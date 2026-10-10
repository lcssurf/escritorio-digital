/* The TASKS page: every sub-agent at work, waiting for its person's OK, waiting or queued, what finished in the last
 * day, and every schedule. Anyone who may watch the farm sees them all (titles, whose, on which Claude, since when);
 * what you can do depends on who you are: the farm manager everything, a Claude's person only that Claude's rows
 * (MINE), someone watching nothing. Status tabs, the search and the Claude filter ask the server (a farm of a hundred
 * Claudes has thousands of tasks), a hundred rows a page, and the choice stays in the address so a link shares it.
 * It refreshes every few seconds while you look and updates rows in place by id, so an open row or a half-clicked
 * SURE? stays as it is. */
const BASE = document.body.dataset.base || "";
const $ = s => document.querySelector(s);
const ZONE = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { return ""; } })();
const TABS = [["", "ALL"], ["running", "AT WORK"], ["pending", "WAITING FOR APPROVAL"], ["waiting", "WAITING"],
  ["queued", "QUEUED"], ["done", "DONE"], ["failed", "FAILED"], ["denied", "DENIED"], ["cancelled", "CANCELLED"]];
const ACTIVE = new Set(["running", "pending", "waiting", "queued"]);
let st = null, busy = false, seq = 0;
const open = new Set();          // rows showing their details: "t:<id>" or "s:<id>"
const detail = new Map();        // a sub-agent's full record, by id (fetched when its row opens)
let armed = null;                // the destructive button waiting for its second click: "<action>:<id>"

// what is shown: ?status=&claude=&q=&page= (page counts from 0 in the API, from 1 in the address)
const view = (() => {
  const p = new URLSearchParams(location.search);
  const v = { status: p.get("status") || "", claude: p.get("claude") || "", q: (p.get("q") || "").slice(0, 120),
    page: Math.max(0, (parseInt(p.get("page"), 10) || 1) - 1) };
  if (!TABS.some(([s]) => s === v.status)) v.status = "";
  return v;
})();

function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "text") e.textContent = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat(4)) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}

async function api(path, body) {
  const opts = { credentials: "same-origin", headers: { Accept: "application/json" } };
  if (body !== undefined) Object.assign(opts, { method: "POST", body: JSON.stringify(body),
    headers: { ...opts.headers, "Content-Type": "application/json", "X-Clodfarm": "1" } });
  const r = await fetch(`${BASE}/api/${path}`, opts);
  // 401 only comes from a private farm this browser may not watch: log in there, then back here
  if (r.status === 401) { location.replace(`${BASE}/?next=tasks`); throw new Error("log in first"); }
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(out.error || r.statusText);
  return out;
}

