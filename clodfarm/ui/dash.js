/* clodfarm dashboards. /dashboards lists them, by folder (/dashboards?folder=Growth/Leads), and lets you move them
 * between folders; /dashboards/<name> draws one from the spec its Claude pushed:
 * stat tabs over one big chart of the selected stat's history, then charts, bar lists, tables, progress and notes.
 * Plain JS, no dependencies; the farm never runs agent-written code in your browser, only this renderer. */
"use strict";

const BASE = document.body.dataset.base || "";
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const SVG = "http://www.w3.org/2000/svg";
function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat(3)) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}
function s(tag, attrs = {}, css = null) {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  if (css) Object.assign(e.style, css); // CSSOM, not a style attribute: allowed by the farm's CSP
  return e;
}
const fill = (el, ...kids) => (el.replaceChildren(...kids.flat(3).filter(k => k != null && k !== false)), el);
const SERIES = n => `var(--s${n + 1})`; // the farm palette in its fixed, checked order (specs cap charts at 5 series)

// ------------------------------------------------------------------ formatting
const nf = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const nfCompact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
function num(v) {
  if (v == null || Number.isNaN(v)) return "–";
  return Math.abs(v) >= 100000 ? nfCompact.format(v) : nf.format(Math.abs(v) >= 100 ? Math.round(v * 10) / 10 : v);
}
const unitGlue = u => (!u ? "" : /^[%°x×]/.test(u) ? u : " " + u);
const withUnit = (v, u) => num(v) + unitGlue(u);
function ago(ts) {
  if (!ts) return "never";
  const x = Math.max(0, Date.now() / 1000 - ts);
  return x < 60 ? "just now" : x < 3600 ? `${Math.round(x / 60)}m ago` : x < 86400 ? `${Math.round(x / 3600)}h ago` : `${Math.round(x / 86400)}d ago`;
}
const every = sec => (sec % 86400 === 0 ? `${sec / 86400}d` : sec % 3600 === 0 ? `${sec / 3600}h` : `${Math.round(sec / 60)}m`);
function timeLabel(t, span) {
  const d = new Date(t * 1000);
  if (span <= 2 * 86400) return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
const fullTime = t => new Date(t * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** The change over the range: first point to now. `good` says which way is better. */
function delta(points, value, good) {
  if (!points || points.length < 2 || value == null) return null;
  const first = points[0][1];
  const d = value - first;
  if (!Number.isFinite(d)) return null;
  const pct = first !== 0 ? (d / Math.abs(first)) * 100 : null;
  const cls = d === 0 || !good ? "" : (d > 0) === (good === "up") ? "good" : "bad";
  const arrow = d > 0 ? "▲" : d < 0 ? "▼" : "■";
  const text = pct != null && Math.abs(pct) < 10000 ? `${d > 0 ? "+" : ""}${nf.format(Math.round(pct * 10) / 10)}%` : `${d > 0 ? "+" : ""}${num(d)}`;
  return { cls, arrow, text, since: points[0][0] };
}
function deltaEl(dl, rangeLabel) {
  if (!dl) return null;
  const word = dl.cls === "good" ? "better" : dl.cls === "bad" ? "worse" : "change";
  return h("span", { class: `delta ${dl.cls}`, title: `${word} since ${fullTime(dl.since)}` },
    h("span", { "aria-hidden": "true", text: dl.arrow }), dl.text,
    rangeLabel ? h("span", { class: "vs", text: ` ${rangeLabel}` }) : null);
}

// -------------------------------------------------------------------- api
async function api(path) {
  const r = await fetch(`${BASE}/api/${path}`, { credentials: "same-origin", headers: { Accept: "application/json" } });
  if (r.status === 401) {
    const here = location.pathname.slice(BASE.length).replace(/^\/|\/$/g, "");
    location.replace(`${BASE}/?next=${encodeURIComponent(here)}`);
    throw new Error("log in first");
  }
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body.error || r.statusText), { status: r.status });
  return body;
}

async function post(path, body) {
  const r = await fetch(`${BASE}/api/${path}`, { method: "POST", credentials: "same-origin", body: JSON.stringify(body),
    headers: { Accept: "application/json", "Content-Type": "application/json", "X-Clodfarm": "1" } });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(out.error || r.statusText);
  return out;
}

