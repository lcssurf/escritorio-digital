#!/usr/bin/env python3
"""Fill a farm with made-up Claudes and work, to see (and load-test) the farm UI with a hundred of them.

    FARM_WORKSPACE=/tmp/bigfarm FARM_AGENTS_KEEP=0 python scripts/seed_farm.py --claudes 100 --tasks 1000 [--live]

It writes straight to the farm's store and registry: Claudes (with skins, some approving every mission), their
workers' heartbeats, budgets, sub-agents in every state, missions waiting for approval, tokens burned, and a planner.
With --live it keeps them moving (heartbeats, tasks finishing and starting, tokens ticking) until you stop it.
Dev only: run the UI with FARM_AGENTS_KEEP=0 so nobody tries to start a hundred `clodfarm run`s.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import socket
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from clodfarm.config import load  # noqa: E402
from clodfarm.governor import Snapshot, Window  # noqa: E402
from clodfarm.store import Store  # noqa: E402

NAMES = ["matan", "gil", "noa", "dana", "yoni", "maya", "omer", "tal", "shira", "ido", "roni", "lior", "adi", "eyal",
         "yael", "amit", "nir", "hila", "ben", "keren"]
HATS = ["straw", "beanie", "cap", "flower", "headphones", "bow", "crown", "sprout", "wizard", "chef"]
COLORS = ["#e8875b", "#5b8ce8", "#8be85b", "#e85bb8", "#e8d35b", "#5be8d3", "#a05be8", "#e85b5b"]
WORK = ["Add CSV export", "Fix flaky login test", "Triage new issues", "Write the release notes", "Speed up the build",
        "Migrate users table", "Review PR #%d", "Update dependencies", "Refactor billing", "Add dark mode",
        "Draft onboarding email", "Scrape competitor pricing", "Summarize support tickets", "Tune the search index"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--claudes", type=int, default=100)
    ap.add_argument("--tasks", type=int, default=1000)
    ap.add_argument("--live", action="store_true")
    a = ap.parse_args()
    cfg = load()
    store = Store.from_config(cfg)
    store.ensure_table()
    farm = os.path.join(cfg.workspace, ".farm")
    base = os.environ.get("FARM_AGENTS_DIR") or os.path.join(os.path.expanduser(
        os.environ.get("CLAUDE_CONFIG_DIR") or "~/.claude"), "clodfarm-agents")
    os.makedirs(farm, exist_ok=True)
    host = socket.gethostname()
    agents = []
    for i in range(a.claudes):
        aid = f"{NAMES[i % len(NAMES)]}{'' if i < len(NAMES) else i // len(NAMES)}"
        d = os.path.join(base, aid)
        os.makedirs(d, exist_ok=True)
        agents.append({"id": aid, "name": aid, "primary": False, "config_dir": d, "hat": HATS[i % len(HATS)],
                       "created": time.time() - i * 60})
        store.put_claude(aid, name=aid, hat=HATS[i % len(HATS)],
                         colors={"hat": random.choice(COLORS), "body": random.choice(["#d97757", "#c96a4a", "#e0896b"])},
                         approve_missions=random.random() < 0.3, owned=True)
        store.add_tokens({"input": random.randint(int(1e4), int(2e6)), "output": random.randint(int(1e3), int(3e5)),
                          "cache_read": random.randint(int(1e5), int(2e7)), "cache_write": random.randint(int(1e4), int(1e6))}, aid)
        seat = f"seat-{aid}"
        t = time.time()
        store.put_snapshot(Snapshot(observed_at=t, five_hour=Window(random.random() * 0.9, t + 3 * 3600),
                                    seven_day=Window(random.random() * 0.85, t + 4 * 86400)), seat)
    json.dump({"agents": agents}, open(os.path.join(farm, "agents.json"), "w"), indent=1)
    ids = [x["id"] for x in agents]
    running: dict[str, list] = {}
    for n in range(a.tasks):
        title = random.choice(WORK)
        title = title % random.randint(int(10), int(999)) if "%d" in title else title
        who = random.choice(ids)
        roll = random.random()
        to = random.choice(ids) if random.random() < 0.3 else None
        t = store.add_task(title, f"(seeded) {title}", owner=who, to=to, created_by=who)
        if t["status"] == "pending":
            continue
        if roll < 0.12:  # at work
            box = f"{to or who}@{host}"
            w = f"w{len(running.get(box, []))}"
            store._set_status(t["id"], "running", extra={"worker": f"{box}/{w}", "lease_until": time.time() + 86400,
                                                         "started": time.time()})
            running.setdefault(box, []).append(t["id"])
        elif roll < 0.25:
            pass  # queued
        elif roll < 0.9:
            store._set_status(t["id"], "done" if random.random() < 0.9 else "failed",
                              extra={"finished": time.time() - random.random() * 80000, "result": "(seeded) done"})
    store.set_planner(on=True, goal="Grow the farm's revenue: find and ship the three highest-value features",
                      every_s=900, state="waiting for its sub-agents", cycles=7, last_at=time.time() - 300)

    def beat():
        for aid in ids:
            box = f"{aid}@{host}"
            seat = f"seat-{aid}"
            tasks = running.get(box, [])
            states = ["running"] * len(tasks) + (["throttled: pacing"] if random.random() < 0.2 else ["idle"])
            for i, st in enumerate(states):
                store.heartbeat(box, f"w{i}", st, tasks[i] if i < len(tasks) else None, seat=seat)
    beat()
    print(f"seeded {len(ids)} Claudes, {a.tasks} tasks into {cfg.workspace}", flush=True)
    while a.live:
        time.sleep(20)
        beat()
        for box, tasks in running.items():
            if tasks and random.random() < 0.3:
                tid = tasks.pop(0)
                store._set_status(tid, "done", extra={"finished": time.time(), "result": "(seeded) done"})
                store.event("task.done", f"{tid} finished")
        for aid in random.sample(ids, min(10, len(ids))):
            store.add_tokens({"output": random.randint(int(100), int(5000)), "input": random.randint(int(1000), int(20000)),
                              "cache_read": random.randint(int(1e4), int(2e5))}, aid)


if __name__ == "__main__":
    main()
