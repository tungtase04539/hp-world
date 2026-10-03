// Song ngữ Việt - Anh
export let lang = 'vi';

// Chữ trong từ điển có thể chứa biến {N} {F}... (số địa danh/hoa thật của giai đoạn — quests.js đặt qua setVars).
// Trước đây số "15 địa danh", "tỉ lệ 1:10", "phóng đại 2,2 lần", "xe máy nhanh gấp 7 lần" viết cứng và đã sai.
const vars = {};
export function setVars(o) { Object.assign(vars, o); }
const fill = (s) => (typeof s === 'string' && s.includes('{') ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s);

const dict = {
  vi: {
    title: 'Hải Phòng 3D',
    subtitle: 'Thành phố Hoa Phượng Đỏ',
    intro: 'Dạo bộ, chạy xe máy giữa trung tâm Hải Phòng dựng 1:1 từ bản đồ thật: Nhà hát lớn, Quán hoa, chợ Sắt, nhà thờ lớn, ga, bưu điện, bờ sông Cấm và cầu Hoàng Văn Thụ.',
    start: '▶ Bắt đầu khám phá',
    ctlMove: 'Di chuyển', ctlRun: 'Chạy', ctlJump: 'Nhảy (đang lái: bấm còi)',
    ctlInteract: 'Tương tác / Lên & xuống xe',
    ctlCam: 'Kéo chuột (vuốt) xoay camera · lăn chuột (chụm 2 ngón) để zoom · Esc đóng bảng',
    quests: 'Nhiệm vụ',
    quality: 'Chất lượng đồ hoạ', qAuto: 'Tự động', qFull: 'Đầy đủ', qLite: 'Nhẹ',
    dlgNext: 'E / Chạm để tiếp tục ▸ · Esc bỏ qua',
    q1: 'Cánh phượng rơi', q1d: 'Nhặt {F} bông phượng phát sáng quanh trung tâm',
    q2: 'Hương vị đất Cảng', q2d: 'Nấu bánh đa cua cùng Cô Ba',
    q3: 'Nhà thám hiểm', q3d: 'Khám phá {N} địa danh trong khu trung tâm',
    qDone: 'Hoàn thành!',
    questComplete: '🎉 Hoàn thành nhiệm vụ',
    allComplete: '🏆 Bạn đã trở thành Người con của Thành phố Cảng!',
    discovered: '📍 Đã khám phá',
    pickedFlower: '🌺 Nhặt được hoa phượng',
    talkTo: 'Nói chuyện với',
    read: 'Xem thông tin',
    mount: 'Lên', dismount: 'Xuống',
    pressE: 'Nhấn', tapBtn: 'chạm ✦',
    vMotorbike: 'xe máy', vCyclo: 'xích lô', vBoat: 'thuyền',
    mgTitle: '🍜 Nấu Bánh Đa Cua',
    mgDesc: 'Chọn đúng 5 nguyên liệu làm nên bát bánh đa cua trứ danh Hải Phòng!',
    mgCook: '🔥 Nấu!',
    mgNeed5: 'Hãy chọn đúng 5 nguyên liệu nhé!',
    mgWin: '🎉 Tuyệt vời! Một bát bánh đa cua chuẩn vị Hải Phòng!',
    mgLose: '😅 Chưa đúng rồi! Nghĩ xem món này cần gì nhé...',
    rotateHint: 'Xoay ngang điện thoại để có trải nghiệm đẹp nhất nhé!',
    rotateDismiss: 'Vẫn chơi màn hình dọc',
    helpTitle: 'Hướng dẫn',
    helpBody: `<h4>Điều khiển</h4>
      <b>W A S D / phím mũi tên</b> — di chuyển · <b>Shift</b> — chạy · <b>Space</b> — nhảy (đang lái xe: bấm còi)<br>
      <b>E</b> — nói chuyện, xem địa danh, lên/xuống xe · <b>Esc</b> — đóng bảng/hội thoại<br>
      <b>Kéo chuột</b> — xoay camera · <b>Lăn chuột</b> — zoom · nút 🏍️ — gọi xe máy<br>
      Điện thoại: joystick bên trái (đẩy hết cỡ để chạy), ✦ tương tác, ⤒ nhảy, vuốt màn hình xoay camera, chụm 2 ngón để zoom.
      <h4>Thế giới — trung tâm Hải Phòng THẬT, tỉ lệ 1:1</h4>
      Mỗi mét trong game là một mét ngoài đời: đường phố, sông hồ và địa danh dựng từ dữ liệu bản đồ thật (OpenStreetMap),
      khối nhà theo footprint thật. Giai đoạn này mở <b>khu trung tâm bán kính ~1,6 km</b> quanh Nhà hát lớn: Quán hoa,
      tượng đài Lê Chân, hồ Tam Bạc, chợ Sắt, nhà thờ lớn, ga, bưu điện, bảo tàng, đền Nghè, bờ sông Cấm, cầu Hoàng Văn Thụ
      và cảng. Có <b>{N} địa danh</b> để khám phá — xem <b>bản đồ nhỏ</b>!
      <h4>Mẹo</h4>
      Đi bộ ~11 km/h, chạy ~25 km/h, xe máy tới ~58 km/h — đi xa thì gọi xe máy. Xe cộ chạy bên PHẢI như ngoài đời, nhớ
      nhìn trước khi qua đường. Thuyền đậu ở Bến Bính (sông Cấm). Hoa phượng phát sáng nằm dọc các phố trung tâm.
      Trời sẽ tối dần — ngắm hoàng hôn trên sông Cấm nhé!
      <p style="margin-top:10px;font-size:11px;color:#8fb8d8">Dữ liệu bản đồ © OpenStreetMap contributors (ODbL) ·
      footprint nhà: Overture Maps (OSM ODbL, Microsoft ML Buildings ODbL, Google Open Buildings CC BY 4.0)</p>`,
    time: 'Giờ',
  },
  en: {
    title: 'Hai Phong 3D',
    subtitle: 'City of Red Flamboyant Flowers',
    intro: 'Walk and ride a motorbike through downtown Hai Phong, built 1:1 from real map data: the Opera House, Flower Kiosks, Sat market, cathedral, station, post office, the Cam riverside and Hoang Van Thu bridge.',
    start: '▶ Start exploring',
    ctlMove: 'Move', ctlRun: 'Run', ctlJump: 'Jump (riding: horn)',
    ctlInteract: 'Interact / Mount & dismount',
    ctlCam: 'Drag (swipe) to rotate camera · scroll (pinch) to zoom · Esc closes panels',
    quests: 'Quests',
    quality: 'Graphics quality', qAuto: 'Auto', qFull: 'Full', qLite: 'Lite',
    dlgNext: 'E / Tap to continue ▸ · Esc to skip',
    q1: 'Falling Petals', q1d: 'Collect {F} glowing flamboyant flowers downtown',
    q2: 'Taste of the Port', q2d: 'Cook banh da cua with Ms. Ba',
    q3: 'The Explorer', q3d: 'Discover {N} downtown landmarks',
    qDone: 'Done!',
    questComplete: '🎉 Quest complete',
    allComplete: '🏆 You are now a true child of the Port City!',
    discovered: '📍 Discovered',
    pickedFlower: '🌺 Picked a flamboyant flower',
    talkTo: 'Talk to',
    read: 'View info',
    mount: 'Ride', dismount: 'Get off',
    pressE: 'Press', tapBtn: 'tap ✦',
    vMotorbike: 'motorbike', vCyclo: 'cyclo', vBoat: 'boat',
    mgTitle: '🍜 Cook Banh Da Cua',
    mgDesc: 'Pick the 5 correct ingredients of Hai Phong\'s famous crab noodle soup!',
    mgCook: '🔥 Cook!',
    mgNeed5: 'Please pick exactly 5 ingredients!',
    mgWin: '🎉 Perfect! A true Hai Phong banh da cua!',
    mgLose: '😅 Not quite! Think about what this dish really needs...',
    rotateHint: 'Rotate your phone to landscape for the best experience!',
    rotateDismiss: 'Keep playing in portrait',
    helpTitle: 'How to play',
    helpBody: `<h4>Controls</h4>
      <b>W A S D / arrow keys</b> — move · <b>Shift</b> — run · <b>Space</b> — jump (riding: horn)<br>
      <b>E</b> — talk, view landmarks, mount/dismount · <b>Esc</b> — close panels/dialogue<br>
      <b>Drag mouse</b> — rotate camera · <b>Scroll</b> — zoom · 🏍️ button — call a motorbike<br>
      On mobile: joystick on the left (push fully to run), ✦ to interact, ⤒ to jump, swipe to rotate, pinch to zoom.
      <h4>The world — REAL downtown Hai Phong at 1:1 scale</h4>
      One metre in the game is one metre in reality: streets, rivers, lakes and landmarks come from real map data
      (OpenStreetMap), buildings from real footprints. This stage opens <b>downtown within ~1.6 km</b> of the Opera House:
      Flower Kiosks, Le Chan monument, Tam Bac lake, Sat market, cathedral, station, post office, museum, Nghe temple,
      the Cam riverside, Hoang Van Thu bridge and the port. <b>{N} landmarks</b> to discover — check the <b>minimap</b>!
      <h4>Tips</h4>
      Walking ~11 km/h, running ~25 km/h, motorbike up to ~58 km/h — call a motorbike for longer trips. Traffic keeps to
      the RIGHT like in real Vietnam, so look before crossing. Boats wait at Ben Binh pier (Cam river). Glowing
      flamboyant flowers lie along downtown streets. Time passes — enjoy the sunset over the Cam river!
      <p style="margin-top:10px;font-size:11px;color:#8fb8d8">Map data © OpenStreetMap contributors (ODbL) ·
      building footprints: Overture Maps (OSM ODbL, Microsoft ML Buildings ODbL, Google Open Buildings CC BY 4.0)</p>`,
    time: 'Time',
  },
};

export function t(key) {
  return fill((dict[lang] && dict[lang][key]) ?? dict.vi[key] ?? key);
}

// Chọn bản dịch từ object {vi, en}
export function tx(obj) {
  if (!obj) return '';
  return fill(obj[lang] ?? obj.vi ?? '');
}

const listeners = [];
export function onLangChange(fn) { listeners.push(fn); }

export function setLang(l) {
  lang = l;
  document.documentElement.lang = l;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    el.innerHTML = t(key);
  });
  listeners.forEach((fn) => fn(l));
}
