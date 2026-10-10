"""Dashboards the Claudes build and keep up to date: each one a page at FARM_UI_BASE/dashboards/<slug>.

A dashboard is a JSON spec of widgets that the farm UI draws (no agent-written HTML runs in your browser):

    {"title": "Test suite", "description": "Is the suite getting faster and greener?",
     "widgets": [
       {"type": "stat", "key": "pass_rate", "label": "Pass rate", "value": 97.2, "unit": "%", "good": "up"},
       {"type": "chart", "label": "Pass rate", "from": ["pass_rate"]},
       {"type": "chart", "label": "Build time", "unit": "s", "series": [{"name": "p50", "points": [["2026-09-01", 12.3]]}]},
       {"type": "bars", "label": "Slowest tests", "unit": "s", "items": [{"label": "test_x", "value": 3.2}]},
       {"type": "table", "label": "Flaky", "columns": ["test", "fails"], "rows": [["test_y", 3]]},
       {"type": "progress", "label": "Migration", "value": 42, "max": 100},
       {"type": "text", "label": "Notes", "text": "**Next:** split the slow suite. See [the PR](https://...)."}]}

Dashboards can sit in folders (nested with "/", e.g. "Growth/Leads"): the list page shows a folder's dashboards and
its subfolders. Set one with `folder` when pushing, or move a dashboard later (the page, `clodfarm dashboard move`); a
push without a folder keeps where it is.

Every push records the value of each stat (by its key) in the dashboard's history, one point per hour, so stats show
how they moved (the improvement) without the agent keeping any history itself. A dashboard can also be *live*: give
it a command (code in the repo, e.g. `python3 dashboards/tests.py`) and an interval, and the farm runs it in the repo
and pushes what it prints. The code lives in git, so the Claudes maintain it like any other code.

Every dashboard has a Refresh button. It runs the dashboard's command now (a command with no interval runs only then),
or, for a dashboard without one, starts a sub-agent of the Claude that keeps it to collect the data and push it again
(with the instructions it was given, `agent`, or the dashboard itself as the brief). `requested` is that last refresh:
who asked, the sub-agent it started, and how it ended.

Items (PK / SK):

    DASH           / <slug>              the dashboard: title, folder, widgets, owner, how it refreshes and its last outcome
    DASHH#<slug>   / <yyyy-mm-ddThh>     the stats' values in that hour (expire after 400 days)
"""

from __future__ import annotations

import json
import math
import os
import re
import subprocess
import time
from datetime import datetime, timezone

from .store import Store, now

SLUG = re.compile(r"[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?")
KEY = re.compile(r"[A-Za-z0-9_.-]{1,48}")
TYPES = ("stat", "chart", "bars", "table", "text", "progress")
MAX_SPEC = 256 * 1024
HISTORY_TTL = 400 * 86400
MIN_EVERY = 300
AGENT_TTL = 3600  # a refresh sub-agent that hasn't pushed by then is given up on
DONE = ("done", "failed", "cancelled", "denied")


class SpecError(ValueError):
    pass


# ------------------------------------------------------------------ the spec
def _s(v, n: int) -> str:
    return "" if v is None else str(v).strip()[:n]


def _num(v, what: str, required: bool = False) -> float | None:
    if v is None or v == "":
        if required:
            raise SpecError(f"{what}: a number is required")
        return None
    if isinstance(v, bool):
        raise SpecError(f"{what}: {v!r} is not a number")
    try:
        f = float(v)
    except (TypeError, ValueError):
        raise SpecError(f"{what}: {v!r} is not a number") from None
    if not math.isfinite(f):
        raise SpecError(f"{what}: {v!r} is not a finite number")
    return int(f) if f.is_integer() and abs(f) < 2 ** 53 else f


def _href(v) -> str | None:
    v = _s(v, 1000)
    return v if re.match(r"https?://", v) else None


def parse_time(x, what: str = "time") -> float:
    """A point's time: unix seconds (or milliseconds), or an ISO date / date-time (UTC unless it says otherwise)."""
    if isinstance(x, (int, float)) and not isinstance(x, bool):
        return float(x) / 1000 if x > 1e11 else float(x)
    s = _s(x, 40)
    try:
        d = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        raise SpecError(f"{what}: {x!r} is not a time (use unix seconds or an ISO date like 2026-09-27T14:00)") from None
    return (d if d.tzinfo else d.replace(tzinfo=timezone.utc)).timestamp()


