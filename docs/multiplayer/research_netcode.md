# Netcode research for Hải Phòng 3D multiplayer (target: more than 1,000 CCU in one city world)

Date: 2026-10-14. Scope: browser (three.js, no build step), players mostly in Vietnam on mobile + desktop, one shared world (the ~3.2 km play disc), survival + jobs + quests on top.

Confidence tags used below:
- **[S]** sourced fact, URL in section 15.
- **[V]** vendor or community claim, not independently verified.
- **[E]** my engineering estimate or recommendation. Treat as a hypothesis and validate with the load tests in section 12.

---

## 0. Executive summary (decisions)

| # | Decision | Why (short) |
|---|---|---|
| 1 | **WebSocket over TLS, binary frames, one connection per client.** Put a transport interface in the client so WebTransport can be added later. | WebSocket works everywhere and CDN/proxy friendly. WebTransport is now in Chrome 97+, Firefox 114+, Safari 26.4+ (91.6% global per caniuse) but needs an HTTP/3 server and Node libraries are immature. [S] |
| 2 | **Server-authoritative, input-based protocol.** Client sends movement commands (not positions). Client predicts, server reconciles. Fixed 30 Hz movement step shared by client and server in ONE JS module. | Speed/teleport hacks are impossible by construction; prediction needs a fixed step, but the game today uses variable dt (`Math.min(delta, 0.05)`). [S repo] |
| 3 | **Server world loop 20 Hz, snapshots 10 Hz** to each client, interpolation delay about 200 ms (adaptive 150-350 ms). | Valve default 20 updates/s with 100 ms lerp; Gaffer: buffer = 2-3 send intervals. For non-combat movement this is ample. [S] |
| 4 | **Interest management: uniform grid, cell 128 m, 3x3 neighbourhood (about 384 m square, about 19 players on average at 1,000 CCU), plus per-client cap of 96 records per snapshot with a priority accumulator.** | Grid/spatial-hash is the standard (Mirror, Unreal Replication Graph). Hotspots (spawn plaza, Opera House) are the real danger, not the average. [S][E] |
| 5 | **Binary bit-packed snapshots, delta against the previous message sent to that client (no acks needed because WebSocket is reliable and ordered).** Approx 3 B per moving entity vs 52 B as JSON. | Quantization + deltas give 10-20x. TCP makes baselines trivial. [S][E] |
| 6 | **Traffic and ambient crowd stay client-side and cosmetic** (not synced). Only gameplay-relevant NPCs/vehicles are synced (server-owned, low rate, or "rail" pure functions of server time). Today's `traffic.js` cannot be made lockstep-deterministic as written. | It is player-centred, uses wall-clock timers and a call-order LCG. Syncing 200 cars would cost about 6 KB/s per client for no gameplay value. [S repo][E] |
| 7 | **Anti-cheat = server authority + time-budget on commands + speed/teleport/bounds checks + all economy server-side.** Never auto-ban on one violation. | Standard practice; main false-positive source is frame-rate/lag variance. [S] |
| 8 | **Chat: AOI-scoped, strict rate limits, Vietnamese-aware local filter, async ML check, report/mute.** Do not depend on Google Perspective API (shuts down 2026-12-31). | [S] |
| 9 | **Bot/abuse: Cloudflare Turnstile at join, short-lived signed join ticket, Origin check, per-connection token buckets, admission queue.** Do NOT rely on per-IP limits alone (Viettel uses carrier-grade NAT). | [S][E] |
| 10 | **Load test with custom headless Node bots using the production codec** (primary), k6 for handshake/connection storms, `tc netem` for RTT/loss. Never run many real WebGL Chrome instances (project memory: GPU BSOD risk, use `tools/qa/gpulock.mjs`). | k6/Artillery are weak for custom binary protocols; Colyseus guidance is about 200 clients per process, one process per core. [S] |
| 11 | **LEGAL FLAG for the owner:** Decree 147/2024/ND-CP requires G1 online games (multiplayer interacting through the operator's server) to verify player accounts by a Vietnamese mobile number, store player data in Vietnam, and limit under-18 playtime. This conflicts with "play instantly with a nickname". Needs a Vietnamese lawyer before launch. | [S] (secondary legal summaries, see 15) |

Headline numbers [E]: 1,000 CCU needs roughly **10-25 Mbps outbound and 8 Mbps inbound**, about **5-11 MB per player-hour**, and **one core at 25-60% CPU** for sim + snapshot encode + TLS if you do the work in one process, which is why the architecture should allow parallel snapshot encoders from day one (section 3).

---

## 1. What the repo tells us (facts that shape the netcode)

Read from `C:/Users/Admin/hp-world` (branch dot3, read-only) and `PROJECT_MAP.md`.

| Fact | Where | Consequence |
|---|---|---|
| Frame `dt = Math.min(clock.getDelta(), 0.05)`; movement integrates with variable dt; mobile TIER<=1 renders every 2nd vsync. | `js/main.js:707`, `:641`, `:705` | Prediction/reconciliation needs a **fixed-step** movement function. Must be refactored out of the render loop into a pure `stepPlayer(state, cmd, dtFixed)`. |
| Player constants today: WALK 3.0, RUN 7.0 m/s, GRAV 26, JUMP 6.5 (apex about 0.81 m). | `js/main.js:333` | Anti-cheat speed limits must come from a **shared constants module**, because audit item 40 proposes more realistic speeds and values have already changed once (PROJECT_MAP said 5/11). |
| Vehicles: motorbike top 16 m/s, accel 3.6, wheelbase 1.25, kinematic-bicycle steering (`yaw = v/wb * tan(steer)`), cyclo 4.2 m/s, boat 10 m/s. | `js/vehicles.js:155-208` | Kinematic model is cheap and deterministic enough to predict. Uses `Math.tan`: fine, because reconciliation absorbs sub-millimetre divergence. |
| Play disc: `PLAY_RADIUS = BUILD_RADIUS - 12`, about R=1588 m around Nhà hát lớn (diameter about 3.18 km, area about 7.92 km2). | `js/main.js:126`, PROJECT_MAP | 16-bit position at 5 cm resolution spans 3,277 m, which just covers the disc diameter. At 1,000 CCU average density is only about 126 players/km2. |
| Collision is circles via `world.resolveCollisions(p, r)` inside the 21,900-line `world.js`, which builds three.js meshes. | PROJECT_MAP 2.7 | The server cannot import this. Need a headless `shared/world_static` (footprints, colliders, `landAt`, `groundHeight`) generated by `tools/process_osm.mjs` (project rule: `mapdata.js` is generated). Without it the server can only check speed/bounds/water, not walls. |
| Traffic (`traffic.js`, 885 lines): a **bubble around the local player** (spawn/despawn at RB+40), wall-clock timers (`performance.now()`), shared module-level LCG `rnd()` consumed in call order, far agents stepped every 2nd/4th frame with accumulated dt (clamped 0.2 s), speed limited by `followLimit(a, px, pz)` and `avoidPlayer(...)` which read the local player position. | `js/traffic.js:60-62, 588-600, 747-785` | Two clients will diverge within seconds even with the same seed. Cannot be turned into lockstep without a rewrite. Section 8 gives the options. |
| 7 NPCs at fixed spots, interaction radii: NPC 4 m, sign 9 m, vehicle 5 m. | PROJECT_MAP | Server-owned static NPCs cost zero bandwidth (positions in shared data). Interaction checks become server-side distance checks. |

---

## 2. Transport

### 2.1 Options compared

| | WebSocket (TCP+TLS) | WebTransport (HTTP/3, QUIC) | WebRTC DataChannel (unordered, maxRetransmits 0) |
|---|---|---|---|
| Browser support | Universal | Chrome/Edge 97+, Firefox 114+, **Safari 26.4+** (March 2026), 91.64% global usage per caniuse; MDN says Baseline 2026 "newly available" [S] | Universal but complex |
| Unreliable datagrams | No | Yes (`transport.datagrams`) [S] | Yes |
| Head-of-line blocking | Yes: one lost TCP segment stalls everything behind it [S Gaffer] | No between streams; datagrams unordered [S] | No |
| Server side (Node) | Excellent (`ws`, uWebSockets.js) | Limited: MDN lists `webtransport-go`, `aioquic`, `wtransport`, `@fails-components/webtransport`; needs HTTP/3 + extended CONNECT + Origin check [S] | STUN/ICE/TURN complexity designed for P2P [S Gaffer] |
| CDN/proxy | Fully compatible | Experimental / limited (websocket.org, 2025, partly stale: it still says Safari unsupported) [S] | Needs TURN for some NATs |

### 2.2 Recommendation
- **Ship WebSocket now.** Movement at 10 Hz snapshots tolerates TCP stalls if the interpolation buffer is sized for them (section 6). This is an open-world city walker, not an FPS.
- Build `net/transport.js` with `send(bytes)`, `onmessage(bytes)`, `getBufferedAmount()` so that WebTransport datagrams (for snapshots) + one reliable stream (for events/chat) can be added in 2027 behind a feature flag. If you add datagrams you lose the "reliable, so no acks" simplification (section 5.3) and must add snapshot sequence numbers + acked baselines (Gaffer/Quake 3 style).
- Do not use `permessage-deflate`: `ws` warns it "adds a significant overhead in terms of performance and memory consumption" and can cause "catastrophic memory fragmentation" under concurrency; uWebSockets.js has it disabled by default. Our payloads are already bit-packed. [S]

### 2.3 WebSocket production settings (uWebSockets.js defaults shown) [S] + [E] recommended values

| Setting | uWS default [S] | Recommended [E] |
|---|---|---|
| `compression` | DISABLED | DISABLED |
| `maxPayloadLength` (incoming) | 16 KB | **512 B** (largest legit message: chat 140 chars = at most about 420 B in UTF-8 for Vietnamese) |
| `idleTimeout` | 120 s | **20 s**, with app-level ping every 5 s (`ws` docs suggest 30 s ping/terminate pattern) |
| `maxBackpressure` | 64 KB | keep 64 KB, and set `closeOnBackpressureLimit: true` |
| `ws.send()` return | 1 ok / 0 backpressure building / 2 dropped | If `getBufferedAmount() > 16 KB` skip this snapshot (**latest wins**) and flag the client for a keyframe (full state of its AOI) |
| Batching | `ws.cork(cb)` batches into one syscall / TLS block | Send exactly **one message per client per snapshot tick**; cork the burst |

Wire overhead per WS message [S]: frame header 2-14 B (server to client is unmasked: 2-4 B for our sizes; client to server adds a 4 B mask); TLS 1.3 record about 22 B [E]; TCP/IP about 40-52 B [E]. Assume **about 68 B per message** when budgeting. That is why we send fewer, larger messages and not one per event.

Browser keep-alive on mobile: tabs get throttled/suspended; Wi-Fi/4G switches break TCP. Need `resume token` reconnect within 60 s that re-attaches the same avatar [E].

---

## 3. Server architecture and capacity at 1,000 CCU

### 3.1 Reference points
| Reference | Number | Note |
|---|---|---|
| Colyseus FAQ | 1 vCPU / 1 GB handles **1,000-2,000** concurrent connections for *simple* games; **2-5 KB RAM per connection**; default patch rate **50 ms** (20 Hz); Linux default 1,024 file descriptors until `ulimit -n` raised | [S] "always load test your use case" |
| Colyseus maintainer (Cocos interview) | about 1,500 CCU per room "easily", depends on game loop; split a big world over processes | [V] verbal |
| Colyseus forum | poker lobby stuck at about 3,500 idle clients at 15% CPU; t2.micro with 16-player rooms topped out at about 375 players | [V] anecdotes |
| Go, 1 goroutine/connection | about 20 KB per connection; epoll design cut a million connections to about 600 MB | [S] 2019 talk, secondary |
| uWebSockets.js | 1 M mostly-idle sockets on one thread (2019 write-up); README: "one app per thread ... let uWS share the listening port" | [S]/[V] |
| Node+Socket.IO browser game on 4 vCPU | at about 500 players CPU low but **event-loop lag high** due to per-keystroke typing broadcasts; "1000+ without issue" after removing them | [V] HN comment. Lesson: fan-out volume, not connection count, is the bottleneck. |
| Tribes (1998) | designed for about **2 KB/s per client** over 28.8k modems; priority-ordered, skip-count-boosted object updates | [S] |
| JSConf Asia Node game server deck | 800 CCU per area, 7,000 per group of servers at 80% CPU cap | [V] old |

Conclusion: connection count is not the problem; **per-tick fan-out work and tail latency (GC, event-loop lag)** are. A well-written single Node process can plausibly hold 1,000 connections, but with thin headroom in crowds.

### 3.2 CPU model for one authoritative process [E]

Assumptions: 1,000 clients, 30 Hz movement commands applied on arrival, 20 Hz world loop, 10 Hz snapshots.

| Work item | Typical (about 19 entities in view) | Crowd worst case (all 1,000 see about 80) |
|---|---|---|
| Apply movement commands (about 1-5 µs each incl. collision) | 1000 x 30 x 3 µs = about 90 ms/s | same |
| Grid cell migration (movers only) | negligible | negligible |
| Build snapshots (about 0.5 µs per entity record incl. delta compare + bit write) | 1000 x 19 x 0.5 µs = **9.5 ms per snapshot tick**, 95 ms/s | 1000 x 80 x 0.5 µs = **40 ms per snapshot tick**, 400 ms/s |
| `ws.send` x 10,000/s (TLS + syscall, about 10 µs) | about 100 ms/s | same |
| **Total CPU of one core** | **about 29%** | **about 60%** (and 40 ms spikes against a 50 ms tick) |

So: feasible, not comfortable. Unrealistic worst case "everyone in one hotspot" is what the cap + accumulator (section 4) and the degradation ladder (section 4.5) exist for.

### 3.3 Recommended process model (staged)
1. **Stage 1 (up to about 300-500 CCU, ship first):** single Node process, uWebSockets.js, authoritative state in structure-of-arrays typed arrays (`Float32Array x[], z[], yaw[]`...), zero per-tick allocations (preallocated `ArrayBuffer`+`DataView` writer), telemetry from day one (event-loop delay p99, tick time, bytes/s).
2. **Stage 2 (500-3,000 CCU): split I/O from simulation inside one machine.** N gateway `worker_threads`, each with its own uWS app on the shared port (per uWS README), owning a subset of sockets; one sim thread owning the world. State exchange via `SharedArrayBuffer` double-buffered per tick (`Atomics.store` of the completed tick index) so gateway threads build per-client snapshots in parallel and lock-free; inputs go gateway to sim through a SAB ring buffer. This removes the 40 ms crowd spike from the sim thread. No spatial sharding needed yet.
3. **Stage 3 (beyond about 3,000 or for HA):** spatial zone processes (e.g. 2x2 or 3x3 blocks with 150 m mirrored "ghost" border bands) plus cross-zone handoff. Only if the product proves demand; expensive in complexity.
- Keep the **movement/survival rules in shared JS** (client = server), because rewriting the step function in Go/Rust risks client/server mismatch, which shows up as constant rubber-banding.
- Admission control: hard cap CCU (suggest 1,200 for a 1,000 target) with a login queue and ETA rather than degrading everyone.

### 3.4 Hosting-model note (for the cost-tier task)
- Cloudflare Durable Objects: Hibernation API allows max **32,768 WebSockets per object**; incoming WS messages bill at 20:1; paid plan includes 1 M requests and 400,000 GB-s, then $0.15/M requests and $12.50/M GB-s; duration billed at 128 MB per object [S]. A 20 Hz game loop with timers prevents hibernation, so expect continuous duration billing, and a single object is one JS isolate (single-threaded). Reported "soft limit about 1,000 req/s per object" is third-party and unverified [V]. Verdict [E]: fine for lobby/presence/chat/leaderboards, **risky as the 1,000-CCU world simulator**; needs a prototype before committing.
- Region/latency: hosting-vendor estimates for ping to a Singapore server: HCMC 30-50 ms, Da Nang 40-60 ms, Hanoi 50-70 ms [V]; Hải Phòng is near Hanoi so assume **50-75 ms RTT fixed-line, 70-120 ms p50 and 200-300 ms p95 on 4G/5G** [E]. Ookla last-mile mobile median latency in Vietnam was 19-26 ms in 2021 for Vinaphone/MobiFone/Viettel, but that is to local test servers [S]. Measure real RTT/jitter with in-client telemetry in the first closed test and size buffers from it.
- Egress may be the real cost lever in some regions (one review claims Hetzner Singapore/US include only 0.5-1 TB [V], unverified). Our estimate is 3.4-8 TB per month for 1,000 CCU 24x7, or 47-112 GB per 10,000 player-hours (section 5.5).

---

## 4. Interest management (area of interest, AOI)

### 4.1 State of the art
- **Mirror (Unity)**: Distance checking is O(entities x connections); its Spatial Hashing sends each connection the entities in the **8 neighbouring cells + own**, described as about 30x faster than distance checking in early uMMORPG tests [S]; hex variant recommended; `rebuildInterval` default 1 s.
- **Unreal Replication Graph (Fortnite)**: 100 connections and about 50,000 replicated actors made per-actor-per-client relevancy a CPU bottleneck; the fix is graph nodes with a **spatial grid** where each actor is registered in every cell from which it may be seen, and dormant actors kept in separate lists [S].
- **Boulanger et al. (NetGames 2006)**, measured on a real MMO: obstacle-aware methods cut update traffic by up to 6x; inexpensive **tile-based** methods approximate ideal visibility-based IM at very low cost [S].
- **Tribes**: scope then priority; objects that were skipped get a skip counter that raises priority; fill each packet to the bandwidth budget [S].
- **Gaffer priority accumulator**: one float per object, add priority every send, sort, send what fits, reset sent ones. Guarantees low-priority objects still get updates; max 64 updates per packet in his demo [S].

### 4.2 Recommended design [E]
| Parameter | Value | Reasoning |
|---|---|---|
| Grid | square cells **128 m** (power of two), about 484 cells inside the disc | 3x3 block = 384 m square = 0.147 km2, about **18.6 players** on average at 1,000 CCU |
| Subscription | each client subscribes to its cell + 8 neighbours; recompute only when the player crosses a cell boundary (with **hysteresis**: change cell when 8 m past the border) | avoids thrash on borders; removes per-tick distance checks |
| Visible radius on top of cells | 160 m hard, 120 m default; far records at half rate | small avatars are unreadable beyond about 150 m |
| Records per snapshot | **max 96** and payload <= **1,100 B** (fits one TCP segment on a typical mobile path MTU, avoiding a partial-segment stall) | keeps HOL stalls short |
| Selection when over cap | priority = 1/(distance+10) x type weight (self-adjacent vehicles, friends/party, quest targets boosted) with accumulator | Gaffer/Tribes pattern |
| Enter/leave | explicit `ENTER(id, appearance)` (about 15 B) and `LEAVE(id)` (2 B) records; client keeps a local table | enters/s per client at 1,000 CCU: about 0.15 (walk), 0.34 (run), 0.78 (motorbike) |
| LOD rates (phase 2) | <= 40 m: 20 Hz (vehicles), 40-120 m: 10 Hz, 120-160 m: 5 Hz | spends bandwidth where lag is visible |
| Non-player entities | static NPCs/shops: never sent (shared data); wandering NPC / vehicle owned by server: AOI like players | |

### 4.3 The hotspot problem (N-squared)
All-pairs visibility in one crowd costs `clients x visible x rate`. Example: 300 players in one plaza, uncapped: 300 x 299 x 10 Hz = about **897,000 records/s** (about 45 ms per snapshot tick on one core at 0.5 µs each); capped at 80: 300 x 80 x 10 = **240,000/s**. Design for hotspots: spawn plaza, Opera House, markets, events. Add a "crowd mode" visual rule on the client (draw beyond 40 nearest as cheap impostors) that is independent of the network cap.

### 4.4 No player-to-player body collision in v1
Predicted players pushing each other creates reconciliation fights. Make avatars pass through each other (ghost) and resolve only vs static world and special vehicle events. Many persistent-world games do this [E].

### 4.5 Degradation ladder (load shedding) [E]
Trigger on rolling p99 tick time (budget 50 ms at 20 Hz) or event-loop delay p99:
- L0 normal. L1 (>25 ms): far tier 5 Hz to 2.5 Hz. L2 (>35 ms): visible radius 120 m to 80 m. L3 (>45 ms): snapshots 10 Hz to 5 Hz for all but self + nearest 16. L4: stop admitting new connections (queue). Log every transition.

---

## 5. Snapshot encoding and bandwidth

### 5.1 What the literature says (numbers to anchor on) [S]
Gaffer On Games, 901 cubes, 60 Hz:
- Naive: 321 bits per cube, **17.37 Mbps**. Target 256 kbps.
- Smallest-three quaternion: 128 to **29 bits** (2-bit index + 3x9 bits, range +-0.707).
- Position bounded to [-256, 255] m x [0, 32] m at 512 steps/m (about 2 mm): **50 bits** (from 96). Cube state 10 bytes, about 1/4 of the original.
- Delta vs a baseline about one RTT old: unchanged = 1 bit. Relative position average **26.1 bits** per changed cube; relative orientation **23.3 bits** (80.3% of absolute).
- Steady state with nothing moving: about **15 kbps**, mostly header/IP/UDP.
- Gaffer: delta compression with acks gave "roughly another order of magnitude" but "at significant complexity cost".
- Quake 3: server keeps the last 32 snapshots, sends deltas against the **last acknowledged** snapshot, acks piggy-backed on normal traffic; a zeroed dummy state is the baseline for new clients [S].

### 5.2 Our quantization (play disc 3,176 m) [E]
| Field | Bits | Resolution / range | Note |
|---|---|---|---|
| entity id | 16 | session-unique player/NPC id | |
| x, z (absolute) | 16 + 16 | **5 cm**, u16 spans 3,277 m, covers disc diameter | |
| y | 0 (derived) or 8 | derived from client `groundHeight(x,z)`; 8-bit level/offset only for decks/bridges/airborne | saves 1-2 B/entity |
| yaw | 8 | 1.4 deg | remote avatars only |
| speed | 6 | 0.5 m/s steps, 0-31.5 | also drives walk-cycle animation |
| state/anim/vehicle flags | 10 | idle/walk/run/jump/mounted(type)/horn... | |
| **Absolute record** | **72 bits = 9 B** | | used for ENTER and keyframes |
| Delta record (moving) | about 24-30 bits (about 3.5 B) | dx,dz in 5 cm units: 7-bit signed covers +-3.2 m, walking at 10 Hz is 6 units, motorbike 16 m/s is 32 units; yaw delta 4 bits; speed/state 4 bits; 2-3 bits size class | |
| Delta record (stationary) | 1 bit in an "unchanged" mask | idle players are common near shops | |
| **Own state to self** | about 14 B | 1 cm precision (i32 relative to disc centre), velocity, yaw 16 bit, `lastProcessedInputSeq` u16 | higher precision so reconciliation error can reach about 0 |

### 5.3 Why delta is simple here
Quake 3 / Gaffer need acks because UDP loses packets. **WebSocket is reliable and ordered**, so the server can delta each snapshot against the *previous message it sent to that client* with no ack protocol. The only failure case is when the server deliberately drops a snapshot for backpressure; then it sets `needKeyframe` and sends absolute records. Per-client "last sent" state is about 1,000 x 80 x 16 B = **1.3 MB** total. If you ever move snapshots to unreliable datagrams, you must add sequence numbers, acked baselines and the Quake 3 style 32-snapshot history.

### 5.4 Message catalogue (first byte = opcode) [E]
| Dir | Op | Payload | Rate |
|---|---|---|---|
| C to S | INPUT | seq u16, n u8, n x {fwd i8, turn i8, flags u8} (n up to 3) | 15-20 msgs/s while moving (batch 2 commands of 30 Hz), 2 Hz idle heartbeat |
| C to S | ACTION | type u8, target u16, arg u16 (interact, buy, mount, eat) | on demand, rate-limited |
| C to S | CHAT | utf8 up to 140 chars | <= 1 per 2 s |
| C to S | PING | client time u32 | every 5 s (2 s for the first 10 s) |
| S to C | SNAPSHOT | server tick u32, self state (14 B), bitmask + records, enters, leaves | 10 Hz |
| S to C | EVENT | reliable semantic events (quest, trade result, damage, weather change) | on demand |
| S to C | STATS | hunger/thirst/stamina/health/heat/money deltas | on change, max 1 Hz |
| S to C | PONG / CHAT / SYSTEM | | |

Implementation: hand-rolled bit writer on a preallocated `ArrayBuffer`/`DataView` (zero allocation per tick); a 1-byte protocol version in the join handshake; the **same codec file** imported by server, client and bots (single source of truth). Protobuf/JSON are poor fits for bit-level deltas.

### 5.5 Bandwidth tables (computed, includes 68 B wire overhead per message, 10 Hz) [E]
Per-client downstream:

| Encoding | 19 entities in view (average) | 80 entities (crowd) |
|---|---|---|
| JSON (52 B per entity) | 10.6 KB/s = 84 kbps | 42.3 KB/s = 338 kbps |
| Binary absolute (9 B) | 2.4 KB/s = 19 kbps | 7.9 KB/s = 63 kbps |
| **Binary delta (about 3 B)** | **1.25 KB/s = 10 kbps** | **3.1 KB/s = 25 kbps** |

Aggregate for 1,000 clients all in that situation (upper bounds): JSON 84-338 Mbps (impossible), absolute 19-63 Mbps, **delta 10-25 Mbps**.
Upstream per client: 20 Hz x (8 B + 68 B) = 1.5 KB/s, or 820 B/s with 2 commands per message at 10 Hz. 1,000 clients: about 8-12 Mbps inbound.
Per player-hour (downstream): 1.3 KB/s = 4.7 MB/h; 3.1 KB/s = 11.2 MB/h. For 10,000 player-hours per day: **47-112 GB/day**. 1,000 CCU 24x7 for 30 days: **3.4-8.0 TB**. Mobile data cost to the player is negligible; the radio stays awake at 10 Hz so battery is the mobile concern [E].

Verdict: ship the binary absolute format first (simple, 2.4 KB/s typical), upgrade to delta only after profiling, but **never ship JSON snapshots**, even for the prototype that goes beyond about 30 CCU.

---

## 6. Tick rates, timing and interpolation

### 6.1 What others use [S unless noted]
| Game / source | Rates |
|---|---|
| Valve Source | tick 66 (about 15 ms); `cl_updaterate` 20 (50 ms); `cl_interp` 0.1 s (about two updates); Valve games keep a minimum 100 ms lerp |
| Overwatch | 63 Hz servers (up from 21 Hz); 16 ms command frames; client runs ahead by about RTT/2 + 1 command frame; server tells a starving client to simulate slightly faster to refill the input buffer (secondary source) |
| Colyseus | `patchRate` default 50 ms (20 Hz) |
| Gambetta | 10 updates/s example, entities rendered 100 ms (one interval) in the past |
| Gaffer | at 10 pps the minimum interpolation delay is 100 ms, practical 150 ms, **250-350 ms with loss protection**; rule: buffer = **3 x send interval** at 2-5% loss (30 pps: about 150 ms; 60 pps: about 85 ms); 60 pps full-snapshot cost 11.6 Mbit/s vs 10 pps about 2 Mbit/s (his cube scene) |
| Roblox | a test-place note recommends 20-30 ticks/s for games with 10+ players [V]; a DevForum post says physics replication defaults to 15/s [V] |

### 6.2 Our timing budget [E]
| Loop | Rate | Notes |
|---|---|---|
| Client render | 30-60 fps | unchanged |
| **Movement sim step (client AND server)** | **fixed 1/30 s** | walk 0.10 m, run 0.23 m, motorbike 0.53 m per step; 60 fps clients accumulate two frames per step, render-interpolate between steps |
| Command upload | 15-20 msgs/s, 1-3 commands per message | server applies commands as they arrive, in 33 ms steps |
| Server world loop | **20 Hz** | grid maintenance, survival timers, weather, NPC logic, snapshot scheduling |
| Snapshot to clients | **10 Hz** (phase 2: near-tier vehicles 20 Hz) | |
| Clock sync | NTP-style ping/pong, keep the 8 lowest-RTT samples, median offset; resync every 5 s; slew the clock at most 0.5% per second to avoid visible jumps | needed for rail NPCs, weather and day/night |

### 6.3 Interpolation buffer [E]
`renderTime = serverTimeEstimate - interpDelay`, with `interpDelay = clamp(2 x snapInterval + 2 x sigmaArrival, 150, 350 ms)`, starting at 220 ms. Visual lag behind the true position at 200 ms: walk 0.6 m, run 1.4 m, motorbike 3.2 m. Acceptable for non-combat. TCP stalls (retransmit after a lost segment) show up as a burst of several snapshots arriving at once: process in order, advance the buffer without teleporting. If the buffer runs dry: dead-reckon with last velocity for at most 150 ms, then ease to stop. Hermite interpolation using sent speed+yaw looks better than linear at 10 Hz (Gaffer: linear at 10 pps shows jitter/pulsing); derive lean from yaw rate on the client, do not send it.

---

## 7. Client-side prediction, reconciliation, lag compensation

### 7.1 Pattern (Gambetta Part II; Gaffer; Overwatch) [S]
1. Client samples input each fixed step, applies it immediately to its predicted state, stores `{seq, cmd}` in a pending ring buffer and sends it.
2. Server applies commands in order with the same `stepPlayer`, then reports state + `lastProcessedSeq`.
3. Client drops pending commands <= `lastProcessedSeq`, rewinds to the server state and **replays** the rest. Error = new predicted minus old predicted.
4. Never snap the rendered avatar to the corrected state: keep a visual offset that decays. Gaffer's demo smoothed with factor **0.95 per frame at 60 Hz for errors <= 25 cm, 0.85 for >= 1 m**, blended in between. Gambetta notes disagreement is common once several players exist, even without cheating [S].

### 7.2 Numbers for this game [E]
| Item | Value |
|---|---|
| Pending buffer | up to 64 commands (about 2 s at 30 Hz); beyond that, force a resync |
| Deadband | ignore corrections < 5 cm |
| Smoothing | exponential decay of the visual offset, time constant about 100 ms (walk), about 150 ms (motorbike) |
| Hard snap | error > 2 m (walk/run), > 5 m (motorbike), or server sends `FORCE_POS` flag (teleport, respawn, mount transition) |
| Prediction-critical shared code | `stepPlayer`, `stepVehicle` (kinematic bicycle), `groundHeight`, collision query. Any mismatch (e.g. server lacks a collider the client has) means permanent rubber-banding at that wall. Add a debug counter `mispredictions/min` per client in telemetry. |
| Jump | predicted locally; server validates apex (<= ground + 1.5 m given JUMP 6.5, GRAV 26) |
| Mount/dismount | **server-confirmed event**, not predicted: client shows a short animation, vehicle appears under the player on server ack (distance <= 5 m + 2 m tolerance; one rider unless pillion is designed) |
| Vehicles | a mounted player *is* the vehicle entity; remote vehicles are interpolated like players; state flags carry vehicle type and horn |

### 7.3 Lag compensation
Not needed for v1 because nothing is hitscan. For proximity actions (talk, buy, pick up, mount) use the **server's current position with a tolerance radius** `base + min(2 m, v x RTT/2)` rather than rewinding. If PvP or vehicle-hits-pedestrian damage arrives later, add a position history ring buffer: 5 snapshots at 20 Hz x 1,000 players x 8 B = about 40 KB, rewind by the shooter's `interpDelay` capped at about 250 ms (Gambetta: the server reconstructs the world as the shooter saw it, at the price that a target can be hit "a few milliseconds" after taking cover; Valve rewinds using each client's interpolation delay [S]). Race conditions on shared objects (two players pick up the last item) are first-come-first-served in server order.

---

## 8. NPCs and traffic

### 8.1 Classify by gameplay consequence
| Class | Examples | Sync strategy | Cost |
|---|---|---|---|
| **A. Cosmetic ambient** | parked and moving traffic, pedestrians, boats, birds | **Client-only**, seeded per area, never collides with players, never blocks quests | 0 B/s |
| **B. Deterministic "rail" gameplay objects** | a few buses, ferries, trams/trains with schedules, delivery trucks on fixed loops that a player can ride or must avoid | Pure function of `(routeId, serverTime)`; route polylines are shared static data; position = arc-length `s = (s0 + v x (t - t0)) mod L` | 0 B/s per object after clock sync; use only +,-,*,/ and sqrt (IEEE-754 exact in JS); avoid `Math.sin/cos/tan` in the sync-critical path because ECMA-262 defines such functions as "implementation-approximated" (the spec's term, section 4.4.1; I saw the term but not the Math.sin clause text), so engines may differ in the last bits |
| **C. Server-owned interactive NPCs** | shopkeepers, quest givers, street vendors, shippers' customers, fishermen | Static: position in shared data, only *state* (stock, quest stage, mood) over events. Wandering: server entity in AOI at 2-5 Hz | static 0; wandering about 3 B x 5 Hz = 15 B/s per visible NPC |
| **D. Server-owned physical vehicles** | player-owned and rented bikes | Same as players | as players |

### 8.2 Why the current traffic cannot simply be "deterministic seeded sim"
From `js/traffic.js` [S repo]: spawn/despawn is a **bubble around the local player** (`refreshBubble`, `fill`, `removeAgent` when beyond RB+40); timing uses `performance.now()`; one module-level LCG `rnd()` consumed in call order (so any difference in the order of spawns or junction choices desynchronises everything after it); far agents step every 2nd/4th frame with `dt` clamped to 0.2 s; target speed depends on `followLimit(a, px, pz)` and `avoidPlayer(...)`. Gaffer's own conclusion applies: determinism needs same step, same inputs, no hardware-dependent iteration counts; lockstep also can't support late joiners without full state, and floating-point determinism across machines is only "conditionally" achievable [S]. The cost-benefit is poor for background traffic.

### 8.3 Options with numbers
| Option | Bandwidth/client | Server CPU | Effort | Verdict |
|---|---|---|---|---|
| 1. Keep per-client ambient traffic (class A) | 0 | 0 | 0 | **Recommended default.** Make it visually respect *remote* players' positions (read from snapshots) so bikes do not drive through them. |
| 2. Rail objects (class B) for the few vehicles with gameplay meaning | 0 | tiny | medium (route data + time sync) | **Recommended** for buses/ferries/missions. |
| 3. Server-owned full traffic (200 cars in AOI) | 200 x 3 B x 10 Hz = **6 KB/s** (more than 4x the player-snapshot budget) | 200k records/s at 1,000 CCU | high | Reject unless traffic must collide with players. |
| 4. Make `traffic.js` a lockstep deterministic world sim | 0 | 0 | very high, fragile | Reject. |

If NPC vehicles must hurt players (knock-down, fines), only class B objects do it: server evaluates `f(route, serverTime)` for impact tests; clients render the same function; residual client error is clock error (+- 20-50 ms) x speed (10 m/s) = 0.2-0.5 m, acceptable if the hit volume has tolerance.

### 8.4 Survival-relevant world state (server authority)
Hunger/thirst/stamina/health/body heat/money, inventory, job state, weather and day/night are **server state evaluated lazily**: `value(t) = f(lastValue, lastTime, rates)`, no per-tick cost per player and correct while offline. Weather and time of day: one global `(epoch, seed)` pair broadcast on join + hourly; storms as scheduled events (start time, duration, intensity) so every client renders the same without per-frame messages. Shops: purchase = server-validated ACTION (distance, stock, price, cooldown, idempotency id).

---

## 9. Anti-cheat for a web client

Threat model: browser JS is fully inspectable and modifiable (console, devtools, userscripts, modified clients, memory editors, packet replay, bots). Obfuscation is not security. **Security = server authority + validation.**

### 9.1 Layered controls [E, grounded in S practice]
1. **Authoritative state**: the client sends *commands/intents*; position, money, stats, inventory, quest progress live on the server. Quest completion by proximity (landmark discover radius 18 m) is evaluated by the server on the server position.
2. **Time budget (anti time-hack)**: the server keeps `credit_ms` per player: add real elapsed time, subtract 33.3 ms per applied command. Allow credit in [-100, +200] ms; commands beyond that are dropped and counted. This stops "send 100 commands per second" speed-hacks. Overwatch uses a related input-buffer/time-dilation control [S].
3. **Input sanity**: clamp analog axes to the unit circle, reject out-of-range flags, reject unknown opcodes, disallow `seq` going backwards.
4. **Kinematic limits** per mode, from the shared constants file (today: walk 3, run 7, motorbike 16, cyclo 4.2, boat 10 m/s): allowed displacement over a 1-second window = `vmax x 1.20 + 1.0 m` burst; accelerations capped using the vehicle accel. Violations accumulate a score (+1 per violating window, decays 1 per second); score > 5: rubber-band (force-position message); > 20: kick; repeat offenders: temporary ban. A Thunderstore anti-cheat mod exposes the same knobs (time window, flat buffer, tolerance multiplier, separate teleport threshold), and Eco ships a `MovementHackDetector` [S]; Roblox devs advise not to auto-punish single events, only continuous violations [S].
5. **Teleport**: any server-side position jump > 3 x max step, or a client `FORCE_POS` ack mismatch > 30 m, is a hard flag. Legit teleports (fast travel, respawn) are server-initiated and whitelisted.
6. **World constraints**: bounds (`PLAY_RADIUS`), water/land (`landAt`), vertical (ground + 1.5 m unless deck/bridge). Walls: needs the headless collider grid (section 1); until then noclip is possible, so keep anything valuable (shops far from spawn, rare spawns) gated by server-side *path/time* plausibility, not only by distance.
7. **Economy**: all mutations server-side with idempotency keys; per-action cooldowns; server-computed prices; daily caps for jobs (shipper, xe ôm, port worker, fisherman); anomaly alerts (income per hour 5 sigma above median).
8. **Replay/forgery**: join ticket signed (HMAC) with short TTL; per-connection random session key mixed into a 32-bit message MAC is optional [E]; main protection is that nothing a client sends is trusted.
9. **Telemetry**: log violation scores, `mispredictions/min`, input timing entropy (bots often have zero jitter), and send a sample to a review dashboard.

### 9.2 Expected false positives
Frame-rate variation and TCP burst delivery break naive "distance per tick" checks (documented by a forum author) [S]; hence the time-credit model and windowed limits above. Tune thresholds against measured per-RTT-bucket false-positive rates from the beta, not constants from this document. I found no reliable public "latency threshold" for catching speed hacks; treat any such number as marketing [S].

---

## 10. Chat moderation

### 10.1 Pipeline [E]
1. **Scope**: default `SAY` to players within 40 m (AOI cell broadcast, not global). Global `SHOUT` rare, with a cooldown (60 s) and a currency/stamina cost. No typing-indicator broadcasts (the HN Node case blew the event loop that way) [V].
2. **Hard limits**: <= 140 chars, 1 message per 2 s with burst of 3, identical or near-duplicate message suppression, <= 2 links (or no links), repeated-character collapse.
3. **Local Vietnamese-aware filter (sync, < 1 ms)**: Unicode NFC + NFD normalisation, strip diacritics for matching, map leetspeak/teencode (`d1`, `dm`, `đ.m`, spaced letters, zero-width characters), blocklist + allowlist (to avoid the Scunthorpe problem with Vietnamese syllables without tones), nickname filter and reserved names (staff impersonation, real brands: project rule "no brand names").
4. **Async ML check (post-send, 1-2 s)**: OpenAI `omni-moderation` is free and OpenAI says it improved on non-English text (reported +42% multilingual in an OpenAI community summary), but I found **no Vietnamese-specific accuracy data**, and a third-party benchmark reports high recall with more false positives; a vendor blog says latency is 1.0-1.5 s [S/V]. Use it to hide the message retroactively and raise a flag; never block gameplay on it. **Do not build on Google Perspective API**: Jigsaw states service ends 2026-12-31 and new quota requests closed in Feb 2026 [S].
5. **Player tools**: mute/block (client-side + server-persisted), report with the last 20 lines of context snapshot, auto-mute at N reports from distinct accounts within 10 minutes, shadow-mute (sender sees own text, nobody else) for repeat offenders.
6. **Friction for guests** (design lever, owner decision): nickname-only guests get quick-chat/emote wheel only for the first 10-15 minutes or until Google sign-in. Cheap sybil/abuse friction that keeps "play instantly".
7. **Records**: keep moderation logs (who/what/when) with retention policy; Vietnamese G1 rules expect content management and activity records (section 11).

---

## 11. Bot and abuse protection, and the legal flag

### 11.1 Join flow [E]
```
Browser --HTTPS--> /join {nickname, turnstileToken, deviceId, [googleIdToken]}
Server: verify Turnstile (free, unlimited challenges on Free plan [S]), nickname filter, create/restore account, issue
        join ticket = HMAC({accountId, expiry=60 s, nonce}); 
Browser --WSS--> first binary message carries ticket (not in URL: URLs end up in logs)
Server (uWS 'upgrade'): check Origin allow-list, per-IP and global connection budget; then verify ticket; single session per account (kick the old)
```
- Cloudflare WAF only inspects the initial HTTP request of a WebSocket, not later frames [S], so frame-level abuse control must live in our server.
- Per-connection token buckets: INPUT 40 msgs/s, ACTION 5/s, CHAT 1/2 s burst 3, PING 1/s; a violation counter closes the socket (code 1008) after N hits.
- **IP limits must be lenient**: Viettel runs carrier-grade NAT to stretch IPv4 [S], and IPv6 reached about 45% of Vietnamese subscribers by 2021 [S]. Suggested: <= 50 concurrent connections per IPv4, <= 10 new connections per minute per IPv4; key IPv6 by /64. Prefer per-account and per-device-cookie limits to per-IP.
- **Admission control and reconnect storms**: hard CCU cap, queue with ETA, jittered client reconnect backoff (1 s, 2 s, 4 s ... plus random 0-1 s) so a deploy does not DDoS ourselves; deploy by draining (WebTransport has a `draining` concept; for WS send a `SERVER_RESTART in N s` event).
- **Bot heuristics** (phase 2): zero-jitter input timing, perfectly repeated paths, 24x7 sessions, no camera/rotation input, abnormal job income; shadow-flag rather than instantly ban.

### 11.2 Legal flag (Decree 147/2024/ND-CP, in force 2024-12-25) [S, secondary summaries; confirm with counsel]
- G1 games (multiple players interacting simultaneously through the operator's game server system) need a G1 service licence plus a per-game release decision; the operator must be a Vietnamese enterprise.
- Operators must **verify player accounts by a Vietnamese mobile number** so only verified accounts can play, and store full name, date of birth and phone number in Vietnam.
- Under-18 players limited to 60 min per game and 180 min per day with a health warning every 30 min; accounts of under-16s registered with a parent/guardian.
- The sources did not settle whether a free, non-commercial hobby project with chat falls under these rules, nor whether national-ID verification is an alternative for games (it is for social networks). Because the owner chose "play instantly with a nickname", **this is the highest non-technical risk in the plan**. Architect for an optional "verified" tier (phone OTP) from the start so it can be switched from optional to mandatory without a protocol change.

---

## 12. Load testing

### 12.1 Tool choice
| Tool | Binary WS | Multi-connection | Use here |
|---|---|---|---|
| **Custom headless Node bot swarm** (`ws` + our shared codec + shared `stepPlayer`) | yes | one process, hundreds of bots | **Primary.** Can follow roads from the real graph, reconcile, chat, buy, mount; reports its own RTT/misprediction stats. |
| **k6** `k6/websockets` (the experimental module is deprecated) | `binaryType` `arraybuffer` | a single VU may hold multiple connections (global event loop) | Handshake storms, join-ticket path, reconnect storms, soak. JS codec import needs bundling. |
| **Artillery** `ws` engine | docs show `send` objects converted with `JSON.stringify`; binary not documented | many virtual users | Weak fit for a bit-packed protocol; fine for HTTP join endpoints. |
| **Colyseus loadtest** (reference only) | n/a | docs: `--numClients` per process; single-threaded; keep <= 1 process per core; separate machine from the server; about 200 clients per process is a good number | Use its guidance for sizing the bot fleet. |
| `tc qdisc ... netem` | n/a | n/a | `tc qdisc add dev eth0 root netem delay 100ms 10ms loss 1%`; note TCP TSQ: for TCP tests netem should sit on the receiver's ingress [S] |
| Playwright + real Chrome | n/a | max about 5-10 | Correctness only (visuals, UI). **Always through `tools/qa/gpulock.mjs`**; many parallel WebGL Chromes have caused BSOD 0x133 on the owner's machine. |

Bots cost: each bot decodes 10 Hz snapshots; per Colyseus note, decode cost grows with client count (500 clients x 20 patches/s = 10,000 patch decodes/s on one core). Expect **200-400 of our bots per core** [E]; 1,500 bots need 4-8 cores on separate machines, ideally in a region with Vietnam-like RTT (or netem-delayed).

### 12.2 Test plan with pass/fail criteria [E]
| Phase | Load | Duration | Pass criteria |
|---|---|---|---|
| T0 smoke | 50 bots + 3 real browsers | 10 min | zero decode errors; mispredictions < 2/min per client |
| T1 ramp | 0 to 1,000 bots over 10 min, uniform random walk on real roads | 30 min | tick p99 < 25 ms (budget 50), event-loop delay p99 < 20 ms, no growth in RSS > 10% after forced GC, snapshot bytes p95 < 1,100 |
| T2 hotspot | 300 bots converge on the Opera House plaza | 10 min | cap + accumulator hold; tick p99 < 40 ms; no client above 8 KB/s |
| T3 stress | 1,500-2,000 bots | 15 min | degradation ladder engages in order; admission queue works; no crash |
| T4 network | netem 80 ms +- 30 ms, 2% loss on 30% of bots | 20 min | interpolation buffer adapts; reconciliation snaps/min < 1; no stuck keyframe loop |
| T5 reconnect storm | drop all sockets, reconnect within 30 s | 5 min | all clients resume; admission respects cap; no thundering herd |
| T6 soak | 800 bots | 8-12 h | memory flat, no timer drift, log volume sane |
| T7 abuse | bots send malformed frames, oversize payloads, 1,000 msg/s spam, speed-hack commands | 10 min | each is rejected or closed within 1 s; no CPU spike > 10% |

Metrics to export: tick duration histogram, event-loop delay (`perf_hooks.monitorEventLoopDelay`), per-client `bufferedAmount`, snapshot size histogram, records dropped by the cap, keyframes/min, corrections/min, validation rejections by reason, GC pauses, RSS, FD count, per-opcode message counts.

---

## 13. Suggested rollout gates (netcode only)

| Gate | Scope | Exit criteria |
|---|---|---|
| N0 | Refactor: fixed-step `stepPlayer`/`stepVehicle` shared module, headless static world extract, protocol codec | Single-player build still passes `diag`/`tour`; unit tests prove client and server replay produce identical positions for recorded inputs |
| N1 | 2-20 players, one process, absolute binary snapshots, grid AOI, prediction + reconciliation | T0 passes; mispredictions < 2/min |
| N2 | 200 CCU public closed beta, telemetry (RTT/jitter/loss per carrier), join ticket + Turnstile, chat limits | T1 at 300 bots; real RTT data collected |
| N3 | 500-1,000 CCU: delta encoding, accumulator, degradation ladder, worker-thread encoders if needed | T1-T5 pass at 1,000 |
| N4 | 1,500+ headroom, anti-cheat tuning from beta data, wall collisions server-side | T3, T6, T7 pass |
| N5 | Optional: WebTransport datagram path, zone sharding, DDoS front | demand-driven |

---

## 14. Risks and open questions for the owner

1. **Legal (Decree 147/2024)**: phone verification vs instant nickname play (section 11.2).
2. **Collision parity**: server needs the same colliders as the client; today they live inside `world.js`. Until extracted, wall-clipping is a cheat vector.
3. **Variable dt in the main loop** must go before any prediction work.
4. **Measured RTT in Hải Phòng on mobile** is an estimate; section 6 constants depend on it.
5. **Hotspot design**: where do 300 people gather (spawn, Opera House, events)? Consider multiple spawn points and instanced "channels" of the same city as a safety valve (soft cap per channel, e.g. 400, party/friend join) if tests show hotspots dominate; this contradicts "one single world" only mildly and is the most robust production fallback [E].
6. **Player-to-player collision, PvP, and trading** are explicitly out of v1 netcode scope; each changes the lag-compensation and anti-cheat design.
7. **Language of moderation lists** (Vietnamese slang) needs a native reviewer.

---

## 15. Sources and reliability

Primary / documentation (fetched and read):
- Gaffer On Games, Snapshot Compression: https://gafferongames.com/post/snapshot_compression/
- Gaffer On Games, Snapshot Interpolation: https://gafferongames.com/post/snapshot_interpolation/
- Gaffer On Games, State Synchronization (priority accumulator): https://gafferongames.com/post/state_synchronization/
- Gaffer On Games, Deterministic Lockstep: https://gafferongames.com/post/deterministic_lockstep/
- Gaffer On Games, Floating Point Determinism: https://gafferongames.com/post/floating_point_determinism/
- Gaffer On Games, Why can't I send UDP packets from a browser: https://gafferongames.com/post/why_cant_i_send_udp_packets_from_a_browser/
- Gabriel Gambetta, Client-side prediction and server reconciliation: https://gabrielgambetta.com/client-side-prediction-server-reconciliation.html
- Gabriel Gambetta, Entity interpolation: https://gabrielgambetta.com/entity-interpolation.html
- Gabriel Gambetta, Lag compensation: https://gabrielgambetta.com/lag-compensation.html
- Valve, Source Multiplayer Networking (via search snippets; direct fetch failed): https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking
- caniuse WebTransport: https://caniuse.com/webtransport
- MDN WebTransport API: https://developer.mozilla.org/docs/Web/API/WebTransport_API
- Colyseus FAQ: https://docs.colyseus.io/faq ; Colyseus load testing: https://docs.colyseus.io/tools/loadtest
- uWebSockets.js behaviour options: https://unetworking.github.io/uWebSockets.js/generated/interfaces/WebSocketBehavior.html ; WebSocket methods: https://unetworking.github.io/uWebSockets.js/generated/interfaces/WebSocket.html ; README: https://github.com/uNetworking/uWebSockets
- `ws` README (permessage-deflate warning, ping pattern): https://github.com/websockets/ws
- Mirror spatial hashing: https://mirror-networking.gitbook.io/docs/manual/interest-management/spatial-hashing
- Unreal Replication Graph: https://dev.epicgames.com/documentation/unreal-engine/replication-graph-in-unreal-engine
- k6 websockets: https://grafana.com/docs/k6/latest/javascript-api/k6-websockets/
- Artillery WebSocket engine: https://www.artillery.io/docs/reference/engines/websocket
- tc-netem: https://man7.org/linux/man-pages/man8/tc-netem.8.html
- Cloudflare Durable Objects pricing/WebSocket API (via search): https://developers.cloudflare.com/durable-objects/platform/pricing/ ; https://developers.cloudflare.com/durable-objects/api/websockets
- Cloudflare Turnstile plans: https://developers.cloudflare.com/turnstile/plans/ ; launch post https://blog.cloudflare.com/turnstile-ga/
- Perspective API sunset (official site): https://perspectiveapi.com/
- OpenAI omni-moderation announcement: https://openai.com/index/upgrading-the-moderation-API-with-our-new-multimodal-moderation-model/

Secondary / community / vendor (lower confidence, [V]):
- Overwatch netcode: GDC talk page https://gdcvault.com/play/1024001 ; Edgegap summary https://edgegap.com/blog/game-backend-deep-dive-overwatch-2016-netcode-architecture-rollback ; 63 Hz report https://gamesbeat.com/overwatch-netcode-tick-rate-60hz/
- Quake 3 snapshot model: https://mail.fabiensanglard.net/quake3/network.php
- Tribes networking model: https://edgegap.com/blog/game-backend-deep-dive-tribes-(1998) ; TNL docs https://opentnl.sourceforge.net/doxydocs/classTNL_1_1GhostConnection.html
- Boulanger et al., Comparing interest management algorithms for MMOs (NetGames 2006): https://www.sable.mcgill.ca/~clump/papers/boulanger-06-comparing.pdf
- Go 1M WebSockets (Eran Yanay): https://speakerdeck.com/eranyanay/going-infinite-handling-1m-websockets-connections-in-go ; gobwas: https://medium.com/@gobwas/million-websockets-and-go-cc58418460bb
- uWebSockets.js million-connection test (2019): https://unetworkingab.medium.com/millions-of-active-websockets-with-node-js-7dc575746a01 (search snippet only; fetch failed)
- Colyseus forum on CCU: https://discuss.colyseus.io/post/1221 ; Cocos interview https://cocos.com/en/post/7fa77b668578a893653c674b2be3865c
- Node/Socket.IO event-loop lag anecdote: https://hn.matthewblode.com/item/44389408
- JSConf Asia Node game server deck: https://www.slideshare.net/slideshow/pomelo-jsconfasia/28738621
- Roblox replication notes: https://devforum.roblox.com/t/allow-game-developers-to-configure-the-physics-replication-rate-for-their-games/4005498
- Anti-cheat practice: Eco MovementHackDetector https://docs.play.eco/api/server/eco.gameplay/Eco.Gameplay.Players.MovementHackDetector.html ; HardAntiCheat mod https://thunderstore.io/c/atlyss/p/s0apy/HardAntiCheat/v/2.1.9/ ; Roblox exploit thread https://devforum.roblox.com/t/ways-to-patch-common-exploits/98961
- SpacetimeDB / BitCraft (server-as-database alternative; no independent CCU figure found, only "thousands of players" claims): https://spacetimedb.com/docs/intro/what-is-spacetimedb
- WebSocket vs WebTransport (stale on Safari): https://websocket.org/comparisons/webtransport/
- Vietnam latency estimates: https://space-node.net/blog/minecraft-server-hosting-vietnam-2026 ; Ookla via https://vietnamnet.vn/en/viettel-still-vietnams-fastest-mobile-provider-in-q4-810903.html
- Viettel CGNAT: https://www.telecomreviewasia.com/news/network-news/3548-vietnam-s-viettel-chooses-juniper-networks-for-platform-upgrade/ ; IPv6 45% (2021): https://english.mic.gov.vn/vietnam-ranks-eighth-in-ipv6-adoption-worldwide-197148613.htm
- Decree 147/2024 G1 summaries: https://luatvietnam.vn/linh-vuc-khac/lam-the-nao-de-duoc-cung-cap-tro-choi-dien-tu-g1-883-99958-article.html ; https://hethongphapluat.com/decree-no-147-2024-nd-cp-dated-november-9-2024-on-management-provision-and-use-of-internet-services-and-cyber-information/dieu-39 ; https://voh.com.vn/xa-hoi/gioi-han-thoi-gian-choi-game-cua-nguoi-duoi-18-tuoi-567266.html

### What I could not verify
- Valve wiki pages and the Photon Fusion AOI page could not be fetched (errors / bot wall); Valve numbers come from search snippets of the wiki. `sv_maxunlag` (Valve's rewind cap) was not confirmed, so no number is given.
- Overwatch details (63 Hz, input time dilation) are from news and a third-party summary of the GDC talk, not the talk itself.
- No independent concurrent-player figure for BitCraft/SpacetimeDB; no verified uWebSockets.js bytes-per-connection figure.
- No Vietnamese-specific accuracy data for ML moderation; no current Ookla Singapore-route latency for Hải Phòng.
- Hosting prices (Hetzner Singapore etc.) were not verified and are deliberately excluded.
- ECMA-262 Math.sin clause text was not retrieved (only the defined term "implementation-approximated").
- All CPU, bandwidth-per-entity, tolerance and timing numbers marked [E] are calculations or judgement (script-checked arithmetic) and must be validated by the load tests in section 12.
