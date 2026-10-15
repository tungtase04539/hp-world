# Hải Phòng 3D — Multiplayer / Survival: codebase hooks

Scope: what the current client code does that multiplayer, survival, jobs, weather and quests must touch.
Read-only analysis of `C:/Users/Admin/hp-world`, branch `dot3` at `bcdcacc`, working tree on 2026-10-14.
Line numbers are for that working tree (`js/main.js` is 1,095 lines now; PROJECT_MAP.md line numbers for main.js are stale).
Files read in full: main.js, character.js, vehicles.js, traffic.js, npcs.js, quests.js, ui.js, minimap.js, i18n.js, audio.js, input.js, index.html, device.js, footprints.js, minigame.js, boot.js (head). Partly read: daynight.js, models_kit.js, world.js (collision / spawn / dyn-matrix / flower sections), landmarks.js, instcull.js, assets.js, css/style.css.

---

## 0. One-paragraph model of the client

A static ES-module site (no bundler). `main.js` is a top-level-await script: it builds the UI, then awaits a 17-35 s synchronous `buildWorld`, freezes static matrices, creates the actors (NPCs, vehicles, traffic), then runs one `requestAnimationFrame` loop. There is exactly one local player, held in the plain object `pState`. Everything is client-trusted: movement, collision, pickups, quest completion, saves. Nothing talks to a network (no `fetch`/`WebSocket` in game code; only `assets.js` uses `fetch` inside a Blob Worker for GLBs). The only persistence is `localStorage`.

---

## 1. The local player: exact state and where it lives

### 1.1 State objects (all in `js/main.js`)

| What | Where | Content |
|---|---|---|
| `pState` | main.js:214-220 | `pos: Vector3` (feet), `yaw` (rad, 0 = +Z, `atan2(dir.x, dir.z)`), `vy`, `onGround`, `mounted: vehicle\|null` |
| `player` (rig) | main.js:208, character.js:44-148 | `makeHumanoid({hat:'cap'})`. One `SkinnedMesh`, 11 bones, 1 shared material. API: `group, animate(dt, speedRatio, time, speedMs), sit(on), pose(), walkT, blob` |
| camera `cam` | main.js:265 | `yaw, pitch, dist, cur, lastDrag, occlude, snap` (client only, never replicate) |
| input | input.js:3-10 | `input.forward/right` (-1..1), `run`, `jump`/`interact`/`escape` edge flags consumed by `consumeJump/Interact/Escape` |
| speeds | main.js:333 | `WALK=3.0, RUN=7.0, GRAV=26, JUMP=6.5` m/s |
| spawn | main.js:213 | `SPAWN = EXTRAS.square + (-5, +23)`, the Opera House square. Every player would spawn on one point. |
| play area | main.js:126-127, 680-690 | `PLAY_RADIUS = BUILD_RADIUS-12 = 1588`; `clampToPlayArea` slides along the circle (it runs for `pState.pos` at 725, and for the vehicle at 500) |

There is no stored "animation state". It is implicit: speed = displacement per frame inside `updatePlayerOnFoot` (main.js:347-381), `player.animate(dt, mag*(run?1:0.6), time, speed)` at 380, `player.sit(true)` while riding (401, 496).
The local `speed` variable is not kept anywhere, so a network layer must compute `v = |Δpos|/dt` itself (the same way `updatePlayerShadow` does at main.js:245).

### 1.2 Per-frame order for the player (animate(), main.js:702-846)

1. 707 `dt = min(clock.getDelta(), 0.05)`; 708 `time += dt`. Note: `time` and `dt` are clamped game time; they drift from real time on slow machines.
2. 713-715 Esc, E (`handleInteract`), jump flush.
3. 719-723 `updateMounted` (494-511) or `updatePlayerOnFoot` (347-381).
4. 725 `clampToPlayArea(pState.pos)`, 726 `updatePlayerShadow`.
5. 728-738 interaction prompt, 10 Hz (`nearestInteraction`, 514-532).
6. 741-749 flower pickup (proximity 2.4 m, `quests.pickFlower(i)`); 751-755 landmark discovery (18 m).
7. 757 `updateNPCs`, 758 `world.updaters`, 759-761 parked vehicles, 763 `traffic.update`, 766 `dayNight.update`, 789 `audio.updateAudio`, 818 `drawMinimap` (10 Hz).
8. 837 `world.updateDynMatrices()` must be last before render.

