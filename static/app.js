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
  var state = null, mode = "local";
  var view = { tab: "today", sura: null, filter: "all", q: "", open: {}, check: {}, hint: {}, pick: false, tafsir: null, ob: null, confirm: null };

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
  function hifz(n) { var s = state.suras[n]; return !!(s && s.done && s.done.indexOf("0") === -1 && s.done.length === count(n)); }
  function full(n) { var s = state.suras[n]; return !!(s && s.tr && s.tf && hifz(n)); }
  function lettersOf(n, a, b, onlyDone) {
    var L = lens(n), t = 0; a = a || 1; b = b || L.length;
    for (var i = a; i <= b; i++) if (!onlyDone || isDone(n, i)) t += L[i - 1];
    return t;
  }
  function runs(n) { // непрерывные выученные отрезки
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
    if (st.v === 1) { // перенос из первой версии
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
      if (!state.setup) view.ob = { step: 0, known: "none", from: 78, to: 1, picks: {}, tr: false, tf: false };
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
    if (c <= 40) return [1, c];
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
  /* выученный диапазон → интервальные повторы; вся сура → следующая сура */
  function afterProgress(n) {
    var r = range(n);
    if (doneCount(n, r[0], r[1]) === r[1] - r[0] + 1) {
      addReview(n, r[0], r[1]);
      if (hifz(n)) {
        toast(full(n) ? "Сура «" + SURAS[n - 1].ru + "» заучена полностью! Первый повтор — завтра"
          : "Текст суры выучен. Для статуса «заучена полностью» отметьте перевод и тафсир");
        if (state.current === n) state.current = suggestNext();
      } else {
        S(n).range = defaultRange(n); S(n).blocks = null; blocksOf(n);
        toast("Диапазон выучен. Следующий: аяты " + S(n).range[0] + "–" + S(n).range[1]);
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
      if (r.stage >= iv.length) {
        state.reviews = state.reviews.filter(function (x) { return x.id !== id; });
        toast("Отрывок перешёл в манзиль");
      } else { r.next = addDays(today(), iv[r.stage]); toast("Следующий повтор: " + nice(r.next)); }
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
  function rLabel(r) { return SURAS[r.n - 1].ru + (r.s === 1 && r.e === count(r.n) ? "" : ", аяты " + r.s + "–" + r.e); }

  /* ---------------- манзиль ---------------- */
  function cycleInfo(dateStr) {
    var cyc = state.set.cycle, t = dateStr || today(), idx, start;
    if (cyc === 7) { idx = (weekday(t) - state.set.weekStart + 7) % 7; }
    else { idx = ((diff(t, state.anchor) % cyc) + cyc) % cyc; }
    start = addDays(t, -idx);
    return { cyc: cyc, idx: idx, start: start };
  }
  function dayLabel(i) {
    if (state.set.cycle === 7) return DAYS_FULL[(state.set.weekStart + i) % 7];
    return "День " + (i + 1);
  }
  function manzilParts() {
    var cyc = state.set.cycle, units = [], total = 0;
    SURAS.forEach(function (x) { runs(x.n).forEach(function (r) { var l = lettersOf(x.n, r[0], r[1]); units.push({ n: x.n, s: r[0], e: r[1], w: l }); total += l; }); });
    if (!units.length) return [];
    var cap = total / cyc * 0.5, fine = [];
    units.forEach(function (u) { // большие отрывки режем по аятам, чтобы части были ровнее
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
  function itemLabel(it) { return SURAS[it.n - 1].ru + (it.s === 1 && it.e === count(it.n) ? "" : " " + it.s + "–" + it.e); }

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
  function juzOf(n, a) {
    var j = 0;
    for (var i = 0; i < JUZ.length; i++) if (JUZ[i][0] < n || (JUZ[i][0] === n && JUZ[i][1] <= a)) j = i;
    return j;
  }
  function juzRemaining(j) {
    var st = JUZ[j], en = JUZ[j + 1] || [115, 1], sum = 0;
    for (var n = st[0]; n <= Math.min(114, en[0]); n++) {
      var a = n === st[0] ? st[1] : 1, b = n === en[0] ? en[1] - 1 : count(n);
      if (b >= a) sum += lettersOf(n, a, b) - lettersOf(n, a, b, true);
    }
    return sum;
  }

  /* ---------------- тафсир Ибн Касира ---------------- */
  var tafsirMem = {}, tafsirLoading = {};
  var idb = null;
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
        .then(function (j) {
          var m = parseTafsir(j);
          if (!Object.keys(m).length) throw new Error("empty");
          idbSet("t" + n, m);
          return m;
        });
    }).then(function (m) { tafsirMem[n] = m; delete tafsirLoading[n]; return m; },
      function (e) { delete tafsirLoading[n]; throw e; });
    tafsirLoading[n] = p;
    return p;
  }
  function getTafsirAyah(n, a) { // запасной путь: файл одного аята
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
      reps: single ? Math.max(1, state.set.ayahRep) : state.set.ayahRep, rounds: single ? 1 : state.set.blockRep };
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
    if (pr && pr.catch) pr.catch(function () { /* ошибка обработается в onerror */ });
    highlight();
  }
  function onEnded() {
    var au = player.audio, wait = state.set.pause * 1000;
    if (state.set.listen && au.duration && isFinite(au.duration)) wait += au.duration * 1000 / state.set.speed; // «слушай и повторяй»
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
    var a = player.list[player.i];
    el.hidden = false;
    el.innerHTML = '<div class="pl-in"><div class="pl-info"><b>' + esc(SURAS[player.n - 1].ru) + ", аят " + a + '</b><span>' +
      (player.err ? '<span class="err">' + esc(player.err) + "</span>" :
        esc(reciter().name) + " · повтор " + player.rep + "/" + player.reps + (player.rounds > 1 ? " · круг " + player.round + "/" + player.rounds : "") + (state.set.listen ? " · слушай и повторяй" : "")) +
      '</span></div><div class="pl-btns"><button class="pbtn" data-act="pl-prev" aria-label="Предыдущий аят">' + ICON.prev + '</button><button class="pbtn main" data-act="pl-toggle" aria-label="' + (player.paused ? "Продолжить" : "Пауза") + '">' + (player.paused ? ICON.play : ICON.pause) +
      '</button><button class="pbtn" data-act="pl-next" aria-label="Следующий аят">' + ICON.next + '</button><button class="pbtn" data-act="pl-stop" aria-label="Остановить">' + ICON.stop + "</button></div></div>";
  }

  /* ---------------- UI-утилиты ---------------- */
  function esc(t) { return String(t == null ? "" : t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function plural(n, a, b, c) { var m = n % 10, h = n % 100; return (m === 1 && h !== 11) ? a : (m >= 2 && m <= 4 && (h < 10 || h >= 20)) ? b : c; }
  function arNum(n) { return String(n).replace(/\d/g, function (d) { return "\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669".charAt(+d); }); }
  function ayahsW(n) { return n + " " + plural(n, "аят", "аята", "аятов"); }
  var ICON = {
    check: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    play: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>',
    pause: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/></svg>',
    stop: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>',
    prev: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h2v14H6zM20 5v14L9 12z"/></svg>',
    next: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16 5h2v14h-2zM4 5v14l11-7z"/></svg>',
    info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5" stroke-linecap="round"/></svg>',
    eye: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>'
  };

  /* Медальон суры: каждый из трёх пунктов добавляет свой слой.
     Тафсир — двойная рамка, перевод — золотая восьмиконечная звезда, хифз — зелёный центр. */
  function medal(n, size) {
    var s = state.suras[n] || {}, tf = !!s.tf, tr = !!s.tr, hz = hifz(n);
    var part = s.done ? doneCount(n) / count(n) : 0, fullM = tf && tr && hz;
    var star = "M32 6 L39.4 14.1 L50.4 13.6 L49.9 24.6 L58 32 L49.9 39.4 L50.4 50.4 L39.4 49.9 L32 58 L24.6 49.9 L13.6 50.4 L14.1 39.4 L6 32 L14.1 24.6 L13.6 13.6 L24.6 14.1 Z";
    var g = '<svg viewBox="0 0 64 64" aria-hidden="true">';
    if (fullM) { // завершённый медальон: венец из точек
      for (var i = 0; i < 8; i++) { var ang = (i * 45 + 22.5) * Math.PI / 180; g += '<circle cx="' + (32 + 29.5 * Math.cos(ang)).toFixed(2) + '" cy="' + (32 + 29.5 * Math.sin(ang)).toFixed(2) + '" r="1.6" class="m-dot"/>'; }
    }
    if (tf) g += '<circle cx="32" cy="32" r="27" class="m-ring"/><circle cx="32" cy="32" r="24.2" class="m-ring thin"/>';
    g += '<path d="' + star + '" class="m-star' + (tr ? " on" : "") + '"/>';
    if (tr) g += '<path d="' + star + '" class="m-star-in" transform="translate(32 32) scale(0.72) translate(-32 -32)"/>';
    if (hz) g += '<circle cx="32" cy="32" r="16" class="m-core"/>';
    else if (part > 0) {
      var R = 15, C = 2 * Math.PI * R;
      g += '<circle cx="32" cy="32" r="' + R + '" class="m-track"/><circle cx="32" cy="32" r="' + R + '" class="m-arc" stroke-dasharray="' + (C * part).toFixed(1) + " " + C.toFixed(1) + '" transform="rotate(-90 32 32)"/>';
    }
    g += "</svg>";
    var lvl = (tf ? 1 : 0) + (tr ? 1 : 0) + (hz ? 1 : 0);
    return '<span class="medal lvl' + lvl + (hz ? " hz" : "") + (fullM ? " full" : "") + (size ? " " + size : "") + (n >= 100 ? " d3" : "") + '">' + g + "<b>" + n + "</b></span>";
  }
  var toastTimer;
  function toast(t) {
    var el = document.getElementById("toast");
    el.textContent = t; el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2800);
  }
  function applyTheme() {
    var th = state && state.set.theme;
    if (th === "dark" || th === "light") document.documentElement.setAttribute("data-theme", th);
    else document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.setProperty("--ar-size", state ? state.set.arSize + "px" : "30px");
    document.documentElement.style.setProperty("--ru-size", state ? state.set.ruSize + "px" : "15px");
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

  /* ---------------- отрисовка ---------------- */
  function render() {
    if (!state) return;
    var tabs = document.querySelectorAll(".tab");
    for (var i = 0; i < tabs.length; i++) tabs[i].setAttribute("aria-current", tabs[i].getAttribute("data-tab") === (view.sura ? "suras" : view.tab) ? "page" : "false");
    var html;
    if (view.sura) html = renderSura(view.sura);
    else if (view.tab === "suras") html = renderSuras();
    else if (view.tab === "manzil") html = renderManzil();
    else if (view.tab === "tips") html = renderTips();
    else if (view.tab === "settings") html = renderSettings();
    else html = renderToday();
    document.getElementById("main").innerHTML = html;
    document.getElementById("mode").textContent = mode === "server"
      ? "Прогресс сохраняется в файл data/progress.json"
      : "Прогресс сохраняется в этом браузере — делайте резервную копию в настройках";
    renderOverlay();
    highlight();
  }

  function renderToday() {
    var t = today(), st = stats(), wd = weekday(t), set = state.set;
    var tags = "";
    if (set.ustaz.indexOf(wd) !== -1) tags += '<span class="tag gold">урок с устазом</span>';
    if (isRest(t)) tags += '<span class="tag plain">день без нового урока</span>';
    var h = '<div class="page-head"><span class="eyebrow">' + DAYS_FULL[wd] + ", " + esc(nice(t)) + '</span><h1>' + (set.name ? "Ас-саляму алейкум, " + esc(set.name) : "Сегодняшний хифз") + "</h1>" + (tags ? '<div class="row">' + tags + "</div>" : "") + "</div>";
    h += '<div class="stats">' +
      '<div class="stat gold"><b>' + st.full + "</b><span>" + plural(st.full, "сура заучена", "суры заучены", "сур заучено") + " полностью</span></div>" +
      '<div class="stat"><b>' + st.hifz + "</b><span>" + plural(st.hifz, "сура", "суры", "сур") + " знаете наизусть</span></div>" +
      '<div class="stat"><b>' + st.ayahs + "</b><span>" + plural(st.ayahs, "аят", "аята", "аятов") + " в памяти из 6236</span></div>" +
      '<div class="stat"><b>' + (st.pct < 10 ? st.pct.toFixed(2) : st.pct.toFixed(1)) + '%</b><span>текста Корана</span><span class="bar"><i style="width:' + Math.min(100, st.pct) + '%"></i></span></div></div>';
    h += '<div class="day"><div class="col">' + (set.ustaz.indexOf(wd) !== -1 ? ustazCard() : "") + sabakCard() + '</div><div class="col">' + sabqiCard() + manzilCard() + "</div></div>";
    return h;
  }

  function ustazCard() {
    var n = state.current, due = dueReviews();
    var h = '<section class="card accent"><div class="card-head"><span class="k">Урок с устазом</span></div><p style="margin:0">Подготовьте к сдаче:</p><ul class="clean">';
    if (n) {
      var learned = blocksOf(n).filter(function (b) { return blockDone(n, b); });
      h += "<li>Новое: «" + esc(SURAS[n - 1].ru) + "»" + (learned.length ? ", выученные блоки " + learned.map(function (b) { return b.s + "–" + b.e; }).join(", ") : ", первый блок") + "</li>";
    }
    if (due.length) h += "<li>Повторы: " + due.map(function (r) { return esc(rLabel(r)); }).join("; ") + "</li>";
    h += "<li>Слабые места, отмеченные с прошлого урока</li></ul></section>";
    return h;
  }

  function pillarsHtml(n) {
    var s = S(n), c = count(n), d = doneCount(n);
    function p(key, title, on, sub) {
      return '<button class="pillar' + (on ? " done" : "") + '" data-act="pillar" data-k="' + key + '" data-n="' + n + '" aria-pressed="' + on + '"><span class="pc">' + (on ? ICON.check : "") + '</span><span class="pt">' + title + '</span><span class="ps">' + sub + "</span></button>";
    }
    return '<div class="pillars">' + p("tr", "Перевод", s.tr, s.tr ? "прочитан" : "смысл суры целиком") +
      p("tf", "Тафсир", s.tf, s.tf ? "изучен" : "Ибн Касир или краткий") +
      p("hz", "Хифз", hifz(n), d + " из " + ayahsW(c)) + "</div>";
  }

  function sabakCard() {
    var n = state.current, set = state.set;
    var h = '<section class="card"><div class="card-head"><span class="k">Сабак</span><span class="muted small">новый урок</span>';
    if (!n) return h + '</div><div class="empty">Выберите суру, которую будете учить.<div class="row center" style="margin-top:10px"><button class="btn primary" data-act="pick">Выбрать суру</button></div></div></section>';
    var x = SURAS[n - 1], s = S(n), r = range(n), bl = blocksOf(n);
    h += '<span class="tag gold">аяты ' + r[0] + "–" + r[1] + "</span></div>";
    h += '<div class="lesson-title">' + medal(n, "md") + '<div><b>' + esc(x.ru) + '</b><div class="muted small">сура ' + n + " · " + ayahsW(x.ayahs) + '</div></div><span class="ar">' + esc(x.ar) + "</span></div>";
    h += pillarsHtml(n);
    if (isRest(today())) h += '<p class="source">Сегодня день отдыха от нового. Можно только повторять — или выучить блок, если есть силы.</p>';
    var nb = null;
    for (var i = 0; i < bl.length; i++) if (!blockDone(n, bl[i])) { nb = i; break; }
    if (!s.tr || !s.tf) {
      h += '<div class="next-block"><span class="range">Сначала смысл</span><span class="name">' + (!s.tr ? "Прочитайте перевод всей суры как рассказ" : "Прочитайте тафсир: о чём сура и почему ниспослана") +
        '</span><div class="row"><button class="btn primary" data-act="open" data-n="' + n + '">Открыть суру</button>' + (s.tr ? "" : '<button class="btn ghost" data-act="pillar" data-k="tr" data-n="' + n + '">Перевод прочитан</button>') + "</div></div>";
    } else if (nb !== null) {
      var b = bl[nb];
      h += '<div class="next-block"><span class="range">Блок ' + (nb + 1) + " из " + bl.length + " · аяты " + b.s + "–" + b.e + '</span><span class="name">' + esc(b.name) + "</span>" +
        '<div class="row"><button class="btn gold" data-act="block-ok" data-n="' + n + '" data-i="' + nb + '">Блок выучен</button><button class="btn" data-act="play-block" data-n="' + n + '" data-i="' + nb + '">' + ICON.play + ' Слушать</button><button class="btn ghost" data-act="open-block" data-n="' + n + '" data-i="' + nb + '">Текст</button></div></div>';
    }
    // прогноз по дневной норме
    var remR = lettersOf(n, r[0], r[1]) - lettersOf(n, r[0], r[1], true), remS = lettersOf(n) - lettersOf(n, 1, count(n), true);
    var fu = firstUndone(n), j = juzOf(n, fu || 1), remJ = juzRemaining(j);
    var nm = NORMS.filter(function (x) { return x[0] === set.norm; })[0];
    h += '<div class="forecast"><span class="muted small">Прогноз при норме ' + (nm ? nm[1] : set.norm + " стр.") + " в день:</span><dl>" +
      (remR > 0 ? "<dt>Диапазон " + r[0] + "–" + r[1] + "</dt><dd>" + esc(nice(finishDate(remR))) + "</dd>" : "") +
      (remS > 0 ? "<dt>Вся сура</dt><dd>" + esc(nice(finishDate(remS))) + "</dd>" : "") +
      (remJ > 0 ? "<dt>Джуз " + (j + 1) + "</dt><dd>" + esc(nice(finishDate(remJ))) + "</dd>" : "") + "</dl></div>";
    h += '<div class="row" style="margin-top:12px"><button class="btn sm ghost" data-act="pick">Сменить суру</button><button class="btn sm ghost" data-act="open" data-n="' + n + '">Диапазон и блоки</button></div>';
    return h + "</section>";
  }

  function sabqiCard() {
    var due = dueReviews(), t = today();
    var h = '<section class="card"><div class="card-head"><span class="k">Сабки</span><span class="muted small">интервальный повтор</span>' + (due.length ? '<span class="tag warn">' + due.length + "</span>" : "") + "</div>";
    var cur = state.current, learned = cur ? blocksOf(cur).filter(function (b) { return blockDone(cur, b); }) : [];
    if (!due.length && !learned.length) {
      var up = state.reviews.slice().sort(function (a, b) { return a.next < b.next ? -1 : 1; })[0];
      h += '<div class="empty">На сегодня повторов нет.' + (up ? "<br>Следующий: " + esc(rLabel(up)) + ", " + esc(nice(up.next)) : "") + "</div>";
    }
    if (due.length) {
      var iv = intervals();
      h += '<div class="list">' + due.map(function (r) {
        var late = diff(t, r.next);
        return '<div class="item"><span class="ar">' + esc(SURAS[r.n - 1].ar) + '</span><div class="main"><b>' + esc(rLabel(r)) + '</b><div class="meta">интервал ' + iv[Math.min(r.stage, iv.length - 1)] + " дн." + (late > 0 ? ' · <span class="late">просрочено на ' + late + " дн.</span>" : "") + "</div></div>" +
          '<button class="btn sm" data-act="play" data-n="' + r.n + '" data-a="' + r.s + '" data-b="' + r.e + '" aria-label="Слушать">' + ICON.play + "</button>" +
          '<button class="btn sm primary" data-act="rev" data-id="' + r.id + '" data-good="1">Без ошибок</button><button class="btn sm" data-act="rev" data-id="' + r.id + '" data-good="0">Были запинки</button></div>';
      }).join("") + "</div>";
    }
    if (learned.length) {
      h += '<p class="muted small" style="margin:12px 0 6px">Выученные блоки «' + esc(SURAS[cur - 1].ru) + "» — прочитайте подряд перед новым уроком:</p>" +
        '<div class="row">' + learned.map(function (b) { return '<span class="tag plain">' + b.s + "–" + b.e + "</span>"; }).join("") + "</div>";
    }
    return h + "</section>";
  }

  function manzilCard() {
    var parts = manzilParts(), ci = cycleInfo(), t = today();
    var h = '<section class="card"><div class="card-head"><span class="k">Манзиль</span><span class="muted small">всё выученное за ' + ci.cyc + " дней</span>";
    if (!parts.length) return h + '</div><div class="empty">Когда выучите первый отрывок, он появится здесь.</div></section>';
    var p = parts[ci.idx], doneT = !!state.manzil[t];
    h += (doneT ? '<span class="tag">прочитан</span>' : "") + "</div>";
    if (p) {
      h += '<div class="list">' + p.items.map(function (it) {
        return '<div class="item"><span class="ar">' + esc(SURAS[it.n - 1].ar) + '</span><div class="main"><b>' + esc(itemLabel(it)) + '</b></div><button class="btn sm ghost" data-act="play" data-n="' + it.n + '" data-a="' + it.s + '" data-b="' + it.e + '" data-once="1" aria-label="Слушать">' + ICON.play + "</button></div>";
      }).join("") + '</div><p class="muted small" style="margin:10px 0">' + dayLabel(ci.idx) + " · часть " + (ci.idx + 1) + " из " + parts.length + " · ≈ " + p.pages.toFixed(1) + " стр.</p>";
    } else h += '<div class="empty">Сегодня свободно: повторите слабые места.</div>';
    h += '<button class="btn ' + (doneT ? "" : "primary") + '" data-act="manzil" data-d="' + t + '">' + (doneT ? "Отменить отметку" : "Манзиль прочитан") + "</button>";
    h += '<div class="week">';
    for (var i = 0; i < Math.min(ci.cyc, 14); i++) {
      var dd = addDays(ci.start, i);
      h += '<div class="wd' + (state.manzil[dd] ? " done" : "") + (dd === t ? " today" : "") + '"><i>' + (state.manzil[dd] ? ICON.check : parse(dd).getDate()) + "</i>" + (ci.cyc === 7 ? DAYS[(state.set.weekStart + i) % 7] : i + 1) + "</div>";
    }
    return h + "</div></section>";
  }

  function renderSuras() {
    var f = view.filter, q = view.q.trim().toLowerCase();
    var list = SURAS.filter(function (x) {
      var s = state.suras[x.n], hz = hifz(x.n), fl = full(x.n), any = s && (s.tr || s.tf || doneCount(x.n) > 0);
      if (f === "full" && !fl) return false;
      if (f === "hifz" && !hz) return false;
      if (f === "learning" && (fl || !any)) return false;
      if (f === "none" && any) return false;
      if (q && x.ru.toLowerCase().indexOf(q) === -1 && String(x.n) !== q && x.ar.indexOf(q) === -1) return false;
      return true;
    });
    var ch = [["all", "Все"], ["full", "Заучены полностью"], ["hifz", "Наизусть"], ["learning", "В процессе"], ["none", "Не начаты"]];
    var h = '<div class="page-head"><span class="eyebrow">114 сур</span><h1>Суры</h1><p class="muted" style="margin:4px 0 0">Медальон растёт с каждым шагом: тафсир добавляет рамку, перевод — звезду, хифз — зелёную сердцевину. Все три — полный медальон.</p></div>';
    h += '<div class="filters"><input class="search" id="q" type="search" placeholder="Поиск по названию или номеру" value="' + esc(view.q) + '">' +
      ch.map(function (c) { return '<button class="chip" data-act="filter" data-f="' + c[0] + '" aria-pressed="' + (f === c[0]) + '">' + c[1] + "</button>"; }).join("") + "</div>";
    h += '<div class="suras">' + list.map(function (x) {
      var s = state.suras[x.n] || {};
      return '<button class="sura" data-act="open" data-n="' + x.n + '">' + medal(x.n) + '<span class="nm">' + esc(x.ru) + '</span><span class="ar">' + esc(x.ar) + "</span>" +
        '<span class="dots"><i class="dot' + (s.tr ? " on" : "") + '" title="Перевод"></i><i class="dot' + (s.tf ? " on" : "") + '" title="Тафсир"></i><i class="dot' + (hifz(x.n) ? " on" : doneCount(x.n) ? " half" : "") + '" title="Хифз"></i>&nbsp;' + ayahsW(x.ayahs) + "</span></button>";
    }).join("") + "</div>";
    if (!list.length) h += '<div class="empty">Ничего не найдено</div>';
    return h;
  }

  function ayahHtml(n, a, opts) {
    var r = rows(n)[a - 1], ar = r[0];
    var hidden = opts.check && a >= opts.reveal;
    var arHtml = hidden ? '<div class="a hidden-ar" lang="ar">· · ·</div>' : '<div class="a" lang="ar" dir="rtl">' + esc(opts.hint ? firstLetters(ar) : ar) + ' <span class="no">﴿' + arNum(a) + "﴾</span></div>";
    return '<div class="ayah' + (isDone(n, a) ? " learned" : "") + '" id="ay-' + n + "-" + a + '">' + arHtml +
      (opts.check ? "" : '<div class="t"><span class="no">' + a + ".</span> " + esc(r[1]) + "</div>") +
      '<div class="ay-tools"><button class="mini" data-act="play" data-n="' + n + '" data-a="' + a + '" data-b="' + a + '" aria-label="Слушать аят ' + a + '">' + ICON.play + '</button><button class="mini" data-act="tafsir" data-n="' + n + '" data-a="' + a + '" aria-label="Тафсир аята ' + a + '">' + ICON.info + " тафсир</button></div></div>";
  }

  function renderSura(n) {
    var x = SURAS[n - 1], s = S(n), bl = blocksOf(n), r = range(n), c = x.ayahs, d = doneCount(n);
    var h = '<button class="back" data-act="back">← Все суры</button>';
    h += '<div class="detail-head">' + medal(n, "xl") + '<div class="dh-t"><h1>' + esc(x.ru) + '</h1><span class="muted">' + ayahsW(c) + " · " + (x.medinan ? "мединская" : "мекканская") + " · джуз " + (juzOf(n, 1) + 1) + " · с. " + x.page + ' мусхафа</span></div><span class="ar">' + esc(x.ar) + "</span></div>";
    h += '<div class="detail"><div class="col">';

    // три шага
    h += '<section class="card"><div class="card-head"><span class="k">Три шага</span>' + (full(n) ? '<span class="tag">заучена полностью</span>' : hifz(n) ? '<span class="tag gold">наизусть</span>' : "") + "</div>";
    h += pillarsHtml(n);
    h += '<p class="muted small" style="margin:0">Сура заучена полностью, когда отмечены все три шага. «Хифз» отмечает или снимает отметку со всех аятов сразу; по отдельности — в блоках ниже.</p></section>';

    // диапазон
    h += '<section class="card"><div class="card-head"><span class="k">Что учу сейчас</span><span class="muted small">' + d + " из " + c + " аятов выучено</span></div>" +
      '<div class="range-row"><label for="ra">Аяты с</label><input type="number" id="ra" min="1" max="' + c + '" value="' + r[0] + '"><label for="rb">по</label><input type="number" id="rb" min="1" max="' + c + '" value="' + r[1] + '">' +
      '<button class="btn sm primary" data-act="set-range" data-n="' + n + '">Применить</button><button class="btn sm ghost" data-act="range-all" data-n="' + n + '">Вся сура</button>' +
      (state.current === n ? '<span class="tag gold">учу сейчас</span>' : '<button class="btn sm" data-act="set-current" data-n="' + n + '">Учить эту суру</button>') + "</div>" +
      '<div class="rangebar">' + rangeBar(n, r) + "</div>" +
      '<p class="muted small" style="margin:8px 0 0">В диапазоне ' + ayahsW(r[1] - r[0] + 1) + " ≈ " + (lettersOf(n, r[0], r[1]) / LPP).toFixed(1) + " стр. Смысловые блоки строятся только по нему.</p></section>";

    // блоки
    h += '<section class="card"><div class="card-head"><span class="k">Смысловые блоки</span><span class="tag ' + (s.bsrc === "custom" ? "gold" : "") + '">' + (s.bsrc === "custom" ? "ваша правка" : "рассчитаны автоматически") + "</span></div>";
    h += '<p class="source">Границы найдены по смене рифмы аятов и словам, с которых начинается новая тема. Названия — начало перевода первого аята. Всё можно поправить: название, границы, число аятов.</p>';
    h += '<div class="blocks">' + bl.map(function (b, i) { return blockHtml(n, b, i, bl.length); }).join("") + "</div>";
    h += '<div class="row" style="margin-top:12px"><button class="btn sm" data-act="reset-blocks" data-n="' + n + '">Пересчитать автоматически</button><span class="muted small">Размер блоков: ' + SIZES.filter(function (z) { return z[0] === state.set.blockSize; })[0][1].toLowerCase() + " (меняется в настройках)</span></div></section>";
    h += '</div><div class="col">';

    // повторение
    var mine = state.reviews.filter(function (q) { return q.n === n; });
    h += '<section class="card"><div class="card-head"><span class="k">Повторение</span></div>';
    if (mine.length) {
      var iv = intervals();
      h += mine.map(function (q) {
        var tl = '<div class="timeline" style="grid-template-columns:repeat(' + (iv.length + 1) + ',minmax(0,1fr))">' + [0].concat(iv).map(function (v, k) {
          var cls = k === 0 || k <= q.stage ? "done" : k === q.stage + 1 ? "now" : "";
          return '<div class="tl ' + cls + '"><i>' + v + "</i>" + (k === 0 ? "выучил" : "+" + v) + "</div>";
        }).join("") + "</div>";
        return '<div class="stack" style="margin-bottom:12px"><b>Аяты ' + q.s + "–" + q.e + '</b><span class="muted small">следующий повтор: ' + esc(nice(q.next)) + "</span>" + tl +
          '<div class="row"><button class="btn sm primary" data-act="rev" data-id="' + q.id + '" data-good="1">Без ошибок</button><button class="btn sm" data-act="rev" data-id="' + q.id + '" data-good="0">Были запинки</button></div></div>';
      }).join("");
    } else if (d) h += '<p class="muted" style="margin:0">Выученное повторяется в манзиле.</p>';
    else h += '<p class="muted" style="margin:0">Когда выучите диапазон, приложение назначит повторы через ' + intervals().join(", ") + " дней, а затем добавит его в манзиль.</p>";
    h += "</section>";

    h += '<section class="card"><div class="card-head"><span class="k">Конспект тафсира</span></div><textarea class="note" id="note-' + n + '" data-n="' + n + '" placeholder="О чём эта сура, главные мысли…">' + esc(s.note) + "</textarea>" +
      '<div class="row" style="margin-top:10px"><button class="btn sm" data-act="tafsir" data-n="' + n + '" data-a="' + r[0] + '">' + ICON.info + " Тафсир Ибн Касира</button></div></section>";
    h += '<section class="card"><div class="card-head"><span class="k">Как учить блок</span></div><ol class="muted clean-ol">' +
      "<li>Прочитайте последние аяты вчерашнего блока.</li><li>Скажите про себя смысл нового блока одним предложением.</li><li>Послушайте чтеца с повторами, следя по тексту.</li><li>Учите аят за аятом, каждый раз читая с начала блока.</li><li>Проверьте себя в режиме «Проверка» и с подсказкой первых букв.</li></ol></section>";
    h += '<section class="card">' + (view.confirm === "sura" + n ? '<p style="margin:0 0 8px;color:var(--warn)">Сбросить весь прогресс этой суры?</p><div class="row"><button class="btn sm warn" data-act="reset-sura" data-n="' + n + '">Да, сбросить</button><button class="btn sm" data-act="cancel">Отмена</button></div>'
      : '<button class="btn sm warn" data-act="ask" data-what="sura' + n + '">Сбросить прогресс суры</button>') + "</section>";
    return h + "</div></div>";
  }

  function rangeBar(n, r) {
    var c = count(n), out = "";
    var step = c > 120 ? Math.ceil(c / 120) : 1;
    for (var a = 1; a <= c; a += step) {
      var e = Math.min(c, a + step - 1), dn = doneCount(n, a, e) === e - a + 1, inr = e >= r[0] && a <= r[1];
      out += '<i class="' + (dn ? "d" : "") + (inr ? " r" : "") + '"></i>';
    }
    return out;
  }

  function blockHtml(n, b, i, total) {
    var key = n + ":" + i, open = view.open[key], chk = view.check[key], hint = view.hint[key], dn = blockDone(n, b);
    var h = '<div class="block' + (dn ? " learned" : "") + '"><div class="top-line"><button class="check' + (dn ? " on" : "") + '" data-act="block-toggle" data-n="' + n + '" data-i="' + i + '" aria-label="Блок выучен">' + ICON.check + "</button>" +
      '<input class="bname" id="bn-' + n + "-" + i + '" data-n="' + n + '" data-i="' + i + '" value="' + esc(b.name) + '" aria-label="Название блока"></div>';
    h += '<div class="bedit"><label>Аяты <input type="number" class="bnum" id="bs-' + n + "-" + i + '" data-n="' + n + '" data-i="' + i + '" data-f="s" value="' + b.s + '"' + (i === 0 ? " disabled" : "") + '></label>' +
      '<label>– <input type="number" class="bnum" id="be-' + n + "-" + i + '" data-n="' + n + '" data-i="' + i + '" data-f="e" value="' + b.e + '"' + (i === total - 1 ? " disabled" : "") + '></label>' +
      '<label>всего <input type="number" class="bnum" id="bl-' + n + "-" + i + '" data-n="' + n + '" data-i="' + i + '" data-f="len" min="1" value="' + (b.e - b.s + 1) + '"' + (i === total - 1 ? " disabled" : "") + "></label>" +
      '<span class="muted small">≈ ' + (lettersOf(n, b.s, b.e) / LPP).toFixed(2) + " стр.</span></div>";
    h += '<div class="tools"><button class="btn sm" data-act="play-block" data-n="' + n + '" data-i="' + i + '">' + ICON.play + " Слушать</button>" +
      '<button class="btn sm ghost" data-act="toggle-text" data-n="' + n + '" data-i="' + i + '">' + (open ? "Скрыть текст" : "Текст и перевод") + "</button>" +
      '<button class="btn sm ghost" data-act="check-mode" data-n="' + n + '" data-i="' + i + '" aria-pressed="' + !!chk + '">' + ICON.eye + " Проверка</button>" +
      '<button class="btn sm ghost" data-act="hint-mode" data-n="' + n + '" data-i="' + i + '" aria-pressed="' + !!hint + '">Первые буквы</button>' +
      '<button class="btn sm ghost" data-act="tafsir" data-n="' + n + '" data-a="' + b.s + '" data-b="' + b.e + '">' + ICON.info + " Тафсир блока</button>";
    if (b.e > b.s) h += '<button class="btn sm ghost" data-act="split" data-n="' + n + '" data-i="' + i + '">Разделить пополам</button>';
    if (i < total - 1) h += '<button class="btn sm ghost" data-act="merge" data-n="' + n + '" data-i="' + i + '">Объединить со следующим</button>';
    h += "</div>";
    if (open || chk || hint) {
      var reveal = chk ? (b.s + (chk - 1)) : 0;
      h += '<div class="text">';
      for (var a = b.s; a <= b.e; a++) h += ayahHtml(n, a, { check: !!chk, reveal: reveal, hint: !!hint });
      if (chk) h += '<div class="row">' + (reveal <= b.e ? '<button class="btn sm primary" data-act="reveal" data-n="' + n + '" data-i="' + i + '">Показать аят ' + reveal + "</button>" : '<span class="tag">все аяты открыты</span>') + '<button class="btn sm ghost" data-act="check-mode" data-n="' + n + '" data-i="' + i + '">Выйти из проверки</button></div>';
      h += "</div>";
    }
    return h + "</div>";
  }

  function renderManzil() {
    var parts = manzilParts(), ci = cycleInfo(), t = today();
    var total = parts.reduce(function (a, p) { return a + p.pages; }, 0);
    var h = '<div class="page-head"><span class="eyebrow">Манзиль · круг ' + ci.cyc + ' дней</span><h1>Повторение всего выученного</h1><p class="muted" style="margin:4px 0 0">Всё, что вы знаете наизусть (≈ ' + total.toFixed(1) + " стр.), разделено на части, близкие по объёму текста. Деление пересчитывается само, когда добавляется новое. Длину круга и первый день меняйте в настройках.</p></div>";
    if (!parts.length) return h + '<div class="empty">Пока нечего повторять — выучите первый отрывок или отметьте уже знакомые суры.</div>';
    h += '<div class="manzil-grid">';
    for (var i = 0; i < ci.cyc; i++) {
      var p = parts[i], dd = addDays(ci.start, i), dn = !!state.manzil[dd];
      h += '<div class="mday' + (dd === t ? " today" : "") + (dn ? " done" : "") + '"><button class="mcheck' + (dn ? " on" : "") + '" data-act="manzil" data-d="' + dd + '" aria-label="Отметить: ' + esc(dayLabel(i)) + ' повторено" aria-pressed="' + dn + '">' + ICON.check + "</button>" +
        '<div class="dname">' + esc(dayLabel(i)) + '</div><span class="muted small">' + esc(niceShort(dd)) + (p ? " · ≈ " + p.pages.toFixed(1) + " стр." : "") + "</span>";
      if (p) h += "<ul>" + p.items.map(function (it) { return "<li><span>" + esc(itemLabel(it)) + "</span><span>" + it.n + "</span></li>"; }).join("") + "</ul>";
      else h += '<p class="muted small" style="margin:0">Свободный день: слабые места и отрывки с ошибками.</p>';
      h += "</div>";
    }
    return h + "</div>";
  }

  function renderTips() {
    var tips = [
      ["key", "Каждый день — три чтения", ["Сабак — новый смысловой блок.", "Сабки — свежее, по интервалам.", "Манзиль — всё старое по кругу.", "Повторению — больше времени, чем новому."]],
      ["", "Сначала смысл", ["Перевод всей суры целиком, как рассказ.", "Тафсир: о чём сура и почему ниспослана.", "Деление на смысловые блоки, у каждого — своё название.", "Перед блоком — одна фраза его смысла про себя."]],
      ["", "Слушайте с повторами", ["Один чтец: память привыкает к одному напеву.", "Повтор аята 3–5 раз, затем весь блок.", "Режим «слушай и повторяй» оставляет паузу для вашего чтения."]],
      ["", "Связки", ["Выучил аят — прочитай блок с начала.", "Каждый день начинай с последних аятов вчерашнего урока.", "Запоминай, как один блок переходит в другой."]],
      ["", "Проверка", ["Режим «Проверка» скрывает текст — открывайте по одному аяту.", "Подсказка первыми буквами — промежуточный шаг.", "Читайте устазу или другу с мусхафом."]],
      ["", "Постоянство", ["Мало, но каждый день сильнее, чем много раз в неделю.", "Тяжёлый день — пропустите новое, но не повторение.", "Время после фаджра — лучшее для нового."]]
    ];
    return '<div class="page-head"><span class="eyebrow">Методика</span><h1>Как учить и не забывать</h1></div><div class="tips">' +
      tips.map(function (t) { return '<div class="tip ' + t[0] + '"><h3>' + t[1] + "</h3><ul>" + t[2].map(function (l) { return "<li>" + esc(l) + "</li>"; }).join("") + "</ul></div>"; }).join("") + "</div>";
  }

  function reciterCards(cur) {
    return '<div class="reciters">' + RECITERS.map(function (r) {
      return '<button class="rcard" data-act="set" data-k="reciter" data-v="' + r.id + '" aria-pressed="' + (cur === r.id) + '"><b>' + esc(r.name) + "</b>" + (r.note ? '<span class="muted small">' + esc(r.note) + "</span>" : "") + (r.id === "sowaid" ? '<span class="tag gold">по умолчанию</span>' : "") + "</button>";
    }).join("") + "</div>";
  }
  function rangeInput(k, min, max, step, val, fmt) {
    return '<div class="slider"><input type="range" id="sl-' + k + '" data-k="' + k + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '"><output id="out-' + k + '">' + fmt(val) + "</output></div>";
  }
  var FMT = {
    speed: function (v) { return (+v).toFixed(2).replace(/0$/, "") + "×"; }, ayahRep: function (v) { return v + " " + plural(+v, "раз", "раза", "раз"); },
    blockRep: function (v) { return v + " " + plural(+v, "раз", "раза", "раз"); }, pause: function (v) { return v + " с"; },
    arSize: function (v) { return v + " px"; }, ruSize: function (v) { return v + " px"; }
  };

  function renderSettings() {
    var s = state.set, sample = rows(1)[1];
    var h = '<div class="page-head"><span class="eyebrow">Настройки</span><h1>Под вас</h1></div><div class="settings">';
    h += '<section class="card"><div class="card-head"><span class="k">Профиль</span></div><div class="field"><label for="st-name">Как к вам обращаться</label><input type="text" id="st-name" data-k="name" value="' + esc(s.name) + '" placeholder="Имя"></div></section>';
    h += '<section class="card"><div class="card-head"><span class="k">Чтецы и аудио</span></div>' + reciterCards(s.reciter) +
      '<div class="field"><label>Скорость</label>' + rangeInput("speed", 0.75, 1.25, 0.05, s.speed, FMT.speed) + "</div>" +
      '<div class="field"><label>Повтор каждого аята</label>' + rangeInput("ayahRep", 1, 10, 1, s.ayahRep, FMT.ayahRep) + "</div>" +
      '<div class="field"><label>Повтор всего блока</label>' + rangeInput("blockRep", 1, 10, 1, s.blockRep, FMT.blockRep) + "</div>" +
      '<div class="field"><label>Пауза между повторами</label>' + rangeInput("pause", 1, 5, 1, s.pause, FMT.pause) + "</div>" +
      '<label class="cb"><input type="checkbox" id="st-listen" data-k="listen"' + (s.listen ? " checked" : "") + '> Режим «слушай и повторяй»: после аята пауза такой же длины, чтобы прочитать самому</label>' +
      '<div class="row"><button class="btn sm" data-act="play" data-n="1" data-a="2" data-b="2" data-once="1">' + ICON.play + " Проверить звук</button></div></section>";
    h += '<section class="card"><div class="card-head"><span class="k">Текст</span></div>' +
      '<div class="field"><label>Арабский шрифт</label>' + rangeInput("arSize", 20, 48, 1, s.arSize, FMT.arSize) + "</div>" +
      '<div class="field"><label>Перевод</label>' + rangeInput("ruSize", 12, 22, 1, s.ruSize, FMT.ruSize) + "</div>" +
      '<div class="ayah preview"><div class="a" lang="ar" dir="rtl">' + esc(sample[0]) + ' <span class="no">﴿٢﴾</span></div><div class="t">' + esc(sample[1]) + "</div></div>" +
      '<div class="field"><label>Оформление</label>' + chips("theme", [["system", "Как в системе"], ["light", "Светлое"], ["dark", "Тёмное"]], s.theme || "system") + "</div></section>";
    h += '<section class="card"><div class="card-head"><span class="k">Методика</span></div>' +
      '<div class="field"><label>Размер смыслового блока</label>' + chips("blockSize", SIZES, s.blockSize) + '<span class="muted small">Меняет автоматическое деление. Ваши правки блоков сохраняются, пока не нажмёте «Пересчитать».</span></div>' +
      '<div class="field"><label for="st-iv">Интервалы повторения, дни</label><input type="text" id="st-iv" value="' + intervals().join(", ") + '"><span class="muted small">По умолчанию 1, 3, 7, 14, 30. Через запятую, по возрастанию.</span><div class="row"><button class="btn sm" data-act="save-iv">Сохранить интервалы</button><button class="btn sm ghost" data-act="reset-iv">По умолчанию</button></div></div>' +
      '<div class="field"><label>Направление заучивания</label>' + chips("direction", [["end", "С конца Корана"], ["start", "С начала"]], s.direction) + "</div>" +
      '<div class="field"><label>Дневная норма нового</label>' + chips("norm", NORMS, s.norm) + '<span class="muted small">По ней считается прогноз на главной.</span></div></section>';
    h += '<section class="card"><div class="card-head"><span class="k">Расписание</span></div>' +
      '<div class="field"><label>Уроки с устазом</label>' + chips("ustaz", DAY_CHIPS, s.ustaz, true) + "</div>" +
      '<div class="field"><label>Дни без нового урока</label>' + chips("rest", DAY_CHIPS, s.rest, true) + '<span class="muted small">В эти дни — только повторение.</span></div>' +
      '<div class="field"><label>Круг манзиля</label>' + chips("cycle", [[7, "7 дней"], [10, "10 дней"], [14, "14 дней"]], s.cycle) + "</div>" +
      (s.cycle === 7 ? '<div class="field"><label>Первый день недели манзиля</label>' + chips("weekStart", [[0, "Понедельник"], [5, "Суббота"], [6, "Воскресенье"]], s.weekStart) + "</div>"
        : '<div class="field"><label>Начало круга</label><div class="row"><span class="muted">' + esc(nice(cycleInfo().start)) + '</span><button class="btn sm ghost" data-act="anchor">Начать круг сегодня</button></div></div>') + "</section>";
    h += '<section class="card"><div class="card-head"><span class="k">Данные</span></div><p class="muted small" style="margin:0">' + (mode === "server" ? "Прогресс хранится в файле data/progress.json." : "Прогресс хранится только в этом браузере. Сохраните резервную копию в заметках или файле.") + "</p>" +
      '<div class="field"><label for="bk">Резервная копия (JSON)</label><textarea id="bk" spellcheck="false">' + esc(JSON.stringify(state)) + "</textarea></div>" +
      '<div class="row"><button class="btn sm" data-act="copy">Скопировать</button><button class="btn sm primary" data-act="import">Загрузить из поля</button><button class="btn sm ghost" data-act="rerun">Пройти настройку заново</button></div>' +
      (view.confirm === "all" ? '<p style="margin:0;color:var(--warn)">Удалить весь прогресс? Это нельзя отменить.</p><div class="row"><button class="btn sm warn" data-act="reset-all">Да, удалить всё</button><button class="btn sm" data-act="cancel">Отмена</button></div>'
        : '<button class="btn sm warn" data-act="ask" data-what="all">Начать с нуля</button>') + "</section>";
    return h + "</div>";
  }

  /* ---------------- оверлеи: мастер, выбор суры, тафсир ---------------- */
  function renderOverlay() {
    var o = document.getElementById("overlay");
    if (view.ob) { o.innerHTML = '<div class="overlay"><div class="sheet wide" role="dialog" aria-labelledby="ob-t">' + obHtml() + "</div></div>"; return; }
    if (view.tafsir) { o.innerHTML = '<div class="overlay" data-act="close"><div class="sheet wide" role="dialog" aria-labelledby="tf-t">' + tafsirHtml() + "</div></div>"; return; }
    if (view.pick) {
      var start = state.set.direction === "start", nx = suggestNext();
      var list = SURAS.slice();
      if (!start) list.reverse();
      list = list.filter(function (x) { return !hifz(x.n); });
      o.innerHTML = '<div class="overlay" data-act="close"><div class="sheet" role="dialog" aria-labelledby="pk-t"><div class="row between"><h2 id="pk-t">Какую суру учите?</h2><button class="btn sm ghost" data-act="close">Закрыть</button></div>' +
        '<div class="list">' + list.map(function (x) {
          var dc = doneCount(x.n);
          return '<button class="item pick" data-act="set-current" data-n="' + x.n + '"><span class="ar">' + esc(x.ar) + '</span><span class="main"><b>' + x.n + ". " + esc(x.ru) + '</b><span class="meta"> · ' + ayahsW(x.ayahs) + (dc ? " · выучено " + dc : "") + "</span></span>" + (x.n === nx ? '<span class="tag gold">следующая</span>' : "") + "</button>";
        }).join("") + "</div></div></div>";
      return;
    }
    o.innerHTML = "";
  }

  var OB_STEPS = ["Знакомство", "Что уже знаете", "Перевод и тафсир", "План", "Расписание", "Чтец"];
  function obHtml() {
    var o = view.ob, s = state.set, st = o.step;
    var h = '<div class="ob-head"><div class="frame"><span class="ar">بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ</span></div><div class="ob-dots">' + OB_STEPS.map(function (t, i) { return '<i class="' + (i < st ? "done" : i === st ? "now" : "") + '" title="' + t + '"></i>'; }).join("") + '</div><span class="eyebrow">Шаг ' + (st + 1) + " из " + OB_STEPS.length + " · " + OB_STEPS[st] + "</span></div>";
    if (st === 0) {
      h += '<h2 id="ob-t">Настроим Хифз под вас</h2><p class="muted" style="margin:0">Несколько вопросов — и приложение составит план: что учить, когда повторять и как делить выученное на круг манзиля.</p>' +
        '<div class="field"><label for="st-name">Как к вам обращаться</label><input type="text" id="st-name" data-k="name" value="' + esc(s.name) + '" placeholder="Имя (необязательно)"></div>';
    } else if (st === 1) {
      h += '<h2 id="ob-t">Что вы уже знаете наизусть?</h2>' + chips("ob-known", [["none", "Пока ничего"], ["end", "Последние суры"], ["begin", "Суры с начала"], ["manual", "Выберу сам"]], o.known);
      if (o.known === "end") {
        var opts = ""; for (var n = 114; n >= 1; n--) opts += '<option value="' + n + '"' + (n === o.from ? " selected" : "") + ">с " + n + "-й (" + esc(SURAS[n - 1].ru) + ") по 114-ю</option>";
        h += '<div class="field"><label for="ob-from">Какие именно</label><select id="ob-from">' + opts + '</select><span class="muted small">Например, джуз Амма — с 78-й суры.</span></div>';
      } else if (o.known === "begin") {
        var opts2 = ""; for (var m = 1; m <= 114; m++) opts2 += '<option value="' + m + '"' + (m === o.to ? " selected" : "") + ">с 1-й по " + m + "-ю (" + esc(SURAS[m - 1].ru) + ")</option>";
        h += '<div class="field"><label for="ob-to">Какие именно</label><select id="ob-to">' + opts2 + "</select></div>";
      } else if (o.known === "manual") {
        h += '<div class="numgrid">' + SURAS.map(function (x) { return '<button class="num" data-act="ob-pick" data-n="' + x.n + '" aria-pressed="' + !!o.picks[x.n] + '" title="' + esc(x.ru) + '">' + x.n + "</button>"; }).join("") + '</div><span class="muted small">Выбрано: ' + Object.keys(o.picks).length + "</span>";
      }
    } else if (st === 2) {
      h += '<h2 id="ob-t">Перевод и тафсир выученных сур</h2>';
      if (obKnown().length) {
        h += '<p class="muted" style="margin:0">Сура считается заученной полностью, только когда изучены перевод, тафсир и текст. Отметьте, что уже сделано для выученных сур (' + obKnown().length + "):</p>" +
          '<label class="cb big"><input type="checkbox" id="ob-tr"' + (o.tr ? " checked" : "") + "> Перевод этих сур я читал</label>" +
          '<label class="cb big"><input type="checkbox" id="ob-tf"' + (o.tf ? " checked" : "") + "> Тафсир этих сур я изучал</label>" +
          '<p class="muted small" style="margin:0">Потом это можно поменять в карточке каждой суры.</p>';
      } else h += '<p class="muted" style="margin:0">Вы начинаете с нуля — этот шаг пропускаем. Для каждой новой суры приложение попросит сначала прочитать перевод и тафсир.</p>';
    } else if (st === 3) {
      h += '<h2 id="ob-t">Как будете учить</h2>' +
        '<div class="field"><label>Направление</label>' + chips("direction", [["end", "С конца Корана (обычно)"], ["start", "С начала"]], s.direction) + "</div>" +
        '<div class="field"><label>Сколько нового в день</label>' + chips("norm", NORMS, s.norm) + '<span class="muted small">Новичкам — четверть или половина страницы.</span></div>' +
        '<div class="field"><label>Размер смыслового блока</label>' + chips("blockSize", SIZES, s.blockSize) + "</div>";
    } else if (st === 4) {
      h += '<h2 id="ob-t">Расписание</h2>' +
        '<div class="field"><label>В какие дни уроки с устазом</label>' + chips("ustaz", DAY_CHIPS, s.ustaz, true) + '<span class="muted small">Можно не выбирать, если учите сами.</span></div>' +
        '<div class="field"><label>Дни без нового урока</label>' + chips("rest", DAY_CHIPS, s.rest, true) + "</div>" +
        '<div class="field"><label>Круг манзиля (повторение всего выученного)</label>' + chips("cycle", [[7, "7 дней"], [10, "10 дней"], [14, "14 дней"]], s.cycle) + "</div>" +
        (s.cycle === 7 ? '<div class="field"><label>Неделя начинается с</label>' + chips("weekStart", [[0, "Понедельника"], [5, "Субботы"], [6, "Воскресенья"]], s.weekStart) + "</div>" : "");
    } else {
      h += '<h2 id="ob-t">Чтец</h2>' + reciterCards(s.reciter) +
        '<div class="field"><label>Скорость</label>' + rangeInput("speed", 0.75, 1.25, 0.05, s.speed, FMT.speed) + "</div>" +
        '<div class="field"><label>Повтор каждого аята</label>' + rangeInput("ayahRep", 1, 10, 1, s.ayahRep, FMT.ayahRep) + "</div>";
    }
    h += '<div class="row between ob-nav">' + (st > 0 ? '<button class="btn ghost" data-act="ob-back">Назад</button>' : "<span></span>") +
      (st < OB_STEPS.length - 1 ? '<button class="btn primary" data-act="ob-next">Далее</button>' : '<button class="btn gold" data-act="ob-finish">Начать</button>') + "</div>";
    return h;
  }
  function obKnown() {
    var o = view.ob, out = [];
    if (o.known === "end") for (var n = o.from; n <= 114; n++) out.push(n);
    else if (o.known === "begin") for (var m = 1; m <= o.to; m++) out.push(m);
    else if (o.known === "manual") out = Object.keys(o.picks).map(Number);
    return out;
  }

  function tafsirHtml() {
    var t = view.tafsir, n = t.n, a = t.a, b = t.b || t.a, x = SURAS[n - 1];
    var h = '<div class="row between"><h2 id="tf-t">Тафсир Ибн Касира</h2><button class="btn sm ghost" data-act="close">Закрыть</button></div>';
    h += '<span class="muted small">' + esc(x.ru) + ", " + (a === b ? "аят " + a : "аяты " + a + "–" + b) + "</span>";
    var m = tafsirMem[n];
    h += '<div class="tafsir-body">';
    for (var k = a; k <= b; k++) {
      var r = rows(n)[k - 1];
      h += '<div class="ayah"><div class="a" lang="ar" dir="rtl">' + esc(r[0]) + ' <span class="no">﴿' + arNum(k) + '﴾</span></div><div class="t"><span class="no">' + k + ".</span> " + esc(r[1]) + "</div></div>";
      if (m) {
        var txt = m[k];
        if (txt) h += '<div class="tafsir-text">' + esc(txt).replace(/\n/g, "<br>") + "</div>";
        else if (a === b) h += '<p class="muted small">Толкование этого аята дано вместе с соседними — смотрите предыдущий аят.</p>';
      }
    }
    if (!m) {
      if (t.err) h += '<div class="empty">' + esc(t.err) + '<div class="row center" style="margin-top:10px"><button class="btn sm primary" data-act="tafsir-retry">Повторить</button><a class="btn sm ghost" href="https://quran.com/ru/' + n + ":" + a + '/tafsirs" target="_blank" rel="noopener">Открыть на quran.com</a></div></div>';
      else h += '<div class="empty">Загружаю тафсир…</div>';
    }
    h += "</div>";
    h += '<div class="row between"><div class="row">' + (a > 1 ? '<button class="btn sm" data-act="tafsir-step" data-d="-1">← Предыдущий</button>' : "") + (b < count(n) ? '<button class="btn sm" data-act="tafsir-step" data-d="1">Следующий →</button>' : "") + "</div>" +
      (m ? '<button class="btn sm" data-act="tafsir-copy">Копировать</button>' : "") + "</div>";
    h += '<p class="muted small" style="margin:0">Источник: открытый проект spa5k/tafsir_api (перевод на русский). Без интернета тафсир недоступен.</p>';
    return h;
  }
  function openTafsir(n, a, b) {
    view.tafsir = { n: n, a: a, b: b || a, err: "" };
    render();
    if (tafsirMem[n]) return;
    getTafsir(n).then(function () { if (view.tafsir && view.tafsir.n === n) render(); }, function () {
      // запасной путь: файл одного аята
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
    if (k === "ob-known") { view.ob.known = v; return; }
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
      case "open": view.sura = n; view.confirm = null; window.scrollTo(0, 0); break;
      case "open-block": view.sura = n; view.open[n + ":" + i] = true; window.scrollTo(0, 0); break;
      case "back": view.sura = null; view.tab = "suras"; break;
      case "filter": view.filter = el.getAttribute("data-f"); break;
      case "pillar":
        var k = el.getAttribute("data-k");
        if (k === "hz") {
          if (hifz(n)) { setDone(n, 1, count(n), false); state.reviews = state.reviews.filter(function (r) { return r.n !== n; }); }
          else { setDone(n, 1, count(n), true); s.range = [1, count(n)]; s.blocks = null; afterProgress(n); }
        } else { s[k] = !s[k]; if (s[k] && full(n)) toast("Сура «" + SURAS[n - 1].ru + "» заучена полностью"); }
        save(); break;
      case "block-ok": case "block-toggle":
        b = blocksOf(n)[i];
        var on = a === "block-ok" ? true : !blockDone(n, b);
        setDone(n, b.s, b.e, on);
        if (on) { toast("Блок " + b.s + "–" + b.e + " выучен"); afterProgress(n); }
        save(); break;
      case "set-range":
        setRange(n, +document.getElementById("ra").value, +document.getElementById("rb").value); view.open = {}; view.check = {}; view.hint = {}; save(); toast("Блоки построены по аятам " + s.range[0] + "–" + s.range[1]); break;
      case "range-all": setRange(n, 1, count(n)); view.open = {}; save(); break;
      case "set-current": state.current = n; view.pick = false; range(n); blocksOf(n); save(); toast("Учим суру «" + SURAS[n - 1].ru + "»"); break;
      case "pick": view.pick = true; break;
      case "close": view.pick = false; view.tafsir = null; break;
      case "toggle-text": view.open[n + ":" + i] = !view.open[n + ":" + i]; break;
      case "check-mode": var ck = n + ":" + i; view.check[ck] = view.check[ck] ? 0 : 1; break;
      case "hint-mode": var hk = n + ":" + i; view.hint[hk] = !view.hint[hk]; break;
      case "reveal": view.check[n + ":" + i]++; break;
      case "split":
        bl = blocksOf(n); b = bl[i]; var mid = Math.floor((b.s + b.e + 1) / 2);
        bl.splice(i + 1, 0, { s: mid, e: b.e, name: B.title(rows(n)[mid - 1][1], mid, b.e) }); b.e = mid - 1; s.bsrc = "custom"; save(); break;
      case "merge":
        bl = blocksOf(n); bl[i].e = bl[i + 1].e; bl.splice(i + 1, 1); s.bsrc = "custom"; save(); break;
      case "reset-blocks": s.blocks = null; s.bsrc = null; blocksOf(n); view.open = {}; save(); toast("Блоки пересчитаны"); break;
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
      case "manzil": var dd = el.getAttribute("data-d"); if (state.manzil[dd]) delete state.manzil[dd]; else { state.manzil[dd] = true; toast("Отмечено: повторено"); } save(); break;
      case "set": setSetting(el.getAttribute("data-k"), el.getAttribute("data-v"), el.getAttribute("data-multi") === "1"); break;
      case "save-iv":
        var arr = document.getElementById("st-iv").value.split(/[,;\s]+/).filter(Boolean).map(Number);
        var okv = arr.length && arr.every(function (v, ix) { return v > 0 && Math.floor(v) === v && (ix === 0 || v > arr[ix - 1]); });
        if (!okv) { toast("Нужны целые числа по возрастанию, например: 1, 3, 7, 14, 30"); return; }
        state.set.intervals = arr; state.reviews.forEach(function (r) { r.stage = Math.min(r.stage, arr.length - 1); }); save(); toast("Интервалы сохранены"); break;
      case "reset-iv": state.set.intervals = [1, 3, 7, 14, 30]; save(); break;
      case "anchor": state.anchor = today(); save(); break;
      case "ask": view.confirm = el.getAttribute("data-what"); break;
      case "cancel": view.confirm = null; break;
      case "reset-sura": delete state.suras[n]; state.reviews = state.reviews.filter(function (r) { return r.n !== n; }); if (state.current === n) state.current = null; view.confirm = null; save(); toast("Прогресс суры сброшен"); break;
      case "reset-all": stopAudio(true); state = blank(); view = { tab: "today", sura: null, filter: "all", q: "", open: {}, check: {}, hint: {}, ob: { step: 0, known: "none", from: 78, to: 1, picks: {} } }; applyTheme(); save(); break;
      case "rerun": view.ob = { step: 0, known: "none", from: 78, to: 1, picks: {} }; break;
      case "copy": copyText(document.getElementById("bk").value, document.getElementById("bk")); return;
      case "import":
        try { var obj = migrate(JSON.parse(document.getElementById("bk").value)); if (!obj) throw new Error("bad"); state = obj; applyTheme(); save(); toast("Прогресс загружен"); }
        catch (e) { toast("В поле должен быть JSON из резервной копии"); return; }
        break;
      case "ob-pick": if (view.ob.picks[n]) delete view.ob.picks[n]; else view.ob.picks[n] = true; break;
      case "ob-back": obRead(); view.ob.step--; break;
      case "ob-next": obRead(); view.ob.step++; break;
      case "ob-finish":
        obRead();
        var known = obKnown(), o = view.ob;
        known.forEach(function (m) { var sm = S(m); sm.tr = o.tr; sm.tf = o.tf; setDone(m, 1, count(m), true); sm.range = [1, count(m)]; });
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
    if ((el = document.getElementById("ob-from"))) o.from = +el.value;
    if ((el = document.getElementById("ob-to"))) o.to = +el.value;
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
    if (f === "len") f = "e", val = b.s + val - 1;
    if (f === "s") {
      var prev = bl[i - 1];
      val = Math.max(prev.s + 1, Math.min(b.e, val));
      b.s = val; prev.e = val - 1;
    } else {
      var nx = bl[i + 1];
      val = Math.max(b.s, Math.min(r[1] - 1, val));
      b.e = val;
      // следующие блоки сдвигаются, пустые убираются
      var j = i + 1;
      while (j < bl.length) {
        var c = bl[j];
        c.s = bl[j - 1].e + 1;
        if (c.s > c.e) { if (j === bl.length - 1) { c.e = r[1]; break; } bl.splice(j, 1); continue; }
        break;
      }
      if (nx && bl[i + 1] && bl[i + 1].s > r[1]) bl.splice(i + 1);
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
  document.addEventListener("input", function (e) {
    var el = e.target, k = el.getAttribute("data-k");
    if (el.id === "q") { view.q = el.value; var pos = el.selectionStart; render(); var q = document.getElementById("q"); q.focus(); try { q.setSelectionRange(pos, pos); } catch (er) { /* ignore */ } return; }
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
    if (el.id === "st-listen") { state.set.listen = el.checked; save(); return; }
    if (el.id === "ob-from" || el.id === "ob-to") { obRead(); render(); }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && (view.tafsir || view.pick)) { view.tafsir = null; view.pick = false; render(); }
  });

  boot();
})();
