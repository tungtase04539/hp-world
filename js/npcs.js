import * as THREE from 'three';
import { makeHumanoid } from './character.js';
import { tx, onLangChange } from './i18n.js';

// 6 NPC với hội thoại song ngữ. action: 'minigame' mở trò nấu ăn sau hội thoại
export const NPC_DATA = [
  {
    id: 'guide', x: 10, z: 14, face: 0,
    scheme: { shirt: 0x2e86c1, shorts: 0x24455f, hat: 'cap', cap: 0x1a5276, backpack: 0 },
    name: { vi: 'Linh — Hướng dẫn viên', en: 'Linh — Tour guide' },
    lines: [
      { vi: 'Chào mừng bạn đến với Hải Phòng — Thành phố Hoa Phượng Đỏ! Mình là Linh, hướng dẫn viên của bạn. Đây là quảng trường Nhà hát lớn, trái tim của thành phố.', en: 'Welcome to Hai Phong — City of Red Flamboyants! I\'m Linh, your guide. This is the Opera House square, the heart of the city.' },
      { vi: 'Có 15 địa danh để khám phá — hãy nhìn bản đồ nhỏ góc màn hình nhé! Quanh đây có Quán hoa, tượng đài Lê Chân, hồ Tam Bạc... Phía bắc là sông Cấm với cảng và hai cây cầu lớn.', en: 'There are 15 landmarks to discover — check the minimap in the corner! Nearby are the Flower Kiosks, Le Chan monument and Tam Bac lake... North lies the Cam river with the port and two great bridges.' },
      { vi: 'Đi xa hơn: theo quốc lộ về phía nam 20 cây số là biển Đồ Sơn, còn muốn ra đảo Cát Bà thì xuống Bến Bính lấy thuyền — thuyền trưởng Hải sẽ chỉ cho bạn. Lấy xe máy đậu cạnh nhà hát mà đi cho nhanh!', en: 'Further out: follow the highway 20km south to Do Son beach, or take a boat from Ben Binh pier to Cat Ba island — Captain Hai will show you. Grab the motorbike parked by the theatre to travel fast!' },
    ],
  },
  {
    id: 'coba', x: -96, z: -14, face: Math.PI,
    scheme: { shirt: 0xc0392b, shorts: 0x5b3256, skin: 0xe8b080, hat: 'nonla', backpack: 0 },
    name: { vi: 'Cô Ba — Quán bánh đa cua', en: 'Ms. Ba — Banh da cua stall' },
    lines: [
      { vi: 'Cháu ơi, vào đây! Quán cô ngay bờ hồ Tam Bạc này bán bánh đa cua ngon nhất phố đấy. Chưa ăn bánh đa cua là chưa biết Hải Phòng đâu!', en: 'Come here, dear! My stall by Tam Bac lake serves the best banh da cua in town. You don\'t know Hai Phong until you\'ve had it!' },
      { vi: 'Bát bánh đa cua ngon phải có sợi bánh đa đỏ đặc trưng, gạch cua đồng béo ngậy... Cháu có muốn thử nấu cùng cô không?', en: 'A true bowl needs the signature red noodles and rich field-crab paste... Want to try cooking with me?' },
    ],
    action: 'minigame',
  },
  {
    id: 'xichlo', x: -30, z: 30, face: -Math.PI / 2,
    scheme: { shirt: 0xf0e6c8, shorts: 0x4a5568, skin: 0xd8a070, hat: 'nonla', backpack: 0 },
    name: { vi: 'Bác Tư — Xích lô', en: 'Mr. Tu — Cyclo driver' },
    lines: [
      { vi: 'Ơ này du khách! Lên xích lô bác chở đi một vòng dải trung tâm không? Xe đậu ngay kia kìa.', en: 'Hey traveler! Fancy a cyclo ride around the central strip? It\'s parked right over there.' },
      { vi: 'Bác chạy xích lô ba chục năm rồi. Hải Phòng đẹp nhất tháng 5, tháng 6 — mùa phượng nở đỏ trời. Người ta bảo hoa phượng là "lửa" của thành phố này đấy.', en: 'Thirty years on this cyclo. Hai Phong is loveliest in May and June — flamboyant season paints the sky red. They say the flowers are this city\'s "fire".' },
      { vi: 'Thấy hoa phượng phát sáng quanh phố không? Nhặt đủ mười bông là có quà đấy, hehe!', en: 'See those glowing flowers around town? Collect all ten and something nice happens, hehe!' },
    ],
  },
  {
    id: 'captain', x: 40, z: -128, face: 0,
    scheme: { shirt: 0xf5f5f0, shorts: 0x24455f, skin: 0xd8a070, hat: 'cap', cap: 0x24455f, backpack: 0 },
    name: { vi: 'Thuyền trưởng Hải', en: 'Captain Hai' },
    lines: [
      { vi: 'Chào cậu! Con thuyền này sẵn sàng ra khơi rồi. Cậu biết lái không? Cứ lên đi, nhấn E là chạy được!', en: 'Ahoy! This boat is ready to sail. Know how to steer? Hop on — press E and off you go!' },
      { vi: 'Đây là Bến Bính. Xuôi sông Cấm về phía đông ra cửa biển, rồi giữ hướng đông nam len qua các đảo đá vôi là tới vịnh Lan Hạ — Cát Bà. Cảnh đẹp như tranh vẽ!', en: 'This is Ben Binh pier. Sail the Cam river east to the sea, then keep southeast between the limestone karsts to reach Lan Ha bay at Cat Ba. Like a painting!' },
      { vi: 'Nhìn bản đồ nhỏ mà đi cho khỏi lạc. Nhớ tránh va vào đá ngầm nhé — biển lặng thế này, chạy chừng một phút là tới.', en: 'Follow the minimap so you don\'t get lost. Mind the rocks — sea\'s calm, about a minute\'s sail.' },
    ],
  },
  {
    id: 'fisherman', x: 388, z: 1896, face: Math.PI / 2,
    scheme: { shirt: 0x6a8a5a, shorts: 0x4a4038, skin: 0xc89060, hat: 'nonla', backpack: 0 },
    name: { vi: 'Chú Sáu — Ngư dân Đồ Sơn', en: 'Mr. Sau — Do Son fisherman' },
    lines: [
      { vi: 'Biển Đồ Sơn hôm nay đẹp quá ha! Chú vừa kéo lưới về, toàn tôm với ghẹ tươi roi rói.', en: 'Do Son sea is beautiful today! Just hauled in the nets — prawns and crabs, all fresh.' },
      { vi: 'Thấy ngọn hải đăng ngoài kia không? Đảo Hòn Dấu đấy. Hơn trăm năm nay đèn chưa tắt đêm nào, dân biển tụi chú coi như mắt thần hộ mệnh.', en: 'See that lighthouse out there? Hon Dau island. Its light hasn\'t missed a night in a century — we sea folk call it our guardian eye.' },
      { vi: 'Muốn ra đó thì bơi hơi xa đấy — lấy thuyền ở Bến Nghiêng ngay kia mà đi! Trên đồi sau lưng chú là biệt thự Bảo Đại, lên ngắm cảnh đẹp lắm.', en: 'Bit far to swim — take the boat at Ben Nghieng pier right there! And up the hill behind me is Bao Dai Villa, a great viewpoint.' },
    ],
  },
  {
    id: 'catba', x: 2452, z: 1150, face: Math.PI,
    scheme: { shirt: 0x2ea08a, shorts: 0x4a4038, skin: 0xe8b080, hat: null, hair: 0x1a1210, backpack: 0 },
    name: { vi: 'Chị Thu — Người đảo Cát Bà', en: 'Ms. Thu — Cat Ba islander' },
    lines: [
      { vi: 'Ôi, khách từ đất liền ra chơi! Chào mừng đến Cát Bà — hòn ngọc của vịnh Bắc Bộ đấy.', en: 'Oh, a visitor from the mainland! Welcome to Cat Ba — pearl of the Gulf of Tonkin.' },
      { vi: 'Những dãy núi đá vôi ngoài kia là vịnh Lan Hạ. Chèo thuyền len giữa các đảo lúc hoàng hôn thì không gì bằng. Nước xanh như ngọc, lặng như gương.', en: 'Those limestone peaks out there are Lan Ha bay. Nothing beats weaving between the islets at sunset — jade water, still as a mirror.' },
      { vi: 'Trong rừng quốc gia còn loài voọc Cát Bà quý hiếm nhất thế giới, chỉ còn khoảng bảy chục con thôi. Người đảo tự hào lắm!', en: 'Our national park shelters the world\'s rarest langur — barely seventy left. We islanders are very proud of them!' },
    ],
  },
  {
    id: 'florist', x: -22, z: 18, face: Math.PI / 2,
    scheme: { shirt: 0xd87ca0, shorts: 0x5b3256, skin: 0xf0c090, hat: 'nonla', backpack: 0 },
    name: { vi: 'Bà Năm — Quán hoa', en: 'Mrs. Nam — Flower kiosk' },
    lines: [
      { vi: 'Mua hoa đi cháu! Quán hoa này có từ năm 1944 đấy, bà ngồi bán ở đây từ thời con gái. À mà mùa này hoa đẹp nhất lại là hoa phượng trên cây kia kìa, bà có bán đâu.', en: 'Flowers, dear! These kiosks date from 1944 — I\'ve sold here since I was a girl. Though this season\'s prettiest blooms are the flamboyants on the trees — those I can\'t sell.' },
      { vi: 'Hồi bà còn trẻ, cứ tan trường là nhặt cánh phượng ép vào trang vở. Cháu thử nhặt những bông hoa rơi quanh hồ xem — kỷ niệm đẹp lắm đấy.', en: 'When I was young we pressed fallen petals into our notebooks after school. Try gathering the fallen flowers around the lake — a lovely memory to keep.' },
    ],
  },
];

