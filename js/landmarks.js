import * as THREE from 'three';
import { tx, onLangChange } from './i18n.js';
import { LM, LM_FACE, EXTRAS } from './mapdata.js';

// đầu cầu phía nam (gần trung tâm) — tính từ tâm/trục/nửa chiều dài way OSM
function bridgeEnd(b) {
  const e1 = [b.x + Math.sin(b.ang) * b.half, b.zc + Math.cos(b.ang) * b.half];
  const e2 = [b.x - Math.sin(b.ang) * b.half, b.zc - Math.cos(b.ang) * b.half];
  return e1[1] > e2[1] ? e1 : e2;
}
const hvtEnd = bridgeEnd(EXTRAS.bridges[0]);
const binhEnd = bridgeEnd(EXTRAS.bridges[1]);

// vị trí biển chỉ dẫn: cạnh công trình thật (LM = tâm footprint OSM), lệch ra ngoài để không chắn lối
const P = {
  opera: [LM.opera[0] + 14, LM.opera[1] + 16],
  quanhoa: [LM.quanhoa[0] + 8, LM.quanhoa[1] + 6],
  lechan: [LM.lechan[0] + 8, LM.lechan[1] + 8],
  lake: [LM.lake[0], LM.lake[1] + 30],
  market: [LM.market[0] + 2, LM.market[1] - 22], // phía bắc — nam là đầu hồ Tam Bạc
  cathedral: [LM.cathedral[0] + LM_FACE.cathedral[0] * 20, LM.cathedral[1] + LM_FACE.cathedral[1] * 20],
  postoffice: [LM.postoffice[0] + LM_FACE.postoffice[0] * 16, LM.postoffice[1] + LM_FACE.postoffice[1] * 16],
  museum: [LM.museum[0] + LM_FACE.museum[0] * 18, LM.museum[1] + LM_FACE.museum[1] * 18],
  station: [LM.station[0] + 18, LM.station[1] + 4],
  bridge: [hvtEnd[0] + 9, hvtEnd[1] + 8],
  binhbridge: [binhEnd[0] + 9, binhEnd[1] + 8],
  port: [LM.port[0] - 80, LM.port[1] + 30],
  doson: [LM.doson[0], LM.doson[1]],
  hondau: [LM.hondau[0] + 6, LM.hondau[1] - 6], // đảo nhỏ — lệch về phía đất
  catba: [EXTRAS.catbaTown[0] - 25, EXTRAS.catbaTown[1] + 10],
  thptnq: [LM.thptnq[0] + LM_FACE.thptnq[0] * 16, LM.thptnq[1] + LM_FACE.thptnq[1] * 16],
  thcsnq: [LM.thcsnq[0] + LM_FACE.thcsnq[0] * 16, LM.thcsnq[1] + LM_FACE.thcsnq[1] * 16],
  thcstp: [LM.thcstp[0] + LM_FACE.thcstp[0] * 16, LM.thcstp[1] + LM_FACE.thcstp[1] * 16],
};