### 1.3 Movement facts the server must mirror

- On foot (347-381): sub-steps of at most 0.35 m, `tryMove` (335-345) blocks water (`surfaceY <= 0.32`), world bounds ±30 m, step-down more than 1.2 m, deck parapets (`world.decks.crossesParapet`). Collision is `resolveAll` (188-191) = `world.resolveCollisions` (circles + polygon fabric) + `pushOutNPCs` + `traffic.pushOut`. Collision radius 0.45 m.
- Height: `surfaceY(x, z, yRef)` (world.js:83) = max(ground, bridge deck at or below yRef+1.2). City is flat at `LAND_H = 2` except bridges and the HVT spiral ramps. Remote clients can reconstruct y from (x, z) plus a 1-byte "level/yRef" hint, so y does not need to be sent.
- Vehicle physics (vehicles.js:154-158, 190-241), bicycle model: motorbike 16 m/s (accel 3.6, brake 8), cyclo 4.2, boat 10. Heading `v.heading`, roll `v.lean` (clamped 0.45 rad).
- Max legit speeds for server plausibility checks: walk 3.0, run 7.0, motorbike 16, boat 10, jump apex about 0.8 m.

### 1.4 What the network must replicate for the local player (minimum state vector)

`x, z` (quantise 5 cm), `yaw` (1 byte), `speed` (1 byte, 0.1 m/s steps), `flags` {onGround/jump, running, mounted, honk-this-tick}, `level` (bridge/ground, 1 byte), `vehicleId`/`vehicleType` when mounted, `heading` and `lean` when mounted (derived from yaw and speed is good enough for the remote view), appearance seed (sent once, not per tick).

---

## 2. Vehicles (js/vehicles.js, main.js mount/dismount)

- `createVehicles(scene, groundHeight, waterHeight, spawns, resolveCollisions, opts)` (vehicles.js:159) returns `{ vehicles, update, spawn }`. A vehicle is a plain object: `{type, pos: Vector3, vel, heading, lean, mounted: bool, seatY, seatZ, land, mesh, speed, accel, brake, ...}`.
- Spawns come from `world.vehicleSpawns` (world.js:641; pushes at ~20134, 20160, 21776-21777): one motorbike near the Opera, one cyclo near Lê Chân, boats at piers inside the play radius (the Đồ Sơn ones are filtered out at vehicles.js:162).
- `mount(v)` main.js:397, `dismount()` 422-454 (spiral search for a free spot; never refuses on land), `callMoto()` 458-491 (spawns one `personalMoto` per client the first time, then teleports it). `updateMounted` 494-511 sets `pState.pos` from `v.pos + seat offset`. Parked vehicles update only while `!v.mounted && !v.land` (759-761, boats bobbing).
- In multiplayer these split into two classes:
  1. Personal motorbike: owner-authoritative, replicate as "player.mounted = motorbike" (rider and bike drawn together). Not a world entity.
  2. Shared vehicles (default moto, cyclo, boats): need server ownership (claim on mount, release on dismount or disconnect, timeout) or two players can ride the same boat. The `v.mounted` bool is the only existing lock.
- Gaps for jobs: a vehicle has exactly one seat (`seatY/seatZ`). An xe ôm passenger needs a pillion pose. The traffic kit already has one (`OPT.PILLION`, person 'B' in models_kit.js:316-466) but the SkinnedMesh humanoid has only the driver pose `sit(true)` (character.js:125-144). Cargo for the shipper exists only as a traffic kit option (`OPT.CARGO`), not for the player rig.

---

## 3. Rendering other players cheaply

### 3.1 What already exists and should be reused

