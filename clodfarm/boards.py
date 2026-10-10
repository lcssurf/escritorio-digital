"""Whiteboards: every Claude has one, at FARM_UI_BASE/whiteboard. Its person draws and writes on it in the farm UI, the
Claude draws on it with `clodfarm board ...`, and both see the other's changes within a second.

There are no walls between boards: everyone who can open the farm sees every Claude's board and draws on it, and
every Claude can draw on any of them (`clodfarm board --board <claude> ...`).

A board is a set of elements the farm UI draws on a canvas (no agent-written HTML or SVG runs in your browser). Every
element has a type and an id; the rest depends on the type:

    boxes     rect ellipse diamond cylinder hexagon parallelogram cloud triangle star document frame note image
              {"x", "y", "w", "h"}, a label in "text" (wrapped and centered; a note's and a frame's sit top left),
              "fill", "color" (the outline), "width", "dash", "radius" (a rect's corners), "src" (an image's data: URL)
    text      {"x", "y", "text"}: (x, y) is its top left
    lines     line arrow {"x1", "y1", "x2", "y2"}, or "from"/"to": the ids of the boxes it joins (it follows them),
              "head" (end, start, both, none), "route" (straight, elbow, curve), a label in "text"
    path      {"points": [[x, y], ...]}, "closed", "smooth", "fill": freehand, polygons, art
    any       "color", "opacity", "dash" (solid, dashed, dotted), "size" (the font), "font" (hand, the default;
              sans, mono, serif), "bold", "align" (left, center, right), "text_color", "roughness" (0 to 3: how
              hand-drawn), "fill_style" (hachure, cross-hatch, solid, zigzag, dots), "seed" (its wobble); colors
              are #rrggbb or a name (blue, green, ...)

Coordinates are board pixels: x grows right, y grows down, (0, 0) is the top left of the first view. diagram.py lays
out whole diagrams (Mermaid flowcharts, or nodes and edges) as these elements.

Every change takes the next number of the board's revision, so a page asks only for what changed since it last
looked. Items (PK / SK):

    BOARD           / <claude>    the board: rev, how many elements, who changed it last and when
    BOARDI#<claude> / <id>        one element (or, for an hour, the tombstone of a removed one)
"""

from __future__ import annotations

import json
import math
import re
import secrets
import time

from .store import Store, now

BOXES = ("rect", "ellipse", "diamond", "cylinder", "hexagon", "parallelogram", "cloud", "triangle", "star", "document",
         "frame", "note", "image")
LINES = ("line", "arrow")
TYPES = ("path", *LINES, "text", *BOXES)
ID = re.compile(r"[A-Za-z0-9_-]{1,64}")
COLOR = re.compile(r"#[0-9a-fA-F]{6}")
INK, NOTE_FILL = "#1e1e1e", "#ffec99"
# names a Claude (or Mermaid) may use for a color: Excalidraw's palette (open-color), and its light shade for fills
NAMED = {"ink": INK, "black": INK, "white": "#ffffff", "gray": "#868e96", "grey": "#868e96",
         "red": "#e03131", "pink": "#c2255c", "grape": "#9c36b5", "purple": "#6741d9", "violet": "#6741d9",
         "blue": "#1971c2", "navy": "#1864ab", "sky": "#1c7ed6", "cyan": "#0c8599", "teal": "#099268",
         "green": "#2f9e44", "yellow": "#f08c00", "gold": "#f08c00", "orange": "#e8590c", "clay": "#e8590c",
         "brown": "#846358"}
TINTS = {"ink": "#e9ecef", "black": "#e9ecef", "white": "#ffffff", "gray": "#e9ecef", "grey": "#e9ecef",
         "red": "#ffc9c9", "pink": "#fcc2d7", "grape": "#eebefa", "purple": "#d0bfff", "violet": "#d0bfff",
         "blue": "#a5d8ff", "navy": "#a5d8ff", "sky": "#a5d8ff", "cyan": "#99e9f2", "teal": "#96f2d7",
         "green": "#b2f2bb", "yellow": "#ffec99", "gold": "#ffec99", "orange": "#ffd8a8", "clay": "#ffd8a8",
         "brown": "#eaddd7"}
