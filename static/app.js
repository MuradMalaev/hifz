/* Хифз — трекер заучивания и повторения Корана.
 * Хранение: через server.py — файл data/progress.json; иначе — браузер (localStorage + IndexedDB).
 * Код без новейшего синтаксиса, чтобы работать и в не самых свежих браузерах.
 */
(function () {
  "use strict";
  var SURAS = window.HIFZ_SURAS, JUZ = window.HIFZ_JUZ, RECITERS = window.HIFZ_RECITERS;
  var Q = window.__HIFZ_QURAN__, THEMES = window.HIFZ_THEMES || {};
  var RUB = window.HIFZ_RUB || [], ORDER = window.HIFZ_ORDER || [], ASBAB = window.HIFZ_ASBAB || {};
  var QNAME = ["", "¼", "½", "¾"];
  var B = window.HifzBlocks;
  var BLOCKS_VER = 5; // при смене тематических данных автоматические блоки пересчитываются
  var DAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
  var DAYS_FULL = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];
  var KEY = "hifz.state.v2";
  var TAFSIR_URL = "https://cdn.jsdelivr.net/gh/spa5k/tafsir_api@main/tafsir/ru-tafsir-ibne-kahtir/";
  var NORMS = [[0.25, "¼ страницы"], [0.5, "½ страницы"], [1, "1 страница"]];
  var SIZES = [["short", "Короче"], ["std", "Стандартно"], ["long", "Длиннее"]];
  var GRADES = [["easy", "Легко"], ["hard", "С запинками"], ["forgot", "Забыл"]];
  var LESSON_GRADES = [["great", "Отлично"], ["good", "Хорошо"], ["repeat", "Повторить"]]; // старые записи журнала
  var MARKS = [[5, "отлично"], [4, "хорошо"], [3, "удовл."], [2, "плохо"]];
  var HIDE = [0, 5, 3, 2, 1], HIDE_LABEL = ["", "⅕", "⅓", "½", "всё"];
  var PARTIAL_MIN = 20;
  var STOPS = /[ۖ-ۭ]/g;

  /* ---------------- даты ---------------- */
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ds(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function parse(s) { var p = s.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function today() { return ds(new Date()); }
  function addDays(s, n) { var d = parse(s); d.setDate(d.getDate() + n); return ds(d); }
  function diff(a, b) { return Math.round((parse(a) - parse(b)) / 86400000); }
  function weekday(s) { return (parse(s).getDay() + 6) % 7; }
  function nice(s) { return parse(s).toLocaleDateString("ru-RU", { day: "numeric", month: "long" }); }
  function niceShort(s) { return parse(s).toLocaleDateString("ru-RU", { day: "numeric", month: "short" }); }

  /* ---------------- состояние ---------------- */
  function defaults() {
    return {
      name: "", reciter: "sowaid", speed: 1, ayahRep: 3, blockRep: 2, pause: 2, listen: false,
      arSize: 30, ruSize: 15, blockSize: "std", intervals: [1, 3, 7, 14, 30],
      cycle: 7, weekStart: 0, ustaz: [], rest: [], direction: "end", norm: 0.5,
      manzilMode: "volume", suraMode: "juz", suraSort: "desc", ui: "md", contrast: false
    };
  }
  function blank() {
    return { v: 2, bver: BLOCKS_VER, setup: false, set: defaults(), current: null, suras: {}, reviews: [], manzil: {}, anchor: today(), log: [],
      weak: [], journal: [], days: {}, miles: {}, carry: {}, mskip: {}, mitems: {}, mshift: 0, started: today(), keep: [], mz: null };
  }
  function newOb() { return { step: 0, picks: {}, q: "", partial: null, tr: false, tf: false, mode: "juz", jopen: {} }; }
  var state = null, mode = "local";
  var view = { tab: "today", sura: null, filter: "all", q: "", openB: null, edit: null, check: {}, hint: {}, hide: {}, dl: {}, tafFull: {},
    pick: false, tafsir: null, reader: null, sheet: null, celebrate: null, done: null, quiz: null, lesson: null, ob: null, confirm: null, rangeEdit: false, jopen: null,
    wordRev: {}, showLearned: false, scroll: {}, plain: {}, split: null, keepOpen: {} };

  function S(n) {
    var s = state.suras[n];
    if (!s) s = state.suras[n] = { tr: false, tf: false, done: "", range: null, blocks: null, bsrc: null, note: "", anchors: {} };
    if (!s.anchors) s.anchors = {};
    return s;
  }
  function rows(n) { return Q.suras[n - 1].a; }
  function count(n) { return SURAS[n - 1].ayahs; }

  /* заученность — строка из 0/1 по аятам */
  function doneStr(n) { var s = S(n), c = count(n); if (s.done.length !== c) s.done = (s.done + new Array(c + 1).join("0")).slice(0, c); return s.done; }
  function isDone(n, a) { var s = state.suras[n]; return !!(s && s.done && s.done.charAt(a - 1) === "1"); }
  function setDone(n, a, b, v) { var d = doneStr(n).split(""); for (var i = a; i <= b; i++) d[i - 1] = v ? "1" : "0"; S(n).done = d.join(""); if (v && !S(n).startD) S(n).startD = today(); }
  function doneCount(n, a, b) { var c = 0; a = a || 1; b = b || count(n); for (var i = a; i <= b; i++) if (isDone(n, i)) c++; return c; }
  function hifz(n) { var s = state.suras[n]; return !!(s && s.done && s.done.length === count(n) && s.done.indexOf("0") === -1); }
  function full(n) { var s = state.suras[n]; return !!(s && s.tr && s.tf && hifz(n)); }
  function runs(n) {
    var out = [], st = null, c = count(n);
    for (var i = 1; i <= c + 1; i++) {
      var d = i <= c && isDone(n, i);
      if (d && st === null) st = i;
      if (!d && st !== null) { out.push([st, i - 1]); st = null; }
    }
    return out;
  }
  function firstUndone(n) { var d = doneStr(n).indexOf("0"); return d === -1 ? null : d + 1; }

  /* ---------------- объём: страницы мединского мусхафа (604) ---------------- */
  var MUSHAF = 604;
  var PW = (function () { // вес аята в страницах: буквы аята / плотность текста его джуза
    var pagesInJuz = [21], j, n, a;
    for (j = 1; j < 29; j++) pagesInJuz.push(20);
    pagesInJuz.push(23);
    var juzLetters = [], idx = {};
    for (j = 0; j < 30; j++) juzLetters.push(0);
    j = 0;
    for (n = 1; n <= 114; n++) {
      idx[n] = [];
      for (a = 1; a <= SURAS[n - 1].ayahs; a++) {
        while (j < 29 && (JUZ[j + 1][0] < n || (JUZ[j + 1][0] === n && JUZ[j + 1][1] <= a))) j++;
        idx[n].push(j); juzLetters[j] += Q.suras[n - 1].len[a - 1];
      }
    }
    var out = {};
    for (n = 1; n <= 114; n++) out[n] = Q.suras[n - 1].len.map(function (l, i) { var jj = idx[n][i]; return l * pagesInJuz[jj] / juzLetters[jj]; });
    return out;
  })();
  function pagesOf(n, a, b, onlyDone) {
    var w = PW[n], t = 0; a = a || 1; b = b || w.length;
    for (var i = a; i <= b; i++) if (!onlyDone || isDone(n, i)) t += w[i - 1];
    return t;
  }
  function juzOf(n, a) { var j = 0; for (var i = 0; i < JUZ.length; i++) if (JUZ[i][0] < n || (JUZ[i][0] === n && JUZ[i][1] <= a)) j = i; return j; }
  function juzSegs(j) {
    var st = JUZ[j], en = JUZ[j + 1] || [115, 1], out = [];
    for (var n = st[0]; n <= Math.min(114, en[0]); n++) {
      var a = n === st[0] ? st[1] : 1, b = n === en[0] ? en[1] - 1 : count(n);
      if (b >= a) out.push([n, a, b]);
    }
    return out;
  }
  /* четверти хизба: r = 0..239, хизб = r/4 + 1 */
  function rubSegs(r) {
    var st = RUB[r], en = RUB[r + 1] || [115, 1], out = [];
    for (var n = st[0]; n <= Math.min(114, en[0]); n++) {
      var a = n === st[0] ? st[1] : 1, b = n === en[0] ? en[1] - 1 : count(n);
      if (b >= a) out.push([n, a, b]);
    }
    return out;
  }
  function rubOf(n, a) { var lo = 0, hi = RUB.length - 1; while (lo < hi) { var m = (lo + hi + 1) >> 1; var r = RUB[m]; if (r[0] < n || (r[0] === n && r[1] <= a)) lo = m; else hi = m - 1; } return lo; }
  function rubName(r) { return "хизб " + (Math.floor(r / 4) + 1) + (r % 4 ? " " + QNAME[r % 4] : ""); }
  function segPages(segs, onlyDone) { return segs.reduce(function (t, s) { return t + pagesOf(s[0], s[1], s[2], onlyDone); }, 0); }
  function juzPages(j, onlyDone) { return juzSegs(j).reduce(function (t, s) { return t + pagesOf(s[0], s[1], s[2], onlyDone); }, 0); }
  function juzDone(j) { return juzSegs(j).every(function (s) { return doneCount(s[0], s[1], s[2]) === s[2] - s[1] + 1; }); }
  function juzFull(j) { return juzDone(j) && juzSegs(j).every(function (s) { var x = state.suras[s[0]]; return x && x.tr && x.tf; }); }

  /* ---------------- хранение ---------------- */
  function readLocal() { try { var r = localStorage.getItem(KEY); return r ? JSON.parse(r) : null; } catch (e) { return null; } }
  var saveTimer = null;
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* хранилище недоступно */ }
    if (mode === "server") {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(function () {
        fetch("api/state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state) })
          .catch(function () { toast("Сервер недоступен — сохранено только в браузере"); });
      }, 300);
    }
  }
  function migrate(st) {
    if (!st) return null;
    if (st.v === 1) {
      var nw = blank(); nw.setup = !!st.setup; nw.current = st.current; nw.manzil = st.manzil || {};
      Object.keys(st.suras || {}).forEach(function (key) {
        var o = st.suras[key], n = +key, c = count(n), dn = new Array(c + 1).join("0").split("");
        if (o.hifz) dn = new Array(c + 1).join("1").split("");
        else (o.blocks || []).forEach(function (b) { if (b.ok) for (var i = b.s; i <= b.e; i++) dn[i - 1] = "1"; });
        nw.suras[n] = { tr: !!o.tr, tf: !!o.tf, done: dn.join(""), range: null, blocks: null, bsrc: null, note: o.note || "", anchors: {} };
        if (o.phase === "review") nw.reviews.push({ id: n + ":1-" + c, n: n, s: 1, e: c, stage: o.stage || 0, next: o.next || today() });
      });
      st = nw;
    }
    if (st.v !== 2) return null;
    var d = defaults(), b = blank(), k;
    st.set = st.set || {};
    for (k in d) if (!(k in st.set)) st.set[k] = d[k];
    for (k in b) if (!(k in st)) st[k] = b[k];
    if (!st.started) st.started = today();
    if (st.bver !== BLOCKS_VER) {
      Object.keys(st.suras).forEach(function (k2) { var x = st.suras[k2]; if (x.bsrc !== "custom") { x.blocks = null; x.bsrc = null; } });
      st.bver = BLOCKS_VER;
    }
    return st;
  }
  function boot() {
    var local = migrate(readLocal());
    var done = function (st) {
      state = st || blank();
      applyTheme();
      if (!state.setup) view.ob = newOb(); else { checkMiles(true); restoreView(); }
      render();
      if (state.setup) window.scrollTo(0, view.scroll[viewKey()] || 0);
      loadRecs();
    };
    if (/^https?:/.test(location.protocol)) {
      fetch("api/state", { cache: "no-store" }).then(function (r) {
        var ct = r.headers.get("content-type") || "";
        if (!r.ok || ct.indexOf("json") === -1) throw new Error("no api");
        return r.json();
      }).then(function (st) {
        mode = "server";
        var m = migrate(st && st.v ? st : null);
        done(m || local);
        if (!m && local) save();
      }).catch(function () { done(local); });
    } else done(local);
  }
  function markDay() { state.days[today()] = 1; }
  function streak() { var d = today(), c = 0; if (!state.days[d]) d = addDays(d, -1); while (state.days[d] && c < 5000) { c++; d = addDays(d, -1); } return c; }

  /* ---------------- диапазон и блоки ---------------- */
  function defaultRange(n) {
    var c = count(n), f = firstUndone(n) || 1;
    if (c <= 40 && f === 1) return [1, c];
    var sum = 0, e = f;
    while (e <= c && sum + PW[n][e - 1] <= 2) { sum += PW[n][e - 1]; e++; }
    return [f, Math.max(f, Math.min(c, e - 1))];
  }
  function range(n) { var s = S(n); if (!s.range) s.range = defaultRange(n); return s.range; }
  function autoBlocks(n) {
    var r = range(n), th = THEMES[n];
    if (th) {
      var out = [];
      th.forEach(function (t) { var s = Math.max(t[0], r[0]), e = Math.min(t[1], r[1]); if (s <= e) out.push({ s: s, e: e, name: t[2], d: t[3] || "" }); });
      if (out.length) return out;
    }
    var part = rows(n).slice(r[0] - 1, r[1]).map(function (x) { return { ar: x[0], ru: x[1] }; });
    return B.compute(part, { offset: r[0], size: state.set.blockSize });
  }
  function blocksOf(n) { var s = S(n); if (!s.blocks) { s.blocks = autoBlocks(n); s.bsrc = "auto"; } return s.blocks; }
  function blockDone(n, b) { return doneCount(n, b.s, b.e) === b.e - b.s + 1; }
  function setRange(n, a, b) {
    var s = S(n), c = count(n);
    a = Math.max(1, Math.min(c, a | 0)); b = Math.max(a, Math.min(c, b | 0));
    s.range = [a, b]; s.blocks = null; blocksOf(n);
  }
  function afterProgress(n, quiet) {
    var r = range(n);
    if (doneCount(n, r[0], r[1]) === r[1] - r[0] + 1) {
      addReview(n, r[0], r[1]);
      if (hifz(n)) {
        if (state.current === n) { state.current = suggestNext(); if (state.current) range(state.current); }
        if (quiet) toast(full(n) ? "Сура «" + SURAS[n - 1].ru + "» заучена полностью" : "Текст суры отмечен выученным");
        else { S(n).doneD = today(); view.done = n; }
      } else {
        S(n).range = defaultRange(n); S(n).blocks = null; blocksOf(n);
        toast("Диапазон выучен. Дальше: аяты " + S(n).range[0] + "–" + S(n).range[1]);
      }
    }
  }
  function suggestNext() {
    var start = state.set.direction === "start";
    for (var i = 0; i < 114; i++) { var n = start ? i + 1 : 114 - i; if (!hifz(n)) return n; }
    return null;
  }
  /* якорь блока — первое слово (или два, если первое короткое); можно задать своё */
  function autoAnchor(n, a) {
    var w = rows(n)[a - 1][0].replace(STOPS, "").trim().split(/\s+/);
    return B.letters(w[0] || "").length <= 3 && w[1] ? w[0] + " " + w[1] : (w[0] || "");
  }
  function anchorOf(n, a) { var s = S(n); return s.anchors[a] || autoAnchor(n, a); }

  /* ---------------- повторы по интервалам ---------------- */
  function intervals() { return state.set.intervals && state.set.intervals.length ? state.set.intervals : [1, 3, 7, 14, 30]; }
  function addReview(n, a, b) {
    var id = n + ":" + a + "-" + b;
    if (state.reviews.some(function (r) { return r.id === id; })) return;
    state.reviews.push({ id: id, n: n, s: a, e: b, stage: 0, next: addDays(today(), intervals()[0]) });
  }
  /* «Легко» — интервал через ступень, «С запинками» — тот же интервал, «Забыл» — завтра и в слабые места */
  function review(id, g) {
    var r = state.reviews.filter(function (x) { return x.id === id; })[0];
    if (!r) return;
    var iv = intervals();
    if (g === "easy") r.stage += 2;
    else if (g === "forgot") { r.stage = 0; addWeak(r.n, r.s, r.e, "forgot"); }
    else r.stage = Math.min(r.stage, iv.length - 1);
    if (r.stage >= iv.length) { state.reviews = state.reviews.filter(function (x) { return x.id !== id; }); toast("Отрывок перешёл в манзиль"); }
    else { r.next = addDays(today(), iv[r.stage]); toast(g === "forgot" ? "Повторим завтра. Отрывок добавлен в слабые места" : "Следующий повтор — " + nice(r.next)); }
    state.log.push({ d: today(), id: id, g: g });
    if (state.log.length > 500) state.log = state.log.slice(-500);
    markDay(); afterChange();
  }
  function dueReviews() { var t = today(); return state.reviews.filter(function (r) { return r.next <= t; }).sort(function (a, b) { return a.next < b.next ? -1 : 1; }); }
  function rLabel(r) { return SURAS[r.n - 1].ru + (r.s === 1 && r.e === count(r.n) ? "" : " · " + rng(r.s, r.e)); }

  /* ---------------- слабые места ---------------- */
  var WEAK_SRC = { forgot: "забыто при повторе", ustaz: "замечание устаза", quiz: "самопроверка" };
  function addWeak(n, s, e, src, note) {
    var id = n + ":" + s + "-" + e, ex = state.weak.filter(function (w) { return w.id === id; })[0];
    if (ex) { ex.d = today(); ex.src = src; if (note) ex.note = note; return; }
    state.weak.unshift({ id: id, n: n, s: s, e: e, src: src, note: note || "", d: today() });
  }

  /* ---------------- манзиль (без Аль-Фатихи — её читают в каждом намазе) ---------------- */
  function cycleInfo(dateStr) {
    var cyc = state.set.cycle, t = dateStr || today(), raw;
    if (cyc === 7) raw = (weekday(t) - state.set.weekStart + 7) % 7;
    else raw = ((diff(t, state.anchor) % cyc) + cyc) % cyc;
    var idx = (((raw - (state.mshift || 0)) % cyc) + cyc) % cyc;
    return { cyc: cyc, idx: idx, start: addDays(t, -idx) };
  }
  function dayName(d, i) { return state.set.cycle === 7 ? DAYS_FULL[weekday(d)] : "День " + (i + 1); }
  var partsCache = null;
  /* Манзиль: всё выученное делится на части, близкие по объёму.
     По объёму — большие отрывки режутся по аятам; по хизбам — границы только по четвертям хизба. */
  /* Новое выученное входит в манзиль только с начала следующего круга (недели):
     в начале круга запоминается снимок выученного, и до конца круга деление не меняется. */
  function syncMz() {
    var st = cycleInfo().start;
    if (state.mz && state.mz.start === st) return false;
    var snap = {};
    Object.keys(state.suras).forEach(function (k) { var d = state.suras[k].done; if (d && d.indexOf("1") !== -1) snap[k] = d; });
    state.mz = { start: st, done: snap };
    return true;
  }
  function inMz(n, a) { var d = state.mz && state.mz.done[n]; return !!(d && d.charAt(a - 1) === "1"); }
  function mzRuns(n, pending) {
    var out = [], st = null, c = count(n);
    for (var i = 1; i <= c + 1; i++) {
      var d = i <= c && isDone(n, i) && (pending ? !inMz(n, i) : inMz(n, i));
      if (d && st === null) st = i;
      if (!d && st !== null) { out.push([st, i - 1]); st = null; }
    }
    return out;
  }
  function mzAdd(n, a, b) {
    if (!state.mz) return;
    var c = count(n), d = ((state.mz.done[n] || "") + new Array(c + 1).join("0")).slice(0, c).split("");
    for (var i = a; i <= b; i++) d[i - 1] = "1";
    state.mz.done[n] = d.join("");
  }
  function mzPending() {
    var out = [];
    SURAS.forEach(function (x) { if (x.n === 1 || !state.suras[x.n]) return; mzRuns(x.n, true).forEach(function (r) { out.push({ n: x.n, s: r[0], e: r[1] }); }); });
    return out;
  }
  function mzWaitHtml() {
    var pend = mzPending();
    if (!pend.length) return "";
    var ci = cycleInfo(), nx = addDays(ci.start, ci.cyc);
    return '<p class="mz-wait">' + ICON.clock + "<span>С " + esc(niceShort(nx)) + ": " + esc(pend.map(itemLabel).join(", ")) + '</span><button class="link" data-act="mz-now">сейчас</button></p>';
  }
  function manzilParts() {
    var cyc = state.set.cycle, hizbMode = state.set.manzilMode === "hizb", units = [], total = 0;
    SURAS.forEach(function (x) {
      if (x.n === 1) return;
      mzRuns(x.n).forEach(function (r) { var w = pagesOf(x.n, r[0], r[1]); units.push({ n: x.n, s: r[0], e: r[1], w: w }); total += w; });
    });
    if (!units.length) return [];
    var elems = [];
    if (hizbMode) {
      units.forEach(function (u) {
        var a = u.s;
        while (a <= u.e) {
          var r = rubOf(u.n, a), nx = RUB[r + 1], end = nx && nx[0] === u.n ? Math.min(u.e, nx[1] - 1) : u.e;
          var piece = { n: u.n, s: a, e: end, w: pagesOf(u.n, a, end), r: r }, g = elems[elems.length - 1];
          if (g && g.r === r) { g.list.push(piece); g.w += piece.w; } else elems.push({ r: r, list: [piece], w: piece.w });
          a = end + 1;
        }
      });
    } else {
      var cap = total / cyc * 0.5;
      units.forEach(function (u) {
        if (u.w <= cap) { elems.push({ list: [u], w: u.w }); return; }
        var a = u.s, sum = 0;
        for (var i = u.s; i <= u.e; i++) { sum += PW[u.n][i - 1]; if (sum >= cap || i === u.e) { elems.push({ list: [{ n: u.n, s: a, e: i, w: sum }], w: sum }); a = i + 1; sum = 0; } }
      });
    }
    var k = Math.min(cyc, elems.length), n = elems.length, pre = [0], dp = [], cut = [], j, i2;
    elems.forEach(function (u) { pre.push(pre[pre.length - 1] + u.w); });
    for (j = 0; j <= k; j++) { dp.push([]); cut.push([]); }
    for (i2 = 0; i2 <= n; i2++) dp[1][i2] = pre[i2];
    for (j = 2; j <= k; j++) for (i2 = j; i2 <= n; i2++) {
      var best = Infinity, bc = j - 1;
      for (var c = j - 1; c < i2; c++) { var v = Math.max(dp[j - 1][c], pre[i2] - pre[c]); if (v < best - 1e-9) { best = v; bc = c; } }
      dp[j][i2] = best; cut[j][i2] = bc;
    }
    var parts = [], end2 = n;
    for (j = k; j >= 1; j--) { var st2 = j === 1 ? 0 : cut[j][end2]; parts.unshift(elems.slice(st2, end2)); end2 = st2; }
    return parts.map(function (p) {
      var items = [];
      p.forEach(function (g) {
        g.list.forEach(function (u) {
          var last = items[items.length - 1];
          if (last && last.n === u.n && last.e + 1 === u.s) { last.e = u.e; last.w += u.w; } else items.push({ n: u.n, s: u.s, e: u.e, w: u.w });
        });
      });
      var out = { items: items, pages: p.reduce(function (a, g) { return a + g.w; }, 0) };
      if (hizbMode) { out.r0 = p[0].r; out.rs = p.map(function (g) { return g.r; }); }
      return out;
    });
  }
  function partLabel(p) {
    if (!p.rs) return "";
    var gr = [];
    p.rs.forEach(function (r) { var l = gr[gr.length - 1]; if (l && r === l[1] + 1) l[1] = r; else if (!l || r !== l[1]) gr.push([r, r]); });
    return gr.map(function (g) { return g[0] === g[1] ? rubName(g[0]) : rubName(g[0]) + " – " + rubName(g[1]); }).join(", ");
  }
  function itemKey(it) { return it.n + ":" + it.s + "-" + it.e; }
  function itemDone(d, it) { return !!(state.manzil[d] || (state.mitems[d] && state.mitems[d][itemKey(it)])); }
  function itemLabel(it) { return SURAS[it.n - 1].ru + (it.s === 1 && it.e === count(it.n) ? "" : " · " + rng(it.s, it.e)); }
  function missedYesterday(parts) {
    var y = addDays(today(), -1);
    if (y < state.started || state.manzil[y] || state.mskip[y] || state.carry[today()]) return null;
    var ci = cycleInfo(y);
    return parts[ci.idx] ? { d: y, idx: ci.idx } : null;
  }

  /* ---------------- статистика, прогноз, вехи ---------------- */
  function stats() {
    var f = 0, h = 0, ay = 0, pg = 0;
    SURAS.forEach(function (x) {
      if (!state.suras[x.n]) return;
      var c = doneCount(x.n); ay += c; if (c) pg += pagesOf(x.n, 1, count(x.n), true);
      if (hifz(x.n)) h++; if (full(x.n)) f++;
    });
    return { full: f, hifz: h, ayahs: ay, pages: pg, pct: pg / MUSHAF * 100 };
  }
  function isRest(dstr) { return state.set.rest.indexOf(weekday(dstr)) !== -1; }
  function finishDate(pages) {
    if (pages <= 0.001) return null;
    var days = Math.ceil(pages / state.set.norm - 1e-9), d = today(), guard = 0;
    while (days > 0 && guard < 4000) { if (!isRest(d)) days--; if (days > 0) d = addDays(d, 1); guard++; }
    return d;
  }
  var MILES = [
    ["sura1", "Первая сура наизусть", function (st) { return st.hifz >= 1; }],
    ["full1", "Первая сура заучена полностью", function (st) { return st.full >= 1; }],
    ["juz1", "Первый джуз наизусть", function () { for (var j = 0; j < 30; j++) if (juzDone(j)) return true; return false; }],
    ["p5", "5 % Корана", function (st) { return st.pct >= 5; }],
    ["p10", "10 % Корана", function (st) { return st.pct >= 10; }],
    ["p25", "Четверть Корана", function (st) { return st.pct >= 25; }],
    ["p50", "Половина Корана", function (st) { return st.pct >= 50; }],
    ["p100", "Весь Коран", function (st) { return st.pct >= 99.95; }],
    ["s7", "7 дней подряд", function () { return streak() >= 7; }],
    ["s30", "30 дней подряд", function () { return streak() >= 30; }],
    ["s100", "100 дней подряд", function () { return streak() >= 100; }]
  ];
  function mileTitle(id) {
    var m = /^j(f?)(\d+)$/.exec(id);
    if (m) return "Джуз " + m[2] + (m[1] ? " заучен полностью" : " наизусть");
    var d = MILES.filter(function (x) { return x[0] === id; })[0];
    return d ? d[1] : id;
  }
  function checkMiles(silent) {
    var st = stats(), fresh = [];
    MILES.forEach(function (m) { if (!state.miles[m[0]] && m[2](st)) { state.miles[m[0]] = today(); fresh.push(m[0]); } });
    for (var j = 0; j < 30; j++) {
      if (!state.miles["j" + (j + 1)] && juzDone(j)) { state.miles["j" + (j + 1)] = today(); fresh.push("j" + (j + 1)); }
      if (!state.miles["jf" + (j + 1)] && juzFull(j)) { state.miles["jf" + (j + 1)] = today(); fresh.push("jf" + (j + 1)); }
    }
    if (!silent && fresh.length) view.celebrate = fresh[fresh.length - 1];
  }
  function afterChange() { checkMiles(false); save(); render(); }

  /* ---------------- тафсир Ибн Касира и записи (IndexedDB) ---------------- */
  var tafsirMem = {}, tafsirLoading = {}, idb = null;
  function idbOpen() {
    return new Promise(function (res) {
      try {
        var rq = indexedDB.open("hifz", 2);
        rq.onupgradeneeded = function () {
          var db = rq.result;
          if (!db.objectStoreNames.contains("tafsir")) db.createObjectStore("tafsir");
          if (!db.objectStoreNames.contains("rec")) db.createObjectStore("rec");
        };
        rq.onsuccess = function () { idb = rq.result; res(idb); };
        rq.onerror = function () { res(null); };
      } catch (e) { res(null); }
    });
  }
  function idbDo(store, fn) {
    return (idb ? Promise.resolve(idb) : idbOpen()).then(function (db) {
      if (!db) return null;
      return new Promise(function (res) { try { fn(db, store, res); } catch (e) { res(null); } });
    });
  }
  function idbGet(store, k) { return idbDo(store, function (db, st, res) { var rq = db.transaction(st).objectStore(st).get(k); rq.onsuccess = function () { res(rq.result || null); }; rq.onerror = function () { res(null); }; }); }
  function idbSet(store, k, v) { return idbDo(store, function (db, st, res) { var tx = db.transaction(st, "readwrite"); tx.objectStore(st).put(v, k); tx.oncomplete = function () { res(true); }; tx.onerror = function () { res(null); }; }); }
  var decoder = document.createElement("textarea");
  function cleanHtml(t) {
    t = String(t || "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<[^>]+>/g, "");
    decoder.innerHTML = t;
    return decoder.value.replace(/ /g, " ").replace(/\n{3,}/g, "\n\n").trim();
  }
  function parseTafsir(j) {
    var list = Array.isArray(j) ? j : (j && Array.isArray(j.ayahs) ? j.ayahs : (j && Array.isArray(j.verses) ? j.verses : null)), map = {};
    if (list) list.forEach(function (it) { var a = +(it.ayah || it.verse || it.ayah_number || it.verse_number || it.number); if (a) map[a] = cleanHtml(it.text || it.content || it.tafsir || ""); });
    else if (j && (j.text || j.content)) map[+(j.ayah || j.verse || 0)] = cleanHtml(j.text || j.content);
    return map;
  }
  function getTafsir(n) {
    if (tafsirMem[n]) return Promise.resolve(tafsirMem[n]);
    if (tafsirLoading[n]) return tafsirLoading[n];
    var p = idbGet("tafsir", "t" + n).then(function (cached) {
      if (cached) return cached;
      var src = mode === "server" ? "api/tafsir/" + n : TAFSIR_URL + n + ".json";
      return fetch(src).then(function (r) { if (!r.ok) throw new Error("http " + r.status); return r.json(); })
        .then(function (j) { var m = parseTafsir(j); if (!Object.keys(m).length) throw new Error("empty"); idbSet("tafsir", "t" + n, m); return m; });
    }).then(function (m) { tafsirMem[n] = m; delete tafsirLoading[n]; return m; }, function (e) { delete tafsirLoading[n]; throw e; });
    tafsirLoading[n] = p;
    return p;
  }
  function getTafsirAyah(n, a) {
    return fetch(TAFSIR_URL + n + "/" + a + ".json").then(function (r) { if (!r.ok) throw new Error("http"); return r.json(); })
      .then(function (j) { var m = parseTafsir(j); var t = m[a] || m[0] || ""; if (!t) throw new Error("empty"); return t; });
  }

  /* ---------------- аудио ---------------- */
  var player = { on: false, paused: false, n: 0, list: [], i: 0, rep: 1, round: 1, audio: null, timer: null, err: "" };
  var GLOBAL_START = (function () { var out = [0], s = 0; SURAS.forEach(function (x) { s += x.ayahs; out.push(s); }); return out; })();
  function pad3(x) { return ("00" + x).slice(-3); }
  function reciter() { return RECITERS.filter(function (r) { return r.id === state.set.reciter; })[0] || RECITERS[0]; }
  function audioUrl(n, a, alt) {
    var r = reciter();
    if (alt && r.alt) return "https://cdn.islamic.network/quran/audio/128/" + r.alt + "/" + (GLOBAL_START[n - 1] + a) + ".mp3";
    return "https://everyayah.com/data/" + r.folder + "/" + pad3(n) + pad3(a) + ".mp3";
  }
  function playRange(n, a, b, single) {
    stopAudio(true);
    var list = [];
    for (var i = a; i <= b; i++) list.push(i);
    var au = player.audio;
    if (!au) { au = new Audio(); au.preload = "auto"; }
    player = { on: true, paused: false, n: n, list: list, i: 0, rep: 1, round: 1, audio: au, pre: player.pre || null, timer: null, watch: null, err: "", loading: true,
      reps: Math.max(1, state.set.ayahRep), rounds: single ? 1 : Math.max(1, state.set.blockRep) };
    setupMediaSession();
    playCurrent(0);
    renderPlayer();
  }
  /* attempt: 0 — основной источник, 1 — повтор, 2 — запасной источник */
  function playCurrent(attempt) {
    var au = player.audio, a = player.list[player.i], r = reciter();
    clearTimeout(player.watch);
    var fail = function () {
      clearTimeout(player.watch);
      if (!player.on) return;
      if (attempt === 0) { playCurrent(1); return; }
      if (attempt === 1 && r.alt) { playCurrent(2); return; }
      player.err = "Аудио не загрузилось. Проверьте интернет или выберите другого чтеца.";
      player.paused = true; player.loading = false; renderPlayer();
    };
    au.onended = onEnded;
    au.onerror = fail;
    au.onplaying = function () { clearTimeout(player.watch); player.loading = false; player.err = ""; renderPlayer(); };
    au.src = audioUrl(player.n, a, attempt === 2);
    try { au.load(); } catch (e) { /* ignore */ }
    au.playbackRate = state.set.speed;
    try { au.defaultPlaybackRate = state.set.speed; } catch (e) { /* ignore */ }
    player.loading = true;
    player.watch = setTimeout(function () { if (player.on && !player.paused && player.loading) fail(); }, 12000);
    var pr = au.play();
    if (pr && pr.catch) pr.catch(function (err) {
      if (err && err.name === "NotAllowedError") {
        clearTimeout(player.watch); player.paused = true; player.loading = false;
        player.err = "Нажмите ▶, чтобы включить звук"; renderPlayer();
      }
    });
    mediaMeta();
    preloadNext();
    highlight();
  }
  function preloadNext() {
    var nx = player.list[player.i + 1];
    if (!nx) return;
    try { if (!player.pre) player.pre = new Audio(); player.pre.preload = "auto"; player.pre.src = audioUrl(player.n, nx, false); } catch (e) { /* ignore */ }
  }
  function onEnded() {
    var au = player.audio, wait = state.set.pause * 1000;
    if (state.set.listen && au.duration && isFinite(au.duration)) wait += au.duration * 1000 / state.set.speed;
    var last = player.i === player.list.length - 1;
    if (player.rep < player.reps) player.rep++;
    else if (!last) { player.rep = 1; player.i++; if (!state.set.listen) wait = 350; }
    else if (player.round < player.rounds) { player.rep = 1; player.i = 0; player.round++; }
    else { stopAudio(); toast("Повтор завершён"); return; }
    renderPlayer();
    player.timer = setTimeout(function () { if (player.on && !player.paused) playCurrent(0); }, wait);
  }
  function stopAudio(silent) {
    clearTimeout(player.timer); clearTimeout(player.watch);
    if (player.audio) { try { player.audio.pause(); } catch (e) { /* ignore */ } player.audio.onended = null; player.audio.onerror = null; player.audio.onplaying = null; }
    player.on = false; player.paused = false;
    document.body.classList.remove("has-player");
    if ("mediaSession" in navigator) try { navigator.mediaSession.playbackState = "none"; } catch (e) { /* ignore */ }
    if (!silent) { renderPlayer(); highlight(); }
  }
  function togglePause() {
    if (!player.on) return;
    if (player.paused) { player.paused = false; player.err = ""; playCurrent(0); }
    else { player.paused = true; clearTimeout(player.timer); clearTimeout(player.watch); try { player.audio.pause(); } catch (e) { /* ignore */ } }
    if ("mediaSession" in navigator) try { navigator.mediaSession.playbackState = player.paused ? "paused" : "playing"; } catch (e) { /* ignore */ }
    renderPlayer();
  }
  function stepAyah(d) {
    if (!player.on) return;
    clearTimeout(player.timer);
    player.i = Math.max(0, Math.min(player.list.length - 1, player.i + d)); player.rep = 1; player.paused = false;
    playCurrent(0); renderPlayer();
  }
  /* управление с экрана блокировки и наушников */
  var msReady = false;
  function setupMediaSession() {
    if (msReady || !("mediaSession" in navigator)) return;
    msReady = true;
    var h = {
      play: function () { if (player.paused) togglePause(); },
      pause: function () { if (!player.paused) togglePause(); },
      previoustrack: function () { stepAyah(-1); },
      nexttrack: function () { stepAyah(1); },
      stop: function () { stopAudio(); }
    };
    Object.keys(h).forEach(function (k) { try { navigator.mediaSession.setActionHandler(k, h[k]); } catch (e) { /* не поддерживается */ } });
  }
  function mediaMeta() {
    if (!("mediaSession" in navigator) || !window.MediaMetadata) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: SURAS[player.n - 1].ru + " · аят " + player.list[player.i], artist: reciter().name, album: "Хифз" });
      navigator.mediaSession.playbackState = "playing";
    } catch (e) { /* ignore */ }
  }
  function highlight() {
    var els = document.querySelectorAll(".ayah.playing");
    for (var i = 0; i < els.length; i++) els[i].classList.remove("playing");
    if (!player.on) return;
    var el = document.getElementById("ay-" + player.n + "-" + player.list[player.i]);
    if (el) el.classList.add("playing");
  }
  function renderPlayer() {
    var el = document.getElementById("player");
    if (!player.on) { el.hidden = true; el.innerHTML = ""; return; }
    document.body.classList.add("has-player");
    var a = player.list[player.i];
    el.hidden = false;
    el.innerHTML = '<div class="pl-in"><div class="pl-info"><b>' + esc(SURAS[player.n - 1].ru) + " · аят " + a + "</b><span>" +
      (player.err ? '<span class="err">' + esc(player.err) + "</span>" :
        (player.loading && !player.paused ? "загрузка…" : "повтор " + player.rep + " из " + player.reps + (player.rounds > 1 ? " · круг " + player.round + " из " + player.rounds : ""))) +
      '</span></div><div class="pl-btns"><button class="pbtn" data-act="pl-prev" aria-label="Предыдущий аят">' + ICON.prev + '</button><button class="pbtn main" data-act="pl-toggle" aria-label="' + (player.paused ? "Продолжить" : "Пауза") + '">' + (player.paused ? ICON.play : ICON.pause) +
      '</button><button class="pbtn" data-act="pl-next" aria-label="Следующий аят">' + ICON.next + '</button><button class="pbtn" data-act="pl-stop" aria-label="Остановить">' + ICON.close + "</button></div></div>";
  }

  /* ---------------- запись своего чтения ---------------- */
  var rec = { on: null, mr: null, chunks: [], urls: {} };
  function loadRecs() {
    idbDo("rec", function (db, st, res) {
      var rq = db.transaction(st).objectStore(st).openCursor();
      rq.onsuccess = function () { var c = rq.result; if (c) { try { rec.urls[c.key] = URL.createObjectURL(c.value); } catch (e) { /* ignore */ } c.continue(); } else res(true); };
      rq.onerror = function () { res(null); };
    });
  }
  function startRec(n, a) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) { toast("Запись не поддерживается в этом браузере"); return; }
    stopAudio(true);
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      var mr = new MediaRecorder(stream), key = n + ":" + a;
      rec.chunks = [];
      mr.ondataavailable = function (e) { if (e.data && e.data.size) rec.chunks.push(e.data); };
      mr.onstop = function () {
        stream.getTracks().forEach(function (t) { t.stop(); });
        var blob = new Blob(rec.chunks, { type: mr.mimeType || "audio/webm" });
        if (rec.urls[key]) URL.revokeObjectURL(rec.urls[key]);
        rec.urls[key] = URL.createObjectURL(blob);
        idbSet("rec", key, blob);
        rec.on = null; rec.mr = null; render();
        compareRec(n, a);
      };
      mr.start(); rec.on = key; rec.mr = mr; render();
    }).catch(function () { toast("Нет доступа к микрофону — разрешите его в настройках браузера"); });
  }
  function stopRec() { if (rec.mr && rec.mr.state !== "inactive") rec.mr.stop(); }
  function compareRec(n, a) {
    stopAudio(true);
    var own = rec.urls[n + ":" + a], done = false;
    var playOwn = function () { if (done || !own) return; done = true; var o = new Audio(own); var p = o.play(); if (p && p.catch) p.catch(function () { /* ignore */ }); };
    var ref = new Audio(audioUrl(n, a, false));
    ref.playbackRate = state.set.speed;
    ref.onended = function () { setTimeout(playOwn, 400); };
    ref.onerror = playOwn;
    toast("Сначала чтец, затем ваша запись");
    var p = ref.play();
    if (p && p.catch) p.catch(playOwn);
  }

  /* ---------------- офлайн: service worker, скачивание аудио ---------------- */
  var installEvt = null;
  function swActive() { return !!(navigator.serviceWorker && navigator.serviceWorker.controller); }
  function registerSW() {
    try {
      if (!("serviceWorker" in navigator)) return;
      if (!/^https:|^http:\/\/(localhost|127\.0\.0\.1)/.test(location.href)) return;
      if (window.self !== window.top) return;
      navigator.serviceWorker.register("sw.js").then(function () {
        navigator.serviceWorker.addEventListener("controllerchange", function () { render(); });
      }).catch(function () { /* в однофайловой версии sw.js нет */ });
    } catch (e) { /* ignore */ }
  }
  window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); installEvt = e; if (view.tab === "settings") render(); });
  function blockUrls(n, b) { var out = []; for (var a = b.s; a <= b.e; a++) out.push(audioUrl(n, a, false)); return out; }
  function checkDownloaded(n, b, key) {
    if (!window.caches || view.dl[key] !== undefined) return;
    view.dl[key] = null;
    caches.open("hifz-audio").then(function (c) {
      return Promise.all(blockUrls(n, b).map(function (u) { return c.match(u); }));
    }).then(function (hits) { view.dl[key] = hits.every(Boolean); if (view.dl[key]) render(); }, function () { view.dl[key] = false; });
  }
  function downloadBlock(n, b, key) {
    var urls = blockUrls(n, b), ok = 0, fail = 0;
    toast("Скачиваю аудио блока…");
    caches.open("hifz-audio").then(function (c) {
      return Promise.all(urls.map(function (u) {
        return c.match(u).then(function (hit) {
          if (hit) return true;
          return fetch(u, { mode: "cors" }).catch(function () { return fetch(u, { mode: "no-cors" }); })
            .then(function (r) { if (r && (r.ok || r.type === "opaque")) return c.put(u, r); throw new Error("bad"); });
        }).then(function () { ok++; }, function () { fail++; });
      }));
    }).then(function () {
      view.dl[key] = !fail;
      toast(fail ? "Скачано " + ok + " из " + urls.length + " — проверьте интернет" : "Аудио блока доступно без интернета");
      render();
    }, function () { toast("Не удалось сохранить аудио"); });
  }
  function audioCacheInfo(cb) {
    if (!window.caches) return cb(0);
    caches.open("hifz-audio").then(function (c) { return c.keys(); }).then(function (k) { cb(k.length); }, function () { cb(0); });
  }

  /* ---------------- поиск по тексту ---------------- */
  var normAr = null;
  var DIAC = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;
  function nAr(t) { return t.replace(DIAC, "").replace(/[آأإٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/[^ء-ي ]/g, "").replace(/\s+/g, " ").trim(); }
  function nRu(t) { return t.toLowerCase().replace(/ё/g, "е"); }
  function searchAyahs(q) {
    var ar = /[؀-ۿ]/.test(q), qq = ar ? nAr(q) : nRu(q.trim()), hits = [], total = 0;
    if (qq.length < (ar ? 2 : 3)) return { hits: [], total: 0, ar: ar };
    if (ar && !normAr) normAr = Q.suras.map(function (s) { return s.a.map(function (r) { return nAr(r[0]); }); });
    for (var n = 1; n <= 114; n++) {
      var A = rows(n);
      for (var a = 1; a <= A.length; a++) {
        var hay = ar ? normAr[n - 1][a - 1] : nRu(A[a - 1][1]);
        if (hay.indexOf(qq) !== -1) { total++; if (hits.length < 40) hits.push([n, a]); }
      }
    }
    return { hits: hits, total: total, ar: ar, q: qq };
  }
  function snippet(text, q) {
    var low = nRu(text), i = low.indexOf(q);
    if (i === -1) return esc(text.slice(0, 120));
    var s = Math.max(0, i - 50), e = Math.min(text.length, i + q.length + 70);
    return (s ? "…" : "") + esc(text.slice(s, i)) + "<mark>" + esc(text.slice(i, i + q.length)) + "</mark>" + esc(text.slice(i + q.length, e)) + (e < text.length ? "…" : "");
  }

  /* ---------------- самопроверка ---------------- */
  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function buildQuiz() {
    var pairs = [], bpairs = [], learned = [];
    SURAS.forEach(function (x) {
      var n = x.n;
      if (!state.suras[n]) return;
      if (doneCount(n)) learned.push(n);
      for (var a = 1; a < x.ayahs; a++) if (isDone(n, a) && isDone(n, a + 1)) pairs.push({ t: "ayah", n: n, a: a });
      var bl = blocksOf(n);
      for (var i = 0; i + 1 < bl.length; i++) if (blockDone(n, bl[i]) && blockDone(n, bl[i + 1])) bpairs.push({ t: "block", n: n, i: i });
    });
    var spairs = [];
    learned.forEach(function (n) { if (n < 114 && learned.indexOf(n + 1) !== -1) spairs.push({ t: "sura", n: n }); });
    shuffle(pairs); shuffle(bpairs); shuffle(spairs);
    var qs = [], want = 8;
    var take = function (arr, k) { while (k-- > 0 && arr.length && qs.length < want) qs.push(arr.pop()); };
    take(spairs, 2); take(bpairs, 2); take(pairs, want);
    take(bpairs, want); take(spairs, want);
    shuffle(qs);
    qs.forEach(function (q) {
      if (q.t !== "sura") return;
      var pool = learned.filter(function (m) { return m !== q.n + 1 && m !== q.n; });
      if (pool.length < 2) for (var k = 1; k <= 114 && pool.length < 6; k++) if (k !== q.n && k !== q.n + 1 && pool.indexOf(k) === -1) pool.push(k);
      q.opts = shuffle(shuffle(pool).slice(0, 2).concat([q.n + 1]));
    });
    return { qs: qs, i: 0, shown: false, pick: null, score: 0, missed: 0 };
  }

  /* ---------------- UI-утилиты ---------------- */
  function esc(t) { return String(t == null ? "" : t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function plural(n, a, b, c) { var m = n % 10, h = n % 100; return (m === 1 && h !== 11) ? a : (m >= 2 && m <= 4 && (h < 10 || h >= 20)) ? b : c; }
  function arNum(n) { return String(n).replace(/\d/g, function (d) { return "٠١٢٣٤٥٦٧٨٩".charAt(+d); }); }
  function ayahsW(n) { return n + " " + plural(n, "аят", "аята", "аятов"); }
  function rng(a, b) { return a === b ? String(a) : a + "–" + b; }
  function num1(x) { return (Math.round(x * 10) / 10).toString().replace(".", ","); }
  var ICON = {
    check: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    play: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>',
    pause: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/></svg>',
    close: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    prev: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h2v14H6zM20 5v14L9 12z"/></svg>',
    next: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16 5h2v14h-2zM4 5v14l11-7z"/></svg>',
    book: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20"/></svg>',
    chev: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
    mic: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
    stop: '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>',
    clock: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    cmp: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4v16M17 4v16M3 9h8M13 15h8"/></svg>'
  };
  var STAR = "M32 6 L39.4 14.1 L50.4 13.6 L49.9 24.6 L58 32 L49.9 39.4 L50.4 50.4 L39.4 49.9 L32 58 L24.6 49.9 L13.6 50.4 L14.1 39.4 L6 32 L14.1 24.6 L13.6 13.6 L24.6 14.1 Z";
  /* медальон: tf — двойная рамка, tr — золотая звезда, hz — зелёный центр, part — дуга прогресса */
  function medalSvg(tf, tr, hz, part) {
    var fullM = tf && tr && hz, g = '<svg viewBox="0 0 64 64" aria-hidden="true">';
    if (fullM) for (var i = 0; i < 8; i++) { var ang = (i * 45 + 22.5) * Math.PI / 180; g += '<circle cx="' + (32 + 29.5 * Math.cos(ang)).toFixed(2) + '" cy="' + (32 + 29.5 * Math.sin(ang)).toFixed(2) + '" r="1.6" class="m-dot"/>'; }
    if (tf) g += '<circle cx="32" cy="32" r="27" class="m-ring"/><circle cx="32" cy="32" r="24.2" class="m-ring thin"/>';
    g += '<path d="' + STAR + '" class="m-star' + (tr ? " on" : "") + '"/>';
    if (tr) g += '<path d="' + STAR + '" class="m-star-in" transform="translate(32 32) scale(0.72) translate(-32 -32)"/>';
    if (hz) g += '<circle cx="32" cy="32" r="16" class="m-core"/>';
    else if (part > 0) { var R = 15, C = 2 * Math.PI * R; g += '<circle cx="32" cy="32" r="' + R + '" class="m-track"/><circle cx="32" cy="32" r="' + R + '" class="m-arc" stroke-dasharray="' + (C * part).toFixed(1) + " " + C.toFixed(1) + '" transform="rotate(-90 32 32)"/>'; }
    return g + "</svg>";
  }
  function medal(n, size) {
    var s = state.suras[n] || {}, hz = hifz(n);
    return '<span class="medal' + (hz ? " hz" : "") + (s.tf && s.tr && hz ? " full" : "") + (size ? " " + size : "") + (n >= 100 ? " d3" : "") + '">' + medalSvg(!!s.tf, !!s.tr, hz, s.done ? doneCount(n) / count(n) : 0) + "<b>" + n + "</b></span>";
  }
  function juzMedal(j) {
    var done = juzDone(j), fl = juzFull(j), part = done ? 1 : juzPages(j, true) / juzPages(j);
    return '<span class="medal sm' + (done ? " hz" : "") + (fl ? " full" : "") + '">' + medalSvg(fl, fl, done, part) + "<b>" + (j + 1) + "</b></span>";
  }
  var toastTimer;
  function toast(t) {
    var el = document.getElementById("toast");
    el.textContent = t; el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2600);
  }
  function applyTheme() {
    var th = state && state.set.theme;
    if (th === "dark" || th === "light") document.documentElement.setAttribute("data-theme", th);
    else document.documentElement.removeAttribute("data-theme");
    if (state && state.set.ui && state.set.ui !== "md") document.documentElement.setAttribute("data-ui", state.set.ui); else document.documentElement.removeAttribute("data-ui");
    if (state && state.set.contrast) document.documentElement.setAttribute("data-contrast", "high"); else document.documentElement.removeAttribute("data-contrast");
    document.documentElement.style.setProperty("--ar-size", (state ? state.set.arSize : 30) + "px");
    document.documentElement.style.setProperty("--ru-size", (state ? state.set.ruSize : 15) + "px");
  }
  function firstLetter(w) {
    var m = w.match(/^[^ً-ٰٟۖ-ۭ][ً-ٰٟۖ-ۭٓ-ٕ]*/);
    return m ? m[0] + "ـ" : w;
  }
  function chips(name, values, current, multi) {
    return '<div class="seg" role="group">' + values.map(function (v) {
      var on = multi ? current.indexOf(v[0]) !== -1 : current === v[0];
      return '<button class="segb" data-act="set" data-k="' + name + '" data-v="' + v[0] + '" data-multi="' + (multi ? 1 : 0) + '" aria-pressed="' + on + '">' + v[1] + "</button>";
    }).join("") + "</div>";
  }
  var DAY_CHIPS = DAYS.map(function (d, i) { return [i, d]; });
  function stepChips(n) {
    var s = S(n), c = count(n), d = doneCount(n);
    function chip(key, label, on, extra) {
      return '<button class="step' + (on ? " on" : "") + '" data-act="pillar" data-k="' + key + '" data-n="' + n + '" aria-pressed="' + on + '"><i>' + (on ? ICON.check : "") + "</i>" + label + (extra ? "<span>" + extra + "</span>" : "") + "</button>";
    }
    return '<div class="steps">' + chip("tr", "Перевод", s.tr) + chip("tf", "Тафсир", s.tf) + chip("hz", "Хифз", hifz(n), hifz(n) ? "" : d + "/" + c) + "</div>";
  }
  function gradeBtns(id) {
    return '<span class="grades">' + GRADES.map(function (g) { return '<button class="gbtn ' + g[0] + '" data-act="rev" data-id="' + id + '" data-g="' + g[0] + '">' + g[1] + "</button>"; }).join("") + "</span>";
  }

  /* ---------------- отрисовка ---------------- */
  function render() {
    if (!state) return;
    if (state.setup && syncMz()) save();
    var tabs = document.querySelectorAll(".tab");
    for (var i = 0; i < tabs.length; i++) tabs[i].setAttribute("aria-current", tabs[i].getAttribute("data-tab") === (view.sura ? "suras" : view.tab) ? "page" : "false");
    var html;
    if (view.sura) html = renderSura(view.sura);
    else if (view.tab === "suras") html = renderSuras();
    else if (view.tab === "manzil") html = renderManzil();
    else if (view.tab === "settings") html = renderSettings();
    else html = renderToday();
    document.getElementById("main").innerHTML = html;
    renderOverlay();
    highlight();
    updateSticky();
  }

  function renderToday() {
    var t = today(), st = stats(), wd = weekday(t), set = state.set, sk = streak();
    var notes = [];
    if (set.ustaz.indexOf(wd) !== -1) notes.push("урок с устазом");
    if (isRest(t)) notes.push("без нового урока");
    var R = 22, C = 2 * Math.PI * R;
    var h = '<div class="hello"><div><span class="eyebrow">' + DAYS_FULL[wd] + ", " + esc(nice(t)) + (notes.length ? " · " + notes.join(" · ") : "") + "</span>" +
      "<h1>" + (set.name ? "Ас-саляму алейкум, " + esc(set.name) : "Ас-саляму алейкум") + "</h1></div>" +
      '<button class="progress" data-act="sheet" data-v="path" aria-label="Путь: прогресс и вехи"><svg viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="' + R + '" class="pr-track"/><circle cx="26" cy="26" r="' + R + '" class="pr-arc" stroke-dasharray="' + (C * Math.min(st.pct, 100) / 100).toFixed(1) + " " + C.toFixed(1) + '" transform="rotate(-90 26 26)"/></svg>' +
      "<span><b>" + num1(st.pct) + "% Корана</b><span>≈ " + (st.pages < 10 ? num1(st.pages) : Math.round(st.pages)) + " из 604 стр. · " + num1(st.pages / 20) + " джуза</span><span>" +
      st.hifz + " " + plural(st.hifz, "сура", "суры", "сур") + " наизусть" + (sk > 1 ? " · " + sk + " " + plural(sk, "день", "дня", "дней") + " подряд" : "") + "</span></span></button></div>";
    h += '<div class="day"><div class="col">' + (set.ustaz.indexOf(wd) !== -1 ? (state.journal.some(function (j) { return j.d === t; }) ? "" : ustazNote()) : set.ustaz.length ? "" : hwNote()) + sabakCard() + keepCards() + '</div><div class="col">' + manzilCard() + "</div></div>";
    return h;
  }

  function ustazNote() {
    var hj = lastHw();
    if (hj && hj.d < today()) {
      return '<div class="note-ustaz lesson"><b>Сегодня урок с устазом</b>' + hwBody(hj.hw) +
        '<button class="btn sm primary" data-act="lesson-new">Записать урок</button></div>';
    }
    var n = state.current, due = dueReviews(), items = [];
    if (n) {
      var learned = blocksOf(n).filter(function (b) { return blockDone(n, b); });
      items.push("«" + SURAS[n - 1].ru + "»" + (learned.length ? ": аяты " + learned.map(function (b) { return rng(b.s, b.e); }).join(", ") : ""));
    }
    due.forEach(function (r) { items.push(rLabel(r)); });
    var done = state.journal.some(function (j) { return j.d === today(); });
    return '<div class="note-ustaz"><div><b>Сегодня урок с устазом.</b> Подготовьте: ' + (items.length ? esc(items.join("; ")) : "выученное за неделю") + ".</div>" +
      '<button class="btn sm ' + (done ? "" : "primary") + '" data-act="lesson-new">' + (done ? "Ещё запись" : "Записать урок") + "</button></div>";
  }

  function suraBar(n, lesson) {
    var c = count(n), out = "", step = c > 140 ? Math.ceil(c / 140) : 1;
    for (var a = 1; a <= c; a += step) {
      var e = Math.min(c, a + step - 1), dn = doneCount(n, a, e) === e - a + 1, tl = lesson && e >= lesson.s && a <= lesson.e;
      out += '<i class="' + (dn ? "d" : tl ? "t" : "") + '"></i>';
    }
    return '<div class="sbar" aria-hidden="true">' + out + "</div>";
  }

  function blockMain(n, b, act, i, chev) {
    return '<button class="bmain" data-act="' + act + '" data-n="' + n + '" data-i="' + i + '"' + (chev ? ' aria-expanded="' + (view.openB === n + ":" + i) + '"' : "") + '><span class="br">' + rng(b.s, b.e) + '</span><span class="bt"><span class="bn">' + esc(b.name) + "</span>" + (b.d ? '<span class="bd">' + esc(b.d) + "</span>" : "") + "</span>" + (chev ? '<span class="chev">' + ICON.chev + "</span>" : "") + "</button>";
  }

  function sabakCard() {
    var n = state.current;
    var h = '<section class="card"><div class="card-title"><h2>Новое</h2>';
    if (!n) return h + '</div><p class="muted">Выберите суру, которую будете учить.</p><button class="btn primary" data-act="pick">Выбрать суру</button></section>';
    var x = SURAS[n - 1], s = S(n), r = range(n), bl = blocksOf(n);
    var nb = -1;
    for (var i = 0; i < bl.length; i++) if (!blockDone(n, bl[i])) { nb = i; break; }
    h += '<button class="link" data-act="pick">сменить</button></div>';
    h += '<button class="sura-line" data-act="open" data-n="' + n + '">' + medal(n, "md") + '<span class="sl-t"><b>' + esc(x.ru) + "</b><span>" + doneCount(n) + " из " + ayahsW(x.ayahs) + " · учу " + rng(r[0], r[1]) + '</span></span><span class="ar">' + esc(x.ar) + "</span></button>";
    h += suraBar(n, nb >= 0 ? bl[nb] : null);
    h += stepChips(n);
    if (!s.tr || !s.tf) h += '<p class="hint">' + (!s.tr ? "Начните со смысла: прочитайте перевод суры целиком" : "Прочитайте тафсир: о чём сура и почему ниспослана") + " — и отметьте шаг выше.</p>";
    var learnedB = bl.filter(function (b) { return blockDone(n, b); }), fold = learnedB.length >= 2 && !view.showLearned;
    h += '<ol class="blist">';
    if (fold) {
      var lr = [];
      learnedB.forEach(function (b) { var last = lr[lr.length - 1]; if (last && last[1] + 1 === b.s) last[1] = b.e; else lr.push([b.s, b.e]); });
      h += '<li class="brow done fold"><span class="tick on" aria-hidden="true">' + ICON.check + '</span><button class="bmain" data-act="show-learned"><span class="bt"><span class="bn">Выучено: аяты ' + lr.map(function (x) { return rng(x[0], x[1]); }).join(", ") + '</span><span class="bd">' + learnedB.length + " " + plural(learnedB.length, "блок", "блока", "блоков") + ' · показать</span></span></button><button class="icon" data-act="play" data-n="' + n + '" data-a="' + learnedB[0].s + '" data-b="' + learnedB[learnedB.length - 1].e + '" aria-label="Слушать выученное">' + ICON.play + "</button></li>";
    }
    h += bl.map(function (b, i) {
      if (fold && blockDone(n, b)) return "";
      return blockRow(n, b, i, bl.length, i === nb);
    }).join("") + "</ol>";
    if (learnedB.length >= 2 && view.showLearned) h += '<button class="link" data-act="show-learned">свернуть выученное</button>';
    if (nb > 0) h += '<p class="hint">Перед новым блоком прочитайте выученные подряд.</p>';
    var remS = pagesOf(n) - pagesOf(n, 1, count(n), true), j = juzOf(n, firstUndone(n) || 1), remJ = juzPages(j) - juzPages(j, true), parts = [];
    if (remS > 0.001) parts.push("сура — " + nice(finishDate(remS)));
    if (remJ > 0.001) parts.push("джуз " + (j + 1) + " — " + nice(finishDate(remJ)));
    if (parts.length) h += '<p class="forecast">При вашей норме: ' + parts.join(", ") + "</p>";
    return h + "</section>";
  }

  /* выученные суры, оставленные на главной */
  function keepCards() {
    return state.keep.filter(function (n) { return n !== state.current; }).map(function (n) {
      var x = SURAS[n - 1], op = !!view.keepOpen[n];
      var h = '<section class="card keep' + (op ? " open" : "") + '"><div class="keep-row"><button class="sura-line" data-act="keep-open" data-n="' + n + '" aria-expanded="' + op + '">' + medal(n, "md") +
        '<span class="sl-t"><b>' + esc(x.ru) + "</b><span>" + (hifz(n) ? "наизусть" : doneCount(n) + " из " + x.ayahs) + " · " + ayahsW(x.ayahs) + '</span></span><span class="chev">' + ICON.chev + "</span></button>" +
        '<button class="icon" data-act="play" data-n="' + n + '" data-a="1" data-b="' + x.ayahs + '" aria-label="Слушать суру">' + ICON.play + "</button></div>";
      if (op) { var bl = blocksOf(n); h += '<ol class="blist">' + bl.map(function (bb, i) { return blockRow(n, bb, i, bl.length, false); }).join("") + "</ol>"; }
      return h + "</section>";
    }).join("");
  }

  /* свежевыученное: повторы по интервалам — часть манзиля */
  function freshList(due) {
    var t = today();
    return '<ul class="rlist">' + due.map(function (r) {
      var late = diff(t, r.next);
      return '<li><div class="rtop"><button class="rl" data-act="read" data-n="' + r.n + '" data-a="' + r.s + '" data-b="' + r.e + '"><b>' + esc(rLabel(r)) + "</b>" + (late > 0 ? '<span class="late">просрочено на ' + late + " дн.</span>" : '<span class="muted small">текст</span>') + "</button>" +
        '<button class="icon" data-act="play" data-n="' + r.n + '" data-a="' + r.s + '" data-b="' + r.e + '" aria-label="Слушать">' + ICON.play + "</button></div>" + gradeBtns(r.id) + "</li>";
    }).join("") + "</ul>";
  }
  function nextFresh() {
    var up = state.reviews.slice().sort(function (a, b) { return a.next < b.next ? -1 : 1; })[0];
    return up ? '<p class="muted small">Следующий повтор — ' + esc(rLabel(up)) + ", " + esc(niceShort(up.next)).replace(/\.$/, "") + ".</p>" : "";
  }
  function weakLine() {
    return state.weak.length ? '<button class="weak-line" data-act="sheet" data-v="weak"><span>Слабые места</span><b>' + state.weak.length + "</b>" + ICON.chev + "</button>" : "";
  }
  function manzilCard() {
    var parts = manzilParts(), ci = cycleInfo(), t = today(), due = dueReviews();
    var h = '<section class="card"><div class="card-title"><h2>Манзиль</h2><button class="link" data-act="quiz">проверить себя</button></div>';
    if (!parts.length && !due.length) return h + '<p class="muted">Когда выучите первый отрывок, он появится здесь.</p>' + weakLine() + "</section>";
    if (due.length) h += '<p class="sub">Свежее · по интервалам <span class="count">' + due.length + "</span></p>" + freshList(due);
    if (parts.length) {
      var p = parts[ci.idx], doneT = !!state.manzil[t], miss = missedYesterday(parts), carried = state.carry[t];
      h += '<p class="sub">' + esc(dayName(t, ci.idx)) + (p ? " · ≈ " + num1(p.pages) + " стр." : "") + "</p>";
      if (p && p.rs) h += '<p class="muted small hz-l">' + esc(partLabel(p)) + "</p>";
      if (miss) {
        h += '<div class="miss"><span>Вчерашняя часть манзиля не отмечена.</span><div class="miss-btns"><button class="btn sm" data-act="m-carry" data-d="' + miss.d + '">Добавить к сегодня</button><button class="btn sm" data-act="m-shift">Сдвинуть круг</button>' +
          '<button class="link" data-act="m-did" data-d="' + miss.d + '">я прочитал</button><button class="link muted" data-act="m-skip" data-d="' + miss.d + '">пропустить</button></div></div>';
      }
      var list = function (pp, d) { return '<ul class="mlist">' + pp.items.map(function (it) {
        var dn = itemDone(d, it);
        return '<li class="' + (dn ? "done" : "") + '"><button class="tick sm' + (dn ? " on" : "") + '" data-act="m-item" data-d="' + d + '" data-k="' + itemKey(it) + '" aria-label="Отметить: ' + esc(itemLabel(it)) + '" aria-pressed="' + dn + '">' + ICON.check + '</button><button class="mitem" data-act="read" data-n="' + it.n + '" data-a="' + it.s + '" data-b="' + it.e + '"><span class="ar">' + esc(SURAS[it.n - 1].ar) + "</span><span>" + esc(itemLabel(it)) + '</span><span class="mopen">текст</span></button><button class="icon" data-act="play" data-n="' + it.n + '" data-a="' + it.s + '" data-b="' + it.e + '" aria-label="Слушать">' + ICON.play + "</button></li>";
      }).join("") + "</ul>"; };
      if (carried) {
        var cp = parts[cycleInfo(carried).idx];
        if (cp && !state.manzil[carried]) h += '<p class="muted small">Со вчера:</p>' + list(cp, carried) + '<p class="muted small">Сегодня:</p>';
      }
      h += p ? list(p, t) : '<p class="muted">Свободный день: повторите слабые места.</p>';
      h += '<button class="btn ' + (doneT ? "done-btn" : "primary") + ' wide" data-act="manzil" data-d="' + t + '">' + (doneT ? ICON.check + " Прочитан" : "Отметить прочитанным") + "</button>";
      h += '<div class="week">';
      for (var i = 0; i < Math.min(ci.cyc, 14); i++) { var dd = addDays(ci.start, i); h += '<i class="' + (state.manzil[dd] ? "on" : "") + (dd === t ? " now" : "") + '" title="' + esc(dayName(dd, i)) + '"></i>'; }
      h += "</div>";
    }
    if (!due.length) h += nextFresh();
    return h + weakLine() + "</section>";
  }

  function suraCard(x) {
    var dc = doneCount(x.n);
    return '<button class="sura" data-act="open" data-n="' + x.n + '">' + medal(x.n) + '<span class="st"><b>' + esc(x.ru) + "</b><span>" + (hifz(x.n) ? (full(x.n) ? "заучена полностью" : "наизусть") : dc ? dc + " из " + x.ayahs : ayahsW(x.ayahs)) + '</span></span><span class="ar">' + esc(x.ar) + "</span></button>";
  }
  function suraPass(x) {
    var f = view.filter, s = state.suras[x.n], hz = hifz(x.n), any = s && (s.tr || s.tf || doneCount(x.n) > 0);
    if (f === "hifz" && !hz) return false;
    if (f === "learning" && (hz || !any)) return false;
    if (f === "none" && any) return false;
    return true;
  }
  function renderSuras() {
    var q = view.q.trim(), ql = q.toLowerCase();
    var ch = [["all", "Все"], ["hifz", "Наизусть"], ["learning", "Учу"], ["none", "Не начаты"]];
    var h = '<div class="page-head"><h1>Суры</h1><p class="muted small">Медальон растёт с каждым шагом: тафсир — рамка, перевод — звезда, хифз — зелёный центр.</p></div>';
    h += '<div class="filters"><input class="search" id="q" type="search" placeholder="Сура или слово из текста" value="' + esc(view.q) + '">' +
      ch.map(function (c) { return '<button class="chip" data-act="filter" data-f="' + c[0] + '" aria-pressed="' + (view.filter === c[0]) + '">' + c[1] + "</button>"; }).join("") + "</div>";
    if (!q) h += '<div class="viewbar">' + chips("suraMode", [["juz", "Джузы"], ["suras", "Суры"], ["hizb", "Хизбы"]], state.set.suraMode) +
      '<button class="sortbtn" data-act="set" data-k="suraSort" data-v="' + (state.set.suraSort === "asc" ? "desc" : "asc") + '" aria-label="Порядок">' + (state.set.suraSort === "asc" ? "1 → 114" : "114 → 1") + "</button></div>";
    if (q) {
      var list = SURAS.filter(function (x) { return suraPass(x) && (x.ru.toLowerCase().indexOf(ql) !== -1 || String(x.n) === q || x.ar.indexOf(q) !== -1); });
      if (list.length) h += '<div class="suras">' + list.map(suraCard).join("") + "</div>";
      var res = searchAyahs(q);
      if (res.total) {
        h += '<h2 class="sec">Аяты · найдено ' + res.total + (res.total > res.hits.length ? ", показаны первые " + res.hits.length : "") + '</h2><ul class="hits">' + res.hits.map(function (hh) {
          var r = rows(hh[0])[hh[1] - 1];
          return '<li><button data-act="read-hit" data-n="' + hh[0] + '" data-a="' + hh[1] + '"><span class="hl">' + esc(SURAS[hh[0] - 1].ru) + " · " + hh[1] + "</span>" +
            (res.ar ? '<span class="ha" dir="rtl" lang="ar">' + esc(r[0]) + "</span>" : '<span class="ht">' + snippet(r[1], res.q) + "</span>") + "</button></li>";
        }).join("") + "</ul>";
      }
      if (!list.length && !res.total) h += '<p class="muted center">Ничего не найдено</p>';
      return h;
    }
    var mode = state.set.suraMode, desc = state.set.suraSort !== "asc";
    var order = function (len) { var a = []; for (var z = 0; z < len; z++) a.push(desc ? len - 1 - z : z); return a; };
    if (mode === "suras") {
      var flat = SURAS.filter(suraPass);
      if (desc) flat = flat.slice().reverse();
      return h + (flat.length ? '<div class="suras">' + flat.map(suraCard).join("") + "</div>" : '<p class="muted center">Ничего не найдено</p>');
    }
    if (view.jopen === null) { view.jopen = {}; view.jopen["j" + (state.current ? juzOf(state.current, 1) : 29)] = true; view.jopen["h" + (state.current ? Math.floor(rubOf(state.current, firstUndone(state.current) || 1) / 4) : 59)] = true; }
    if (mode === "hizb") {
      order(60).forEach(function (hz) {
        var rs = [hz * 4, hz * 4 + 1, hz * 4 + 2, hz * 4 + 3], segs = [];
        rs.forEach(function (r) { segs = segs.concat(rubSegs(r)); });
        var tot = segPages(segs), dn = segPages(segs, true), open = !!view.jopen["h" + hz];
        if (view.filter !== "all") {
          var any = segs.some(function (sg) { return suraPass(SURAS[sg[0] - 1]); });
          if (!any) return;
        }
        h += '<section class="juz' + (open ? " open" : "") + '"><button class="jhead" data-act="jtoggle" data-j="h' + hz + '" aria-expanded="' + open + '"><span class="hnum' + (dn >= tot - 0.001 ? " on" : "") + '">' + (hz + 1) + '</span><span class="jt"><b>Хизб ' + (hz + 1) + "</b><span>джуз " + (Math.floor(hz / 2) + 1) + " · " + esc(SURAS[RUB[hz * 4][0] - 1].ru) + " " + RUB[hz * 4][1] + " · " + num1(dn) + " из " + num1(tot) + ' стр.</span><span class="jbar"><i style="width:' + Math.min(100, dn / tot * 100).toFixed(1) + '%"></i></span></span><span class="chev">' + ICON.chev + "</span></button>";
        if (open) {
          h += '<ul class="rubs">' + rs.map(function (r) {
            var sg = rubSegs(r), t2 = segPages(sg), d2 = segPages(sg, true);
            return '<li><span class="rq">' + (r % 4 ? QNAME[r % 4] : "۞") + '</span><span class="rsegs">' + sg.map(function (x) {
              return '<button class="link plain" data-act="read" data-n="' + x[0] + '" data-a="' + x[1] + '" data-b="' + x[2] + '">' + esc(SURAS[x[0] - 1].ru) + " " + rng(x[1], x[2]) + "</button>";
            }).join(", ") + '</span><span class="rp' + (d2 >= t2 - 0.001 ? " on" : "") + '">' + Math.round(d2 / t2 * 100) + "%</span></li>";
          }).join("") + "</ul>";
        }
        h += "</section>";
      });
      return h;
    }
    order(30).forEach(function (j) {
      var su = SURAS.filter(function (x) { return juzOf(x.n, 1) === j && suraPass(x); });
      if (desc) su = su.reverse();
      var cont = juzSegs(j).filter(function (sg) { return sg[1] > 1; })[0];
      if (!su.length && view.filter !== "all") return;
      var tot = juzPages(j), dn = juzPages(j, true), open = !!view.jopen["j" + j];
      h += '<section class="juz' + (open ? " open" : "") + '"><button class="jhead" data-act="jtoggle" data-j="j' + j + '" aria-expanded="' + open + '">' + juzMedal(j) +
        '<span class="jt"><b>Джуз ' + (j + 1) + "</b><span>" + esc(SURAS[JUZ[j][0] - 1].ru) + (JUZ[j][1] > 1 ? " " + JUZ[j][1] : "") + " · " + num1(dn) + " из " + Math.round(tot) + ' стр.</span><span class="jbar"><i style="width:' + Math.min(100, dn / tot * 100).toFixed(1) + '%"></i></span></span><span class="chev">' + ICON.chev + "</span></button>";
      if (open) {
        if (cont && view.filter === "all") h += '<p class="muted small jcont">Начинается с продолжения суры «' + esc(SURAS[cont[0] - 1].ru) + "», аяты " + rng(cont[1], cont[2]) + "</p>";
        h += su.length ? '<div class="suras">' + su.map(suraCard).join("") + "</div>" : "";
      }
      h += "</section>";
    });
    return h;
  }

  function wordsHtml(ar, k, hint) {
    var idx = 0;
    return ar.split(" ").map(function (w) {
      if (!w.replace(STOPS, "").length) return esc(w);
      var hid = k && (k === 1 || idx % k === k - 1);
      idx++;
      if (hid) return '<span class="hw" data-act="peek">' + esc(w) + "</span>";
      return esc(hint ? firstLetter(w) : w);
    }).join(" ");
  }
  function partialWords(ar, w) {
    var out = [], c = 0;
    ar.split(" ").forEach(function (x) { if (c >= w) return; out.push(x); if (x.replace(STOPS, "").length) c++; });
    return out.join(" ");
  }
  function wordCount(ar) { return ar.split(" ").filter(function (x) { return x.replace(STOPS, "").length; }).length; }
  function ayahHtml(n, a, opts) {
    var r = rows(n)[a - 1], key = n + ":" + a, dn = isDone(n, a), wc = wordCount(r[0]);
    var rev = opts.check ? Math.min(view.wordRev[key] || 0, wc) : wc, hidden = opts.check && rev < wc;
    var arHtml;
    if (hidden) arHtml = rev ? '<div class="a" lang="ar" dir="rtl">' + esc(partialWords(r[0], rev)) + ' <span class="more">…</span></div>' : '<div class="a hidden-ar">﴿' + arNum(a) + "﴾</div>";
    else arHtml = '<div class="a" lang="ar" dir="rtl">' + wordsHtml(r[0], opts.k || 0, opts.hint) + ' <span class="no">﴿' + arNum(a) + "﴾</span></div>";
    var recOn = rec.on === key;
    var peek = hidden ? '<span class="peekbtns"><button class="wbtn" data-act="word-next" data-n="' + n + '" data-a="' + a + '" aria-label="Открыть следующее слово аята ' + a + '">+ слово</button><button class="wbtn" data-act="word-all" data-n="' + n + '" data-a="' + a + '" aria-label="Открыть аят ' + a + '">аят</button></span>' : "";
    return '<div class="ayah' + (opts.hl === a ? " hl" : "") + (hidden ? " closed" : "") + '" id="ay-' + n + "-" + a + '">' + arHtml +
      (hidden ? "" : '<div class="t">' + esc(r[1]) + "</div>") +
      '<div class="ay-tools"><button class="ay-n' + (dn ? " on" : "") + '" data-act="ayah-toggle" data-n="' + n + '" data-a="' + a + '" aria-pressed="' + dn + '" aria-label="Аят ' + a + (dn ? ": выучен" : ": отметить выученным") + '">' + (dn ? ICON.check : "") + a + "</button>" + peek +
      '<button class="icon sm' + (recOn ? " rec" : "") + '" data-act="' + (recOn ? "rec-stop" : "rec") + '" data-n="' + n + '" data-a="' + a + '" aria-label="' + (recOn ? "Остановить запись" : "Записать своё чтение") + '">' + (recOn ? ICON.stop : ICON.mic) + "</button>" +
      (rec.urls[key] && !recOn ? '<button class="icon sm" data-act="rec-cmp" data-n="' + n + '" data-a="' + a + '" aria-label="Сравнить с чтецом">' + ICON.cmp + "</button>" : "") +
      '<button class="icon sm" data-act="play" data-n="' + n + '" data-a="' + a + '" data-b="' + a + '" aria-label="Слушать аят ' + a + '">' + ICON.play + '</button><button class="icon sm" data-act="tafsir" data-n="' + n + '" data-a="' + a + '" aria-label="Тафсир аята ' + a + '">' + ICON.book + "</button></div></div>";
  }

  function renderSura(n) {
    var x = SURAS[n - 1], s = S(n), bl = blocksOf(n), r = range(n), c = x.ayahs, d = doneCount(n);
    var h = '<div class="stickhead" id="stickhead" aria-hidden="true"><b>' + esc(x.ru) + '</b><span id="stick-b"></span></div>';
    h += '<div class="narrow"><button class="back" data-act="back">← Суры</button>';
    h += '<div class="detail-head">' + medal(n, "xl") + '<div class="dh-t"><h1>' + esc(x.ru) + '</h1><span class="muted small">' + ayahsW(c) + " · " + (x.medinan ? "мединская" : "мекканская") + " · джуз " + (juzOf(n, 1) + 1) + " · ≈ " + num1(pagesOf(n)) + ' стр.</span></div><span class="ar">' + esc(x.ar) + "</span></div>";
    h += stepChips(n);
    if (state.current !== n && !hifz(n)) h += '<button class="btn primary wide" data-act="set-current" data-n="' + n + '">Учить эту суру</button>';
    h += aboutHtml(n);

    var plain = !!view.plain[n];
    h += '<section class="card"><div class="card-title"><div class="seg mode-sw" role="group" aria-label="Вид суры"><button class="segb" data-act="sura-mode" data-n="' + n + '" data-v="0" aria-pressed="' + !plain + '">Блоки</button><button class="segb" data-act="sura-mode" data-n="' + n + '" data-v="1" aria-pressed="' + plain + '">Текст</button></div><span class="muted small">' + d + " из " + c + " выучено</span></div>";
    if (plain) h += plainHtml(n);
    else {
      h += '<div class="range-line"><span>Блоки по аятам <b>' + rng(r[0], r[1]) + "</b></span>" + (view.rangeEdit ? "" : '<button class="link" data-act="range-edit" data-n="' + n + '">разделить на блоки</button>') + "</div>";
      if (view.rangeEdit && view.split) h += splitHtml(n);
      h += suraBar(n, null);
      h += '<ol class="blist">' + bl.map(function (b, i) { return blockRow(n, b, i, bl.length); }).join("") + "</ol>";
      h += '<div class="foot-links"><button class="link" data-act="reset-blocks" data-n="' + n + '">Пересчитать блоки</button>' + (s.bsrc === "custom" ? '<span class="muted small">есть ваши правки</span>' : "") +
        (hifz(n) ? '<button class="link" data-act="keep" data-n="' + n + '">' + (state.keep.indexOf(n) !== -1 ? "убрать с главной" : "показывать на главной") + "</button>" : "") + "</div>";
    }
    h += "</section>";

    var mine = state.reviews.filter(function (q) { return q.n === n; });
    if (mine.length) {
      var iv = intervals();
      h += '<section class="card"><div class="card-title"><h2>Закрепление</h2><span class="muted small">до входа в манзиль</span></div>' + mine.map(function (q) {
        var dots = [0].concat(iv).map(function (v, k) { return '<i class="' + (k <= q.stage ? "on" : k === q.stage + 1 ? "now" : "") + '" title="' + (k ? "+" + v + " дн." : "выучено") + '"></i>'; }).join("");
        return '<div class="rev"><div><b>Аяты ' + rng(q.s, q.e) + '</b><span class="muted small">следующий — ' + esc(nice(q.next)) + '</span><div class="dots">' + dots + "</div></div>" + (q.next <= today() ? gradeBtns(q.id) : "") + "</div>";
      }).join("") + "</section>";
    }
    var lessons = state.journal.filter(function (j) { return jItems(j).some(function (x) { return x.n === n; }); });
    h += '<section class="card"><div class="card-title"><h2>Конспект</h2><button class="link" data-act="tafsir" data-n="' + n + '" data-a="' + r[0] + '">тафсир Ибн Касира</button></div><textarea class="note" id="note-' + n + '" data-n="' + n + '" placeholder="О чём сура, главные мысли тафсира…">' + esc(s.note) + "</textarea>" +
      (lessons.length ? '<div class="jlist">' + lessons.slice(0, 5).map(lessonRow).join("") + "</div>" : "") + "</section>";
    h += '<div class="foot-links">' + (view.confirm === "sura" + n ? '<span class="warn-t">Сбросить прогресс суры?</span><button class="link warn" data-act="reset-sura" data-n="' + n + '">да, сбросить</button><button class="link" data-act="cancel">отмена</button>'
      : '<button class="link muted" data-act="ask" data-what="sura' + n + '">Сбросить прогресс суры</button>') + "</div>";
    return h + "</div>";
  }

  /* сура обычным текстом: арабский и перевод подряд, без блоков */
  function plainHtml(n) {
    var c = count(n), rs = rows(n), h = '<div class="plain-tools"><button class="tool" data-act="play" data-n="' + n + '" data-a="1" data-b="' + c + '">' + ICON.play + ' Слушать суру</button></div><div class="plain">';
    for (var a = 1; a <= c; a++) {
      h += '<div class="pa' + (isDone(n, a) ? " dn" : "") + '" id="ay-' + n + "-" + a + '"><div class="a" lang="ar" dir="rtl">' + esc(rs[a - 1][0]) + ' <span class="no">﴿' + arNum(a) + "﴾</span></div>" +
        '<div class="t"><b>' + a + ".</b> " + esc(rs[a - 1][1]) + "</div></div>";
    }
    return h + "</div>";
  }
  /* деление всей суры или её части на блоки */
  function splitHtml(n) {
    var sp = view.split, c = count(n);
    return '<div class="split"><div class="split-row"><label>с аята <input type="number" id="sp-a" min="1" max="' + c + '" value="' + sp.a + '"></label><label>по <input type="number" id="sp-b" min="1" max="' + c + '" value="' + sp.b + '"></label>' +
      '<button class="link" data-act="split-all" data-n="' + n + '">вся сура</button></div>' +
      '<div class="split-row"><div class="seg" role="group" aria-label="Как делить"><button class="segb" data-act="split-m" data-n="' + n + '" data-v="auto" aria-pressed="' + (sp.m === "auto") + '">По смыслу</button><button class="segb" data-act="split-m" data-n="' + n + '" data-v="eq" aria-pressed="' + (sp.m === "eq") + '">Поровну</button></div>' +
      (sp.m === "eq" ? '<label>по <input type="number" id="sp-k" min="1" max="40" value="' + sp.k + '"> аятов</label>' : "") + "</div>" +
      '<div class="split-btns"><button class="btn sm primary" data-act="split-go" data-n="' + n + '">Разделить</button><button class="link" data-act="know-range" data-n="' + n + '">уже знаю эти аяты</button><button class="link muted" data-act="cancel-split">отмена</button></div></div>';
  }

  var MECCAN_RANK = (function () {
    var mec = SURAS.filter(function (x) { return !/един/i.test(Q.suras[x.n - 1].type || ""); }).map(function (x) { return x.n; });
    mec.sort(function (a, b) { return ORDER[a - 1] - ORDER[b - 1]; });
    var out = {}; mec.forEach(function (n, i) { out[n] = i + 1; }); return out;
  })();
  function aboutHtml(n) {
    if (!ORDER.length) return "";
    var type = Q.suras[n - 1].type || (SURAS[n - 1].medinan ? "Мединская" : "Мекканская"), rank = MECCAN_RANK[n], period = "";
    if (rank) period = rank <= 48 ? "ранний мекканский период" : rank <= 69 ? "средний мекканский период" : "поздний мекканский период";
    else period = "мединский период";
    return '<section class="card about"><div class="card-title"><h2>О суре</h2><span class="muted small">' + ORDER[n - 1] + "-я по порядку ниспослания</span></div>" +
      '<p><b>' + esc(type) + "</b> · " + period + (rank ? ' <span class="muted small">(условно)</span>' : "") + "</p>" +
      (ASBAB[n] ? "<p>" + esc(ASBAB[n]) + "</p>" : '<p class="muted small">Подробнее об обстоятельствах ниспослания — в тафсире Ибн Касира.</p>') + "</section>";
  }
  function blockRow(n, b, i, total, cur) {
    var key = n + ":" + i, open = view.openB === key, dn = blockDone(n, b);
    var h = '<li class="brow' + (dn ? " done" : "") + (cur ? " cur" : "") + (open ? " open" : "") + '"><button class="tick' + (dn ? " on" : "") + '" data-act="block-toggle" data-n="' + n + '" data-i="' + i + '" aria-label="' + (dn ? "Снять отметку" : "Отметить выученным") + '">' + ICON.check + "</button>" + blockMain(n, b, "toggle-block", i, true);
    if (open) {
      var chk = view.check[key], hint = view.hint[key], lvl = view.hide[key] || 0, edit = view.edit === key;
      h += '<div class="bbody"><div class="btools">' +
        '<button class="tool" data-act="play-block" data-n="' + n + '" data-i="' + i + '">' + ICON.play + " Слушать</button>" +
        '<button class="tool" data-act="check-mode" data-n="' + n + '" data-i="' + i + '" aria-pressed="' + !!chk + '">Проверка</button>' +
        '<button class="tool" data-act="hide-mode" data-n="' + n + '" data-i="' + i + '" aria-pressed="' + !!lvl + '">Скрытие' + (lvl ? " " + HIDE_LABEL[lvl] : "") + "</button>" +
        '<button class="tool" data-act="hint-mode" data-n="' + n + '" data-i="' + i + '" aria-pressed="' + !!hint + '">Первые буквы</button>' +
        '<button class="tool" data-act="tafsir" data-n="' + n + '" data-a="' + b.s + '" data-b="' + b.e + '">Тафсир</button></div>';
      if (b.e > b.s) {
        var anc = [];
        for (var aa = b.s; aa <= b.e; aa++) anc.push('<button class="anc' + (isDone(n, aa) ? " done" : "") + '" data-act="goto-ayah" data-n="' + n + '" data-a="' + aa + '" lang="ar"><sup>' + arNum(aa) + "</sup>" + esc(anchorOf(n, aa)) + "</button>");
        h += '<div class="route" dir="rtl" aria-label="Якоря аятов">' + anc.join('<span class="sep">·</span>') + "</div>";
      }
      if (lvl) h += '<p class="muted small">Скрыто ' + (lvl === 4 ? "всё" : "каждое " + ["", "пятое", "третье", "второе"][lvl] + " слово") + ". Нажмите на пропуск, чтобы подсмотреть; нажмите «Скрытие» ещё раз — скрыть больше.</p>";
      if (edit) {
        h += '<div class="bedit"><label class="full">Название<input type="text" class="bname" id="bn-' + n + "-" + i + '" data-n="' + n + '" data-i="' + i + '" value="' + esc(b.name) + '"></label>' +
          '<label>С аята<input type="number" class="bnum" id="bs-' + n + "-" + i + '" data-n="' + n + '" data-i="' + i + '" data-f="s" value="' + b.s + '"' + (i === 0 ? " disabled" : "") + "></label>" +
          '<label>По аят<input type="number" class="bnum" id="be-' + n + "-" + i + '" data-n="' + n + '" data-i="' + i + '" data-f="e" value="' + b.e + '"' + (i === total - 1 ? " disabled" : "") + "></label>" +
          '<label>Аятов<input type="number" class="bnum" id="bl-' + n + "-" + i + '" data-n="' + n + '" data-i="' + i + '" data-f="len" min="1" value="' + (b.e - b.s + 1) + '"' + (i === total - 1 ? " disabled" : "") + "></label>" +
          '<div class="full anc-edit"><span>Якоря аятов — слово, по которому вспоминается аят</span><div class="anc-grid">' + (function () { var o = ""; for (var ea = b.s; ea <= b.e; ea++) o += '<label><span>' + ea + '</span><input type="text" class="banchor" id="ba-' + n + "-" + ea + '" data-n="' + n + '" data-s="' + ea + '" dir="rtl" lang="ar" value="' + esc(anchorOf(n, ea)) + '"></label>'; return o; })() + "</div></div>" +
          '<div class="bedit-btns">' + (b.e > b.s ? '<button class="btn sm" data-act="split" data-n="' + n + '" data-i="' + i + '">Разделить</button>' : "") +
          (i < total - 1 ? '<button class="btn sm" data-act="merge" data-n="' + n + '" data-i="' + i + '">Объединить со следующим</button>' : "") + "</div></div>";
      }
      if (chk) h += '<p class="muted small">Читайте по памяти. Застряли — «+ слово» откроет одно слово аята, «аят» — весь аят.</p>';
      h += '<div class="text">';
      for (var a = b.s; a <= b.e; a++) h += ayahHtml(n, a, { check: !!chk, hint: !!hint, k: HIDE[lvl] });
      if (chk) h += '<div class="row center"><button class="link" data-act="check-all" data-n="' + n + '" data-i="' + i + '">открыть все</button><button class="link" data-act="check-reset" data-n="' + n + '" data-i="' + i + '">скрыть снова</button></div>';
      if (!chk && !lvl && !hint) h += '<p class="muted small">Нажмите на номер аята, чтобы отметить его выученным, — большой блок можно учить по частям.</p>';
      h += "</div>";
      var dl = view.dl[key];
      if (swActive()) checkDownloaded(n, b, key);
      h += '<div class="foot-links"><button class="link" data-act="edit-block" data-n="' + n + '" data-i="' + i + '">' + (edit ? "готово" : "изменить блок") + "</button>" +
        (swActive() ? (dl ? '<span class="muted small">' + ICON.check + " аудио без интернета</span>" : '<button class="link" data-act="dl-block" data-n="' + n + '" data-i="' + i + '">скачать аудио</button>') : "") + "</div></div>";
    }
    return h + "</li>";
  }

  function renderManzil() {
    var parts = manzilParts(), ci = cycleInfo(), t = today();
    var total = parts.reduce(function (a, p) { return a + p.pages; }, 0);
    var h = '<div class="page-head"><h1>Манзиль</h1><p class="muted small">Всё выученное (≈ ' + num1(total) + " стр.) разделено на " + ci.cyc + (state.set.manzilMode === "hizb" ? " частей по четвертям хизбов" : " частей, близких по объёму") + ". Отмечайте суры по отдельности или весь день. Аль-Фатиха не входит — её читают в каждом намазе.</p>" +
      chips("manzilMode", [["volume", "По объёму"], ["hizb", "По хизбам"]], state.set.manzilMode) + "</div>";
    var due = dueReviews();
    h += '<section class="card fresh"><div class="card-title"><h2>Свежее</h2><button class="link" data-act="quiz">проверить себя</button></div>' +
      '<p class="muted small">Недавно выученное · через ' + intervals().join(", ") + " дн.</p>" +
      (due.length ? freshList(due) : nextFresh() || '<p class="muted small">Свежих повторов нет.</p>') + weakLine() + "</section>";
    h += mzWaitHtml();
    if (!parts.length) return h + '<p class="muted">Пока нечего повторять.</p>';
    h += '<div class="manzil-grid">';
    for (var i = 0; i < ci.cyc; i++) {
      var p = parts[i], dd = addDays(ci.start, i), dn = !!state.manzil[dd];
      h += '<div class="mday' + (dd === t ? " today" : "") + (dn ? " done" : "") + '"><div class="md-head"><div><b>' + esc(dayName(dd, i)) + '</b><span class="muted small">' + esc(niceShort(dd)) + (p ? " · ≈ " + num1(p.pages) + " стр." : "") + "</span></div>" +
        '<button class="tick lg' + (dn ? " on" : "") + '" data-act="manzil" data-d="' + dd + '" aria-label="' + esc(dayName(dd, i)) + ': повторено" aria-pressed="' + dn + '">' + ICON.check + "</button></div>";
      if (p && p.r0 !== undefined) h += '<span class="muted small">' + esc(partLabel(p)) + "</span>";
      if (p) h += '<ul class="mdl">' + p.items.map(function (it) {
        var idn = itemDone(dd, it);
        return '<li class="' + (idn ? "done" : "") + '"><button class="tick xs' + (idn ? " on" : "") + '" data-act="m-item" data-d="' + dd + '" data-k="' + itemKey(it) + '" aria-label="Отметить: ' + esc(itemLabel(it)) + '">' + ICON.check + '</button><button class="link plain" data-act="read" data-n="' + it.n + '" data-a="' + it.s + '" data-b="' + it.e + '">' + esc(itemLabel(it)) + "</button></li>";
      }).join("") + "</ul>";
      else h += '<p class="muted small">Свободный день</p>';
      h += "</div>";
    }
    return h + "</div>";
  }

  function reciterList(cur) {
    return '<div class="reciters">' + RECITERS.map(function (r) {
      return '<button class="rcard" data-act="set" data-k="reciter" data-v="' + r.id + '" aria-pressed="' + (cur === r.id) + '"><i></i><span><b>' + esc(r.name) + "</b>" + (r.note ? "<em>" + esc(r.note) + "</em>" : "") + "</span></button>";
    }).join("") + "</div>";
  }
  function slider(k, label, min, max, step, val) {
    return '<div class="field"><div class="fl"><label for="sl-' + k + '">' + label + '</label><output id="out-' + k + '">' + FMT[k](val) + '</output></div><input type="range" id="sl-' + k + '" data-k="' + k + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '"></div>';
  }
  var FMT = {
    speed: function (v) { return (+v).toFixed(2).replace(/0$/, "") + "×"; }, ayahRep: function (v) { return v + " " + plural(+v, "раз", "раза", "раз"); },
    blockRep: function (v) { return v + " " + plural(+v, "раз", "раза", "раз"); }, pause: function (v) { return v + " с"; },
    arSize: function (v) { return v + " px"; }, ruSize: function (v) { return v + " px"; }
  };

  function renderSettings() {
    var s = state.set, sample = rows(1)[1];
    var h = '<div class="narrow"><div class="page-head"><h1>Настройки</h1></div>';
    h += '<section class="card"><h2>Аудио</h2>' + reciterList(s.reciter) +
      slider("speed", "Скорость", 0.75, 1.25, 0.05, s.speed) + slider("ayahRep", "Повтор аята", 1, 10, 1, s.ayahRep) +
      slider("blockRep", "Повтор блока", 1, 10, 1, s.blockRep) + slider("pause", "Пауза между повторами", 1, 5, 1, s.pause) +
      '<label class="switch"><input type="checkbox" id="st-listen"' + (s.listen ? " checked" : "") + '><span>Слушай и повторяй<em>после аята — пауза такой же длины, чтобы прочитать самому</em></span></label></section>';
    h += '<section class="card"><h2>Текст</h2>' + slider("arSize", "Арабский", 20, 48, 1, s.arSize) + slider("ruSize", "Перевод", 12, 22, 1, s.ruSize) +
      '<div class="ayah preview"><div class="a" lang="ar" dir="rtl">' + esc(sample[0]) + ' <span class="no">﴿٢﴾</span></div><div class="t">' + esc(sample[1]) + "</div></div>" +
      '<div class="field"><label>Тема</label>' + chips("theme", [["system", "Системная"], ["light", "Светлая"], ["dark", "Тёмная"]], s.theme || "system") + "</div>" +
      '<div class="field"><label>Размер кнопок и текста</label>' + chips("ui", [["md", "Обычный"], ["lg", "Крупный"], ["xl", "Очень крупный"]], s.ui) + "</div>" +
      '<label class="switch"><input type="checkbox" id="st-contrast"' + (s.contrast ? " checked" : "") + '><span>Высокий контраст<em>более тёмный текст и чёткие границы — легче читать</em></span></label></section>';
    h += '<section class="card"><h2>Заучивание</h2>' +
      '<div class="field"><label>Новое в день</label>' + chips("norm", NORMS, s.norm) + "</div>" +
      '<div class="field"><label>Размер блока</label>' + chips("blockSize", SIZES, s.blockSize) + '<span class="muted small">Для сур с тематическим делением блоки задаются темами.</span></div>' +
      '<div class="field"><label>Направление</label>' + chips("direction", [["end", "С конца Корана"], ["start", "С начала"]], s.direction) + "</div>" +
      '<div class="field"><label for="st-iv">Интервалы для свежевыученного, дни</label><div class="inline"><input type="text" id="st-iv" value="' + intervals().join(", ") + '"><button class="btn sm" data-act="save-iv">Сохранить</button></div><span class="muted small">Свежее повторяется в манзиле по этим интервалам. «Легко» перескакивает ступень, «С запинками» повторяет интервал, «Забыл» — завтра.</span></div></section>';
    h += '<section class="card"><h2>Расписание</h2>' +
      '<div class="field"><label>Уроки с устазом</label>' + chips("ustaz", DAY_CHIPS, s.ustaz, true) + "</div>" +
      '<button class="weak-line" data-act="sheet" data-v="journal"><span>Журнал уроков</span><b>' + state.journal.length + "</b>" + ICON.chev + "</button>" +
      '<div class="field"><label>Без нового урока</label>' + chips("rest", DAY_CHIPS, s.rest, true) + "</div>" +
      '<div class="field"><label>Круг манзиля</label>' + chips("cycle", [[7, "7 дней"], [10, "10 дней"], [14, "14 дней"]], s.cycle) + "</div>" +
      '<div class="field"><label>Деление манзиля</label>' + chips("manzilMode", [["volume", "По объёму"], ["hizb", "По хизбам"]], s.manzilMode) + '<span class="muted small">«По хизбам» — дни начинаются и заканчиваются на метках четвертей хизба (۞), привычных хафизам.</span></div>' +
      (s.cycle === 7 ? '<div class="field"><label>Неделя начинается с</label>' + chips("weekStart", [[0, "Пн"], [5, "Сб"], [6, "Вс"]], s.weekStart) + "</div>"
        : '<div class="field"><label>Начало круга</label><div class="inline"><span class="muted">' + esc(nice(cycleInfo().start)) + '</span><button class="link" data-act="anchor">начать сегодня</button></div></div>') + "</section>";
    h += '<section class="card"><h2>Приложение</h2>' +
      (installEvt ? '<button class="btn primary" data-act="install">Установить на телефон</button>' : '<p class="muted small">Установить как приложение: в браузере на телефоне — меню → «Добавить на главный экран» (на iPhone: «Поделиться» → «На экран „Домой“»).</p>') +
      '<p class="muted small" id="offline-info">' + (swActive() ? "Работает без интернета: текст, перевод, блоки и повторы. Аудио блока можно скачать в карточке суры." : "Работа без интернета включается, когда приложение открыто с сайта (GitHub Pages) или через server.py.") + "</p>" +
      (swActive() ? '<button class="link" data-act="clear-audio">Удалить скачанное аудио</button>' : "") + "</section>";
    h += '<section class="card"><h2>Профиль и данные</h2><div class="field"><label for="st-name">Имя</label><input type="text" id="st-name" value="' + esc(s.name) + '" placeholder="Как к вам обращаться"></div>' +
      '<p class="muted small">' + (mode === "server" ? "Прогресс хранится в файле data/progress.json." : "Прогресс хранится в этом браузере. Сохраняйте резервную копию.") + "</p>" +
      '<details class="backup"><summary>Резервная копия</summary><textarea id="bk" spellcheck="false">' + esc(JSON.stringify(state)) + '</textarea><div class="inline"><button class="btn sm" data-act="copy">Скопировать</button><button class="btn sm" data-act="import">Загрузить из поля</button></div></details>' +
      '<div class="foot-links"><button class="link" data-act="rerun">Пройти настройку заново</button>' +
      (view.confirm === "all" ? '<span class="warn-t">Удалить всё?</span><button class="link warn" data-act="reset-all">да</button><button class="link" data-act="cancel">нет</button>' : '<button class="link muted" data-act="ask" data-what="all">Начать с нуля</button>') + "</div></section>";
    h += '<section class="card tips"><h2>Методика</h2><ul>' + [
      "Каждый день два чтения: новое и манзиль. В манзиле — круг выученного и свежевыученное по интервалам.",
      "Сначала смысл: перевод суры целиком, затем тафсир, потом текст.",
      "Сначала запомните темы блоков, затем якоря аятов — первые слова, по которым вспоминается порядок.",
      "Слушайте одного чтеца с повторами, читайте вслух и не спеша. Записывайте себя и сравнивайте.",
      "Переходите от текста к памяти постепенно: скрытие слов, первые буквы, проверка.",
      "Проверяйте связки между аятами, блоками и сурами, затем читайте устазу.",
      "Мало, но каждый день. В тяжёлый день пропустите новое, но не повторение."
    ].map(function (t) { return "<li>" + t + "</li>"; }).join("") + "</ul></section>";
    if (swActive()) audioCacheInfo(function (k) { var el = document.getElementById("offline-info"); if (el && k) el.textContent += " Скачано аудио: " + k + " " + plural(k, "аят", "аята", "аятов") + "."; });
    return h + "</div>";
  }

  /* ---------------- окна ---------------- */
  function sheet(id, head, body, foot) {
    return '<div class="overlay" data-act="close"><div class="sheet" role="dialog" aria-labelledby="' + id + '"><div class="sheet-head">' + head + '<button class="icon" data-act="close" aria-label="Закрыть">' + ICON.close + '</button></div><div class="sheet-body">' + body + "</div>" + (foot ? '<div class="sheet-foot">' + foot + "</div>" : "") + "</div></div>";
  }
  function renderOverlay() {
    var o = document.getElementById("overlay"), sb0 = o.querySelector(".sheet-body"), top0 = sb0 ? sb0.scrollTop : 0;
    var key = view.ob ? "ob" + view.ob.step : view.tafsir ? "tf" : view.done ? "dn" : view.celebrate ? "cl" : view.reader ? "rd" : view.sheet ? "sh" + view.sheet : view.pick ? "pk" : "";
    var same = o.__k === key; o.__k = key;
    setTimeout(function () { var sb1 = same && o.querySelector(".sheet-body"); if (sb1 && top0) sb1.scrollTop = top0; }, 0);
    var any = !!(view.ob || view.tafsir || view.done || view.celebrate || view.reader || view.sheet || view.pick);
    document.body.classList.toggle("locked", any);
    if (view.ob) { o.innerHTML = '<div class="overlay"><div class="sheet" role="dialog" aria-labelledby="ob-t">' + obHtml() + "</div></div>"; return; }
    if (view.tafsir) { o.innerHTML = tafsirHtml(); return; }
    if (view.done) { o.innerHTML = doneHtml(view.done); return; }
    if (view.celebrate) { o.innerHTML = celebrateHtml(); return; }
    if (view.reader) { o.innerHTML = readerHtml(); return; }
    if (view.sheet) { o.innerHTML = sheetHtml(view.sheet); return; }
    if (view.pick) { o.innerHTML = pickHtml(); return; }
    o.innerHTML = "";
  }
  function pickHtml() {
    var start = state.set.direction === "start", nx = suggestNext(), list = SURAS.slice();
    if (!start) list.reverse();
    list = list.filter(function (x) { return !hifz(x.n); });
    return sheet("pk-t", '<h2 id="pk-t">Какую суру учить?</h2>', '<ul class="plist">' + list.map(function (x) {
      var dc = doneCount(x.n);
      return '<li><button data-act="set-current" data-n="' + x.n + '"><span class="pn">' + x.n + '</span><span class="pt"><b>' + esc(x.ru) + "</b><span>" + ayahsW(x.ayahs) + (dc ? " · выучено " + dc : "") + '</span></span><span class="ar">' + esc(x.ar) + "</span>" + (x.n === nx ? '<span class="tag">дальше</span>' : "") + "</button></li>";
    }).join("") + "</ul>");
  }
  function readerHtml() {
    var r = view.reader, x = SURAS[r.n - 1], h = "";
    h += '<div class="text">';
    for (var a = r.s; a <= r.e; a++) h += ayahHtml(r.n, a, { hl: r.hl });
    h += "</div>";
    return sheet("rd-t", '<div><h2 id="rd-t">' + esc(x.ru) + '</h2><span class="muted small">' + (r.s === 1 && r.e === x.ayahs ? ayahsW(x.ayahs) : "аяты " + rng(r.s, r.e)) + "</span></div>", h,
      '<button class="btn sm" data-act="play" data-n="' + r.n + '" data-a="' + r.s + '" data-b="' + r.e + '">' + ICON.play + ' Слушать</button><button class="link" data-act="open" data-n="' + r.n + '">к суре</button><button class="btn sm" data-act="tafsir" data-n="' + r.n + '" data-a="' + (r.hl || r.s) + '">Тафсир</button>');
  }
  function celebrateHtml() {
    var id = view.celebrate;
    return '<div class="overlay" data-act="close"><div class="sheet celebrate" role="dialog" aria-labelledby="cl-t"><div class="sheet-body center">' +
      '<span class="medal xl hz full">' + medalSvg(true, true, true, 1) + "<b>✓</b></span>" +
      '<h2 id="cl-t">' + esc(mileTitle(id)) + "</h2>" +
      '<p class="dua" lang="ar" dir="rtl">رَّبِّ زِدْنِي عِلْمًا</p><p class="muted">«Господи, приумножь мои знания» (Та Ха, 114)</p>' +
      '<p class="muted small">Дату можно изменить на странице «Путь».</p></div><div class="sheet-foot center"><button class="btn primary" data-act="close">Альхамдулиллях</button></div></div></div>';
  }
  function doneHtml(n) {
    var x = SURAS[n - 1], s = S(n), nx = state.current, days = s.startD ? diff(today(), s.startD) + 1 : 0;
    var body = medal(n, "xl") + '<h2 id="dn-t">Сура «' + esc(x.ru) + "» выучена</h2>" +
      '<p class="dua" lang="ar" dir="rtl">ٱلْحَمْدُ لِلَّهِ ٱلَّذِي بِنِعْمَتِهِ تَتِمُّ ٱلصَّالِحَاتُ</p><p class="muted small">«Хвала Аллаху, по милости Которого совершаются благие дела»</p>' +
      '<p class="done-sum">' + ayahsW(x.ayahs) + " · ≈ " + num1(pagesOf(n)) + " стр." + (days ? " · выучено за " + days + " " + plural(days, "день", "дня", "дней") : "") + "</p>" +
      (full(n) ? "" : '<p class="muted small">Отметьте перевод и тафсир — тогда сура будет заучена полностью.</p>' + stepChips(n)) +
      '<p class="muted small">Первый повтор — завтра, затем по интервалам. В манзиль сура войдёт с ' + esc(niceShort(addDays(cycleInfo().start, cycleInfo().cyc))) + ".</p>" +
      keepToggle(n);
    var foot = (nx ? '<button class="btn" data-act="done-pick">Другую суру</button><button class="btn primary" data-act="done-next">Учить «' + esc(SURAS[nx - 1].ru) + "»</button>" : '<span></span><button class="btn primary" data-act="close">Альхамдулиллях</button>');
    return '<div class="overlay" data-act="close"><div class="sheet celebrate" role="dialog" aria-labelledby="dn-t"><div class="sheet-body center">' + body + '</div><div class="sheet-foot">' + foot + "</div></div></div>";
  }
  function lsItem(n) {
    var s = state.suras[n], r = s && s.range ? s.range : [1, count(n)];
    if (s && hifz(n)) r = [1, count(n)];
    return { n: n, s: r[0], e: r[1], w: "" };
  }
  function lsLearn(n) {
    var s = state.suras[n], c = count(n), f = s ? firstUndone(n) || 1 : 1, e = s && s.range && s.range[1] >= f ? s.range[1] : c;
    return { n: n, s: f, e: e, w: "" };
  }
  function itemText(x) { return SURAS[x.n - 1].ru + (x.s === 1 && x.e === count(x.n) ? "" : " " + rng(x.s, x.e)); }
  function hasHw(hw) { return !!(hw && (typeof hw === "string" ? hw : (hw.learn.length || hw.rev.length || hw.text))); }
  function lastHw() { var j = state.journal[0]; return j && hasHw(j.hw) ? j : null; }
  function nextLesson(from) {
    var u = state.set.ustaz;
    if (!u.length) return null;
    for (var i = 0; i < 14; i++) { var d = addDays(from, i); if (u.indexOf(weekday(d)) !== -1) return d; }
    return null;
  }
  /* задание устаза: что выучить и что повторить; выученное отмечается галочкой */
  function hwBody(hw) {
    if (typeof hw === "string") return "<p>" + esc(hw) + "</p>";
    var grp = function (label, list, learn) {
      if (!list.length) return "";
      return '<div class="hw-g"><span class="hw-l">' + label + '</span><div class="hw-items">' + list.map(function (x) {
        var ok = learn && doneCount(x.n, x.s, x.e) === x.e - x.s + 1;
        return '<button class="hw-i' + (ok ? " ok" : "") + '" data-act="read" data-n="' + x.n + '" data-a="' + x.s + '" data-b="' + x.e + '">' + (ok ? ICON.check : "") + esc(itemText(x)) + "</button>";
      }).join("") + "</div></div>";
    };
    return grp("Выучить", hw.learn, true) + grp("Повторить", hw.rev, false) + (hw.text ? '<p class="hw-text">' + esc(hw.text) + "</p>" : "");
  }
  function hwPlain(hw) {
    if (typeof hw === "string") return hw;
    var out = [];
    if (hw.learn.length) out.push("выучить " + hw.learn.map(itemText).join(", "));
    if (hw.rev.length) out.push("повторить " + hw.rev.map(itemText).join(", "));
    if (hw.text) out.push(hw.text);
    return out.join("; ");
  }
  function jItems(j) { return j.items || (j.n ? [{ n: j.n, s: j.s, e: j.e }] : []); }
  function gradeTag(g) {
    if (typeof g === "number") return '<span class="tag mark g' + g + '" title="Оценка">' + g + "</span>";
    var lg = LESSON_GRADES.filter(function (x) { return x[0] === g; })[0];
    return lg ? '<span class="tag ' + g + '">' + lg[1] + "</span>" : "";
  }
  function keepToggle(n) {
    var on = state.keep.indexOf(n) !== -1;
    return '<button class="keep-t" data-act="keep" data-n="' + n + '" aria-pressed="' + on + '"><span class="kbox">' + (on ? "✓" : "") + "</span>Оставить суру на главной</button>";
  }
  function lessonRow(j) {
    var it = jItems(j).map(function (x) { return SURAS[x.n - 1].ru + (x.s === 1 && x.e === count(x.n) ? "" : " " + rng(x.s, x.e)); }).join(", ");
    return '<div class="jrow"><div><b>' + esc(niceShort(j.d)) + (it ? " · " + esc(it) : "") + "</b>" + gradeTag(j.g) + "</div>" + (j.note ? '<p class="muted small">' + esc(j.note) + "</p>" : "") +
      (hasHw(j.hw) ? '<p class="small jhw"><b>Задание:</b> ' + esc(hwPlain(j.hw)) + "</p>" : "") + "</div>";
  }
  function hwNote() {
    var j = lastHw();
    if (!j) return "";
    return '<div class="note-hw"><span class="eyebrow">Задание устаза</span>' + hwBody(j.hw) + "</div>";
  }
  function sheetHtml(kind) {
    if (kind === "weak") {
      var body = state.weak.length ? '<ul class="wlist">' + state.weak.map(function (w) {
        return '<li><div><b>' + esc(SURAS[w.n - 1].ru) + " · " + rng(w.s, w.e) + '</b><span class="muted small">' + esc(WEAK_SRC[w.src] || "") + " · " + esc(niceShort(w.d)) + "</span>" + (w.note ? '<p class="small">' + esc(w.note) + "</p>" : "") + "</div>" +
          '<div class="wbtns"><button class="btn sm" data-act="read" data-n="' + w.n + '" data-a="' + w.s + '" data-b="' + w.e + '">Текст</button><button class="btn sm" data-act="weak-done" data-id="' + w.id + '">' + ICON.check + " Исправлено</button></div></li>";
      }).join("") + "</ul>" : '<p class="muted">Слабых мест нет.</p>';
      return sheet("wk-t", '<div><h2 id="wk-t">Слабые места</h2><span class="muted small">Забытое при повторе, замечания устаза и самопроверки</span></div>', body);
    }
    if (kind === "journal") {
      var jb = '<button class="btn primary wide" data-act="lesson-new">Записать урок</button>' + (state.journal.length ? '<div class="jlist">' + state.journal.map(function (j) {
        return '<div class="jwrap">' + lessonRow(j) + '<button class="link muted" data-act="lesson-del" data-id="' + j.id + '">удалить</button></div>';
      }).join("") + "</div>" : '<p class="muted">Записей пока нет.</p>');
      return sheet("jr-t", '<div><h2 id="jr-t">Журнал уроков</h2><span class="muted small">Что сдано устазу, оценка и замечания</span></div>', jb);
    }
    if (kind === "lesson") return lessonHtml();
    if (kind === "quiz") return quizHtml();
    if (kind === "path") return pathHtml();
    return "";
  }
  function lsList(g) { var L = view.lesson; return g === "learn" ? L.hw.learn : g === "rev" ? L.hw.rev : L.items; }
  function lessonHtml() {
    var L = view.lesson;
    var mine = SURAS.filter(function (x) { return doneCount(x.n) > 0 || x.n === state.current; });
    var opts = function (sel) {
      var o = function (x) { return '<option value="' + x.n + '"' + (x.n === sel ? " selected" : "") + ">" + x.n + ". " + esc(x.ru) + "</option>"; };
      return (mine.length ? '<optgroup label="Учу и знаю">' + mine.map(o).join("") + "</optgroup>" : "") + '<optgroup label="Все суры">' + SURAS.map(o).join("") + "</optgroup>";
    };
    var list = function (g) {
      var arr = lsList(g);
      return '<div class="ls-items">' + arr.map(function (it, k) {
        var c = count(it.n), at = ' data-g="' + g + '" data-k="' + k + '"';
        return '<div class="ls-item"><select class="ls-n"' + at + ' aria-label="Сура">' + opts(it.n) + "</select>" +
          '<input type="text" inputmode="numeric" class="ls-r"' + at + ' value="' + rng(it.s, it.e) + '" aria-label="Аяты (из ' + c + ')">' +
          (g !== "items" || arr.length > 1 ? '<button class="icon sm" data-act="ls-del"' + at + ' aria-label="Убрать суру">' + ICON.close + "</button>" : "") +
          (g === "items" ? '<input type="text" class="ls-w"' + at + ' value="' + esc(it.w) + '" placeholder="ошибки в аятах: 23, 24–26" aria-label="Аяты с ошибками">' : "") + "</div>";
      }).join("") + "</div>";
    };
    var body = '<div class="field"><label>Что сдано</label>' + list("items") + '<button class="link ls-add" data-act="ls-add" data-g="items">+ сура</button></div>' +
      '<div class="field"><label>Оценка</label><div class="seg marks">' + MARKS.map(function (g) { return '<button class="segb mk g' + g[0] + '" data-act="ls-grade" data-v="' + g[0] + '" aria-pressed="' + (L.g === g[0]) + '" aria-label="' + g[0] + " — " + g[1] + '">' + g[0] + "</button>"; }).join("") + "</div></div>" +
      '<div class="field"><label for="ls-note">Замечания</label><input type="text" id="ls-note" value="' + esc(L.note) + '" placeholder="например: следить за мадд"></div>' +
      '<div class="field hw-f"><label>Задание к следующему уроку</label>' +
      '<div class="hw-sub"><span class="hw-l">Выучить</span>' + list("learn") + '<button class="link ls-add" data-act="ls-add" data-g="learn">+ сура</button></div>' +
      '<div class="hw-sub"><span class="hw-l">Повторить</span>' + list("rev") + '<button class="link ls-add" data-act="ls-add" data-g="rev">+ сура</button></div>' +
      '<input type="text" id="ls-hw" value="' + esc(L.hw.text) + '" placeholder="комментарий (необязательно)" aria-label="Комментарий к заданию"></div>';
    return sheet("ls-t", '<div><h2 id="ls-t">Урок с устазом</h2><span class="muted small">' + esc(nice(today())) + "</span></div>", body, '<button class="btn" data-act="sheet" data-v="journal">Журнал</button><button class="btn primary" data-act="lesson-save">Сохранить</button>');
  }
  function quizHtml() {
    var z = view.quiz;
    if (!z.qs.length) return sheet("qz-t", '<h2 id="qz-t">Самопроверка</h2>', '<p class="muted">Пока мало выученного для проверки связок. Выучите хотя бы два соседних аята или блока.</p>');
    if (z.i >= z.qs.length) {
      return sheet("qz-t", '<h2 id="qz-t">Самопроверка</h2>', '<div class="center"><p class="score">' + z.score + " из " + z.qs.length + '</p><p class="muted">' + (z.missed ? "Забытые места добавлены в слабые — повторите их." : "Все связки на месте. Машаллах!") + "</p></div>",
        '<button class="btn" data-act="close">Закрыть</button><button class="btn primary" data-act="quiz">Ещё раз</button>');
    }
    var q = z.qs[z.i], x = SURAS[q.n - 1], body = "", foot = "";
    if (q.t === "ayah" || q.t === "block") {
      var bl = q.t === "block" ? blocksOf(q.n) : null;
      var showA = q.t === "ayah" ? q.a : bl[q.i].e, ansA = q.t === "ayah" ? q.a + 1 : bl[q.i + 1].s;
      body += '<p class="qq">' + (q.t === "ayah" ? "Какой аят идёт дальше?" : "Блок «" + esc(bl[q.i].name) + "» закончился. С чего начинается следующий блок?") + '</p><span class="muted small">' + esc(x.ru) + ", аят " + showA + "</span>";
      body += '<div class="ayah compact"><div class="a" lang="ar" dir="rtl">' + esc(rows(q.n)[showA - 1][0]) + ' <span class="no">﴿' + arNum(showA) + "﴾</span></div></div>";
      if (z.shown) body += '<p class="sub">Ответ · аят ' + ansA + (q.t === "block" ? " · «" + esc(bl[q.i + 1].name) + "»" : "") + '</p><div class="ayah compact ans"><div class="a" lang="ar" dir="rtl">' + esc(rows(q.n)[ansA - 1][0]) + ' <span class="no">﴿' + arNum(ansA) + '﴾</span></div><div class="t">' + esc(rows(q.n)[ansA - 1][1]) + "</div></div>";
      foot = z.shown ? '<button class="btn" data-act="quiz-ans" data-ok="0">Не вспомнил</button><button class="btn primary" data-act="quiz-ans" data-ok="1">Вспомнил</button>'
        : '<button class="btn sm" data-act="play" data-n="' + q.n + '" data-a="' + showA + '" data-b="' + showA + '">' + ICON.play + '</button><button class="btn primary" data-act="quiz-show">Показать ответ</button>';
    } else {
      body += '<p class="qq">Какая сура идёт после «' + esc(x.ru) + "»?</p>";
      body += '<div class="qopts">' + q.opts.map(function (o) {
        var cls = z.pick === null ? "" : o === q.n + 1 ? " right" : o === z.pick ? " wrong" : "";
        return '<button class="qopt' + cls + '" data-act="quiz-opt" data-v="' + o + '"' + (z.pick !== null ? " disabled" : "") + '><b>' + esc(SURAS[o - 1].ru) + '</b><span class="ar">' + esc(SURAS[o - 1].ar) + "</span></button>";
      }).join("") + "</div>";
      foot = z.pick !== null ? '<span></span><button class="btn primary" data-act="quiz-next">Дальше</button>' : "";
    }
    return sheet("qz-t", '<div><h2 id="qz-t">Самопроверка</h2><span class="muted small">Вопрос ' + (z.i + 1) + " из " + z.qs.length + " · связки аятов, блоков и сур</span></div>", body, foot);
  }
  function pathHtml() {
    var st = stats(), sk = streak();
    var body = '<div class="path-sum"><b>' + num1(st.pct) + "% Корана</b><span>≈ " + num1(st.pages) + " из 604 стр. · " + num1(st.pages / 20) + " джуза · " + st.hifz + " " + plural(st.hifz, "сура", "суры", "сур") + (sk ? " · серия " + sk + " " + plural(sk, "день", "дня", "дней") : "") + "</span></div>";
    body += '<p class="sub">Джузы</p><div class="jgrid">';
    for (var j = 0; j < 30; j++) body += juzMedal(j);
    body += "</div>";
    var ids = MILES.map(function (m) { return m[0]; });
    Object.keys(state.miles).forEach(function (k) { if (/^jf?\d+$/.test(k)) ids.push(k); });
    body += '<p class="sub">Вехи</p><ul class="miles">' + ids.map(function (id) {
      var d = state.miles[id];
      return '<li class="' + (d ? "on" : "") + '"><i>' + (d ? ICON.check : "") + "</i><span>" + esc(mileTitle(id)) + "</span>" +
        (d ? '<input type="date" class="mdate" data-id="' + id + '" value="' + d + '" aria-label="Дата: ' + esc(mileTitle(id)) + '">' : '<button class="link" data-act="mile-set" data-id="' + id + '">отметить</button>') + "</li>";
    }).join("") + '</ul><p class="muted small">Вехи отмечаются сами. Дату можно изменить, а достигнутое раньше — отметить вручную. Очистите дату, чтобы снять отметку.</p>';
    return sheet("pt-t", '<h2 id="pt-t">Путь</h2>', body);
  }

  var OB_STEPS = ["Начало", "Что знаете", "Смысл", "План", "Расписание", "Чтец"];
  function obPicked() { return Object.keys(view.ob.picks).map(Number).sort(function (a, b) { return a - b; }); }
  /* выбор в мастере: picks[n] = true (вся сура) или список диапазонов [[a, b], …] */
  function obRanges(n) { var p = view.ob.picks[n]; return p === true ? [[1, count(n)]] : (p || []); }
  function obSet(n, list) {
    list = list.slice().sort(function (x, y) { return x[0] - y[0]; });
    var m = [];
    list.forEach(function (r) { var l = m[m.length - 1]; if (l && r[0] <= l[1] + 1) l[1] = Math.max(l[1], r[1]); else m.push([r[0], r[1]]); });
    if (!m.length) delete view.ob.picks[n];
    else if (m.length === 1 && m[0][0] === 1 && m[0][1] === count(n)) view.ob.picks[n] = true;
    else view.ob.picks[n] = m;
  }
  function obCovered(n, a, b) { var c = 0; obRanges(n).forEach(function (r) { c += Math.max(0, Math.min(b, r[1]) - Math.max(a, r[0]) + 1); }); return c; }
  function obSubtract(n, a, b) { var out = []; obRanges(n).forEach(function (r) { if (r[1] < a || r[0] > b) out.push(r); else { if (r[0] < a) out.push([r[0], a - 1]); if (r[1] > b) out.push([b + 1, r[1]]); } }); obSet(n, out); }
  function obJuzState(j) {
    var tot = 0, cov = 0;
    juzSegs(j).forEach(function (sg) { tot += sg[2] - sg[1] + 1; cov += obCovered(sg[0], sg[1], sg[2]); });
    return cov === 0 ? "" : cov === tot ? "on" : "part";
  }
  function obRangeText(n) { var p = view.ob.picks[n]; return p === true ? "" : p ? "аяты " + p.map(function (r) { return rng(r[0], r[1]); }).join(", ") : ""; }
  function obSuraRow(x, sg) {
    var o = view.ob, a = sg ? sg[1] : 1, b = sg ? sg[2] : x.ayahs, cov = obCovered(x.n, a, b), whole = cov === b - a + 1, part = cov > 0 && !whole;
    var label = sg && (a > 1 || b < x.ayahs) ? "аяты " + rng(a, b) : ayahsW(x.ayahs);
    var r = '<li class="' + (cov ? "on" : "") + '"><button class="kmain" data-act="ob-seg" data-n="' + x.n + '" data-a="' + a + '" data-b="' + b + '" aria-pressed="' + whole + '"><i class="kbox">' + (whole ? ICON.check : part ? "½" : "") + '</i><span class="kn">' + x.n + '</span><span class="kt"><b>' + esc(x.ru) + "</b><span>" + (part ? obRangeText(x.n) + " из " + rng(a, b) : label) + '</span></span><span class="ar">' + esc(x.ar) + "</span></button>";
    if (b - a + 1 >= PARTIAL_MIN) r += '<button class="kpart' + (part ? " on" : "") + '" data-act="ob-partial" data-n="' + x.n + '">Частично</button>';
    if (o.partial === x.n) {
      var cur = obRanges(x.n)[0] || [a, Math.min(b, a + 9)];
      r += '<div class="kedit"><span>Знаю аяты</span><label>с <input type="number" id="kp-a" min="1" max="' + x.ayahs + '" value="' + cur[0] + '"></label><label>по <input type="number" id="kp-b" min="1" max="' + x.ayahs + '" value="' + cur[1] + '"></label><button class="btn sm primary" data-act="ob-partial-ok" data-n="' + x.n + '">Готово</button></div>';
    }
    return r + "</li>";
  }
  function obHtml() {
    var o = view.ob, s = state.set, st = o.step;
    var h = '<div class="sheet-head ob"><div class="ob-dots">' + OB_STEPS.map(function (t, i) { return '<i class="' + (i < st ? "done" : i === st ? "now" : "") + '"></i>'; }).join("") + "</div></div>";
    h += '<div class="sheet-body">';
    if (st === 0) {
      h += '<div class="ob-hero"><span class="ar">بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ</span><h2 id="ob-t">Настроим Хифз под вас</h2><p class="muted">Несколько вопросов — и приложение составит план: что учить, когда повторять и как распределить выученное по дням.</p></div>' +
        '<div class="field"><label for="st-name">Как к вам обращаться</label><input type="text" id="st-name" value="' + esc(s.name) + '" placeholder="Имя, можно пропустить"></div>';
    } else if (st === 1) {
      var picked = obPicked(), partial = picked.filter(function (n) { return o.picks[n] !== true; }).length;
      h += '<h2 id="ob-t">Что вы уже знаете наизусть?</h2><p class="muted small">Отметьте джузы целиком или раскройте джуз и отметьте отдельные суры. Если большую суру знаете не целиком — «Частично».</p>' +
        '<div class="viewbar">' + '<div class="seg">' + [["juz", "Джузы"], ["suras", "Суры"]].map(function (m) { return '<button class="segb" data-act="ob-mode" data-v="' + m[0] + '" aria-pressed="' + (o.mode === m[0]) + '">' + m[1] + "</button>"; }).join("") + "</div>" +
        '<button class="link muted" data-act="ob-preset" data-v="none">очистить</button></div>';
      if (o.mode === "juz") {
        h += '<ul class="known jl">';
        for (var jz = 29; jz >= 0; jz--) {
          var jst = obJuzState(jz), segs = juzSegs(jz), op = !!o.jopen[jz];
          h += '<li class="jrowk ' + jst + '"><button class="kmain" data-act="ob-juz" data-j="' + jz + '" aria-pressed="' + (jst === "on") + '"><i class="kbox">' + (jst === "on" ? ICON.check : jst ? "½" : "") + '</i><span class="kt"><b>Джуз ' + (jz + 1) + "</b><span>" + esc(SURAS[segs[0][0] - 1].ru) + (segs[0][1] > 1 ? " " + segs[0][1] : "") + " — " + esc(SURAS[segs[segs.length - 1][0] - 1].ru) + '</span></span></button><button class="kpart open-j" data-act="ob-jopen" data-j="' + jz + '" aria-expanded="' + op + '">' + (op ? "свернуть" : "суры") + "</button>";
          if (op) h += '<ul class="known sub-k">' + segs.map(function (sg) { return obSuraRow(SURAS[sg[0] - 1], sg); }).join("") + "</ul>";
          h += "</li>";
        }
        h += "</ul>";
      } else {
        h += '<input class="search" id="obq" type="search" placeholder="Найти суру" value="' + esc(o.q) + '">' +
          '<ul class="known">' + SURAS.slice().reverse().filter(function (x) {
            var q = o.q.trim().toLowerCase(); return !q || x.ru.toLowerCase().indexOf(q) !== -1 || String(x.n) === q;
          }).map(function (x) { return obSuraRow(x, null); }).join("") + "</ul>";
      }
      h += '<p class="muted small sel">' + (picked.length ? "Отмечено: " + picked.length + " " + plural(picked.length, "сура", "суры", "сур") + (partial ? ", из них частично " + partial : "") : "Ничего не отмечено — начнём с нуля") + "</p>";
    } else if (st === 2) {
      var whole2 = obPicked().filter(function (n) { return o.picks[n] === true; });
      h += '<h2 id="ob-t">Смысл выученных сур</h2>';
      if (whole2.length) {
        h += '<p class="muted">Сура считается заученной полностью, когда изучены перевод, тафсир и текст. Что из этого уже сделано для выученных сур?</p>' +
          '<label class="switch"><input type="checkbox" id="ob-tr"' + (o.tr ? " checked" : "") + "><span>Перевод читал</span></label>" +
          '<label class="switch"><input type="checkbox" id="ob-tf"' + (o.tf ? " checked" : "") + "><span>Тафсир изучал</span></label>" +
          '<p class="muted small">Можно поменять потом в карточке каждой суры.</p>';
      } else h += '<p class="muted">Для каждой новой суры приложение сначала предложит прочитать перевод и тафсир — так учить легче.</p>';
    } else if (st === 3) {
      h += '<h2 id="ob-t">Как будете учить</h2>' +
        '<div class="field"><label>Новое в день</label>' + chips("norm", NORMS, s.norm) + '<span class="muted small">Новичкам — четверть или половина страницы.</span></div>' +
        '<div class="field"><label>Направление</label>' + chips("direction", [["end", "С конца Корана"], ["start", "С начала"]], s.direction) + "</div>" +
        '<div class="field"><label>Размер смыслового блока</label>' + chips("blockSize", SIZES, s.blockSize) + "</div>";
    } else if (st === 4) {
      h += '<h2 id="ob-t">Расписание</h2>' +
        '<div class="field"><label>Дни уроков с устазом</label>' + chips("ustaz", DAY_CHIPS, s.ustaz, true) + '<span class="muted small">Если учите сами — пропустите.</span></div>' +
        '<div class="field"><label>Дни без нового урока</label>' + chips("rest", DAY_CHIPS, s.rest, true) + "</div>" +
        '<div class="field"><label>Повторять всё выученное за</label>' + chips("cycle", [[7, "7 дней"], [10, "10 дней"], [14, "14 дней"]], s.cycle) + "</div>" +
        (s.cycle === 7 ? '<div class="field"><label>Неделя начинается с</label>' + chips("weekStart", [[0, "Пн"], [5, "Сб"], [6, "Вс"]], s.weekStart) + "</div>" : "");
    } else {
      h += '<h2 id="ob-t">Чтец</h2>' + reciterList(s.reciter) + slider("ayahRep", "Повтор аята", 1, 10, 1, s.ayahRep);
    }
    h += "</div>";
    h += '<div class="sheet-foot">' + (st > 0 ? '<button class="btn" data-act="ob-back">Назад</button>' : "<span></span>") +
      (st < OB_STEPS.length - 1 ? '<button class="btn primary" data-act="ob-next">Далее</button>' : '<button class="btn primary" data-act="ob-finish">Начать</button>') + "</div>";
    return h;
  }

  function tafsirHtml() {
    var t = view.tafsir, n = t.n, a = t.a, b = t.b || t.a, x = SURAS[n - 1], m = tafsirMem[n], h = "";
    for (var k = a; k <= b; k++) {
      var r = rows(n)[k - 1];
      h += '<div class="ayah compact"><div class="a" lang="ar" dir="rtl">' + esc(r[0]) + ' <span class="no">﴿' + arNum(k) + '﴾</span></div><div class="t">' + esc(r[1]) + "</div></div>";
      if (m) {
        var txt = m[k];
        if (txt) {
          var fk = n + ":" + k, long = txt.length > 700 && !view.tafFull[fk];
          var shown = long ? txt.slice(0, Math.max(txt.lastIndexOf(" ", 560), 400)) + "…" : txt;
          h += '<div class="tafsir-text" data-a="' + k + '">' + esc(shown).replace(/\n/g, "<br>") + "</div>" + (long ? '<button class="link" data-act="taf-full" data-k="' + fk + '">Читать полностью</button>' : "");
        } else if (a === b) h += '<p class="muted small">Толкование этого аята дано вместе с соседними — смотрите предыдущий аят.</p>';
      }
    }
    if (!m) {
      if (t.err) h += '<div class="empty">' + esc(t.err) + '<div class="row center"><button class="btn sm primary" data-act="tafsir-retry">Повторить</button><a class="btn sm" href="https://quran.com/ru/' + n + ":" + a + '/tafsirs" target="_blank" rel="noopener">quran.com</a></div></div>';
      else h += '<div class="empty">Загружаю тафсир…</div>';
    } else h += '<p class="muted small">Выделите фрагмент толкования — его можно добавить в конспект суры.</p>';
    var foot = (a > 1 ? '<button class="btn sm" data-act="tafsir-step" data-d="-1">← Аят ' + (a - 1) + "</button>" : "<span></span>") +
      '<span class="tf-mid">' + (m ? '<button class="link" id="tf-copy" data-act="tafsir-copy">копировать</button><button class="btn sm primary" id="tf-add" data-act="tafsir-note" hidden>+ В конспект</button>' : "") + "</span>" +
      (b < count(n) ? '<button class="btn sm" data-act="tafsir-step" data-d="1">Аят ' + (b + 1) + " →</button>" : "<span></span>");
    return sheet("tf-t", '<div><h2 id="tf-t">Тафсир Ибн Касира</h2><span class="muted small">' + esc(x.ru) + ", " + (a === b ? "аят " + a : "аяты " + a + "–" + b) + "</span></div>", h, foot);
  }
  function openTafsir(n, a, b) {
    view.tafsir = { n: n, a: a, b: b || a, err: "" };
    render();
    if (tafsirMem[n]) return;
    getTafsir(n).then(function () { if (view.tafsir && view.tafsir.n === n) render(); }, function () {
      getTafsirAyah(n, a).then(function (txt) { tafsirMem[n] = tafsirMem[n] || {}; tafsirMem[n][a] = txt; if (view.tafsir) render(); }, function () {
        if (view.tafsir && view.tafsir.n === n) { view.tafsir.err = "Не удалось загрузить тафсир. Проверьте интернет."; render(); }
      });
    });
  }
  function selectionInTafsir() {
    var sel = window.getSelection ? window.getSelection() : null;
    if (!sel || sel.isCollapsed) return null;
    var txt = sel.toString().replace(/\s+/g, " ").trim();
    if (txt.length < 4) return null;
    var node = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentNode);
    var box = node && node.closest ? node.closest(".tafsir-text") : null;
    return box ? { text: txt, a: +box.getAttribute("data-a") } : null;
  }
  document.addEventListener("selectionchange", function () {
    if (!view.tafsir) return;
    var add = document.getElementById("tf-add"), cp = document.getElementById("tf-copy");
    if (!add) return;
    var s = selectionInTafsir();
    add.hidden = !s; if (cp) cp.hidden = !!s;
  });

  /* ---------------- шапка суры и память экрана ---------------- */
  function updateSticky() {
    var bar = document.getElementById("stickhead");
    if (!bar || !view.sura) return;
    var top = document.querySelector(".top"), off = top && getComputedStyle(top).position === "sticky" ? top.offsetHeight : 0;
    bar.style.top = off + "px";
    var head = document.querySelector(".detail-head"), show = head && head.getBoundingClientRect().bottom < off;
    bar.classList.toggle("on", !!show);
    if (!show) return;
    var rowsEl = document.querySelectorAll(".narrow .blist > .brow"), cur = -1;
    for (var i = 0; i < rowsEl.length; i++) if (rowsEl[i].getBoundingClientRect().top < off + 80) cur = i;
    var bl = blocksOf(view.sura), b = bl[Math.max(0, cur)];
    document.getElementById("stick-b").textContent = cur >= 0 && b ? "блок " + (cur + 1) + " из " + bl.length + " · " + rng(b.s, b.e) : bl.length + " " + plural(bl.length, "блок", "блока", "блоков");
  }
  function viewKey() { return view.sura ? "s" + view.sura : "t" + view.tab; }
  var viewSaveT = null;
  function saveView() {
    clearTimeout(viewSaveT);
    viewSaveT = setTimeout(function () {
      view.scroll[viewKey()] = window.scrollY;
      try { localStorage.setItem("hifz.view", JSON.stringify({ tab: view.tab, sura: view.sura, lastSura: view.lastSura, openB: view.openB, scroll: view.scroll, plain: view.plain })); } catch (e) { /* ignore */ }
    }, 150);
  }
  function restoreView() {
    try {
      var v = JSON.parse(localStorage.getItem("hifz.view") || "null");
      if (v) { view.tab = v.tab || "today"; view.sura = v.sura || null; view.openB = v.openB || null; view.lastSura = v.lastSura || null; view.scroll = v.scroll || {}; view.plain = v.plain || {}; }
    } catch (e) { /* ignore */ }
  }
  window.addEventListener("scroll", function () { updateSticky(); if (state && state.setup) saveView(); }, { passive: true });

  /* ---------------- действия ---------------- */
  function setSetting(k, v, multi) {
    var s = state.set;
    if (multi) { v = +v; var arr = s[k].slice(), ix = arr.indexOf(v); if (ix === -1) arr.push(v); else arr.splice(ix, 1); s[k] = arr.sort(); }
    else if (k === "norm" || k === "cycle" || k === "weekStart") s[k] = +v;
    else s[k] = v;
    if (k === "theme" || k === "ui") applyTheme();
    if (k === "cycle" || k === "weekStart") { state.anchor = today(); state.mshift = 0; }
    if (k === "blockSize") Object.keys(state.suras).forEach(function (n) { var x = state.suras[n]; if (x.bsrc !== "custom") x.blocks = null; });
    if (k === "reciter") { if (player.on) stopAudio(); view.dl = {}; }
    save();
  }
  function closeTop() {
    if (view.tafsir) view.tafsir = null;
    else if (view.done) view.done = null;
    else if (view.celebrate) view.celebrate = null;
    else if (view.reader) view.reader = null;
    else if (view.sheet) { view.sheet = null; view.quiz = null; }
    else view.pick = false;
  }
  function parseRanges(str, max) {
    var out = [];
    String(str || "").split(/[,;]+/).forEach(function (p) {
      var m = p.trim().match(/^(\d+)\s*(?:[-–—]\s*(\d+))?$/);
      if (!m) return;
      var a = Math.max(1, Math.min(max, +m[1])), b = Math.max(a, Math.min(max, +(m[2] || m[1])));
      out.push([a, b]);
    });
    return out;
  }

  function go(fn, toBlock) {
    view.scroll[viewKey()] = window.scrollY;
    fn();
    render();
    if (toBlock) { var el2 = document.querySelector(".narrow .brow.open"); if (el2) { var off = document.querySelector(".top").offsetHeight; window.scrollTo(0, el2.getBoundingClientRect().top + window.scrollY - off - 50); } }
    else window.scrollTo(0, view.scroll[viewKey()] || 0);
    saveView();
  }
  function act(a, el) {
    var n = +el.getAttribute("data-n"), i = +el.getAttribute("data-i"), s = n ? S(n) : null, bl, b, key;
    switch (a) {
      case "tab":
        var nt = el.getAttribute("data-tab");
        go(function () {
          if (view.sura) { view.lastSura = nt === "suras" ? null : view.sura; view.sura = null; }
          else if (nt === "suras" && view.tab !== "suras" && view.lastSura) view.sura = view.lastSura;
          else if (view.tab === nt) view.scroll["t" + nt] = 0;
          view.tab = nt; view.confirm = null;
        }); return;
      case "open": go(function () { if (view.sura !== n) { view.openB = null; view.scroll["s" + n] = 0; } view.sura = n; view.reader = null; view.sheet = null; view.done = null; view.confirm = null; view.edit = null; view.rangeEdit = false; }); return;
      case "open-block": go(function () { view.sura = n; view.openB = n + ":" + i; view.edit = null; view.rangeEdit = false; }, true); return;
      case "toggle-block": key = n + ":" + i; view.openB = view.openB === key ? null : key; view.edit = null; saveView(); break;
      case "edit-block": key = n + ":" + i; view.edit = view.edit === key ? null : key; break;
      case "back": go(function () { view.sura = null; view.lastSura = null; view.tab = "suras"; }); return;
      case "filter": view.filter = el.getAttribute("data-f"); break;
      case "jtoggle": var jj = el.getAttribute("data-j"); view.jopen[jj] = !view.jopen[jj]; break;
      case "pillar":
        var k = el.getAttribute("data-k");
        if (k === "hz") {
          if (hifz(n)) { setDone(n, 1, count(n), false); state.reviews = state.reviews.filter(function (r) { return r.n !== n; }); s.range = null; s.blocks = null; }
          else { setDone(n, 1, count(n), true); s.range = [1, count(n)]; s.blocks = null; afterProgress(n, true); markDay(); }
        } else { s[k] = !s[k]; if (s[k] && full(n)) toast("Сура «" + SURAS[n - 1].ru + "» заучена полностью"); }
        afterChange(); return;
      case "block-toggle":
        b = blocksOf(n)[i];
        var on = !blockDone(n, b);
        setDone(n, b.s, b.e, on);
        if (on) { toast("Блок " + rng(b.s, b.e) + " выучен"); markDay(); afterProgress(n); }
        afterChange(); return;
      case "range-edit": var r0 = range(n); view.split = { a: r0[0], b: r0[1], m: "auto", k: Math.max(1, Math.min(10, (blocksOf(n)[0] || { s: 1, e: 5 }).e - (blocksOf(n)[0] || { s: 1 }).s + 1)) }; view.rangeEdit = true; break;
      case "cancel-split": view.rangeEdit = false; view.split = null; break;
      case "split-all": view.split.a = 1; view.split.b = count(n); break;
      case "split-m": view.split.m = el.getAttribute("data-v"); break;
      case "split-go":
        var spl = view.split, c1 = count(n), sa = Math.max(1, Math.min(c1, spl.a | 0)), sb = Math.max(sa, Math.min(c1, spl.b | 0));
        if (spl.m === "eq") {
          var kk = Math.max(1, Math.min(40, spl.k | 0)), out = [];
          for (var q1 = sa; q1 <= sb; q1 += kk) { var q2 = Math.min(sb, q1 + kk - 1); out.push({ s: q1, e: q2, name: B.title(rows(n)[q1 - 1][1], q1, q2), d: "" }); }
          s.range = [sa, sb]; s.blocks = out; s.bsrc = "custom";
        } else { setRange(n, sa, sb); s.bsrc = "auto"; }
        view.rangeEdit = false; view.split = null; view.openB = null; save();
        toast("Аяты " + rng(sa, sb) + ": " + s.blocks.length + " " + plural(s.blocks.length, "блок", "блока", "блоков")); break;
      case "sura-mode": view.plain[n] = el.getAttribute("data-v") === "1"; view.rangeEdit = false; saveView(); break;
      case "keep":
        var kx = state.keep.indexOf(n);
        if (kx === -1) { state.keep.push(n); var kr = range(n); if ((kr[0] !== 1 || kr[1] !== count(n)) && s.bsrc !== "custom") setRange(n, 1, count(n)); toast("Сура останется на главной"); }
        else { state.keep.splice(kx, 1); toast("Сура убрана с главной"); }
        save(); break;
      case "keep-open": view.keepOpen[n] = !view.keepOpen[n]; break;
      case "mz-now":
        mzPending().forEach(function (pp) { mzAdd(pp.n, pp.s, pp.e); }); save(); toast("Добавлено в манзиль"); break;
      case "goto-ayah":
        var ga = document.getElementById("ay-" + n + "-" + el.getAttribute("data-a"));
        if (ga) { var topH = document.querySelector(".top").offsetHeight || 0; window.scrollTo(0, ga.getBoundingClientRect().top + window.scrollY - (getComputedStyle(document.querySelector(".top")).position === "sticky" ? topH : 0) - 60); ga.classList.remove("flash"); void ga.offsetWidth; ga.classList.add("flash"); }
        return;
      case "show-learned": view.showLearned = !view.showLearned; break;
      case "know-range":
        var ka = view.split ? view.split.a : range(n)[0], kb = view.split ? view.split.b : range(n)[1], c0 = count(n);
        ka = Math.max(1, Math.min(c0, ka | 0)); kb = Math.max(ka, Math.min(c0, kb | 0));
        setDone(n, ka, kb, true); mzAdd(n, ka, kb); s.range = null; s.blocks = null; range(n); blocksOf(n);
        view.rangeEdit = false; view.split = null; toast("Аяты " + rng(ka, kb) + " отмечены выученными");
        if (hifz(n)) afterProgress(n, true);
        afterChange(); return;
      case "set-current": state.current = n; view.pick = false; range(n); blocksOf(n); save(); toast("Учим «" + SURAS[n - 1].ru + "»"); break;
      case "pick": view.pick = true; break;
      case "done-next": view.done = null; toast("Учим «" + SURAS[state.current - 1].ru + "»"); break;
      case "done-pick": view.done = null; view.pick = true; break;
      case "close": closeTop(); break;
      case "sheet": view.sheet = el.getAttribute("data-v"); break;
      case "check-mode": key = n + ":" + i; view.check[key] = !view.check[key]; b = blocksOf(n)[i]; for (var ca = b.s; ca <= b.e; ca++) delete view.wordRev[n + ":" + ca]; break;
      case "check-reset": b = blocksOf(n)[i]; for (var cr = b.s; cr <= b.e; cr++) delete view.wordRev[n + ":" + cr]; break;
      case "check-all": b = blocksOf(n)[i]; for (var cl = b.s; cl <= b.e; cl++) view.wordRev[n + ":" + cl] = 9999; break;
      case "word-next": var wk = n + ":" + el.getAttribute("data-a"); view.wordRev[wk] = (view.wordRev[wk] || 0) + 1; break;
      case "word-all": view.wordRev[n + ":" + el.getAttribute("data-a")] = 9999; break;
      case "hint-mode": key = n + ":" + i; view.hint[key] = !view.hint[key]; break;
      case "hide-mode": key = n + ":" + i; view.hide[key] = ((view.hide[key] || 0) + 1) % HIDE.length; break;
      case "ayah-toggle":
        var aa = +el.getAttribute("data-a"), was = isDone(n, aa);
        setDone(n, aa, aa, !was);
        if (!was) { markDay(); afterProgress(n); }
        afterChange(); return;
      case "split":
        bl = blocksOf(n); b = bl[i]; var mid = Math.floor((b.s + b.e + 1) / 2);
        bl.splice(i + 1, 0, { s: mid, e: b.e, name: B.title(rows(n)[mid - 1][1], mid, b.e), d: "" }); b.e = mid - 1; s.bsrc = "custom"; save(); break;
      case "merge": bl = blocksOf(n); bl[i].e = bl[i + 1].e; bl.splice(i + 1, 1); s.bsrc = "custom"; save(); break;
      case "reset-blocks": s.blocks = null; s.bsrc = null; blocksOf(n); view.openB = null; view.edit = null; save(); toast("Блоки пересчитаны"); break;
      case "dl-block": b = blocksOf(n)[i]; downloadBlock(n, b, n + ":" + i); return;
      case "clear-audio": if (window.caches) caches.delete("hifz-audio").then(function () { view.dl = {}; toast("Скачанное аудио удалено"); render(); }); return;
      case "install": if (installEvt) { installEvt.prompt(); installEvt = null; } break;
      case "play": playRange(n, +el.getAttribute("data-a"), +el.getAttribute("data-b"), true); return;
      case "play-block": b = blocksOf(n)[i]; playRange(n, b.s, b.e, false); return;
      case "pl-toggle": togglePause(); return;
      case "pl-stop": stopAudio(); return;
      case "pl-prev": stepAyah(-1); return;
      case "pl-next": stepAyah(1); return;
      case "rec": startRec(n, +el.getAttribute("data-a")); return;
      case "rec-stop": stopRec(); return;
      case "rec-cmp": compareRec(n, +el.getAttribute("data-a")); return;
      case "read": view.reader = { n: n, s: +el.getAttribute("data-a"), e: +el.getAttribute("data-b") }; break;
      case "read-hit": var ha = +el.getAttribute("data-a"); view.reader = { n: n, s: Math.max(1, ha - 1), e: Math.min(count(n), ha + 1), hl: ha }; break;
      case "tafsir": openTafsir(n, +el.getAttribute("data-a"), +el.getAttribute("data-b") || 0); return;
      case "tafsir-step":
        var t = view.tafsir, d = +el.getAttribute("data-d"), na = d > 0 ? (t.b || t.a) + 1 : t.a - 1;
        openTafsir(t.n, na, na); return;
      case "tafsir-retry": var tr = view.tafsir; delete tafsirMem[tr.n]; openTafsir(tr.n, tr.a, tr.b); return;
      case "taf-full": view.tafFull[el.getAttribute("data-k")] = true; break;
      case "tafsir-copy":
        var tv = view.tafsir, txt = SURAS[tv.n - 1].ru + "\n";
        for (var qq = tv.a; qq <= tv.b; qq++) { var rr = rows(tv.n)[qq - 1]; txt += "\n" + qq + ". " + rr[0] + "\n" + rr[1] + "\n" + (tafsirMem[tv.n][qq] ? "\nТафсир Ибн Касира:\n" + tafsirMem[tv.n][qq] + "\n" : ""); }
        copyText(txt); return;
      case "tafsir-note":
        var sel = selectionInTafsir(), tn = view.tafsir.n;
        if (!sel) return;
        var sn = S(tn);
        sn.note = (sn.note ? sn.note.replace(/\s+$/, "") + "\n\n" : "") + "— " + sel.text + " (Ибн Касир, " + tn + ":" + sel.a + ")";
        try { window.getSelection().removeAllRanges(); } catch (e) { /* ignore */ }
        save(); toast("Добавлено в конспект суры"); return;
      case "rev": review(el.getAttribute("data-id"), el.getAttribute("data-g")); return;
      case "weak-done": var wid = el.getAttribute("data-id"); state.weak = state.weak.filter(function (w) { return w.id !== wid; }); save(); toast("Отмечено как исправленное"); break;
      case "manzil":
        var dd = el.getAttribute("data-d");
        if (state.manzil[dd]) { delete state.manzil[dd]; delete state.mitems[dd]; }
        else { state.manzil[dd] = true; if (state.carry[dd]) state.manzil[state.carry[dd]] = true; markDay(); toast("Отмечено"); }
        afterChange(); return;
      case "m-item":
        var md = el.getAttribute("data-d"), mk = el.getAttribute("data-k"), mp = manzilParts(), mpart = mp[cycleInfo(md).idx];
        state.mitems[md] = state.mitems[md] || {};
        if (itemDone(md, { n: +mk.split(":")[0], s: +mk.split(":")[1].split("-")[0], e: +mk.split("-")[1] })) {
          if (state.manzil[md] && mpart) { mpart.items.forEach(function (it) { state.mitems[md][itemKey(it)] = 1; }); delete state.manzil[md]; }
          delete state.mitems[md][mk];
        } else {
          state.mitems[md][mk] = 1; markDay();
          if (mpart && mpart.items.every(function (it) { return state.mitems[md][itemKey(it)]; })) { state.manzil[md] = true; toast("Манзиль дня прочитан"); }
        }
        afterChange(); return;
      case "m-carry": state.carry[today()] = el.getAttribute("data-d"); save(); break;
      case "m-shift": state.mshift = ((state.mshift || 0) + 1) % state.set.cycle; state.mskip[addDays(today(), -1)] = 1; save(); toast("Круг сдвинут: сегодня — вчерашняя часть"); break;
      case "m-did": state.manzil[el.getAttribute("data-d")] = true; afterChange(); return;
      case "m-skip": state.mskip[el.getAttribute("data-d")] = 1; save(); break;
      case "quiz": view.quiz = buildQuiz(); view.sheet = "quiz"; break;
      case "quiz-show": view.quiz.shown = true; break;
      case "quiz-ans":
        var z = view.quiz, q = z.qs[z.i];
        if (el.getAttribute("data-ok") === "1") z.score++;
        else { z.missed++; var wa = q.t === "ayah" ? q.a + 1 : blocksOf(q.n)[q.i + 1].s; addWeak(q.n, wa, wa, "quiz"); }
        z.i++; z.shown = false; if (z.i >= z.qs.length) { markDay(); save(); }
        break;
      case "quiz-opt":
        var zz = view.quiz, qo = zz.qs[zz.i], v = +el.getAttribute("data-v");
        zz.pick = v; if (v === qo.n + 1) zz.score++; else zz.missed++;
        break;
      case "quiz-next": view.quiz.i++; view.quiz.pick = null; if (view.quiz.i >= view.quiz.qs.length) { markDay(); save(); } break;
      case "lesson-new":
        var ln = state.current || (state.weak[0] && state.weak[0].n) || 114, lhj = lastHw(), its = [];
        if (lhj && lhj.d < today() && typeof lhj.hw !== "string") lhj.hw.learn.concat(lhj.hw.rev).forEach(function (x) {
          var ex = its.filter(function (y) { return y.n === x.n; })[0];
          if (ex) { ex.s = Math.min(ex.s, x.s); ex.e = Math.max(ex.e, x.e); } else its.push({ n: x.n, s: x.s, e: x.e, w: "" });
        });
        if (!its.length) its = [lsItem(ln)];
        var nl0 = suggestNext();
        view.lesson = { items: its, g: 5, note: "", hw: { learn: state.current ? [lsLearn(state.current)] : nl0 ? [lsLearn(nl0)] : [], rev: [], text: "" } }; view.sheet = "lesson"; break;
      case "ls-grade": view.lesson.g = +el.getAttribute("data-v"); break;
      case "ls-add":
        var lg = el.getAttribute("data-g"), lit = lsList(lg), pool;
        if (lg === "learn") pool = [state.current, suggestNext()];
        else if (lg === "rev") pool = view.lesson.items.map(function (x) { return x.n; }).concat(state.reviews.map(function (r) { return r.n; }), state.keep, SURAS.filter(function (x) { return hifz(x.n); }).map(function (x) { return x.n; }).reverse());
        else pool = state.reviews.map(function (r) { return r.n; }).concat(state.current ? [state.current] : []);
        var cand = pool.filter(function (m) { return m && !lit.some(function (x) { return x.n === m; }) && (lg !== "rev" || (doneCount(m) > 0 && !view.lesson.hw.learn.some(function (x) { return x.n === m; }))); });
        var base = lit.length ? lit[lit.length - 1].n : state.current || 114, nn = cand[0] || (base > 1 ? base - 1 : 2);
        lit.push(lg === "learn" ? lsLearn(nn) : lsItem(nn)); break;
      case "ls-del": lsList(el.getAttribute("data-g")).splice(+el.getAttribute("data-k"), 1); break;
      case "lesson-save":
        var clampIt = function (x) { var cL = count(x.n), a1 = Math.max(1, Math.min(cL, x.s | 0)); return { n: x.n, s: a1, e: Math.max(a1, Math.min(cL, x.e | 0)) }; };
        var L = view.lesson, items = L.items.map(function (x) { var y = clampIt(x); y.w = x.w; return y; });
        state.journal.unshift({ id: String(Date.now()), d: today(), items: items.map(function (x) { return { n: x.n, s: x.s, e: x.e }; }), g: L.g, note: L.note.trim(), hw: { learn: L.hw.learn.map(clampIt), rev: L.hw.rev.map(clampIt), text: L.hw.text.trim() } });
        items.forEach(function (x) { parseRanges(x.w, count(x.n)).forEach(function (p) { addWeak(x.n, p[0], p[1], "ustaz", L.note.trim()); }); });
        markDay(); view.sheet = "journal"; toast("Урок записан"); afterChange(); return;
      case "lesson-del": var lid = el.getAttribute("data-id"); state.journal = state.journal.filter(function (j) { return j.id !== lid; }); save(); break;
      case "mile-set": state.miles[el.getAttribute("data-id")] = today(); save(); break;
      case "set": setSetting(el.getAttribute("data-k"), el.getAttribute("data-v"), el.getAttribute("data-multi") === "1"); break;
      case "save-iv":
        var arr = document.getElementById("st-iv").value.split(/[,;\s]+/).filter(Boolean).map(Number);
        var okv = arr.length && arr.every(function (x, ix) { return x > 0 && Math.floor(x) === x && (ix === 0 || x > arr[ix - 1]); });
        if (!okv) { toast("Нужны целые числа по возрастанию, например 1, 3, 7, 14, 30"); return; }
        state.set.intervals = arr; state.reviews.forEach(function (r) { r.stage = Math.min(r.stage, arr.length - 1); }); save(); toast("Интервалы сохранены"); break;
      case "anchor": state.anchor = today(); state.mshift = 0; save(); break;
      case "ask": view.confirm = el.getAttribute("data-what"); break;
      case "cancel": view.confirm = null; break;
      case "reset-sura": delete state.suras[n]; state.reviews = state.reviews.filter(function (r) { return r.n !== n; }); if (state.current === n) state.current = null; view.confirm = null; save(); toast("Прогресс суры сброшен"); break;
      case "reset-all": stopAudio(true); state = blank(); view.tab = "today"; view.sura = null; view.confirm = null; view.ob = newOb(); applyTheme(); save(); break;
      case "rerun": view.ob = newOb(); break;
      case "copy": copyText(document.getElementById("bk").value, document.getElementById("bk")); return;
      case "import":
        try { var obj = migrate(JSON.parse(document.getElementById("bk").value)); if (!obj) throw new Error("bad"); state = obj; applyTheme(); save(); toast("Прогресс загружен"); }
        catch (e) { toast("В поле должен быть текст резервной копии"); return; }
        break;
      case "ob-seg":
        var sa = +el.getAttribute("data-a"), sb = +el.getAttribute("data-b");
        if (obCovered(n, sa, sb) === sb - sa + 1) obSubtract(n, sa, sb); else obSet(n, obRanges(n).concat([[sa, sb]]));
        if (view.ob.partial === n) view.ob.partial = null; break;
      case "ob-juz":
        var jz2 = +el.getAttribute("data-j"), on2 = obJuzState(jz2) === "on";
        juzSegs(jz2).forEach(function (sg) { if (on2) obSubtract(sg[0], sg[1], sg[2]); else obSet(sg[0], obRanges(sg[0]).concat([[sg[1], sg[2]]])); });
        break;
      case "ob-jopen": var jo = +el.getAttribute("data-j"); view.ob.jopen[jo] = !view.ob.jopen[jo]; break;
      case "ob-mode": view.ob.mode = el.getAttribute("data-v"); break;
      case "ob-partial": view.ob.partial = view.ob.partial === n ? null : n; break;
      case "ob-partial-ok":
        var pa = +document.getElementById("kp-a").value, pb = +document.getElementById("kp-b").value, cc = count(n);
        pa = Math.max(1, Math.min(cc, pa | 0)); pb = Math.max(pa, Math.min(cc, pb | 0));
        obSet(n, [[pa, pb]]); view.ob.partial = null; break;
      case "ob-preset":
        var pv = el.getAttribute("data-v"), from = pv === "amma" ? 78 : pv === "tabarak" ? 67 : 0;
        view.ob.picks = {}; view.ob.partial = null;
        if (from) for (var zq = from; zq <= 114; zq++) view.ob.picks[zq] = true;
        break;
      case "ob-back": obRead(); view.ob.step--; break;
      case "ob-next": obRead(); view.ob.step++; break;
      case "ob-finish":
        obRead();
        var o = view.ob;
        obPicked().forEach(function (m) {
          var p = o.picks[m], sm = S(m);
          if (p === true) { setDone(m, 1, count(m), true); sm.tr = o.tr; sm.tf = o.tf; sm.range = [1, count(m)]; }
          else { p.forEach(function (rr) { setDone(m, rr[0], rr[1], true); }); sm.range = null; sm.blocks = null; }
        });
        state.current = suggestNext(); state.setup = true; state.anchor = today(); state.started = today(); state.mshift = 0; state.mz = null; view.ob = null; view.tab = "today";
        if (state.current) { range(state.current); blocksOf(state.current); }
        checkMiles(true); save(); toast("План готов");
        break;
      default: return;
    }
    render();
  }
  function obRead() {
    var o = view.ob, el;
    if ((el = document.getElementById("ob-tr"))) o.tr = el.checked;
    if ((el = document.getElementById("ob-tf"))) o.tf = el.checked;
  }
  function copyText(txt, ta) {
    var fb = function () { if (ta) { ta.focus(); ta.select(); toast("Текст выделен — скопируйте его"); } else toast("Не удалось скопировать"); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(function () { toast("Скопировано"); }, fb);
    else fb();
  }
  function editBlock(n, i, f, val) {
    var bl = blocksOf(n), b = bl[i], r = range(n);
    val = Math.round(val);
    if (!val) return;
    if (f === "len") { f = "e"; val = b.s + val - 1; }
    if (f === "s") { var prev = bl[i - 1]; val = Math.max(prev.s + 1, Math.min(b.e, val)); b.s = val; prev.e = val - 1; }
    else {
      val = Math.max(b.s, Math.min(r[1] - 1, val)); b.e = val;
      var j = i + 1;
      while (j < bl.length) {
        var c = bl[j]; c.s = bl[j - 1].e + 1;
        if (c.s > c.e) { if (j === bl.length - 1) { c.e = r[1]; break; } bl.splice(j, 1); continue; }
        break;
      }
    }
    S(n).bsrc = "custom"; save(); render();
  }

  document.addEventListener("click", function (e) {
    var el = e.target.closest ? e.target.closest("[data-act]") : null;
    if (!el) return;
    var a = el.getAttribute("data-act");
    if (a === "peek") { el.classList.toggle("show"); return; }
    if (a === "close" && el.classList.contains("overlay") && e.target !== el) return;
    if (el.tagName === "A") e.preventDefault();
    act(a, el);
  });
  function keepFocus(id, fn) {
    var el = document.getElementById(id), pos = el ? el.selectionStart : 0;
    fn(); el = document.getElementById(id);
    if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (er) { /* ignore */ } }
  }
  document.addEventListener("input", function (e) {
    var el = e.target, k = el.getAttribute("data-k");
    if (el.id === "q") { view.q = el.value; keepFocus("q", render); return; }
    if (el.id === "obq") { view.ob.q = el.value; keepFocus("obq", renderOverlay); return; }
    if (el.id === "ls-note") { view.lesson.note = el.value; return; }
    if (el.id === "ls-hw") { view.lesson.hw.text = el.value; return; }
    if (el.classList.contains("ls-r") || el.classList.contains("ls-w")) {
      var lk = lsList(el.getAttribute("data-g"))[+el.getAttribute("data-k")];
      if (lk) {
        if (el.classList.contains("ls-w")) lk.w = el.value;
        else { var pr = parseRanges(el.value, count(lk.n)); if (pr.length) { lk.s = pr[0][0]; lk.e = pr[pr.length - 1][1]; } }
      }
      return;
    }
    if (el.id === "sp-a" || el.id === "sp-b" || el.id === "sp-k") { if (view.split) view.split[el.id.slice(3)] = +el.value; return; }
    if (el.classList.contains("note")) { S(+el.getAttribute("data-n")).note = el.value; save(); return; }
    if (el.classList.contains("bname")) { var n = +el.getAttribute("data-n"); blocksOf(n)[+el.getAttribute("data-i")].name = el.value; S(n).bsrc = "custom"; save(); return; }
    if (el.classList.contains("banchor")) { var an = S(+el.getAttribute("data-n")), as = el.getAttribute("data-s"); if (el.value.trim()) an.anchors[as] = el.value.trim(); else delete an.anchors[as]; save(); return; }
    if (el.type === "range" && k) {
      state.set[k] = +el.value; document.getElementById("out-" + k).textContent = FMT[k](el.value);
      if (k === "arSize" || k === "ruSize") applyTheme();
      if (k === "speed" && player.on) player.audio.playbackRate = state.set.speed;
      save(); return;
    }
    if (el.id === "st-name") { state.set.name = el.value.slice(0, 40); save(); }
  });
  document.addEventListener("change", function (e) {
    var el = e.target;
    if (el.classList.contains("bnum")) { var bn = +el.getAttribute("data-n"), bi = +el.getAttribute("data-i"), bf = el.getAttribute("data-f"), bv = +el.value; setTimeout(function () { editBlock(bn, bi, bf, bv); }, 0); return; }
    if (el.classList.contains("banchor")) { setTimeout(render, 0); return; }
    if (el.id === "st-listen") { state.set.listen = el.checked; save(); return; }
    if (el.id === "st-contrast") { state.set.contrast = el.checked; applyTheme(); save(); return; }
    if (el.classList.contains("ls-n")) { var lg2 = el.getAttribute("data-g"), la = lsList(lg2), lk2 = +el.getAttribute("data-k"), w0 = la[lk2].w; la[lk2] = lg2 === "learn" ? lsLearn(+el.value) : lsItem(+el.value); la[lk2].w = w0; renderOverlay(); return; }
    if (el.classList.contains("mdate")) { var id = el.getAttribute("data-id"); if (el.value) state.miles[id] = el.value; else delete state.miles[id]; save(); setTimeout(renderOverlay, 0); }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && (view.tafsir || view.pick || view.reader || view.sheet || view.celebrate)) { closeTop(); render(); }
  });

  registerSW();
  boot();
})();