def _widget(w, i: int) -> dict:
    where = f"widget {i + 1}"
    if not isinstance(w, dict):
        raise SpecError(f"{where}: expected an object")
    t = w.get("type")
    if t not in TYPES:
        raise SpecError(f"{where}: type must be one of {', '.join(TYPES)} (got {t!r})")
    out = {"type": t, "label": _s(w.get("label"), 120)}
    where += f" ({out['label'] or t})"
    if w.get("note"):
        out["note"] = _s(w["note"], 300)
    if w.get("width") in ("full", "half"):
        out["width"] = w["width"]
    if t in ("stat", "chart", "bars", "progress") and w.get("unit"):
        out["unit"] = _s(w["unit"], 12)
    if t == "stat":
        key = _s(w.get("key"), 48) or re.sub(r"[^a-z0-9]+", "_", out["label"].lower()).strip("_")[:48]
        if not KEY.fullmatch(key or ""):
            raise SpecError(f"{where}: give it a key (letters, digits, _ . -), used for its history")
        out.update(key=key, value=_num(w.get("value"), where))
        if w.get("good") in ("up", "down"):
            out["good"] = w["good"]
        if w.get("target") is not None:
            out["target"] = _num(w["target"], where + " target")
    elif t == "chart":
        if w.get("from"):
            keys = w["from"] if isinstance(w["from"], list) else [w["from"]]
            out["from"] = [k for k in (_s(k, 48) for k in keys[:5]) if KEY.fullmatch(k)]
            if not out["from"]:
                raise SpecError(f"{where}: `from` lists the stat keys to chart")
        else:
            series = w.get("series")
            if not isinstance(series, list) or not series:
                raise SpecError(f"{where}: give `series` ([{{name, points: [[time, value], ...]}}]) or `from` (stat keys)")
            out["series"] = []
            for j, s in enumerate(series[:5]):  # five colors, never cycled
                if not isinstance(s, dict) or not isinstance(s.get("points"), list):
                    raise SpecError(f"{where}: series {j + 1} needs `points`: [[time, value], ...]")
                pts = []
                for p in s["points"][:2000]:
                    if not isinstance(p, (list, tuple)) or len(p) != 2:
                        raise SpecError(f"{where}: a point is [time, value], got {p!r}")
                    pts.append([parse_time(p[0], where), _num(p[1], where)])
                out["series"].append({"name": _s(s.get("name"), 60) or f"series {j + 1}",
                                      "points": sorted((p for p in pts if p[1] is not None), key=lambda p: p[0])})
        if w.get("good") in ("up", "down"):
            out["good"] = w["good"]
    elif t == "bars":
        items = w.get("items")
        if not isinstance(items, list):
            raise SpecError(f"{where}: `items` is a list of {{label, value}}")
        out["items"] = [{k: v for k, v in {"label": _s(it.get("label"), 120), "value": _num(it.get("value"), where, True),
                                            "href": _href(it.get("href"))}.items() if v is not None}
                        for it in items[:50] if isinstance(it, dict)]
    elif t == "table":
        cols, rows = w.get("columns"), w.get("rows")
        if not isinstance(cols, list) or not isinstance(rows, list):
            raise SpecError(f"{where}: `columns` is a list of names and `rows` a list of lists")
        out["columns"] = [_s(c, 60) for c in cols[:12]]

        def cell(c):
            if isinstance(c, dict):
                return {k: v for k, v in {"text": _s(c.get("text"), 300), "href": _href(c.get("href"))}.items() if v}
            if isinstance(c, (int, float)) and not isinstance(c, bool):
                return _num(c, where)
            return None if c is None else _s(c, 300)
        out["rows"] = [[cell(c) for c in (r if isinstance(r, list) else [r])[:12]] for r in rows[:200]]
    elif t == "text":
        out["text"] = _s(w.get("text"), 5000)
    elif t == "progress":
        out.update(value=_num(w.get("value"), where, True), max=_num(w.get("max", 100), where) or 100)
    return out


