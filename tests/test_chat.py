"""Talking to the team: a message becomes a short job for that person, and its result is the reply."""
import pytest

from clodfarm import chat, team
from test_web import client, ui  # noqa: F401  (the fixture serves the UI on a local port)


def finish(store, tid, result, ok=True):
    t = store.claim_next("w@box/w0", 300, agent=None)
    assert t and t["id"] == tid
    store.finish(tid, "w@box/w0", ok, result, 5)


def test_a_message_becomes_a_job_for_that_person_and_the_result_is_the_reply(ui):
    base, farm_ui = ui
    farm_ui.team.upsert({"name": "Ana", "title": "Documentos", "gender": "f", "instructions": "x"})
    anon, key = client(), {"X-Overlay-Token": farm_ui.overlay_token()}
    st, view, _ = anon(base + "/api/chat/ana", {"text": "Oi Ana, o que falta no caso Exemplo?"}, key)
    assert st == 200 and view["pending"] and [m["role"] for m in view["messages"]] == ["user"]
    tid = view["messages"][0]["task"]
    task = farm_ui.store.get_task(tid)
    assert task["specialist"] == "ana" and "Você é Ana, Documentos" in task["prompt"] and "feminino" in task["prompt"]
    assert "Oi Ana, o que falta no caso Exemplo?" in task["prompt"]
    finish(farm_ui.store, tid, "Faltam a procuração e o comprovante.\n\n[git] no commits")
    st, view, _ = anon(base + "/api/chat/ana", headers=key)
    assert not view["pending"] and view["messages"][-1]["role"] == "assistant"
    assert view["messages"][-1]["text"] == "Faltam a procuração e o comprovante.", "the git line is not part of the answer"
    # the next message carries the conversation so far
    anon(base + "/api/chat/ana", {"text": "E o RG?"}, key)
    nxt = farm_ui.store.list_tasks("queued", 5)[0]
    assert "Advogado: Oi Ana" in nxt["prompt"] and "Você: Faltam a procuração" in nxt["prompt"] and "E o RG?" in nxt["prompt"]


def test_a_failed_job_is_shown_as_a_failed_answer(ui):
    base, farm_ui = ui
    anon, key = client(), {"X-Overlay-Token": farm_ui.overlay_token()}
    view = anon(base + "/api/chat/chief", {"text": "Bom dia"}, key)[1]
    tid = view["messages"][0]["task"]
    farm_ui.store.update_task(tid, max_attempts=1)
    finish(farm_ui.store, tid, "boom", ok=False)
    last = anon(base + "/api/chat/chief", headers=key)[1]["messages"][-1]
    assert last["role"] == "assistant" and last["ok"] is False


def test_chat_is_guarded(ui):
    base, farm_ui = ui
    anon, key = client(), {"X-Overlay-Token": farm_ui.overlay_token()}
    assert anon(base + "/api/chat/chief")[0] == 403 and anon(base + "/api/chat/chief", {"text": "oi"})[0] == 403, "no key, no chat"
    assert anon(base + "/api/chat/ghost", headers=key)[0] == 404
    assert anon(base + "/api/chat/ghost", {"text": "oi"}, key)[0] == 400
    assert anon(base + "/api/chat/chief", {"text": "  "}, key)[0] == 400
    assert anon(base + "/api/chat/chief", {"text": "x" * (chat.MAX_TEXT + 1)}, key)[0] == 400
    for _ in range(chat.MAX_PENDING):
        assert anon(base + "/api/chat/chief", {"text": "oi"}, key)[0] == 200
    assert anon(base + "/api/chat/chief", {"text": "mais uma"}, key)[0] == 400, "too many unanswered messages"


def test_the_latest_answers_feed_the_speech_bubbles(ui):
    base, farm_ui = ui
    anon, key = client(), {"X-Overlay-Token": farm_ui.overlay_token()}
    tid = anon(base + "/api/chat/chief", {"text": "Oi"}, key)[1]["messages"][0]["task"]
    finish(farm_ui.store, tid, "Oi! Em que posso ajudar?")
    st, latest, _ = anon(base + "/api/chat-latest?since=0", headers=key)
    assert st == 200 and [(x["member"], x["text"]) for x in latest] == [("chief", "Oi! Em que posso ajudar?")]
    assert anon(base + f"/api/chat-latest?since={latest[0]['at'] + 1}", headers=key)[1] == [], "only what is newer"


def test_the_chief_conversation_guide_reaches_the_claude_app(tmp_path):
    from clodfarm.auth import install_office_guide
    tm = team.Team(str(tmp_path / "team.json"))
    tm.upsert({"name": "Marina", "title": "Chefe", "gender": "f", "instructions": "Seja objetiva."}, "chief")
    tm.upsert({"name": "Ana", "title": "Documentos", "gender": "f", "instructions": "Organize documentos."})
    guide = tm.chat_guide()
    assert "você é Marina" in guide and "feminino" in guide and "- ana: Ana, Documentos" in guide
    assert "FARM_TASK_ID" in guide and "IGNORE esta seção" in guide, "sub-agents must not take the chief's role"
    assert "dados reais de clientes" in guide
    home = tmp_path / "claude"
    home.mkdir()
    (home / "CLAUDE.md").write_text("# meu arquivo\n", encoding="utf-8")
    install_office_guide(guide, str(home))
    install_office_guide(guide.replace("Marina", "Marta"), str(home))     # rewritten, not appended twice
    text = (home / "CLAUDE.md").read_text(encoding="utf-8")
    assert text.count("clodfarm:office:start") == 1 and "Marta" in text and "Marina" not in text and text.startswith("# meu arquivo")
