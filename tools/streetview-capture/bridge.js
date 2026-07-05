// Cầu nối (ISOLATED world): page.js chạy MAIN world nên KHÔNG có chrome.*.
// Nhận yêu cầu qua window.postMessage, chuyển sang background (captureVisibleTab / tải file),
// rồi trả kết quả ngược lại cho page.js.
window.addEventListener('message', (e) => {
  if (e.source !== window || !e.data || e.data.source !== 'hp-cap-req') return;
  const { id, type, payload } = e.data;
  chrome.runtime.sendMessage({ type, ...(payload || {}) }, (res) => {
    const result = chrome.runtime.lastError
      ? { ok: false, error: chrome.runtime.lastError.message }
      : (res || { ok: false, error: 'no response' });
    window.postMessage({ source: 'hp-cap-res', id, result }, '*');
  });
});
