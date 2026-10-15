// bản giả js/world.js cho test node (MP-2 C2): nền phẳng LAND_H 2, một "mặt cầu" 4,1 m ở x ∈ [100, 200]
export function surfaceY(x, z, yRef) { const g = 2; return x >= 100 && x <= 200 && yRef + 1.2 >= 4.1 ? 4.1 : g; }
export function spawnY(x, z) { return surfaceY(x, z, 10); }