// ------------------------------------------------------------------ charts
function niceTicks(lo, hi, n = 4) {
  if (lo === hi) { const p = Math.abs(lo) * 0.1 || 1; lo -= p; hi += p; }
  const raw = (hi - lo) / n, mag = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(x => x >= raw);
  const a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step, out = [];
  for (let v = a; v <= b + step / 2; v += step) out.push(Math.round(v / step) * step);
  return out;
}
/** Monotone cubic path (Fritsch-Carlson): smooth, and never overshoots the data. */
function smoothPath(pts) {
  if (pts.length < 2) return "";
  const n = pts.length, dx = [], m = [], t = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0]; m[i] = dx[i] ? (pts[i + 1][1] - pts[i][1]) / dx[i] : 0; }
  t[0] = m[0]; t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]);
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], k = dx[i] / 3;
    d += `C${x0 + k},${y0 + k * t[i]} ${x1 - k},${y1 - k * t[i + 1]} ${x1},${y1}`;
  }
  return d;
}

/** A line chart with a crosshair and tooltip. series: [{name, points: [[t, v]]}]. One series gets a soft area. */
function lineChart(series, { unit = "", height = 220, from = null, to = null } = {}) {
  const box = h("div", { class: "chart" });
  const live = series.filter(x => x.points.length);
  if (!live.length) return fill(box, h("div", { class: "empty-chart", text: "No data in this range yet. Each push records a point." }));
  if (series.length > 1) box.append(h("div", { class: "legend" }, series.map((x, i) => { const sw = h("i"); sw.style.background = SERIES(i); return h("span", {}, sw, x.name); })));
  const svgWrap = h("div");
  box.append(svgWrap);
  const draw = () => {
    const W = Math.max(260, svgWrap.clientWidth || 600), H = height, L = 52, R = 14, T = 10, B = 26;
    const all = live.flatMap(x => x.points);
    let x0 = from ?? Math.min(...all.map(p => p[0])), x1 = to ?? Math.max(...all.map(p => p[0]));
    if (x1 - x0 < 3600) { x0 -= 1800; x1 += 1800; }
    const vals = all.map(p => p[1]), ticks = niceTicks(Math.min(...vals), Math.max(...vals));
    const y0 = ticks[0], y1 = ticks[ticks.length - 1];
    const X = t => L + ((t - x0) / (x1 - x0)) * (W - L - R), Y = v => T + (1 - (v - y0) / (y1 - y0 || 1)) * (H - T - B);
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, height: H, role: "img",
      "aria-label": series.map(x => `${x.name}: ${x.points.length} points, latest ${withUnit(x.points.at(-1)?.[1], unit)}`).join("; ") });
    for (const v of ticks) {
      svg.append(s("line", { class: v === y0 ? "baseline" : "gridline", x1: L, x2: W - R, y1: Y(v), y2: Y(v) }));
      const lab = s("text", { x: L - 8, y: Y(v) + 4, "text-anchor": "end" }); lab.textContent = withUnit(v, unit.length <= 2 ? unit : ""); svg.append(lab);
    }
    const nx = Math.max(2, Math.min(6, Math.floor((W - L - R) / 110)));
    for (let i = 0; i <= nx; i++) {
      const t = x0 + ((x1 - x0) * i) / nx, lab = s("text", { x: X(t), y: H - 6, "text-anchor": i === 0 ? "start" : i === nx ? "end" : "middle" });
      lab.textContent = timeLabel(t, x1 - x0); svg.append(lab);
    }
    const uid = "g" + Math.random().toString(36).slice(2, 8);
    live.forEach((x) => {
      const i = series.indexOf(x), pts = x.points.map(p => [X(p[0]), Y(p[1])]), color = SERIES(i);
      if (live.length === 1 && pts.length > 1) {
        const defs = s("defs"), g = s("linearGradient", { id: uid, x1: 0, x2: 0, y1: 0, y2: 1 });
        g.append(s("stop", { offset: "0" }, { stopColor: color, stopOpacity: ".22" }), s("stop", { offset: "1" }, { stopColor: color, stopOpacity: "0" }));
        defs.append(g); svg.append(defs);
        svg.append(s("path", { d: smoothPath(pts) + `L${pts.at(-1)[0]},${Y(y0)}L${pts[0][0]},${Y(y0)}Z`, fill: `url(#${uid})` }));
      }
      if (pts.length > 1) svg.append(s("path", { d: smoothPath(pts), fill: "none", "stroke-width": 3, "stroke-linejoin": "round", "stroke-linecap": "square" }, { stroke: color }));
      if (pts.length <= 3) for (const [px, py] of pts) svg.append(s("rect", { x: px - 5, y: py - 5, width: 10, height: 10, "stroke-width": 2 }, { fill: color, stroke: "var(--ink)" }));
    });
    // hover: the nearest point of every series to the pointer
    const cross = s("line", { class: "crosshair", y1: T, y2: H - B, visibility: "hidden" }), dots = s("g", { visibility: "hidden" });
    svg.append(cross, dots);
    const hit = s("rect", { class: "hit", x: L, y: T, width: W - L - R, height: H - T - B });
    svg.append(hit);
    const tip = $("#tip");
    const move = (e) => {
      const r = svg.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * W, t = x0 + ((px - L) / (W - L - R)) * (x1 - x0);
      const near = live.map(x => ({ x, p: x.points.reduce((a, b) => (Math.abs(b[0] - t) < Math.abs(a[0] - t) ? b : a)) }));
      const at = near[0].p[0];
      cross.setAttribute("x1", X(at)); cross.setAttribute("x2", X(at)); cross.setAttribute("visibility", "visible");
      fill(dots, near.map(({ x, p }) => s("rect", { x: X(p[0]) - 5, y: Y(p[1]) - 5, width: 10, height: 10, "stroke-width": 2 }, { fill: SERIES(series.indexOf(x)), stroke: "var(--ink)" })));
      dots.setAttribute("visibility", "visible");
      fill(tip, h("div", { class: "t", text: fullTime(at) }), near.map(({ x, p }) => {
        const sw = h("i"); sw.style.background = SERIES(series.indexOf(x));
        return h("div", { class: "row" }, h("span", {}, sw, x.name), h("b", { text: withUnit(p[1], unit) }));
      }));
      tip.hidden = false;
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      tip.style.left = Math.min(innerWidth - tw - 8, Math.max(8, e.clientX + 14)) + "px";
      tip.style.top = Math.max(8, e.clientY - th - 12) + "px";
    };
    const leave = () => { cross.setAttribute("visibility", "hidden"); dots.setAttribute("visibility", "hidden"); tip.hidden = true; };
    hit.addEventListener("pointermove", move);
    hit.addEventListener("pointerdown", move);
    hit.addEventListener("pointerleave", leave);
    fill(svgWrap, svg);
  };
  requestAnimationFrame(draw);
  new ResizeObserver(() => draw()).observe(svgWrap);
  // the same numbers as a table, for screen readers and for copying
  const rows = live.flatMap(x => x.points.slice(-60).map(p => [x.name, p[0], p[1]])).sort((a, b) => b[1] - a[1]);
  box.append(h("details", { class: "data" }, h("summary", { text: "View data" }),
    h("table", {}, h("thead", {}, h("tr", {}, h("th", { text: "Series" }), h("th", { text: "Time" }), h("th", { class: "num", text: "Value" }))),
      h("tbody", {}, rows.map(([n, t, v]) => h("tr", {}, h("td", { text: n }), h("td", { text: fullTime(t) }), h("td", { class: "num", text: withUnit(v, unit) })))))));
  return box;
}

