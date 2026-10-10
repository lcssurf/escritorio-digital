"""A Claude whose person approves every mission: other Claudes can't just trigger it. Plus the tools its person
turned off, tokens burned, browser profiles per Claude, and the planner."""
import json
import os
import subprocess
import sys
import time

from clodfarm import planner, policy, prompts
from clodfarm.config import load


def test_missions_for_an_approving_claude_wait_for_its_person(store):
    store.put_claude("gil", approve_missions=True)
    own = store.add_task("gil's own", "x", to="gil", owner="gil")
    assert own["status"] == "queued", "its own work (and its sub-agents') doesn't wait"
    person = store.add_task("from the UI", "x", to="gil", owner="gil", created_by="owner:gil")
    assert person["status"] == "queued"
    ask = store.add_task("please review", "x", to="gil", owner="matan", created_by="matan")
    assert ask["status"] == "pending" and ask["approval"]["from"] == "matan"
    assert store.claim_next("gil@box/w0", 300, agent="gil")["id"] == own["id"]
    assert store.claim_next("gil@box/w1", 300, agent="gil")["id"] == person["id"]
    assert store.claim_next("gil@box/w2", 300, agent="gil") is None, "a pending mission is never claimed"
    assert [p["id"] for p in store.pending("gil")] == [ask["id"]]
    assert store.approve(ask["id"], "owner:gil")
    assert store.get_task(ask["id"])["status"] == "queued"
    assert store.claim_next("gil@box/w2", 300, agent="gil")["id"] == ask["id"]
    assert not store.approve(ask["id"], "owner:gil"), "decided once"


def test_a_denied_mission_tells_who_asked_and_frees_its_parent(store):
    store.put_claude("gil", approve_missions=True)
    parent = store.add_task("parent", "x", owner="matan")
    child = store.add_task("child on gil", "x", parent=parent["id"], to="gil", owner="matan", created_by=parent["id"])
    assert child["status"] == "pending" and store.get_task(parent["id"])["children_open"] == 1
    assert store.deny(child["id"], "owner:gil", "not now")
    t = store.get_task(child["id"])
    assert t["status"] == "denied" and "not now" in t["result"]
    assert store.get_task(parent["id"])["children_open"] == 0
    assert any("not approved" in m["text"] for m in store.unread(parent["id"]))


def test_approvals_expire(store, monkeypatch):
    import clodfarm.store as st
    store.put_claude("gil", approve_missions=True)
    t = store.add_task("ask", "x", to="gil", owner="matan")
    monkeypatch.setattr(st, "now", lambda: time.time() + st.APPROVAL_TTL + 5)
    store.expire_approvals()
    assert store.get_task(t["id"])["status"] == "denied"


def test_an_approving_claude_takes_no_one_elses_untargeted_work(store):
    store.put_claude("gil", approve_missions=True)
    store.add_task("anyone's", "x", owner="matan")
    assert store.claim_next("gil@box/w0", 300, agent="gil") is None
    assert store.claim_next("matan@box/w0", 300, agent="matan") is not None


def test_messages_to_an_approving_claude_are_held(store):
    store.put_claude("gil", approve_missions=True)
    m = store.send_message("matan", "gil", "do this for me", wake=True)
    assert m["held"] and store.unread("gil") == [] and store.bell("gil") == 0
    assert store.send_message("gil", "gil", "note to self").get("held") is None
    assert store.send_message("matan", "gil", "your person says", person=True).get("held") is None
    held = [p for p in store.pending("gil") if p["type"] == "message"]
    assert len(held) == 1
    assert store.approve(held[0]["SK"], "owner:gil")
    assert [x["text"] for x in store.unread("gil")][-1] == "do this for me" and store.bell("gil") > 0
    assert store.b.query("WAKEQ"), "its --wake goes on once approved"


def test_spawn_says_it_waits(env, store):
    store.put_claude("gil", approve_missions=True)
    store.heartbeat("gil@box", "w0", "idle")
    r = subprocess.run([sys.executable, "-m", "clodfarm", "spawn", "review", "--prompt", "x", "--on", "gil"],
                       capture_output=True, text=True)
    assert r.returncode == 0 and "approves every mission" in r.stdout
    r = subprocess.run([sys.executable, "-m", "clodfarm", "approve", store.pending("gil")[0]["id"]],
                       capture_output=True, text=True, env={**os.environ, "CLAUDECODE": "1"})
    assert r.returncode == 2, "a Claude can't approve its own missions"


