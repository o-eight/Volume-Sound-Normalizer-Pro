// popup-core.js - コア機能を提供する基本的なポップアップスクリプト

document.addEventListener('DOMContentLoaded', function () {
  // 基本的なUI要素
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

  // ボタン要素
  const saveButton = document.getElementById('save-settings');
  const saveChannelButton = document.getElementById('save-channel');
  const saveGeneralButton = document.getElementById('save-settings-general');
  const channelInfoDiv = document.getElementById('channel-info');
  const nonYoutubeInfoDiv = document.getElementById('non-youtube-info');
  const channelNameSpan = document.getElementById('channel-name');
  const detectionMethodSpan = document.getElementById('detection-method');

  // 折りたたみパネルの設定
  const advancedCollapsible = document.getElementById('advanced-collapsible');
  const advancedSettings = document.querySelector('.advanced-settings');

  // グローバル変数
  let currentChannelId = '';
  let currentPlatform = ''; // 'youtube' または 'twitch'
  let isVideoSite = false;
  let updateTimeout = null;
  let compressorSettings = {};

  // 折りたたみパネルのクリックイベント
  advancedCollapsible.addEventListener('click', function () {
    this.classList.toggle('active');

    if (advancedSettings.style.maxHeight) {
      advancedSettings.style.maxHeight = null;
    } else {
      advancedSettings.style.maxHeight = advancedSettings.scrollHeight + 'px';
    }
  });

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

  // 2. アクティブなタブからチャンネル情報を取得する関数を修正
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

      // YouTubeまたはTwitchのページかどうかを確認
      isVideoSite = currentTab.url && (currentTab.url.includes('youtube.com') || currentTab.url.includes('twitch.tv'));

      // プラットフォームを特定
      if (currentTab.url && currentTab.url.includes('youtube.com')) {
        currentPlatform = 'youtube';
      } else if (currentTab.url && currentTab.url.includes('twitch.tv')) {
        currentPlatform = 'twitch';
      } else {
        currentPlatform = '';
      }

      if (isVideoSite) {
        console.log('動画サイトページを検出しました:', currentPlatform);
        channelInfoDiv.style.display = 'block';
        nonYoutubeInfoDiv.style.display = 'none';

        // チャンネルの表示名を更新
        const platformNameSpan = document.getElementById('platform-name');
        if (platformNameSpan) {
          platformNameSpan.textContent = currentPlatform === 'youtube' ? 'YouTube' : 'Twitch';
        }

        // チャンネル情報を取得
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
              updateChannelUI(response.channelId, response.channelName, response.method);
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
        // YouTube/Twitch以外のページ
        console.log('動画サイト以外のページを検出');
        channelInfoDiv.style.display = 'none';
        nonYoutubeInfoDiv.style.display = 'block';
        loadDefaultSettings();
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

      console.log('チャンネル名を表示:', channelNameSpan.textContent, '方法:', detectionMethod);

      // チャンネル固有の設定を読み込む
      loadChannelSettings(currentChannelId);
    }
  }


  // 3. チャンネル固有の設定を読み込む関数を修正
  function loadChannelSettings(channelId) {
    // プラットフォーム情報も含めてキーを生成
    const settingsKey = channelId ? `channel_${currentPlatform}_${channelId}` : 'default';
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

      // 他のモジュールで使用できるように設定を保存
      compressorSettings = settings;

      // カスタムイベントを発行して設定が読み込まれたことを通知
      const event = new CustomEvent('settingsLoaded', { detail: settings });
      document.dispatchEvent(event);
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

      // 他のモジュールで使用できるように設定を保存
      compressorSettings = items.default;

      // カスタムイベントを発行して設定が読み込まれたことを通知
      const event = new CustomEvent('settingsLoaded', { detail: items.default });
      document.dispatchEvent(event);
    });
  }

  // 設定をUIに適用
  function applySettingsToUI(settings) {
    // 既存の設定を適用
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

    // カスタムイベントを発行して設定が適用されたことを通知
    const event = new CustomEvent('settingsApplied', { detail: settings });
    document.dispatchEvent(event);
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

  // カスタムイベントのエクスポート
  window.audioNormalizer = {
    getCurrentSettings: getCurrentSettings,
    showNotification: showNotification,
    // 設定リセット用に関数を追加
    loadDefaultSettings: loadDefaultSettings
  };


  // 4. 設定保存の処理を修正
  function saveSettings(saveForChannel, saveAsDefault) {
    const settings = getCurrentSettings();

    // 保存中の状態表示
    showNotification('設定を保存中...', false, true);

    // 現在の設定を保存
    if (saveForChannel && currentChannelId) {
      // プラットフォーム情報も含めたキーを生成
      const channelSettingsKey = `channel_${currentPlatform}_${currentChannelId}`;

      // まず設定をストレージに直接保存
      chrome.storage.sync.set({
        [channelSettingsKey]: settings
      }, function () {
        if (chrome.runtime.lastError) {
          console.error('設定保存エラー:', chrome.runtime.lastError);
          showNotification('設定の保存に失敗しました: ' + chrome.runtime.lastError.message, true);
          return;
        }

        // 次に現在のタブに設定変更を通知
        sendSettingsToTab(settings, saveForChannel, saveAsDefault);
      });
    } else if (saveAsDefault) {
      // デフォルト設定を保存
      chrome.storage.sync.set({
        'default': settings
      }, function () {
        if (chrome.runtime.lastError) {
          console.error('デフォルト設定保存エラー:', chrome.runtime.lastError);
          showNotification('デフォルト設定の保存に失敗しました: ' + chrome.runtime.lastError.message, true);
          return;
        }

        // 現在のタブに設定変更を通知
        sendSettingsToTab(settings, saveForChannel, saveAsDefault);
      });
    } else {
      // 単に現在のタブに設定変更を通知
      sendSettingsToTab(settings, saveForChannel, saveAsDefault);
    }
  }

  // タブに設定を送信する処理を別関数に分離
  function sendSettingsToTab(settings, saveForChannel, saveAsDefault) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      // アクティブなタブがあるか確認
      if (!tabs || !tabs.length) {
        console.error('アクティブなタブが見つかりません');
        showNotification('アクティブなタブが見つかりません。', true);
        return;
      }

      // コンテンツスクリプトが有効かどうかを最初にチェック
      chrome.tabs.sendMessage(tabs[0].id, { action: 'ping' }, function (response) {
        if (chrome.runtime.lastError) {
          console.error('コンテンツスクリプトとの通信エラー:', chrome.runtime.lastError);

          // ユーザーに対してよりわかりやすいエラーメッセージを表示
          let errorMsg = 'ページとの通信に失敗しました。ページの再読み込みが必要かもしれません。';
          if (chrome.runtime.lastError.message.includes('receiving end does not exist')) {
            errorMsg = 'コンテンツスクリプトが読み込まれていません。ページを更新してください。';
          }

          showNotification(errorMsg, true);
          addRefreshPageButton();
          return;
        }

        // コンテンツスクリプトが応答したので設定を送信
        chrome.tabs.sendMessage(tabs[0].id, {
          action: 'updateCompressorSettings',
          settings: settings,
          saveForChannel: saveForChannel,
          saveAsDefault: saveAsDefault
        }, function (response) {
          if (chrome.runtime.lastError) {
            console.error('設定更新エラー:', chrome.runtime.lastError);
            showNotification('設定の更新に失敗しました: ' + chrome.runtime.lastError.message, true);
            addRefreshPageButton();
            return;
          }

          // 成功したら通知を表示
          const successMessage = saveForChannel ?
            '選択したチャンネルに設定を保存しました' :
            (saveAsDefault ? 'デフォルト設定を保存しました' : '設定を適用しました');

          showNotification(successMessage);
        });
      });
    });
  }

  // 通知を表示する汎用関数
  function showNotification(message, isError = false, isLoading = false, duration = 2000) {
    // 既存の通知を削除
    const existingStatus = document.getElementById('status-notification');
    if (existingStatus) {
      if (existingStatus.parentNode) {
        existingStatus.parentNode.removeChild(existingStatus);
      }
    }

    // 新しい通知を作成
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

    // ローディング中はアイコンを追加
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

      // スピナーアニメーションのためのスタイルを追加
      const style = document.createElement('style');
      style.textContent = `
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `;
      document.head.appendChild(style);
    }

    document.body.appendChild(status);

    // エラーでなく、ローディング中でもない場合は、通知を指定時間後に消す
    if (!isError && !isLoading) {
      setTimeout(function () {
        const notification = document.getElementById('status-notification');
        if (notification && notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, duration);
    }
  }

  // エラー回復のためのページ更新ボタンを追加
  function addRefreshPageButton() {
    // 既存のボタンがあれば削除
    const existingButton = document.getElementById('refresh-page-button-container');
    if (existingButton && existingButton.parentNode) {
      existingButton.parentNode.removeChild(existingButton);
    }

    const container = document.createElement('div');
    container.id = 'refresh-page-button-container';
    container.style.marginTop = '15px';
    container.style.textAlign = 'center';

    const refreshButton = document.createElement('button');
    refreshButton.textContent = 'ページを更新して再接続';
    refreshButton.style.padding = '8px 12px';
    refreshButton.style.backgroundColor = '#2196F3';
    refreshButton.style.color = 'white';
    refreshButton.style.border = 'none';
    refreshButton.style.borderRadius = '4px';
    refreshButton.style.cursor = 'pointer';

    refreshButton.addEventListener('click', function () {
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (tabs && tabs.length > 0) {
          chrome.tabs.reload(tabs[0].id);
          window.close(); // ポップアップを閉じる
        }
      });
    });

    container.appendChild(refreshButton);
    document.body.appendChild(container);
  }

  // 初期化時にコンテンツスクリプトへの接続を確認
  function checkContentScriptConnection() {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs || !tabs.length) {
        showNotification('アクティブなタブが見つかりません。', true);
        return;
      }

      chrome.tabs.sendMessage(tabs[0].id, { action: 'ping' }, function (response) {
        if (chrome.runtime.lastError) {
          console.error('コンテンツスクリプト接続エラー:', chrome.runtime.lastError);
          showNotification('ページとの接続に失敗しました。ページの更新が必要です。', true);
          addRefreshPageButton();
        }
      });
    });
  }

  // リアルタイム更新用の関数
  function updateSettingsRealtime() {
    // 連続した更新をまとめるために少し遅延を入れる（パフォーマンス向上）
    if (updateTimeout) {
      clearTimeout(updateTimeout);
    }

    updateTimeout = setTimeout(function () {
      const settings = getCurrentSettings();

      // コンテンツスクリプトに更新を送信（保存しない）
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (!tabs || !tabs.length) {
          console.error('アクティブなタブが見つかりません');
          return;
        }

        chrome.tabs.sendMessage(tabs[0].id, {
          action: 'updateCompressorSettings',
          settings: settings,
          saveForChannel: false,
          saveAsDefault: false
        }, function (response) {
          if (chrome.runtime.lastError) {
            console.error('リアルタイム設定更新エラー:', chrome.runtime.lastError);
            // エラーが続く場合はステータス表示（一時的にしておく）
            showNotification('設定の更新に失敗しました', true);
            setTimeout(() => {
              const status = document.getElementById('status-notification');
              if (status) document.body.removeChild(status);
            }, 1000);
          }
        });
      });
    }, 50); // 50ms遅延（スムーズな更新のバランス）
  }

  // 既存のスライダーイベントリスナー
  thresholdSlider.addEventListener('input', function () {
    thresholdValue.textContent = this.value;
    updateSettingsRealtime();
  });

  ratioSlider.addEventListener('input', function () {
    ratioValue.textContent = this.value;
    updateSettingsRealtime();
  });

  attackSlider.addEventListener('input', function () {
    attackValue.textContent = this.value;
    updateSettingsRealtime();
  });

  releaseSlider.addEventListener('input', function () {
    releaseValue.textContent = this.value;
    updateSettingsRealtime();
  });

  kneeSlider.addEventListener('input', function () {
    kneeValue.textContent = this.value;
    updateSettingsRealtime();
  });

  makeupGainSlider.addEventListener('input', function () {
    makeupGainValue.textContent = this.value;
    updateSettingsRealtime();
  });

  // コンプレッサーの有効/無効切り替えもリアルタイムで適用
  compressorEnabled.addEventListener('change', function () {
    updateSettingsRealtime();
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

  // 初期化
  console.log('ポップアップコアを初期化します');
  getCurrentChannelInfo();
  checkContentScriptConnection();
});