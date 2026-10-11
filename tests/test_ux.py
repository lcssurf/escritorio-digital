# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# Required Notice: Copyright (c) 2026 lcssurf (https://github.com/lcssurf/escritorio-digital)
"""What makes the office usable by someone who never saw it: read the work before approving it, get the files on your own
computer, and let the chief propose a plan that you accept before anything starts."""
import json
import os

import pytest

from conftest import cli
from clodfarm import chat, gitops
from clodfarm.web import FarmUI
from test_farm import start_farm, stop_farm, wait_for
from test_web import client, ui  # noqa: F401


# ------------------------------------------------------------------ the plan the chief proposes
def test_a_plan_block_is_split_from_the_text_and_checked_against_the_team():
    text = ('Vou chamar a Helena e o Bruno.\n```plano\n{"passos":[{"quem":"helena","tarefa":"Analisar o caso"},'
            '{"quem":"ghost","tarefa":"Algo"},{"quem":"bruno","tarefa":""},{"quem":"bruno","tarefa":"Dar o semáforo"}]}\n```\n')
    clean, plan = chat.split_plan(text, {"helena", "bruno"})
    assert clean == "Vou chamar a Helena e o Bruno."
    assert plan == {"steps": [{"who": "helena", "task": "Analisar o caso"}, {"who": "bruno", "task": "Dar o semáforo"}], "status": "proposed"}, \
        "people who are not on the team and empty steps are dropped"
    assert chat.split_plan("Só uma resposta.", {"helena"}) == ("Só uma resposta.", None)
    assert chat.split_plan("Oi\n```plano\nisso nao e json\n```", {"helena"}) == ("Oi", None)
    big = {"passos": [{"quem": "helena", "tarefa": f"passo {i}"} for i in range(20)]}
    assert len(chat.split_plan("x\n```plano\n" + json.dumps(big) + "\n```", {"helena"})[1]["steps"]) == chat.MAX_STEPS


def finish(store, tid, result):
    t = store.claim_next("w@box/w0", 300, agent=None)
    assert t and t["id"] == tid
    store.finish(tid, "w@box/w0", True, result, 5)


def test_the_chief_asks_before_acting_and_the_lawyer_decides(ui):
    base, farm_ui = ui
    farm_ui.team.upsert({"name": "Helena", "title": "Coordenação INSS", "gender": "f", "lead": True})
    anon, key = client(), {"X-Overlay-Token": farm_ui.overlay_token()}
    view = anon(base + "/api/chat/chief", {"text": "Analise o caso da Maria e monte o requerimento"}, key)[1]
    task = farm_ui.store.get_task(view["messages"][0]["task"])
    assert "NÃO execute nada ainda" in task["prompt"] and "```plano" in task["prompt"], "the chief is told to plan first"
    finish(farm_ui.store, task["id"], 'Vou chamar a Helena.\n```plano\n{"passos":[{"quem":"helena","tarefa":"Analisar o caso e montar o requerimento"}]}\n```')
    view = anon(base + "/api/chat/chief", headers=key)[1]
    reply = view["messages"][-1]
    assert reply["text"] == "Vou chamar a Helena." and reply["plan"]["status"] == "proposed" and reply["plan"]["steps"][0]["who"] == "helena"
    assert not farm_ui.store.list_tasks("queued", 5), "nothing starts before the lawyer says yes"
    # yes: the plan becomes a job for the chief, with the approved steps in it
    st, view, _ = anon(base + f"/api/chat/chief/plan/{reply['id']}/start", {}, key)
    assert st == 200
    run = farm_ui.store.list_tasks("queued", 5)[0]
    assert run["specialist"] == "chief" and "APROVOU" in run["prompt"] and "Helena (helena): Analisar o caso" in run["prompt"]
    assert "Analise o caso da Maria" in run["prompt"]
    assert anon(base + f"/api/chat/chief/plan/{reply['id']}/start", {}, key)[0] == 400, "decided once"
    # and the result comes back into the conversation when the job is done
    finish(farm_ui.store, run["id"], "Tudo pronto: requerimento montado.")
    last = anon(base + "/api/chat/chief", headers=key)[1]["messages"][-1]
    assert last["text"] == "Tudo pronto: requerimento montado." and last["kind"] == "done"


