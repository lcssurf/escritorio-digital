"""An invite: a link for one person, who logs in with their own Claude account and gets their own Claude on the farm,
once, whether the farm is private or its hatching is closed. And a public farm's visitor only watches."""
import hashlib
import re

from test_owners import ui  # noqa: F401 - the fixture
from test_sso import browser
from test_web import client, login
from clodfarm.config import load


def make_invite(api, base):
    code, r, _ = api(base + "/api/manager/invite", {})
    assert code == 200, r
    return r["link"]


def test_an_invite_hatches_one_claude_once(ui, monkeypatch):
    base, farm_ui = ui
    manager = client()
    login(manager, base)
    manager(base + "/api/manager/settings", {"hatch_open": False})  # closed to everyone else
    link = make_invite(manager, base)
    token = link.rsplit("/", 1)[1]
    assert re.fullmatch(r"[A-Za-z0-9_-]{20,}", token) and "/invite/" in link

    friend_call, friend = browser()
    # opening it (or a chat app's preview) doesn't spend it
    code, _, headers = friend_call(base + f"/invite/{token}")
    assert code == 302 and headers["Location"].endswith("/?invited=1") and "clodfarm_invite=" in headers["Set-Cookie"]
    assert farm_ui.store.invite(hashlib.sha256(token.encode()).hexdigest())
    me = friend(base + "/api/me")[1]
    assert me["invite"] is True and not me["owner"]
    # logging in hatches their own Claude, and spends the invite
    code, a, headers = friend(base + "/api/agents", {"invite": True})
    assert code == 200, a
    assert "clodfarm_owner=" in headers["Set-Cookie"]
    me = friend(base + "/api/me")[1]
    assert me["owner"] == a["id"] and me["invite"] is False
    assert farm_ui.store.claude(a["id"])["hatched_by"] == "invite"
    assert farm_ui.store.invite(hashlib.sha256(token.encode()).hexdigest()) is None
    # the same link again: refused
    other_call, other = browser()
    assert other_call(base + f"/invite/{token}")[2]["Location"].endswith("/?invited=0")
    assert other(base + "/api/agents", {"invite": True})[0] == 410
    assert other(base + "/api/agents", {"name": "sneaky"})[0] == 403, "hatching is closed without an invite"


def test_an_invite_works_on_a_private_farm(ui, monkeypatch):
    base, farm_ui = ui
    monkeypatch.setenv("FARM_UI_PRIVATE", "1")
    manager = client()
    login(manager, base)
    token = make_invite(manager, base).rsplit("/", 1)[1]
    call, friend = browser()
    call(base + f"/invite/{token}")
    code, me, _ = friend(base + "/api/me")
    assert code == 401 and me["invite"] is True, "can't watch yet, but may log in"
    code, a, _ = friend(base + "/api/agents", {"invite": True})
    assert code == 200, a
    assert friend(base + "/api/me")[0] == 200, "now they're a person on the farm"


def test_the_plan_still_counts(ui, monkeypatch):
    base, farm_ui = ui
    monkeypatch.setenv("FARM_MAX_CLAUDES", "0")
    manager = client()
    login(manager, base)
    r = manager(base + "/api/manager/invite", {})[1]
    assert r["room"] is False
    call, friend = browser()
    call(base + "/invite/" + r["link"].rsplit("/", 1)[1])
    code, body, _ = friend(base + "/api/agents", {"invite": True})
    assert code == 400 and "room for 1 Claude" in body["error"]
    assert friend(base + "/api/me")[1]["invite"] is True, "the invite isn't spent by a refusal"


def test_only_the_manager_makes_invites(ui):
    base, _ = ui
    assert client()(base + "/api/manager/invite", {})[0] == 403


from test_bots import provider  # noqa: E402,F401 - the fixture: a stand-in provider (key `good`)


