"""The office's team: specialists a person creates, the chief who delegates, and the rules every one of them works under."""
import json

import pytest

from conftest import cli
from clodfarm import team
from test_web import client, ui  # noqa: F401  (the fixture serves the UI on a local port)


@pytest.fixture
def tm(tmp_path):
    return team.Team(str(tmp_path / ".farm" / "team.json"))


def member(**kw):
    return {"name": "Ana", "title": "Documentos", "gender": "f", "instructions": "Organize os documentos do caso.", **kw}


def test_the_chief_always_exists_and_comes_first(tm):
    assert [m["id"] for m in tm.all()] == ["chief"]
    tm.upsert(member())
    assert [m["id"] for m in tm.all()] == ["chief", "ana"]


def test_ids_are_unique_slugs_without_accents(tm):
    a = tm.upsert(member(name="João Prazos"))
    b = tm.upsert(member(name="João Prazos"))
    assert a["id"] == "joao-prazos" and b["id"] == "joao-prazos-2"
    assert tm.upsert(member(name="Chief"))["id"] == "chief-2", "never collides with the chief"


def test_a_member_is_validated_on_the_server(tm):
    for bad in ({"name": ""}, {"name": "x" * 41}, member(gender="x"), member(instructions="y" * 6001),
                member(look={"skin": "red"}), member(look={"style": "mohawk"}), member(look={"prop": 9}), "nope"):
        with pytest.raises(team.TeamError):
            tm.upsert(bad)
    ok = tm.upsert(member(look={"skin": "#AABBCC", "style": "bun", "glasses": 1, "prop": "2", "evil": "<script>"}))
    assert ok["look"] == {"skin": "#aabbcc", "style": "bun", "glasses": True, "prop": 2}, "unknown keys are dropped"


def test_edit_and_delete(tm):
    ana = tm.upsert(member())
    tm.upsert(member(name="Ana Paula", title="Peças"), ana["id"])
    assert tm.get("ana")["name"] == "Ana Paula" and tm.get("ana")["title"] == "Peças"
    tm.delete("ana")
    assert tm.get("ana") is None
    with pytest.raises(team.TeamError):
        tm.delete("chief")
    with pytest.raises(team.TeamError):
        tm.upsert(member(), "nobody")


def test_the_team_is_capped(tm):
    for i in range(team.MAX_MEMBERS - 1):
        tm.upsert(member(name=f"Pessoa {i}"))
    with pytest.raises(team.TeamError):
        tm.upsert(member(name="Uma a mais"))


def test_a_specialist_works_under_the_office_rules_and_their_own_instructions(tm):
    tm.upsert(member(gender="f"))
    text = tm.briefing({"specialist": "ana"})
    assert "Ana" in text and "feminino" in text and "Organize os documentos do caso." in text
    assert "dados reais de clientes" in text and "[CONFERIR]" in text, "the rules come with every specialist"
    assert "clodfarm spawn" not in text, "only the chief delegates"
    assert tm.briefing({}) == "" and tm.briefing({"specialist": "ghost"}) == ""


def test_the_chief_knows_the_roster_and_how_to_delegate(tm):
    tm.upsert(member())
    tm.upsert(member(name="Bruno", title="Prazos", gender="m", instructions="Confira os prazos da semana."))
    text = tm.briefing({"specialist": "chief"})
    assert "- ana: Ana, Documentos" in text and "- bruno: Bruno, Prazos" in text and "Confira os prazos da semana." in text
    assert "--specialist <id>" in text and "dados reais de clientes" in text


def test_spawn_for_a_specialist_is_stored_on_the_task(env, tm):
    from clodfarm.config import load
    from clodfarm.store import Store
    cfg = load()
    team.Team(f"{cfg.workspace}/.farm/team.json").upsert(member())
    Store.from_config(cfg).ensure_table()
    t = json.loads(cli("spawn", "organizar", "--specialist", "ana", "--json").stdout)
    store = Store.from_config(cfg)
    assert store.get_task(t["id"])["specialist"] == "ana"
    bad = cli("spawn", "x", "--specialist", "ghost", check=False)
    assert bad.returncode == 2 and "no team member" in bad.stderr


