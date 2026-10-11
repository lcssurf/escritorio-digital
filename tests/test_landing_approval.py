# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# Required Notice: Copyright (c) 2026 lcssurf (https://github.com/lcssurf/escritorio-digital)
"""Digital office: finished work waits for a person's OK instead of landing on main by itself."""
import json

from conftest import cli
from clodfarm.web import FarmUI

from test_farm import repo_files, start_farm, stop_farm, wait_for


def test_work_waits_for_approval_then_lands(env, monkeypatch):
    monkeypatch.setenv("FARM_APPROVE_LANDING", "1")
    farm, t = start_farm()
    try:
        tid = json.loads(cli("spawn", "needs ok", "--prompt", "COMMIT draft", "--json").stdout)["id"]
        wait_for(lambda: farm.store.get_task(tid)["status"] == "done", timeout=60)
        assert "draft.txt" not in repo_files(env), "nothing lands before a person approves"
        ui = FarmUI(farm.cfg, farm.store)
        waiting = ui.landings()
        assert [w["id"] for w in waiting] == [tid]
        assert any("draft.txt" in f for f in waiting[0]["files"])
        ui.decide_landing(tid, True, "manager")
        assert "draft.txt" in repo_files(env)
        assert ui.landings() == []
    finally:
        stop_farm(farm, t)


def test_denied_work_never_lands(env, monkeypatch):
    monkeypatch.setenv("FARM_APPROVE_LANDING", "1")
    farm, t = start_farm()
    try:
        tid = json.loads(cli("spawn", "bad idea", "--prompt", "COMMIT nope", "--json").stdout)["id"]
        wait_for(lambda: farm.store.get_task(tid)["status"] == "done", timeout=60)
        ui = FarmUI(farm.cfg, farm.store)
        ui.decide_landing(tid, False, "manager", "not this")
        assert "nope.txt" not in repo_files(env)
        assert farm.store.get_task(tid)["landing"] == "denied"
        try:
            ui.decide_landing(tid, True, "manager")
            raise AssertionError("a decided landing must not be decided twice")
        except ValueError:
            pass
    finally:
        stop_farm(farm, t)