- Traffic is drawn with `InstancedMesh` + interleaved dynamic buffers, 13 draw calls for the whole city (traffic.js:166-221, `writeInstances` 671-733):
  - stride 28 floats per instance = 16 matrix, 3 paint, 3 shirt A, 3 shirt B, 1 walk phase, 1 walk amplitude, 1 option word; 3 rotating buffer sets per frame (`NSET`) to avoid CPU-GPU stalls (comment 161-165: writing the in-flight buffer cost 5-9 fps).
  - `kitMaterial({walk:'cpu', shirts:true, std})` (models_kit.js:1073) is one shared shader program; walking is done in the vertex shader from `aPhase`/`aWalk`, CPU only integrates the phase.
  - Appearance is a bit word: `optWord(bits, seed)` (models_kit.js:40) with `OPT.NONLA/CAP/BAG/MASK_A/HAIR_A/SLEEVE_A/SHORTS_A/PILLION/CARGO`, plus shirt colours and a seed for skin/hair/trousers from the palette. This is a ready-made compact avatar format: a remote player's look fits in about 6 bytes.
  - Geometry: `pedestrianGeometry()` (models_kit.js:877) near, `motorbikeGeometry(kind,{rider:'ride'})` rider+bike (about 1.1-1.5k tris near, about 0.27k far, per the traffic.js header), `motorbikeFarGeometry`. Draw radius `DRAW_R` 170/230/260 m (TIER 1/2/3), bike near/far LOD at 32/42/50 m with 5 m hysteresis (traffic.js:58, 662-695).
- Contract that must be kept (traffic.js:30, 183-187, 216): instanced groups use `userData.noCull = true`, `raycast = () => {}`, `matrixAutoUpdate = false`, and a manually set `boundingSphere` around the player (`DRAW_R + 12`), because `instcull.js:17-83` would otherwise compact them and r160's instance bounding sphere goes stale.
- Local player and NPCs use the heavier `makeHumanoid` SkinnedMesh (1 draw call each, plus a blob shadow mesh and a bone texture). That is fine for 1 + 5 NPCs but not for hundreds.

### 3.2 Recommended design for remote avatars

- Tier A (all remote players inside the draw radius, up to a cap): add instanced groups `remote_ped` and `remote_ride_*` next to the traffic groups, reusing `pedestrianGeometry`, `motorbikeGeometry`, `kitMaterial`, `contactShadowGeometry`. Do not add new shader programs (each new program costs compile time; boot already spends 3.7-4 s on link).
  - Cap per tier suggested: TIER 1: 40, TIER 2: 120, TIER 3: 250 visible. Beyond the cap show the nearest N plus a minimap dot only.
  - Interpolate 100-150 ms behind the latest snapshot (10-15 Hz updates), extrapolate at most 250 ms, snap above 8 m error.
- Tier B (nearest 8-12 players within 15 m, optional): a pool of real `makeHumanoid` rigs for full pose fidelity (sit, emotes). Pool and recycle rigs; do not create one per player-join (each `humanoidGeometry` bakes a fresh colour array, character.js:52).
- Name tags: do not use `world.makeTextSprite` (world.js:21789, one 512×128 canvas, texture and sprite material per call; NPC code at npcs.js:95-114 even re-creates them on language change). For players use one shared canvas atlas (for example 16×16 cells of 128×32) plus one instanced billboard mesh, limited to the nearest 20-30 players within about 25 m, with cells recycled LRU. Optional DOM labels for at most 5-8 friends/party members.
- Shadows: remote avatars should not cast into the shadow map (traffic does the same, traffic.js:178-182: the map refreshes at only 2-4.5 Hz, so moving casters detach). Use the existing contact-shadow instance mesh.
- `scene.matrixWorldAutoUpdate = false` after `freezeStatic` (world.js:22025-22044). Any new dynamic `Object3D` must be a direct child of `scene` with `matrixAutoUpdate` true or `userData.dyn`; `refreshDynRoots` walks `scene.children` every frame, so hundreds of extra roots cost CPU. Instanced groups with `matrixAutoUpdate=false` are free here; pooled rigs are fine at 10.
- Frame budget warning (PROJECT_MAP §0): the frame is CPU-bound at about 23 µs per draw call, 672 draw calls at spawn. Remote avatars must add a fixed handful of draw calls, independent of N.
- Collisions between players: `resolveAll` (main.js:188-191) already pushes out of NPCs and traffic. Recommendation: no player-vs-player collision (ghosting). It avoids griefing and avoids per-pair work at 1,000 CCU.

---

## 4. Determinism: what is the same on every client, what is not

