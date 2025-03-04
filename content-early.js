// content-early.js
// 早期にロードするコンテンツスクリプト部分

(function () {
  // 拡張機能がアクティブかどうかを確認
  function checkExtensionContext() {
    try {
      chrome.runtime.sendMessage({ action: 'ping' }, function (response) {
        if (!chrome.runtime.lastError) {
          console.log('[Volume Normalizer] 拡張機能がアクティブ化されました');
        }
      });
    } catch (e) {
      return;
    }
  }

  // YouTubeのURLからチャンネルIDを取得する関数
  function getYouTubeChannelId() {
    const url = window.location.href;
    if (!url.includes('youtube.com')) {
      return { id: '', name: '', method: 'not_youtube' };
    }

    let channelId = '';
    let channelName = '';
    let detectionMethod = '';

    try {
      // チャンネルページの場合
      if (url.includes('/channel/')) {
        const matches = url.match(/\/channel\/([^\/\?]+)/);
        if (matches && matches[1]) {
          channelId = matches[1];
          detectionMethod = 'channel_url';
          const titleElem = document.querySelector('title');
          if (titleElem) {
            channelName = titleElem.textContent.replace(' - YouTube', '').trim();
          }
          return { id: channelId, name: channelName, method: detectionMethod };
        }
      }

      // ユーザーページの場合
      if (url.includes('/@')) {
        const matches = url.match(/\/@([^\/\?]+)/);
        if (matches && matches[1]) {
          channelId = '@' + matches[1];
          detectionMethod = 'username_url';
          const titleElem = document.querySelector('title');
          if (titleElem) {
            channelName = titleElem.textContent.replace(' - YouTube', '').trim();
          }
          return { id: channelId, name: channelName, method: detectionMethod };
        }
      }

      // 動画ページの場合
      if (url.includes('/watch')) {
        // メタデータから取得
        const metaElements = document.querySelectorAll('meta[itemprop="channelId"]');
        if (metaElements.length > 0) {
          channelId = metaElements[0].content;
          detectionMethod = 'meta_channelid';
          const nameElements = document.querySelectorAll('meta[itemprop="author"]');
          if (nameElements.length > 0) {
            channelName = nameElements[0].content;
          } else {
            channelName = getChannelName();
          }
          return { id: channelId, name: channelName, method: detectionMethod };
        }

        // 新しいYouTubeデザイン用のセレクタ
        const channelSelectors = [
          { selector: '#owner #channel-name a', method: 'owner_channel_name' },
          { selector: 'ytd-video-owner-renderer a', method: 'video_owner_renderer' },
          { selector: 'ytd-channel-name a', method: 'channel_name_link' }
        ];

        for (const selectorInfo of channelSelectors) {
          const channelElement = document.querySelector(selectorInfo.selector);
          if (channelElement && channelElement.href) {
            detectionMethod = selectorInfo.method;
            const channelUrl = channelElement.href;
            
            // チャンネルIDを取得
            const urlMatches = channelUrl.match(/\/channel\/([^\/\?]+)/);
            if (urlMatches && urlMatches[1]) {
              channelId = urlMatches[1];
              detectionMethod += '_channel_id';
              return { id: channelId, name: channelElement.textContent.trim(), method: detectionMethod };
            }

            // ユーザー名を取得
            const usernameMatches = channelUrl.match(/\/@([^\/\?]+)/);
            if (usernameMatches && usernameMatches[1]) {
              channelId = '@' + usernameMatches[1];
              detectionMethod += '_username';
              return { id: channelId, name: channelElement.textContent.trim(), method: detectionMethod };
            }
          }
        }

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
                return { id: channelId, name: channelName, method: detectionMethod };
              }
            }

            if (channelLink.includes('/@')) {
              const matches = channelLink.match(/\/@([^\/\?]+)/);
              if (matches && matches[1]) {
                channelId = '@' + matches[1];
                channelName = links[0].textContent.trim();
                detectionMethod = 'description_username_link';
                return { id: channelId, name: channelName, method: detectionMethod };
              }
            }
          }
        }

        // スクリプトからJSONデータを取得
        const scriptElements = document.querySelectorAll('script');
        for (const script of scriptElements) {
          const text = script.textContent;
          if (text && text.includes('"channelId":"')) {
            const matches = text.match(/"channelId":"([^"]+)"/);
            if (matches && matches[1]) {
              channelId = matches[1];
              detectionMethod = 'script_json_data';

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
      detectionMethod = 'error';
    }

    return { id: channelName || channelId || 'unknown', name: channelName, method: detectionMethod || 'unknown' };
  }

  // チャンネル名を取得
  function getChannelName() {
    if (!window.location.href.includes('youtube.com')) {
      return '';
    }

    const channelElement = document.querySelector('[itemprop="author"] [itemprop="name"], #owner #channel-name');
    if (channelElement) {
      return channelElement.textContent.trim();
    }

    return '';
  }

  // メッセージハンドラーを登録（基本的なコミュニケーション用）
  chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    // Pingに応答
    if (request.action === 'ping') {
      sendResponse({ status: 'pong' });
      return true;
    }

    // チャンネル情報のリクエストに応答
    if (request.action === 'getChannelInfo') {
      const channelInfo = getYouTubeChannelId();
      sendResponse(channelInfo);
      return true;
    }
    
    return true;
  });

  // チャンネル情報を定期的に更新
  let lastUrl = window.location.href;
  let lastChannelId = '';
  let navigationChangeTimeout = null;

  function checkForNavigationChanges() {
    const currentUrl = window.location.href;

    if (lastUrl !== currentUrl) {
      lastUrl = currentUrl;

      if (navigationChangeTimeout) {
        clearTimeout(navigationChangeTimeout);
      }

      navigationChangeTimeout = setTimeout(() => {
        const channelInfo = getYouTubeChannelId();
        const newChannelId = channelInfo.id;
        const channelName = channelInfo.name || getChannelName();

        if (newChannelId !== lastChannelId) {
          lastChannelId = newChannelId;

          chrome.runtime.sendMessage({
            action: 'channelChanged',
            channelId: newChannelId,
            channelName: channelName,
            detectionMethod: channelInfo.method
          });
        }
      }, 1000);
    }
  }

  // URLの変更を監視
  setInterval(checkForNavigationChanges, 1000);

  // DOMの変更も監視して新しいチャンネル情報を検出
  new MutationObserver(() => {
    checkForNavigationChanges();
  }).observe(document, { subtree: true, childList: true });

  // 初期化
  checkExtensionContext();
  const initialChannelInfo = getYouTubeChannelId();
  
  // バックグラウンドスクリプトにチャンネル情報を通知
  chrome.runtime.sendMessage({
    action: 'currentChannelUpdate',
    channelId: initialChannelInfo.id,
    channelName: initialChannelInfo.name || getChannelName(),
    detectionMethod: initialChannelInfo.method
  });

  // グローバルスコープにチャンネル情報取得関数を露出
  window.getYouTubeChannelId = getYouTubeChannelId;
})();
