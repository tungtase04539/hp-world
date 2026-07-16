// Nhận danh sách URL từ content script -> tải từng ảnh về Downloads/<folder>/.
// chrome.downloads gửi request như trình duyệt (cookie/referer) -> vượt hotlink/CORS cho phần lớn nguồn.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'hp_download') {
    const { urls, folder } = msg;
    urls.forEach((url, idx) => {
      let base = (url.split('?')[0].split('/').pop() || ('img' + idx));
      base = base.replace(/[^\w.\-]+/g, '_');
      if (!/\.(jpe?g|png|webp)$/i.test(base)) base += '.jpg';
      const name = String(idx + 1).padStart(2, '0') + '_' + base;
      chrome.downloads.download(
        { url, filename: folder + '/' + name, conflictAction: 'uniquify', saveAs: false },
        () => { void chrome.runtime.lastError; }   // nuốt lỗi lẻ (403/hotlink) để không chặn ảnh khác
      );
    });
    sendResponse({ ok: true, count: urls.length });
  }
  return true;
});