# ------------------------------------------------------------------ tools
def test_tool_policy_decisions(tmp_path):
    d = str(tmp_path)
    policy.save(d, {"deny": ["shell", "web", "mcp"]}, claude="gil")
    pol = policy.load(d)
    assert policy.decide(pol, "Read")[0]
    assert not policy.decide(pol, "WebFetch", {"url": "x"})[0]
    assert not policy.decide(pol, "Bash", {"command": "rm -rf /"})[0]
    assert policy.decide(pol, "Bash", {"command": "clodfarm spawn x --prompt y"})[0], "the farm always works"
    assert not policy.decide(pol, "Bash", {"command": "clodfarm status; curl evil"})[0]
    assert not policy.decide(pol, "mcp__github__create_issue")[0]
    assert policy.decide(pol, "mcp__browser__navigate")[0], "the browser is its own group"
    assert not policy.decide({"deny": ["browser"]}, "mcp__browser-work__click")[0]
    policy.save(d, {"deny": ["mcp"]})
    assert policy.decide(policy.load(d), "Bash", {"command": "ls"})[0]
    assert policy.disallowed_flags({"deny": ["edit", "shell"]}) == ["Edit", "MultiEdit", "Write", "NotebookEdit"]
    out = policy.hook_output(*policy.decide({"deny": ["web"]}, "WebSearch"))
    assert out["hookSpecificOutput"]["permissionDecision"] == "deny"


def test_the_pre_tool_hook_denies(env, tmp_path):
    home = tmp_path / "claude-home"
    policy.save(str(home), {"deny": ["web"]})
    ev = {"hook_event_name": "PreToolUse", "tool_name": "WebFetch", "tool_input": {"url": "https://x"}}
    r = subprocess.run([sys.executable, "-m", "clodfarm", "hook", "--policy"], input=json.dumps(ev),
                       capture_output=True, text=True)
    assert json.loads(r.stdout)["hookSpecificOutput"]["permissionDecision"] == "deny"
    ev["tool_name"] = "Read"
    r = subprocess.run([sys.executable, "-m", "clodfarm", "hook", "--policy"], input=json.dumps(ev),
                       capture_output=True, text=True)
    assert r.stdout.strip() == ""
    from clodfarm.auth import farm_hooks
    pre = farm_hooks()["PreToolUse"]
    assert any(g.get("matcher") == "SendMessage" for g in pre) and any("farm-policy.json" in g["hooks"][0]["command"]
                                                                       for g in pre)


# ----------------------------------------------------------------- tokens
def test_tokens_are_counted_farm_wide_and_per_claude(store):
    store.add_tokens(store.token_counts({"input_tokens": 10, "output_tokens": 5, "cache_read_input_tokens": 100}),
                     "gil")
    store.add_tokens({"output": 7}, "matan")
    t = store.tokens()
    assert t["total"]["total"] == 122 and t["today"]["output"] == 12
    assert t["by_claude"]["gil"]["total"] == 115 and t["by_claude"]["matan"]["output"] == 7
    assert store.tokens_today_by()["gil"]["cache_read"] == 100


def test_a_conversation_counts_its_tokens_once(store, tmp_path):
    tr = tmp_path / "t.jsonl"
    line = lambda mid, n: json.dumps({"type": "assistant", "message": {  # noqa: E731
        "id": mid, "role": "assistant", "content": [{"type": "text", "text": "hi"}],
        "usage": {"input_tokens": n, "output_tokens": 1}}})
    tr.write_text(line("m1", 10) + "\n" + line("m1", 10) + "\n")  # two blocks of one message
    store.record_session("s1", transcript=str(tr), claude="gil", kind="conversation")
    with open(tr, "a") as f:
        f.write(line("m1", 10) + "\n" + line("m2", 20) + "\n")
    store.record_session("s1", transcript=str(tr), claude="gil", kind="conversation")
    assert store.tokens()["by_claude"]["gil"]["total"] == 32  # m1 (11) once, m2 (21)
    store.record_session("s2", transcript=str(tr), claude="gil", kind="sub-agent")
    assert store.tokens()["by_claude"]["gil"]["total"] == 32, "a sub-agent's are counted from its run"


