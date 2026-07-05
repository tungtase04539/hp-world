import { WAYPOINTS } from './coords.js';

const $ = (id) => document.getElementById(id);
const logEl = $('log');
const panel = $('panel');
let stopFlag = false;

$('wpcount').textContent = `${WAYPOINTS.length} tọa độ dải trung tâm (bám đường thật OSM)`;

function log(msg) {
  const t = new Date().toLocaleTimeString();
  logEl.textContent = `[${t}] ${msg}\n` + logEl.textContent;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const send = (m) => new Promise((res) => chrome.runtime.sendMessage(m, res));

// khôi phục key đã lưu
chrome.storage.local.get(['svKey', 'svCfg'], (d) => {
  if (d.svKey) $('key').value = d.svKey;
  if (d.svCfg) { for (const k in d.svCfg) if ($(k)) $(k).value = d.svCfg[k]; }
});

function loadMapsApi(key) {
  return new Promise((resolve, reject) => {
    if (window.google && window.google.maps) return resolve();
    window.__svinit = () => resolve();
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&callback=__svinit`;
    s.onerror = () => reject(new Error('Không tải được Maps API — kiểm tra key / mạng'));
    document.head.appendChild(s);
  });
}

function getPanoramaAsync(sv, req) {
  return new Promise((resolve, reject) => {
    sv.getPanorama(req, (data, status) => {
      if (status === 'OK') resolve(data); else reject(status);
    });
  });
}

// đợi panorama đổi sang pano mới (tile bắt đầu tải)
function waitPano(pano, wantId, timeout = 4000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (done) return; done = true; resolve(); };
    const l = pano.addListener('pano_changed', () => { if (pano.getPano() === wantId) { google.maps.event.removeListener(l); finish(); } });
    setTimeout(() => { google.maps.event.removeListener(l); finish(); }, timeout);
  });
}

async function captureOne(filename) {
  // ẩn bảng điều khiển để không lọt vào ảnh, chờ repaint rồi chụp
  panel.style.visibility = 'hidden';
  await sleep(80);
  const res = await send({ type: 'capture', filename });
  panel.style.visibility = 'visible';
  return res;
}

let panoObj = null, svService = null;

async function run() {
  stopFlag = false;
  const key = $('key').value.trim();
  if (!key) { log('⚠ Chưa nhập API key.'); return; }
  const nHeading = Math.max(4, Math.min(24, +$('nheading').value || 8));
  const pitches = ($('pitches').value || '0').split(',').map((s) => +s.trim()).filter((v) => !isNaN(v));
  const tileWait = +$('tilewait').value || 1300;
  const gap = +$('gap').value || 550;
  const radius = +$('radius').value || 70;
  chrome.storage.local.set({ svKey: key, svCfg: { nheading: nHeading, pitches: $('pitches').value, tilewait: tileWait, gap, radius } });

  $('start').style.display = 'none';
  $('stop').style.display = 'block';
  const headings = Array.from({ length: nHeading }, (_, i) => Math.round((360 / nHeading) * i));

  try {
    log('Đang tải Google Maps API…');
    await loadMapsApi(key);
    svService = new google.maps.StreetViewService();
    panoObj = new google.maps.StreetViewPanorama($('pano'), {
      pov: { heading: 0, pitch: 0 }, zoom: 1, motionTracking: false, showRoadLabels: false,
      disableDefaultUI: true, addressControl: false, linksControl: false, panControl: false,
      zoomControl: false, fullscreenControl: false, clickToGo: false, scrollwheel: false,
    });
    log('Sẵn sàng. Bắt đầu quét ' + WAYPOINTS.length + ' tọa độ…');
  } catch (e) {
    log('❌ ' + e.message); reset(); return;
  }

  const manifest = [];
  let covered = 0, shots = 0, checked = 0;
  const seenPano = new Set();

  for (let i = 0; i < WAYPOINTS.length && !stopFlag; i++) {
    const wp = WAYPOINTS[i];
    checked++;
    let data;
    try {
      data = await getPanoramaAsync(svService, { location: wp, radius, source: 'outdoor', preference: 'nearest' });
    } catch (status) {
      continue; // ZERO_RESULTS: không có Street View ở điểm này → bỏ qua
    }
    const panoId = data.location.pano;
    if (seenPano.has(panoId)) continue; // tránh chụp trùng cùng 1 pano từ 2 điểm gần nhau
    seenPano.add(panoId);
    covered++;
    const pos = data.location.latLng;
    panoObj.setPano(panoId);
    await waitPano(panoObj, panoId);
    await sleep(tileWait);

    for (const pitch of pitches) {
      for (const heading of headings) {
        if (stopFlag) break;
        panoObj.setPov({ heading, pitch });
        await sleep(tileWait);
        const file = `pano_${String(covered).padStart(3, '0')}_h${String(heading).padStart(3, '0')}_p${pitch}.jpg`;
        const res = await captureOne(file);
        if (res && res.ok) {
          shots++;
          manifest.push({
            file, reqLat: wp.lat, reqLng: wp.lng, panoId,
            panoLat: +pos.lat().toFixed(7), panoLng: +pos.lng().toFixed(7),
            heading, pitch, zoom: 1,
            date: (data.imageDate || ''), copyright: (data.copyright || ''),
          });
        } else {
          log('⚠ chụp lỗi ' + file + ' — ' + (res && res.error));
        }
        await sleep(gap);
      }
    }
    log(`✓ pano #${covered} (điểm ${i + 1}/${WAYPOINTS.length}) — đã chụp ${shots} ảnh`);
    // lưu manifest tạm mỗi 10 pano để không mất dữ liệu
    if (covered % 10 === 0) await send({ type: 'saveText', filename: 'manifest.json', text: JSON.stringify(manifest, null, 2) });
  }

  await send({ type: 'saveText', filename: 'manifest.json', text: JSON.stringify(manifest, null, 2) });
  log(`🏁 XONG. Đã quét ${checked} điểm, tìm thấy ${covered} pano, chụp ${shots} ảnh. Xem Downloads/hp-streetview/.`);
  reset();
}

function reset() {
  $('start').style.display = 'block';
  $('stop').style.display = 'none';
}

$('start').addEventListener('click', run);
$('stop').addEventListener('click', () => { stopFlag = true; log('■ Đang dừng…'); });