DASHES = ("solid", "dashed", "dotted")
HEADS = ("end", "start", "both", "none")
ROUTES = ("straight", "elbow", "curve")
FONTS = ("hand", "sans", "mono", "serif")
FILLS = ("hachure", "cross-hatch", "solid", "zigzag", "dots")
IMAGE = re.compile(r"data:image/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+")
MAX_ITEMS = 5000
MAX_POINTS = 4000
MAX_TEXT = 4000
MAX_IMAGE = 300 * 1024  # a data: URL's characters (the store keeps an item under 400 KB)
MAX_COORD = 1_000_000
MAX_OPS = 1000
OVERLAP = 64  # a page asks again for the last revisions: a writer may commit after a later one did
SETTLE = 5.0  # seconds after which every revision handed out has been written
TOMB_TTL = 3600


class BoardError(ValueError):
    pass


# --------------------------------------------------------------- an element
def _num(v, what: str, lo: float = -MAX_COORD, hi: float = MAX_COORD) -> float:
    if isinstance(v, bool) or v is None:
        raise BoardError(f"{what}: a number is required")
    try:
        f = float(v)
    except (TypeError, ValueError):
        raise BoardError(f"{what}: {v!r} is not a number") from None
    if not math.isfinite(f) or abs(f) > MAX_COORD:
        raise BoardError(f"{what}: {v!r} is out of range")
    f = float(round(max(lo, min(hi, f)), 1))  # a bound can be an int (int.is_integer is 3.12+)
    return int(f) if f.is_integer() else f


def color(v, default: str | None = None, tint: bool = False) -> str | None:
    """#rrggbb, #rgb or a color's name (a fill gets the name's light tint); 'none' is no color."""
    if v in (None, ""):
        return default
    if not isinstance(v, str):
        raise BoardError(f"color {v!r}: use #rrggbb or a name like blue")
    s = v.strip().lower()
    if s in ("none", "transparent"):
        return None
    if s in NAMED:
        return (TINTS if tint else NAMED)[s]
    if re.fullmatch(r"#[0-9a-f]{3}", s):
        s = "#" + "".join(c * 2 for c in s[1:])
    if not COLOR.fullmatch(s):
        raise BoardError(f"color {v!r}: use #rrggbb or a name ({', '.join(sorted(NAMED))})")
    return s


def _text(v) -> str:
    return str(v if v is not None else "").replace("\r\n", "\n").replace("<br>", "\n").replace("<br/>", "\n")[:MAX_TEXT]


def _pick(el: dict, k: str, allowed: tuple, what: str):
    v = el.get(k)
    if v in (None, ""):
        return None
    if v not in allowed:
        raise BoardError(f"{what} {v!r}: one of {', '.join(allowed)}")
    return v


