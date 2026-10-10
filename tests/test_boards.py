"""Whiteboards: the element check, revisions and what a page asks for, clear and tombstones, the API (everyone sees and
draws on every board) and `clodfarm board`."""
import json
import time

import pytest

from clodfarm import boards
from clodfarm.cli import main as cli
from test_web import client, login, ui  # noqa: F401 - the UI server fixture


def test_normalize_cleans_and_explains():
    assert boards.normalize({"type": "rect", "x": 10, "y": 10, "w": -50, "h": 20.04, "fill": "#AABBCC"}) == \
        {"type": "rect", "color": "#1e1e1e", "width": 2, "x": -40, "y": 10, "w": 50, "h": 20, "fill": "#aabbcc"}
    note = boards.normalize({"type": "note", "x": 0, "y": 0, "text": "idea"})
    assert note["w"] == 200 and note["fill"] == boards.NOTE_FILL and note["size"] == 20
    assert boards.normalize({"type": "path", "points": "0,0 10,5", "closed": 1})["points"] == [[0, 0], [10, 5]]
    assert boards.normalize({"type": "text", "x": 1, "y": 2, "text": "hi", "size": 999})["size"] == 300
    db = boards.normalize({"type": "cylinder", "x": 0, "y": 0, "w": 90, "h": 80, "label": "DB<br>main", "fill": "blue",
                           "color": "#f0a", "dash": "dashed", "opacity": 3})
    assert db["text"] == "DB\nmain" and db["fill"] == boards.TINTS["blue"] and db["color"] == "#ff00aa"
    assert db["dash"] == "dashed" and db["opacity"] == 1
    joined = boards.normalize({"type": "arrow", "from": "a", "to": "b", "route": "curve", "text": "SQL"})
    assert joined["x1"] == 0 and joined["head"] == "end" and joined["route"] == "curve" and joined["size"] == 18
    assert boards.normalize({"type": "line", "x1": 0, "y1": 0, "x2": 1, "y2": 1})["head"] == "none"
    png = "data:image/png;base64," + "A" * 20
    assert boards.normalize({"type": "image", "x": 0, "y": 0, "w": 9, "h": 9, "src": png})["src"] == png
    for bad, msg in [({"type": "circle"}, "type must be one of"), ({"type": "line", "x1": 0}, "a number is required"),
                     ({"type": "arrow", "from": "a"}, "give from and to"),
                     ({"type": "rect", "x": 0, "y": 0, "w": 1, "h": 1, "color": "reddish"}, "#rrggbb or a name"),
                     ({"type": "text", "x": 0, "y": 0, "text": "  "}, "needs some text"),
                     ({"type": "path", "points": []}, "needs points"),
                     ({"type": "line", "x1": float("nan"), "y1": 0, "x2": 0, "y2": 0}, "out of range"),
                     ({"type": "line", "x1": 0, "y1": 0, "x2": 0, "y2": 0, "route": "zigzag"}, "route"),
                     ({"type": "image", "x": 0, "y": 0, "w": 1, "h": 1, "src": "https://x.test/a.png"}, "data:image"),
                     ({"type": "image", "x": 0, "y": 0, "w": 1, "h": 1, "src": "data:image/png;base64," + "A" * boards.MAX_IMAGE},
                      "too big"),
                     ({"type": "text", "id": "no spaces", "x": 0, "y": 0, "text": "x"}, "id"), ([], "JSON object")]:
        with pytest.raises(boards.BoardError, match=msg):
            boards.normalize(bad)


