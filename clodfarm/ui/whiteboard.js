/* Every Claude's whiteboard, in the spirit of Excalidraw: a hand-drawn board (rough.js for the shapes,
 * perfect-freehand for the pen, Virgil for the writing) where you and the Claudes draw together. There are no walls:
 * everyone who can open the farm sees and draws on every Claude's board.
 *
 * The page asks the farm for what changed since the revision it last saw (GET api/boards/<claude>?since=N) about once
 * a second, and sends what you do as ops (POST api/boards/<claude> {ops: [{op: "put", el, z?}, {op: "del", id}]}),
 * drawing them at once without waiting. Undo and redo are yours alone: they undo what you did on this page.
 * Arrows can join two shapes by id (from, to): the page routes them (straight, elbow, curve) from wherever the shapes
 * are, so they follow a shape you move. Frames draw under everything and carry what's inside them when moved.
 * Each element's wobble comes from its seed (its id when it has none), so it looks the same on every screen. */
import rough from "./vendor/rough.esm.js";
import { getStroke } from "./vendor/perfect-freehand.js";

const BASE = document.body.dataset.base || "";
const $ = s => document.querySelector(s);
const cv = $("#board"), ctx = cv.getContext("2d"), stage = $("#stage"), editor = $("#editor");
const gen = rough.generator();
const FONTS = { hand: '"Virgil", "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive', sans: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace', serif: 'Georgia, "Times New Roman", serif' };
const INK = "#1e1e1e", NOTE_FILL = "#ffec99", PRIMARY = "#6965db";
const STROKES = ["#1e1e1e", "#e03131", "#2f9e44", "#1971c2", "#f08c00"];
const BGS = [null, "#ffc9c9", "#b2f2bb", "#a5d8ff", "#ffec99"];
const STROKE_ALL = ["#1e1e1e", "#495057", "#868e96", "#e03131", "#c2255c", "#9c36b5", "#6741d9", "#3b5bdb", "#1971c2", "#0c8599",
  "#099268", "#2f9e44", "#66a80f", "#f08c00", "#e8590c", "#846358", "#ffffff", "#ced4da"];
const BG_ALL = ["#ffffff", "#f8f9fa", "#e9ecef", "#ffc9c9", "#fcc2d7", "#eebefa", "#d0bfff", "#bac8ff", "#a5d8ff", "#99e9f2",
  "#96f2d7", "#b2f2bb", "#d8f5a2", "#ffec99", "#ffd8a8", "#eaddd7", "#343a40", "#1e1e1e"];
const BOXES = ["rect", "ellipse", "diamond", "cylinder", "hexagon", "parallelogram", "cloud", "triangle", "star", "document", "frame", "note", "image"];
const GRID = 20, MAX_IMAGE_CHARS = 190000;

// ------------------------------------------------------------------ icons
const P = { // 24x24 stroke icons (currentColor)
  menu: "M4 6h16M4 12h16M4 18h16",
  lock: "M7 11V8a5 5 0 0 1 10 0v3M5 11h14v9H5zM12 15v2", unlock: "M7 11V8a5 5 0 0 1 9.6-2M5 11h14v9H5zM12 15v2",
  hand: "M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11.5V4a1.5 1.5 0 0 1 3 0v8M14 5.5a1.5 1.5 0 0 1 3 0V12M17 8a1.5 1.5 0 0 1 3 0v6a7 7 0 0 1-7 7h-1c-2.6 0-4-1.2-5.5-3L3.6 15a1.6 1.6 0 0 1 2.3-2.2L8 15",
  select: "M6 3l12 9-5.5 1.5L15.5 20 13 21l-3-6.5L6 18z",
  rect: "M4 5h16v14H4z", diamond: "M12 3l9 9-9 9-9-9z", ellipse: "M12 4a8 8 0 1 0 .01 0z", arrow: "M5 19L19 5M10 5h9v9",
  line: "M5 19L19 5", pen: "M4 20l1.5-5L16 4.5a2.1 2.1 0 0 1 3 3L8.5 18zM14 6.5l3 3", text: "M5 6V4.5h14V6M12 4.5v15M9 19.5h6",
  image: "M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9.5a1 1 0 1 0 .01 0", eraser: "M7 20h12M5.5 13.5l7-7a2 2 0 0 1 2.8 0l3.2 3.2a2 2 0 0 1 0 2.8L12 19H8.5l-3-3a1.8 1.8 0 0 1 0-2.5zM9.5 9.5l5.5 5.5",
  shapes: "M4 13h7v7H4zM17.5 4l4 7h-8zM17.5 14a3 3 0 1 0 .01 0", frame: "M7 3v18M17 3v18M3 7h18M3 17h18",
  note: "M5 4h14v10l-6 6H5zM13 20v-6h6", cylinder: "M5 6c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3zM5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6",
  hexagon: "M7.5 4h9l4.5 8-4.5 8h-9L3 12z", cloud: "M7 18a4 4 0 0 1-.6-8A5.5 5.5 0 0 1 17 8.5a4.8 4.8 0 0 1 .5 9.5z",
  parallelogram: "M7 5h14l-4 14H3z", document: "M5 4h14v13c-3-2-5 3-7 1.5S8 16 5 18z", triangle: "M12 4l9 16H3z",
  star: "M12 3.5l2.6 5.5 6 .8-4.4 4.1 1.1 6-5.3-3-5.3 3 1.1-6L3.4 9.8l6-.8z",
  plus: "M12 5v14M5 12h14", minus: "M5 12h14", undo: "M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11", redo: "M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13",
  trash: "M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3", copy: "M8 8h12v12H8zM16 8V4H4v12h4",
  front: "M12 4v12M7 9l5-5 5 5M5 20h14", back: "M12 20V8M7 15l5 5 5-5M5 4h14", fwd: "M12 6v10M8 10l4-4 4 4M6 19h12",
  bwd: "M12 18V8M8 14l4 4 4-4M6 5h12", download: "M12 4v11M7 10l5 5 5-5M5 20h14", link: "M10 14a4 4 0 0 0 6 .5l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6-.5l-3 3a4 4 0 0 0 6 6l1-1",
  grid: "M4 4h16v16H4zM4 10h16M4 15h16M10 4v16M15 4v16", home: "M4 11l8-7 8 7M6 9.5V20h12V9.5", help: "M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5v.01",
  fit: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  // properties
  w1: "M4 12h16", w2: "M4 12h16", w3: "M4 12h16", solid: "M4 12h16", dashed: "M4 12h3M10.5 12h3M17 12h3", dotted: "M4 12h.01M8 12h.01M12 12h.01M16 12h.01M20 12h.01",
  r0: "M4 16C8 16 10 8 20 8", r1: "M4 17c2-1 2-6 5-6s3 4 6 3 2-6 5-6", r2: "M4 17c1.5-3 3-8 4.5-8s1.5 9 3.5 9 2-10 4-10 2 6 4 6",
  sharp: "M5 19V5h14", round: "M5 19V11a6 6 0 0 1 6-6h8", straight: "M5 19L19 5", elbow: "M5 19v-7h14V5", curve: "M5 19C5 8 19 16 19 5",
  hNone: "M4 12h16", hEnd: "M4 12h16M14 7l6 5-6 5", hBoth: "M4 12h16M14 7l6 5-6 5M10 7l-6 5 6 5",
  aLeft: "M4 6h16M4 10h10M4 14h16M4 18h10", aCenter: "M4 6h16M7 10h10M4 14h16M7 18h10", aRight: "M4 6h16M10 10h10M4 14h16M10 18h10",
  hachure: "M4 4h16v16H4zM4 12l8-8M4 20L20 4M12 20l8-8", cross: "M4 4h16v16H4zM4 12l8-8M4 20L20 4M12 20l8-8M12 4l8 8M4 4l16 16M4 12l8 8",
  solidFill: "M4 4h16v16H4z",
};
const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${name === "w2" ? 3 : name === "w3" ? 5 : 1.8}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${name === "solidFill" ? '<path d="M4 4h16v16H4z" fill="currentColor"/>' : `<path d="${P[name] || ""}"/>`}</svg>`;
const TOOLS = [ // [tool, icon, label, number]
  ["hand", "hand", "Hand: drag to look around (H, or hold space)", ""],
  ["select", "select", "Select (V or 1)", "1"], ["rect", "rect", "Rectangle (R or 2)", "2"],
  ["diamond", "diamond", "Diamond (D or 3)", "3"], ["ellipse", "ellipse", "Ellipse (O or 4)", "4"],
  ["arrow", "arrow", "Arrow (A or 5): drag from one shape to another to join them", "5"], ["line", "line", "Line (L or 6)", "6"],
  ["pen", "pen", "Draw (P or 7)", "7"], ["text", "text", "Text (T or 8)", "8"], ["image", "image", "Insert an image (9)", "9"],
  ["eraser", "eraser", "Eraser (E or 0)", "0"],
];
const MORE = [["frame", "frame", "Frame (F): a titled area that groups what's inside"], ["note", "note", "Sticky note (N)"],
  ["cylinder", "cylinder", "Database (C)"], ["hexagon", "hexagon", "Hexagon"], ["cloud", "cloud", "Cloud"],
  ["parallelogram", "parallelogram", "Input / output"], ["document", "document", "Document"], ["triangle", "triangle", "Triangle"], ["star", "star", "Star"]];
const KEYS = { h: "hand", v: "select", 1: "select", r: "rect", 2: "rect", d: "diamond", 3: "diamond", o: "ellipse", 4: "ellipse",
  a: "arrow", 5: "arrow", l: "line", 6: "line", p: "pen", x: "pen", 7: "pen", t: "text", 8: "text", 9: "image", e: "eraser", 0: "eraser",
  f: "frame", n: "note", c: "cylinder" };
const ALL_TOOLS = [...TOOLS.map(t => t[0]), ...MORE.map(t => t[0])];

// ------------------------------------------------------------------ state
let dirty = true;
class Els extends Map { // the board's elements; any change re-sorts them (for drawing and hit tests) when next needed
  set(k, v) { dirty = true; return super.set(k, v); }
  delete(k) { dirty = true; return super.delete(k); }
}
let boards = [], cur = null, rev = 0, els = new Els(), loaded = false, ordered = [];
let view = { x: -40, y: -80, z: 1 }, dpr = 1, W = 0, H = 0;
const style = Object.assign({ stroke: INK, bg: null, fill_style: "hachure", width: 2, dash: "solid", roughness: 1, round: true,
  size: 20, font: "hand", align: "left", opacity: 1, route: "straight", head: "end" }, remembered("style") || {});
let tool = "select", locked = false, grid = !!remembered("grid");
let sel = new Set(), act = null, editing = null, space = false, hover = null;
const pointers = new Map(), images = new Map(), shapesCache = new Map();
let pinch = null, undo = [], redo = [], pollT = null, failing = 0, fitted = false, clip = null, topZ = 1e13;

function remembered(k) { try { return JSON.parse(localStorage.getItem("clodfarm.wb2." + k)); } catch { return null; } }
function remember(k, v) { try { localStorage.setItem("clodfarm.wb2." + k, JSON.stringify(v)); } catch { /* private mode */ } }

async function api(path, body) {
  const opts = { credentials: "same-origin", headers: { Accept: "application/json" } };
  if (body !== undefined) Object.assign(opts, { method: "POST", body: JSON.stringify(body),
    headers: { ...opts.headers, "Content-Type": "application/json", "X-Clodfarm": "1" } });
  const r = await fetch(`${BASE}/api/${path}`, opts);
  if (r.status === 401) { location.replace(`${BASE}/?next=whiteboard`); throw new Error("log in first"); }
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(out.error || r.statusText), { status: r.status });
  return out;
}
const newId = () => Date.now().toString(16) + Math.random().toString(16).slice(2, 8);
const strip = e => { const o = {}; for (const [k, v] of Object.entries(e)) if (!k.startsWith("_") && !["z", "by", "rev", "at"].includes(k) && v !== undefined) o[k] = v; return o; };
const isBox = e => !!e && BOXES.includes(e.type);
const isLine = e => !!e && (e.type === "line" || e.type === "arrow");
const hasText = e => !!e && (e.type === "text" || e.type === "note" || !!e.text);
const snap = (v, ev) => (ev && ev.altKey) || !grid ? Math.round(v) : Math.round(v / GRID) * GRID;
const round = v => Math.round(v * 10) / 10;
const rect = (x0, y0, x1, y1) => [Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)];

// ------------------------------------------------------------------ status
let toastT = 0;
function toast(text) { const t = $("#toast"); t.textContent = text; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2600); }
function live(text, cls) { $("#live").className = "live " + (cls || ""); $("#live-text").textContent = text; }
function ago(t) {
  const s = Math.max(0, Date.now() / 1000 - t);
  return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`;
}
function whoDid(by) {
  if (!by) return "";
  const [kind, id] = String(by).split(":");
  const name = boards.find(b => b.claude === id)?.name || id || kind;
  return kind === "claude" ? `${name}'s Claude` : kind === "person" ? name : "a visitor";
}
const boardTitle = b => !b ? "Whiteboard" : b.mine ? "Your board" : `${b.name}'s board`;