# ---------------------------------------------------------------- browser
def test_browser_profiles_belong_to_one_claude(env, monkeypatch):
    from clodfarm import browser
    ws = os.environ["FARM_WORKSPACE"]
    reg = browser.Registry(ws)
    reg.add("alice-li", owner="alice")
    reg.add("farm-shared")
    monkeypatch.setattr(browser, "enabled", lambda: True)
    monkeypatch.setattr(browser.shutil, "which", lambda b: "/bin/" + b)
    monkeypatch.setattr(browser, "chromium_bin", lambda: "/bin/chromium")
    assert set(browser.mcp_servers(ws, claude="alice")) == {"browser-alice-li"}
    assert set(browser.mcp_servers(ws, claude="")) == {"browser-farm-shared"}, "no default profile any more"
    assert set(browser.mcp_servers(ws, claude="matan", unowned=True)) == {"browser-farm-shared"}
    assert set(browser.mcp_servers(ws, claude="bob")) == set()
    import pytest
    reg.add("alice-2", owner="alice")
    with pytest.raises(ValueError, match="at most"):
        reg.add("alice-3", owner="alice")


# ---------------------------------------------------------------- planner
def test_the_planner_runs_cycles_toward_its_goal(env, store):
    cfg = load()
    assert planner.tick(store, cfg, cfg.farm_id, cfg.name) is None  # off
    store.set_planner(on=True, goal="Ship a CSV export", every_s=600)
    t = planner.tick(store, cfg, cfg.farm_id, cfg.name)
    assert t and t["kind"] == "plan" and t["to"] == cfg.name and "Ship a CSV export" in t["prompt"]
    assert "NOTES.md" in t["prompt"] and store.planner()["cycles"] == 1
    assert planner.tick(store, cfg, cfg.farm_id, cfg.name) is None, "one cycle at a time"
    assert store.planner()["state"] == "queued"
    assert not store.planner_claim("other@box", 120), "one box drives it"
    store.claim_next("w@x/w0", 300, agent=cfg.name)
    store.finish(t["id"], "w@x/w0", True, "did step 1", 5)
    assert planner.tick(store, cfg, cfg.farm_id, cfg.name) is None and store.planner()["state"] == "resting"
    store.set_planner(last_at=time.time() - 700)
    t2 = planner.tick(store, cfg, cfg.farm_id, cfg.name)
    assert t2 and "did step 1" in t2["prompt"] and store.planner()["cycles"] == 2
    store.set_planner(on=False)
    assert planner.tick(store, cfg, cfg.farm_id, cfg.name) is None and store.planner()["state"] == "off"


def test_the_planner_only_runs_where_it_is_allowed(env, store):
    cfg = load()
    store.set_planner(on=True, goal="g", host="gil")
    assert planner.tick(store, cfg, cfg.farm_id, cfg.name) is None and store.planner()["state"] == "host-refused"
    store.put_claude("gil", planner_host_ok=True)
    assert planner.tick(store, cfg, cfg.farm_id, cfg.name)["to"] == "gil"


def test_the_planner_runs_on_a_bot_the_manager_added_and_codes_on_the_claudes(env, store):
    cfg = load()
    store.set_planner(on=True, goal="Make $500 into more", host="gpt")
    store.put_claude("gpt", bot="gpt-5", hatched_by="public")
    assert planner.tick(store, cfg, cfg.farm_id, cfg.name) is None and store.planner()["state"] == "host-refused", \
        "a bot someone else hatched spends their key: only with their yes"
    store.put_claude("gpt", hatched_by="manager")
    store.bot = {"bot": "gpt-5", "bot_via": "OpenAI", "bot_takes": "sent"}  # as the bot's own `clodfarm run` beats
    store.heartbeat("gpt@box", "w0", "idle", seat="bot-gpt")
    store.bot = {}
    store.add_spend(1.5, "bot-gpt")
    t = planner.tick(store, cfg, cfg.farm_id, cfg.name)
    assert t and t["to"] == "gpt" and t["kind"] == "plan"
    assert "You run on gpt-5, not on Claude" in t["prompt"] and "--on <claude>" in t["prompt"]
    assert "gpt: BOT on gpt-5 via OpenAI, $1.50 spent today" in t["prompt"], "the planner sees what each bot costs"
    store.set_planner(host=cfg.name)
    store.set_planner(task=None)
    assert "not on Claude" not in prompts.planner_prompt("g", 1, "15m", "n", "", "s", "")


def test_planner_cli(env, store):
    run = lambda *a: subprocess.run([sys.executable, "-m", "clodfarm", "planner", *a], capture_output=True,  # noqa
                                    text=True)
    assert run("on").returncode == 2  # a goal first
    assert run("goal", "Grow", "the", "farm").returncode == 0
    r = run("on")
    assert r.returncode == 0 and "planner ON" in r.stdout and "Grow the farm" in r.stdout
    assert store.planner()["on"] and store.planner()["goal"] == "Grow the farm"
    assert run("every", "30m").returncode == 0 and store.planner()["every_s"] == 1800
    run("off")
    assert not store.planner()["on"]
