// Bàn phím + joystick cảm ứng
import { IS_MOBILE, HAS_TOUCH } from './device.js';
export const input = {
  forward: 0, right: 0,      // -1..1 (đã gộp bàn phím + joystick)
  run: false,
  jump: false,               // edge-triggered, tiêu thụ bằng consumeJump()
  interact: false,           // edge-triggered, tiêu thụ bằng consumeInteract()
  isTouch: false,
};

const keys = {};
let joyX = 0, joyY = 0;

export function consumeInteract() {
  const v = input.interact; input.interact = false; return v;
}
export function consumeJump() {
  const v = input.jump; input.jump = false; return v;
}

function recompute() {
  let f = 0, r = 0;
  if (keys['KeyW'] || keys['ArrowUp']) f += 1;
  if (keys['KeyS'] || keys['ArrowDown']) f -= 1;
  if (keys['KeyD'] || keys['ArrowRight']) r += 1;
  if (keys['KeyA'] || keys['ArrowLeft']) r -= 1;
  f += joyY; r += joyX;
  input.forward = Math.max(-1, Math.min(1, f));
  input.right = Math.max(-1, Math.min(1, r));
  input.run = !!(keys['ShiftLeft'] || keys['ShiftRight']) || Math.hypot(joyX, joyY) > 0.85;
}

export function initInput() {
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    keys[e.code] = true;
    if (e.code === 'Space') { input.jump = true; e.preventDefault(); }
    if (e.code === 'KeyE' || e.code === 'Enter') input.interact = true;
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
    recompute();
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; recompute(); });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; recompute(); });

  // --- Joystick cảm ứng ---
  const joy = document.getElementById('joystick');
  const knob = document.getElementById('joyKnob');
  let joyId = null;

  function setKnob(dx, dy) {
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }
  function joyMove(e) {
    const touch = [...e.changedTouches].find((tc) => tc.identifier === joyId);
    if (!touch) return;
    const rect = joy.getBoundingClientRect();
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    let dx = touch.clientX - cx, dy = touch.clientY - cy;
    const max = rect.width / 2 - 20;
    const len = Math.hypot(dx, dy);
    if (len > max) { dx = dx / len * max; dy = dy / len * max; }
    setKnob(dx, dy);
    joyX = dx / max; joyY = -dy / max;
    recompute();
  }
  joy.addEventListener('touchstart', (e) => {
    input.isTouch = true;
    if (joyId === null) { joyId = e.changedTouches[0].identifier; joyMove(e); }
    e.preventDefault();
  }, { passive: false });
  joy.addEventListener('touchmove', (e) => { joyMove(e); e.preventDefault(); }, { passive: false });
  function joyEnd(e) {
    if ([...e.changedTouches].some((tc) => tc.identifier === joyId)) {
      joyId = null; joyX = 0; joyY = 0; setKnob(0, 0); recompute();
    }
  }
  joy.addEventListener('touchend', joyEnd);
  joy.addEventListener('touchcancel', joyEnd);

  // --- Nút cảm ứng ---
  const btnA = document.getElementById('btnActionT');
  const btnJ = document.getElementById('btnJumpT');
  btnA.addEventListener('touchstart', (e) => { input.interact = true; e.preventDefault(); }, { passive: false });
  btnJ.addEventListener('touchstart', (e) => { input.jump = true; e.preventDefault(); }, { passive: false });

  // Hiện điều khiển cảm ứng khi CON TRỎ CHÍNH là ngón tay (điện thoại/tablet). Laptop có màn cảm ứng nhưng
  // dùng chuột: chỉ hiện khi có touchstart THẬT (joystick từng che góc màn laptop + prompt E thành ✦).
  const showTouch = () => { input.isTouch = true; document.getElementById('touchControls').classList.remove('hidden'); };
  const coarsePrimary = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches);
  if (IS_MOBILE || coarsePrimary) showTouch();
  else if (HAS_TOUCH) window.addEventListener('touchstart', showTouch, { once: true, passive: true });
}