def test_a_plan_can_be_turned_down(ui):
    base, farm_ui = ui
    farm_ui.team.upsert({"name": "Helena", "title": "x", "gender": "f", "lead": True})
    anon, key = client(), {"X-Overlay-Token": farm_ui.overlay_token()}
    tid = anon(base + "/api/chat/chief", {"text": "faça algo"}, key)[1]["messages"][0]["task"]
    finish(farm_ui.store, tid, 'ok\n```plano\n{"passos":[{"quem":"helena","tarefa":"x"}]}\n```')
    mid = anon(base + "/api/chat/chief", headers=key)[1]["messages"][-1]["id"]
    anon(base + f"/api/chat/chief/plan/{mid}/cancel", {}, key)
    assert anon(base + "/api/chat/chief", headers=key)[1]["messages"][-1]["plan"]["status"] == "cancelled"
    assert not farm_ui.store.list_tasks("queued", 5)


def test_only_the_chief_plans_first(ui):
    base, farm_ui = ui
    farm_ui.team.upsert({"name": "Ana", "title": "Docs", "gender": "f"})
    anon, key = client(), {"X-Overlay-Token": farm_ui.overlay_token()}
    tid = anon(base + "/api/chat/ana", {"text": "oi"}, key)[1]["messages"][0]["task"]
    assert "NÃO execute nada ainda" not in farm_ui.store.get_task(tid)["prompt"], "a direct chat with a specialist just answers"


# ------------------------------------------------------------------ reading and receiving the work
def test_work_can_be_read_before_it_is_approved_and_lands_in_the_lawyers_folder(env, monkeypatch, tmp_path):
    export = tmp_path / "entregas"
    monkeypatch.setenv("FARM_APPROVE_LANDING", "1")
    monkeypatch.setenv("FARM_EXPORT_DIR", str(export))
    farm, t = start_farm()
    try:
        tid = json.loads(cli("spawn", "Minuta da inicial (ficticia)", "--prompt", "COMMIT draft", "--json").stdout)["id"]
        wait_for(lambda: farm.store.get_task(tid)["status"] == "done", timeout=60)
        fui = FarmUI(farm.cfg, farm.store)
        got = fui.landing_file(tid, "draft.txt")
        assert got == {"path": "draft.txt", "text": "draft\n", "truncated": False, "binary": False}
        for bad in ("../etc/passwd", "/etc/passwd", "other.txt", ""):
            with pytest.raises(ValueError):
                fui.landing_file(tid, bad)
        with pytest.raises(ValueError):
            fui.landing_file("nonexistent1", "draft.txt")
        assert not export.exists(), "nothing is handed over before the OK"
        fui.decide_landing(tid, True, "manager")
        folders = list(export.iterdir())
        assert len(folders) == 1 and folders[0].name.endswith("minuta-da-inicial-ficticia")
        assert (folders[0] / "draft.txt").read_text() == "draft\n"
        with pytest.raises(ValueError):
            fui.landing_file(tid, "draft.txt")   # decided: nothing to read any more
    finally:
        stop_farm(farm, t)


def test_a_rejected_job_is_not_exported(env, monkeypatch, tmp_path):
    export = tmp_path / "entregas"
    monkeypatch.setenv("FARM_APPROVE_LANDING", "1")
    monkeypatch.setenv("FARM_EXPORT_DIR", str(export))
    farm, t = start_farm()
    try:
        tid = json.loads(cli("spawn", "ruim", "--prompt", "COMMIT nope", "--json").stdout)["id"]
        wait_for(lambda: farm.store.get_task(tid)["status"] == "done", timeout=60)
        FarmUI(farm.cfg, farm.store).decide_landing(tid, False, "manager")
        assert not export.exists()
    finally:
        stop_farm(farm, t)


def test_safe_paths():
    assert gitops.safe_relpath("saidas/a.md") and gitops.safe_relpath("a/b/c.txt")
    for bad in ("", "/abs", "../x", "a/../../x", "a\\..\\x"):
        assert not gitops.safe_relpath(bad), bad
