# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# Required Notice: Copyright (c) 2026 lcssurf (https://github.com/lcssurf/escritorio-digital)
"""Following a job: what each agent is doing in plain categories, who called whom, and why jobs wait."""
import pytest

from clodfarm import progress
from clodfarm.governor import SEVEN_DAYS, Policy, Snapshot, Window, decide, explain, with_speed
from test_web import client, ui  # noqa: F401


def item(kind, text, tool=None):
    return {"kind": kind, "text": text, **({"tool": tool} if tool else {})}


def test_feed_lines_are_sorted_into_plain_categories():
    c = progress.classify
    assert c(item("thought", "hmm")) == {"cat": "think", "arg": ""}
    assert c(item("say", "Pronto."))["cat"] == "say"
    assert c(item("tool", "Read: /workspace/.worktrees/2610abc/clientes/maria/rg.txt", "Read")) == {"cat": "read", "arg": "clientes/maria/rg.txt"}
    assert c(item("tool", "Write: /workspace/.worktrees/2610abc/saidas/a.md", "Write")) == {"cat": "write", "arg": "saidas/a.md"}
    assert c(item("tool", "Edit: /workspace/repo/saidas/a.md", "Edit"))["cat"] == "edit"
    assert c(item("tool", "Grep: art. 71", "Grep"))["cat"] == "search"
    assert c(item("tool", "WebSearch: salario maternidade rural", "WebSearch"))["cat"] == "web"
    call = c(item("tool", 'Bash: clodfarm spawn "Documentos: Maria" --specialist beatriz --prompt "x"', "Bash"))
    assert call == {"cat": "call", "arg": "Documentos: Maria", "who": "beatriz"}
    assert c(item("tool", "Bash: cd /workspace/.worktrees/26/x; ls -R clientes | head", "Bash"))["cat"] == "read"
    assert c(item("tool", "Bash: git add -A && git commit -qm x", "Bash"))["cat"] == "save"
    assert c(item("tool", "Bash: git merge farm/261011", "Bash"))["cat"] == "merge"
    assert c(item("tool", "Bash: clodfarm result 2610", "Bash"))["cat"] == "check"
    assert c(item("tool", "Bash: python3 - <<'EOF' print(1)", "Bash"))["cat"] == "compute"
    assert c(item("tool", "Bash: mkdir -p saidas/x", "Bash"))["cat"] == "write"
    assert c(item("tool", "Bash: make something", "Bash"))["cat"] == "run"
    assert c(item("tool", "Weird: x", "Weird"))["cat"] == "tool"


def test_a_job_shows_who_it_called_and_the_newest_steps(store):
    top = store.add_task("Caso Maria", "x", specialist="chief")
    kid = store.add_task("Documentos: Maria", "x", parent=top["id"], specialist="beatriz")
    grand = store.add_task("Conferir", "x", parent=kid["id"], specialist="ana")
    other = store.add_task("Outro job", "x")
    store.live_add([item("tool", "Read: /workspace/.worktrees/1/a.md", "Read")], claude="c", task=top["id"])
    store.live_add([item("say", "Chamei a Beatriz")], claude="c", task=kid["id"])
    store.live_add([item("tool", "Write: /workspace/repo/b.md", "Write")], claude="c", task=grand["id"])
    store.live_add([item("say", "nada a ver")], claude="c", task=other["id"])
    nodes = progress.tree(store, top["id"])
    assert [(n["specialist"], n["depth"]) for n in nodes] == [("chief", 0), ("beatriz", 1), ("ana", 2)]
    st = progress.steps(store, {n["id"] for n in nodes}, 10)
    assert [s["cat"] for s in st] == ["read", "say", "write"], "the other job's lines are not mixed in, oldest first"
    assert st[0]["arg"] == "a.md"
    assert len(progress.steps(store, {n["id"] for n in nodes}, 2)) == 2, "only the newest ones when limited"


def test_a_faster_speed_lets_more_agents_run_and_the_reason_is_explained():
    now = 1_000_000.0
    elapsed = 0.115                                   # a little over 18% of the week used by the lawyer, about 11% of the week gone
    snap = Snapshot(observed_at=now, status="allowed", rate_limit_type=None, resets_at=None,
                    five_hour=Window(0.05, now + 3 * 3600), seven_day=Window(0.18, now + SEVEN_DAYS * (1 - elapsed)))
    pol = Policy(max_workers=3)
    slow, fast, top = (decide(snap, with_speed(pol, s), now) for s in ("balanced", "fast", "max"))
    assert slow.workers == 1 and "pacing the week" in slow.reason, "ahead of the weekly pace: one at a time"
    assert slow.workers <= fast.workers <= top.workers and top.workers > slow.workers
    assert with_speed(pol, None) is pol and with_speed(pol, "nonsense") is pol and with_speed(pol, "balanced") is pol
    ex = explain(snap, pol, now)
    assert ex["week_used"] == 0.18 and 0.13 < ex["week_allowed"] < 0.15 and ex["five_used"] == 0.05
    assert explain(None, pol, now)["week_used"] is None


def test_the_progress_api(ui):
    base, farm_ui = ui
    anon, key = client(), {"X-Overlay-Token": farm_ui.overlay_token()}
    farm_ui.team.upsert({"name": "Beatriz", "title": "Docs", "gender": "f"})
    top = farm_ui.store.add_task("Caso Maria", "x", specialist="chief", owner=farm_ui.cfg.name)
    kid = farm_ui.store.add_task("Documentos", "x", parent=top["id"], specialist="beatriz", owner=farm_ui.cfg.name)
    farm_ui.store.live_add([item("tool", "Read: /workspace/repo/rg.txt", "Read")], claude="c", task=kid["id"])
    assert anon(base + "/api/progress")[0] == 403 and anon(base + "/api/speed", {"mode": "fast"})[0] == 403
    st, body, _ = anon(base + "/api/progress", headers=key)
    assert st == 200 and [j["id"] for j in body["jobs"]] == [top["id"]]
    nodes = body["jobs"][0]["nodes"]
    assert [(n["name"], n["status"]) for n in nodes][1] == ("Beatriz", "queued")
    assert body["jobs"][0]["steps"][0]["cat"] == "read"
    assert set(body["pace"]) >= {"limited", "speed", "speeds"} and body["pace"]["speed"] == "balanced"
    st, one, _ = anon(base + f"/api/progress/{top['id']}?limit=5", headers=key)
    assert st == 200 and one["job"]["id"] == top["id"]
    assert anon(base + f"/api/progress/{kid['id']}", headers=key)[0] == 404, "only whole jobs are followed, not their parts"
    assert anon(base + "/api/progress/doesnotexist1", headers=key)[0] == 404
    # the speed is a setting that takes effect at once
    assert anon(base + "/api/speed", {"mode": "fast"}, key)[1]["speed"] == "fast"
    assert farm_ui.store.settings()["speed"] == "fast"
    assert anon(base + "/api/speed", {"mode": "warp"}, key)[0] == 400
    assert anon(base + "/api/progress", headers=key)[1]["pace"]["speed"] == "fast"
