# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# Required Notice: Copyright (c) 2026 lcssurf (https://github.com/lcssurf/escritorio-digital)
"""Backup and restore of the team and the office speed, and what an approved job tells the desktop app about its files.
The team is the person's own work: a bad file must never change it, and a restore must never go through unannounced."""
import json
import os

import pytest

from conftest import cli
from clodfarm import team
from clodfarm.web import FarmUI
from test_farm import start_farm, stop_farm, wait_for
from test_web import client, login, ui  # noqa: F401


def member(name, **kw):
    return {"name": name, "title": "Cargo", "gender": "f", "instructions": "faça " + name, "look": {"style": "bun"}, **kw}


@pytest.fixture
def fui(ui):  # noqa: F811
    return ui[1]


def make_team(fui):
    lead = fui.team.upsert(member("Coordenadora Ana", lead=True))
    fui.team.upsert(member("Bruno", gender="m", parent=lead["id"]))
    fui.team.upsert(member("Carla"))


def test_a_backup_holds_the_team_and_the_speed_and_nothing_secret(fui):
    make_team(fui)
    fui.set_speed("fast")
    b = fui.backup_view()
    assert b["kind"] == "escritorio-digital-backup" and b["version"] == 1
    assert [m["name"] for m in b["team"]][1:] == ["Coordenadora Ana", "Bruno", "Carla"] and b["settings"] == {"speed": "fast"}
    text = json.dumps(b).lower()
    for secret in ("token", "password", "connector", "login"):
        assert secret not in text, secret


def test_restoring_brings_the_team_back_and_keeps_a_copy_of_the_one_it_replaced(fui):
    make_team(fui)
    fui.set_speed("max")
    saved = json.loads(json.dumps(fui.backup_view()))
    fui.team.delete("carla")
    fui.team.upsert(member("Outra pessoa"))
    fui.set_speed("balanced")
    out = fui.restore_backup(saved)
    assert out["restored"] == 4 and out["kept"].startswith("team-") and out["kept"].endswith("-before-restore.json")
    names = [m["name"] for m in fui.team.all()]
    assert "Carla" in names and "Outra pessoa" not in names, "the team is the one in the backup"
    assert fui.store.settings()["speed"] == "max"
    kept = json.load(open(os.path.join(fui.cfg.workspace, ".farm", "backups", out["kept"]), encoding="utf-8"))
    assert "Outra pessoa" in [m["name"] for m in kept["team"]], "the replaced team can be recovered"
    assert [m["parent"] for m in fui.team.all() if m["name"] == "Bruno"] == ["coordenadora-ana"], "who reports to whom survives"


def test_a_bad_backup_changes_nothing_and_leaves_no_trace(fui):
    make_team(fui)
    before = fui.team.all()
    good = fui.backup_view()
    bad_files = [
        {},                                                          # not a backup
        {**good, "kind": "something-else"},
        {**good, "version": 2},                                      # made by a newer version
        {**good, "team": []},
        {**good, "team": "x"},
        {**good, "team": [{"id": "chief", "name": ""}]},             # a member without a name
        {**good, "team": [*good["team"], {"id": "../x", "name": "Z"}]},                    # an id that is not an id
        {**good, "team": [*good["team"], {"id": "carla", "name": "Duplicada"}]},          # the same id twice
        {**good, "team": [*good["team"], {"id": "novo", "name": "Z", "parent": "carla"}]},  # reports to a specialist
        {**good, "team": [*good["team"], {"id": "novo", "name": "Z", "look": {"suit": "red"}}]},  # a colour that is not one
        {**good, "team": [{"id": f"m{i}", "name": "M"} for i in range(team.MAX_MEMBERS + 5)]},    # too many
    ]
    for bad in bad_files:
        with pytest.raises(ValueError):
            fui.restore_backup(bad)
    assert fui.team.all() == before
    assert not os.path.exists(os.path.join(fui.cfg.workspace, ".farm", "backups")), "a refused file does not even leave a copy behind"
    assert not os.path.exists(os.path.join(fui.cfg.workspace, ".farm", "team-check.json"))


