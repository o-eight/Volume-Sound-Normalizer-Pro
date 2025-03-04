// 現在のチャンネル情報を保持するグローバル変数を更新
let currentChannelInfo = {
  channelId: '',
  channelName: '',
  detectionMethod: '',
  platform: ''  // 'youtube' または 'twitch'
};

// pingメッセージに応答するリスナー
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (request.action === 'ping') {
    sendResponse({ status: 'pong' });
  }
  else if (request.action === 'currentChannelUpdate' || request.action === 'channelChanged') {
    // チャンネル情報の更新を保存
    currentChannelInfo.channelId = request.channelId;
    currentChannelInfo.channelName = request.channelName;
    currentChannelInfo.detectionMethod = request.detectionMethod || 'unknown';
    currentChannelInfo.platform = request.platform || 'unknown'; // プラットフォーム情報を追加

    // ポップアップが開いている場合は通知
    notifyPopupIfOpen();
  }
  else if (request.action === 'getStoredChannelInfo') {
    // ポップアップからのリクエストに保存されたチャンネル情報を返す
    sendResponse(currentChannelInfo);
  }

  return true;  // 非同期レスポンスのために必要
});

// 開いているポップアップに通知する
function notifyPopupIfOpen() {
  chrome.runtime.sendMessage({
    action: 'channelInfoUpdated',
    channelInfo: currentChannelInfo
  }).catch(error => {
    // ポップアップが開いていない場合はエラーになるが無視してよい
  });
}

// インストール時やアップデート時にYouTubeとTwitchのタブをリロード
chrome.runtime.onInstalled.addListener(function () {
  chrome.tabs.query({}, function (tabs) {
    for (let i = 0; i < tabs.length; i++) {
      if (tabs[i].url && (tabs[i].url.includes('youtube.com') || tabs[i].url.includes('twitch.tv'))) {
        chrome.tabs.reload(tabs[i].id);
      }
    }
  });
});