| System | Deterministic? | Detail |
|---|---|---|
| Static world geometry, buildings, roads, props, trees, shop signs | Yes, by data | Built from generated data files (mapdata.js, buildings_real.js, treemap.js, shopsigns.js...) with hash or seeded LCGs (world.js:7518, 21388; trees.js:34 "all positions/hashes deterministic"). `Math.random` appears only in world.js canvas-texture noise (16 sites) and audio.js. |
| Static world, but input-dependent | Mostly | Depends on `TIER`/`LITE` (device.js:59-69): `props.js:726` caps, `citygen.js:51,1194`, `trees.js:56`, `world.js:18403` (`?fabric=proc` only), merge tile size (22098). `?fabric=proc` (world.js:172) switches the whole building source. Colliders come from `addCollider` calls in props.js/trees.js/world.js. Not verified whether the collider set is identical across TIERs; test needed (hash `__hp.world.colliders` per tier). |
| Collision | Client-side only | `world.resolveCollisions` (world.js:661) = 48 m grid of circles, plus polygon fabric collide (`_fabCollide`), plus landmark polygon push (18823). Server has no copy. |
| Pickups | Deterministic ids | `world.flowerPickups` (world.js:21670-21712): 10 spots chosen by walking `ROADS_DT` and testing `resolveCollisions`. Index `i` is stable if the world is identical; saved by index (quests.js:25-50, indices < 64). |
| NPCs | Deterministic positions | `NPC_DATA` (npcs.js:5-75) + `world.npcSpots`. 7 defined, 5 built (fisherman and Cát Bà islander are outside play radius, npcs.js:88). Behaviour is local and cosmetic: they only turn toward the local player (npcs.js:117-127). |
| Landmarks / signs | Deterministic | `LANDMARKS` (landmarks.js:49, 26 entries; 22 inside `PLAY_LANDMARKS`, quests.js:9). |
| Vehicle spawns | Deterministic | `world.vehicleSpawns`; but vehicle state is runtime-only (no save). |
| Traffic | No (per-client) | Seeded LCG `_seed=0x5eed1234` (traffic.js:61-64), but it is consumed on real-time-gated paths: bubble refresh and fill use `performance.now()` (traffic.js:753-774), hash rebuild every 100 ms, population is centred on the local player and the RNG advances per frame event. Two clients on the same street see different cars and pedestrians. Keep it as local ambient decoration unless a deterministic flow model is built. Player vs traffic interaction is local (`traffic.pushOut` 863, `avoidPlayer` 532). |
| Props `props.js` parked bikes/cars/pedestrians (walkers by GPU path shader) | Yes, shader time | Path walkers run from `KIT_U.uKitTime` (props updater 1937), which is the local clamped `time`, so they are not in phase across clients (cosmetic). |
| Time of day | No | `dayT` starts at 09:00 per session, advances by clamped `dt/DAY_LENGTH` (daynight.js:20, 336, 500). Must be replaced by server time. |
| Clouds | Local | `_cloudT += dt` (daynight.js:505). Cosmetic. |
| Weather | Does not exist | No rain, storm, wind, wetness anywhere in js/ (searched). Only `LIGHT.cloud = 0.40` (cloud cover), `LIGHT.fogDensity`, a tree `aSway` vertex attribute, and `uCloud` on the sky dome (daynight.js:284). |

---

## 5. Time, sky, weather: where to sync

- `createDayNight(scene, world)` main.js:176. Public: `t` getter/setter (daynight.js:463-464), `hours`, `frozen`, `clockString`, `LIGHT`, `bakeEnv`, `update(dt, playerPos, camera)` at 499, which does `dayT = (dayT + dt/DAY_LENGTH) % 1` at 500.
- The `t` setter also calls `applySky()`, `updateFog(0)` and forces an IBL re-bake (`_envT = -1`), so do not call it every frame. Add a `syncTo(serverDayT)` that nudges `dayT` toward the server value with a small proportional correction (and snaps only on large error). `DAY_LENGTH` is 1440 s (24 real minutes per game day, daynight.js:20); the server needs `epoch` + `DAY_LENGTH` + start offset and the client computes `dayT = ((serverNow - epoch)/1000/1440 + 9/24) % 1`.
- Weather plan hooks (nothing exists yet): add a `weather` object `{kind, intensity, windX, windZ, seed, t0}` from the server. Client hooks: `LIGHT.cloud` and `uCloud` (sky), `LIGHT.fogDensity` (updateFog), a new rain particle pass (deterministic from `seed` + server time so all clients see matching bursts), `audio.updateAudio` env (rain/wind noise, makeNoise already exists, audio.js:20), road wetness via `makeRoadMaterial` (roadtex.js:430, a single Phong material with a DataArrayTexture, so wetness is a uniform on that material), tree sway via the existing `aSway` attribute plus a new wind uniform. Lightning = bloom spike (post.js bloom is night-only today: main.js:772-776 enables bloom only when `sky.night > 0.04`) plus hemi flash.
- Body-heat "shelter" detection: the game has no enterable interiors. Buildings are solid footprints (`fp.blocked`, footprints.js:70) so "indoors" does not exist. Shelter has to be defined as zones (awnings, covered markets, café shop fronts) in a data file, not inferred from geometry.

