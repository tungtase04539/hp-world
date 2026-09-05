// Song ngữ Việt - Anh
export let lang = 'vi';

const dict = {
  vi: {
    title: 'Hải Phòng 3D',
    subtitle: 'Thành phố Hoa Phượng Đỏ',
    intro: 'Nhập vai một du khách trẻ khám phá thành phố Cảng: dạo trung tâm, qua cầu Hoàng Văn Thụ, tắm biển Đồ Sơn và giong thuyền ra Cát Bà!',
    start: '▶ Bắt đầu khám phá',
    ctlMove: 'Di chuyển', ctlRun: 'Chạy', ctlJump: 'Nhảy',
    ctlInteract: 'Tương tác / Lên & xuống xe',
    ctlCam: 'Kéo chuột xoay camera, lăn để zoom',
    quests: 'Nhiệm vụ',
    quality: 'Chất lượng đồ hoạ', qAuto: 'Tự động', qFull: 'Đầy đủ', qLite: 'Nhẹ',
    dlgNext: 'E / Chạm để tiếp tục ▸',
    q1: 'Cánh phượng rơi', q1d: 'Nhặt hoa phượng phát sáng',
    q2: 'Hương vị đất Cảng', q2d: 'Nấu bánh đa cua cùng Cô Ba',
    q3: 'Nhà thám hiểm', q3d: 'Khám phá 15 địa danh',
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
      <b>W A S D / phím mũi tên</b> — di chuyển · <b>Shift</b> — chạy · <b>Space</b> — nhảy<br>
      <b>E</b> — nói chuyện, xem địa danh, lên/xuống xe · <b>Kéo chuột</b> — xoay camera · <b>Lăn chuột</b> — zoom<br>
      Trên điện thoại: joystick bên trái, nút ✦ để tương tác, ⤒ để nhảy.
      <h4>Thế giới — bản đồ Hải Phòng THẬT</h4>
      Địa hình, sông Cấm, bờ biển, đảo và <b>từng con phố trung tâm</b> dựng từ dữ liệu bản đồ thực (OpenStreetMap), tỉ lệ 1:10, khu trung tâm phóng đại 2,2 lần cho dễ dạo chơi. Trung tâm có Nhà hát lớn, Quán hoa, tượng đài Lê Chân, hồ Tam Bạc, chợ Sắt, nhà thờ, ga, bưu điện, bảo tàng. Phía bắc là sông Cấm với cầu Hoàng Văn Thụ, cầu Bính và cảng. Về nam là biển Đồ Sơn, biệt thự Bảo Đại, đảo Hòn Dấu. Ngoài khơi đông nam là Cát Bà — vịnh Lan Hạ. 15 địa danh, xem <b>bản đồ nhỏ</b>!
      <h4>Mẹo</h4>
      Xe máy nhanh gấp 7 lần đi bộ — hãy lấy xe khi đi xa. Thuyền đậu ở Bến Bính (sông Cấm) và Bến Nghiêng (Đồ Sơn). Hoa phượng phát sáng nằm quanh dải trung tâm. Trời sẽ tối dần — ngắm hoàng hôn trên sông Cấm nhé!
      <p style="margin-top:10px;font-size:11px;color:#8fb8d8">Dữ liệu bản đồ © OpenStreetMap contributors (ODbL)</p>`,
    time: 'Giờ',
  },
  en: {
    title: 'Hai Phong 3D',
    subtitle: 'City of Red Flamboyant Flowers',
    intro: 'Play as a young tourist exploring the Port City: stroll downtown, cross Hoang Van Thu bridge, swim at Do Son beach and sail to Cat Ba island!',
    start: '▶ Start exploring',
    ctlMove: 'Move', ctlRun: 'Run', ctlJump: 'Jump',
    ctlInteract: 'Interact / Mount & dismount',
    ctlCam: 'Drag mouse to rotate camera, scroll to zoom',
    quests: 'Quests',
    quality: 'Graphics quality', qAuto: 'Auto', qFull: 'Full', qLite: 'Lite',
    dlgNext: 'E / Tap to continue ▸',
    q1: 'Falling Petals', q1d: 'Collect glowing flamboyant flowers',
    q2: 'Taste of the Port', q2d: 'Cook banh da cua with Ms. Ba',
    q3: 'The Explorer', q3d: 'Discover 15 landmarks',
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
      <b>W A S D / arrow keys</b> — move · <b>Shift</b> — run · <b>Space</b> — jump<br>
      <b>E</b> — talk, view landmarks, mount/dismount · <b>Drag mouse</b> — rotate camera · <b>Scroll</b> — zoom<br>
      On mobile: joystick on the left, ✦ to interact, ⤒ to jump.
      <h4>The world — the REAL Hai Phong map</h4>
      Terrain, the Cam river, coastline, islands and <b>every downtown street</b> are built from real map data (OpenStreetMap) at 1:10 scale, with downtown magnified 2.2× for walkability. Downtown: Opera House, Flower Kiosks, Le Chan monument, Tam Bac lake, Sat market, cathedral, station, post office, museum. North: the Cam river with two great bridges and the port. South: Do Son beach, Bao Dai villa, Hon Dau island. Southeast across the sea lies Cat Ba — Lan Ha bay. 15 landmarks — check the <b>minimap</b>!
      <h4>Tips</h4>
      The motorbike is 7× walking speed — grab it for long trips. Boats wait at Ben Binh (Cam river) and Ben Nghieng (Do Son). Glowing flamboyant flowers hide around the central strip. Time passes — enjoy the sunset over the Cam river!
      <p style="margin-top:10px;font-size:11px;color:#8fb8d8">Map data © OpenStreetMap contributors (ODbL)</p>`,
    time: 'Time',
  },
};

export function t(key) {
  return (dict[lang] && dict[lang][key]) ?? dict.vi[key] ?? key;
}

// Chọn bản dịch từ object {vi, en}
export function tx(obj) {
  if (!obj) return '';
  return obj[lang] ?? obj.vi ?? '';
}

const listeners = [];
export function onLangChange(fn) { listeners.push(fn); }

export function setLang(l) {
  lang = l;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    el.innerHTML = t(key);
  });
  listeners.forEach((fn) => fn(l));
}
