"""A farm hosted for someone: its host signs its customer in with a one-time /sso link (FARM_UI_SSO_KEY), keeps it
private (FARM_UI_PRIVATE) and caps its Claudes (FARM_MAX_CLAUDES), the manager's included."""
import http.cookiejar
import json
import time
import urllib.error
import urllib.request

import pytest

from clodfarm import sso

from test_owners import ui  # noqa: F401 - the fixture
from test_web import client

KEY = "k" * 43


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **kw):
        return None


def browser():
    """A client that keeps cookies and shows redirects instead of following them."""
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar), _NoRedirect)

    def call(url, body=None):
        hdrs = {"Content-Type": "application/json", "X-Clodfarm": "1"} if body is not None else {}
        req = urllib.request.Request(url, data=None if body is None else json.dumps(body).encode(), headers=hdrs)
        try:
            with opener.open(req) as r:
                return r.status, r.read(), dict(r.headers)
        except urllib.error.HTTPError as e:
            return e.code, e.read(), dict(e.headers)

    def api(url, body=None):
        code, raw, headers = call(url, body)
        return code, json.loads(raw or b"{}"), headers
    return call, api


@pytest.fixture
def hosted(monkeypatch):
    monkeypatch.setenv("FARM_UI_SSO_KEY", KEY)
    monkeypatch.setenv("FARM_UI_PRIVATE", "1")


def test_tokens_are_signed_for_one_farm_and_expire():
    t = sso.make(KEY, "test", sub="a@example.com")
    claims = sso.read(KEY, "test", t)
    assert claims["sub"] == "a@example.com" and len(claims["n"]) >= 8
    assert sso.read("other-key", "test", t) is None
    assert sso.read(KEY, "another-farm", t) is None
    assert sso.read(KEY, "test", t, at=time.time() + 600) is None  # expired
    body, sig = t.split(".")
    assert sso.read(KEY, "test", body + "." + sig[:-2] + "AA") is None
    assert sso.read(KEY, "test", "") is None and sso.read("", "test", t) is None
    assert sso.read(KEY, "test", sso.make(KEY, "test", ttl=10_000), at=time.time()) is not None  # capped, not refused


def test_sso_link_signs_in_the_manager_once(ui, hosted):
    base, farm_ui = ui
    call, api = browser()
    code, me, _ = api(base + "/api/me")
    assert code == 401 and me["private"] and "password" not in me, "no password: you sign in with your Claude"
    assert api(base + "/api/state")[0] == 401, "a hosted farm is private whatever its settings say"
    t = sso.make(KEY, farm_ui.cfg.farm, sub="a@example.com")
    code, _, headers = call(base + "/sso?t=" + t)
    assert code == 302 and headers["Location"] == "/" and "clodfarm_owner=" in headers["Set-Cookie"]
    assert headers["Cache-Control"] == "no-store"
    code, me, _ = api(base + "/api/me")
    assert code == 200 and me["manager"] and me["owner"] == farm_ui.cfg.name
    assert api(base + "/api/manager")[1]["settings"]["private_by_host"] is True
    # the same link again, on another device: refused
    other_call, other_api = browser()
    assert other_call(base + "/sso?t=" + t)[0] == 403
    assert other_api(base + "/api/me")[0] == 401


def test_bad_links_are_refused(ui, hosted):
    base, farm_ui = ui
    call, _ = browser()
    assert call(base + "/sso")[0] == 403
    assert call(base + "/sso?t=" + sso.make("wrong", farm_ui.cfg.farm))[0] == 403
    assert call(base + "/sso?t=" + sso.make(KEY, "someone-elses-farm"))[0] == 403


def test_no_key_no_sso(ui, monkeypatch):
    base, farm_ui = ui
    monkeypatch.delenv("FARM_UI_SSO_KEY", raising=False)
    call, _ = browser()
    assert call(base + "/sso?t=" + sso.make(KEY, farm_ui.cfg.farm))[0] == 403


def test_plan_caps_claudes_even_for_the_manager(ui, hosted, monkeypatch):
    base, farm_ui = ui
    monkeypatch.setenv("FARM_MAX_CLAUDES", "1")
    call, api = browser()
    call(base + "/sso?t=" + sso.make(KEY, farm_ui.cfg.farm))
    assert api(base + "/api/me")[1]["hatch"]["max"] == 1
    code, a, _ = api(base + "/api/agents", {"name": "Second"})
    assert code == 200, a
    code, body, _ = api(base + "/api/agents", {"name": "Third"})
    assert code == 409 and "room for 2 Claudes" in body["error"]  # 409: the manager has a Claude here already
    me = api(base + "/api/me")[1]
    assert me["hatch"] == {"can": False, "why": "this farm has room for 2 Claudes, and they're all here", "claudes": 1, "max": 1}
    with pytest.raises(ValueError, match="room for 2 Claudes"):
        farm_ui.manager.create("Fourth", start=False)  # the CLI and MCP paths go through the same check


def test_plan_of_zero_means_the_farms_own_claude_only(ui, monkeypatch):
    base, farm_ui = ui
    monkeypatch.setenv("FARM_MAX_CLAUDES", "0")
    code, body, _ = client()(base + "/api/agents", {"name": "Anyone"})
    assert code == 403 and "room for 1 Claude," in body["error"]