// ------------------------------------------------------------------ boards
async function loadBoards() {
  try { boards = await api("boards"); } catch (e) { if (!boards.length) toast(e.message); return; }
  if (!boards.length) { live("no Claudes yet", "off"); toast("No Claudes on this farm yet: hatch one, and it gets a whiteboard."); return; }
  const want = decodeURIComponent(location.pathname.replace(/\/+$/, "").split("/whiteboard/")[1] || "");
  if (!cur) pick((boards.find(b => b.claude === want) || boards.find(b => b.mine) || boards[0]).claude);
  renderBoards();
}
function renderBoards() {
  const b = boards.find(x => x.claude === cur);
  $("#board-name").textContent = boardTitle(b);
  document.title = `${boardTitle(b)} · clodfarm`;
  $("#boards").replaceChildren(...boards.map(x => {
    const a = document.createElement("button");
    a.type = "button"; a.className = "mi"; a.setAttribute("role", "option"); a.setAttribute("aria-selected", String(x.claude === cur));
    a.innerHTML = icon("rect");
    const name = document.createElement("span"); name.textContent = x.mine ? `${x.name} (yours)` : `${x.name}'s board`;
    const k = document.createElement("span"); k.className = "k";
    k.textContent = `${x.claude === cur && loaded ? els.size : x.count} · ${x.updated ? ago(x.updated) : "empty"}`;
    a.append(name, k);
    a.onclick = () => { closePops(); pick(x.claude); };
    return a;
  }));
}
function pick(claude) {
  if (claude === cur) return;
  commitEditor();
  cur = claude; rev = 0; els = new Els(); loaded = false; sel = new Set(); undo = []; redo = []; fitted = false; act = null;
  shapesCache.clear();
  history.replaceState(null, "", `${BASE}/whiteboard/${encodeURIComponent(claude)}`);
  renderBoards(); updateChrome(); draw(); poll();
}

// ------------------------------------------------------------------- sync
async function poll() {
  clearTimeout(pollT);
  const for_ = cur;
  if (!for_) return;
  try {
    const r = await api(`boards/${encodeURIComponent(for_)}?since=${rev}`);
    if (for_ !== cur) return;
    const busy = new Set(act && act.orig ? Object.keys(act.orig) : []);
    if (editing) busy.add(editing.id);
    if (r.full) {
      const keep = [...busy].map(id => els.get(id)).filter(Boolean);
      els = new Els(r.items.map(e => [e.id, e]));
      for (const e of keep) els.set(e.id, e);
    } else {
      for (const e of r.items) {
        if (busy.has(e.id)) continue; // you have it in hand: yours wins until you let go
        if (e.deleted) els.delete(e.id); else els.set(e.id, e);
      }
    }
    for (const id of [...sel]) if (!els.has(id)) sel.delete(id);
    rev = r.rev; loaded = true; failing = 0;
    live(r.updated ? `Live · ${whoDid(r.updated_by)} ${ago(r.updated)}` : "Live");
    if (!fitted) { fitted = true; if (els.size) fit(); }
    const b = boards.find(x => x.claude === cur);
    if (b && b.count !== els.size) { b.count = els.size; renderBoards(); }
    if (r.items.length || r.full) updateChrome();
    draw();
  } catch (e) {
    failing++;
    live(failing > 2 ? "offline · retrying" : "connecting…", failing > 2 ? "bad" : "off");
    if (e.status === 404) toast(e.message);
  }
  pollT = setTimeout(poll, document.hidden ? 5000 : failing ? Math.min(10000, 1000 * failing) : 900);
}
async function send(ops) {
  const for_ = cur;
  for (let i = 0; i < ops.length; i += 400) { // a pasted board goes in parts
    try {
      const r = await api(`boards/${encodeURIComponent(for_)}`, { ops: ops.slice(i, i + 400) });
      if (for_ !== cur) return;
      for (const e of r.items) if (!e.deleted && els.has(e.id) && !(act && act.orig && act.orig[e.id])) els.set(e.id, { ...els.get(e.id), z: e.z, by: e.by, rev: e.rev });
    } catch (e) {
      toast(e.message);
      rev = 0; return poll(); // what the farm has is what counts
    }
  }
  draw();
}
// a change you made: drawn now, sent, and undoable (before[i] -> after[i]; null is "not there")
function change(before, after) {
  const ops = [];
  after.forEach((a, i) => {
    const b = before[i];
    if (a) {
      if (a.z === undefined) a.z = ++topZ;
      els.set(a.id, a);
      const op = { op: "put", el: strip(a) };
      if (b && a.z !== b.z) op.z = a.z;
      ops.push(op);
    } else if (b) { els.delete(b.id); sel.delete(b.id); ops.push({ op: "del", id: b.id }); }
  });
  if (!ops.length) return;
  undo.push({ before: before.map(x => x && { ...x }), after: after.map(x => x && { ...x }) }); if (undo.length > 300) undo.shift();
  redo = [];
  send(ops); updateChrome(); draw();
}
function replay(step, back) {
  const from = back ? step.after : step.before, to = back ? step.before : step.after, ops = [];
  to.forEach((e, i) => {
    const id = (e || from[i]).id;
    if (e) { els.set(id, { ...e }); const op = { op: "put", el: strip(e) }; if (e.z !== undefined && e.z < 1e13) op.z = e.z; ops.push(op); }
    else if (els.has(id)) { els.delete(id); ops.push({ op: "del", id }); }
  });
  if (ops.length) send(ops);
  sel = new Set(); updateChrome(); draw();
}
function doUndo() { commitEditor(); const s = undo.pop(); if (s) { replay(s, true); redo.push(s); updateChrome(); } }
function doRedo() { const s = redo.pop(); if (s) { replay(s, false); undo.push(s); updateChrome(); } }

// --------------------------------------------------------------- the view
const toBoard = (sx, sy) => [sx / view.z + view.x, sy / view.z + view.y];
const toScreen = (bx, by) => [(bx - view.x) * view.z, (by - view.y) * view.z];
function resize() {
  dpr = window.devicePixelRatio || 1;
  W = stage.clientWidth; H = stage.clientHeight;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  draw();
}
function zoomAt(sx, sy, f) {
  const [bx, by] = toBoard(sx, sy);
  view.z = Math.max(0.05, Math.min(10, view.z * f));
  view.x = bx - sx / view.z; view.y = by - sy / view.z;
  placeEditor(); draw();
}
function zoomTo(z) { zoomAt(W / 2, H / 2, z / view.z); }
function bounds(list) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const e of list) { const [x, y, w, h] = bbox(e); x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h); }
  return x0 === Infinity ? null : [x0, y0, x1 - x0, y1 - y0];
}
function fit() {
  const b = bounds(els.values());
  if (!b) { view = { x: -40, y: -80, z: 1 }; placeEditor(); return draw(); }
  const padX = 60, padTop = 80, padBottom = 70;
  const z = Math.max(0.05, Math.min(1.5, (W - padX * 2) / Math.max(b[2], 1), (H - padTop - padBottom) / Math.max(b[3], 1)));
  view = { z, x: b[0] + b[2] / 2 - W / 2 / z, y: b[1] + b[3] / 2 - (H + padTop - padBottom) / 2 / z };
  placeEditor(); draw();
}

// ------------------------------------------------------------- geometry
const center = b => [b.x + b.w / 2, b.y + b.h / 2];
function clipTo(b, tx, ty) { // where the line from b's center towards (tx, ty) leaves b
  const [cx, cy] = center(b), dx = tx - cx, dy = ty - cy;
  if (!dx && !dy) return [cx, cy];
  const hw = Math.max(b.w / 2, 1), hh = Math.max(b.h / 2, 1);
  const s = (b.type === "ellipse" || b.type === "cloud") ? 1 / Math.hypot(dx / hw, dy / hh)
    : b.type === "diamond" ? 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh) : 1 / Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh);
  return [cx + dx * s, cy + dy * s];
}
function gapOut(p, from, g) { const d = Math.hypot(p[0] - from[0], p[1] - from[1]) || 1; return [p[0] + (p[0] - from[0]) / d * g, p[1] + (p[1] - from[1]) / d * g]; }
function ends(e) {
  const A = e.from ? els.get(e.from) : null, B = e.to ? els.get(e.to) : null;
  return [isBox(A) ? A : null, isBox(B) ? B : null];
}
function side(b, toward) { // the middle of the side of b that faces a point, and the way out of it
  const [cx, cy] = center(b), dx = toward[0] - cx, dy = toward[1] - cy;
  return Math.abs(dx) - b.w / 2 >= Math.abs(dy) - b.h / 2 ? [[cx + Math.sign(dx || 1) * (b.w / 2 + 5), cy], [Math.sign(dx || 1), 0]]
    : [[cx, cy + Math.sign(dy || 1) * (b.h / 2 + 5)], [0, Math.sign(dy || 1)]];
}
function viaRoute(e, A, B) { // a laid-out edge: through its way points
  const v = e.via, r = e.route || "straight";
  const [s, ds] = A ? (r === "straight" ? [gapOut(clipTo(A, ...v[0]), center(A), 5), null] : side(A, v[0])) : [[e.x1, e.y1], null];
  const [t, dt] = B ? (r === "straight" ? [gapOut(clipTo(B, ...v[v.length - 1]), center(B), 5), null] : side(B, v[v.length - 1])) : [[e.x2, e.y2], null];
  const Pp = [s, ...v, t];
  if (r === "curve") { // Catmull-Rom through them, as béziers
    const pts = [Pp[0]], segs = [];
    for (let i = 0; i < Pp.length - 1; i++) {
      const p0 = Pp[i - 1] || Pp[i], p1 = Pp[i], p2 = Pp[i + 1], p3 = Pp[i + 2] || Pp[i + 1];
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      segs.push([c1, c2, p2]);
      for (let k = 1; k <= 12; k++) { const u = k / 12, w = 1 - u; pts.push([w * w * w * p1[0] + 3 * w * w * u * c1[0] + 3 * w * u * u * c2[0] + u * u * u * p2[0], w * w * w * p1[1] + 3 * w * w * u * c1[1] + 3 * w * u * u * c2[1] + u * u * u * p2[1]]); }
    }
    return { pts, segs };
  }
  if (r === "straight") return { pts: Pp };
  const pts = [Pp[0]];
  for (let i = 1; i < Pp.length; i++) {
    const p = pts[pts.length - 1], q = Pp[i], horiz = i === 1 && ds ? ds[0] !== 0 : i === Pp.length - 1 && dt ? dt[0] !== 0 : Math.abs(q[0] - p[0]) >= Math.abs(q[1] - p[1]);
    if (Math.abs(q[0] - p[0]) > 0.5 && Math.abs(q[1] - p[1]) > 0.5) {
      if (horiz) { const mx = (p[0] + q[0]) / 2; pts.push([mx, p[1]], [mx, q[1]]); } else { const my = (p[1] + q[1]) / 2; pts.push([p[0], my], [q[0], my]); }
    }
    pts.push(q);
  }
  return { pts };
}
function layers() { // the elements bottom first, frames under everything; sorted again only after a change
  if (dirty || ordered.length !== els.size) { dirty = false; ordered = [...els.values()].sort(order); pairUp(); }
  return ordered;
}
const order = (a, b) => ((a.type === "frame") - (b.type === "frame")) * -1 || (a.z || 0) - (b.z || 0) || (a.id < b.id ? -1 : 1);
function pairUp() { // arrows joining the same two shapes (either way) are spread apart, not drawn on top of each other
  const pairs = new Map();
  for (const e of ordered) {
    e._off = 0;
    if (!isLine(e) || !e.from || !e.to || (e.via && e.via.length)) continue;
    const k = e.from < e.to ? e.from + "|" + e.to : e.to + "|" + e.from;
    if (!pairs.has(k)) pairs.set(k, []);
    pairs.get(k).push(e);
  }
  for (const list of pairs.values()) if (list.length > 1) list.forEach((e, i) => { e._off = (i - (list.length - 1) / 2) * 22 * (e.from < e.to ? 1 : -1); });
}
function shifted(r, e) {
  if (!e._off) return r;
  const p = r.pts, a = p[0], b = p[p.length - 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const nx = -(b[1] - a[1]) / L * e._off, ny = (b[0] - a[0]) / L * e._off, mv = q => [q[0] + nx, q[1] + ny];
  return { pts: p.map(mv), ...(r.bez ? { bez: r.bez.map(mv) } : {}) };
}
function route(e) { return shifted(route0(e), e); }
function route0(e) { // the points a line runs through (a curve: its bezier too), from wherever the shapes it joins are
  const [A, B] = ends(e);
  if (e.via && e.via.length) return viaRoute(e, A, B);
  const pa = A ? center(A) : [e.x1, e.y1], pb = B ? center(B) : [e.x2, e.y2];
  const r = e.route || "straight";
  if (r === "straight" || (!A && !B)) {
    if (r === "curve" && !A && !B) { // a free curve: a gentle bow
      const mx = (pa[0] + pb[0]) / 2, my = (pa[1] + pb[1]) / 2, nx = -(pb[1] - pa[1]) * 0.2, ny = (pb[0] - pa[0]) * 0.2;
      return bez(pa, [mx + nx, my + ny], [mx + nx, my + ny], pb);
    }
    return { pts: [A ? gapOut(clipTo(A, ...pb), pa, 5) : pa, B ? gapOut(clipTo(B, ...pa), pb, 5) : pb] };
  }
  let horiz;
  if (A && B) horiz = (Math.abs(pb[0] - pa[0]) - (A.w + B.w) / 2) >= (Math.abs(pb[1] - pa[1]) - (A.h + B.h) / 2);
  else horiz = Math.abs(pb[0] - pa[0]) >= Math.abs(pb[1] - pa[1]);
  let s, t, d;
  if (horiz) {
    const dir = Math.sign(pb[0] - pa[0]) || 1; d = [dir, 0];
    s = A ? [pa[0] + dir * (A.w / 2 + 5), pa[1]] : pa; t = B ? [pb[0] - dir * (B.w / 2 + 5), pb[1]] : pb;
  } else {
    const dir = Math.sign(pb[1] - pa[1]) || 1; d = [0, dir];
    s = A ? [pa[0], pa[1] + dir * (A.h / 2 + 5)] : pa; t = B ? [pb[0], pb[1] - dir * (B.h / 2 + 5)] : pb;
  }
  if (r === "curve") {
    const k = Math.max(30, Math.hypot(t[0] - s[0], t[1] - s[1]) * 0.45);
    return bez(s, [s[0] + d[0] * k, s[1] + d[1] * k], [t[0] - d[0] * k, t[1] - d[1] * k], t);
  }
  if (horiz) { const mx = (s[0] + t[0]) / 2; return { pts: Math.abs(s[1] - t[1]) < 1 ? [s, t] : [s, [mx, s[1]], [mx, t[1]], t] }; }
  const my = (s[1] + t[1]) / 2;
  return { pts: Math.abs(s[0] - t[0]) < 1 ? [s, t] : [s, [s[0], my], [t[0], my], t] };
}
function bez(s, c1, c2, t) {
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const u = i / 24, v = 1 - u;
    pts.push([v * v * v * s[0] + 3 * v * v * u * c1[0] + 3 * v * u * u * c2[0] + u * u * u * t[0],
      v * v * v * s[1] + 3 * v * v * u * c1[1] + 3 * v * u * u * c2[1] + u * u * u * t[1]]);
  }
  return { pts, bez: [s, c1, c2, t] };
}
function midOf(pts) { // halfway along a polyline
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  let left = total / 2;
  for (let i = 1; i < pts.length; i++) {
    const L = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (L >= left && L > 0) { const u = left / L; return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * u, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * u]; }
    left -= L;
  }
  return pts[0];
}
function bbox(e) {
  if (e.type === "path" || isLine(e)) {
    const pts = e.type === "path" ? e.points : route(e).pts;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const pad = e.type === "path" ? (e.width || 2) * 1.5 : 0;
    return [x0 - pad, y0 - pad, x1 - x0 + pad * 2, y1 - y0 + pad * 2];
  }
  if (e.type === "text") { const [w, h] = measure(e); return [e.x, e.y, w, h]; }
  return [e.x, e.y, e.w, e.h];
}

