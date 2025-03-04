// popup-advanced.js - 上級者向け機能とラウドネス関連の機能を提供する拡張スクリプト

document.addEventListener('DOMContentLoaded', function () {
  // ラウドネスノーマライズ用の要素
  const loudnessNormEnabled = document.getElementById('loudness-norm-enabled');
  const targetLoudnessSlider = document.getElementById('target-loudness');
  const targetLoudnessValue = document.getElementById('target-loudness-value');
  const loudnessRangeSlider = document.getElementById('loudness-range-slider');
  const loudnessRangeValue = document.getElementById('loudness-range-value');
  const loudnessBar = document.getElementById('loudness-bar');
  const loudnessTarget = document.getElementById('loudness-target');
  const loudnessRange = document.getElementById('loudness-range');
  const currentLoudnessValue = document.getElementById('current-loudness-value');

  // 上級者向け機能トグルボタン
  const advancedFeaturesToggle = document.getElementById('advanced-features-toggle');
  const advancedFeaturesContainer = document.getElementById('advanced-features-container');

  // URL除外設定用要素
  const excludedUrlsCollapsible = document.getElementById('excluded-urls-collapsible');
  const excludedUrlsList = document.getElementById('excluded-urls-list');
  const excludedUrlInput = document.getElementById('excluded-url-input');
  const addExcludedUrlButton = document.getElementById('add-excluded-url');
  const addCurrentUrlButton = document.getElementById('add-current-url');

  // グローバル変数
  let loudnessUpdateInterval = null;

  // ラウドネスモニタリングの処理
  function toggleLoudnessMonitoring(enabled) {
    // 既存のインターバルがあれば停止
    if (loudnessUpdateInterval) {
      clearInterval(loudnessUpdateInterval);
      loudnessUpdateInterval = null;
    }

    // 有効な場合は監視を開始
    if (enabled && advancedFeaturesContainer.classList.contains('visible')) {
      // 初回更新
      updateLoudnessMeter();
      // 定期的に更新（200ミリ秒ごと）
      loudnessUpdateInterval = setInterval(updateLoudnessMeter, 200);
    } else {
      // 無効の場合はメーターをリセット
      loudnessBar.style.width = '0%';
      currentLoudnessValue.textContent = '無効';
    }
  }

  // コア機能からのイベント受信
  document.addEventListener('settingsLoaded', function(e) {
    const settings = e.detail;
    
    // ラウドネス設定を適用
    if ('loudnessNormEnabled' in settings) {
      loudnessNormEnabled.checked = settings.loudnessNormEnabled;
    }
    if ('targetLoudness' in settings) {
      targetLoudnessSlider.value = settings.targetLoudness;
      targetLoudnessValue.textContent = settings.targetLoudness;
      updateLoudnessMeterTarget();
    }
    if ('loudnessRange' in settings) {
      loudnessRangeSlider.value = settings.loudnessRange;
      loudnessRangeValue.textContent = settings.loudnessRange;
      updateLoudnessMeterRange();
    }

    // ラウドネスモニタリングを開始/停止
    toggleLoudnessMonitoring(settings.loudnessNormEnabled);
  });

  // 折りたたみパネルのイベントリスナー（URL除外設定用）
  if (excludedUrlsCollapsible) {
    excludedUrlsCollapsible.addEventListener('click', function () {
      this.classList.toggle('active');
      const content = this.nextElementSibling;

      if (content.style.maxHeight) {
        content.style.maxHeight = null;
      } else {
        content.style.maxHeight = content.scrollHeight + 'px';
      }
    });
  }

  // ラウドネスメーターのターゲットマーカーを更新
  function updateLoudnessMeterTarget() {
    const targetLufs = parseFloat(targetLoudnessSlider.value);
    // LUFSスケールを0〜-60の表示範囲に変換（0が右端、-60が左端）
    const position = (1 - Math.abs(targetLufs) / 60) * 100;
    loudnessTarget.style.left = `${position}%`;
  }

  // ラウドネスメーターの許容範囲を更新
  function updateLoudnessMeterRange() {
    const targetLufs = parseFloat(targetLoudnessSlider.value);
    const range = parseFloat(loudnessRangeSlider.value);

    // 範囲の開始位置と幅を計算
    const startLufs = targetLufs - range / 2;
    const endLufs = targetLufs + range / 2;

    // スケールを表示範囲に変換 (0〜-60の範囲)
    const startPosition = (1 - Math.abs(startLufs) / 60) * 100;
    const endPosition = (1 - Math.abs(endLufs) / 60) * 100;
    const width = endPosition - startPosition;

    // レンジ表示を更新
    loudnessRange.style.left = `${startPosition}%`;
    loudnessRange.style.width = `${width}%`;
  }

  // 現在のラウドネス値を取得して表示を更新
  function updateLoudnessMeter() {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs || tabs.length === 0) return;

      try {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: 'getLoudnessInfo'
        }, function (response) {
          if (chrome.runtime.lastError) {
            console.log('ラウドネス情報の取得に失敗:', chrome.runtime.lastError);
            return;
          }

          if (response && response.success) {
            const lufs = response.currentLoudness;

            // 有効な値が返された場合のみ表示を更新
            if (lufs > -70) {
              // メーターバーの更新（-60〜0 LUFSの範囲を0%〜100%に変換）
              const barWidth = Math.min(100, Math.max(0, (lufs + 60) * 100 / 60));
              loudnessBar.style.width = `${barWidth}%`;

              // 数値表示の更新
              currentLoudnessValue.textContent = `${lufs.toFixed(1)} LUFS`;

              // ターゲットとの差に応じた色の変更
              const targetLufs = parseFloat(targetLoudnessSlider.value);
              const difference = Math.abs(lufs - targetLufs);
              const range = parseFloat(loudnessRangeSlider.value) / 2;

              if (difference <= range) {
                // 許容範囲内は緑
                loudnessBar.style.backgroundColor = '#4CAF50';
              } else if (difference <= range * 2) {
                // やや範囲外は黄色
                loudnessBar.style.backgroundColor = '#FFEB3B';
              } else {
                // 大きく範囲外は赤
                loudnessBar.style.backgroundColor = '#F44336';
              }
            } else {
              // 無音や極小音の場合
              loudnessBar.style.width = '0%';
              currentLoudnessValue.textContent = '無音';
            }
          }
        });
      } catch (error) {
        console.error('ラウドネスメーター更新エラー:', error);
      }
    });
  }