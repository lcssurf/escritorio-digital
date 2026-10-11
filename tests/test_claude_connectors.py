"""The connectors of the lawyer's Claude account (Gmail, Drive, Calendar...): off for the office until they let one in,
and read-only when they do."""
from clodfarm import policy
from test_web import client, ui  # noqa: F401

MCP_LIST = """Checking MCP server health…

claude.ai Claude Docs: https://api.anthropic.com/v1/pages/mcp - ✔ Connected
claude.ai Google Drive: https://drivemcp.googleapis.com/mcp/v1 - ✔ Connected
claude.ai Gmail: https://gmailmcp.googleapis.com/mcp/v1 - ! Needs authentication
"""


def test_a_connector_is_denied_unless_let_in_and_then_only_to_look_things_up():
    off = {"deny": ["claude_ai"]}
    ok, why = policy.decide(off, "mcp__claude_ai_Gmail__search_threads")
    assert not ok and "off for the office" in why
    on = {"deny": ["claude_ai"], "allow": ["claude_ai_Google_Drive"]}
    assert policy.decide(on, "mcp__claude_ai_Google_Drive__search_files")[0]
    assert policy.decide(on, "mcp__claude_ai_Google_Drive__get_file_content")[0]
    ok, why = policy.decide(on, "mcp__claude_ai_Google_Drive__create_file")
    assert not ok and "read-only" in why
    assert not policy.decide(on, "mcp__claude_ai_Gmail__search_threads")[0], "only the connector that was let in"
    assert not policy.decide(on, "mcp__claude_ai_Gmail__send_message")[0]
    assert policy.decide(off, "Bash")[0] and policy.decide(off, "Read")[0], "this group does not touch the other tools"


def test_the_allow_list_is_sanitised():
    assert policy.clean({"deny": ["claude_ai"], "allow": ["claude_ai_Gmail", "../../x", "Bash", 3]}) == {"deny": ["claude_ai"], "allow": ["claude_ai_Gmail"]}
    assert policy.clean(None) == {"deny": []} and policy.clean("all") == {"deny": []}


def test_connectors_start_off_once(store, tmp_path):
    cfg_dir = str(tmp_path / "claude")
    policy.ensure_connectors_off(store, "primary", cfg_dir)
    assert store.claude("primary")["tools"]["deny"] == ["claude_ai"]
    assert policy.load(cfg_dir)["deny"] == ["claude_ai"], "the hook's file exists"
    # the lawyer let one in: starting again keeps their choice
    store.put_claude("primary", tools={"deny": ["claude_ai"], "allow": ["claude_ai_Google_Drive"]})
    policy.ensure_connectors_off(store, "primary", cfg_dir)
    assert store.claude("primary")["tools"]["allow"] == ["claude_ai_Google_Drive"]
    # and if they turned the whole group on by hand, it is not switched off behind their back
    store.put_claude("other", tools={"deny": []}, connectors_default=True)
    policy.ensure_connectors_off(store, "other", str(tmp_path / "o"))
    assert "claude_ai" not in store.claude("other")["tools"]["deny"]


def test_the_api_lists_and_lets_connectors_in(ui, monkeypatch):
    base, farm_ui = ui
    monkeypatch.setattr(type(farm_ui), "_mcp_list_text", lambda self: MCP_LIST)
    anon, key = client(), {"X-Overlay-Token": farm_ui.overlay_token()}
    assert anon(base + "/api/claude-connectors")[0] == 403
    st, body, _ = anon(base + "/api/claude-connectors", headers=key)
    assert st == 200 and body["url"].startswith("https://claude.ai/")
    assert [(c["name"], c["connected"], c["allowed"]) for c in body["connectors"]] == [
        ("Claude Docs", True, False), ("Google Drive", True, False), ("Gmail", False, False)]
    st, body, _ = anon(base + "/api/claude-connectors", {"allow": ["claude_ai_Google_Drive", "claude_ai_Ghost", "x"]}, key)
    assert st == 200 and [c["name"] for c in body["connectors"] if c["allowed"]] == ["Google Drive"], "unknown ones are ignored"
    tools = farm_ui.store.claude(farm_ui.cfg.name)["tools"]
    assert tools == {"deny": ["claude_ai"], "allow": ["claude_ai_Google_Drive"]}
    assert anon(base + "/api/claude-connectors", {"allow": "all"}, key)[0] == 400
    assert anon(base + "/api/claude-connectors", {"allow": []}, key)[1]["connectors"][1]["allowed"] is False, "and they can be turned off again"
    assert anon(base + "/api/claude-connectors", {"allow": []})[0] == 403
