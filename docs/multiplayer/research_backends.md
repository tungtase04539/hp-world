# Hải Phòng 3D — Authoritative multiplayer backend: options research (2026-10-14)

Scope: a browser (three.js, no build step, static site) open-world city, **1,000–3,000 concurrent players (CCU) in ONE shared world**, ~10 Hz state updates with interest management, players mostly in Vietnam on mobile + desktop, "play instantly with a nickname" plus optional Google sign-in, survival/jobs/quests to come later.

Evidence tags used below: **[V]** = read on the vendor/primary page during this research; **[3P]** = third-party / secondary / vendor-marketing; **[E]** = my own estimate or derivation (assumptions stated, must be validated by a spike). Where a number could not be verified I say so rather than guess.

---

## 0. TL;DR (EN)

1. **No off-the-shelf product gives you "1,000–3,000 players in one seamless open world".** Every candidate shards by *room/match/database/actor* and leaves the spatial layer (zones, border replication, hand-off) to you. The question is therefore "what do I want under my own zone code": a cheap VM, a serverless actor, or a game-backend framework.
2. **Cost at this load is dominated by outbound bandwidth, not CPU.** At 10 Hz and ~40 visible entities, one player costs ~45 kbps down; 1,000 CCU ≈ 45 Mbps ≈ 20 GB/h ≈ 5 TB/month at a typical 35% daily average (14.5 TB if 1,000 are online 24/7) [E]. Platforms that bill egress ($0.08–0.15/GB: Rivet, SpacetimeDB Maincloud, Edgegap, AWS) turn that into $0.5–2k/month per 1,000 CCU; Hetzner/Vultr-class VMs ($8–10/TB) or Cloudflare Durable Objects ($0 egress) keep it at tens of dollars.
3. **2026 was a platform-death year** (Hathora shut down 2026-05-05; Unity Multiplay hosting sunset 2026-03-31; PlayFab cut to "Foundation Mode"). Prefer open source you can run yourself, behind a thin transport interface you own.
4. **Recommendation:** build **custom authoritative zone servers in Node.js + uWebSockets.js** (binary protocol, grid interest management), self-hosted on dedicated-vCPU VMs in **Singapore** (plus Postgres), with **our own thin Google-ID-token auth** (guest token first, "link Google" later). Keep game logic transport-agnostic so the same sim can run as **Cloudflare Durable Objects (Plan B: zero-ops, ~$130–400/mo at 1k CCU, hard 1,000-req/s-per-object ceiling)** or under **Colyseus rooms**. Use **WebSocket now, WebTransport later** as an opt-in (Baseline since Mar 2026 but servers are immature and UDP is blockable). Do **not** build on Nakama (Heroic Cloud $1.2k+/mo for a thin fit), SpacetimeDB Maincloud (est. $2k+/mo at 1k CCU for 10 Hz movement) or Photon/PlayFab/Hathora-style products for this game.
5. **Budget tiers (est., monthly):** alpha ≤200 CCU **$5–25**; launch ≤1k CCU **$200–450**; growth ≤3k CCU **$600–1,300**; fully managed alternatives **$1.2k–7k+**.

### TL;DR (VI, cho chủ dự án)
- Không có dịch vụ nào "bật lên là chạy" cho 1.000–3.000 người trong MỘT thành phố liền mạch; mọi lựa chọn đều chỉ chia theo phòng/match/actor, phần chia vùng theo bản đồ (zone, đồng bộ biên, chuyển người chơi) mình phải tự viết.
- Chi phí chủ yếu là **băng thông ra** (≈45 kbps/người ở 10 Hz → ~5 TB/tháng cho 1.000 CCU trung bình), không phải CPU. VM kiểu Hetzner/Vultr rẻ (~$8–10/TB), Cloudflare DO không tính egress; Rivet/SpacetimeDB Maincloud/AWS tính $0.08–0.15/GB nên đắt gấp 10–50 lần.
- Khuyến nghị: **server Node.js + uWebSockets.js tự viết, thuê VM ở Singapore + Postgres + đăng nhập Google tự xác thực ID token**; giữ logic game tách khỏi lớp mạng để có thể chuyển sang Cloudflare Durable Objects hoặc Colyseus. WebSocket trước, WebTransport thêm sau.
- Lưu ý pháp lý: game nhiều người chơi tương tác qua máy chủ là "game G1" theo Nghị định 147/2024 (cần giấy phép doanh nghiệp) — xem mục 7, cần hỏi luật sư trước khi mở công khai.

---

## 1. Workload model (assumptions used for every cost number)

| Parameter | Value | Note |
|---|---|---|
| Snapshot rate | 10 Hz, one batched binary message per client per tick | batching is required anyway (Cloudflare docs also advise 50–100 ms batching [V]) |
| Visible entities per client (V) | 20 / **40** / 80 (low / base / high) | players + interactive NPCs in the area of interest (AOI) |
| Bytes per entity update | 12 B after quantization + delta | id u16, x/z i16 deltas, y, yaw, anim/state |
| Per-message overhead | ~70 B (WS frame + TLS record + TCP/IP) + 8 B snapshot header | |
| Upstream per client | 10 Hz × (70 + 20 B) ≈ 0.9 KB/s | |
| "Typical" load | average = 35% of peak CCU over a month | diurnal curve; "full" = peak 24/7 = upper bound |

Derived [E] (script: `model.mjs` in this folder):

| CCU | Down per client | Aggregate down | Per hour | Month, typical (35%) | Month, full 24/7 | Aggregate up |
|---|---|---|---|---|---|---|
| 1,000 (V=40) | 44.6 kbps | 45 Mbps | 20 GB/h | **5.1 TB** | 14.5 TB | 7 Mbps |
| 3,000 (V=40) | 44.6 kbps | 134 Mbps | 60 GB/h | **15.2 TB** | 43.4 TB | 22 Mbps |
| 1,000 (V=80, dense downtown) | 83 kbps | 83 Mbps | 37 GB/h | 9.4 TB | 26.9 TB | 7 Mbps |
| 3,000 (V=80) | 83 kbps | 249 Mbps | 112 GB/h | 28.3 TB | 80.7 TB | 22 Mbps |

Player-side note: 45 kbps ≈ 20 MB/hour of mobile data per player; worth an adaptive-rate / LOD policy (target average ≤ 30 kbps).

