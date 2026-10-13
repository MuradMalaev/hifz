/* Service worker «Хифз»: приложение и текст Корана работают без интернета.
   Аудио, скачанное кнопкой «скачать аудио», хранится в кэше hifz-audio. */
var VERSION = "hifz-v8";
var SHELL = [
  "./", "index.html", "manifest.webmanifest",
  "static/style.css", "static/app.js", "static/data.js", "static/blocks.js",
  "static/data/quran.js", "static/data/themes.js", "static/data/meta.js",
  "static/fonts/UthmanicHafs.ttf", "static/icons/icon-192.png", "static/icons/icon-512.png"
];
self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return /^hifz-v/.test(k) && k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (/\.mp3$/i.test(url.pathname)) { // аудио: сначала скачанное
    e.respondWith(caches.open("hifz-audio").then(function (c) {
      return c.match(req.url).then(function (hit) { return hit || fetch(req); });
    }));
    return;
  }
  if (url.origin === self.location.origin) {
    if (url.pathname.indexOf("/api/") !== -1) return; // данные server.py — всегда из сети
    e.respondWith(fetch(req).then(function (res) { // свежая версия из сети, иначе из кэша
      if (res && res.ok) { var copy = res.clone(); caches.open(VERSION).then(function (c) { c.put(req, copy); }); }
      return res;
    }).catch(function () {
      return caches.match(req, { ignoreSearch: true }).then(function (hit) { return hit || caches.match("index.html"); });
    }));
    return;
  }
  if (/(^|\.)jsdelivr\.net$|fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) { // тафсир и шрифты
    e.respondWith(caches.open("hifz-rt").then(function (c) {
      return c.match(req).then(function (hit) {
        var net = fetch(req).then(function (res) { if (res && (res.ok || res.type === "opaque")) c.put(req, res.clone()); return res; }).catch(function () { return hit; });
        return hit || net;
      });
    }));
  }
});
