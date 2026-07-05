// Cầu nối (ISOLATED world): page.js chạy MAIN world nên KHÔNG có chrome.*.
// - getState/setState/clearState: lưu tiến trình qua mỗi lần RELOAD (cách B) bằng chrome.storage.
// - capture/saveText: chuyển sang background (captureVisibleTab / tải file).
function reply(id, result) { window.postMessage({ source: 'hp-cap-res', id, result }, '*'); }

window.addEventListener('message', (e) => {
  if (e.source !== window || !e.data || e.data.source !== 'hp-cap-req') return;
  const { id, type, payload } = e.data;

  if (type === 'getState') {
    chrome.storage.local.get('hpRun', (d) => reply(id, { ok: true, state: d.hpRun || null }));
    return;
  }
  if (type === 'setState') {
    chrome.storage.local.set({ hpRun: payload.state }, () => reply(id, { ok: !chrome.runtime.lastError, error: chrome.runtime.lastError && chrome.runtime.lastError.message }));
    return;
  }
  if (type === 'clearState') {
    chrome.storage.local.remove('hpRun', () => reply(id, { ok: true }));
    return;
  }
  // capture / saveText → background
  chrome.runtime.sendMessage({ type, ...(payload || {}) }, (res) => {
    reply(id, chrome.runtime.lastError ? { ok: false, error: chrome.runtime.lastError.message } : (res || { ok: false, error: 'no response' }));
  });
});