// 15 địa danh đặc trưng — tọa độ thật từ dữ liệu OpenStreetMap (đã qua phép chiếu 1:10 + kính lúp trung tâm)
export const LANDMARKS = [
  {
    id: 'opera', x: P.opera[0], z: P.opera[1],
    name: { vi: 'Nhà hát lớn Hải Phòng', en: 'Hai Phong Opera House' },
    text: {
      vi: 'Xây năm 1904 theo phong cách Baroque với vật liệu chở từ Pháp sang. Mặt tiền vàng rực đối xứng hoàn hảo, các cột trắng kiểu Corinth, hơn 100 cửa. Trước nhà hát là quảng trường với đài phun nước và cột cờ Tổ quốc.',
      en: 'Built in 1904 in Baroque style with materials shipped from France. A perfectly symmetric golden façade, white Corinthian columns and over 100 doors. The square in front holds a fountain and the national flagpole.',
    },
    fact: {
      vi: '💡 Nhà hát được mô phỏng theo các nhà hát Paris — trái tim văn hóa của đất Cảng hơn một thế kỷ.',
      en: '💡 Modeled after Parisian theatres — the cultural heart of the Port City for over a century.',
    },
  },
  {
    id: 'quanhoa', x: P.quanhoa[0], z: P.quanhoa[1],
    name: { vi: 'Quán hoa', en: 'The Flower Kiosks' },
    text: {
      vi: 'Dải 5 quán hoa nhỏ xây năm 1944, mái ngói vẩy rồng cong vút kiểu đình làng Bắc Bộ trên bốn cột gỗ lim. Hơn 80 năm qua, đây là nơi người Hải Phòng mua hoa mỗi sáng — nét duyên riêng không nơi nào có.',
      en: 'Five little flower kiosks built in 1944, with curved dragon-scale tile roofs in northern communal-house style on ironwood columns. For 80+ years locals have bought flowers here each morning — a charm found nowhere else.',
    },
    fact: {
      vi: '💡 Hà Nội và TP.HCM đều không có công trình nào tương tự tồn tại lâu như vậy.',
      en: '💡 Neither Hanoi nor Ho Chi Minh City has anything quite like them.',
    },
  },
  {
    id: 'lechan', x: P.lechan[0], z: P.lechan[1],
    name: { vi: 'Tượng đài Nữ tướng Lê Chân', en: 'Lady General Le Chan Monument' },
    text: {
      vi: 'Tượng đồng cao 7,5m, nặng 19 tấn, khánh thành năm 2000, đặt trước Trung tâm Triển lãm. Nữ tướng Lê Chân là người khai phá vùng đất An Biên — tiền thân của Hải Phòng — và là biểu tượng tinh thần của thành phố.',
      en: 'A 7.5m, 19-ton bronze statue unveiled in 2000 before the Exhibition Center. Lady General Le Chan founded An Bien — the settlement that became Hai Phong — and remains the city\'s guardian symbol.',
    },
    fact: {
      vi: '💡 Bà là nữ tướng của Hai Bà Trưng từ thế kỷ thứ nhất — lễ hội đền Nghè tưởng nhớ bà mỗi tháng 2 âm lịch.',
      en: '💡 She served the Trung Sisters in the 1st century — the Nghe Temple festival honors her every year.',
    },
  },
  {
    id: 'lake', x: P.lake[0], z: P.lake[1],
    name: { vi: 'Hồ Tam Bạc', en: 'Tam Bac Lake' },
    text: {
      vi: 'Dải hồ dài giữa lòng thành phố, người Pháp cải tạo từ một nhánh sông năm 1885. Hai bờ là hàng phượng vĩ rực đỏ mỗi độ hè — đoạn đẹp nhất của "dải trung tâm" để dạo bộ buổi chiều.',
      en: 'A long ribbon of water downtown, remodeled by the French from a river branch in 1885. Its banks blaze with flamboyant trees each summer — the loveliest stretch of the "central strip" for an evening stroll.',
    },
    fact: {
      vi: '💡 Cứ tháng 5 về, mặt hồ như được viền bằng lửa đỏ của hoa phượng.',
      en: '💡 Come May, the lake seems rimmed with the red fire of flamboyant blooms.',
    },
  },
  {
    id: 'market', x: P.market[0], z: P.market[1],
    name: { vi: 'Chợ Sắt', en: 'Sat (Iron) Market' },
    text: {
      vi: 'Khu chợ nổi tiếng nhất Hải Phòng bên sông Tam Bạc, xây từ thời Pháp với khung thép — vì thế có tên "chợ Sắt". Từng là trung tâm buôn bán sầm uất nhất miền Bắc, "gì cũng có, từ cái kim đến chiếc tàu thủy".',
      en: 'Hai Phong\'s most famous market by the Tam Bac river, built in colonial times on an iron frame — hence "Iron Market". Once the North\'s busiest trading hub: "everything from a needle to a ship".',
    },
    fact: {
      vi: '💡 Câu xưa: "Chưa đi chợ Sắt, coi như chưa đến Hải Phòng".',
      en: '💡 Old saying: "You haven\'t seen Hai Phong until you\'ve been to Sat Market".',
    },
  },
  {
    id: 'cathedral', x: P.cathedral[0], z: P.cathedral[1],
    name: { vi: 'Nhà thờ chính tòa Hải Phòng', en: 'Hai Phong Cathedral' },
    text: {
      vi: 'Nhà thờ chính tòa Nữ Vương Rất Thánh Mân Côi xây năm 1880 theo lối Gothic, tháp chuông cao vút giữa khu phố cũ. Tiếng chuông nhà thờ đã điểm nhịp cho phố Cảng gần một thế kỷ rưỡi.',
      en: 'The Queen of the Rosary Cathedral, built in 1880 in Gothic style, its bell tower soaring over the old quarter. Its bells have marked time for the port town for nearly 150 years.',
    },
    fact: {
      vi: '💡 Đây là một trong những nhà thờ lớn cổ nhất miền Bắc Việt Nam.',
      en: '💡 One of the oldest cathedrals in northern Vietnam.',
    },
  },
  {
    id: 'postoffice', x: P.postoffice[0], z: P.postoffice[1],
    name: { vi: 'Bưu điện trung tâm', en: 'Central Post Office' },
    text: {
      vi: 'Tòa bưu điện kiểu thuộc địa Pháp với tường vàng, dãy cửa vòm trắng và đồng hồ lớn trên nóc — một trong những công trình cổ duyên dáng nhất của khu phố Pháp Hải Phòng.',
      en: 'A French-colonial post office with golden walls, white arched doorways and a big rooftop clock — one of the most graceful old buildings in Hai Phong\'s French quarter.',
    },
    fact: {
      vi: '💡 Khu phố quanh đây vẫn giữ nguyên quy hoạch bàn cờ người Pháp vẽ từ thế kỷ 19.',
      en: '💡 The surrounding streets still follow the 19th-century French grid plan.',
    },
  },
  {
    id: 'museum', x: P.museum[0], z: P.museum[1],
    name: { vi: 'Bảo tàng Hải Phòng', en: 'Hai Phong Museum' },
    text: {
      vi: 'Tòa nhà gạch đỏ kiểu Gothic thuộc địa xây năm 1919, nguyên là Ngân hàng Pháp-Hoa. Nay lưu giữ hàng vạn hiện vật kể chuyện vùng đất Cảng từ thuở Nữ tướng Lê Chân khai hoang.',
      en: 'A red-brick colonial-Gothic building from 1919, originally the Franco-Chinese Bank. It now holds tens of thousands of artifacts telling the Port City\'s story since Le Chan\'s founding days.',
    },
    fact: {
      vi: '💡 Kiến trúc mang cả nét Á Đông pha Gothic — hiếm thấy ở Việt Nam.',
      en: '💡 Its blend of East Asian and Gothic style is rare in Vietnam.',
    },
  },
  {
    id: 'station', x: P.station[0], z: P.station[1],
    name: { vi: 'Ga Hải Phòng', en: 'Hai Phong Railway Station' },
    text: {
      vi: 'Nhà ga kiểu Pháp khánh thành năm 1902, điểm cuối tuyến đường sắt Hà Nội – Hải Phòng lịch sử. Chuyến tàu LP luôn là cách lãng mạn nhất để đến thành phố Cảng.',
      en: 'A French-style station opened in 1902, terminus of the historic Hanoi–Hai Phong railway. The LP train remains the most romantic way to reach the Port City.',
    },
    fact: {
      vi: '💡 Tuyến đường sắt này do người Pháp xây từ 1901-1902, dài hơn 100km.',
      en: '💡 The line was built in 1901-02 and runs over 100km.',
    },
  },
  {
    id: 'bridge', x: P.bridge[0], z: P.bridge[1],
    name: { vi: 'Cầu Hoàng Văn Thụ', en: 'Hoang Van Thu Bridge' },
    text: {
      vi: 'Cây cầu vòm thép hiện đại bắc qua sông Cấm, khánh thành 2019, dáng như "cánh chim biển" sải cánh. Nhịp vòm chính dài 200m. Đứng trên cầu ngắm hoàng hôn trên sông Cấm là trải nghiệm không thể bỏ lỡ!',
      en: 'A modern steel arch over the Cam river, opened in 2019, shaped like a seabird spreading its wings, with a 200m main span. Sunset from the bridge is unmissable!',
    },
    fact: {
      vi: '💡 Hãy thử phóng xe máy qua cầu sang Thủy Nguyên nhé!',
      en: '💡 Try riding your motorbike across to Thuy Nguyen!',
    },
  },
  {
    id: 'binhbridge', x: P.binhbridge[0], z: P.binhbridge[1],
    name: { vi: 'Cầu Bính', en: 'Binh Bridge' },
    text: {
      vi: 'Cầu dây văng thanh thoát bắc qua sông Cấm, khánh thành 2005, từng là một trong những cầu dây văng đẹp nhất Đông Nam Á với hai trụ tháp cao vút và rừng dây cáp trắng.',
      en: 'An elegant cable-stayed bridge over the Cam river, opened in 2005 — once among Southeast Asia\'s most beautiful, with soaring pylons and a forest of white cables.',
    },
    fact: {
      vi: '💡 Cầu dài 1,3km, tĩnh không 25m cho tàu lớn qua lại bên dưới.',
      en: '💡 It is 1.3km long with 25m clearance for big ships below.',
    },
  },
  {
    id: 'port', x: P.port[0], z: P.port[1],
    name: { vi: 'Cảng Hải Phòng', en: 'Port of Hai Phong' },
    text: {
      vi: 'Cửa ngõ ra biển lớn nhất miền Bắc với lịch sử hơn 150 năm. Giàn cần cẩu và núi container hoạt động ngày đêm bên sông Cấm — chính nơi này cho thành phố cái tên "Thành phố Cảng".',
      en: 'Northern Vietnam\'s biggest gateway to the sea, over 150 years old. Cranes and container mountains work day and night along the Cam river — the port that named the "Port City".',
    },
    fact: {
      vi: '💡 Nghe tiếng còi tàu chưa? Đó là "giọng nói" của Hải Phòng đấy!',
      en: '💡 Hear the ship horn? That\'s the "voice" of Hai Phong!',
    },
  },
  {
    id: 'doson', x: P.doson[0], z: P.doson[1],
    name: { vi: 'Bãi biển Đồ Sơn', en: 'Do Son Beach' },
    text: {
      vi: 'Bán đảo nghỉ mát nổi tiếng từ đầu thế kỷ 20, cách trung tâm 20km. Đồi thông, bãi cát dài và sóng êm. Trên đỉnh đồi là biệt thự Bảo Đại — nơi nghỉ của vị vua cuối cùng. Bến Nghiêng dưới kia là nơi thuyền ra đảo Hòn Dấu.',
      en: 'A famous resort peninsula since the early 1900s, 20km from downtown — pine hills, long sand and gentle waves. On the hilltop sits Bao Dai Villa, retreat of the last emperor. Ben Nghieng pier below serves boats to Hon Dau island.',
    },
    fact: {
      vi: '💡 Lễ hội chọi trâu Đồ Sơn (9/8 âm lịch) đã có từ hàng trăm năm.',
      en: '💡 The centuries-old Do Son buffalo-fighting festival falls on the 9th day of the 8th lunar month.',
    },
  },
  {
    id: 'hondau', x: P.hondau[0], z: P.hondau[1],
    name: { vi: 'Hải đăng Hòn Dấu', en: 'Hon Dau Lighthouse' },
    text: {
      vi: 'Ngọn hải đăng do người Pháp xây năm 1892 trên đảo Hòn Dấu, được mệnh danh "mắt ngọc của Tổ quốc". Hơn 130 năm qua, đèn chưa tắt đêm nào, dẫn lối tàu thuyền vào cảng Hải Phòng.',
      en: 'Built by the French in 1892 on Hon Dau island and called the "pearl eye of the nation". For over 130 years its light has never missed a night, guiding ships into Hai Phong port.',
    },
    fact: {
      vi: '💡 Đèn chiếu xa tới 40km. Đảo còn có đền thờ Nam Hải Thần Vương linh thiêng.',
      en: '💡 Its beam reaches 40km. The island also holds the sacred South Sea King temple.',
    },
  },
  {
    id: 'catba', x: P.catba[0], z: P.catba[1],
    name: { vi: 'Cát Bà & Vịnh Lan Hạ', en: 'Cat Ba & Lan Ha Bay' },
    text: {
      vi: 'Hòn đảo lớn nhất vịnh Bắc Bộ với vườn quốc gia, thị trấn ven vịnh đầy nhà cao màu sắc, và vịnh Lan Hạ — hàng trăm đảo đá vôi nhấp nhô trên nước xanh ngọc, đẹp không kém Hạ Long mà yên bình hơn nhiều.',
      en: 'The largest island in the Gulf of Tonkin: a national park, a bayside town of tall colorful houses, and Lan Ha bay — hundreds of limestone karsts on jade water, as stunning as Ha Long but far more peaceful.',
    },
    fact: {
      vi: '💡 Cát Bà là Khu dự trữ sinh quyển thế giới, nhà của loài voọc Cát Bà chỉ còn ~70 cá thể.',
      en: '💡 A UNESCO biosphere reserve, home to the Cat Ba langur — only ~70 remain.',
    },
  },
  {
    id: 'thptnq', x: P.thptnq[0], z: P.thptnq[1],
    name: { vi: 'Trường THPT Ngô Quyền', en: 'Ngo Quyen High School' },
    text: {
      vi: 'Tiền thân là trường Bonnal do người Pháp lập năm 1920 — trường trung học lâu đời nhất Hải Phòng. Dãy nhà vàng kiểu Pháp với cửa chớp xanh đã đón hơn một thế kỷ học trò đất Cảng, trong đó có nhà văn Nguyên Hồng, Tổng Bí thư Nguyễn Văn Linh.',
      en: 'Founded in 1920 as the French Bonnal school — the oldest high school in Hai Phong. Its yellow colonial halls with green shutters have taught generations, including writer Nguyen Hong and Party leader Nguyen Van Linh.',
    },
    fact: {
      vi: '💡 Hơn 100 năm tuổi — ngôi trường cổ kính bậc nhất thành phố Cảng.',
      en: '💡 Over a century old — the most storied school of the Port City.',
    },
  },
  {
    id: 'thcsnq', x: P.thcsnq[0], z: P.thcsnq[1],
    name: { vi: 'Trường THCS Ngô Quyền', en: 'Ngo Quyen Secondary School' },
    text: {
      vi: 'Trường trung học cơ sở nằm giữa khu phố cũ quận Lê Chân, cạnh ngôi trường THPT trăm tuổi cùng tên. Sân trường rợp bóng phượng vĩ — loài hoa biểu tượng của Hải Phòng.',
      en: 'A secondary school in the old quarter of Le Chan district, neighboring the century-old high school of the same name. Its yard blazes with flamboyant trees — the city\'s signature bloom.',
    },
    fact: {
      vi: '💡 Mùa hè, phượng nở đỏ rực sân trường — mùa chia tay của học trò.',
      en: '💡 In summer the schoolyard turns red with phoenix flowers — farewell season.',
    },
  },
  {
    id: 'thcstp', x: P.thcstp[0], z: P.thcstp[1],
    name: { vi: 'Trường THCS Trần Phú', en: 'Tran Phu Secondary School' },
    text: {
      vi: 'Một trong những trường THCS trọng điểm của Hải Phòng bên dải trung tâm, gần hồ Tam Bạc. Nhiều thế hệ học sinh giỏi của thành phố đã trưởng thành từ đây.',
      en: 'One of Hai Phong\'s key secondary schools by the central strip, near Tam Bac lake. Generations of the city\'s top students grew up here.',
    },
    fact: {
      vi: '💡 Trường nằm ngay dải vườn hoa trung tâm — đi bộ vài phút tới hồ Tam Bạc.',
      en: '💡 Steps away from the central flower gardens and Tam Bac lake.',
    },
  },
];