def test_the_hand_drawn_look_is_kept():
    el = boards.normalize({"type": "ellipse", "x": 0, "y": 0, "w": 9, "h": 9, "roughness": 2, "fill": "red",
                           "fill_style": "cross-hatch", "seed": 42, "font": "hand", "text": "hi"})
    assert (el["roughness"], el["fill_style"], el["seed"], el["font"], el["fill"]) == (2, "cross-hatch", 42, "hand", "#ffc9c9")
    assert boards.normalize({"type": "rect", "x": 0, "y": 0, "w": 1, "h": 1, "roughness": 9})["roughness"] == 3
    with pytest.raises(boards.BoardError, match="fill_style"):
        boards.normalize({"type": "rect", "x": 0, "y": 0, "w": 1, "h": 1, "fill_style": "plaid"})
    from clodfarm import diagram
    els = {e["id"]: e for e in diagram.build("flowchart LR\n  a[(DB)] --> b{ok?} --> c[plain]", "d")}
    assert els["d-a"]["fill"] == "#a5d8ff" and els["d-b"]["fill"] == "#ffec99" and els["d-c"]["fill"] == "#ffffff"
    assert els["d-a"]["fill_style"] == "hachure"


def test_an_op_can_set_its_place_in_the_stack(store):
    r = boards.apply(store, "gil", [{"op": "put", "el": {"type": "text", "x": 0, "y": 0, "text": "a", "id": "a"}},
                                    {"op": "put", "el": {"type": "text", "x": 0, "y": 0, "text": "b", "id": "b"}}], "x")
    assert r["items"][0]["z"] < r["items"][1]["z"]
    boards.apply(store, "gil", [{"op": "put", "el": {"type": "text", "x": 0, "y": 0, "text": "a", "id": "a"},
                                 "z": r["items"][1]["z"] + 1}], "x")
    assert [e["id"] for e in boards.elements(store, "gil")] == ["b", "a"]      # brought to the front
    with pytest.raises(boards.BoardError, match="z"):
        boards.apply(store, "gil", [{"op": "put", "el": {"type": "text", "x": 0, "y": 0, "text": "a"}, "z": "top"}], "x")


def test_changes_since_a_revision(store):
    r = boards.apply(store, "gil", [{"op": "put", "el": {"type": "text", "x": 0, "y": 0, "text": "a", "id": "t1"}},
                                    {"op": "put", "el": {"type": "line", "x1": 0, "y1": 0, "x2": 9, "y2": 9}}], "claude:gil")
    assert r["rev"] == 2 and [i["rev"] for i in r["items"]] == [1, 2]
    first = boards.changes(store, "gil", 0)
    assert first["full"] and [e["id"] for e in first["items"]][0] == "t1" and first["count"] == 2
    boards.apply(store, "gil", [{"op": "put", "el": {"type": "text", "x": 5, "y": 5, "text": "b", "id": "t1"}},
                                {"op": "del", "id": r["items"][1]["id"]}], "person:gil")
    ch = boards.changes(store, "gil", 2)
    assert not ch["full"] and ch["rev"] == 4 and ch["count"] == 1
    got = {i["id"]: i for i in ch["items"]}
    assert got["t1"]["text"] == "b" and got["t1"]["by"] == "person:gil"
    assert got[r["items"][1]["id"]]["deleted"]
    assert [e["text"] for e in boards.elements(store, "gil")] == ["b"]      # the moved text kept its place in the stack
    assert boards.changes(store, "gil", 99)["full"]                        # a page from before a reset starts over
    assert boards.changes(store, "noa", 0) == {**boards.changes(store, "noa", 0), "rev": 0, "items": [], "full": True}


def test_a_settled_board_answers_with_nothing(store, monkeypatch):
    boards.apply(store, "gil", [{"op": "put", "el": {"type": "text", "x": 0, "y": 0, "text": "a"}}], "x")
    assert boards.changes(store, "gil", 1)["items"], "just written: asked again, in case a writer was still at it"
    later = time.time() + boards.SETTLE + 1
    monkeypatch.setattr(boards, "now", lambda: later)
    assert boards.changes(store, "gil", 1)["items"] == []


