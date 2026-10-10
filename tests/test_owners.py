"""Each person owns one Claude: hatching, the owner cookie, pairing from the phone, what each role sees, and the
settings (skin, tools, approvals) only its person changes."""
import hashlib
import json
import subprocess
import sys
import threading
import time

import pytest

from clodfarm.config import load
from clodfarm.store import Store
from clodfarm.web import FarmUI, make_handler

from test_web import client, login


@pytest.fixture
def ui(env, backend, monkeypatch):
    if backend != "sqlite":
        pytest.skip("the UI reads the same Store API on both backends; one is enough")
    from http.server import ThreadingHTTPServer
    monkeypatch.setenv("FARM_UI_PASSWORD", "correct horse")
    monkeypatch.setenv("FARM_UI_PUBLIC_URL", "https://farm.example")
    cfg = load()
    store = Store.from_config(cfg)
    store.ensure_table()
    farm_ui = FarmUI(cfg, store)
    srv = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(farm_ui))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_address[1]}", farm_ui
    srv.shutdown()
    farm_ui.manager.shutdown()


def state(call, base):
    time.sleep(1.05)  # the state is built once a second
    return call(base + "/api/state")[1]


def test_anyone_hatches_one_claude_and_owns_it(ui):
    base, farm_ui = ui
    alice, bob = client(), client()
    code, a, headers = alice(base + "/api/agents", {
        "name": "Alice", "approve_missions": True, "tools": {"deny": ["web", "shell", "nonsense"]},
        "skin": {"hat": "wizard", "colors": {"hat": "#aa33ff", "body": "#d97757", "band": "red"}, "accessory": "cape"}})
    assert code == 200, a
    assert "clodfarm_owner=" in headers["Set-Cookie"] and "SameSite=Lax" in headers["Set-Cookie"]
    rec = farm_ui.store.claude(a["id"])
    assert rec["approve_missions"] and rec["tools"] == {"deny": ["shell", "web"]} and rec["hat"] == "wizard"
    assert rec["colors"] == {"hat": "#aa33ff", "body": "#d97757"}  # a bad colour is dropped
    policy = json.load(open(farm_ui.manager.get(a["id"])["config_dir"] + "/farm-policy.json"))
    assert policy["tools"]["deny"] == ["shell", "web"]
    # one per person: the same browser can't hatch a second one
    code, body, _ = alice(base + "/api/agents", {"name": "Alice 2"})
    assert code == 409 and "already" in body["error"]
    me = alice(base + "/api/me")[1]
    assert me["owner"] == a["id"] and me["hatch"]["can"] is False
    # its person sees its login and settings; someone else doesn't
    assert alice(base + f"/api/agents/{a['id']}/login")[0] == 200
    assert bob(base + f"/api/agents/{a['id']}/login")[0] == 403
    assert bob(base + f"/api/agents/{a['id']}/settings", {"name": "Bob's now"})[0] == 403
    assert bob(base + f"/api/agents/{a['id']}/remove", {})[0] == 403
    st = state(alice, base)
    mine = next(x for x in st["agents"] if x["id"] == a["id"])
    assert mine["mine"] and mine["hat"] == "wizard" and mine["approve_missions"] and mine["tools_off"] == ["shell", "web"]
    other = next(x for x in state(bob, base)["agents"] if x["id"] == a["id"])
    assert not other["mine"] and "email" not in other and not (other.get("login") or {}).get("url")


def test_settings_change_the_skin_and_tools_at_once(ui):
    base, farm_ui = ui
    alice = client()
    a = alice(base + "/api/agents", {"name": "Alice"})[1]
    code, s, _ = alice(base + f"/api/agents/{a['id']}/settings", {
        "name": "Ally", "skin": {"hat": "crown", "colors": {"hat": "#ffcc00"}}, "approve_missions": False,
        "tools": {"deny": ["mcp"]}, "notify_topic": "ally-farm-42"})
    assert code == 200 and s["name"] == "Ally" and s["hat"] == "crown" and s["tools"] == {"deny": ["mcp"]}
    assert s["notify_topic"] == "ally-farm-42" and not s["approve_missions"]
    assert alice(base + f"/api/agents/{a['id']}/settings", {"notify_topic": "no spaces allowed"})[0] == 400
    assert farm_ui.store.claude(a["id"])["name"] == "Ally"
    code, s, _ = alice(base + f"/api/agents/{a['id']}/settings", {"tools": "all"})
    assert s["tools"] == {"deny": []}
    import os
    assert not os.path.exists(farm_ui.manager.get(a["id"])["config_dir"] + "/farm-policy.json"), \
        "nothing off: no policy file, so the hook starts no Python"


