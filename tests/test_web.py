"""The farm UI server: login, sessions, CSRF guard, state and the agent registry (with the fake `claude`)."""
import http.cookiejar
import json
import os
import threading
import time
import urllib.error
import urllib.request

import pytest

from clodfarm.config import load
from clodfarm.store import Store
from clodfarm.web import FarmUI, make_handler


@pytest.fixture
def ui(env, backend, monkeypatch):
    if backend != "sqlite":
        pytest.skip("the UI reads the same Store API on both backends; one is enough")
    from http.server import ThreadingHTTPServer
    monkeypatch.setenv("FARM_UI_PASSWORD", "correct horse")
    cfg = load()
    store = Store.from_config(cfg)
    store.ensure_table()
    farm_ui = FarmUI(cfg, store)
    srv = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(farm_ui))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_address[1]}", farm_ui
    srv.shutdown()
    farm_ui.manager.shutdown()


def client():
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

    def call(url, body=None, headers=None):
        hdrs = {"Content-Type": "application/json", "X-Clodfarm": "1"} if body is not None else {}
        hdrs.update(headers or {})
        req = urllib.request.Request(url, data=None if body is None else json.dumps(body).encode(), headers=hdrs)
        try:
            with opener.open(req) as r:
                return r.status, json.loads(r.read() or b"{}"), dict(r.headers)
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"{}"), dict(e.headers)
    return call


def wait(fn, timeout=15):
    end = time.time() + timeout
    while time.time() < end:
        if fn():
            return True
        time.sleep(0.1)
    return False


def login(call, base, claude=None):
    """Sign in the way the farm's manager does: as the person of the farm's own Claude (a code from `clodfarm pair`)."""
    import hashlib
    import secrets
    cfg = load()
    code = secrets.token_hex(3).upper()
    Store.from_config(cfg).add_pairing(claude or cfg.name, hashlib.sha256(secrets.token_bytes(8)).hexdigest(), code)
    status, body, _ = call(base + "/api/pair", {"code": code})
    assert status == 200, body


def test_login_required_and_wrong_password(ui):
    base, _ = ui
    call = client()
    code, st, headers = call(base + "/api/state")  # a public farm: anyone watches
    assert code == 200 and st["farm"] == "test" and st["me"]["role"] == "viewer"
    assert "frame-ancestors 'none'" in headers["Content-Security-Policy"]
    assert call(base + "/api/manager")[0] == 403
    assert call(base + "/api/login", {"password": "correct horse"})[0] == 410, "no passwords at all"
    login(call, base)  # the person of the farm's own Claude
    assert call(base + "/api/manager")[0] == 200


def test_a_private_farm_is_its_claudes_people_only(ui):
    """No passwords: a private farm is seen by the people of its Claudes (and its manager), who sign in with them."""
    base, _ = ui
    manager, visitor = client(), client()
    login(manager, base)
    assert manager(base + "/api/manager/settings", {"private": True})[0] == 200, "no password needed"
    assert visitor(base + "/api/state")[0] == 401
    assert visitor(base + "/api/login", {"password": "anything"})[0] == 410
    assert manager(base + "/api/state")[0] == 200
    assert "viewer_password" not in manager(base + "/api/manager")[1]["settings"]

def test_session_cookie_flags_and_logout(ui):
    base, farm_ui = ui
    import hashlib
    call = client()
    Store.from_config(load()).add_pairing(farm_ui.cfg.name, hashlib.sha256(b"x").hexdigest(), "ABC234")
    _, _, headers = call(base + "/api/pair", {"code": "ABC234"})
    cookie = headers["Set-Cookie"]
    assert "HttpOnly" in cookie and "SameSite=Lax" in cookie and "clodfarm_owner=" in cookie
    assert call(base + "/api/manager")[0] == 200
    call(base + "/api/owner/forget", {})
    assert call(base + "/api/manager")[0] == 403


def test_writes_need_the_csrf_header(ui):
    base, _ = ui
    call = client()
    login(call, base)
    code, _, _ = call(base + "/api/pause", {}, headers={"X-Clodfarm": ""})
    assert code == 403


def test_lockout_after_five_wrong_tries(ui):
    base, _ = ui
    call = client()
    for _ in range(5):
        assert call(base + "/api/pair", {"code": "WRONG1"})[0] == 401
    assert call(base + "/api/pair", {"code": "WRONG1"})[0] == 429


