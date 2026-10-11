"""Автоматическое деление диапазона суры на смысловые блоки (Python-версия static/blocks.js).

Признаки границы блока:
  1) смена рифмы окончаний аятов (фасыла);
  2) аят начинается с маркера новой темы: клятва, обращение, «Скажи», «Когда…», «Разве…».
Динамическое программирование подбирает границы так, чтобы блоки были близки к
целевому объёму и совпадали с этими признаками.

Запуск для проверки:  python blocks.py 74 [short|std|long] [с_аята] [по_аят]
"""
import math
import re

SIZES = {"short": 220, "std": 350, "long": 520}
MAX_AYAHS = {"short": 8, "std": 12, "long": 18}

_DIACRITICS = re.compile("[ؐ-ًؚ-ٰٟۖ-ۭـ]")
_RU_CUES = [re.compile(p, re.I) for p in (
    r"^клянусь", r"^о вы, которые уверовали", r"^о люди", r"^о сыны", r"^о пророк",
    r"^о посланник", r"^скажи", r"^когда ", r"^неужели", r"^разве ", r"^дош[её]л ли",
    r"^дошло ли", r"^вот ", r"^и вот ", r"^вспомни", r"^мы ниспослали",
    r"^поистине, мы ниспослали")]
_AR_NOT_OATH = {"والذين", "والتي", "والذي", "والله", "والمؤمنون", "والمؤمنين"}
_LEAD = re.compile(r"^[\s«\"“(\[\d.]+")
_FILLER = re.compile(r"^(и|а|но|же|воистину,?|поистине,?|ведь|вот|затем|потом)\s+", re.I)


def normalize(t):
    t = _DIACRITICS.sub("", t or "")
    t = re.sub("[آأإٱ]", "ا", t)
    return t.replace("ى", "ي").replace("ئ", "ي").replace("ة", "ه")


def letters(t):
    return re.sub("[^ء-ي]", "", normalize(t))


def rhyme(t):
    l = letters(t)
    c = l[-1:]
    if c in ("ن", "م"):
        return "N"
    if c in ("ا", "ه", "ي", "و"):
        return c + l[-2:-1]
    return c


def cue_score(ar, ru):
    s = 0.0
    words = re.sub("[^ء-ي ]", "", normalize(ar)).split()
    w0 = words[0] if words else ""
    w1 = words[1] if len(words) > 1 else ""
    if w0 in ("اذا", "قل", "يايها") or (w0 == "يا" and w1.startswith("ايها")):
        s = 2
    if w0.startswith("وال") and len(w0) >= 5 and w0 not in _AR_NOT_OATH:
        s = max(s, 1.5)
    if w0 in ("افلا", "الم", "اولم", "هل"):
        s = max(s, 1.5)
    r = _LEAD.sub("", ru or "")
    if any(p.search(r) for p in _RU_CUES):
        s = max(s, 2)
    return s


def title(ru, a, b):
    t = re.sub(r"[«»\"“”]", "", _LEAD.sub("", re.sub(r"\s+", " ", ru or "")))
    t = re.sub(r"\s*\([^)]*\)", "", t).strip()
    for _ in range(2):
        t = _FILLER.sub("", t)
    if not t:
        return "Аяты %s" % (a if a == b else "%d–%d" % (a, b))
    w = t.split(" ")
    s = re.sub(r"[,.;:!?—–-]+$", "", " ".join(w[:5]))
    s = s[:1].upper() + s[1:]
    return s + ("…" if len(w) > 5 else "")


def compute(ayahs, offset=1, size="std"):
    """ayahs: [{'ar','ru'}] аятов диапазона → [{'s','e','name'}] с номерами аятов суры."""
    size = size if size in SIZES else "std"
    target, maxa = SIZES[size], MAX_AYAHS[size]
    n = len(ayahs)
    if not n:
        return []
    pre = [0]
    for a in ayahs:
        pre.append(pre[-1] + max(len(letters(a.get("ar", ""))), 8))

    def named(s, e):
        return {"s": s + offset, "e": e + offset, "name": title(ayahs[s].get("ru"), s + offset, e + offset)}

    if pre[n] <= target * 1.4 or n <= 3:
        return [named(0, n - 1)]
    rh = [rhyme(a.get("ar", "")) for a in ayahs]
    score = [0.0]
    for i in range(1, n):
        sc = cue_score(ayahs[i].get("ar", ""), ayahs[i].get("ru", ""))
        if rh[i] != rh[i - 1]:
            sc += 1.2
            if i + 1 < n and rh[i + 1] == rh[i]:
                sc += 0.6
        score.append(sc)

    def cost(a, b):
        length, cnt = pre[b + 1] - pre[a], b - a + 1
        d = (length - target) / target
        c = d * d
        if cnt > maxa:
            c += (cnt - maxa) * 0.3
        if length > target * 2.2:
            c += 2
        if length < target * 0.45:  # слишком маленький блок
            c += (target * 0.45 - length) / (target * 0.45) * 1.6
        if a > 0:
            c -= 0.3 * score[a]
        return c

    best, frm = [0.0], [0]
    for b in range(n):
        bv, ba = math.inf, 0
        for a in range(b, -1, -1):
            if pre[b + 1] - pre[a] > target * 4 and a < b:
                break
            v = best[a] + cost(a, b)
            if v < bv:
                bv, ba = v, a
        best.append(bv)
        frm.append(ba)
    out, e = [], n
    while e > 0:
        s = frm[e]
        out.insert(0, named(s, e - 1))
        e = s
    return out


if __name__ == "__main__":
    import json
    import os
    import sys
    root = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(root, "static", "data", "quran.js"), encoding="utf-8") as f:
        raw = f.read()
    data = json.loads(raw[raw.index("=") + 1:].rstrip().rstrip(";"))
    num = int(sys.argv[1]) if len(sys.argv) > 1 else 74
    sz = sys.argv[2] if len(sys.argv) > 2 else "std"
    rows = data["suras"][num - 1]["a"]
    a1 = int(sys.argv[3]) if len(sys.argv) > 3 else 1
    a2 = int(sys.argv[4]) if len(sys.argv) > 4 else len(rows)
    part = [{"ar": r[0], "ru": r[1]} for r in rows[a1 - 1:a2]]
    for blk in compute(part, offset=a1, size=sz):
        print("%3d–%-3d  %s" % (blk["s"], blk["e"], blk["name"]))
