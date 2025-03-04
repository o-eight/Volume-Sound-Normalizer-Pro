// content-main.js
// メインのオーディオ処理機能を含むコンテンツスクリプト

(function () {
  // 初期化処理のメイン関数
  function initializeExtension() {
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
    let loudnessWorkletNode;
    let workletInitialized = false;
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
      loudnessNormEnabled: false,
      targetLoudness: -24,
      loudnessRange: 7
    };
    let compressorSettings = { ...defaultSettings };

    // ラウドネス測定関連変数
    let currentLoudness = -70;
    let loudnessHistory = [];
    const HISTORY_SIZE = 10;
    let lastGainAdjustment = 0;

    // メーターの重み付け係数
    let kWeights = {
      lowShelf: { frequency: 60, gain: -10 },
      highPass: { frequency: 100 },
      highShelf: { frequency: 8000, gain: 4 }
    };

    // AudioWorkletの初期化関数
    async function initAudioWorklet() {
      if (!audioContext) {
        try {
          audioContext = new (window.AudioContext || window.webkitAudioContext)();
          if (audioContext.state === 'suspended') {
            try {
              await audioContext.resume();
            } catch (resumeErr) {
              // 再開失敗してもプロセスは続行
            }
          }
        } catch (ctxErr) {
          return false;
        }
      }

      if (!workletInitialized) {
        try {
          const workletUrl = chrome.runtime.getURL('loudness-processor.js');
          await audioContext.audioWorklet.addModule(workletUrl);
          workletInitialized = true;
        } catch (error) {
          workletInitialized = false;
          return false;
        }
      }

      return workletInitialized;
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

    // チャンネル固有の設定キーを作成
    function getChannelSettingsKey(channelId) {
      return channelId ? `channel_${channelId}` : 'default';
    }

    // 現在のチャンネルの設定を読み込む
    function loadChannelSettings() {
      // 既存のgetYouTubeChannelId関数を使用（content-early.jsで定義）
      const channelInfo = window.getYouTubeChannelId ? 
            window.getYouTubeChannelId() : 
            { id: '', name: '', method: 'not_detected' };
            
      currentChannelId = channelInfo.id;
      const settingsKey = getChannelSettingsKey(currentChannelId);

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
          detectionMethod: channelInfo.method
        });
      });
    }

    // メッセージリスナー（拡張メッセージハンドリング）
    chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
      if (request.action === 'ping') {
        sendResponse({ status: 'pong' });
        return true;
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
            
            if ('loudnessNormEnabled' in compressorSettings) {
              toggleLoudnessNormalization(compressorSettings.loudnessNormEnabled);
            }

            if ('targetLoudness' in compressorSettings && 'loudnessRange' in compressorSettings) {
              updateLoudnessSettings(compressorSettings.targetLoudness, compressorSettings.loudnessRange);
            }
          }, 20);

          sendResponse({ success: true });
        } catch (error) {
          sendResponse({ success: false, error: error.message });
        }
        return true;
      }
      
      else if (request.action === 'getLoudnessInfo') {
        try {
          sendResponse({
            success: true,
            currentLoudness: currentLoudness,
            targetLoudness: compressorSettings.targetLoudness,
            isEnabled: compressorSettings.loudnessNormEnabled && workletInitialized
          });
        } catch (error) {
          sendResponse({
            success: false,
            error: error.message,
            workletInitialized: workletInitialized
          });
        }
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

        if (compressorSettings.loudnessNormEnabled && !workletInitialized) {
          try {
            const initialized = await initAudioWorklet();
            if (!initialized) {
              compressorSettings.loudnessNormEnabled = false;
            }
          } catch (err) {
            compressorSettings.loudnessNormEnabled = false;
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

            if (nodes.loudnessWorklet) {
              try {
                nodes.loudnessWorklet.disconnect();
                if (nodes.loudnessWorklet.port) {
                  nodes.loudnessWorklet.port.onmessage = null;
                }
              } catch (e) { }
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

          let loudnessWorkletNode = null;
          if (compressorSettings.loudnessNormEnabled && workletInitialized) {
            try {
              loudnessWorkletNode = new AudioWorkletNode(audioContext, 'loudness-processor');

              loudnessWorkletNode.port.onmessage = (event) => {
                if (event.data.type === 'measurement') {
                  const measuredLoudness = event.data.loudness;
                  currentLoudness = measuredLoudness;

                  const loudnessDifference = compressorSettings.targetLoudness - measuredLoudness;
                  const withinRange = Math.abs(loudnessDifference) <= compressorSettings.loudnessRange / 2;

                  if (!withinRange) {
                    const MAX_ADJUSTMENT = 0.5;
                    const adjustmentFactor = compressorSettings.targetLoudness < -24 ? 0.05 : 0.1;
                    let gainAdjustment = Math.max(-MAX_ADJUSTMENT, Math.min(MAX_ADJUSTMENT, loudnessDifference * adjustmentFactor));

                    gainAdjustment = (gainAdjustment + lastGainAdjustment) / 2;
                    lastGainAdjustment = gainAdjustment;

                    const currentGainDb = compressorSettings.makeupGain;
                    const newGainDb = currentGainDb + gainAdjustment;
                    const limitedGainDb = Math.max(-12, Math.min(24, newGainDb));

                    if (newGainDb !== currentGainDb) {
                      try {
                        const linearGain = Math.pow(10, limitedGainDb / 20);
                        const now = audioContext.currentTime;
                        gainNode.gain.linearRampToValueAtTime(linearGain, now + 0.1);
                        compressorSettings.makeupGain = limitedGainDb;
                      } catch (gainError) { }
                    }
                  }
                }
              };

              loudnessWorkletNode.port.postMessage({
                type: 'config',
                targetLoudness: compressorSettings.targetLoudness,
                loudnessRange: compressorSettings.loudnessRange
              });
            } catch (workletError) {
              loudnessWorkletNode = null;
              compressorSettings.loudnessNormEnabled = false;
            }
          }

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

            if (compressorSettings.loudnessNormEnabled && loudnessWorkletNode) {
              gainNode.connect(audioContext.destination);
              gainNode.connect(analyserNode);
              analyserNode.connect(loudnessWorkletNode);
            } else {
              gainNode.connect(audioContext.destination);
            }

            connectedVideos.set(videoElement, {
              source: sourceNode,
              compressor: compressorNode,
              gain: gainNode,
              analyser: analyserNode,
              loudnessWorklet: loudnessWorkletNode
            });
          } catch (connectionError) {
            try {
              if (sourceNode) sourceNode.disconnect();
              if (compressorNode) compressorNode.disconnect();
              if (gainNode) gainNode.disconnect();
              if (analyserNode) analyserNode.disconnect();
              if (loudnessWorkletNode) loudnessWorkletNode.disconnect();
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

    // オーディオ処理関数 (ラウドネス計算と調整)
    function processAudio(event) {
      if (!compressorSettings.loudnessNormEnabled) return;

      try {
        const inputBuffer = event.inputBuffer;
        const inputData = inputBuffer.getChannelData(0);

        let sum = 0;
        for (let i = 0; i < inputData.length; i++) {
          sum += inputData[i] * inputData[i];
        }
        const rms = Math.sqrt(sum / inputData.length);
        const dbFS = 20 * Math.log10(rms);
        const lufs = dbFS - 10;

        if (lufs > -70) {
          loudnessHistory.push(lufs);
          if (loudnessHistory.length > HISTORY_SIZE) {
            loudnessHistory.shift();
          }

          const avgLoudness = loudnessHistory.reduce((a, b) => a + b, 0) / loudnessHistory.length;
          currentLoudness = avgLoudness;

          const loudnessDifference = compressorSettings.targetLoudness - avgLoudness;
          const withinRange = Math.abs(loudnessDifference) <= compressorSettings.loudnessRange / 2;

          if (!withinRange) {
            const MAX_ADJUSTMENT = 0.5;
            let gainAdjustment = Math.max(-MAX_ADJUSTMENT, Math.min(MAX_ADJUSTMENT, loudnessDifference * 0.1));

            gainAdjustment = (gainAdjustment + lastGainAdjustment) / 2;
            lastGainAdjustment = gainAdjustment;

            const currentGainDb = compressorSettings.makeupGain;
            const newGainDb = currentGainDb + gainAdjustment;
            const limitedGainDb = Math.max(-12, Math.min(12, newGainDb));

            if (newGainDb !== currentGainDb) {
              videoElements.forEach(video => {
                if (connectedVideos.has(video)) {
                  const nodes = connectedVideos.get(video);
                  const linearGain = Math.pow(10, limitedGainDb / 20);
                  const now = audioContext.currentTime;
                  nodes.gain.gain.linearRampToValueAtTime(linearGain, now + 0.1);
                }
              });

              compressorSettings.makeupGain = limitedGainDb;
            }
          }
        }
      } catch (e) { }
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

          if (nodes.loudnessWorklet) {
            nodes.loudnessWorklet.disconnect();
          }

          if (enabled) {
            nodes.source.connect(nodes.compressor);
            nodes.compressor.connect(nodes.gain);

            if (compressorSettings.loudnessNormEnabled && workletInitialized && nodes.loudnessWorklet) {
              nodes.gain.connect(nodes.analyser);
              nodes.analyser.connect(nodes.loudnessWorklet);
              nodes.gain.connect(audioContext.destination);
            } else {
              nodes.gain.connect(audioContext.destination);
            }
          } else {
            nodes.source.connect(nodes.gain);

            if (compressorSettings.loudnessNormEnabled && workletInitialized && nodes.loudnessWorklet) {
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

    // ラウドネスノーマライズ切り替え関数
    async function toggleLoudnessNormalization(enabled) {
      const previousState = compressorSettings.loudnessNormEnabled;
      compressorSettings.loudnessNormEnabled = enabled;

      if (enabled) {
        if (audioContext && audioContext.state === 'suspended') {
          try {
            await audioContext.resume();
          } catch (error) { }
        }

        if (!workletInitialized) {
          try {
            const initialized = await initAudioWorklet();
            if (!initialized) {
              compressorSettings.loudnessNormEnabled = false;
              return false;
            }
          } catch (error) {
            compressorSettings.loudnessNormEnabled = false;
            return false;
          }
        }
      }

      if (previousState !== compressorSettings.loudnessNormEnabled) {
        loudnessHistory = [];
        currentLoudness = -70;
        lastGainAdjustment = 0;

        let updateSuccess = true;
        for (const video of videoElements) {
          if (connectedVideos.has(video) && !video.paused) {
            try {
              await applyCompressorToVideo(video);
            } catch (error) {
              updateSuccess = false;
            }
          }
        }

        return updateSuccess;
      }

      return true;
    }

    // ラウドネス設定更新関数
    function updateLoudnessSettings(targetLoudness, loudnessRange) {
      compressorSettings.targetLoudness = targetLoudness;
      compressorSettings.loudnessRange = loudnessRange;

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

      loudnessHistory = [];
      currentLoudness = -70;
      lastGainAdjustment = 0;
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

    