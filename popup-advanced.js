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

  // URLリストを表示する関数
  function displayExcludedUrls() {
    const excludedUrlsList = document.getElementById('excluded-urls-list');
    if (!excludedUrlsList) return;
    
    excludedUrlsList.innerHTML = '';

    chrome.storage.sync.get({ 'excludedUrls': [] }, function (items) {
      const excludedUrls = items.excludedUrls || [];

      if (excludedUrls.length === 0) {
        excludedUrlsList.innerHTML = '<p style="color: #666; font-style: italic;">除外URLはありません</p>';
        return;
      }

      excludedUrls.forEach((url, index) => {
        const urlItem = document.createElement('div');
        urlItem.style.display = 'flex';
        urlItem.style.justifyContent = 'space-between';
        urlItem.style.alignItems = 'center';
        urlItem.style.padding = '3px 0';
        urlItem.style.borderBottom = index < excludedUrls.length - 1 ? '1px solid #eee' : 'none';

        const urlText = document.createElement('span');
        urlText.textContent = url;
        urlText.style.overflow = 'hidden';
        urlText.style.textOverflow = 'ellipsis';
        urlText.style.whiteSpace = 'nowrap';

        const removeButton = document.createElement('button');
        removeButton.textContent = '削除';
        removeButton.style.backgroundColor = '#f44336';
        removeButton.style.color = 'white';
        removeButton.style.border = 'none';
        removeButton.style.padding = '2px 5px';
        removeButton.style.marginLeft = '5px';
        removeButton.style.cursor = 'pointer';
        removeButton.style.fontSize = '11px';

        removeButton.addEventListener('click', function () {
          removeExcludedUrl(url);
        });

        urlItem.appendChild(urlText);
        urlItem.appendChild(removeButton);
        excludedUrlsList.appendChild(urlItem);
      });
    });
  }

  // 現在のURL取得関数
  function getCurrentTabUrl(callback) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs && tabs.length > 0) {
        const url = tabs[0].url;
        // URLからhttpやhttpsを除去して、シンプルな形式に変換
        const cleanUrl = url.replace(/^https?:\/\//, '');
        callback(cleanUrl);
      } else {
        callback('');
      }
    });
  }

  // URLを追加する関数
  function addExcludedUrl(url) {
    if (!url) return;

    // URLの形式をシンプルに修正（http://, https:// を削除）
    let cleanUrl = url.trim();
    cleanUrl = cleanUrl.replace(/^https?:\/\//, '');

    chrome.storage.sync.get({ 'excludedUrls': [] }, function (items) {
      let excludedUrls = items.excludedUrls || [];

      // 既に存在する場合は追加しない
      if (excludedUrls.includes(cleanUrl)) {
        showNotification('このURLは既に除外リストに存在します', true, false, 2000);
        return;
      }

      // URLを追加
      excludedUrls.push(cleanUrl);

      // ストレージに保存
      chrome.storage.sync.set({ 'excludedUrls': excludedUrls }, function () {
        displayExcludedUrls();
        showNotification('URLを除外リストに追加しました', false, false, 2000);

        // 入力フィールドをクリア
        if (excludedUrlInput) {
          excludedUrlInput.value = '';
        }
      });
    });
  }

  // URLを削除する関数
  function removeExcludedUrl(url) {
    chrome.storage.sync.get({ 'excludedUrls': [] }, function (items) {
      let excludedUrls = items.excludedUrls || [];

      // URLを削除
      excludedUrls = excludedUrls.filter(item => item !== url);

      // ストレージに保存
      chrome.storage.sync.set({ 'excludedUrls': excludedUrls }, function () {
        displayExcludedUrls();
        showNotification('URLを除外リストから削除しました', false, false, 2000);
      });
    });
  }

  // 通知関数
  function showNotification(message, isError = false, isLoading = false, duration = 2000) {
    // window.audioNormalizerが定義されていれば、そちらの関数を使用
    if (window.audioNormalizer && window.audioNormalizer.showNotification) {
      window.audioNormalizer.showNotification(message, isError, isLoading, duration);
      return;
    }
    
    // 定義されていない場合は独自に実装
    const existingStatus = document.getElementById('status-notification');
    if (existingStatus) {
      if (existingStatus.parentNode) {
        existingStatus.parentNode.removeChild(existingStatus);
      }
    }

    const status = document.createElement('div');
    status.id = 'status-notification';
    status.textContent = message;
    status.style.color = isError ? 'red' : (isLoading ? 'blue' : 'green');
    status.style.marginTop = '10px';
    status.style.padding = '8px';
    status.style.borderRadius = '4px';
    status.style.textAlign = 'center';
    status.style.backgroundColor = isError ? '#ffeeee' : (isLoading ? '#e6f7ff' : '#eeffee');
    status.style.border = `1px solid ${isError ? '#ffcccc' : (isLoading ? '#b3e0ff' : '#ccffcc')}`;

    if (isLoading) {
      const loadingText = document.createTextNode(' ');
      const loadingSpinner = document.createElement('span');
      loadingSpinner.textContent = '⟳';
      loadingSpinner.style.display = 'inline-block';
      loadingSpinner.style.animation = 'spin 2s linear infinite';
      status.innerHTML = '';
      status.appendChild(loadingSpinner);
      status.appendChild(loadingText);
      status.appendChild(document.createTextNode(message));
    }

    document.body.appendChild(status);

    if (!isError && !isLoading) {
      setTimeout(function () {
        const notification = document.getElementById('status-notification');
        if (notification && notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, duration);
    }
  }

  // 上級者向け機能を表示
  function showAdvancedFeatures() {
    advancedFeaturesContainer.style.display = 'block';
    setTimeout(() => {
      advancedFeaturesContainer.classList.add('visible');
    }, 10);
    advancedFeaturesToggle.classList.add('active');
    advancedFeaturesToggle.textContent = '上級者向け機能を隠す';

    // ラウドネスメーターとスライダーの状態を更新
    updateLoudnessMeterTarget();
    updateLoudnessMeterRange();

    // ラウドネスメーターの更新を開始（表示されている場合のみ）
    if (loudnessNormEnabled && loudnessNormEnabled.checked) {
      toggleLoudnessMonitoring(true);
    }
  }

  // 上級者向け機能を非表示
  function hideAdvancedFeatures() {
    advancedFeaturesContainer.classList.remove('visible');
    setTimeout(() => {
      advancedFeaturesContainer.style.display = 'none';
    }, 300); // トランジション時間に合わせる
    advancedFeaturesToggle.classList.remove('active');
    advancedFeaturesToggle.textContent = '上級者向け機能を表示';

    // ラウドネスモニタリングを停止（非表示時は不要）
    if (loudnessNormEnabled && loudnessNormEnabled.checked) {
      toggleLoudnessMonitoring(false);
    }
  }

  // イベントリスナーの設定
  
  // ローカルストレージから上級者モードの状態を取得
  chrome.storage.local.get({
    'advanced_mode_enabled': false
  }, function (items) {
    if (items.advanced_mode_enabled) {
      showAdvancedFeatures();
    }
  });

  // トグルボタンのイベントリスナー
  if (advancedFeaturesToggle) {
    advancedFeaturesToggle.addEventListener('click', function () {
      if (advancedFeaturesContainer.classList.contains('visible')) {
        hideAdvancedFeatures();

        // 設定を保存
        chrome.storage.local.set({
          'advanced_mode_enabled': false
        });
      } else {
        showAdvancedFeatures();

        // 設定を保存
        chrome.storage.local.set({
          'advanced_mode_enabled': true
        });
      }
    });
  }

  // ラウドネス設定のイベントリスナー
  if (targetLoudnessSlider) {
    targetLoudnessSlider.addEventListener('input', function () {
      targetLoudnessValue.textContent = this.value;
      updateLoudnessMeterTarget();
      updateLoudnessMeterRange();
      if (window.audioNormalizer && window.audioNormalizer.updateSettingsRealtime) {
        window.audioNormalizer.updateSettingsRealtime();
      }
    });
  }

  if (loudnessRangeSlider) {
    loudnessRangeSlider.addEventListener('input', function () {
      loudnessRangeValue.textContent = this.value;
      updateLoudnessMeterRange();
      if (window.audioNormalizer && window.audioNormalizer.updateSettingsRealtime) {
        window.audioNormalizer.updateSettingsRealtime();
      }
    });
  }

  // ラウドネスノーマライズの有効/無効切り替え
  if (loudnessNormEnabled) {
    loudnessNormEnabled.addEventListener('change', function () {
      toggleLoudnessMonitoring(this.checked);
      if (window.audioNormalizer && window.audioNormalizer.updateSettingsRealtime) {
        window.audioNormalizer.updateSettingsRealtime();
      }

      // 有効化されたがUIが表示されていない場合、ユーザーに通知
      if (this.checked && !advancedFeaturesContainer.classList.contains('visible')) {
        showNotification('ラウドネスノーマライズが有効化されました。上級者向け機能が非表示のため、メーターは表示されません。', false, false, 3000);
      }
    });
  }

  // URL除外設定のイベントリスナー
  if (addExcludedUrlButton) {
    addExcludedUrlButton.addEventListener('click', function () {
      if (excludedUrlInput) {
        const url = excludedUrlInput.value;
        addExcludedUrl(url);
      }
    });
  }

  if (excludedUrlInput) {
    excludedUrlInput.addEventListener('keypress', function (e) {
      if (e.key === 'Enter') {
        const url = this.value;
        addExcludedUrl(url);
      }
    });
  }

  if (addCurrentUrlButton) {
    addCurrentUrlButton.addEventListener('click', function () {
      getCurrentTabUrl(function (currentUrl) {
        if (currentUrl) {
          if (excludedUrlInput) {
            excludedUrlInput.value = currentUrl;
          }
          addExcludedUrl(currentUrl);
        } else {
          showNotification('現在のURLを取得できませんでした', true, false, 2000);
        }
      });
    });
  }

  // ウィンドウのunloadイベント
  window.addEventListener('unload', function () {
    // ラウドネスモニタリングを停止
    if (loudnessUpdateInterval) {
      clearInterval(loudnessUpdateInterval);
    }
  });

  // 初期表示
  if (excludedUrlsList) {
    displayExcludedUrls();
  }

  console.log('ポップアップ拡張機能を初期化しました');
});
