// Service worker: mở trang chụp + chụp màn hình tab đang hiển thị + tải file về.
// capture.js gửi message; ở đây gọi captureVisibleTab / downloads.

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('capture.html') });
});

// Hàng đợi tải để không nghẽn (downloads.download nhiều dataURL cùng lúc dễ lỗi)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'capture') {
    const winId = sender.tab ? sender.tab.windowId : chrome.windows.WINDOW_ID_CURRENT;
    chrome.tabs.captureVisibleTab(winId, { format: 'jpeg', quality: 88 }, (dataUrl) => {
      if (chrome.runtime.lastError || !dataUrl) {
        sendResponse({ ok: false, error: (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'no dataUrl' });
        return;
      }
      chrome.downloads.download(
        { url: dataUrl, filename: 'hp-streetview/' + msg.filename, conflictAction: 'overwrite', saveAs: false },
        (id) => sendResponse({ ok: !chrome.runtime.lastError, id, error: chrome.runtime.lastError && chrome.runtime.lastError.message })
      );
    });
    return true; // async
  }
  if (msg.type === 'saveText') {
    const url = 'data:application/json;charset=utf-8,' + encodeURIComponent(msg.text);
    chrome.downloads.download(
      { url, filename: 'hp-streetview/' + msg.filename, conflictAction: 'overwrite', saveAs: false },
      (id) => sendResponse({ ok: !chrome.runtime.lastError, id, error: chrome.runtime.lastError && chrome.runtime.lastError.message })
    );
    return true;
  }
  return false;
});