---

## 6. Save / progress storage today

| Key (localStorage) | Writer | Content |
|---|---|---|
| `hp3d.progress.v1` | quests.js:28-35 `saveProgress()` (called on every quest event, not debounced) | `{flowers, flowerIdx[], food, discovered[], allDone}` |
| `hp3d.quality` | device.js:45-50 | `full`/`lite` (auto = absent) |
| `hp3d.bootProfile.v1` | boot.js:101 | step durations |
| `hp3d.gpuHint` | main.js:1043 | one-time toast flag |

Not stored anywhere: nickname, position, language (`setLang('vi')` every load, main.js:138), inventory, money, vitals, vehicle. `resetProgress()` (quests.js:60) is exported but never called from UI (grep). All storage calls are wrapped in `try/catch` and degrade silently, which is a good pattern to copy for the new `progress` adapter.
Import into a server account must treat the local JSON as untrusted (a user can hand-edit it): cap what it can grant (for example only cosmetic achievements, no money/items).

---

## 7. Quest system: structure and what it lacks

- Structure (quests.js): one global object `quests = {flowers, FLOWER_GOAL (10), food (bool), discovered: Set, LANDMARK_GOAL (= PLAY_LANDMARKS.length, 22 per PROJECT_MAP), allDone}` (12-18). Three hard-coded quests rendered by `renderQuests()` (72-86) from i18n keys `q1/q1d`, `q2/q2d`, `q3/q3d`.
- Triggers (all client-trusted):
  - `pickFlower(i)` (105), called from the frame loop main.js:741-749.
  - `completeFood()` (119), called by `minigame.js:77` after the cooking mini-game opened from NPC `coba` (`action:'minigame'`, main.js:544-547).
  - `discoverLandmark(lm)` (128), called on E at a sign (main.js:543) and by proximity 18 m (751-755).
- Dispatch: `handleInteract()` (main.js:535-549) is the single interaction switch: kinds `dismount | mount | info | npc`; `nearestInteraction()` (514-532) scans `npcs`, `signs`, `vehicles` at 10 Hz. NPC `action` field is the only extension point (`'minigame'`).
- Missing for a quest/story engine (these are the things to build, in this order of dependence): data-driven quest defs (id, steps, conditions, rewards, localized `{vi,en}` text), an event bus (`visit`, `talk`, `pickup`, `deliver`, `buy`, `kill-time`), per-player quest state with server validation, NPC quest givers (NPC_DATA has only `lines`), reward grants (no inventory/money exists), shared/party quests, repeatable daily jobs.
- Landmark text already carries history/culture content (`LANDMARKS[].text/fact`, {vi,en}) and the `docs/KICHBAN_*` and `HOI*_PHANCANH.md` scripts exist, so story content has a source.
- `quests.js` imports `landmarks.js` (imports three) and `world.js` (BUILD_RADIUS), so it cannot run on a Node server as is. The server needs its own quest definitions (pure JSON) and the client quest module becomes a thin view.

---

## 8. UI / i18n / audio / input / minimap hooks