def normalize(spec) -> dict:
    """Check a pushed spec and return the clean version (raises SpecError with a message an agent can act on)."""
    if isinstance(spec, (str, bytes)):
        try:
            spec = json.loads(spec)
        except ValueError as e:
            raise SpecError(f"not JSON: {e}") from None
    if not isinstance(spec, dict):
        raise SpecError("a dashboard is a JSON object: {title, description, widgets: [...]}")
    if len(json.dumps(spec, default=str)) > MAX_SPEC:
        raise SpecError(f"too big (over {MAX_SPEC // 1024} KB): keep the points to what the charts need")
    widgets = spec.get("widgets", [])
    if not isinstance(widgets, list):
        raise SpecError("`widgets` is a list")
    if len(widgets) > 40:
        raise SpecError("at most 40 widgets")
    out = {"widgets": [_widget(w, i) for i, w in enumerate(widgets)]}
    keys = [w["key"] for w in out["widgets"] if w["type"] == "stat"]
    if len(keys) != len(set(keys)):
        raise SpecError("two stats have the same key")
    for k in ("title", "description"):
        if spec.get(k):
            out[k] = _s(spec[k], 120 if k == "title" else 500)
    return out


def clean_folder(folder) -> str:
    """'  Growth / Leads/ ' -> 'Growth/Leads'; '' is the top level. At most 3 levels of 40 characters."""
    parts = [" ".join(p.split()) for p in str(folder or "").split("/")]
    parts = [p for p in parts if p]
    if len(parts) > 3:
        raise SpecError("folders go at most 3 deep (e.g. 'Growth/Leads/EU')")
    if any(len(p) > 40 for p in parts):
        raise SpecError("a folder's name is at most 40 characters")
    return "/".join(parts)


def _slug(slug: str) -> str:
    slug = (slug or "").strip().lower()
    if not SLUG.fullmatch(slug):
        raise SpecError(f"bad name {slug!r}: lowercase letters, digits and dashes (it becomes /dashboards/<name>)")
    return slug


# ----------------------------------------------------------------- the store
def get(store: Store, slug: str) -> dict | None:
    return store.b.get("DASH", slug)


def all_(store: Store) -> list[dict]:
    return sorted(store.b.query("DASH"), key=lambda d: -float(d.get("updated", 0)))


def _record(store: Store, slug: str, widgets: list[dict], t: float):
    vals = {w["key"]: w["value"] for w in widgets if w["type"] == "stat" and w.get("value") is not None}
    if vals:
        hour = time.strftime("%Y-%m-%dT%H", time.gmtime(t))
        store._update(f"DASHH#{slug}", hour, lambda x: {**x, "values": {**(x.get("values") or {}), **vals}, "at": t,
                                                         "expires_at": int(t + HISTORY_TTL)}, create=True)


def push(store: Store, slug: str, spec, by: str = "human", owner: str | None = None, folder: str | None = None) -> dict:
    """Create or replace a dashboard's widgets (keeping its refresh command, and its folder unless given), and record
    its stats."""
    slug, clean, t = _slug(slug), normalize(spec), now()
    folder = None if folder is None else clean_folder(folder)

    def fn(x):
        new = not x
        x.update(slug=slug, title=clean.get("title") or x.get("title") or slug, widgets=clean["widgets"], updated=t,
                 updated_by=by, pushes=int(x.get("pushes", 0)) + 1)
        x["description"] = clean.get("description", x.get("description", ""))
        if folder is not None:
            x["folder"] = folder
        if new:
            x.update(created=t, owner=owner or by)
        q = x.get("requested")
        if q and not q.get("done_at"):  # fresh data: the refresh someone asked for is done
            x["requested"] = {**q, "done_at": t, "ok": True, "error": ""}
        return x
    it = store._update("DASH", slug, fn, create=True)
    _record(store, slug, it["widgets"], t)
    if it["pushes"] == 1:
        store.event("dashboard.added", f"{slug} {it['title'][:100]}", by=by)
    return it


def set_metric(store: Store, slug: str, key: str, value, label: str | None = None, unit: str | None = None,
               good: str | None = None, by: str = "human", owner: str | None = None, folder: str | None = None) -> dict:
    """Set one stat (adding it, and the dashboard, when new): the quick way to log a number after a change."""
    slug = _slug(slug)
    d = get(store, slug) or {}
    widgets = list(d.get("widgets") or [])
    w = next((w for w in widgets if w["type"] == "stat" and w.get("key") == key), None)
    if not w:
        w = {"type": "stat", "key": key}
        widgets.insert(sum(x["type"] == "stat" for x in widgets), w)
    w.update(value=value, **{k: v for k, v in {"label": label or w.get("label") or key, "unit": unit, "good": good}.items() if v})
    return push(store, slug, {"title": d.get("title") or slug, "description": d.get("description", ""), "widgets": widgets},
                by=by, owner=owner, folder=folder)