export function buildNPCs(scene, world) {
  const npcs = [];
  for (const d of NPC_DATA) {
    // vị trí tính từ dữ liệu bản đồ thật (world.npcSpots), fallback về tọa độ tĩnh
    if (world.npcSpots && world.npcSpots[d.id]) {
      d.x = world.npcSpots[d.id][0];
      d.z = world.npcSpots[d.id][1];
    }
    const rig = makeHumanoid(d.scheme);
    const y = world.groundHeight(d.x, d.z);
    rig.group.position.set(d.x, y, d.z);
    rig.group.rotation.y = d.face;
    scene.add(rig.group);

    let sprite = world.makeTextSprite(tx(d.name), { color: '#bfe8ff', size: 36 });
    sprite.scale.set(11, 2.75, 1);
    sprite.position.set(d.x, y + 3, d.z);
    scene.add(sprite);

    const npc = { data: d, rig, sprite, baseFace: d.face };
    npcs.push(npc);
    world.colliders.push({ x: d.x, z: d.z, r: 0.7 });
  }

  onLangChange(() => {
    for (const n of npcs) {
      const ns = world.makeTextSprite(tx(n.data.name), { color: '#bfe8ff', size: 36 });
      ns.scale.set(11, 2.75, 1);
      ns.position.copy(n.sprite.position);
      scene.remove(n.sprite);
      n.sprite.material.map.dispose();
      n.sprite.material.dispose();
      scene.add(ns);
      n.sprite = ns;
    }
  });

  // NPC nhìn về phía người chơi khi ở gần
  function update(dt, time, playerPos) {
    for (const n of npcs) {
      n.rig.animate(dt, 0, time + n.data.x);
      const dx = playerPos.x - n.data.x, dz = playerPos.z - n.data.z;
      const dist = Math.hypot(dx, dz);
      const targetY = dist < 8 ? Math.atan2(dx, dz) : n.baseFace;
      let diff = targetY - n.rig.group.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      n.rig.group.rotation.y += diff * Math.min(1, dt * 5);
    }
  }

  return { npcs, update };
}
