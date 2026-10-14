# Hosting research: real-time multiplayer server for Hải Phòng 3D (players in Vietnam)

Research date: 2026-10-14. All prices USD/month unless noted, ex-VAT. Confidence tags: **[1P]** = read from the provider's own page or API this session; **[2P]** = third-party aggregator/news, treat as indicative; **[EST]** = my estimate/assumption. The web-search tool returned several pages that could not be fetched in full, so every row marked [2P] or [EST] needs a live check before money is committed.

---

## 0. TL;DR

1. **Latency.** Measured server-to-server pings on 2026-10-14 (WonderNetwork): Hà Nội to Singapore 44 ms, Hong Kong 54 ms, Tokyo 88 ms; HCMC to Singapore 47 ms, Hong Kong 52 ms, Tokyo 110 ms; Hà Nội to HCMC 26 ms. Singapore is the best out-of-country location. A server in Hà Nội would cut a northern player's RTT from roughly 50-65 ms to 5-30 ms, and it keeps working when submarine cables fail.
2. **Submarine-cable risk is real and current.** On 2026-08-25 faults on SJC2, AAE-1, AAG and IA removed about 30% of Vietnam's international capacity. Operators warned of higher latency at peak hours for overseas-hosted games; Vietnam-hosted services were expected to be unaffected. Repair status after 3 Sep 2026 is unconfirmed, and repairs typically take months.
3. **Bandwidth is the cost driver, not CPU.** 1,000 CCU at 10 KB/s is about 80 Mbps and 10-26 TB/month. Singapore egress ranges from $5/TB (Linode) and $8.49/TB (Hetzner SIN) and $10/TB (Vultr, DigitalOcean) up to $120/TB (AWS/Lightsail overage, CloudFront Singapore). AWS/GCP EC2 egress alone would be about $1,200/month at 1,000 CCU, which is 4x the whole balanced-tier bill on a $10/TB provider.
4. **Monthly cost (planning case: 10 KB/s, average load 40% of peak).**

| CCU | Cheap | Balanced | Premium |
|---|---|---|---|
| 1,000 | about $125 (range $120-180) | about $295 (range $290-310) | about $1,800 (range $1,500-2,200) |
| 3,000 | about $610 (range $510-770) | about $1,000 (range $1,000-1,100) | about $4,000 (range $3,300-4,800) |

5. **Static assets must leave GitHub.** First-time loads pull roughly 100-270 MB of GLB per player. Put them on Cloudflare R2 (egress free) behind Cloudflare's CDN. Monthly cost is a few cents of storage instead of $60-650 on other CDNs for the first 20,000 players.
6. **Auth and DB are cheap.** Sign-in with Google is free; Firebase/Identity Platform is free to 49,999 MAU; Supabase Pro ($25) includes 100k MAU. Progress saves are about 33 writes/s at 1,000 CCU. Any small Postgres handles it.
7. **Recommended path.** Start in Singapore on a dedicated-vCPU tier (Balanced, about $300 at 1,000 CCU), with Cloudflare in front and R2 for assets. Keep the server container-portable. Run a 2-week real-user RTT probe (Section 8) comparing Singapore with a Hà Nội VPS. Add or move to a Hà Nội node (Viettel IDC, BizFly, or the new AWS Hanoi Local Zone) if the probe or the cable situation justifies it.

---

## 1. Assumptions (change these and the tables change)

