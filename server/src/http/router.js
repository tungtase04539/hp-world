// http/router.js — tiny HTTP router on top of the transport's normalised request/response.
//
//   const r = createRouter({ log, metrics, name: 'game', allowedOrigins, allowNoOrigin, bodyLimit, auth: { admin: fn } })
//   r.get(path, handler, opts) / r.post / r.put / r.patch / r.delete / r.route(method, path, handler, opts)
//     path: '/v1/join', '/admin/api/players/:id', or a prefix ending in '/*' ('/admin/static/*' → req.params['*'])
//     opts: { auth: 'admin' (name in `auth`), cors: true (default), raw: false (true = req.body is a Buffer),
//             bodyLimit, rateLimit: fn(req) → null | {retryAfterS} }
//   handler(req, res) → (optional) value:  a returned plain object/array is sent as 200 JSON;
//     res.json(obj, status = 200, headers), res.text(str, status = 200, type = 'text/plain; charset=utf-8'),
//     res.send(status, headers, body), res.error(status, code, extra) → JSON {error: code, ...extra}
//     throw httpError(status, code) → JSON {error: code}
//   req: transport request + { params, queryObj, json (parsed body for JSON requests), body: raw Buffer if opts.raw }
//   r.handle(req, res) — give this to transport.onHttp().
//
// CORS: if the request has an Origin header, it must match allowedOrigins (exact, or with a '*' port/host wildcard:
// 'http://localhost:*'). Allowed → Access-Control-Allow-Origin echoes it. Preflight (OPTIONS) answers 204/403.
// Disallowed origin on a non-GET request → 403 origin_not_allowed (CSRF guard). No Origin → allowed iff allowNoOrigin.
import { API_ERR } from '../../../js/shared/protocol.js';

export function httpError(status, code, extra) {
  const e = new Error(code || `http ${status}`);
  e.status = status; e.code = code || API_ERR.INTERNAL; e.extra = extra;
  return e;
}

export function originMatcher(list) {
  const res = (list || []).map((p) => new RegExp('^' + p.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\/]/g, '\\$&')).join('[^/]*') + '$', 'i'));
  return (origin) => !!origin && res.some((re) => re.test(origin));
}

