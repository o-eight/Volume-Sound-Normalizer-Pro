// 現在のチャンネル情報を保持するグローバル変数
let currentChannelInfo = {
  channelId: '',
  channelName: '',
  detectionMethod: ''
};

// pingメッセージに応答するリスナー
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  console.log('バックグラウンドがメッセージを受信:', request.action);

  if (request.action === 'ping') {
    sendResponse({ status: 'pong' });
  }
  else if (request.action === 'currentChannelUpdate' || request.action === 'channelChanged') {
    // チャンネル情報の更新を保存
    currentChannelInfo.channelId = request.channelId;
    currentChannelInfo.channelName = request.channelName;
    currentChannelInfo.detectionMethod = request.detectionMethod || 'unknown';

    console.log('バックグラウンドがチャンネル情報を更新:', currentChannelInfo);

    // ポップアップが開いている場合は通知
    notifyPopupIfOpen();
  }
  else if (request.action === 'getStoredChannelInfo') {
    // ポップアップからのリクエストに保存されたチャンネル情報を返す
    console.log('保存されたチャンネル情報を送信:', currentChannelInfo);
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
    console.log('ポップアップへの通知をスキップ（おそらく閉じられています）');
  });
}

// インストール時やアップデート時にYouTubeのタブをリロード
chrome.runtime.onInstalled.addListener(function () {
  chrome.tabs.query({}, function (tabs) {
    for (let i = 0; i < tabs.length; i++) {
      if (tabs[i].url && tabs[i].url.includes('youtube.com')) {
        chrome.tabs.reload(tabs[i].id);
      }
    }
  });
});