def test_an_invite_adds_an_agent_on_an_api_key_and_its_person_signs_in_with_a_username(ui, provider):
    base, farm_ui = ui
    url, _ = provider
    manager = client()
    login(manager, base)
    token = make_invite(manager, base).rsplit("/", 1)[1]
    call, friend = browser()
    call(base + f"/invite/{token}")
    bot = {"provider": "custom", "url": url, "model": "m", "key": "good"}
    code, body, _ = friend(base + "/api/agents", {"invite": True, "name": "Gemma", "bot": bot})
    assert code == 400 and "username" in body["error"], "no Claude to sign them in later: a username is a must"
    code, body, _ = friend(base + "/api/agents", {"invite": True, "name": "Gemma", "bot": {**bot, "key": "wrong"},
                                                  "account": {"username": "noa", "password": "long enough"}})
    assert code == 400 and "refused the key" in body["error"]
    assert friend(base + "/api/me")[1]["invite"] is True, "a refusal doesn't spend the invite"
    code, a, headers = friend(base + "/api/agents", {"invite": True, "name": "Gemma", "bot": bot,
                                                     "account": {"username": "Noa", "password": "long enough"}})
    assert code == 200 and a["said"] == "ok" and "clodfarm_owner=" in headers["Set-Cookie"]
    rec = farm_ui.store.claude(a["id"])
    assert rec["hatched_by"] == "invite" and rec["bot"] == "m" and farm_ui.manager.get(a["id"])["bot"]["model"] == "m"
    me = friend(base + "/api/me")[1]
    assert me["owner"] == a["id"] and me["username"] == "noa", "usernames are lower case"
    login_rec = farm_ui.store.login("noa")
    assert login_rec["claude"] == a["id"] and "long enough" not in str(login_rec), "only a salted hash is kept"

    # another device: signs in with that username and password
    _, other = browser()
    assert other(base + "/api/signin", {"username": "noa", "password": "wrong one"})[0] == 401
    code, r, headers = other(base + "/api/signin", {"username": "NOA", "password": "long enough"})
    assert code == 200 and r["claude"] == a["id"] and "clodfarm_owner=" in headers["Set-Cookie"]
    assert other(base + "/api/me")[1]["owner"] == a["id"]


def test_signing_in_with_a_username_works_on_a_private_farm_and_locks_out_guessers(ui, monkeypatch):
    base, farm_ui = ui
    monkeypatch.setenv("FARM_UI_PRIVATE", "1")
    manager = client()
    login(manager, base)
    token = make_invite(manager, base).rsplit("/", 1)[1]
    call, friend = browser()
    call(base + f"/invite/{token}")
    code, a, _ = friend(base + "/api/agents", {"invite": True, "account": {"username": "gil", "password": "hunter2!x"}})
    assert code == 200, "a Claude by invite may have a username too"
    _, guesser = browser()
    assert guesser(base + "/api/me")[0] == 401
    for _ in range(5):
        assert guesser(base + "/api/signin", {"username": "gil", "password": "nope nope"})[0] == 401
    assert guesser(base + "/api/signin", {"username": "gil", "password": "hunter2!x"})[0] == 429, "five tries"
    farm_ui.lock.clear("127.0.0.1")  # another address (every client here is 127.0.0.1)
    _, phone = browser()
    assert phone(base + "/api/signin", {"username": "gil", "password": "hunter2!x"})[0] == 200
    assert phone(base + "/api/me")[0] == 200, "a person on the private farm now"


def test_a_person_sets_and_changes_their_username(ui):
    base, farm_ui = ui
    manager = client()
    login(manager, base)
    code, r, _ = manager(base + "/api/account", {"account": {"username": "matan", "password": "first password"}})
    assert code == 200 and r["username"] == "matan"
    assert manager(base + "/api/me")[1]["username"] == "matan"
    code, r, _ = manager(base + "/api/account", {"account": {"username": "matan", "password": "second password"}})
    assert code == 200, "the same name, a new password"
    _, phone = browser()
    assert phone(base + "/api/signin", {"username": "matan", "password": "first password"})[0] == 401
    code, r, _ = phone(base + "/api/signin", {"username": "matan", "password": "second password"})
    assert code == 200 and r["claude"] == load().name and phone(base + "/api/me")[1]["manager"], \
        "the manager signs in the same way"
    for bad, why in ((("x", "long enough"), "3 to 32"), (("ok-name", "short"), "8 characters")):
        code, r, _ = manager(base + "/api/account", {"account": {"username": bad[0], "password": bad[1]}})
        assert code == 400 and why in r["error"]
    assert client()(base + "/api/account", {"account": {"username": "anon", "password": "long enough"}})[0] == 403
    assert manager(base + "/api/account", {"remove": True})[1] == {"username": None}
    assert phone(base + "/api/signin", {"username": "matan", "password": "second password"})[0] == 401