// ------------------------------------------------------------------ time
const now = () => (st ? st.now + (Date.now() - st.fetched) / 1000 : Date.now() / 1000);
function span(sec) {
  sec = Math.max(0, Math.round(sec));
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86400) { const m = Math.round(sec / 60), hh = Math.floor(m / 60), mm = m % 60; return mm ? `${hh}h ${mm}m` : `${hh}h`; }
  return `${Math.round(sec / 86400)}d`;
}
// rows are compared by their text, so "ago" moves in coarse steps: a row doesn't redraw every poll for its seconds
function ago(t) {
  if (!t) return "";
  const s = now() - t;
  return s < 60 ? "just now" : `${span(s < 3600 ? s : Math.round(s / 300) * 300)} ago`;
}
const until = t => (t > 0 ? (t - now() < 60 ? "now" : `in ${span(t - now())}`) : "never again");
function clock(t) {
  if (!t) return "";
  const d = new Date(t * 1000), same = d.toDateString() === new Date().toDateString();
  return d.toLocaleString([], same ? { hour: "2-digit", minute: "2-digit" } : { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
// a schedule's next time, in the viewer's own clock: "tomorrow at 12:30 AM your time, in 6h 10m"
function nextRun(s) {
  if (s.paused) return "paused";
  if (!(s.next_at > 0)) return "won't run again";
  const d = new Date(s.next_at * 1000), days = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 864e5);
  const day = days === 0 ? "today" : days === 1 ? "tomorrow" : days < 7 ? d.toLocaleDateString([], { weekday: "long" })
    : d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const yours = (s.tz || "UTC") !== ZONE ? " your time" : "";
  return `next ${until(s.next_at) === "now" ? "now" : `${day} at ${time}${yours}, ${until(s.next_at)}`}`;
}
const upper = s => String(s || "").toUpperCase();
const decider = by => (!by ? "" : by.startsWith("owner:") ? `${by.slice(6)}'s person` : by === "manager" ? "the farm manager" : by);

// ------------------------------------------------------------------- who may do what (the server checks again)
const role = () => (st && st.role) || "viewer";
const isManager = () => role() === "manager";
const isOwner = () => role() === "owner" && !!st.me;
const mayTask = t => isManager() || (isOwner() && !!t.mine);
const maySched = s => isManager() || (isOwner() && !!s.mine);
const mayDecide = t => isManager() || (isOwner() && t.to === st.me);

// ---------------------------------------------------------------- actions
function lock(on) { for (const b of document.querySelectorAll("main .btn, .top .btn")) b.disabled = on; }
async function act(path, body = {}, errors = $("#error")) {
  if (busy) return false;
  busy = true; armed = null; errors.textContent = "";
  lock(true);
  let ok = false;
  try { await api(path, body); ok = true; }   // (its answer is the manager's unfiltered view: ask again, as us)
  catch (e) { errors.textContent = e.message; }
  finally { busy = false; lock(false); }
  render(); refresh();
  return ok;
}

function button(a) {
  // a destructive action asks once more on the button itself ("SURE?"), and forgets after a few seconds
  const key = `${a.action}:${a.id}`;
  return h("button", { type: "button", class: "btn small-btn" + (a.danger ? " danger" : a.primary ? " primary" : ""),
    title: a.title, "data-k": key, onclick: () => {
      if (a.confirm && armed !== key) {
        armed = key; render();
        setTimeout(() => { if (armed === key) { armed = null; render(); } }, 4000);
        return;
      }
      act(a.path, a.body || {});
    } }, a.sure ? "SURE?" : a.label);
}

function status(s, text) { return h("span", { class: `st ${s}` }, h("i"), text || upper(s)); }

function toggle(key, id) {
  if (open.has(key)) { open.delete(key); detail.delete(id); }
  else {
    open.add(key);
    if (key.startsWith("t:")) fetchDetail(id);
  }
  render();
}
function fetchDetail(id) {
  api(`tasks/${id}`).then(t => { detail.set(id, t); render(); }).catch(e => { detail.set(id, { error: e.message }); render(); });
}

// ------------------------------------------------ keyed rows: each tbody keeps its rows by key and only rebuilds one
// whose text changed, moving the rest into order; a rebuilt row gives the focus back to the same button
function sync(tbody, items) {
  const have = tbody._rows || (tbody._rows = new Map()), keep = new Set();
  let prev = null;
  for (const it of items) {
    keep.add(it.key);
    let r = have.get(it.key);
    if (!r || r.sig !== it.sig) {
      const el = it.build(), focus = r && r.el.contains(document.activeElement) && document.activeElement.dataset?.k;
      if (r) r.el.replaceWith(el);
      r = { el, sig: it.sig };
      have.set(it.key, r);
      if (focus) el.querySelector(`[data-k="${CSS.escape(focus)}"]`)?.focus();
    }
    const want = prev ? prev.nextSibling : tbody.firstChild;
    if (want !== r.el) tbody.insertBefore(r.el, want);
    prev = r.el;
  }
  for (const [k, r] of have) if (!keep.has(k)) { r.el.remove(); have.delete(k); }
}
const item = (key, v, build) => ({ key, sig: JSON.stringify(v), build: () => build(v) });

// ---------------------------------------------------------------- the rows
function onWhat(t) {
  if (t.status === "running") return t.on ? `${t.on}'s account` : "";
  if (t.status === "pending") return t.to ? `${t.to}, once OK'd` : "once OK'd";
  return t.on ? `waits for ${t.on}` : "any Claude with budget";
}
function since(t) {
  if (t.status === "running") return ago(t.started);
  if (t.status === "pending") return ago(t.approval?.asked_at || t.created);
  if (t.status === "waiting") return `for ${t.children_open || 0} sub-agent${t.children_open === 1 ? "" : "s"}`;
  return ago(t.created);
}
function tags(t) {
  const a = t.approval || {}, out = [];
  if (t.mine) out.push(["mine", "MINE", "Your Claude's: it asked for it, or works on it"]);
  if (t.kind === "plan") out.push(["plan", "PLANNER", "A cycle of the farm's planner"]);
  if (t.status === "pending") out.push(["ok", `WAITS FOR ${upper(t.to)}'S OK`, `${t.to}'s person approves or denies it before it starts`]);
  if (t.status === "denied") out.push(["no", a.decided_by ? `DENIED BY ${upper(decider(a.decided_by))}` : "DENIED", a.decided_by ? "" : "Not approved in time"]);
  return out;
}
function note(t) {
  const a = t.approval || {}, left = a.expires_at ? a.expires_at - now() : null;
  return [
    t.status === "pending" ? `asked by ${a.from || t.owner || "?"}` : "",
    t.status === "pending" && left != null ? (left > 0 ? `${span(left < 3600 ? left : Math.round(left / 300) * 300)} left to decide` : "expired") : "",
    t.id, t.attempts ? `attempt ${t.attempts}/${t.max_attempts || 3}` : "", t.created_by?.startsWith("schedule:") ? "from a schedule" : "",
    t.parent ? `sub-agent of ${t.parent}` : "", t.depth ? `depth ${t.depth}` : ""].filter(Boolean).join(" · ");
}
function acts(t, done) {
  const out = [];
  if (!done && t.status === "pending" && mayDecide(t)) {
    out.push({ label: "APPROVE", action: "approve", path: `approvals/${t.id}/approve`, primary: true, title: "Let it start" },
      { label: "DENY", action: "deny", path: `approvals/${t.id}/deny`, danger: true, confirm: true, title: "It won't start" });
  }
  // (a denied one isn't retried: that would skip its OK)
  if (mayTask(t) && t.status !== "denied") out.push(done ? { label: "RETRY", action: "retry", path: `tasks/${t.id}/retry`, title: "Start it again from scratch" }
    : { label: "CANCEL", action: "cancel", path: `tasks/${t.id}/cancel`, danger: true, confirm: true,
      title: "Stop it (and its own sub-agents). Nothing it did lands." });
  return out.map(a => ({ ...a, id: t.id, sure: armed === `${a.action}:${t.id}` }));
}

function taskItems(t, done) {
  const key = `t:${t.id}`;
  const v = { key, id: t.id, s: t.status, title: t.title || "(untitled)", tags: tags(t), note: note(t), owner: t.owner || "",
    where: done ? (t.worker || "").split("@")[0] || t.on || "" : onWhat(t),
    when: done ? ago(t.finished || t.updated) : since(t), acts: acts(t, done), open: open.has(key), done };
  const out = [item(key, v, rowEl)];
  if (open.has(key)) out.push(item(`d:${t.id}`, { t: { id: t.id, s: t.status }, d: detail.get(t.id) || null }, detailEl));
  return out;
}

function rowEl(v) {
  return h("tr", { class: v.open ? "is-open" : null },
    h("td", { class: "stc" }, status(v.s)),
    h("td", { class: "title" },
      h("button", { type: "button", class: "open", "aria-expanded": String(v.open), onclick: () => toggle(v.key, v.id) }, v.title),
      v.tags.length ? h("span", { class: "tags" }, v.tags.map(([c, text, title]) => h("span", { class: `tag ${c}`, title: title || null, text }))) : null,
      h("span", { class: "sub", text: v.note })),
    h("td", { class: "who", "data-l": "FOR", text: v.owner }),
    h("td", { class: "who", "data-l": v.done ? "RAN ON" : v.s === "running" || v.s === "pending" ? "ON" : "", text: v.where }),
    h("td", { class: "who when-c", text: v.when }),
    h("td", { class: "acts" }, v.acts.map(button)));
}

function detailEl({ t, d }) {
  const body = !d ? [h("p", { class: "muted", text: "Loading…" })] : d.error ? [h("p", { class: "form-error", text: d.error })] : [
    h("dl", {},
      h("dt", { text: "id" }), h("dd", { text: d.id }),
      d.branch ? [h("dt", { text: "branch" }), h("dd", { text: d.branch })] : null,
      d.created_by ? [h("dt", { text: "started by" }), h("dd", { text: d.created_by })] : null,
      d.approval?.asked_at ? [h("dt", { text: "asked" }), h("dd", { text: `${clock(d.approval.asked_at)} by ${d.approval.from || "?"}` })] : null,
      d.approval?.decided_by ? [h("dt", { text: d.approval.ok === false ? "denied by" : "approved by" }), h("dd", { text: decider(d.approval.decided_by) })] : null,
      d.children?.length ? [h("dt", { text: "its sub-agents" }), h("dd", { text: d.children.join(", ") })] : null,
      d.runs?.length ? [h("dt", { text: "runs" }), h("dd", { text: d.runs.map(r => `${(r.worker || "").split("@")[0]} ${r.ok ? "ok" : "not ok"} ${Math.round(r.duration_s || 0)}s`).join(" · ") })] : null),
    d.full ? [h("h3", { text: "ITS INSTRUCTIONS" }), h("pre", { text: d.prompt || "" }),
      d.result ? [h("h3", { text: t.s === "running" ? "ITS LAST RESULT" : "ITS RESULT" }), h("pre", { text: d.result })] : null,
      h("p", { class: "muted small", text: `In a shell: clodfarm result ${d.id}` })]
      : h("p", { class: "muted private", text: "Only its Claude's person sees the instructions and the result." })];
  return h("tr", { class: "details" }, h("td", { colspan: 6 }, h("div", { class: "details" }, body)));
}

function schedItems(s) {
  const key = `s:${s.id}`, may = maySched(s);
  const v = { key, id: s.id, paused: !!s.paused, title: s.title, mine: isOwner() && !!s.mine,
    sub: [s.id, `for ${s.owner || st.me || "the farm"}`, s.runs ? `ran ${s.runs}× · last ${ago(s.last_at)}` : "hasn't run yet"].join(" · "),
    when: s.when, cron: s.cron || "", next: nextRun(s), to: s.to || "any", open: open.has(key),
    acts: !may ? [] : [
      { label: "RUN NOW", action: "run", path: `schedules/${s.id}/run`, title: "Start its sub-agent now, once; its next time stays" },
      s.paused ? { label: "RESUME", action: "resume", path: `schedules/${s.id}/resume`, primary: true, title: "Fire again, from its next time" }
        : { label: "PAUSE", action: "pause", path: `schedules/${s.id}/pause`, title: "Stop it firing until you resume it" },
      { label: "REMOVE", action: "remove", path: `schedules/${s.id}/remove`, danger: true, confirm: true, title: "Delete this schedule" },
    ].map(a => ({ ...a, id: s.id, sure: armed === `${a.action}:${s.id}` })) };
  const out = [item(key, v, schedEl)];
  if (v.open) out.push(item(`d:${s.id}`, { id: s.id, cron: s.cron, tz: s.tz, by: s.created_by, created: s.created, prompt: s.prompt ?? null }, schedDetailEl));
  return out;
}
function schedEl(v) {
  return h("tr", { class: v.open ? "is-open" : null },
    h("td", { class: "stc" }, status(v.paused ? "paused" : "on", v.paused ? "PAUSED" : "ON")),
    h("td", { class: "title" },
      h("button", { type: "button", class: "open", "aria-expanded": String(v.open), onclick: () => toggle(v.key, v.id) }, v.title),
      v.mine ? h("span", { class: "tags" }, h("span", { class: "tag mine", text: "MINE" })) : null,
      h("span", { class: "sub", text: v.sub })),
    h("td", { class: "when", title: v.cron ? `cron ${v.cron}` : null }, v.when, h("span", { class: "sub", text: v.next })),
    h("td", { class: "who", "data-l": "ON", text: v.to }),
    h("td", { class: "acts" }, v.acts.map(button)));
}
function schedDetailEl(s) {
  return h("tr", { class: "details" }, h("td", { colspan: 5 }, h("div", { class: "details" },
    h("dl", {}, h("dt", { text: "id" }), h("dd", { text: s.id }), s.cron ? [h("dt", { text: "cron" }), h("dd", { text: s.cron })] : null,
      h("dt", { text: "time zone" }), h("dd", { text: s.tz || "UTC" }),
      h("dt", { text: "added by" }), h("dd", { text: s.by || "" }), h("dt", { text: "added" }), h("dd", { text: clock(s.created) })),
    s.prompt != null ? [h("h3", { text: "WHAT ITS SUB-AGENT IS TOLD" }), h("pre", { text: s.prompt || "" }),
      h("p", { class: "muted small", text: `In a shell: clodfarm schedule pause|resume|run|remove ${s.id}` })]
      : h("p", { class: "muted private", text: "Only its Claude's person sees what its sub-agent is told." }))));
}

// -------------------------------------------------------------- the choices: tabs, search, Claude, pages
function query() {
  const p = new URLSearchParams();
  for (const k of ["status", "claude", "q"]) if (view[k]) p.set(k, view[k]);
  if (view.page) p.set("page", String(view.page));
  return p.toString();
}
function remember() { // the address shows what you see (pages from 1), so a link shares it
  const p = new URLSearchParams();
  for (const k of ["status", "claude", "q"]) if (view[k]) p.set(k, view[k]);
  if (view.page) p.set("page", String(view.page + 1));
  const s = p.toString();
  history.replaceState(null, "", location.pathname + (s ? `?${s}` : "") + location.hash);
}
function choose(ch) {
  Object.assign(view, { page: 0 }, ch);
  remember(); renderChoices(); refresh();
}

const tabEls = new Map();
function buildTabs() {
  const box = $("#stabs");
  for (const [s, label] of TABS) {
    const b = h("button", { type: "button", role: "tab", class: `stab ${s || "all"}`, "aria-selected": "false",
      onclick: () => choose({ status: s }) }, h("span", { text: label }), " ", h("b", { class: "n", text: "" }));
    tabEls.set(s, b); box.append(b);
  }
  box.addEventListener("keydown", e => { // ← → between the tabs
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const i = TABS.findIndex(([s]) => s === view.status), n = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length][0];
    e.preventDefault(); choose({ status: n }); tabEls.get(n).focus();
  });
}
function renderChoices() {
  for (const [s, b] of tabEls) {
    const on = s === view.status;
    if (b.getAttribute("aria-selected") !== String(on)) {
      b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1;
      if (on) b.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }
  if (document.activeElement !== $("#q") && $("#q").value !== view.q) $("#q").value = view.q;
  if ($("#who").value !== view.claude) { ensureOption(view.claude); $("#who").value = view.claude; }
  const mine = $("#only-mine");
  mine.setAttribute("aria-pressed", String(!!(st && st.me && view.claude === st.me && isOwner())));
}
function ensureOption(v) {
  if (v && ![...$("#who").options].some(o => o.value === v)) $("#who").append(h("option", { value: v }, upper(v)));
}

function pages() { return st ? Math.max(1, Math.ceil(Math.max(st.active_total, st.finished_total) / (st.page_size || 100))) : 1; }
function renderPager(box) {
  const n = pages(), p = view.page;
  box.hidden = n <= 1;
  if (box.hidden) return;
  if (!box.firstChild) box.append(
    h("button", { type: "button", class: "btn small-btn prev", onclick: () => { view.page = Math.max(0, view.page - 1); remember(); refresh(true); } }, "‹ PREV"),
    h("span", { class: "pg" }),
    h("button", { type: "button", class: "btn small-btn next", onclick: () => { view.page = Math.min(pages() - 1, view.page + 1); remember(); refresh(true); } }, "NEXT ›"));
  box.querySelector(".pg").textContent = `PAGE ${p + 1} OF ${n}`;
  box.querySelector(".prev").disabled = p <= 0;
  box.querySelector(".next").disabled = p >= n - 1;
}
function range(total, shown) {
  if (!total) return "· 0";
  const size = st.page_size || 100, a = view.page * size;
  return total <= size ? `· ${total}` : shown ? `· ${a + 1}–${a + shown} OF ${total}` : `· ${total}`;
}

// ------------------------------------------------------------------ render
function take(data) { st = { ...data, fetched: Date.now() }; }

function render() {
  if (!st) return;
  const c = st.counts || {}, n = s => c[s] || 0;
  const all = Object.values(c).reduce((a, b) => a + b, 0);
  $("#state").className = "chip " + (st.paused ? "wait" : n("running") ? "" : "off");
  $("#state-text").textContent = `${n("running")} AT WORK · ${n("pending")} WAITING FOR OK · ${n("waiting") + n("queued")} WAITING`;
  $("#pause").hidden = !isManager() || st.paused; $("#resume").hidden = !isManager() || !st.paused;
  $("#paused-note").hidden = !st.paused;
  $("#paused-note").textContent = `The farm is paused${st.pause_reason ? `: ${st.pause_reason}` : ""}. No new sub-agents start and schedules only queue theirs${isManager() ? ", until you resume" : ""}.`;
  $("#watch-note").hidden = role() !== "viewer";
  $("#add-open").hidden = !(isManager() || isOwner()) || !$("#add-form").hidden;
  $("#only-mine").hidden = !isOwner();

  for (const [s, b] of tabEls) b.querySelector(".n").textContent = String(s ? n(s) : all);
  const filtered = view.claude || view.q;
  $("#board-note").textContent = `${all} at work, waiting or done today${filtered ? ` · filtered${view.claude ? ` to ${view.claude}` : ""}${view.q ? ` by “${view.q}”` : ""}` : ""}`;

  // the Claude filter: every Claude on the farm (a hundred is fine for a select)
  const names = [...new Set(st.claudes || [])].sort(), sel = $("#who");
  if (sel.dataset.names !== names.join(",")) {
    sel.replaceChildren(h("option", { value: "" }, "EVERY CLAUDE"), ...names.map(x => h("option", { value: x }, upper(x))));
    sel.dataset.names = names.join(",");
    ensureOption(view.claude); sel.value = view.claude;
  }
  const onSel = $("#add-form [name=on]");
  if (onSel.dataset.names !== names.join(",")) {
    const v = onSel.value;
    onSel.replaceChildren(h("option", { value: "" }, "any Claude with budget"), ...names.map(x => h("option", { value: x }, x)));
    onSel.dataset.names = names.join(","); onSel.value = v;
  }
  $("#on-pick").hidden = !isManager(); $("#on-mine").hidden = isManager();
  $("#on-mine-name").textContent = isOwner() ? `your Claude, ${st.me}` : "";
  renderChoices();

  const showActive = !view.status || ACTIVE.has(view.status), showDone = !view.status || !ACTIVE.has(view.status);
  $("#active-part").hidden = !showActive; $("#done-part").hidden = !showDone;
  $("#active-n").textContent = range(st.active_total, st.active.length);
  $("#done-n").textContent = range(st.finished_total, st.finished.length);
  sync($("#active"), showActive ? st.active.flatMap(t => taskItems(t, false)) : []);
  sync($("#finished"), showDone ? st.finished.flatMap(t => taskItems(t, true)) : []);
  const none = filtered ? "Nothing here matches." : null, later = "Nothing more on this page: see the pages before.";
  $("#active-empty").hidden = st.active.length > 0;
  $("#active-empty").textContent = st.active_total ? later : none || (view.status ? "None right now." : "No sub-agent is at work or waiting.");
  $("#done-empty").hidden = st.finished.length > 0;
  $("#done-empty").textContent = st.finished_total ? later : none || "Nothing finished in the last day.";
  renderPager($("#pager-top")); renderPager($("#pager-bottom"));

  // schedules are few: filtered here by the same Claude and words
  const words = view.q.toLowerCase();
  const scheds = (st.schedules || []).filter(s => (!view.claude || s.owner === view.claude || s.to === view.claude)
    && (!words || (s.title || "").toLowerCase().includes(words) || s.id.includes(words)));
  sync($("#schedules"), scheds.flatMap(schedItems));
  $("#sched-empty").hidden = scheds.length > 0;
  $("#sched-empty").textContent = st.schedules?.length ? "No schedule matches." :
    isManager() || isOwner() ? "No schedules. Add one here, or ask a Claude: “every weekday at 9, check …”." : "No schedules.";
  $("#to-sched").textContent = `SCHEDULES${st.schedules?.length ? ` (${st.schedules.length})` : ""} ↓`;
}

async function refresh(top) {
  if (busy) return;
  const n = ++seq, qs = query();
  try {
    const data = await api("tasks" + (qs ? `?${qs}` : ""));
    if (n !== seq) return; // a newer question went out meanwhile (the tab or the search changed)
    take(data);
    if (view.page > 0 && view.page >= pages()) { view.page = pages() - 1; remember(); return refresh(); }
    for (const id of [...detail.keys()]) { // an open row's record is fetched again when its sub-agent moved on
      const t = [...st.active, ...st.finished].find(x => x.id === id);
      if (!open.has(`t:${id}`)) detail.delete(id);
      else if (t && detail.get(id).updated !== t.updated) fetchDetail(id);
    }
    render();
    if (top === true) $(".board").scrollIntoView({ block: "start" });
  } catch (e) { if (n === seq) $("#state-text").textContent = "FARM UNREACHABLE"; }
}

// ------------------------------------------------------------ the choices' controls
let typing = null;
$("#q").value = view.q;
$("#q").addEventListener("input", e => {
  clearTimeout(typing);
  typing = setTimeout(() => { const q = e.target.value.trim(); if (q !== view.q) choose({ q }); }, 300);
});
$("#q").addEventListener("keydown", e => { if (e.key === "Escape") { e.target.value = ""; clearTimeout(typing); if (view.q) choose({ q: "" }); } });
$("#who").addEventListener("change", e => choose({ claude: e.target.value }));
$("#only-mine").addEventListener("click", () => { if (st && st.me) choose({ claude: view.claude === st.me ? "" : st.me }); });
addEventListener("keydown", e => { // "/" searches, the way the farm's other pages do their shortcuts
  if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "")) return;
  e.preventDefault(); $("#q").focus(); $("#q").select();
});

