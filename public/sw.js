// ZMF VOX STUDIO+ service worker: precache app shell, cache-first for same-origin GETs.
// Never intercepts or forwards cross-origin requests; never caches POST bodies (no audio leaves the device).
const VERSION = 'zmf-v0.2.0';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg'];
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await c.addAll(SHELL);
    // Precache built assets listed in the Vite manifest, if present.
    try { const m = await (await fetch('./.vite/manifest.json')).json(); await c.addAll([...new Set(Object.values(m).flatMap((x) => [x.file, ...(x.css || []), ...(x.assets || [])]).map((f) => './' + f))]); } catch (_) {}
    try { await c.addAll(['./ort/ort-wasm-simd-threaded.jsep.wasm', './ort/ort-wasm-simd-threaded.jsep.mjs']); } catch (_) {}
    self.skipWaiting();
  })());
});
self.addEventListener('activate', (e) => e.waitUntil((async () => { for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k); await self.clients.claim(); })()));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith((async () => {
    const c = await caches.open(VERSION);
    const hit = await c.match(e.request, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const r = await fetch(e.request);
      if (r.ok) c.put(e.request, r.clone());
      return r;
    } catch (err) {
      if (e.request.mode === 'navigate') return (await c.match('./index.html')) || Response.error();
      throw err;
    }
  })());
});