def move(store: Store, slug: str, folder: str, by: str = "human") -> dict:
    """Put a dashboard in a folder ('' for the top level)."""
    slug, folder = _slug(slug), clean_folder(folder)
    it = store._update("DASH", slug, lambda x: {**x, "folder": folder})
    if not it:
        raise SpecError(f"no dashboard {slug}")
    store.event("dashboard.moved", f"{slug} to {folder or 'the top level'}", by=by)
    return it


def rename_folder(store: Store, old: str, new: str, by: str = "human") -> int:
    """Rename a folder (moving its subfolders along; into another folder's name merges them). How many moved."""
    old, new = clean_folder(old), clean_folder(new)
    if not old:
        raise SpecError("name the folder to rename")
    if new == old or new.startswith(old + "/"):
        raise SpecError("a folder can't move into itself")
    n = 0
    for d in store.b.query("DASH"):
        f = d.get("folder") or ""
        if f == old or f.startswith(old + "/"):
            store._update("DASH", d["SK"], lambda x, f=f: {**x, "folder": clean_folder(new + f[len(old):])})
            n += 1
    if n:
        store.event("dashboard.folder", f"{old} renamed {new or 'the top level'}", by=by)
    return n


def set_refresh(store: Store, slug: str, cmd: str | None = None, every: int | None = None, by: str = "human",
                agent: str | None = None) -> dict:
    """How a dashboard refreshes: ``cmd`` (code in the repo that prints its spec; with ``every`` seconds the farm also
    runs it on that schedule, without, only from its page's Refresh button), or ``agent`` (instructions for the
    sub-agent its Refresh button starts to collect the data and push it). Neither: its Claude is asked, with the
    dashboard itself as the brief."""
    slug = _slug(slug)
    if cmd and agent:
        raise SpecError("give a command or a sub-agent's instructions, not both")
    if every and not cmd:
        raise SpecError("only a command refreshes on a schedule (a recurring sub-agent is a `clodfarm schedule`)")
    if cmd and every is not None and every < MIN_EVERY:
        raise SpecError(f"refresh at most every {MIN_EVERY // 60} minutes")

    def fn(x):
        old = {k: v for k, v in (x.get("refresh") or {}).items() if k in ("last_at", "ok", "error")}
        if cmd:
            x["refresh"] = {**old, "cmd": cmd[:500], "by": by}
            if every:
                x["refresh"].update(every=int(every), next_at=now() + int(every))
        elif agent:
            x["refresh"] = {**old, "agent": agent.strip()[:4000], "by": by}
        else:
            x.pop("refresh", None)
        return x
    it = store._update("DASH", slug, fn)
    if not it:
        raise SpecError(f"no dashboard {slug}: push it first")
    return it


def _busy(store: Store, q: dict | None) -> bool:
    """Is the refresh someone asked for still under way? (A sub-agent that ended without pushing is not.)"""
    if not q or q.get("done_at"):
        return False
    if q.get("task"):
        task = store.get_task(q["task"]) or {}
        return task.get("status") not in DONE and now() - float(q.get("at", 0)) < AGENT_TTL
    return now() - float(q.get("at", 0)) < int(os.environ.get("FARM_DASHBOARD_TIMEOUT", "300")) + 60


def _settle(store: Store, d: dict) -> dict:
    """Close a requested refresh whose sub-agent ended (or ran out of time) without pushing, so the page says so."""
    q = d.get("requested")
    if not q or q.get("done_at") or _busy(store, q):
        return d
    task = store.get_task(q["task"]) if q.get("task") else None
    status = (task or {}).get("status")
    said = {"done": "finished", "failed": "failed", "cancelled": "was cancelled", "denied": "was not approved"}
    err = (f"its sub-agent {said.get(status, status)} without pushing new data" + (f": {(task.get('result') or '')[-300:]}"
                                                                 if task.get("result") else "")
           if status in DONE else "it took too long and was given up on")

    def fn(x):
        qq = x.get("requested") or {}
        if qq.get("at") != q.get("at") or qq.get("done_at"):
            return None
        x["requested"] = {**qq, "done_at": now(), "ok": False, "error": err[:600]}
        return x
    return store._update("DASH", d["slug"], fn) or get(store, d["slug"]) or d