- HUD (index.html:57-70): `#hud` is `pointer-events:none` (css/style.css:39), so interactive widgets need `pointer-events:auto` like `#topRight` (51-52). Existing z-index: HUD 20, touch 21, prompt 22, dialogue 25, toast 30, banner 35, modals 40, title 50, rotate hint 60. Vitals bars, chat, player list and shop panels go inside `#hud`. The quest panel is top-left, clock/buttons top-right, minimap bottom-right (bottom 116 px on narrow screens, css:61-68).
- Title screen (index.html:27-54): no inputs exist at all. Nickname field and "Sign in with Google" go here. `input.js:41` already has a `typing()` guard for INPUT/TEXTAREA ("if later there is one").
- Key conflicts: `input.js:48` binds both `KeyE` and `Enter` to interact, so Enter cannot open chat; use `T` or `/`. Mobile uses `touchstart` on dedicated buttons and a joystick (input.js:57-95); chat on mobile needs the OS keyboard, while the viewport meta is `user-scalable=no`.
- Modals: `ui.isAnyModalOpen()` (ui.js:72-76) knows 4 panels only (dialogue, info, minigame, help). The game freezes player control while a modal is open (main.js:711, 719-723) but the world keeps running. In multiplayer a blocking shop panel leaves the avatar standing in traffic, so new panels should be non-blocking (or the avatar gets a "busy" shield). Register any new modal in `isAnyModalOpen` and `closeTopModal` (80-90).
- i18n (i18n.js): `dict.vi/en`, `t(key)`, `tx({vi,en})`, `{VAR}` substitution through `setVars` (6-8), `onLangChange`. No plurals, no formatting, no number/currency helpers. Server messages should be codes + params, localized on the client (`t('err_no_money')`), and server content should be `{vi,en}` objects. Add VND currency and time-of-day formatters.
- Audio (audio.js): fully procedural WebAudio; `AudioContext` is created inside the Start click (main.js:156). `updateAudio(dt, env)` takes `{seaFactor, night, traffic, honk, engine, green}` (main.js:789). There is no positional audio. Remote horns and engines need either a new `env.remote = {near, honk}` scalar (cheap) or a few pooled `PannerNode`s for the nearest 3-4 riders. Voice chat does not exist and is out of scope.
- Minimap (minimap.js): `drawMinimap(px, pz, yaw)` at 10 Hz (main.js:814-819) draws a prebuilt 2720 px raster window, street names, landmark dots (reads `quests.discovered` directly, minimap.js:155), and the player arrow. Add an optional list parameter for remote dots (party/friends/quest targets/shops); nearby strangers by default hidden to keep it readable at 1,000 CCU.
- Interactions to add to `nearestInteraction` (514): shop counters, job boards, other players (invite/trade), water points. NPC `action` becomes a registry (`minigame`, `shop`, `job`, `quest`).
- Eat/drink at real shops: `SHOP_SIGNS` (js/shopsigns.js, 954 entries `[x, z, rotY, "NAME"]`, generated by `tools/pano_loop/gen_shopsigns.mjs`) has no ID and no category, positions are offsets from pano cameras, about 530 entries share a position, and some sit inside footprints (PROJECT_MAP §2.7). It is also brand-filtered (project memory: no real brand names on signs). So a proper `shops` registry (stable id = hash of rounded x,z,name; category by keyword: phở, bún, bánh, cà phê, trà, nhà hàng...; a service point = `world.findFree()` position, world.js:689) must be generated offline, and prices/menus live on the server.
- Static-sign / market stalls from props: `props.stalls`, `FOOD` clusters (props.js:1150) are decorative, no interaction.

---

## 9. Where the network module plugs in (file:line)

Proposed layout: `js/net/` (client), loaded as ES modules, plus a dedicated network Web Worker following the Blob-Worker precedent in `assets.js:67-112` (and `citygen.js:338`, `landuse.js:549`, `roadtex.js:409`). The worker owns the WebSocket, decodes binary frames, and posts transferable `ArrayBuffer`s to the main thread. This keeps the socket serviced during the 17-35 s synchronous world build (protocol-level pings are answered by the browser, but app-level keepalives and buffering are not). SharedArrayBuffer is not needed and would require COOP/COEP headers that GitHub Pages cannot set.