def test_clear_full_board_and_tombstones(store, monkeypatch):
    for i in range(3):
        boards.apply(store, "gil", [{"op": "put", "el": {"type": "text", "x": i, "y": 0, "text": str(i), "id": f"e{i}"}}], "x")
    boards.apply(store, "gil", [{"op": "del", "id": "e0"}], "x")
    c = boards.clear(store, "gil", "person:gil")
    assert boards.elements(store, "gil") == [] and boards.changes(store, "gil", c["rev"] - 1)["full"]
    monkeypatch.setattr(boards, "MAX_ITEMS", 2)
    boards.apply(store, "gil", [{"op": "put", "el": {"type": "text", "x": 0, "y": 0, "text": "a", "id": "a"}},
                                {"op": "put", "el": {"type": "text", "x": 0, "y": 0, "text": "b", "id": "b"}}], "x")
    with pytest.raises(boards.BoardError, match="full"):
        boards.apply(store, "gil", [{"op": "put", "el": {"type": "text", "x": 0, "y": 0, "text": "c"}}], "x")
    boards.apply(store, "gil", [{"op": "put", "el": {"type": "text", "x": 0, "y": 0, "text": "a2", "id": "a"}}], "x")  # replacing fits
    with pytest.raises(boards.BoardError, match="op is"):
        boards.apply(store, "gil", [{"op": "move"}], "x")
    # old tombstones are forgotten, and a page that looked before them gets everything
    boards.apply(store, "gil", [{"op": "del", "id": "b"}], "x")
    rev = boards.meta(store, "gil")["rev"]
    later = time.time() + boards.TOMB_TTL + 5
    monkeypatch.setattr(boards, "now", lambda: later)
    boards._prune(store, "gil")
    assert boards.meta(store, "gil")["pruned"] == rev and boards.changes(store, "gil", rev - 1)["full"]


def test_everyone_sees_and_draws_on_every_board(ui):
    base, farm_ui = ui
    owner, visitor = client(), client()
    code, gil, _ = owner(base + "/api/agents", {"name": "Gil"})
    assert code == 200, gil
    boards_ = owner(base + "/api/boards")[1]
    assert boards_[0]["claude"] == gil["id"] and boards_[0]["mine"] and {b["claude"] for b in boards_} == {"test", gil["id"]}
    # someone only watching a public farm sees every board and draws on the farm's own Claude's
    assert {b["claude"] for b in visitor(base + "/api/boards")[1]} == {"test", gil["id"]}
    code, r, _ = visitor(base + "/api/boards/test", {"ops": [{"op": "put", "el": {"type": "note", "x": 0, "y": 0, "text": "hi"}}]})
    assert code == 200 and r["items"][0]["by"] == "visitor"
    code, r, _ = owner(base + f"/api/boards/test", {"ops": [{"op": "put", "el": {"type": "arrow", "x1": 0, "y1": 0, "x2": 5, "y2": 5}}]})
    assert r["items"][0]["by"] == f"person:{gil['id']}"
    seen = visitor(base + "/api/boards/test?since=0")[1]
    assert seen["full"] and [e["type"] for e in seen["items"]] == ["note", "arrow"]
    assert visitor(base + "/api/boards/test?since=2")[1]["items"]          # just written: the last ones again
    assert owner(base + "/api/boards/test", {"ops": [{"op": "put", "el": {"type": "pie"}}]})[0] == 400
    assert owner(base + "/api/boards/nobody")[0] == 404
    assert owner(base + "/api/boards/nobody", {"ops": []})[0] == 404
    assert visitor(base + "/api/boards/test", {"clear": True})[1]["items"] == []
    assert visitor(base + "/api/boards/test?since=0")[1]["items"] == []
    page = __import__("urllib.request").request.urlopen(base + f"/whiteboard/{gil['id']}").read().decode()
    assert "whiteboard.js" in page
    # a private farm: only its people
    login(owner, base)
    assert owner(base + "/api/manager/settings", {"private": True})[0] == 200
    assert visitor(base + "/api/boards")[0] == 401
    assert visitor(base + "/api/boards/test", {"ops": [{"op": "del", "id": "x"}]})[0] == 401