def test_state_pause_and_no_quest_endpoints(ui):
    base, farm_ui = ui
    call = client()
    login(call, base)
    assert call(base + "/api/tasks", {"text": "Plant tomatoes"})[0] == 404  # you talk to your Claude, not a form
    assert call(base + "/api/mission", {"text": "Grow"})[0] == 404
    farm_ui.store.event("rc.connected", f"Remote Control '{farm_ui.cfg.name}' is live: https://claude.ai/code/session_abc")
    assert call(base + "/api/pause", {"reason": "lunch"})[0] == 200
    time.sleep(1.1)  # the state is cached for a second
    st = call(base + "/api/state")[1]
    assert st["paused"] and st["pause_reason"] == "lunch" and "goal" not in st
    me = next(a for a in st["agents"] if a["primary"])
    assert me["remote_control"] == "https://claude.ai/code/session_abc"


def test_released_agent_takes_its_workers_along(ui):
    import socket
    base, farm_ui = ui
    call = client()
    login(call, base)
    a = call(base + "/api/agents", {"name": "gil"})[1]
    box = farm_ui.manager.farm_id(a["id"])
    t = farm_ui.store.add_task("gil works on this", "x")
    farm_ui.store.claim_next(f"{box}/w0", 300)
    farm_ui.store.heartbeat(box, "w0", "running", t["id"])
    farm_ui.store.heartbeat("ghost@" + socket.gethostname(), "w0", "idle")  # released before this fix
    farm_ui.store.heartbeat("far-box@elsewhere", "w0", "idle")  # a real visitor from another box
    time.sleep(1.1)
    names = {x["id"] for x in call(base + "/api/state")[1]["agents"]}
    assert a["id"] in names and "far-box" in names and "ghost" not in names
    assert call(base + f"/api/agents/{a['id']}/remove", {})[0] == 200
    assert not farm_ui.manager.alive(a["id"])
    stale = {**farm_ui.manager.primary(), **a, "primary": False, "config_dir": "/nonexistent"}
    for _ in range(3):  # keep_alive holding an old copy of the registry must not bring it back
        farm_ui.manager.spawn(stale)
    assert not farm_ui.manager.alive(a["id"])
    assert farm_ui.store.get_task(t["id"])["status"] == "queued"
    assert all(not w["SK"].startswith(box + "/") for w in farm_ui.store.workers())
    time.sleep(1.1)
    assert a["id"] not in {x["id"] for x in call(base + "/api/state")[1]["agents"]}


def test_hatch_an_agent_starts_its_own_farm_process(ui):
    base, farm_ui = ui
    call = client()
    login(call, base)
    code, a, _ = call(base + "/api/agents", {"name": "Gil's Claude"})
    assert code == 200 and a["id"] == "gil-s-claude"
    agent = farm_ui.manager.get(a["id"])
    assert agent["config_dir"].startswith(farm_ui.manager.base)
    farm_ui.manager.spawn(agent)  # the farm daemon's keeper does this (AgentManager.keep_alive)
    assert wait(lambda: farm_ui.manager.alive(a["id"]))
    env = farm_ui.manager.env_for(agent)
    assert env["FARM_NAME"] == a["id"] and env["FARM_UI"] == "0" and env["CLAUDE_CONFIG_DIR"] == agent["config_dir"]
    assert call(base + "/api/agents", {"name": "Gil's Claude"})[1]["id"] != a["id"]  # names stay unique
    assert call(base + f"/api/agents/{a['id']}/remove", {})[0] == 200
    assert not farm_ui.manager.get(a["id"]) and not os.path.exists(agent["config_dir"])
    assert call(base + f"/api/agents/{farm_ui.cfg.name}/remove", {})[0] == 400  # the primary is the farm itself


