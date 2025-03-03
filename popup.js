document.addEventListener('DOMContentLoaded', function () {
  // スライダー要素と値表示要素の取得
  const thresholdSlider = document.getElementById('threshold');
  const thresholdValue = document.getElementById('threshold-value');
  const ratioSlider = document.getElementById('ratio');
  const ratioValue = document.getElementById('ratio-value');
  const attackSlider = document.getElementById('attack');
  const attackValue = document.getElementById('attack-value');
  const releaseSlider = document.getElementById('release');
  const releaseValue = document.getElementById('release-value');
  const kneeSlider = document.getElementById('knee');
  const kneeValue = document.getElementById('knee-value');
  const makeupGainSlider = document.getElementById('makeup-gain');
  const makeupGainValue = document.getElementById('makeup-gain-value');
  const compressorEnabled = document.getElementById('compressor-enabled');

  const saveButton = document.getElementById('save-settings');
  const saveChannelButton = document.getElementById('save-channel');
  const saveGeneralButton = document.getElementById('save-settings-general');
  const channelInfoDiv = document.getElementById('channel-info');
  const nonYoutubeInfoDiv = document.getElementById('non-youtube-info');
  const channelNameSpan = document.getElementById('channel-name');
  const detectionMethodSpan = document.getElementById('detection-method');
  const refreshChannelButton = document.getElementById('refresh-channel');

  // 折りたたみパネルの設定
  const collapsible = document.querySelector('.collapsible');
  const advancedSettings = document.querySelector('.advanced-settings');

  // 折りたたみパネルのクリックイベント
  collapsible.addEventListener('click', function () {
    this.classList.toggle('active');

    if (advancedSettings.style.maxHeight) {
      advancedSettings.style.maxHeight = null;
    } else {
      advancedSettings.style.maxHeight = advancedSettings.scrollHeight + 'px';
    }
  });

  let currentChannelId = '';
  let isYouTube = false;

  // エラーメッセージを表示
  function showError(message) {
    channelNameSpan.textContent = `エラー: ${message}`;
    channelNameSpan.style.color = 'red';

    // 3秒後に元の色に戻す
    setTimeout(() => {
      channelNameSpan.style.color = '';
    }, 3000);
  }

  // 現在のチャンネル情報を取得
  function getCurrentChannelInfo() {
    // まずbackground.jsから保存されたチャンネル情報を取得
    chrome.runtime.sendMessage({ action: 'getStoredChannelInfo' }, function (response) {
      console.log('バックグラウンドからのチャンネル情報:', response);

      if (response && response.channelId) {
        // background.jsから有効なチャンネル情報を受け取った場合
        updateChannelUI(response.channelId, response.channelName, response.detectionMethod);
      } else {
        // background.jsに情報がない場合は、アクティブなタブから直接取得
        getChannelInfoFromTab();
      }
    });

    // チャンネル情報更新通知のリスナーを設定
    chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
      if (request.action === 'channelInfoUpdated' && request.channelInfo) {
        console.log('リアルタイム更新：新しいチャンネル情報を受信', request.channelInfo);
        updateChannelUI(
          request.channelInfo.channelId,
          request.channelInfo.channelName,
          request.channelInfo.detectionMethod
        );
      }
    });
  }

  // アクティブなタブからチャンネル情報を取得
  function getChannelInfoFromTab() {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      // 現在のタブがあるか確認
      if (!tabs || tabs.length === 0) {
        console.error('アクティブなタブが見つかりません');
        channelInfoDiv.style.display = 'none';
        nonYoutubeInfoDiv.style.display = 'block';
        return;
      }

      const currentTab = tabs[0];
      console.log('現在のタブ:', currentTab.url);

      // YouTubeのページかどうかを確認
      isYouTube = currentTab.url && currentTab.url.includes('youtube.com');

      if (isYouTube) {
        console.log('YouTubeページを検出しました');
        channelInfoDiv.style.display = 'block';
        nonYoutubeInfoDiv.style.display = 'none';

        // YouTubeの場合はチャンネル情報を取得
        try {
          chrome.tabs.sendMessage(currentTab.id, {
            action: 'getChannelInfo'
          }, function (response) {
            console.log('タブからのチャンネル情報応答:', response);

            if (chrome.runtime.lastError) {
              console.error('メッセージ送信エラー:', chrome.runtime.lastError);
              channelNameSpan.textContent = 'エラー: 接続できません。ページを更新してください。';
              loadDefaultSettings();
              return;
            }

            if (response && response.channelId) {
              updateChannelUI(response.channelId, response.channelName, response.detectionMethod);
            } else {
              // チャンネル情報がない場合
              console.log('チャンネル情報が利用できません');
              channelNameSpan.textContent = '不明なチャンネル';
              detectionMethodSpan.textContent = '取得失敗';
              loadDefaultSettings();
            }
          });
        } catch (error) {
          console.error('メッセージ送信中のエラー:', error);
          channelNameSpan.textContent = 'エラー: ' + error.message;
          detectionMethodSpan.textContent = 'エラー';
          loadDefaultSettings();
        }
      } else {
        // YouTube以外のページ
        console.log('YouTube以外のページを検出');
        channelInfoDiv.style.display = 'none';
        nonYoutubeInfoDiv.style.display = 'block';
        loadDefaultSettings();
      }
    });
  }

  // チャンネル情報を強制的に更新
  function forceRefreshChannelInfo() {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs || tabs.length === 0) {
        showError('アクティブなタブが見つかりません');
        return;
      }

      const currentTab = tabs[0];
      if (!currentTab.url || !currentTab.url.includes('youtube.com')) {
        showError('YouTubeページではありません');
        return;
      }

      // 更新中の表示
      channelNameSpan.textContent = '更新中...';
      detectionMethodSpan.textContent = '検索中...';

      try {
        chrome.tabs.sendMessage(currentTab.id, {
          action: 'forceChannelInfoRefresh'
        }, function (response) {
          console.log('チャンネル情報の強制更新の応答:', response);

          if (chrome.runtime.lastError) {
            console.error('メッセージ送信エラー:', chrome.runtime.lastError);
            showError('接続できません。ページを更新してください。');
            return;
          }

          if (response && response.channelId) {
            updateChannelUI(response.channelId, response.channelName, response.detectionMethod);
          } else if (response && response.error) {
            showError(response.message || 'チャンネル情報の取得に失敗しました');
            detectionMethodSpan.textContent = '取得失敗';
          } else {
            showError('不明なエラーが発生しました');
            detectionMethodSpan.textContent = '取得失敗';
          }
        });
      } catch (error) {
        console.error('強制更新中のエラー:', error);
        showError(error.message);
        detectionMethodSpan.textContent = 'エラー';
      }
    });
  }

  // チャンネル情報をUIに反映
  function updateChannelUI(channelId, channelName, detectionMethod) {
    if (channelId) {
      currentChannelId = channelId;

      // チャンネル情報があれば表示
      channelInfoDiv.style.display = 'block';
      nonYoutubeInfoDiv.style.display = 'none';
      channelNameSpan.textContent = channelName || channelId;
      channelNameSpan.style.color = ''; // 色をリセット

      // 検出方法を表示
      detectionMethodSpan.textContent = detectionMethod || '不明';

      console.log('チャンネル名を表示:', channelNameSpan.textContent, '取得方法:', detectionMethod);

      // チャンネル固有の設定を読み込む
      loadChannelSettings(currentChannelId);
    }
  }

  // チャンネル固有の設定を読み込む
  function loadChannelSettings(channelId) {
    const settingsKey = channelId ? `channel_${channelId}` : 'default';
    console.log('設定読み込み:', settingsKey);

    chrome.storage.sync.get({
      'default': {
        enabled: true,
        threshold: -24,
        ratio: 4,
        attack: 50,
        release: 250,
        knee: 5,
        makeupGain: 0
      },
      [settingsKey]: null
    }, function (items) {
      // チャンネル固有設定があればそれを使用、なければデフォルト設定
      const settings = items[settingsKey] || items.default;
      console.log('読み込んだ設定:', settings);
      applySettingsToUI(settings);
    });
  }

  // デフォルト設定を読み込む
  function loadDefaultSettings() {
    console.log('デフォルト設定を読み込みます');
    chrome.storage.sync.get({
      'default': {
        enabled: true,
        threshold: -24,
        ratio: 4,
        attack: 50,
        release: 250,
        knee: 5,
        makeupGain: 0
      }
    }, function (items) {
      applySettingsToUI(items.default);
    });
  }

  // 設定をUIに適用
  function applySettingsToUI(settings) {
    compressorEnabled.checked = settings.enabled;
    thresholdSlider.value = settings.threshold;
    thresholdValue.textContent = settings.threshold;
    ratioSlider.value = settings.ratio;
    ratioValue.textContent = settings.ratio;
    attackSlider.value = settings.attack;
    attackValue.textContent = settings.attack;
    releaseSlider.value = settings.release;
    releaseValue.textContent = settings.release;
    kneeSlider.value = settings.knee;
    kneeValue.textContent = settings.knee;
    makeupGainSlider.value = settings.makeupGain;
    makeupGainValue.textContent = settings.makeupGain;
  }

  // 現在の設定を取得
  function getCurrentSettings() {
    return {
      enabled: compressorEnabled.checked,
      threshold: parseInt(thresholdSlider.value, 10),
      ratio: parseFloat(ratioSlider.value),
      attack: parseInt(attackSlider.value, 10),
      release: parseInt(releaseSlider.value, 10),
      knee: parseInt(kneeSlider.value, 10),
      makeupGain: parseFloat(makeupGainSlider.value)
    };
  }

  // 設定保存の処理
  function saveSettings(saveForChannel, saveAsDefault) {
    const settings = getCurrentSettings();

    // 現在開いているタブに設定変更を通知
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      chrome.tabs.sendMessage(tabs[0].id, {
        action: 'updateCompressorSettings',
        settings: settings,
        saveForChannel: saveForChannel,
        saveAsDefault: saveAsDefault
      }, function (response) {
        if (chrome.runtime.lastError) {
          console.error('設定更新エラー:', chrome.runtime.lastError);
          showSaveNotification('設定の更新に失敗しました。ページを更新してください。', true);
          return;
        }

        // 保存が成功したら通知を表示
        showSaveNotification(saveForChannel ? '選択したチャンネルに設定を保存しました' : 'デフォルト設定を保存しました');
      });
    });
  }

  // 保存成功の通知
  function showSaveNotification(message, isError = false) {
    const status = document.createElement('div');
    status.textContent = message;
    status.style.color = isError ? 'red' : 'green';
    status.style.marginTop = '10px';
    status.style.textAlign = 'center';
    document.body.appendChild(status);

    // 通知を2秒後に消す
    setTimeout(function () {
      document.body.removeChild(status);
    }, 2000);
  }

  // スライダーの値が変更されたときに表示を更新
  thresholdSlider.addEventListener('input', function () {
    thresholdValue.textContent = this.value;
  });

  ratioSlider.addEventListener('input', function () {
    ratioValue.textContent = this.value;
  });

  attackSlider.addEventListener('input', function () {
    attackValue.textContent = this.value;
  });

  releaseSlider.addEventListener('input', function () {
    releaseValue.textContent = this.value;
  });

  kneeSlider.addEventListener('input', function () {
    kneeValue.textContent = this.value;
  });

  makeupGainSlider.addEventListener('input', function () {
    makeupGainValue.textContent = this.value;
  });

  // デフォルトとして保存ボタンのクリックイベント
  saveButton.addEventListener('click', function () {
    saveSettings(false, true);
  });

  // チャンネルに保存ボタンのクリックイベント
  saveChannelButton.addEventListener('click', function () {
    saveSettings(true, false);
  });

  // 一般的な保存ボタンのクリックイベント（YouTube以外のページ用）
  saveGeneralButton.addEventListener('click', function () {
    saveSettings(false, true);
  });

  // チャンネル情報更新ボタンのクリックイベント
  refreshChannelButton.addEventListener('click', function () {
    forceRefreshChannelInfo();
  });

  // 初期化
  console.log('ポップアップを初期化します');
  getCurrentChannelInfo();
});