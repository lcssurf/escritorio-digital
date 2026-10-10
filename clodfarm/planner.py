"""The planner: one Claude that works toward a goal all the time, in cycles.

The farm manager sets the goal and switches it on (the manager panel, or `clodfarm planner on`). The farm's own daemon
(one across boxes, by a lease) starts a planner cycle whenever the last one is over and its wait is up: a sub-agent
of kind ``plan`` on the planner's Claude (the farm's own Claude, one whose person allowed it, or a bot the manager
added: the planner can think on GPT, Grok or Gemini and still have the Claudes write the code). The cycle reads its
notebook, looks at the farm (every Claude's budget and tools), delegates work as its own sub-agents (on any Claude:
their persons' approvals apply), builds tools the goal needs, and ends; it is resumed with its sub-agents' results like
any parent, and the next cycle starts after ``every_s`` or once they are all in.
"""

from __future__ import annotations

import os

from . import prompts
from .store import now

ACTIVE = ("queued", "running", "waiting", "pending")


def notes_path(workspace: str) -> str:
    return os.path.join(workspace, ".farm", "planner", "NOTES.md")


def _every(s: float) -> str:
    s = int(s)
    return f"{s // 3600}h" if s % 3600 == 0 and s >= 3600 else f"{s // 60}m" if s >= 60 else f"{s}s"


def host_ok(rec: dict) -> bool:
    """The planner may run on a Claude whose person allowed it, or on a bot the farm manager added: a bot spends its
    provider's key, which the manager gave the farm, not a person's subscription."""
    return bool(rec.get("planner_host_ok")) or bool(rec.get("bot") and rec.get("hatched_by") == "manager")


def snapshot(store, cfg) -> str:
    from .cli import _seats
    lines = []
    tools = store.tools()
    seats = {r["seat"]: r for r in _seats(cfg, store)}
    boxes: dict[str, str] = {}
    bots: dict[str, dict] = {}
    for w in store.workers():
        name = w["SK"].split("/")[0].split("@")[0]
        boxes.setdefault(name, w.get("seat") or "")
        if w.get("bot"):
            bots[name] = w
    for name in sorted(set(boxes) | set(tools)):
        r = seats.get(boxes.get(name)) or {}
        snap = r.get("snapshot")
        use = ""
        if snap and snap.five_hour:
            use = f"5h {snap.five_hour.utilization:.0%} used"
        if snap and snap.seven_day:
            use += f", 7d {snap.seven_day.utilization:.0%} used"
        if name in bots:  # no subscription windows: what it costs is what counts
            b = bots[name]
            use = (f"BOT on {b['bot']}" + (f" via {b['bot_via']}" if b.get("bot_via") else "")
                   + f", ${store.spent_today(boxes.get(name) or f'bot-{name}'):.2f} spent today at list price"
                   + ("" if b.get("bot_takes") == "any" else "; takes only work sent to it with --on"))
        rec = store.claude(name)
        t = tools.get(name) or {}
        mcps = ", ".join(sorted(m.get("name", "?") for m in t.get("mcp_servers") or [] if isinstance(m, dict)))[:300]
        skills = ", ".join(sorted(map(str, t.get("skills") or [])))[:300]
        lines.append(f"- {name}: {use or 'usage not measured yet'}"
                     + ("; its person approves every mission" if rec.get("approve_missions") else "")
                     + (f"; tools off: {', '.join(rec['tools']['deny'])}" if (rec.get('tools') or {}).get('deny') else "")
                     + (f"\n    MCP: {mcps}" if mcps else "") + (f"\n    skills: {skills}" if skills else ""))
    counts = {s: store.count(s) for s in ("running", "queued", "waiting", "pending")}
    lines.append("Sub-agents on the farm: " + ", ".join(f"{v} {k}" for k, v in counts.items()))
    return "\n".join(lines) or "(no Claude has reported in yet)"


def tick(store, cfg, farm_id: str, primary: str):
    """Called every main-loop tick by the farm's own daemon. Starts the next cycle when it is due."""
    pl = store.planner()
    if not pl.get("on"):
        if pl.get("state") not in (None, "off"):
            store.set_planner(state="off")
        return None
    if not store.planner_claim(farm_id, 120):
        return None  # another box drives it
    host = pl.get("host") or primary
    rec = store.claude(host)
    if host != primary and not host_ok(rec):
        if pl.get("state") != "host-refused":
            store.set_planner(state="host-refused")
            store.event("planner.blocked", f"the planner can't run on {host}: its person hasn't allowed it (SETTINGS)")
        return None
    t = store.get_task(pl["task"]) if pl.get("task") else None
    if t and t.get("status") in ACTIVE:
        st = "waiting for its sub-agents" if t["status"] == "waiting" else t["status"]
        if pl.get("state") != st:
            store.set_planner(state=st)
        return None
    if float(pl.get("idle_until") or 0) > now():
        if pl.get("state") != "idle":
            store.set_planner(state="idle")
        return None
    every = float(pl.get("every_s") or 900)
    last_at = float(pl.get("last_at") or 0)
    if t and now() - last_at < every and t.get("status") in ("done",):
        if pl.get("state") != "resting":
            store.set_planner(state="resting", next_at=last_at + every)
        return None
    if t and t.get("status") in ("failed", "cancelled", "denied") and now() - last_at < min(every, 300):
        return None  # a failed cycle: don't spin
    cycle = int(pl.get("cycles") or 0) + 1
    path = notes_path(cfg.workspace)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    try:
        notes = open(path).read()
    except OSError:
        notes = ""
    prompt = prompts.planner_prompt(pl.get("goal") or "", cycle, _every(every), path, notes, snapshot(store, cfg),
                                    (t or {}).get("result", ""), bot=rec.get("bot") or "")
    task = store.add_task(f"Planner cycle {cycle}: {(pl.get('goal') or '')[:60]}", prompt, priority=6, kind="plan",
                          to=host, owner=host, created_by="planner", max_depth=cfg.max_depth,
                          max_attempts=cfg.max_attempts)
    store.set_planner(task=task["id"], cycles=cycle, last_at=now(), state="queued", next_at=None)
    store.event("planner.cycle", f"planner cycle {cycle} on {host}: {task['id']}", task=task["id"], by="planner")
    return task