def test_a_restore_cannot_open_a_connector_or_set_a_secret(fui):
    before = fui.store.settings()
    saved = {**fui.backup_view(), "settings": {"speed": "fast", "connectors": ["claude_ai_Gmail"], "token": "x", "private": not before["private"]}}
    fui.restore_backup(saved)
    settings = fui.store.settings()
    assert settings["speed"] == "fast"
    assert "connectors" not in settings and "token" not in settings
    assert {k: v for k, v in settings.items() if k not in ("speed", "at")} == {k: v for k, v in before.items() if k not in ("speed", "at")}, "only the speed is taken from a backup"
    assert fui.restore_backup({**saved, "settings": {"speed": "warp"}})["restored"] >= 1
    assert fui.store.settings()["speed"] == "fast", "an unknown speed is ignored"


def test_the_backup_routes_are_for_the_farms_person_only(ui):
    url, fui = ui
    call = client()
    assert call(url + "/api/backup")[0] in (401, 403)
    assert call(url + "/api/restore", {})[0] in (401, 403)
    login(call, url)
    code, data, _ = call(url + "/api/backup")
    assert code == 200 and data["kind"] == "escritorio-digital-backup"
    assert call(url + "/api/restore", {"kind": "nope"})[0] == 400
    code, out, _ = call(url + "/api/restore", data)
    assert code == 200 and out["restored"] == len(data["team"])


def test_an_approved_job_tells_which_folder_and_files_were_handed_over(env, monkeypatch, tmp_path):
    export = tmp_path / "entregas"
    monkeypatch.setenv("FARM_APPROVE_LANDING", "1")
    monkeypatch.setenv("FARM_EXPORT_DIR", str(export))
    farm, t = start_farm()
    try:
        tid = json.loads(cli("spawn", "Minuta (ficticia)", "--prompt", "COMMIT draft", "--json").stdout)["id"]
        wait_for(lambda: farm.store.get_task(tid)["status"] == "done", timeout=60)
        f = FarmUI(farm.cfg, farm.store)
        assert f.exported_view(tid) == {"folder": "", "files": []}, "nothing before the OK"
        f.decide_landing(tid, True, "manager")
        got = f.exported_view(tid)
        assert got["files"] == ["draft.txt"] and got["folder"] == os.listdir(export)[0]
        assert f.exported_view("nonexistent1") == {"folder": "", "files": []}
    finally:
        stop_farm(farm, t)


def fail_a_job(fui, text):
    t = fui.store.add_task("trabalho que falhou", "x", created_by="test", owner=fui.cfg.name)
    job = fui.store.claim_next("w@box/w0", 300, agent=None)
    assert job["id"] == t["id"]
    fui.store.finish(job["id"], "w@box/w0", False, text, 0)
    return t["id"]


@pytest.fixture
def signed_in(fui, monkeypatch):
    monkeypatch.setattr(fui, "state", lambda: {"agents": [{"id": "clodfarm", "loggedIn": True}]})
    return fui


def test_the_panel_is_told_when_the_claude_account_signed_out(fui, monkeypatch):
    monkeypatch.setattr(fui, "state", lambda: {"agents": [{"id": "clodfarm", "loggedIn": False}, {"id": "ana", "loggedIn": False}]})
    assert fui.progress()["alerts"] == [{"kind": "login"}], "every account signed out"
    monkeypatch.setattr(fui, "state", lambda: {"agents": [{"id": "clodfarm", "loggedIn": False}, {"id": "ana", "loggedIn": True}]})
    assert fui.progress()["alerts"] == [], "one still signed in: no alarm"
    monkeypatch.setattr(fui, "state", lambda: {"agents": []})
    assert fui.progress()["alerts"] == [], "nobody known yet: no alarm"


def test_a_failed_run_that_asks_for_login_raises_the_alarm(signed_in):
    assert signed_in.progress()["alerts"] == []
    fail_a_job(signed_in, "Error: Please run /login to sign in")
    assert signed_in.progress()["alerts"] == [{"kind": "login"}]


def test_the_plan_limit_raises_its_own_alarm(signed_in):
    fail_a_job(signed_in, "Claude usage limit reached. Your limit will reset at 3pm")
    assert signed_in.progress()["alerts"] == [{"kind": "limit"}]


def test_an_ordinary_failure_raises_no_alarm(signed_in):
    fail_a_job(signed_in, "Erro 401 na rota do cliente fictício; o teste unitário falhou")   # a job's own failure
    assert signed_in.progress()["alerts"] == []


def test_an_old_failure_no_longer_raises_the_alarm(signed_in):
    tid = fail_a_job(signed_in, "Error: Please run /login")
    signed_in.store.update_task(tid, finished=1.0, updated=1.0)
    assert signed_in.progress()["alerts"] == [], "only failures of the last half hour count"
