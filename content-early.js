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

  // 1. isExcludedUrl 関数の修正（Twitch.tv も含めるように）
  function isExcludedUrl(url) {
    return new Promise((resolve) => {
      chrome.storage.sync.get({ 'excludedUrls': [] }, function (items) {
        const excludedUrls = items.excludedUrls || [];
        // 現在のURLがリストに含まれているかチェック
        const isExcluded = excludedUrls.some(pattern => {
          // 完全一致またはワイルドカードパターン（例：*.example.com）をサポート
          if (pattern.includes('*')) {
            const regexPattern = pattern.replace(/\*/g, '.*');
            return new RegExp(regexPattern).test(url);
          }
          return url.includes(pattern);
        });
        resolve(isExcluded);
      });
    });
  }


  // content-early.js に追加する Twitch チャンネル検出機能

  // Twitch チャンネル情報を取得する関数
  function getTwitchChannelId() {
    const url = window.location.href;
    if (!url.includes('twitch.tv')) {
      return { id: '', name: '', method: 'not_twitch' };
    }

    let channelId = '';
    let channelName = '';
    let detectionMethod = '';

    try {
      // チャンネルページ（通常のストリーマーページ）の場合
      // 例: https://www.twitch.tv/shroud
      const matches = url.match(/twitch\.tv\/([^\/\?]+)/);
      if (matches && matches[1] && !['directory', 'videos', 'clips', 'settings', 'subscriptions', 'inventory'].includes(matches[1])) {
        channelId = matches[1].toLowerCase();
        detectionMethod = 'channel_url';

        // チャンネル名をページタイトルから取得
        const titleElem = document.querySelector('title');
        if (titleElem) {
          const titleText = titleElem.textContent;
          // タイトル例: "Shroud - Twitch" または "Shroud streaming VALORANT - Twitch"
          const channelNameMatch = titleText.match(/^([^-]+)/);
          if (channelNameMatch) {
            channelName = channelNameMatch[1].trim();
          } else {
            channelName = channelId;
          }
        } else {
          channelName = channelId;
        }

        // もしくはプロフィール名から取得を試みる
        if (!channelName || channelName === channelId) {
          const profileNameElem = document.querySelector('h1[data-a-target="channel-header-info-name"]');
          if (profileNameElem) {
            channelName = profileNameElem.textContent.trim();
          }
        }

        return { id: channelId, name: channelName, method: detectionMethod };
      }

      // VOD（ビデオオンデマンド）ページの場合
      // 例: https://www.twitch.tv/videos/1234567890
      if (url.includes('/videos/')) {
        const videoOwnerElem = document.querySelector('a[data-a-target="video-info-username"]');
        if (videoOwnerElem) {
          const href = videoOwnerElem.getAttribute('href');
          if (href) {
            const ownerMatches = href.match(/\/([^\/\?]+)$/);
            if (ownerMatches && ownerMatches[1]) {
              channelId = ownerMatches[1].toLowerCase();
              channelName = videoOwnerElem.textContent.trim();
              detectionMethod = 'video_owner';
              return { id: channelId, name: channelName, method: detectionMethod };
            }
          }
        }

        // 別の方法で試行：メタデータから取得
        const metaChannelElem = document.querySelector('meta[property="og:channel"]');
        if (metaChannelElem) {
          channelId = metaChannelElem.content.toLowerCase();
          const metaChannelNameElem = document.querySelector('meta[property="og:channel:display_name"]');
          if (metaChannelNameElem) {
            channelName = metaChannelNameElem.content;
          } else {
            channelName = channelId;
          }
          detectionMethod = 'meta_data';
          return { id: channelId, name: channelName, method: detectionMethod };
        }
      }

      // クリップページの場合
      // 例: https://www.twitch.tv/shroud/clip/FunnyClipName
      if (url.includes('/clip/')) {
        // クリップ作成者の情報を取得
        const clipperElem = document.querySelector('a[data-a-target="clips-card-broadcaster-name"]');
        if (clipperElem) {
          const href = clipperElem.getAttribute('href');
          if (href) {
            const clipperMatches = href.match(/\/([^\/\?]+)$/);
            if (clipperMatches && clipperMatches[1]) {
              channelId = clipperMatches[1].toLowerCase();
              channelName = clipperElem.textContent.trim();
              detectionMethod = 'clip_creator';
              return { id: channelId, name: channelName, method: detectionMethod };
            }
          }
        }

        // クリップURLから直接取得
        const clipUrlMatches = url.match(/twitch\.tv\/([^\/\?]+)\/clip\//);
        if (clipUrlMatches && clipUrlMatches[1]) {
          channelId = clipUrlMatches[1].toLowerCase();
          detectionMethod = 'clip_url';

          // 名前をタイトルから取得
          const titleElem = document.querySelector('title');
          if (titleElem) {
            const titleMatch = titleElem.textContent.match(/^([^-]+)/);
            if (titleMatch) {
              channelName = titleMatch[1].trim();
            } else {
              channelName = channelId;
            }
          } else {
            channelName = channelId;
          }

          return { id: channelId, name: channelName, method: detectionMethod };
        }
      }
    } catch (error) {
      detectionMethod = 'error';
    }

    return { id: channelId || 'unknown', name: channelName || channelId || 'unknown', method: detectionMethod || 'unknown' };
  }

  // 既存の getYouTubeChannelId 関数を拡張して、Twitch も処理できるように統合関数を作成
  function getChannelInfo() {
    const url = window.location.href;

    // YouTube URL の場合
    if (url.includes('youtube.com')) {
      return window.getYouTubeChannelId();
    }

    // Twitch URL の場合
    if (url.includes('twitch.tv')) {
      return getTwitchChannelId();
    }

    // その他のサイトの場合
    return { id: '', name: '', method: 'unsupported_site' };
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


  // 2. メッセージハンドラーを更新
  chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    // Pingに応答
    if (request.action === 'ping') {
      sendResponse({ status: 'pong' });
      return true;
    }

    // チャンネル情報のリクエストに応答
    if (request.action === 'getChannelInfo') {
      const url = window.location.href;
      let channelInfo;

      if (url.includes('youtube.com')) {
        channelInfo = getYouTubeChannelId();
      } else if (url.includes('twitch.tv')) {
        channelInfo = getTwitchChannelId();
      } else {
        channelInfo = { id: '', name: '', method: 'unsupported_site' };
      }

      sendResponse(channelInfo);
      return true;
    }

    return true;
  });



  // チャンネル情報を定期的に更新
  let lastUrl = window.location.href;
  let lastChannelId = '';
  let navigationChangeTimeout = null;


  // 3. チャンネル情報を定期的に更新する部分を修正
  function checkForNavigationChanges() {
    const currentUrl = window.location.href;

    if (lastUrl !== currentUrl) {
      lastUrl = currentUrl;

      if (navigationChangeTimeout) {
        clearTimeout(navigationChangeTimeout);
      }

      navigationChangeTimeout = setTimeout(() => {
        let channelInfo;

        if (currentUrl.includes('youtube.com')) {
          channelInfo = getYouTubeChannelId();
        } else if (currentUrl.includes('twitch.tv')) {
          channelInfo = getTwitchChannelId();
        } else {
          channelInfo = { id: '', name: '', method: 'unsupported_site' };
        }

        const newChannelId = channelInfo.id;
        const channelName = channelInfo.name || getChannelName();

        if (newChannelId !== lastChannelId) {
          lastChannelId = newChannelId;

          chrome.runtime.sendMessage({
            action: 'channelChanged',
            channelId: newChannelId,
            channelName: channelName,
            detectionMethod: channelInfo.method,
            platform: currentUrl.includes('youtube.com') ? 'youtube' :
              (currentUrl.includes('twitch.tv') ? 'twitch' : 'unknown')
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
  let initialChannelInfo;

  const currentUrl = window.location.href;
  if (currentUrl.includes('youtube.com')) {
    initialChannelInfo = getYouTubeChannelId();
  } else if (currentUrl.includes('twitch.tv')) {
    initialChannelInfo = getTwitchChannelId();
  } else {
    initialChannelInfo = { id: '', name: '', method: 'unsupported_site' };
  }


  // バックグラウンドスクリプトにチャンネル情報を通知
  chrome.runtime.sendMessage({
    action: 'currentChannelUpdate',
    channelId: initialChannelInfo.id,
    channelName: initialChannelInfo.name || getChannelName(),
    detectionMethod: initialChannelInfo.method,
    platform: currentUrl.includes('youtube.com') ? 'youtube' :
      (currentUrl.includes('twitch.tv') ? 'twitch' : 'unknown')
  });

  // グローバルスコープにチャンネル情報取得関数を露出
  window.getYouTubeChannelId = getYouTubeChannelId;
  // グローバルスコープに関数を露出
  window.getTwitchChannelId = getTwitchChannelId;
  window.getChannelInfo = getChannelInfo;
})();