def agent_prompt(d: dict, url: str = "") -> str:
    """What the sub-agent a Refresh button starts is asked to do."""
    r, slug = d.get("refresh") or {}, d["slug"]
    return (f"Refresh the dashboard '{slug}' ({d.get('title') or slug}){' at ' + url if url else ''}: its person pressed "
            "its Refresh button and wants current numbers now.\n\n"
            + (f"How to collect them:\n{r['agent']}\n\n" if r.get("agent") else
               f"Collect the current data the same way its numbers were made: `clodfarm dashboard show {slug}` shows "
               "what it has now. ")
            + f"Then push it: `clodfarm dashboard push {slug} --file spec.json` with the whole page, or "
            f"`clodfarm dashboard metric {slug} <key> <value>` per stat. Keep its layout, stat keys and folder. This is "
            "a refresh, not new work: be quick, and don't change code unless the data can't be had without it. If you "
            "can't get the data, push nothing and say why in your answer. To make the next refresh instant, write the "
            f"code that measures, commit it and `clodfarm dashboard push {slug} --run '<command>' --every manual`.")


def request_refresh(store: Store, slug: str, by: str = "human", to: str | None = None, url: str = "",
                    created_by: str | None = None, max_depth: int = 3, max_attempts: int = 1) -> dict:
    """Refresh a dashboard now (its page's Refresh button). Claims it, so two clicks (or two people) start one refresh,
    and returns the dashboard with ``requested`` set. A dashboard with a command comes back for the caller to run it
    (``refresh`` in a thread); for any other a sub-agent of ``to`` (the Claude that keeps it) is queued here."""
    slug, t = _slug(slug), now()
    d = get(store, slug)
    if not d:
        raise SpecError(f"no dashboard {slug}")
    if _busy(store, d.get("requested")):
        raise SpecError("it is already refreshing")
    cmd = bool((d.get("refresh") or {}).get("cmd"))
    q = {"at": t, "by": by, "kind": "cmd" if cmd else "agent"}

    def fn(x):
        if _busy(store, x.get("requested")):
            return None  # someone else just asked
        x["requested"] = q
        return x
    it = store._update("DASH", slug, fn)
    if not it:
        raise SpecError("it is already refreshing")
    if cmd:
        return it
    try:
        task = store.add_task(f"Refresh dashboard {slug}", agent_prompt(it, url), priority=7, kind="task",
                              created_by=created_by or by, to=to, owner=to, max_depth=max_depth,
                              max_attempts=max_attempts)
    except ValueError as e:
        store._update("DASH", slug, lambda x: {**x, "requested": {**q, "done_at": now(), "ok": False, "error": str(e)}})
        raise SpecError(str(e)) from None
    store.event("dashboard.refresh", f"{slug}: sub-agent {task['id']} collects its data, asked by {by}", task=task["id"],
                by=by)
    return store._update("DASH", slug, lambda x: {**x, "requested": {**(x.get("requested") or q), "task": task["id"],
                                                                     "status": task["status"]}}) or it


def history(store: Store, slug: str, since: float) -> list[dict]:
    rows = store.b.query(f"DASHH#{slug}", sk_gt=time.strftime("%Y-%m-%dT%H", time.gmtime(since - 3600)))
    return [{"at": float(r.get("at", 0)), "values": r.get("values") or {}} for r in rows if float(r.get("at", 0)) >= since]


def remove(store: Store, slug: str, by: str = "human") -> bool:
    d = get(store, slug)
    if not d:
        return False
    for r in store.b.query(f"DASHH#{slug}"):
        store.b.delete(r["PK"], r["SK"])
    store.b.delete("DASH", slug)
    store.event("dashboard.removed", f"{slug} {d.get('title', '')[:100]}", by=by)
    return True


def claim_due(store: Store) -> list[dict]:
    """The live dashboards due for a refresh, each claimed atomically (every box may call this; one runs each)."""
    out, t = [], now()
    for d in store.b.query("DASH"):
        r = d.get("refresh") or {}
        if not r.get("cmd") or not r.get("every") or float(r.get("next_at", 0)) > t:
            continue  # not live, run only by hand, or not due
        due = float(r["next_at"])

        def advance(x, due=due):
            rr = x.get("refresh") or {}
            if float(rr.get("next_at", -1)) != due:
                return None  # another box took it
            rr["next_at"] = t + int(rr.get("every", 3600))
            x["refresh"] = rr
            return x
        it = store._update("DASH", d["SK"], advance)
        if it:
            out.append(it)
    return out