def normalize(el) -> dict:
    """Check one element and return the clean version (raises BoardError with a message an agent can act on)."""
    if not isinstance(el, dict):
        raise BoardError("an element is a JSON object with a type")
    t = el.get("type")
    if t not in TYPES:
        raise BoardError(f"type must be one of {', '.join(TYPES)} (got {t!r})")
    if "label" in el and "text" not in el:
        el = {**el, "text": el["label"]}
    out: dict = {"type": t}
    for k in ("id", "from", "to", "diagram"):
        if el.get(k) not in (None, ""):
            if not ID.fullmatch(str(el[k])):
                raise BoardError(f"{k} {el[k]!r}: letters, digits, _ and - (at most 64)")
            out[k] = str(el[k])
    if t in ("text", "note"):
        out["color"] = color(el.get("color"), INK) or INK
    else:
        out["color"] = color(el.get("color"), INK) or INK
        out["width"] = _num(el.get("width") if el.get("width") is not None else 2, f"{t} width", 0, 60)
    if t == "path":
        pts = el.get("points")
        if isinstance(pts, str):  # "x,y x,y ...", the way a shell writes it
            pts = [p.split(",") for p in pts.split()]
        if not isinstance(pts, list) or not pts:
            raise BoardError("a path needs points: [[x, y], ...]")
        if len(pts) > MAX_POINTS:
            raise BoardError(f"a path has at most {MAX_POINTS} points")
        out["points"] = []
        for p in pts:
            if not isinstance(p, (list, tuple)) or len(p) != 2:
                raise BoardError(f"a point is [x, y], got {p!r}")
            out["points"].append([_num(p[0], "x"), _num(p[1], "y")])
        for k in ("closed", "smooth"):
            if el.get(k) is not None:
                out[k] = bool(el[k])
        if el.get("fill"):
            out["fill"] = color(el["fill"], None, tint=False)
    elif t in LINES:
        bound = bool(out.get("from") and out.get("to"))
        for k in ("x1", "y1", "x2", "y2"):
            out[k] = _num(el.get(k, 0 if bound else None), f"{t} {k} (or give from and to: the ids it joins)")
        out["head"] = _pick(el, "head", HEADS, "head") or ("end" if t == "arrow" else "none")
        if el.get("via"):  # way points it runs through (a laid-out diagram's long edges)
            if not isinstance(el["via"], list) or len(el["via"]) > 50:
                raise BoardError("via is a list of at most 50 [x, y] points")
            out["via"] = [[_num(p[0], "via x"), _num(p[1], "via y")] for p in el["via"]
                          if isinstance(p, (list, tuple)) and len(p) == 2]
        out["route"] = _pick(el, "route", ROUTES, "route") or "straight"
    elif t in BOXES:
        for k in ("x", "y"):
            out[k] = _num(el.get(k), f"{t} {k}")
        dw, dh = {"note": (200, 140), "frame": (480, 320)}.get(t, (None, None))
        w = _num(el.get("w", dw), f"{t} w")
        h = _num(el.get("h", dh), f"{t} h")
        if w < 0:  # dragged right to left: the same box
            out["x"], w = out["x"] + w, -w
        if h < 0:
            out["y"], h = out["y"] + h, -h
        out["w"], out["h"] = w, h
        if t == "note":
            out["fill"] = color(el.get("fill"), NOTE_FILL, tint=True) or NOTE_FILL
        else:
            f = color(el.get("fill"), None, tint=True)
            if f:
                out["fill"] = f
        if t == "rect" and el.get("radius") is not None:
            out["radius"] = _num(el["radius"], "radius", 0, 500)
        if t == "image":
            src = str(el.get("src") or "")
            if not IMAGE.fullmatch(src):
                raise BoardError("an image needs src: a data:image/(png|jpeg|gif|webp);base64,... URL")
            if len(src) > MAX_IMAGE:
                raise BoardError(f"the image is too big ({len(src) // 1024} KB as text, at most {MAX_IMAGE // 1024} KB):"
                                 " shrink it or save it as JPEG")
            out["src"] = src
    elif t == "text":
        out["x"], out["y"] = _num(el.get("x"), "text x"), _num(el.get("y"), "text y")
    if t != "path" and t != "image" and (el.get("text") not in (None, "") or t in ("text", "note")):
        out["text"] = _text(el.get("text"))
        if t == "text" and not out["text"].strip():
            raise BoardError("a text needs some text")
    if "text" in out or t in ("text", "note"):
        out["size"] = _num(el.get("size") or {"text": 24, "note": 20, "frame": 18}.get(t, 18), f"{t} size", 6, 300)
        for k, allowed in (("font", FONTS), ("align", ("left", "center", "right"))):
            v = _pick(el, k, allowed, k)
            if v:
                out[k] = v
        if el.get("bold"):
            out["bold"] = True
        if el.get("text_color"):
            out["text_color"] = color(el["text_color"], INK)
    d = _pick(el, "dash", DASHES, "dash")
    if d and d != "solid":
        out["dash"] = d
    if el.get("opacity") is not None:
        out["opacity"] = _num(el["opacity"], "opacity", 0.05, 1)
    if el.get("roughness") is not None:  # how hand-drawn: 0 architect, 1 artist (the default), 2 cartoonist
        out["roughness"] = _num(el["roughness"], "roughness", 0, 3)
    f = _pick(el, "fill_style", FILLS, "fill_style")
    if f:
        out["fill_style"] = f
    if el.get("seed") is not None:  # its wobble: the same seed draws the same lines
        out["seed"] = int(_num(el["seed"], "seed", 1, 2 ** 31 - 1))
    return out