CPU model [E, must be validated]: 1,000 CCU × 10 Hz × V=40 is ~400k entity-writes/s. If the snapshot of each grid cell is encoded once and shared by all clients that see it, this is a few ms per tick — plausibly one Node process for 1,000 CCU, 3–6 zone processes for 3,000. Per-client message sends (10k–30k/s) are what uWebSockets-class servers are good at. Bandwidth, not CPU, is the real bill. Keep NPC traffic/ambient crowds client-side deterministic (seeded from server time) so V counts only players and interactive NPCs.

---

## 2. What changed in 2026 (platform-risk lens)

- **Hathora**: announced 2026-03-04 that game-server hosting shuts down; acquired by Fireworks AI, platform frozen, switched off **2026-05-05**; customers pointed to Nitrado GameFabric [3P: [crux](https://crux.supercraft.host/blog/hathora-shut-down-where-to-go-after-may-2026/), [gameye](https://gameye.com/blog/game-server-shake-up-2026)]. Stormgate lost its online modes after the sale [3P].
- **Unity Multiplay Hosting**: direct support ended **2026-03-31**, software licensed to Rocket Science Group [3P: [gameye](https://gameye.com/blog/game-server-shake-up-2026), [crux](https://crux.supercraft.host/blog/game-backend-shutdowns-2026-who-died-where-studios-went/)].
- **PlayFab**: not shut down, but "Foundation Mode" (2026-03-11) and Development Mode capped at 1,000 lifetime players per title [3P: crux link above].
- Lesson recorded by the same source: keep an export path for accounts/saves, wrap vendor SDKs in your own thin interface, avoid coupling hosting + backend + live-ops to one vendor. This directly supports the "own the zone server, rent only commodity VMs" recommendation.

---

## 3. Candidate profiles

### 3.1 Nakama (Heroic Labs)
- **Capacity.** Published per-node test: **20,277 concurrent sockets on 1 CPU / 3 GB**, 29,550 on 2 nodes×1 CPU, **35,723 on 2 nodes×2 CPU**; authoritative-match workload is reported only as request rates (10 ticks/s, 10 players per match), no "players per core" figure [V: [benchmarks](https://heroiclabs.com/docs/nakama/getting-started/benchmarks/)]. Cluster test: **2.05 M connected clients** on Heroic Cloud (AWS EKS/EC2/Aurora) but the workloads were auth + heartbeat, chat messages every 10–20 s, and wallet/inventory writes — **not spatial gameplay** [V: [2M CCU test](https://heroiclabs.com/blog/code-wizards-scale-test-of-nakama-2m-ccu/)]. Heroic's own scaling guidance: "no universal formula" for CPU per CCU, keep 25% headroom, dashboard goes to 120 vCPU [V: [scaling](https://heroiclabs.com/docs/heroic-cloud/concepts/introduction/scaling/)].
- **Sharding model.** An authoritative match's handler and state live on **one node**; matches cannot talk to each other except via match signals; ticks must finish before the next is due or the server ends the match; payload guidance ≤ 1,500 B MTU and ≤ 1 message per tick per presence [V: [authoritative multiplayer](https://heroiclabs.com/docs/nakama/concepts/multiplayer/authoritative/)]. So a world = many matches you route players between yourself. Staff say there is no hard per-match cap; community reports go up to ~128 players per match [3P: [forum](https://forum.heroiclabs.com/t/how-to-increase-the-32-player-limit-for-nakama-realtime-matches/6499)].
- **Clustering is Enterprise-only** (mesh, HA, split-brain healing, proprietary license); OSS is Apache-2.0 and a single node on CockroachDB/Postgres [V: [enterprise](https://heroiclabs.com/enterprise/), [GitHub](https://github.com/heroiclabs/nakama)].
- **Auth/persistence.** Best of the field: device-ID (anonymous), email, Google/Apple/Facebook/Steam, custom; *link* attaches a new identifier to the signed-in account, 409 if that identifier belongs to another account (no automatic progress merge) [V: [auth docs](https://heroiclabs.com/docs/nakama/concepts/authentication/)]. Storage, leaderboards, groups, chat, notifications out of the box. Runtime in Go / TypeScript / Lua.
- **Transport.** WebSocket (JS client) + HTTP/gRPC. I found no WebTransport support [absence of evidence].
- **Pricing.** Heroic Cloud: no DAU/MAU/CCU limits; support packages $2,000 / $6,000 per month [V: [pricing](https://heroiclabs.com/pricing/)]. AWS Marketplace listing bills **$13.33/day per Nakama CPU and $6.67/day per DB CPU** (≈ $400 and ≈ $200 per CPU-month) plus AWS infra [3P: [AWS listing via search](https://aws.amazon.com/marketplace/pp/prodview-zfxkalyjehlh2)]. Regions: Seoul (2021 announcement) — Singapore not confirmed [3P: [region post](https://heroiclabs.com/blog/heroic-cloud-east-asia-region-announced/)].
- **Verdict.** Excellent for accounts/economy/leaderboards/chat; poor fit for the *realtime spatial layer* (match = single node, no open-world primitives) and the clustering that makes it scale is paid. Would still need a custom zone layer.

### 3.2 SpacetimeDB (Clockwork Labs)
- **Model.** "A relational database that is also a server": your module (Rust/C#/TypeScript) runs inside the DB; clients subscribe to SQL queries and receive live row deltas over a binary WebSocket protocol (BSATN subprotocol) [V: [GitHub](https://github.com/clockworklabs/SpacetimeDB), [WS docs](https://spacetimedb.com/docs/ws)]. Subscriptions + row-level security are the interest-management primitive.
- **Limits.** Each database is **single-threaded by design** and holds all table data **in memory on one machine**; benchmark ≈ 300k transactions/s on a simple TS transfer workload; no per-DB connection/CCU cap is published [V: [how Spacetime scales](https://spacetimedb.com/blog/how-does-spacetime-scale)]. Roadmap: async inter-database communication + tiered storage on **2026-10-31**; networking read-replicas, sync cross-DB transactions and intra-DB partitioning are "planned" [V: same page; [runtimewire](https://runtimewire.com/article/spacetimedb-october-31-scaling-plan-single-thread)] — i.e. the sharding story is days-old.
- **Case study.** BitCraft Online runs a root DB + **many region DBs** (spatial partition by design) [V: [scaling post](https://spacetimedb.com/blog/how-does-spacetime-scale), [BitCraft note](https://bitcraftonline.com/news/spacetimedb-and-bitcraft)]. Steam peak ≈ 4,382 CCU (June 2025), ~2,800 in March 2026 and falling, spread over the whole game [3P: [steamcharts](https://steamcharts.com/app/3454650)]; early-access launch had stability trouble [3P: [massivelyop](https://massivelyop.com/2026/08/10/bitcraft-online-finally-addresses-long-standing-stability-problems-and-overhauls-mining/)]. No per-region player cap is public.
- **Auth.** OIDC JWTs (needs a stable issuer, audience, JWKS; reports that an *ID token*, not an access token, is expected) [3P: [Better Auth guide](https://spacetimedb.com/docs/core-concepts/authentication/BetterAuth), [community write-up](https://dev.to/insiderto/how-to-obtain-an-oidc-id-token-for-spacetimedb-using-nextjs-and-auth0-1ci)]. Anonymous identities are native.
- **License.** BSL 1.1 converting to AGPL v3 with linking exception "after a few years" (release notes differ on AGPL vs GPLv3) — self-hosting a game on it is permitted; competing DBaaS is not [V/3P: GitHub page above; [NuGet license page](https://www.nuget.org/packages/SpacetimeDB.Runtime/2.8.0/License)].
- **Pricing (Maincloud).** Free 2,500 TeV; Pro **$25/mo** with 100,000 TeV (~120 M reducer calls, ~500 GB egress, ~40 GB storage); Team $250/mo; overage **2,592 TeV per $**; implied ≈ 1,200 calls/TeV and ≈ $0.077/GB egress [V: [pricing](https://spacetimedb.com/pricing), [pricing blog](https://spacetimedb.com/blog/all-new-spacetimedb-pricing)]. At 10 Hz movement every client input is a billable reducer call; see cost table.
- **Transport.** WebSocket only that I could find.
- **Verdict.** Conceptually the best-matched data model for an MMO (subscriptions = interest management, regions = shards) and the only candidate with a real MMORPG running on it, but: young sharding, memory-bound single-thread DBs, BSL license, metered cost makes 10 Hz movement expensive on Maincloud. Interesting **Plan C self-hosted** after Oct-31 features land and after a spike.

### 3.3 Colyseus
- **Capacity.** Docs: 1,000–2,000 concurrent connections on a 1 vCPU / 1 GB box *for simple games*, 2–5 KB per connection, raise file-descriptor limits; "load test your use case" [V: [FAQ](https://docs.colyseus.io/faq)]. README claims "10 to 10,000+ CCU by scaling vertically or horizontally with Redis and load balancers" [V: [GitHub](https://github.com/colyseus/colyseus), MIT].
- **Sharding.** Each Room belongs to exactly one process; clients connect directly to the process that owns their room; multi-process needs Redis presence + driver and a public address per process [V: [scalability](https://docs.colyseus.io/scalability)]. No seamless zone hand-off — you write it.
- **Interest management.** 0.16 `StateView` filters per client, but the post warns it is "not recommended for big datasets, not optimized for that yet" [V: [0.16 post](https://colyseus.io/blog/colyseus-016-is-here/)]. In practice you would bypass Schema sync and send your own binary snapshots.
- **Auth.** `@colyseus/auth` (beta): email, anonymous, OAuth incl. Google; `onAuth` hook verifies tokens [3P: [auth module](https://docs.colyseus.io/auth/module)].
- **Transport.** WebSocket default; **WebTransport is experimental** via `@colyseus/h3-transport` ("hasn't been battle tested"), unreliable sends only through `client.sendUnreliable()`, JS SDK only [V: [WebTransport page](https://docs.colyseus.io/server/transport/webtransport)].
- **Managed.** Colyseus Cloud "from $15/mo", no CCU limits, "32 locations", 99.9% SLA, **no autoscaling** (manual resize/instances) [V: [pricing](https://www.colyseus.io/pricing), [cloud](https://colyseus.io/cloud-managed-hosting)]; tier table and bandwidth not public; Asia/Singapore not confirmed.
- **Adoption.** 48 Vibe Jam 2026 entries (~15% of multiplayer entries) [V: [post](https://colyseus.io/blog/vibe-jam-2026/)]; no public MMO-scale numbers found.
- **Verdict.** Best "batteries included" for rooms/matchmaking/reconnection/loadtest tooling, MIT, easy self-host. It is a room framework, not an open-world server; value for us is moderate. Valid runner-up and a plausible *Tier-0 vehicle*.

### 3.4 Cloudflare Durable Objects (+ WebSocket Hibernation, PartyKit/PartyServer)
- **Model.** One single-threaded JS object per ID with its own storage and WebSockets; Hibernation lets idle objects sleep while sockets stay open [V: [WebSockets best practices](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)]. Cloudflare acquired PartyKit (2024) and names multiplayer gaming as a target [3P: [plushcap](https://www.plushcap.com/content/cloudflare/blog/cloudflare-acquires-partykit)].
- **Limits.** **Soft limit 1,000 requests/s per object** (WS messages count as requests for billing; I assume they count here too); 30 s CPU per invocation default; 10 GB SQLite storage; 32 MiB max received WS message; no stated WS-per-object cap ("thousands of clients per instance") [V: [limits](https://developers.cloudflare.com/durable-objects/platform/limits/)]; 128 MB isolate memory may be shared by objects on the same machine [3P: pricing doc warning surfaced in search; [pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)]; attachment ≤ 16 KB; **deploying a new version restarts every Durable Object and disconnects all WebSockets** [V: WebSockets page].
- **What that means [E].** At 10 Hz inputs per player one object saturates around **80–100 players** (200 at 5 Hz), so 1,000 CCU needs ≥ 13 zone objects and 3,000 CCU ≥ 38, with cross-object RPC for border visibility. Downtown hot spots (landmarks) can exceed the cap — the zone map must be population-adaptive.
- **Placement.** An object is created near the first request; hints (`apac`, `apac-ne`, `apac-se`) are best-effort and cannot pin it to Hanoi/HCMC; objects never move afterwards [V: [data location](https://developers.cloudflare.com/durable-objects/reference/data-location/), [APAC hints changelog](https://developers.cloudflare.com/changelog/post/2026-06-19-apac-ne-apac-se-location-hints/)]. Cloudflare has PoPs in Hanoi and Ho Chi Minh City [3P: [blog](https://blog.cloudflare.com/ten-new-data-centers/)], but DO placement there is undocumented.
- **Pricing [V: pricing page].** Paid plan: $0.15/M requests (1M incl.), **incoming WebSocket messages billed 20:1**, outgoing messages free, duration $12.50/M GB-s (400k incl., billed on 128 MB while active), SQLite rows written $1/M (50M incl.), **no egress fee**. Min $5/mo.
- **Auth.** None built in; verify Google ID tokens in a Worker (e.g. `google-auth-library`/JWKS) and issue your own session token.
- **Transport.** WebSocket. No evidence of inbound WebTransport on Workers/DO (inbound TCP is private beta, Aug 2026 [3P: [Cloudflare blog](https://blog.cloudflare.com/grpc-workers/)]).
- **Case studies.** None at MMO scale found; demos only (e.g. Unity "Durable World" [3P: [plushcap](https://plushcap.com/content/cloudflare/blog/building-real-time-games-using-workers-durable-objects-and-unity)]).
- **Verdict.** Cheapest and lowest-ops path to ~1k CCU if you accept: ~100-player ceiling per zone object, JS-only sim in a 128 MB isolate, deploy-time disconnects, no Vietnam pin, vendor lock-in, and zero public evidence at this scale. Strong **Plan B** and a good home for stateless-ish services (matchmaking, chat, leaderboards).

### 3.5 Custom servers: uWebSockets.js / Bun / Go / Rust (+ zone sharding)
- **uWebSockets.js.** C++ core with Node bindings, Apache-2.0, installed from a GitHub tag (not npm), built-in pub/sub; project claims 13× Fastify / 20× Socket.IO [V/3P: [README](https://github.com/uNetworking/uWebSockets.js)]. Independent test (Evil Martians, 32 vCPU/32 GB): ~**5 KB per connection** bare wire, p99 10 ms at 10k subscribers, but ~9 s to absorb a 20k reconnect storm [V: [benchmark](https://evilmartians.com/chronicles/choose-your-fighter-benchmarking-5-websocket-servers-for-nodejs)]. Node + uWS is the same language as the client code (`js/world.js` terrain/collision formulas and the generated `js/mapdata.js` can be shared with the server) — a large practical win for this repo. Single-maintainer project (bus-factor risk; fallback is the `ws` library) [E].
- **Bun.** Native WebSocket pub/sub built on uWebSockets [V: [Bun docs](https://bun.com/docs/runtime/http/websockets.md)]; the only published benchmark is from Bun v0.2.1; I found no 2026 game-server data [3P]. Not needed; plain Node LTS is lower risk.
- **Go.** Mature (Nakama is Go); event-loop libs like `nbio` report 1 M WebSocket connections at ~1 GB for echo workloads [3P: [nbio README](https://pkg.go.dev/github.com/lesismal/nbio)]; `quic-go/webtransport-go` for WebTransport (targets an old draft; maintenance history shaky) [3P: [pkg.go.dev](https://pkg.go.dev/github.com/quic-go/webtransport-go)]. Requires a second language and no code sharing with the client.
- **Rust.** Highest ceiling (tokio + `wtransport` for WebTransport per MDN's library list [V: [MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebTransport_API)]); slowest to iterate, worst code-sharing; unnecessary at ≤ 3k CCU.
- **Sharding.** You own it: grid interest management (e.g. 128–150 m cells), zone processes owning cell ranges, 1-cell border replication ("ghosts"), hand-off with a short-lived transfer token, gateway processes terminating WebSockets. Redis/NATS only for cross-process control messages.
- **Persistence/auth.** Postgres (or SQLite+Litestream at tiny scale); Google Identity Services → ID token → server verification (Google recommends client libraries such as `google-auth-library`, check `aud`/`iss`/`exp`) [3P: [Google guide](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token)].
- **Case studies (custom-server MMOs).** Jagex runs Old School RuneScape worlds on regional-datacentre VMs with a 0.6 s tick that stretches as worlds fill [3P: [OSRS wiki](https://oldschool.runescape.wiki/w/Game_tick), [Spudworks](https://oldschool.runescape.wiki/w/Update:More_Worlds,_More_Power:_The_Road_To_Greater_Capacity)]; practitioners quote 500–1,500 players "in one place" as a practical single-area limit [3P: [gamedev.net thread](https://gamedev.net/forums/topic/657588-mmos-and-modern-scaling-techniques/?page=1)].
- **Verdict.** Highest fit and lowest cost; most code to write (gateway, zone sim, AOI, encoder, hand-off, persistence) and you operate it. Mitigated by AI-assisted development, a transport-agnostic design, and the small play disc (R = 1,588 m).

### 3.6 Rivet (Actors)
- Apache-2.0 actor platform (in-memory state + SQLite persistence, Durable-Objects-like), self-host (RocksDB single node; Postgres backend "experimental") or Rivet Cloud [3P: [sliplane](https://sliplane.io/blog/self-hosting-rivet-engine-the-easy-way)]. Cloud: Free ($0, hard caps), **Hobby from $20/mo**, **Team from $200/mo** (400k awake-actor-hours, 8 vCPU, **1 TB egress** included); usage: $0.05/1k actor-hours, **egress $0.15/GB**, compute from $0.000033/vCPU-s + $0.0000029/GiB-s; actors 0.08–8 vCPU, 128 MiB–4 GiB [V: [pricing](https://rivet.dev/cloud/)]. Actors are placed in the region nearest the first client by default and never move; the region list is not public in what I read (SE Asia unconfirmed) [3P: [edge docs](https://rivet.dev/actors/docs/general/edge)].
- **Verdict.** Interesting self-hostable alternative to DO; too young and, on Cloud, egress-priced ($0.15/GB) for this workload. Watch, do not adopt.

### 3.7 Game-server orchestrators (Edgegap, GameFabric/Nitrado, Gameye, Agones, GameLift)
- Session-oriented: they start/stop dedicated-server containers per match; they do not provide persistence, auth, or open-world sharding [3P: [crux on Edgegap](https://crux.supercraft.host/blog/edgegap-orchestration-alternatives/)]. Edgegap pay-as-you-go ≈ $0.00115/min per vCPU (≈ $50/vCPU-month) + **$0.10/GB egress**, bare-metal private fleets from $250/mo (no egress fees) [3P: [fitgap](https://us.fitgap.com/products/edgegap)]; WebSocket support and SE-Asia/Vietnam locations not confirmed from their docs.
- **Verdict.** Wrong abstraction for one persistent city. Could host the Node zone containers, but a plain VM is cheaper and simpler. Hathora's death makes this category the riskiest.

### 3.8 Photon / PlayFab (excluded)
- **Photon** Public Cloud: 2,000 CCU plan **$370/mo** incl. 6 TB (3 GB per peak CCU per month — only ~20–60% of what a peak-CCU slot moves in our model, 5–14.5 GB/month [E]), 100-CCU launch plan $95 one-time, free 20 CCU dev tier [3P: [Photon pricing via search](https://www.photonengine.com/pricing)]. Photon Realtime is a relay/room service; Fusion/Quantum authoritative modes target Unity/Unreal/Godot, not three.js. No server-side authority for our game rules → excluded.
- **PlayFab Multiplayer Servers** run Unity/Unreal-style dedicated servers; a GitHub issue shows a WebGL client unable to talk to them over raw WebSocket [3P: [issue](https://github.com/PlayFab/MultiplayerServerSecureWebsocket/issues/9)]; PlayFab was also cut back in 2026 → excluded.

---

## 4. Comparison table (technical)

| Option | Realistic CCU per unit | Spatial sharding | Auth / persistence | Browser transport | License | Ops complexity | MMO-scale evidence | Fit |
|---|---|---|---|---|---|---|---|---|
| **Custom Node + uWebSockets.js** | ~5 KB/conn idle [V]; 1k CCU/process plausible, 3k = 3–6 zone procs [E] | DIY: grid AOI + zone procs + ghosts + hand-off | DIY (Postgres + Google ID-token verify, easy) | WS now; WT via Node/Go/Rust H3 sidecar later | Apache-2.0 (uWS), yours | Medium (you run VMs/DB) | OSRS-style custom worlds [3P]; uWS reconnect-storm 9 s/20k [V] | **Best** |
| **Colyseus** (self-host / Cloud) | 1–2k conn/vCPU simple [V]; claims 10k+ w/ Redis [V] | Room = 1 process; zones DIY | `@colyseus/auth` beta incl. Google [3P] | WS; WT experimental [V] | MIT | Low–Med (Redis, PM2; Cloud no autoscale) | 48 jam games; no MMO data | Good runner-up |
| **Cloudflare Durable Objects** | ~80–100 players/object @10 Hz in (1k req/s soft) [E from V] | 1 DO per cell/zone, RPC between; DIY hand-off | DIY in Worker; storage SQLite 10 GB/obj | WS only | Proprietary (lock-in) | Very low | No MMO case; demos only | Plan B |
| **Nakama OSS** (self-host) | 20k idle sockets/1 CPU [V]; auth'd gameplay unpublished | Match = single node; routing DIY | **Best built-in** (Google, device, link) | WS (no WT found) | Apache-2.0 | Medium (+DB) | 2M synthetic CCU [V] | Meta-layer only |
| **Nakama on Heroic Cloud** | same + cluster (Enterprise) | Matches placed across nodes; routing DIY | same | WS | Commercial | Very low | same | Too costly |
| **SpacetimeDB self-host** | single-thread, in-memory per DB; ~300k simple tx/s [V] | DB per region (BitCraft); async cross-DB from 2026-10-31 | OIDC, anonymous identities | WS (BSATN) | BSL→AGPL | Medium (young) | BitCraft ~4k Steam peak [3P] | Plan C |
| **SpacetimeDB Maincloud** | managed | same | same | WS | managed | Very low | same | Cost-prohibitive at 10 Hz |
| **Rivet (Cloud / self-host)** | not published | actor per zone | DIY | WS | Apache-2.0 | Low (Cloud) / Med | none found | Watch |
| **Edgegap / GameFabric / Gameye / Agones** | n/a (per-session containers) | n/a | none | depends | proprietary / Apache (Agones) | Medium | session games | Wrong shape |
| **Photon / PlayFab** | 100–2,000 CCU plans | rooms / Unity | partial | WebGL SDKs / none | proprietary | Low | Unity games | Excluded |

Weighted fit score (weights: open-world fit 25, cost 20, control/longevity 15, dev speed for a solo JS dev + AI 15, ops 10, auth/persistence 10, Vietnam region 5; my judgment, `score.mjs`): **Custom Node+uWS 81**, Colyseus 75, SpacetimeDB self-host 74, Cloudflare DO 70, Nakama OSS 65, SpacetimeDB Maincloud 59, Nakama Heroic Cloud 58, Rivet Cloud 55.

---

## 5. Cost at 1,000 and 3,000 CCU (monthly, USD, estimates)

"Typical" = average 35% of peak; "full" = peak concurrency 24/7. Bandwidth model from section 1 (V=40). Compute estimates assume headroom; none of the CPU sizes are measured.

| Option | 1,000 CCU typical – full | 3,000 CCU typical – full | What drives the bill / assumptions |
|---|---|---|---|
| **Custom on Hetzner Singapore** | **$220–320 – $300–430** | **$700 – $1,000+** | Dedicated vCPU ≈ €22–27/vCPU-mo (Singapore CCX €54–1,036, 1–8 TB included, overage €7.40–$8.49/TB [3P: [costgoat](https://costgoat.com/pricing/hetzner), [Hetzner SG](https://www.hetzner.com/cloud-singapore/)]); 4 vCPU + 2 vCPU standby/DB at 1k, ~12 vCPU + gateway + DB at 3k [E]; egress ≈ $26/$106 (1k) and $112/$351 (3k) |
| **Custom on Vultr Singapore** | similar | similar | overage $0.01/GB [3P: [Vultr docs](https://docs.vultr.com/support/platform/billing/what-is-the-bandwidth-overage-rate)]; 4 vCPU/8 GB ≈ $48 w/ 6 TB [3P] |
| **Custom on Fly.io (APAC)** | +$200 egress – +$580 | +$610 – +$1,730 | APAC egress $0.04/GB [3P: [servercompass](https://servercompass.app/blog/flyio-pricing-breakdown-vs-vps)] |
| **Custom on AWS / GCP Singapore** | +$600 – +$1,700 egress | +$1,800 – +$5,200 | ≈ $0.12/GB internet egress [3P: [egresscost](https://egresscost.com/aws/data-transfer-pricing)]; the cost trap |
| **Cloudflare Durable Objects** | **$130–200 – $370** | **$440–600 – $1,250** | req 20:1 + duration of 13 / 38 objects + player-save writes (2/min/player) + ~30% for cross-object RPC and the front Worker [E from V pricing]; **egress $0** |
| **Colyseus self-host** | same as custom + Redis ($10–30) | same | MIT |
| **Colyseus Cloud** | "from $15"; real tiers not public | unknown | get a quote; manual scaling [V] |
| **Nakama OSS self-host** | $250–400 | $600–900, single node, no HA | clustering not available in OSS |
| **Nakama Heroic Cloud** | **$1.2k–2.4k** (2+2 to 4+4 CPU) | **$2.4k–4.8k+** | $400/Nakama-CPU + $200/DB-CPU per month [3P] + AWS infra/egress + optional $2k–6k support; CPU counts are my guess, Heroic publishes no ratio |
| **SpacetimeDB Maincloud** | **$2.2k typical – $6k+ full** | **$6.7k – $17k+** | 5 reducer calls/s/player ⇒ 4.5 B calls/month at 1k typical ≈ $1.46k, plus egress at ~2× row overhead ≈ $0.8k [E from V pricing]; very sensitive to calls/s and TeV-per-call |
| **SpacetimeDB self-host** | ≈ custom ($250–400) | ≈ custom + bigger box | BSL permits game use |
| **Rivet Cloud** | **$0.95k – $2.6k** | **$3.1k – $8k** | $0.15/GB egress dominates; 0.5 vCPU/zone assumed |
| **Edgegap (containers)** | $700 – $1.65k | $2.1k – $4.9k | 4/12 vCPU-containers + $0.10/GB [3P] |
| **Photon Public Cloud** | $370 plan + traffic overage | cap 2,000 CCU | relay only, fails authority requirement |

Tier summary (all-in incl. Postgres/backups/monitoring, my estimate): **Alpha ≤200 CCU: $5–25** (one VPS, or Cloudflare free/$5) · **Launch ≤1k CCU: $200–450** · **Growth ≤3k CCU: $600–1,300** · **Managed premium: $1.2k–7k+**.

---

## 6. WebSocket vs WebTransport in 2026

- **Browser support:** WebTransport reached **Baseline "newly available" in March 2026** when Safari 26.4 shipped it (Chrome 97+, Edge 98+, Firefox 114+) — still partial in places and not "widely available" (30-month bar ≈ Sept 2028) [V/3P: [MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebTransport_API), [webrtc.ventures](https://webrtc.ventures/2026/04/webtransport-is-now-baseline-what-it-means-for-real-time-media/)]. The HTTP/3 binding is still an IETF draft (draft-16, July 2026) and browsers/servers disagree on edge details such as the `:protocol` token [3P: [IETF](https://datatracker.ietf.org/doc/draft-ietf-webtrans-http3/16/)]. No browser devtools show WebTransport traffic as of July 2026 [3P].
- **Server support:** Colyseus experimental; Go `quic-go/webtransport-go`; Node `@fails-components/webtransport`; Rust `wtransport` [V: MDN list]. **Nakama, SpacetimeDB, Cloudflare Workers/DO, uWebSockets.js, Bun: WebSocket only** (no WebTransport support found in docs/search). Cloudflare's proxy will not carry arbitrary UDP; Spectrum UDP is Enterprise-only [3P: [Spectrum docs](https://developers.cloudflare.com/spectrum/llms-full.txt)].
- **Benefit:** unreliable datagrams avoid TCP head-of-line stalls for superseded position snapshots, which matters on lossy mobile links. At 10 Hz the cost of TCP HOL is a visible hitch, not a failure.
- **Risks:** UDP/QUIC blocked on some networks; iOS < 26.4 has none; WebTransport needs a TLS cert and HTTP/3 server; debugging tools lag.
- **Decision:** ship **WebSocket (binary, `wss://`) first**; define the wire protocol as "reliable stream + optional unreliable snapshot channel" so a WebTransport transport can be added behind feature detection (`typeof WebTransport !== "undefined"`) once measured packet-loss on Vietnamese mobile networks justifies it.

---

## 7. Where to host for Vietnam, and compliance flags

- **Latency (vendor estimates [3P: [space-node](https://space-node.net/blog/minecraft-server-hosting-vietnam-2026)]):** to Singapore ≈ 30–50 ms from HCMC, 40–60 ms Da Nang, **50–70 ms Hanoi** (Hải Phòng is near Hanoi); US/EU 200–300 ms. A 100–150 ms interpolation buffer tolerates this; fast driving and combat need client prediction anyway. **Measure** from Viettel/VNPT/FPT fixed and 4G/5G before committing; also test Hong Kong and Bangkok.
- **In-country hosting** (Zenlayer Hanoi/HCMC, Viettel IDC, VNG Cloud/GreenNode, FPT Cloud) avoids the five international subsea cables (all five failed in early 2023, ~75% capacity lost, per a Zenlayer marketing post [3P: [zenlayer](https://cloud.zenlayer.com/blog/game-servers-vietnam)]). Domestic bandwidth is generous/unmetered on some plans (Viettel IDC plans list unmetered traffic [3P: [whtop](https://www.whtop.com/plans/viettelidc.com.vn/147281)]; VNG's default package gives 300 Mbps domestic but only 5 Mbps *international* [3P: [VNG docs](https://docs.vngcloud.vn/vng-cloud-document/vserver/compute-hcm03-1a/vpc/bandwidth)]). Good Phase-3 option (second region, or primary if the owner has a Vietnamese entity), but the tooling/price transparency is weaker than Hetzner/Vultr.
- **DDoS/TLS:** need `wss://` (GitHub Pages is HTTPS). Cloudflare's proxy handles WebSockets but WebSocket concurrency/bandwidth on Free is "low" and judged case by case; do not plan 14 TB/month through a free zone [3P: [community](https://community.cloudflare.com/t/cloudflare-websocket-limits/57455)]. Use provider-level DDoS filtering or a paid Cloudflare plan after asking them.
- **Regulatory (needs a Vietnamese lawyer; not legal advice):** Decree 147/2024/ND-CP defines **"G1" games = multi-player interaction through the operator's servers**, which require a service licence *and* a release decision; accounts of under-18s are limited to 60 min/game and 180 min/day (draft amendments propose 60 min/day for under-16) [3P: [luatvietan](https://luatvietan.vn/giay-phep-game-online-g1.html), [lsvn](https://lsvn.vn/phan-loai-game-theo-do-tuoi-tu-25-12-2024-a150127.html), [pocketgamer.biz](https://www.pocketgamer.biz/vietnam-issues-decree-1472024-to-regulate-online-games-and-internet-services)]. Decree 53/2022 lists "online video games" among services that can be ordered to localise user data and open a local presence after a violation request [3P: [Allen & Gledhill](https://www.allenandgledhill.com/vn/perspectives/articles/22527/vnkh-data-localisation-requirement-for-specific-data-and-entities-in-effective-1-october-2022)]. Practical implication: **account system + age/playtime hooks + data export/delete** should be designed in from the start, and a public launch of an open multiplayer world in Vietnam is a licensing question, not just an engineering one.

---

## 8. Recommendation

### 8.1 Pick
**Custom authoritative zone servers: Node.js LTS + uWebSockets.js, binary protocol, grid interest management, Postgres, own Google auth, on dedicated-vCPU VMs in Singapore (Hetzner/Vultr class) behind provider DDoS filtering.** Reasons: (1) every managed option still leaves the spatial layer to us, so their marginal value is mostly auth + hosting, which are cheap to own; (2) same JS language as the client lets the server reuse the exact terrain/collision formulas and generated map data; (3) egress at $8–10/TB instead of $80–150/TB is a 10–50× cost difference; (4) no vendor can shut it down (2026 evidence); (5) 1k CCU is plausibly one process, so the first version can be simple.

### 8.2 Why not the others (one line each)
- **Colyseus:** fine, but Schema/StateView don't suit large-AOI open worlds, Redis/room model adds machinery we'd bypass; keep as a convenience layer option.
- **Cloudflare DO:** best ops/cost, but ~100-player/object ceiling, hot-spot risk, deploy disconnects, no Vietnam pin, lock-in.
- **Nakama:** auth/storage great, realtime layer a poor fit, clustering paid, region unclear.
- **SpacetimeDB:** right data model, wrong moment (sharding features land 2026-10-31; BSL; Maincloud cost). Re-evaluate in Q1 2027 with a spike.
- **Rivet / Edgegap / Photon / PlayFab:** see 3.6–3.8.

### 8.3 Architecture sketch (to validate)
- **Gateway** (stateless, N copies): terminates `wss://`, validates session token, forwards frames to the owning zone worker; clients keep one socket across zone hand-offs.
- **Zone workers**: own a contiguous set of grid cells (128–150 m), run the 10 Hz sim, encode one snapshot per cell and fan out per client; replicate a 1-cell border ring to neighbours; hand-offs via transfer message. Start with **one process = the whole disc** and split only when the spike says so; make entity IDs, cell keys and the protocol shard-ready from day one.
- **Persistence**: Postgres (accounts, characters, inventory, money, quests); in-memory authoritative state flushed on events + every 30–60 s; append-only event log for economy audits.
- **Auth**: `POST /auth/guest {nickname}` → server-issued opaque guest token (stored in localStorage); `POST /auth/google {idToken}` → verify `aud/iss/exp`, then either create a Google-linked player or **attach the Google `sub` to the current guest player** (the "link, don't merge" rule: if that `sub` already owns a player, ask the user which progress to keep — Nakama's 409 behaviour shows why this must be explicit [V]); session = short-lived JWT + refresh.
- **Anti-cheat baseline**: server-authoritative movement with speed/teleport validation, input rate limits, Origin check on the WS upgrade, per-IP/account connection limits.
- **Ops**: Prometheus/Grafana (or Grafana Cloud free), tick-time p99 alarms, blue/green deploy with reconnect tokens, nightly Postgres backups.

### 8.4 Budget tiers
| Tier | Target | Stack | Est. monthly |
|---|---|---|---|
| 0 Alpha | ≤200 CCU, friends/testers | 1 VPS (2 vCPU) in SG, SQLite/Postgres, Let's Encrypt | **$5–25** |
| 1 Launch | ≤1k CCU | 1× 4-vCPU dedicated + 1× 2-vCPU standby/DB, Postgres backups, provider DDoS | **$200–450** |
| 2 Growth | ≤3k CCU | 3–4 zone VMs + 2 gateways + managed/HA Postgres; optional 2nd region (HCMC/Hanoi colo) | **$600–1,300** (+$150–400 second region) |
| Plan B | ≤1k CCU, zero-ops | Cloudflare DO zones + D1/Postgres for accounts | **$130–400** |
| Premium managed | whichever | Heroic Cloud / Maincloud / Colyseus Cloud | **$1.2k–7k+** |

### 8.5 Spikes with explicit pass/fail (do before committing; ~1 week total)
1. **Zone-sim load test (Node+uWS):** 500 then 1,000 synthetic WebSocket bots at 10 Hz, V=40, on a 2-vCPU Singapore VM. Pass: p99 tick < 25 ms, CPU < 60% of one core at 1,000, memory < 1.5 GB, measured egress within ±20% of model. Fail ⇒ shard earlier or consider Go.
2. **Durable Object load test:** 100 bots/object at 10 Hz and 5 Hz. Pass: no `overloaded` errors, p99 message latency < 150 ms. Tells us the real per-object ceiling.
3. **Vietnam network test:** RTT/jitter/loss from Hà Nội, Hải Phòng, HCMC on Viettel/VNPT/FPT + 4G/5G to Singapore, Hong Kong, Bangkok, and an in-country Hanoi colo; also test QUIC/UDP reachability to size the WebTransport opportunity.
4. **Egress sanity:** compare a real recorded session to the 45 kbps model; tune delta/LOD.
5. **Optional SpacetimeDB self-host spike** after Oct-31 features: one region DB with 500 bots; revisit as Plan C.

### 8.6 Hedging (escape hatches)
Keep three seams clean: `Transport` (WS today, WT/DO later), `Persistence` (Postgres repo functions), `ZoneRouter` (in-process → multi-process → DO stub). Never put game rules in a vendor SDK. Maintain an export script for accounts and saves from day one (the 2026 lesson).

---

## 9. Not verified (honest gaps)

- No public per-process CCU for authoritative open-world gameplay on Nakama, Colyseus, SpacetimeDB or Durable Objects; every capacity figure for them above is either idle-socket data or my estimate.
- Heroic Cloud: no official per-vCPU price page read (AWS Marketplace rates via search); Singapore region unconfirmed.
- Colyseus Cloud tiers/bandwidth/regions, Rivet Cloud regions, Edgegap WebSocket + Asia pricing, Photon 500/1,000-CCU prices: not confirmed.
- Whether DO WebSocket messages count against the 1,000 req/s soft limit: assumed yes.
- Exact Singapore prices for Hetzner/Vultr plans (ranges only); Vietnamese provider price lists (unmetered claims are from aggregator listings).
- Vietnamese legal status of a free, non-monetised hobby multiplayer game under Decree 147/2024: unknown, needs counsel.

---

## 10. Sources

Nakama: [benchmarks](https://heroiclabs.com/docs/nakama/getting-started/benchmarks/) · [2M CCU](https://heroiclabs.com/blog/code-wizards-scale-test-of-nakama-2m-ccu/) · [authoritative](https://heroiclabs.com/docs/nakama/concepts/multiplayer/authoritative/) · [auth](https://heroiclabs.com/docs/nakama/concepts/authentication/) · [enterprise](https://heroiclabs.com/enterprise/) · [pricing](https://heroiclabs.com/pricing/) · [scaling](https://heroiclabs.com/docs/heroic-cloud/concepts/introduction/scaling/) · [GitHub](https://github.com/heroiclabs/nakama) · [AWS listing](https://aws.amazon.com/marketplace/pp/prodview-zfxkalyjehlh2) · [forum](https://forum.heroiclabs.com/t/how-to-increase-the-32-player-limit-for-nakama-realtime-matches/6499) · [East Asia region](https://heroiclabs.com/blog/heroic-cloud-east-asia-region-announced/)

SpacetimeDB: [pricing](https://spacetimedb.com/pricing) · [pricing blog](https://spacetimedb.com/blog/all-new-spacetimedb-pricing) · [how it scales](https://spacetimedb.com/blog/how-does-spacetime-scale) · [Oct-31 plan](https://runtimewire.com/article/spacetimedb-october-31-scaling-plan-single-thread) · [GitHub](https://github.com/clockworklabs/SpacetimeDB) · [BitCraft note](https://bitcraftonline.com/news/spacetimedb-and-bitcraft) · [Steam peaks](https://steamcharts.com/app/3454650) · [WS protocol](https://spacetimedb.com/docs/ws) · [auth guide](https://spacetimedb.com/docs/core-concepts/authentication/BetterAuth) · [license](https://www.nuget.org/packages/SpacetimeDB.Runtime/2.8.0/License)

Colyseus: [FAQ](https://docs.colyseus.io/faq) · [scalability](https://docs.colyseus.io/scalability) · [GitHub](https://github.com/colyseus/colyseus) · [0.16](https://colyseus.io/blog/colyseus-016-is-here/) · [WebTransport](https://docs.colyseus.io/server/transport/webtransport) · [pricing](https://www.colyseus.io/pricing) · [cloud](https://colyseus.io/cloud-managed-hosting) · [auth](https://docs.colyseus.io/auth/module) · [Vibe Jam](https://colyseus.io/blog/vibe-jam-2026/)

Cloudflare: [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) · [limits](https://developers.cloudflare.com/durable-objects/platform/limits/) · [WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) · [data location](https://developers.cloudflare.com/durable-objects/reference/data-location/) · [APAC hints](https://developers.cloudflare.com/changelog/post/2026-06-19-apac-ne-apac-se-location-hints/) · [Vietnam PoPs](https://blog.cloudflare.com/ten-new-data-centers/) · [PartyKit](https://www.plushcap.com/content/cloudflare/blog/cloudflare-acquires-partykit) · [Workers inbound TCP](https://blog.cloudflare.com/grpc-workers/) · [Spectrum](https://developers.cloudflare.com/spectrum/llms-full.txt) · [WS limits thread](https://community.cloudflare.com/t/cloudflare-websocket-limits/57455)

Custom stack: [uWebSockets.js](https://github.com/uNetworking/uWebSockets.js) · [Evil Martians benchmark](https://evilmartians.com/chronicles/choose-your-fighter-benchmarking-5-websocket-servers-for-nodejs) · [Bun WebSockets](https://bun.com/docs/runtime/http/websockets.md) · [nbio](https://pkg.go.dev/github.com/lesismal/nbio) · [webtransport-go](https://pkg.go.dev/github.com/quic-go/webtransport-go) · [MDN WebTransport](https://developer.mozilla.org/en-US/docs/Web/API/WebTransport_API) · [WebTransport Baseline](https://webrtc.ventures/2026/04/webtransport-is-now-baseline-what-it-means-for-real-time-media/) · [IETF draft-16](https://datatracker.ietf.org/doc/draft-ietf-webtrans-http3/16/) · [Google ID token verification](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token) · [OSRS ticks](https://oldschool.runescape.wiki/w/Game_tick) · [OSRS capacity](https://oldschool.runescape.wiki/w/Update:More_Worlds,_More_Power:_The_Road_To_Greater_Capacity) · [MMO scaling thread](https://gamedev.net/forums/topic/657588-mmos-and-modern-scaling-techniques/?page=1)

Others / market: [Rivet pricing](https://rivet.dev/cloud/) · [Rivet edge](https://rivet.dev/actors/docs/general/edge) · [Rivet self-host](https://sliplane.io/blog/self-hosting-rivet-engine-the-easy-way) · [Edgegap](https://crux.supercraft.host/blog/edgegap-orchestration-alternatives/) · [Edgegap pricing listing](https://us.fitgap.com/products/edgegap) · [Photon pricing](https://www.photonengine.com/pricing) · [PlayFab WebGL issue](https://github.com/PlayFab/MultiplayerServerSecureWebsocket/issues/9) · [2026 shake-up (crux)](https://crux.supercraft.host/blog/game-backend-shutdowns-2026-who-died-where-studios-went/) · [Hathora shutdown (crux)](https://crux.supercraft.host/blog/hathora-shut-down-where-to-go-after-may-2026/) · [Gameye 2026](https://gameye.com/blog/game-server-shake-up-2026)

Hosting / Vietnam: [Hetzner Singapore](https://www.hetzner.com/cloud-singapore/) · [costgoat Hetzner](https://costgoat.com/pricing/hetzner) · [Vultr overage](https://docs.vultr.com/support/platform/billing/what-is-the-bandwidth-overage-rate) · [AWS egress](https://egresscost.com/aws/data-transfer-pricing) · [Fly.io pricing](https://servercompass.app/blog/flyio-pricing-breakdown-vs-vps) · [Vietnam latency](https://space-node.net/blog/minecraft-server-hosting-vietnam-2026) · [Zenlayer Vietnam](https://cloud.zenlayer.com/blog/game-servers-vietnam) · [VNG bandwidth](https://docs.vngcloud.vn/vng-cloud-document/vserver/compute-hcm03-1a/vpc/bandwidth) · [Viettel IDC listing](https://www.whtop.com/plans/viettelidc.com.vn/147281)

Regulation: [Decree 147 G1](https://luatvietan.vn/giay-phep-game-online-g1.html) · [age/time limits](https://lsvn.vn/phan-loai-game-theo-do-tuoi-tu-25-12-2024-a150127.html) · [pocketgamer.biz](https://www.pocketgamer.biz/vietnam-issues-decree-1472024-to-regulate-online-games-and-internet-services) · [Decree 53 localisation](https://www.allenandgledhill.com/vn/perspectives/articles/22527/vnkh-data-localisation-requirement-for-specific-data-and-entities-in-effective-1-october-2022)

Helper files in this folder: `model.mjs` (bandwidth + cost model), `score.mjs` (weighted matrix).
