#!/usr/bin/env python3
"""Собирает приложение в один HTML-файл: стили, скрипты, текст Корана и шрифт встроены.

  python build_single.py
    → dist/hifz.html          — открывается двойным щелчком, без сервера; подходит для GitHub Pages
    → dist/hifz-artifact.html — то же без <html>/<head>/<body> (для публикации как артефакт)
"""
import base64
import os
import re

ROOT = os.path.dirname(os.path.abspath(__file__))


def read(*p):
    with open(os.path.join(ROOT, *p), encoding="utf-8") as f:
        return f.read()


def main():
    with open(os.path.join(ROOT, "static", "fonts", "UthmanicHafs.ttf"), "rb") as f:
        font = base64.b64encode(f.read()).decode("ascii")
    css = read("static", "style.css").replace(
        'url("fonts/UthmanicHafs.ttf") format("truetype")',
        'url(data:font/ttf;base64,%s) format("truetype")' % font)

    html = read("index.html")
    # в однофайловой версии нет манифеста и service worker
    html = re.sub(r'<link rel="(manifest|apple-touch-icon)"[^>]*>\n?', "", html)
    # иконка вкладки встраивается в файл; лишние размеры убираем
    with open(os.path.join(ROOT, "static", "icons", "favicon-64.png"), "rb") as f:
        fav = base64.b64encode(f.read()).decode("ascii")
    html = re.sub(r'<link rel="icon"[^>]*sizes="192x192"[^>]*>\n?', "", html)
    html = re.sub(r'<link rel="icon"[^>]*>', '<link rel="icon" type="image/png" href="data:image/png;base64,%s">' % fav, html)
    html = html.replace('<link rel="stylesheet" href="static/style.css">', "<style>\n" + css + "\n</style>")
    for path in ("data.js", "data/quran.js", "data/themes.js", "data/meta.js", "blocks.js", "app.js"):
        js = read("static", *path.split("/")).replace("</script", "<\\/script")
        html = html.replace('<script src="static/%s"></script>' % path, "<script>\n" + js + "\n</script>")
    if "static/" in re.sub(r"<script>.*?</script>|<style>.*?</style>", "", html, flags=re.S):
        raise SystemExit("Ошибка: остались ссылки на static/")

    os.makedirs(os.path.join(ROOT, "dist"), exist_ok=True)
    with open(os.path.join(ROOT, "dist", "hifz.html"), "w", encoding="utf-8") as f:
        f.write(html)

    head = re.search(r"<head>(.*?)</head>", html, re.S).group(1)
    body = re.search(r"<body>(.*?)</body>", html, re.S).group(1)
    head = re.sub(r'<meta charset[^>]*>\s*|<meta name="viewport"[^>]*>\s*', "", head)
    with open(os.path.join(ROOT, "dist", "hifz-artifact.html"), "w", encoding="utf-8") as f:
        f.write(head.strip() + "\n" + body.strip() + "\n")
    size = os.path.getsize(os.path.join(ROOT, "dist", "hifz.html")) / 1048576
    print("Готово: dist/hifz.html (%.1f МБ) и dist/hifz-artifact.html" % size)


if __name__ == "__main__":
    main()