// ---------------------------------------------------------------- text
const fontOf = (e, size) => `${e.bold ? "700 " : ""}${size || e.size || 20}px ${FONTS[e.font] || FONTS.hand}`;
function wrap(text, font, maxW) {
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.font = font;
  const out = [];
  for (const para of String(text).split("\n")) {
    let line = "";
    for (const word of para.split(/(\s+)/)) {
      const next = line + word;
      if (line && ctx.measureText(next).width > maxW && word.trim()) { out.push(line.trimEnd()); line = word.trimStart(); }
      else line = next;
    }
    out.push(line);
  }
  ctx.restore();
  return out;
}
function measure(e) { // a text's size, measured once for its text and font
  const key = e.text + "|" + fontOf(e);
  if (e._key !== key) {
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.font = fontOf(e);
    const lines = String(e.text).split("\n");
    e._w = Math.max(8, ...lines.map(l => ctx.measureText(l).width)); e._h = lines.length * e.size * 1.25; e._key = key;
    ctx.restore();
  }
  return [e._w, e._h];
}
function inner(e) { // where a shape's label goes: x, y, w, h
  const { x, y, w, h } = e;
  const f = { diamond: [0.62, 0.6], ellipse: [0.76, 0.74], cloud: [0.66, 0.6], hexagon: [0.78, 0.9], parallelogram: [0.72, 0.9],
    triangle: [0.56, 0.5], star: [0.42, 0.38], document: [0.9, 0.78], cylinder: [0.9, 0.62] }[e.type] || [1, 1];
  const iw = Math.max(10, w * f[0] - 20), ih = Math.max(10, h * f[1] - 12);
  let cy = y + h / 2;
  if (e.type === "triangle") cy = y + h * 0.66; else if (e.type === "cylinder") cy = y + h * 0.56; else if (e.type === "document") cy = y + h * 0.44;
  return [x + (w - iw) / 2, cy - ih / 2, iw, ih];
}
function paintLines(g, lines, e, x, y, w, align) {
  const lh = e.size * 1.25;
  g.textBaseline = "top";
  lines.forEach((l, i) => {
    const lw = align === "left" ? 0 : g.measureText(l).width;
    const lx = align === "center" ? x + (w - lw) / 2 : align === "right" ? x + w - lw : x;
    g.fillText(l, lx, y + i * lh + e.size * 0.12);
  });
}
function paintLabel(g, e) {
  if (!e.text || (editing && editing.id === e.id)) return;
  g.save();
  g.fillStyle = e.text_color || (e.type === "frame" ? e.color || "#868e96" : e.type === "note" ? e.color || INK : INK);
  g.font = fontOf(e);
  if (e.type === "note") {
    const pad = Math.min(14, e.w / 8);
    g.beginPath(); g.rect(e.x, e.y, e.w, e.h); g.clip();
    paintLines(g, wrap(e.text, g.font, e.w - pad * 2), e, e.x + pad, e.y + pad, e.w - pad * 2, e.align || "left");
  } else if (e.type === "frame") { // its name, just above it
    const size = Math.min(e.size || 18, 22);
    g.font = fontOf({ ...e, size });
    g.textBaseline = "bottom";
    g.fillText(String(e.text).split("\n")[0], e.x + 4, e.y - 6);
  } else {
    const [ix, iy, iw, ih] = inner(e), lines = wrap(e.text, g.font, iw), th = lines.length * e.size * 1.25;
    paintLines(g, lines, e, ix, iy + Math.max(0, (ih - th) / 2), iw, e.align || "center");
  }
  g.restore();
}

