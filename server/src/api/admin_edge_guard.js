// api/admin_edge_guard.js — OWNER: S5. Defence in depth for the admin port (SPEC §4.2):
// the admin port must never answer anything that came through the Cloudflare tunnel or from the `edge` Docker network.
//
//   installAdminEdgeGuard(app, { denyCidrs, allowCidrs }) adds a middleware to app.admin that answers 403 when
//     1. the request carries a Cloudflare edge header (cf-connecting-ip, cf-ray, cf-warp-tag-id, cdn-loop: cloudflare)
//        — a correctly configured tunnel never routes to the admin port, so such a request is a misconfiguration; or
//     2. the socket source address is inside one of `denyCidrs` (compose sets ADMIN_DENY_CIDRS = the `edge` subnet,
//        i.e. the cloudflared container's network); or
//     3. `allowCidrs` is non-empty and the source address is not inside any of them.
//   Sources: options > app.config.adminDenyCidrs / adminAllowCidrs (if the integrator adds them) > process.env
//   ADMIN_DENY_CIDRS / ADMIN_ALLOW_CIDRS (comma-separated IPv4 CIDRs or single addresses).
// The admin transport is created with trustProxy 'none', so req.ip is always the real socket address.

const CF_HEADERS = ['cf-connecting-ip', 'cf-ray', 'cf-warp-tag-id', 'cf-ipcountry'];

export function parseIpv4(s) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(s || '').trim());
  if (!m) return null;
  let n = 0;
  for (let i = 1; i <= 4; i++) { const b = +m[i]; if (b > 255) return null; n = n * 256 + b; }
  return n >>> 0;
}

// '172.30.140.0/24' | '10.0.0.5' → {net, mask}; invalid → throws (a typo must not silently disable the guard)
export function parseCidr(s) {
  const [ip, bitsS] = String(s).trim().split('/');
  const base = parseIpv4(ip);
  const bits = bitsS === undefined ? 32 : Number(bitsS);
  if (base === null || !Number.isInteger(bits) || bits < 0 || bits > 32) throw new Error(`admin_edge_guard: bad CIDR "${s}"`);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return { net: (base & mask) >>> 0, mask, text: String(s).trim() };
}

export function ipInCidrs(ip, cidrs) {
  const n = parseIpv4(ip);
  if (n === null) return false;
  return cidrs.some((c) => ((n & c.mask) >>> 0) === c.net);
}

const splitList = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((x) => String(x).trim()).filter(Boolean);

export function cameThroughCloudflare(headers) {
  if (!headers) return false;
  for (const h of CF_HEADERS) if (headers[h]) return true;
  return /cloudflare/i.test(String(headers['cdn-loop'] || ''));
}

export function installAdminEdgeGuard(app, opts = {}) {
  const deny = splitList(opts.denyCidrs ?? app.config?.adminDenyCidrs ?? process.env.ADMIN_DENY_CIDRS).map(parseCidr);
  const allow = splitList(opts.allowCidrs ?? app.config?.adminAllowCidrs ?? process.env.ADMIN_ALLOW_CIDRS).map(parseCidr);
  const log = app.log?.child ? app.log.child({ mod: 'admin-edge-guard' }) : app.log;
  const blocked = app.metrics?.counter('admin_edge_blocked_total', 'Admin requests refused because they came from the tunnel/edge');
  app.admin.use((req, res) => {
    let why = null;
    if (cameThroughCloudflare(req.headers)) why = 'cloudflare_header';
    else if (deny.length && ipInCidrs(req.ip, deny)) why = 'edge_network';
    else if (allow.length && !ipInCidrs(req.ip, allow)) why = 'not_allowed_source';
    if (!why) return false;
    blocked?.inc(1, { why });
    log?.warn('admin request refused (edge guard)', { why, ip: req.ip, path: req.path });
    res.error(403, 'forbidden');
    return true;
  });
  log?.info('admin edge guard on', { deny: deny.map((c) => c.text), allow: allow.map((c) => c.text) });
  return { deny, allow };
}
