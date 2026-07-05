// MAIN world — CÁCH B: điều hướng thẳng URL instantstreetview.com cho từng (pano × góc)
// rồi chụp CHÍNH ảnh trang đang hiển thị (không tạo panorama riêng → hết màn đen).
// Trạng thái lưu qua mỗi lần reload nhờ bridge.js (chrome.storage).
(function () {
  if (window.__hpCapLoaded) return; window.__hpCapLoaded = true;
  const WAYPOINTS = window.HP_WAYPOINTS || [];

  // ---- cầu nối tới bridge.js (ISOLATED) — có kèm timeout để không treo nếu bridge chưa sẵn ----
  let msgId = 0; const pending = {};
  function bridge(type, payload, timeout = 20000) {
    return new Promise((resolve) => {
      const id = ++msgId; pending[id] = resolve;
      window.postMessage({ source: 'hp-cap-req', id, type, payload }, '*');
      setTimeout(() => { if (pending[id]) { delete pending[id]; resolve({ ok: false, timeout: true }); } }, timeout);
    });
  }
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.source !== 'hp-cap-res') return;
    const p = pending[e.data.id]; if (p) { p(e.data.result); delete pending[e.data.id]; }
  });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---- UI panel (góc trên-PHẢI để không đè ô tìm kiếm của trang) ----
  const panel = document.createElement('div');
  panel.id = 'hp-cap-panel';
  panel.innerHTML = `
    <style>
      #hp-cap-panel{position:fixed;top:12px;right:12px;z-index:2147483647;width:310px;max-height:94vh;overflow:auto;
        background:rgba(18,22,26,.96);color:#eef;border-radius:12px;padding:13px 15px;font:13px/1.5 system-ui,Arial;box-shadow:0 6px 24px rgba(0,0,0,.55)}
      #hp-cap-panel h1{font-size:15px;margin:0 0 6px}
      #hp-cap-panel label{display:block;margin:7px 0 2px;color:#9fb3c8}
      #hp-cap-panel input{width:100%;box-sizing:border-box;padding:6px 8px;border-radius:7px;border:1px solid #3a4653;background:#0e1418;color:#eef}
      #hp-cap-panel .row{display:flex;gap:8px}#hp-cap-panel .row>div{flex:1}
      #hp-cap-panel button{margin-top:10px;width:100%;padding:9px;border:0;border-radius:8px;font-weight:600;cursor:pointer}
      #hp-cap-start{background:#2e9c56;color:#fff}#hp-cap-stop{background:#b5423a;color:#fff}
      #hp-cap-log{margin-top:9px;font:11px/1.45 ui-monospace,monospace;white-space:pre-wrap;max-height:34vh;overflow:auto;background:#0b0f13;padding:8px;border-radius:7px;color:#bfe}
      #hp-cap-panel .muted{color:#7f93a8}
    </style>
    <h1>🌺 Chụp Street View — Dải trung tâm HP</h1>
    <div class="muted" id="hp-wp"></div>
    <div class="row">
      <div><label>Số góc / vòng</label><input id="hp-nh" type="number" min="4" max="24" value="8"></div>
      <div><label>Pitch (°, cách ,)</label><input id="hp-pit" value="0"></div>
    </div>
    <div class="row">
      <div><label>Chờ tải trang (ms)</label><input id="hp-lw" type="number" value="3500"></div>
      <div><label>Bán kính pano (m)</label><input id="hp-rad" type="number" value="70"></div>
    </div>
    <button id="hp-cap-start">▶ Bắt đầu chụp</button>
    <button id="hp-cap-stop" style="display:none">■ Dừng</button>
    <div id="hp-cap-log"></div>
    <div class="muted" style="margin-top:8px">Cách B: mỗi góc trang sẽ tự nhảy URL & tải lại rồi chụp. <b>Đừng chuyển tab.</b> Ảnh → <b>Downloads/hp-streetview/</b>.</div>`;
  const mount = () => document.body.appendChild(panel);
  if (document.body) mount(); else window.addEventListener('DOMContentLoaded', mount);
  const $ = (id) => panel.querySelector('#' + id);
  const logEl = () => $('hp-cap-log');
  function log(m) { const t = new Date().toLocaleTimeString(); if (logEl()) logEl().textContent = `[${t}] ${m}\n` + logEl().textContent; }
  $('hp-wp').textContent = `${WAYPOINTS.length} tọa độ (bám đường thật OSM)`;

  let stopFlag = false;
  const urlFor = (j) => `https://www.instantstreetview.com/@${j.lat},${j.lng},${j.heading}h,${j.pitch}p,0z,${j.panoId}`;

  async function waitMaps(timeout = 20000) {
    const t0 = Date.now();
    while (!(window.google && google.maps && google.maps.StreetViewService)) {
      if (Date.now() - t0 > timeout) return false; await sleep(300);
    }
    return true;
  }
  const getPano = (svc, req) => new Promise((res, rej) => svc.getPanorama(req, (d, s) => (s === 'OK' ? res(d) : rej(s))));

  // ---------- PHA 1: dò các pano có Street View rồi bắt đầu ----------
  async function startRun() {
    stopFlag = false;
    $('hp-cap-start').style.display = 'none'; $('hp-cap-stop').style.display = 'block';
    const nH = Math.max(4, Math.min(24, +$('hp-nh').value || 8));
    const pitches = ($('hp-pit').value || '0').split(',').map((s) => +s.trim()).filter((v) => !isNaN(v));
    const loadWait = +$('hp-lw').value || 3500, radius = +$('hp-rad').value || 70;
    const headings = Array.from({ length: nH }, (_, i) => Math.round((360 / nH) * i));

    log('Đang dò vùng có Street View (StreetViewService)…');
    if (!await waitMaps()) { log('❌ Trang chưa nạp Google Maps — chờ ảnh street view hiện rồi bấm lại.'); reset(); return; }
    const svc = new google.maps.StreetViewService();
    const seen = new Set(); const panos = [];
    for (let i = 0; i < WAYPOINTS.length && !stopFlag; i++) {
      let d; try { d = await getPano(svc, { location: WAYPOINTS[i], radius, source: 'outdoor', preference: 'nearest' }); } catch (e) { continue; }
      const id = d.location.pano; if (seen.has(id)) continue; seen.add(id);
      panos.push({ panoId: id, lat: +d.location.latLng.lat().toFixed(7), lng: +d.location.latLng.lng().toFixed(7),
        reqLat: WAYPOINTS[i].lat, reqLng: WAYPOINTS[i].lng, date: d.imageDate || '', copyright: d.copyright || '' });
      if (i % 50 === 0) log(`…dò ${i}/${WAYPOINTS.length}, thấy ${panos.length} pano`);
    }
    if (stopFlag) { reset(); return; }
    if (!panos.length) { log('⚠ Không thấy Street View nào ở dải trung tâm (Hải Phòng có thể chưa phủ).'); reset(); return; }

    const jobs = [];
    panos.forEach((p, pi) => { for (const pitch of pitches) for (const heading of headings) {
      jobs.push({ panoId: p.panoId, lat: p.lat, lng: p.lng, reqLat: p.reqLat, reqLng: p.reqLng, heading, pitch,
        date: p.date, copyright: p.copyright, file: `pano_${String(pi + 1).padStart(3, '0')}_h${String(heading).padStart(3, '0')}_p${pitch}.jpg` });
    } });
    const state = { active: true, idx: 0, total: jobs.length, nPano: panos.length, loadWait, jobs, manifest: [] };
    await bridge('setState', { state });
    log(`Tìm thấy ${panos.length} pano → ${jobs.length} ảnh. Bắt đầu (điều hướng URL)…`);
    await sleep(400);
    location.href = urlFor(jobs[0]);   // rời trang → content script sẽ tự chạy PHA 2 sau khi tải lại
  }

  // ---------- PHA 2: mỗi lần tải lại, trang đang ở view của jobs[idx] → chụp rồi sang cái kế ----------
  async function continueRun(state) {
    $('hp-cap-start').style.display = 'none'; $('hp-cap-stop').style.display = 'block';
    const job = state.jobs[state.idx];
    log(`Đang tải view ${state.idx + 1}/${state.total} (chờ ${state.loadWait}ms)…`);
    await sleep(state.loadWait || 3500);
    if (stopFlag) return;
    panel.style.visibility = 'hidden'; await sleep(90);
    const res = await bridge('capture', { filename: job.file });
    panel.style.visibility = 'visible';
    if (res && res.ok) {
      state.manifest.push({ file: job.file, reqLat: job.reqLat, reqLng: job.reqLng, panoId: job.panoId,
        panoLat: job.lat, panoLng: job.lng, heading: job.heading, pitch: job.pitch, zoom: 0, date: job.date, copyright: job.copyright });
      log(`✓ ${state.idx + 1}/${state.total} ${job.file}`);
    } else { log(`⚠ lỗi chụp ${job.file} — ${res && (res.error || (res.timeout && 'timeout'))}`); }

    state.idx++;
    if (state.idx % 10 === 0 || state.idx >= state.total) {
      await bridge('saveText', { filename: 'manifest.json', text: JSON.stringify(state.manifest, null, 2) });
    }
    if (state.idx >= state.total) {
      await bridge('clearState');
      log(`🏁 XONG. ${state.manifest.length} ảnh từ ${state.nPano} pano → Downloads/hp-streetview/.`);
      $('hp-cap-start').style.display = 'block'; $('hp-cap-stop').style.display = 'none';
      return;
    }
    await bridge('setState', { state });
    await sleep(250);
    location.href = urlFor(state.jobs[state.idx]);
  }

  function reset() { $('hp-cap-start').style.display = 'block'; $('hp-cap-stop').style.display = 'none'; }

  $('hp-cap-start').addEventListener('click', startRun);
  $('hp-cap-stop').addEventListener('click', async () => {
    stopFlag = true; log('■ Dừng — lưu manifest…');
    const r = await bridge('getState');
    if (r && r.state) { await bridge('saveText', { filename: 'manifest.json', text: JSON.stringify(r.state.manifest || [], null, 2) }); await bridge('clearState'); }
    reset();
  });

  // Khi trang tải: nếu đang có phiên chụp dở → tự chạy PHA 2 (không cần bấm lại)
  (async () => {
    let r;
    for (let k = 0; k < 12; k++) { r = await bridge('getState', null, 1500); if (r && !r.timeout) break; await sleep(300); }
    if (r && r.state && r.state.active) continueRun(r.state);
  })();
})();
