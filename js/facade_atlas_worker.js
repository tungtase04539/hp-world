// facade_atlas_worker.js — vẽ atlas mặt tiền (js/facade_atlas.js) NGOÀI luồng chính (~90-200 ms tuỳ máy/tải).
// citygen.js gửi {size}, nhận {data (chuyển quyền ArrayBuffer), size, mods, ms}. Chữ biển hiệu dùng OffscreenCanvas
// (không có thì facade_atlas tự vẽ vạch thay chữ).
import { buildFacadeAtlas } from './facade_atlas.js';
self.onmessage = (e) => {
  try {
    const A = buildFacadeAtlas(e.data.size);
    self.postMessage({ data: A.data, size: A.size, mods: A.mods, ms: A.ms }, [A.data.buffer]);
  } catch (err) {
    self.postMessage({ error: String(err && err.message || err) });
  }
};