def bbox(el: dict) -> tuple[float, float, float, float]:
    """Roughly where it is (x, y, w, h); text is measured by its characters."""
    t = el["type"]
    if t == "path":
        xs, ys = [p[0] for p in el["points"]], [p[1] for p in el["points"]]
        return min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)
    if t in LINES:
        return min(el["x1"], el["x2"]), min(el["y1"], el["y2"]), abs(el["x2"] - el["x1"]), abs(el["y2"] - el["y1"])
    if t == "text":
        lines = el["text"].split("\n")
        return el["x"], el["y"], max(len(x) for x in lines) * el["size"] * 0.55, len(lines) * el["size"] * 1.25
    return el["x"], el["y"], el["w"], el["h"]


def bounds(els: list[dict]) -> tuple[float, float, float, float] | None:
    """The box around them all, or None for none."""
    bs = [bbox(e) for e in els if not (e["type"] in LINES and e.get("from"))]
    if not bs:
        return None
    x0, y0 = min(b[0] for b in bs), min(b[1] for b in bs)
    return x0, y0, max(b[0] + b[2] for b in bs) - x0, max(b[1] + b[3] for b in bs) - y0


# ---------------------------------------------------------------- the store
def meta(store: Store, claude: str) -> dict:
    return store.b.get("BOARD", claude) or {}


def all_(store: Store) -> list[dict]:
    return store.b.query("BOARD")


def _view(it: dict) -> dict:
    return {**it["el"], "id": it["SK"], "z": it.get("z", 0), "by": it.get("by"), "rev": it.get("rev", 0),
            "at": it.get("at")}


def elements(store: Store, claude: str) -> list[dict]:
    """Every element on the board, bottom first."""
    rows = [r for r in store.b.query(f"BOARDI#{claude}") if not r.get("deleted")]
    return sorted((_view(r) for r in rows), key=lambda e: (e["z"], e["id"]))


def changes(store: Store, claude: str, since: int = 0) -> dict:
    """What changed on the board after revision ``since``: everything (``full``) for a page that just opened, missed a
    clear or was away too long; else the elements written (and removed) since, a few revisions back to be safe."""
    m = meta(store, claude)
    rev = int(m.get("rev", 0))
    head = {"claude": claude, "rev": rev, "count": int(m.get("count", 0)), "updated": m.get("updated"),
            "updated_by": m.get("updated_by")}
    if since <= 0 or since > rev or since <= int(m.get("cleared", 0)) or since < int(m.get("pruned", 0)):
        return {**head, "full": True, "items": elements(store, claude)}
    if since == rev and now() - float(m.get("updated") or 0) > SETTLE:
        return {**head, "full": False, "items": []}
    out = []
    for r in store.b.query(f"BOARDI#{claude}"):
        if int(r.get("rev", 0)) > since - OVERLAP:
            out.append({"id": r["SK"], "deleted": True, "rev": r.get("rev", 0)} if r.get("deleted") else _view(r))
    return {**head, "full": False, "items": out}


def _new_id() -> str:
    return f"{int(time.time() * 1000):x}{secrets.token_hex(3)}"


