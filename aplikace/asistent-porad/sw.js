// Service worker: offline běh aplikace + síťová brána secure režimu.
// V secure režimu odmítne VŠECHNY požadavky mimo vlastní původ a mimo cache.
const VERZE = 'ap-0.1.0';
const SKORAPKA = ['./', 'index.html', 'styl.css', 'app.js', 'analyza.js', 'uloziste.js',
  'prepis-worker.js', 'manifest.webmanifest', 'icon.svg'];
const CDN_CACHE = 'ap-cdn';

let secure = null; // null = neznámý stav po restartu SW → načti z cache

async function jeSecure() {
  if (secure !== null) return secure;
  const c = await caches.open('ap-stav');
  const r = await c.match('secure');
  secure = r ? (await r.text()) === '1' : false;
  return secure;
}

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERZE).then(c => c.addAll(SKORAPKA)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(n => n.startsWith('ap-0') && n !== VERZE).map(n => caches.delete(n))))
    .then(() => self.clients.claim()));
});

self.addEventListener('message', e => {
  if (e.data && e.data.typ === 'secure') {
    secure = !!e.data.zapnuto;
    e.waitUntil(caches.open('ap-stav').then(c => c.put('secure', new Response(secure ? '1' : '0'))));
  }
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  const vlastni = url.origin === self.location.origin;
  e.respondWith((async () => {
    const zabezpeceno = await jeSecure();
    if (vlastni) {
      // aplikace: cache-first, aktualizace na pozadí jen mimo secure režim
      const c = await caches.match(e.request, { ignoreSearch: true });
      if (c) {
        if (!zabezpeceno) e.waitUntil(fetch(e.request).then(r => r.ok && caches.open(VERZE).then(k => k.put(e.request, r))).catch(() => {}));
        return c;
      }
      if (zabezpeceno) return new Response('Secure režim: offline', { status: 503 });
      return fetch(e.request);
    }
    // cizí původ (CDN knihovny, model): jen z cache, síť pouze mimo secure režim
    const c = await caches.match(e.request);
    if (c) return c;
    if (zabezpeceno) return Response.error();
    const r = await fetch(e.request);
    if (r.ok && url.hostname === 'cdn.jsdelivr.net') {
      const kopie = r.clone();
      e.waitUntil(caches.open(CDN_CACHE).then(k => k.put(e.request, kopie)));
    }
    return r;
  })());
});
