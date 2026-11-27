(function(){
  var root=document.documentElement, KEY="syllabus-theme", cur="light";
  try{ var v=localStorage.getItem(KEY); if(v==="dark"||v==="light"||v==="stoic") cur=v; }catch(e){}
  function apply(t){
    cur=t; root.setAttribute("data-theme",t);
    var p=document.getElementById("portal"); if(p) p.disabled=(t==="dark"||t==="stoic");
    Array.prototype.forEach.call(document.querySelectorAll("details.sug-fold"),function(d){
      if(t==="stoic"){ if(d.__wasOpen===undefined) d.__wasOpen=d.open; d.open=true; }
      else if(d.__wasOpen!==undefined){ d.open=d.__wasOpen; d.__wasOpen=undefined; }
    });
    var sw=document.getElementById("themeSwitch");
    if(sw) Array.prototype.forEach.call(sw.querySelectorAll("[data-settheme]"),function(btn){
      btn.setAttribute("aria-pressed", String(btn.getAttribute("data-settheme")===t));
    });
  }
  apply(cur);
  var sw=document.getElementById("themeSwitch");
  if(sw) sw.addEventListener("click",function(e){
    var b=e.target.closest ? e.target.closest("[data-settheme]") : null;
    if(!b) return;
    var n=b.getAttribute("data-settheme");
    apply(n);
    try{ localStorage.setItem(KEY,n); }catch(err){}
  });
})();