| # | Where | What to add |
|---|---|---|
| 1 | main.js:17-25 imports | `import { createNet } from './net/net.js'` |
| 2 | main.js:136-141 (after `initInput`, `ui.initUI`, `quests.loadProgress`) | Create the session object and open the socket early as an anonymous guest (token from localStorage or Google). Handshake runs in parallel with the world build. Send `hello{nick, build/worldVersion, tier}` only when Start is pressed. |
| 3 | main.js:156 `boot.armStart` / main.js:1028 `startGame` | Send `join{nick, appearance}`; receive `welcome{playerId, serverTime, dayEpoch, weather, spawn, snapshot}`; place `pState` at the server spawn (spread spawns: `world.findFree`) instead of the single `SPAWN` (213). |
| 4 | main.js:222 (right after `pState` and `player` exist) | `const net = createNet({scene, world, pState, player, vehicles, dayNight, quests, ui, camera})`; build instanced remote groups (reuse traffic.js `makeGroup` pattern: export it or copy the buffer scheme). |
| 5 | main.js:725-726 (after `clampToPlayArea`) | `net.sendState(dt)` at 10-15 Hz from `pState` + `pState.mounted`; local prediction stays as is (client authoritative for feel, server validates). |
| 6 | main.js:755-757 (just before `updateNPCs`) | `net.update(dt, time)`: apply snapshots, interpolate, write remote instance buffers (same place and cost class as `traffic.update` at 763). |
| 7 | main.js:397 `mount`, 422 `dismount`, 458 `callMoto` | `net.send('mount'/'dismount', vehicleId)`; shared vehicles need a server claim (reject → undo mount). |
| 8 | main.js:535 `handleInteract`, 514 `nearestInteraction` | New kinds: `shop`, `job`, `player`, `quest`; send the intent to the server, apply result when acked. |
| 9 | main.js:741-755 (flower pickup, landmark discovery) | Route through `net.claim('flower', i)` / `net.event('visit', id)`; the server grants once per account. |
| 10 | main.js:350 and 370 | Stamina hooks: `input.run ? RUN : WALK` and the jump check (server-authoritative stamina value gates run and jump). |
| 11 | main.js:498 `updateVehicle(v, ...)` / vehicles.js:190 | Fuel and engine-damage hooks (money sink), if wanted. |
| 12 | main.js:766 and daynight.js:500 | Replace local `dayT` advance with `syncTo(server)`; main.js:780 weather uniforms. |
| 13 | main.js:789 `audio.updateAudio` env | Add `remote` scalar and weather fields (rain, wind, thunder). |
| 14 | main.js:818 `drawMinimap` and minimap.js:118 | Optional `markers` argument. |
| 15 | quests.js:25-67 | Replace the `localStorage` functions with a `progress` adapter: `local` (guest) and `remote` (account); keep the v1 schema for migration. |
| 16 | index.html:27-54, 57-70; css/style.css:39-68; ui.js:72-90; input.js:41-48 | Nickname field, Google button, vitals HUD, chat, player list; modal registration; chat key. |
| 17 | main.js:885 `window.__hp` | Gate behind a QA flag in production: `pState`, `teleport`, `world` are writable from the console and are an obvious cheat vector (the server must not rely on this, but it should not be advertised). **Done (riders fixer, 15/10/2026):** `js/qagate.js` — localhost or `?qa=1` only (not `navigator.webdriver`); while ONLINE elsewhere `__hp.net` is null, `__hp.teleport` refuses, `pState/world/vehicles/mount/player/traffic/footprints` read null (main.js); checked by `tools/qa/mp_qagate.mjs`. |
| 18 | main.js:1056 (`boot.step('shaders')`) | Show "Connecting..." status in the boot bar; connection state in the HUD afterward. |

Server-reusable pure-JS modules (no `three`, can be imported in Node 24, which is installed here as v24.15.0): `terrain.js` (groundHeight, groundHeightNoDeck, `WORLD_BOUNDS`), `mapdata.js`, `roadgraph.js` + `xsection.js`, `skymodel.js`, `buildings_data.js` (footprint grid), `landmark_polys.js`.
Not directly reusable: `bridges.js` (its `makeDeckIndex`, line 19, is pure but the file imports three at lines 13-14, so split it out), `landmarks.js` (three), `quests.js` (three + world.js), `footprints.js` (needs `world.rbData`, built at runtime by citygen).
With those the server can check: inside play disc, not in water, on-road/sidewalk vs building footprint, speed limits per mode, bridge level continuity, day/night from `skymodel`. It cannot replicate the circle colliders without a shared export of `world.colliders` (build-time dump of the collider list per world version).

---

## 10. Risks, ranked