def test_the_cli_draws_reads_and_moves(store, capsys, monkeypatch):
    assert cli(["board", "text", "Hello\\nfarm", "--at", "40,40", "--id", "hello"]) == 0
    assert cli(["board", "note", "An idea", "--at", "40,120"]) == 0
    assert cli(["board", "arrow", "--at", "0,0", "--to", "100,50", "--color", "#d97757"]) == 0
    assert cli(["board", "rect", "--at", "0,0", "--wh", "200x80", "--fill", "#d8eef8", "--board", "gil"]) == 0
    capsys.readouterr()
    assert cli(["board", "show", "--json"]) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["board"] == "test" and out["url"].endswith("/whiteboard/test")
    els = {e["type"]: e for e in out["elements"]}
    assert els["text"]["text"] == "Hello\nfarm" and els["text"]["by"] == "claude:test" and els["arrow"]["color"] == "#d97757"
    assert cli(["board", "move", "hello", "--by", "10,-5"]) == 0
    assert boards.elements(store, "test")[0]["x"] == 50 and boards.elements(store, "test")[0]["y"] == 35
    assert cli(["board"]) == 0 and '"Hello\\nfarm"' in capsys.readouterr().out   # what's on it, one per line
    assert cli(["board", "list"]) == 0 and "gil" in capsys.readouterr().out
    assert boards.elements(store, "gil")[0]["fill"] == "#d8eef8"
    assert cli(["board", "remove", "hello"]) == 0 and len(boards.elements(store, "test")) == 2
    assert cli(["board", "text", "x", "--at", "nope"]) == 2
    spec = [{"type": "rect", "x": 0, "y": 0, "w": 10, "h": 10}, {"type": "text", "x": 0, "y": 20, "text": "box"}]
    monkeypatch.setattr("sys.stdin", __import__("io").StringIO(json.dumps({"elements": spec})))
    assert cli(["board", "draw"]) == 0 and len(boards.elements(store, "test")) == 4
    assert cli(["board", "clear"]) == 0 and boards.elements(store, "test") == []


ARCH = """flowchart LR
  %% a comment
  user((Customer)) -->|HTTPS| cdn{{CloudFront}}
  cdn --> alb[Load balancer]
  subgraph aws [AWS us-east-1]
    subgraph vpc [VPC]
      alb --> api1[API 1] & api2["API 2<br>(canary)"]
      api1 & api2 --> db[(Postgres)]
      db -.->|replication| replica[(Replica)]
    end
    q[[SQS]]
  end
  api1 -.-> q ==> worker[/Worker/]
  worker --> db
  stripe>Stripe] <-->|webhooks| api2
  classDef ext fill:#fde3cf,stroke:#e8833a
  class stripe,user ext
  style db fill:#d8eef8
"""


def test_mermaid_flowcharts_parse():
    from clodfarm import diagram
    spec = diagram.from_mermaid(ARCH)
    nodes = {n["id"]: n for n in spec["nodes"]}
    assert spec["direction"] == "LR"
    assert nodes["alb"]["group"] == "vpc", "a node used in a subgraph belongs to it, wherever it was first named"
    assert nodes["q"]["group"] == "aws" and nodes["user"].get("group") is None
    assert nodes["db"]["shape"] == "cylinder" and nodes["db"]["fill"] == "#d8eef8"
    assert nodes["api2"]["text"] == "API 2\n(canary)" and nodes["cdn"]["shape"] == "hexagon"
    assert nodes["worker"]["shape"] == "parallelogram" and nodes["user"]["shape"] == "circle"
    assert nodes["stripe"]["fill"] == "#fde3cf" and nodes["stripe"]["color"] == "#e8833a"
    groups = {g["id"]: g for g in spec["groups"]}
    assert groups["vpc"]["parent"] == "aws" and groups["aws"]["text"] == "AWS us-east-1"
    edges = {(e["from"], e["to"]): e for e in spec["edges"]}
    assert edges[("user", "cdn")]["text"] == "HTTPS" and edges[("db", "replica")]["dash"] == "dashed"
    assert ("api1", "db") in edges and ("api2", "db") in edges and ("alb", "api2") in edges    # a & b fan out
    assert edges[("q", "worker")]["width"] == 4 and edges[("stripe", "api2")]["head"] == "both"
    assert diagram.from_mermaid("graph TD\n a -- yes --> b\n b --- c")["edges"][0]["text"] == "yes"
    for bad, msg in [("sequenceDiagram\n a->>b: hi", "only flowcharts"), ("flowchart LR\n a[open", "unclosed"),
                     ("flowchart LR\n a --> ", "can't read a node")]:
        with pytest.raises(diagram.DiagramError, match=msg):
            diagram.from_mermaid(bad)


