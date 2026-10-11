# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# Required Notice: Copyright (c) 2026 lcssurf (https://github.com/lcssurf/escritorio-digital)
"""Reviewing work that waits for approval: the lawyer edits a document by hand, or asks its author to adjust it and applies
(or not) what comes back. Whatever is approved is what lands."""
import json

import pytest

from conftest import cli
from clodfarm import chat, gitops
from clodfarm.web import FarmUI
from test_farm import start_farm, stop_farm, wait_for
from test_web import client, ui  # noqa: F401


def test_the_answer_to_an_adjustment_request_is_split_into_the_note_and_the_document():
    note, doc = chat.split_document("Troquei o parágrafo 2.\n<<<DOCUMENTO\n# Título\n\nTexto novo.\nDOCUMENTO>>>\n")
    assert note == "Troquei o parágrafo 2." and doc == "# Título\n\nTexto novo."
    assert chat.split_document("Qual parágrafo você quer mudar?") == ("Qual parágrafo você quer mudar?", None)
    p = chat.revision_prompt({"name": "Carla", "title": "Peças", "gender": "f"}, "saidas/a.md", "texto atual", "mais curto")
    assert "<<<ATUAL\ntexto atual\nATUAL>>>" in p and "mais curto" in p and "NÃO crie nem altere arquivos" in p and "feminino" in p


@pytest.fixture
def work(env, monkeypatch, tmp_path):
    """A job that finished and waits for approval, with the farm stopped (so no worker takes the jobs made afterwards)."""
    monkeypatch.setenv("FARM_APPROVE_LANDING", "1")
    farm, t = start_farm()
    try:
        tid = json.loads(cli("spawn", "Minuta (ficticia)", "--prompt", "COMMIT draft", "--json").stdout)["id"]
        wait_for(lambda: farm.store.get_task(tid)["status"] == "done", timeout=60)
    finally:
        stop_farm(farm, t)
    return FarmUI(farm.cfg, farm.store), tid


def landed(fui, rel):
    return gitops.show_file(fui.cfg.repo_dir, gitops.main_branch(fui.cfg.repo_dir), rel)[0]


def test_an_edit_by_hand_is_what_lands(work):
    fui, tid = work
    before = fui.store.get_task(tid)["landing_ahead"]
    out = fui.landing_save(tid, "draft.txt", "texto do advogado\n", "manager")
    assert out["changed"] is True and out["text"] == "texto do advogado\n"
    assert fui.landing_file(tid, "draft.txt")["text"] == "texto do advogado\n"
    assert fui.store.get_task(tid)["landing_ahead"] == before + 1, "the edit is one more commit on the work's branch"
    assert fui.landing_save(tid, "draft.txt", "texto do advogado\n", "manager")["changed"] is False, "saving the same text changes nothing"
    fui.decide_landing(tid, True, "manager")
    assert landed(fui, "draft.txt") == "texto do advogado\n", "what was approved is the edited text"


def test_only_the_files_of_the_work_can_be_edited(work):
    fui, tid = work
    for bad in ("../../etc/passwd", "/etc/passwd", "other.txt", "", "draft.txt/../../x"):
        with pytest.raises(ValueError):
            fui.landing_save(tid, bad, "x", "manager")
    for bad in (None, 5, "a\0b", "x" * 200_001):
        with pytest.raises(ValueError):
            fui.landing_save(tid, "draft.txt", bad, "manager")
    with pytest.raises(ValueError):
        fui.landing_save("nonexistent1", "draft.txt", "x", "manager")
    assert fui.landing_file(tid, "draft.txt")["text"] == "draft\n", "nothing was touched"
    fui.decide_landing(tid, False, "manager")
    with pytest.raises(ValueError):
        fui.landing_save(tid, "draft.txt", "x", "manager")   # decided: nothing to edit any more


def test_asking_for_an_adjustment_gives_a_proposal_that_changes_nothing_until_applied(work):
    fui, tid = work
    started = fui.revise_start(tid, "draft.txt", "Troque a palavra draft por rascunho")
    assert started["pending"] and started["messages"][0]["path"] == "draft.txt"
    job = fui.store.claim_next("w@box/w0", 300, agent=None)
    assert job["specialist"] == "chief" and "Troque a palavra draft por rascunho" in job["prompt"] and "<<<ATUAL\ndraft\n\nATUAL>>>" in job["prompt"]
    fui.store.finish(job["id"], "w@box/w0", True, "Troquei a palavra.\n<<<DOCUMENTO\nrascunho\nDOCUMENTO>>>", 5)
    fui.chat_settle_all()   # the overlay does this every few seconds: it must not swallow the proposal (it did, once)
    view = fui.revise_view(tid)
    assert not view["pending"]
    reply = view["messages"][-1]
    assert reply["role"] == "assistant" and reply["text"] == "Troquei a palavra."
    assert reply["proposal"] == {"path": "draft.txt", "text": "rascunho"}
    assert fui.landing_file(tid, "draft.txt")["text"] == "draft\n", "a proposal is only a proposal"
    fui.landing_save(tid, "draft.txt", reply["proposal"]["text"] + "\n", "manager")   # the lawyer applies it
    fui.decide_landing(tid, True, "manager")
    assert landed(fui, "draft.txt") == "rascunho\n"


def test_adjustment_requests_are_checked(work):
    fui, tid = work
    for bad in ("", "   ", "x" * 2001):
        with pytest.raises(ValueError):
            fui.revise_start(tid, "draft.txt", bad)
    with pytest.raises(ValueError):
        fui.revise_start(tid, "nao-existe.txt", "oi")
    for _ in range(chat.MAX_PENDING):
        fui.revise_start(tid, "draft.txt", "mude algo")
    with pytest.raises(ValueError):
        fui.revise_start(tid, "draft.txt", "mais uma")


def test_the_review_api_needs_the_overlay_key(ui):
    base, farm_ui = ui
    anon = client()
    assert anon(base + "/api/landings/abcdef123/revise")[0] == 403
    assert anon(base + "/api/landings/abcdef123/save", {"path": "a", "text": "b"})[0] == 403
    key = {"X-Overlay-Token": farm_ui.overlay_token()}
    assert anon(base + "/api/landings/abcdef123/save", {"path": "a", "text": "b"}, key)[0] == 400, "nothing waits under that id"
    assert anon(base + "/api/landings/abcdef123/revise", {"path": "a", "instruction": "b"}, key)[0] == 400
    st, body, _ = anon(base + "/api/landings/abcdef123/revise", headers=key)
    assert st == 200 and body == {"messages": [], "pending": False}