1. Frame budget and main-thread long tasks. The frame is CPU-bound at about 23 µs per draw call. Boot is 17-35 s in one task (PROJECT_MAP §0). Remote avatars must stay at a fixed handful of draw calls (instancing, section 3.2), no per-player materials, no per-player canvas textures.
2. Join latency and heartbeat. For 17-35 s after page load the main thread is blocked. A socket owned by the main thread will miss app-level heartbeats. Use the network worker; server must not drop a connected-but-loading client; late-join sends a full AOI snapshot when the client signals `ready`. Same-second thundering herd on the single spawn point (`SPAWN`, main.js:213).
3. Everything is client-trusted today: movement, collision, pickups, quests, saves. Survival/money/jobs make cheating valuable. Collision truth cannot be moved to the server cheaply (circle colliders + polygon fabric are built at runtime). Plan: server-side plausibility (section 1.3 limits, terrain/water/footprint checks with pure modules), authoritative economy and vitals, client authoritative only for position feel. `window.__hp` exposes writable state (main.js:885).
4. World mismatch between clients. `TIER`/`LITE` and `?fabric=` change generated content (props caps, citygen detail). Colliders may differ across tiers (unverified). Add a `worldVersion` hash (data file hashes + code build id) in the handshake and a test that hashes `world.colliders` per tier. Remote players may appear inside walls on others' screens (cosmetic, acceptable).
5. Time bases. Three clocks exist: clamped `time`/`dt` (main.js:707-708, drifts on slow machines), real `performance.now()` (used for throttles; KNOWLEDGE traps "da"/"dc"), and `dayT`. Network code must use real clock plus a server-time offset, never the clamped `dt`, for interpolation timestamps, cooldowns and day cycle.
6. Traffic divergence. Cars and pedestrians differ per client (section 4). Do not build mechanics on them (no damage, no jobs depending on specific cars). A deterministic flow model is a large rewrite of traffic.js (about 885 lines).
7. Vehicle model limits: one seat, no pillion pose on the rig, no cargo pose; shared vehicles need ownership; boats only at piers. This constrains xe ôm and shipper jobs and the fisherman job (needs boat plus a water interaction).
8. No interiors: shops, shelter, cafes can only be storefront interactions. Brand-name filter applies to any generated shop names (project memory). `SHOP_SIGNS` has no ids and 530 duplicate positions, and the generator is regenerated, so index keys are unstable; a registry with stable hash ids is needed.
9. Name tags and chat text: `makeTextSprite` is O(canvas) per label. Chat bubbles above heads must use the atlas approach too. Vietnamese nicknames and chat are diacritic-heavy: the current canvas path uses `'Segoe UI', sans-serif` (world.js:21793), which is not guaranteed on Android/iOS, so the glyphs may come from a fallback font. Define a font stack with a Vietnamese-capable family and check a sample frame with diacritics on a phone (same failure family as the Remotion SVG-text note in the user's CLAUDE.md, though canvas 2D text itself is not corrupted the way SVG `<text>` is).
10. UI collisions: `Enter`=interact vs chat; `isAnyModalOpen` is a closed list; `#hud` is pointer-events none; `user-scalable=no`. i18n has no formatting helpers.
11. Hosting: the site is GitHub Pages static (`deploy-pages.yml` force-pushes `gh-pages`); `vercel.json` only sets headers. A separate `wss://` game server is mandatory (HTTPS page → no `ws://`). `sw.js` (heavy assets only) is unaffected. Pages cannot set COOP/COEP, so no SharedArrayBuffer.
12. Load testing: do not drive 1,000 real Chrome WebGL clients on this machine. Parallel GPU Chrome caused BSOD 0x133 three times (project memory; `tools/qa/gpulock.mjs`). Use headless protocol bots (WebSocket only) for load, and at most one real browser at a time under the GPU lock for visual/perf checks.
13. Local progress import: `hp3d.progress.v1` is user-editable; treat as untrusted on import; flower ids are indices < 64 (quests.js:41) and tied to world determinism (risk 4).
14. Density/hotspots: 1,000 players in a 7.9 km² play disc is about 126 per km² on average, but players cluster (Opera square, Chợ Sắt, lake). The AOI cap and the render cap (section 3.2) must be tested at 200+ players in a single 100 m cell, not only at average density.

---

## 11. Suggested first implementation slice (smallest end-to-end, to de-risk the above)

1. Net worker + binary protocol + `hello/join/welcome` + server-time sync (offset and RTT), no gameplay.
2. Remote avatars as one instanced `remote_ped` group + contact shadows, interpolation, AOI cap, using `pedestrianGeometry` and `kitMaterial`.
3. Day-time sync (`dayNight.syncTo`) so all players share the same sun.
4. Nickname field on the title screen, atlas name tags for the nearest 24.
5. Riders (personal motorbike as `remote_ride_*`) and shared-vehicle claims.
6. Server-side plausibility checks with `terrain.js` + `skymodel.js`; `worldVersion` handshake; collider-hash test per tier.
Survival vitals, shops registry, weather and the quest engine layer on top once state and events flow.
