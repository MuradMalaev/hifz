#!/usr/bin/env python3
"""Локальный сервер приложения «Хифз».

Запуск:  python server.py   → откроется http://localhost:8765

Что делает:
  • отдаёт интерфейс (index.html и папку static/ — текст Корана и перевод уже встроены);
  • хранит прогресс в файле data/progress.json (не пропадёт при очистке браузера);
  • загружает тафсир Ибн Касира по суре и кэширует его в data/cache/ —
    после первого открытия сура доступна без интернета.
Нужен только Python 3.8+, без сторонних библиотек.
"""
import json
import os
import re
import sys
import threading
import urllib.request
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "data")
CACHE = os.path.join(DATA, "cache")
STATE = os.path.join(DATA, "progress.json")
PORT = int(os.environ.get("HIFZ_PORT", "8765"))
TAFSIR = "https://cdn.jsdelivr.net/gh/spa5k/tafsir_api@main/tafsir/ru-tafsir-ibne-kahtir/%d.json"

os.makedirs(CACHE, exist_ok=True)
_lock = threading.Lock()


def load_tafsir(n):
    path = os.path.join(CACHE, "tafsir-%d.json" % n)
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    req = urllib.request.Request(TAFSIR % n, headers={"User-Agent": "hifz-app"})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.loads(r.read().decode("utf-8"))
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    return data


class Handler(SimpleHTTPRequestHandler):
    extensions_map = dict(SimpleHTTPRequestHandler.extensions_map, **{".ttf": "font/ttf", ".js": "text/javascript", ".webmanifest": "application/manifest+json"})

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, fmt, *args):
        if args and "/api/" in str(args[0]):
            return
        sys.stderr.write("  " + fmt % args + "\n")

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/api/state":
            with _lock:
                if os.path.exists(STATE):
                    with open(STATE, encoding="utf-8") as f:
                        return self._json(200, json.load(f))
            return self._json(200, {})
        m = re.match(r"^/api/tafsir/(\d{1,3})$", self.path)
        if m:
            n = int(m.group(1))
            if not 1 <= n <= 114:
                return self._json(404, {"error": "Нет такой суры"})
            try:
                return self._json(200, load_tafsir(n))
            except Exception as e:  # нет интернета и т. п.
                return self._json(503, {"error": "Не удалось загрузить тафсир: %s" % e})
        if self.path in ("/", ""):
            self.path = "/index.html"
        return super().do_GET()

    def do_POST(self):
        if self.path != "/api/state":
            return self._json(404, {"error": "not found"})
        size = int(self.headers.get("Content-Length", "0"))
        try:
            data = json.loads(self.rfile.read(size).decode("utf-8"))
        except ValueError:
            return self._json(400, {"error": "Некорректный JSON"})
        with _lock:
            tmp = STATE + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=1)
            os.replace(tmp, STATE)
        return self._json(200, {"ok": True})


def main():
    url = "http://localhost:%d" % PORT
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print("Хифз запущен: %s   (остановить: Ctrl+C)" % url)
    print("Прогресс сохраняется в %s" % STATE)
    if "--no-browser" not in sys.argv:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nОстановлено.")


if __name__ == "__main__":
    main()
