// content-main.js
// メインのオーディオ処理機能を含むコンテンツスクリプト

(function () {
  // 初期化処理のメイン関数
  async function initializeExtension() {
    // リアルタイム更新のスロットリング用
    let updateThrottleTimeout = null;

    // AudioContext の再開ハンドラーをセットアップ
    setupAudioContextResume();

    // Web Audio APIのノード参照
    let audioContext;
    let compressorNode;
    let sourceNode;
    let gainNode;
    let analyserNode;
    let videoElements = [];
    let connectedVideos = new WeakMap();
    let currentChannelId = '';
    let currentPlatform = ''; // 'youtube' または 'twitch'
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

    // URLが除外リストに含まれているかチェックする関数（既存関数を活用）
    async function isExcludedUrl(url) {
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


    async function checkIfUrlIsExcluded() {
      const currentUrl = window.location.href;
      const isExcluded = await isExcludedUrl(currentUrl);

      if (isExcluded) {
        console.log('[Volume Normalizer] 現在のURLは除外リストに含まれています。機能を無効化します。');
        // 既存のオーディオノードを切断
        videoElements.forEach(video => {
          if (connectedVideos.has(video)) {
            try {
              const nodes = connectedVideos.get(video);
              if (nodes.source) nodes.source.disconnect();
              if (nodes.compressor) nodes.compressor.disconnect();
              if (nodes.gain) nodes.gain.disconnect();
              if (nodes.analyser) nodes.analyser.disconnect();

              // オリジナルのソースを直接出力先に接続
              nodes.source.connect(audioContext.destination);
            } catch (e) {
              console.error('[Volume Normalizer] 切断エラー:', e);
            }
          }
        });

        // 新しい接続を防止するためのフラグ
        compressorSettings.enabled = false;
        return true;
      }

      return false;
    }

    // AudioContext再開のヘルパー関数
    async function resumeAudioContext() {
      if (audioContext && audioContext.state === 'suspended') {
        try {
          await audioContext.resume();
          return true;
        } catch (error) {
          return false;
        }
      }
      return audioContext ? audioContext.state === 'running' : false;
    }

    // ユーザーインタラクションでAudioContextを再開するハンドラー
    function setupAudioContextResume() {
      const resumeEvents = ['click', 'touchstart', 'keydown'];

      const resumeAudioContextHandler = async () => {
        const resumed = await resumeAudioContext();
        if (resumed) {
          resumeEvents.forEach(eventType => {
            document.removeEventListener(eventType, resumeAudioContextHandler);
          });
        }
      };

      resumeEvents.forEach(eventType => {
        document.addEventListener(eventType, resumeAudioContextHandler, { once: false, passive: true });
      });
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

    // チャンネル固有の設定キーを作成する関数を修正
    function getChannelSettingsKey(channelId, platform) {
      return channelId ? `channel_${platform}_${channelId}` : 'default';
    }


    // 現在のチャンネルの設定を読み込む関数を修正
    function loadChannelSettings() {
      const url = window.location.href;
      let channelInfo;

      if (url.includes('youtube.com')) {
        // YouTubeチャンネル情報を取得
        channelInfo = window.getYouTubeChannelId ?
          window.getYouTubeChannelId() :
          { id: '', name: '', method: 'not_detected' };
        currentPlatform = 'youtube';
      } else if (url.includes('twitch.tv')) {
        // Twitchチャンネル情報を取得
        channelInfo = window.getTwitchChannelId ?
          window.getTwitchChannelId() :
          { id: '', name: '', method: 'not_detected' };
        currentPlatform = 'twitch';
      } else {
        // その他のサイト
        channelInfo = { id: '', name: '', method: 'unsupported_site' };
        currentPlatform = '';
      }

      currentChannelId = channelInfo.id;
      const settingsKey = getChannelSettingsKey(currentChannelId, currentPlatform);

      chrome.storage.sync.get({
        'default': defaultSettings,
        [settingsKey]: null
      }, function (items) {
        const defaultConfig = items.default || defaultSettings;

        if (items[settingsKey]) {
          compressorSettings = items[settingsKey];
        } else {
          compressorSettings = defaultConfig;
        }

        updateCompressorSettings();
        toggleCompressor(compressorSettings.enabled);
        findAndProcessVideos();

        chrome.runtime.sendMessage({
          action: 'currentChannelUpdate',
          channelId: channelInfo.id,
          channelName: channelInfo.name || '',
          detectionMethod: channelInfo.method,
          platform: currentPlatform
        });
      });
    }

    // メッセージリスナー（拡張メッセージハンドリング）
    chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
      if (request.action === 'ping') {
        sendResponse({ status: 'pong' });
        return true;
      }

      if (request.action === 'isUrlExcluded') {
        const currentUrl = window.location.href;
        isExcludedUrl(currentUrl.replace(/^https?:\/\//, '')).then(excluded => {
          sendResponse({ excluded: excluded });
        });
        return true; // 非同期レスポンスのために必要
      }

      if (request.action === 'updateCompressorSettings') {
        try {
          compressorSettings = request.settings;

          if (updateThrottleTimeout) {
            clearTimeout(updateThrottleTimeout);
          }

          updateThrottleTimeout = setTimeout(() => {
            updateCompressorSettings();
            toggleCompressor(compressorSettings.enabled);
          }, 20);

          sendResponse({ success: true });
        } catch (error) {
          sendResponse({ success: false, error: error.message });
        }
        return true;
      }

      return true;
    });


    // ページ内の動画要素を探す関数の強化
    function findAndProcessVideos() {
      const videos = document.querySelectorAll('video');

      // Twitchの場合、特定のクラスや要素を持つ動画に対象を絞る
      if (window.location.href.includes('twitch.tv')) {
        // Twitchでは特定のプレーヤーが使われることが多い
        const twitchPlayers = document.querySelectorAll('.video-player__container video, .player-video video');
        if (twitchPlayers.length > 0) {
          twitchPlayers.forEach(video => {
            if (!connectedVideos.has(video)) {
              videoElements.push(video);
              video.addEventListener('play', function () {
                if (!connectedVideos.has(video)) {
                  applyCompressorToVideo(video);
                }
              });

              if (!video.paused) {
                applyCompressorToVideo(video);
              }
            }
          });
          return;
        }
      }

      // 通常の動画検出（すべてのサイト向け）
      videos.forEach(video => {
        if (!connectedVideos.has(video)) {
          videoElements.push(video);
          video.addEventListener('play', function () {
            if (!connectedVideos.has(video)) {
              applyCompressorToVideo(video);
            }
          });

          if (!video.paused) {
            applyCompressorToVideo(video);
          }
        }
      });
    }
    
    // 動画にコンプレッサーを適用する関数
    async function applyCompressorToVideo(videoElement) {
      try {
        if (!audioContext) {
          try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();

            if (audioContext.state === 'suspended') {
              await audioContext.resume();
            }
          } catch (err) {
            return;
          }
        }

        try {
          if (connectedVideos.has(videoElement)) {
            const nodes = connectedVideos.get(videoElement);

            if (nodes.source) {
              try { nodes.source.disconnect(); } catch (e) { }
            }

            if (nodes.analyser) {
              try { nodes.analyser.disconnect(); } catch (e) { }
            }

            if (nodes.gain) {
              try { nodes.gain.disconnect(); } catch (e) { }
            }

            if (nodes.compressor) {
              try { nodes.compressor.disconnect(); } catch (e) { }
            }

            connectedVideos.delete(videoElement);
          }
        } catch (disconnectError) {
          // 切断エラーは致命的ではないため続行
        }

        try {
          if (videoElement._hasBeenConnected) {
            return;
          }

          sourceNode = audioContext.createMediaElementSource(videoElement);
          videoElement._hasBeenConnected = true;
        } catch (sourceError) {
          return;
        }

        try {
          compressorNode = audioContext.createDynamicsCompressor();
          gainNode = audioContext.createGain();
          analyserNode = audioContext.createAnalyser();
          analyserNode.fftSize = 2048;

          compressorNode.threshold.value = compressorSettings.threshold;
          compressorNode.ratio.value = compressorSettings.ratio;
          compressorNode.attack.value = compressorSettings.attack / 1000;
          compressorNode.release.value = compressorSettings.release / 1000;
          compressorNode.knee.value = compressorSettings.knee;

          gainNode.gain.value = Math.pow(10, compressorSettings.makeupGain / 20);

          try {
            if (compressorSettings.enabled) {
              sourceNode.connect(compressorNode);
              compressorNode.connect(gainNode);
            } else {
              sourceNode.connect(gainNode);
            }

            gainNode.connect(audioContext.destination);
            gainNode.connect(analyserNode);

            connectedVideos.set(videoElement, {
              source: sourceNode,
              compressor: compressorNode,
              gain: gainNode,
              analyser: analyserNode
            });
          } catch (connectionError) {
            try {
              if (sourceNode) sourceNode.disconnect();
              if (compressorNode) compressorNode.disconnect();
              if (gainNode) gainNode.disconnect();
              if (analyserNode) analyserNode.disconnect();
            } catch (e) { }
          }
        } catch (nodeCreationError) {
          if (sourceNode) {
            try { sourceNode.disconnect(); } catch (e) { }
          }
        }
      } catch (mainError) {
        // メインエラー - 内部処理済み
      }
    }

    // コンプレッサー設定更新関数
    function updateCompressorSettings() {
      if (videoElements.length === 0 || connectedVideos.size === 0) {
        return;
      }

      videoElements.forEach(video => {
        if (connectedVideos.has(video) && !video.paused) {
          const nodes = connectedVideos.get(video);
          const now = audioContext.currentTime;
          const transitionTime = 0.05;

          nodes.compressor.threshold.linearRampToValueAtTime(compressorSettings.threshold, now + transitionTime);
          nodes.compressor.ratio.linearRampToValueAtTime(compressorSettings.ratio, now + transitionTime);
          nodes.compressor.attack.linearRampToValueAtTime(compressorSettings.attack / 1000, now + transitionTime);
          nodes.compressor.release.linearRampToValueAtTime(compressorSettings.release / 1000, now + transitionTime);
          nodes.compressor.knee.linearRampToValueAtTime(compressorSettings.knee, now + transitionTime);

          const newGain = Math.pow(10, compressorSettings.makeupGain / 20);
          nodes.gain.gain.linearRampToValueAtTime(newGain, now + transitionTime);
        }
      });
    }

    // トグルコンプレッサー関数
    function toggleCompressor(enabled) {
      videoElements.forEach(video => {
        if (connectedVideos.has(video)) {
          const nodes = connectedVideos.get(video);

          nodes.source.disconnect();
          nodes.compressor.disconnect();
          nodes.gain.disconnect();

          if (nodes.analyser) {
            nodes.analyser.disconnect();
          }

          if (enabled) {
            nodes.source.connect(nodes.compressor);
            nodes.compressor.connect(nodes.gain);
            nodes.gain.connect(audioContext.destination);
            nodes.gain.connect(nodes.analyser);
          } else {
            nodes.source.connect(nodes.gain);
            nodes.gain.connect(audioContext.destination);
            nodes.gain.connect(nodes.analyser);
          }
        }
      });
    }

    // DOMの変更を監視して新しいビデオ要素を検出
    new MutationObserver(() => {
      findAndProcessVideos();
    }).observe(document, { subtree: true, childList: true });

    // 初期設定の読み込み
    loadChannelSettings();

    // 定期的なビデオ要素のチェック
    setInterval(findAndProcessVideos, 2000);

    // ページ読み込み完了時に初期化
    window.addEventListener('load', () => {
      findAndProcessVideos();
    });

    console.log('[Volume Normalizer] メイン機能が初期化されました');
  }

  // 初期化を実行
  // content-early.jsが正しく読み込まれてから少し遅延させて実行
  setTimeout(() => {
    try {
      initializeExtension();
    } catch (e) {
      console.error('[Volume Normalizer] 初期化エラー:', e);
    }
  }, 500);
})();