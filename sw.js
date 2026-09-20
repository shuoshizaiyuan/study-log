/* sw.js — 把网页本体缓存到手机，没网也能打开（模块 9：可选增强） */
var CACHE = 'study-log-v1';
var SHELL = [
  './',
  './index.html',
  './app.css',
  './icon.svg',
  './manifest.webmanifest',
  './js/core.js',
  './js/github.js',
  './js/sync.js',
  './js/export.js',
  './js/card.js',
  './js/view-timeline.js',
  './js/view-tasks.js',
  './js/view-dashboard.js',
  './js/view-settings.js',
  './js/app.js'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return Promise.all(SHELL.map(function (u) {
        return c.add(new Request(u, { cache: 'reload' })).catch(function () { });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  /* 只缓存自家页面资源；GitHub API 一律走网络，绝不缓存数据 */
  if (url.origin !== location.origin) return;

  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) {
        if (hit) return hit;
        if (req.mode === 'navigate') return caches.match('./index.html');
        return new Response('', { status: 504, statusText: '离线且无缓存' });
      });
    })
  );
});
