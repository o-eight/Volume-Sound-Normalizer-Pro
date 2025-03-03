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

    // 検出メソッドを追跡する変数を追加
    let lastDetectionMethod = '';
    // ナビゲーション変更用のタイムアウト変数を追加
    let navigationChangeTimeout = null;



    // YouTubeのチャンネルIDを取得する関数（改良版）
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
        // DOMキャッシュをリセットして新鮮な検出を確保
        document.body.querySelector = HTMLBodyElement.prototype.querySelector;

        // まずチャンネルページを直接処理
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

        // 動画ページの場合、複数の検出方法を検証付きで使用
        if (url.includes('/watch')) {
          // まずメタデータからチャンネルを取得（最も信頼性が高い）
          const metaElements = document.querySelectorAll('meta[itemprop="channelId"]');
          if (metaElements.length > 0) {
            channelId = metaElements[0].content;
            detectionMethod = 'meta_channelid';
            console.log('メタデータからチャンネルIDを検出:', channelId);

            // 他のメタデータからチャンネル名も取得
            const nameElements = document.querySelectorAll('meta[itemprop="author"]');
            if (nameElements.length > 0) {
              channelName = nameElements[0].content;
            } else {
              channelName = getChannelName();
            }

            return { id: channelId, name: channelName, method: detectionMethod };
          }

          // 検証付きで様々なDOMセレクタを試行
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

          // 各セレクタを試し、結果を検証
          for (const selectorInfo of selectors) {
            const channelElements = document.querySelectorAll(selectorInfo.selector);

            // 重要: 複数の要素が見つかった場合、最も関連性の高いものを使用
            if (channelElements && channelElements.length > 0) {
              let channelElement = null;

              // 複数の要素がある場合、動画所有者である可能性が最も高いものを探す
              if (channelElements.length > 1) {
                // 表示されていて有効なリンクを含む要素を探す
                for (let i = 0; i < channelElements.length; i++) {
                  const elem = channelElements[i];
                  if (elem.href &&
                    (elem.href.includes('/channel/') || elem.href.includes('/@')) &&
                    isElementVisible(elem)) {
                    channelElement = elem;
                    break;
                  }
                }

                // 良い候補が見つからなかった場合、最初のものを使用
                if (!channelElement) {
                  channelElement = channelElements[0];
                }
              } else {
                channelElement = channelElements[0];
              }

              console.log('セレクタでチャンネル要素を検出:', selectorInfo.selector);
              detectionMethod = selectorInfo.method;

              // hrefが利用可能な場合、そこからチャンネルIDを抽出
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

                // /@username 形式を処理
                const usernameMatches = channelUrl.match(/\/@([^\/\?]+)/);
                if (usernameMatches && usernameMatches[1]) {
                  channelId = '@' + usernameMatches[1];
                  detectionMethod += '_username';
                  console.log('URLからユーザー名を抽出:', channelId);
                  return { id: channelId, name: channelElement.textContent.trim(), method: detectionMethod };
                }
              }

              // URL抽出が失敗した場合、フォールバックとしてテキスト内容を使用
              if (!channelId && channelElement.textContent) {
                channelName = channelElement.textContent.trim();
                channelId = channelName; // IDのフォールバックとして名前を使用
                detectionMethod += '_text_only';
                console.log('テキストからチャンネル名を抽出:', channelName);
                return { id: channelId, name: channelName, method: detectionMethod };
              }
            }
          }
        }

        // ここまで来た場合、チャンネル情報を見つけるためにより積極的な方法を使用
        console.log('標準的な検出方法が失敗しました、代替方法を試行中...');

        // 動画説明文でチャンネル情報を確認
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

        // 最終フォールバック: ページのJSONデータから抽出
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

          // チャンネルIDが変更された場合、またはより良い検出方法がある場合のみ更新
          const shouldUpdate = newChannelId !== lastChannelId ||
            (newChannelId === lastChannelId &&
              isImprovedDetectionMethod(channelInfo.method, lastDetectionMethod));

          if (shouldUpdate) {
            lastChannelId = newChannelId;
            lastDetectionMethod = channelInfo.method;

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
        }, 2000); // タイムアウトを2秒に増加
      }
    }

    // 新しい検出方法が以前のものより信頼性が高いかどうかを判断する関数
    function isImprovedDetectionMethod(newMethod, oldMethod) {
      // 検出方法の信頼性ランキングを定義（インデックスが高いほど信頼性が高い）
      const methodReliability = [
        'unknown',
        'error',
        'fallback_endpoint_text_only',
        'channel_name_link_text_only',
        'video_owner_renderer_text_only',
        'owner_channel_name_text_only',
        'itemprop_author_url_text_only',
        'fallback_endpoint_username',
        'channel_name_link_username',
        'video_owner_renderer_username',
        'owner_channel_name_username',
        'itemprop_author_url_username',
        'fallback_endpoint_channel_id',
        'channel_name_link_channel_id',
        'video_owner_renderer_channel_id',
        'owner_channel_name_channel_id',
        'itemprop_author_url_channel_id',
        'description_username_link',
        'description_channel_link',
        'username_url',
        'script_json_data',
        'meta_channelid',
        'channel_url'
      ];

      const newMethodRank = methodReliability.indexOf(newMethod);
      const oldMethodRank = methodReliability.indexOf(oldMethod);

      // メソッドがリストに見つからない場合、最低の信頼性を割り当て
      const newRank = newMethodRank === -1 ? 0 : newMethodRank;
      const oldRank = oldMethodRank === -1 ? 0 : oldMethodRank;

      return newRank > oldRank;
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



    // メッセージリスナーを改善
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

          // コンプレッサーの設定を適用
          updateCompressorSettings();
          toggleCompressor(compressorSettings.enabled);

          // チャンネル固有の設定を保存
          if (request.saveForChannel && currentChannelId) {
            const settingsKey = getChannelSettingsKey(currentChannelId);
            chrome.storage.sync.set({
              [settingsKey]: compressorSettings
            }, function () {
              if (chrome.runtime.lastError) {
                console.error('チャンネル設定の保存エラー:', chrome.runtime.lastError);
                sendResponse({ success: false, error: chrome.runtime.lastError.message });
              } else {
                console.log('チャンネル設定を保存しました:', settingsKey);
                sendResponse({ success: true });
              }
            });
            return true; // 非同期レスポンスのために必要
          }

          // デフォルト設定を保存
          if (request.saveAsDefault) {
            chrome.storage.sync.set({
              'default': compressorSettings
            }, function () {
              if (chrome.runtime.lastError) {
                console.error('デフォルト設定の保存エラー:', chrome.runtime.lastError);
                sendResponse({ success: false, error: chrome.runtime.lastError.message });
              } else {
                console.log('デフォルト設定を保存しました');
                sendResponse({ success: true });
              }
            });
            return true; // 非同期レスポンスのために必要
          }

          // 設定の更新のみの場合（保存なし）
          sendResponse({ success: true });
        } catch (error) {
          console.error('設定更新処理中のエラー:', error);
          sendResponse({ success: false, error: error.message });
        }
        return true;
      }
      else if (request.action === 'getChannelInfo') {
        try {
          // 現在のチャンネル情報を返す
          const channelInfo = getYouTubeChannelId();
          console.log('チャンネル情報を返します:', channelInfo);
          sendResponse({
            channelId: channelInfo.id,
            channelName: channelInfo.name || getChannelName(),
            detectionMethod: channelInfo.method
          });
        } catch (error) {
          console.error('チャンネル情報取得中のエラー:', error);
          sendResponse({
            error: true,
            message: error.message
          });
        }
        return true;
      }
      else if (request.action === 'forceChannelInfoRefresh') {
        // チャンネル情報を強制的に再取得
        console.log('チャンネル情報の強制更新リクエストを受信');

        try {
          // チャンネル情報を再取得
          const channelInfo = getYouTubeChannelId();
          const channelId = channelInfo.id;
          const channelName = channelInfo.name || getChannelName();

          console.log('強制更新で取得したチャンネル情報:', channelId, channelName, '方法:', channelInfo.method);

          // 最新のチャンネル情報でグローバル変数を更新
          currentChannelId = channelId;

          // background.jsにも通知
          chrome.runtime.sendMessage({
            action: 'channelChanged',
            channelId: channelId,
            channelName: channelName,
            detectionMethod: channelInfo.method
          }).catch(err => {
            console.log('バックグラウンドへの通知エラー (無視可):', err);
          });

          // レスポンスを送信
          sendResponse({
            channelId: channelId,
            channelName: channelName,
            detectionMethod: channelInfo.method
          });
        } catch (error) {
          console.error('チャンネル情報の強制更新中にエラー:', error);
          sendResponse({
            error: true,
            message: error.message
          });
        }

        // 非同期レスポンスのためにtrueを返す
        return true;
      }

      // 他のメッセージタイプのために必要
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