def test_the_public_sees_titles_not_prompts(ui):
    base, farm_ui = ui
    public, manager = client(), client()
    login(manager, base)
    t = farm_ui.store.add_task("Grow tomatoes", "secret instructions", owner=farm_ui.cfg.name)
    farm_ui.store.claim_next("x@y/w0", 300)
    farm_ui.store.finish(t["id"], "x@y/w0", True, "secret result", 5)
    farm_ui.store.send_message("gil", farm_ui.cfg.name, "psst: the launch code")
    st = state(public, base)
    assert "secret" not in json.dumps(st) and "launch code" not in json.dumps(st)
    assert any(r["title"] == "Grow tomatoes" for r in st["recent"])
    task = public(base + f"/api/tasks/{t['id']}")[1]
    assert task["title"] == "Grow tomatoes" and "prompt" not in task and "result" not in task
    assert "secret instructions" in json.dumps(manager(base + f"/api/tasks/{t['id']}")[1])
    assert "secret" not in json.dumps(public(base + "/api/tasks")[1])
    for path in ("/api/sessions", "/api/browser", "/api/slack", "/api/dashboards", "/api/manager"):
        assert public(base + path)[0] == 403, path
    assert "launch code" in json.dumps(state(manager, base)["events"])


def test_the_state_has_an_etag(ui):
    base, _ = ui
    call = client()
    code, _, headers = call(base + "/api/state")
    assert code == 200 and headers.get("ETag")
    import urllib.request
    req = urllib.request.Request(base + "/api/state", headers={"If-None-Match": headers["ETag"]})
    try:
        urllib.request.urlopen(req)
        status = 200
    except urllib.error.HTTPError as e:
        status = e.code
    assert status == 304


def test_pairing_from_the_phone_signs_in_once(ui, env):
    base, farm_ui = ui
    r = subprocess.run([sys.executable, "-m", "clodfarm", "pair", "--json"], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    out = json.loads(r.stdout)
    assert out["claude"] == farm_ui.cfg.name and out["link"].startswith("https://farm.example/pair/")
    token = out["link"].rsplit("/", 1)[1]
    import urllib.request

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k):
            return None
    opener = urllib.request.build_opener(NoRedirect)
    try:
        opener.open(base + f"/pair/{token}")
    except urllib.error.HTTPError as e:
        assert e.code == 302 and "paired=1" in e.headers["Location"]
        assert "clodfarm_owner=" in e.headers["Set-Cookie"]
    try:
        opener.open(base + f"/pair/{token}")
    except urllib.error.HTTPError as e:
        assert "paired=0" in e.headers["Location"] and not e.headers.get("Set-Cookie"), "a link works once"
    # the code, on another device: the link having been tapped (the Claude app's own browser) doesn't use it up
    code = out["code"]
    phone = client()
    assert phone(base + "/api/pair", {"code": "WRONG1"})[0] == 401
    c, body, headers = phone(base + "/api/pair", {"code": code.lower()})
    assert c == 200 and body["claude"] == farm_ui.cfg.name
    assert phone(base + "/api/me")[1]["owner"] == farm_ui.cfg.name
    # a sub-agent can't make one
    r = subprocess.run([sys.executable, "-m", "clodfarm", "pair"], capture_output=True, text=True,
                       env={**__import__("os").environ, "FARM_TASK_ID": "260101000000abcdef"})
    assert r.returncode == 2


def test_the_manager_signs_an_owner_out_everywhere(ui):
    base, farm_ui = ui
    alice, manager = client(), client()
    a = alice(base + "/api/agents", {"name": "Alice"})[1]
    login(manager, base)
    assert alice(base + "/api/me")[1]["owner"] == a["id"]
    assert manager(base + f"/api/manager/owners/{a['id']}/signout", {})[0] == 200
    assert alice(base + "/api/me")[1]["owner"] is None


def test_hatching_rules(ui):
    base, farm_ui = ui
    manager = client()
    login(manager, base)
    assert manager(base + "/api/manager/settings", {"hatch_open": False})[0] == 200
    code, body, _ = client()(base + "/api/agents", {"name": "Nope"})
    assert code == 403 and "closed" in body["error"]
    manager(base + "/api/manager/settings", {"hatch_open": True, "hatch_per_ip_hour": 2})
    assert client()(base + "/api/agents", {"name": "One"})[0] == 200
    assert client()(base + "/api/agents", {"name": "Two"})[0] == 200
    assert client()(base + "/api/agents", {"name": "Three"})[0] == 429, "a per-address limit"


def test_private_farm_owner_still_sees_it(ui):
    base, farm_ui = ui
    alice, manager, stranger = client(), client(), client()
    a = alice(base + "/api/agents", {"name": "Alice"})[1]
    login(manager, base)
    manager(base + "/api/manager/settings", {"private": True})
    assert stranger(base + "/api/state")[0] == 401
    assert stranger(base + "/api/agents", {"name": "x"})[0] == 401
    assert alice(base + "/api/state")[0] == 200 and alice(base + "/api/me")[1]["owner"] == a["id"]
