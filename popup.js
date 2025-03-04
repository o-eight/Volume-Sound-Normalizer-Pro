document.addEventListener('DOMContentLoaded', function () {
  // 既存のスライダー要素と値表示要素
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

  // ラウドネスノーマライズ用の要素（新規追加）
  const loudnessNormEnabled = document.getElementById('loudness-norm-enabled');
  const targetLoudnessSlider = document.getElementById('target-loudness');
  const targetLoudnessValue = document.getElementById('target-loudness-value');
  const loudnessRangeSlider = document.getElementById('loudness-range-slider');
  const loudnessRangeValue = document.getElementById('loudness-range-value');
  const loudnessBar = document.getElementById('loudness-bar');
  const loudnessTarget = document.getElementById('loudness-target');
  const loudnessRange = document.getElementById('loudness-range');
  const currentLoudnessValue = document.getElementById('current-loudness-value');

  // 既存のボタン要素
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
  const loudnessCollapsible = document.getElementById('loudness-collapsible');
  const loudnessSettings = document.querySelector('.loudness-settings');

  // 折りたたみパネルのクリックイベント
  advancedCollapsible.addEventListener('click', function () {
    this.classList.toggle('active');

    if (advancedSettings.style.maxHeight) {
      advancedSettings.style.maxHeight = null;
    } else {
      advancedSettings.style.maxHeight = advancedSettings.scrollHeight + 'px';
    }
  });

  // ラウドネス設定の折りたたみパネルのクリックイベント
  loudnessCollapsible.addEventListener('click', function () {
    this.classList.toggle('active');

    if (loudnessSettings.style.maxHeight) {
      loudnessSettings.style.maxHeight = null;
    } else {
      loudnessSettings.style.maxHeight = loudnessSettings.scrollHeight + 'px';
    }
  });

  let currentChannelId = '';
  let isYouTube = false;
  let loudnessUpdateInterval = null;

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
        makeupGain: 0,
        // ラウドネスノーマライズのデフォルト設定を追加
        loudnessNormEnabled: false,
        targetLoudness: -24,
        loudnessRange: 7
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
        makeupGain: 0,
        // ラウドネスノーマライズのデフォルト設定を追加
        loudnessNormEnabled: false,
        targetLoudness: -24,
        loudnessRange: 7
      }
    }, function (items) {
      applySettingsToUI(items.default);
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

    // ラウドネス設定を適用（新規）
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
      makeupGain: parseFloat(makeupGainSlider.value),
      // ラウドネス設定を追加
      loudnessNormEnabled: loudnessNormEnabled.checked,
      targetLoudness: parseFloat(targetLoudnessSlider.value),
      loudnessRange: parseFloat(loudnessRangeSlider.value)
    };
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



  // ラウドネスモニタリングの開始/停止関数を追加
  function toggleLoudnessMonitoring(enabled) {
    // 既存のインターバルがあれば停止
    if (loudnessUpdateInterval) {
      clearInterval(loudnessUpdateInterval);
      loudnessUpdateInterval = null;
    }

    // 有効な場合は監視を開始
    if (enabled) {
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

  // 設定保存の処理
  function saveSettings(saveForChannel, saveAsDefault) {
    const settings = getCurrentSettings();

    // 保存中の状態表示
    showSaveNotification('設定を保存中...', false, true);

    // 現在の設定を保存
    if (saveForChannel && currentChannelId) {
      const channelSettingsKey = `channel_${currentChannelId}`;

      // まず設定をストレージに直接保存
      chrome.storage.sync.set({
        [channelSettingsKey]: settings
      }, function () {
        if (chrome.runtime.lastError) {
          console.error('設定保存エラー:', chrome.runtime.lastError);
          showSaveNotification('設定の保存に失敗しました: ' + chrome.runtime.lastError.message, true);
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
          showSaveNotification('デフォルト設定の保存に失敗しました: ' + chrome.runtime.lastError.message, true);
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
        showSaveNotification('アクティブなタブが見つかりません。', true);
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

          showSaveNotification(errorMsg, true);
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
            showSaveNotification('設定の更新に失敗しました: ' + chrome.runtime.lastError.message, true);
            addRefreshPageButton();
            return;
          }

          // 成功したら通知を表示
          const successMessage = saveForChannel ?
            '選択したチャンネルに設定を保存しました' :
            (saveAsDefault ? 'デフォルト設定を保存しました' : '設定を適用しました');

          showSaveNotification(successMessage);
        });
      });
    });
  }

  // 保存成功/エラーの通知を改善
  function showSaveNotification(message, isError = false, isLoading = false) {
    // 既存の通知を削除
    const existingStatus = document.getElementById('status-notification');
    if (existingStatus) {
      // 親要素が存在することを確認
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

    // エラーでなく、ローディング中でもない場合は、通知を2秒後に消す
    if (!isError && !isLoading) {
      setTimeout(function () {
        const notification = document.getElementById('status-notification');
        if (notification && notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 2000);
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
        showSaveNotification('アクティブなタブが見つかりません。', true);
        return;
      }

      chrome.tabs.sendMessage(tabs[0].id, { action: 'ping' }, function (response) {
        if (chrome.runtime.lastError) {
          console.error('コンテンツスクリプト接続エラー:', chrome.runtime.lastError);
          showSaveNotification('ページとの接続に失敗しました。ページの更新が必要です。', true);
          addRefreshPageButton();
        }
      });
    });
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

  // ラウドネス設定のイベントリスナー
  targetLoudnessSlider.addEventListener('input', function () {
    targetLoudnessValue.textContent = this.value;
    updateLoudnessMeterTarget();
    updateLoudnessMeterRange();
    updateSettingsRealtime();
  });

  loudnessRangeSlider.addEventListener('input', function () {
    loudnessRangeValue.textContent = this.value;
    updateLoudnessMeterRange();
    updateSettingsRealtime();
  });

  // コンプレッサーの有効/無効切り替えもリアルタイムで適用
  compressorEnabled.addEventListener('change', function () {
    updateSettingsRealtime();
  });

  // ラウドネスノーマライズの有効/無効切り替え
  loudnessNormEnabled.addEventListener('change', function () {
    toggleLoudnessMonitoring(this.checked);
    updateSettingsRealtime();
  });

  // リアルタイム更新用の関数を追加
  let updateTimeout = null;
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
            showSaveNotification('設定の更新に失敗しました', true);
            setTimeout(() => {
              const status = document.getElementById('status-notification');
              if (status) document.body.removeChild(status);
            }, 1000);
          }
        });
      });
    }, 50); // 50ms遅延（スムーズな更新のバランス）
  }

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

  // ポップアップが閉じられるときの処理
  window.addEventListener('unload', function () {
    // ラウドネスモニタリングを停止
    if (loudnessUpdateInterval) {
      clearInterval(loudnessUpdateInterval);
    }
  });

  // 初期化
  console.log('ポップアップを初期化します');
  getCurrentChannelInfo();
  checkContentScriptConnection();
});