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
    // オーディオコンテキストとノード参照を格納する変数
    let audioContext;
    let compressorNode;
    let sourceNode;
    let gainNode;
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
      makeupGain: 0
    };
    let compressorSettings = { ...defaultSettings };



    // YouTubeのURLからチャンネルIDを取得する関数
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
        // チャンネルページの場合
        if (url.includes('/channel/')) {
          const matches = url.match(/\/channel\/([^\/\?]+)/);
          if (matches && matches[1]) {
            channelId = matches[1];
            detectionMethod = 'channel_url';
            console.log('チャンネルページからIDを検出:', channelId);
            return { id: channelId, name: '', method: detectionMethod };
          }
        }

        // YouTubeの動画ページでの複数のセレクタを試行
        const selectors = [
          // 標準的なYouTubeセレクタ
          { selector: '[itemprop="author"] [itemprop="url"]', method: 'itemprop_author_url' },
          { selector: '#owner #channel-name a', method: 'owner_channel_name' },
          // 新しいYouTubeデザイン用のセレクタ
          { selector: 'ytd-video-owner-renderer a', method: 'video_owner_renderer' },
          { selector: 'ytd-channel-name a', method: 'channel_name_link' },
          // フォールバックセレクタ
          { selector: 'a.yt-simple-endpoint.style-scope.yt-formatted-string', method: 'fallback_endpoint' }
        ];

        // 各セレクタを試してチャンネル情報を取得
        for (const selectorInfo of selectors) {
          const channelElement = document.querySelector(selectorInfo.selector);
          if (channelElement) {
            console.log('セレクタでチャンネル要素を検出:', selectorInfo.selector);
            detectionMethod = selectorInfo.method;

            // チャンネルURLからIDを抽出
            if (channelElement.href) {
              const channelUrl = channelElement.href;
              console.log('チャンネルURL:', channelUrl);

              const urlMatches = channelUrl.match(/\/channel\/([^\/\?]+)/);
              if (urlMatches && urlMatches[1]) {
                channelId = urlMatches[1];
                detectionMethod += '_channel_id';
                console.log('URLからチャンネルIDを抽出:', channelId);
                return { id: channelId, name: channelElement.textContent.trim(), method: detectionMethod };
              }

              // /@username 形式のURLの場合
              const usernameMatches = channelUrl.match(/\/@([^\/\?]+)/);
              if (usernameMatches && usernameMatches[1]) {
                channelId = '@' + usernameMatches[1];
                detectionMethod += '_username';
                console.log('URLからユーザー名を抽出:', channelId);
                return { id: channelId, name: channelElement.textContent.trim(), method: detectionMethod };
              }
            }

            // URLからIDを取得できなかった場合はテキスト内容を使用
            if (!channelId && channelElement.textContent) {
              channelName = channelElement.textContent.trim();
              detectionMethod += '_text_only';
              console.log('テキストからチャンネル名を抽出:', channelName);
              return { id: channelName, name: channelName, method: detectionMethod }; // IDの代わりに名前を返す
            }
          }
        }

        // メタデータから取得を試行
        const metaElements = document.querySelectorAll('meta[itemprop="channelId"]');
        if (metaElements.length > 0) {
          channelId = metaElements[0].content;
          detectionMethod = 'meta_channelid';
          console.log('メタデータからチャンネルIDを検出:', channelId);
          return { id: channelId, name: getChannelName(), method: detectionMethod };
        }
      } catch (error) {
        console.error('チャンネルID取得中のエラー:', error);
        detectionMethod = 'error';
      }

      console.log('チャンネルIDの取得に失敗しました');
      return { id: channelName || channelId || 'unknown', name: channelName, method: detectionMethod || 'unknown' };
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



    // メッセージリスナーを設定
    chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
      if (request.action === 'updateCompressorSettings') {
        // 省略...既存のコード
      } else if (request.action === 'getChannelInfo') {
        // 現在のチャンネル情報を返す
        const channelInfo = getYouTubeChannelId();
        sendResponse({
          channelId: channelInfo.id,
          channelName: channelInfo.name || getChannelName(),
          detectionMethod: channelInfo.method
        });
      } else if (request.action === 'forceChannelInfoRefresh') {
        // チャンネル情報を強制的に再取得
        console.log('チャンネル情報の強制更新リクエストを受信');

        // 処理中フラグを立てる 
        let responseData = null;
        let responseTimer = null;

        // DOMをより詳細に確認
        function tryGetChannelInfo() {
          // チャンネル情報を再取得
          const channelInfo = getYouTubeChannelId();
          const channelId = channelInfo.id;
          const channelName = channelInfo.name || getChannelName();

          console.log('取得試行:', channelId, channelName, '方法:', channelInfo.method);

          if (channelId) {
            // 情報を取得できた場合
            console.log('強制更新で取得したチャンネル情報:', channelId, channelName, '方法:', channelInfo.method);

            // 最新のチャンネル情報でグローバル変数を更新
            currentChannelId = channelId;

            // background.jsにも通知
            chrome.runtime.sendMessage({
              action: 'channelChanged',
              channelId: channelId,
              channelName: channelName,
              detectionMethod: channelInfo.method
            });

            // レスポンスデータを設定
            responseData = {
              channelId: channelId,
              channelName: channelName,
              detectionMethod: channelInfo.method
            };

            // レスポンスを送信し、タイマーをクリア
            clearTimeout(responseTimer);
            sendResponse(responseData);
            return true;
          }

          return false;
        }

        // 即時に一度試行
        if (!tryGetChannelInfo()) {
          // 略... 既存のコード
        }

        // 非同期レスポンスのためにtrueを返す
        return true;
      }
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

    // コンプレッサーを動画に適用する関数
    function applyCompressorToVideo(videoElement) {
      try {
        if (!audioContext) {
          audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }

        // 既存のノードがある場合は切断
        if (connectedVideos.has(videoElement)) {
          const nodes = connectedVideos.get(videoElement);
          nodes.source.disconnect();
          nodes.gain.disconnect();
          nodes.compressor.disconnect();
        }

        // 新しいノードを作成
        sourceNode = audioContext.createMediaElementSource(videoElement);
        compressorNode = audioContext.createDynamicsCompressor();
        gainNode = audioContext.createGain();

        // コンプレッサーの設定を適用
        compressorNode.threshold.value = compressorSettings.threshold;
        compressorNode.ratio.value = compressorSettings.ratio;
        compressorNode.attack.value = compressorSettings.attack / 1000; // msから秒に変換
        compressorNode.release.value = compressorSettings.release / 1000; // msから秒に変換
        compressorNode.knee.value = compressorSettings.knee;

        // メイクアップゲインの設定 (dBをリニアゲインに変換)
        gainNode.gain.value = Math.pow(10, compressorSettings.makeupGain / 20);

        // ノードを接続
        if (compressorSettings.enabled) {
          // コンプレッサーとゲインの両方を適用
          sourceNode.connect(compressorNode);
          compressorNode.connect(gainNode);
          gainNode.connect(audioContext.destination);
        } else {
          // コンプレッサーなしでゲイン（音量調整）のみを適用
          sourceNode.connect(gainNode);
          gainNode.connect(audioContext.destination);
        }

        // 接続情報を保存
        connectedVideos.set(videoElement, {
          source: sourceNode,
          compressor: compressorNode,
          gain: gainNode
        });

        console.log('Compressor applied to video element', videoElement);
      } catch (error) {
        console.error('Failed to apply compressor to video:', error);
      }
    }

    // 既存の接続を更新する関数
    function updateCompressorSettings() {
      videoElements.forEach(video => {
        if (connectedVideos.has(video)) {
          const nodes = connectedVideos.get(video);

          // コンプレッサーの設定を更新
          nodes.compressor.threshold.value = compressorSettings.threshold;
          nodes.compressor.ratio.value = compressorSettings.ratio;
          nodes.compressor.attack.value = compressorSettings.attack / 1000;
          nodes.compressor.release.value = compressorSettings.release / 1000;
          nodes.compressor.knee.value = compressorSettings.knee;

          // メイクアップゲインの更新 (dBをリニアゲインに変換)
          nodes.gain.gain.value = Math.pow(10, compressorSettings.makeupGain / 20);
        }
      });
    }

    // コンプレッサーの有効/無効を切り替える関数
    function toggleCompressor(enabled) {
      videoElements.forEach(video => {
        if (connectedVideos.has(video)) {
          const nodes = connectedVideos.get(video);

          // 現在の接続を解除
          nodes.source.disconnect();
          nodes.compressor.disconnect();
          nodes.gain.disconnect();

          // 有効/無効に応じて再接続
          if (enabled) {
            // コンプレッサーとゲイン両方適用
            nodes.source.connect(nodes.compressor);
            nodes.compressor.connect(nodes.gain);
            nodes.gain.connect(audioContext.destination);
          } else {
            // コンプレッサーなしでゲイン（音量調整）のみを適用
            nodes.source.connect(nodes.gain);
            nodes.gain.connect(audioContext.destination);
          }
        }
      });
    }

    // URLの変更を監視して、チャンネルが変わったら設定を再読み込み
    let lastUrl = window.location.href;
    let lastChannelId = '';

    // YouTube SPA内の遷移を監視する関数
    function checkForNavigationChanges() {
      const currentUrl = window.location.href;

      if (lastUrl !== currentUrl) {
        console.log('URLが変更されました:', lastUrl, '->', currentUrl);
        lastUrl = currentUrl;

        // YouTubeのSPA遷移後、DOMが構築されるまで少し待機
        setTimeout(() => {
          // チャンネル情報を再読み込み
          const channelInfo = getYouTubeChannelId();
          const newChannelId = channelInfo.id;
          const channelName = channelInfo.name || getChannelName();

          console.log('URLの変更を検出。新しいチャンネル:', newChannelId, channelName, '方法:', channelInfo.method);

          // チャンネルIDが変更された場合
          if (newChannelId !== lastChannelId) {
            lastChannelId = newChannelId;

            // 新しいチャンネル情報をbackground.jsに通知
            chrome.runtime.sendMessage({
              action: 'channelChanged',
              channelId: newChannelId,
              channelName: channelName,
              detectionMethod: channelInfo.method
            });

            // 新しいチャンネルの設定を読み込み
            loadChannelSettings();
          }
        }, 1000);
      }
    }

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