// ------------------------------------------------------------ the new schedule
const HINTS = {
  cron: ["0 9 * * 1-5", "minute hour day month weekday: 0 9 * * 1-5 is weekdays at 9:00"],
  every: ["2h", "30m, 2h, 1d or 1w (at least a minute); the first run is one interval from now"],
  at: ["in 3h", "once: 2026-10-01T09:00 (in the time zone), or in 3h"],
};
function kind() { return new FormData($("#add-form")).get("kind"); }
function syncKind() {
  const [ph, hint] = HINTS[kind()], w = $("#add-form [name=when]");
  w.placeholder = ph; $("#when-hint").textContent = hint;
}
$("#add-open").addEventListener("click", () => {
  const f = $("#add-form");
  f.hidden = false; $("#add-open").hidden = true;
  if (!f.tz.value) f.tz.value = ZONE || st?.tz || "UTC";
  syncKind(); f.querySelector("[name=title]").focus();
});
$("#add-cancel").addEventListener("click", () => { $("#add-form").reset(); $("#add-form").hidden = true; $("#add-error").textContent = ""; render(); });
for (const r of document.querySelectorAll("#add-form [name=kind]")) r.addEventListener("change", syncKind);
$("#add-form").addEventListener("submit", async e => {
  e.preventDefault();
  const f = new FormData(e.target), body = { title: f.get("title"), prompt: f.get("prompt"), tz: f.get("tz") };
  if (isManager()) body.on = f.get("on"); // a Claude's person schedules for their own Claude (the server sees to it)
  body[kind()] = f.get("when");
  if (await act("schedules", body, $("#add-error"))) { e.target.reset(); e.target.hidden = true; render(); }
});

// ------------------------------------------------------------------ the farm
$("#pause").addEventListener("click", () => act("pause", { reason: "paused from the TASKS page" }));
$("#resume").addEventListener("click", () => act("resume", {}));

buildTabs();
renderChoices();
refresh();
setInterval(() => { if (!document.hidden) refresh(); }, 4000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
