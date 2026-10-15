// tests/net/loader.mjs — cho phép node chạy module trình duyệt của js/net (test riêng MP-2 C2):
//   'three' → lib/three.module.js, 'three/addons/…' → lib/jsm/… (như importmap trong index.html),
//   js/world.js · js/device.js → bản giả nhẹ (tests/net/stubs/*) — world.js dựng cả thành phố khi import.
// Dùng: node --import ./tests/net/register.mjs --test tests/net/remote_avatars.test.mjs
const root = new URL('../../', import.meta.url);
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: new URL('lib/three.module.js', root).href, shortCircuit: true };
  if (spec.startsWith('three/addons/')) return { url: new URL('lib/jsm/' + spec.slice('three/addons/'.length), root).href, shortCircuit: true };
  const r = await next(spec, ctx);
  if (r.url.endsWith('/js/world.js')) return { url: new URL('tests/net/stubs/world.js', root).href, shortCircuit: true };
  if (r.url.endsWith('/js/device.js')) return { url: new URL('tests/net/stubs/device.js', root).href, shortCircuit: true };
  return r;
}
