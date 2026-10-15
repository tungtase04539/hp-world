// game/encoder.js — OWNER: S2. Per-client snapshot assembly with js/shared/codec.js SnapshotBuilder from an AoiFrame
// (game/aoi.js). Entities are quantised once per accepted STATE (world.js Entity.requant), never per snapshot; one
// Writer is reused for every client (send() copies). NAMES for players a client sees for the first time this session.
// Backpressure (bufferedAmount > NET.DROP_SNAPSHOT_BUFFERED) is handled by the caller (game/sim.js): the snapshot is
// skipped BEFORE aoiStep and the next one is a keyframe.
import { SnapshotBuilder, encodeNames } from '../../../js/shared/codec.js';
import { SNAP_FLAG } from '../../../js/shared/protocol.js';

// Write the snapshot for `self` (the observer's Entity) from `frame`. Returns a Uint8Array view of w.
export function encodeFrame(sb, tick, self, corrEpoch, lastSeq, frame, degraded) {
  let flags = 0;
  if (frame.keyframe) flags |= SNAP_FLAG.KEYFRAME;
  if (degraded) flags |= SNAP_FLAG.DEGRADED;
  sb.begin(tick >>> 0, flags, self.qx, self.qz, self.qy, corrEpoch & 255, lastSeq & 0xffff);
  for (let i = 0; i < frame.nLeave; i++) sb.leave(frame.leaves[i]);
  sb.enters();
  for (let i = 0; i < frame.nEnter; i++) {
    const e = frame.enterEnt[i];
    sb.enter(frame.enterSlot[i], e.netId, e.qx, e.qz, e.qy, e.qyaw, e.qspd, e.state, e.appearance);
    frame.enterEnt[i] = null;
  }
  sb.updates();
  for (let i = 0; i < frame.nUpd; i++) {
    const e = frame.updEnt[i];
    sb.update(frame.updSlot[i], e.qx, e.qz, e.qy, e.qyaw, e.qspd, e.state);
    frame.updEnt[i] = null;
  }
  return sb.end();
}

// NAMES message for a list of entities
const nameScratch = [];
export function encodeNamesFor(w, ents) {
  nameScratch.length = 0;
  for (const e of ents) nameScratch.push({ netId: e.netId, name: e.name, badge: e.badge });
  return encodeNames(w, nameScratch);
}

export function createSnapshotBuilder(w) { return new SnapshotBuilder(w); }

export function register(app) { void app; }