def _overlap(a, b):
    return a["x"] < b["x"] + b["w"] and b["x"] < a["x"] + a["w"] and a["y"] < b["y"] + b["h"] and b["y"] < a["y"] + a["h"]


def test_the_layout_never_overlaps_and_groups_hold_their_nodes():
    from clodfarm import diagram
    els = diagram.build(ARCH, "arch", (100, 50))
    boxes = {e["id"]: e for e in els if e["type"] not in boards.LINES}
    frames = {k: v for k, v in boxes.items() if v["type"] == "frame"}
    nodes = {k: v for k, v in boxes.items() if v["type"] != "frame"}
    assert all(e.get("diagram") == "arch" and e["id"].startswith("arch-") for e in els)
    assert min(b["x"] for b in boxes.values()) == 100 and min(b["y"] for b in boxes.values()) == 50
    ids = list(nodes)
    for i, a in enumerate(ids):
        for b in ids[i + 1:]:
            assert not _overlap(nodes[a], nodes[b]), (a, b)
    def within(inner, outer):
        return inner["x"] >= outer["x"] and inner["y"] >= outer["y"] and \
            inner["x"] + inner["w"] <= outer["x"] + outer["w"] and inner["y"] + inner["h"] <= outer["y"] + outer["h"]
    assert within(frames["arch-vpc"], frames["arch-aws"])
    for n in ("alb", "api1", "api2", "db", "replica"):
        assert within(nodes[f"arch-{n}"], frames["arch-vpc"]), n
    assert within(nodes["arch-q"], frames["arch-aws"]) and not _overlap(nodes["arch-q"], frames["arch-vpc"])
    for n in ("user", "stripe", "cdn", "worker"):
        assert not _overlap(nodes[f"arch-{n}"], frames["arch-aws"]), n
    arrows = [e for e in els if e["type"] in boards.LINES]
    assert len(arrows) == 11 and all(a["from"] in boxes and a["to"] in boxes for a in arrows)
    assert any(a.get("via") for a in arrows), "long edges run through way points"
    # left to right: what an arrow leaves comes before what it reaches (except an edge that closes a cycle)
    lr = sum(nodes[a["from"]]["x"] < nodes[a["to"]]["x"] for a in arrows if a["from"] in nodes and a["to"] in nodes)
    assert lr >= len(arrows) - 2
    tb = diagram.build({"direction": "TB", "title": "Steps", "nodes": [{"id": "a"}, {"id": "b", "shape": "diamond"}],
                        "edges": [{"from": "a", "to": "b"}, {"from": "b", "to": "c", "text": "no"}]}, "steps")
    by = {e["id"]: e for e in tb}
    assert by["steps--title"]["text"] == "Steps" and by["steps-c"]["text"] == "c"       # an edge makes its nodes
    assert by["steps-a"]["y"] < by["steps-b"]["y"] < by["steps-c"]["y"]
    for bad, msg in [({"nodes": []}, "at least one node"), ({"nodes": [{"id": "a", "group": "g"}]}, "no group g"),
                     ({"nodes": [{"id": "a", "shape": "blob"}]}, "shape is one of"),
                     ({"groups": [{"id": "x", "parent": "y"}, {"id": "y", "parent": "x"}], "nodes": [{"id": "a"}]}, "inside each other")]:
        with pytest.raises(diagram.DiagramError, match=msg):
            diagram.build(bad)