(function () {
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  var SUBJ = ["botany", "zoology", "chemistry", "physics"];
  var LABEL = { botany: "Botany", zoology: "Zoology", chemistry: "Chemistry", physics: "Physics" };
  var SIZES = [[1, "Very short"], [2, "Short"], [3, "Medium"], [4, "Long"], [5, "Very long"]];
  /* Points per tick are whole numbers: the size level itself (1 to 5). The levels follow NCERT page counts: up to 13, 14-19, 20-26, 27-34 and 35+ pages. */
  var SIZE_W = [0, 1, 2, 3, 4, 5];
  var CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  var FILTERS = [["all", "All"], ["todo", "Not started"], ["part", "In progress"], ["done", "Done"], ["due", "Due"]];
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  var DEFAULT_DEADLINE = "2027-03-01";
  var TESTS = 120, TEST_DAYS = 60;

  var state = {
    subjects: {}, chapters: [], active: "botany", filter: "all", search: "",
    gotS: false, gotC: false, err: "", slow: false,
    sizes: {}, goalPts: null, deadline: DEFAULT_DEADLINE
  };
  var db = null;
  var queues = {};
  var toastTimer = null;

  var fmt = function (p) { return Math.round(p * 100) + "%"; };
  var fint = function (x) { return Math.round(x).toLocaleString(); };
  var fnum = function (x) { return String(Math.round(x * 10) / 10); };
  var fmtDate = function (d) { return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }); };
  function dstr(d) {
    var m = d.getMonth() + 1, dd = d.getDate();
    return d.getFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (dd < 10 ? "0" : "") + dd;
  }
  function parseD(s) { var p = s.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function startOfToday() { var n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }

  function effRepeat(sub) {
    var s = state.subjects[sub];
    if (s && Array.isArray(s.repeat)) return s.repeat;
    return sourcesOf(sub).filter(function (n) { return /^ncert/i.test(n); });
  }
  function isRepeat(sub, src) { return effRepeat(sub).indexOf(src) > -1; }
  function readsOf(c, src) {
    var r = c.rounds && c.rounds[src];
    if (Array.isArray(r) && r.length) return r.length;
    return c.ticks && c.ticks[src] ? 1 : 0;
  }
  function lastRead(c, src) {
    var r = c.rounds && c.rounds[src], v = Array.isArray(r) && r.length ? r[r.length - 1] : (c.ticks && c.ticks[src]);
    return typeof v === "string" && DATE_RE.test(v) ? v : "";
  }
  function totalReads(chs, src) { var n = 0; chs.forEach(function (c) { n += readsOf(c, src); }); return n; }
  function srcCell(c, src) {
    if (isRepeat(c.subject, src)) {
      var n = readsOf(c, src), lv = Math.min(5, n), lr = lastRead(c, src);
      return '<td><span class="heatwrap"><button class="heat" type="button" data-heat="+" data-ch="' + esc(c.id) + '" data-src="' + esc(src) + '" data-level="' + lv + '" aria-label="' + esc(c.name + ", " + src + ", read " + n + (n === 1 ? " time" : " times") + ". Tap to add a read") + '" title="' + (n ? "Read " + n + "×" + (lr ? ", last " + lr : "") : "Not read yet") + '">' + (n || "") + '</button>' +
        '<button class="heatminus" type="button" data-heat="-" data-ch="' + esc(c.id) + '" data-src="' + esc(src) + '" aria-label="Remove a read of ' + esc(c.name + ", " + src) + '" title="Remove last read"' + (n ? "" : " disabled") + '>−</button></span></td>';
    }
    var on = !!(c.ticks && c.ticks[src]);
    return '<td><button class="tick" type="button" data-ch="' + esc(c.id) + '" data-src="' + esc(src) + '" aria-pressed="' + on + '" aria-label="' + esc(c.name + ", " + src) + '">' + CHECK + '</button></td>';
  }

  function sourcesOf(sub) { var s = state.subjects[sub]; return (s && s.sources) || []; }
  function chaptersOf(sub) {
    return state.chapters.filter(function (c) { return c.subject === sub; })
      .sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
  }
  var DIFFS = [[0, "Not rated"], [1, "1 · Easiest"], [2, "2 · Easy"], [3, "3 · Medium"], [4, "4 · Hard"], [5, "5 · Hardest"]];
  function diffOf(id) { return 0; } /* difficulty ratings were removed */
  state.order = "syllabus";
  function byDifficulty(list) {
    if (state.order !== "easy") return list;
    return list.map(function (c, i) { return { c: c, i: i, d: diffOf(c.id) }; }).sort(function (a, b) {
      var da = a.d || 99, db2 = b.d || 99;
      return da !== db2 ? da - db2 : a.i - b.i;
    }).map(function (x) { return x.c; });
  }
  function diffSelect(c) {
    var d = diffOf(c.id);
    return '<select class="size diff" data-diff="' + esc(c.id) + '" data-level="' + d + '" aria-label="Difficulty of ' + esc(c.name) + '">' + DIFFS.map(function (o) {
      return '<option value="' + o[0] + '"' + (o[0] === d ? " selected" : "") + '>' + o[1] + '</option>';
    }).join("") + '</select>';
  }
  function diffHead() { return ''; }
  function ptCell(c) { return ''; }
  function orderChip() { return ""; }
  function rawSize(id) { var s = state.sizes[id]; return s >= 1 && s <= 5 && s === Math.floor(s) ? s : 3; }
  var SUBJ_TARGET = 250;
  var wcache = { ch: null, sz: null, sb: null, map: {} };
  function weightMap() {
    if (wcache.ch === state.chapters && wcache.sz === state.sizes && wcache.sb === state.subjects) return wcache.map;
    var map = {};
    SUBJ.forEach(function (s) {
      var chs = chaptersOf(s), nSrc = sourcesOf(s).length, rawSum = 0;
      chs.forEach(function (c) { rawSum += SIZE_W[rawSize(c.id)] * nSrc; });
      var scale = rawSum > 0 ? SUBJ_TARGET / rawSum : 1;
      chs.forEach(function (c) {
        map[c.id] = SIZE_W[rawSize(c.id)] * scale;
      });
    });
    wcache = { ch: state.chapters, sz: state.sizes, sb: state.subjects, map: map };
    return map;
  }
  function sizeOf(id) { var w = weightMap()[id]; return w > 0 ? w : SIZE_W[rawSize(id)]; }
  function tickedCount(ch, srcs) {
    var n = 0;
    for (var i = 0; i < srcs.length; i++) if (ch.ticks && ch.ticks[srcs[i]]) n++;
    return n;
  }
  function statusOf(ch, srcs) {
    var n = tickedCount(ch, srcs);
    if (!srcs.length || n === 0) return "todo";
    return n === srcs.length ? "done" : "part";
  }
  function summary(sub) {
    var srcs = sourcesOf(sub), chs = chaptersOf(sub), total = 0, done = 0, started = 0;
    chs.forEach(function (c) {
      var w = sizeOf(c.id), n = tickedCount(c, srcs);
      total += w * srcs.length; done += w * n;
      if (n > 0) started++;
    });
    return { chapters: chs.length, started: started, total: total, done: done, pct: total ? done / total : 0, sources: srcs.length };
  }
  function totals() {
    var t = 0, d = 0;
    SUBJ.forEach(function (s) { var m = summary(s); t += m.total; d += m.done; });
    return { total: t, done: d };
  }
  function dayData() {
    var pts = {}, items = {};
    state.chapters.forEach(function (c) {
      if (!c.ticks) return;
      var w = sizeOf(c.id);
      Object.keys(c.ticks).forEach(function (s) {
        var v = c.ticks[s];
        if (typeof v === "string" && DATE_RE.test(v)) {
          pts[v] = (pts[v] || 0) + w;
          (items[v] = items[v] || []).push({ name: c.name, src: s, sub: c.subject, order: c.order || 0, w: w });
        }
      });
    });
    return { pts: pts, items: items };
  }
  function needed() {
    var t0 = startOfToday();
    var days = Math.max(0, Math.round((parseD(state.deadline) - t0) / 864e5));
    var tt = totals(), left = Math.max(0, tt.total - tt.done);
    return { t0: t0, days: days, left: left, need: days > 0 ? left / days : left };
  }
  function autoGoal() { return Math.min(60, Math.max(1, Math.ceil(needed().need))); }
  function effGoal() { return state.goalPts > 0 ? state.goalPts : autoGoal(); }
  /* With a fixed target, whatever you fell short of yesterday is added to today's. In auto mode the deadline pace already absorbs it. */
  function carryGap(dd) { return 0; }

  function toast(msg) {
    var t = $("toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 3500);
  }

  function renderTop() {
    var tt = totals();
    $("overallPct").textContent = fmt(tt.total ? tt.done / tt.total : 0);
    $("overallBar").style.width = (tt.total ? (tt.done / tt.total) * 100 : 0) + "%";
    $("overallText").textContent = tt.total
      ? fint(tt.done) + " of " + fint(tt.total) + " points covered"
      : (state.err || "Loading your syllabus");

    $("tabs").innerHTML = SUBJ.map(function (s) {
      var m = summary(s);
      return '<button class="tab" role="tab" type="button" data-subject="' + s + '" data-tab="' + s + '" aria-selected="' + (s === state.active) + '">' +
        '<span class="tab-head"><span class="tab-name">' + LABEL[s] + '</span><span class="tab-pct">' + fmt(m.pct) + '</span></span>' +
        '<span class="meter" aria-hidden="true"><i style="width:' + (m.pct * 100) + '%"></i></span>' +
        '<small>' + m.started + ' of ' + m.chapters + ' chapters started</small></button>';
    }).join("");
    $("panel").setAttribute("data-subject", state.active);
  }

  function datedMap(filter) {
    var m = {};
    state.chapters.forEach(function (c) {
      if (!c.ticks) return;
      var w = sizeOf(c.id);
      Object.keys(c.ticks).forEach(function (src) {
        var v = c.ticks[src];
        if (typeof v === "string" && DATE_RE.test(v) && filter(c, src)) m[v] = (m[v] || 0) + w;
      });
    });
    return m;
  }

  function chartW() {
    var c = document.querySelector(".view:not([hidden]) .card"), w = c ? c.clientWidth - 30 : 0;
    return w > 240 ? Math.min(900, w) : 640;
  }
  function burnChart(o) {
    if (!o.total) return "";
    var W = o.w || 640, H = W < 480 ? 236 : 276, L = W < 480 ? 42 : 50, R = 16, T = 40, B = 32, DAY = 864e5;
    var uid = (burnChart.n = (burnChart.n || 0) + 1);
    var today = o.today, due = o.due, left = Math.max(0, o.total - o.done);
    var keys = Object.keys(o.dated).sort();
    var start = o.startDate ? parseD(o.startDate) : new Date(today);
    if (!o.startDate) {
      start.setDate(start.getDate() - 13);
      if (keys.length) { var e0 = parseD(keys[0]); if (e0 < start) start = e0; }
    }
    var sday = o.startDate ? parseD(o.startDate) : (keys.length ? parseD(keys[0]) : today);
    var fin = null;
    if (o.pace > 0 && left > 0) { fin = new Date(today); fin.setDate(fin.getDate() + Math.ceil(left / o.pace)); }
    var endMs = Math.max(due.getTime(), today.getTime() + 7 * DAY);
    var spanD = Math.max(7, Math.round((endMs - start.getTime()) / DAY));
    var domEnd = start.getTime() + (spanD + Math.ceil(spanD * 0.04)) * DAY;
    var dom = domEnd - start.getTime();
    var x = function (d) { return L + (d.getTime() - start.getTime()) / dom * (W - L - R); };
    var rawStep = o.total / 6, mag = Math.pow(10, Math.floor(Math.log10(Math.max(rawStep, 0.1)))), step = mag * 10;
    [1, 2, 2.5, 5, 10].some(function (m) { if (m * mag >= rawStep) { step = m * mag; return true; } return false; });
    if (step < 1) step = 1;
    if (step > 100 && Math.ceil(o.total / 100) <= 14) step = 100;
    var ymax = Math.max(step, Math.ceil(o.total / step - 1e-9) * step);
    var y = function (v) { return T + (1 - Math.min(v, ymax) / ymax) * (H - T - B); };
    var f1 = function (n) { return Math.round(n * 10) / 10; };
    var pt = function (d, v) { return f1(x(d)) + "," + f1(y(v)); };
    var sd = function (d) { return d.toLocaleDateString(undefined, { day: "numeric", month: "short" }); };

    var startKey = dstr(start), sumDated = 0; keys.forEach(function (k) { if (k >= startKey) sumDated += o.dated[k]; });
    var base = Math.max(0, o.done - sumDated), cum = base, pts = [], series = [];
    for (var d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
      cum += o.dated[dstr(d)] || 0;
      pts.push(pt(new Date(d), Math.min(cum, o.total)));
      series.push(Math.min(cum, o.total));
    }
    var hasIdeal = due > sday && left > 0;
    var idealAt = function (ms) { return ms >= due.getTime() ? o.total : base + (o.total - base) * (ms - sday.getTime()) / (due.getTime() - sday.getTime()); };
    var shUp = "", shDn = "";
    if (hasIdeal) {
      for (var si = 1; si < series.length; si++) {
        var t0m = start.getTime() + (si - 1) * DAY, t1m = t0m + DAY;
        if (t0m < sday.getTime()) continue;
        var xa = f1(x(new Date(t0m))), xb = f1(x(new Date(t1m)));
        var a0v = series[si - 1], a1v = series[si], i0v = idealAt(t0m), i1v = idealAt(t1m);
        var quad = "M" + xa + "," + f1(y(a0v)) + " L" + xb + "," + f1(y(a1v)) + " L" + xb + "," + f1(y(i1v)) + " L" + xa + "," + f1(y(i0v)) + " Z ";
        if ((i0v + i1v) / 2 > (a0v + a1v) / 2) shDn += quad; else shUp += quad;
      }
    }
    var gapNow = hasIdeal ? idealAt(today.getTime()) - o.done : 0;
    var g = "";
    for (var yv = 0; yv <= ymax + 1e-9; yv += step) {
      var yy = f1(y(yv));
      g += '<line class="' + (yv === 0 ? "base" : "grid") + '" x1="' + L + '" x2="' + (W - R) + '" y1="' + yy + '" y2="' + yy + '"/>' +
        '<text x="' + (L - 8) + '" y="' + (yy + 4) + '" text-anchor="end">' + fint(yv) + '</text>';
    }
    var yt = f1(y(o.total));
    g += '<line class="tot" x1="' + L + '" x2="' + (W - R) + '" y1="' + yt + '" y2="' + yt + '"/>';
    if (Math.abs(o.total - ymax) > 1e-9 && Math.round(o.total / step) * step !== o.total) g += '<text class="totlab" x="' + (L + 6) + '" y="' + (yt - 5) + '">' + fint(o.total) + ' points in all</text>';
    g += (shUp ? '<path class="sh-up" d="' + shUp + '"/>' : '') + (shDn ? '<path class="sh-dn" d="' + shDn + '"/>' : '');
    var xd = f1(x(due));
    g += '<line class="due" x1="' + xd + '" x2="' + xd + '" y1="' + T + '" y2="' + (H - B) + '"/>';
    var a0 = pts[0].split(",");
    g += '<defs><linearGradient id="gf' + uid + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--day);stop-opacity:0.32"/><stop offset="1" style="stop-color:var(--day);stop-opacity:0"/></linearGradient></defs>' +
      '<path class="area" style="fill:url(#gf' + uid + ')" d="M' + a0[0] + ',' + f1(y(0)) + ' L' + pts.join(" L") + ' L' + pts[pts.length - 1].split(",")[0] + ',' + f1(y(0)) + ' Z"/>';
    if (hasIdeal) g += '<line class="req" x1="' + f1(x(sday)) + '" y1="' + f1(y(base)) + '" x2="' + xd + '" y2="' + f1(y(o.total)) + '"/>';

    g += '<polyline class="act" points="' + pts.join(" ") + '"/><circle class="dot" cx="' + f1(x(today)) + '" cy="' + f1(y(o.done)) + '" r="5"/>';

    /* Direct labels instead of a legend, and today's standing in a small pill. */
    if (hasIdeal) {
      var lx1 = x(sday), ly1 = y(base), lx2 = x(due), ly2 = y(o.total), len = Math.sqrt(Math.pow(lx2 - lx1, 2) + Math.pow(ly2 - ly1, 2));
      if (len > 150) {
        var fr = 0.62, ang = Math.atan2(ly2 - ly1, lx2 - lx1) * 180 / Math.PI;
        g += '<text class="dlab" text-anchor="middle" dy="-7" transform="translate(' + f1(lx1 + (lx2 - lx1) * fr) + ',' + f1(ly1 + (ly2 - ly1) * fr) + ') rotate(' + f1(ang) + ')">Needed to finish on time</text>';
      }
    }
    if (x(today) - L > 76) g += '<text class="dlab cov" text-anchor="end" x="' + f1(x(today) - 10) + '" y="' + f1(y(o.done) - 10) + '">Covered</text>';
    var pillTxt = left <= 0 ? "Complete" : !hasIdeal ? "" : Math.abs(gapNow) < 0.5 ? "On track" : (gapNow > 0 ? "Behind by " : "Ahead by ") + fint(Math.abs(gapNow)) + " pts";
    if (pillTxt) {
      var pw = Math.round(pillTxt.length * 6.6 + 18), px = Math.max(L, Math.min(W - R - pw, x(today) - pw / 2));
      var pcls = left <= 0 || gapNow <= 0.5 ? "ahead" : "behind";
      g += '<line class="todayline" x1="' + f1(x(today)) + '" x2="' + f1(x(today)) + '" y1="26" y2="' + (H - B) + '"/>' +
        '<rect class="gpill ' + pcls + '" x="' + f1(px) + '" y="6" width="' + pw + '" height="20" rx="10"/>' +
        '<text class="gtxt" x="' + f1(px + pw / 2) + '" y="20" text-anchor="middle">' + esc(pillTxt) + '</text>';
    }

    var used = [], labels = "";
    function lab(d, txt, strong) {
      var xx = Math.max(L + 40, Math.min(W - R - 40, x(d)));
      for (var i = 0; i < used.length; i++) if (Math.abs(used[i] - xx) < 118) return;
      used.push(xx);
      labels += '<text' + (strong ? ' class="strong"' : '') + ' x="' + f1(xx) + '" y="' + (H - 12) + '" text-anchor="middle">' + esc(txt) + '</text>';
    }
    lab(due, (o.dueLabel || "Due") + " " + sd(due), true);
    lab(today, "Today", true);

    lab(start, sd(start), false);
    /* Extra dates along the bottom: month starts on long spans, otherwise weekly, skipping any that would crowd a label already placed. */
    var tkUsed = [], spanDays = dom / DAY, xt = "", dd0 = new Date(start), dd1 = new Date(start.getTime() + dom);
    var ticks = [];
    if (spanDays > 70) { var m0 = new Date(dd0.getFullYear(), dd0.getMonth() + 1, 1); for (; m0 <= dd1; m0 = new Date(m0.getFullYear(), m0.getMonth() + 1, 1)) ticks.push(new Date(m0)); }
    else { var stp = spanDays > 28 ? 7 : spanDays > 14 ? 3 : 2; for (var td = new Date(start); td <= dd1; td = new Date(td.getFullYear(), td.getMonth(), td.getDate() + stp)) ticks.push(new Date(td)); }
    ticks.forEach(function (td) {
      var xx = x(td); if (xx < L + 6 || xx > W - R - 6) return;
      var clash = false, i2;
      for (i2 = 0; i2 < used.length; i2++) if (Math.abs(used[i2] - xx) < 66) clash = true;
      if (Math.abs(xd - xx) < 88) clash = true;
      for (i2 = 0; i2 < tkUsed.length; i2++) if (Math.abs(tkUsed[i2] - xx) < 52) clash = true;
      xt += '<line class="xgrid" x1="' + f1(xx) + '" x2="' + f1(xx) + '" y1="' + T + '" y2="' + (H - B + 4) + '"/>';
      if (clash) return;
      tkUsed.push(xx);
      labels += '<text class="xlab" x="' + f1(xx) + '" y="' + (H - 12) + '" text-anchor="middle">' + esc(sd(td)) + '</text>';
    });
    g = xt + g;

    var finTxt = fin ? (fin > due ? "Projected finish is " + Math.round((fin - due) / DAY) + " days after the due date." : "Projected finish is on or before the due date.") : "";
    var meta = ' data-w="' + W + '" data-l="' + L + '" data-r="' + R + '" data-start="' + start.getTime() + '" data-dom="' + dom + '" data-today="' + today.getTime() + '" data-due="' + due.getTime() + '" data-sday="' + sday.getTime() + '" data-base="' + base + '" data-fin="' + (fin ? fin.getTime() : "") + '" data-total="' + o.total + '" data-done="' + o.done + '" data-pace="' + f1(o.pace || 0) + '" data-series="' + series.join(",") + '" data-label="' + esc(o.dueLabel || "Due") + '" data-ymax="' + ymax + '" data-top="' + T + '" data-bot="' + (H - B) + '"';
    return '<svg class="burn"' + meta + ' viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Points covered over time against the line needed to finish by ' + esc(sd(due)) + '. ' + finTxt + '">' + g + labels + '<line class="guide" x1="0" x2="0" y1="' + T + '" y2="' + (H - B) + '" style="display:none"/><circle class="hdot hd1" r="4.5" style="display:none"/><circle class="hdot hd2" r="4" style="display:none"/></svg>';
  }

  setInterval(function () {
    if (state.view !== "plan") return;
    var ae = document.activeElement;
    if (ae && $("seneca") && $("seneca").contains(ae) && (ae.tagName === "INPUT" || ae.tagName === "SELECT")) return;
    if (state.timeEdit !== null || cbDrag || state.ttEdit) return;
    renderPlan();
  }, 60000);
  var rzT = null, rzW = 0;
  window.addEventListener("resize", function () {
    clearTimeout(rzT);
    rzT = setTimeout(function () { if (Math.abs(chartW() - rzW) > 20) { rzW = chartW(); try { renderDeadline(); renderTest(); } catch (e) {} } }, 200);
  });
  function renderToday() {
    var dd = dayData(), now = new Date(), today = dstr(now), goal = effGoal();
    var n = dd.pts[today] || 0;
    $("todayDate").textContent = "Today · " + now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
    $("todayPts").textContent = fnum(n);
    $("goalVal").textContent = goal;
    $("todayBar").style.width = (Math.min(1, n / goal) * 100) + "%";
    $("todayMsg").textContent = n >= goal ? "Goal reached. Anything more is extra."
      : (goal - n) + " more to reach today's goal." + (state.goalPts > 0 ? "" : " The goal follows your deadline pace.");

    var streak = 0, d = new Date(now);
    if (!(dd.pts[today] > 0)) d.setDate(d.getDate() - 1);
    while (dd.pts[dstr(d)] > 0) { streak++; d.setDate(d.getDate() - 1); }
    $("streak").textContent = streak ? streak + "-day streak" : "No streak yet";

    state.dd = dd; state.dayGoal = goal;
    var days = [], max = goal, i;
    for (i = 13; i >= 0; i--) {
      var x = new Date(now); x.setDate(x.getDate() - i);
      var k = dstr(x), c = dd.pts[k] || 0;
      if (c > max) max = c;
      days.push({ k: k, c: c, d: x, now: i === 0 });
    }
    $("plot").innerHTML = '<span class="goalline" style="bottom:' + (goal / max * 100) + '%"></span>' + days.map(function (x) {
      var cls = x.c === 0 ? "bar zero" : (x.c >= goal ? "bar hit" : "bar");
      var h = x.c === 0 ? "" : ' style="height:' + (x.c / max * 100) + '%"';
      return '<div class="cell' + (x.now ? " now" : "") + '" data-k="' + esc(x.k) + '" tabindex="0" role="img" aria-label="' + esc(x.d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })) + ': ' + x.c + ' points"><div class="' + cls + '"' + h + '></div></div>';
    }).join("");
    $("axis").innerHTML = days.map(function (x) {
      return '<div' + (x.now ? ' class="now"' : "") + '>' + esc(x.d.toLocaleDateString(undefined, { weekday: "narrow" })) + '</div>';
    }).join("");

    var list = (dd.items[today] || []).slice().sort(function (a, b) {
      return SUBJ.indexOf(a.sub) - SUBJ.indexOf(b.sub) || a.order - b.order;
    });
    $("todayList").innerHTML = list.length ? list.map(function (x) {
      return '<li data-subject="' + esc(x.sub) + '"><span class="tag">' + esc(LABEL[x.sub] || x.sub) + '</span><span>' + esc(x.name) + ' · ' + esc(x.src) + '</span><span class="pts">+' + fnum(x.w) + '</span></li>';
    }).join("") : '<li class="none">Nothing done yet today. Tick a source below and it is recorded here.</li>';
  }

  var tip = document.createElement("div");
  tip.className = "tip"; tip.hidden = true; tip.setAttribute("role", "tooltip");
  $("today").appendChild(tip);
  function showTip(cell) {
    var k = cell.getAttribute("data-k"), dd = state.dd || { pts: {}, items: {} }, goal = state.dayGoal || 0;
    var c = dd.pts[k] || 0, list = (dd.items[k] || []).slice().sort(function (a, b) {
      return SUBJ.indexOf(a.sub) - SUBJ.indexOf(b.sub) || a.order - b.order;
    });
    var h = '<b>' + esc(parseD(k).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })) + '</b>' +
      '<span>' + fnum(c) + ' point' + (c === 1 ? "" : "s") + (goal ? ' · ' + (c >= goal ? '<span class="t-ok">goal met</span>' : 'goal ' + goal) : '') + '</span>';
    if (list.length) {
      h += '<ul>' + list.slice(0, 6).map(function (x) {
        return '<li><span>' + esc(x.name) + ' · ' + esc(x.src) + '</span><span>+' + fnum(x.w) + '</span></li>';
      }).join("") + (list.length > 6 ? '<li class="t-sub"><span>and ' + (list.length - 6) + ' more</span><span></span></li>' : '') + '</ul>';
    } else h += '<span class="t-sub">Nothing ticked this day.</span>';
    tip.innerHTML = h; tip.hidden = false;
    var card = $("today").getBoundingClientRect(), r = cell.getBoundingClientRect();
    var left = r.left - card.left + r.width / 2 - tip.offsetWidth / 2;
    left = Math.max(8, Math.min(card.width - tip.offsetWidth - 8, left));
    var top = r.top - card.top - tip.offsetHeight - 8;
    if (top < 8) top = r.bottom - card.top + 8;
    tip.style.left = left + "px"; tip.style.top = top + "px";
  }
  function hideTip() { tip.hidden = true; }
  $("plot").addEventListener("mouseover", function (e) { var c = e.target.closest(".cell"); if (c) showTip(c); });
  $("plot").addEventListener("mouseleave", hideTip);
  $("plot").addEventListener("focusin", function (e) { var c = e.target.closest(".cell"); if (c) showTip(c); });
  $("plot").addEventListener("focusout", hideTip);
  $("plot").addEventListener("click", function (e) { var c = e.target.closest(".cell"); if (c) showTip(c); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") hideTip(); });

  var tip2 = document.createElement("div");
  tip2.className = "tip fixed"; tip2.hidden = true; tip2.setAttribute("role", "tooltip");
  document.body.appendChild(tip2);
  function hideBurn() {
    tip2.hidden = true;
    Array.prototype.forEach.call(document.querySelectorAll(".burn .guide, .burn .hdot"), function (g) { g.style.display = "none"; });
  }
  function showBurn(e) {
    var svg = e.target.closest ? e.target.closest("svg.burn") : null;
    if (!svg) { hideBurn(); return; }
    var a = function (n) { return svg.getAttribute("data-" + n); };
    var W = +a("w"), L = +a("l"), R = +a("r"), start = +a("start"), dom = +a("dom"), today = +a("today"), due = +a("due");
    var fin = a("fin") ? +a("fin") : null, total = +a("total"), done = +a("done"), pace = +a("pace");
    var rect = svg.getBoundingClientRect(), xv = (e.clientX - rect.left) / rect.width * W;
    if (xv < L || xv > W - R) { hideBurn(); return; }
    var DAY = 864e5, ms = start + (xv - L) / (W - L - R) * dom;
    var day = new Date(Math.round(ms / DAY) * DAY); day = new Date(day.getFullYear(), day.getMonth(), day.getDate());
    var t0 = Math.round((day.getTime() - today) / DAY);
    var gx = L + ((day.getTime() - start) / dom) * (W - L - R), g = svg.querySelector(".guide");
    g.setAttribute("x1", gx); g.setAttribute("x2", gx); g.style.display = "";
    var lines = [], series = a("series") ? a("series").split(",").map(Number) : [];
    var idx = Math.round((day.getTime() - start) / DAY);
    var sday = +a("sday"), base = +a("base"), dm = day.getTime(), cov = null, hv2 = null;
    if (t0 <= 0 && idx >= 0 && idx < series.length) { cov = series[idx]; lines.push(["Covered", fint(cov) + " of " + fint(total)]); }
    if (due > sday && done < total && dm >= sday) {
      var need = dm >= due ? total : base + (total - base) * (dm - sday) / (due - sday);
      lines.push(["Needed to finish on time", "about " + fint(need)]);
      hv2 = need;
      if (cov !== null) { var gap = Math.round(need - cov); lines.push([gap > 0 ? "Behind by" : "Ahead by", Math.abs(gap) + " points"]); }
    }
    var ymaxv = +a("ymax"), topv = +a("top"), botv = +a("bot");
    var yOf = function (v) { return topv + (1 - Math.min(v, ymaxv) / ymaxv) * (botv - topv); };
    var d1 = svg.querySelector(".hd1"), d2 = svg.querySelector(".hd2");
    if (d1) { if (cov !== null) { d1.setAttribute("cx", gx); d1.setAttribute("cy", yOf(cov)); d1.style.display = ""; } else d1.style.display = "none"; }
    if (d2) { if (hv2 !== null) { d2.setAttribute("cx", gx); d2.setAttribute("cy", yOf(hv2)); d2.style.display = ""; } else d2.style.display = "none"; }
    var tags = [];
    if (Math.round((day.getTime() - due) / DAY) === 0) tags.push(a("label") + " date");
    if (t0 === 0) tags.push("today");

    tip2.innerHTML = '<b>' + esc(day.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" })) + '</b>' +
      (tags.length ? '<span class="t-ok">' + esc(tags.join(" · ")) + '</span>' : '') +
      (lines.length ? '<ul>' + lines.map(function (l) { return '<li><span>' + esc(l[0]) + '</span><span>' + esc(l[1]) + '</span></li>'; }).join("") + '</ul>' : '<span class="t-sub">Nothing to compare for this day.</span>');
    tip2.hidden = false;
    var w = tip2.offsetWidth, h = tip2.offsetHeight;
    var left = Math.max(8, Math.min(window.innerWidth - w - 8, e.clientX - w / 2));
    var top = e.clientY - h - 14; if (top < 8) top = e.clientY + 18;
    tip2.style.left = left + "px"; tip2.style.top = top + "px";
  }
  document.addEventListener("mousemove", function (e) { if (e.target.closest && e.target.closest("svg.burn")) showBurn(e); else if (!tip2.hidden) hideBurn(); });
  document.addEventListener("click", function (e) { if (e.target.closest && e.target.closest("svg.burn")) showBurn(e); });
  document.addEventListener("scroll", hideBurn, true);

  /* Current rate, as in cricket: everything scored since the first innings day, over every day played so far (today included). */
  function currentRate(dd) {
    var keys = Object.keys(dd.pts).filter(function (k) { return dd.pts[k] > 0; }).sort();
    if (!keys.length) return 0;
    var t0 = startOfToday(), first = parseD(keys[0]), sum = 0;
    keys.forEach(function (k) { if (parseD(k) <= t0) sum += dd.pts[k]; });
    var days = Math.max(1, Math.round((t0 - first) / 864e5) + 1);
    return sum / days;
  }
  function renderDeadline() {
    var q = needed(), dd = dayData(), dl = parseD(state.deadline), i, sum = 0;
    var pace = currentRate(dd);
    $("dlDays").textContent = q.days;
    if ($("dlInput").value !== state.deadline && document.activeElement !== $("dlInput")) $("dlInput").value = state.deadline;
    $("dlPoints").textContent = fint(totals().done) + "/" + fint(totals().total);
    $("dlNeed").textContent = fnum(q.need);
    $("dlPace").textContent = fnum(pace);

    var msg = "", ds = "";
    if (state.gotC && q.left <= 0) { msg = "Every slot is ticked. The syllabus is complete."; ds = "ok"; }
    else if (q.days === 0) { msg = "The deadline is today with " + fint(q.left) + " points left."; ds = "behind"; }
    else if (pace === 0) { msg = "Tick a few boxes and your projected finish date appears here."; }
    else {
      var f = new Date(q.t0); f.setDate(f.getDate() + Math.ceil(q.left / pace));
      var diff = Math.round((f - dl) / 864e5);
      if (diff <= 0) { msg = "On pace. At your current rate you finish around " + fmtDate(f) + (diff < 0 ? ", " + (-diff) + " days early." : "."); ds = "ok"; }
      else { msg = "Behind pace. At your current rate you finish around " + fmtDate(f) + ", " + diff + " days after the deadline."; ds = "behind"; }
    }
    var st = $("dlStatus"); st.textContent = msg;
    if (ds) st.setAttribute("data-state", ds); else st.removeAttribute("data-state");

    var tt0 = totals();
    $("dlChart").innerHTML = burnChart({ total: tt0.total, done: tt0.done, today: q.t0, due: dl, pace: pace, dated: datedMap(function () { return true; }), startDate: "2026-11-01", dueLabel: "Deadline", w: chartW() });

    var auto = autoGoal(), btn = $("dlApply");
    btn.hidden = !(state.goalPts > 0 && state.goalPts !== auto);
    btn.textContent = "Reset goal to deadline pace (" + auto + " points a day)";
    $("dlTests").textContent = "Then the test phase from " + fmtDate(dl) + ": " + TESTS + " papers in about " + TEST_DAYS + " days is " + fnum(TESTS / TEST_DAYS) + " a day.";
  }

  function renderGrid() {
    var sub = state.active, srcs = sourcesOf(sub), chs = chaptersOf(sub), grid = $("grid");
    function isChapterDue(c) {
      var sp = spaceInfo(c, srcs, tickedCount(c, srcs), {});
      return !!(sp && sp.od >= 0);
    }
    var counts = { all: chs.length, todo: 0, part: 0, done: 0, due: 0 };
    chs.forEach(function (c) { counts[statusOf(c, srcs)]++; if (isChapterDue(c)) counts.due++; });
    $("chips").innerHTML = FILTERS.map(function (f) {
      return '<button class="chip" type="button" data-filter="' + f[0] + '" aria-pressed="' + (state.filter === f[0]) + '">' + f[1] + ' <span>' + counts[f[0]] + '</span></button>';
    }).join("") + orderChip();

    var m = summary(sub);
    $("plan").textContent = m.sources && m.chapters
      ? m.chapters + " chapters × " + m.sources + " sources, weighted by chapter size = " + fint(m.total) + " points · " + fint(m.done) + " covered"
      : "";

    if (!chs.length) {
      var loaded = state.gotS && state.gotC;
      var msg = state.err ? ["Saved data could not be loaded", state.err]
        : state.slow ? ["Still trying to reach your saved data", "Check your connection. The tracker fills in as soon as it answers."]
        : loaded ? ["No chapters yet", "Chapters from your Google Sheet appear here once they are imported."]
        : ["Loading chapters", "This takes a moment."];
      grid.innerHTML = '<div class="state"><strong>' + esc(msg[0]) + '</strong>' + esc(msg[1]) + '</div>';
      return;
    }

    var qSearch = (state.search || "").toLowerCase().trim();
    var list = byDifficulty(chs.filter(function (c) {
      var okF = state.filter === "all" ? true : (state.filter === "due" ? isChapterDue(c) : statusOf(c, srcs) === state.filter);
      if (!okF) return false;
      return !qSearch || c.name.toLowerCase().indexOf(qSearch) > -1;
    }));
    var head = '<tr><th scope="col" class="chcol sizecol"><span>Chapter</span><small>' + chs.length + ' total</small></th><th class="sizecol" scope="col"><span>Size</span><small>length</small></th>' + diffHead() + srcs.map(function (s) {
      var n = 0; chs.forEach(function (c) { if (c.ticks && c.ticks[s]) n++; });
      return '<th class="src" scope="col"><span>' + esc(s) + '</span><small>' + n + '/' + chs.length + '</small></th>';
    }).join("") + '<th class="pctcol" scope="col">Done<small>by size</small></th><th class="src qcol" scope="col"><span>Q</span><small>questions</small></th><th class="src qcol" scope="col"><span>F</span><small>cards</small></th></tr>';

    var qi = qlIndex();
    var body = list.map(function (c) {
      var w = rawSize(c.id), n = tickedCount(c, srcs), p = srcs.length ? n / srcs.length : 0;
      var opts = SIZES.map(function (o) {
        return '<option value="' + o[0] + '"' + (o[0] === w ? " selected" : "") + '>' + o[1] + '</option>';
      }).join("");
      var cells = srcs.map(function (s) { return srcCell(c, s); }).join("");
      return '<tr class="' + statusOf(c, srcs) + '"><td><button type="button" class="chlink" data-chsheet="' + esc(c.id) + '" title="Open questions and flashcards">' + esc(c.name) + '</button></td>' +
        '<td><select class="size" data-size="' + esc(c.id) + '"' + (state.sizes["p:" + c.id] ? ' title="NCERT pages: ' + Number(state.sizes["p:" + c.id]) + '"' : '') + ' aria-label="Size of ' + esc(c.name) + '">' + opts + '</select></td>' + ptCell(c) + cells +
        '<td><div class="pctcell"><span class="pct">' + fmt(p) + '</span><span class="mini"><i style="width:' + (p * 100) + '%"></i></span></div></td>' + qlCell(c.id, "q", qi[c.id]) + qlCell(c.id, "f", qi[c.id]) + '</tr>';
    }).join("");

    grid.innerHTML = '<table><thead>' + head + '</thead><tbody>' + (body || '') + '</tbody></table>' +
      (list.length ? "" : '<div class="state"><strong>Nothing in this view</strong>Try another filter.</div>');
  }

  function render() { renderTop(); renderToday(); renderDeadline(); renderGrid(); renderMgr(); renderTest(); renderPlan(); }
  function renderSide() { renderTop(); renderToday(); renderDeadline(); renderPlan(); }

  function renderMgr() {
    var host = $("srcMgr"), mb = $("mgrBtn");
    if (!host) return;
    mb.textContent = state.mgr ? "Done editing" : "Edit sources";
    host.hidden = !state.mgr;
    if (!state.mgr) return;
    if (host.contains(document.activeElement) && document.activeElement.tagName === "INPUT") return;
    var sub = state.active, srcs = sourcesOf(sub), chs = chaptersOf(sub);
    host.setAttribute("data-subject", sub);
    host.innerHTML = '<strong>Sources for ' + LABEL[sub] + '</strong><p class="note">Rename a source by editing its name and pressing Enter. Ticks and tests move with it. Deleting a source removes its ticks for every chapter.</p>' +
      (srcs.length ? srcs.map(function (src) {
        var n = 0; chs.forEach(function (c) { if (c.ticks && c.ticks[src]) n++; });
        var sure = state.srcSure === sub + "|" + src;
        return '<div class="mgr-row"><input class="srcname" type="text" maxlength="24" value="' + esc(src) + '" data-srcold="' + esc(src) + '" aria-label="Rename source ' + esc(src) + '">' +
          '<label class="rep"><input type="checkbox" data-srcrep="' + esc(src) + '"' + (isRepeat(sub, src) ? " checked" : "") + '> Heatmap (re-reads)</label>' +
          '<span class="cnt">' + n + '/' + chs.length + ' ticked</span>' +
          '<button type="button" class="del' + (sure ? " sure" : "") + '" data-srcdel="' + esc(src) + '">' + (sure ? "Confirm delete" : "Delete") + '</button></div>';
      }).join("") : '<p class="note">No sources yet. Use + Add source.</p>');
  }
  function cleanName(raw) { return String(raw || "").replace(/[.\[\]\/]/g, " ").replace(/\s+/g, " ").trim().slice(0, 24); }
  function mapTests(sub, fn) {
    state.tests.forEach(function (x) {
      var cur = x.sources && x.sources[sub];
      if (!cur) return;
      var nx = fn(cur.slice());
      if (JSON.stringify(nx) === JSON.stringify(cur)) return;
      x.sources[sub] = nx; saveTest(x.id);
    });
  }
  function setRepeat(sub, src, on) {
    if (needDb()) { renderMgr(); return; }
    var cur = effRepeat(sub).slice(), i = cur.indexOf(src);
    if (on && i < 0) cur.push(src); else if (!on && i > -1) cur.splice(i, 1);
    state.subjects[sub] = Object.assign({}, state.subjects[sub], { repeat: cur });
    queued("s:" + sub, function () { return db.collection("subjects").doc(sub).update({ repeat: cur }); });
    render();
  }
  function renameSource(sub, old, raw) {
    var nu = cleanName(raw), list = sourcesOf(sub);
    if (!nu || nu === old) { renderMgr(); return; }
    if (list.some(function (s) { return s !== old && s.toLowerCase() === nu.toLowerCase(); })) { toast(nu + " is already a source."); renderMgr(); return; }
    if (needDb()) { renderMgr(); return; }
    var next = list.map(function (s) { return s === old ? nu : s; });
    var rp = effRepeat(sub).map(function (s) { return s === old ? nu : s; });
    state.subjects[sub] = Object.assign({}, state.subjects[sub], { sources: next, repeat: rp });
    queued("s:" + sub, function () { return db.collection("subjects").doc(sub).update({ sources: next, repeat: rp }); });
    state.chapters.forEach(function (c) {
      if (c.subject !== sub || !((c.ticks && old in c.ticks) || (c.rounds && old in c.rounds))) return;
      var t = Object.assign({}, c.ticks || {}); if (old in t) { t[nu] = t[old]; delete t[old]; } c.ticks = t;
      if (c.rounds && old in c.rounds) { var rr = Object.assign({}, c.rounds); rr[nu] = rr[old]; delete rr[old]; c.rounds = rr; }
      var data = Object.assign({}, c); delete data.id;
      queued("c:" + c.id, function () { return db.collection("chapters").doc(c.id).set(data); });
    });
    mapTests(sub, function (a) { return a.map(function (s) { return s === old ? nu : s; }); });
    render(); toast("Renamed to " + nu + ".");
  }
  function deleteSource(sub, name) {
    var key = sub + "|" + name;
    if (state.srcSure !== key) { state.srcSure = key; renderMgr(); return; }
    if (needDb()) return;
    state.srcSure = "";
    var next = sourcesOf(sub).filter(function (s) { return s !== name; });
    var rp = effRepeat(sub).filter(function (s) { return s !== name; });
    state.subjects[sub] = Object.assign({}, state.subjects[sub], { sources: next, repeat: rp });
    queued("s:" + sub, function () { return db.collection("subjects").doc(sub).update({ sources: next, repeat: rp }); });
    state.chapters.forEach(function (c) {
      if (c.subject !== sub || !((c.ticks && name in c.ticks) || (c.rounds && name in c.rounds))) return;
      var t = Object.assign({}, c.ticks || {}); delete t[name]; c.ticks = t;
      if (c.rounds && name in c.rounds) { var rr = Object.assign({}, c.rounds); delete rr[name]; c.rounds = rr; }
      var data = Object.assign({}, c); delete data.id;
      queued("c:" + c.id, function () { return db.collection("chapters").doc(c.id).set(data); });
    });
    mapTests(sub, function (a) { return a.filter(function (s) { return s !== name; }); });
    render(); toast("Deleted " + name + ".");
  }

  function queued(id, fn) {
    var prev = queues[id] || Promise.resolve();
    var next = prev.then(fn).catch(function (e) {
      toast(e && e.code === "invalid_argument" ? "You can view this tracker but not change it." : "Could not save that change. Try again.");
    });
    queues[id] = next; return next;
  }
  function needDb() { if (!db) { toast("Saving is not available in this view."); return true; } return false; }

  function toggle(id, src) {
    if (needDb()) return;
    var ch = state.chapters.filter(function (c) { return c.id === id; })[0];
    if (!ch) return;
    var cur = !!(ch.ticks && ch.ticks[src]);
    var patch = { ticks: {} }; patch.ticks[src] = cur ? false : dstr(new Date());
    queued("c:" + id, function () { return db.collection("chapters").doc(id).update(patch); });
  }

  function heat(id, src, dir) {
    if (needDb()) return;
    var ch = state.chapters.filter(function (c) { return c.id === id; })[0];
    if (!ch) return;
    var n = readsOf(ch, src), today = dstr(new Date());
    var r = (ch.rounds && Array.isArray(ch.rounds[src]) && ch.rounds[src].length) ? ch.rounds[src].slice() : (n ? [lastRead(ch, src)] : []);
    var tk;
    if (dir > 0) { r.push(today); if (n === 0) tk = today; }
    else { if (!n) return; r.pop(); if (!r.length) tk = false; }
    var patch = { rounds: {} }; patch.rounds[src] = r;
    if (tk !== undefined) { patch.ticks = {}; patch.ticks[src] = tk; }
    queued("c:" + id, function () { return db.collection("chapters").doc(id).update(patch); });
  }

  function addSource(raw) {
    if (needDb()) return;
    var name = raw.replace(/[.\[\]\/]/g, " ").replace(/\s+/g, " ").trim().slice(0, 24);
    if (!name) return;
    var list = sourcesOf(state.active);
    if (list.some(function (s) { return s.toLowerCase() === name.toLowerCase(); })) { toast(name + " is already a source."); return; }
    var sub = state.active;
    queued("s:" + sub, function () {
      return db.collection("subjects").doc(sub).update({ sources: list.concat([name]) });
    }).then(function () { $("addForm").hidden = true; $("addInput").value = ""; });
  }

  function saveSettings() {
    var payload = { deadline: state.deadline };
    if (state.goalPts > 0) payload.goalPts = state.goalPts;
    queued("settings", function () { return db.doc("settings/daily").set(payload); });
  }
  function setGoal(g) {
    if (needDb()) return;
    g = Math.max(1, Math.min(60, Math.round(g)));
    if (state.goalPts > 0 && g === state.goalPts) return;
    state.goalPts = g; renderToday(); renderDeadline(); renderPlan(); saveSettings();
  }
  function resetGoal() {
    if (needDb()) return;
    state.goalPts = null; renderToday(); renderDeadline(); renderPlan(); saveSettings();
  }
  function setDiff(id, v) {
    if (needDb()) { renderGrid(); renderTest(); return; }
    var sizes = Object.assign({}, state.sizes); sizes["d:" + id] = v; state.sizes = sizes;
    render();
    var patch = {}; patch["d:" + id] = v;
    queued("sizes", function () { return db.doc("settings/sizes").update(patch); });
  }
  function setOrder() {
    state.order = state.order === "easy" ? "syllabus" : "easy";
    try { localStorage.setItem("syllabus-order", state.order); } catch (e) {}
    renderGrid(); renderTest();
  }
  function setSize(id, v) {
    if (needDb()) { renderGrid(); return; }
    var sizes = Object.assign({}, state.sizes); sizes[id] = v; state.sizes = sizes;
    render();
    var patch = {}; patch[id] = v;
    queued("sizes", function () { return db.doc("settings/sizes").update(patch); });
  }
  function setBlocks(id, v) {
    if (needDb()) { renderGrid(); return; }
    var sizes = Object.assign({}, state.sizes); sizes["b:" + id] = v; state.sizes = sizes;
    render();
    var patch = {}; patch["b:" + id] = v;
    queued("sizes", function () { return db.doc("settings/sizes").update(patch); });
  }

  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-order],[data-tab],[data-filter],[data-goal],[data-resetgoal],[data-mgrtoggle],[data-srcdel],.tick,.heat,.heatminus");
    if (!t) return;
    if (t.hasAttribute("data-order")) setOrder();
    else if (t.hasAttribute("data-tab")) { state.active = t.getAttribute("data-tab"); render(); }
    else if (t.hasAttribute("data-filter")) { state.filter = t.getAttribute("data-filter"); renderGrid(); }
    else if (t.hasAttribute("data-mgrtoggle")) { state.mgr = !state.mgr; state.srcSure = ""; renderMgr(); }
    else if (t.hasAttribute("data-srcdel")) deleteSource(state.active, t.getAttribute("data-srcdel"));
    else if (t.hasAttribute("data-resetgoal")) resetGoal();
    else if (t.hasAttribute("data-goal")) setGoal(effGoal() + Number(t.getAttribute("data-goal")));
    else if (t.classList.contains("heat") || t.classList.contains("heatminus")) heat(t.getAttribute("data-ch"), t.getAttribute("data-src"), t.getAttribute("data-heat") === "+" ? 1 : -1);
    else if (t.classList.contains("tick")) toggle(t.getAttribute("data-ch"), t.getAttribute("data-src"));
  });
  document.addEventListener("change", function (e) {
    var t = e.target;
    if (t.hasAttribute && t.hasAttribute("data-srcrep")) { setRepeat(state.active, t.getAttribute("data-srcrep"), t.checked); return; }
    if (t.classList && t.classList.contains("srcname")) { renameSource(state.active, t.getAttribute("data-srcold"), t.value); return; }
    if (t.hasAttribute && t.hasAttribute("data-diff")) { var dv = Number(t.value); if (dv >= 0 && dv <= 5) setDiff(t.getAttribute("data-diff"), dv); return; }
    if (t.hasAttribute && t.hasAttribute("data-planblks")) {
      var bv = Number(t.value), pidx2 = Number(t.getAttribute("data-planblks")), cid2 = t.getAttribute("data-ch");
      if (bv >= 1 && bv <= 6) {
        setBlocks(cid2, bv);
        var pr2 = planResolved(planKey(0)).filter(function (x) { return x.i === pidx2; })[0];
        if (pr2 && pr2.blks && pr2.blks.length) placeAtBlock(pidx2, pr2.blks[0]);
      }
      return;
    }
    if (t.hasAttribute && t.hasAttribute("data-size")) {
      var v = Number(t.value);
      if (v >= 1 && v <= 5) setSize(t.getAttribute("data-size"), v);
    }
  });
  if ($("chSearch")) {
    $("chSearch").addEventListener("input", function () {
      state.search = $("chSearch").value;
      renderGrid();
    });
  }
  $("addBtn").addEventListener("click", function () {
    var f = $("addForm"); f.hidden = !f.hidden; if (!f.hidden) $("addInput").focus();
  });
  $("addCancel").addEventListener("click", function () { $("addForm").hidden = true; });
  $("addForm").addEventListener("submit", function (e) { e.preventDefault(); addSource($("addInput").value); });
  $("dlInput").addEventListener("change", function () {
    var v = $("dlInput").value;
    if (!DATE_RE.test(v) || v === state.deadline) return;
    if (needDb()) return;
    state.deadline = v; renderDeadline(); renderToday(); saveSettings();
  });

  /* ---------- Test prep ---------- */
  state.view = "plan"; state.tests = []; state.testId = null;
  state.mgr = false; state.srcSure = ""; state.tpSub = "botany"; state.tpFilter = "all"; state.tpAddCh = false; state.tpAddSrc = false;
  state.confirmDel = false; state.newOpen = false;

  function currentTest() {
    for (var i = 0; i < state.tests.length; i++) if (state.tests[i].id === state.testId) return state.tests[i];
    return null;
  }
  function saveActive() { try { localStorage.setItem("neet-test", state.testId || ""); } catch (e) {} }
  function pickDefaultTest() {
    var saved = null; try { saved = localStorage.getItem("neet-test"); } catch (e) {}
    if (saved && state.tests.some(function (x) { return x.id === saved; })) return saved;
    var t0 = dstr(new Date());
    var up = state.tests.filter(function (x) { return x.date && x.date >= t0; })
      .sort(function (a, b) { return a.date < b.date ? -1 : 1; })[0];
    if (up) return up.id;
    var last = state.tests.slice().sort(function (a, b) { return (b.created || 0) - (a.created || 0); })[0];
    return last ? last.id : null;
  }
  function testDays(x) {
    return x && x.date && DATE_RE.test(x.date) ? Math.round((parseD(x.date) - startOfToday()) / 864e5) : null;
  }
  function chosenSources(x, sub) {
    var have = sourcesOf(sub), sel = (x.sources && x.sources[sub]) || [];
    return have.filter(function (s) { return sel.indexOf(s) > -1; });
  }
  function chapterSet(x) {
    var set = {}; (x.chapters || []).forEach(function (id) { set[id] = 1; });
    return set;
  }
  function testScope(x) {
    var set = chapterSet(x), out = { total: 0, done: 0, left: 0, by: {}, count: 0 };
    SUBJ.forEach(function (s) { out.by[s] = { total: 0, done: 0, chapters: 0 }; });
    state.chapters.forEach(function (c) {
      if (!set[c.id] || !out.by[c.subject]) return;
      var b = out.by[c.subject], w = sizeOf(c.id);
      b.chapters++; out.count++;
      chosenSources(x, c.subject).forEach(function (s) {
        b.total += w; out.total += w;
        if (c.ticks && c.ticks[s]) { b.done += w; out.done += w; }
      });
    });
    out.left = out.total - out.done;
    return out;
  }
  function paceAll() { return currentRate(dayData()); }

  function renderTpPlan() {
    var host = $("tpPlan");
    if (host.contains(document.activeElement) && document.activeElement !== host) return;
    var x = currentTest();
    var list = state.tests.slice().sort(function (a, b) { return (a.date || "9999") < (b.date || "9999") ? -1 : 1; });
    var h = '<div class="tp-top"><div class="tp-pick"><p class="eyebrow">Test prep</p>';
    if (list.length) {
      h += '<label class="sr" for="tpSelect">Choose a test</label><select id="tpSelect" class="field">' + list.map(function (y) {
        return '<option value="' + esc(y.id) + '"' + (x && y.id === x.id ? " selected" : "") + '>' + esc(y.name || "Untitled test") + (y.date ? " · " + esc(fmtDate(parseD(y.date))) : "") + '</option>';
      }).join("") + '</select>';
    } else {
      h += '<p class="note">No test planned yet. Add one to choose its chapters and resources.</p>';
    }
    h += '</div>' + (list.length ? '<button type="button" class="pill" data-testnew="1">' + (state.newOpen ? "Cancel" : "+ New test") + '</button>' : '') + '</div>';
    if (x) {
      h += '<div class="tp-row"><label class="fld"><span>Name</span><input id="tpName" class="field" type="text" maxlength="60" value="' + esc(x.name || "") + '"></label>' +
        '<button type="button" class="pill' + (state.confirmDel ? " warn" : "") + '" data-testdel="1">' + (state.confirmDel ? "Confirm delete" : "Delete test") + '</button></div>';
    }
    if (state.newOpen || !list.length) {
      h += '<form id="tpNewForm" class="tp-row"><label class="fld"><span>New test name</span><input id="npName" class="field" type="text" maxlength="60" placeholder="e.g. Allen Test 5" required></label>' +
        '<label class="fld"><span>Test date</span><input id="npDate" class="field" type="date" required></label>' +
        '<button class="pill main" type="submit">Create test</button></form>';
    }
    host.innerHTML = h;
  }

  function renderTpProgress(x) {
    var host = $("tpProgress");
    if (host.contains(document.activeElement) && document.activeElement.tagName === "INPUT") return;
    if (!x) { host.innerHTML = '<p class="eyebrow">Test deadline</p><p class="note">Create a test to see whether your coverage is on track for its date.</p>'; return; }
    var sc = testScope(x), name = esc(x.name || "this test");
    var days = testDays(x), pace = paceAll(), p = sc.total ? sc.done / sc.total : 0;
    var need = days !== null && days > 0 ? sc.left / days : sc.left;
    var cset = chapterSet(x), chosen = {};
    SUBJ.forEach(function (s) { chosen[s] = chosenSources(x, s); });
    var inTest = function (c, src) { return cset[c.id] && chosen[c.subject] && chosen[c.subject].indexOf(src) > -1; };
    var dated = datedMap(inTest), todayPts = dated[dstr(new Date())] || 0;
    var goal = Math.max(1, Math.ceil(need)), msg = "", ds = "", cap = "";
    if (!sc.total) msg = "Pick chapters and materials below. Your progress for this test shows up here.";
    else if (sc.left <= 0) { msg = "Everything you picked for this test is covered."; ds = "ok"; }
    else if (days === null) msg = "Add a test date to see the pace you need.";
    else if (days < 0) { msg = "This test date has passed."; ds = "behind"; }
    else if (days === 0) { msg = "The test is today with " + fint(sc.left) + " points left."; ds = "behind"; }
    else if (pace === 0) msg = "Tick a few boxes and your projected finish date appears here.";
    else {
      var f = new Date(startOfToday()); f.setDate(f.getDate() + Math.ceil(sc.left / pace));
      var diff = Math.round((f - parseD(x.date)) / 864e5);
      if (diff <= 0) { msg = "On pace. At your current rate you finish around " + fmtDate(f) + (diff < 0 ? ", " + (-diff) + " days before the test." : ", the day of the test."); ds = "ok"; }
      else { msg = "Behind pace. At your current rate you finish around " + fmtDate(f) + ", " + diff + " days after the test."; ds = "behind"; }
      var room = pace * days - sc.left;
      cap = "At your pace you can cover about " + fint(pace * days) + " more points before the test, and this plan needs " + fint(sc.left) + ". " + (room >= 0 ? "About " + fint(room) + " points to spare." : "You are about " + fint(-room) + " points short.");
    }
    var planLine = "";
    if (sc.left > 0 && days !== null && days >= 0) {
      var ti0 = testInfo(x), td0 = testToday(ti0, planResolved(planKey(0)), planKey(0));
      planLine = '<p class="note">In today\'s plan for this test: ' + td0.pend + ' points still to do, ' + td0.done + ' done today. This test needs about ' + fnum(td0.perDay) + ' a day.</p>' +
        (td0.short > 0 ? '<button type="button" class="pill main" data-testplan="1">Add ' + td0.short + ' points to today\'s plan</button>' : '<p class="note">Today\'s plan already covers this test\'s daily share.</p>');
    }
    var chart = x.date && DATE_RE.test(x.date) ? burnChart({ total: sc.total, done: sc.done, today: startOfToday(), due: parseD(x.date), pace: pace, dated: dated, dueLabel: "Test", w: chartW() }) : "";
    var bars = SUBJ.filter(function (s) { return sc.by[s].total > 0; }).map(function (s) {
      var b = sc.by[s], bp = b.total ? b.done / b.total : 0;
      return '<div class="tp-bar-row" data-subject="' + s + '"><span>' + LABEL[s] + '</span><span class="meter" aria-hidden="true"><i style="width:' + (bp * 100) + '%"></i></span><span class="cnt">' + fint(b.done) + ' / ' + fint(b.total) + '</span></div>';
    }).join("");
    host.innerHTML = '<div><p class="eyebrow">Test deadline · ' + name + '</p>' +
      '<p class="dl-days"><b>' + (days === null ? "–" : days < 0 ? 0 : days) + '</b> <span>days left until</span>' +
      '<label class="dl-date"><span class="sr">Test date</span><input type="date" id="tpDate" value="' + esc(x.date || "") + '"></label></p></div>' +
      (sc.total ? '<div class="tp-big"><div class="big">' + fmt(p) + '</div><div class="overall-side"><div class="meter" aria-hidden="true"><i style="width:' + (p * 100) + '%"></i></div><small>' + fint(sc.done) + ' of ' + fint(sc.total) + ' points covered</small></div></div>' : '') +
      '<dl class="dl-stats"><div><dt>Points</dt><dd>' + fint(sc.done) + '/' + fint(sc.total) + '</dd></div>' +
      '<div><dt>Required rate</dt><dd>' + (days !== null && days >= 0 ? fnum(need) : "–") + '</dd></div>' +
      '<div><dt>Current rate</dt><dd>' + fnum(pace) + '</dd></div>' +
      '<div><dt>Covered today</dt><dd>' + fnum(todayPts) + '</dd></div></dl>' +
      (sc.left > 0 && days !== null && days > 0 ? '<div class="today" style="--sub:var(--day)"><div class="meter" aria-hidden="true"><i style="width:' + (Math.min(1, todayPts / goal) * 100) + '%"></i></div><p class="note">' + (todayPts >= goal ? "Today's share of this test is done." : fnum(goal - todayPts) + " more points today keeps you on the line for this test.") + '</p></div>' : '') +
      '<p class="dl-status"' + (ds ? ' data-state="' + ds + '"' : '') + '>' + esc(msg) + '</p>' +
      ((cap || planLine) ? '<details class="more"><summary>Reckoning</summary>' + (cap ? '<p class="note">' + esc(cap) + '</p>' : '') + planLine + '</details>' : '') + chart +
      '<div class="tp-bars">' + bars + '</div>';
  }

  function renderTpBuild(x) {
    var host = $("tpBuild");
    if (!x) { host.innerHTML = '<section class="card"><p class="eyebrow">Chapters and materials</p><p class="note">Create a test first.</p></section>'; return; }
    var sc = testScope(x), set = chapterSet(x), sub = state.tpSub, pace = paceAll(), days = testDays(x);
    var allChs = chaptersOf(sub), chs = allChs.filter(function (c) { return set[c.id]; });
    var srcs = chosenSources(x, sub), have = sourcesOf(sub);
    var spare = days !== null && days > 0 && pace > 0 ? pace * days - sc.left : null;

    var h = '<nav class="tabs" role="tablist" aria-label="Test subjects">' + SUBJ.map(function (s) {
      var b = sc.by[s], p = b.total ? b.done / b.total : 0;
      return '<button class="tab" role="tab" type="button" data-tptab="' + s + '" data-subject="' + s + '" aria-selected="' + (s === sub) + '">' +
        '<span class="tab-head"><span class="tab-name">' + LABEL[s] + '</span><span class="tab-pct">' + fmt(p) + '</span></span>' +
        '<span class="meter" aria-hidden="true"><i style="width:' + (p * 100) + '%"></i></span>' +
        '<small>' + b.chapters + ' chapters · ' + chosenSources(x, s).length + ' materials</small></button>';
    }).join("") + '</nav>';

    var counts = { all: chs.length, todo: 0, part: 0, done: 0 };
    chs.forEach(function (c) { counts[statusOf(c, srcs)]++; });
    var showCh = state.tpAddCh || !chs.length, showSrc = state.tpAddSrc || !srcs.length;

    h += '<section class="panel" data-subject="' + sub + '"><div class="toolbar"><div class="chips" role="group" aria-label="Filter chapters">' + FILTERS.map(function (f) {
      return '<button class="chip" type="button" data-tpfilter="' + f[0] + '" aria-pressed="' + (state.tpFilter === f[0]) + '">' + f[1] + ' <span>' + counts[f[0]] + '</span></button>';
    }).join("") + orderChip() + '</div><div class="chips">' +
      '<button class="add-btn" type="button" data-tpaddch="1">' + (state.tpAddCh ? "Done adding chapters" : "+ Add chapters") + '</button>' +
      '<button class="add-btn" type="button" data-tpaddsrc="1">' + (state.tpAddSrc ? "Done adding materials" : "+ Add materials") + '</button></div></div>';

    if (showCh) {
      h += '<div class="picker"><div class="sub-head"><strong>Chapters in this test</strong><span class="sub-btns"><button type="button" class="mini-btn" data-testall="' + sub + ':all">Add all</button><button type="button" class="mini-btn" data-testall="' + sub + ':none">Clear</button></span></div>' +
        '<div class="pick-grid">' + allChs.map(function (c) {
          var pp = have.length ? tickedCount(c, have) / have.length : 0;
          return '<label class="pick"><input type="checkbox" data-testch="' + esc(c.id) + '"' + (set[c.id] ? " checked" : "") + '><span class="pk-name">' + esc(c.name) + '</span><span class="pk-pct">' + fmt(pp) + '</span></label>';
        }).join("") + '</div></div>';
    }
    if (showSrc) {
      h += '<div class="picker"><div class="sub-head"><strong>Study materials for ' + LABEL[sub] + '</strong><button type="button" class="mini-btn" data-mgrsub="' + sub + '">Add, rename or delete sources</button></div>' +
        (spare !== null ? '<p class="note">"fits" means the points still to do fit within what you can cover at your current pace.</p>' : '') + '<div class="chips">' +
        (have.length ? have.map(function (src) {
          var cost = 0; chs.forEach(function (c) { if (!(c.ticks && c.ticks[src])) cost += sizeOf(c.id); });
          var on = srcs.indexOf(src) > -1, tag = "";
          if (!on && spare !== null && chs.length) tag = cost <= spare ? " · fits" : " · over";
          return '<button type="button" class="chip srcchip" data-testsrc="' + sub + '" data-srcname="' + esc(src) + '" aria-pressed="' + on + '">' + esc(src) + ' <span>' + (chs.length ? cost + ' pts left' + tag : "") + '</span></button>';
        }).join("") : '<span class="note">No sources in this subject yet. Add one on the Tracker tab.</span>') + '</div></div>';
    }

    var list = byDifficulty(chs.filter(function (c) { return state.tpFilter === "all" || statusOf(c, srcs) === state.tpFilter; }));
    if (!chs.length) {
      h += '<div class="empty-row"><strong>No ' + LABEL[sub] + ' chapters in this test yet</strong>Tick the chapters above to add them.</div>';
    } else {
      var head = '<tr><th scope="col" class="chcol sizecol"><span>Chapter</span><small>' + chs.length + ' total</small></th><th class="sizecol" scope="col"><span>Size</span><small>length</small></th>' + diffHead() + srcs.map(function (src) {
        var n = 0; chs.forEach(function (c) { if (c.ticks && c.ticks[src]) n++; });
        return '<th class="src" scope="col"><span>' + esc(src) + '</span><small>' + n + '/' + chs.length + '</small></th>';
      }).join("") + '<th class="pctcol" scope="col">Done<small>of materials</small></th><th scope="col"><span class="sr">Remove</span></th></tr>';
      var body = list.map(function (c) {
        var w = rawSize(c.id), n = tickedCount(c, srcs), p = srcs.length ? n / srcs.length : 0;
        var opts = SIZES.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === w ? " selected" : "") + '>' + o[1] + '</option>'; }).join("");
        return '<tr class="' + statusOf(c, srcs) + '"><td>' + esc(c.name) + '</td>' +
          '<td><select class="size" data-size="' + esc(c.id) + '"' + (state.sizes["p:" + c.id] ? ' title="NCERT pages: ' + Number(state.sizes["p:" + c.id]) + '"' : '') + ' aria-label="Size of ' + esc(c.name) + '">' + opts + '</select></td>' + ptCell(c) +
          srcs.map(function (src) { return srcCell(c, src); }).join("") +
          '<td><div class="pctcell"><span class="pct">' + fmt(p) + '</span><span class="mini"><i style="width:' + (p * 100) + '%"></i></span></div></td>' +
          '<td><button type="button" class="rm" data-testrm="' + esc(c.id) + '" aria-label="Remove ' + esc(c.name) + ' from this test" title="Remove from test">✕</button></td></tr>';
      }).join("");
      h += '<div class="scroll"><table class="tp-table"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>' +
        (list.length ? "" : '<div class="state"><strong>Nothing in this view</strong>Try another filter.</div>') +
        (srcs.length ? "" : '<p class="plan">Add study materials above to get tick boxes for each chapter.</p>');
      var b2 = sc.by[sub];
      h += '<p class="plan">' + chs.length + ' chapters × ' + srcs.length + ' materials, weighted by chapter size = ' + fint(b2.total) + ' points · ' + fint(b2.done) + ' covered</p>';
    }
    h += '</section>';
    host.innerHTML = h;
  }

  function renderTest() {
    if (state.view !== "test") return;
    var x = currentTest();
    renderTpPlan(); renderTpProgress(x); renderTpBuild(x);
  }

  /* ---------- Today's plan ---------- */
  state.plans = {}; state.pAdd = { sub: "", ch: "", src: "" }; state.sugg = [];
  function planKey(offset) { var d = new Date(); d.setDate(d.getDate() + (offset || 0)); return dstr(d); }
  function chById(id) { for (var i = 0; i < state.chapters.length; i++) if (state.chapters[i].id === id) return state.chapters[i]; return null; }
  var TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  state.timeEdit = null; state.timeFocus = "";
  function fmtT(t) {
    if (!TIME_RE.test(t || "")) return "";
    var h = Number(t.slice(0, 2)), m = t.slice(3), ap = h >= 12 ? "pm" : "am";
    h = h % 12; if (h === 0) h = 12;
    return h + ":" + m + " " + ap;
  }
  function blockTxt(r) {
    if (r.start && r.end) return fmtT(r.start) + " – " + fmtT(r.end);
    if (r.start) return "from " + fmtT(r.start);
    if (r.end) return "until " + fmtT(r.end);
    return "";
  }
  function planRaw(key) { var p = state.plans[key]; return p && Array.isArray(p.items) ? p.items : []; }
  function planResolved(key) {
    var out = [], tpl = ttFor(modeOf(key)), byId = {};
    tpl.forEach(function (b) { byId[b.id] = b; });
    planRaw(key).forEach(function (it, i) {
      var c = chById(it.ch);
      if (!c || sourcesOf(c.subject).indexOf(it.src) < 0) return;
      var ids = blkIds(it, tpl).sort(function (a, b) { return toMin(byId[a].start) - toMin(byId[b].start); });
      out.push({ i: i, c: c, src: it.src, w: sizeOf(c.id), done: !!(c.ticks && c.ticks[it.src]), carried: it.carried > 0 ? it.carried : 0, blks: ids, start: ids.length ? byId[ids[0]].start : (TIME_RE.test(it.start || "") && TIME_RE.test(it.end || "") ? it.start : ""), end: ids.length ? byId[ids[ids.length - 1]].end : (TIME_RE.test(it.start || "") && TIME_RE.test(it.end || "") ? it.end : "") });
    });
    return out;
  }
  function savePlan(items) {
    if (needDb()) return;
    var key = planKey(0);
    var rec = Object.assign({}, state.plans[key] || {}, { items: items });
    state.plans[key] = rec;
    renderPlan();
    queued("p:" + key, function () { return db.doc("plans/" + key).set(rec); });
  }
  function toMin(t) { return TIME_RE.test(t || "") ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) : null; }
  function fromMin(m) { m = Math.max(0, Math.min(1439, Math.round(m))); return (m < 600 ? "0" : "") + Math.floor(m / 60) + ":" + (m % 60 < 10 ? "0" : "") + (m % 60); }
  function durTxt(m) { var h = Math.floor(m / 60), r = m % 60; return (h ? h + "h" : "") + (h && r ? " " : "") + (r ? r + "m" : ""); }
  var DURS = [60, 90, 120, 180], CB_H = 64, CB_PPM = CB_H / 60;
  /* The next free start: after the latest block already set today, or the next quarter hour from now if that is later. */
  function nextFree(skipIdx) {
    var now = new Date(), nm = Math.ceil((now.getHours() * 60 + now.getMinutes()) / 15) * 15, latest = 0;
    planResolved(planKey(0)).forEach(function (it) { if (it.i === skipIdx) return; var e = toMin(it.end); if (e !== null && e > latest) latest = e; });
    return Math.min(1439 - 25, Math.max(nm, latest));
  }
  function setBlock(idx, st, en) {
    var cur = planRaw(planKey(0)).map(function (x) { return Object.assign({}, x); });
    if (!cur[idx]) return;
    delete cur[idx].blks;
    if (TIME_RE.test(st || "")) cur[idx].start = st; else delete cur[idx].start;
    if (TIME_RE.test(en || "")) cur[idx].end = en; else delete cur[idx].end;
    savePlan(cur);
  }
  /* Lay today's unscheduled items out back to back from the next free time. Returns how many were placed. */
  function autoPlaceOpen() {
    var raw0 = planRaw(planKey(0)).map(function (x) { return Object.assign({}, x); }), res0 = planResolved(planKey(0)), tests0 = upcomingTests();
    var open0 = res0.filter(function (r) { return !r.done && !r.start; }).sort(function (a, b) {
      var ta = 99, tb = 99, k;
      for (k = 0; k < tests0.length; k++) { if (ta === 99 && tests0[k].keys[a.c.id + "|" + a.src]) ta = k; if (tb === 99 && tests0[k].keys[b.c.id + "|" + b.src]) tb = k; }
      return (ta - tb) || (sizeOf(b.c.id) - sizeOf(a.c.id)) || (srcRank(a.src) - srcRank(b.src)) || (a.i - b.i);
    });
    var cursor = nextFree(-1), placed = 0;
    open0.forEach(function (r) {
      var len = autoLen(r.c.id);
      if (cursor + len > 1439) return;
      raw0[r.i].start = fromMin(cursor); raw0[r.i].end = fromMin(cursor + len); cursor += len; placed++;
    });
    if (placed) savePlan(raw0);
    return { placed: placed, total: open0.length };
  }
  function ttClone(o) { return JSON.parse(JSON.stringify(o)); }
  function planAdd(list) {
    var cur = planRaw(planKey(0)).slice(), have = {};
    cur.forEach(function (it) { have[it.ch + "|" + it.src] = 1; });
    list.forEach(function (x) { if (!have[x.ch + "|" + x.src]) { cur.push(x.carried > 0 ? { ch: x.ch, src: x.src, carried: x.carried } : { ch: x.ch, src: x.src }); have[x.ch + "|" + x.src] = 1; } });
    savePlan(cur); renderTest();
  }
  var PRIORITY = ["ncert", "module", "race", "ee", "ncr", "jm"];
  function srcRank(n) { var i = PRIORITY.indexOf(String(n).toLowerCase().trim()); return i < 0 ? PRIORITY.length : i; }
  function testInfo(x) {
    var set = chapterSet(x), chosen = {}, keys = {};
    SUBJ.forEach(function (sb) { chosen[sb] = chosenSources(x, sb); });
    state.chapters.forEach(function (c) {
      if (!set[c.id]) return;
      (chosen[c.subject] || []).forEach(function (src) { keys[c.id + "|" + src] = 1; });
    });
    var left = 0, total = 0;
    Object.keys(keys).forEach(function (k) {
      var p = k.split("|"), c = chById(p[0]); if (!c) return;
      var w = sizeOf(c.id); total += w; if (!(c.ticks && c.ticks[p[1]])) left += w;
    });
    return { x: x, name: x.name || "Test", days: testDays(x), keys: keys, left: left, total: total };
  }
  function upcomingTests() {
    return state.tests.filter(function (x) { var d = testDays(x); return d !== null && d >= 0; })
      .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; }).map(testInfo);
  }
  function testToday(ti, items, todayKey) {
    var dated = datedMap(function (c, src) { return ti.keys[c.id + "|" + src]; });
    var pend = 0; items.forEach(function (r) { if (!r.done && ti.keys[r.c.id + "|" + r.src]) pend += r.w; });
    var perDay = ti.days > 0 ? ti.left / ti.days : ti.left;
    var done = dated[todayKey] || 0;
    return { perDay: perDay, done: done, pend: pend, short: Math.max(0, Math.ceil(perDay) - done - pend) };
  }
  function daysTxt(n) { return n === 0 ? "today" : "in " + n + " day" + (n === 1 ? "" : "s"); }
  function dayRand(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0) / 4294967296;
  }
  /* Spaced repetition: after a chapter's first material, each further material comes due at an expanding gap from the last one you did. */
  var SPACE_GAPS = [1, 3, 7, 14, 30];
  function spaceInfo(c, srcs, n, plannedSet) {
    if (!n) return null;
    var last = "";
    srcs.forEach(function (s) { var l = lastRead(c, s); if (l && l > last) last = l; });
    if (!last) return null;
    var d = parseD(last); d.setDate(d.getDate() + SPACE_GAPS[Math.min(n - 1, SPACE_GAPS.length - 1)]);
    var od = Math.round((startOfToday() - d) / 86400000);
    var touched = srcs.some(function (s) { return plannedSet[c.id + "|" + s]; });
    return { last: last, od: touched ? -1 : od, gap: SPACE_GAPS[Math.min(n - 1, SPACE_GAPS.length - 1)] };
  }
  function spaceWhy(sp) {
    var ago = Math.round((startOfToday() - parseD(sp.last)) / 86400000);
    var lastTxt = ago <= 0 ? "today" : ago === 1 ? "yesterday" : ago + " days ago";
    if (sp.od >= 0) return "Spaced revisit · " + (sp.od === 0 ? "due today" : "overdue by " + sp.od + " day" + (sp.od === 1 ? "" : "s")) + " · chapter last done " + lastTxt;
    return "";
  }
  /* ---------- Seneca: Automated Routine & Study Planner ---------- */
  function senN(n, w) { return n + " " + w + (n === 1 ? "" : "s"); }
  function senClock(t) { var m = toMin(t); if (m === null) return t; var h = Math.floor(m / 60), mi = m % 60; return (h % 12 || 12) + ":" + (mi < 10 ? "0" : "") + mi + (h >= 12 ? " pm" : " am"); }
  function senDaysSince(ds) { return Math.round((startOfToday() - parseD(ds)) / 864e5); }
  function dueRevisits() {
    var out = [];
    state.chapters.forEach(function (c) {
      var srcs = sourcesOf(c.subject), n = tickedCount(c, srcs), sp = spaceInfo(c, srcs, n, {});
      if (!sp || sp.od < 0) return;
      var nr = 99, ns = "";
      srcs.forEach(function (s2) { if (!(c.ticks && c.ticks[s2]) && srcRank(s2) < nr) { nr = srcRank(s2); ns = s2; } });
      if (ns) out.push({ c: c, src: ns, od: sp.od });
    });
    return out.sort(function (a, b) { return b.od - a.od; });
  }
  function subjectLastDay(sub) {
    var last = "";
    chaptersOf(sub).forEach(function (c) { sourcesOf(sub).forEach(function (s2) { var l = lastRead(c, s2); if (l && l > last) last = l; }); });
    return last;
  }
  function senStanding() {
    var dd = dayData(), q = needed(), st = standing(dd), rate = currentRate(dd), dl = parseD(state.deadline);
    if (q.left <= 0 && state.gotC) return { badge: "Complete", state: "ok", text: "Syllabus complete. Shift focus to timed testing and revision." };
    var lead = senN(q.days, "day") + " to " + fmtDate(dl) + " · " + fint(q.left) + " pts left · Pace: " + (rate > 0 ? fnum(rate) + " vs " + fnum(q.need) + " pts/day" : fnum(q.need) + " pts/day needed") + ".";
    if (!st || rate <= 0) return { badge: "Baseline needed", state: "neutral", text: lead + " Complete a block today to establish your current pace." };
    var f = new Date(q.t0); f.setDate(f.getDate() + Math.ceil(q.left / rate));
    var diff = Math.round((f - dl) / 864e5);
    if (st.gap > 0.5) {
      return {
        badge: "Behind " + fint(st.gap) + " pts",
        state: "behind",
        text: lead + " Projected " + fmtDate(f) + " (" + senN(Math.max(1, diff), "day") + " late). Hit " + effGoal() + "+ pts today, revisits first."
      };
    }
    if (st.gap < -0.5) {
      return {
        badge: "Ahead " + fint(-st.gap) + " pts",
        state: "ok",
        text: lead + " Projected " + fmtDate(f) + " (" + senN(Math.max(0, -diff), "day") + " early). Clear due revisits before new material."
      };
    }
    return { badge: "On track", state: "ok", text: lead + " Maintain today's target." };
  }
  function senRisks(ctx) {
    var risks = [], plSet = {};
    if (ctx && ctx.items) ctx.items.forEach(function (r) { plSet[r.c.id + "|" + r.src] = 1; });
    var due = dueRevisits(), late = due.filter(function (x) { return x.od >= 3; });
    if (late.length) {
      var lr = late[0], lkey = lr.c.id + "|" + lr.src;
      risks.push({
        text: "Retention risk: " + lr.c.name + " (" + lr.src + ") is " + senN(lr.od, "day") + " overdue" + (late.length > 1 ? " (+" + (late.length - 1) + " more)" : "") + ".",
        act: plSet[lkey] ? null : { attr: 'data-riskadd="' + esc(lkey) + '"', label: "+ Queue" }
      });
    }
    var ps = SUBJ.map(function (s) { return { s: s, m: summary(s), last: subjectLastDay(s) }; });
    ps.forEach(function (x) {
      if (x.m.pct < 1 && x.last && senDaysSince(x.last) >= 3) {
        risks.push({
          text: "Neglected subject: " + LABEL[x.s] + " untouched for " + senN(senDaysSince(x.last), "day") + ".",
          act: { attr: 'data-risksub="' + esc(x.s) + '"', label: "+ Queue" }
        });
      }
    });
    var hi = ps.slice().sort(function (a, b) { return b.m.pct - a.m.pct; })[0];
    var lo = ps.slice().sort(function (a, b) { return a.m.pct - b.m.pct; })[0];
    if (hi.m.pct - lo.m.pct >= 0.15) {
      risks.push({ text: "Imbalance: " + LABEL[lo.s] + " (" + fmt(lo.m.pct) + ") trails " + LABEL[hi.s] + " (" + fmt(hi.m.pct) + ")." });
    }
    var tests = upcomingTests();
    if (tests.length && tests[0].left > 0 && tests[0].days <= 14) {
      var ti = tests[0], rate = currentRate(dayData());
      if (rate > 0 && rate * ti.days < ti.left) {
        risks.push({ text: "Test deficit (" + ti.name + ", " + daysTxt(ti.days) + "): " + fnum(ti.left) + " pts left exceeds capacity (~" + fint(rate * ti.days) + " pts)." });
      }
    }
    if (ctx && ctx.trimmed > 0 && state.sview !== "manual") {
      risks.push({ text: "Capacity limit: " + fnum(ctx.trimmed) + " pts exceed today's remaining study blocks." });
    }
    var rvRisk = revInfo();
    var capPerBlk = Math.max(1, (rvRisk.tq + rvRisk.tf) || Math.floor(rvRisk.mins / 1.2));
    if (rvRisk.n > capPerBlk * 3) {
      risks.push({ text: "Revision backlog: " + rvRisk.n + " due items (~" + Math.ceil(rvRisk.n / capPerBlk) + " blocks of work)." });
    }
    return risks.slice(0, 4);
  }
  function renderSeneca(ctx) {
    var host = $("seneca"); if (!host) return;
    var st = senStanding(), acts = [], nowMin = nowMinutes();
    var html = '<div class="sen-head"><div class="sen-id"><span class="sen-mark" aria-hidden="true">S</span><div><p class="eyebrow">Seneca</p></div></div>' +
      '<span class="sen-badge ' + st.state + '">' + esc(st.badge) + '</span></div>';

    var maxims = [
      "What stands in the way becomes the way. — Marcus Aurelius",
      "We suffer more often in imagination than in reality. — Seneca",
      "You have power over your mind—not outside events. Realize this, and you will find strength. — Marcus Aurelius",
      "Begin at once to live, and count each separate day as a separate life. — Seneca",
      "It is not events that disturb us, but our judgments about them. — Epictetus",
      "No man is free who is not master of himself. — Epictetus",
      "Luck is what happens when preparation meets opportunity. — Seneca"
    ];
    var dayIdx = Math.floor(Date.now() / 86400000) % maxims.length;
    var body = '<p class="sen-maxim">' + esc(maxims[dayIdx]) + '</p><div class="sen-say"><div class="sg sg-brief">';
    /* 1. Today's progress and Next task first */
    body += ctx.todayHtml || ('<p><b>Today:</b> ' + fnum(ctx.todayPts) + ' / ' + ctx.target + ' pts completed' + (ctx.pendPts > 0 ? ', ' + fnum(ctx.pendPts) + ' pts pending in plan' : '') + '.</p>');
    body += '<div class="sen-pair"><div class="sen-tgt"><div class="sen-tgt-info"><small>Today\'s target</small><strong><b>' + fnum(ctx.todayPts) + '</b> / ' + ctx.target + ' <i>pts</i></strong></div><span class="stepper"><button type="button" data-goal="-1" aria-label="Lower target">\u2212</button><button type="button" data-goal="1" aria-label="Raise target">+</button></span></div>';
    var focusItem = null;
    if (state.focusOverride) {
      focusItem = ctx.pendItems.filter(function (r) { return (r.c.id + "|" + r.src) === state.focusOverride; })[0] || null;
      if (!focusItem) state.focusOverride = null;
    }
    if (!focusItem) focusItem = (ctx.curBlk && !ctx.curBlk.done) ? ctx.curBlk : (ctx.nxtBlk || ctx.pendItems[0] || null);
    if (!focusItem) body += '<div class="sen-focus sen-focus-empty"><div class="sen-focus-info"><small>Next task</small><strong>Nothing planned yet</strong></div></div>';
    if (focusItem) {
      var chKey = focusItem.c.id + "|" + focusItem.src;
      var blkMins = autoLen(focusItem.c.id);
      if (state.sview === "manual" && focusItem.start && focusItem.end) {
        blkMins = Math.max(15, toMin(focusItem.end) - toMin(focusItem.start));
      }
      var defSec = blkMins * 60;
      var fKey = state.sview === "manual"
        ? (chKey + "|m|" + (focusItem.start || "") + "-" + (focusItem.end || ""))
        : (chKey + "|q|" + blocksOf(focusItem.c.id));
      if (!state.timer || state.timer.key !== fKey) {
        state.timer = { key: fKey, chKey: chKey, secs: defSec, total: defSec, elapsed: 0, running: false };
      }
      var tm = state.timer, mm = Math.floor(tm.secs / 60), ss = tm.secs % 60;
      var tStr = (mm < 10 ? "0" : "") + mm + ":" + (ss < 10 ? "0" : "") + ss;
      var fLabel = (ctx.curBlk && !ctx.curBlk.done) ? "Active block" : (state.sview === "manual" && ctx.nxtBlk ? "Next block · " + senClock(ctx.nxtBlk.start) : "Next task");
      body += '<div class="sen-focus"><div class="sen-focus-info"><small>' + esc(fLabel) + '</small><strong>' + esc(LABEL[focusItem.c.subject]) + ' · ' + esc(focusItem.c.name) + ' (' + esc(focusItem.src) + ', ' + fnum(focusItem.w) + ' pts)</strong></div>' +
        '<div class="sen-focus-ctl"><span class="sen-timer" id="senTimerVal">' + tStr + '</span>' +
        '<button type="button" class="mini-btn" data-sentimer="1">' + (tm.running ? "Pause" : "Start") + '</button>' +
        '<button type="button" class="pill" data-senreset="1">Reset</button>' +
        '<button type="button" class="mini-btn" data-sencomplete="' + esc(focusItem.c.id + "|" + focusItem.src) + '">Done</button></div></div>';
    }
    body += '</div>';
    /* 2. Syllabus progress next */
    body += '<div class="sen-bal" aria-label="Subject balance">' + SUBJ.map(function (sb) {
      var m = summary(sb);
      return '<div class="sen-bal-item"><div class="sen-bal-top"><b>' + esc(LABEL[sb]) + '</b><span>' + fnum(m.done) + '/' + fint(m.total) + '</span></div><div class="meter" aria-hidden="true"><i style="width:' + (m.pct * 100) + '%"></i></div></div>';
    }).join("") + '</div>';
    /* 3. Analytics lower down */
    body += '<div class="sen-analytics"><p class="sen-pace">' + esc(st.text) + '</p>' + (ctx.analyticsHtml || '') + '</div>';
    body += '</div><div class="sg sg-counsel">';

    // Current priority queue / scheduled routine
    var timed = ctx.items.filter(function (r) { return r.start && r.end; }).sort(function (a, b) { return toMin(a.start) - toMin(b.start); });
    var queuedList = state.sview === "manual" ? timed : ctx.items;
    var missed = state.sview === "manual" ? timed.filter(function (r) { return !r.done && toMin(r.end) <= nowMin; }) : [];
    var unplaced = state.sview === "manual" ? ctx.items.filter(function (r) { return !r.done && !r.start; }) : [];

    var rvC = revInfo();
    if (state.sview !== "manual") {
      body += '<p class="sen-sub">Revision</p><ul class="sen-routine"><li' + (rvC.done ? ' class="done"' : '') + '><span class="rt-t">1 blk · 1h 30m</span><span class="rt-n"><b>Questions + flashcards</b> · ' + esc(revText(rvC)) + '</span><span class="rt-p">' + (rvC.done ? 'Done · <button type="button" class="linkbtn" data-revdone="1">Undo</button>' : '<button type="button" class="linkbtn" data-revqueue="1">Queue</button> · <button type="button" class="linkbtn" data-qlfull="1">Open log</button> · <button type="button" class="linkbtn" data-revdone="1">Mark done</button>') + '</span></li></ul>';
    }
    if (queuedList.length) {
      body += '<p class="sen-sub">Today\'s Priority Queue</p><ul class="sen-routine">' + queuedList.map(function (r, idx) {
        var blkLab = state.sview === "manual" ? senClock(r.start) + '–' + senClock(r.end) : ('Block ' + blockLetter(idx) + ' · ' + durTxt(blocksOf(r.c.id) * 90));
        var cls = r.done ? 'done' : '';
        var tag = r.done ? 'Done' : (state.sview === "manual" ? 'Scheduled' : (blocksOf(r.c.id) + ' blk' + (blocksOf(r.c.id) === 1 ? '' : 's')));
        var rkey = r.c.id + "|" + r.src;
        var rBtns = r.done ? '' : ' <button type="button" class="mini-btn" data-senfocus="' + esc(rkey) + '">Focus</button><button type="button" class="mini-btn" data-sencomplete="' + esc(rkey) + '">Done</button>';
        return '<li' + (cls ? ' class="' + cls + '"' : '') + '><span class="rt-t">' + esc(blkLab) + '</span><span class="rt-n"><b>' + esc(LABEL[r.c.subject]) + '</b> · ' + esc(r.c.name) + ' (' + esc(r.src) + ')</span><span class="rt-p">' + fnum(r.w) + ' pts · ' + tag + '</span>' + rBtns + '</li>';
      }).join("") + '</ul>';
    }

    if (missed.length) {
      acts.push('<button type="button" class="pill main" data-senreplan="1">Auto-replan day</button>');
      acts.push('<button type="button" class="pill warn" data-mreschedall="1">Reschedule ' + missed.length + ' missed</button>');
    }
    if (unplaced.length) {
      acts.push('<button type="button" class="pill" data-senplace="1">Schedule ' + unplaced.length + ' into blocks</button>');
    }

    if (ctx.sug.length) {
      var sp = 0; ctx.sug.forEach(function (x) { sp += x.w; });
      body += '<p class="sen-sub">' + (timed.length ? 'Additional Recommended Blocks' : 'Proposed Study Routine') + '</p><ul class="sen-routine">' + ctx.sug.map(function (x, i) {
        return '<li><span class="rt-t">~' + esc(durTxt(autoLen(x.c.id))) + '</span><span class="rt-n"><b>' + esc(LABEL[x.c.subject]) + '</b> · ' + esc(x.c.name) + ' (' + esc(x.src) + ')' + (x.why ? ' <small style="color:var(--muted)">— ' + esc(x.why) + '</small>' : '') + '</span><span class="rt-p">' + fnum(x.w) + ' pts</span><button type="button" class="mini-btn" data-sugadd="' + i + '">+ Add</button></li>';
      }).join("") + '</ul>' +
      '<details class="more"><summary>How these are picked</summary><p class="note">The syllabus is treated as one unit: each subject gets a share of the day in proportion to what it still has left, so all of them finish together at your deadline. Materials you did on a chapter come back on a spaced schedule (1, 3, 7, 14, then 30 days after the last one), and those revisits lead the list, but they never take more than 40% of the day\'s points. Otherwise materials follow your priority order: NCERT, Module, RACE, EE, NCR, then JM. The chapter within each material is picked at random, and the picks stay the same all day, so you are not choosing what to avoid.</p></details>';
      acts.push('<button type="button" class="pill main" data-senplan="1">Plan & schedule day (' + fnum(sp) + ' pts)</button>');
    } else if (!timed.length && ctx.budget <= 0 && ctx.pendItems.length === 0) {
      body += '<p class="sen-sub">Status</p><p>Daily target met. Use surplus time for error-log review or spaced revisits.</p>';
    }

    if (ctx.pendItems.length && ctx.carryable.length) {
      acts.push('<button type="button" class="pill" data-carry="1">Carry ' + ctx.carryable.length + ' to tomorrow</button>');
    }

    var risks = senRisks(ctx);
    body += '</div><div class="sg sg-risks">';
    if (risks.length) {
      body += '<p class="sen-sub">Risks</p><ul class="sen-list">' + risks.map(function (r) {
        return '<li' + (r.act ? ' class="has-act"' : '') + '><span>' + esc(r.text) + '</span>' + (r.act ? '<button type="button" class="mini-btn" ' + r.act.attr + '>' + esc(r.act.label) + '</button>' : '') + '</li>';
      }).join("") + '</ul>';
    }
    body += '</div></div>';

    host.innerHTML = html + body + (acts.length ? '<div class="sen-acts">' + acts.join("") + '</div>' : '');

    /* Alternate theme: mirror subject coverage into the sidebar and the revision count into the top bar. */
    var cov = $("stoicCov");
    if (cov) cov.innerHTML = '<p class="sc-h">Subject coverage</p>' + SUBJ.map(function (sb) {
      var m = summary(sb);
      return '<div class="sc-i"><div class="sc-t"><b>' + esc(LABEL[sb]) + '</b><span>' + Math.round(m.pct * 100) + '%</span></div><div class="meter" aria-hidden="true"><i style="width:' + (m.pct * 100) + '%"></i></div></div>';
    }).join("");
    var rqb = $("stoicRq");
    if (rqb) { var rqi = revInfo(); rqb.textContent = "Revision queue" + (rqi && rqi.n != null ? " (" + rqi.n + ")" : ""); }
  }
  function senPlace() {
    var r = state.sview === "manual" ? autoPlaceOpen() : autoPlaceBlocks();
    if (r.total && r.placed < r.total) toast("Placed " + r.placed + " of " + r.total + ". Remaining items did not fit today.");
    return r;
  }
  setInterval(function () {
    if (!state.timer || !state.timer.running) return;
    if (state.timer.secs > 0) {
      state.timer.secs--;
      state.timer.elapsed = (state.timer.elapsed || 0) + 1;
      var kNow = planKey(0), recNow = state.plans[kNow];
      if (state.timer.elapsed % 60 === 0 && recNow) {
        var hb = Object.assign({}, recNow.habit || {});
        hb.studyMins = (hb.studyMins || 0) + 1;
        recNow.habit = hb;
        queued("p:" + kNow, function () { return db.doc("plans/" + kNow).set(recNow); });
      }
      var mm = Math.floor(state.timer.secs / 60), ss = state.timer.secs % 60;
      var tTxt = (mm < 10 ? "0" : "") + mm + ":" + (ss < 10 ? "0" : "") + ss;
      var el = $("senTimerVal"); if (el) el.textContent = tTxt;
      var qel = document.querySelector(".pq-timer[data-tkey='" + state.timer.key + "']");
      if (qel) qel.textContent = tTxt;
      if (state.timer.secs === 0) { state.timer.running = false; toast("Study block timer complete."); renderPlan(); }
    }
  }, 1000);
  document.addEventListener("click", function (e) {
    var b = e.target.closest ? e.target.closest("[data-senplan],[data-senplace],[data-sentimer],[data-senreset],[data-sencomplete],[data-senfocus],[data-senreplan],[data-riskadd],[data-risksub]") : null;
    if (!b) return;
    if (b.hasAttribute("data-senreset")) { if (state.timer) { state.timer.secs = state.timer.total; state.timer.running = false; renderPlan(); } }
    else if (b.hasAttribute("data-senplace")) senPlace();
    else if (b.hasAttribute("data-senplan")) { if (needDb()) return; planAdd(state.sugg || []); senPlace(); }
    else if (b.hasAttribute("data-senreplan")) {
      if (needDb()) return;
      if (state.sview === "manual") {
        var nowM = nowMinutes(), rawM = cloneItems(planKey(0));
        var list = planResolved(planKey(0)).filter(function (r) { return !r.done && r.start && r.end && toMin(r.end) <= nowM; }).sort(function (a, b) { return toMin(a.start) - toMin(b.start); });
        var cur2 = nextFree(-1);
        list.forEach(function (r) { var L = toMin(r.end) - toMin(r.start); if (cur2 + L <= 1439) { delete rawM[r.i].blks; rawM[r.i].start = fromMin(cur2); rawM[r.i].end = fromMin(cur2 + L); cur2 += L; } });
        savePlan(rawM);
      } else { reschedule(); }
      if (state.sugg && state.sugg.length) planAdd(state.sugg);
      senPlace();
      toast("Day replanned into remaining free blocks.");
    }
    else if (b.hasAttribute("data-senfocus")) {
      state.focusOverride = b.getAttribute("data-senfocus");
      state.timer = null;
      renderPlan();
    }
    else if (b.hasAttribute("data-riskadd")) {
      if (needDb()) return;
      var rp = b.getAttribute("data-riskadd").split("|");
      planAdd([{ ch: rp[0], src: rp[1] }]);
      toast("Added overdue revisit to today's plan.");
    }
    else if (b.hasAttribute("data-risksub")) {
      if (needDb()) return;
      var rs = b.getAttribute("data-risksub"), plS = {};
      planResolved(planKey(0)).forEach(function (r) { plS[r.c.id + "|" + r.src] = 1; });
      var pick = suggestSlots(1, plS, upcomingTests(), null, rs, Infinity, Infinity)[0];
      if (pick) { planAdd([pick]); toast("Added " + pick.c.name + " (" + LABEL[rs] + ") to today's plan."); }
      else toast("No unticked chapters left in " + LABEL[rs] + ".");
    }
    else if (b.hasAttribute("data-sentimer")) { if (state.timer) { state.timer.running = !state.timer.running; renderPlan(); } }
    else if (b.hasAttribute("data-sencomplete")) {
      if (needDb()) return;
      var p = b.getAttribute("data-sencomplete").split("|"), cid = p[0], src = p[1], ch = chById(cid);
      if (!ch) return;
      state.timer = null;
      if (isRepeat(ch.subject, src)) heat(cid, src, 1);
      else if (!(ch.ticks && ch.ticks[src])) toggle(cid, src);
      toast("Completed " + ch.name + " (" + src + ").");
    }
  });

  var SPACE_SHARE = 0.4; /* revisits may take at most this share of a day's target points */
  function isRevisit(c, src) {
    var srcs = sourcesOf(c.subject), n = tickedCount(c, srcs);
    if (c.ticks && c.ticks[src]) return false;
    var sp = spaceInfo(c, srcs, n, {}), nextRk = 99;
    srcs.forEach(function (s2) { if (!(c.ticks && c.ticks[s2])) nextRk = Math.min(nextRk, srcRank(s2)); });
    return !!(sp && sp.od >= 0 && srcRank(src) === nextRk);
  }
  function suggestSlots(need, plannedSet, tests, only, subjOnly, cap, dueCap) {
    if (cap === undefined) cap = Infinity;
    if (dueCap === undefined) dueCap = Infinity;
    var dueGot = 0;
    function okSlot(x) { return got + x.w <= cap && (x.g !== 0 || dueGot + x.w <= dueCap); }
    tests = tests || [];
    var out = [], got = 0, rem = {}, total = 0, assigned = {}, slots = {};
    var bandN = [0, 0, 0], bandRem = [0, 0, 0];
    /* One syllabus: every subject shares the same deadline, so each takes a share of the day in proportion to what it still has left. That way all of them finish together. Whoever is furthest below their share goes next. */
    var cnt = {}, lastD = {};
    SUBJ.forEach(function (sb) { cnt[sb] = 0; lastD[sb] = subjectLastDay(sb) || ""; });
    Object.keys(plannedSet).forEach(function (k) { if (!plannedSet[k]) return; var c0 = chById(k.split("|")[0]); if (c0 && cnt[c0.subject] !== undefined) cnt[c0.subject] += sizeOf(c0.id); });
    function bandOf(id) { var d = diffOf(id); return d === 0 || d === 3 ? 1 : (d <= 2 ? 0 : 2); }
    Object.keys(plannedSet).forEach(function (k) { if (plannedSet[k]) bandN[bandOf(k.split("|")[0])] += sizeOf(k.split("|")[0]); });
    function bandSc(id) { var b = bandOf(id); return bandN[b] / Math.max(bandRem[b] / Math.max(total, 1e-6), 1e-6); }
    SUBJ.forEach(function (sub) {
      var srcs = sourcesOf(sub); rem[sub] = 0; assigned[sub] = 0; slots[sub] = [];
      if (subjOnly && sub !== subjOnly) return;
      chaptersOf(sub).forEach(function (c) {
        var n = tickedCount(c, srcs);
        var sp = spaceInfo(c, srcs, n, plannedSet), nextRk = 99;
        srcs.forEach(function (s2) { if (!(c.ticks && c.ticks[s2])) nextRk = Math.min(nextRk, srcRank(s2)); });
        srcs.forEach(function (src, si) {
          if (c.ticks && c.ticks[src]) return;
          var key = c.id + "|" + src;
          if (only && !only.keys[key]) return;
          var w = sizeOf(c.id); rem[sub] += w; total += w; bandRem[bandOf(c.id)] += w;
          if (plannedSet[key]) return;
          var ti = 99, tn = "";
          for (var t = 0; t < tests.length; t++) if (tests[t].keys[key]) { ti = t; tn = tests[t].name + " " + daysTxt(tests[t].days); break; }
          var rk = srcRank(src);
          var isDue = !!(sp && sp.od >= 0 && rk === nextRk), waiting = !!(sp && !isDue);
          slots[sub].push({ ch: c.id, c: c, src: src, w: w, partial: n > 0, si: si, rk: rk, ti: ti, rnd: dayRand(planKey(0) + "|" + c.id),
            g: isDue ? 0 : 1, nd: waiting ? 1 : 0, od: isDue ? sp.od : 0,
            why: [isDue ? spaceWhy(sp) : "", ti < 99 ? "For " + tn : "", n > 0 && !isDue ? "Already started" : ""].filter(Boolean).join(" · ") });
        });
      });
      slots[sub].sort(function (a, b) { return (a.ti - b.ti) || (a.g - b.g) || (a.g === 0 ? b.od - a.od : 0) || (a.rk - b.rk) || (a.nd - b.nd) || (a.rnd - b.rnd); });
    });
    while (got < need && out.length < 30) {
      var tiers = [], best = null, bs = Infinity, bi = -1;
      SUBJ.forEach(function (sub) { slots[sub].forEach(function (x) { if (tiers.indexOf(x.ti) < 0) tiers.push(x.ti); }); });
      tiers.sort(function (p, q) { return p - q; });
      for (var tj = 0; tj < tiers.length && !best; tj++) {
        SUBJ.forEach(function (sub) {
          var idx = -1;
          for (var k = 0; k < slots[sub].length; k++) { var cand = slots[sub][k]; if (cand.ti === tiers[tj] && okSlot(cand)) { idx = k; break; } }
          if (idx < 0) return;
          var f0 = slots[sub][idx];
          for (var k2 = idx + 1; k2 < slots[sub].length; k2++) {
            var c2 = slots[sub][k2];
            if (c2.ti !== f0.ti || c2.g !== f0.g || c2.rk !== f0.rk || c2.nd !== f0.nd) break;
            if (okSlot(c2) && bandSc(c2.ch) < bandSc(slots[sub][idx].ch)) idx = k2;
          }
          var sc = assigned[sub] / Math.max(rem[sub] / total, 1e-6);
          var scs = cnt[sub] / Math.max(rem[sub] / total, 1e-6);
          var better = !best || scs < bs - 1e-9 || (Math.abs(scs - bs) <= 1e-9 && lastD[sub] < lastD[best]);
          if (better) { bs = scs; best = sub; bi = idx; }
        });
      }
      if (!best) break;
      var it = slots[best].splice(bi, 1)[0]; out.push(it); got += it.w; if (it.g === 0) dueGot += it.w; assigned[best] += it.w; cnt[best] += it.w; bandN[bandOf(it.ch)] += it.w;
    }
    return out;
  }

  function slotButton(r) {
    var c = r.c, src = r.src;
    if (isRepeat(c.subject, src)) {
      var n = readsOf(c, src);
      return '<button class="heat" type="button" data-heat="+" data-ch="' + esc(c.id) + '" data-src="' + esc(src) + '" data-level="' + Math.min(5, n) + '" aria-label="' + esc(c.name + ", " + src + ", read " + n + " times. Add a read") + '">' + (n || "") + '</button>';
    }
    return '<button class="tick" type="button" data-ch="' + esc(c.id) + '" data-src="' + esc(src) + '" aria-pressed="' + r.done + '" aria-label="' + esc(c.name + ", " + src) + '">' + CHECK + '</button>';
  }

  function streakNow(dd) {
    var d = new Date(), n = 0, k = dstr(d);
    if (!(dd.pts[k] > 0)) d.setDate(d.getDate() - 1);
    while (dd.pts[dstr(d)] > 0) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }
  /* How far ahead or behind the straight line from your first day to the deadline you are right now. */
  function standing(dd) {
    var tt = totals(), keys = Object.keys(dd.pts).filter(function (k) { return dd.pts[k] > 0; }).sort();
    if (!keys.length || tt.total <= tt.done) return null;
    var t0 = startOfToday(), sday = parseD("2026-11-01"), due = parseD(state.deadline);
    if (due <= sday) return null;
    var sum = 0; keys.forEach(function (k) { if (k >= "2026-11-01") sum += dd.pts[k]; });
    var base = Math.max(0, tt.done - sum);
    var ideal = t0 >= due ? tt.total : base + (tt.total - base) * (t0 - sday) / (due - sday);
    return { gap: ideal - tt.done };
  }
  function hourLab(h) { var x = h % 24, ap = x >= 12 ? "pm" : "am"; return (x % 12 || 12) + ap; }
  /* Study time per chapter by size level: 1 -> 60 min, 2 -> 75, 3 -> 90 (one block), 4 -> 135 and 5 -> 180 (two blocks). */
  function blocksForSize(sz) { return [0, 1, 1, 2, 3, 3][Math.max(1, Math.min(5, Math.round(sz)))] || 1; }
  function blocksOf(id) {
    var b = state.sizes["b:" + id];
    return b >= 1 && b <= 6 && b === Math.floor(b) ? b : blocksForSize(rawSize(id));
  }
  function avgStudyBlockMins(tpl) {
    var sb = (tpl || []).filter(function (b) { return b.kind === "study"; });
    if (!sb.length) return 90;
    var tot = 0; sb.forEach(function (b) { tot += toMin(b.end) - toMin(b.start); });
    return Math.round(tot / sb.length);
  }
  function autoLen(id) { return blocksOf(id) * 90; }
  /* Keep neighbours from the same subject apart where there is a choice, so the day alternates. */
  function spreadSubjects(list) {
    var rest = list.slice(), out = [];
    while (rest.length) {
      var last = out.length ? out[out.length - 1].c.subject : null, k = 0;
      for (var j = 0; j < Math.min(rest.length, 4); j++) if (rest[j].c.subject !== last) { k = j; break; }
      out.push(rest.splice(k, 1)[0]);
    }
    return out;
  }
  /* ---------- Study blocks: the day's timetable ---------- */
  var FIT_SLACK = 15;
  var DEFAULT_TT = {
    home: [
      { id: "b-read", name: "Reading + coffee", start: "06:00", end: "07:30", kind: "other" },
      { id: "sb1", name: "SB1", start: "07:30", end: "09:00", kind: "study" },
      { id: "b-brk1", name: "Break / coffee", start: "09:00", end: "09:30", kind: "other" },
      { id: "sb2", name: "SB2", start: "09:30", end: "11:00", kind: "study" },
      { id: "b-brk2", name: "Break / coffee", start: "11:00", end: "11:30", kind: "other" },
      { id: "sb3", name: "SB3", start: "11:30", end: "13:00", kind: "study" },
      { id: "b-lunch", name: "Lunch", start: "13:00", end: "14:00", kind: "other" },
      { id: "sb4", name: "SB4", start: "14:00", end: "15:30", kind: "study" },
      { id: "b-brk3", name: "Break", start: "15:30", end: "16:00", kind: "other" },
      { id: "sb5", name: "SB5", start: "16:00", end: "17:30", kind: "study" },
      { id: "b-brk4", name: "Break / football", start: "17:30", end: "18:00", kind: "other" },
      { id: "sb6", name: "SB6", start: "18:00", end: "19:30", kind: "study" },
      { id: "b-dinner", name: "Dinner", start: "19:30", end: "20:30", kind: "other" },
      { id: "sb7", name: "SB7 · Questions + flashcards", start: "20:30", end: "22:00", kind: "qf" },
      { id: "b-10k", name: "10K", start: "22:00", end: "23:00", kind: "other" }
    ],
    "class": [
      { id: "b-read", name: "Reading + coffee", start: "06:00", end: "07:30", kind: "other" },
      { id: "sb1", name: "SB1", start: "07:30", end: "09:00", kind: "study" },
      { id: "b-brk1", name: "Break / coffee", start: "09:00", end: "09:30", kind: "other" },
      { id: "sb2", name: "SB2", start: "09:30", end: "11:00", kind: "study" },
      { id: "b-brk2", name: "Break / coffee", start: "11:00", end: "11:30", kind: "other" },
      { id: "sb3", name: "SB3", start: "11:30", end: "13:00", kind: "study" },
      { id: "b-lunch", name: "Lunch", start: "13:00", end: "14:00", kind: "other" },
      { id: "b-travel1", name: "Travel", start: "14:00", end: "15:00", kind: "other" },
      { id: "sb4", name: "SB4", start: "15:00", end: "16:15", kind: "study" },
      { id: "sb5", name: "SB5", start: "16:25", end: "17:45", kind: "study" },
      { id: "sb6", name: "SB6", start: "17:55", end: "19:15", kind: "study" },
      { id: "sb7", name: "SB7 · Questions + flashcards", start: "19:25", end: "20:45", kind: "qf" },
      { id: "b-travel2", name: "Travel", start: "21:00", end: "22:00", kind: "other" },
      { id: "b-dinner", name: "Dinner + 10K", start: "22:00", end: "23:30", kind: "other" }
    ]
  };
  state.tt = null; state.ttEdit = false; state.ttEditMode = "home"; state.placeIdx = null; state.schedDay = 0;
  var cbDrag = null;
  function validBlock(b) { return b && typeof b.id === "string" && TIME_RE.test(b.start || "") && TIME_RE.test(b.end || "") && toMin(b.end) > toMin(b.start); }
  /* Timetables: a list of named day layouts. The first two are the ones you wrote; more can be added. */
  function ttTables() {
    var raw = state.tt, out = [];
    if (raw && Array.isArray(raw.tables)) raw.tables.forEach(function (t) { if (t && typeof t.id === "string") out.push({ id: t.id, name: String(t.name || "Timetable").slice(0, 24), blocks: Array.isArray(t.blocks) ? t.blocks : [] }); });
    if (!out.length) out = [
      { id: "home", name: "T1", blocks: raw && Array.isArray(raw.home) ? raw.home : DEFAULT_TT.home },
      { id: "class", name: "Coaching day", blocks: raw && Array.isArray(raw["class"]) ? raw["class"] : DEFAULT_TT["class"] }
    ];
    return out;
  }
  function tableById(id) { var r = null; ttTables().forEach(function (t) { if (t.id === id) r = t; }); return r; }
  function cleanBlocks(src) {
    return src.filter(validBlock).map(function (b) { return { id: b.id, name: String(b.name || "").slice(0, 40), start: b.start, end: b.end, kind: b.kind === "study" || b.kind === "qf" ? b.kind : "other" }; })
      .sort(function (a, b) { return toMin(a.start) - toMin(b.start); });
  }
  function rawTtFor(mode) { var t = tableById(mode); return t ? cleanBlocks(t.blocks) : []; }
  function flexCfg() {
    var raw = state.tt || {};
    return {
      blkLen: Math.max(30, Math.min(180, Number(raw.blkLen) || 90)),
      brkLen: Math.max(0, Math.min(60, raw.brkLen != null ? Number(raw.brkLen) : 15))
    };
  }
  function isFixedIsland(b, mode) {
    if (b.kind !== "other") return false;
    if (mode === "home") return false;
    return !/^break\b/i.test(b.name || "");
  }
  function flexBlocksFor(mode) {
    var key = planKey(0), rec = state.plans[key] || {}, cfg = flexCfg();
    var nowM = nowMinutes();
    var wakeStr = (rec.habit && TIME_RE.test(rec.habit.wake || "")) ? rec.habit.wake : (TIME_RE.test(rec.wake || "") ? rec.wake : "");
    var wakeMin = wakeStr ? toMin(wakeStr) : Math.max(300, Math.floor(nowM / 5) * 5);
    var shiftMin = (rec.shiftFrom != null && rec.shiftFrom > wakeMin) ? rec.shiftFrom : wakeMin;
    var rawTpl = rawTtFor(mode);
    var islands = rawTpl.filter(function (b) { return isFixedIsland(b, mode) && toMin(b.end) > wakeMin; })
      .map(function (b) { return { id: b.id, name: b.name, start: b.start, end: b.end, kind: "other", sMin: toMin(b.start), eMin: toMin(b.end) }; });

    var items = planRaw(key), dd = dayData(), todayPts = dd.pts[key] || 0;
    var usedBlks = 0, openBlks = 0, doneSet = {};
    items.forEach(function (it) {
      if (Array.isArray(it.blks) && it.blks.length) {
        usedBlks += it.blks.length;
        var ch = chById(it.ch);
        if (ch && ch.ticks && ch.ticks[it.src]) it.blks.forEach(function (bid) { doneSet[bid] = 1; });
      } else if (!it.start) {
        openBlks += it.ch ? blocksOf(it.ch) : 1;
      }
    });
    if (rec.rev && rec.rev.done && Array.isArray(rec.rev.blks)) rec.rev.blks.forEach(function (bid) { doneSet[bid] = 1; });
    var remPts = Math.max(0, effGoal() + carryGap(dd) - todayPts);
    var needForTarget = Math.ceil(remPts / 2.4);
    var nStudy = Math.min(16, Math.max(4, 1 + Math.max(usedBlks + openBlks, needForTarget) + 1));

    var out = [], cur = wakeMin, ii = 0;
    for (var k = 1; k <= nStudy; k++) {
      var bid = "sb" + k;
      if (!doneSet[bid] && cur < shiftMin) cur = shiftMin;
      while (ii < islands.length) {
        if (cur >= islands[ii].eMin) {
          out.push({ id: islands[ii].id, name: islands[ii].name, start: islands[ii].start, end: islands[ii].end, kind: "other" });
          ii++;
          continue;
        }
        if (cur + cfg.blkLen > islands[ii].sMin) {
          out.push({ id: islands[ii].id, name: islands[ii].name, start: islands[ii].start, end: islands[ii].end, kind: "other" });
          cur = Math.max(cur, islands[ii].eMin + (cfg.brkLen > 0 ? Math.min(10, cfg.brkLen) : 0));
          ii++;
          continue;
        }
        break;
      }
      if (cur + cfg.blkLen > 1439) break;
      out.push({ id: bid, name: "SB" + k, start: fromMin(cur), end: fromMin(cur + cfg.blkLen), kind: "study" });
      cur += cfg.blkLen + cfg.brkLen;
    }
    while (ii < islands.length) {
      out.push({ id: islands[ii].id, name: islands[ii].name, start: islands[ii].start, end: islands[ii].end, kind: "other" });
      ii++;
    }
    return out.sort(function (a, b) { return toMin(a.start) - toMin(b.start); });
  }
  function ttFor(mode) {
    if (state.ttEdit) return rawTtFor(mode);
    return flexBlocksFor(mode);
  }
  function modeOf(key) {
    var p = state.plans[key];
    if (p && tableById(p.mode)) return p.mode;
    var ks = Object.keys(state.plans).filter(function (k) { var q = state.plans[k]; return k < key && q && tableById(q.mode); }).sort();
    return ks.length ? state.plans[ks[ks.length - 1]].mode : ttTables()[0].id;
  }
  function setMode(m) {
    if (needDb() || !tableById(m)) return;
    var key = planKey(0), rec = Object.assign({}, state.plans[key] || {}, { mode: m, items: planRaw(key) });
    state.plans[key] = rec; state.placeIdx = null; if (state.ttEdit) state.ttEditMode = m;
    renderPlan();
    queued("p:" + key, function () { return db.doc("plans/" + key).set(rec); });
  }
  function saveTables(tables, keepFocus) {
    if (needDb()) return;
    var prev = state.tt || {}, next = { tables: tables.map(function (t) { return { id: t.id, name: t.name, blocks: cleanBlocks(t.blocks) }; }), blkLen: prev.blkLen || 75, brkLen: prev.brkLen != null ? prev.brkLen : 15 };
    state.tt = next;
    if (!keepFocus) renderPlan();
    queued("tt", function () { return db.doc("settings/timetable").set(next); });
  }
  function saveTTQuiet(mode, list) {
    var tables = ttTables(); tables.forEach(function (t) { if (t.id === mode) t.blocks = list; });
    saveTables(tables, true);
  }
  function saveTT(mode, list) {
    var tables = ttTables(); tables.forEach(function (t) { if (t.id === mode) t.blocks = list; });
    saveTables(tables);
  }
  function blkIds(it, tpl) {
    var have = {}; tpl.forEach(function (b) { have[b.id] = 1; });
    return (Array.isArray(it.blks) ? it.blks : []).filter(function (id) { return have[id]; });
  }
  function occupancy(raw, tpl, skip) {
    var occ = {};
    raw.forEach(function (it, i) { if (i === skip) return; blkIds(it, tpl).forEach(function (id) { occ[id] = i; }); });
    var rv = state.plans[planKey(0)]; rv = rv && rv.rev;
    if (rv && Array.isArray(rv.blks)) rv.blks.forEach(function (id) { if (occ[id] === undefined) occ[id] = -2; });
    return occ;
  }
  /* Revision block: one study block kept every day for the question log, ahead of syllabus chapters. */
  function revDueCounts() {
    var now = Date.now(), q = 0, f = 0;
    Object.keys(state.qlog || {}).forEach(function (k) { var d = state.qlog[k]; if (qlDue(d) <= now && qlOK(d)) q++; });
    Object.keys(state.qcards || {}).forEach(function (k) { var d = state.qcards[k]; if ((d.fcDue != null ? d.fcDue : 0) <= now) f++; });
    return { q: q, f: f, n: q + f };
  }
  function revEnsure() {
    if (!db || !state.plansLoaded || state.ttEdit) return;
    var key = planKey(0), tpl = ttFor(modeOf(key)), rec = state.plans[key] || {}, rev = rec.rev;
    var studyBlks = tpl.filter(function (b) { return b.kind === "study"; }).sort(function (a, b) { return toMin(a.start) - toMin(b.start); });
    var studyIds = {}; studyBlks.forEach(function (b) { studyIds[b.id] = 1; });
    var saved = (rev && Array.isArray(rev.blks)) ? rev.blks.filter(function (id) { return studyIds[id]; }) : [];
    var items = planRaw(key).map(function (x) { return Object.assign({}, x); }), moved = false;
    var want = saved.length ? [saved[0]] : [];
    if (!want.length && studyBlks.length) {
      var occ = occupancy(items, tpl, -1);
      var free = studyBlks.filter(function (b) { return occ[b.id] === undefined; })[0];
      want = [free ? free.id : studyBlks[0].id];
    }
    /* Keep the assigned revision block free of chapters. */
    items.forEach(function (it) { if (want.length && blkIds(it, tpl).indexOf(want[0]) >= 0) { delete it.blks; delete it.start; delete it.end; moved = true; } });
    var same = rev && Array.isArray(rev.blks) && rev.blks.join() === want.join();
    if (same && !moved) return;
    var next = Object.assign({}, rec, { items: items, rev: { blks: want, done: !!(rev && rev.done) } });
    state.plans[key] = next;
    queued("p:" + key, function () { return db.doc("plans/" + key).set(next); });
  }
  function moveRevToBlock(bid) {
    var key = planKey(0), tpl = ttFor(modeOf(key)), rec = state.plans[key] || {}, raw = cloneItems(key);
    var blk = tpl.filter(function (b) { return b.id === bid && b.kind === "study"; })[0];
    if (!blk) { toast("Pick a study block for revision."); return; }
    var occ = occupancy(raw, tpl, -1);
    if (occ[bid] !== undefined && occ[bid] !== -2) { toast("Clear that block first or pick a free study block."); return; }
    var next = Object.assign({}, rec, { items: raw, rev: Object.assign({}, rec.rev || {}, { blks: [bid] }) });
    state.plans[key] = next; state.placeIdx = null; renderPlan();
    queued("p:" + key, function () { return db.doc("plans/" + key).set(next); });
  }
  function revMedianQMin() {
    var ms = [];
    Object.keys(state.qlog || {}).forEach(function (k) {
      var d = state.qlog[k];
      if (d && Array.isArray(d.times)) d.times.forEach(function (t) { if (t && t.ms > 3000 && t.ms < 600000) ms.push(t.ms); });
    });
    if (ms.length < 5) return 2;
    ms.sort(function (a, b) { return a - b; });
    var mid = ms[Math.floor(ms.length / 2)] / 60000;
    return Math.max(1, Math.min(4, Math.round(mid * 10) / 10));
  }
  function revBuildQueue(mins) {
    var now = Date.now(), qMin = revMedianQMin(), fMin = 0.5;
    var testCh = {};
    upcomingTests().forEach(function (ti) {
      if (ti.days <= 14) Object.keys(ti.keys || {}).forEach(function (k) { testCh[k.split("|")[0]] = 1; });
    });
    var qCands = [], fCands = [], qDue = 0, fDue = 0;
    Object.keys(state.qlog || {}).forEach(function (id) {
      var d = state.qlog[id]; if (!qlOK(d)) return;
      var due = qlDue(d), isDue = due <= now, isTest = !!testCh[d.chapter];
      var isRed = d.color === "red", isYel = d.color === "yellow", isWrong = d.last === "wrong";
      if (isDue) qDue++;
      var tier = 0;
      if (isTest && (isDue || isRed || isWrong)) tier = 1;
      else if (isDue) tier = 2;
      else if (isRed || isYel || isWrong) tier = 3;
      if (tier) qCands.push({ id: id, kind: "q", tier: tier, ch: d.chapter, color: d.color || "", wrong: isWrong ? 1 : 0, due: due, label: d.question || d.takeaway || (d.source ? d.source + " question" : "Logged question") });
    });
    Object.keys(state.qcards || {}).forEach(function (id) {
      var d = state.qcards[id]; if (!d) return;
      var due = d.fcDue != null ? d.fcDue : 0, isDue = due <= now, isTest = !!testCh[d.chapter], lapses = d.fcLapses || 0;
      if (isDue) fDue++;
      var tier = 0;
      if (isTest && (isDue || lapses > 0)) tier = 1;
      else if (isDue) tier = 2;
      else if (lapses > 0 || due <= now + 3 * 86400000) tier = 3;
      if (tier) fCands.push({ id: id, kind: "f", tier: tier, ch: d.chapter, color: lapses > 0 ? "red" : "", wrong: lapses, due: due, label: d.front || "Flashcard" });
    });
    function cmpQ(a, b) {
      return (a.tier - b.tier) || ((b.color === "red" ? 1 : 0) - (a.color === "red" ? 1 : 0)) || (b.wrong - a.wrong) || (a.due - b.due);
    }
    function cmpF(a, b) {
      return (a.tier - b.tier) || (b.wrong - a.wrong) || (a.due - b.due);
    }
    qCands.sort(cmpQ); fCands.sort(cmpF);
    var qc = Math.floor(mins * 0.6 / qMin), fc = Math.floor(mins * 0.4 / fMin);
    var tq = Math.min(qCands.length, qc + Math.max(0, Math.floor((fc - fCands.length) * fMin / qMin)));
    var tf = Math.min(fCands.length, fc + Math.max(0, Math.floor((qc - qCands.length) * qMin / fMin)));
    tq = Math.max(0, tq); tf = Math.max(0, tf);
    var qQueue = qCands.slice(0, tq), fQueue = fCands.slice(0, tf);
    var qBackfill = qQueue.filter(function (x) { return x.tier === 3; }).length;
    var fBackfill = fQueue.filter(function (x) { return x.tier === 3; }).length;
    var urgent = qQueue.filter(function (x) { return x.tier === 1; }).length + fQueue.filter(function (x) { return x.tier === 1; }).length;
    return { qQueue: qQueue, fQueue: fQueue, tq: qQueue.length, tf: fQueue.length, q: qDue, f: fDue, n: qDue + fDue, qBackfill: qBackfill, fBackfill: fBackfill, urgent: urgent, qMin: qMin };
  }
  function revInfo() {
    var key = planKey(0), rec = state.plans[key], tpl = ttFor(modeOf(key)), rev = rec && rec.rev;
    var bs = rev && rev.blks ? tpl.filter(function (b) { return rev.blks.indexOf(b.id) >= 0; }) : [];
    var mins = state.sview === "manual" && bs.length ? toMin(bs[0].end) - toMin(bs[0].start) : 90;
    var q = revBuildQueue(mins);
    return { tq: q.tq, tf: q.tf, qQueue: q.qQueue, fQueue: q.fQueue, qBackfill: q.qBackfill, fBackfill: q.fBackfill, urgent: q.urgent, qMin: q.qMin, mins: mins, blks: bs, ids: bs.map(function (b) { return b.id; }), start: bs.length ? bs[0].start : "", end: bs.length ? bs[bs.length - 1].end : "", q: q.q, f: q.f, n: q.n, done: !!(rev && rev.done) };
  }
  function revText(v) {
    if (!v.tq && !v.tf) return "Nothing due or flagged. Add today\u2019s mistakes or review a chapter.";
    var t = v.tq + " question" + (v.tq === 1 ? "" : "s") + " + " + v.tf + " card" + (v.tf === 1 ? "" : "s") + " (" + v.mins + "m";
    if (v.urgent) t += " · " + v.urgent + " test-urgent";
    if (v.qBackfill + v.fBackfill > 0) t += " · " + (v.qBackfill + v.fBackfill) + " backfill";
    t += ")";
    return (v.tq < v.q || v.tf < v.f) ? t + " — " + v.q + "Q/" + v.f + "F due; rest roll over" : t;
  }
  function revQueueShow() {
    var v = revInfo();
    var host = document.getElementById("revQHost");
    if (!host) {
      host = document.createElement("div");
      host.id = "revQHost";
      host.className = "revq-backdrop";
      host.hidden = true;
      host.innerHTML = '<div class="revq-dialog" role="dialog" aria-modal="true" aria-label="Today\u2019s Revision Queue">' +
        '<div class="revq-head"><h3>Today\u2019s Revision Queue</h3><button type="button" class="mini-btn" data-revqclose="1">Close</button></div>' +
        '<div class="revq-meta" id="revQMeta"></div><div class="revq-body" id="revQBody"></div></div>';
      document.body.appendChild(host);
    }
    var meta = host.querySelector("#revQMeta"), body = host.querySelector("#revQBody");
    meta.textContent = (v.start ? senClock(v.start) + "–" + senClock(v.end) + " (" + v.mins + "m) · " : "") +
      v.tq + " questions (~" + v.qMin + "m each) + " + v.tf + " flashcards (~0.5m each)" +
      (v.n > (v.tq + v.tf) ? " · " + v.n + " total due (excess rolls over)" : "");
    var all = v.qQueue.concat(v.fQueue);
    if (!all.length) {
      body.innerHTML = '<p style="margin:8px 0;color:var(--muted)">No due, red, yellow, or test-urgent items right now.</p>';
    } else {
      var tiers = [
        { t: 1, title: "Tier 1 · Test-urgent & red" },
        { t: 2, title: "Tier 2 · Due today" },
        { t: 3, title: "Tier 3 · Smart backfill (red / yellow / recent misses)" }
      ];
      body.innerHTML = tiers.map(function (g) {
        var rows = all.filter(function (x) { return x.tier === g.t; });
        if (!rows.length) return "";
        return '<div class="revq-group"><h4>' + esc(g.title) + ' (' + rows.length + ')</h4><ul class="revq-list">' + rows.map(function (x) {
          var ch = chById(x.ch);
          var chName = ch ? ch.name : x.ch;
          return '<li class="revq-row"><span class="revq-left"><span class="revq-dot ' + esc(x.color) + '"></span><span class="revq-tag">' + (x.kind === "f" ? "Card" : "Q") + '</span><span class="revq-txt">' + esc(x.label) + '</span></span>' +
            '<span class="revq-ch">' + esc(chName) + '</span>' +
            '<button type="button" class="mini-btn" data-revopen="' + esc(x.ch) + '" data-revtab="' + (x.kind === "f" ? "f" : "") + '">Open</button></li>';
        }).join("") + '</ul></div>';
      }).join("");
    }
    host.hidden = false;
  }
  function revToggle() {
    var key = planKey(0), rec = state.plans[key] || {}, rev = Object.assign({ blks: [] }, rec.rev || {});
    rev.done = !rev.done;
    var next = Object.assign({}, rec, { items: planRaw(key), rev: rev });
    state.plans[key] = next; renderPlan();
    queued("p:" + key, function () { return db.doc("plans/" + key).set(next); });
  }
  function nowMinutes() { var n = new Date(); return n.getHours() * 60 + n.getMinutes(); }
  function freeStudy(raw, tpl, skip, nowM) {
    var occ = occupancy(raw, tpl, skip);
    return tpl.filter(function (b) { return b.kind === "study" && occ[b.id] === undefined && toMin(b.end) > nowM; });
  }
  /* Take the number of free study blocks a chapter size requires (1 for short, 2 for medium/long, 3 for very long). */
  function takeBlocks(free, count) {
    var ids = [], n = Math.max(1, count || 1);
    while (free.length && ids.length < n) ids.push(free.shift().id);
    return ids;
  }
  function cloneItems(key) { return planRaw(key).map(function (x) { return Object.assign({}, x); }); }
  function clearPlace(it, ids) { if (ids && ids.length) it.blks = ids; else delete it.blks; delete it.start; delete it.end; }
  function placeAtBlock(idx, bid) {
    var key = planKey(0), tpl = ttFor(modeOf(key)), raw = cloneItems(key), it = raw[idx];
    if (!it) return;
    var r = planResolved(key).filter(function (x) { return x.i === idx; })[0], needBlk = r ? blocksOf(r.c.id) : 1;
    var study = tpl.filter(function (b) { return b.kind === "study"; }), pos = -1;
    study.forEach(function (b, k) { if (b.id === bid) pos = k; });
    if (pos < 0) { toast("That block is not for chapters."); return; }
    var occ = occupancy(raw, tpl, idx), ids = [], k;
    for (k = pos; k < study.length && ids.length < needBlk; k++) {
      if (occ[study[k].id] !== undefined) { if (!ids.length) { toast(occ[study[k].id] === -2 ? "That block is kept for revision." : "That block already has a chapter."); return; } break; }
      ids.push(study[k].id);
    }
    clearPlace(it, ids); state.placeIdx = null; savePlan(raw);
    if (ids.length < needBlk) toast("This chapter needs " + needBlk + " study blocks, but only " + ids.length + " free block(s) fit there.");
  }
  function planSorter(tests0) {
    return function (a, b) {
      var ta = 99, tb = 99, k;
      for (k = 0; k < tests0.length; k++) { if (ta === 99 && tests0[k].keys[a.c.id + "|" + a.src]) ta = k; if (tb === 99 && tests0[k].keys[b.c.id + "|" + b.src]) tb = k; }
      return (ta - tb) || (sizeOf(b.c.id) - sizeOf(a.c.id)) || (srcRank(a.src) - srcRank(b.src)) || (a.i - b.i);
    };
  }
  /* Fill the free study blocks left today with the chapters you have not placed yet, hardest first. */
  function autoPlaceBlocks() {
    var key = planKey(0), tpl = ttFor(modeOf(key)), raw = cloneItems(key), res = planResolved(key);
    var open0 = spreadSubjects(res.filter(function (r) { return !r.done && !r.blks.length && !r.start; }).sort(planSorter(upcomingTests())));
    var free = freeStudy(raw, tpl, -1, nowMinutes()), placed = 0;
    open0.forEach(function (r) { if (!free.length) return; clearPlace(raw[r.i], takeBlocks(free, blocksOf(r.c.id))); placed++; });
    if (placed) savePlan(raw);
    return { placed: placed, total: open0.length };
  }
  /* A block that passed without a tick moves to the next free study block. */
  function reschedule(only) {
    var key = planKey(0), tpl = ttFor(modeOf(key)), raw = cloneItems(key), nowM = nowMinutes();
    var list = planResolved(key).filter(function (r) { return !r.done && r.blks.length && toMin(r.end) <= nowM && (only === undefined || r.i === only); })
      .sort(function (a, b) { return toMin(a.start) - toMin(b.start); });
    list.forEach(function (r) { delete raw[r.i].blks; });
    var free = freeStudy(raw, tpl, -1, nowM), moved = 0;
    list.forEach(function (r) {
      if (!free.length) { raw[r.i].blks = r.blks; return; }
      clearPlace(raw[r.i], takeBlocks(free, blocksOf(r.c.id))); moved++;
    });
    if (moved) savePlan(raw);
    return { moved: moved, total: list.length };
  }
  function ttTime(b) {
    var a = fmtT(b.start), z = fmtT(b.end);
    if (a.slice(-2) === z.slice(-2)) a = a.slice(0, -3);
    return a + " – " + z;
  }
  state.sview = (function () { try { return localStorage.getItem("syllabus-sview") === "manual" ? "manual" : "blocks"; } catch (x) { return "blocks"; } })();
  function ttPicker(mode) {
    var tables = ttTables();
    if (tables.length > 3) return '<select class="field tt-pick" data-modesel="1" aria-label="Timetable for today">' + tables.map(function (t) { return '<option value="' + esc(t.id) + '"' + (t.id === mode ? ' selected' : '') + '>' + esc(t.name) + '</option>'; }).join("") + '</select>';
    return '<div class="tb-seg" role="group" aria-label="Timetable for today">' + tables.map(function (t) { return '<button type="button" data-mode="' + esc(t.id) + '" aria-pressed="' + (mode === t.id) + '">' + esc(t.name) + '</button>'; }).join("") + '</div>';
  }
  function blockLetter(idx) {
    var s = "", n = idx;
    do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
    return s;
  }
  function schedHead(mode, kind, autoCount) {
    var off = state.schedDay === 1 ? 1 : 0;
    return '<div class="cb-head"><div><p class="eyebrow">Schedule</p></div><div class="tt-ctl">' +
      '<div class="tb-seg" role="group" aria-label="Schedule view">' + [["blocks", "Queue"], ["manual", "Manual"]].map(function (m) {
        return '<button type="button" data-sview="' + m[0] + '" aria-pressed="' + (kind === m[0]) + '">' + m[1] + '</button>'; }).join("") + '</div>' +
      (kind === "blocks" ? '<div class="tb-seg" role="group" aria-label="Plan day"><button type="button" data-schedday="0" aria-pressed="' + (off === 0) + '">Today</button><button type="button" data-schedday="1" aria-pressed="' + (off === 1) + '">Tomorrow</button></div>' : '') +
      (kind === "blocks" && autoCount > 0 ? '<button type="button" class="mini-btn" data-autofillq="1" title="Add recommended chapters to fill remaining target points">Auto-fill target (+' + fnum(autoCount) + ' pts)</button>' : '') +
      (kind === "manual" && autoCount ? '<button type="button" class="mini-btn" data-mauto="1" title="Lay your unscheduled items out back to back from the next free time">Auto-schedule ' + autoCount + '</button>' : '') +
      '</div></div>';
  }
  function renderTimeline(items, ordered, clash, nowMin) {
    if (state.sview === "manual") renderManualView(items, ordered, clash, nowMin); else renderBlocksView(items, ordered, clash, nowMin);
  }
  /* Blocks named like a break, meal or travel are not for chapters; "questions" or "flashcards" make a practice block; the rest take chapters. */
  function inferKind(name) {
    if (/question|flashcard/i.test(name)) return "qf";
    if (/break|lunch|dinner|breakfast|travel|sleep|wake|coffee|football|reading|walk|10k|gym|class|nap|rest|meal|snack|prayer|yoga/i.test(name)) return "other";
    return "study";
  }
  var KIND_OPTS = [["study", "Chapters"], ["qf", "Questions + flashcards"], ["other", "Break / other"]];
  function renderBlocksView(items, ordered, clash, nowMin) {
    var host = $("planTimeline"); if (!host) return;
    var off = state.schedDay === 1 ? 1 : 0;
    var key = planKey(off), rec = state.plans[key] || {}, hb = rec.habit || {};
    var dayItems = off === 0 ? items : planResolved(key);
    var dd = dayData(), target = effGoal() + (off === 0 ? carryGap(dd) : 0);
    var donePts = 0, pendPts = 0, totalMins = 0, remMins = 0;
    dayItems.forEach(function (r) {
      var m = blocksOf(r.c.id) * 90;
      totalMins += m;
      if (r.done) donePts += r.w;
      else { pendPts += r.w; remMins += m; }
    });
    var rvI = revInfo();
    if (off === 0 && !rvI.done) { totalMins += 90; remMins += 90; }
    else if (off === 0 && rvI.done) totalMins += 90;
    var gapPts = Math.max(0, target - donePts - pendPts);
    var projFinish = off === 0 && remMins > 0 ? fmtT(fromMin((nowMin + remMins) % 1440)) + (nowMin + remMins >= 1440 ? " (+1d)" : "") : (remMins === 0 && dayItems.length ? "Done" : "—");
    var tests9 = upcomingTests();

    var h = schedHead(modeOf(key), "blocks", gapPts);

    // Wake-up & sleep habit tracker bar
    var wakeVal = TIME_RE.test(hb.wake || "") ? hb.wake : (TIME_RE.test(rec.wake || "") ? rec.wake : "");
    var wakeTgt = TIME_RE.test(hb.wakeTarget || "") ? hb.wakeTarget : "06:30";
    var sleepVal = hb.sleep != null ? hb.sleep : "";
    var studyHrs = hb.studyMins ? (hb.studyMins / 60).toFixed(1) : (hb.studyHrs != null ? hb.studyHrs : "");
    h += '<div class="flex-bar"><div class="flex-bar-ctl">' +
      (off === 0 ? '<button type="button" class="mini-btn" data-wokenow="1">Woke up now</button>' : '') +
      '<label>Wake <input class="field" type="time" value="' + esc(wakeVal) + '" data-habit="wake" aria-label="Wake-up time"></label>' +
      '<label>Target <input class="field" type="time" value="' + esc(wakeTgt) + '" data-habit="wakeTarget" aria-label="Wake-up target"></label>' +
      '<label>Sleep (h) <input class="field" type="number" step="0.5" min="0" max="16" placeholder="7.5" value="' + esc(String(sleepVal)) + '" data-habit="sleep" aria-label="Sleep hours"></label>' +
      '<label>Studied (h) <input class="field" type="number" step="0.5" min="0" max="18" placeholder="0" value="' + esc(String(studyHrs)) + '" data-habit="studyHrs" aria-label="Study hours"></label>' +
      '</div><div class="flex-bar-ctl"><span class="flex-meta">1 timeblock = 1h 30m · No fixed clock</span></div></div>';

    // Summary strip (emphasise next task in Queue Mode)
    var nextQIdx = -1, nextQ = null;
    for (var qi = 0; qi < dayItems.length; qi++) { if (!dayItems[qi].done) { nextQIdx = qi; nextQ = dayItems[qi]; break; } }
    var nextLabel = nextQ ? ("Block " + blockLetter(nextQIdx) + " · " + nextQ.c.name) : (dayItems.length ? "All blocks done" : "None queued");
    var blkRange = dayItems.length ? (dayItems.length === 1 ? "Block A" : "Blocks A–" + blockLetter(dayItems.length - 1)) : "0 blocks";
    h += '<dl class="tt-sum">' +
      '<div><dt>Next task</dt><dd>' + esc(nextLabel) + '</dd></div>' +
      '<div><dt>' + (off === 0 ? "Target progress" : "Tomorrow target") + '</dt><dd>' + fnum(donePts + pendPts) + ' / ' + target + ' pts</dd></div>' +
      '<div><dt>Priority queue</dt><dd>' + esc(blkRange) + '</dd></div>' +
      '<div><dt>Est. workload</dt><dd>' + durTxt(totalMins) + (remMins > 0 && remMins < totalMins ? ' (' + durTxt(remMins) + ' left)' : '') + '</dd></div>' +
      '</dl>';

    // Priority Queue Table: Revision + Block A, B, C...
    var rows = "";
    if (off === 0) {
      rows += '<div class="tt-row rev' + (rvI.done ? ' past' : '') + '">' +
        '<div class="tt-t"><span class="pq-badge">Revision</span></div>' +
        '<div class="tt-l">1 blk · 1h 30m</div>' +
        '<div class="tt-n">Daily Review</div>' +
        '<div class="tt-c"><div class="tt-item rev' + (rvI.done ? ' done' : '') + '"><span class="nm"><b>Revision</b>Question log and flashcards<small>' + esc(revText(rvI)) + '</small></span>' +
        '<button type="button" class="mini-btn" data-revqueue="1">Queue</button>' +
        '<button type="button" class="mini-btn" data-qlfull="1">Open log</button>' +
        '<button type="button" class="mini-btn" data-revdone="1" aria-pressed="' + rvI.done + '">' + (rvI.done ? 'Undo' : 'Mark done') + '</button></div></div></div>';
    }

    rows += dayItems.map(function (r, idx) {
      var bCount = blocksOf(r.c.id), bMins = bCount * 90, letter = blockLetter(idx);
      var tn = ""; for (var t8 = 0; t8 < tests9.length; t8++) if (tests9[t8].keys[r.c.id + "|" + r.src]) { tn = " · for " + tests9[t8].name; break; }
      var isThisTimer = state.timer && state.timer.chKey === (r.c.id + "|" + r.src);
      var tTxt = "";
      if (isThisTimer) {
        var mm = Math.floor(state.timer.secs / 60), ss = state.timer.secs % 60;
        tTxt = (mm < 10 ? "0" : "") + mm + ":" + (ss < 10 ? "0" : "") + ss;
      }
      var startBtn = (!r.done && off === 0)
        ? ((isThisTimer ? '<span class="pq-timer" data-tkey="' + esc(state.timer.key) + '">' + tTxt + '</span>' : '') +
           '<button type="button" class="mini-btn" data-qstart="' + esc(r.c.id + "|" + r.src) + '">' + (isThisTimer && state.timer.running ? 'Pause' : 'Start') + '</button>')
        : '';
      var moveBtns = dayItems.length > 1
        ? '<button type="button" class="mini-btn" data-qmove="' + idx + ':-1" title="Raise priority"' + (idx === 0 ? ' disabled' : '') + '>↑</button>' +
          '<button type="button" class="mini-btn" data-qmove="' + idx + ':1" title="Lower priority"' + (idx === dayItems.length - 1 ? ' disabled' : '') + '>↓</button>'
        : '';
      return '<div class="tt-row study' + (r.done ? ' past' : '') + '">' +
        '<div class="tt-t"><span class="pq-badge' + (idx === 0 && !r.done ? ' top' : '') + '">Block ' + esc(letter) + '</span></div>' +
        '<div class="tt-l">' + durTxt(bMins) + '</div>' +
        '<div class="tt-n">Priority ' + (idx + 1) + '</div>' +
        '<div class="tt-c"><div class="tt-item' + (r.done ? ' done' : '') + '" data-subject="' + esc(r.c.subject) + '">' +
        (off === 0 ? slotButton(r) : '') +
        '<span class="nm"><b>' + esc(LABEL[r.c.subject]) + '</b>' + esc(r.c.name) +
        '<small>' + esc(r.src) + esc(tn) + (r.carried ? ' · carried ' + r.carried + '×' : '') + '</small></span>' +
        '<select class="size" data-planblks="' + r.i + '" data-ch="' + esc(r.c.id) + '" aria-label="Timeblocks for ' + esc(r.c.name) + '">' + [1, 2, 3, 4, 5, 6].map(function (b) { return '<option value="' + b + '"' + (b === bCount ? ' selected' : '') + '>' + b + ' blk' + (b === 1 ? '' : 's') + ' (' + durTxt(b * 90) + ')</option>'; }).join("") + '</select>' +
        '<span class="pts">' + fnum(r.w) + ' pt' + (r.w === 1 ? '' : 's') + '</span>' +
        '<span class="pq-ctl">' + startBtn + moveBtns + '<button type="button" class="rm" data-qrm="' + idx + '" aria-label="Remove ' + esc(r.c.name) + '" title="Remove from plan">✕</button></span>' +
        '</div></div></div>';
    }).join("");

    if (!dayItems.length) {
      rows += '<div class="tt-row study"><div class="tt-t"><span class="pq-badge">Block A</span></div><div class="tt-l">—</div><div class="tt-n">Empty</div><div class="tt-c"><span class="tt-empty">No chapters queued for ' + (off === 0 ? 'today' : 'tomorrow') + ' yet. Click <b>Auto-fill target</b> above or add chapters from Home.</span></div></div>';
    }

    h += '<div class="tt"><div class="tt-head"><span>Block</span><span>Est. Time</span><span>Priority</span><span>Chapter & Controls</span></div>' + rows + '</div>';

    // End-of-day review & Weekly review panels
    var doneCount = dayItems.filter(function (r) { return r.done; }).length;
    var wkPts = 0, wkTgt = 0, wkTasksDone = 0, wkStudyMins = 0, wkWakes = [];
    for (var wi = 0; wi < 7; wi++) {
      var wk = planKey(-wi), wr = state.plans[wk] || {}, wh = wr.habit || {};
      wkPts += dd.pts[wk] || 0;
      wkTgt += effGoal();
      planResolved(wk).forEach(function (xr) { if (xr.done) wkTasksDone++; });
      if (wh.studyMins) wkStudyMins += wh.studyMins;
      else if (wh.studyHrs) wkStudyMins += Math.round(Number(wh.studyHrs) * 60);
      if (TIME_RE.test(wh.wake || "")) wkWakes.push(toMin(wh.wake));
    }
    var avgWake = wkWakes.length ? fmtT(fromMin(Math.round(wkWakes.reduce(function (a, b) { return a + b; }, 0) / wkWakes.length))) : "—";
    var wkPct = wkTgt ? Math.round((wkPts / wkTgt) * 100) : 0;

    h += '<div class="pq-reviews">' +
      '<details class="pq-revbox"><summary>End-of-day review</summary><div class="pq-revgrid">' +
      '<div><b>' + doneCount + ' / ' + dayItems.length + '</b><span>Tasks completed</span></div>' +
      '<div><b>' + (studyHrs || "0") + ' hrs</b><span>Actual study logged</span></div>' +
      '<div><b>' + fnum(donePts) + ' / ' + target + ' pts</b><span>Daily target</span></div>' +
      '<div><b>' + esc(wakeTgt) + '</b><span>Wake-up target</span></div>' +
      '</div><div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">' +
      (off === 0 && dayItems.length - doneCount > 0 ? '<button type="button" class="mini-btn" data-carry="1">Carry unfinished to tomorrow</button>' : '') +
      '<button type="button" class="mini-btn" data-schedday="' + (off === 0 ? 1 : 0) + '">' + (off === 0 ? 'Plan tomorrow tonight' : 'Back to today') + '</button>' +
      '</div></details>' +
      '<details class="pq-revbox"><summary>Weekly review (7 days)</summary><div class="pq-revgrid">' +
      '<div><b>' + fnum(wkPts) + ' / ' + wkTgt + ' pts (' + wkPct + '%)</b><span>Syllabus completed vs planned</span></div>' +
      '<div><b>' + wkTasksDone + ' tasks · ' + (wkStudyMins / 60).toFixed(1) + 'h</b><span>Discipline & effort</span></div>' +
      '<div><b>' + rvI.dueQ + 'Q / ' + rvI.dueF + 'F due</b><span>Revision & mistake log</span></div>' +
      '<div><b>' + esc(avgWake) + ' (goal ' + esc(fmtT(wakeTgt)) + ')</b><span>Avg wake-up time</span></div>' +
      '</div></details></div>';

    host.innerHTML = h;
  }
  function renderManualView(items, ordered, clash, nowMin) {
    var host = $("planTimeline"); if (!host) return;
    var timed = ordered.filter(function (r) { return r.start && r.end; });
    var tray = ordered.filter(function (r) { return !(r.start && r.end); });
    var missed = timed.filter(function (r) { return !r.done && toMin(r.end) <= nowMin; });
    var trayOpen = tray.filter(function (r) { return !r.done; }).length, tests9 = upcomingTests(), nxt9 = null;
    timed.forEach(function (r) { if (!nxt9 && !r.done && toMin(r.start) > nowMin) nxt9 = r; });
    var selR = state.selBlk !== null ? items.filter(function (r) { return r.i === state.selBlk && r.start && r.end; })[0] : null;
    if (!selR) state.selBlk = null;
    if (state.placeIdx !== null && !items.some(function (r) { return r.i === state.placeIdx; })) state.placeIdx = null;
    var minS = timed.length ? Math.min.apply(null, timed.map(function (r) { return toMin(r.start); })) : 600;
    var h0 = Math.min(5, Math.floor(minS / 60)), h1 = 24, gridH = (h1 - h0) * CB_H;
    var h = schedHead(modeOf(planKey(0)), "manual", trayOpen);
    if (missed.length) h += '<p class="note cb-miss"><b>' + missed.length + ' missed block' + (missed.length === 1 ? '' : 's') + '.</b> <button type="button" class="linkbtn" data-mreschedall="1">Move ' + (missed.length === 1 ? 'it' : 'all') + ' to the next free time</button></p>';
    if (items.length) {
      h += '<div class="cb-tray"><div class="cb-trayhead"><span class="cb-lab">Plan · ' + items.length + ' item' + (items.length === 1 ? '' : 's') + (tray.length ? ' · ' + tray.length + ' to place' : ' · all scheduled') + '</span>' + (tray.length ? '<span class="cb-hint">Click one, then a time on the calendar. Or drag it across.</span>' : '') + '</div>' + tray.map(function (r) {
        var tn = ""; for (var t9 = 0; t9 < tests9.length; t9++) if (tests9[t9].keys[r.c.id + "|" + r.src]) { tn = " · for " + tests9[t9].name; break; }
        return '<div class="cb-row' + (r.done ? ' done' : '') + (state.placeIdx === r.i ? ' on' : '') + '" draggable="' + (r.done ? 'false' : 'true') + '"' + (r.done ? '' : ' data-pick="' + r.i + '"') + ' data-subject="' + esc(r.c.subject) + '">' + slotButton(r) +
          '<span class="nm"><b>' + esc(LABEL[r.c.subject]) + '</b>' + esc(r.c.name) + '<small>' + esc(r.src) + esc(tn) + (r.carried ? ' · carried over ' + r.carried + (r.carried === 1 ? ' time' : ' times') : '') + '</small></span>' +
          '<span class="pts">' + fnum(r.w) + ' pt' + (r.w === 1 ? '' : 's') + '</span>' +
          '<button type="button" class="rm" data-planrm="' + r.i + '" aria-label="Remove ' + esc(r.c.name + ', ' + r.src) + ' from Today" title="Remove">✕</button></div>';
      }).join("") + '</div>';
    }
    if (state.placeIdx !== null) h += '<p class="note cb-banner">Click a time on the calendar to place it. <button type="button" class="linkbtn" data-selclose="1">Cancel</button></p>';
    else if (selR) {
      h += '<div class="cb-sel" data-subject="' + esc(selR.c.subject) + '"><div class="cb-sel-top">' + slotButton(selR) + '<span class="nm"><b>' + esc(LABEL[selR.c.subject]) + '</b> ' + esc(selR.c.name) + '<small>' + esc(selR.src) + ' · ' + esc(blockTxt(selR)) + ' · ' + durTxt(toMin(selR.end) - toMin(selR.start)) + '</small></span><button type="button" class="rm" data-selclose="1" aria-label="Close">✕</button></div>' +
        '<div class="tb-seg" role="group" aria-label="Block length">' + DURS.map(function (m) { return '<button type="button" data-pdur="' + selR.i + ':' + m + '" aria-pressed="' + (toMin(selR.end) - toMin(selR.start) === m) + '">' + durTxt(m) + '</button>'; }).join("") + '</div>' +
        '<p class="note cb-banner">Click an empty time to move it there, or drag it. Drag its bottom edge to change the length. <button type="button" class="linkbtn" data-pclear="' + selR.i + '">Unschedule</button> · <button type="button" class="linkbtn" data-planrm="' + selR.i + '">Remove from today</button></p></div>';
    }
    // lane layout for overlapping blocks
    var lanes = {}, laneN = {};
    var sorted = timed.slice().sort(function (a, b) { return toMin(a.start) - toMin(b.start); });
    sorted.forEach(function (a) {
      var used = {}; sorted.forEach(function (b) { if (b !== a && lanes[b.i] !== undefined && toMin(b.start) < toMin(a.end) && toMin(a.start) < toMin(b.end)) used[lanes[b.i]] = 1; });
      var l = 0; while (used[l]) l++; lanes[a.i] = l;
    });
    sorted.forEach(function (a) { var m = lanes[a.i]; sorted.forEach(function (b) { if (b !== a && toMin(b.start) < toMin(a.end) && toMin(a.start) < toMin(b.end) && lanes[b.i] > m) m = lanes[b.i]; }); laneN[a.i] = m + 1; });
    var hours = "", hh;
    for (hh = h0; hh < h1; hh++) hours += '<div class="cb-hour" style="top:' + (hh - h0) * CB_H + 'px"><span>' + hourLab(hh) + '</span></div>';
    var blocks = timed.map(function (r) {
      var s0 = toMin(r.start), e0 = toMin(r.end), top = (s0 - h0 * 60) * CB_PPM, ht = Math.max(15, e0 - s0) * CB_PPM, n = laneN[r.i] || 1, l = lanes[r.i] || 0;
      var isMiss = !r.done && e0 <= nowMin;
      return '<div class="cb-blk' + (r.done ? ' done' : '') + (isMiss ? ' miss' : '') + (clash[r.i] ? ' clash' : '') + (state.selBlk === r.i ? ' sel' : '') + '" role="button" tabindex="0" data-bidx="' + r.i + '" data-s="' + s0 + '" data-e="' + e0 + '" data-subject="' + esc(r.c.subject) + '" style="top:' + top + 'px;height:' + ht + 'px;left:calc(' + (l * 100 / n) + '% + 2px);width:calc(' + (100 / n) + '% - 4px)" title="' + esc(r.c.name + ' · ' + r.src + ' · ' + blockTxt(r)) + '"><span class="cb-tk">' + slotButton(r) + '</span><b>' + esc(r.c.name) + (nxt9 === r ? ' <em class="badge">Next up</em>' : '') + '</b><small>' + esc(r.src) + ' · ' + esc(fmtT(r.start)) + '</small>' + (isMiss ? '<button type="button" class="cb-mv" data-mresched="' + r.i + '" title="Move to the next free time">Missed · move</button>' : '') + '<i class="cb-rs" aria-hidden="true"></i></div>';
    }).join("");
    var nowLine = nowMin >= h0 * 60 ? '<div class="cb-now" style="top:' + ((nowMin - h0 * 60) * CB_PPM) + 'px"><i></i></div>' : '';
    var bands = [].map(function (b) {
      var t0 = Math.max(0, (toMin(b.start) - h0 * 60) * CB_PPM), t1 = (toMin(b.end) - h0 * 60) * CB_PPM; if (t1 <= 0) return "";
      return '<div class="cb-band ' + b.kind + '" style="top:' + t0 + 'px;height:' + (t1 - t0) + 'px"><span>' + esc(b.name) + '</span></div>';
    }).join("");
    h += '<div class="cb-scroll"><div class="cb-grid" data-ppm="' + CB_PPM + '" style="height:' + gridH + 'px">' + hours +
      '<div class="cb-slots" data-h0="' + h0 + '"' + (state.placeIdx !== null || state.selBlk !== null ? ' data-armed="1"' : '') + '>' + bands + blocks + nowLine + '</div></div></div>';
    host.innerHTML = h;
    var sc = host.querySelector(".cb-scroll");
    if (sc) sc.scrollTop = state.tlScroll !== null ? state.tlScroll : Math.max(0, (nowMin - 60 - h0 * 60) * CB_PPM);
  }
  document.addEventListener("click", function (e) { var sm = e.target.closest ? e.target.closest(".addwrap > summary") : null; if (sm) state.pAddOpen = !sm.parentNode.open; }, true);
  document.addEventListener("scroll", function (e) { if (e.target && e.target.classList && e.target.classList.contains("cb-scroll")) state.tlScroll = e.target.scrollTop; }, true);
  document.addEventListener("pointerdown", function (e) {
    var b = e.target.closest ? e.target.closest(".cb-blk") : null;
    if (!b || e.button > 0 || e.target.closest("button")) return;
    cbDrag = { b: b, idx: Number(b.getAttribute("data-bidx")), y0: e.clientY, top0: parseFloat(b.style.top), h0: parseFloat(b.style.height), s0: Number(b.getAttribute("data-s")), e0: Number(b.getAttribute("data-e")), resize: !!e.target.closest(".cb-rs"), moved: false, mouse: e.pointerType === "mouse", dm: 0 };
    if (cbDrag.mouse) { try { b.setPointerCapture(e.pointerId); } catch (x) {} }
  });
  document.addEventListener("pointermove", function (e) {
    if (!cbDrag || !cbDrag.mouse) return;
    var dy = e.clientY - cbDrag.y0; if (Math.abs(dy) > 4) cbDrag.moved = true; if (!cbDrag.moved) return;
    var dm = Math.round(dy / CB_PPM / 15) * 15; cbDrag.dm = dm;
    if (cbDrag.resize) cbDrag.b.style.height = Math.max(15 * CB_PPM, cbDrag.h0 + dm * CB_PPM) + "px"; else cbDrag.b.style.top = (cbDrag.top0 + dm * CB_PPM) + "px";
  });
  document.addEventListener("pointercancel", function () { cbDrag = null; });
  document.addEventListener("pointerup", function () {
    if (!cbDrag) return; var d = cbDrag; cbDrag = null;
    if (!d.moved) { state.selBlk = state.selBlk === d.idx ? null : d.idx; state.placeIdx = null; renderPlan(); return; }
    var ns = d.s0, ne = d.e0;
    if (d.resize) ne = Math.min(1439, Math.max(d.s0 + 15, d.e0 + d.dm));
    else { var len = d.e0 - d.s0; ns = Math.max(0, Math.min(1439 - len, d.s0 + d.dm)); ne = ns + len; }
    state.selBlk = d.idx; setBlock(d.idx, fromMin(ns), fromMin(ne));
  });
  document.addEventListener("keydown", function (e) {
    var b = e.target.closest ? e.target.closest(".cb-blk") : null;
    if (b && (e.key === "Enter" || e.key === " ") && !(e.target.closest && e.target.closest("button"))) { e.preventDefault(); var i = Number(b.getAttribute("data-bidx")); state.selBlk = state.selBlk === i ? null : i; state.placeIdx = null; renderPlan(); }
    else if (e.key === "Escape" && (state.selBlk !== null || state.placeIdx !== null)) { state.selBlk = null; state.placeIdx = null; renderPlan(); }
  });
  document.addEventListener("click", function (e) {
    var slots = e.target.closest ? e.target.closest(".cb-slots") : null;
    if (!slots || e.target.closest(".cb-blk")) return;
    var m = cbMinuteAt(slots, e.clientY);
    if (state.placeIdx !== null) placeAt(state.placeIdx, m);
    else if (state.selBlk !== null) placeAt(state.selBlk, m);
  });
  document.addEventListener("dragover", function (e) { if (e.target.closest && e.target.closest(".cb-slots")) e.preventDefault(); });
  document.addEventListener("drop", function (e) {
    var slots = e.target.closest ? e.target.closest(".cb-slots") : null; if (!slots || !e.dataTransfer) return;
    e.preventDefault(); var idx = Number(e.dataTransfer.getData("text/plain")); if (isNaN(idx)) return;
    placeAt(idx, cbMinuteAt(slots, e.clientY));
  });

  function renderPlan() {
    if (state.view !== "plan" && state.view !== "schedule") return;
    var card = $("seneca");
    revEnsure();
    var key = planKey(0), now = new Date();
    var items = planResolved(key), carry = carryGap(dayData()), target = effGoal() + carry, q = needed();
    var dd = dayData(), todayPts = dd.pts[key] || 0;
    var planPts = 0, pendPts = 0, planned = {};
    items.forEach(function (r) { planPts += r.w; if (!r.done) pendPts += r.w; planned[r.c.id + "|" + r.src] = 1; });
    var gap = Math.max(0, target - todayPts - pendPts);
    var tests = upcomingTests(), tinfo = tests.slice(0, 2).map(function (ti) { return { ti: ti, td: testToday(ti, items, key) }; });
    var testShort = tinfo.length && tinfo[0].ti.left > 0 ? tinfo[0].td.short : 0;
    var msg, ds;
    if (todayPts >= target) { msg = "Target reached. Anything more today is extra."; ds = "ok"; }
    else if (!items.length) { msg = "Nothing is planned yet. Add an item below, or take the counsel."; ds = ""; }
    else if (gap === 0) { msg = "On track. Finish the " + fnum(pendPts) + " points still planned and you hit today's target of " + target + "."; ds = "ok"; }
    else { msg = "Plan " + fnum(gap) + " more point" + (gap === 1 ? "" : "s") + " to reach today's target."; ds = "plan"; }
    var fin = "";
    if (q.left > 0 && target > 0) {
      var f = new Date(q.t0); f.setDate(f.getDate() + Math.ceil(q.left / target));
      var diff = Math.round((f - parseD(state.deadline)) / 864e5);
      fin = "Hitting " + target + " points every day finishes the syllabus around " + fmtDate(f) + (diff <= 0 ? ", " + (-diff) + " days before your deadline." : ", " + diff + " days after your deadline.");
    }
    var nowMin = now.getHours() * 60 + now.getMinutes();
    var stk = streakNow(dd), stand = standing(dd), curRate = currentRate(dd);
    var gapTxt = !stand ? "" : Math.abs(stand.gap) < 0.5 ? "On track" : (stand.gap > 0 ? "Behind by " : "Ahead by ") + fint(Math.abs(stand.gap)) + " pts";
    var testLine = tinfo.length ? (function () {
      var ti = tinfo[0].ti, td = tinfo[0].td;
      return '<p class="note"><b>' + esc(ti.name) + '</b> ' + daysTxt(ti.days) + ': ' + (ti.left > 0 ? fnum(ti.left) + ' of ' + fnum(ti.total) + ' points left, about ' + fnum(td.perDay) + ' a day. Today\'s plan covers ' + fnum(td.pend) + ' still to do, and ' + fnum(td.done) + ' done today.' + (td.short > 0 ? ' Short by ' + fnum(td.short) + ' for the test.' : '') : 'everything you picked for it is covered.') + '</p>';
    })() : "";
    var h = '<div class="sen-today"><div><p class="eyebrow">Today · ' + esc(now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })) + '</p>' +
      '<div class="td-stats"><span class="line"><span>Target</span> <span class="stepper"><button type="button" data-goal="-1" aria-label="Lower target">−</button><b>' + target + '</b><button type="button" data-goal="1" aria-label="Raise target">+</button></span></span>' +
      (carry ? '<span class="stat carry" title="You fell short of your target yesterday. The gap is added to today.">+' + fnum(carry) + ' carried from yesterday</span>' : '') +
      '<span class="stat"><b>' + fnum(todayPts) + '</b> of ' + target + ' done</span>' +

      '</div></div>' +
      '<div class="meter" style="--sub:var(--day)" aria-hidden="true"><i style="width:' + (Math.min(1, target ? todayPts / target : 0) * 100) + '%"></i></div>' +
      '<p class="dl-status"' + (ds ? ' data-state="' + ds + '"' : '') + '>' + esc(msg) + '</p>';
    var analyticsHtml = '<details class="more"><summary>Reckoning</summary><p class="note">' + (stk ? stk + '-day streak' : 'No streak yet') + (fin ? ' · ' + esc(fin) : '') + '</p>' + testLine + '</details>';

    var ordered = [], clash = {}, nextUp = null, timedAll = [];
    function testIdx(r) { for (var t = 0; t < tests.length; t++) if (tests[t].keys[r.c.id + "|" + r.src]) return t; return 99; }
    if (items.length) {
      ordered = items.slice().sort(function (a, b) {
        if (!!a.start !== !!b.start) return a.start ? -1 : 1;
        if (a.start && b.start) return a.start < b.start ? -1 : a.start > b.start ? 1 : a.i - b.i;
        if (a.done !== b.done) return a.done ? 1 : -1;
        return (testIdx(a) - testIdx(b)) || (sizeOf(b.c.id) - sizeOf(a.c.id)) || (srcRank(a.src) - srcRank(b.src)) || (a.i - b.i);
      });
      ordered.forEach(function (a) {
        if (!a.start || !a.end) return;
        ordered.forEach(function (b) { if (a !== b && b.start && b.end && a.start < b.end && b.start < a.end) clash[a.i] = 1; });
      });
      timedAll = ordered.filter(function (r) { return r.start && r.end; });
      for (var ni = 0; ni < ordered.length; ni++) if (!ordered[ni].done && !ordered[ni].start) { nextUp = ordered[ni]; break; }
    }
    // now / next
    var curBlk = null, nxtBlk = null;
    timedAll.forEach(function (r) { var s0 = toMin(r.start), e0 = toMin(r.end); if (!curBlk && s0 <= nowMin && nowMin < e0) curBlk = r; if (!nxtBlk && !r.done && s0 > nowMin) nxtBlk = r; });
    if (items.length) {
    }
    // manual add
    var pa = state.pAdd, subs = SUBJ;
    var openChs = pa.sub ? chaptersOf(pa.sub).filter(function (c) {
      return sourcesOf(pa.sub).some(function (src) { return !(c.ticks && c.ticks[src]) && !planned[c.id + "|" + src]; });
    }) : [];
    if (!openChs.some(function (c) { return c.id === pa.ch; })) pa.ch = "";
    var cc = pa.ch ? chById(pa.ch) : null;
    var srcOpts = cc ? sourcesOf(pa.sub).filter(function (src) { return !(cc.ticks && cc.ticks[src]) && !planned[cc.id + "|" + src]; }).sort(function (a, b) { return srcRank(a) - srcRank(b); }) : [];
    pa.src = srcOpts.length ? srcOpts[0] : "";
    var ph = function (txt) { return '<option value="" selected>' + txt + '</option>'; };
    h += '<details class="addwrap"' + (state.pAddOpen ? ' open' : '') + '><summary>+ Add a chapter</summary><div class="plan-add"><label class="fld"><span>Subject</span><select class="field" id="planSub">' + (pa.sub ? '<option value="">Choose subject</option>' : ph("Choose subject")) + subs.map(function (s) { return '<option value="' + s + '"' + (s === pa.sub ? " selected" : "") + '>' + LABEL[s] + '</option>'; }).join("") + '</select></label>' +
      '<label class="fld"><span>Chapter</span><select class="field" id="planCh"' + (pa.sub ? "" : " disabled") + '>' + (pa.ch ? '<option value="">Choose chapter</option>' : ph(pa.sub && !openChs.length ? "Nothing left" : "Choose chapter")) + openChs.map(function (c) { return '<option value="' + esc(c.id) + '"' + (c.id === pa.ch ? " selected" : "") + '>' + esc(c.name) + '</option>'; }).join("") + '</select></label>' +
      '<button type="button" class="pill main" data-planadd="1"' + (cc && pa.src ? "" : " disabled") + '>+ Add to plan</button>' + (cc && pa.src ? '<span class="note">Adds ' + esc(pa.src) + ' (highest priority left)</span>' : '') + '</div></details>';
    var pendItems = items.filter(function (r) { return !r.done; }), tomorrowKey = planKey(1);
    var tmrHave = {}; planRaw(tomorrowKey).forEach(function (it) { tmrHave[it.ch + "|" + it.src] = 1; });
    var carryable = pendItems.filter(function (r) { return !tmrHave[r.c.id + "|" + r.src]; });
    if (items.length) {
      h += '<div class="wrapup"><div><p class="eyebrow">Evening reckoning</p><p class="note">' + fnum(todayPts) + ' of ' + target + ' points done' + (pendItems.length ? ', ' + pendItems.length + ' item' + (pendItems.length === 1 ? '' : 's') + ' unfinished.' : '. Everything planned is ticked.') + '</p></div></div>';
    }
    h += '</div>';
    renderTimeline(items, ordered, clash, nowMin);
    if (state.timeEdit !== null && state.timeFocus) {
      var tlEl = $("planTimeline");
      var fe = tlEl ? tlEl.querySelector("[data-" + state.timeFocus + "=\"" + state.timeEdit + "\"]") : null; state.timeFocus = "";
      if (fe) fe.focus();
    }

    // suggestions: a mix across all three subjects, with a way out for items you do not feel like doing
    var sug = [], carried = [];
    var budget = Math.max(0, target + 1 - todayPts - pendPts);
    var needSug = Math.min(Math.max(gap, testShort), budget);
    var set2 = Object.assign({}, planned), got = 0;
    if (needSug > 0) {
      planResolved(planKey(-1)).forEach(function (r) {
        var kk = r.c.id + "|" + r.src;
        if (r.done || set2[kk] || got >= needSug || got + r.w > budget) return;
        carried.push({ ch: r.c.id, c: r.c, src: r.src, w: r.w, carried: (r.carried || 0) + 1, why: "Not finished yesterday" }); got += r.w; set2[kk] = 1;
      });
    }
    var dueCap = Math.max(0, Math.round(target * SPACE_SHARE));
    items.forEach(function (r) { if (!r.done && isRevisit(r.c, r.src)) dueCap -= r.w; });
    dueCap = Math.max(0, dueCap);
    var main = needSug - got > 0 ? suggestSlots(needSug - got, set2, tests, null, null, budget - got, dueCap) : [];
    var dueUsed = 0; main.forEach(function (x) { if (x.g === 0) dueUsed += x.w; });
    sug = carried.concat(main);
    var have = {}, extra = [];
    items.forEach(function (r) { have[r.c.subject] = 1; });
    sug.forEach(function (x) { have[x.c.subject] = 1; x.key = x.ch + "|" + x.src; });
    var set3 = Object.assign({}, set2); sug.forEach(function (x) { set3[x.ch + "|" + x.src] = 1; });
    SUBJ.forEach(function (sb) {
      if (have[sb]) return;
      var used = 0; sug.concat(extra).forEach(function (x) { used += x.w; });
      /* A subject that would otherwise be missing gets its turn whatever the chapter size, so hard chapters are never skipped for being big. */
      var one = suggestSlots(1, set3, tests, null, sb, Infinity, Math.max(0, dueCap - dueUsed))[0];
      if (!one) return;
      if (one.g === 0) dueUsed += one.w;
      one.why = "Keeps " + LABEL[sb] + " moving" + (one.why ? " · " + one.why : ""); set3[one.ch + "|" + one.src] = 1; extra.push(one);
    });
    sug = sug.concat(extra);
    /* The day's study blocks are the real limit: keep only what the free blocks can hold, biggest first. */
    var trimmedPts = 0;
    if (false && state.sview !== "manual") {
      var tplT = ttFor(modeOf(planKey(0))), rawT = cloneItems(planKey(0));
      if (tplT.some(function (b) { return b.kind === "study"; })) {
        var freeT = freeStudy(rawT, tplT, -1, nowMinutes());
        items.forEach(function (r) { if (!r.done && !r.blks.length && !r.start) takeBlocks(freeT, blocksOf(r.c.id)); });
        if (freeT.length > 0) {
          var keepS = [];
          /* Keep one item per subject first, then the rest in the order they were picked. Size and difficulty never decide what stays. */
          var seenS = {}, firstPass = [], restPass = [];
          sug.forEach(function (x) { if (!seenS[x.c.subject]) { seenS[x.c.subject] = 1; firstPass.push(x); } else restPass.push(x); });
          firstPass.sort(function (a, b) {
            var la = subjectLastDay(a.c.subject) || "", lb = subjectLastDay(b.c.subject) || "";
            return la < lb ? -1 : la > lb ? 1 : dayRand(planKey(0) + "|" + a.c.subject) - dayRand(planKey(0) + "|" + b.c.subject);
          }).concat(restPass).forEach(function (x) {
            if (!freeT.length) { trimmedPts += x.w; return; }
            takeBlocks(freeT, blocksOf(x.c.id)); keepS.push(x);
          });
          sug = sug.filter(function (x) { return keepS.indexOf(x) > -1; });
        }
      }
    }
    /* interleave so the list reads Biology, Physics, Chemistry, Biology... */
    var qs = {}; SUBJ.forEach(function (sb) { qs[sb] = []; });
    sug.forEach(function (x) { qs[x.c.subject].push(x); });
    sug = []; for (var rr = 0; rr < 40; rr++) { var any = false; SUBJ.forEach(function (sb) { if (qs[sb].length) { sug.push(qs[sb].shift()); any = true; } }); if (!any) break; }
    state.sugg = sug;
    renderSeneca({ target: target, todayPts: todayPts, pendPts: pendPts, items: items, curBlk: curBlk, nxtBlk: nxtBlk, pendItems: pendItems, carryable: carryable, sug: sug, budget: budget, stk: stk, trimmed: trimmedPts, todayHtml: h, analyticsHtml: analyticsHtml });
  }

  function applyView() {
    $("viewPlan").hidden = state.view !== "plan";
    $("viewSchedule").hidden = state.view !== "schedule";
    $("viewTracker").hidden = state.view !== "tracker";
    $("viewTest").hidden = state.view !== "test";
    Array.prototype.forEach.call(document.querySelectorAll(".vbtn"), function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-view") === state.view));
    });
    if (state.view === "test") renderTest();
    if (state.view === "plan" || state.view === "schedule") renderPlan();
  }
  /* Supertabs: show only the groups that belong to the active supertab. */
  state.super = "stoa";
  function applySuper() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-superof]"), function (el) { el.classList.toggle("super-off", el.getAttribute("data-superof") !== state.super); });
    Array.prototype.forEach.call(document.querySelectorAll(".sbtn"), function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-super") === state.super)); });
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest ? e.target.closest(".sbtn") : null; if (!b) return;
    state.super = b.getAttribute("data-super"); applySuper();
  });
  function applyHash() {
    var h = location.hash;
    if (h === "#test-prep") state.view = "test";
    else if (h === "#schedule") state.view = "schedule";
    else if (h === "#home" || h === "#todays-plan") state.view = "plan";
    else if (h === "#tracker") state.view = "tracker";
    else if (h === "") state.view = "plan";
    applySuper();
    applyView();
  }
  function setView(v) {
    state.view = v; applyView();
    try { location.hash = v === "test" ? "test-prep" : v === "schedule" ? "schedule" : v === "plan" ? "home" : "tracker"; } catch (e) {}
  }

  function saveTest(id) {
    queued("t:" + id, function () {
      var x = state.tests.filter(function (y) { return y.id === id; })[0];
      if (!x) return null;
      return db.collection("tests").doc(id).set({ name: x.name || "", date: x.date || "", chapters: x.chapters || [], sources: x.sources || {}, created: x.created || 0 });
    });
  }
  function mutateTest(fn) {
    var x = currentTest();
    if (!x || needDb()) { renderTest(); return; }
    var copy = JSON.parse(JSON.stringify(x)); fn(copy);
    state.tests = state.tests.map(function (y) { return y.id === x.id ? copy : y; });
    state.confirmDel = false;
    renderTest(); saveTest(x.id);
  }
  function newTest(name, date) {
    if (needDb()) return;
    name = (name || "").trim().slice(0, 60);
    if (!name) { toast("Give the test a name."); return; }
    if (!DATE_RE.test(date || "")) { toast("Pick the test date."); return; }
    var sources = {}; SUBJ.forEach(function (s) { sources[s] = []; });
    var ref = db.collection("tests").doc();
    var body = { name: name, date: date, chapters: [], sources: sources, created: Date.now() };
    state.tests = state.tests.concat([Object.assign({ id: ref.id }, body)]);
    state.testId = ref.id; state.newOpen = false; state.confirmDel = false; saveActive();
    renderTest();
    queued("t:" + ref.id, function () { return ref.set(body); });
  }
  function deleteTest() {
    var x = currentTest(); if (!x) return;
    if (!state.confirmDel) { state.confirmDel = true; renderTest(); return; }
    if (needDb()) return;
    var id = x.id;
    state.tests = state.tests.filter(function (y) { return y.id !== id; });
    state.testId = pickDefaultTest(); state.confirmDel = false; saveActive();
    renderTest();
    queued("t:" + id, function () { return db.collection("tests").doc(id).delete(); });
  }
  function setSubjectChapters(sub, on) {
    var ids = chaptersOf(sub).map(function (c) { return c.id; });
    mutateTest(function (c) {
      var set = chapterSet(c);
      ids.forEach(function (id) { if (on) set[id] = 1; else delete set[id]; });
      c.chapters = Object.keys(set);
    });
  }
  function toggleSource(sub, name) {
    mutateTest(function (c) {
      c.sources = c.sources || {};
      var arr = (c.sources[sub] || []).slice(), i = arr.indexOf(name);
      if (i > -1) arr.splice(i, 1); else arr.push(name);
      c.sources[sub] = arr;
    });
  }

  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-view],[data-testnew],[data-testdel],[data-testall],[data-testsrc],[data-tptab],[data-tpfilter],[data-tpaddch],[data-tpaddsrc],[data-testrm],[data-mgrsub],[data-planrm],[data-resched],[data-reschedall],[data-autofill],[data-sview],[data-pdur],[data-pclear],[data-mauto],[data-mresched],[data-mreschedall],[data-mode],[data-schedday],[data-autofillq],[data-wokenow],[data-qstart],[data-qmove],[data-qrm],[data-flexshift],[data-place],[data-unplace],[data-ttedit],[data-ttadd],[data-ttdel],[data-ttreset],[data-ttmode],[data-ttnew],[data-ttrm],[data-carry],[data-pick],[data-selclose],[data-planadd],[data-sugadd],[data-sugall],[data-testplan]");
    if (!t) return;
    if (t.hasAttribute("data-view")) setView(t.getAttribute("data-view"));
    else if (t.hasAttribute("data-testnew")) { state.newOpen = !state.newOpen; renderTest(); var ni = $("npName"); if (ni) ni.focus(); }
    else if (t.hasAttribute("data-testdel")) deleteTest();
    else if (t.hasAttribute("data-testall")) { var p = t.getAttribute("data-testall").split(":"); setSubjectChapters(p[0], p[1] === "all"); }
    else if (t.hasAttribute("data-testsrc")) toggleSource(t.getAttribute("data-testsrc"), t.getAttribute("data-srcname"));
    else if (t.hasAttribute("data-tptab")) { state.tpSub = t.getAttribute("data-tptab"); renderTest(); }
    else if (t.hasAttribute("data-tpfilter")) { state.tpFilter = t.getAttribute("data-tpfilter"); renderTest(); }
    else if (t.hasAttribute("data-tpaddch")) { state.tpAddCh = !state.tpAddCh; renderTest(); }
    else if (t.hasAttribute("data-tpaddsrc")) { state.tpAddSrc = !state.tpAddSrc; renderTest(); }
    else if (t.hasAttribute("data-testplan")) {
      var tx = currentTest();
      if (tx) {
        var tiX = testInfo(tx), its = planResolved(planKey(0)), tdX = testToday(tiX, its, planKey(0)), pl = {};
        its.forEach(function (r) { pl[r.c.id + "|" + r.src] = 1; });
        var pick = suggestSlots(tdX.short, pl, [tiX], tiX);
        if (pick.length) { planAdd(pick); toast("Added " + pick.length + " item" + (pick.length === 1 ? "" : "s") + " to today's plan."); }
        else toast("Nothing left to add for this test.");
      }
    }
    else if (t.hasAttribute("data-planrm")) {
      var pi = Number(t.getAttribute("data-planrm")), cur = planRaw(planKey(0)).slice(); cur.splice(pi, 1); state.timeEdit = null; state.selBlk = null; state.placeIdx = null; savePlan(cur);
    }
    else if (t.hasAttribute("data-mode")) setMode(t.getAttribute("data-mode"));
    else if (t.hasAttribute("data-schedday")) {
      state.schedDay = Number(t.getAttribute("data-schedday")) || 0;
      renderPlan();
    }
    else if (t.hasAttribute("data-autofillq")) {
      if (needDb()) return;
      var qOff = state.schedDay === 1 ? 1 : 0, qKey = planKey(qOff);
      var qItems = planResolved(qKey), qDone = qOff === 0 ? (dayData().pts[qKey] || 0) : 0, qPend = 0, qSet = {};
      qItems.forEach(function (r) { if (!r.done) qPend += r.w; qSet[r.c.id + "|" + r.src] = 1; });
      var qNeed = Math.max(0, effGoal() + (qOff === 0 ? carryGap(dayData()) : 0) - qDone - qPend);
      var picks = qOff === 0 && state.sugg && state.sugg.length ? state.sugg : suggestSlots(qNeed, qSet, upcomingTests());
      if (!picks.length) { toast("No more chapters available to add."); return; }
      var qRaw = cloneItems(qKey);
      picks.forEach(function (x) { var kk = x.ch + "|" + x.src; if (!qSet[kk]) { qRaw.push({ ch: x.ch, src: x.src }); qSet[kk] = 1; } });
      var qRec = Object.assign({}, state.plans[qKey] || {}, { mode: modeOf(qKey), items: qRaw });
      state.plans[qKey] = qRec; renderPlan();
      queued("p:" + qKey, function () { return db.doc("plans/" + qKey).set(qRec); });
      toast("Filled priority queue for " + (qOff === 0 ? "today" : "tomorrow") + ".");
    }
    else if (t.hasAttribute("data-wokenow")) {
      if (needDb()) return;
      var hwKey = planKey(state.schedDay === 1 ? 1 : 0), hwRec = Object.assign({}, state.plans[hwKey] || {}, { items: planRaw(hwKey) });
      hwRec.habit = Object.assign({}, hwRec.habit || {}, { wake: fromMin(nowMinutes()) });
      state.plans[hwKey] = hwRec; renderPlan();
      queued("p:" + hwKey, function () { return db.doc("plans/" + hwKey).set(hwRec); });
      toast("Wake-up logged at " + fmtT(hwRec.habit.wake) + ".");
    }
    else if (t.hasAttribute("data-qstart")) {
      var qk = t.getAttribute("data-qstart"), qp = qk.split("|"), qCh = chById(qp[0]);
      if (!qCh) return;
      var qSecs = blocksOf(qCh.id) * 90 * 60;
      if (state.timer && state.timer.chKey === qk) {
        state.timer.running = !state.timer.running;
      } else {
        state.timer = { key: qk + "|q|" + blocksOf(qCh.id), chKey: qk, secs: qSecs, total: qSecs, elapsed: 0, running: true };
        state.focusOverride = qk;
      }
      renderPlan();
    }
    else if (t.hasAttribute("data-qmove")) {
      if (needDb()) return;
      var mp = t.getAttribute("data-qmove").split(":"), mi = Number(mp[0]), md = Number(mp[1]);
      var mKey = planKey(state.schedDay === 1 ? 1 : 0), mArr = planRaw(mKey).slice(), mTo = mi + md;
      if (mTo < 0 || mTo >= mArr.length) return;
      var tmp = mArr[mi]; mArr[mi] = mArr[mTo]; mArr[mTo] = tmp;
      var mRec = Object.assign({}, state.plans[mKey] || {}, { mode: modeOf(mKey), items: mArr });
      state.plans[mKey] = mRec; renderPlan();
      queued("p:" + mKey, function () { return db.doc("plans/" + mKey).set(mRec); });
    }
    else if (t.hasAttribute("data-qrm")) {
      if (needDb()) return;
      var ri = Number(t.getAttribute("data-qrm")), rKey = planKey(state.schedDay === 1 ? 1 : 0), rArr = planRaw(rKey).slice();
      rArr.splice(ri, 1);
      var rRec = Object.assign({}, state.plans[rKey] || {}, { mode: modeOf(rKey), items: rArr });
      state.plans[rKey] = rRec; renderPlan();
      queued("p:" + rKey, function () { return db.doc("plans/" + rKey).set(rRec); });
    }
    else if (t.hasAttribute("data-wakenow_unused")) {
      if (needDb()) return;
      var k0 = planKey(0), r0 = Object.assign({}, state.plans[k0] || {}, { items: planRaw(k0), wake: fromMin(Math.floor(nowMinutes() / 5) * 5) });
      delete r0.shiftFrom;
      state.plans[k0] = r0; renderPlan();
      queued("p:" + k0, function () { return db.doc("plans/" + k0).set(r0); });
      toast("Day anchored to " + fmtT(r0.wake) + ".");
    }
    else if (t.hasAttribute("data-flexshift")) {
      if (needDb()) return;
      var k1 = planKey(0), nowS = Math.floor(nowMinutes() / 5) * 5;
      var r1 = Object.assign({}, state.plans[k1] || {}, { items: planRaw(k1), shiftFrom: nowS });
      if (!TIME_RE.test(r1.wake || "")) r1.wake = fromMin(nowS);
      state.plans[k1] = r1; renderPlan();
      queued("p:" + k1, function () { return db.doc("plans/" + k1).set(r1); });
      toast("Remaining blocks shifted to " + fmtT(fromMin(nowS)) + ".");
    }
    else if (t.hasAttribute("data-place")) {
      if (e.target.closest(".tick,.heat,.mini-btn")) return;
      if (state.placeIdx === "rev") moveRevToBlock(t.getAttribute("data-place"));
      else if (state.placeIdx !== null) placeAtBlock(state.placeIdx, t.getAttribute("data-place"));
    }
    else if (t.hasAttribute("data-unplace")) {
      var ui = Number(t.getAttribute("data-unplace")), ur = cloneItems(planKey(0));
      if (ur[ui]) { clearPlace(ur[ui], null); state.placeIdx = null; savePlan(ur); }
    }
    else if (t.hasAttribute("data-autofill")) {
      var af = autoPlaceBlocks();
      if (af.placed < af.total) toast(af.placed ? "Placed " + af.placed + ". The rest did not fit in today's free blocks." : "No free study blocks left today.");
    }
    else if (t.hasAttribute("data-resched") || t.hasAttribute("data-reschedall")) {
      var rr = reschedule(t.hasAttribute("data-resched") ? Number(t.getAttribute("data-resched")) : undefined);
      if (rr.moved < rr.total) toast(rr.moved ? "Moved " + rr.moved + ". The rest have no free block left today." : "No free study blocks left today.");
    }
    else if (t.hasAttribute("data-sview")) {
      state.sview = t.getAttribute("data-sview") === "manual" ? "manual" : "blocks"; state.placeIdx = null; state.selBlk = null; state.ttEdit = false;
      try { localStorage.setItem("syllabus-sview", state.sview); } catch (x) {}
      renderPlan();
    }
    else if (t.hasAttribute("data-pdur")) {
      var pd = t.getAttribute("data-pdur").split(":"), pidx = Number(pd[0]), pmin = Number(pd[1]);
      var pr0 = planResolved(planKey(0)).filter(function (x) { return x.i === pidx; })[0], pst = pr0 && pr0.start ? toMin(pr0.start) : nextFree(pidx);
      if (pst + pmin > 1439) pst = Math.max(0, 1439 - pmin);
      setBlock(pidx, fromMin(pst), fromMin(Math.min(1439, pst + pmin)));
    }
    else if (t.hasAttribute("data-pclear")) {
      var ci = Number(t.getAttribute("data-pclear")), cr = cloneItems(planKey(0)); state.selBlk = null;
      if (cr[ci]) { clearPlace(cr[ci], null); savePlan(cr); }
    }
    else if (t.hasAttribute("data-mauto")) {
      var am = autoPlaceOpen();
      if (am.placed < am.total) toast(am.placed ? "Scheduled " + am.placed + ". The rest would run past midnight." : "No room left today for more blocks.");
    }
    else if (t.hasAttribute("data-mresched") || t.hasAttribute("data-mreschedall")) {
      var nowM = nowMinutes(), rawM = cloneItems(planKey(0));
      var list = planResolved(planKey(0)).filter(function (r) { return !r.done && r.start && r.end && toMin(r.end) <= nowM; }).sort(function (a, b) { return toMin(a.start) - toMin(b.start); });
      if (t.hasAttribute("data-mresched")) { var one = Number(t.getAttribute("data-mresched")); list = list.filter(function (r) { return r.i === one; }); }
      var cur2 = nextFree(-1), moved2 = 0;
      list.forEach(function (r) {
        var L = toMin(r.end) - toMin(r.start);
        if (cur2 + L > 1439) return;
        delete rawM[r.i].blks; rawM[r.i].start = fromMin(cur2); rawM[r.i].end = fromMin(cur2 + L); cur2 += L; moved2++;
      });
      if (moved2) { state.selBlk = null; savePlan(rawM); }
      if (moved2 < list.length) toast(moved2 ? "Moved " + moved2 + ". The rest would run past midnight." : "No room left today.");
    }
    else if (t.hasAttribute("data-ttedit")) { state.ttEdit = !state.ttEdit; state.ttEditMode = modeOf(planKey(0)); renderPlan(); }
    else if (t.hasAttribute("data-ttmode")) { state.ttEditMode = t.getAttribute("data-ttmode"); state.ttSure = ""; renderPlan(); }
    else if (t.hasAttribute("data-ttadd")) {
      var al = ttFor(state.ttEditMode), last = al.length ? toMin(al[al.length - 1].end) : 420, ae = Math.min(1439, last + 90);
      if (last >= 1439 - 15) { toast("There is no room after the last block."); return; }
      al.push({ id: "b" + Date.now().toString(36), name: "SB", start: fromMin(last), end: fromMin(ae), kind: "study" });
      saveTT(state.ttEditMode, al);
    }
    else if (t.hasAttribute("data-ttdel")) {
      var did = t.getAttribute("data-ttdel");
      saveTT(state.ttEditMode, ttFor(state.ttEditMode).filter(function (b) { return b.id !== did; }));
    }
    else if (t.hasAttribute("data-ttreset")) { if (DEFAULT_TT[state.ttEditMode]) saveTT(state.ttEditMode, ttClone(DEFAULT_TT[state.ttEditMode])); }
    else if (t.hasAttribute("data-ttnew")) {
      var tbs = ttTables(), nid = "t" + Date.now().toString(36);
      tbs.push({ id: nid, name: "Timetable " + (tbs.length + 1), blocks: ttClone(ttFor(state.ttEditMode)) });
      state.ttEditMode = nid; saveTables(tbs);
    }
    else if (t.hasAttribute("data-ttrm")) {
      var tbs2 = ttTables(); if (tbs2.length <= 1) return;
      if (state.ttSure !== state.ttEditMode) { state.ttSure = state.ttEditMode; renderPlan(); return; }
      state.ttSure = "";
      var rid = state.ttEditMode; tbs2 = tbs2.filter(function (x) { return x.id !== rid; });
      state.ttEditMode = tbs2[0].id; saveTables(tbs2);
    }
    else if (t.hasAttribute("data-pick")) { if (e.target.closest(".tick,.heat,select")) return; var pk = Number(t.getAttribute("data-pick")); state.placeIdx = state.placeIdx === pk ? null : pk; state.selBlk = null; renderPlan(); }
    else if (t.hasAttribute("data-selclose")) { state.selBlk = null; state.placeIdx = null; renderPlan(); }
    else if (t.hasAttribute("data-planadd")) { if (state.pAdd.ch && state.pAdd.src) { var pick1 = { ch: state.pAdd.ch, src: state.pAdd.src }; state.pAdd = { sub: "", ch: "", src: "" }; planAdd([pick1]); } }
    else if (t.hasAttribute("data-sugadd")) { var sx = state.sugg[Number(t.getAttribute("data-sugadd"))]; if (sx) planAdd([sx]); }
    else if (t.hasAttribute("data-sugall")) planAdd(state.sugg);
    else if (t.hasAttribute("data-mgrsub")) { state.active = t.getAttribute("data-mgrsub"); state.mgr = true; state.srcSure = ""; setView("tracker"); render(); }
    else if (t.hasAttribute("data-carry")) { carryUnfinishedToTomorrow(); }
    else if (t.hasAttribute("data-testrm")) {
      var rid = t.getAttribute("data-testrm");
      mutateTest(function (c) { c.chapters = (c.chapters || []).filter(function (i) { return i !== rid; }); });
    }
  });
  document.addEventListener("change", function (e) {
    var t = e.target;
    if (t.hasAttribute && t.hasAttribute("data-modesel")) { setMode(t.value); return; }
    if (t.hasAttribute && t.hasAttribute("data-habit")) {
      if (needDb()) return;
      var hf = t.getAttribute("data-habit"), hKey = planKey(state.schedDay === 1 ? 1 : 0);
      var hRec = Object.assign({}, state.plans[hKey] || {}, { items: planRaw(hKey) });
      var hh = Object.assign({}, hRec.habit || {});
      if (hf === "studyHrs") hh.studyMins = Math.max(0, Math.round((Number(t.value) || 0) * 60));
      else if (hf === "sleep") hh.sleep = t.value === "" ? "" : Number(t.value);
      else hh[hf] = t.value;
      hRec.habit = hh;
      state.plans[hKey] = hRec; renderPlan();
      queued("p:" + hKey, function () { return db.doc("plans/" + hKey).set(hRec); });
      return;
    }
    if (t.hasAttribute && t.hasAttribute("data-wake")) {
      if (needDb() || !TIME_RE.test(t.value || "")) return;
      var kw = planKey(0), rw = Object.assign({}, state.plans[kw] || {}, { items: planRaw(kw), wake: t.value });
      delete rw.shiftFrom;
      state.plans[kw] = rw; renderPlan();
      queued("p:" + kw, function () { return db.doc("plans/" + kw).set(rw); });
      return;
    }
    if (t.hasAttribute && (t.hasAttribute("data-blklen") || t.hasAttribute("data-brklen"))) {
      if (needDb()) return;
      var curTT = Object.assign({}, state.tt || { tables: ttTables() });
      if (t.hasAttribute("data-blklen")) curTT.blkLen = Number(t.value) || 75;
      if (t.hasAttribute("data-brklen")) curTT.brkLen = Number(t.value);
      state.tt = curTT; renderPlan();
      queued("tt", function () { return db.doc("settings/timetable").set(curTT); });
      return;
    }
    if (t.hasAttribute && t.hasAttribute("data-ttname")) {
      var nm = t.value.trim().slice(0, 24);
      if (!nm) { toast("A timetable needs a name."); renderPlan(); return; }
      var tb3 = ttTables(); tb3.forEach(function (x) { if (x.id === state.ttEditMode) x.name = nm; });
      saveTables(tb3, true); return;
    }
    if (t.hasAttribute && t.hasAttribute("data-ttf")) {
      var tf = t.getAttribute("data-ttf"), tid = t.getAttribute("data-ttid"), tm = state.ttEditMode, tl = ttFor(tm), tb = null;
      tl.forEach(function (b) { if (b.id === tid) tb = b; });
      if (!tb) return;
      var tv = t.value;
      if (tf === "name") { tv = tv.trim().slice(0, 40); if (!tv) { toast("A block needs a name."); renderPlan(); return; } tb.name = tv; tb.kind = inferKind(tv); }
      else if (tf === "kind") tb.kind = tv;
      else {
        var ns = tf === "start" ? tv : tb.start, ne = tf === "end" ? tv : tb.end;
        if (!TIME_RE.test(ns) || !TIME_RE.test(ne) || toMin(ne) <= toMin(ns)) { toast("The end has to be after the start."); renderPlan(); return; }
        tb.start = ns; tb.end = ne;
      }
      saveTTQuiet(tm, tl); return;
    }
    if (t.id === "planSub") { state.pAdd = { sub: t.value, ch: "", src: "" }; renderPlan(); return; }
    if (t.id === "planCh") { state.pAdd.ch = t.value; state.pAdd.src = ""; renderPlan(); return; }
    if (t.id === "planSrc") { state.pAdd.src = t.value; renderPlan(); return; }
    if (t.id === "tpSelect") { state.testId = t.value; state.confirmDel = false; saveActive(); renderTest(); }
    else if (t.id === "tpName") {
      var v = t.value.trim().slice(0, 60);
      if (!v) { toast("A test needs a name."); renderTest(); return; }
      mutateTest(function (c) { c.name = v; });
    }
    else if (t.id === "tpDate") {
      if (DATE_RE.test(t.value)) mutateTest(function (c) { c.date = t.value; }); else renderTest();
    }
    else if (t.hasAttribute && t.hasAttribute("data-testch")) {
      var id = t.getAttribute("data-testch"), on = t.checked;
      mutateTest(function (c) {
        var set = chapterSet(c);
        if (on) set[id] = 1; else delete set[id];
        c.chapters = Object.keys(set);
      });
    }
  });
  $("viewTest").addEventListener("submit", function (e) {
    if (e.target.id === "tpNewForm") { e.preventDefault(); newTest($("npName").value, $("npDate").value); }
  });
  window.addEventListener("hashchange", applyHash);
  document.addEventListener("keydown", function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var tag = e.target && e.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (e.key === "1") setView("plan");
    else if (e.key === "2") setView("schedule");
    else if (e.key === "3") setView("tracker");
    else if (e.key === "4") setView("test");
    else if (e.key === "/") {
      e.preventDefault();
      if (state.view !== "tracker") setView("tracker");
      var cs = $("chSearch"); if (cs) { cs.focus(); cs.select(); }
    }
  });

  render();
  applyHash();
  setInterval(function () { renderToday(); renderDeadline(); renderTest(); renderPlan(); }, 60000);

  var timer = setTimeout(function () {
    if (!(state.gotS && state.gotC)) { state.slow = true; renderGrid(); }
  }, 10000);
  function onErr(e) { state.err = "Reason: " + ((e && e.code) || "unknown") + "."; render(); }
  function loaded() {
    if (state.gotS && state.gotC) { clearTimeout(timer); state.slow = false; }
    render();
  }

  function createLocalDb() {
    var LS_KEY = "seneca-db-v3", mem = null, colSubs = {}, docSubs = {};
    function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
    function isPlain(v) { return v && typeof v === "object" && !Array.isArray(v); }
    function merge(dst, src) {
      var out = clone(dst || {});
      Object.keys(src || {}).forEach(function (k) {
        if (isPlain(src[k]) && isPlain(out[k])) out[k] = merge(out[k], src[k]);
        else out[k] = clone(src[k]);
      });
      return out;
    }
    function readEmbedded() {
      try {
        var el = document.getElementById("seneca-data");
        if (el && el.textContent.trim()) return JSON.parse(el.textContent);
      } catch (e) {}
      return null;
    }
    function seedStore() {
      return readEmbedded() || { subjects: {}, chapters: {}, settings: {}, tests: {}, plans: {}, savedAt: 0 };
    }
    function load() {
      if (mem) return mem;
      var emb = readEmbedded(), ls = null;
      try {
        var raw = localStorage.getItem(LS_KEY);
        if (raw) ls = JSON.parse(raw);
      } catch (e) {}
      if (ls && emb) mem = (ls.savedAt || 0) >= (emb.savedAt || 0) ? ls : emb;
      else mem = ls || emb || seedStore();
      if (mem && mem.subjects && mem.subjects.biology && !mem.subjects.botany) {
        var ZOO = { "Animal Kingdom": 1, "Structural Organisation in Animals": 1, "Biomolecules": 1, "Breathing": 1, "Circulation": 1, "Excretion": 1, "Locomotion & Movement": 1, "Neural System": 1, "Endocrine System": 1, "Human Reproduction": 1, "Reproductive Health": 1, "Evolution": 1, "Human Health & Disease": 1, "Biotech 1": 1, "Biotech 2": 1 };
        mem.subjects.botany = clone(mem.subjects.biology);
        mem.subjects.zoology = clone(mem.subjects.biology);
        delete mem.subjects.biology;
        var bo = 0, zo = 0;
        Object.keys(mem.chapters || {}).forEach(function (k) {
          var ch = mem.chapters[k];
          if (ch && ch.subject === "biology") {
            if (ZOO[ch.name]) { ch.subject = "zoology"; ch.order = ++zo; }
            else { ch.subject = "botany"; ch.order = ++bo; }
          }
        });
        try { localStorage.setItem(LS_KEY, JSON.stringify(mem)); } catch (e) {}
      }
      return mem;
    }
    var fileHandle = null, writeTimer = null, writing = false, writeQueued = false;
    function idbHandle(op, val) {
      return new Promise(function (resolve) {
        if (!window.indexedDB) { resolve(null); return; }
        try {
          var req = indexedDB.open("seneca-fs", 1);
          req.onupgradeneeded = function () { req.result.createObjectStore("h"); };
          req.onerror = function () { resolve(null); };
          req.onsuccess = function () {
            var d = req.result, tx = d.transaction("h", op === "set" ? "readwrite" : "readonly"), st = tx.objectStore("h");
            var r = op === "set" ? st.put(val, "html") : st.get("html");
            r.onsuccess = function () { resolve(r.result || null); };
            r.onerror = function () { resolve(null); };
          };
        } catch (e) { resolve(null); }
      });
    }
    function buildSelfHtml() {
      var s = load();
      var el = document.getElementById("seneca-data");
      if (el) el.textContent = JSON.stringify(s).replace(/<\//g, "<\\/");
      if (window.__senBlobsSync) window.__senBlobsSync();
      var clone = document.documentElement.cloneNode(true);
      var t = clone.querySelector("#toast");
      if (t) t.hidden = true;
      return "<!doctype html>\n" + clone.outerHTML;
    }
    function flushFileWrite() {
      if (!fileHandle) return;
      if (writing) { writeQueued = true; return; }
      writing = true; writeQueued = false;
      var out = buildSelfHtml();
      fileHandle.createWritable().then(function (w) {
        return w.write(out).then(function () { return w.close(); });
      }).then(function () {
        var b = document.getElementById("saveHtmlBtn");
        if (b) b.textContent = "Auto-saved";
      }).catch(function () {
        // Permission may need re-confirmation after reload
      }).finally(function () {
        writing = false;
        if (writeQueued) flushFileWrite();
      });
    }
    function scheduleFileAutoSave() {
      if (!fileHandle) return;
      clearTimeout(writeTimer);
      writeTimer = setTimeout(flushFileWrite, 350);
    }
    function save(s) {
      s.savedAt = Date.now();
      mem = s;
      try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch (e) {}
      try {
        var el = document.getElementById("seneca-data");
        if (el) el.textContent = JSON.stringify(s).replace(/<\//g, "<\\/");
      } catch (e) {}
      scheduleFileAutoSave();
      if (window.__senScheduleGistPush) window.__senScheduleGistPush();
      if (window.__senScheduleSupaPush) window.__senScheduleSupaPush();
    }
    function updateSyncLabel(txt) {
      var st = document.getElementById("syncLinkState");
      if (st) st.textContent = txt;
      var mb = document.getElementById("syncMenuBtn");
      if (mb && txt === "Auto-saved") mb.textContent = "Synced ▾";
    }
    if (window.showSaveFilePicker) {
      idbHandle("get").then(function (h) {
        if (!h) return;
        fileHandle = h;
        updateSyncLabel("Linked");
      });
    }
    var syncMenuBtn = document.getElementById("syncMenuBtn"), syncMenu = document.getElementById("syncMenu");
    function closeSyncMenu() { if (syncMenu) syncMenu.hidden = true; if (syncMenuBtn) syncMenuBtn.setAttribute("aria-expanded", "false"); }
    if (syncMenuBtn && syncMenu) {
      syncMenuBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        var open = syncMenu.hidden;
        syncMenu.hidden = !open;
        syncMenuBtn.setAttribute("aria-expanded", String(open));
      });
      document.addEventListener("click", function (e) {
        if (!syncMenu.hidden && !e.target.closest(".sync-wrap")) closeSyncMenu();
      });
    }
    var saveBtn = document.getElementById("saveHtmlBtn");
    function linkCloudFile() {
      if (!window.showSaveFilePicker) { toast("Auto-save linking requires Chrome/Edge/Brave. Use Download snapshot instead."); return; }
      (fileHandle ? fileHandle.requestPermission({ mode: "readwrite" }).then(function (p) { return p === "granted" ? fileHandle : null; }) : Promise.resolve(null))
        .then(function (h) {
          if (h) return h;
          return window.showSaveFilePicker({
            suggestedName: "Seneca.html",
            types: [{ description: "HTML File", accept: { "text/html": [".html"] } }]
          });
        }).then(function (h) {
          if (!h) return;
          fileHandle = h;
          idbHandle("set", h);
          flushFileWrite();
          updateSyncLabel("Linked");
          toast("Linked. All future changes auto-save to this file.");
        }).catch(function () {});
    }
    if (saveBtn) {
      if (!window.showSaveFilePicker) saveBtn.hidden = true;
      saveBtn.addEventListener("click", function () { closeSyncMenu(); linkCloudFile(); });
    }
    var syncNowBtn = document.getElementById("syncNowBtn");
    if (syncNowBtn) {
      syncNowBtn.addEventListener("click", function () {
        closeSyncMenu();
        if (fileHandle) { flushFileWrite(); updateSyncLabel("Auto-saved"); toast("Synced to linked file."); }
        else linkCloudFile();
      });
    }
    var syncExportBtn = document.getElementById("syncExportBtn");
    if (syncExportBtn) {
      syncExportBtn.addEventListener("click", function () {
        closeSyncMenu();
        var html = buildSelfHtml();
        var blob = new Blob([html], { type: "text/html;charset=utf-8" });
        var a = document.createElement("a");
        var d = new Date().toISOString().slice(0, 10);
        a.href = URL.createObjectURL(blob);
        a.download = "Seneca-" + d + ".html";
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
        toast("Snapshot downloaded.");
      });
    }
    var syncImportBtn = document.getElementById("syncImportBtn"), syncImportFile = document.getElementById("syncImportFile");
    if (syncImportBtn && syncImportFile) {
      syncImportBtn.addEventListener("click", function () { closeSyncMenu(); syncImportFile.click(); });
      syncImportFile.addEventListener("change", function () {
        var f = syncImportFile.files && syncImportFile.files[0]; if (!f) return;
        var rd = new FileReader();
        rd.onload = function () {
          try {
            var raw = String(rd.result || ""), parsed = null;
            if (/\.json$/i.test(f.name)) {
              parsed = JSON.parse(raw);
            } else {
              var doc = new DOMParser().parseFromString(raw, "text/html");
              var el = doc.getElementById("seneca-data");
              if (el && el.textContent) parsed = JSON.parse(el.textContent);
            }
            if (!parsed || typeof parsed !== "object" || !parsed.chapters) { toast("Could not find Seneca progress data in that file."); return; }
            save(parsed);
            toast("Progress imported. Reloading…");
            setTimeout(function () { location.reload(); }, 500);
          } catch (err) {
            toast("Import failed: invalid file format.");
          }
        };
        rd.readAsText(f);
        syncImportFile.value = "";
      });
    }
    var GIST_KEY = "seneca-gist-cfg", GIST_FILE = "seneca-progress.json", gistTimer = null, gistBusy = false;
    function getGistCfg() {
      try { return JSON.parse(localStorage.getItem(GIST_KEY) || "null"); } catch (e) { return null; }
    }
    function setGistCfg(cfg) {
      try { localStorage.setItem(GIST_KEY, JSON.stringify(cfg)); } catch (e) {}
      refreshGistUI();
    }
    function refreshGistUI() {
      var cfg = getGistCfg(), st = document.getElementById("syncGistState"), mb = document.getElementById("syncMenuBtn");
      if (cfg && cfg.token && cfg.gistId) {
        if (st) st.textContent = cfg.lastSyncAt ? "Synced" : "Ready";
        if (mb) mb.textContent = "Sync ✓ ▾";
      } else {
        if (st) st.textContent = "Not set";
        if (mb) mb.textContent = "Sync ▾";
      }
    }
    function gistHeaders(token) {
      return { "Authorization": "Bearer " + token, "Accept": "application/vnd.github+json", "Content-Type": "application/json" };
    }
    function gistSync(mode) {
      var cfg = getGistCfg();
      if (!cfg || !cfg.token || !cfg.gistId) {
        if (mode === "manual") openGistModal();
        return Promise.resolve();
      }
      if (gistBusy) return Promise.resolve();
      gistBusy = true;
      var st = document.getElementById("syncGistState");
      if (st) st.textContent = "Syncing…";
      return fetch("https://api.github.com/gists/" + encodeURIComponent(cfg.gistId), { headers: gistHeaders(cfg.token) })
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then(function (g) {
          var f = g.files && g.files[GIST_FILE];
          if (!f) return null;
          if (f.truncated && f.raw_url) return fetch(f.raw_url).then(function (r) { return r.text(); });
          return f.content || "";
        })
        .then(function (raw) {
          var local = load(), localTs = Number(local.savedAt || 0);
          var remote = null, remoteTs = 0;
          if (raw) {
            try { remote = JSON.parse(raw); remoteTs = Number((remote && remote.savedAt) || 0); } catch (e) {}
          }
          if (remote && remote.chapters && remoteTs > localTs + 2000) {
            save(remote);
            cfg.lastSyncAt = Date.now();
            setGistCfg(cfg);
            toast("Pulled newer progress from GitHub Gist. Reloading…");
            setTimeout(function () { location.reload(); }, 450);
            return;
          }
          if (!remote || localTs > remoteTs + 2000 || mode === "push") {
            var payload = { files: {} };
            payload.files[GIST_FILE] = { content: JSON.stringify(local) };
            return fetch("https://api.github.com/gists/" + encodeURIComponent(cfg.gistId), {
              method: "PATCH",
              headers: gistHeaders(cfg.token),
              body: JSON.stringify(payload)
            }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
              .then(function () {
                cfg.lastSyncAt = Date.now();
                setGistCfg(cfg);
                if (mode === "manual") toast("Synced progress to GitHub Gist.");
              });
          }
          cfg.lastSyncAt = Date.now();
          setGistCfg(cfg);
          if (mode === "manual") toast("Already up to date with GitHub Gist.");
        })
        .catch(function (err) {
          if (st) st.textContent = "Error";
          if (mode === "manual") toast("Gist sync failed: " + (err && err.message ? err.message : "check token/ID"));
        })
        .finally(function () { gistBusy = false; });
    }
    window.__senScheduleGistPush = function () {
      var cfg = getGistCfg();
      if (!cfg || !cfg.token || !cfg.gistId) return;
      clearTimeout(gistTimer);
      gistTimer = setTimeout(function () { gistSync("push"); }, 4500);
    };
    function openGistModal() {
      var host = document.getElementById("gistModalHost");
      if (!host) {
        host = document.createElement("div");
        host.id = "gistModalHost";
        host.className = "revq-backdrop";
        host.hidden = true;
        host.innerHTML = '<div class="revq-dialog" role="dialog" aria-modal="true" aria-label="GitHub Gist Sync">' +
          '<div class="revq-head"><h3>Anki-Style Cloud Sync (GitHub Gist)</h3><button type="button" class="mini-btn" id="gistCloseBtn">Close</button></div>' +
          '<div class="revq-body"><form class="gist-form" id="gistForm">' +
          '<p class="gist-note">Your token stays only in this app (never exported in HTML snapshots). Paste a GitHub token with <b>gist</b> scope below and click <b>Create private Gist</b> (or leave Gist ID blank and click <b>Save &amp; Sync</b>).</p>' +
          '<label>GitHub Personal Access Token<input type="password" id="gistTokenIn" placeholder="ghp_... or github_pat_..." autocomplete="off"></label>' +
          '<label>Private Gist ID (leave blank to create one automatically)<input type="text" id="gistIdIn" placeholder="e.g. a1b2c3d4e5f6..."></label>' +
          '<div class="gist-status" id="gistStatus" hidden></div>' +
          '<div class="gist-actions">' +
          '<button type="submit" class="pill main">Save &amp; Sync</button>' +
          '<button type="button" class="pill" id="gistCreateBtn">Create private Gist</button>' +
          '<button type="button" class="pill" id="gistClearBtn">Disconnect</button>' +
          '</div></form></div></div>';
        document.body.appendChild(host);
        function setStatus(msg, isErr) {
          var el = host.querySelector("#gistStatus");
          if (!el) return;
          el.textContent = msg;
          el.classList.toggle("err", !!isErr);
          el.hidden = !msg;
        }
        function createNewGist(tok) {
          if (!tok) { setStatus("Paste your GitHub token first.", true); return; }
          var btn = host.querySelector("#gistCreateBtn");
          if (btn) btn.disabled = true;
          setStatus("Creating private Gist…", false);
          var payload = { description: "Seneca Study Progress", public: false, files: {} };
          payload.files[GIST_FILE] = { content: JSON.stringify(load()) };
          fetch("https://api.github.com/gists", { method: "POST", headers: gistHeaders(tok), body: JSON.stringify(payload) })
            .then(function (r) {
              return r.text().then(function (txt) {
                var data = null; try { data = JSON.parse(txt); } catch (e) {}
                if (!r.ok) throw new Error((data && data.message) ? data.message : ("HTTP " + r.status));
                return data;
              });
            })
            .then(function (g) {
              host.querySelector("#gistIdIn").value = g.id;
              setGistCfg({ token: tok, gistId: g.id, lastSyncAt: Date.now() });
              setStatus("Created Gist " + g.id + " and synced!", false);
              toast("Created private Gist and synced!");
              setTimeout(function () { host.hidden = true; }, 900);
            })
            .catch(function (err) {
              var msg = (err && err.message) ? err.message : "Network/CORS blocked";
              setStatus("Could not create Gist: " + msg, true);
              toast("Could not create Gist: " + msg);
            })
            .finally(function () { if (btn) btn.disabled = false; });
        }
        host.querySelector("#gistCloseBtn").addEventListener("click", function () { host.hidden = true; });
        host.querySelector("#gistClearBtn").addEventListener("click", function () {
          try { localStorage.removeItem(GIST_KEY); } catch (e) {}
          refreshGistUI();
          host.hidden = true;
          toast("Disconnected GitHub Gist sync.");
        });
        host.querySelector("#gistCreateBtn").addEventListener("click", function () {
          createNewGist((host.querySelector("#gistTokenIn").value || "").trim());
        });
        host.querySelector("#gistForm").addEventListener("submit", function (e) {
          e.preventDefault();
          var tok = (host.querySelector("#gistTokenIn").value || "").trim();
          var gid = (host.querySelector("#gistIdIn").value || "").trim();
          if (!tok) { setStatus("Paste your GitHub token first.", true); return; }
          if (!gid) { createNewGist(tok); return; }
          setGistCfg({ token: tok, gistId: gid, lastSyncAt: 0 });
          host.hidden = true;
          gistSync("manual");
        });
      }
      var curCfg = getGistCfg() || {};
      host.querySelector("#gistTokenIn").value = curCfg.token || "";
      host.querySelector("#gistIdIn").value = curCfg.gistId || "";
      var stEl = host.querySelector("#gistStatus"); if (stEl) stEl.hidden = true;
      host.hidden = false;
    }
    var gNowBtn = document.getElementById("syncGistNowBtn"), gCfgBtn = document.getElementById("syncGistCfgBtn");
    if (gNowBtn) gNowBtn.addEventListener("click", function () { closeSyncMenu(); gistSync("manual"); });
    if (gCfgBtn) gCfgBtn.addEventListener("click", function () { closeSyncMenu(); openGistModal(); });
    refreshGistUI();
    setTimeout(function () { gistSync("auto"); }, 1200);

    /* ---- Supabase Anki-style Cloud Sync ---- */
    var SUPA_KEY = "seneca-supa-cfg", supaTimer = null, supaBusy = false;
    function getSupaCfg() { try { return JSON.parse(localStorage.getItem(SUPA_KEY) || "null"); } catch (e) { return null; } }
    function setSupaCfg(c) {
      try { if (c) localStorage.setItem(SUPA_KEY, JSON.stringify(c)); else localStorage.removeItem(SUPA_KEY); } catch (e) {}
      refreshSupaUI();
    }
    function refreshSupaUI() {
      var c = getSupaCfg(), st = document.getElementById("syncSupaState"), mb = document.getElementById("syncMenuBtn");
      if (c && c.accessToken && c.userId) {
        if (st) st.textContent = c.email ? c.email.split("@")[0] : "Signed in";
        if (mb) mb.textContent = "Sync ✓ ▾";
      } else {
        if (st) st.textContent = "Sign in";
      }
    }
    function supaHeaders(c, extra) {
      var h = { "apikey": c.anonKey, "Content-Type": "application/json" };
      if (c.accessToken) h["Authorization"] = "Bearer " + c.accessToken;
      if (extra) Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
      return h;
    }
    function supaRefreshToken(c) {
      if (!c || !c.refreshToken) return Promise.reject(new Error("Session expired; please sign in again."));
      return fetch(c.url + "/auth/v1/token?grant_type=refresh_token", {
        method: "POST",
        headers: { "apikey": c.anonKey, "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: c.refreshToken })
      }).then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.msg || d.error_description || "Auth failed"); return d; }); })
        .then(function (d) {
          c.accessToken = d.access_token;
          c.refreshToken = d.refresh_token || c.refreshToken;
          c.userId = (d.user && d.user.id) || c.userId;
          setSupaCfg(c);
          return c;
        });
    }
    function supaSync(mode) {
      var c = getSupaCfg();
      if (!c || !c.url || !c.anonKey || !c.accessToken || !c.userId) {
        if (mode === "manual") openSupaModal();
        return Promise.resolve();
      }
      if (supaBusy) return Promise.resolve();
      supaBusy = true;
      var st = document.getElementById("syncSupaState");
      if (st) st.textContent = "Syncing…";
      function run(cfg) {
        var qUrl = cfg.url + "/rest/v1/seneca_state?user_id=eq." + encodeURIComponent(cfg.userId) + "&select=data,updated_at";
        return fetch(qUrl, { headers: supaHeaders(cfg) })
          .then(function (r) {
            if (r.status === 401) return supaRefreshToken(cfg).then(function (nc) {
              return fetch(nc.url + "/rest/v1/seneca_state?user_id=eq." + encodeURIComponent(nc.userId) + "&select=data,updated_at", { headers: supaHeaders(nc) });
            });
            return r;
          })
          .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
          .then(function (rows) {
            var row = Array.isArray(rows) && rows[0] ? rows[0] : null;
            var local = load(), localTs = Number(local.savedAt || 0);
            var remote = row && row.data ? row.data : null;
            var remoteTs = Number((remote && remote.savedAt) || (row && row.updated_at) || 0);
            if (remote && remote.chapters && remoteTs > localTs + 2000 && mode !== "push") {
              save(remote);
              refreshSupaUI();
              toast("Pulled newer progress from Supabase. Reloading…");
              setTimeout(function () { location.reload(); }, 450);
              return;
            }
            if (!remote || localTs > remoteTs + 2000 || mode === "push") {
              return fetch(cfg.url + "/rest/v1/seneca_state", {
                method: "POST",
                headers: supaHeaders(cfg, { "Prefer": "resolution=merge-duplicates" }),
                body: JSON.stringify({ user_id: cfg.userId, data: local, updated_at: localTs || Date.now() })
              }).then(function (r) { if (!r.ok) throw new Error("Save HTTP " + r.status); })
                .then(function () {
                  refreshSupaUI();
                  if (mode === "manual") toast("Synced progress to Supabase.");
                });
            }
            refreshSupaUI();
            if (mode === "manual") toast("Already up to date with Supabase.");
          });
      }
      return run(c)
        .catch(function (err) {
          if (st) st.textContent = "Error";
          if (mode === "manual") toast("Supabase sync failed: " + (err && err.message ? err.message : "check setup"));
        })
        .finally(function () { supaBusy = false; });
    }
    window.__senScheduleSupaPush = function () {
      var c = getSupaCfg();
      if (!c || !c.accessToken || !c.userId) return;
      clearTimeout(supaTimer);
      supaTimer = setTimeout(function () { supaSync("push"); }, 4000);
    };
    function openSupaModal() {
      var host = document.getElementById("supaModalHost");
      if (!host) {
        host = document.createElement("div");
        host.id = "supaModalHost";
        host.className = "revq-backdrop";
        host.hidden = true;
        host.innerHTML = '<div class="revq-dialog" role="dialog" aria-modal="true" aria-label="Supabase Cloud Sync">' +
          '<div class="revq-head"><h3>Supabase Cloud Account (Anki-Style)</h3><button type="button" class="mini-btn" id="supaCloseBtn">Close</button></div>' +
          '<div class="revq-body"><form class="gist-form" id="supaForm">' +
          '<p class="gist-note">Enter your Supabase Project URL and Anon Key once, then sign up or sign in with your email and password.</p>' +
          '<label>Project URL<input type="url" id="supaUrlIn" placeholder="https://your-project.supabase.co" autocomplete="off"></label>' +
          '<label>Anon Public Key<input type="password" id="supaKeyIn" placeholder="eyJhbGciOi..." autocomplete="off"></label>' +
          '<label>Email<input type="email" id="supaEmailIn" placeholder="you@example.com" autocomplete="email"></label>' +
          '<label>Password<input type="password" id="supaPassIn" placeholder="At least 6 characters" autocomplete="current-password"></label>' +
          '<div class="gist-status" id="supaStatus" hidden></div>' +
          '<div class="gist-actions">' +
          '<button type="submit" class="pill main" id="supaLoginBtn">Sign in &amp; Sync</button>' +
          '<button type="button" class="pill" id="supaSignupBtn">Create account</button>' +
          '<button type="button" class="pill" id="supaOutBtn">Sign out</button>' +
          '</div></form></div></div>';
        document.body.appendChild(host);
        function setSupaSt(msg, isErr) {
          var el = host.querySelector("#supaStatus");
          el.textContent = msg; el.classList.toggle("err", !!isErr); el.hidden = !msg;
        }
        function doAuth(endpoint) {
          var url = (host.querySelector("#supaUrlIn").value || "").trim().replace(/\/+$/, "");
          var key = (host.querySelector("#supaKeyIn").value || "").trim();
          var email = (host.querySelector("#supaEmailIn").value || "").trim();
          var pass = host.querySelector("#supaPassIn").value || "";
          if (!url || !key || !email || !pass) { setSupaSt("Fill in Project URL, Anon Key, Email, and Password.", true); return; }
          setSupaSt("Connecting…", false);
          fetch(url + endpoint, {
            method: "POST",
            headers: { "apikey": key, "Content-Type": "application/json" },
            body: JSON.stringify({ email: email, password: pass })
          }).then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.msg || d.error_description || d.message || ("HTTP " + r.status)); return d; }); })
            .then(function (d) {
              var tok = d.access_token, uid = (d.user && d.user.id);
              if (!tok || !uid) { setSupaSt("Account created! Check your email to confirm, then click Sign in & Sync.", false); return; }
              setSupaCfg({ url: url, anonKey: key, email: email, userId: uid, accessToken: tok, refreshToken: d.refresh_token || "" });
              setSupaSt("Signed in! Syncing…", false);
              supaSync("manual").then(function () { host.hidden = true; });
            })
            .catch(function (err) { setSupaSt(err && err.message ? err.message : "Auth failed", true); });
        }
        host.querySelector("#supaCloseBtn").addEventListener("click", function () { host.hidden = true; });
        host.querySelector("#supaSignupBtn").addEventListener("click", function () { doAuth("/auth/v1/signup"); });
        host.querySelector("#supaForm").addEventListener("submit", function (e) { e.preventDefault(); doAuth("/auth/v1/token?grant_type=password"); });
        host.querySelector("#supaOutBtn").addEventListener("click", function () {
          var cur = getSupaCfg();
          setSupaCfg(cur ? { url: cur.url, anonKey: cur.anonKey, email: cur.email || "" } : null);
          host.hidden = true;
          toast("Signed out of Supabase.");
        });
      }
      var c = getSupaCfg() || {};
      host.querySelector("#supaUrlIn").value = c.url || "";
      host.querySelector("#supaKeyIn").value = c.anonKey || "";
      host.querySelector("#supaEmailIn").value = c.email || "";
      host.querySelector("#supaPassIn").value = "";
      host.querySelector("#supaStatus").hidden = true;
      host.hidden = false;
    }
    var sNow = document.getElementById("syncSupaNowBtn"), sCfg = document.getElementById("syncSupaCfgBtn");
    if (sNow) sNow.addEventListener("click", function () { closeSyncMenu(); supaSync("manual"); });
    if (sCfg) sCfg.addEventListener("click", function () { closeSyncMenu(); openSupaModal(); });
    refreshSupaUI();
    setTimeout(function () { supaSync("auto"); }, 1400);
    function emitCol(col) {
      var s = load(), bag = s[col] || {};
      var docs = Object.keys(bag).map(function (id) {
        return { id: id, data: function () { return clone(bag[id]); } };
      });
      (colSubs[col] || []).forEach(function (fn) { fn({ docs: docs }); });
    }
    function emitDoc(path) {
      var p = path.split("/"), s = load(), d = (s[p[0]] && s[p[0]][p[1]]) || null;
      (docSubs[path] || []).forEach(function (fn) {
        fn({ exists: !!d, data: function () { return d ? clone(d) : null; } });
      });
    }
    function docRef(col, id) {
      var path = col + "/" + id;
      return {
        id: id,
        onSnapshot: function (fn) {
          (docSubs[path] = docSubs[path] || []).push(fn);
          emitDoc(path);
          return function () {};
        },
        set: function (data) {
          var s = load(); s[col] = s[col] || {};
          s[col][id] = clone(data);
          save(s); emitDoc(path); emitCol(col);
          return Promise.resolve();
        },
        update: function (patch) {
          var s = load(); s[col] = s[col] || {};
          s[col][id] = merge(s[col][id] || {}, patch);
          save(s); emitDoc(path); emitCol(col);
          return Promise.resolve();
        },
        delete: function () {
          var s = load();
          if (s[col]) delete s[col][id];
          save(s); emitDoc(path); emitCol(col);
          return Promise.resolve();
        }
      };
    }
    return {
      collection: function (col) {
        return {
          onSnapshot: function (fn) {
            (colSubs[col] = colSubs[col] || []).push(fn);
            emitCol(col);
            return function () {};
          },
          doc: function (id) {
            return docRef(col, id || ("id_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)));
          }
        };
      },
      doc: function (path) {
        var p = path.split("/");
        return docRef(p[0], p[1]);
      }
    };
  }

  /* ---- Question log, linked to chapters. The log itself is your original, unchanged; this only connects it to the syllabus. ---- */
  state.qlog = {}; state.qcards = {}; state.qlset = {};
  var QL_DAY = 864e5, QL_LET = ["A", "B", "C", "D"];
  var qlBlobs = null, qlBlobsDirty = false, qlSeeding = false, qlPrefsSeeded = false, qlGridTimer = null, qlFrameEl = null, qlSig = "";

  /* Images are large, so they live in their own embedded block, plus IndexedDB for anything added since the last export. */
  function qlEnsureBlobs() {
    if (qlBlobs) return qlBlobs;
    qlBlobs = {};
    var el = document.getElementById("seneca-blobs");
    try { if (el && el.textContent.trim()) qlBlobs = JSON.parse(el.textContent); } catch (e) {}
    return qlBlobs;
  }
  function qlIdb(mode, key, val) {
    return new Promise(function (res) {
      try {
        var r = indexedDB.open("seneca-img", 1);
        r.onupgradeneeded = function () { r.result.createObjectStore("b"); };
        r.onerror = function () { res(mode === "all" ? {} : undefined); };
        r.onsuccess = function () {
          var tx = r.result.transaction("b", mode === "all" ? "readonly" : "readwrite"), st = tx.objectStore("b");
          if (mode === "put") st.put(val, key); else if (mode === "del") st.delete(key);
          else { var out = {}, cur = st.openCursor(); cur.onsuccess = function () { var c = cur.result; if (c) { out[c.key] = c.value; c.continue(); } else res(out); }; return; }
          tx.oncomplete = function () { res(); };
        };
      } catch (e) { res(mode === "all" ? {} : undefined); }
    });
  }
  qlIdb("all").then(function (extra) {
    var ks = Object.keys(extra || {}); if (!ks.length) return;
    var b = qlEnsureBlobs(); ks.forEach(function (k) { if (!b[k]) { b[k] = extra[k]; qlBlobsDirty = true; } });
  });
  window.__senBlobsSync = function () {
    if (!qlBlobsDirty || !qlBlobs) return;
    var el = document.getElementById("seneca-blobs"); if (el) el.textContent = JSON.stringify(qlBlobs);
    qlBlobsDirty = false;
  };
  function qlRid() { return "id_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  /* Counts shown next to each chapter, using the log's own rules for what is due. */
  function qlDue(d) { var t = d.due != null ? d.due : (d.created || 0) + QL_DAY, x = new Date(t); x.setHours(0, 0, 0, 0); return x.getTime(); }
  function qlParseIdx(str, opts) {
    var t = String(str || "").trim(); if (!t) return -1;
    var low = t.toLowerCase();
    for (var i = 0; i < 4; i++) if (opts[i] && opts[i].toLowerCase() === low) return i;
    var m = /^(?:option\s*)?\(?\s*([A-Da-d1-4])\s*\)?\s*[.:]?$/i.exec(t) || /^\(\s*([A-Da-d1-4])\s*\)/.exec(t);
    if (!m) return -1;
    var c = m[1].toUpperCase(), k = "ABCD".indexOf(c);
    return k >= 0 ? k : parseInt(c, 10) - 1;
  }
  function qlOK(d) {
    var o = QL_LET.map(function (L) { return String(d["opt" + L] || "").trim(); }), has = o.map(function (t, i) { return !!t || !!d["img" + QL_LET[i]]; });
    if (has.filter(Boolean).length < 2) return false;
    var i = qlParseIdx(d.correct, o); return i >= 0 && has[i];
  }
  function qlIndex() {
    var m = {}, now = Date.now();
    function g(id) { return m[id] || (m[id] = { q: 0, f: 0, dq: 0, df: 0 }); }
    Object.keys(state.qlog).forEach(function (k) { var d = state.qlog[k], o = g(d.chapter); o.q++; if (qlDue(d) <= now && qlOK(d)) o.dq++; });
    Object.keys(state.qcards).forEach(function (k) { var d = state.qcards[k], o = g(d.chapter); o.f++; if ((d.fcDue != null ? d.fcDue : 0) <= now) o.df++; });
    return m;
  }
  function qlCell(id, kind, o) {
    var n = o ? (kind === "q" ? o.q : o.f) : 0, d = o ? (kind === "q" ? o.dq : o.df) : 0, nm = kind === "q" ? "questions" : "flashcards";
    return '<td class="qc"><button type="button" class="qcell' + (n ? '' : ' zero') + '" data-chsheet="' + esc(id) + '" data-qtab="' + kind + '" title="' + (n ? n + ' ' + nm : 'No ' + nm + ' yet, click to add') + (d ? ', ' + d + ' due' : '') + '" aria-label="' + (n || 'No') + ' ' + nm + (d ? ', ' + d + ' due' : '') + '">' + (n ? n : '+') + (d ? '<b class="qdue">' + d + '</b>' : '') + '</button></td>';
  }
  function qlBadge(o) {
    if (!o || (!o.q && !o.f)) return '<span class="chq none" aria-hidden="true">+ Q / F</span>';
    return '<span class="chq" title="' + o.q + ' questions, ' + o.f + ' flashcards">' + (o.q ? o.q + ' Q' : '') + (o.q && o.f ? ' · ' : '') + (o.f ? o.f + ' F' : '') + ((o.dq + o.df) ? ' <b>' + (o.dq + o.df) + ' due</b>' : '') + '</span>';
  }
  function qlChanged() { clearTimeout(qlGridTimer); qlGridTimer = setTimeout(function () { renderGrid(); }, 60); }

  /* The bridge the embedded log talks to. It reads and writes Seneca's own saved data, so everything is kept in this file. */
  var QL_COLS = { entries: "qlog", cards: "qcards", settings: "qlsettings" };
  window.__senQl = {
    cols: QL_COLS, mode: "chapter",
    rid: qlRid,
    db: { collection: function (n) { return db.collection(QL_COLS[n]); } },
    store: function (n) { return function () { return n === "entries" ? state.qlog : n === "cards" ? state.qcards : state.qlset; }; },
    blobs: qlEnsureBlobs,
    addBlob: function (id, url) { qlEnsureBlobs()[id] = url; qlBlobsDirty = true; qlIdb("put", id, url); },
    dropBlob: function (id) { var b = qlEnsureBlobs(); if (b[id]) { delete b[id]; qlBlobsDirty = true; qlIdb("del", id); } },
    subjects: function () {
      var by = { botany: [], zoology: [], chemistry: [], physics: [] };
      state.chapters.forEach(function (c) { if (by[c.subject]) by[c.subject].push(c); });
      function ch(a) { return a.sort(function (x, y) { return (x.order || 0) - (y.order || 0); }).map(function (c) { return { id: c.id, name: c.name }; }); }
      return [
        { id: "phy", name: "Physics", classes: [{ label: "Physics", short: "P", chapters: ch(by.physics) }] },
        { id: "chem", name: "Chemistry", classes: [{ label: "Chemistry", short: "C", chapters: ch(by.chemistry) }] },
        { id: "bio", name: "Biology", classes: [{ label: "Botany", short: "B", chapters: ch(by.botany) }, { label: "Zoology", short: "Z", chapters: ch(by.zoology) }] }
      ];
    },
    closed: function () { qlHide(); }
  };
  function qlHost() {
    var h = document.getElementById("qlHost");
    if (!h) {
      h = document.createElement("div"); h.id = "qlHost"; h.className = "qlhost"; h.hidden = true;
      h.innerHTML = '<div class="qlbar"><span id="qlTitle">Question log</span><button type="button" class="qlclose" id="qlCloseBtn">Close</button></div><iframe id="qlFrame" title="Question log"></iframe>';
      document.body.appendChild(h);
      h.querySelector("#qlCloseBtn").addEventListener("click", qlHide);
    }
    return h;
  }
  function qlHide() { var h = document.getElementById("qlHost"); if (h) h.hidden = true; document.body.classList.remove("ql-open"); }
  function qlShow(chId, tab) {
    var tpl = document.getElementById("seneca-qlapp");
    if (!tpl) { toast("The question log is not part of this file."); return; }
    var h = qlHost(), fr = h.querySelector("#qlFrame"), c = chId ? chById(chId) : null;
    var sig = state.chapters.map(function (x) { return x.id + x.name; }).join("|");
    h.querySelector("#qlTitle").textContent = c ? c.name + " · questions and flashcards" : "Question log";
    window.__senQl.mode = c ? "chapter" : "full";
    h.classList.toggle("chapter", !!c);
    h.hidden = false; document.body.classList.add("ql-open");
    function go() {
      var w = fr.contentWindow; if (!w || !w.document) return;
      var root = w.document.documentElement;
      root.classList.toggle("qe-chapter", !!c);
      root.setAttribute("data-theme", document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light");
      w.__qlEmbed = c ? 1 : 2;
      if (c && w.__qlOpen) w.__qlOpen(chId, tab);
      else if (!c && w.__qlCloseAll) w.__qlCloseAll();
    }
    if (!qlFrameEl || sig !== qlSig) {
      qlFrameEl = fr; qlSig = sig;
      fr.onload = go;
      fr.srcdoc = tpl.textContent.replace(/<\\\/script/gi, "</script");
      clearTimeout(window.__qlWatch);
      window.__qlWatch = setTimeout(function () {
        var ok = false; try { ok = !!(fr.contentWindow && fr.contentWindow.__qlOpen); } catch (e) {}
        if (!ok) { h.classList.remove("chapter"); h.querySelector("#qlTitle").textContent = "The question log could not start in this window. Open seneca.html directly in Chrome, Edge or Firefox from your computer (not inside a preview pane)."; qlFrameEl = null; }
      }, 5000);
    } else go();
  }
  document.addEventListener("click", function (e) {
    var link = e.target.closest ? e.target.closest("[data-chsheet]") : null;
    if (link) { qlShow(link.getAttribute("data-chsheet"), link.getAttribute("data-qtab")); return; }
    if (e.target.closest && e.target.closest("#qlFullBtn, [data-qlfull]")) { qlShow(null); return; }
    if (e.target.closest && e.target.closest("[data-revmove]")) { state.placeIdx = (state.placeIdx === "rev" ? null : "rev"); renderPlan(); return; }
    if (e.target.closest && e.target.closest("[data-revqueue]")) { revQueueShow(); return; }
    if (e.target.closest && e.target.closest("[data-revqclose]")) { var rq = document.getElementById("revQHost"); if (rq) rq.hidden = true; return; }
    var ro = e.target.closest ? e.target.closest("[data-revopen]") : null;
    if (ro) { var rq2 = document.getElementById("revQHost"); if (rq2) rq2.hidden = true; qlShow(ro.getAttribute("data-revopen"), ro.getAttribute("data-revtab") || null); return; }
    if (e.target.closest && e.target.closest("[data-revdone]")) revToggle();
  });
  document.addEventListener("keydown", function (e) { var h = document.getElementById("qlHost"); if (e.key === "Escape" && h && !h.hidden) qlHide(); });

  /* One-time import of your existing log. */
  function qlSeed() {
    var el = document.getElementById("seneca-ql-seed"); if (!el || qlSeeding || !db) return;
    var seed; try { seed = JSON.parse(el.textContent); } catch (err) { return; }
    qlSeeding = true;
    Object.keys(seed.entries || {}).forEach(function (k) { db.collection("qlog").doc(k).set(seed.entries[k]); });
    Object.keys(seed.cards || {}).forEach(function (k) { db.collection("qcards").doc(k).set(seed.cards[k]); });
    Object.keys(seed.settings || {}).forEach(function (k) { db.collection("qlsettings").doc(k).set(seed.settings[k]); });
    db.doc("settings/ql").set({ seeded: Date.now() });
  }
  function qlStart() {
    db.collection("qlog").onSnapshot(function (snap) { state.qlog = {}; snap.docs.forEach(function (x) { state.qlog[x.id] = x.data(); }); qlChanged(); }, onErr);
    db.collection("qcards").onSnapshot(function (snap) { state.qcards = {}; snap.docs.forEach(function (x) { state.qcards[x.id] = x.data(); }); qlChanged(); }, onErr);
    db.collection("qlsettings").onSnapshot(function (snap) {
      state.qlset = {}; snap.docs.forEach(function (x) { state.qlset[x.id] = x.data(); });
      if (!state.qlset.prefs && !qlPrefsSeeded) {
        qlPrefsSeeded = true;
        var el = document.getElementById("seneca-ql-seed"), seed = null; try { seed = el && JSON.parse(el.textContent); } catch (err) {}
        if (seed && seed.settings && seed.settings.prefs) db.collection("qlsettings").doc("prefs").set(seed.settings.prefs);
      }
    }, onErr);
    db.doc("settings/ql").onSnapshot(function (snap) { if (!(snap.exists && snap.data() && snap.data().seeded)) qlSeed(); }, onErr);
  }

  var bioMigrated = false;
  function maybeMigrateBio(d) {
    if (bioMigrated || !state.gotS || !state.gotC) return;
    if (!state.subjects.biology || state.subjects.botany) return;
    bioMigrated = true;
    var ZOO = { "Animal Kingdom": 1, "Structural Organisation in Animals": 1, "Biomolecules": 1, "Breathing": 1, "Circulation": 1, "Excretion": 1, "Locomotion & Movement": 1, "Neural System": 1, "Endocrine System": 1, "Human Reproduction": 1, "Reproductive Health": 1, "Evolution": 1, "Human Health & Disease": 1, "Biotech 1": 1, "Biotech 2": 1 };
    var bio = JSON.parse(JSON.stringify(state.subjects.biology));
    d.collection("subjects").doc("botany").set(bio);
    d.collection("subjects").doc("zoology").set(bio);
    var bo = 0, zo = 0;
    state.chapters.slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); }).forEach(function (c) {
      if (c.subject !== "biology") return;
      var sub = ZOO[c.name] ? "zoology" : "botany";
      var ord = sub === "zoology" ? ++zo : ++bo;
      d.collection("chapters").doc(c.id).update({ subject: sub, order: ord });
    });
  }

  function connectDb(d) {
    db = d;
    db.collection("subjects").onSnapshot(function (snap) {
      var map = {}; snap.docs.forEach(function (x) { map[x.id] = x.data(); });
      state.subjects = map; state.gotS = true; maybeMigrateBio(d); loaded();
    }, onErr);
    db.collection("chapters").onSnapshot(function (snap) {
      state.chapters = snap.docs.map(function (x) { return Object.assign({ id: x.id }, x.data()); });
      state.gotC = true; maybeMigrateBio(d); loaded();
    }, onErr);
    db.doc("settings/sizes").onSnapshot(function (snap) {
      state.sizes = snap.exists ? (snap.data() || {}) : {};
      render();
    }, onErr);
    db.doc("settings/daily").onSnapshot(function (snap) {
      var s = snap.exists ? snap.data() : null;
      state.goalPts = s && s.goalPts > 0 ? s.goalPts : null;
      state.deadline = s && typeof s.deadline === "string" && DATE_RE.test(s.deadline) ? s.deadline : DEFAULT_DEADLINE;
      renderSide();
    }, onErr);
    qlStart();
    db.collection("tests").onSnapshot(function (snap) {
      state.tests = snap.docs.map(function (x) { return Object.assign({ id: x.id }, x.data()); });
      if (!currentTest()) { state.testId = pickDefaultTest(); saveActive(); }
      renderTest();
    }, onErr);
    db.doc("settings/timetable").onSnapshot(function (snap) {
      state.tt = snap.exists ? snap.data() : null;
      var ae = document.activeElement;
      if (!(state.ttEdit && ae && $("planTimeline") && $("planTimeline").contains(ae) && ae.tagName === "INPUT")) renderPlan();
    }, onErr);
    db.collection("plans").onSnapshot(function (snap) {
      var m = {}; snap.docs.forEach(function (x) { m[x.id] = x.data(); });
      state.plans = m; state.plansLoaded = true; renderPlan();
    }, onErr);
  }

  function snapshotNow() {
    var chapMap = {};
    state.chapters.forEach(function (c) { var copy = Object.assign({}, c); delete copy.id; chapMap[c.id] = copy; });
    var snap = {
      subjects: state.subjects,
      chapters: chapMap,
      settings: { sizes: state.sizes, daily: { deadline: state.deadline }, timetable: state.tt || null },
      tests: (function () { var m = {}; state.tests.forEach(function (t) { var cp = Object.assign({}, t); delete cp.id; m[t.id] = cp; }); return m; })(),
      plans: state.plans,
      savedAt: Date.now()
    };
    if (state.goalPts > 0) snap.settings.daily.goalPts = state.goalPts;
    snap.qlog = state.qlog; snap.qcards = state.qcards; snap.qlsettings = state.qlset;
    return snap;
  }
  /* Export the whole page as an HTML file with your current data written into it, so it opens with everything already there. */
  if ($("exportHtmlBtn")) {
    $("exportHtmlBtn").addEventListener("click", function () {
      var el = $("seneca-data");
      if (el) el.textContent = JSON.stringify(snapshotNow()).replace(/<\//g, "<\\/");
      if (window.__senBlobsSync) window.__senBlobsSync();
      var cl = document.documentElement.cloneNode(true), tt = cl.querySelector("#toast");
      if (tt) tt.hidden = true;
      var blob = new Blob(["<!doctype html>\n" + cl.outerHTML], { type: "text/html;charset=utf-8" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "Seneca-" + dstr(new Date()) + ".html";
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      toast("Exported HTML with your data inside.");
    });
  }
  if ($("exportJsonBtn")) {
    $("exportJsonBtn").addEventListener("click", function () {
      if (window.__senBlobsSync) window.__senBlobsSync();
      var snap = snapshotNow();
      snap.blobs = Object.assign({}, qlEnsureBlobs());
      var blob = new Blob([JSON.stringify(snap, null, 2)], { type: "application/json;charset=utf-8" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "seneca-backup-" + dstr(new Date()) + ".json";
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      toast("Exported JSON backup.");
    });
  }
  if ($("importJsonInput")) {
    $("importJsonInput").addEventListener("change", function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var data = JSON.parse(String(reader.result || ""));
          if (!data || !data.subjects || !data.chapters) { toast("Invalid Seneca backup file."); return; }
          if (needDb()) return;
          Object.keys(data.subjects).forEach(function (id) { db.collection("subjects").doc(id).set(data.subjects[id]); });
          Object.keys(data.chapters).forEach(function (id) { db.collection("chapters").doc(id).set(data.chapters[id]); });
          if (data.settings) {
            if (data.settings.sizes) db.doc("settings/sizes").set(data.settings.sizes);
            if (data.settings.daily) db.doc("settings/daily").set(data.settings.daily);
            if (data.settings.timetable) db.doc("settings/timetable").set(data.settings.timetable);
          }
          if (data.qlog) Object.keys(data.qlog).forEach(function (id) { db.collection("qlog").doc(id).set(data.qlog[id]); });
          if (data.qlsettings) Object.keys(data.qlsettings).forEach(function (id) { db.collection("qlsettings").doc(id).set(data.qlsettings[id]); });
          if (data.qcards) Object.keys(data.qcards).forEach(function (id) { db.collection("qcards").doc(id).set(data.qcards[id]); });
          if (data.blobs && typeof data.blobs === "object") {
            var curB = qlEnsureBlobs();
            Object.keys(data.blobs).forEach(function (bk) {
              if (data.blobs[bk]) { curB[bk] = data.blobs[bk]; qlIdb("put", bk, data.blobs[bk]); qlBlobsDirty = true; }
            });
            if (window.__senBlobsSync) window.__senBlobsSync();
          }
          if (data.tests) Object.keys(data.tests).forEach(function (id) { db.collection("tests").doc(id).set(data.tests[id]); });
          if (data.plans) Object.keys(data.plans).forEach(function (id) { db.doc("plans/" + id).set(data.plans[id]); });
          toast("Backup restored.");
        } catch (err) { toast("Could not read that JSON file."); }
      };
      reader.readAsText(f);
      e.target.value = "";
    });
  }


  function carryUnfinishedToTomorrow() {
    if (needDb()) return { carried: 0, message: "Database is read-only here." };
    var todayKey = planKey(0), tmrKey = planKey(1);
    var pendItems = planResolved(todayKey).filter(function (r) { return !r.done; });
    var tmrArr = cloneItems(tmrKey), tmrSet = {};
    tmrArr.forEach(function (it) { tmrSet[it.ch + "|" + it.src] = 1; });
    var added = 0;
    pendItems.forEach(function (r) {
      var kk = r.c.id + "|" + r.src;
      if (tmrSet[kk]) return;
      tmrArr.push({ ch: r.c.id, src: r.src, carried: (r.carried || 0) + 1 });
      tmrSet[kk] = 1;
      added++;
    });
    if (!added) {
      toast("No new unfinished items to carry to tomorrow.");
      return { carried: 0, message: "Everything unfinished is already queued for tomorrow." };
    }
    var tmrRec = Object.assign({}, state.plans[tmrKey] || {}, { mode: modeOf(tmrKey), items: tmrArr });
    state.plans[tmrKey] = tmrRec;
    renderPlan();
    queued("p:" + tmrKey, function () { return db.doc("plans/" + tmrKey).set(tmrRec); });
    toast("Carried " + added + " item" + (added === 1 ? "" : "s") + " to tomorrow.");
    return { carried: added, message: "Carried " + added + " unfinished item(s) to tomorrow." };
  }

  function findChapterMatch(query, subjectHint) {
    var q = String(query || "").toLowerCase().trim();
    if (!q) return null;
    var sub = subjectHint ? String(subjectHint).toLowerCase().trim() : "";
    var pool = sub && LABEL[sub] ? chaptersOf(sub) : state.chapters;
    var i;
    for (i = 0; i < pool.length; i++) if (pool[i].id.toLowerCase() === q || pool[i].name.toLowerCase() === q) return pool[i];
    for (i = 0; i < pool.length; i++) if (pool[i].name.toLowerCase().indexOf(q) === 0) return pool[i];
    for (i = 0; i < pool.length; i++) if (pool[i].name.toLowerCase().indexOf(q) > -1) return pool[i];
    if (sub) return findChapterMatch(query, "");
    var tokens = q.split(/\s+/).filter(Boolean);
    if (tokens.length) {
      var best = null, bestScore = 0;
      state.chapters.forEach(function (c) {
        var nm = c.name.toLowerCase(), sc = 0;
        tokens.forEach(function (tk) { if (nm.indexOf(tk) > -1) sc++; });
        if (sc > bestScore) { bestScore = sc; best = c; }
      });
      if (bestScore > 0) return best;
    }
    return null;
  }

  function pickSourceForChapter(ch, requestedSrc) {
    var srcs = sourcesOf(ch.subject);
    if (!srcs.length) return "";
    if (requestedSrc) {
      var rq = String(requestedSrc).toLowerCase().trim();
      for (var i = 0; i < srcs.length; i++) {
        if (srcs[i].toLowerCase() === rq || srcs[i].toLowerCase().indexOf(rq) > -1) return srcs[i];
      }
    }
    var unticked = srcs.filter(function (s) { return !(ch.ticks && ch.ticks[s]); })
      .sort(function (a, b) { return srcRank(a) - srcRank(b); });
    return unticked[0] || srcs[0];
  }

  function normalizeSubj(raw) {
    var s = String(raw || "").toLowerCase().trim();
    if (s === "bio" || s === "bot") return "botany";
    if (s === "zoo") return "zoology";
    if (s === "chem") return "chemistry";
    if (s === "phy") return "physics";
    return LABEL[s] ? s : "";
  }

  window.__senecaApi = {
    getStudySnapshot: function () {
      var tt = totals(), dd = dayData(), key = planKey(0), now = new Date();
      var items = planResolved(key), target = effGoal() + carryGap(dd), todayPts = dd.pts[key] || 0;
      var pendPts = 0, pendItems = [];
      items.forEach(function (r) { if (!r.done) { pendPts += r.w; pendItems.push(r); } });
      var st = senStanding(), rv = revInfo(), tests = upcomingTests(), risks = senRisks({ items: items });
      var focus = pendItems[0] || null;
      return {
        dateLabel: now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }),
        overallPct: tt.total ? (tt.done / tt.total) * 100 : 0,
        donePts: tt.done,
        totalPts: tt.total,
        todayPts: todayPts,
        targetPts: target,
        pendingPts: pendPts,
        standingText: st.badge + " — " + st.text,
        subjects: SUBJ.map(function (s) {
          var m = summary(s);
          return { name: LABEL[s], pct: m.pct * 100, done: m.done, total: m.total };
        }),
        nextTask: focus ? (LABEL[focus.c.subject] + " · " + focus.c.name + " (" + focus.src + ", " + fnum(focus.w) + " pts)") : "None queued",
        dueQuestions: rv.q,
        dueCards: rv.f,
        upcomingTests: tests.slice(0, 3).map(function (ti) { return { name: ti.name, days: ti.days, leftPts: ti.left }; }),
        risks: risks.map(function (r) { return r.text; }),
        briefSummary: "Today, " + fnum(todayPts) + " of " + target + " points are done. " + st.text +
          (focus ? " Next up is " + focus.c.name + " in " + LABEL[focus.c.subject] + ", " + focus.src + "." : "") +
          " Revision queue has " + rv.q + " questions and " + rv.f + " flashcards due."
      };
    },
    getStateOverview: function () {
      var snap = this.getStudySnapshot();
      var key = planKey(0), items = planResolved(key), rv = revInfo();
      return {
        snapshot: snap,
        ui: {
          view: state.view,
          theme: document.documentElement.getAttribute("data-theme") || "light",
          activeSubject: state.active,
          filter: state.filter,
          search: state.search,
          scheduleView: state.sview,
          scheduleDay: state.schedDay === 1 ? "tomorrow" : "today",
          timetableMode: modeOf(key),
          timetables: ttTables().map(function (t) { return { id: t.id, name: t.name }; }),
          deadline: state.deadline,
          dailyGoal: effGoal(),
          revisionDone: !!rv.done,
          timer: state.timer ? {
            chKey: state.timer.chKey,
            running: !!state.timer.running,
            secsRemaining: state.timer.secs
          } : null
        },
        todayPlan: items.map(function (r, idx) {
          return {
            index: idx,
            chapterId: r.c.id,
            chapter: r.c.name,
            subject: r.c.subject,
            source: r.src,
            points: r.w,
            done: !!r.done,
            start: r.start || null,
            end: r.end || null
          };
        }),
        proposedRoutine: (state.sugg || []).map(function (s) {
          return { chapterId: s.ch, chapter: s.c.name, subject: s.c.subject, source: s.src, points: s.w, why: s.why || "" };
        }),
        tests: upcomingTests().map(function (t) {
          return { id: t.x.id, name: t.name, date: t.x.date, daysLeft: t.days, pointsLeft: t.left, totalPoints: t.total };
        })
      };
    },
    getChapters: function () {
      return state.chapters.slice().sort(function (a, b) {
        if (a.subject !== b.subject) return a.subject < b.subject ? -1 : 1;
        return (a.order || 0) - (b.order || 0);
      }).map(function (c) {
        return { id: c.id, name: c.name, subject: c.subject, label: LABEL[c.subject] || c.subject };
      });
    },
    executeAppCommand: function (name, args) {
      args = args || {};
      var key = planKey(0);
      if (name === "getStudyStatus") {
        return { ok: true, overview: this.getStateOverview() };
      }
      if (name === "navigateView") {
        var v = String(args.view || "").toLowerCase().trim();
        var mapV = { home: "plan", plan: "plan", today: "plan", schedule: "schedule", calendar: "schedule", tracker: "tracker", syllabus: "tracker", test: "test", tests: "test" };
        var targetV = mapV[v];
        if (!targetV) return { ok: false, error: "Unknown view: " + v };
        setView(targetV);
        return { ok: true, view: state.view };
      }
      if (name === "setTheme") {
        var th = String(args.theme || "").toLowerCase().trim();
        if (th === "alternate" || th === "alt" || th === "parchment") th = "stoic";
        if (th !== "light" && th !== "dark" && th !== "stoic") return { ok: false, error: "Theme must be light, dark, or stoic (alternate)." };
        var thBtn = document.querySelector('#themeSwitch [data-settheme="' + th + '"]');
        if (thBtn) thBtn.click();
        return { ok: true, theme: th };
      }
      if (name === "switchSubject") {
        var sb = normalizeSubj(args.subject);
        if (!sb) return { ok: false, error: "Subject must be botany, zoology, chemistry, or physics." };
        state.active = sb;
        if (args.openTracker !== false && state.view !== "tracker" && state.view !== "test") setView("tracker");
        render();
        return { ok: true, activeSubject: state.active };
      }
      if (name === "searchOrFilterChapters") {
        if (args.subject) {
          var subF = normalizeSubj(args.subject);
          if (subF) state.active = subF;
        }
        if (args.filter) {
          var f = String(args.filter).toLowerCase().trim();
          var mapF = { all: "all", todo: "todo", "not started": "todo", part: "part", "in progress": "part", done: "done", due: "due" };
          if (mapF[f]) state.filter = mapF[f];
        }
        if (args.search !== undefined) {
          state.search = String(args.search || "");
          if ($("chSearch")) $("chSearch").value = state.search;
        }
        if (state.view !== "tracker") setView("tracker");
        render();
        return { ok: true, subject: state.active, filter: state.filter, search: state.search };
      }
      if (name === "planAndScheduleDay") {
        if (needDb()) return { ok: false, error: "Saving unavailable." };
        var prevView = state.view;
        state.view = "plan";
        renderPlan();
        var picks = (state.sugg && state.sugg.length) ? state.sugg : suggestSlots(Math.max(1, effGoal()), {}, upcomingTests());
        if (picks && picks.length) planAdd(picks);
        var placedRes = senPlace();
        state.view = prevView;
        applyView();
        toast("Planned and scheduled today's study blocks.");
        return { ok: true, addedCount: picks ? picks.length : 0, placed: placedRes };
      }
      if (name === "manageTodayPlan") {
        var act = String(args.action || "").toLowerCase().trim();
        if (act === "carry" || act === "carrytotomorrow" || act === "carry_to_tomorrow") {
          return Object.assign({ ok: true }, carryUnfinishedToTomorrow());
        }
        if (act === "clear") {
          if (needDb()) return { ok: false, error: "Saving unavailable." };
          var keepDone = args.keepDone !== false;
          var nextRaw = keepDone ? planResolved(key).filter(function (r) { return r.done; }).map(function (r) { return { ch: r.c.id, src: r.src }; }) : [];
          savePlan(nextRaw);
          toast("Updated today's plan.");
          return { ok: true, remainingCount: nextRaw.length };
        }
        var ch = findChapterMatch(args.chapterQuery || args.chapter, args.subject);
        if (!ch) return { ok: false, error: "Could not find chapter matching '" + (args.chapterQuery || args.chapter || "") + "'." };
        var src = pickSourceForChapter(ch, args.source);
        if (act === "add") {
          if (needDb()) return { ok: false, error: "Saving unavailable." };
          planAdd([{ ch: ch.id, src: src }]);
          if (args.scheduleNow) senPlace();
          toast("Added " + ch.name + " (" + src + ") to today's plan.");
          return { ok: true, chapter: ch.name, subject: LABEL[ch.subject], source: src };
        }
        if (act === "remove") {
          if (needDb()) return { ok: false, error: "Saving unavailable." };
          var cur = cloneItems(key).filter(function (it) { return !(it.ch === ch.id && (!args.source || it.src === src)); });
          savePlan(cur);
          toast("Removed " + ch.name + " from today's plan.");
          return { ok: true, chapter: ch.name, remainingCount: cur.length };
        }
        return { ok: false, error: "Unsupported plan action: " + act };
      }
      if (name === "manageSchedule") {
        var sAct = String(args.action || "").toLowerCase().trim();
        if (sAct === "setview" || sAct === "set_view") {
          var sv = String(args.scheduleView || "blocks").toLowerCase();
          state.sview = sv === "manual" ? "manual" : "blocks";
          try { localStorage.setItem("syllabus-sview", state.sview); } catch (e) {}
          renderPlan();
          return { ok: true, scheduleView: state.sview };
        }
        if (sAct === "setday" || sAct === "set_day") {
          state.schedDay = String(args.day || "").toLowerCase() === "tomorrow" ? 1 : 0;
          renderPlan();
          return { ok: true, scheduleDay: state.schedDay === 1 ? "tomorrow" : "today" };
        }
        if (sAct === "settimetable" || sAct === "set_timetable") {
          var ttQ = String(args.timetable || "").toLowerCase().trim();
          var tables = ttTables(), found = null;
          tables.forEach(function (t) {
            if (t.id.toLowerCase() === ttQ || t.name.toLowerCase() === ttQ || t.name.toLowerCase().indexOf(ttQ) > -1) found = t;
          });
          if (!found && /t1|home/.test(ttQ)) found = tableById("home");
          if (!found && /t2|coach|class/.test(ttQ)) found = tableById("class");
          if (!found) return { ok: false, error: "Timetable not found: " + ttQ };
          setMode(found.id);
          return { ok: true, timetable: found.name, id: found.id };
        }
        if (sAct === "wokenow" || sAct === "woke_now") {
          if (needDb()) return { ok: false, error: "Saving unavailable." };
          var hwKey = planKey(state.schedDay === 1 ? 1 : 0), hwRec = Object.assign({}, state.plans[hwKey] || {}, { items: planRaw(hwKey) });
          hwRec.habit = Object.assign({}, hwRec.habit || {}, { wake: fromMin(nowMinutes()) });
          state.plans[hwKey] = hwRec; renderPlan();
          queued("p:" + hwKey, function () { return db.doc("plans/" + hwKey).set(hwRec); });
          toast("Wake-up logged at " + fmtT(hwRec.habit.wake) + ".");
          return { ok: true, wakeTime: fmtT(hwRec.habit.wake) };
        }
        if (sAct === "autofill" || sAct === "auto_fill") {
          if (state.sview === "manual") {
            var am = autoPlaceOpen();
            return { ok: true, placed: am.placed, total: am.total };
          }
          var qOff = state.schedDay === 1 ? 1 : 0, qKey = planKey(qOff);
          var qItems = planResolved(qKey), qDone = qOff === 0 ? (dayData().pts[qKey] || 0) : 0, qPend = 0, qSet = {};
          qItems.forEach(function (r) { if (!r.done) qPend += r.w; qSet[r.c.id + "|" + r.src] = 1; });
          var qNeed = Math.max(0, effGoal() + (qOff === 0 ? carryGap(dayData()) : 0) - qDone - qPend);
          var picks2 = suggestSlots(Math.max(1, qNeed), qSet, upcomingTests());
          var qRaw = cloneItems(qKey);
          picks2.forEach(function (x) { var kk = x.ch + "|" + x.src; if (!qSet[kk]) { qRaw.push({ ch: x.ch, src: x.src }); qSet[kk] = 1; } });
          var qRec = Object.assign({}, state.plans[qKey] || {}, { mode: modeOf(qKey), items: qRaw });
          state.plans[qKey] = qRec; renderPlan();
          queued("p:" + qKey, function () { return db.doc("plans/" + qKey).set(qRec); });
          toast("Auto-filled schedule.");
          return { ok: true, added: picks2.length };
        }
        if (sAct === "replan") {
          if (state.sview === "blocks") reschedule();
          renderPlan();
          if (state.sugg && state.sugg.length) planAdd(state.sugg);
          senPlace();
          toast("Day replanned into free blocks.");
          return { ok: true };
        }
        return { ok: false, error: "Unsupported schedule action: " + sAct };
      }
      if (name === "controlFocusTimer") {
        var tAct = String(args.action || "").toLowerCase().trim();
        if (args.chapterQuery || args.chapter) {
          var fCh = findChapterMatch(args.chapterQuery || args.chapter, args.subject);
          if (fCh) {
            var fItems = planResolved(key).filter(function (r) { return !r.done && r.c.id === fCh.id; });
            var fSrc = fItems[0] ? fItems[0].src : pickSourceForChapter(fCh, args.source);
            if (!fItems.length) planAdd([{ ch: fCh.id, src: fSrc }]);
            state.focusOverride = fCh.id + "|" + fSrc;
            state.timer = null;
          }
        }
        var pv = state.view;
        state.view = "plan";
        renderPlan();
        state.view = pv;
        applyView();
        if (!state.timer) return { ok: false, error: "No pending study block is queued for the timer." };
        if (tAct === "start" || tAct === "resume") {
          state.timer.running = true;
          renderPlan();
          toast("Focus timer started.");
          return { ok: true, running: true, chKey: state.timer.chKey, secsRemaining: state.timer.secs };
        }
        if (tAct === "pause" || tAct === "stop") {
          state.timer.running = false;
          renderPlan();
          toast("Focus timer paused.");
          return { ok: true, running: false, secsRemaining: state.timer.secs };
        }
        if (tAct === "reset") {
          state.timer.secs = state.timer.total;
          state.timer.running = false;
          renderPlan();
          toast("Focus timer reset.");
          return { ok: true, running: false, secsRemaining: state.timer.secs };
        }
        if (tAct === "complete" || tAct === "done") {
          if (needDb()) return { ok: false, error: "Saving unavailable." };
          var parts = state.timer.chKey.split("|"), cid = parts[0], csrc = parts[1], cObj = chById(cid);
          if (!cObj) return { ok: false, error: "Active block chapter not found." };
          state.timer = null;
          if (isRepeat(cObj.subject, csrc)) heat(cid, csrc, 1);
          else if (!(cObj.ticks && cObj.ticks[csrc])) toggle(cid, csrc);
          toast("Completed " + cObj.name + " (" + csrc + ").");
          return { ok: true, completed: cObj.name, source: csrc };
        }
        return { ok: false, error: "Unknown timer action: " + tAct };
      }
      if (name === "updateChapterProgress") {
        var uCh = findChapterMatch(args.chapterQuery || args.chapter, args.subject);
        if (!uCh) return { ok: false, error: "Chapter not found." };
        var uSrc = pickSourceForChapter(uCh, args.source);
        var uAct = String(args.action || "toggle").toLowerCase().trim();
        if (isRepeat(uCh.subject, uSrc) || uAct === "add_read" || uAct === "remove_read") {
          var dir = uAct === "remove_read" || uAct === "untick" ? -1 : 1;
          heat(uCh.id, uSrc, dir);
          toast((dir > 0 ? "Logged read for " : "Removed read from ") + uCh.name + " (" + uSrc + ").");
          return { ok: true, chapter: uCh.name, source: uSrc, action: dir > 0 ? "read_added" : "read_removed" };
        }
        var curOn = !!(uCh.ticks && uCh.ticks[uSrc]);
        if ((uAct === "tick" && curOn) || (uAct === "untick" && !curOn)) {
          return { ok: true, chapter: uCh.name, source: uSrc, ticked: curOn, unchanged: true };
        }
        toggle(uCh.id, uSrc);
        toast((curOn ? "Unticked " : "Ticked ") + uCh.name + " (" + uSrc + ").");
        return { ok: true, chapter: uCh.name, source: uSrc, ticked: !curOn };
      }
      if (name === "toggleRevision") {
        var rAct = String(args.action || "").toLowerCase().trim();
        if (rAct === "open_queue") { revQueueShow(); return { ok: true, opened: "revision_queue" }; }
        if (rAct === "open_question_log") {
          var qCh = args.chapterQuery ? findChapterMatch(args.chapterQuery, args.subject) : null;
          qlShow(qCh ? qCh.id : null, args.tab === "flashcards" ? "f" : null);
          return { ok: true, opened: "question_log", chapter: qCh ? qCh.name : "full" };
        }
        if (rAct === "close_modals") {
          qlHide();
          var rqEl = document.getElementById("revQHost");
          if (rqEl) rqEl.hidden = true;
          return { ok: true, closed: true };
        }
        if (rAct === "mark_done" || rAct === "undo_done" || rAct === "toggle") {
          var curRev = revInfo();
          if (rAct === "mark_done" && curRev.done) return { ok: true, revisionDone: true, unchanged: true };
          if (rAct === "undo_done" && !curRev.done) return { ok: true, revisionDone: false, unchanged: true };
          revToggle();
          return { ok: true, revisionDone: !curRev.done };
        }
        return { ok: false, error: "Unknown revision action: " + rAct };
      }
      if (name === "manageTests") {
        var mAct = String(args.action || "list").toLowerCase().trim();
        if (mAct === "create") {
          if (!args.name || !args.date) return { ok: false, error: "Provide both test name and YYYY-MM-DD date." };
          newTest(String(args.name), String(args.date));
          setView("test");
          return { ok: true, created: args.name, date: args.date };
        }
        if (mAct === "select") {
          var tq = String(args.testName || args.name || "").toLowerCase().trim();
          var matchT = state.tests.filter(function (x) { return (x.name || "").toLowerCase().indexOf(tq) > -1; })[0];
          if (!matchT) return { ok: false, error: "Test not found: " + tq };
          state.testId = matchT.id; state.confirmDel = false; saveActive(); setView("test"); renderTest();
          return { ok: true, selectedTest: matchT.name, date: matchT.date };
        }
        if (mAct === "plan_for_test") {
          var curT = currentTest();
          if (!curT) return { ok: false, error: "No active test selected." };
          var tiX = testInfo(curT), its = planResolved(key), tdX = testToday(tiX, its, key), pl = {};
          its.forEach(function (r) { pl[r.c.id + "|" + r.src] = 1; });
          var pick = suggestSlots(tdX.short, pl, [tiX], tiX);
          if (pick.length) planAdd(pick);
          return { ok: true, test: curT.name, addedItems: pick.length };
        }
        return {
          ok: true,
          tests: upcomingTests().map(function (t) { return { name: t.name, date: t.x.date, days: t.days, leftPts: t.left }; })
        };
      }
      if (name === "adjustTargets") {
        if (args.dailyGoal != null) {
          setGoal(Number(args.dailyGoal));
          toast("Daily goal set to " + effGoal() + " points.");
        } else if (args.delta != null) {
          setGoal(effGoal() + Number(args.delta));
          toast("Daily goal set to " + effGoal() + " points.");
        } else if (args.resetGoal) {
          resetGoal();
          toast("Daily goal reset to deadline pace (" + effGoal() + " pts).");
        }
        if (args.deadline && DATE_RE.test(String(args.deadline))) {
          if (needDb()) return { ok: false, error: "Saving unavailable." };
          state.deadline = String(args.deadline);
          renderDeadline(); renderToday(); renderPlan(); saveSettings();
          toast("Syllabus deadline updated to " + state.deadline + ".");
        }
        return { ok: true, dailyGoal: effGoal(), deadline: state.deadline };
      }
      return { ok: false, error: "Unknown command: " + name };
    },
    saveQuestionToLog: function (entry) {
      if (!db) throw new Error("Database not ready");
      var ch = chById(entry.chapterId);
      if (!ch) throw new Error("Please select a valid chapter.");
      var qId = qlRid();
      var imgIds = [];
      if (entry.imageBase64 && window.__senQl) {
        var bId = "";
        while (bId.length < 32) bId += Math.floor(Math.random() * 16).toString(16);
        window.__senQl.addBlob(bId, entry.imageBase64);
        imgIds.push(bId);
      }
      var doc = {
        subject: ch.subject,
        chapter: ch.id,
        source: String(entry.source || "Seneca AI").trim(),
        question: String(entry.question || "").trim(),
        optA: String(entry.optA || "").trim(),
        optB: String(entry.optB || "").trim(),
        optC: String(entry.optC || "").trim(),
        optD: String(entry.optD || "").trim(),
        mine: "",
        correct: String(entry.correct || "").trim(),
        type: "",
        takeaway: String(entry.takeaway || "").trim(),
        revised: "",
        color: "",
        stage: 0,
        due: Date.now() + QL_DAY,
        images: imgIds,
        created: Date.now()
      };
      return db.collection("qlog").doc(qId).set(doc).then(function () {
        toast("Saved question to " + ch.name + ".");
        return qId;
      });
    },
    toast: function (m) { toast(m); }
  };

  if (window.claude && window.claude.use) {
    window.claude.use("db").then(function (d) {
      connectDb(d || createLocalDb());
    }).catch(function () {
      connectDb(createLocalDb());
    });
  } else {
    connectDb(createLocalDb());
  }
})();