def test_team_api_needs_the_overlay_key(ui):
    base, farm_ui = ui
    anon = client()
    assert anon(base + "/api/team")[0] == 403
    key = {"X-Overlay-Token": farm_ui.overlay_token()}
    st, body, _ = anon(base + "/api/team", headers=key)
    assert st == 200 and [m["id"] for m in body] == ["chief"]
    st, body, _ = anon(base + "/api/team", member(), key)
    assert st == 200 and [m["id"] for m in body] == ["chief", "ana"]
    assert anon(base + "/api/team", {"name": ""}, key)[0] == 400
    assert anon(base + "/api/team/ana", member(title="Peças"), key)[1][1]["title"] == "Peças"
    assert anon(base + "/api/team", member(), None)[0] == 403, "no key, no change"
    assert anon(base + "/api/team/chief/delete", {}, key)[0] == 400
    st, body, _ = anon(base + "/api/team/ana/delete", {}, key)
    assert st == 200 and [m["id"] for m in body] == ["chief"]


def test_a_job_goes_to_the_chief_unless_someone_is_named(ui):
    base, farm_ui = ui
    anon, key = client(), {"X-Overlay-Token": farm_ui.overlay_token()}
    farm_ui.team.upsert(member())
    a = anon(base + "/api/tasks/new", {"title": "sem nome"}, key)[1]
    b = anon(base + "/api/tasks/new", {"title": "para a Ana", "specialist": "ana"}, key)[1]
    assert farm_ui.store.get_task(a["id"])["specialist"] == "chief"
    assert farm_ui.store.get_task(b["id"])["specialist"] == "ana"
    assert anon(base + "/api/tasks/new", {"title": "x", "specialist": "ghost"}, key)[0] == 400


def lead(**kw):
    base = {"name": "Helena", "title": "Coordenação INSS", "lead": True, "instructions": "Coordene a frente do INSS."}
    return member(**{**base, **kw})


def test_leads_coordinate_a_team_of_their_own(tm):
    h = tm.upsert(lead())
    assert h["lead"] is True and h["parent"] == "chief"
    a = tm.upsert(member(parent="helena"))
    b = tm.upsert(member(name="Bruno", title="Prazos", gender="m"))
    assert a["parent"] == "helena" and b["parent"] == "chief", "no boss named: under the chief"
    # a lead is told its own people, not everyone
    text = tm.briefing({"specialist": "helena"})
    assert "- ana: Ana, Documentos" in text and "bruno" not in text and "clodfarm spawn" in text and "Coordene a frente do INSS." in text
    # the chief sees the leads (with their teams) and the specialists who report to the chief directly
    chief = tm.briefing({"specialist": "chief"})
    assert "- helena: Helena, Coordenação INSS (coordena: ana)" in chief and "- bruno: Bruno, Prazos" in chief and "- ana:" not in chief


def test_the_hierarchy_has_three_levels_and_no_loops(tm):
    tm.upsert(lead())
    tm.upsert(member(parent="helena"))
    for bad in (member(name="X", parent="ghost"), member(name="Y", parent="ana"),           # unknown boss / a specialist as boss
                member(name="Z", lead=True, parent="helena"), lead(name="Outra", parent="helena")):  # a lead under a lead
        with pytest.raises(team.TeamError):
            tm.upsert(bad)
    with pytest.raises(team.TeamError):
        tm.upsert(member(name="Helena", lead=True, parent="helena"), "helena")      # herself as boss
    with pytest.raises(team.TeamError):
        tm.upsert(lead(lead=False), "helena")                                        # a lead with a team can't become a specialist


def test_removing_a_lead_hands_the_team_to_the_chief(tm):
    tm.upsert(lead())
    tm.upsert(member(parent="helena"))
    tm.delete("helena")
    assert tm.get("ana")["parent"] == "chief"


def test_records_from_before_the_hierarchy_still_load(tm):
    import json as _json, os
    os.makedirs(os.path.dirname(tm.path), exist_ok=True)
    open(tm.path, "w", encoding="utf-8").write(_json.dumps({"members": [{"id": "ana", "name": "Ana", "title": "", "gender": "f", "instructions": "", "look": {}}]}))
    ana, chief = tm.get("ana"), tm.get("chief")
    assert ana["parent"] == "chief" and ana["lead"] is False and ana["pinned"] is False
    assert chief["lead"] is True and chief["parent"] is None


def test_the_chief_stays_on_top(tm):
    c = tm.upsert({**member(name="Marina", title="Chefe"), "parent": "helena", "lead": False, "pinned": False}, "chief")
    assert c["parent"] is None and c["lead"] is True and c["pinned"] is True
