// popup-advanced.js - 上級者向け機能を提供する拡張スクリプト

document.addEventListener('DOMContentLoaded', function () {
  // 上級者向け機能トグルボタン
  const advancedFeaturesToggle = document.getElementById('advanced-features-toggle');
  const advancedFeaturesContainer = document.getElementById('advanced-features-container');

  // URL除外設定用要素
  const excludedUrlsCollapsible = document.getElementById('excluded-urls-collapsible');
  const excludedUrlsList = document.getElementById('excluded-urls-list');
  const addCurrentUrlButton = document.getElementById('add-current-url');

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

        // URL表示スペースを拡大
        const urlText = document.createElement('span');
        urlText.textContent = url;
        urlText.title = url; // ツールチップの追加
        urlText.style.overflow = 'hidden';
        urlText.style.textOverflow = 'ellipsis';
        urlText.style.whiteSpace = 'nowrap';
        urlText.style.flex = '1';  // フレックスで領域を最大化
        urlText.style.maxWidth = 'calc(100% - 55px)';  // 削除ボタンのスペースを確保
        urlText.style.cursor = 'default'; // ツールチップを表示するためのカーソル

        // 削除ボタンのサイズを縮小
        const removeButton = document.createElement('button');
        removeButton.textContent = '削除';
        removeButton.title = `${url} を除外リストから削除`; // ツールチップの追加
        removeButton.style.backgroundColor = '#f44336';
        removeButton.style.color = 'white';
        removeButton.style.border = 'none';
        removeButton.style.padding = '2px 5px';
        removeButton.style.marginLeft = '5px';
        removeButton.style.cursor = 'pointer';
        removeButton.style.fontSize = '11px';
        removeButton.style.width = '50px'; // 横幅を固定
        removeButton.style.borderRadius = '3px'; // 角を丸く
        removeButton.style.textAlign = 'center';

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
  }

  // 上級者向け機能を非表示
  function hideAdvancedFeatures() {
    advancedFeaturesContainer.classList.remove('visible');
    setTimeout(() => {
      advancedFeaturesContainer.style.display = 'none';
    }, 300); // トランジション時間に合わせる
    advancedFeaturesToggle.classList.remove('active');
    advancedFeaturesToggle.textContent = '上級者向け機能を表示';
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



  // 現在のURLを追加するボタンのイベントリスナー
  if (addCurrentUrlButton) {
    addCurrentUrlButton.addEventListener('click', function () {
      getCurrentTabUrl(function (currentUrl) {
        if (currentUrl) {
          addExcludedUrl(currentUrl);
        } else {
          showNotification('現在のURLを取得できませんでした', true, false, 2000);
        }
      });
    });
  }


  // 初期表示
  if (excludedUrlsList) {
    displayExcludedUrls();
  }


  console.log('ポップアップ拡張機能を初期化しました');
});