def test_the_farm_manager_is_a_claudes_person(ui):
    base, farm_ui = ui
    import subprocess
    import sys
    gil = farm_ui.manager.create("gil", start=False)
    first, second = client(), client()
    login(first, base)
    login(second, base, claude=gil["id"])
    assert first(base + "/api/manager")[0] == 200 and second(base + "/api/manager")[0] == 403
    assert first(base + "/api/manager/managers", {"action": "add", "claude": gil["id"]})[1]["managers"] == \
        [farm_ui.cfg.name, gil["id"]]
    assert second(base + "/api/manager")[0] == 200, "made a manager too"
    assert first(base + "/api/manager/managers", {"action": "remove", "claude": farm_ui.cfg.name})[0] == 200
    assert first(base + "/api/manager")[0] == 403, "handed it over"
    assert second(base + "/api/manager/managers", {"action": "remove", "claude": gil["id"]})[0] == 400, \
        "the farm always has a manager"
    r = subprocess.run([sys.executable, "-m", "clodfarm", "farm", "manager", "set", farm_ui.cfg.name],
                       capture_output=True, text=True, env={k: v for k, v in os.environ.items() if k != "CLAUDECODE"})
    assert r.returncode == 0 and farm_ui.cfg.name in r.stdout, "the box's shell can always set it"
    assert first(base + "/api/manager")[0] == 200 and second(base + "/api/manager")[0] == 403


def test_path_prefix_behind_a_proxy(env, backend, monkeypatch):
    if backend != "sqlite":
        pytest.skip("one backend is enough")
    import importlib
    from http.server import ThreadingHTTPServer
    import clodfarm.web as web
    monkeypatch.setenv("FARM_UI_PASSWORD", "correct horse")
    monkeypatch.setenv("FARM_UI_BASE", "/team/")
    monkeypatch.setenv("FARM_UI_TRUST_PROXY", "1")
    monkeypatch.setenv("FARM_UI_SECURE", "1")
    web = importlib.reload(web)
    try:
        cfg = load()
        Store.from_config(cfg).ensure_table()
        farm_ui = web.FarmUI(cfg)
        srv = ThreadingHTTPServer(("127.0.0.1", 0), web.make_handler(farm_ui))
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{srv.server_address[1]}"
        call = client()
        assert call(base + "/healthz")[0] == 200  # the container health check stays at the root
        assert call(base + "/api/state")[0] == 404  # outside the prefix
        import hashlib
        Store.from_config(cfg).add_pairing(cfg.name, hashlib.sha256(b"p").hexdigest(), "PAIR23")
        code, _, headers = call(base + "/team/api/pair", {"code": "PAIR23"}, headers={"X-Forwarded-For": "1.2.3.4"})
        assert code == 200 and "Path=/team/" in headers["Set-Cookie"] and "Secure" in headers["Set-Cookie"]
        # the lockout counts the forwarded client, not the proxy: another client can still sign in
        for _ in range(5):
            call(base + "/team/api/pair", {"code": "WRONG1"}, headers={"X-Forwarded-For": "6.6.6.6"})
        assert call(base + "/team/api/pair", {"code": "WRONG1"}, headers={"X-Forwarded-For": "6.6.6.6"})[0] == 429
        Store.from_config(cfg).add_pairing(cfg.name, hashlib.sha256(b"q").hexdigest(), "PAIR45")
        assert client()(base + "/team/api/pair", {"code": "PAIR45"}, headers={"X-Forwarded-For": "1.2.3.4"})[0] == 200
        srv.shutdown()
        farm_ui.manager.shutdown()
    finally:
        for k in ("FARM_UI_BASE", "FARM_UI_TRUST_PROXY", "FARM_UI_SECURE"):
            monkeypatch.delenv(k, raising=False)
        importlib.reload(web)


def test_state_is_claudes_and_their_sub_agents(ui):
    base, farm_ui = ui
    call = client()
    login(call, base)
    me = farm_ui.cfg.name
    top = farm_ui.store.add_task("refactor", "x", owner=me)
    farm_ui.store.add_task("part 1", "x", parent=top["id"], to="gil")
    farm_ui.store.claim_next(f"{me}@h/w0", 300, agent=me)
    farm_ui.store.heartbeat(f"{me}@h", "w0", "running", top["id"], seat="s1")
    st = call(base + "/api/state")[1]
    assert "workers" not in st["agents"][0] and "tasks" not in st and "counts" not in st
    subs = {t["title"]: t for t in st["subagents"]}
    assert subs["refactor"]["owner"] == me and subs["refactor"]["on"] == me
    assert subs["part 1"]["owner"] == me and subs["part 1"]["to"] == "gil" and subs["part 1"]["status"] == "queued"


