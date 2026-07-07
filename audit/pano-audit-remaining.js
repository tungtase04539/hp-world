export const meta = {
  name: 'pano-audit-remaining-4h',
  description: 'Catalog 223 pano còn lại (4 heading tiết kiệm quota) theo quy chuẩn Hải Phòng',
  phases: [
    { title: 'Catalog', detail: '38 agent, mỗi agent 6 pano × 4 heading (0/90/180/270)' },
  ],
}

const indexPath = '/tmp/claude-0/-home-user-hp-world/c2e34905-ff51-516d-bf34-6f2f3d70ade9/scratchpad/pano_remaining.json'
const total = 223
const batchSize = 6

const RUBRIC = `
QUY CHUẨN GHI NHẬN (bắt buộc, tiếng Việt, KHÔNG bịa — chỉ ghi thứ THẬT SỰ nhìn thấy trong ảnh):
Mỗi pano có 4 ảnh heading (0,90,180,270 độ) phủ 360°. ĐỌC HẾT cả 4 ảnh.
Với mỗi pano ghi:
- area: tên phố/khu vực hoặc mô tả bối cảnh (giao lộ, ven hồ, công viên, khu dân cư, phố thương mại...).
- sidewalk: kiểu lát vỉa hè + màu (caro đỏ-xám, gạch terracotta, gạch con sâu, gạch xám, bê tông, đá...) + bề rộng ước lượng. Không thấy vỉa hè → ghi "không rõ".
- buildings[]: từng công trình đáng kể — heading (độ), style (nhà ống, biệt thự Pháp, cao tầng kính, mái ngói, shophouse, công sở...), floors (số tầng ước lượng), color, width_m (bề ngang ~m), features (ban công/biển hiệu/mái vòm/cửa cuốn...).
- landmarks[]: mọi công trình/địa danh nhận diện được tên (nhà thờ, chợ, ga, tượng đài, trường, ngân hàng, khách sạn có tên...).
- vehicles: loại + mật độ (xe máy đỗ, xe máy chạy, ô tô, xích lô, xe bus, xe tải...).
- vegetation: loại cây (phượng, xà cừ, bàng, cọ, cây cảnh), bồn hoa, thảm cỏ, hàng cây.
- street_furniture[]: cột điện + dây, cột đèn (kiểu gì), đèn giao thông, biển tên phố, dải phân cách, nhà chờ bus, thùng rác, ghế, hàng rào, bốt điện...
- banners[]: băng rôn/khẩu hiệu/biển quảng cáo — CHÉP nguyên văn chữ nếu đọc được.
- special[]: vật đặc trưng/độc đáo cần dựng riêng (giàn vòm, cổng chào, tượng, đài phun nước, đồng hồ, kiosk, quán hoa, cầu, bến, tháp...). KHÔNG có gì đặc biệt → mảng rỗng, ĐỪNG bịa.
- summary: 1-2 câu tổng quát.
- confidence: high/medium/low theo độ rõ.
NGUYÊN TẮC: thà bỏ trống còn hơn bịa. Ảnh mờ/che khuất → confidence low, không suy diễn.
`

const PANO_ITEM = {
  type: 'object',
  required: ['id', 'summary', 'confidence'],
  properties: {
    id: { type: 'string' },
    area: { type: 'string' },
    sidewalk: { type: 'string' },
    buildings: { type: 'array', items: { type: 'object', properties: {
      heading: { type: 'integer' }, style: { type: 'string' }, floors: { type: 'integer' },
      color: { type: 'string' }, width_m: { type: 'number' }, features: { type: 'string' } } } },
    landmarks: { type: 'array', items: { type: 'string' } },
    vehicles: { type: 'string' },
    vegetation: { type: 'string' },
    street_furniture: { type: 'array', items: { type: 'string' } },
    banners: { type: 'array', items: { type: 'string' } },
    special: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
}
const CATALOG_SCHEMA = { type: 'object', required: ['panos'], properties: { panos: { type: 'array', items: PANO_ITEM } } }

const nBatches = Math.ceil(total / batchSize)
const batches = []
for (let b = 0; b < nBatches; b++) batches.push({ b, start: b * batchSize, end: Math.min(total, (b + 1) * batchSize) })
log(`Catalog ${total} pano còn lại (4 heading) trong ${nBatches} batch.`)

const results = await pipeline(
  batches,
  (batch) => agent(
    `Bạn là chuyên gia khảo sát đô thị Hải Phòng. Lập catalog CHI TIẾT các pano Street View theo quy chuẩn.
Bước 1: Đọc file JSON: ${indexPath} (mảng ${total} pano, mỗi phần tử có id, X, Z toạ độ thế giới, imgs = map heading→đường dẫn ảnh tuyệt đối; CHỈ có 4 heading 0/90/180/270).
Bước 2: Xử lý các pano CHỈ SỐ mảng từ ${batch.start} đến ${batch.end - 1} (0-based, ${batch.end - batch.start} pano).
Bước 3: Với MỖI pano, DÙNG TOOL Read mở LẦN LƯỢT cả 4 ảnh heading (imgs["0"],imgs["90"],imgs["180"],imgs["270"]) và quan sát kỹ.
Bước 4: Ghi theo đúng quy chuẩn, trả về {panos:[...]} qua StructuredOutput, đủ ${batch.end - batch.start} pano, id chính xác như trong file.
${RUBRIC}`,
    { label: `catalog4:${batch.start}-${batch.end - 1}`, phase: 'Catalog', schema: CATALOG_SCHEMA, agentType: 'general-purpose' }
  )
)

const clean = results.filter(Boolean)
const allPanos = clean.flatMap(r => r.panos || [])
log(`Xong: ${allPanos.length}/${total} pano còn lại đã catalog.`)
return { panos: allPanos, batchesOK: clean.length, nBatches }
