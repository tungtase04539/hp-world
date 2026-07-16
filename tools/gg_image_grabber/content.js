// Cầu nối cho Claude (điều khiển trang qua JS) + nút cho người dùng.
// Trích URL ẢNH GỐC (từ /imgres?imgurl=...) rồi nhờ background chrome.downloads tải.
(function () {
  if (window.__hpGrabInstalled) return;
  window.__hpGrabInstalled = true;

  function extractUrls() {
    const set = new Set();
    // 1) Chuẩn: mỗi kết quả có <a href="/imgres?imgurl=<URL_GỐC>&...">
    document.querySelectorAll('a[href*="imgurl="]').forEach((a) => {
      const m = a.href.match(/[?&]imgurl=([^&]+)/);
      if (m) { try { const u = decodeURIComponent(m[1]); if (/^https?:\/\//.test(u)) set.add(u); } catch (e) {} }
    });
    // 2) Dự phòng: quét HTML tìm URL ảnh (bỏ thumbnail google)
    if (set.size < 3) {
      const bad = /gstatic|\/\/www\.google|ggpht|googleusercontent|encrypted|favicon|sprite|logo/i;
      (document.documentElement.innerHTML.match(/https?:\/\/[^"'\\ )]+?\.(?:jpg|jpeg|png|webp|JPG|JPEG|PNG)/g) || [])
        .forEach((u) => { u = u.replace(/\\u003d/g, '=').replace(/\\/g, ''); if (!bad.test(u)) set.add(u); });
    }
    return [...set];
  }

  function folderFromQuery(f) {
    if (f) return f.startsWith('hp_landmark/') ? f : 'hp_landmark/' + f;
    const q = (new URLSearchParams(location.search).get('q') || 'images');
    return 'hp_landmark/' + q.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '').slice(0, 40);
  }

  function grab(urlsIn, folderIn, cb) {
    const urls = (urlsIn && urlsIn.length) ? urlsIn : extractUrls();
    const folder = folderFromQuery(folderIn);
    chrome.runtime.sendMessage({ type: 'hp_download', urls, folder }, () => {
      void chrome.runtime.lastError;
      if (cb) cb(urls.length, folder);
    });
    return { count: urls.length, folder };
  }

  // ---- CẦU NỐI CHO CLAUDE: window.postMessage({type:'HP_GRAB', urls?, folder?}) ----
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.type !== 'HP_GRAB') return;
    const r = grab(e.data.urls, e.data.folder, (count, folder) => {
      window.postMessage({ type: 'HP_GRAB_RESULT', count, folder }, '*');
    });
    // phản hồi sớm số URL trích được (để Claude biết ngay)
    window.postMessage({ type: 'HP_GRAB_ACK', count: r.count, folder: r.folder }, '*');
  });

  // ---- NÚT CHO NGƯỜI DÙNG (tuỳ chọn) ----
  const btn = document.createElement('button');
  btn.id = 'hp-grab-btn';
  btn.textContent = '⬇ Tải ảnh gốc (HP)';
  Object.assign(btn.style, {
    position: 'fixed', top: '90px', right: '20px', zIndex: 999999,
    padding: '10px 14px', background: '#c0392b', color: '#fff', border: 'none',
    borderRadius: '8px', fontSize: '14px', fontWeight: '600', cursor: 'pointer',
    boxShadow: '0 2px 10px rgba(0,0,0,.35)', fontFamily: 'sans-serif'
  });
  btn.addEventListener('click', () => {
    const r = grab(null, null);
    btn.textContent = r.count ? `✓ ${r.count} ảnh → Downloads/${r.folder}` : '✗ Không thấy ảnh — cuộn rồi bấm lại';
    setTimeout(() => { btn.textContent = '⬇ Tải ảnh gốc (HP)'; }, 6000);
  });
  document.body.appendChild(btn);
})();
