/* Хифз — трекер заучивания и повторения Корана.
 * Режимы хранения:
 *   • через server.py — прогресс в data/progress.json, тафсир кэшируется на диске;
 *   • отдельная страница (hifz.html, GitHub Pages) — прогресс в браузере.
 * Код без новейшего синтаксиса, чтобы работать и в не самых свежих браузерах.
 */
(function () {
  "use strict";
  var SURAS = window.HIFZ_SURAS, JUZ = window.HIFZ_JUZ, RECITERS = window.HIFZ_RECITERS;
  var Q = window.__HIFZ_QURAN__;
  var B = window.HifzBlocks;
  var TOTAL = Q.total, LPP = Q.total / 604; // букв на страницу мусхафа (в среднем)
  var DAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
  var DAYS_FULL = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];
  var KEY = "hifz.state.v2";
  var TAFSIR_URL = "https://cdn.jsdelivr.net/gh/spa5k/tafsir_api@main/tafsir/ru-tafsir-ibne-kahtir/";
  var NORMS = [[0.25, "¼ страницы"], [0.5, "½ страницы"], [1, "1 страница"]];
  var SIZES = [["short", "Короче"], ["std", "Стандартно"], ["long", "Длиннее"]];
  var PARTIAL_MIN = 20; // с какого числа аятов сура считается «большой» (можно знать частично)

  /* ---------------- даты ---------------- */
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ds(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function parse(s) { var p = s.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function today() { return ds(new Date()); }
  function addDays(s, n) { var d = parse(s); d.setDate(d.getDate() + n); return ds(d); }
  function diff(a, b) { return Math.round((parse(a) - parse(b)) / 86400000); }
  function weekday(s) { return (parse(s).getDay() + 6) % 7; } // 0 = Пн
  function nice(s) { return parse(s).toLocaleDateString("ru-RU", { day: "numeric", month: "long" }); }
  function niceShort(s) { return parse(s).toLocaleDateString("ru-RU", { day: "numeric", month: "short" }); }

  /* ---------------- состояние ---------------- */
  function defaults() {
    return {
      name: "", reciter: "sowaid", speed: 1, ayahRep: 3, blockRep: 2, pause: 2, listen: false,
      arSize: 30, ruSize: 15, blockSize: "std", intervals: [1, 3, 7, 14, 30],
      cycle: 7, weekStart: 0, ustaz: [], rest: [], direction: "end", norm: 0.5
    };
  }
  function blank() { return { v: 2, setup: false, set: defaults(), current: null, suras: {}, reviews: [], manzil: {}, anchor: today(), log: [] }; }
  function newOb() { return { step: 0, picks: {}, q: "", partial: null, tr: false, tf: false }; }
  var state = null, mode = "local";
  var view = { tab: "today", sura: null, filter: "all", q: "", openB: null, edit: null, check: {}, hint: {}, pick: false, tafsir: null, ob: null, confirm: null, rangeEdit: false };

  function S(n) {
    var s = state.suras[n];
    if (!s) s = state.suras[n] = { tr: false, tf: false, done: "", range: null, blocks: null, bsrc: null, note: "" };
    return s;
  }
  function rows(n) { return Q.suras[n - 1].a; }
  function lens(n) { return Q.suras[n - 1].len; }
  function count(n) { return SURAS[n - 1].ayahs; }

  /* заученность — строка из 0/1 по аятам */
  function doneStr(n) { var s = S(n); var c = count(n); if (s.done.length !== c) s.done = (s.done + new Array(c + 1).join("0")).slice(0, c); return s.done; }
  function isDone(n, a) { var s = state.suras[n]; return !!(s && s.done && s.done.charAt(a - 1) === "1"); }
  function setDone(n, a, b, v) {
    var d = doneStr(n).split("");
    for (var i = a; i <= b; i++) d[i - 1] = v ? "1" : "0";
    S(n).done = d.join("");
  }
  function doneCount(n, a, b) { var c = 0; a = a || 1; b = b || count(n); for (var i = a; i <= b; i++) if (isDone(n, i)) c++; return c; }
  function hifz(n) { var s = state.suras[n]; return !!(s && s.done && s.done.length === count(n) && s.done.indexOf("0") === -1); }
  function full(n) { var s = state.suras[n]; return !!(s && s.tr && s.tf && hifz(n)); }
  function lettersOf(n, a, b, onlyDone) {
    var L = lens(n), t = 0; a = a || 1; b = b || L.length;
    for (var i = a; i <= b; i++) if (!onlyDone || isDone(n, i)) t += L[i - 1];
    return t;
  }
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
    if (st.v === 2) {
      var d = defaults();
      st.set = st.set || {};
      for (var k in d) if (!(k in st.set)) st.set[k] = d[k];
      st.suras = st.suras || {}; st.reviews = st.reviews || []; st.manzil = st.manzil || {}; st.log = st.log || [];
      st.anchor = st.anchor || today();
      return st;
    }
    if (st.v === 1) {
      var nw = blank(); nw.setup = !!st.setup; nw.current = st.current; nw.manzil = st.manzil || {};
      Object.keys(st.suras || {}).forEach(function (key) {
        var o = st.suras[key], n = +key, c = count(n), dn = new Array(c + 1).join("0").split("");
        if (o.hifz) dn = new Array(c + 1).join("1").split("");
        else (o.blocks || []).forEach(function (b) { if (b.ok) for (var i = b.s; i <= b.e; i++) dn[i - 1] = "1"; });
        nw.suras[n] = { tr: !!o.tr, tf: !!o.tf, done: dn.join(""), range: null, blocks: null, bsrc: null, note: o.note || "" };
        if (o.phase === "review") nw.reviews.push({ id: n + ":1-" + c, n: n, s: 1, e: c, stage: o.stage || 0, next: o.next || today() });
      });
      return nw;
    }
    return null;
  }
  function boot() {
    var local = migrate(readLocal());
    var done = function (st) {
      state = st || blank();
      applyTheme();
      if (!state.setup) view.ob = newOb();
      render();
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

  /* ---------------- диапазон и блоки ---------------- */
  function defaultRange(n) {
    var c = count(n), f = firstUndone(n) || 1;
    if (c <= 40 && f === 1) return [1, c];
    var L = lens(n), sum = 0, e = f;
    while (e <= c && sum + L[e - 1] <= LPP * 2) { sum += L[e - 1]; e++; }
    return [f, Math.max(f, Math.min(c, e - 1))];
  }
  function range(n) { var s = S(n); if (!s.range) s.range = defaultRange(n); return s.range; }
  function autoBlocks(n) {
    var r = range(n), part = rows(n).slice(r[0] - 1, r[1]).map(function (x) { return { ar: x[0], ru: x[1] }; });
    return B.compute(part, { offset: r[0], size: state.set.blockSize });
  }
  function blocksOf(n) {
    var s = S(n);
    if (!s.blocks) { s.blocks = autoBlocks(n); s.bsrc = "auto"; }
    return s.blocks;
  }
  function blockDone(n, b) { return doneCount(n, b.s, b.e) === b.e - b.s + 1; }
  function setRange(n, a, b) {
    var s = S(n), c = count(n);
    a = Math.max(1, Math.min(c, a | 0)); b = Math.max(a, Math.min(c, b | 0));
    s.range = [a, b]; s.blocks = null; blocksOf(n);
  }
  function afterProgress(n) {
    var r = range(n);
    if (doneCount(n, r[0], r[1]) === r[1] - r[0] + 1) {
      addReview(n, r[0], r[1]);
      if (hifz(n)) {
        toast(full(n) ? "Сура «" + SURAS[n - 1].ru + "» заучена полностью!" : "Текст суры выучен. Осталось отметить перевод и тафсир");
        if (state.current === n) { state.current = suggestNext(); if (state.current) range(state.current); }
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

  /* ---------------- интервальные повторы ---------------- */
  function intervals() { return state.set.intervals && state.set.intervals.length ? state.set.intervals : [1, 3, 7, 14, 30]; }
  function addReview(n, a, b) {
    var id = n + ":" + a + "-" + b;
    if (state.reviews.some(function (r) { return r.id === id; })) return;
    state.reviews.push({ id: id, n: n, s: a, e: b, stage: 0, next: addDays(today(), intervals()[0]) });
  }
  function review(id, good) {
    var r = state.reviews.filter(function (x) { return x.id === id; })[0];
    if (!r) return;
    var iv = intervals();
    if (good) {
      r.stage += 1;
      if (r.stage >= iv.length) { state.reviews = state.reviews.filter(function (x) { return x.id !== id; }); toast("Отрывок перешёл в манзиль"); }
      else { r.next = addDays(today(), iv[r.stage]); toast("Следующий повтор — " + nice(r.next)); }
    } else {
      r.stage = Math.max(0, Math.min(r.stage, iv.length - 1) - 1);
      r.next = addDays(today(), iv[r.stage]);
      toast("Повторим ещё раз " + nice(r.next));
    }
    state.log.push({ d: today(), id: id, good: good });
    if (state.log.length > 500) state.log = state.log.slice(-500);
    save(); render();
  }
  function dueReviews() { var t = today(); return state.reviews.filter(function (r) { return r.next <= t; }).sort(function (a, b) { return a.next < b.next ? -1 : 1; }); }
  function rLabel(r) { return SURAS[r.n - 1].ru + (r.s === 1 && r.e === count(r.n) ? "" : " · " + r.s + "–" + r.e); }

  /* ---------------- манзиль (Аль-Фатиха не входит: её читают в каждом намазе) ---------------- */
  function cycleInfo(dateStr) {
    var cyc = state.set.cycle, t = dateStr || today(), idx;
    if (cyc === 7) idx = (weekday(t) - state.set.weekStart + 7) % 7;
    else idx = ((diff(t, state.anchor) % cyc) + cyc) % cyc;
    return { cyc: cyc, idx: idx, start: addDays(t, -idx) };
  }
  function dayLabel(i) { return state.set.cycle === 7 ? DAYS_FULL[(state.set.weekStart + i) % 7] : "День " + (i + 1); }
  function manzilParts() {
    var cyc = state.set.cycle, units = [], total = 0;
    SURAS.forEach(function (x) {
      if (x.n === 1) return;
      runs(x.n).forEach(function (r) { var l = lettersOf(x.n, r[0], r[1]); units.push({ n: x.n, s: r[0], e: r[1], w: l }); total += l; });
    });
    if (!units.length) return [];
    var cap = total / cyc * 0.5, fine = [];
    units.forEach(function (u) {
      if (u.w <= cap) { fine.push(u); return; }
      var L = lens(u.n), a = u.s, sum = 0;
      for (var i = u.s; i <= u.e; i++) {
        sum += L[i - 1];
        if (sum >= cap || i === u.e) { fine.push({ n: u.n, s: a, e: i, w: sum }); a = i + 1; sum = 0; }
      }
    });
    var k = Math.min(cyc, fine.length), n = fine.length, pre = [0];
    fine.forEach(function (u) { pre.push(pre[pre.length - 1] + u.w); });
    var dp = [], cut = [], j, i2;
    for (j = 0; j <= k; j++) { dp.push([]); cut.push([]); }
    for (i2 = 0; i2 <= n; i2++) dp[1][i2] = pre[i2];
    for (j = 2; j <= k; j++) for (i2 = j; i2 <= n; i2++) {
      var best = Infinity, bc = j - 1;
      for (var c = j - 1; c < i2; c++) { var v = Math.max(dp[j - 1][c], pre[i2] - pre[c]); if (v < best - 1e-9) { best = v; bc = c; } }
      dp[j][i2] = best; cut[j][i2] = bc;
    }
    var parts = [], end = n;
    for (j = k; j >= 1; j--) { var st = j === 1 ? 0 : cut[j][end]; parts.unshift(fine.slice(st, end)); end = st; }
    return parts.map(function (p) {
      var items = [];
      p.forEach(function (u) {
        var last = items[items.length - 1];
        if (last && last.n === u.n && last.e + 1 === u.s) { last.e = u.e; last.w += u.w; } else items.push({ n: u.n, s: u.s, e: u.e, w: u.w });
      });
      return { items: items, pages: p.reduce(function (a, u) { return a + u.w; }, 0) / LPP };
    });
  }
  function itemLabel(it) { return SURAS[it.n - 1].ru + (it.s === 1 && it.e === count(it.n) ? "" : " · " + it.s + "–" + it.e); }

  /* ---------------- статистика и прогноз ---------------- */
  function stats() {
    var f = 0, h = 0, ay = 0, let_ = 0;
    SURAS.forEach(function (x) {
      if (!state.suras[x.n]) return;
      var c = doneCount(x.n); ay += c; if (c) let_ += lettersOf(x.n, 1, count(x.n), true);
      if (hifz(x.n)) h++; if (full(x.n)) f++;
    });
    return { full: f, hifz: h, ayahs: ay, pct: let_ / TOTAL * 100 };
  }
  function isRest(dstr) { return state.set.rest.indexOf(weekday(dstr)) !== -1; }
  function finishDate(letters) {
    if (letters <= 0) return null;
    var perDay = state.set.norm * LPP, days = Math.ceil(letters / perDay), d = today(), guard = 0;
    while (days > 0 && guard < 4000) { if (!isRest(d)) days--; if (days > 0) d = addDays(d, 1); guard++; }
    return d;
  }
  function juzOf(n, a) { var j = 0; for (var i = 0; i < JUZ.length; i++) if (JUZ[i][0] < n || (JUZ[i][0] === n && JUZ[i][1] <= a)) j = i; return j; }
  function juzRemaining(j) {
    var st = JUZ[j], en = JUZ[j + 1] || [115, 1], sum = 0;
    for (var n = st[0]; n <= Math.min(114, en[0]); n++) {
      var a = n === st[0] ? st[1] : 1, b = n === en[0] ? en[1] - 1 : count(n);
      if (b >= a) sum += lettersOf(n, a, b) - lettersOf(n, a, b, true);
    }
    return sum;
  }

  /* ---------------- тафсир Ибн Касира ---------------- */
  var tafsirMem = {}, tafsirLoading = {}, idb = null;
  function idbOpen() {
    return new Promise(function (res) {
      try {
        var rq = indexedDB.open("hifz", 1);
        rq.onupgradeneeded = function () { rq.result.createObjectStore("tafsir"); };
        rq.onsuccess = function () { idb = rq.result; res(idb); };
        rq.onerror = function () { res(null); };
      } catch (e) { res(null); }
    });
  }
  function idbGet(k) {
    return (idb ? Promise.resolve(idb) : idbOpen()).then(function (db) {
      if (!db) return null;
      return new Promise(function (res) {
        try { var rq = db.transaction("tafsir").objectStore("tafsir").get(k); rq.onsuccess = function () { res(rq.result || null); }; rq.onerror = function () { res(null); }; } catch (e) { res(null); }
      });
    });
  }
  function idbSet(k, v) {
    (idb ? Promise.resolve(idb) : idbOpen()).then(function (db) {
      if (!db) return;
      try { db.transaction("tafsir", "readwrite").objectStore("tafsir").put(v, k); } catch (e) { /* ignore */ }
    });
  }
  var decoder = document.createElement("textarea");
  function cleanHtml(t) {
    t = String(t || "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<[^>]+>/g, "");
    decoder.innerHTML = t;
    return decoder.value.replace(/ /g, " ").replace(/\n{3,}/g, "\n\n").trim();
  }
  function parseTafsir(j) {
    var list = Array.isArray(j) ? j : (j && Array.isArray(j.ayahs) ? j.ayahs : (j && Array.isArray(j.verses) ? j.verses : null));
    var map = {};
    if (list) list.forEach(function (it) {
      var a = +(it.ayah || it.verse || it.ayah_number || it.verse_number || it.number);
      if (a) map[a] = cleanHtml(it.text || it.content || it.tafsir || "");
    });
    else if (j && (j.text || j.content)) map[+(j.ayah || j.verse || 0)] = cleanHtml(j.text || j.content);
    return map;
  }
  function getTafsir(n) {
    if (tafsirMem[n]) return Promise.resolve(tafsirMem[n]);
    if (tafsirLoading[n]) return tafsirLoading[n];
    var p = idbGet("t" + n).then(function (cached) {
      if (cached) return cached;
      var src = mode === "server" ? "api/tafsir/" + n : TAFSIR_URL + n + ".json";
      return fetch(src).then(function (r) { if (!r.ok) throw new Error("http " + r.status); return r.json(); })
        .then(function (j) { var m = parseTafsir(j); if (!Object.keys(m).length) throw new Error("empty"); idbSet("t" + n, m); return m; });
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
    player = { on: true, paused: false, n: n, list: list, i: 0, rep: 1, round: 1, audio: player.audio || new Audio(), timer: null, err: "",
      reps: Math.max(1, state.set.ayahRep), rounds: single ? 1 : Math.max(1, state.set.blockRep) };
    playCurrent(false);
    renderPlayer();
  }
  function playCurrent(alt) {
    var au = player.audio, a = player.list[player.i];
    au.onended = onEnded;
    au.onerror = function () {
      if (!alt && reciter().alt) { playCurrent(true); return; }
      player.err = "Аудио не загрузилось. Проверьте интернет или выберите другого чтеца.";
      player.paused = true; renderPlayer();
    };
    au.src = audioUrl(player.n, a, alt);
    au.playbackRate = state.set.speed;
    try { au.defaultPlaybackRate = state.set.speed; } catch (e) { /* ignore */ }
    var pr = au.play();
    if (pr && pr.catch) pr.catch(function () { /* обработает onerror */ });
    highlight();
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
    player.timer = setTimeout(function () { if (player.on && !player.paused) playCurrent(false); }, wait);
  }
  function stopAudio(silent) {
    clearTimeout(player.timer);
    if (player.audio) { try { player.audio.pause(); } catch (e) { /* ignore */ } player.audio.onended = null; player.audio.onerror = null; }
    player.on = false; player.paused = false;
    document.body.classList.remove("has-player");
    if (!silent) { renderPlayer(); highlight(); }
  }
  function togglePause() {
    if (!player.on) return;
    if (player.paused) { player.paused = false; player.err = ""; playCurrent(false); }
    else { player.paused = true; clearTimeout(player.timer); try { player.audio.pause(); } catch (e) { /* ignore */ } }
    renderPlayer();
  }
  function stepAyah(d) {
    if (!player.on) return;
    clearTimeout(player.timer);
    player.i = Math.max(0, Math.min(player.list.length - 1, player.i + d)); player.rep = 1; player.paused = false;
    playCurrent(false); renderPlayer();
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
        "повтор " + player.rep + " из " + player.reps + (player.rounds > 1 ? " · круг " + player.round + " из " + player.rounds : "")) +
      '</span></div><div class="pl-btns"><button class="pbtn" data-act="pl-prev" aria-label="Предыдущий аят">' + ICON.prev + '</button><button class="pbtn main" data-act="pl-toggle" aria-label="' + (player.paused ? "Продолжить" : "Пауза") + '">' + (player.paused ? ICON.play : ICON.pause) +
      '</button><button class="pbtn" data-act="pl-next" aria-label="Следующий аят">' + ICON.next + '</button><button class="pbtn" data-act="pl-stop" aria-label="Остановить">' + ICON.close + "</button></div></div>";
  }

  /* ---------------- UI-утилиты ---------------- */
  function esc(t) { return String(t == null ? "" : t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function plural(n, a, b, c) { var m = n % 10, h = n % 100; return (m === 1 && h !== 11) ? a : (m >= 2 && m <= 4 && (h < 10 || h >= 20)) ? b : c; }
  function arNum(n) { return String(n).replace(/\d/g, function (d) { return "٠١٢٣٤٥٦٧٨٩".charAt(+d); }); }
  function ayahsW(n) { return n + " " + plural(n, "аят", "аята", "аятов"); }
  function rng(a, b) { return a === b ? String(a) : a + "–" + b; }
  var ICON = {
    check: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    play: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>',
    pause: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/></svg>',
    close: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    prev: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h2v14H6zM20 5v14L9 12z"/></svg>',
    next: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16 5h2v14h-2zM4 5v14l11-7z"/></svg>',
    book: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20"/></svg>',
    chev: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
    redo: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>'
  };

  /* Медальон суры: тафсир — двойная рамка, перевод — золотая звезда, хифз — зелёная сердцевина; всё вместе — венец */
  function medal(n, size) {
    var s = state.suras[n] || {}, tf = !!s.tf, tr = !!s.tr, hz = hifz(n);
    var part = s.done ? doneCount(n) / count(n) : 0, fullM = tf && tr && hz;
    var star = "M32 6 L39.4 14.1 L50.4 13.6 L49.9 24.6 L58 32 L49.9 39.4 L50.4 50.4 L39.4 49.9 L32 58 L24.6 49.9 L13.6 50.4 L14.1 39.4 L6 32 L14.1 24.6 L13.6 13.6 L24.6 14.1 Z";
    var g = '<svg viewBox="0 0 64 64" aria-hidden="true">';
    if (fullM) for (var i = 0; i < 8; i++) { var ang = (i * 45 + 22.5) * Math.PI / 180; g += '<circle cx="' + (32 + 29.5 * Math.cos(ang)).toFixed(2) + '" cy="' + (32 + 29.5 * Math.sin(ang)).toFixed(2) + '" r="1.6" class="m-dot"/>'; }
    if (tf) g += '<circle cx="32" cy="32" r="27" class="m-ring"/><circle cx="32" cy="32" r="24.2" class="m-ring thin"/>';
    g += '<path d="' + star + '" class="m-star' + (tr ? " on" : "") + '"/>';
    if (tr) g += '<path d="' + star + '" class="m-star-in" transform="translate(32 32) scale(0.72) translate(-32 -32)"/>';
    if (hz) g += '<circle cx="32" cy="32" r="16" class="m-core"/>';
    else if (part > 0) {
      var R = 15, C = 2 * Math.PI * R;
      g += '<circle cx="32" cy="32" r="' + R + '" class="m-track"/><circle cx="32" cy="32" r="' + R + '" class="m-arc" stroke-dasharray="' + (C * part).toFixed(1) + " " + C.toFixed(1) + '" transform="rotate(-90 32 32)"/>';
    }
    g += "</svg>";
    return '<span class="medal' + (hz ? " hz" : "") + (fullM ? " full" : "") + (size ? " " + size : "") + (n >= 100 ? " d3" : "") + '">' + g + "<b>" + n + "</b></span>";
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
    document.documentElement.style.setProperty("--ar-size", (state ? state.set.arSize : 30) + "px");
    document.documentElement.style.setProperty("--ru-size", (state ? state.set.ruSize : 15) + "px");
  }
  function firstLetters(ar) {
    return ar.split(" ").map(function (w) {
      var m = w.match(/^[^ً-ٰٟۖ-ۭ][ً-ٰٟۖ-ۭٓ-ٕ]*/);
      if (!m || /^[ۖ-ۭ]+$/.test(w)) return w;
      return m[0] + "ـ";
    }).join(" ");
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
      return '<button class="step' + (on ? " on" : "") + '" data-act="pillar" data-k="' + key + '" data-n="' + n + '" aria-pressed="' + on + '"><i>' + (on ? ICON.check : "") + "</i>" + label + (extra ? '<span>' + extra + "</span>" : "") + "</button>";
    }
    return '<div class="steps">' + chip("tr", "Перевод", s.tr) + chip("tf", "Тафсир", s.tf) + chip("hz", "Хифз", hifz(n), hifz(n) ? "" : d + "/" + c) + "</div>";
  }

  /* ---------------- отрисовка ---------------- */
  function render() {
    if (!state) return;
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
  }

  function renderToday() {
    var t = today(), st = stats(), wd = weekday(t), set = state.set;
    var notes = [];
    if (set.ustaz.indexOf(wd) !== -1) notes.push("урок с устазом");
    if (isRest(t)) notes.push("без нового урока");
    var pct = st.pct < 10 ? st.pct.toFixed(2) : st.pct.toFixed(1);
    var R = 22, C = 2 * Math.PI * R;
    var h = '<div class="hello"><div><span class="eyebrow">' + DAYS_FULL[wd] + ", " + esc(nice(t)) + (notes.length ? " · " + notes.join(" · ") : "") + "</span>" +
      "<h1>" + (set.name ? "Ас-саляму алейкум, " + esc(set.name) : "Ас-саляму алейкум") + "</h1></div>" +
      '<div class="progress"><svg viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="' + R + '" class="pr-track"/><circle cx="26" cy="26" r="' + R + '" class="pr-arc" stroke-dasharray="' + (C * Math.min(st.pct, 100) / 100).toFixed(1) + " " + C.toFixed(1) + '" transform="rotate(-90 26 26)"/></svg>' +
      "<div><b>" + pct + '% Корана</b><span>' + st.hifz + " " + plural(st.hifz, "сура", "суры", "сур") + " наизусть · " + st.ayahs + " " + plural(st.ayahs, "аят", "аята", "аятов") + (st.full ? " · " + st.full + " полностью" : "") + "</span></div></div></div>";
    h += '<div class="day"><div class="col">' + (set.ustaz.indexOf(wd) !== -1 ? ustazNote() : "") + sabakCard() + '</div><div class="col">' + manzilCard() + sabqiCard() + "</div></div>";
    return h;
  }

  function ustazNote() {
    var n = state.current, due = dueReviews(), items = [];
    if (n) {
      var learned = blocksOf(n).filter(function (b) { return blockDone(n, b); });
      items.push("«" + SURAS[n - 1].ru + "»" + (learned.length ? ": аяты " + learned.map(function (b) { return rng(b.s, b.e); }).join(", ") : ""));
    }
    due.forEach(function (r) { items.push(rLabel(r)); });
    return '<div class="note-ustaz"><b>Сегодня урок с устазом.</b> Подготовьте: ' + (items.length ? esc(items.join("; ")) : "выученное за неделю") + ".</div>";
  }

  function sabakCard() {
    var n = state.current;
    var h = '<section class="card"><div class="card-title"><h2>Новое</h2>';
    if (!n) return h + '</div><p class="muted">Выберите суру, которую будете учить.</p><button class="btn primary" data-act="pick">Выбрать суру</button></section>';
    var x = SURAS[n - 1], s = S(n), r = range(n), bl = blocksOf(n);
    h += '<button class="link" data-act="pick">сменить</button></div>';
    h += '<button class="sura-line" data-act="open" data-n="' + n + '">' + medal(n, "md") + '<span class="sl-t"><b>' + esc(x.ru) + "</b><span>аяты " + rng(r[0], r[1]) + " из " + x.ayahs + '</span></span><span class="ar">' + esc(x.ar) + "</span></button>";
    h += stepChips(n);
    if (!s.tr || !s.tf) h += '<p class="hint">' + (!s.tr ? "Начните со смысла: прочитайте перевод суры целиком" : "Прочитайте тафсир: о чём сура и почему ниспослана") + ' — и отметьте шаг выше.</p>';
    var nb = -1;
    for (var i = 0; i < bl.length; i++) if (!blockDone(n, bl[i])) { nb = i; break; }
    h += '<ol class="blist">' + bl.map(function (b, i) {
      var dn = blockDone(n, b), cur = i === nb;
      var row = '<li class="brow' + (dn ? " done" : "") + (cur ? " cur" : "") + '"><button class="tick' + (dn ? " on" : "") + '" data-act="block-toggle" data-n="' + n + '" data-i="' + i + '" aria-label="' + (dn ? "Снять отметку" : "Отметить выученным") + '">' + ICON.check + "</button>" +
        '<button class="bmain" data-act="open-block" data-n="' + n + '" data-i="' + i + '"><span class="br">' + rng(b.s, b.e) + '</span><span class="bn">' + esc(b.name) + "</span></button>" +
        '<button class="icon" data-act="play-block" data-n="' + n + '" data-i="' + i + '" aria-label="Слушать блок">' + ICON.play + "</button>";
      return row + "</li>";
    }).join("") + "</ol>";
    if (nb >= 0 && nb > 0) h += '<p class="hint">Перед новым блоком прочитайте выученные подряд.</p>';
    var remS = lettersOf(n) - lettersOf(n, 1, count(n), true), j = juzOf(n, firstUndone(n) || 1), remJ = juzRemaining(j);
    var parts = [];
    if (remS > 0) parts.push("сура — " + nice(finishDate(remS)));
    if (remJ > 0) parts.push("джуз " + (j + 1) + " — " + nice(finishDate(remJ)));
    if (parts.length) h += '<p class="forecast">При вашей норме: ' + parts.join(", ") + "</p>";
    return h + "</section>";
  }

  function sabqiCard() {
    var due = dueReviews();
    var h = '<section class="card"><div class="card-title"><h2>Повторы</h2>' + (due.length ? '<span class="count">' + due.length + "</span>" : "") + "</div>";
    if (!due.length) {
      var up = state.reviews.slice().sort(function (a, b) { return a.next < b.next ? -1 : 1; })[0];
      return h + '<p class="muted">На сегодня нет.' + (up ? " Следующий: " + esc(rLabel(up)) + ", " + esc(niceShort(up.next)) + "." : "") + "</p></section>";
    }
    var t = today();
    h += '<ul class="rlist">' + due.map(function (r) {
      var late = diff(t, r.next);
      return '<li><button class="icon" data-act="play" data-n="' + r.n + '" data-a="' + r.s + '" data-b="' + r.e + '" aria-label="Слушать">' + ICON.play + '</button><span class="rl"><b>' + esc(rLabel(r)) + "</b>" + (late > 0 ? '<span class="late">просрочено на ' + late + " дн.</span>" : "") + "</span>" +
        '<span class="rbtns"><button class="btn sm primary" data-act="rev" data-id="' + r.id + '" data-good="1">Без ошибок</button><button class="btn sm" data-act="rev" data-id="' + r.id + '" data-good="0">С ошибками</button></span></li>';
    }).join("") + "</ul>";
    return h + "</section>";
  }

  function manzilCard() {
    var parts = manzilParts(), ci = cycleInfo(), t = today();
    var h = '<section class="card"><div class="card-title"><h2>Манзиль</h2>';
    if (!parts.length) return h + '</div><p class="muted">Когда выучите первый отрывок, он появится здесь.</p></section>';
    var p = parts[ci.idx], doneT = !!state.manzil[t];
    h += '<span class="muted small">' + esc(dayLabel(ci.idx)) + (p ? " · ≈ " + p.pages.toFixed(1) + " стр." : "") + "</span></div>";
    if (p) h += '<ul class="mlist">' + p.items.map(function (it) {
      return '<li><span class="ar">' + esc(SURAS[it.n - 1].ar) + "</span><span>" + esc(itemLabel(it)) + '</span><button class="icon" data-act="play" data-n="' + it.n + '" data-a="' + it.s + '" data-b="' + it.e + '" data-once="1" aria-label="Слушать">' + ICON.play + "</button></li>";
    }).join("") + "</ul>";
    else h += '<p class="muted">Свободный день: повторите слабые места.</p>';
    h += '<button class="btn ' + (doneT ? "done-btn" : "primary") + ' wide" data-act="manzil" data-d="' + t + '">' + (doneT ? ICON.check + " Прочитан" : "Отметить прочитанным") + "</button>";
    h += '<div class="week">';
    for (var i = 0; i < Math.min(ci.cyc, 14); i++) {
      var dd = addDays(ci.start, i);
      h += '<i class="' + (state.manzil[dd] ? "on" : "") + (dd === t ? " now" : "") + '" title="' + esc(dayLabel(i)) + '"></i>';
    }
    return h + "</div></section>";
  }

  function renderSuras() {
    var f = view.filter, q = view.q.trim().toLowerCase();
    var list = SURAS.filter(function (x) {
      var s = state.suras[x.n], hz = hifz(x.n), fl = full(x.n), any = s && (s.tr || s.tf || doneCount(x.n) > 0);
      if (f === "hifz" && !hz) return false;
      if (f === "learning" && (hz || !any)) return false;
      if (f === "none" && any) return false;
      if (q && x.ru.toLowerCase().indexOf(q) === -1 && String(x.n) !== q && x.ar.indexOf(q) === -1) return false;
      return true;
    });
    var ch = [["all", "Все"], ["hifz", "Наизусть"], ["learning", "Учу"], ["none", "Не начаты"]];
    var h = '<div class="page-head"><h1>Суры</h1><p class="muted small">Медальон растёт с каждым шагом: тафсир — рамка, перевод — звезда, хифз — зелёный центр.</p></div>';
    h += '<div class="filters"><input class="search" id="q" type="search" placeholder="Поиск" value="' + esc(view.q) + '">' +
      ch.map(function (c) { return '<button class="chip" data-act="filter" data-f="' + c[0] + '" aria-pressed="' + (f === c[0]) + '">' + c[1] + "</button>"; }).join("") + "</div>";
    h += '<div class="suras">' + list.map(function (x) {
      var dc = doneCount(x.n);
      return '<button class="sura" data-act="open" data-n="' + x.n + '">' + medal(x.n) + '<span class="st"><b>' + esc(x.ru) + '</b><span>' + (hifz(x.n) ? (full(x.n) ? "заучена полностью" : "наизусть") : dc ? dc + " из " + x.ayahs : ayahsW(x.ayahs)) + '</span></span><span class="ar">' + esc(x.ar) + "</span></button>";
    }).join("") + "</div>";
    if (!list.length) h += '<p class="muted center">Ничего не найдено</p>';
    return h;
  }

  function ayahHtml(n, a, opts) {
    var r = rows(n)[a - 1], ar = r[0];
    var hidden = opts.check && a >= opts.reveal;
    var arHtml = hidden ? '<div class="a hidden-ar">﴿' + arNum(a) + "﴾</div>" : '<div class="a" lang="ar" dir="rtl">' + esc(opts.hint ? firstLetters(ar) : ar) + ' <span class="no">﴿' + arNum(a) + "﴾</span></div>";
    return '<div class="ayah" id="ay-' + n + "-" + a + '">' + arHtml +
      (opts.check ? "" : '<div class="t">' + esc(r[1]) + "</div>") +
      '<div class="ay-tools"><span class="ay-n">' + a + '</span><button class="icon sm" data-act="play" data-n="' + n + '" data-a="' + a + '" data-b="' + a + '" aria-label="Слушать аят ' + a + '">' + ICON.play + '</button><button class="icon sm" data-act="tafsir" data-n="' + n + '" data-a="' + a + '" aria-label="Тафсир аята ' + a + '">' + ICON.book + "</button></div></div>";
  }

  function renderSura(n) {
    var x = SURAS[n - 1], s = S(n), bl = blocksOf(n), r = range(n), c = x.ayahs, d = doneCount(n);
    var h = '<div class="narrow"><button class="back" data-act="back">← Суры</button>';
    h += '<div class="detail-head">' + medal(n, "xl") + '<div class="dh-t"><h1>' + esc(x.ru) + '</h1><span class="muted small">' + ayahsW(c) + " · " + (x.medinan ? "мединская" : "мекканская") + " · джуз " + (juzOf(n, 1) + 1) + '</span></div><span class="ar">' + esc(x.ar) + "</span></div>";
    h += stepChips(n);
    if (state.current !== n && !hifz(n)) h += '<button class="btn primary wide" data-act="set-current" data-n="' + n + '">Учить эту суру</button>';

    // диапазон
    h += '<section class="card"><div class="card-title"><h2>Блоки</h2><span class="muted small">' + d + " из " + c + " выучено</span></div>";
    h += '<div class="range-line"><span>Учу аяты <b>' + rng(r[0], r[1]) + "</b></span>" + (view.rangeEdit ? "" : '<button class="link" data-act="range-edit">изменить</button>') + "</div>";
    if (view.rangeEdit) {
      h += '<div class="range-edit"><label>с <input type="number" id="ra" min="1" max="' + c + '" value="' + r[0] + '"></label><label>по <input type="number" id="rb" min="1" max="' + c + '" value="' + r[1] + '"></label>' +
        '<button class="btn sm primary" data-act="set-range" data-n="' + n + '">Учить этот диапазон</button><button class="btn sm" data-act="know-range" data-n="' + n + '">Я уже знаю эти аяты</button><button class="link" data-act="range-all" data-n="' + n + '">вся сура</button></div>';
    }
    h += '<div class="rangebar" aria-hidden="true">' + rangeBar(n, r) + "</div>";
    h += '<ol class="blist">' + bl.map(function (b, i) { return blockRow(n, b, i, bl.length); }).join("") + "</ol>";
    h += '<div class="foot-links"><button class="link" data-act="reset-blocks" data-n="' + n + '">Пересчитать блоки</button>' + (s.bsrc === "custom" ? '<span class="muted small">есть ваши правки</span>' : "") + "</div></section>";

    // повторение
    var mine = state.reviews.filter(function (q) { return q.n === n; });
    if (mine.length) {
      var iv = intervals();
      h += '<section class="card"><div class="card-title"><h2>Повторение</h2></div>' + mine.map(function (q) {
        var dots = [0].concat(iv).map(function (v, k) { return '<i class="' + (k <= q.stage ? "on" : k === q.stage + 1 ? "now" : "") + '" title="' + (k ? "+" + v + " дн." : "выучено") + '"></i>'; }).join("");
        return '<div class="rev"><div><b>Аяты ' + rng(q.s, q.e) + '</b><span class="muted small">следующий — ' + esc(nice(q.next)) + '</span><div class="dots">' + dots + "</div></div>" +
          (q.next <= today() ? '<span class="rbtns"><button class="btn sm primary" data-act="rev" data-id="' + q.id + '" data-good="1">Без ошибок</button><button class="btn sm" data-act="rev" data-id="' + q.id + '" data-good="0">С ошибками</button></span>' : "") + "</div>";
      }).join("") + "</section>";
    }

    h += '<section class="card"><div class="card-title"><h2>Конспект</h2><button class="link" data-act="tafsir" data-n="' + n + '" data-a="' + r[0] + '">тафсир Ибн Касира</button></div><textarea class="note" id="note-' + n + '" data-n="' + n + '" placeholder="О чём сура, главные мысли тафсира…">' + esc(s.note) + "</textarea></section>";
    h += '<div class="foot-links">' + (view.confirm === "sura" + n ? '<span class="warn-t">Сбросить прогресс суры?</span><button class="link warn" data-act="reset-sura" data-n="' + n + '">да, сбросить</button><button class="link" data-act="cancel">отмена</button>'
      : '<button class="link muted" data-act="ask" data-what="sura' + n + '">Сбросить прогресс суры</button>') + "</div>";
    return h + "</div>";
  }

  function rangeBar(n, r) {
    var c = count(n), out = "", step = c > 120 ? Math.ceil(c / 120) : 1;
    for (var a = 1; a <= c; a += step) {
      var e = Math.min(c, a + step - 1), dn = doneCount(n, a, e) === e - a + 1, inr = e >= r[0] && a <= r[1];
      out += '<i class="' + (dn ? "d" : "") + (inr ? " r" : "") + '"></i>';
    }
    return out;
  }

  function blockRow(n, b, i, total) {
    var key = n + ":" + i, open = view.openB === key, dn = blockDone(n, b);
    var h = '<li class="brow' + (dn ? " done" : "") + (open ? " open" : "") + '"><button class="tick' + (dn ? " on" : "") + '" data-act="block-toggle" data-n="' + n + '" data-i="' + i + '" aria-label="' + (dn ? "Снять отметку" : "Отметить выученным") + '">' + ICON.check + "</button>" +
      '<button class="bmain" data-act="toggle-block" data-n="' + n + '" data-i="' + i + '" aria-expanded="' + open + '"><span class="br">' + rng(b.s, b.e) + '</span><span class="bn">' + esc(b.name) + '</span><span class="chev">' + ICON.chev + "</span></button>";
    if (open) {
      var chk = view.check[key], hint = view.hint[key], edit = view.edit === key;
      h += '<div class="bbody"><div class="btools">' +
        '<button class="tool" data-act="play-block" data-n="' + n + '" data-i="' + i + '">' + ICON.play + " Слушать</button>" +
        '<button class="tool" data-act="check-mode" data-n="' + n + '" data-i="' + i + '" aria-pressed="' + !!chk + '">Проверка</button>' +
        '<button class="tool" data-act="hint-mode" data-n="' + n + '" data-i="' + i + '" aria-pressed="' + !!hint + '">Первые буквы</button>' +
        '<button class="tool" data-act="tafsir" data-n="' + n + '" data-a="' + b.s + '" data-b="' + b.e + '">Тафсир</button>' +
        '<button class="tool" data-act="edit-block" data-n="' + n + '" data-i="' + i + '" aria-pressed="' + edit + '">Изменить</button></div>';
      if (edit) {
        h += '<div class="bedit"><label class="full">Название<input type="text" class="bname" id="bn-' + n + "-" + i + '" data-n="' + n + '" data-i="' + i + '" value="' + esc(b.name) + '"></label>' +
          '<label>С аята<input type="number" class="bnum" id="bs-' + n + "-" + i + '" data-n="' + n + '" data-i="' + i + '" data-f="s" value="' + b.s + '"' + (i === 0 ? " disabled" : "") + "></label>" +
          '<label>По аят<input type="number" class="bnum" id="be-' + n + "-" + i + '" data-n="' + n + '" data-i="' + i + '" data-f="e" value="' + b.e + '"' + (i === total - 1 ? " disabled" : "") + "></label>" +
          '<label>Аятов<input type="number" class="bnum" id="bl-' + n + "-" + i + '" data-n="' + n + '" data-i="' + i + '" data-f="len" min="1" value="' + (b.e - b.s + 1) + '"' + (i === total - 1 ? " disabled" : "") + "></label>" +
          '<div class="bedit-btns">' + (b.e > b.s ? '<button class="btn sm" data-act="split" data-n="' + n + '" data-i="' + i + '">Разделить</button>' : "") +
          (i < total - 1 ? '<button class="btn sm" data-act="merge" data-n="' + n + '" data-i="' + i + '">Объединить со следующим</button>' : "") + "</div></div>";
      }
      var reveal = chk ? b.s + chk - 1 : 0;
      h += '<div class="text">';
      for (var a = b.s; a <= b.e; a++) h += ayahHtml(n, a, { check: !!chk, reveal: reveal, hint: !!hint });
      if (chk) h += '<div class="row center">' + (reveal <= b.e ? '<button class="btn sm primary" data-act="reveal" data-n="' + n + '" data-i="' + i + '">Открыть аят ' + reveal + "</button>" : '<span class="muted small">Все аяты открыты</span>') + "</div>";
      h += "</div></div>";
    }
    return h + "</li>";
  }

  function renderManzil() {
    var parts = manzilParts(), ci = cycleInfo(), t = today();
    var total = parts.reduce(function (a, p) { return a + p.pages; }, 0);
    var h = '<div class="page-head"><h1>Манзиль</h1><p class="muted small">Всё выученное (≈ ' + total.toFixed(1) + " стр.) разделено на " + ci.cyc + " частей, близких по объёму. Аль-Фатиха не входит — её читают в каждом намазе.</p></div>";
    if (!parts.length) return h + '<p class="muted">Пока нечего повторять.</p>';
    h += '<div class="manzil-grid">';
    for (var i = 0; i < ci.cyc; i++) {
      var p = parts[i], dd = addDays(ci.start, i), dn = !!state.manzil[dd];
      h += '<div class="mday' + (dd === t ? " today" : "") + (dn ? " done" : "") + '"><div class="md-head"><div><b>' + esc(dayLabel(i)) + '</b><span class="muted small">' + esc(niceShort(dd)) + (p ? " · ≈ " + p.pages.toFixed(1) + " стр." : "") + "</span></div>" +
        '<button class="tick lg' + (dn ? " on" : "") + '" data-act="manzil" data-d="' + dd + '" aria-label="' + esc(dayLabel(i)) + ': повторено" aria-pressed="' + dn + '">' + ICON.check + "</button></div>";
      if (p) h += "<ul>" + p.items.map(function (it) { return "<li>" + esc(itemLabel(it)) + "</li>"; }).join("") + "</ul>";
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
      '<div class="field"><label>Тема</label>' + chips("theme", [["system", "Системная"], ["light", "Светлая"], ["dark", "Тёмная"]], s.theme || "system") + "</div></section>";
    h += '<section class="card"><h2>Заучивание</h2>' +
      '<div class="field"><label>Новое в день</label>' + chips("norm", NORMS, s.norm) + "</div>" +
      '<div class="field"><label>Размер блока</label>' + chips("blockSize", SIZES, s.blockSize) + "</div>" +
      '<div class="field"><label>Направление</label>' + chips("direction", [["end", "С конца Корана"], ["start", "С начала"]], s.direction) + "</div>" +
      '<div class="field"><label for="st-iv">Интервалы повтора, дни</label><div class="inline"><input type="text" id="st-iv" value="' + intervals().join(", ") + '"><button class="btn sm" data-act="save-iv">Сохранить</button></div></div></section>';
    h += '<section class="card"><h2>Расписание</h2>' +
      '<div class="field"><label>Уроки с устазом</label>' + chips("ustaz", DAY_CHIPS, s.ustaz, true) + "</div>" +
      '<div class="field"><label>Без нового урока</label>' + chips("rest", DAY_CHIPS, s.rest, true) + "</div>" +
      '<div class="field"><label>Круг манзиля</label>' + chips("cycle", [[7, "7 дней"], [10, "10 дней"], [14, "14 дней"]], s.cycle) + "</div>" +
      (s.cycle === 7 ? '<div class="field"><label>Неделя начинается с</label>' + chips("weekStart", [[0, "Пн"], [5, "Сб"], [6, "Вс"]], s.weekStart) + "</div>"
        : '<div class="field"><label>Начало круга</label><div class="inline"><span class="muted">' + esc(nice(cycleInfo().start)) + '</span><button class="link" data-act="anchor">начать сегодня</button></div></div>') + "</section>";
    h += '<section class="card"><h2>Профиль и данные</h2><div class="field"><label for="st-name">Имя</label><input type="text" id="st-name" value="' + esc(s.name) + '" placeholder="Как к вам обращаться"></div>' +
      '<p class="muted small">' + (mode === "server" ? "Прогресс хранится в файле data/progress.json." : "Прогресс хранится в этом браузере. Сохраняйте резервную копию.") + "</p>" +
      '<details class="backup"><summary>Резервная копия</summary><textarea id="bk" spellcheck="false">' + esc(JSON.stringify(state)) + '</textarea><div class="inline"><button class="btn sm" data-act="copy">Скопировать</button><button class="btn sm" data-act="import">Загрузить из поля</button></div></details>' +
      '<div class="foot-links"><button class="link" data-act="rerun">Пройти настройку заново</button>' +
      (view.confirm === "all" ? '<span class="warn-t">Удалить всё?</span><button class="link warn" data-act="reset-all">да</button><button class="link" data-act="cancel">нет</button>' : '<button class="link muted" data-act="ask" data-what="all">Начать с нуля</button>') + "</div></section>";
    h += '<section class="card tips"><h2>Методика</h2><ul>' + [
      "Каждый день три чтения: новое, повторы по интервалам и манзиль.",
      "Сначала смысл: перевод суры целиком, затем тафсир, потом текст.",
      "Учите блоками по смыслу. Перед блоком скажите его смысл одной фразой.",
      "Слушайте одного чтеца с повторами, читайте вслух и не спеша.",
      "Выучили аят — прочитайте блок с начала. Связки между блоками учите отдельно.",
      "Проверяйте себя в режиме «Проверка», затем читайте устазу.",
      "Мало, но каждый день. В тяжёлый день пропустите новое, но не повторение."
    ].map(function (t) { return "<li>" + t + "</li>"; }).join("") + "</ul></section>";
    return h + "</div>";
  }

  /* ---------------- оверлеи ---------------- */
  function renderOverlay() {
    var o = document.getElementById("overlay");
    document.body.classList.toggle("locked", !!(view.ob || view.tafsir || view.pick));
    if (view.ob) { o.innerHTML = '<div class="overlay"><div class="sheet" role="dialog" aria-labelledby="ob-t">' + obHtml() + "</div></div>"; return; }
    if (view.tafsir) { o.innerHTML = '<div class="overlay" data-act="close"><div class="sheet" role="dialog" aria-labelledby="tf-t">' + tafsirHtml() + "</div></div>"; return; }
    if (view.pick) {
      var start = state.set.direction === "start", nx = suggestNext(), list = SURAS.slice();
      if (!start) list.reverse();
      list = list.filter(function (x) { return !hifz(x.n); });
      o.innerHTML = '<div class="overlay" data-act="close"><div class="sheet" role="dialog" aria-labelledby="pk-t"><div class="sheet-head"><h2 id="pk-t">Какую суру учить?</h2><button class="icon" data-act="close" aria-label="Закрыть">' + ICON.close + "</button></div>" +
        '<div class="sheet-body"><ul class="plist">' + list.map(function (x) {
          var dc = doneCount(x.n);
          return '<li><button data-act="set-current" data-n="' + x.n + '"><span class="pn">' + x.n + '</span><span class="pt"><b>' + esc(x.ru) + "</b><span>" + ayahsW(x.ayahs) + (dc ? " · выучено " + dc : "") + '</span></span><span class="ar">' + esc(x.ar) + "</span>" + (x.n === nx ? '<span class="tag">дальше</span>' : "") + "</button></li>";
        }).join("") + "</ul></div></div></div>";
      return;
    }
    o.innerHTML = "";
  }

  var OB_STEPS = ["Начало", "Что знаете", "Смысл", "План", "Расписание", "Чтец"];
  function obPicked() { return Object.keys(view.ob.picks).map(Number).sort(function (a, b) { return a - b; }); }
  function obHtml() {
    var o = view.ob, s = state.set, st = o.step;
    var h = '<div class="sheet-head ob"><div class="ob-dots">' + OB_STEPS.map(function (t, i) { return '<i class="' + (i < st ? "done" : i === st ? "now" : "") + '"></i>'; }).join("") + "</div></div>";
    h += '<div class="sheet-body">';
    if (st === 0) {
      h += '<div class="ob-hero"><span class="ar">بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ</span><h2 id="ob-t">Настроим Хифз под вас</h2><p class="muted">Несколько вопросов — и приложение составит план: что учить, когда повторять и как распределить выученное по дням.</p></div>' +
        '<div class="field"><label for="st-name">Как к вам обращаться</label><input type="text" id="st-name" value="' + esc(s.name) + '" placeholder="Имя, можно пропустить"></div>';
    } else if (st === 1) {
      var picked = obPicked(), partial = picked.filter(function (n) { return o.picks[n] !== true; }).length;
      h += '<h2 id="ob-t">Что вы уже знаете наизусть?</h2><p class="muted small">Отметьте суры. Если большую суру знаете не целиком — нажмите «Частично» и укажите аяты.</p>' +
        '<div class="presets"><button class="chip" data-act="ob-preset" data-v="amma">Джуз Амма (78–114)</button><button class="chip" data-act="ob-preset" data-v="tabarak">Таббарак и Амма (67–114)</button><button class="chip" data-act="ob-preset" data-v="none">Очистить</button></div>' +
        '<input class="search" id="obq" type="search" placeholder="Найти суру" value="' + esc(o.q) + '">' +
        '<ul class="known">' + SURAS.slice().reverse().filter(function (x) {
          var q = o.q.trim().toLowerCase(); return !q || x.ru.toLowerCase().indexOf(q) !== -1 || String(x.n) === q;
        }).map(function (x) {
          var p = o.picks[x.n], whole = p === true, part = p && p !== true, editing = o.partial === x.n;
          var r = '<li class="' + (p ? "on" : "") + '"><button class="kmain" data-act="ob-pick" data-n="' + x.n + '" aria-pressed="' + !!p + '"><i class="kbox">' + (whole ? ICON.check : part ? "½" : "") + '</i><span class="kn">' + x.n + '</span><span class="kt"><b>' + esc(x.ru) + "</b><span>" + (part ? "аяты " + rng(p[0], p[1]) + " из " + x.ayahs : ayahsW(x.ayahs)) + '</span></span><span class="ar">' + esc(x.ar) + "</span></button>";
          if (x.ayahs >= PARTIAL_MIN) r += '<button class="kpart' + (part ? " on" : "") + '" data-act="ob-partial" data-n="' + x.n + '">Частично</button>';
          if (editing) {
            var cur = part ? p : [1, Math.min(x.ayahs, 10)];
            r += '<div class="kedit"><span>Знаю аяты</span><label>с <input type="number" id="kp-a" min="1" max="' + x.ayahs + '" value="' + cur[0] + '"></label><label>по <input type="number" id="kp-b" min="1" max="' + x.ayahs + '" value="' + cur[1] + '"></label><button class="btn sm primary" data-act="ob-partial-ok" data-n="' + x.n + '">Готово</button></div>';
          }
          return r + "</li>";
        }).join("") + "</ul>" +
        '<p class="muted small sel">' + (picked.length ? "Отмечено: " + picked.length + " " + plural(picked.length, "сура", "суры", "сур") + (partial ? ", из них частично " + partial : "") : "Ничего не отмечено — начнём с нуля") + "</p>";
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
    var t = view.tafsir, n = t.n, a = t.a, b = t.b || t.a, x = SURAS[n - 1], m = tafsirMem[n];
    var h = '<div class="sheet-head"><div><h2 id="tf-t">Тафсир Ибн Касира</h2><span class="muted small">' + esc(x.ru) + ", " + (a === b ? "аят " + a : "аяты " + a + "–" + b) + '</span></div><button class="icon" data-act="close" aria-label="Закрыть">' + ICON.close + "</button></div>";
    h += '<div class="sheet-body">';
    for (var k = a; k <= b; k++) {
      var r = rows(n)[k - 1];
      h += '<div class="ayah compact"><div class="a" lang="ar" dir="rtl">' + esc(r[0]) + ' <span class="no">﴿' + arNum(k) + '﴾</span></div><div class="t">' + esc(r[1]) + "</div></div>";
      if (m) {
        if (m[k]) h += '<div class="tafsir-text">' + esc(m[k]).replace(/\n/g, "<br>") + "</div>";
        else if (a === b) h += '<p class="muted small">Толкование этого аята дано вместе с соседними — смотрите предыдущий аят.</p>';
      }
    }
    if (!m) {
      if (t.err) h += '<div class="empty">' + esc(t.err) + '<div class="row center"><button class="btn sm primary" data-act="tafsir-retry">Повторить</button><a class="btn sm" href="https://quran.com/ru/' + n + ":" + a + '/tafsirs" target="_blank" rel="noopener">quran.com</a></div></div>';
      else h += '<div class="empty">Загружаю тафсир…</div>';
    }
    h += "</div>";
    h += '<div class="sheet-foot">' + (a > 1 ? '<button class="btn sm" data-act="tafsir-step" data-d="-1">← Аят ' + (a - 1) + "</button>" : "<span></span>") +
      (m ? '<button class="link" data-act="tafsir-copy">копировать</button>' : "") +
      (b < count(n) ? '<button class="btn sm" data-act="tafsir-step" data-d="1">Аят ' + (b + 1) + " →</button>" : "<span></span>") + "</div>";
    return h;
  }
  function openTafsir(n, a, b) {
    view.tafsir = { n: n, a: a, b: b || a, err: "" };
    render();
    if (tafsirMem[n]) return;
    getTafsir(n).then(function () { if (view.tafsir && view.tafsir.n === n) render(); }, function () {
      getTafsirAyah(n, a).then(function (txt) {
        tafsirMem[n] = tafsirMem[n] || {}; tafsirMem[n][a] = txt; if (view.tafsir) render();
      }, function () {
        if (view.tafsir && view.tafsir.n === n) { view.tafsir.err = "Не удалось загрузить тафсир. Проверьте интернет."; render(); }
      });
    });
  }

  /* ---------------- действия ---------------- */
  function setSetting(k, v, multi) {
    var s = state.set;
    if (multi) { v = +v; var arr = s[k].slice(), ix = arr.indexOf(v); if (ix === -1) arr.push(v); else arr.splice(ix, 1); s[k] = arr.sort(); }
    else if (k === "norm" || k === "cycle" || k === "weekStart") s[k] = +v;
    else s[k] = v;
    if (k === "theme") applyTheme();
    if (k === "cycle") state.anchor = today();
    if (k === "blockSize") Object.keys(state.suras).forEach(function (n) { var x = state.suras[n]; if (x.bsrc !== "custom") x.blocks = null; });
    if (k === "reciter" && player.on) stopAudio();
    save();
  }

  function act(a, el) {
    var n = +el.getAttribute("data-n"), i = +el.getAttribute("data-i"), s = n ? S(n) : null, bl, b;
    switch (a) {
      case "tab": view.tab = el.getAttribute("data-tab"); view.sura = null; view.confirm = null; window.scrollTo(0, 0); break;
      case "open": view.sura = n; view.confirm = null; view.openB = null; view.edit = null; view.rangeEdit = false; window.scrollTo(0, 0); break;
      case "open-block": view.sura = n; view.openB = n + ":" + i; view.edit = null; view.rangeEdit = false; window.scrollTo(0, 0); break;
      case "toggle-block": var key = n + ":" + i; view.openB = view.openB === key ? null : key; view.edit = null; break;
      case "edit-block": var ek = n + ":" + i; view.edit = view.edit === ek ? null : ek; break;
      case "back": view.sura = null; view.tab = "suras"; break;
      case "filter": view.filter = el.getAttribute("data-f"); break;
      case "pillar":
        var k = el.getAttribute("data-k");
        if (k === "hz") {
          if (hifz(n)) { setDone(n, 1, count(n), false); state.reviews = state.reviews.filter(function (r) { return r.n !== n; }); s.range = null; s.blocks = null; }
          else { setDone(n, 1, count(n), true); s.range = [1, count(n)]; s.blocks = null; afterProgress(n); }
        } else { s[k] = !s[k]; if (s[k] && full(n)) toast("Сура «" + SURAS[n - 1].ru + "» заучена полностью"); }
        save(); break;
      case "block-toggle":
        b = blocksOf(n)[i];
        var on = !blockDone(n, b);
        setDone(n, b.s, b.e, on);
        if (on) { toast("Блок " + rng(b.s, b.e) + " выучен"); afterProgress(n); }
        save(); break;
      case "range-edit": view.rangeEdit = true; break;
      case "set-range":
        setRange(n, +document.getElementById("ra").value, +document.getElementById("rb").value);
        view.rangeEdit = false; view.openB = null; save(); toast("Блоки построены по аятам " + rng(s.range[0], s.range[1])); break;
      case "know-range":
        var ka = +document.getElementById("ra").value, kb = +document.getElementById("rb").value, c0 = count(n);
        ka = Math.max(1, Math.min(c0, ka | 0)); kb = Math.max(ka, Math.min(c0, kb | 0));
        setDone(n, ka, kb, true); s.range = null; s.blocks = null; range(n); blocksOf(n);
        view.rangeEdit = false; save(); toast("Аяты " + rng(ka, kb) + " отмечены выученными");
        if (hifz(n) && state.current === n) { state.current = suggestNext(); }
        break;
      case "range-all": setRange(n, 1, count(n)); view.rangeEdit = false; view.openB = null; save(); break;
      case "set-current": state.current = n; view.pick = false; range(n); blocksOf(n); save(); toast("Учим «" + SURAS[n - 1].ru + "»"); break;
      case "pick": view.pick = true; break;
      case "close": view.pick = false; view.tafsir = null; break;
      case "check-mode": var ck = n + ":" + i; view.check[ck] = view.check[ck] ? 0 : 1; break;
      case "hint-mode": var hk = n + ":" + i; view.hint[hk] = !view.hint[hk]; break;
      case "reveal": view.check[n + ":" + i]++; break;
      case "split":
        bl = blocksOf(n); b = bl[i]; var mid = Math.floor((b.s + b.e + 1) / 2);
        bl.splice(i + 1, 0, { s: mid, e: b.e, name: B.title(rows(n)[mid - 1][1], mid, b.e) }); b.e = mid - 1; s.bsrc = "custom"; save(); break;
      case "merge": bl = blocksOf(n); bl[i].e = bl[i + 1].e; bl.splice(i + 1, 1); s.bsrc = "custom"; save(); break;
      case "reset-blocks": s.blocks = null; s.bsrc = null; blocksOf(n); view.openB = null; view.edit = null; save(); toast("Блоки пересчитаны"); break;
      case "play": playRange(n, +el.getAttribute("data-a"), +el.getAttribute("data-b"), true); return;
      case "play-block": b = blocksOf(n)[i]; playRange(n, b.s, b.e, false); return;
      case "pl-toggle": togglePause(); return;
      case "pl-stop": stopAudio(); return;
      case "pl-prev": stepAyah(-1); return;
      case "pl-next": stepAyah(1); return;
      case "tafsir": openTafsir(n, +el.getAttribute("data-a"), +el.getAttribute("data-b") || 0); return;
      case "tafsir-step":
        var t = view.tafsir, d = +el.getAttribute("data-d"), na = d > 0 ? (t.b || t.a) + 1 : t.a - 1;
        openTafsir(t.n, na, na); return;
      case "tafsir-retry": var tr = view.tafsir; delete tafsirMem[tr.n]; openTafsir(tr.n, tr.a, tr.b); return;
      case "tafsir-copy":
        var tv = view.tafsir, txt = SURAS[tv.n - 1].ru + "\n";
        for (var q = tv.a; q <= tv.b; q++) { var rr = rows(tv.n)[q - 1]; txt += "\n" + q + ". " + rr[0] + "\n" + rr[1] + "\n" + (tafsirMem[tv.n][q] ? "\nТафсир Ибн Касира:\n" + tafsirMem[tv.n][q] + "\n" : ""); }
        copyText(txt); return;
      case "rev": review(el.getAttribute("data-id"), el.getAttribute("data-good") === "1"); return;
      case "manzil": var dd = el.getAttribute("data-d"); if (state.manzil[dd]) delete state.manzil[dd]; else { state.manzil[dd] = true; toast("Отмечено"); } save(); break;
      case "set": setSetting(el.getAttribute("data-k"), el.getAttribute("data-v"), el.getAttribute("data-multi") === "1"); break;
      case "save-iv":
        var arr = document.getElementById("st-iv").value.split(/[,;\s]+/).filter(Boolean).map(Number);
        var okv = arr.length && arr.every(function (v, ix) { return v > 0 && Math.floor(v) === v && (ix === 0 || v > arr[ix - 1]); });
        if (!okv) { toast("Нужны целые числа по возрастанию, например 1, 3, 7, 14, 30"); return; }
        state.set.intervals = arr; state.reviews.forEach(function (r) { r.stage = Math.min(r.stage, arr.length - 1); }); save(); toast("Интервалы сохранены"); break;
      case "anchor": state.anchor = today(); save(); break;
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
      /* мастер настройки */
      case "ob-pick": var op = view.ob.picks; if (op[n]) delete op[n]; else op[n] = true; if (view.ob.partial === n) view.ob.partial = null; break;
      case "ob-partial": view.ob.partial = view.ob.partial === n ? null : n; break;
      case "ob-partial-ok":
        var pa = +document.getElementById("kp-a").value, pb = +document.getElementById("kp-b").value, cc = count(n);
        pa = Math.max(1, Math.min(cc, pa | 0)); pb = Math.max(pa, Math.min(cc, pb | 0));
        view.ob.picks[n] = pa === 1 && pb === cc ? true : [pa, pb]; view.ob.partial = null; break;
      case "ob-preset":
        var pv = el.getAttribute("data-v"), from = pv === "amma" ? 78 : pv === "tabarak" ? 67 : 0;
        view.ob.picks = {}; view.ob.partial = null;
        if (from) for (var z = from; z <= 114; z++) view.ob.picks[z] = true;
        break;
      case "ob-back": obRead(); view.ob.step--; break;
      case "ob-next": obRead(); view.ob.step++; break;
      case "ob-finish":
        obRead();
        var o = view.ob;
        obPicked().forEach(function (m) {
          var p = o.picks[m], sm = S(m);
          if (p === true) { setDone(m, 1, count(m), true); sm.tr = o.tr; sm.tf = o.tf; sm.range = [1, count(m)]; }
          else { setDone(m, p[0], p[1], true); sm.range = null; sm.blocks = null; }
        });
        state.current = suggestNext(); state.setup = true; state.anchor = today(); view.ob = null; view.tab = "today";
        if (state.current) { range(state.current); blocksOf(state.current); }
        save(); toast("План готов");
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

  /* правка границ блока: соседние блоки подстраиваются */
  function editBlock(n, i, f, val) {
    var bl = blocksOf(n), b = bl[i], r = range(n);
    val = Math.round(val);
    if (!val) return;
    if (f === "len") { f = "e"; val = b.s + val - 1; }
    if (f === "s") {
      var prev = bl[i - 1];
      val = Math.max(prev.s + 1, Math.min(b.e, val));
      b.s = val; prev.e = val - 1;
    } else {
      val = Math.max(b.s, Math.min(r[1] - 1, val));
      b.e = val;
      var j = i + 1;
      while (j < bl.length) {
        var c = bl[j];
        c.s = bl[j - 1].e + 1;
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
    if (el.classList.contains("note")) { S(+el.getAttribute("data-n")).note = el.value; save(); return; }
    if (el.classList.contains("bname")) { var n = +el.getAttribute("data-n"); blocksOf(n)[+el.getAttribute("data-i")].name = el.value; S(n).bsrc = "custom"; save(); return; }
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
    if (el.classList.contains("bnum")) { editBlock(+el.getAttribute("data-n"), +el.getAttribute("data-i"), el.getAttribute("data-f"), +el.value); return; }
    if (el.id === "st-listen") { state.set.listen = el.checked; save(); }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && (view.tafsir || view.pick)) { view.tafsir = null; view.pick = false; render(); }
  });

  boot();
})();