def test_a_big_diagram_lays_out_quickly():
    from clodfarm import diagram
    lines = ["flowchart LR"] + [f"  s{i // 20} --> n{i}[Service {i}] --> d{i % 7}[(DB {i % 7})]" for i in range(300)]
    t = time.time()
    els = diagram.build("\n".join(lines), "big")
    assert time.time() - t < 10 and len([e for e in els if e["type"] == "arrow"]) == 600


def test_the_cli_draws_diagrams_shapes_and_images(store, capsys, tmp_path):
    mmd = tmp_path / "a.mmd"
    mmd.write_text("flowchart LR\n  web[Web] --> api[API] --> db[(DB)]\n")
    assert cli(["board", "text", "Above", "--at", "0,0"]) == 0
    assert cli(["board", "diagram", "--file", str(mmd), "--name", "sys"]) == 0
    els = {e["id"]: e for e in boards.elements(store, "test")}
    assert els["sys-web"]["y"] >= 120 and els["sys-db"]["type"] == "cylinder"     # below what was there
    assert sum(e["type"] == "arrow" for e in els.values()) == 2
    boards.apply(store, "test", [{"op": "put", "el": {**{k: v for k, v in els["sys-api"].items() if k not in
                                                         ("z", "by", "rev", "at", "id")}, "x": 999}, "z": 1}], "x")
    old_x = els["sys-web"]["x"]
    mmd.write_text("flowchart LR\n  web[Web] --> api[API]\n")
    capsys.readouterr()
    assert cli(["board", "diagram", "--file", str(mmd), "--name", "sys"]) == 0
    assert "replaced" in capsys.readouterr().out
    els = {e["id"]: e for e in boards.elements(store, "test")}
    assert "sys-db" not in els and els["sys-web"]["x"] == old_x, "drawn again: in place, and what's gone is removed"
    assert cli(["board", "shape", "hexagon", "Gateway", "--at", "0,600", "--wh", "160x80", "--fill", "purple", "--id", "gw"]) == 0
    assert cli(["board", "connect", "gw", "sys-web", "--label", "routes", "--route", "curve"]) == 0
    assert cli(["board", "connect", "gw", "nope"]) == 2
    els = {e["id"]: e for e in boards.elements(store, "test")}
    link = next(e for e in els.values() if e.get("from") == "gw")
    assert els["gw"]["fill"] == boards.TINTS["purple"] and link["to"] == "sys-web" and link["text"] == "routes"
    png = tmp_path / "dot.png"
    import base64
    png.write_bytes(base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAEklEQVR4nGP8z8Dwn4EBIwMDAAc0AQSVtKrHAAAAAElFTkSuQmCC"))
    assert cli(["board", "image", str(png), "--at", "10,10"]) == 0
    img = next(e for e in boards.elements(store, "test") if e["type"] == "image")
    assert (img["w"], img["h"]) == (2, 3) and img["src"].startswith("data:image/png;base64,")
    assert cli(["board", "path", "0,0 50,0 25,40", "--closed", "--fill", "red"]) == 0
    assert cli(["board", "remove", "gw"]) == 0                                     # its arrow goes with it
    assert not any(e.get("from") == "gw" for e in boards.elements(store, "test"))
    capsys.readouterr()
    assert cli(["board", "show"]) == 0
    out = capsys.readouterr().out
    assert "joins sys-web -> sys-api" in out and "[diagram sys]" in out and "image" in out
