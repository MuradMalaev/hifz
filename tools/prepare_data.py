#!/usr/bin/env python3
"""Готовит встроенные данные Корана для приложения.

  python tools/prepare_data.py [source/quran.json]
    → static/data/quran.js   (window.__HIFZ_QURAN__ = {...})

Что делает:
  • проверяет, что в каждой суре столько аятов, сколько в эталоне (всего 6236);
  • убирает басмалу из первого аята всех сур, кроме 1-й и 9-й (она показывается отдельной строкой);
  • убирает служебный символ BOM;
  • считает объём каждого аята в арабских буквах — по нему считаются процент заученного
    от всего текста Корана, деление манзиля и прогноз.
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import blocks  # noqa: E402

ETALON = [7, 286, 200, 176, 120, 165, 206, 75, 129, 109, 123, 111, 43, 52, 99, 128, 111, 110, 98, 135, 112, 78, 118, 64, 77, 227, 93, 88, 69, 60, 34, 30, 73, 54, 45, 83, 182, 88, 75, 85, 54, 53, 89, 59, 37, 35, 38, 29, 18, 45, 60, 49, 62, 55, 78, 96, 29, 22, 24, 13, 14, 11, 11, 18, 12, 12, 30, 52, 52, 44, 28, 28, 20, 56, 40, 31, 50, 40, 46, 42, 29, 19, 36, 25, 22, 17, 19, 26, 30, 20, 15, 21, 11, 8, 8, 19, 5, 8, 8, 11, 11, 8, 3, 9, 5, 4, 7, 3, 6, 3, 5, 4, 5, 6]
BASMALA_START = "بِسْمِ"


def strip_basmala(text, sura):
    text = text.replace("﻿", "").strip()
    if sura in (1, 9):
        return text
    words = text.split(" ")
    if words and words[0] == BASMALA_START and len(words) > 4:
        return " ".join(words[4:])
    return text


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "source", "quran.json")
    with open(src, encoding="utf-8-sig") as f:
        data = json.load(f)
    if len(data) != 114:
        sys.exit("Ошибка: ожидалось 114 сур, найдено %d" % len(data))

    suras, total_letters = [], 0
    for i, s in enumerate(data):
        n = i + 1
        ayahs = s["ayahs"]
        if s.get("number") != n or len(ayahs) != ETALON[i]:
            sys.exit("Ошибка: сура %d — %d аятов, по эталону %d" % (n, len(ayahs), ETALON[i]))
        rows, lens = [], []
        for j, a in enumerate(ayahs):
            ar = strip_basmala(a["textAr"], n) if j == 0 else a["textAr"].replace("﻿", "").strip()
            ru = re.sub(r"\s+", " ", a.get("translationRu", "")).strip()
            rows.append([ar, ru])
            lens.append(max(len(blocks.letters(ar)), 1))
        total_letters += sum(lens)
        suras.append({
            "n": n,
            "ru": s.get("nameRu", ""),
            "ar": s.get("nameAr", ""),
            "type": s.get("type", ""),
            "a": rows,
            "len": lens,
        })

    out = {"total": total_letters, "suras": suras}
    os.makedirs(os.path.join(ROOT, "static", "data"), exist_ok=True)
    dst = os.path.join(ROOT, "static", "data", "quran.js")
    with open(dst, "w", encoding="utf-8") as f:
        f.write("/* Текст Корана (арабский) и перевод смыслов. Сгенерировано tools/prepare_data.py */\n")
        f.write("window.__HIFZ_QURAN__=")
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    print("Готово: %s — 114 сур, %d аятов, %d букв, %.1f МБ"
          % (dst, sum(ETALON), total_letters, os.path.getsize(dst) / 1048576))


if __name__ == "__main__":
    main()