def apply(store: Store, claude: str, ops: list, by: str) -> dict:
    """Apply a list of changes, each ``{"op": "put", "el": {...}}`` (add, or replace the element with that id; with
    ``"z"``, its place in the stack) or ``{"op": "del", "id": ...}``. Every op is checked before any is written. Returns
    the board's new revision and the elements as written."""
    if not isinstance(ops, list) or not ops:
        raise BoardError("nothing to do: give a list of ops")
    if len(ops) > MAX_OPS:
        raise BoardError(f"at most {MAX_OPS} changes at a time")
    plan = []
    for o in ops:
        if not isinstance(o, dict) or o.get("op") not in ("put", "del"):
            raise BoardError('an op is {"op": "put", "el": {...}} or {"op": "del", "id": "..."}')
        if o["op"] == "put":
            el = normalize(o.get("el"))
            z = o.get("z")
            if z is not None and (isinstance(z, bool) or not isinstance(z, (int, float)) or not math.isfinite(z)):
                raise BoardError("z (its place in the stack) is a number")
            z = None if z is None else max(-1e15, min(1e15, float(z)))
            plan.append(("put", el.pop("id", None) or _new_id(), (el, z)))
        else:
            if not ID.fullmatch(str(o.get("id") or "")):
                raise BoardError("del needs the element's id")
            plan.append(("del", str(o["id"]), None))
    pk = f"BOARDI#{claude}"
    cur = {i: store.b.get(pk, i) for _, i, _ in plan}
    live = {i for i, r in cur.items() if r and not r.get("deleted")}
    adds = len({i for op, i, _ in plan if op == "put"} - live)
    dels = len({i for op, i, _ in plan if op == "del"} & live)
    m = meta(store, claude)
    if adds and int(m.get("count", 0)) + adds - dels > MAX_ITEMS:
        raise BoardError(f"the board is full ({MAX_ITEMS} things): remove some, or clear it")
    t = now()

    def bump(x):
        x.update(rev=int(x.get("rev", 0)) + len(plan), count=max(0, int(x.get("count", 0)) + adds - dels), updated=t,
                 updated_by=by, tombs=int(x.get("tombs", 0)) + dels)
        x.setdefault("created", t)
        return x
    m = store._update("BOARD", claude, bump, create=True)
    rev, out = int(m["rev"]) - len(plan), []
    for op, i, put in plan:
        rev += 1
        if op == "put":
            el, z = put
            old = cur.get(i) or {}
            if z is None:
                z = old.get("z") if old and not old.get("deleted") else t + rev / 1e6
            store.b.put({"PK": pk, "SK": i, "el": el, "rev": rev, "z": z, "by": by, "at": t,
                         "created_by": old.get("created_by") if old and not old.get("deleted") else by})
            out.append({**el, "id": i, "z": z, "by": by, "rev": rev, "at": t})
        elif i in live:
            store.b.put({"PK": pk, "SK": i, "deleted": True, "rev": rev, "at": t, "by": by})
            out.append({"id": i, "deleted": True, "rev": rev})
    if int(m.get("tombs", 0)) > 300:
        _prune(store, claude)
    return {"claude": claude, "rev": int(m["rev"]), "items": out}


def _prune(store: Store, claude: str):
    """Forget tombstones older than an hour; a page that last looked before them gets the whole board."""
    pk, gone, left = f"BOARDI#{claude}", 0, 0
    for r in store.b.query(pk):
        if not r.get("deleted"):
            continue
        if float(r.get("at", 0)) < now() - TOMB_TTL:
            store.b.delete(pk, r["SK"])
            gone = max(gone, int(r.get("rev", 0)))
        else:
            left += 1
    store._update("BOARD", claude, lambda x: {**x, "tombs": left, "pruned": max(int(x.get("pruned", 0)), gone)})


def clear(store: Store, claude: str, by: str) -> dict:
    """Wipe the board."""
    for r in store.b.query(f"BOARDI#{claude}"):
        store.b.delete(r["PK"], r["SK"])
    t = now()
    m = store._update("BOARD", claude, lambda x: {**x, "rev": int(x.get("rev", 0)) + 1, "cleared": int(x.get("rev", 0)) + 1,
                                                  "count": 0, "tombs": 0, "updated": t, "updated_by": by}, create=True)
    return {"claude": claude, "rev": int(m["rev"]), "items": []}


# ---------------------------------------------------------- for a Claude
def describe(e: dict) -> str:
    """One line a Claude reads: what it is, where, its label and what it joins."""
    t, who = e["type"], (e.get("by") or "").replace("person:", "person of ").replace("claude:", "")
    if t in LINES and e.get("from") and e.get("to"):
        where = f"joins {e['from']} -> {e['to']} ({e.get('route', 'straight')})"
    elif t in LINES:
        where = f"from ({e['x1']:g},{e['y1']:g}) to ({e['x2']:g},{e['y2']:g})"
    else:
        x, y, w, h = bbox(e)
        where = f"at ({x:g},{y:g})" + (f" size {w:g}x{h:g}" if t != "text" else "")
    style = e.get("color", "") + (f" fill {e['fill']}" if e.get("fill") else "") + (f" {e['dash']}" if e.get("dash") else "")
    text = f" {json.dumps(e['text'][:400], ensure_ascii=False)}" if e.get("text") else ""
    pts = f" {len(e['points'])} points" + (" closed" if e.get("closed") else "") if t == "path" else ""
    grp = f" [diagram {e['diagram']}]" if e.get("diagram") else ""
    return f"{e['id']:<18} {t:<13} {where}{pts} {style}{text}{grp}  by {who or '?'}"