function sparkline(points, good) {
  const svg = s("svg", { viewBox: "0 0 100 26", preserveAspectRatio: "none", "aria-hidden": "true" });
  if (!points || points.length < 2) return svg;
  const ts = points.map(p => p[0]), vs = points.map(p => p[1]);
  const t0 = Math.min(...ts), t1 = Math.max(...ts), v0 = Math.min(...vs), v1 = Math.max(...vs);
  const pts = points.map(([t, v]) => [((t - t0) / (t1 - t0 || 1)) * 100, 24 - ((v - v0) / (v1 - v0 || 1)) * 22]);
  svg.append(s("path", { d: smoothPath(pts), fill: "none", "stroke-width": 2, "vector-effect": "non-scaling-stroke" }, { stroke: "var(--s1)" }));
  return svg;
}

// ------------------------------------------------------------------ widgets
function mdInline(text) {
  const out = [], re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(h("strong", { text: m[1] }));
    else if (m[2]) out.push(h("code", { text: m[2] }));
    else out.push(h("a", { href: m[4], target: "_blank", rel: "noopener noreferrer", text: m[3] }));
    last = re.lastIndex;
  }
  out.push(text.slice(last));
  return out;
}
/** A small, safe Markdown subset: paragraphs, "- " lists, "## " headings, **bold**, `code`, [links](https://...). */
function prose(text) {
  const root = h("div", { class: "prose" });
  let list = null, para = [];
  const flush = () => { if (para.length) root.append(h("p", {}, mdInline(para.join(" ")))); para = []; };
  for (const line of String(text || "").split("\n")) {
    const l = line.trim();
    if (/^[-*] /.test(l)) { flush(); if (!list) root.append((list = h("ul"))); list.append(h("li", {}, mdInline(l.slice(2)))); continue; }
    list = null;
    if (!l) { flush(); continue; }
    if (/^#{1,6} /.test(l)) { flush(); root.append(h("h3", {}, mdInline(l.replace(/^#+ /, "")))); continue; }
    para.push(l);
  }
  flush();
  return root;
}

function panel(w, body) {
  return h("section", { class: `card panel${w.width === "full" || ["table"].includes(w.type) && w.width !== "half" ? " full" : ""}` },
    h("div", { class: "panel-head" }, h("h2", { text: w.label || "" }), w.note ? h("span", { class: "note", text: w.note }) : null), body);
}

function widget(w, ctx) {
  if (w.type === "chart") {
    const series = w.from
      ? w.from.map(k => ({ name: ctx.stats[k]?.label || k, points: ctx.hist(k) }))
      : w.series;
    const unit = w.unit || (w.from && ctx.stats[w.from[0]]?.unit) || "";
    return panel(w, lineChart(series, { unit, from: w.from ? ctx.from : null, to: w.from ? ctx.to : null }));
  }
  if (w.type === "bars") {
    const max = Math.max(0, ...w.items.map(i => i.value)) || 1;
    return panel(w, h("div", { class: "bars" }, w.items.length ? w.items.map(i => {
      const f = h("i", { class: "fill" }); f.style.width = `${Math.max(0, (i.value / max) * 100)}%`;
      return h(i.href ? "a" : "div", { class: "bar-row", href: i.href, target: i.href ? "_blank" : null, rel: i.href ? "noopener noreferrer" : null },
        f, h("span", { text: i.label }), h("b", { text: withUnit(i.value, w.unit) }));
    }) : h("p", { class: "muted small", text: "Nothing to list." })));
  }
  if (w.type === "table") {
    const numeric = w.columns.map((_, c) => w.rows.length && w.rows.every(r => r[c] == null || typeof r[c] === "number"));
    const cell = (v, c) => h("td", { class: numeric[c] ? "num" : null },
      v && typeof v === "object" ? (v.href ? h("a", { href: v.href, target: "_blank", rel: "noopener noreferrer", text: v.text || v.href }) : v.text) : typeof v === "number" ? num(v) : v ?? "");
    return panel(w, h("div", { class: "table-wrap" }, h("table", {},
      h("thead", {}, h("tr", {}, w.columns.map((c, i) => h("th", { class: numeric[i] ? "num" : null, text: c })))),
      h("tbody", {}, w.rows.map(r => h("tr", {}, w.columns.map((_, c) => cell(r[c], c))))))));
  }
  if (w.type === "progress") {
    const pct = Math.max(0, Math.min(100, (w.value / (w.max || 100)) * 100)), bar = h("i");
    bar.style.width = pct + "%";
    return panel(w, [h("div", { class: "progress-val" }, withUnit(w.value, w.unit), h("span", { class: "muted small", text: `  of ${withUnit(w.max, w.unit)} · ${Math.round(pct)}%` })),
      h("div", { class: "progress", role: "progressbar", "aria-valuenow": Math.round(pct), "aria-valuemin": 0, "aria-valuemax": 100, "aria-label": w.label }, bar)]);
  }
  if (w.type === "text") return panel(w, prose(w.text));
  if (w.type === "stat") { // a stat outside the tabs (only when the tabs can't hold it): a small tile
    return panel(w, h("div", { class: "progress-val" }, withUnit(w.value, w.unit)));
  }
  return null;
}

// -------------------------------------------------------------------- pages
const App = { days: 30, selected: null, key: "", timer: null, slug: null, folder: "", editing: null, busy: false, refreshError: "" };
try { App.days = Number(localStorage.getItem("clodfarm.dash.days")) || 30; } catch { /* storage may be blocked */ }
const RANGE_LABEL = { 1: "vs 24h ago", 7: "vs 7d ago", 30: "vs 30d ago", 90: "vs 90d ago" };

const folderHref = f => `${BASE}/dashboards${f ? `?folder=${encodeURIComponent(f)}` : ""}`;
const parts = f => (f ? f.split("/") : []);

/** The breadcrumb: Dashboards / each folder above this page / this page (a dashboard, or the open folder). */
function crumbs(title, folder = "") {
  const up = parts(folder);
  fill($("#crumb-folders"), up.map((name, i) => [h("span", { class: "sep", "aria-hidden": "true", text: "/" }),
    h("a", { href: folderHref(up.slice(0, i + 1).join("/")), text: name })]));
  $("#crumb-here").textContent = title || "";
  $("#crumb-sep").hidden = !title;
  $("#crumb-all").toggleAttribute("aria-current", !title && !up.length);
  document.title = [title, ...up.reverse(), "Dashboards", "clodfarm"].filter(Boolean).join(" · ");
}

/** An inline one-field form (moving a dashboard, renaming a folder): Enter saves, Escape or CANCEL closes. */
function inlineForm({ value, label, hint, names, save }) {
  const list = "folders-" + Math.random().toString(36).slice(2, 8), err = h("span", { class: "form-error", role: "alert" });
  const input = h("input", { value, "aria-label": label, placeholder: hint, list, autocomplete: "off", spellcheck: "false" });
  const close = () => { App.editing = null; App.key = ""; route(); };
  const form = h("form", { class: "inline-form", onsubmit: async (e) => {
      e.preventDefault(); err.textContent = "";
      try { await save(input.value.trim()); close(); } catch (x) { err.textContent = x.message; }
    }, onkeydown: e => { if (e.key === "Escape") close(); }, onclick: e => e.stopPropagation() },
    h("label", { class: "lbl", text: label }), input, h("datalist", { id: list }, names.map(n => h("option", { value: n }))),
    h("div", { class: "row" }, h("button", { type: "submit", class: "btn primary", text: "SAVE" }),
      h("button", { type: "button", class: "btn", text: "CANCEL", onclick: close })), err);
  requestAnimationFrame(() => { input.focus(); input.select(); });
  return form;
}

function dashCard(r, folders) {
  const card = h("a", { class: "card dash-card", href: `${BASE}/dashboards/${r.slug}` },
    h("div", {}, h("h2", { text: r.title }), r.description ? h("p", { class: "lede", text: r.description }) : null),
    r.stats.length ? h("div", { class: "mini-stats" }, r.stats.map(st => h("div", { class: "mini-stat" },
      h("div", { class: "lbl", text: st.label || st.key }),
      h("div", { class: "val", text: withUnit(st.value, st.unit) }),
      deltaEl(delta(st.points, st.value, st.good)),
      sparkline(st.points)))) : h("p", { class: "muted small", text: `${r.widgets} widget${r.widgets === 1 ? "" : "s"}` }),
    h("div", { class: "card-foot" },
      h("span", { text: `Updated ${ago(r.updated)}` }), r.owner ? h("span", { text: `by ${r.owner}` }) : null,
      r.refreshing ? h("span", { class: "badge busy" }, h("i", { class: "dot" }), "REFRESHING")
        : r.live ? h("span", { class: `badge${r.ok === false ? " bad" : ""}` }, h("i", { class: "dot" }), r.ok === false ? "REFRESH FAILING" : `LIVE · EVERY ${every(r.every).toUpperCase()}`) : null));
  const moving = App.editing === `move:${r.slug}`;
  return h("div", { class: "dash-slot" }, card,
    moving ? h("div", { class: "card slot-form" }, inlineForm({ value: r.folder, label: `MOVE “${r.title}” TO`, hint: "Folder, e.g. Growth/Leads (empty: top level)",
      names: folders, save: folder => post(`dashboards/${r.slug}/move`, { folder }) }))
      : h("button", { type: "button", class: "btn small move", title: "Move it to another folder, or a new one",
        text: "MOVE", onclick: () => { App.editing = `move:${r.slug}`; App.key = ""; route(); } }));
}

async function listPage(quiet) {
  const here = App.folder;
  crumbs(parts(here).at(-1) || null, parts(here).slice(0, -1).join("/"));
  $("#range").hidden = true;
  let rows;
  try { rows = await api("dashboards"); App.busy = rows.some(r => r.refreshing); }
  catch (e) { if (e.status === 403) return App.key === "403" ? null : forPeople(); if (!quiet) fill($("#main"), h("p", { class: "muted", text: e.message })); return; }
  const key = JSON.stringify([rows, here, App.editing]);
  if (key === App.key || (quiet && App.editing)) return; // never redraw under a half-typed folder name
  App.key = key;

  // every folder that has a dashboard somewhere under it, and this folder's own subfolders with how much is in them
  const folders = [...new Set(rows.flatMap(r => parts(r.folder).map((_, i, a) => a.slice(0, i + 1).join("/"))))].sort();
  const inside = f => f === here || (here ? f.startsWith(here + "/") : true);
  const subs = new Map();
  for (const r of rows.filter(r => r.folder && r.folder !== here && inside(r.folder))) {
    const name = parts(r.folder)[parts(here).length], sub = [...parts(here), name].join("/"), x = subs.get(sub) || { n: 0, updated: 0 };
    subs.set(sub, { n: x.n + 1, updated: Math.max(x.updated, r.updated || 0) });
  }
  const mine = rows.filter(r => (r.folder || "") === here);

  const renaming = App.editing === `rename:${here}`;
  const head = h("div", { class: "page-head" },
    h("div", { class: "head-row" }, h("h1", { text: here ? upperName(parts(here).at(-1)) : "DASHBOARDS" }),
      here && !renaming ? h("button", { type: "button", class: "btn small", text: "RENAME FOLDER", title: "Rename it (its dashboards and subfolders go along)",
        onclick: () => { App.editing = `rename:${here}`; App.key = ""; route(); } }) : null),
    renaming ? h("div", { class: "card slot-form" }, inlineForm({ value: here, label: "RENAME THIS FOLDER TO", hint: "e.g. Growth/Leads; an existing folder's name merges them",
      names: folders, save: async to => { await post("dashboards/rename-folder", { from: here, to }); App.folder = to; history.replaceState(null, "", folderHref(to)); } })) : null,
    h("p", { class: "lede", text: here ? `${mine.length} dashboard${mine.length === 1 ? "" : "s"} here${subs.size ? ` and ${subs.size} folder${subs.size === 1 ? "" : "s"}` : ""}. Move a dashboard with its MOVE button; a new folder name makes the folder.`
      : "Pages the Claudes on this farm build and keep up to date, so you can see what is getting better." }));
  if (!rows.length) {
    return fill($("#main"), head, h("section", { class: "card empty" },
      h("h2", { text: "No dashboards yet" }),
      h("p", { class: "muted", text: "Ask your Claude for one, for example: “Keep a dashboard of the test suite: pass rate, run time and the slowest tests, refreshed every hour.”" }),
      h("p", { class: "muted", text: "Or log a number yourself from the farm's shell:" }),
      h("pre", { text: "clodfarm dashboard metric tests pass_rate 97.2 --unit % --good up\nclodfarm dashboard push tests --run \"python3 dashboards/tests.py\" --every 1h" })));
  }
  const tiles = [...subs].sort(([a], [b]) => a.localeCompare(b)).map(([f, x]) => h("a", { class: "card folder-tile", href: folderHref(f) },
    h("span", { class: "folder-icon", "aria-hidden": "true" }), h("h2", { text: parts(f).at(-1) }),
    h("span", { class: "muted", text: `${x.n} dashboard${x.n === 1 ? "" : "s"} · updated ${ago(x.updated)}` })));
  fill($("#main"), head,
    tiles.length ? h("section", { "aria-label": "Folders" }, h("div", { class: "folders" }, tiles)) : null,
    mine.length ? h("div", { class: "list" }, mine.map(r => dashCard(r, folders)))
      : here && !tiles.length ? h("p", { class: "muted", text: "Nothing in this folder any more." }) : null);
}
const upperName = n => String(n || "").toUpperCase();

/** Someone only watching the farm (403): dashboards are for its people. No redirect: the farm can't log them in. */
function forPeople() {
  crumbs(null);
  $("#range").hidden = true;
  App.key = "403";
  return fill($("#main"), h("div", { class: "page-head" }, h("h1", { text: "DASHBOARDS" })),
    h("section", { class: "card empty" },
      h("h2", { text: "Dashboards are for the farm's people" }),
      h("p", { class: "lede", text: "Sign in to your Claude (MY CLAUDE on the farm) or as the manager to see them." }),
      h("p", {}, h("a", { class: "btn primary", href: `${BASE}/`, text: "← BACK TO THE FARM" }))));
}

async function dashPage(slug, quiet) {
  $("#range").hidden = false;
  for (const b of $$("#range button")) b.setAttribute("aria-pressed", String(Number(b.dataset.days) === App.days));
  let d;
  try { d = await api(`dashboards/${slug}?days=${App.days}`); App.busy = !!d.requested?.busy; }
  catch (e) {
    if (e.status === 403) return App.key === "403" ? null : forPeople();
    if (quiet) return;
    crumbs(slug);
    return fill($("#main"), h("h1", { text: e.status === 404 ? "No such dashboard" : "Could not load it" }),
      h("p", { class: "lede" }, e.status === 404 ? ["There is no dashboard called ", h("code", { text: slug }), ". "] : e.message + " ", h("a", { href: `${BASE}/dashboards`, text: "See all dashboards" }), "."));
  }
  const key = JSON.stringify([d, App.selected]);
  if (key === App.key) return;
  App.key = key;
  crumbs(d.title, d.folder);
  const now = Date.now() / 1000, from = now - d.days * 86400;
  const stats = Object.fromEntries(d.widgets.filter(w => w.type === "stat").map(w => [w.key, w]));
  const hist = k => d.history.filter(p => p.values[k] != null).map(p => [p.at, p.values[k]]);
  const ctx = { stats, hist, from, to: now };
  const statList = Object.values(stats);
  if (!statList.some(x => x.key === App.selected)) App.selected = statList[0]?.key || null;

  const q = d.requested, busy = !!q?.busy;
  const meta = h("div", { class: "meta" },
    d.can_refresh || busy ? refreshButton(d) : null,
    h("span", { class: "chip" }, "UPDATED ", h("b", { text: ago(d.updated).toUpperCase() })),
    d.owner ? h("span", { class: "chip" }, "KEPT BY ", h("b", { text: d.owner.toUpperCase() })) : null,
    d.refresh ? h("span", { class: `chip${d.refresh.ok === false ? " bad" : ""}`, title: `Runs \`${d.refresh.cmd}\` in the repo` },
      h("i", { class: "dot" }), d.refresh.ok === false ? "REFRESH FAILING"
        : d.refresh.every ? ["LIVE · EVERY ", h("b", { text: every(d.refresh.every).toUpperCase() })] : "ON DEMAND") : null,
    d.refresh ? h("span", { class: "chip cmd", text: d.refresh.cmd }) : null);
  const out = [h("div", { class: "page-head" }, h("h1", { text: d.title }), d.description ? h("p", { class: "lede", text: d.description }) : null, meta)];
  if (App.refreshError) out.push(h("div", { class: "banner", role: "alert" },
    h("strong", { text: "Could not refresh it. " }), App.refreshError));
  if (d.refresh?.ok === false) out.push(h("div", { class: "banner", role: "alert" },
    h("strong", { text: `The last refresh failed (${ago(d.refresh.last_at)}). ` }), "The page shows the last good data, and the Claude that keeps it got a message to fix it.",
    h("pre", { text: d.refresh.error || "" })));
  else if (q?.kind === "agent" && q.ok === false && q.done_at >= (d.updated || 0)) out.push(h("div", { class: "banner", role: "alert" },
    h("strong", { text: `The refresh you asked for didn't bring new data (${ago(q.done_at)}). ` }), "The page shows the last data its Claude pushed.",
    h("pre", { text: q.error || "" })));

  if (statList.length) {
    const sel = stats[App.selected];
    const tabs = h("div", { class: "tabs", role: "tablist", "aria-label": "Stats" }, statList.map(w => {
      const pts = hist(w.key);
      return h("button", { type: "button", class: "tab", role: "tab", "aria-selected": String(w.key === App.selected), "aria-controls": "hero",
        onclick: () => { App.selected = w.key; App.key = ""; dashPage(slug, true); } },
        h("span", { class: "lbl", text: w.label || w.key }),
        h("span", { class: "val" }, num(w.value), w.unit ? h("small", { text: w.unit }) : null),
        deltaEl(delta(pts, w.value, w.good), RANGE_LABEL[d.days]),
        w.target != null ? h("span", { class: "target", text: `Target ${withUnit(w.target, w.unit)}` }) : null);
    }));
    const hero = h("div", { class: "hero-chart", id: "hero", role: "tabpanel" },
      lineChart([{ name: sel.label || sel.key, points: hist(sel.key) }], { unit: sel.unit || "", height: 260, from, to: now }));
    out.push(h("section", { class: "card" }, tabs, hero));
  }
  const rest = d.widgets.filter(w => w.type !== "stat").map(w => widget(w, ctx)).filter(Boolean);
  if (rest.length) out.push(h("div", { class: "grid" }, rest));
  if (!d.widgets.length) out.push(h("p", { class: "muted", text: "This dashboard has no widgets yet." }));
  fill($("#main"), out);
}

/** REFRESH: runs the dashboard's code now, or starts a sub-agent of its Claude to collect the data and push it. While
 * it works the page checks every few seconds, so the new numbers show the moment they land. */
function refreshButton(d) {
  const q = d.requested, busy = !!q?.busy, cmd = !!d.refresh;
  const who = d.owner ? d.owner.toUpperCase() : "ITS CLAUDE";
  const label = busy ? (q.kind === "agent" ? `${who} IS COLLECTING…` : "REFRESHING…") : "REFRESH";
  const title = busy ? `Asked ${ago(q.at)} ago` + (q.kind === "agent" ? `: a sub-agent of ${d.owner || "its Claude"} is collecting fresh data` : "")
    : cmd ? `Run \`${d.refresh.cmd}\` now and show what it measures`
      : `Start a sub-agent of ${d.owner || "its Claude"} to collect fresh data and push it` + (d.agent ? "" : " (it has no refresh code yet)");
  return h("button", { type: "button", class: `btn primary refresh${busy ? " busy" : ""}`, disabled: busy || !d.can_refresh, title,
    "aria-busy": String(busy), onclick: async (e) => {
      e.currentTarget.disabled = true; App.refreshError = "";
      try { await post(`dashboards/${d.slug}/refresh`, {}); }
      catch (x) { App.refreshError = x.message; }
      App.key = ""; route(true);
    } }, h("span", { class: "spin", "aria-hidden": "true" }), label);
}

/** Look again soon while a refresh is under way, else every 30 s (live dashboards change on their own). */
function schedule(busy) {
  clearTimeout(App.timer);
  App.timer = setTimeout(() => { if (!document.hidden) route(true); else schedule(false); }, busy ? 3000 : 30000);
}

function route(quiet = false) {
  const rel = location.pathname.slice(BASE.length).replace(/\/+$/, "");
  const m = rel.match(/^\/dashboards\/([a-z0-9-]{1,48})$/);
  if ((m ? m[1] : null) !== App.slug) App.refreshError = "";
  App.slug = m ? m[1] : null;
  App.folder = new URLSearchParams(location.search).get("folder") || "";
  App.busy = false;
  return Promise.resolve(App.slug ? dashPage(App.slug, quiet) : listPage(quiet)).finally(() => schedule(App.busy));
}

$("#range").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-days]");
  if (!b) return;
  App.days = Number(b.dataset.days); App.key = "";
  try { localStorage.setItem("clodfarm.dash.days", String(App.days)); } catch { /* fine */ }
  route();
});
addEventListener("keydown", (e) => {
  if (e.key === "Escape") $("#tip").hidden = true;
  if (e.key === "ArrowRight" || e.key === "ArrowLeft") { // move between stat tabs
    const tabs = $$(".tab"), i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    next.click(); requestAnimationFrame(() => $$(".tab")[tabs.indexOf(next)]?.focus());
  }
});
addEventListener("visibilitychange", () => { if (!document.hidden) route(true); });
route();