def test_sessions_and_conversations_in_the_ui(ui):
    base, farm_ui = ui
    call = client()
    login(call, base)
    farm_ui.store.record_session("s1", claude="gil", kind="conversation", title="review the importer",
                                 turns=[{"role": "user", "kind": "text", "text": "review it"},
                                        {"role": "assistant", "kind": "text", "text": "done"}])
    rows = call(base + "/api/sessions?claude=gil")[1]
    assert [r["id"] for r in rows] == ["s1"] and rows[0]["turns"] == 2
    assert call(base + "/api/sessions?claude=nobody")[1] == []
    s = call(base + "/api/sessions/s1")[1]
    assert [t["text"] for t in s["conversation"]] == ["review it", "done"]
    assert call(base + "/api/sessions/nope")[0] == 404


def test_a_claude_mid_turn_in_a_conversation_is_at_work(ui):
    base, farm_ui = ui
    call = client()
    login(call, base)
    me = farm_ui.cfg.name
    view = lambda: next(a for a in call(base + "/api/state")[1]["agents"] if a["id"] == me)  # noqa: E731
    assert view()["talking"] is None
    farm_ui.store.record_session("s1", claude=me, kind="conversation", title="fix the build", busy=True)
    farm_ui._state_cache = None
    assert view()["talking"]["n"] == 1 and view()["talking"]["title"] == "fix the build"
    farm_ui.store.record_session("s1", busy=False)
    farm_ui._state_cache = None
    assert view()["talking"] is None
    farm_ui.store.record_session("s2", claude=me, kind="conversation", busy=True)  # interrupted: no Stop, gone quiet
    farm_ui.store._update("SESSION", "s2", lambda x: {**x, "last_at": x["last_at"] - farm_ui.TURN_QUIET - 1})
    farm_ui._state_cache = None
    assert view()["talking"] is None


def test_slack_setup_endpoints(ui):
    base, _ = ui
    call = client()
    assert call(base + "/api/slack")[0] == 403  # the farm manager's
    login(call, base)
    code, body, _ = call(base + "/api/slack")
    assert code == 200 and body["configured"] is False and body["manifest_url"].startswith("https://api.slack.com/apps?new_app=1")
    code, body, _ = call(base + "/api/slack", {"bot_token": "nope", "app_token": "xapp-1"})
    assert code == 400 and "xoxb-" in body["error"]
    code, body, _ = call(base + "/api/state")
    assert body["slack"]["state"] == "off"


def test_the_old_password_commands_explain(env, backend):
    if backend != "sqlite":
        pytest.skip("one backend is enough")
    import subprocess
    import sys
    r = subprocess.run([sys.executable, "-m", "clodfarm", "manager-passwd"], capture_output=True, text=True)
    assert r.returncode == 1 and "no manager password" in r.stderr


def test_a_burst_of_connections_is_served(env, backend, monkeypatch):
    """The browser page loads ~55 noVNC modules at once, and a proxy in front opens one connection for each: with
    socketserver's backlog of 5, Linux drops the rest, the proxy answers 502 and the page stays blank."""
    if backend != "sqlite":
        pytest.skip("one backend is enough")
    import socket
    from clodfarm.web import FarmHTTPServer, serve
    monkeypatch.setenv("FARM_UI_PASSWORD", "correct horse")
    monkeypatch.setenv("FARM_UI_HOST", "127.0.0.1")
    monkeypatch.setenv("FARM_UI_PORT", "0")
    httpd = serve(load(), block=False)
    try:
        assert isinstance(httpd, FarmHTTPServer)
        port, got, go = httpd.server_address[1], [], threading.Event()

        def one():
            go.wait()
            try:
                s = socket.create_connection(("127.0.0.1", port), timeout=1.0)  # a proxy's connect timeout
                s.settimeout(15)
                s.sendall(b"GET /favicon.svg HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n")
                data = b""
                while chunk := s.recv(65536):
                    data += chunk
                got.append(data.split(b" ", 2)[1].decode() if data.startswith(b"HTTP/") else "empty")
            except OSError as e:
                got.append(type(e).__name__)
        ts = [threading.Thread(target=one) for _ in range(60)]
        for t in ts:
            t.start()
        go.set()
        for t in ts:
            t.join()
        assert got == ["200"] * 60, sorted(set(got))
    finally:
        httpd.shutdown()
        httpd.ui.stopping.set()
        httpd.ui.manager.shutdown()