def run_refresh(cmd: str, cwd: str, slug: str, timeout: int | None = None) -> dict:
    """Run a dashboard's command and return the spec it printed (the last JSON object on stdout)."""
    timeout = timeout or int(os.environ.get("FARM_DASHBOARD_TIMEOUT", "300"))
    try:
        p = subprocess.run(cmd, shell=True, cwd=cwd, capture_output=True, text=True, timeout=timeout,
                           env={**os.environ, "FARM_DASHBOARD": slug})
    except subprocess.TimeoutExpired:
        raise SpecError(f"`{cmd}` took longer than {timeout}s") from None
    if p.returncode != 0:
        raise SpecError(f"`{cmd}` exited {p.returncode}: {(p.stderr or p.stdout).strip()[-400:]}")
    out = p.stdout.strip()
    start = out.rfind("\n{") + 1 if not out.startswith("{") else 0
    try:
        return json.loads(out[start:])
    except ValueError:
        raise SpecError(f"`{cmd}` must print the dashboard as JSON; it printed: {out[-300:]!r}") from None


def refresh(store: Store, d: dict, cwd: str) -> dict:
    """Run one live dashboard and push the result, keeping its outcome (shown on the dashboard) either way."""
    r, t = d["refresh"], now()
    try:
        it = push(store, d["slug"], run_refresh(r["cmd"], cwd, d["slug"]), by=f"refresh:{r.get('by') or 'farm'}")
        ok, err = True, ""
    except SpecError as e:
        it, ok, err = d, False, str(e)[:600]
        store.event("dashboard.failed", f"{d['slug']}: {err[:300]}")
        if r.get("ok", True) and d.get("owner"):  # it just broke: tell the Claude that keeps it (once, not every run)
            store.send_message("farm", d["owner"], f"Your live dashboard '{d['slug']}' failed to refresh: {err[:400]}\n"
                               f"Fix the code (`{r['cmd']}`, run in the repo on main) and check it with "
                               f"`clodfarm dashboard refresh {d['slug']}`.", wake=True)
    def fn(x):
        if not x.get("refresh"):
            return None
        x["refresh"] = {**x["refresh"], "last_at": t, "ok": ok, "error": err}
        q = x.get("requested")
        if q and not q.get("done_at"):  # a Refresh button's run (a successful one is settled by its push)
            x["requested"] = {**q, "done_at": now(), "ok": ok, "error": err}
        return x
    store._update("DASH", d["slug"], fn)
    return {**it, "ok": ok, "error": err}


# ------------------------------------------------------------------- views
def _stats(d: dict) -> list[dict]:
    return [w for w in d.get("widgets") or [] if w["type"] == "stat"]


def summary(store: Store, d: dict, days: int = 30) -> dict:
    """One card of the dashboards list: title, owner, freshness and its first stats with their trend."""
    hist = history(store, d["slug"], now() - days * 86400) if _stats(d) else []
    stats = []
    for w in _stats(d)[:3]:
        pts = [[h["at"], h["values"][w["key"]]] for h in hist if w["key"] in h["values"]]
        stats.append({**{k: w.get(k) for k in ("key", "label", "value", "unit", "good")}, "points": pts[-60:]})
    r = d.get("refresh") or {}
    return {"slug": d["slug"], "title": d.get("title") or d["slug"], "description": d.get("description", ""),
            "folder": d.get("folder") or "", "owner": d.get("owner"), "updated": d.get("updated"), "widgets": len(d.get("widgets") or []), "stats": stats,
            "live": bool(r.get("cmd") and r.get("every")), "every": r.get("every"),
            "ok": r.get("ok", True) if r.get("last_at") else None,
            "refreshing": _busy(store, d.get("requested"))}


def view(store: Store, d: dict, days: int = 30) -> dict:
    """A whole dashboard for its page: the widgets plus the history of every stat."""
    d = _settle(store, d)
    r, q = d.get("refresh") or {}, d.get("requested")
    return {"slug": d["slug"], "title": d.get("title") or d["slug"], "description": d.get("description", ""),
            "folder": d.get("folder") or "", "owner": d.get("owner"), "created": d.get("created"), "updated": d.get("updated"),
            "updated_by": d.get("updated_by"), "widgets": d.get("widgets") or [], "days": days,
            "history": history(store, d["slug"], now() - days * 86400),
            "refresh": {k: r.get(k) for k in ("cmd", "every", "next_at", "last_at", "ok", "error")} if r.get("cmd") else None,
            "agent": r.get("agent") or None,
            "requested": {**{k: q.get(k) for k in ("at", "by", "kind", "task", "done_at", "ok", "error")},
                          "busy": _busy(store, q)} if q else None}
