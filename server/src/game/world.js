// game/world.js — OWNER: S2. The entity table of the single-process world (ARCH §3.3 stage A): one Entity per player
// (visible to others once READY), the 128 m cell grid used by AOI and SAY chat, and netId allocation.
// Pure module (no app, no I/O) so the AOI / snapshot code can be unit-tested and benchmarked without sockets.
import { CELL_COUNT, cellOf, cellWithHysteresis, cellsInRange } from '../../../js/shared/grid.js';
import { qPos, qY, qYaw, qSpd, packState } from '../../../js/shared/quant.js';
import { MODE, AOI } from '../../../js/shared/constants.js';
import { APPEARANCE_BYTES } from '../../../js/shared/codec.js';

let GEN = 0;

export class Entity {
  constructor(netId, accountId) {
    this.gen = ++GEN;              // unique per entity instance (netIds are reused; names caches compare gen)
    this.netId = netId;
    this.accountId = accountId;
    this.session = null;
    this.name = '';
    this.badge = 0;
    this.appearance = new Uint8Array(APPEARANCE_BYTES);
    this.x = 0; this.z = 0; this.y = 2; this.yaw = 0; this.spd = 0;
    this.mode = MODE.WALK; this.flags = 0; this.vehicleRef = 0;
    // quantised wire values (recomputed once per accepted STATE, never per snapshot)
    this.qx = 0; this.qz = 0; this.qy = 0; this.qyaw = 0; this.qspd = 0; this.state = 0;
    this.k1 = 0; this.k2 = 0;      // change keys: k1 = qx | qz << 16, k2 = qy | qyaw << 8 | qspd << 16 | state << 24
    this.cell = -1; this.cellIdx = -1;
    this.inWorld = false;
    this.moved = 0;                // monotonically increasing change counter
    this._aoiTok = 0; this._aoiSlot = -1;   // scratch of the AOI step currently running (aoi.js)
  }
  setPose(x, z, y, yaw, spd, mode, flags) {
    this.x = x; this.z = z; this.y = y; this.yaw = yaw; this.spd = spd; this.mode = mode & 7; this.flags = flags & 31;
    this.requant();
  }
  requant() {
    this.qx = qPos(this.x); this.qz = qPos(this.z); this.qy = qY(this.y); this.qyaw = qYaw(this.yaw);
    this.qspd = qSpd(this.spd); this.state = packState(this.mode, this.flags);
    const k1 = (this.qx | (this.qz << 16)) >>> 0;
    const k2 = (this.qy | (this.qyaw << 8) | (this.qspd << 16) | (this.state << 24)) >>> 0;
    if (k1 !== this.k1 || k2 !== this.k2) { this.k1 = k1; this.k2 = k2; this.moved++; }
  }
}

export class World {
  constructor() {
    this.cells = new Array(CELL_COUNT);
    for (let i = 0; i < CELL_COUNT; i++) this.cells[i] = [];
    this.byNetId = new Map();
    this.count = 0;               // entities in the grid
    this.nextNetId = 1 + Math.floor(Math.random() * 1000);
    this.recent = new Map();      // netId → {accountId, until} of entities that left (REPORT after they leave)
    this._nb = new Int32Array(49);
  }
  allocNetId() {
    for (let i = 0; i < 65535; i++) {
      const id = this.nextNetId;
      this.nextNetId = id >= 65535 ? 1 : id + 1;
      if (!this.byNetId.has(id)) return id;
    }
    throw new Error('world: no free netId');
  }
  createEntity(accountId) {
    const e = new Entity(this.allocNetId(), accountId);
    this.byNetId.set(e.netId, e);
    return e;
  }
  // release the netId (entity must already be out of the grid)
  destroy(e, now = Date.now()) {
    if (e.inWorld) this.remove(e);
    if (this.byNetId.get(e.netId) === e) this.byNetId.delete(e.netId);
    this.recent.set(e.netId, { accountId: e.accountId, until: now + 10 * 60 * 1000 });
  }
  // account behind a netId, current or recently left (for REPORT)
  accountOf(netId, now = Date.now()) {
    const e = this.byNetId.get(netId);
    if (e) return e.accountId;
    const r = this.recent.get(netId);
    return r && r.until > now ? r.accountId : null;
  }
  sweepRecent(now = Date.now()) {
    for (const [k, v] of this.recent) if (v.until <= now) this.recent.delete(k);
  }
  add(e) {
    if (e.inWorld) return;
    e.cell = cellOf(e.x, e.z);
    const arr = this.cells[e.cell];
    e.cellIdx = arr.length;
    arr.push(e);
    e.inWorld = true;
    this.count++;
  }
  remove(e) {
    if (!e.inWorld) return;
    const arr = this.cells[e.cell];
    const last = arr.pop();
    if (last !== e) { arr[e.cellIdx] = last; last.cellIdx = e.cellIdx; }
    e.cell = -1; e.cellIdx = -1; e.inWorld = false;
    this.count--;
  }
  // call after changing e.x / e.z: moves the entity between cells with hysteresis (AOI.HYST)
  relocate(e) {
    if (!e.inWorld) return;
    const c = cellWithHysteresis(e.cell, e.x, e.z, AOI.HYST);
    if (c === e.cell) return;
    const arr = this.cells[e.cell];
    const last = arr.pop();
    if (last !== e) { arr[e.cellIdx] = last; last.cellIdx = e.cellIdx; }
    e.cell = c;
    const to = this.cells[c];
    e.cellIdx = to.length;
    to.push(e);
  }
  // visit every entity within radius r of (x, z) (cells overlapping the disc + hysteresis, NET-5); fn(e, d2) returning
  // true stops. `cell` is accepted for compatibility and ignored.
  forNear(x, z, r, fn, cell) {
    void cell;
    const nb = this._nb;
    const n = cellsInRange(x, z, r, nb);
    const r2 = r * r;
    for (let i = 0; i < n; i++) {
      const arr = this.cells[nb[i]];
      for (let j = 0; j < arr.length; j++) {
        const e = arr[j];
        const dx = e.x - x, dz = e.z - z;
        const d2 = dx * dx + dz * dz;
        if (d2 <= r2 && fn(e, d2)) return;
      }
    }
  }
  // number of entities within r of each point (spawn crowding)
  countNear(points, r) {
    const out = new Array(points.length).fill(0);
    for (let i = 0; i < points.length; i++) this.forNear(points[i].x, points[i].z, r, () => { out[i]++; });
    return out;
  }
}