// ------------------------------------------------------------- painting
function seedOf(e) {
  if (e.seed) return e.seed;
  let h = 2166136261;
  for (const c of String(e.id)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0) % 2147483646 + 1;
}
function ropts(e, noFill) {
  const sw = e.width === undefined ? 2 : e.width;
  const o = { seed: seedOf(e), roughness: e.roughness === undefined ? 1 : e.roughness, bowing: 1, stroke: sw > 0 ? e.color || INK : "transparent",
    strokeWidth: Math.max(sw, 0.5), preserveVertices: true };
  if (e.fill && !noFill) Object.assign(o, { fill: e.fill, fillStyle: e.fill_style || "hachure", hachureGap: Math.max(sw, 1) * 4 + 2, fillWeight: Math.max(sw, 1) / 2 });
  if (e.dash === "dashed") Object.assign(o, { strokeLineDash: [8 + sw * 2, 7 + sw * 2], disableMultiStroke: true });
  else if (e.dash === "dotted") Object.assign(o, { strokeLineDash: [1.5, 5 + sw * 2], disableMultiStroke: true });
  return o;
}
const pt = p => `${round(p[0])} ${round(p[1])}`;
function roundRectPath(x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  return `M${x + r} ${y} L${x + w - r} ${y} Q${x + w} ${y} ${x + w} ${y + r} L${x + w} ${y + h - r} Q${x + w} ${y + h} ${x + w - r} ${y + h} ` +
    `L${x + r} ${y + h} Q${x} ${y + h} ${x} ${y + h - r} L${x} ${y + r} Q${x} ${y} ${x + r} ${y} Z`;
}
function shapeDrawables(e) {
  const { x, y, w, h } = e, cx = x + w / 2, cy = y + h / 2, o = ropts(e);
  switch (e.type) {
    case "rect": return [e.radius ? gen.path(roundRectPath(x, y, w, h, Math.min(e.radius, w * 0.25, h * 0.25)), o) : gen.rectangle(x, y, w, h, o)];
    case "ellipse": return [gen.ellipse(cx, cy, w, h, o)];
    case "diamond": return [gen.polygon([[cx, y], [x + w, cy], [cx, y + h], [x, cy]], o)];
    case "hexagon": { const k = Math.min(w * 0.25, h * 0.5); return [gen.polygon([[x + k, y], [x + w - k, y], [x + w, cy], [x + w - k, y + h], [x + k, y + h], [x, cy]], o)]; }
    case "parallelogram": { const k = Math.min(w * 0.2, h * 0.6); return [gen.polygon([[x + k, y], [x + w, y], [x + w - k, y + h], [x, y + h]], o)]; }
    case "triangle": return [gen.polygon([[cx, y], [x + w, y + h], [x, y + h]], o)];
    case "star": { const p = []; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 0.42 : 1; p.push([cx + Math.cos(a) * w / 2 * r, cy + Math.sin(a) * h / 2 * r]); } return [gen.polygon(p, o)]; }
    case "document": return [gen.path(`M${x} ${y} L${x + w} ${y} L${x + w} ${y + h * 0.86} C${x + w * 0.72} ${y + h * 0.7} ${x + w * 0.3} ${y + h * 1.04} ${x} ${y + h * 0.88} Z`, o)];
    case "cylinder": {
      const ry = Math.min(h * 0.14, w * 0.25), rx = w / 2;
      return [gen.path(`M${x} ${y + ry} L${x} ${y + h - ry} A${rx} ${ry} 0 0 0 ${x + w} ${y + h - ry} L${x + w} ${y + ry} A${rx} ${ry} 0 0 0 ${x} ${y + ry} Z`, o),
        gen.path(`M${x} ${y + ry} A${rx} ${ry} 0 0 0 ${x + w} ${y + ry}`, ropts(e, true))];
    }
    case "cloud": {
      const n = 9, rx = w / 2 * 0.86, ry = h / 2 * 0.8;
      let d = "";
      for (let i = 0; i <= n; i++) {
        const a = -Math.PI / 2 + i * 2 * Math.PI / n, px = cx + Math.cos(a) * rx, py = cy + Math.sin(a) * ry;
        if (!i) { d += `M${pt([px, py])}`; continue; }
        const m = a - Math.PI / n; d += ` Q${pt([cx + Math.cos(m) * rx * 1.32, cy + Math.sin(m) * ry * 1.36])} ${pt([px, py])}`;
      }
      return [gen.path(d + " Z", o)];
    }
  }
  return [];
}
function strokeSvg(points) { // perfect-freehand's outline as a closed path
  if (!points.length) return "";
  const d = ["M", ...points[0], "Q"];
  points.forEach(([x0, y0], i) => { const [x1, y1] = points[(i + 1) % points.length]; d.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2); });
  d.push("Z");
  return d.join(" ");
}
function lineDrawables(e, r) {
  const o = ropts({ ...e, fill: undefined }), w = e.width === undefined ? 2 : e.width, pts = r.pts, d = [];
  if (r.bez) { const [s, c1, c2, t] = r.bez; d.push(gen.path(`M${pt(s)} C${pt(c1)} ${pt(c2)} ${pt(t)}`, o)); }
  else if (r.segs) d.push(gen.path(`M${pt(pts[0])} ` + r.segs.map(([c1, c2, q]) => `C${pt(c1)} ${pt(c2)} ${pt(q)}`).join(" "), o));
  else if (pts.length > 2) { // elbows: rounded corners
    let s = `M${pt(pts[0])}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1], b = pts[i], c = pts[i + 1];
      const r1 = Math.min(14, Math.hypot(b[0] - a[0], b[1] - a[1]) / 2, Math.hypot(c[0] - b[0], c[1] - b[1]) / 2);
      const p1 = gapOut(b, a, -r1), p2 = gapOut(b, c, -r1);
      s += ` L${pt(p1)} Q${pt(b)} ${pt(p2)}`;
    }
    d.push(gen.path(s + ` L${pt(pts[pts.length - 1])}`, o));
  } else d.push(gen.line(pts[0][0], pts[0][1], pts[1][0], pts[1][1], o));
  const head = e.head || (e.type === "arrow" ? "end" : "none"), ho = { ...o, strokeLineDash: undefined, disableMultiStroke: false };
  const tip = (from, to) => {
    const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const L = Math.min(Math.max(10, 12 + w * 3), Math.max(6, len * 0.6)), a = Math.atan2(to[1] - from[1], to[0] - from[0]);
    for (const s of [-0.45, 0.45]) d.push(gen.line(to[0], to[1], to[0] - L * Math.cos(a + s), to[1] - L * Math.sin(a + s), ho));
  };
  const n = pts.length;
  if (head === "end" || head === "both") tip(r.bez ? r.bez[2] : r.segs ? pts[n - 3] : pts[n - 2], pts[n - 1]);
  if (head === "start" || head === "both") tip(r.bez ? r.bez[1] : r.segs ? pts[2] : pts[1], pts[0]);
  return d;
}
function drawables(e) { // the hand-drawn strokes of e, made once for how it looks now
  let key, r = null;
  if (isLine(e)) { r = route(e); key = JSON.stringify([r.pts, e.color, e.width, e.dash, e.roughness, e.head, e.type, e.seed]); }
  else if (e.type === "path") key = JSON.stringify([e.points.length, e.points[0], e.points[e.points.length - 1], e.color, e.width, e.fill, e.fill_style, e.closed, e.smooth, e.roughness, e.dash]);
  else key = JSON.stringify([e.type, e.x, e.y, e.w, e.h, e.color, e.fill, e.fill_style, e.width, e.roughness, e.dash, e.radius, e.seed]);
  const c = shapesCache.get(e.id);
  if (c && c.key === key) return isLine(e) ? { ...c, r } : c;
  let out;
  if (isLine(e)) out = { d: lineDrawables(e, r), r };
  else if (e.type === "path") {
    if (!e.closed && e.smooth !== false) { // the pen: an ink stroke that swells and tapers
      const outline = getStroke(e.points, { size: Math.max(1, (e.width === undefined ? 2 : e.width)) * 2.6 + 0.8, thinning: 0.6, smoothing: 0.5,
        streamline: 0.5, simulatePressure: true, last: true, easing: t => Math.sin((t * Math.PI) / 2) });
      out = { ink: new Path2D(strokeSvg(outline)) };
    } else {
      const o = ropts(e);
      out = { d: [e.closed ? gen.polygon(e.points, o) : gen.linearPath(e.points, o)] };
    }
  } else out = { d: shapeDrawables(e) };
  out.key = key;
  shapesCache.set(e.id, out);
  return out;
}
function image(src) {
  let img = images.get(src);
  if (!img) { img = new Image(); img.onload = draw; img.src = src; images.set(src, img); }
  return img;
}
function roundedPath(g, x, y, w, h, r) {
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h);
}
function paint(g, rc, e) {
  g.save();
  if (e.opacity) g.globalAlpha = e.opacity;
  if (e.type === "text") {
    if (!(editing && editing.id === e.id)) {
      g.fillStyle = e.color || INK; g.font = fontOf(e);
      const [tw] = measure(e);
      paintLines(g, String(e.text).split("\n"), e, e.x, e.y, tw, e.align || "left");
    }
  } else if (e.type === "image") {
    const img = image(e.src);
    if (img.complete && img.naturalWidth) g.drawImage(img, e.x, e.y, e.w, e.h);
    else { g.fillStyle = "#f1f3f5"; g.fillRect(e.x, e.y, e.w, e.h); }
  } else if (e.type === "frame") { // clean and quiet, under everything
    roundedPath(g, e.x, e.y, e.w, e.h, 10);
    if (e.fill) { g.fillStyle = e.fill; g.globalAlpha = (e.opacity || 1) * 0.55; g.fill(); g.globalAlpha = e.opacity || 1; }
    g.strokeStyle = e.color || "#adb5bd"; g.lineWidth = Math.max(1, Math.min(e.width || 1.5, 3));
    g.setLineDash(e.dash === "dashed" ? [8, 6] : e.dash === "dotted" ? [2, 5] : []);
    g.stroke(); g.setLineDash([]);
    paintLabel(g, e);
  } else if (e.type === "note") {
    g.shadowColor = "rgba(0,0,0,.16)"; g.shadowOffsetY = 3; g.shadowBlur = 10;
    g.fillStyle = e.fill || NOTE_FILL;
    roundedPath(g, e.x, e.y, e.w, e.h, 3); g.fill();
    g.shadowColor = "transparent";
    paintLabel(g, e);
  } else {
    const dr = drawables(e);
    if (dr.ink) { g.fillStyle = e.color || INK; g.fill(dr.ink); }
    else for (const d of dr.d) rc.draw(d);
    if (isLine(e)) paintLineLabel(g, e, dr.r.pts);
    else paintLabel(g, e);
  }
  g.restore();
}
function paintLineLabel(g, e, pts) {
  e._lab = null;
  if (!e.text || (editing && editing.id === e.id)) return;
  const [mx, my] = midOf(pts), size = e.size || 16;
  g.font = fontOf({ ...e, size });
  const lines = String(e.text).split("\n"), lw = Math.max(...lines.map(l => g.measureText(l).width)), lh = lines.length * size * 1.25;
  e._lab = [mx - lw / 2 - 5, my - lh / 2 - 2, lw + 10, lh + 4];
  g.fillStyle = "#ffffff"; g.fillRect(...e._lab);
  g.fillStyle = e.text_color || e.color || INK;
  paintLines(g, lines, { size }, mx - lw / 2, my - lh / 2, lw, "center");
}
let raf = 0;
const rcMain = rough.canvas(cv);
function draw() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); }
function render() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H);
  if (grid && view.z > 0.3) { // a quiet grid, like Excalidraw's
    ctx.strokeStyle = "#f1f1f4"; ctx.lineWidth = 1; ctx.beginPath();
    let step = GRID; while (step * view.z < 14) step *= 5;
    for (let x = Math.floor(view.x / step) * step; x < view.x + W / view.z; x += step) { const sx = Math.round((x - view.x) * view.z) + 0.5; ctx.moveTo(sx, 0); ctx.lineTo(sx, H); }
    for (let y = Math.floor(view.y / step) * step; y < view.y + H / view.z; y += step) { const sy = Math.round((y - view.y) * view.z) + 0.5; ctx.moveTo(0, sy); ctx.lineTo(W, sy); }
    ctx.stroke();
  }
  ctx.setTransform(dpr * view.z, 0, 0, dpr * view.z, -view.x * view.z * dpr, -view.y * view.z * dpr);
  layers();
  const vx0 = view.x - 60, vy0 = view.y - 60, vx1 = view.x + W / view.z + 60, vy1 = view.y + H / view.z + 60;
  const gone = act && act.kind === "erase" ? act.gone : null;
  for (const e of ordered) {
    const [x, y, w, h] = bbox(e);
    if (x > vx1 || y > vy1 || x + w < vx0 || y + h < vy0) continue; // off screen
    if (gone && gone.has(e.id)) { ctx.save(); ctx.globalAlpha = 0.2; paint(ctx, rcMain, e); ctx.restore(); continue; }
    paint(ctx, rcMain, e);
  }
  if (act && act.draft) paint(ctx, rcMain, act.draft);
  const px = 1 / view.z;
  if (hover && els.has(hover)) { // what an arrow would join
    const b = els.get(hover);
    ctx.strokeStyle = "rgba(105,101,219,.45)"; ctx.lineWidth = 6 * px;
    roundedPath(ctx, b.x - 6 * px, b.y - 6 * px, b.w + 12 * px, b.h + 12 * px, 8 * px); ctx.stroke();
  }
  for (const id of sel) {
    const e = els.get(id); if (!e) continue;
    const [x, y, w, h] = bbox(e), pad = 6 * px;
    ctx.strokeStyle = PRIMARY; ctx.lineWidth = 1 * px;
    if (sel.size > 1) ctx.setLineDash([4 * px, 3 * px]);
    ctx.strokeRect(x - pad, y - pad, w + pad * 2, h + pad * 2); ctx.setLineDash([]);
  }
  if (sel.size > 1) { const b = bounds(selected()); if (b) { ctx.strokeStyle = PRIMARY; ctx.lineWidth = 1 * px; ctx.strokeRect(b[0] - 10 * px, b[1] - 10 * px, b[2] + 20 * px, b[3] + 20 * px); } }
  for (const [hx, hy] of handles()) {
    ctx.fillStyle = "#ffffff"; ctx.strokeStyle = PRIMARY; ctx.lineWidth = 1.2 * px;
    roundedPath(ctx, hx - 4.5 * px, hy - 4.5 * px, 9 * px, 9 * px, 2 * px); ctx.fill(); ctx.stroke();
  }
  if (act && act.kind === "marquee") {
    const [x, y, w, h] = rect(act.x0, act.y0, act.x1, act.y1);
    ctx.fillStyle = "rgba(105,101,219,.07)"; ctx.strokeStyle = PRIMARY; ctx.lineWidth = 1 * px;
    ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h);
  }
  if (sel.size === 1) { // who drew it
    const e = els.get([...sel][0]), by = e && whoDid(e.by);
    if (by) {
      const [x, y] = bbox(e);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const [sx, sy] = toScreen(x, y);
      ctx.font = `11px ${FONTS.sans}`; ctx.fillStyle = PRIMARY; ctx.textBaseline = "bottom"; ctx.fillText(by, sx - 6, sy - 10);
    }
  }
  $("#zoom-reset").textContent = Math.round(view.z * 100) + "%";
  $("#welcome").hidden = !(loaded && !els.size && !editing && !(act && act.draft));
}

// ------------------------------------------------------------- hit tests
function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / L)) : 0;
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
function nearPolyline(p, x, y, t) {
  if (p.length === 1) return Math.hypot(x - p[0][0], y - p[0][1]) <= t;
  for (let i = 1; i < p.length; i++) if (segDist(x, y, p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]) <= t) return true;
  return false;
}
function inPoly(p, x, y) {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++)
    if ((p[i][1] > y) !== (p[j][1] > y) && x < (p[j][0] - p[i][0]) * (y - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0]) c = !c;
  return c;
}
function hits(e, x, y, tol) {
  const t = tol + (e.width || 0) / 2;
  if (isLine(e)) {
    if (e._lab && x >= e._lab[0] && x <= e._lab[0] + e._lab[2] && y >= e._lab[1] && y <= e._lab[1] + e._lab[3]) return true;
    return nearPolyline(route(e).pts, x, y, t + 3);
  }
  if (e.type === "path") return (e.closed && e.fill && inPoly(e.points, x, y)) || nearPolyline(e.points, x, y, t + (e.width || 2));
  if (e.type === "frame") { // its name above it and its edge, so what's inside stays clickable
    const size = Math.min(e.size || 18, 22), tw = ((e.text || "").length * size * 0.62) + 20;
    if (y >= e.y - size * 1.5 - 6 && y <= e.y && x >= e.x && x <= e.x + Math.min(e.w, tw)) return true;
    const insideIt = x >= e.x - t && x <= e.x + e.w + t && y >= e.y - t && y <= e.y + e.h + t;
    return insideIt && (x <= e.x + t * 2 || x >= e.x + e.w - t * 2 || y <= e.y + t * 2 || y >= e.y + e.h - t * 2);
  }
  const [bx, by, w, h] = bbox(e);
  if (!(x >= bx - tol && x <= bx + w + tol && y >= by - tol && y <= by + h + tol)) return false;
  if (isBox(e) && !e.fill && !e.text && e.type !== "image" && e.type !== "note") { // an empty outline: its edge (or near its middle)
    const inset = Math.min(w, h) * 0.18;
    return !(x > bx + inset && x < bx + w - inset && y > by + inset && y < by + h - inset) || Math.hypot(x - bx - w / 2, y - by - h / 2) < Math.min(w, h) * 0.12;
  }
  return true;
}
function topAt(x, y, only) {
  layers();
  for (let i = ordered.length - 1; i >= 0; i--) { const e = ordered[i]; if ((!only || only(e)) && hits(e, x, y, 6 / view.z)) return e; }
  if (only) for (let i = ordered.length - 1; i >= 0; i--) { // an arrow can join a frame by its inside too
    const e = ordered[i];
    if (e.type === "frame" && only(e) && x >= e.x && x <= e.x + e.w && y >= e.y && y <= e.y + e.h) return e;
  }
  return null;
}
function handles() { // the corners of the one selected shape (or a line's two ends)
  if (sel.size !== 1 || tool !== "select" || editing || (act && act.kind === "move")) return [];
  const e = els.get([...sel][0]);
  if (!e) return [];
  if (isLine(e)) { const p = route(e).pts; return [p[0], p[p.length - 1]]; }
  if (!isBox(e) && e.type !== "text") return [];
  const [x, y, w, h] = bbox(e), p = 6 / view.z;
  return [[x - p, y - p], [x + w + p, y - p], [x - p, y + h + p], [x + w + p, y + h + p]];
}
function handleAt(x, y) {
  const hs = handles(), t = 9 / view.z;
  for (let i = 0; i < hs.length; i++) if (Math.abs(hs[i][0] - x) <= t && Math.abs(hs[i][1] - y) <= t) return i;
  return -1;
}
function inside(outer, e) { // is e within frame outer?
  const [x, y, w, h] = bbox(e);
  return e.id !== outer.id && x >= outer.x - 1 && y >= outer.y - 1 && x + w <= outer.x + outer.w + 1 && y + h <= outer.y + outer.h + 1;
}
const attached = ids => [...els.values()].filter(e => isLine(e) && !ids.has(e.id) && (ids.has(e.from) || ids.has(e.to)));

// ---------------------------------------------------------------- editing
function openEditor(e, isNew) {
  commitEditor();
  editing = { id: e.id, el: { ...e }, isNew, before: isNew ? null : { ...e } };
  if (!e.size) editing.el.size = isLine(e) ? 16 : style.size;
  editor.value = e.text || "";
  editor.className = "editor" + (e.type === "note" ? " wrap" : (isBox(e) || isLine(e)) && e.type !== "frame" ? " wrap center" : "");
  editor.hidden = false; placeEditor(); draw();
  setTimeout(() => { editor.focus(); editor.select(); }, 0);
}
function placeEditor() {
  if (!editing) return;
  const e = editing.el, z = view.z, size = (e.type === "frame" ? Math.min(e.size || 18, 22) : e.size || 20) * z;
  const weight = e.bold ? "700" : "400", family = FONTS[e.font] || FONTS.hand;
  const st = { fontSize: size + "px", color: e.text_color || (e.type === "text" ? e.color || INK : e.type === "frame" ? e.color || "#868e96" : INK), fontWeight: weight,
    fontFamily: family, paddingTop: "0px", textAlign: e.align || (e.type === "text" || e.type === "note" || e.type === "frame" ? "left" : "center") };
  const lines = Math.max(1, editor.value.split("\n").length);
  if (e.type === "text" || e.type === "frame" || isLine(e)) {
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.font = `${weight} ${size}px ${family}`;
    const tw = Math.max(...editor.value.split("\n").map(l => ctx.measureText(l).width), size * 1.5);
    ctx.restore();
    let sx, sy;
    if (isLine(e)) { const [mx, my] = midOf(route(e).pts); [sx, sy] = toScreen(mx, my); sx -= (tw + size) / 2; sy -= lines * size * 0.625; }
    else if (e.type === "frame") { [sx, sy] = toScreen(e.x + 4, e.y - 6); sy -= size * 1.25; }
    else [sx, sy] = toScreen(e.x, e.y);
    Object.assign(st, { left: sx + "px", top: sy + "px", width: tw + size + "px", height: lines * size * 1.25 + 6 + "px" });
  } else if (e.type === "note") {
    const pad = Math.min(14, e.w / 8) * z, [sx, sy] = toScreen(e.x, e.y);
    Object.assign(st, { left: sx + pad + "px", top: sy + pad + "px", width: e.w * z - pad * 2 + "px", height: e.h * z - pad * 2 + "px" });
  } else {
    const [ix, iy, iw, ih] = inner(e), [sx, sy] = toScreen(ix, iy);
    const th = wrap(editor.value || " ", `${weight} ${size}px ${family}`, iw * z).length * size * 1.25;
    Object.assign(st, { left: sx + "px", top: sy + "px", width: iw * z + "px", height: ih * z + "px", paddingTop: Math.max(0, (ih * z - th) / 2) + "px" });
  }
  Object.assign(editor.style, st);
}
function commitEditor(cancel) {
  if (!editing) return;
  const ed = editing; editing = null;
  editor.hidden = true; editor.blur();
  const text = editor.value.replace(/\s+$/, "");
  if (cancel && !ed.isNew) return draw();
  const el = { ...ed.el };
  for (const k of Object.keys(el)) if (k.startsWith("_")) delete el[k];
  if (el.type === "text" && !text.trim()) { // an emptied text is gone
    if (!ed.isNew && els.has(ed.id)) change([ed.before], [null]); else els.delete(ed.id);
    return draw();
  }
  if (text) el.text = text; else delete el.text;
  if (!ed.isNew && (ed.before.text || "") === (el.text || "")) return draw();
  change([ed.before], [el]);
  if (ed.isNew) afterDraw(el);
}
editor.addEventListener("input", placeEditor);
editor.addEventListener("blur", () => setTimeout(() => { if (editing && document.activeElement !== editor) commitEditor(); }, 0));
editor.addEventListener("keydown", (e) => {
  e.stopPropagation();
  if (e.key === "Escape") { e.preventDefault(); commitEditor(!editing?.isNew); }
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commitEditor(); }
});

// ---------------------------------------------------------------- pointer
function local(ev) { const r = cv.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; }
function styled(el) { // what you draw takes the style on the left
  if (style.opacity < 1) el.opacity = style.opacity;
  if (el.type === "text") return Object.assign(el, { color: style.stroke, size: style.size, font: style.font, ...(style.align !== "left" ? { align: style.align } : {}) });
  if (el.type === "note") return Object.assign(el, { color: style.stroke === "#ffffff" ? INK : style.stroke, fill: style.bg || NOTE_FILL, size: style.size, font: style.font });
  if (el.type === "frame") return Object.assign(el, { color: "#adb5bd", width: 1.5, size: 18, font: style.font });
  Object.assign(el, { color: style.stroke, width: style.width, roughness: style.roughness });
  if (style.dash !== "solid") el.dash = style.dash;
  if (el.type === "path") return el;
  if (isLine(el)) return Object.assign(el, { route: style.route, head: el.type === "arrow" ? style.head : "none" });
  if (style.bg && el.type !== "image") Object.assign(el, { fill: style.bg, fill_style: style.fill_style });
  if (el.type === "rect" && style.round) el.radius = 16;
  return el;
}
function newBox(type, x, y, w, h) { return styled({ id: newId(), type, x: round(x), y: round(y), w: round(w), h: round(h) }); }
function lineFrom(x0, y0, x1, y1, shift) {
  if (shift) { const a = Math.round(Math.atan2(y1 - y0, x1 - x0) / (Math.PI / 4)) * (Math.PI / 4), L = Math.hypot(x1 - x0, y1 - y0); x1 = x0 + L * Math.cos(a); y1 = y0 + L * Math.sin(a); }
  return [round(x0), round(y0), round(x1), round(y1)];
}
const boxAt = (x, y, not) => topAt(x, y, e => isBox(e) && e.id !== not);
function eraseAt(x, y) {
  for (const e of els.values()) if (!act.gone.has(e.id) && hits(e, x, y, 8 / view.z)) act.gone.set(e.id, e);
  draw();
}
function newText(bx, by) { return styled({ id: newId(), type: "text", x: round(bx), y: round(by - style.size * 0.65), text: "" }); }
function afterDraw(el) { // Excalidraw's way: back to selecting what you drew, unless the tool is locked
  if (locked) return draw();
  setTool("select"); sel = new Set([el.id]); updateChrome(); draw();
}

cv.addEventListener("pointerdown", (ev) => {
  if (!loaded) return;
  closePops();
  try { cv.setPointerCapture(ev.pointerId); } catch { /* a pen or a synthetic event the browser doesn't track */ }
  const [sx, sy] = local(ev);
  pointers.set(ev.pointerId, [sx, sy]);
  if (pointers.size === 2) { // two fingers: pan and pinch; what the first one started is dropped
    if (act && act.orig) for (const [id, o] of Object.entries(act.orig)) els.set(id, o);
    act = null;
    const [a, b] = [...pointers.values()];
    pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2 };
    return draw();
  }
  if (pointers.size > 2) return;
  if (editing) { const was = editing.el.type; commitEditor(); if (["text", "note"].includes(tool) && was === tool) return; if (tool === "select") return; }
  const [bx, by] = toBoard(sx, sy);
  if (ev.button === 1 || ev.button === 2 || space || tool === "hand") {
    act = { kind: "pan", sx, sy, vx: view.x, vy: view.y }; cv.classList.add("grabbing"); return;
  }
  if (tool === "select") {
    const h = handleAt(bx, by);
    if (h >= 0) {
      const e = els.get([...sel][0]);
      act = { kind: isLine(e) ? "end" : "resize", id: e.id, h, orig: { [e.id]: { ...e } }, bx, by };
      return;
    }
    const e = topAt(bx, by);
    if (!e) {
      if (!ev.shiftKey) sel = new Set();
      act = { kind: "marquee", x0: bx, y0: by, x1: bx, y1: by, keep: new Set(sel) };
      updateChrome(); return draw();
    }
    if (ev.shiftKey) { if (sel.has(e.id)) sel.delete(e.id); else sel.add(e.id); }
    else if (!sel.has(e.id)) sel = new Set([e.id]);
    if (ev.altKey) { // alt-drag: drag a copy
      const copies = cloneAll(withLinks(framed(selected())), 0, 0);
      for (const c of copies) { c.z = ++topZ; els.set(c.id, c); }
      const movable = copies.filter(c => !(isLine(c) && c.from && c.to));
      sel = new Set(movable.map(c => c.id));
      act = { kind: "move", bx, by, orig: Object.fromEntries(movable.map(c => [c.id, { ...c }])), moved: false, lead: movable[0]?.id, copies };
      updateChrome(); return draw();
    }
    const move = new Set(sel);
    for (const id of sel) { const f = els.get(id); if (f && f.type === "frame") for (const x of els.values()) if (inside(f, x)) move.add(x.id); }
    const orig = {};
    for (const id of move) { const x = els.get(id); if (x && !(isLine(x) && x.from && x.to)) orig[id] = { ...x, points: x.points && x.points.map(p => [...p]) }; }
    act = { kind: "move", bx, by, orig, moved: false, lead: e.id };
    updateChrome(); return draw();
  }
  if (tool === "pen") { act = { kind: "draw", draft: styled({ id: newId(), type: "path", points: [[round(bx), round(by)]] }) }; return draw(); }
  if (tool === "eraser") { act = { kind: "erase", gone: new Map() }; return eraseAt(bx, by); }
  if (tool === "text") {
    const e = topAt(bx, by, x => hasText(x) || (isBox(x) && x.type !== "image"));
    if (e) return openEditor(e, false);
    return openEditor(newText(bx, by), true);
  }
  if (tool === "note") {
    const e = topAt(bx, by, x => x.type === "note");
    if (e) return openEditor(e, false);
    const n = styled({ id: newId(), type: "note", x: snap(bx - 110, ev), y: snap(by - 80, ev), w: 220, h: 160, text: "" });
    els.set(n.id, n);
    return openEditor(n, true);
  }
  if (tool === "line" || tool === "arrow") {
    const from = boxAt(bx, by);
    act = { kind: "draw", x0: bx, y0: by, draft: styled({ id: newId(), type: tool, x1: round(bx), y1: round(by), x2: round(bx), y2: round(by), ...(from ? { from: from.id } : {}) }) };
    return draw();
  }
  if (tool === "image") return $("#image-file").click();
  if (BOXES.includes(tool)) {
    act = { kind: "draw", x0: snap(bx, ev), y0: snap(by, ev), draft: newBox(tool, snap(bx, ev), snap(by, ev), 0, 0) };
    return draw();
  }
});
cv.addEventListener("pointermove", (ev) => {
  const [sx, sy] = local(ev);
  if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, [sx, sy]);
  if (pinch && pointers.size === 2) {
    const [a, b] = [...pointers.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]), mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    view.x -= (mx - pinch.mx) / view.z; view.y -= (my - pinch.my) / view.z;
    zoomAt(mx, my, d / (pinch.d || d));
    pinch = { d, mx, my };
    return;
  }
  const [bx, by] = toBoard(sx, sy);
  if (!act) { // hovering: show what a click would take
    if (tool === "select") cv.style.cursor = handleAt(bx, by) >= 0 ? "nwse-resize" : topAt(bx, by) ? "move" : "";
    else cv.style.cursor = "";
    if (tool === "arrow" || tool === "line") { const b = boxAt(bx, by); const hv = b ? b.id : null; if (hv !== hover) { hover = hv; draw(); } }
    return;
  }
  if (act.kind === "pan") { view.x = act.vx - (sx - act.sx) / view.z; view.y = act.vy - (sy - act.sy) / view.z; placeEditor(); return draw(); }
  if (act.kind === "marquee") {
    Object.assign(act, { x1: bx, y1: by });
    const [x, y, w, h] = rect(act.x0, act.y0, bx, by);
    sel = new Set(act.keep);
    for (const e of els.values()) { const [ex, ey, ew, eh] = bbox(e); if (ex >= x && ey >= y && ex + ew <= x + w && ey + eh <= y + h) sel.add(e.id); }
    return draw();
  }
  if (act.kind === "move") {
    let dx = bx - act.bx, dy = by - act.by;
    const lead = act.orig[act.lead];
    if (lead && isBox(lead) && grid && !ev.altKey) { dx = snap(lead.x + dx) - lead.x; dy = snap(lead.y + dy) - lead.y; }
    act.moved = act.moved || Math.hypot(bx - act.bx, by - act.by) * view.z > 2;
    if (!act.moved) return;
    for (const [id, o] of Object.entries(act.orig)) els.set(id, moved(o, dx, dy));
    return draw();
  }
  if (act.kind === "resize") {
    const o = act.orig[act.id], [ox, oy, ow, oh] = bbox(o);
    const fx = act.h % 2 ? ox : ox + ow, fy = act.h < 2 ? oy + oh : oy; // the corner that stays
    const nx = snap(bx, ev), ny = snap(by, ev);
    let w = Math.max(8, Math.abs(nx - fx)), h = Math.max(8, Math.abs(ny - fy));
    if (ev.shiftKey || o.type === "image" || o.type === "text") { const k = Math.max(w / ow, h / oh); w = ow * k; h = oh * k; }
    const x = nx < fx ? fx - w : fx, y = ny < fy ? fy - h : fy;
    const e = { ...o };
    if (o.type === "text") Object.assign(e, { x: round(x), y: round(y), size: Math.max(6, round(o.size * w / ow)) });
    else Object.assign(e, { x: round(x), y: round(y), w: round(w), h: round(h) });
    els.set(act.id, e); act.moved = true;
    return draw();
  }
  if (act.kind === "end") { // drag a line's end: onto a shape, it joins it
    const o = act.orig[act.id], e = { ...o }, k = act.h === 0 ? "from" : "to";
    const other = act.h === 0 ? o.to : o.from, b = boxAt(bx, by, other);
    if (act.h === 0) Object.assign(e, { x1: round(bx), y1: round(by) }); else Object.assign(e, { x2: round(bx), y2: round(by) });
    if (b) e[k] = b.id; else delete e[k];
    delete e.via;
    hover = b ? b.id : null; act.moved = true;
    els.set(act.id, e);
    return draw();
  }
  if (act.kind === "erase") return eraseAt(bx, by);
  const d = act.draft;
  if (!d) return;
  if (d.type === "path") {
    const last = d.points[d.points.length - 1];
    if (Math.hypot(bx - last[0], by - last[1]) * view.z >= 1.5) d.points.push([round(bx), round(by)]);
    shapesCache.delete(d.id);
    if (d.points.length >= 3900) { finishDraft(); act = { kind: "draw", draft: { ...d, id: newId(), points: [[round(bx), round(by)]] } }; }
  } else if (isLine(d)) {
    [d.x1, d.y1, d.x2, d.y2] = lineFrom(act.x0, act.y0, bx, by, ev.shiftKey);
    const b = boxAt(bx, by, d.from);
    hover = b ? b.id : null;
    if (b) d.to = b.id; else delete d.to;
  } else {
    let w = snap(bx, ev) - act.x0, h = snap(by, ev) - act.y0;
    if (ev.shiftKey) { const s = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * s; h = Math.sign(h || 1) * s; }
    Object.assign(d, { x: Math.min(act.x0, act.x0 + w), y: Math.min(act.y0, act.y0 + h), w: Math.abs(w), h: Math.abs(h) });
  }
  draw();
});
function moved(o, dx, dy) {
  const e = { ...o };
  for (const k of ["x", "x1", "x2"]) if (k in o) e[k] = round(o[k] + dx);
  for (const k of ["y", "y1", "y2"]) if (k in o) e[k] = round(o[k] + dy);
  if (o.points) e.points = o.points.map(([x, y]) => [round(x + dx), round(y + dy)]);
  if (o.via) e.via = o.via.map(([x, y]) => [round(x + dx), round(y + dy)]);
  return e;
}
function finishDraft() {
  const d = act && act.draft; if (!d) return;
  act.draft = null;
  if (isBox(d)) {
    if (Math.max(d.w, d.h) * view.z < 6) { // a click: a shape to write in, there
      const [w, h] = d.type === "frame" ? [480, 320] : d.type === "diamond" ? [180, 120] : d.type === "cylinder" ? [140, 120] : d.type === "ellipse" ? [160, 110] : [180, 100];
      Object.assign(d, { x: snap(d.x - w / 2), y: snap(d.y - h / 2), w, h });
      els.set(d.id, d);
      return openEditor(d, true);
    }
    change([null], [d]);
    if (d.type === "frame") return openEditor(els.get(d.id), false);
    return afterDraw(d);
  }
  if (isLine(d)) {
    if (!d.to && Math.hypot(d.x2 - d.x1, d.y2 - d.y1) * view.z < 6) return draw(); // a click, not a line
    if (d.from && d.to && d.from === d.to) return draw();
    change([null], [d]);
    return afterDraw(d);
  }
  change([null], [d]); // the pen keeps drawing
}
function up(ev) {
  pointers.delete(ev.pointerId);
  if (pinch) { if (pointers.size < 2) pinch = null; return; }
  cv.classList.remove("grabbing");
  hover = null;
  const a = act; act = null;
  if (!a) return;
  if (a.kind === "move" || a.kind === "resize" || a.kind === "end") {
    const ids = Object.keys(a.orig);
    if (a.copies) { // alt-drag: the copies are new
      const all = a.copies.map(c => ({ ...(els.get(c.id) || c) }));
      for (const c of a.copies) els.delete(c.id);
      change(all.map(() => null), all);
      return draw();
    }
    if (a.moved) {
      // a laid-out arrow's way points no longer fit once a shape it joins moves alone: it routes itself from then on
      const loose = [], after = [];
      for (const e of attached(new Set(ids))) {
        if (!e.via) continue;
        if (a.orig[e.from] && a.orig[e.to]) { const o = a.orig[e.from], n = els.get(e.from); loose.push(e); after.push({ ...e, via: e.via.map(([x, y]) => [round(x + n.x - o.x), round(y + n.y - o.y)]) }); }
        else { loose.push(e); after.push((({ via, ...rest }) => rest)(e)); }
      }
      change([...ids.map(id => a.orig[id]), ...loose], [...ids.map(id => els.get(id) ? { ...els.get(id) } : null), ...after]);
    } else for (const id of ids) els.set(id, a.orig[id]);
    return draw();
  }
  if (a.kind === "erase") {
    const gone = [...a.gone.values()], ids = new Set(gone.map(e => e.id));
    gone.push(...attached(ids));
    if (gone.length) change(gone, gone.map(() => null)); else draw();
    return;
  }
  if (a.kind === "draw") { act = a; finishDraft(); if (act === a) act = null; }
  updateChrome(); draw();
}
cv.addEventListener("pointerup", up);
cv.addEventListener("pointercancel", up);
cv.addEventListener("dblclick", (ev) => {
  const [bx, by] = toBoard(...local(ev));
  if (tool !== "select" && tool !== "hand") return;
  const e = topAt(bx, by);
  if (e && e.type !== "path" && e.type !== "image") return openEditor(e, false);
  if (!e) openEditor(newText(bx, by), true);
});
cv.addEventListener("contextmenu", e => e.preventDefault());
cv.addEventListener("wheel", (ev) => {
  ev.preventDefault();
  const [sx, sy] = local(ev);
  if (ev.ctrlKey || ev.metaKey) zoomAt(sx, sy, Math.exp(-ev.deltaY * 0.01));
  else { view.x += (ev.shiftKey && !ev.deltaX ? ev.deltaY : ev.deltaX) / view.z; view.y += (ev.shiftKey && !ev.deltaX ? 0 : ev.deltaY) / view.z; placeEditor(); draw(); }
}, { passive: false });

// ------------------------------------------------- selection, clipboard
function selected() { return [...sel].map(id => els.get(id)).filter(Boolean); }
function removeSelected() {
  const gone = selected(); if (!gone.length) return;
  gone.push(...attached(new Set(gone.map(e => e.id))));
  sel = new Set(); change(gone, gone.map(() => null));
}
function cloneAll(list, dx, dy) { // copies with new ids; arrows between copies join the copies
  const ids = new Map(list.map(e => [e.id, newId() + Math.random().toString(16).slice(2, 4)]));
  return list.map(e => {
    const c = { ...moved(strip(e), dx, dy), id: ids.get(e.id) };
    delete c.diagram; delete c.seed;
    for (const k of ["from", "to"]) if (c[k]) { if (ids.has(c[k])) c[k] = ids.get(c[k]); else delete c[k]; }
    return c;
  });
}
function withLinks(list) { const ids = new Set(list.map(e => e.id)); return [...list, ...[...els.values()].filter(e => isLine(e) && !ids.has(e.id) && ids.has(e.from) && ids.has(e.to))]; }
function framed(list) { const out = new Map(list.map(e => [e.id, e])); for (const f of list) if (f.type === "frame") for (const x of els.values()) if (inside(f, x)) out.set(x.id, x); return [...out.values()]; }
function addAll(list) { // already cloned; select them
  const sorted = list.sort(order);
  change(sorted.map(() => null), sorted);
  sel = new Set(sorted.map(e => e.id)); updateChrome(); draw();
}
function duplicate() { const s = withLinks(framed(selected())); if (s.length) addAll(cloneAll(s, 20, 20)); }
function copy() {
  const s = withLinks(framed(selected())); if (!s.length) return false;
  clip = s.map(e => strip(e));
  try { navigator.clipboard.writeText(JSON.stringify({ clodfarm: "whiteboard", elements: clip })); } catch { /* not allowed: the page keeps it */ }
  return true;
}
function pasteElements(list) {
  const b = bounds(list); if (!b) return;
  const [cx, cy] = toBoard(W / 2, H / 2);
  addAll(cloneAll(list, Math.round(cx - b[0] - b[2] / 2), Math.round(cy - b[1] - b[3] / 2)));
}
function restack(how) { // front, back, forward, backward
  const s = selected().sort(order); if (!s.length) return;
  const ids = new Set(s.map(e => e.id)), zs = [...els.values()].map(e => e.z || 0);
  let z;
  if (how === "front" || how === "back") z = how === "front" ? Math.max(...zs) : Math.min(...zs) - s.length - 1;
  else {
    const others = layers().filter(e => !ids.has(e.id)).map(e => e.z || 0);
    const edge = how === "forward" ? Math.max(...s.map(e => e.z || 0)) : Math.min(...s.map(e => e.z || 0));
    const next = how === "forward" ? others.filter(v => v > edge).sort((a, b) => a - b)[0] : others.filter(v => v < edge).sort((a, b) => b - a)[0];
    if (next === undefined) return;
    z = how === "forward" ? next : next - s.length - 1;
  }
  change(s, s.map(e => ({ ...e, z: (z += 0.5) })));
}
async function addImage(file, at) {
  if (!file || !/^image\/(png|jpeg|gif|webp)$/.test(file.type)) return toast("Only PNG, JPEG, GIF or WebP pictures.");
  const url = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(file); });
  const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = url; });
  let src = url.length <= MAX_IMAGE_CHARS ? url : null, sideLen = 1600;
  while (!src && sideLen >= 200) { // smaller and smaller until it fits the board
    const k = Math.min(1, sideLen / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    for (const q of [0.85, 0.7, 0.55]) { const w = c.toDataURL("image/webp", q), d = w.startsWith("data:image/webp") ? w : c.toDataURL("image/jpeg", q); if (d.length <= MAX_IMAGE_CHARS) { src = d; break; } }
    sideLen = Math.round(sideLen * 0.7);
  }
  if (!src) return toast("That picture is too big.");
  const w = Math.min(480, img.naturalWidth), h = Math.round(w * img.naturalHeight / img.naturalWidth);
  const [cx, cy] = at || toBoard(W / 2, H / 2);
  const el = { id: newId(), type: "image", x: round(cx - w / 2), y: round(cy - h / 2), w, h, src };
  change([null], [el]); setTool("select"); sel = new Set([el.id]); updateChrome();
}
addEventListener("paste", (ev) => {
  if (editing || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
  const files = [...(ev.clipboardData?.files || [])].filter(f => f.type.startsWith("image/"));
  if (files.length) { ev.preventDefault(); return files.forEach(f => addImage(f)); }
  const text = ev.clipboardData?.getData("text/plain") || "";
  try { const j = JSON.parse(text); if (j && j.clodfarm === "whiteboard" && Array.isArray(j.elements)) { ev.preventDefault(); return pasteElements(j.elements); } } catch { /* not ours */ }
  if (text.trim()) {
    ev.preventDefault();
    const [cx, cy] = toBoard(W / 2, H / 2), t = newText(cx - 100, cy);
    t.text = text.slice(0, 4000);
    change([null], [t]);
  } else if (clip) pasteElements(clip);
});
stage.addEventListener("dragover", e => e.preventDefault());
stage.addEventListener("drop", (ev) => {
  ev.preventDefault();
  const [sx, sy] = local(ev);
  [...(ev.dataTransfer?.files || [])].filter(f => f.type.startsWith("image/")).forEach(f => addImage(f, toBoard(sx, sy)));
});

// -------------------------------------------------------------- keyboard
addEventListener("keydown", (e) => {
  if (editing || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || $("#help").open) return;
  const k = e.key.toLowerCase(), mod = e.metaKey || e.ctrlKey;
  if (mod && k === "z") { e.preventDefault(); return e.shiftKey ? doRedo() : doUndo(); }
  if (mod && k === "y") { e.preventDefault(); return doRedo(); }
  if (mod && k === "a") { e.preventDefault(); setTool("select"); sel = new Set(els.keys()); updateChrome(); return draw(); }
  if (mod && k === "d") { e.preventDefault(); return duplicate(); }
  if (mod && k === "c") { if (copy()) e.preventDefault(); return; }
  if (mod && k === "x") { if (copy()) { e.preventDefault(); removeSelected(); } return; }
  if (mod && e.shiftKey && (e.key === "]" || e.key === "}")) { e.preventDefault(); return restack("front"); }
  if (mod && e.shiftKey && (e.key === "[" || e.key === "{")) { e.preventDefault(); return restack("back"); }
  if (mod && e.key === "]") { e.preventDefault(); return restack("forward"); }
  if (mod && e.key === "[") { e.preventDefault(); return restack("backward"); }
  if (mod && (k === "=" || k === "+")) { e.preventDefault(); return zoomAt(W / 2, H / 2, 1.2); }
  if (mod && k === "-") { e.preventDefault(); return zoomAt(W / 2, H / 2, 1 / 1.2); }
  if (mod && k === "0") { e.preventDefault(); return zoomTo(1); }
  if (mod || e.altKey) return;
  if (k === " ") { space = true; cv.classList.add("grab"); e.preventDefault(); return; }
  if ((k === "delete" || k === "backspace") && sel.size) { e.preventDefault(); return removeSelected(); }
  if (k === "escape") { closePops(); sel = new Set(); if (tool !== "select") setTool("select"); updateChrome(); return draw(); }
  if (k === "enter" && sel.size === 1) { const x = els.get([...sel][0]); if (x && x.type !== "path" && x.type !== "image") { e.preventDefault(); return openEditor(x, false); } }
  if (k.startsWith("arrow") && sel.size) {
    e.preventDefault();
    const d = e.shiftKey ? 10 : 1, dx = k === "arrowleft" ? -d : k === "arrowright" ? d : 0, dy = k === "arrowup" ? -d : k === "arrowdown" ? d : 0;
    const s = framed(selected()).filter(x => !(isLine(x) && x.from && x.to));
    return change(s, s.map(o => moved(o, dx, dy)));
  }
  if (e.key === "!" || (e.shiftKey && e.code === "Digit1")) return fit();
  if (e.shiftKey && e.code === "Digit0") return zoomTo(1);
  if (k === "+" || k === "=") return zoomAt(W / 2, H / 2, 1.2);
  if (k === "-") return zoomAt(W / 2, H / 2, 1 / 1.2);
  if (k === "?") return openHelp();
  if (k === "q") { locked = !locked; return renderToolbar(); }
  if (k === "g" && e.shiftKey) { grid = !grid; remember("grid", grid); return draw(); }
  if (e.shiftKey) return;
  if (KEYS[k]) { if (KEYS[k] === "image") return $("#image-file").click(); setTool(KEYS[k]); }
});
addEventListener("keyup", (e) => { if (e.key === " ") { space = false; cv.classList.remove("grab"); } });

// ------------------------------------------------------------ the toolbar
function btn(cls, html, title, onclick) {
  const b = document.createElement("button");
  b.type = "button"; b.className = cls; b.innerHTML = html; b.title = title; b.setAttribute("aria-label", title);
  if (onclick) b.onclick = onclick;
  return b;
}
const sep = () => Object.assign(document.createElement("span"), { className: "sep" });
function renderToolbar() {
  const lock = btn("ibtn tool", icon(locked ? "lock" : "unlock"), locked ? "The tool stays on after drawing (Q)" : "Keep the tool on after drawing (Q)", () => { locked = !locked; renderToolbar(); });
  lock.setAttribute("aria-pressed", String(locked));
  const parts = [lock, sep()];
  for (const [t, ic, title, num] of TOOLS) {
    const b = btn("ibtn tool", icon(ic) + (num ? `<span class="num">${num}</span>` : ""), title, () => { if (t === "image") return $("#image-file").click(); setTool(t); });
    b.setAttribute("aria-pressed", String(tool === t));
    parts.push(b);
    if (t === "hand") parts.push(sep());
  }
  parts.push(sep());
  const extra = MORE.find(m => m[0] === tool);
  const more = btn("ibtn tool", icon(extra ? extra[1] : "shapes"), "More shapes: frame, sticky note, database, hexagon, cloud, …", (ev) => { ev.stopPropagation(); togglePop("#shapes", more); });
  more.setAttribute("aria-pressed", String(!!extra));
  parts.push(more);
  $("#toolbar").replaceChildren(...parts);
  $("#shapes").replaceChildren(...MORE.map(([t, ic, title]) => btn("ibtn", icon(ic), title, () => { closePops(); setTool(t); })));
}
function setTool(t) {
  commitEditor();
  tool = ALL_TOOLS.includes(t) ? t : "select";
  if (tool !== "select") sel = new Set();
  cv.className = tool === "select" ? "select" : tool === "hand" ? "grab" : tool === "eraser" ? "erase" : tool === "text" ? "text" : "";
  renderToolbar(); updateChrome(); draw();
}

// ----------------------------------------------------- the properties panel
const PROP_KEYS = { stroke: "color", bg: "fill", fill_style: "fill_style", width: "width", dash: "dash", roughness: "roughness", round: "radius",
  route: "route", head: "head", size: "size", font: "font", align: "align", opacity: "opacity" };
function targets() { // what the panel styles: the selection, or what the tool draws next
  if (sel.size) return selected();
  if (["select", "hand", "eraser", "image"].includes(tool)) return [];
  const type = tool === "pen" ? "path" : tool;
  return [styled({ id: "_next", type, x: 0, y: 0, w: 10, h: 10, x1: 0, y1: 0, x2: 1, y2: 1, points: [[0, 0]], ...(type === "text" || type === "note" ? { text: "a" } : {}) })];
}
function value(list, prop) {
  if (!sel.size) return style[prop];
  const e = list[0], v = e[PROP_KEYS[prop]];
  switch (prop) {
    case "bg": return e.fill || null;
    case "dash": return v || "solid";
    case "roughness": return v === undefined ? 1 : v;
    case "round": return !!v;
    case "width": return v === undefined ? 2 : v;
    case "font": return v || "hand";
    case "align": return v || (isBox(e) && e.type !== "note" ? "center" : "left");
    case "opacity": return v === undefined ? 1 : v;
    case "head": return v || (e.type === "arrow" ? "end" : "none");
    case "route": return v || "straight";
    case "fill_style": return v || "hachure";
    case "size": return v || 20;
    case "stroke": return v || INK;
  }
  return v === undefined ? style[prop] : v;
}
function setProp(prop, v) {
  style[prop] = v; remember("style", style);
  if (!sel.size) return renderProps();
  const before = [], after = [];
  for (const e of selected()) {
    const n = { ...e }, k = PROP_KEYS[prop];
    if (prop === "bg") { if (e.type === "image" || isLine(e) || e.type === "text") continue; if (v) { n.fill = v; n.fill_style = n.fill_style || style.fill_style; } else if (e.type === "note") n.fill = NOTE_FILL; else delete n.fill; }
    else if (prop === "round") { if (e.type !== "rect") continue; if (v) n.radius = 16; else delete n.radius; }
    else if (prop === "dash") { if (v === "solid") delete n.dash; else n.dash = v; }
    else if (prop === "opacity") { if (v >= 1) delete n.opacity; else n.opacity = v; }
    else if (prop === "route" || prop === "head") { if (!isLine(e)) continue; n[k] = v; if (prop === "route") delete n.via; }
    else if (prop === "size" || prop === "font" || prop === "align") { if (!hasText(e)) continue; n[k] = v; delete n._key; }
    else if (prop === "width" || prop === "roughness" || prop === "fill_style") { if (["text", "note", "image"].includes(e.type)) continue; n[k] = v; }
    else n[k] = v;
    before.push(e); after.push(n);
  }
  if (after.length) change(before, after);
  renderProps();
}
function section(title, ...kids) {
  const s = document.createElement("section"), h = document.createElement("h4");
  h.textContent = title; s.append(h, ...kids); return s;
}
function opts(prop, items, current) { // items: [value, icon name or text, title, class]
  const box = document.createElement("div"); box.className = "opts"; box.setAttribute("role", "radiogroup");
  for (const [v, ic, title, cls] of items) {
    const b = btn("opt" + (cls ? " " + cls : ""), P[ic] ? icon(ic) : ic, title, () => setProp(prop, v));
    b.setAttribute("role", "radio"); b.setAttribute("aria-checked", String(current === v));
    box.append(b);
  }
  return box;
}
function swatches(prop, quick, current, all) {
  const box = document.createElement("div"); box.className = "opts";
  for (const c of quick) {
    const b = btn("swatch" + (c ? "" : " none"), "", c || "transparent", () => setProp(prop, c));
    if (c) b.style.background = c;
    b.setAttribute("aria-checked", String(current === c));
    box.append(b);
  }
  box.append(Object.assign(document.createElement("span"), { className: "swatch-sep" }));
  const custom = current && !quick.includes(current);
  const more = btn("swatch more", custom ? "" : "+", "More colors", (ev) => { ev.stopPropagation(); openPicker(more, prop, all, current); });
  if (custom) { more.style.background = current; more.setAttribute("aria-checked", "true"); }
  box.append(more);
  return box;
}
function openPicker(anchor, prop, all, current) {
  const p = $("#picker"), g = document.createElement("div"); g.className = "grid";
  for (const c of all) { const b = btn("swatch", "", c, () => { closePops(); setProp(prop, c); }); b.style.background = c; b.setAttribute("aria-checked", String(current === c)); g.append(b); }
  const hex = document.createElement("label"); hex.className = "hex"; hex.textContent = "#";
  const inp = document.createElement("input"); inp.value = (current || "").replace("#", ""); inp.maxLength = 6; inp.spellcheck = false; inp.setAttribute("aria-label", "Hex color");
  inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === "Enter" && /^[0-9a-f]{6}$/i.test(inp.value)) { closePops(); setProp(prop, "#" + inp.value.toLowerCase()); } };
  hex.append(inp);
  p.replaceChildren(g, hex);
  const r = anchor.getBoundingClientRect();
  Object.assign(p.style, { left: Math.min(r.right + 10, innerWidth - 244) + "px", top: Math.max(8, Math.min(r.top - 8, innerHeight - 230)) + "px" });
  p.hidden = false;
}
function renderProps() {
  const list = targets(), panel = $("#props");
  if (!list.length) { panel.hidden = true; return; }
  const types = new Set(list.map(e => e.type)), any = f => list.some(f), only = t => types.size === 1 && types.has(t);
  const strokeable = any(e => !["image", "frame"].includes(e.type));
  const fillable = any(e => (isBox(e) && !["image", "frame"].includes(e.type)) || (e.type === "path" && e.closed));
  const lined = any(e => isLine(e) || e.type === "path" || (isBox(e) && !["note", "image", "frame"].includes(e.type)));
  const sloppy = any(e => isLine(e) || (isBox(e) && !["note", "image", "frame"].includes(e.type)) || (e.type === "path" && (e.closed || e.smooth === false)));
  const parts = [];
  if (strokeable) parts.push(section(only("text") ? "Text color" : only("note") ? "Ink" : "Stroke", swatches("stroke", STROKES, value(list, "stroke"), STROKE_ALL)));
  if (fillable) parts.push(section(only("note") ? "Paper" : "Background", swatches("bg", BGS, value(list, "bg"), BG_ALL)));
  if (fillable && value(list, "bg") && !only("note")) parts.push(section("Fill", opts("fill_style", [["hachure", "hachure", "Hachure"], ["cross-hatch", "cross", "Cross-hatch"], ["solid", "solidFill", "Solid"]], value(list, "fill_style"))));
  if (lined) parts.push(section("Stroke width", opts("width", [[1, "w1", "Thin"], [2, "w2", "Bold"], [4, "w3", "Extra bold"]], value(list, "width"))));
  if (lined) parts.push(section("Stroke style", opts("dash", [["solid", "solid", "Solid"], ["dashed", "dashed", "Dashed"], ["dotted", "dotted", "Dotted"]], value(list, "dash"))));
  if (sloppy) parts.push(section("Sloppiness", opts("roughness", [[0, "r0", "Architect"], [1, "r1", "Artist"], [2, "r2", "Cartoonist"]], value(list, "roughness"))));
  if (types.has("rect")) parts.push(section("Edges", opts("round", [[false, "sharp", "Sharp"], [true, "round", "Round"]], value(list, "round"))));
  if (any(isLine)) {
    parts.push(section("Arrow type", opts("route", [["straight", "straight", "Straight"], ["elbow", "elbow", "Elbow"], ["curve", "curve", "Curved"]], value(list, "route"))));
    parts.push(section("Arrowheads", opts("head", [["none", "hNone", "None"], ["end", "hEnd", "At the end"], ["both", "hBoth", "Both ends"]], value(list, "head"))));
  }
  if (any(hasText)) {
    parts.push(section("Font size", opts("size", [[16, "S", "Small"], [20, "M", "Medium"], [28, "L", "Large"], [36, "XL", "Extra large"]], value(list, "size"))));
    parts.push(section("Font family", opts("font", [["hand", "Aa", "Hand-drawn", "hand"], ["sans", "Aa", "Normal"], ["mono", "&lt;/&gt;", "Code"]], value(list, "font"))));
    parts.push(section("Text align", opts("align", [["left", "aLeft", "Left"], ["center", "aCenter", "Center"], ["right", "aRight", "Right"]], value(list, "align"))));
  }
  const row = document.createElement("div"); row.className = "range-row";
  const r = document.createElement("input"); r.type = "range"; r.className = "range"; r.min = "10"; r.max = "100"; r.step = "10";
  r.value = String(Math.round(value(list, "opacity") * 100)); r.setAttribute("aria-label", "Opacity");
  const out = document.createElement("span"); out.textContent = r.value;
  r.oninput = () => { out.textContent = r.value; };
  r.onchange = () => setProp("opacity", +r.value / 100);
  row.append(r, out);
  parts.push(section("Opacity", row));
  if (sel.size) {
    const lay = document.createElement("div"); lay.className = "opts";
    lay.append(btn("opt", icon("back"), "Send to back (⌘⇧[)", () => restack("back")), btn("opt", icon("bwd"), "Send backward (⌘[)", () => restack("backward")),
      btn("opt", icon("fwd"), "Bring forward (⌘])", () => restack("forward")), btn("opt", icon("front"), "Bring to front (⌘⇧])", () => restack("front")));
    parts.push(section("Layers", lay));
    const acts = document.createElement("div"); acts.className = "opts";
    acts.append(btn("opt", icon("copy"), "Duplicate (⌘D)", duplicate), btn("opt", icon("trash"), "Delete (⌫)", removeSelected));
    parts.push(section("Actions", acts));
  }
  panel.replaceChildren(...parts);
  panel.hidden = false;
}
function updateChrome() {
  $("#undo").disabled = !undo.length; $("#redo").disabled = !redo.length;
  renderProps();
}

// ------------------------------------------------------------- the menus
function closePops() {
  for (const id of ["menu", "boards", "shapes", "picker"]) $("#" + id).hidden = true;
  $("#menu-btn").setAttribute("aria-expanded", "false"); $("#board-btn").setAttribute("aria-expanded", "false");
}
function togglePop(which, anchor) {
  const p = $(which), was = !p.hidden;
  closePops();
  if (was) return;
  if (anchor && which === "#shapes") { const r = anchor.getBoundingClientRect(); Object.assign(p.style, { left: Math.max(8, Math.min(r.left - 80, innerWidth - 220)) + "px", top: (r.top > innerHeight / 2 ? r.top - 100 : r.bottom + 8) + "px" }); }
  p.hidden = false;
}
function menuItem(ic, text, onclick, extra = {}) {
  const b = document.createElement(extra.href ? "a" : "button");
  if (extra.href) b.href = extra.href; else b.type = "button";
  b.className = "mi" + (extra.danger ? " danger" : ""); b.setAttribute("role", "menuitem");
  b.innerHTML = icon(ic);
  const t = document.createElement("span"); t.textContent = text; b.append(t);
  if (extra.k) { const k = document.createElement("span"); k.className = "k"; k.textContent = extra.k; b.append(k); }
  if (onclick) b.onclick = onclick;
  return b;
}
function renderMenu(confirming) {
  const hr = () => document.createElement("hr");
  const items = [
    menuItem("home", "Back to the farm", null, { href: `${BASE}/` }), hr(),
    menuItem("image", "Insert an image", () => { closePops(); $("#image-file").click(); }, { k: "9" }),
    menuItem("download", sel.size ? "Save the selection as PNG" : "Save as PNG", () => { closePops(); exportPng(); }),
    menuItem("link", "Copy the link to this board", () => { closePops(); try { navigator.clipboard.writeText(location.href); toast("Link copied."); } catch { toast(location.href); } }),
    hr(),
    menuItem("grid", grid ? "Hide the grid" : "Show the grid", () => { grid = !grid; remember("grid", grid); closePops(); draw(); }, { k: "⇧G" }),
    menuItem("fit", "Zoom to fit everything", () => { closePops(); fit(); }, { k: "⇧1" }),
    menuItem("help", "Shortcuts & how Claude draws", () => { closePops(); openHelp(); }, { k: "?" }),
    hr(),
  ];
  if (confirming) {
    const c = document.createElement("div"); c.className = "confirm";
    c.textContent = "Wipe this board for everyone? Undo won't bring it back.";
    const row = document.createElement("div"); row.className = "row";
    row.append(btn("btn danger", "Clear it", "Clear the board", async () => { closePops(); await clearBoard(); }), btn("btn", "Keep it", "Keep it", (ev) => { ev.stopPropagation(); renderMenu(false); }));
    c.append(row); items.push(c);
  } else items.push(menuItem("trash", "Clear the board", (ev) => { ev.stopPropagation(); renderMenu(true); }, { danger: true }));
  $("#menu").replaceChildren(...items);
}
async function clearBoard() {
  try { await api(`boards/${encodeURIComponent(cur)}`, { clear: true }); els = new Els(); undo = []; redo = []; sel = new Set(); shapesCache.clear(); updateChrome(); draw(); }
  catch (e) { toast(e.message); }
  rev = 0; poll();
}
function exportPng() {
  const list = sel.size ? withLinks(framed(selected())) : [...els.values()];
  const b = bounds(list);
  if (!b) return toast("Nothing to save yet.");
  const pad = 40, s = Math.min(2, 8000 / Math.max(b[2] + pad * 2, b[3] + pad * 2));
  const c = document.createElement("canvas"), g = c.getContext("2d"), rc = rough.canvas(c);
  c.width = Math.ceil((b[2] + pad * 2) * s); c.height = Math.ceil((b[3] + pad * 2) * s);
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, c.width, c.height);
  g.setTransform(s, 0, 0, s, (pad - b[0]) * s, (pad - b[1]) * s);
  const was = editing; editing = null;
  for (const e of list.sort(order)) paint(g, rc, e);
  editing = was;
  c.toBlob((blob) => {
    const a = document.createElement("a"), name = boards.find(x => x.claude === cur)?.name || cur;
    a.href = URL.createObjectURL(blob); a.download = `${String(name).replace(/[^a-z0-9._-]+/gi, "-")}-whiteboard.png`;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }, "image/png");
}
function openHelp() { closePops(); $("#help").showModal(); }

// ------------------------------------------------------------------ start
$("#menu-btn").innerHTML = icon("menu");
$("#menu-btn").onclick = (ev) => { ev.stopPropagation(); renderMenu(false); togglePop("#menu"); $("#menu-btn").setAttribute("aria-expanded", String(!$("#menu").hidden)); };
$("#board-btn").onclick = (ev) => { ev.stopPropagation(); renderBoards(); togglePop("#boards"); $("#board-btn").setAttribute("aria-expanded", String(!$("#boards").hidden)); };
$("#zoom-in").innerHTML = icon("plus"); $("#zoom-out").innerHTML = icon("minus");
$("#undo").innerHTML = icon("undo"); $("#redo").innerHTML = icon("redo");
$("#zoom-in").onclick = () => zoomAt(W / 2, H / 2, 1.2);
$("#zoom-out").onclick = () => zoomAt(W / 2, H / 2, 1 / 1.2);
$("#zoom-reset").onclick = () => zoomTo(1);
$("#undo").onclick = doUndo; $("#redo").onclick = doRedo;
$("#help-btn").onclick = openHelp;
$("#image-file").onchange = () => { const f = $("#image-file").files[0]; if (f) addImage(f); $("#image-file").value = ""; };
for (const id of ["menu", "boards", "shapes", "picker"]) $("#" + id).addEventListener("pointerdown", e => e.stopPropagation());
addEventListener("pointerdown", (e) => { if (!e.target.closest(".popover, .island")) closePops(); });
new ResizeObserver(resize).observe(stage);
document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
document.fonts?.load('20px "Virgil"').then(() => { for (const e of els.values()) delete e._key; shapesCache.clear(); placeEditor(); draw(); }).catch(() => {});
renderToolbar(); setTool("select"); resize(); updateChrome();
loadBoards();
setInterval(loadBoards, 10000);
