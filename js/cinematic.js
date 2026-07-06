import * as THREE from 'three';

// ============================================================================
// Chế độ "ĐẠO DIỄN" (cinematic) — CHỈ dùng cho trailer / giới thiệu / cutscene.
// KHÔNG ảnh hưởng lối chơi: khi tắt (mặc định) camera bám nhân vật như thường.
//   __cine.free()            bật camera bay tự do (WASD + kéo chuột; Q/E lên xuống; Shift nhanh)
//   __cine.mark()            ghi 1 điểm mốc camera (vị trí + hướng đang nhìn)
//   __cine.playMarks(sec)    bay mượt qua các điểm mốc đã ghi trong `sec` giây
//   __cine.play(keys, sec)   bay theo path tự định nghĩa [{pos:[x,y,z], look:[x,y,z]}]
//   __cine.demo(sec)         chạy cảnh bay giới thiệu dải trung tâm
//   __cine.startRec()/.stopRec('ten')  quay .webm từ canvas rồi tải về
//   __cine.stop()            thoát chế độ đạo diễn (trả lại camera cho lối chơi)
// ============================================================================
export function initCinematic({ renderer, camera }) {
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const easeInOut = (t) => t * t * (3 - 2 * t);

  const state = { active: false, mode: null };  // mode: 'free' | 'play'
  const keys = new Set();
  let yaw = 0, pitch = 0, speed = 45;

  // playback
  let posCurve = null, tgtCurve = null, dur = 1, elapsed = 0, onDone = null;

  // recording
  let rec = null, chunks = [];

  const canvas = renderer.domElement;
  const fwdVec = new THREE.Vector3(), rightVec = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const dir = () => fwdVec.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));

  // ---- input (chỉ tác dụng khi active) ----
  window.addEventListener('keydown', (e) => { if (state.active) keys.add(e.code); });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  let drag = false, lx = 0, ly = 0;
  canvas.addEventListener('pointerdown', (e) => { if (state.active && state.mode === 'free') { drag = true; lx = e.clientX; ly = e.clientY; } });
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    yaw -= (e.clientX - lx) * 0.004;
    pitch = clamp(pitch - (e.clientY - ly) * 0.004, -1.45, 1.45);
    lx = e.clientX; ly = e.clientY;
  });
  window.addEventListener('pointerup', () => { drag = false; });

  function syncFromCamera() {
    // suy ra yaw/pitch từ hướng camera hiện tại để bay-tự-do liền mạch
    const d = new THREE.Vector3(); camera.getWorldDirection(d);
    yaw = Math.atan2(d.x, d.z);
    pitch = Math.asin(clamp(d.y, -1, 1));
  }

  const api = {
    get active() { return state.active; },
    marks: [],
    free(on = true) {
      state.active = !!on; state.mode = on ? 'free' : null;
      if (on) syncFromCamera();
      return on ? 'FREE-CAM: WASD di chuyển · kéo chuột xoay · Q/E lên-xuống · Shift chạy nhanh' : 'off';
    },
    setSpeed(s) { speed = +s || 45; return 'speed=' + speed; },
    stop() { state.active = false; state.mode = null; posCurve = null; return 'cinematic off — camera trả về lối chơi'; },

    // ghi điểm mốc: vị trí camera + điểm nó đang nhìn (cách 30m phía trước)
    mark() {
      const d = new THREE.Vector3(); camera.getWorldDirection(d);
      this.marks.push({ pos: camera.position.toArray().map(n => +n.toFixed(1)),
        look: camera.position.clone().addScaledVector(d, 30).toArray().map(n => +n.toFixed(1)) });
      return `đã ghi mốc #${this.marks.length}: ${JSON.stringify(this.marks[this.marks.length - 1])}`;
    },
    clearMarks() { this.marks.length = 0; return 'đã xoá mốc'; },
    dumpMarks() { return JSON.stringify(this.marks); },

    // bay theo path: keys=[{pos:[x,y,z], look:[x,y,z]}], trong `sec` giây
    play(kf, sec = 12, done) {
      if (!kf || kf.length < 2) return 'cần ≥2 điểm mốc';
      posCurve = new THREE.CatmullRomCurve3(kf.map(k => new THREE.Vector3(...k.pos)), false, 'catmullrom', 0.5);
      tgtCurve = new THREE.CatmullRomCurve3(kf.map(k => new THREE.Vector3(...(k.look || k.tgt))), false, 'catmullrom', 0.5);
      dur = Math.max(0.1, sec); elapsed = 0; onDone = done || null;
      state.active = true; state.mode = 'play';
      return `chạy path ${kf.length} mốc trong ${sec}s`;
    },
    playMarks(sec = 12, done) { return this.play(this.marks, sec, done); },

    // cảnh bay giới thiệu dải trung tâm (mốc quanh Nhà hát lớn / vườn hoa)
    demo(sec = 20, done) {
      const kf = [
        { pos: [-260, 120, 320], look: [0, 15, 9] },     // từ phía Tây nhìn về Nhà hát lớn
        { pos: [-40, 55, 190], look: [0, 12, 9] },       // hạ thấp, lướt vào quảng trường
        { pos: [90, 40, 40], look: [311, 8, -24] },      // ngoặt sang dải vườn hoa
        { pos: [320, 60, -30], look: [480, 8, -155] },   // lướt dọc dải vườn hoa
        { pos: [560, 110, -260], look: [700, 8, -670] }, // vút lên nhìn toàn dải
      ];
      return this.play(kf, sec, done);
    },

    update(dt) {
      if (state.mode === 'free') {
        const sp = speed * (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 3 : 1) * dt;
        dir(); rightVec.crossVectors(fwdVec, up).normalize();
        if (keys.has('KeyW')) camera.position.addScaledVector(fwdVec, sp);
        if (keys.has('KeyS')) camera.position.addScaledVector(fwdVec, -sp);
        if (keys.has('KeyD')) camera.position.addScaledVector(rightVec, sp);
        if (keys.has('KeyA')) camera.position.addScaledVector(rightVec, -sp);
        if (keys.has('KeyE') || keys.has('Space')) camera.position.y += sp;
        if (keys.has('KeyQ')) camera.position.y -= sp;
        dir(); camera.lookAt(camera.position.clone().add(fwdVec));
      } else if (state.mode === 'play' && posCurve) {
        elapsed += dt;
        const t = Math.min(1, elapsed / dur), te = easeInOut(t);
        camera.position.copy(posCurve.getPoint(te));
        camera.lookAt(tgtCurve.getPoint(te));
        if (t >= 1) { state.mode = 'free'; syncFromCamera(); const cb = onDone; onDone = null; if (cb) cb(); }
      }
    },

    // ---- quay video (.webm) trực tiếp từ canvas ----
    startRec(fps = 60, mbps = 16) {
      if (rec) return 'đang quay rồi';
      try {
        const stream = canvas.captureStream(fps);
        const mt = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
          .find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || 'video/webm';
        chunks = [];
        rec = new MediaRecorder(stream, { mimeType: mt, videoBitsPerSecond: mbps * 1e6 });
        rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
        rec.start();
        return '● ĐANG QUAY (' + mt + ')';
      } catch (err) { rec = null; return 'lỗi quay: ' + err.message; }
    },
    stopRec(name = 'hp_trailer') {
      if (!rec) return 'chưa quay';
      return new Promise((res) => {
        rec.onstop = () => {
          const blob = new Blob(chunks, { type: 'video/webm' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob); a.download = name + '.webm';
          document.body.appendChild(a); a.click(); a.remove();
          rec = null; res('đã lưu ' + name + '.webm (' + Math.round(blob.size / 1e6 * 10) / 10 + ' MB)');
        };
        rec.stop();
      });
    },
    // tiện: bay demo + tự quay, xong tải file về
    recordDemo(sec = 20, name = 'hp_trailer') {
      this.startRec();
      this.demo(sec, () => setTimeout(() => this.stopRec(name), 400));
      return 'quay demo ' + sec + 's rồi tự tải ' + name + '.webm';
    },
  };
  return api;
}
