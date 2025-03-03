(function () {
  // 拡張機能がアクティブかどうかを確認
  function checkExtensionContext() {
    try {
      chrome.runtime.sendMessage({ action: 'ping' }, function (response) {
        if (chrome.runtime.lastError) {
          console.log('拡張機能のコンテキストが無効です:', chrome.runtime.lastError.message);
          return;
        }
        // 正常なら初期化
        initializeExtension();
      });
    } catch (e) {
      console.log('拡張機能初期化エラー:', e);
      return;
    }
  }

  // メイン機能を初期化する関数
  function initializeExtension() {

    // リアルタイム更新のスロットリング用
    let updateThrottleTimeout = null;

    // 検出メソッドを追跡する変数を追加
    let lastDetectionMethod = '';
    // ナビゲーション変更用のタイムアウト変数を追加
    let navigationChangeTimeout = null;

    // content.js に追加する変更
    // 初期化関数の変数定義部分に以下を追加:

    // Web Audio APIのノード参照
    let audioContext;
    let compressorNode;
    let sourceNode;
    let gainNode;
    let analyserNode; // 新規: 音声分析用
    let loudnessWorkletNode; // ScriptProcessorNodeの代わりにAudioWorkletNodeを使用
    let workletInitialized = false; // AudioWorkletProcessorが初期化されたかどうか
    let videoElements = [];
    let connectedVideos = new WeakMap();
    let currentChannelId = '';
    let defaultSettings = {
      enabled: true,
      threshold: -24,
      ratio: 4,
      attack: 50,
      release: 250,
      knee: 5,
      makeupGain: 0,
      // ラウドネスノーマライズの設定を追加
      loudnessNormEnabled: false,
      targetLoudness: -14, // LUFS (一般的なストリーミングサービスの標準値)
      loudnessRange: 7     // 許容範囲 (dB)
    };
    let compressorSettings = { ...defaultSettings };

    // ラウドネスの測定と調整のための変数
    let currentLoudness = -70; // 初期値は十分に小さくしておく
    let loudnessHistory = []; // 過去のラウドネス値履歴
    const HISTORY_SIZE = 10; // 履歴サイズ
    let lastGainAdjustment = 0; // 前回のゲイン調整値

    // メーターの重み付け係数 (K-weighting filter近似)
    let kWeights = {
      lowShelf: {
        frequency: 60,
        gain: -10
      },
      highPass: {
        frequency: 100
      },
      highShelf: {
        frequency: 8000,
        gain: 4
      }
    };


    // AudioWorkletを初期化する関数
    async function initAudioWorklet() {
      if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }

      if (!workletInitialized) {
        try {
          // AudioWorkletProcessorモジュールのURLを作成
          // Chrome拡張機能内のファイルへのURLを取得
          const workletUrl = chrome.runtime.getURL('loudness-processor.js');

          // AudioWorkletを追加
          await audioContext.audioWorklet.addModule(workletUrl);
          workletInitialized = true;
          console.log('AudioWorklet initialized successfully');
        } catch (error) {
          console.error('Failed to initialize AudioWorklet:', error);
          // AudioWorkletの初期化に失敗した場合はフラグをリセット
          workletInitialized = false;
        }
      }

      return workletInitialized;
    }

    // YouTubeのURLからチャンネルIDを取得する関数（シンプル化版）
    function getYouTubeChannelId() {
      // 現在のURLを取得
      const url = window.location.href;

      // YouTubeのページかどうかを確認
      if (!url.includes('youtube.com')) {
        console.log('YouTubeページではありません');
        return { id: '', name: '', method: 'not_youtube' };
      }

      let channelId = '';
      let channelName = '';
      let detectionMethod = '';

      console.log('YouTubeページでチャンネル情報を検索中...');

      try {
        // チャンネルページの場合（最も信頼性が高い）
        if (url.includes('/channel/')) {
          const matches = url.match(/\/channel\/([^\/\?]+)/);
          if (matches && matches[1]) {
            channelId = matches[1];
            detectionMethod = 'channel_url';
            console.log('チャンネルページからIDを検出:', channelId);

            // タイトルからチャンネル名を取得
            const titleElem = document.querySelector('title');
            if (titleElem) {
              channelName = titleElem.textContent.replace(' - YouTube', '').trim();
            }

            return { id: channelId, name: channelName, method: detectionMethod };
          }
        }

        // ユーザーページ (/@username) の場合
        if (url.includes('/@')) {
          const matches = url.match(/\/@([^\/\?]+)/);
          if (matches && matches[1]) {
            channelId = '@' + matches[1];
            detectionMethod = 'username_url';
            console.log('URLからユーザー名を検出:', channelId);

            // タイトルからチャンネル名を取得
            const titleElem = document.querySelector('title');
            if (titleElem) {
              channelName = titleElem.textContent.replace(' - YouTube', '').trim();
            }

            return { id: channelId, name: channelName, method: detectionMethod };
          }
        }

        // 動画ページの場合
        if (url.includes('/watch')) {
          // 1. メタデータから取得（最も信頼性が高い）
          const metaElements = document.querySelectorAll('meta[itemprop="channelId"]');
          if (metaElements.length > 0) {
            channelId = metaElements[0].content;
            detectionMethod = 'meta_channelid';
            console.log('メタデータからチャンネルIDを検出:', channelId);

            // チャンネル名の取得
            const nameElements = document.querySelectorAll('meta[itemprop="author"]');
            if (nameElements.length > 0) {
              channelName = nameElements[0].content;
            } else {
              channelName = getChannelName();
            }

            return { id: channelId, name: channelName, method: detectionMethod };
          }

          // 2. 新しいYouTubeデザイン用のセレクタ（信頼性順）
          const channelSelectors = [
            { selector: '#owner #channel-name a', method: 'owner_channel_name' },
            { selector: 'ytd-video-owner-renderer a', method: 'video_owner_renderer' },
            { selector: 'ytd-channel-name a', method: 'channel_name_link' }
          ];

          for (const selectorInfo of channelSelectors) {
            const channelElement = document.querySelector(selectorInfo.selector);
            if (channelElement && channelElement.href) {
              console.log('セレクタでチャンネル要素を検出:', selectorInfo.selector);
              detectionMethod = selectorInfo.method;

              // チャンネルURLからIDを抽出
              const channelUrl = channelElement.href;
              console.log('チャンネルURL:', channelUrl);

              // チャンネルIDを取得
              const urlMatches = channelUrl.match(/\/channel\/([^\/\?]+)/);
              if (urlMatches && urlMatches[1]) {
                channelId = urlMatches[1];
                detectionMethod += '_channel_id';
                console.log('URLからチャンネルIDを抽出:', channelId);
                return { id: channelId, name: channelElement.textContent.trim(), method: detectionMethod };
              }

              // ユーザー名を取得
              const usernameMatches = channelUrl.match(/\/@([^\/\?]+)/);
              if (usernameMatches && usernameMatches[1]) {
                channelId = '@' + usernameMatches[1];
                detectionMethod += '_username';
                console.log('URLからユーザー名を抽出:', channelId);
                return { id: channelId, name: channelElement.textContent.trim(), method: detectionMethod };
              }
            }
          }

          // 3. 動画説明文でチャンネル情報を確認
          const descriptionElement = document.querySelector('#description');
          if (descriptionElement) {
            const links = descriptionElement.querySelectorAll('a[href*="/channel/"], a[href*="/@"]');
            if (links && links.length > 0) {
              const channelLink = links[0].href;

              if (channelLink.includes('/channel/')) {
                const matches = channelLink.match(/\/channel\/([^\/\?]+)/);
                if (matches && matches[1]) {
                  channelId = matches[1];
                  channelName = links[0].textContent.trim();
                  detectionMethod = 'description_channel_link';
                  console.log('説明文でチャンネルIDを発見:', channelId);
                  return { id: channelId, name: channelName, method: detectionMethod };
                }
              }

              if (channelLink.includes('/@')) {
                const matches = channelLink.match(/\/@([^\/\?]+)/);
                if (matches && matches[1]) {
                  channelId = '@' + matches[1];
                  channelName = links[0].textContent.trim();
                  detectionMethod = 'description_username_link';
                  console.log('説明文でユーザー名を発見:', channelId);
                  return { id: channelId, name: channelName, method: detectionMethod };
                }
              }
            }
          }

          // 4. スクリプトからJSONデータを取得
          const scriptElements = document.querySelectorAll('script');
          for (const script of scriptElements) {
            const text = script.textContent;
            if (text && text.includes('"channelId":"')) {
              const matches = text.match(/"channelId":"([^"]+)"/);
              if (matches && matches[1]) {
                channelId = matches[1];
                detectionMethod = 'script_json_data';
                console.log('スクリプトデータでチャンネルIDを発見:', channelId);

                // チャンネル名も抽出
                const nameMatches = text.match(/"ownerChannelName":"([^"]+)"/);
                if (nameMatches && nameMatches[1]) {
                  channelName = nameMatches[1];
                } else {
                  channelName = getChannelName();
                }

                return { id: channelId, name: channelName, method: detectionMethod };
              }
            }
          }
        }
      } catch (error) {
        console.error('チャンネルID取得中のエラー:', error);
        detectionMethod = 'error';
      }

      console.log('チャンネルIDの取得に失敗しました');
      return { id: channelName || channelId || 'unknown', name: channelName, method: detectionMethod || 'unknown' };
    }

    // 要素が表示されているかどうかを確認するヘルパー関数
    function isElementVisible(element) {
      if (!element) return false;

      const style = window.getComputedStyle(element);
      return style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0' &&
        element.offsetWidth > 0 &&
        element.offsetHeight > 0;
    }

    // より長いタイムアウトを持つ改良されたURL変更検出
    function checkForNavigationChanges() {
      const currentUrl = window.location.href;

      if (lastUrl !== currentUrl) {
        console.log('URLが変更されました:', lastUrl, '->', currentUrl);
        lastUrl = currentUrl;

        // 以前のタイムアウトがある場合はクリア
        if (navigationChangeTimeout) {
          clearTimeout(navigationChangeTimeout);
        }

        // DOMが完全に更新されるのを待つために長めのタイムアウトを設定
        navigationChangeTimeout = setTimeout(() => {
          // 遅延後にチャンネル情報を取得
          const channelInfo = getYouTubeChannelId();
          const newChannelId = channelInfo.id;
          const channelName = channelInfo.name || getChannelName();

          console.log('URLの変更を検出。新しいチャンネル:', newChannelId, channelName, '方法:', channelInfo.method);

          // チャンネルIDが変更された場合のみ更新
          if (newChannelId !== lastChannelId) {
            lastChannelId = newChannelId;

            // チャンネル変更をbackground.jsに通知
            chrome.runtime.sendMessage({
              action: 'channelChanged',
              channelId: newChannelId,
              channelName: channelName,
              detectionMethod: channelInfo.method
            });

            // 新しいチャンネルの設定を読み込み
            loadChannelSettings();
          }
        }, 2000); // タイムアウトを2秒に設定
      }
    }

    // チャンネル固有の設定キーを作成
    function getChannelSettingsKey(channelId) {
      return channelId ? `channel_${channelId}` : 'default';
    }

    // 現在のチャンネルの設定を読み込む
    function loadChannelSettings() {
      const channelInfo = getYouTubeChannelId();
      currentChannelId = channelInfo.id;
      const settingsKey = getChannelSettingsKey(currentChannelId);

      // チャンネル設定とデフォルト設定を取得
      chrome.storage.sync.get({
        'default': defaultSettings,
        [settingsKey]: null
      }, function (items) {
        // デフォルト設定を読み込む
        const defaultConfig = items.default || defaultSettings;

        // チャンネル固有の設定があればそれを適用、なければデフォルト設定を使用
        if (items[settingsKey]) {
          compressorSettings = items[settingsKey];
        } else {
          compressorSettings = defaultConfig;
        }

        // 設定を適用
        updateCompressorSettings();
        toggleCompressor(compressorSettings.enabled);

        // 既存のビデオを探してコンプレッサーを適用
        findAndProcessVideos();

        // 現在のチャンネル情報を拡張機能に通知
        chrome.runtime.sendMessage({
          action: 'currentChannelUpdate',
          channelId: channelInfo.id,
          channelName: channelInfo.name || getChannelName(),
          detectionMethod: channelInfo.method
        });
      });
    }

    // チャンネル名を取得
    function getChannelName() {
      if (!window.location.href.includes('youtube.com')) {
        return '';
      }

      // チャンネル名の取得
      const channelElement = document.querySelector('[itemprop="author"] [itemprop="name"], #owner #channel-name');
      if (channelElement) {
        return channelElement.textContent.trim();
      }

      return '';
    }


    // メッセージリスナーを拡張して新しいコマンドに対応:
    chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
      console.log('コンテンツスクリプトがメッセージを受信:', request.action);

      // pingメッセージには即座に応答
      if (request.action === 'ping') {
        console.log('ping要求を受信 - pongで応答');
        sendResponse({ status: 'pong' });
        return true;
      }

      if (request.action === 'updateCompressorSettings') {
        try {
          console.log('コンプレッサー設定更新を受信:', request.settings);

          // 設定を更新
          compressorSettings = request.settings;

          // 連続した更新をスロットリング
          if (updateThrottleTimeout) {
            clearTimeout(updateThrottleTimeout);
          }

          updateThrottleTimeout = setTimeout(() => {
            // コンプレッサーの設定を適用
            updateCompressorSettings();

            // コンプレッサーの有効/無効を適用
            toggleCompressor(compressorSettings.enabled);

            // ラウドネスノーマライズの設定を適用 (新規)
            if ('loudnessNormEnabled' in compressorSettings) {
              toggleLoudnessNormalization(compressorSettings.loudnessNormEnabled);
            }

            // ラウドネスの目標値と範囲を更新 (新規)
            if ('targetLoudness' in compressorSettings && 'loudnessRange' in compressorSettings) {
              updateLoudnessSettings(compressorSettings.targetLoudness, compressorSettings.loudnessRange);
            }
          }, 20); // 20msのスロットリング

          // 以下、保存処理部分は変更なし
          // チャンネル固有の設定を保存...
          // ...

          sendResponse({ success: true });
        } catch (error) {
          console.error('設定更新処理中のエラー:', error);
          sendResponse({ success: false, error: error.message });
        }
        return true;
      }

      // getLoudnessInfo - 現在のラウドネス情報を取得する新しいコマンド
      // メッセージリスナーの getLoudnessInfo 処理を更新
      // ...
      else if (request.action === 'getLoudnessInfo') {
        try {
          sendResponse({
            success: true,
            currentLoudness: currentLoudness,
            targetLoudness: compressorSettings.targetLoudness,
            isEnabled: compressorSettings.loudnessNormEnabled && workletInitialized
          });
        } catch (error) {
          console.error('ラウドネス情報取得中のエラー:', error);
          sendResponse({
            success: false,
            error: error.message,
            workletInitialized: workletInitialized
          });
        }
        return true;
      }
      // ...

      // 他のメッセージタイプは元のままで処理
      // ...

      // 非同期レスポンスのためにtrueを返す
      return true;
    });


    // ページ内の動画要素を探してコンプレッサーを適用
    function findAndProcessVideos() {
      const videos = document.querySelectorAll('video');
      videos.forEach(video => {
        if (!connectedVideos.has(video)) {
          videoElements.push(video);
          // 動画が再生を開始したときにコンプレッサーを適用
          video.addEventListener('play', function () {
            if (!connectedVideos.has(video)) {
              applyCompressorToVideo(video);
            }
          });

          // 既に再生中の動画にもコンプレッサーを適用
          if (!video.paused) {
            applyCompressorToVideo(video);
          }
        }
      });
    }


    // 動画にコンプレッサーを適用する関数（更新版）
    async function applyCompressorToVideo(videoElement) {
      try {
        if (!audioContext) {
          audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }

        // AudioWorkletが必要かつ初期化されていなければ初期化を試みる
        if (compressorSettings.loudnessNormEnabled && !workletInitialized) {
          const initialized = await initAudioWorklet();
          if (!initialized) {
            console.warn('AudioWorklet initialization failed, loudness normalization disabled');
            // 初期化に失敗した場合はラウドネスノーマライズを無効化
            compressorSettings.loudnessNormEnabled = false;
          }
        }

        // 既存のノードがある場合は切断
        if (connectedVideos.has(videoElement)) {
          const nodes = connectedVideos.get(videoElement);
          nodes.source.disconnect();

          if (nodes.analyser) {
            nodes.analyser.disconnect();
          }

          if (nodes.loudnessWorklet) {
            nodes.loudnessWorklet.disconnect();
            // Workletポートのイベントリスナーを削除
            if (nodes.loudnessWorklet.port) {
              nodes.loudnessWorklet.port.onmessage = null;
            }
          }

          nodes.gain.disconnect();
          nodes.compressor.disconnect();
        }

        // 新しいノードを作成
        sourceNode = audioContext.createMediaElementSource(videoElement);
        compressorNode = audioContext.createDynamicsCompressor();
        gainNode = audioContext.createGain();
        analyserNode = audioContext.createAnalyser();
        analyserNode.fftSize = 2048;

        // AudioWorkletNodeの作成（ラウドネスノーマライズ有効時のみ）
        if (compressorSettings.loudnessNormEnabled && workletInitialized) {
          loudnessWorkletNode = new AudioWorkletNode(audioContext, 'loudness-processor');

          // Workletから測定データを受信
          loudnessWorkletNode.port.onmessage = (event) => {
            if (event.data.type === 'measurement') {
              // 測定されたラウドネス値を取得
              const measuredLoudness = event.data.loudness;
              currentLoudness = measuredLoudness;

              // 目標ラウドネスとの差を計算
              const loudnessDifference = compressorSettings.targetLoudness - measuredLoudness;

              // 差が許容範囲内であれば調整しない
              const withinRange = Math.abs(loudnessDifference) <= compressorSettings.loudnessRange / 2;

              if (!withinRange) {
                // 適用するゲイン調整値を計算（変化が緩やかになるよう制限）
                const MAX_ADJUSTMENT = 0.5; // 一度に最大0.5dBまで調整
                let gainAdjustment = Math.max(-MAX_ADJUSTMENT, Math.min(MAX_ADJUSTMENT, loudnessDifference * 0.1));

                // 前回の調整値との平均をとり、変化を滑らかにする
                gainAdjustment = (gainAdjustment + lastGainAdjustment) / 2;
                lastGainAdjustment = gainAdjustment;

                // ゲイン値を更新
                const currentGainDb = compressorSettings.makeupGain;
                const newGainDb = currentGainDb + gainAdjustment;

                // ゲイン調整の範囲を制限 (-12dB から +12dB)
                const limitedGainDb = Math.max(-12, Math.min(12, newGainDb));

                // 音が大きすぎる場合は下げる、小さすぎる場合は上げる
                if (newGainDb !== currentGainDb) {
                  // 全てのビデオ要素に対して調整
                  videoElements.forEach(video => {
                    if (connectedVideos.has(video)) {
                      const nodes = connectedVideos.get(video);
                      const linearGain = Math.pow(10, limitedGainDb / 20);

                      // 滑らかに変化させるため時間をかけて調整
                      const now = audioContext.currentTime;
                      nodes.gain.gain.linearRampToValueAtTime(linearGain, now + 0.1);
                    }
                  });

                  // 設定も更新
                  compressorSettings.makeupGain = limitedGainDb;
                }
              }
            }
          };

          // 現在の設定をWorkletに送信
          loudnessWorkletNode.port.postMessage({
            type: 'config',
            targetLoudness: compressorSettings.targetLoudness,
            loudnessRange: compressorSettings.loudnessRange
          });
        }

        // コンプレッサーの設定を適用
        compressorNode.threshold.value = compressorSettings.threshold;
        compressorNode.ratio.value = compressorSettings.ratio;
        compressorNode.attack.value = compressorSettings.attack / 1000; // msから秒に変換
        compressorNode.release.value = compressorSettings.release / 1000; // msから秒に変換
        compressorNode.knee.value = compressorSettings.knee;

        // メイクアップゲインの設定 (dBをリニアゲインに変換)
        gainNode.gain.value = Math.pow(10, compressorSettings.makeupGain / 20);

        // ノードを接続 (ラウドネスノーマライズが有効な場合は分析ノードも含める)
        if (compressorSettings.enabled) {
          // オーディオパスの接続
          sourceNode.connect(compressorNode);
          compressorNode.connect(gainNode);

          // ラウドネスノーマライズが有効かつWorkletが初期化されている場合
          if (compressorSettings.loudnessNormEnabled && workletInitialized) {
            // ラウドネス測定用の分岐パスを接続
            gainNode.connect(analyserNode);
            analyserNode.connect(loudnessWorkletNode);
            // AudioWorkletにオーディオを送るが、出力はしない（パラレル処理）
            gainNode.connect(audioContext.destination);
          } else {
            // 通常のオーディオパス
            gainNode.connect(audioContext.destination);
          }
        } else {
          // コンプレッサーなしでゲイン（音量調整）のみを適用
          sourceNode.connect(gainNode);

          // ラウドネスノーマライズが有効かつWorkletが初期化されている場合
          if (compressorSettings.loudnessNormEnabled && workletInitialized) {
            // ラウドネス測定用の分岐パスを接続
            gainNode.connect(analyserNode);
            analyserNode.connect(loudnessWorkletNode);
            // 通常のオーディオパス
            gainNode.connect(audioContext.destination);
          } else {
            // 通常のオーディオパス
            gainNode.connect(audioContext.destination);
          }
        }

        // 接続情報を保存
        connectedVideos.set(videoElement, {
          source: sourceNode,
          compressor: compressorNode,
          gain: gainNode,
          analyser: analyserNode,
          loudnessWorklet: compressorSettings.loudnessNormEnabled && workletInitialized ? loudnessWorkletNode : null
        });

        console.log('Audio processing applied to video element', videoElement);
      } catch (error) {
        console.error('Failed to apply audio processing to video:', error);
      }
    }


    // より効率的なコンプレッサー設定更新関数
    function updateCompressorSettings() {
      // 更新の最適化のため、接続されたビデオが存在する場合のみ処理を行う
      if (videoElements.length === 0 || connectedVideos.size === 0) {
        return;
      }

      // 現在再生中のビデオのみを更新（リソース節約）
      videoElements.forEach(video => {
        if (connectedVideos.has(video) && !video.paused) {
          const nodes = connectedVideos.get(video);

          // AudioParamの変化を滑らかにするために時間を設定
          // 即時変更ではなく少し時間をかけて変化させる
          const now = audioContext.currentTime;
          const transitionTime = 0.05; // 50ミリ秒の滑らかな遷移

          // 各パラメータを徐々に変更
          nodes.compressor.threshold.linearRampToValueAtTime(compressorSettings.threshold, now + transitionTime);
          nodes.compressor.ratio.linearRampToValueAtTime(compressorSettings.ratio, now + transitionTime);
          nodes.compressor.attack.linearRampToValueAtTime(compressorSettings.attack / 1000, now + transitionTime);
          nodes.compressor.release.linearRampToValueAtTime(compressorSettings.release / 1000, now + transitionTime);
          nodes.compressor.knee.linearRampToValueAtTime(compressorSettings.knee, now + transitionTime);

          // メイクアップゲインも滑らかに変更
          const newGain = Math.pow(10, compressorSettings.makeupGain / 20);
          nodes.gain.gain.linearRampToValueAtTime(newGain, now + transitionTime);
        }
      });
    }



    // オーディオ処理関数 (ラウドネス計算と調整)
    function processAudio(event) {
      // ラウドネスノーマライズが無効の場合は何もしない
      if (!compressorSettings.loudnessNormEnabled) return;

      try {
        // 入力バッファを取得
        const inputBuffer = event.inputBuffer;
        const inputData = inputBuffer.getChannelData(0); // 左チャンネル

        // RMSレベル計算 (単純な音量レベル)
        let sum = 0;
        for (let i = 0; i < inputData.length; i++) {
          sum += inputData[i] * inputData[i];
        }
        const rms = Math.sqrt(sum / inputData.length);

        // RMSをdBに変換 (20 * log10(rms))
        const dbFS = 20 * Math.log10(rms);

        // 簡易的なLUFSへの変換 (実際のLUFSはもっと複雑)
        // EBU R128 規格の簡易近似
        const lufs = dbFS - 10; // 簡易的な K-weighting 補正

        // -70dB未満の値は無視 (無音部分)
        if (lufs > -70) {
          // 履歴に追加
          loudnessHistory.push(lufs);
          if (loudnessHistory.length > HISTORY_SIZE) {
            loudnessHistory.shift(); // 古い値を削除
          }

          // 平均ラウドネスを計算
          const avgLoudness = loudnessHistory.reduce((a, b) => a + b, 0) / loudnessHistory.length;
          currentLoudness = avgLoudness;

          // 目標ラウドネスとの差を計算
          const loudnessDifference = compressorSettings.targetLoudness - avgLoudness;

          // 差が許容範囲内であれば調整しない
          const withinRange = Math.abs(loudnessDifference) <= compressorSettings.loudnessRange / 2;

          if (!withinRange) {
            // 適用するゲイン調整値を計算 (変化が緩やかになるよう制限)
            const MAX_ADJUSTMENT = 0.5; // 一度に最大0.5dBまで調整
            let gainAdjustment = Math.max(-MAX_ADJUSTMENT, Math.min(MAX_ADJUSTMENT, loudnessDifference * 0.1));

            // 前回の調整値との平均をとり、変化を滑らかにする
            gainAdjustment = (gainAdjustment + lastGainAdjustment) / 2;
            lastGainAdjustment = gainAdjustment;

            // ゲイン値を更新
            const currentGainDb = compressorSettings.makeupGain;
            const newGainDb = currentGainDb + gainAdjustment;

            // ゲイン調整の範囲を制限 (-12dB から +12dB)
            const limitedGainDb = Math.max(-12, Math.min(12, newGainDb));

            // 音が大きすぎる場合は下げる、小さすぎる場合は上げる
            if (newGainDb !== currentGainDb) {
              // 全てのビデオ要素に対して調整
              videoElements.forEach(video => {
                if (connectedVideos.has(video)) {
                  const nodes = connectedVideos.get(video);
                  const linearGain = Math.pow(10, limitedGainDb / 20);

                  // 滑らかに変化させるため時間をかけて調整
                  const now = audioContext.currentTime;
                  nodes.gain.gain.linearRampToValueAtTime(linearGain, now + 0.1);
                }
              });

              // 設定も更新
              compressorSettings.makeupGain = limitedGainDb;
            }
          }
        }
      } catch (e) {
        console.error('Error in audio processing:', e);
      }
    }



    // トグルコンプレッサーの関数を更新
    function toggleCompressor(enabled) {
      videoElements.forEach(video => {
        if (connectedVideos.has(video)) {
          const nodes = connectedVideos.get(video);

          // 現在の接続を解除
          nodes.source.disconnect();
          nodes.compressor.disconnect();
          nodes.gain.disconnect();

          if (nodes.analyser) {
            nodes.analyser.disconnect();
          }

          if (nodes.loudnessWorklet) {
            nodes.loudnessWorklet.disconnect();
          }

          // 有効/無効に応じて再接続
          if (enabled) {
            // コンプレッサーとゲイン両方適用
            nodes.source.connect(nodes.compressor);
            nodes.compressor.connect(nodes.gain);

            // ラウドネスノーマライズが有効かつWorkletが初期化されている場合
            if (compressorSettings.loudnessNormEnabled && workletInitialized && nodes.loudnessWorklet) {
              // ラウドネス測定用の分岐パスを接続
              nodes.gain.connect(nodes.analyser);
              nodes.analyser.connect(nodes.loudnessWorklet);
              nodes.gain.connect(audioContext.destination);
            } else {
              nodes.gain.connect(audioContext.destination);
            }
          } else {
            // コンプレッサーなしでゲイン（音量調整）のみを適用
            nodes.source.connect(nodes.gain);

            // ラウドネスノーマライズが有効かつWorkletが初期化されている場合
            if (compressorSettings.loudnessNormEnabled && workletInitialized && nodes.loudnessWorklet) {
              // ラウドネス測定用の分岐パスを接続
              nodes.gain.connect(nodes.analyser);
              nodes.analyser.connect(nodes.loudnessWorklet);
              nodes.gain.connect(audioContext.destination);
            } else {
              nodes.gain.connect(audioContext.destination);
            }
          }
        }
      });
    }



    // ラウドネスノーマライズの有効/無効を切り替える関数を更新
    async function toggleLoudnessNormalization(enabled) {
      compressorSettings.loudnessNormEnabled = enabled;

      if (enabled && !workletInitialized) {
        // 有効化時にWorkletが初期化されていなければ初期化を試みる
        const initialized = await initAudioWorklet();
        if (!initialized) {
          console.warn('AudioWorklet initialization failed, loudness normalization disabled');
          compressorSettings.loudnessNormEnabled = false;
          return false;
        }
      }

      // 履歴をリセット
      loudnessHistory = [];
      currentLoudness = -70;
      lastGainAdjustment = 0;

      // 既存の接続を更新
      videoElements.forEach(video => {
        if (connectedVideos.has(video) && !video.paused) {
          // すでに接続されている場合は、再適用して接続を更新
          applyCompressorToVideo(video);
        }
      });

      return true;
    }


    // ラウドネスノーマライズの設定を更新する関数
    function updateLoudnessSettings(targetLoudness, loudnessRange) {
      compressorSettings.targetLoudness = targetLoudness;
      compressorSettings.loudnessRange = loudnessRange;

      // 設定を接続済みのWorkletに送信
      videoElements.forEach(video => {
        if (connectedVideos.has(video)) {
          const nodes = connectedVideos.get(video);
          if (nodes.loudnessWorklet && nodes.loudnessWorklet.port) {
            nodes.loudnessWorklet.port.postMessage({
              type: 'config',
              targetLoudness: targetLoudness,
              loudnessRange: loudnessRange
            });
          }
        }
      });

      // 履歴をリセット
      loudnessHistory = [];
      currentLoudness = -70;
      lastGainAdjustment = 0;
    }





    // URLの変更を監視して、チャンネルが変わったら設定を再読み込み
    let lastUrl = window.location.href;
    let lastChannelId = '';

    // 定期的にURLの変更をチェック（YouTube SPAの遷移に対応）
    setInterval(checkForNavigationChanges, 1000);

    // DOMの変更も監視（URLだけでは検出できない変更に対応）
    new MutationObserver(() => {
      // URLの変更をチェック
      checkForNavigationChanges();

      // ビデオ要素を検出
      findAndProcessVideos();
    }).observe(document, { subtree: true, childList: true });

    // 初期設定の読み込み
    loadChannelSettings();
  }

  // 初期チェック実行
  checkExtensionContext();
})();