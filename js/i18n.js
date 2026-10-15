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
    // ---- MP-2 C1: màn tiêu đề online, trạng thái mạng, chat (js/net/net.js, js/ui/chat.js) ----
    mpNickPh: 'Biệt danh (3–16 ký tự, gõ có dấu được)',
    mpInvitePh: 'Mã mời (XXXXX-XXXXX)',
    mpEnter: '🌆 Vào thành phố',
    mpSolo: '🚶 Chơi một mình',
    mpHello: 'Xin chào, <b>{NAME}</b>!',
    mpHaveCode: 'Có mã khôi phục?',
    mpRecoverPh: 'Mã khôi phục 12 ký tự',
    mpRecoverBtn: 'Lấy lại tài khoản',
    mpRecovered: '✓ Đã lấy lại tài khoản {NAME}',
    mpServer: 'Máy chủ: {HOST}',
    mpCodeTitle: '🔑 Mã khôi phục của bạn',
    mpCodeBody: 'Đây là chìa khoá tài khoản <b>{NAME}</b>. Hãy chép lại và cất kỹ — mã chỉ hiện <b>MỘT LẦN DUY NHẤT</b>. Dùng mã này để vào lại tài khoản trên máy khác hoặc sau khi xoá dữ liệu trình duyệt. Đừng đưa mã cho bất kỳ ai.',
    mpCopy: '📋 Sao chép', mpCopied: '✓ Đã chép',
    mpCodeOk: 'Tôi đã lưu mã — vào thành phố',
    mpWorking: '⏳ Đang kết nối máy chủ…',
    mpNeedNick: 'Hãy nhập biệt danh.',
    mpStOnline: 'Trực tuyến', mpStConnecting: 'Đang kết nối…', mpStReconnect: 'Đang nối lại…',
    mpStExplore: 'Khám phá', mpStSolo: 'Một mình', mpStQueue: 'Hàng chờ #{POS}', mpStClosed: 'Ngoại tuyến',
    mpStTip: 'Bấm để thử nối lại máy chủ',
    mpLost: '📡 Mất kết nối máy chủ — chuyển sang chế độ Khám phá (chơi một mình), đang tự nối lại…',
    mpBack: '🟢 Đã nối lại máy chủ',
    mpJoined: '🌆 Đã vào thành phố cùng mọi người!',
    mpMoved: '📍 Máy chủ đưa bạn về vị trí đã lưu',
    mpQueue: '⏳ Máy chủ đang đầy — bạn ở vị trí #{POS}, chờ khoảng {ETA}. Trong lúc chờ, bạn cứ khám phá một mình nhé.',
    mpReload: '🔄 Tải lại trang',
    mpNewVersion: '🆕 Có phiên bản game mới — hãy tải lại trang để chơi cùng mọi người.',
    mpErr_network: 'Không kết nối được máy chủ. Bạn vẫn có thể chơi một mình.',
    mpErr_timeout: 'Máy chủ không trả lời. Bạn vẫn có thể chơi một mình.',
    mpErr_invite_required: 'Lần đầu vào thành phố cần có mã mời.',
    mpErr_invite_invalid: 'Mã mời không đúng hoặc đã hết lượt dùng.',
    mpErr_nickname_taken: 'Biệt danh này đã có quá nhiều người dùng — hãy chọn tên khác.',
    mpErr_nick_length: 'Biệt danh phải dài 3–16 ký tự.',
    mpErr_nick_chars: 'Biệt danh chỉ gồm chữ (có dấu), số, dấu cách, _ . - và có ít nhất 2 chữ cái.',
    mpErr_nick_reserved: 'Biệt danh này được dành riêng — hãy chọn tên khác.',
    mpErr_nick_brand: 'Không dùng tên thương hiệu làm biệt danh.',
    mpErr_nick_profanity: 'Biệt danh có từ ngữ không phù hợp.',
    mpErr_nick_contact: 'Biệt danh không được chứa số điện thoại hay thông tin liên lạc.',
    mpErr_nickname_invalid: 'Biệt danh không hợp lệ.',
    mpErr_device_invalid: 'Lỗi mã thiết bị — hãy tải lại trang.',
    mpErr_rate_limited: 'Bạn thao tác nhanh quá — thử lại sau {S} giây.',
    mpErr_banned: '⛔ Tài khoản đang bị khoá{FOR}.',
    mpErr_recovery_invalid: 'Mã khôi phục không đúng.',
    mpErr_unauthorized: 'Phiên đăng nhập trên máy này đã hết — hãy nhập mã khôi phục hoặc tạo tài khoản mới.',
    mpErr_refresh_reused: 'Tài khoản vừa được dùng ở nơi khác — hãy nhập mã khôi phục.',
    mpErr_proto_mismatch: 'Có phiên bản game mới — hãy tải lại trang.',
    mpErr_origin_not_allowed: 'Máy chủ không nhận kết nối từ trang này.',
    mpErr_bad_request: 'Yêu cầu không hợp lệ.',
    mpErr_default: 'Máy chủ báo lỗi ({CODE}). Bạn vẫn có thể chơi một mình.',
    mpSys_kick: '🚪 Bạn đã bị mời ra khỏi máy chủ{WHY}. Chuyển sang chơi một mình.',
    mpKick_1: ' (quản trị viên)', mpKick_2: ' (di chuyển bất thường)', mpKick_3: ' (vi phạm)', mpKick_4: ' (không hoạt động)',
    mpKick_5: ' (máy chủ tắt)', mpKick_6: ' (lỗi giao thức)', mpKick_7: ' (mạng quá chậm)',
    mpSys_restart: '🔄 Máy chủ sẽ khởi động lại sau {S} giây — game sẽ tự nối lại.',
    mpSys_duplicate: '👥 Tài khoản này vừa vào từ nơi khác — máy này chuyển sang chơi một mình.',
    mpSys_muted: '🔇 Bạn đang bị khoá chat {FOR}.',
    mpForever: 'vĩnh viễn',
    mpSec: '{N} giây', mpMin: '{N} phút', mpHour: '{N} giờ', mpDay: '{N} ngày',
    chatPh: 'Nói với người xung quanh (40 m)… Enter gửi · Esc đóng',
    chatHint: 'T hoặc / để chat',
    chatYou: 'Bạn',
    chatSys: 'Hệ thống',
    chatAdmin: '📢 Thông báo',
    chatOpen: 'Chat',
    chatSend: 'Gửi',
    chatReport: '🚩 Báo cáo',
    chatBlock: '🚫 Chặn',
    chatUnblock: 'Bỏ chặn',
    chatCancel: 'Huỷ',
    chatReportWhy: 'Vì sao báo cáo {NAME}?',
    chatReason_1: 'Nói tục, xúc phạm', chatReason_2: 'Quấy rối, đe doạ', chatReason_3: 'Gian lận',
    chatReason_4: 'Spam, quảng cáo', chatReason_5: 'Tên không phù hợp', chatReason_6: 'Lý do khác',
    chatBlocked: '🚫 Đã chặn {NAME} — bạn và người này sẽ không thấy tin của nhau nữa.',
    chatUnblocked: 'Đã bỏ chặn {NAME}.',
    chatRej_1: 'Bạn gửi nhanh quá — chờ {S} giây rồi gửi tiếp.',
    chatRej_2: 'Tin này giống tin bạn vừa gửi.',
    chatRej_3: 'Tin quá dài (tối đa 140 ký tự).',
    chatRej_4: 'Tin trống.',
    chatRej_5: 'Tin không được gửi: có từ ngữ không phù hợp hoặc thông tin liên lạc (số điện thoại, đường link, nick mạng xã hội…).',
    chatRej_6: 'Bạn đang bị khoá chat{FOR}.',
    chatRej_7: 'Người chơi mới chỉ gửi được 1 tin mỗi 5 giây — chờ {S} giây.',
    chatRej_8: 'Kênh chat không hợp lệ.',
    chatRep_0: '✓ Đã gửi báo cáo — cảm ơn bạn! Quản trị viên sẽ xem xét.',
    chatRep_1: 'Bạn vừa báo cáo — chờ một chút rồi thử lại.',
    chatRep_2: 'Người này đã rời đi.',
    chatRep_3: 'Không thể tự báo cáo chính mình.',
    chatRep_4: 'Bạn đã báo cáo người này rồi.',
    chatMuted: '🔇 Bạn bị khoá chat {FOR}.',
    chatUnmuted: '🔈 Đã gỡ khoá chat.',
    chatWarned: '⚠️ Cảnh cáo từ quản trị viên: hãy giữ lời nói lịch sự với mọi người.',
    chatBanned: '⛔ Tài khoản bị khoá {FOR}.',
    chatSupport: '💛 Nếu bạn đang buồn hay gặp chuyện khó khăn, bạn không phải một mình. Hãy nói với người lớn bạn tin tưởng, hoặc gọi Tổng đài quốc gia bảo vệ trẻ em 111 (miễn phí, 24/7).',
    chatOffline: 'Chưa kết nối máy chủ — tin chưa gửi được.',
    vehicleBusy: '🛵 Xe này đang có người dùng.',
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
    // ---- MP-2 C1 ----
    mpNickPh: 'Nickname (3–16 characters)',
    mpInvitePh: 'Invite code (XXXXX-XXXXX)',
    mpEnter: '🌆 Enter the city',
    mpSolo: '🚶 Play solo',
    mpHello: 'Hello, <b>{NAME}</b>!',
    mpHaveCode: 'Have a recovery code?',
    mpRecoverPh: '12-character recovery code',
    mpRecoverBtn: 'Recover account',
    mpRecovered: '✓ Account {NAME} recovered',
    mpServer: 'Server: {HOST}',
    mpCodeTitle: '🔑 Your recovery code',
    mpCodeBody: 'This is the key to your account <b>{NAME}</b>. Copy it and keep it safe — it is shown <b>ONLY ONCE</b>. Use it to get back into your account on another device or after clearing browser data. Never share it with anyone.',
    mpCopy: '📋 Copy', mpCopied: '✓ Copied',
    mpCodeOk: 'I saved the code — enter the city',
    mpWorking: '⏳ Connecting to the server…',
    mpNeedNick: 'Please enter a nickname.',
    mpStOnline: 'Online', mpStConnecting: 'Connecting…', mpStReconnect: 'Reconnecting…',
    mpStExplore: 'Explore', mpStSolo: 'Solo', mpStQueue: 'Queue #{POS}', mpStClosed: 'Offline',
    mpStTip: 'Click to retry the server connection',
    mpLost: '📡 Lost the server — switching to Explore mode (solo), reconnecting automatically…',
    mpBack: '🟢 Reconnected to the server',
    mpJoined: '🌆 You are in the city with everyone!',
    mpMoved: '📍 The server moved you to your saved position',
    mpQueue: '⏳ The server is full — you are #{POS} in the queue, about {ETA}. Explore solo while you wait.',
    mpReload: '🔄 Reload',
    mpNewVersion: '🆕 A new game version is out — reload the page to play with everyone.',
    mpErr_network: 'Cannot reach the server. You can still play solo.',
    mpErr_timeout: 'The server did not answer. You can still play solo.',
    mpErr_invite_required: 'An invite code is needed the first time.',
    mpErr_invite_invalid: 'The invite code is wrong or used up.',
    mpErr_nickname_taken: 'Too many players use this nickname — pick another one.',
    mpErr_nick_length: 'Nicknames must be 3–16 characters long.',
    mpErr_nick_chars: 'Use letters (accents OK), digits, spaces, _ . - and at least 2 letters.',
    mpErr_nick_reserved: 'This nickname is reserved — pick another one.',
    mpErr_nick_brand: 'Brand names cannot be used as nicknames.',
    mpErr_nick_profanity: 'This nickname contains inappropriate words.',
    mpErr_nick_contact: 'Nicknames cannot contain phone numbers or contact details.',
    mpErr_nickname_invalid: 'Invalid nickname.',
    mpErr_device_invalid: 'Device id error — please reload.',
    mpErr_rate_limited: 'Too fast — try again in {S} s.',
    mpErr_banned: '⛔ This account is banned{FOR}.',
    mpErr_recovery_invalid: 'Wrong recovery code.',
    mpErr_unauthorized: 'Your login on this device expired — enter your recovery code or create a new account.',
    mpErr_refresh_reused: 'This account was just used elsewhere — enter your recovery code.',
    mpErr_proto_mismatch: 'A new game version is out — please reload.',
    mpErr_origin_not_allowed: 'The server does not accept connections from this page.',
    mpErr_bad_request: 'Invalid request.',
    mpErr_default: 'Server error ({CODE}). You can still play solo.',
    mpSys_kick: '🚪 You were removed from the server{WHY}. Switching to solo.',
    mpKick_1: ' (moderator)', mpKick_2: ' (abnormal movement)', mpKick_3: ' (abuse)', mpKick_4: ' (idle)',
    mpKick_5: ' (server shutdown)', mpKick_6: ' (protocol error)', mpKick_7: ' (network too slow)',
    mpSys_restart: '🔄 The server restarts in {S} s — the game will reconnect by itself.',
    mpSys_duplicate: '👥 This account just joined from another device — this one switches to solo.',
    mpSys_muted: '🔇 You are muted {FOR}.',
    mpForever: 'permanently',
    mpSec: '{N} s', mpMin: '{N} min', mpHour: '{N} h', mpDay: '{N} days',
    chatPh: 'Talk to people nearby (40 m)… Enter to send · Esc to close',
    chatHint: 'T or / to chat',
    chatYou: 'You',
    chatSys: 'System',
    chatAdmin: '📢 Announcement',
    chatOpen: 'Chat',
    chatSend: 'Send',
    chatReport: '🚩 Report',
    chatBlock: '🚫 Block',
    chatUnblock: 'Unblock',
    chatCancel: 'Cancel',
    chatReportWhy: 'Why report {NAME}?',
    chatReason_1: 'Swearing, insults', chatReason_2: 'Harassment, threats', chatReason_3: 'Cheating',
    chatReason_4: 'Spam, ads', chatReason_5: 'Bad name', chatReason_6: 'Other',
    chatBlocked: '🚫 {NAME} blocked — you will no longer see each other\'s messages.',
    chatUnblocked: '{NAME} unblocked.',
    chatRej_1: 'Too fast — wait {S} s.',
    chatRej_2: 'Same as your previous message.',
    chatRej_3: 'Too long (max 140 characters).',
    chatRej_4: 'Empty message.',
    chatRej_5: 'Not sent: inappropriate words or contact details (phone numbers, links, social handles…).',
    chatRej_6: 'You are muted{FOR}.',
    chatRej_7: 'New players can send 1 message every 5 s — wait {S} s.',
    chatRej_8: 'Invalid chat channel.',
    chatRep_0: '✓ Report sent — thank you! A moderator will review it.',
    chatRep_1: 'You just reported — wait a moment.',
    chatRep_2: 'That player has left.',
    chatRep_3: 'You cannot report yourself.',
    chatRep_4: 'You already reported this player.',
    chatMuted: '🔇 You are muted {FOR}.',
    chatUnmuted: '🔈 Chat unmuted.',
    chatWarned: '⚠️ Moderator warning: please keep it friendly.',
    chatBanned: '⛔ Account banned {FOR}.',
    chatSupport: '💛 If you feel sad or are going through something hard, you are not alone. Talk to an adult you trust, or call Vietnam\'s national child protection hotline 111 (free, 24/7).',
    chatOffline: 'Not connected — message not sent.',
    vehicleBusy: '🛵 Someone is using this vehicle.',
  },
};

export function t(key) {
  return fill((dict[lang] && dict[lang][key]) ?? dict.vi[key] ?? key);
}

// t() + thay {KEY} bằng tham số riêng (MP-2: lời máy chủ = mã + tham số, dịch ở client)
export function tf(key, params) {
  let s = t(key);
  if (params && typeof s === 'string') s = s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
  return s;
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
