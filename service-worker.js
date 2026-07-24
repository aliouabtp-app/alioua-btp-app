/* ===== ALIOUA BTP — Service Worker (يونس) =====
   يفعّل التخزين المؤقت (Cache) للتطبيق والمكتبات الخارجية باش يخدم بدون إنترنت
   بعد أول فتح ناجح. */

const CACHE_VERSION = 'alioua-btp-v1';
const APP_SHELL_CACHE = CACHE_VERSION + '-shell';
const RUNTIME_CACHE = CACHE_VERSION + '-runtime';

// الملفات الأساسية ديال التطبيق (Offline shell)
const APP_SHELL_URLS = [
  './',
  './index.html',
  './manifest.json'
];

// مكتبات خارجية (نسخ محددة برقم الإصدار، آمنة للتخزين طويل الأمد)
const RUNTIME_PRECACHE_URLS = [
  'https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shellCache = await caches.open(APP_SHELL_CACHE);
    // نخزنو أساسيات التطبيق؛ إذا فشل وحدة منهم (نادر)، ما نوقفوش التثبيت كاملو
    await Promise.allSettled(
      APP_SHELL_URLS.map((url) => shellCache.add(url).catch(() => {}))
    );

    const runtimeCache = await caches.open(RUNTIME_CACHE);
    await Promise.allSettled(
      RUNTIME_PRECACHE_URLS.map((url) =>
        fetch(url, { mode: 'cors' })
          .then((res) => { if (res && res.ok) return runtimeCache.put(url, res); })
          .catch(() => {}) // بلا إنترنت أو المصدر محجوب: نتجاوزو بهدوء
      )
    );
  })());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith('alioua-btp-') && key !== APP_SHELL_CACHE && key !== RUNTIME_CACHE)
        .map((key) => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

function isApiOrDataRequest(url) {
  // طلبات ديناميكية (AI، سحابة، خرائط...) ما خصهاش تتخزن أبدًا
  const dynamicHosts = [
    'generativelanguage.googleapis.com',
    'openrouter.ai',
    'api.mistral.ai',
    'firebasedatabase.app',
    'googleapis.com/calendar',
    'accounts.google.com',
    'image.pollinations.ai',
    'translate.google.com',
    'api.voicerss.org'
  ];
  return dynamicHosts.some((h) => url.hostname.includes(h) || url.href.includes(h));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // خلي طلبات POST/PUT (API، مزامنة) تفوت بلا تدخل

  const url = new URL(req.url);

  if (isApiOrDataRequest(url)) {
    // شبكة فقط، بلا أي تخزين مؤقت
    return;
  }

  const isNavigation = req.mode === 'navigate';
  const isSameOrigin = url.origin === self.location.origin;

  if (isNavigation || (isSameOrigin && APP_SHELL_URLS.some((u) => req.url.endsWith(u.replace('./', ''))))) {
    // Network-first لصفحة التطبيق الأساسية: يجيب آخر نسخة إذا كان أونلاين، ويرجع للنسخة المخزنة إذا خط الإنترنت مقطوع
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(APP_SHELL_CACHE);
        cache.put(req, fresh.clone());
        return fresh;
      } catch (err) {
        const cached = await caches.match(req, { ignoreSearch: true });
        return cached || caches.match('./index.html');
      }
    })());
    return;
  }

  // Cache-first لباقي الموارد الثابتة (مكتبات، خطوط، صور...)
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok && (fresh.type === 'basic' || fresh.type === 'cors')) {
        const cache = await caches.open(RUNTIME_CACHE);
        cache.put(req, fresh.clone());
      }
      return fresh;
    } catch (err) {
      return cached; // undefined إذا ماكانش فالكاش، المتصفح غادي يعرض خطأ شبكة عادي
    }
  })());
});