function compile(path) {
  if (path.endsWith('/*')) {
    const prefix = path.slice(0, -1);
    const dec = (x) => { try { return decodeURIComponent(x); } catch { return x; } };   // malformed '%' → raw, not a 500
    return { prefix, match: (p) => (p.startsWith(prefix) ? { '*': dec(p.slice(prefix.length)) } : null) };
  }
  const keys = [];
  const re = new RegExp('^' + path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\/:([A-Za-z_][A-Za-z0-9_]*)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$');
  return {
    match: (p) => {
      const m = re.exec(p);
      if (!m) return null;
      const params = {};
      keys.forEach((k, i) => { try { params[k] = decodeURIComponent(m[i + 1]); } catch { params[k] = m[i + 1]; } });
      return params;
    },
  };
}

const JSON_TYPE = 'application/json; charset=utf-8';

export function createRouter({ log, metrics, name = 'http', allowedOrigins = [], allowNoOrigin = true, bodyLimit = 16384, auth = {} } = {}) {
  const routes = [];
  const middleware = [];
  const isAllowed = originMatcher(allowedOrigins);
  const reqCount = metrics?.counter(`http_${name}_requests_total`, `HTTP requests on the ${name} port`);
  const errCount = metrics?.counter(`http_${name}_errors_total`, `HTTP 5xx on the ${name} port`);
  const lat = metrics?.histogram(`http_${name}_ms`, `HTTP handler latency on the ${name} port (ms)`);

  const add = (method, path, handler, opts = {}) => { routes.push({ method, path, ...compile(path), handler, opts }); return router; };

  function corsHeaders(req) {
    const o = req.headers.origin;
    if (o && isAllowed(o)) return { 'access-control-allow-origin': o, vary: 'Origin' };
    return {};
  }

  async function handle(req, tres) {
    const t0 = performance.now();
    const base = corsHeaders(req);
    const res = {
      get sent() { return tres.sent; },
      get aborted() { return tres.aborted; },
      send: (status, headers, body) => tres.send(status, { ...base, ...(headers || {}) }, body),
      json: (obj, status = 200, headers) => tres.send(status, { ...base, 'content-type': JSON_TYPE, 'cache-control': 'no-store', ...(headers || {}) }, JSON.stringify(obj)),
      text: (s, status = 200, type = 'text/plain; charset=utf-8', headers) => tres.send(status, { ...base, 'content-type': type, ...(headers || {}) }, s),
      error: (status, code, extra) => res.json({ error: code, ...(extra || {}) }, status),
    };
    let status = 200;
    try {
      reqCount?.inc();
      const origin = req.headers.origin;
      const originOk = origin ? isAllowed(origin) : allowNoOrigin;
      if (req.method === 'OPTIONS') {
        if (!origin || !isAllowed(origin)) { status = 403; return res.error(403, API_ERR.ORIGIN); }
        status = 204;
        return tres.send(204, {
          ...base,
          'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
          'access-control-allow-headers': 'content-type, authorization',
          'access-control-max-age': '600',
        }, '');
      }
      for (const mw of middleware) { if (await mw(req, res)) return; }
      let route = null, params = null, pathMatched = false;
      for (const r of routes) {
        const p = r.match(req.path);
        if (!p) continue;
        pathMatched = true;
        if (r.method !== req.method && !(r.method === 'GET' && req.method === 'HEAD')) continue;
        route = r; params = p; break;
      }
      if (!route) { status = pathMatched ? 405 : 404; return res.error(status, pathMatched ? 'method_not_allowed' : API_ERR.NOT_FOUND); }
      if (!originOk && req.method !== 'GET' && req.method !== 'HEAD') { status = 403; return res.error(403, API_ERR.ORIGIN); }
      if (route.opts.auth) {
        const fn = auth[route.opts.auth];
        if (!fn || !(await fn(req))) { status = 401; return res.error(401, API_ERR.UNAUTHORIZED); }
      }
      if (route.opts.rateLimit) {
        const rl = route.opts.rateLimit(req);
        if (rl) { status = 429; return res.json({ error: API_ERR.RATE_LIMITED, retryAfterS: rl.retryAfterS }, 429, { 'retry-after': String(Math.ceil(rl.retryAfterS || 1)) }); }
      }
      req.params = params;
      req.queryObj = Object.fromEntries(new URLSearchParams(req.query || ''));
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        let raw;
        try { raw = await req.body(); } catch (e) { status = e.status || 400; return res.error(status, status === 413 ? API_ERR.PAYLOAD_TOO_LARGE : API_ERR.BAD_REQUEST); }
        if (raw.length > (route.opts.bodyLimit || bodyLimit)) { status = 413; return res.error(413, API_ERR.PAYLOAD_TOO_LARGE); }
        if (route.opts.raw) req.rawBody = raw;
        else if (raw.length) {
          try { req.json = JSON.parse(raw.toString('utf8')); } catch { status = 400; return res.error(400, API_ERR.BAD_REQUEST, { detail: 'invalid json' }); }
        } else req.json = {};
      }
      const out = await route.handler(req, res);
      if (!tres.sent && !tres.aborted) {
        if (out === undefined) { status = 204; tres.send(204, base, ''); } else res.json(out);
      }
    } catch (e) {
      if (e && e.status) { status = e.status; if (!tres.sent) res.error(e.status, e.code, e.extra); }
      else {
        status = 500;
        log?.error('http handler error', { path: req.path, err: e });
        if (!tres.sent) res.error(500, API_ERR.INTERNAL);
      }
    } finally {
      lat?.observe(performance.now() - t0);
      if (status >= 500) errCount?.inc();
    }
  }

  const router = {
    name,
    get: (p, h, o) => add('GET', p, h, o),
    post: (p, h, o) => add('POST', p, h, o),
    put: (p, h, o) => add('PUT', p, h, o),
    patch: (p, h, o) => add('PATCH', p, h, o),
    delete: (p, h, o) => add('DELETE', p, h, o),
    route: (m, p, h, o) => add(m.toUpperCase(), p, h, o),
    use: (fn) => { middleware.push(fn); return router; },
    handle,
    isAllowedOrigin: isAllowed,
    get routes() { return routes.map((r) => `${r.method} ${r.path}`); },
  };
  return router;
}
