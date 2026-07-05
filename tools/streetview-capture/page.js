// MAIN world — chạy trên instantstreetview.com, TÁI DÙNG Google Maps mà trang đã nạp
// (không cần API key riêng). Tạo 1 panorama phủ toàn trang, tự lái xoay 360° từng tọa độ,
// nhờ bridge.js (ISOLATED) gọi chrome.tabs.captureVisibleTab để chụp.
(function () {
  if (window.__hpCapLoaded) return; window.__hpCapLoaded = true;
  const WAYPOINTS = window.HP_WAYPOINTS || [];

  // ---- cầu nối tới bridge.js (ISOLATED) ----
  let msgId = 0; const pending = {};
  function bridge(type, payload) {
    return new Promise((resolve) => { const id = ++msgId; pending[id] = resolve; window.postMessage({ source: 'hp-cap-req', id, type, payload }, '*'); });
  }
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.source !== 'hp-cap-res') return;
    const p = pending[e.data.id]; if (p) { p(e.data.result); delete pending[e.data.id]; }
  });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---- UI panel ----
  const panel = document.createElement('div');
  panel.id = 'hp-cap-panel';
  panel.innerHTML = `
    <style>
      #hp-cap-panel{position:fixed;top:12px;left:12px;z-index:2147483647;width:310px;max-height:94vh;overflow:auto;
        background:rgba(18,22,26,.95);color:#eef;border-radius:12px;padding:13px 15px;font:13px/1.5 system-ui,Arial;box-shadow:0 6px 24px rgba(0,0,0,.55)}
      #hp-cap-panel h1{font-size:15px;margin:0 0 6px}
      #hp-cap-panel label{display:block;margin:7px 0 2px;color:#9fb3c8}
      #hp-cap-panel input{width:100%;box-sizing:border-box;padding:6px 8px;border-radius:7px;border:1px solid #3a4653;background:#0e1418;color:#eef}
      #hp-cap-panel .row{display:flex;gap:8px}#hp-cap-panel .row>div{flex:1}
      #hp-cap-panel button{margin-top:10px;width:100%;padding:9px;border:0;border-radius:8px;font-weight:600;cursor:pointer}
      #hp-cap-start{background:#2e9c56;color:#fff}#hp-cap-stop{background:#b5423a;color:#fff}
      #hp-cap-log{margin-top:9px;font:11px/1.45 ui-monospace,monospace;white-space:pre-wrap;max-height:32vh;overflow:auto;background:#0b0f13;padding:8px;border-radius:7px;color:#bfe}
      #hp-cap-panel .muted{color:#7f93a8}
    </style>
    <h1>🌺 Chụp Street View — Dải trung tâm HP</h1>
    <div class="muted" id="hp-wp"></div>
    <div class="row">
      <div><label>Số góc / vòng</label><input id="hp-nh" type="number" min="4" max="24" value="8"></div>
      <div><label>Pitch (°, cách ,)</label><input id="hp-pit" value="0"></div>
    </div>
    <div class="row">
      <div><label>Chờ tile (ms)</label><input id="hp-tw" type="number" value="1300"></div>
      <div><label>Nghỉ/ảnh (ms)</label><input id="hp-gap" type="number" value="550"></div>
    </div>
    <label>Bán kính tìm pano (m)</label><input id="hp-rad" type="number" value="70">
    <button id="hp-cap-start">▶ Bắt đầu chụp</button>
    <button id="hp-cap-stop" style="display:none">■ Dừng</button>
    <div id="hp-cap-log"></div>
    <div class="muted" style="margin-top:8px">Ảnh → <b>Downloads/hp-streetview/</b> + <b>manifest.json</b>. Đừng chuyển tab khi đang chụp.</div>`;
  const mount = () => { document.body.appendChild(panel); };
  if (document.body) mount(); else window.addEventListener('DOMContentLoaded', mount);

  const $ = (id) => panel.querySelector('#' + id);
  const logEl = () => $('hp-cap-log');
  function log(m) { const t = new Date().toLocaleTimeString(); logEl().textContent = `[${t}] ${m}\n` + logEl().textContent; }
  $('hp-wp').textContent = `${WAYPOINTS.length} tọa độ (bám đường thật OSM)`;

  // panorama phủ toàn trang (che panorama của site)
  let capDiv, pano, svc, stopFlag = false, running = false;
  function ensurePano() {
    if (pano) return true;
    if (!(window.google && google.maps && google.maps.StreetViewPanorama)) return false;
    capDiv = document.createElement('div');
    capDiv.id = 'hp-cap-pano';
    capDiv.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#111';
    document.body.appendChild(capDiv);
    pano = new google.maps.StreetViewPanorama(capDiv, {
      pov: { heading: 0, pitch: 0 }, zoom: 1, visible: true, motionTracking: false, showRoadLabels: false,
      disableDefaultUI: true, addressControl: false, linksControl: false, panControl: false,
      zoomControl: false, fullscreenControl: false, clickToGo: false, scrollwheel: false,
    });
    svc = new google.maps.StreetViewService();
    // đảm bảo panel nổi trên panorama
    panel.style.zIndex = '2147483647';
    log('pano API: ' + ['setPano', 'setPov', 'setPosition', 'setOptions'].map((m) => m + '=' + typeof pano[m]).join(' '));
    return true;
  }
  // vài bản Maps JS (instantstreetview) không expose setPano/setPov trực tiếp → fallback setPosition/setOptions
  function setPanoId(id, latLng) {
    if (typeof pano.setPano === 'function') pano.setPano(id);
    else if (latLng && typeof pano.setPosition === 'function') pano.setPosition(latLng);
    else pano.setOptions({ pano: id });
  }
  function setPovSafe(pov) { if (typeof pano.setPov === 'function') pano.setPov(pov); else pano.setOptions({ pov }); }

  const getPano = (req) => new Promise((res, rej) => svc.getPanorama(req, (d, s) => (s === 'OK' ? res(d) : rej(s))));
  function waitPano(wantId, timeout = 4000) {
    return new Promise((resolve) => {
      let done = false; const fin = () => { if (!done) { done = true; resolve(); } };
      const l = pano.addListener('pano_changed', () => { if (pano.getPano() === wantId) { google.maps.event.removeListener(l); fin(); } });
      setTimeout(() => { google.maps.event.removeListener(l); fin(); }, timeout);
    });
  }
  async function capture(filename) {
    panel.style.visibility = 'hidden'; await sleep(80);
    const res = await bridge('capture', { filename });
    panel.style.visibility = 'visible';
    return res;
  }

  async function run() {
    if (running) return;
    if (!ensurePano()) { log('❌ Trang chưa nạp xong Google Maps — chờ vài giây rồi bấm lại.'); return; }
    running = true; stopFlag = false;
    $('hp-cap-start').style.display = 'none'; $('hp-cap-stop').style.display = 'block';
    const nH = Math.max(4, Math.min(24, +$('hp-nh').value || 8));
    const pitches = ($('hp-pit').value || '0').split(',').map((s) => +s.trim()).filter((v) => !isNaN(v));
    const tileWait = +$('hp-tw').value || 1300, gap = +$('hp-gap').value || 550, radius = +$('hp-rad').value || 70;
    const headings = Array.from({ length: nH }, (_, i) => Math.round((360 / nH) * i));
    const manifest = []; let covered = 0, shots = 0; const seen = new Set();
    log(`Bắt đầu quét ${WAYPOINTS.length} tọa độ…`);

    for (let i = 0; i < WAYPOINTS.length && !stopFlag; i++) {
      const wp = WAYPOINTS[i];
      let data;
      try { data = await getPano({ location: wp, radius, source: 'outdoor', preference: 'nearest' }); }
      catch (s) { continue; } // không có Street View ở điểm này
      const panoId = data.location.pano;
      if (seen.has(panoId)) continue; seen.add(panoId); covered++;
      const pos = data.location.latLng;
      setPanoId(panoId, pos); await waitPano(panoId); await sleep(tileWait);
      for (const pitch of pitches) {
        for (const heading of headings) {
          if (stopFlag) break;
          setPovSafe({ heading, pitch }); await sleep(tileWait);
          const file = `pano_${String(covered).padStart(3, '0')}_h${String(heading).padStart(3, '0')}_p${pitch}.jpg`;
          const res = await capture(file);
          if (res && res.ok) {
            shots++;
            manifest.push({ file, reqLat: wp.lat, reqLng: wp.lng, panoId,
              panoLat: +pos.lat().toFixed(7), panoLng: +pos.lng().toFixed(7), heading, pitch, zoom: 1,
              date: data.imageDate || '', copyright: data.copyright || '' });
          } else { log('⚠ lỗi chụp ' + file + ' — ' + (res && res.error)); }
          await sleep(gap);
        }
      }
      log(`✓ pano #${covered} (điểm ${i + 1}/${WAYPOINTS.length}) — ${shots} ảnh`);
      if (covered % 10 === 0) await bridge('saveText', { filename: 'manifest.json', text: JSON.stringify(manifest, null, 2) });
    }
    await bridge('saveText', { filename: 'manifest.json', text: JSON.stringify(manifest, null, 2) });
    log(`🏁 XONG. ${covered} pano, ${shots} ảnh → Downloads/hp-streetview/.`);
    running = false; $('hp-cap-start').style.display = 'block'; $('hp-cap-stop').style.display = 'none';
  }

  $('hp-cap-start').addEventListener('click', run);
  $('hp-cap-stop').addEventListener('click', () => { stopFlag = true; log('■ Đang dừng…'); });
})();
