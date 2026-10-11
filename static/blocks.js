/*
 * Автоматическое деление выбранного диапазона суры на смысловые блоки.
 * Та же логика есть в blocks.py.
 *
 * Признаки границы смысловой части:
 *   1) меняется рифма окончаний аятов (фасыла) — особенно заметно в мекканских сурах;
 *   2) аят начинается с «маркера» новой темы: клятва (وَالْ…, «Клянусь»), обращение
 *      («О вы, которые уверовали», «О люди»), «Скажи», «Когда…», «Разве…», «Вспомни…».
 * Динамическое программирование подбирает границы так, чтобы блоки были близки к
 * целевому объёму и по возможности совпадали с этими признаками.
 */
(function (root) {
  var SIZES = { short: 220, std: 350, long: 520 }; // целевой объём блока в арабских буквах
  var MAX_AYAHS = { short: 8, std: 12, long: 18 };

  var DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;
  function normalize(t) {
    return (t || "").replace(DIACRITICS, "")
      .replace(/[آأإٱ]/g, "ا")
      .replace(/ى/g, "ي").replace(/ئ/g, "ي")
      .replace(/ة/g, "ه");
  }
  function letters(t) { return normalize(t).replace(/[^ء-ي]/g, ""); }
  function rhyme(t) {
    var l = letters(t), c = l.charAt(l.length - 1);
    if (c === "ن" || c === "م") return "N";
    if (c === "ا" || c === "ه" || c === "ي" || c === "و") return c + l.charAt(l.length - 2);
    return c;
  }

  var RU_CUES = [/^клянусь/i, /^о вы, которые уверовали/i, /^о люди/i, /^о сыны/i, /^о пророк/i,
    /^о посланник/i, /^скажи/i, /^когда /i, /^неужели/i, /^разве /i, /^дош[её]л ли/i, /^дошло ли/i,
    /^вот /i, /^и вот /i, /^вспомни/i, /^мы ниспослали/i, /^поистине, мы ниспослали/i];
  var AR_NOT_OATH = ["والذين", "والتي", "والذي", "والله", "والمؤمنون", "والمؤمنين"];
  var LEAD = /^[\s«"“(\[\d.]+/;

  function cueScore(ar, ru) {
    var s = 0;
    var words = normalize(ar).replace(/[^ء-ي ]/g, "").trim().split(/\s+/);
    var w0 = words[0] || "", w1 = words[1] || "";
    if (w0 === "اذا" || w0 === "قل" || w0 === "يايها" || (w0 === "يا" && w1.indexOf("ايها") === 0)) s = 2;
    if (w0.indexOf("وال") === 0 && w0.length >= 5 && AR_NOT_OATH.indexOf(w0) === -1) s = Math.max(s, 1.5);
    if (w0 === "افلا" || w0 === "الم" || w0 === "اولم" || w0 === "هل") s = Math.max(s, 1.5);
    var r = (ru || "").replace(LEAD, "");
    for (var i = 0; i < RU_CUES.length; i++) if (RU_CUES[i].test(r)) { s = Math.max(s, 2); break; }
    return s;
  }

  /* Краткое название блока — начало перевода первого аята без слов-связок */
  var FILLER = /^(и|а|но|же|воистину,?|поистине,?|ведь|вот|затем|потом)\s+/i;
  function title(ru, a, b) {
    var t = (ru || "").replace(/\s+/g, " ").replace(LEAD, "").replace(/[«»"“”]/g, "").replace(/\s*\([^)]*\)/g, "").trim();
    for (var k = 0; k < 2; k++) t = t.replace(FILLER, "");
    if (!t) return "Аяты " + (a === b ? a : a + "–" + b);
    var w = t.split(" ");
    var s = w.slice(0, 5).join(" ").replace(/[,.;:!?—–-]+$/, "");
    s = s.charAt(0).toUpperCase() + s.slice(1);
    return s + (w.length > 5 ? "…" : "");
  }

  /**
   * ayahs: [{ar, ru}] — аяты диапазона; opts.offset — номер первого аята диапазона,
   * opts.size — "short" | "std" | "long". Возвращает [{s, e, name}] с номерами аятов суры.
   */
  function compute(ayahs, opts) {
    opts = opts || {};
    var off = opts.offset || 1, size = SIZES[opts.size] ? opts.size : "std";
    var TARGET = SIZES[size], MAXA = MAX_AYAHS[size];
    var n = ayahs.length;
    if (!n) return [];
    var pre = [0], i;
    for (i = 0; i < n; i++) pre.push(pre[i] + Math.max(letters(ayahs[i].ar).length, 8));
    function named(s, e) { return { s: s + off, e: e + off, name: title(ayahs[s].ru, s + off, e + off) }; }
    if (pre[n] <= TARGET * 1.4 || n <= 3) return [named(0, n - 1)];
    var rh = ayahs.map(function (x) { return rhyme(x.ar); });
    var score = [0];
    for (i = 1; i < n; i++) {
      var sc = cueScore(ayahs[i].ar, ayahs[i].ru);
      if (rh[i] !== rh[i - 1]) {
        sc += 1.2;
        if (i + 1 < n && rh[i + 1] === rh[i]) sc += 0.6;
      }
      score.push(sc);
    }
    function cost(a, b) {
      var len = pre[b + 1] - pre[a], cnt = b - a + 1;
      var d = (len - TARGET) / TARGET, c = d * d;
      if (cnt > MAXA) c += (cnt - MAXA) * 0.3;
      if (len > TARGET * 2.2) c += 2;
      if (len < TARGET * 0.45) c += (TARGET * 0.45 - len) / (TARGET * 0.45) * 1.6; // слишком маленький блок
      if (a > 0) c -= 0.3 * score[a];
      return c;
    }
    var best = [0], from = [0];
    for (var b = 0; b < n; b++) {
      var bv = Infinity, ba = 0;
      for (var a = b; a >= 0; a--) {
        if (pre[b + 1] - pre[a] > TARGET * 4 && a < b) break;
        var v = best[a] + cost(a, b);
        if (v < bv) { bv = v; ba = a; }
      }
      best[b + 1] = bv; from[b + 1] = ba;
    }
    var out = [], e = n;
    while (e > 0) { var s = from[e]; out.unshift(named(s, e - 1)); e = s; }
    return out;
  }

  root.HifzBlocks = { compute: compute, letters: letters, title: title, SIZES: SIZES };
})(typeof window !== "undefined" ? window : this);