| Item | Value | Basis |
|---|---|---|
| Downstream per player | 5 / 10 / 15 KB/s | Owner brief; 10 KB/s is the planning midpoint. Treated as wire bytes; add 10-20% if those are application-level numbers. |
| Upstream per player | 1-3 KB/s | [EST]. Ingress is free at every provider listed. |
| CCU meaning | Peak concurrent players | Owner target is more than 1,000. |
| Duty cycle | Planning = average load is 40% of peak over the month; stress = 100% of peak 24/7 | [EST]. A Vietnam-centred game peaks in the evening. Measure after launch. |
| Month | 30 days = 2,592,000 s | |
| Game-sim CPU | 1,000 CCU needs 4-8 dedicated vCPU; 3,000 CCU needs 12-32 vCPU, split across several processes by area | [EST]. Depends entirely on the server architecture (tick rate, interest management). Load-test before buying. |
| FX | 26,000 VND per USD; 1 EUR about 1.15 USD (Hetzner's own page implies 8.49 USD for 7.40 EUR) | VND rate [EST], not verified. |

### 1.1 Egress model (TB per month and peak Mbps)

Formula: TB = CCU x KB/s x 2,592,000 x duty / 1e9. Peak Mbps = CCU x KB/s x 8 / 1000.

| CCU | KB/s per player | Peak Mbps | TB/mo @ 40% duty (planning) | TB/mo @ 100% duty (stress) |
|---|---|---|---|---|
| 1,000 | 5 | 40 | 5.2 | 13.0 |
| 1,000 | 10 | 80 | 10.4 | 25.9 |
| 1,000 | 15 | 120 | 15.6 | 38.9 |
| 3,000 | 5 | 120 | 15.6 | 38.9 |
| 3,000 | 10 | 240 | 31.1 | 77.8 |
| 3,000 | 15 | 360 | 46.7 | 116.6 |

Implications: a 100 Mbps port (BizFly's default Cloud Server port) cannot carry 1,000 CCU at 15 KB/s (120 Mbps) or any 3,000 CCU case. Plan 1 Gbps ports. A shared Hetzner Cloud host is documented as roughly 300-500 Mbit/s expected with no guarantee [1P], which is tight at 3,000 CCU on one box.

### 1.2 What the same traffic costs on each provider's Singapore egress (overage only, no included allowance)

| TB/mo | Linode ($5/TB) | Hetzner SIN ($8.49/TB) | Vultr / DO ($10/TB) | Bunny Asia CDN ($30/TB) | AWS EC2 SG (tiered, $120/TB first 10 TB) | CloudFront SG ($120/TB) |
|---|---|---|---|---|---|---|
| 5.2 | 26 | 44 | 52 | 156 | 612 | 624 |
| 10.4 | 52 | 88 | 104 | 312 | 1,226 | 1,248 |
| 15.6 | 78 | 132 | 156 | 468 | 1,668 | 1,872 |
| 31.1 | 156 | 264 | 311 | 933 | 2,985 | 3,732 |
| 46.7 | 234 | 396 | 467 | 1,401 | 4,311 | 5,604 |
| 77.8 | 389 | 661 | 778 | 2,334 | 6,539 | 9,336 |

AWS tiers beyond the first 10 TB use the US-region ratios ($0.085, $0.07, $0.05 per GB) because I found no Singapore-specific tier table; the Singapore first tier of $0.12/GB is [1P] from the Lightsail pricing page and [2P] from Wise. The first 100 GB free is ignored.

---

## 2. Latency: Vietnam to candidate locations

### 2.1 Measured (server to server, 2026-10-14)

Source: WonderNetwork ping pages, live averages. [2P]: these are data-centre-to-data-centre probes on current routing, not residential users, and the page gives no averaging window.

| From \ To | Hà Nội | HCMC | Singapore | Hong Kong | Tokyo | Bangkok | Seoul |
|---|---|---|---|---|---|---|---|
| Hà Nội | - | 26.4 | **43.9** | 53.5 | 87.9 | 66.4 | 115.7 |
| HCMC | 26.1 | - | **47.0** | 52.0 | 109.6 | 78.0 | 69.4 |

Other Hà Nội pings: Taipei 48.8, Manila 42.8, Jakarta 56.0, Kuala Lumpur 52.1, Osaka 100.9.

Notes:
- HCMC to Singapore (47 ms) is slower than Hà Nội to Singapore (44 ms). Vendor claims put HCMC to Singapore at 30-50 ms (Valebyte) and 30-50 ms vs Hà Nội 50-70 ms (a Minecraft host, sales copy) [2P]. The measured figure is plausibly inflated by the ongoing cable faults, but I could not confirm that.
- A vendor article puts Tokyo at 70-120 ms from Vietnam [2P]; the measurements agree.

### 2.2 Last mile (to add on top)

Ookla Speedtest Global Index, Aug 2026, Hà Nội: median latency 19 ms mobile and 4 ms fixed broadband (to Ookla's nearest servers) [2P]. No national or HCMC latency figure was found.

### 2.3 Estimated player RTT by server location [EST]

| Server location | Hà Nội fibre | Hà Nội 4G/5G | HCMC fibre |
|---|---|---|---|
| Hà Nội (in-country) | 5-15 ms | 20-35 ms | 28-40 ms |
| Singapore | 48-55 ms | 63-75 ms | 50-60 ms |
| Hong Kong | 58-65 ms | 73-85 ms | 55-65 ms |
| Tokyo | 92-100 ms | 107-120 ms | 113-125 ms |

For a walking, driving and survival game with client-side prediction and 10-20 Hz snapshots, up to about 100 ms is workable. Singapore at 50-75 ms is fine for gameplay quality; the concern is stability, not average RTT.

### 2.4 Submarine-cable risk

- 2026-08-25: SJC2 and AAE-1 failed within hours of each other, with AAG still impaired and Tata IA also hit; Vietnam lost an estimated 30% of international capacity. Reports list four of eight (Light Reading) or six (other outlets) international systems, so counts conflict. Operators warned of slower speeds and higher latency at peak for overseas-hosted games; services hosted in Vietnam were not expected to be affected (Light Reading). [2P]
- Mitigation reported: Viettel added 800 Gbps via IA and 300 Gbps via APG and rerouted some traffic through a terrestrial route via Laos to Singapore, with another 1.5 Tbps planned; VNPT says backup routes keep service stable, "somewhat affected" at peak. [2P]
- AAE-1 has been out since February 2026 and was still unrepaired on 3 Sep 2026 [2P]. I found no October 2026 repair update.
- A vendor (Zenlayer, commercially interested) claims about 15 cable faults a year and that all five cables then in service failed in early 2023, cutting about 75% of capacity [2P]. APG's 2025 outage ran from February to May 2025 [2P].
- Conclusion: an overseas (Singapore or Hong Kong) server will degrade at peak hours during cable events, and a Vietnam-hosted server will not. This is the strongest argument for a Hà Nội node, independent of average RTT.

### 2.5 In-country hosting options

| Provider | Product | Price | Bandwidth | Confidence |
|---|---|---|---|---|
| Viettel IDC | T1.Base 01 (1 vCPU / 1 GB) | 129,000 VND (about $5) | listed unmetered | [2P] whtop listing, updated 20 Apr 2026 |
| Viettel IDC | T1.Base 03 (2 vCPU / 4 GB) | 399,000 VND (about $15) | unmetered | [2P] |
| Viettel IDC | T1.Base 06 (6 vCPU / 6 GB) | 899,000 VND (about $35) | unmetered | [2P] |
| Viettel IDC | T2.Gen 06 (8 vCPU / 32 GB) | 4,100,000 VND (about $158) | unmetered | [2P] |
| Viettel IDC | extra vCPU or GB RAM | about 70,000 VND each | - | [2P] |
| BizFly Cloud | Cloud Server Micro to Huge | 116,820 - 7,980,000 VND; cheap VPS plan 95,000 VND | **100 Mbps port**, data transfer unlimited | [2P] search snippet; the pricing page fetched as 404 later. Prices ex-VAT (10%). |
| BizFly Cloud | Load balancer data transfer | 280 VND/GB, 5 TB free | - | [2P] |
| CMC Cloud | C6 Small 1 to 2XLarge 2 | 725,000 - 2,900,000 VND | quote | [2P] GreenNode blog |
| GreenNode (VNG) | CPU instances | from 212,850 VND | not stated | [2P] |
| FPT Cloud | Standard-01 to -03 | contact sales; colocation 300 Mbps domestic | - | [2P] |
| VNPT Data | VNPT Cloud | contact sales | - | no price found |
| AWS | **Hanoi Local Zone** (ap-southeast-1-han-1a), launched 2026-06-19 | EC2 prices differ from Singapore; data transfer at Local Zone-specific rates; not published in what I could read | internet or Direct Connect | [1P] AWS news page |

- Domestic providers advertise "unmetered" transfer but the limit is the port speed and fair use. For 1,000-3,000 CCU ask for a committed 1 Gbps with a written international and domestic split. FPT's published colocation port is only 300 Mbps domestic.
- Hà Nội and HCMC both host the main domestic carriers via VNIX (Zenlayer, vendor [2P]); no Google Cloud or Azure region exists in Vietnam (Google only reported as considering a 2027 data centre) [2P].
- AWS Hanoi Local Zone: new, supports C7i, M7i, R7i, S3 One Zone-IA, EBS local snapshots. The unknown is its egress price, which could erase the savings if it follows the Singapore $0.12/GB. Ask AWS or use the pricing calculator before choosing it. [1P] for the launch and instance types.
- Data-residency and licensing rules for online games in Vietnam may favour in-country hosting; see Section 10.

---

## 3. Compute and bandwidth prices for Singapore

### 3.1 Vultr (read from the public API api.vultr.com/v2, 2026-10-14) [1P]

| Plan | vCPU | RAM | Included transfer | $/mo |
|---|---|---|---|---|
| High Frequency vhf-2c-4gb | 2 | 4 GB | 3 TB | 24 |
| High Frequency vhf-4c-16gb | 4 | 16 GB | 5 TB | 96 |
| High Frequency vhf-8c-32gb | 8 | 32 GB | 7 TB | 192 |
| CPU-Optimized voc-c-2c-4gb-50s | 2 dedicated | 4 GB | 5 TB | 40 |
| CPU-Optimized voc-c-4c-8gb-75s | 4 dedicated | 8 GB | 6 TB | 80 |
| CPU-Optimized voc-c-8c-16gb-150s | 8 dedicated | 16 GB | 7 TB | 160 |
| CPU-Optimized voc-c-16c-32gb-300s | 16 dedicated | 32 GB | 8 TB | 320 |
| Memory-Optimized voc-m-2c-16gb-100s | 2 | 16 GB | 6 TB | 80 |
| Bare metal vbm-4c-32gb (E3-1270) | 4 | 32 GB | 5 TB | 120 |
| Bare metal vbm-6c-32gb-amd (EPYC 4245P) | 6 | 32 GB | 10 TB | 295 |
| Bare metal vbm-8c-64gb-amd (EPYC 4345P) | 8 | 64 GB | 10 TB | 365 |
| Bare metal vbm-24c-256gb-amd (EPYC 7443P) | 24 | 256 GB | 10 TB | 725 |

All of the above list Singapore (sgp) as a location. Overage is $0.01/GB worldwide; each account also gets 2 TB of free egress per month pooled across instances; ingress is free (docs.vultr.com last updated 16 Dec 2025; 2022 announcement for the 2 TB pool; egresscost.com agrees). DDoS protection: 10 Gbps per instance, available in all locations; a third party says $10/month per IP, unconfirmed.

### 3.2 Others

| Provider | Plan (Singapore) | $/mo | Included transfer | Overage | Confidence |
|---|---|---|---|---|---|
| Hetzner Cloud SIN | CPX 15.49-171.99 EUR (about $18-197); CCX13 (2 dedicated vCPU / 8 GB) 53.99 EUR (about $62); CPX32 48.99 EUR (about $56) | see left | CPX 0.5-5 TB; CCX 1-8 TB | $8.49/TB (7.40 EUR), vs 1 EUR/TB in EU and US | Overage [1P] (Hetzner SIN page); prices and traffic [2P] (costgoat, Northflank). Prices roughly doubled on 2026-06-15; SIN rose a smaller average of about 78%. Expected network 300-500 Mbit/s per host, no guarantee [1P]. Free DDoS protection per Hetzner [1P]. |
| DigitalOcean SGP | Basic 4 vCPU shared / 8 GB: $48; CPU-Optimized 4 vCPU / 8 GB: $84; 8 vCPU / 16 GB: $168 | see left | 5,000 / 5,000 / 6,000 GiB, pooled across the team | $0.01/GiB, no regional variation | [1P] pricing and docs pages. Free L3/L4 DDoS protection, no L7. |
| Linode / Akamai Cloud | Dedicated 4 vCPU / 8 GB: $72 | 72 | 5 TB, pooled | $5/TB (Jakarta $15/TB, São Paulo $7/TB) | [2P] egresscost, Cloud Mercato; Akamai's own docs fetched without a price table. |
| AWS Lightsail SG | Compute-opt 2 vCPU / 4 GB $42 (5 TB); 4 vCPU / 8 GB $84 (6 TB); 8 vCPU / 16 GB $168 (7 TB); General 4 vCPU / 16 GB $84 (6 TB) | see left | see left | $0.12/GB Singapore | [1P] Lightsail pricing page. |
| AWS EC2 SG | not researched (instance prices) | - | 100 GB free | $0.12/GB first 10 TB | Egress [1P] via Lightsail FAQ and [2P] Wise (2025). |
| Google Cloud asia-southeast1 | not researched | - | - | North America reference: Premium $0.12 / $0.11 / $0.08 per GB by tier; Standard $0.085 / $0.065 / $0.045 | Singapore row not retrievable; Asia rates are likely equal or higher. [2P] egresscost. |
| OVHcloud SG VPS | VPS-4 8 vCores / 24 GB from $23.37 | 23 | **3 TB then capped at 10 Mbps** (500 GB / 1 TB / 1 TB for the smaller plans) | cap, not billing | [1P] OVH page. Unsuitable for a game server. |

Takeaways:
- Bundled transfer on dedicated-vCPU plans is about 5-8 TB per node at $80-320, so a 4-5 node cluster already includes 25-40 TB. Overage at $10/TB only matters at the high-traffic ends.
- After June 2026 Hetzner Singapore compute is no longer a bargain; its edge is the $8.49/TB overage and free DDoS filtering.
- Hyperscaler egress ($120/TB) is the cost trap for this workload. If AWS is required for another reason (for example the Hanoi Local Zone), front the game with a cheap relay or confirm the Local Zone egress rate first.
- Avoid OVH Singapore VPS and any plan whose transfer is capped rather than billed.

### 3.3 Cloudflare in front of the game server

- WebSockets are supported on all plans (Cloudflare docs) [1P]. Cloudflare closes WebSocket connections that stay idle, so the client needs a ping/pong heartbeat [1P]. Connections can also drop during Cloudflare releases, so build reconnect and resume.
- Cloudflare measures data sent from its edge to the client as bandwidth (relevant for Enterprise contracts) [1P]. The free-tier "unmetered bandwidth" language is written around cached HTTP. Whether 30-100 TB/month of proxied WebSocket traffic is acceptable on Free or Pro is not something I could verify; plan on a conversation with Cloudflare, or a Business plan, above roughly 20 TB/month. [EST]
- Plan prices: Pro about $25/month monthly-billed ($20 annual), Business about $250 monthly ($200 annual) [2P, sources conflict].
- Spectrum (raw TCP/UDP proxy) is an Enterprise-only product [2P]. A browser game on WebSocket over HTTPS does not need it. WebRTC/UDP data channels would bypass Cloudflare's proxy.
- PoPs exist in Hà Nội and HCMC (Cloudflare's 160th and 161st data centres, 2018 post) [1P]. Whether a given Vietnamese ISP reaches them or is routed to Singapore/Hong Kong depends on peering. Check with `curl -sI https://<host> | grep -i cf-ray` from Viettel, VNPT, FPT and mobile networks and look for HAN/SGN versus SIN/HKG. [EST]
- Free L3/L4/L7 DDoS mitigation is included on Free [2P]; the real value for a WebSocket game is hiding the origin IP and terminating TLS near the player.
- Alternative: Cloudflare Workers + Durable Objects (Workers Paid $5/month, 1M requests and 400,000 GB-s included, then $0.15 per million requests and $12.50 per million GB-s; WebSocket hibernation avoids duration charges) [2P]. Third-party calculator says incoming WebSocket messages bill at 20:1; outgoing are free [2P]. Fits sharded, event-driven state (chat, quests, trading, party lobbies); it is not a good home for a 20 Hz simulation loop for 1,000 players in one world.

---

## 4. Cost tables

All figures are USD per month, ex-VAT, Singapore unless stated. "Pool" = bundled transfer across nodes plus Vultr's 2 TB account allowance. Overage uses the Vultr rate of $10/TB. Egress scenarios are 5 / 10 / 15 KB/s at 40% duty unless noted.

### 4.1 Cheap: single region, shared-vCPU VPS, self-run Postgres, Cloudflare Free, R2 assets

| Line | 1,000 CCU | 3,000 CCU |
|---|---|---|
| Game node(s) | 1x Vultr HF 4 vCPU / 16 GB = $96 | 2x Vultr HF 8 vCPU / 32 GB = $384 |
| Gateway, auth, Redis, Postgres box | 1x HF 2 vCPU / 4 GB = $24 | 1x HF 4 vCPU / 16 GB = $96 |
| Cloudflare | Free = $0 | Pro = $25 (Free is a risk at this volume) |
| R2 storage and backups, domain | about $3 | about $5 |
| Included transfer pool | 10 TB (5+3+2) | 21 TB (7+7+5+2) |
| Egress overage @5 / 10 / 15 KB/s | $0 / $4 / $56 | $0 / $101 / $257 |
| **Total** | **$123 / $127 / $179** | **$510 / $611 / $767** |
| Stress (100% duty, 10 KB/s) | $282 | $1,078 |
| Notes | No redundancy; one node failing ends the session. Shared vCPU on HF is fast but not dedicated. | Same; at least one more node is needed for failover in practice. |

Variant, in-country: 1x Viettel IDC 8 vCPU / 32 GB (about $158, listed unmetered) plus Cloudflare Free is about $160-200 per month for 1,000 CCU, if the provider confirms at least 200 Mbps of committed bandwidth. [2P/EST]

### 4.2 Balanced: dedicated vCPU, N+1, managed Postgres, Cloudflare Pro, monitoring

| Line | 1,000 CCU | 3,000 CCU |
|---|---|---|
| Game nodes | 2x Vultr CPU-Optimized 4 vCPU / 8 GB = $160 (one active shard, one shard or hot standby) | 5x Vultr CPU-Optimized 8 vCPU / 16 GB = $800 (4 active plus 1 standby, 40 dedicated vCPU) |
| Postgres | Supabase Pro $25 + Medium compute $60 - $10 credit = $75 (Singapore region exists) | Supabase Pro $25 + Large compute $110 - $10 credit = $125 |
| Cloudflare | Pro = $25 | Pro = $25 (consider Business $250) |
| Monitoring and alerting | about $30 | about $50 |
| R2, backups, domain | about $3 | about $5 |
| Included transfer pool | 14 TB (6+6+2) | 37 TB (5x7+2) |
| Egress overage @5 / 10 / 15 KB/s | $0 / $0 / $16 | $0 / $0 / $97 |
| **Total** | **$293 / $293 / $309** | **$1,005 / $1,005 / $1,102** |
| Stress (100% duty, 10 KB/s) | $412 | $1,413 |

### 4.3 Premium: in-country primary plus Singapore fallback, HA database, anti-DDoS, Cloudflare Business

Line items other than the Vultr and Supabase rows are [EST] or require a quote.

| Line | 1,000 CCU | 3,000 CCU |
|---|---|---|
| Hà Nội primary nodes (Viettel-class 8 vCPU / 32 GB, about $158 each) | 2 = $316 | 6 = $948 |
| HCMC warm standby (same spec) | 1 = $158 | 2 = $316 |
| Singapore overflow/fallback | 1x Vultr CPU-Opt 4 vCPU / 8 GB = $80 | 2x Vultr CPU-Opt 8 vCPU / 16 GB = $320 |
| Anti-DDoS add-on (provider quote) | about $200 | about $300 |
| Postgres with point-in-time recovery | Supabase Pro + XL ($210) - $10 + $25 + PITR $100 = $325 | Supabase Pro + 2XL ($410) - $10 + $25 + PITR $100 = $525 |
| Cloudflare Business (monthly billing) | $250 | $250 |
| Observability | $100 | $150 |
| Staging and load-test environment | $100 | $200 |
| Committed 1 Gbps bandwidth quote (placeholder) | $300 | $1,000 (2x 1 Gbps) |
| **Total** | **about $1,830** (range $1,500-2,200) | **about $4,010** (range $3,300-4,800) |

### 4.4 For comparison: hyperscaler Singapore (egress only, compute extra)

| | 1,000 CCU @ 10 KB/s, 40% | 3,000 CCU @ 10 KB/s, 40% |
|---|---|---|
| Egress at $0.12 then tiered | about $1,230 | about $2,990 |
| Typical compute for same size | add $300-900 | add $1,000-2,500 [EST] |
| Verdict | 4x the Balanced tier | 3x the Balanced tier |

Lightsail bundles are priced like Vultr (for example 8 vCPU / 16 GB for $168 with 7 TB) but the overage is $120/TB instead of $10/TB, so a Lightsail cluster that exceeds its bundle pool is much more expensive than Vultr.

### 4.5 Cost per CCU per month

| | 1,000 CCU | 3,000 CCU |
|---|---|---|
| Cheap | $0.12-0.18 | $0.17-0.26 |
| Balanced | $0.29-0.31 | $0.34-0.37 |
| Premium | $1.5-2.2 | $1.1-1.6 |

---

## 5. Static assets and CDN

### 5.1 The load

From the repo map: landmark GLBs are 13 files totalling 229 MiB plus 42 MiB of lite twins; local `assets/` is 282 MB and `assets_lite/` 64 MB; there are 24 GLBs in all. High tiers fetch full models near the player and lite twins far away; low tiers fetch only lite twins. A first visit therefore moves roughly **100 MB (mobile/lite) to 270 MB (desktop)**. The service worker is documented in the map as never registering, so repeat visits may re-download. [EST for the per-visit range]

### 5.2 Today's setup and its limits

- GLBs are served from the `assets-storage` branch via jsDelivr (SHA-pinned) and raw.githubusercontent.com for files over 20 MB.
- GitHub Pages: published site limit 1 GB, soft bandwidth limit 100 GB per month, and not intended to host commercial sites for free (GitHub docs) [1P]. The map notes the current pushed tree is 1.77 GB, already over the 1 GB limit.
- jsDelivr's usage policy page did not load fully, so its limits for large binaries and heavy usage are unverified. raw.githubusercontent.com is not a CDN and may rate-limit.
- At 1,000 first-time players per day at 100-270 MB, that is 100-270 GB per day, which breaks the 100 GB-per-month soft limit within hours.

### 5.3 Options (cost of delivering 20,000 first-time players = 2-5.4 TB)

| Option | Egress price | Cost for 2-5.4 TB | Notes |
|---|---|---|---|
| **Cloudflare R2 + custom domain via Cloudflare CDN** | $0 egress; storage $0.015/GB-month; Class A $4.50/M; Class B $0.36/M; free 10 GB, 1M and 10M ops | under $1 | [1P] Cloudflare R2 docs. Pages caps files at 25 MiB (not verified here), which is why R2 is better for GLBs. Vietnam PoPs in HAN/SGN; check actual routing per ISP. Recommended. |
| Bunny.net Standard | Asia & Oceania $0.03/GB | $60-162 | [2P]. A Ho Chi Minh City presence is listed by third parties; Hà Nội not confirmed. |
| Bunny.net Volume | $0.005/GB flat | $10-27 | Only 10 PoPs; none confirmed in Vietnam. |
| AWS CloudFront | up to $0.12/GB Hong Kong/Singapore group; 1 TB/month free | $240-650 after free tier | [2P] |
| Fastly | $0.19-0.28/GB Asia | $400-1,500 | [2P] |
| Vietnam CDNs (BizFly, Viettel, VNPT, FPT) | quote | quote | BizFly's CDN pricing page fetched as 404; domestic CDNs minimise cable risk for asset loads. |
| Serve from the game nodes | $10/TB | $20-54 | Competes with game traffic for the same port. Not recommended. |

Recommendation: R2 behind Cloudflare, with the SHA-pinned URL scheme preserved (`ASSETS_SHA` can map to an R2 path prefix). Keep the `node tools/check_assets.mjs` gate by pointing it at the new base. Optional later: mirror to a Vietnamese CDN for the first-load path if cf-ray tests show Vietnamese ISPs being routed to Singapore.

---

## 6. Managed database and authentication

Player state (hunger, thirst, stamina, health, body heat, money, job, quest flags) is small and write-light.

Write load estimate [EST]: one progress save per player every 30 s is about 33 writes/s at 1,000 CCU and 100 writes/s at 3,000 CCU, easily batched. Inventory/money transactions are rarer. Keep hot state in the game process and checkpoint to Postgres; do not use a database as the real-time channel.

| Option | Price | Fit | Confidence |
|---|---|---|---|
| **Sign in with Google (Google Identity Services) + server-side token check + your own Postgres** | $0 for sign-in | Cheapest; no vendor lock-in; you own the user table and the "nickname-only local play, optional Google link" flow. | Pricing not researched (general knowledge); verify. |
| **Supabase** (Auth + Postgres) | Free: 50,000 MAU, 500 MB DB, 5 GB egress, 200 realtime connections. Pro $25: 100,000 MAU ($0.00325 per extra), 8 GB DB, 250 GB egress ($0.09/GB beyond), 500 realtime connections ($10 per 1,000). Compute add-ons: Micro $10 (credited), Small $15, Medium $60, Large $110 (2 dedicated vCPU, 8 GB), XL $210, 2XL $410. Team $599. | Good fit for auth + progress + admin UI. Singapore (ap-southeast-1) is an official region. Realtime is not for game state. | [1P] supabase.com/pricing (regions page via search snippet). Spend cap on by default for Pro [2P]. |
| **Firebase Authentication / Google Identity Platform** | Free up to 49,999 MAU; $0.0055/MAU for 50,000-99,999 (about $275 at 100k); $0.0046 for 100,000-999,999; phone SMS billed per message | Easy Google sign-in SDK; auth only, pair with Postgres. Firestore/RTDB are poor fits for game state (RTDB: 100 connections on Spark, 200k on Blaze). | [1P] firebase.google.com/pricing; tier table [2P] from Google's Identity Platform page snippet. |
| **Neon serverless Postgres** | Free: 100 CU-hours per project. Launch $0.106 per CU-hour, Scale $0.222; storage $0.35/GB-month. One always-on CU is about $77/month | Singapore (aws-ap-southeast-1) listed. Disable scale-to-zero for a live game. | [1P] neon.com/pricing; region [2P]. |
| **Self-run Postgres on the VPS** | $0 beyond compute (backup to R2 costs cents) | Fine at this write load; you own HA, upgrades and restores. | - |

Since Google sign-in is optional, only the opted-in fraction counts as MAU. Even at 100,000 monthly players, if 20% sign in, Identity Platform and Supabase stay in their free allowances.

---

## 7. Recommendation (hosting only)

**Phase A, multiplayer prototype to first thousand CCU: Balanced, Singapore.**
- 2-5 Vultr CPU-Optimized nodes (or Hetzner CCX / DigitalOcean CPU-Optimized for the same job), Cloudflare Pro in front for WebSocket and DDoS, R2 for GLBs, Supabase or self-run Postgres, Postgres backups to R2.
- Cost about $300 per month at 1,000 CCU, scaling to about $1,000 per month at 3,000 CCU.
- The Cheap tier is fine for a closed alpha under 300 CCU.
- Build the server as stateless-ish containers with config-driven region so it can be moved.

**Phase B, decide on a Hà Nội node with data.** Run the probe in Section 8. Move or add a Hà Nội node (Viettel IDC / BizFly with a committed 1 Gbps, or the AWS Hanoi Local Zone after confirming its egress rate) if any of these hold:
- Real-user median RTT to Singapore exceeds about 80 ms or its p95 exceeds about 150 ms in the evening peak.
- The August cable faults are still degrading evening latency.
- Legal advice says in-country data residency or an in-country operator is needed (Section 10).

**Avoid:** OVH APAC VPS (capped), hyperscaler EC2 egress at $120/TB without a relay or CDN, 100 Mbps ports, GitHub Pages/jsDelivr as the asset path once real traffic arrives.

---

## 8. Cheap measurement plan before committing (about $15 per month for 2 weeks)

1. Rent three minimal VPS: Vultr Singapore, Vultr Tokyo (or Hong Kong at another provider), and a BizFly or Viettel IDC VPS in Hà Nội. Run a trivial WebSocket echo (about 20 lines) on each, behind Cloudflare and direct.
2. Add an opt-in `?netprobe=1` to the existing game page (already live on GitHub Pages) that opens each WebSocket, sends 20 pings at 1 Hz, and posts median, p95 and loss plus ISP and network type (via a 3rd-party ASN lookup or the server's view) to a tiny collector. The game already sets `__hp.tier` and `__hp.gpu`, so tag each sample with them.
3. Collect from Viettel, VNPT, FPT, Mobifone, Vinaphone and Viettel mobile players in the evening peak (19:00-23:00) and off-peak. Compare Singapore vs Hà Nội vs Tokyo.
4. In the same run, record the `cf-ray` suffix to learn which Cloudflare PoP each ISP reaches (HAN/SGN vs SIN/HKG).
5. Run a synthetic load test (for example 1,000 headless WebSocket bots at the planned message rates) on the chosen node type to confirm CPU, memory, and real bytes/s per player. This replaces the 5-15 KB/s assumption with a measured figure.

---

## 9. Quotes and live checks still needed

- Hetzner official Singapore price table after 15 Jun 2026 (docs.hetzner.com price adjustment page) and the exact included traffic per SIN plan.
- Viettel IDC: port speed behind "unmetered", committed 1 Gbps quote, anti-DDoS price, Hà Nội DC availability.
- BizFly: 1 Gbps port pricing; live price page (the fetched URL returned 404).
- FPT, VNPT, CMC: quotes; none publish bandwidth prices.
- AWS Hanoi Local Zone: EC2 hourly price and Local Zone data-transfer rate.
- GCP Singapore egress table; AWS EC2 Singapore tier table beyond the first 10 TB.
- Cloudflare: written position on 30-100 TB per month of proxied WebSocket traffic on Pro/Business; confirm Pro and Business prices.
- Vultr DDoS protection price; Vultr Singapore plan stock at the time of ordering.
- Current status of SJC2, AAE-1 and AAG repairs (no update after 3 Sep 2026 found); expected new capacity. One search result mentioned a Vietnam-Singapore cable (VTS) targeted for Q2 2027, unverified.
- The VND/USD rate used (26,000) is an assumption.

---

## 10. Risk flag outside hosting: Vietnamese online-game rules

Not part of the hosting question, but it changes the login design and possibly where servers must sit. Decree 147/2024/ND-CP (effective 25 Dec 2024) is reported by Vietnamese outlets to require game providers to collect players' full name, date of birth and Vietnamese mobile number, to have guardians register accounts for players under 16, and to limit under-18 play (60 minutes per game per day, 180 minutes across a provider's games, a warning every 30 minutes). Multiplayer games with player-to-player interaction fall under the G1 licence category for domestic enterprises. A "play instantly with a nickname" flow may conflict with this if the game is offered to the public in Vietnam as a service. I read only news summaries, not the decree; get legal advice before launch. A draft amendment proposes 60 minutes per day for under-16s but is not in force as far as I found. Also check Vietnam's data-localisation rules (not researched).

---

## 11. Sources

Latency and network
- WonderNetwork Hà Nội pings: https://wondernetwork.com/pings/Hanoi
- WonderNetwork HCMC pings: https://wondernetwork.com/pings/Ho%20Chi%20Minh%20City
- Valebyte latency table: https://valebyte.com/en/blog/best-vps-for-india-southeast-asia-locations-latency/
- Space-Node Vietnam estimates (sales copy): https://space-node.net/blog/minecraft-server-hosting-vietnam-2026 (the page itself had no figures; the estimate came via the search summary)
- Ookla Hà Nội mobile and fixed latency (news): https://vietnamnet.vn/en/hanoi-ranks-among-world-s-five-fastest-cities-for-mobile-internet-2563875.html and https://vietnamnews.vn/economy/1801785/ha-noi-becomes-world-s-fifth-fastest-city-for-mobile-internet.html
- Cable faults, Aug 2026: https://www.lightreading.com/cable-technology/four-subsea-cable-faults-hit-vietnam-s-internet and https://news.tuoitre.vn/vietnams-international-internet-connection-affected-by-faults-on-three-undersea-cables-103260827144107718.htm and https://english.vov.vn/en/society/four-undersea-cables-hit-faults-vietnams-international-internet-slows-locally-post1328208.vov
- Zenlayer Vietnam game servers (vendor): https://cloud.zenlayer.com/blog/game-servers-vietnam
- Cloudflare Hà Nội and HCMC data centres: https://blog.cloudflare.com/ten-new-data-centers/
- AWS Hanoi Local Zone: https://www.aboutamazon.sg/news/aws/amazon-web-services-launches-local-zone-in-hanoi-vietnam and https://aws.amazon.com/about-aws/global-infrastructure/localzones/pricing/

Compute and bandwidth
- Vultr plans API: https://api.vultr.com/v2/plans?type=vhf&per_page=100 , https://api.vultr.com/v2/plans?type=voc&per_page=100 , https://api.vultr.com/v2/plans-metal?per_page=100
- Vultr overage: https://docs.vultr.com/support/platform/billing/what-is-the-bandwidth-overage-rate and https://blogs.vultr.com/vultr-announces-reduced-bandwidth-pricing-2-tb-of-free-monthly-egress-free-ingress-and-global-pooling and https://egresscost.com/vultr
- Vultr DDoS: https://docs.vultr.com/ddos-protection
- Hetzner Singapore: https://www.hetzner.com/cloud-singapore/ , https://docs.hetzner.cloud/whats-new , https://costgoat.com/pricing/hetzner , https://northflank.com/blog/hetzner-cloud-server-price-increases , https://heise.de/-11333037 , https://capitalandcompute.net/blog/hetzner-price-increase-2026/ , https://docs.hetzner.com/cloud/technical-details/faq/
- DigitalOcean: https://www.digitalocean.com/pricing/droplets and https://docs.digitalocean.com/products/billing/bandwidth/
- Linode/Akamai: https://egresscost.com/linode , https://techdocs.akamai.com/cloud-computing/docs/network-transfer-usage-and-costs
- AWS Lightsail: https://aws.amazon.com/lightsail/pricing ; AWS egress tiers: https://egresscost.com/aws ; Wise (2025): https://wise.com/sg/blog/aws-pricing
- GCP egress reference: https://egresscost.com/gcp/
- OVHcloud Singapore VPS: https://www.ovhcloud.com/en/vps/vps-singapore/
- Viettel IDC listings: https://www.whtop.com/plans/viettelidc.com.vn/147273 (and neighbouring plan ids)
- BizFly: https://bizflycloud.vn/en/cloud-vps and https://bizflycloud.vn/en/cloud-server/bang-gia (the latter returned 404 on re-fetch; figures from the search snippet)
- GreenNode VND benchmark: https://greennode.ai/blog/cloud-server-bang-gia-thue

Cloudflare, CDN, storage
- Cloudflare WebSockets: https://developers.cloudflare.com/network/websockets/
- Cloudflare R2 pricing: https://developers.cloudflare.com/r2/pricing
- Cloudflare Durable Objects pricing: https://developers.cloudflare.com/durable-objects/platform/pricing
- Cloudflare plan prices (third-party): https://blog.cdnsun.com/cloudflare-pricing/ , https://costbench.com/software/cdn-edge/cloudflare/
- CDN price comparison and Bunny: https://egresscost.com/cdn-pricing , https://docs.bunny.net/cdn/pricing
- GitHub Pages limits: https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits

Database and auth
- Supabase pricing: https://supabase.com/pricing ; regions: https://supabase.com/docs/guides/platform/regions
- Firebase pricing: https://firebase.google.com/pricing ; Identity Platform: https://cloud.google.com/identity-platform/pricing
- Neon pricing: https://neon.com/pricing

Regulation (news summaries only)
- https://luatvietnam.vn/bai-viet-lien-quan/147-2024-nd-cp-372523.html
- https://hethongphapluat.com/phap-luat/chinh-sach-phap-luat/chinh-thuc-tre-em-choi-game-dung-mang-xa-hoi-phai-co-so-dien-thoai-cha-me-xac-thuc.html
- https://luatvietnam.vn/linh-vuc-khac/lam-the-nao-de-duoc-cung-cap-tro-choi-dien-tu-g1-883-99958-article.html