export function buildLandmarkSigns(scene, world) {
  const signs = [];
  for (const lm of LANDMARKS) {
    const y = world.groundHeight(lm.x, lm.z);
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.15, 2.2, 6),
      new THREE.MeshLambertMaterial({ color: 0x7a5230 })
    );
    post.position.set(lm.x, y + 1.1, lm.z);
    scene.add(post);
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 1.2, 0.16),
      new THREE.MeshLambertMaterial({ color: 0x2e6fa1 })
    );
    board.position.set(lm.x, y + 2.4, lm.z);
    scene.add(board);
    const icon = new THREE.Mesh(
      new THREE.CircleGeometry(0.34, 12),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    icon.position.set(lm.x, y + 2.4, lm.z + 0.09);
    scene.add(icon);

    let sprite = world.makeTextSprite(tx(lm.name), { color: '#ffe9b8' });
    sprite.position.set(lm.x, y + 4.6, lm.z);
    scene.add(sprite);
    signs.push({ lm, sprite, y });
  }
  onLangChange(() => {
    for (const s of signs) {
      const ns = world.makeTextSprite(tx(s.lm.name), { color: '#ffe9b8' });
      ns.position.copy(s.sprite.position);
      scene.remove(s.sprite);
      s.sprite.material.map.dispose();
      s.sprite.material.dispose();
      scene.add(ns);
      s.sprite = ns;
    }
  });
  return signs;
}
