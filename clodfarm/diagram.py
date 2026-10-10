"""Whole diagrams on a whiteboard: a Claude says what is connected to what, and the farm lays it out and draws it.

Either a Mermaid flowchart (Claudes write those well):

    flowchart LR
      subgraph aws [AWS us-east-1]
        subgraph vpc [VPC]
          api[API service] --> db[(Postgres)]
          api --> cache[(Redis)]
        end
        q[[SQS]]
      end
      user((User)) -->|HTTPS| cdn{{CloudFront}} --> api
      api -.->|jobs| q
      style db fill:#d8eef8

or the same as JSON:

    {"direction": "LR", "title": "Checkout",
     "groups": [{"id": "vpc", "text": "VPC", "parent": "aws"}, {"id": "aws", "text": "AWS"}],
     "nodes": [{"id": "api", "text": "API service", "group": "vpc", "shape": "rect", "fill": "blue"}, ...],
     "edges": [{"from": "user", "to": "api", "text": "HTTPS", "dash": "dashed", "head": "both"}, ...]}

The layout is layered (Sugiyama): each group is laid out on its own and then placed as one block in its parent, so
groups never overlap; cycles are broken, long edges get way points so the order has fewer crossings, and each layer
is placed as close to its neighbours as the spacing allows. The result is ordinary board elements: boxes, frames for
the groups, and arrows bound to the boxes they join, every one tagged with the diagram's name so drawing it again
replaces it. Standard library only.
"""

from __future__ import annotations

import hashlib
import json
import re

from . import boards

SHAPES = ("rect", "rounded", "ellipse", "circle", "diamond", "cylinder", "hexagon", "parallelogram", "cloud",
          "document", "note", "triangle", "star", "text")
GAP_IN, GAP_RANK, PAD, TITLE = 50, 90, 30, 6  # a frame's name sits just above it, in its parent's padding
FRAME_TINTS = ("#f8f9fa", "#f3f0ff", "#ebfbee", "#fff9db")
FRAME_LINES = ("#868e96", "#7950f2", "#40c057", "#fab005")
# a friendly default color for each kind of box (Excalidraw's light shades), so a diagram reads at a glance
SHAPE_FILL = {"cylinder": "#a5d8ff", "diamond": "#ffec99", "circle": "#ffd8a8", "ellipse": "#ffd8a8",
              "hexagon": "#d0bfff", "cloud": "#99e9f2", "parallelogram": "#b2f2bb", "document": "#eebefa",
              "rounded": "#b2f2bb", "triangle": "#ffc9c9", "star": "#ffec99"}


class DiagramError(ValueError):
    pass


# ------------------------------------------------------------------ Mermaid
_SHAPE_OPEN = [("(((", ")))", "circle"), ("([", "])", "rounded"), ("[[", "]]", "rect"), ("[(", ")]", "cylinder"),
               ("((", "))", "circle"), ("{{", "}}", "hexagon"), ("[/", "/]", "parallelogram"),
               ("[\\", "\\]", "parallelogram"), ("[/", "\\]", "parallelogram"), ("[\\", "/]", "parallelogram"),
               (">", "]", "rect"), ("[", "]", "rect"), ("(", ")", "rounded"), ("{", "}", "diamond")]
_ID = r"[A-Za-z0-9_][A-Za-z0-9_.\-]*"
_LINK = re.compile(r"""\s*(
      (?P<l1><)?(?P<b1>-{2,}|={2,}|-\.+-?)(?P<h1>[>ox])?\s*\|(?P<t1>[^|]*)\|     # -->|label|
    | (?P<l2><)?(?P<s2>--|==|-\.)\s+(?P<t2>[^-=.>|][^>]*?)\s*(?P<e2>-{2,}|={2,}|\.+-)(?P<h2>[>ox])?   # -- label -->
    | (?P<l3><)?(?P<b3>-{2,}|={2,}|-\.+-?)(?P<h3>[>ox])?                      # --> --- -.-> ==> <-->
    | (?P<b4>~~~)
    )\s*""", re.X)


def _unquote(s: str) -> str:
    s = s.strip()
    if len(s) >= 2 and s[0] == s[-1] == '"':
        s = s[1:-1]
    s = re.sub(r"fa:fa-[a-z-]+\s*", "", s)
    return s.replace("<br>", "\n").replace("<br/>", "\n").replace("<br />", "\n").replace("\\n", "\n").strip()


def _node_at(s: str, i: int):
    """A node at s[i:]: (id, text or None, shape or None, classes, next index), or None."""
    m = re.compile(_ID).match(s, i)
    if not m:
        return None
    nid, j = m.group(0), m.end()
    while nid.endswith(("-", ".")) and nid:  # `a--b`: the id stops before the link
        nid, j = nid[:-1], j - 1
    if not nid:
        return None
    text = shape = None
    for op, cl, sh in _SHAPE_OPEN:
        if s.startswith(op, j):
            k = j + len(op)
            if s.startswith('"', k):
                end = s.find('"', k + 1)
                end = s.find(cl, end + 1 if end >= 0 else k)
            else:
                end = s.find(cl, k)
            if end < 0:
                raise DiagramError(f"unclosed {op} in: {s.strip()[:80]}")
            text, shape, j = _unquote(s[k:end]), sh, end + len(cl)
            break
    classes = []
    while s.startswith(":::", j):
        m2 = re.compile(r":::([A-Za-z0-9_-]+)").match(s, j)
        if not m2:
            break
        classes.append(m2.group(1))
        j = m2.end()
    return nid, text, shape, classes, j


def _style(spec: str) -> dict:
    out = {}
    for part in spec.split(","):
        if ":" not in part:
            continue
        k, v = (x.strip() for x in part.split(":", 1))
        v = v.rstrip(";").strip()
        try:
            if k == "fill":
                out["fill"] = boards.color(v, None)
            elif k == "stroke":
                out["color"] = boards.color(v, None)
            elif k == "color":
                out["text_color"] = boards.color(v, None)
            elif k == "stroke-width":
                out["width"] = float(re.sub(r"[^0-9.]", "", v) or 2)
            elif k == "stroke-dasharray":
                out["dash"] = "dashed"
        except (boards.BoardError, ValueError):
            pass
    return out


def from_mermaid(text: str) -> dict:
    """A Mermaid flowchart (graph / flowchart) as a diagram spec."""
    lines = []
    for raw in text.replace("\r", "").split("\n"):
        raw = raw.split("%%", 1)[0]
        lines += [x for x in (p.strip() for p in raw.split(";")) if x]
    if not lines:
        raise DiagramError("empty diagram")
    head = re.fullmatch(r"(graph|flowchart)(\s+(TB|TD|BT|RL|LR))?", lines[0], re.I)
    if not head:
        raise DiagramError("start a Mermaid diagram with `flowchart LR` (or TD); only flowcharts are drawn")
    d = (head.group(3) or "TD").upper()
    spec = {"direction": "LR" if d in ("LR", "RL") else "TB", "nodes": [], "edges": [], "groups": []}
    nodes: dict[str, dict] = {}
    classdefs: dict[str, dict] = {}
    pending_class: list[tuple[str, str]] = []
    stack: list[str] = []

    gparent: dict[str, str | None] = {}

    def inside(g, outer):  # is group g (in) outer?
        while g:
            if g == outer:
                return True
            g = gparent.get(g)
        return False

    def node(nid, txt, shape, classes):
        n = nodes.get(nid)
        if not n:
            n = nodes[nid] = {"id": nid, "text": nid}
            spec["nodes"].append(n)
        # as in Mermaid, a node used in a subgraph belongs to it: the deepest one it's used in
        if stack and (not n.get("group") or (inside(stack[-1], n["group"]) and stack[-1] != n["group"])):
            n["group"] = stack[-1]
        if txt is not None:
            n["text"] = txt
        if shape:
            n["shape"] = shape
        for c in classes:
            pending_class.append((nid, c))
        return nid

    for ln in lines[1:]:
        low = ln.lower()
        m = re.fullmatch(r"subgraph\s+(.+)", ln, re.I)
        if m:
            rest = m.group(1).strip()
            mm = re.fullmatch(r"(" + _ID + r")\s*\[(.*)\]", rest)
            if mm:
                gid, label = mm.group(1), _unquote(mm.group(2))
            elif rest.startswith('"'):
                label = _unquote(rest)
                gid = "g" + hashlib.sha1(label.encode()).hexdigest()[:6]
            else:
                gid = label = rest
                if not re.fullmatch(_ID, gid):
                    gid = "g" + hashlib.sha1(label.encode()).hexdigest()[:6]
            spec["groups"].append({"id": gid, "text": label, **({"parent": stack[-1]} if stack else {})})
            gparent[gid] = stack[-1] if stack else None
            stack.append(gid)
            continue
        if low == "end":
            if stack:
                stack.pop()
            continue
        if low.startswith("direction "):
            continue
        m = re.fullmatch(r"classDef\s+([A-Za-z0-9_,-]+)\s+(.+)", ln)
        if m:
            for c in m.group(1).split(","):
                classdefs[c] = _style(m.group(2))
            continue
        m = re.fullmatch(r"class\s+([A-Za-z0-9_,.\- ]+?)\s+([A-Za-z0-9_-]+)", ln)
        if m:
            for nid in m.group(1).split(","):
                pending_class.append((nid.strip(), m.group(2)))
            continue
        m = re.fullmatch(r"style\s+(" + _ID + r")\s+(.+)", ln)
        if m:
            target = nodes.get(m.group(1)) or next((g for g in spec["groups"] if g["id"] == m.group(1)), None)
            if target is not None:
                target.update(_style(m.group(2)))
            continue
        if re.match(r"(linkStyle|click|accTitle|accDescr|title)\b", ln):
            continue
        # a chain: nodes (a & b) joined by links
        i, groups_, links = 0, [], []
        while i < len(ln):
            grp = []
            while True:
                while i < len(ln) and ln[i] == " ":
                    i += 1
                got = _node_at(ln, i)
                if not got:
                    raise DiagramError(f"can't read a node at: {ln[i:][:60]!r} (in {ln[:80]!r})")
                nid, txt, shape, classes, i = got
                grp.append(node(nid, txt, shape, classes))
                m = re.compile(r"\s*&\s*").match(ln, i)
                if not m:
                    break
                i = m.end()
            groups_.append(grp)
            if i >= len(ln):
                break
            lm = _LINK.match(ln, i)
            if not lm:
                raise DiagramError(f"can't read a link at: {ln[i:][:60]!r} (in {ln[:80]!r})")
            links.append(lm)
            i = lm.end()
        if len(links) >= len(groups_):
            raise DiagramError(f"can't read a node after the last link in {ln[:80]!r}")
        for k, lm in enumerate(links):
            g = lm.groupdict()
            body = g.get("b1") or g.get("s2") or g.get("b3") or g.get("b4") or ""
            if g.get("e2"):
                body += g["e2"]
            head = g.get("h1") or g.get("h2") or g.get("h3")
            back = g.get("l1") or g.get("l2") or g.get("l3")
            e = {"text": _unquote(g.get("t1") or g.get("t2") or "")}
            if "." in body:
                e["dash"] = "dashed"
            if "=" in body:
                e["width"] = 4
            e["head"] = ("both" if back and head else "end" if head else "start" if back else "none")
            if body == "~~~":
                e["invisible"] = True
            for a in groups_[k]:
                for b in groups_[k + 1]:
                    spec["edges"].append({"from": a, "to": b, **{x: y for x, y in e.items() if y not in ("", None)}})
    for nid, c in pending_class:
        if nid in nodes and c in classdefs:
            nodes[nid].update(classdefs[c])
    return spec


# --------------------------------------------------------------- the spec
def parse(text: str) -> dict:
    """A diagram from what a Claude wrote: JSON (nodes and edges) or a Mermaid flowchart."""
    s = text.strip().removeprefix("```mermaid").removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    if s.startswith("{"):
        try:
            return json.loads(s)
        except ValueError as e:
            raise DiagramError(f"not JSON: {e}") from None
    return from_mermaid(s)


def _sid(x) -> str:
    s = str(x)
    clean = re.sub(r"[^A-Za-z0-9_-]+", "_", s)[:40]
    return clean if clean == s else f"{clean}_{hashlib.sha1(s.encode()).hexdigest()[:5]}"


def _size(n: dict) -> tuple[float, float]:
    """A node's box from its label, and its shape."""
    size = float(n.get("size") or 18)
    lines = []
    for ln in str(n.get("text") or "").split("\n"):  # wrap long lines at about 24 characters
        words, cur = ln.split(" "), ""
        for w in words:
            if cur and len(cur) + 1 + len(w) > 24:
                lines.append(cur)
                cur = w
            else:
                cur = f"{cur} {w}" if cur else w
        lines.append(cur)
    chars = max((len(x) for x in lines), default=4)
    w = max(130.0, min(360.0, chars * size * 0.64 + 52))  # the hand-drawn font is a little wide
    h = max(64.0, len(lines) * size * 1.3 + 36)
    sh = n.get("shape") or "rect"
    if sh == "diamond":
        w, h = w * 1.45, h * 1.6
    elif sh in ("ellipse", "cloud"):
        w, h = w * 1.25, h * 1.35
    elif sh == "circle":
        w = h = max(w * 0.8, h * 1.3)
    elif sh == "cylinder":
        h += 26
    elif sh in ("hexagon", "parallelogram"):
        w += 40
    elif sh in ("triangle", "star"):
        w, h = w * 1.4, h * 1.9
    elif sh == "note":
        w, h = max(w, 180), max(h, 110)
    if n.get("w"):
        w = float(n["w"])
    if n.get("h"):
        h = float(n["h"])
    return round(w), round(h)


def clean(spec) -> dict:
    """Check a diagram spec: every node has an id, edges join known nodes (unknown ones are made), groups nest."""
    if not isinstance(spec, dict):
        raise DiagramError("a diagram is {nodes: [...], edges: [...], groups: [...]}, or a Mermaid flowchart")
    d = str(spec.get("direction") or "LR").upper()
    out = {"direction": "LR" if d in ("LR", "RL") else "TB", "nodes": [], "edges": [], "groups": [],
           "route": spec.get("route") if spec.get("route") in boards.ROUTES else "elbow",
           "fill_style": spec.get("fill_style") if spec.get("fill_style") in boards.FILLS else "hachure"}
    if spec.get("title"):
        out["title"] = str(spec["title"])[:200]
    groups = {}
    for g in spec.get("groups") or []:
        if not isinstance(g, dict) or g.get("id") in (None, ""):
            raise DiagramError("a group needs an id")
        gid = _sid(g["id"])
        groups[gid] = {**g, "id": gid, "text": str(g.get("text", g.get("label", g["id"]))),
                       "parent": _sid(g["parent"]) if g.get("parent") else None}
    nodes = {}
    for n in spec.get("nodes") or []:
        if not isinstance(n, dict) or n.get("id") in (None, ""):
            raise DiagramError("a node needs an id")
        nid = _sid(n["id"])
        if nid in groups:
            raise DiagramError(f"{n['id']} is a node and a group")
        if n.get("shape") and n["shape"] not in SHAPES:
            raise DiagramError(f"node {n['id']}: shape is one of {', '.join(SHAPES)}")
        nodes[nid] = {**n, "id": nid, "text": str(n.get("text", n.get("label", n["id"]))),
                      "group": _sid(n["group"]) if n.get("group") else None}
    for e in spec.get("edges") or []:
        if not isinstance(e, dict) or e.get("from") in (None, "") or e.get("to") in (None, ""):
            raise DiagramError("an edge needs from and to")
        a, b = _sid(e["from"]), _sid(e["to"])
        for x, raw in ((a, e["from"]), (b, e["to"])):
            if x not in nodes and x not in groups:
                nodes[x] = {"id": x, "text": str(raw), "group": None}
        out["edges"].append({**e, "from": a, "to": b})
    for g in groups.values():
        p, seen = g["parent"], {g["id"]}
        if p and p not in groups:
            raise DiagramError(f"group {g['id']}: no group {p}")
        while p:
            if p in seen:
                raise DiagramError(f"groups {', '.join(seen)} are inside each other")
            seen.add(p)
            p = groups[p]["parent"]
    for n in nodes.values():
        if n["group"] and n["group"] not in groups:
            raise DiagramError(f"node {n['id']}: no group {n['group']}")
    if not nodes:
        raise DiagramError("a diagram needs at least one node")
    if len(nodes) + len(groups) + len(out["edges"]) > 1500:
        raise DiagramError("too big: at most 1500 nodes, groups and edges together")
    out["nodes"], out["groups"] = list(nodes.values()), list(groups.values())
    return out


# ---------------------------------------------------------------- the layout
def _pav(target: list[float], minsep: list[float]) -> list[float]:
    """Positions as close to ``target`` as they can be, in order, each at least ``minsep[i]`` after the one before it
    (least squares: pool-adjacent-violators on the offsets)."""
    off, acc = [], 0.0
    for i, s in enumerate(minsep):
        acc += s if i else 0
        off.append(acc)
    vals = [t - o for t, o in zip(target, off)]
    blocks: list[list[float]] = []  # [sum, count]
    for v in vals:
        blocks.append([v, 1])
        while len(blocks) > 1 and blocks[-2][0] / blocks[-2][1] > blocks[-1][0] / blocks[-1][1]:
            s, c = blocks.pop()
            blocks[-1][0] += s
            blocks[-1][1] += c
    out = []
    for s, c in blocks:
        out += [s / c] * c
    return [v + o for v, o in zip(out, off)]


def _block(items: dict[str, tuple[float, float]], edges: list[tuple[str, str]], lr: bool, labels: dict | None = None):
    """Lay out one level: items are id -> (w, h); edges (a, b) with labels {(a, b): characters}. Returns id -> (x, y) of
    their top left, the block's w and h, and each edge's way points (a -> b) through the layers it crosses."""
    ids = list(items)
    labels = labels or {}
    if not ids:
        return {}, 0, 0, {}
    adj = {i: [] for i in ids}
    es = []
    for a, b in edges:
        if a != b and (a, b) not in es:
            es.append((a, b))
    # break cycles: an edge back to a node still on the DFS stack is turned around
    state, order = {}, []

    def dfs(v):
        state[v] = 1
        for w in [b for a, b in es if a == v]:
            if state.get(w) == 1:
                continue
            if not state.get(w):
                dfs(w)
        state[v] = 2
        order.append(v)
    import sys
    old = sys.getrecursionlimit()
    sys.setrecursionlimit(max(old, len(ids) * 4 + 100))
    try:
        for v in ids:
            if not state.get(v):
                dfs(v)
    finally:
        sys.setrecursionlimit(old)
    pos = {v: i for i, v in enumerate(reversed(order))}  # a topological order once back edges turn
    dag = [(a, b) if pos[a] < pos[b] else (b, a) for a, b in es]
    for a, b in dag:
        adj[a].append(b)
    rank = {v: 0 for v in ids}
    for v in sorted(ids, key=lambda v: pos[v]):
        for w in adj[v]:
            rank[w] = max(rank[w], rank[v] + 1)
    # long edges get way points, one per layer they cross
    layers: dict[int, list[str]] = {}
    for v in sorted(ids, key=lambda v: pos[v]):
        layers.setdefault(rank[v], []).append(v)
    up, down = {v: [] for v in ids}, {v: [] for v in ids}
    size = dict(items)
    n, dummies = 0, {}
    for a, b in dag:
        prev, chain_ = a, []
        for r in range(rank[a] + 1, rank[b]):
            n += 1
            d = f"\0{n}"
            size[d] = (16, 16)
            layers[r].append(d)
            up[d], down[d] = [prev], []
            down[prev].append(d)
            prev = d
            chain_.append(d)
        down[prev].append(b)
        up[b].append(prev)
        dummies[(a, b)] = chain_
    # the gap after each rank: room for the labels of the edges that leave it (left to right, labels sit in the gap)
    gap_after = {r: GAP_RANK for r in range(max(rank.values()) + 1)}
    if lr:
        for (a, b), chars in labels.items():
            if a in rank and b in rank:
                r = min(rank[a], rank[b])
                gap_after[r] = max(gap_after[r], chars * 10 + 80)  # the hand-drawn font is wide
    nl = max(layers) + 1 if layers else 0
    L = [layers.get(r, []) for r in range(nl)]
    idx = {}

    def reindex():
        for layer in L:
            for i, v in enumerate(layer):
                idx[v] = i
    reindex()

    def crossings():
        c = 0
        for r in range(nl - 1):
            es_ = [(idx[a], idx[b]) for a in L[r] for b in down[a]]
            for i in range(len(es_)):
                for j in range(i + 1, len(es_)):
                    if (es_[i][0] - es_[j][0]) * (es_[i][1] - es_[j][1]) < 0:
                        c += 1
        return c
    best, best_c = [list(x) for x in L], crossings()
    for it in range(12):  # barycenter sweeps, down then up, keeping the best order seen
        rng = range(1, nl) if it % 2 == 0 else range(nl - 2, -1, -1)
        for r in rng:
            nb = up if it % 2 == 0 else down
            bary = {v: (sum(idx[u] for u in nb[v]) / len(nb[v])) if nb[v] else idx[v] for v in L[r]}
            L[r].sort(key=lambda v: (bary[v], idx[v]))
            for i, v in enumerate(L[r]):
                idx[v] = i
        c = crossings()
        if c < best_c:
            best, best_c = [list(x) for x in L], c
        if best_c == 0:
            break
    L = best
    reindex()
    # coordinates: across the layer (x for TB, y for LR), then along the ranks
    across = (lambda v: size[v][1]) if lr else (lambda v: size[v][0])
    along = (lambda v: size[v][0]) if lr else (lambda v: size[v][1])
    c = {}
    for layer in L:
        x = 0.0
        for v in layer:
            c[v] = x + across(v) / 2
            x += across(v) + GAP_IN
    for it in range(16):
        rng = range(nl) if it % 2 == 0 else range(nl - 1, -1, -1)
        for r in rng:
            layer = L[r]
            nb = (lambda v: up[v] + down[v]) if it >= 4 else ((lambda v: up[v]) if it % 2 == 0 else (lambda v: down[v]))
            target = [sum(c[u] for u in nb(v)) / len(nb(v)) if nb(v) else c[v] for v in layer]
            sep = [0.0] + [(across(layer[i - 1]) + across(layer[i])) / 2 + (GAP_IN if not layer[i].startswith("\0")
                           and not layer[i - 1].startswith("\0") else 18) for i in range(1, len(layer))]
            for v, p in zip(layer, _pav(target, sep)):
                c[v] = p
    lo = min(c[v] - across(v) / 2 for v in c)
    out, a0, dpos = {}, 0.0, {}
    for r, layer in enumerate(L):
        thick = max((along(v) for v in layer if not v.startswith("\0")), default=16)
        for v in layer:
            mid = c[v] - lo
            if v.startswith("\0"):
                dpos[v] = (a0 + thick / 2, mid) if lr else (mid, a0 + thick / 2)
                continue
            w, h = items[v]
            if lr:
                out[v] = (a0 + (thick - w) / 2, mid - h / 2)
            else:
                out[v] = (mid - w / 2, a0 + (thick - h) / 2)
        a0 += thick + gap_after.get(r, GAP_RANK)
    W = max(x + items[v][0] for v, (x, y) in out.items())
    H = max(y + items[v][1] for v, (x, y) in out.items())
    ways = {}
    for (a, b), ch in dummies.items():
        pts = [dpos[d] for d in ch]
        if (a, b) in es:
            ways[(a, b)] = pts
        else:  # turned round to break a cycle: its way points run the other way
            ways[(b, a)] = pts[::-1]
    return out, W, H, ways


def layout(spec: dict, name: str = "diagram", origin: tuple[float, float] = (40, 40)) -> list[dict]:
    """A clean spec as board elements, its top left at ``origin``."""
    lr = spec["direction"] == "LR"
    groups = {g["id"]: g for g in spec["groups"]}
    nodes = {n["id"]: n for n in spec["nodes"]}
    parent = {**{n["id"]: n.get("group") for n in nodes.values()}, **{g["id"]: g.get("parent") for g in groups.values()}}
    kids: dict[str | None, list[str]] = {}
    for x in list(groups) + list(nodes):
        kids.setdefault(parent[x], []).append(x)

    def chain(x):
        out = [x]
        while parent.get(out[-1]):
            out.append(parent[out[-1]])
        return out
    sizes, rel, via, level, origin_of = {}, {}, {}, {}, {}

    def solve(container):
        items = {}
        for k in kids.get(container, []):
            if k in groups:
                solve(k)
            items[k] = sizes[k] if k in groups else _size(nodes[k])
        es, labels = [], {}
        for i, e in enumerate(spec["edges"]):
            ca, cb = chain(e["from"]), chain(e["to"])
            a = next((x for x in ca if parent.get(x) == container and x in items), None)
            b = next((x for x in cb if parent.get(x) == container and x in items), None)
            if a and b and a != b:
                es.append((a, b))
                level[i] = (container, a, b)
                if e.get("text"):
                    labels[(a, b)] = max(labels.get((a, b), 0), max(len(x) for x in str(e["text"]).split("\n")))
        pos, w, h, ways = _block(items, es, lr, labels)
        rel[container], via[container] = pos, ways
        if container is not None:
            g = groups[container]
            sizes[container] = (max(w + PAD * 2, len(g["text"]) * 10 + 60), h + PAD * 2 + TITLE)
    solve(None)
    els = []
    tag = _sid(name)[:24]
    eid = lambda x: f"{tag}-{x}"[:64]  # noqa: E731
    ox, oy = origin
    if spec.get("title"):
        els.append({"type": "text", "id": f"{tag}--title", "x": ox, "y": oy, "text": spec["title"], "size": 28,
                    "bold": True, "diagram": tag})
        oy += 76  # room for the name of a frame just under it

    def place(container, x0, y0, depth):
        origin_of[container] = (x0, y0)
        for k, (x, y) in rel[container].items():
            ax, ay = x0 + x, y0 + y
            if k in groups:
                g = groups[k]
                w, h = sizes[k]
                els.append({"type": "frame", "id": eid(k), "x": round(ax), "y": round(ay), "w": round(w), "h": round(h),
                            "text": g["text"], "fill": g.get("fill") or FRAME_TINTS[depth % 4], "fill_style": "solid",
                            "color": g.get("color") or FRAME_LINES[depth % 4], "dash": g.get("dash") or "dashed",
                            "diagram": tag, **({"text_color": g["text_color"]} if g.get("text_color") else {})})
                place(k, ax + PAD, ay + PAD + TITLE, depth + 1)
            else:
                n = nodes[k]
                w, h = _size(n)
                sh = n.get("shape") or "rect"
                t = {"rounded": "rect", "circle": "ellipse", "text": "text"}.get(sh, sh)
                el = {"type": t, "id": eid(k), "x": round(ax), "y": round(ay), "diagram": tag, "text": n["text"]}
                if t == "text":
                    el.update(size=n.get("size") or 18, align="center")
                else:
                    el.update(w=w, h=h, fill=n.get("fill") or SHAPE_FILL.get(sh) or (None if t == "note" else "#ffffff"),
                              color=n.get("color") or boards.INK, width=n.get("width") or 2,
                              fill_style=n.get("fill_style") or spec.get("fill_style") or "hachure")
                    if sh == "rounded":
                        el["radius"] = min(h / 2, 28)
                    elif t == "rect":
                        el["radius"] = 8
                for kk in ("size", "bold", "text_color", "dash", "font", "opacity", "roughness"):
                    if n.get(kk) is not None and kk not in el:
                        el[kk] = n[kk]
                els.append({k2: v for k2, v in el.items() if v is not None})
    place(None, ox, oy, 0)
    boxes = {e["id"]: e for e in els}
    for i, e in enumerate(spec["edges"]):
        if e.get("invisible"):
            continue
        a, b = boxes.get(eid(e["from"])), boxes.get(eid(e["to"]))
        if not a or not b:
            continue
        ca = (a["x"] + a.get("w", 0) / 2, a["y"] + a.get("h", 0) / 2)
        cb = (b["x"] + b.get("w", 0) / 2, b["y"] + b.get("h", 0) / 2)
        el = {"type": "arrow", "id": f"{tag}--e{i}", "from": a["id"], "to": b["id"], "x1": round(ca[0]), "y1": round(ca[1]),
              "x2": round(cb[0]), "y2": round(cb[1]), "route": e.get("route") or spec["route"],
              "head": e.get("head") or "end", "color": e.get("color") or boards.INK, "width": e.get("width") or 2,
              "diagram": tag}
        for kk in ("text", "dash", "size"):
            if e.get(kk):
                el[kk] = e[kk]
        if i in level:  # through the layers it crosses, where the layout left it room
            cont, la, lb = level[i]
            x0, y0 = origin_of.get(cont, (ox, oy))
            pts = via.get(cont, {}).get((la, lb)) or []
            if pts:
                el["via"] = [[round(x0 + px), round(y0 + py)] for px, py in pts]
        els.append(el)
    return [boards.normalize(e) for e in els]


def build(text_or_spec, name: str = "diagram", origin: tuple[float, float] = (40, 40), direction: str | None = None):
    """Mermaid, JSON text or a dict -> board elements."""
    spec = parse(text_or_spec) if isinstance(text_or_spec, str) else text_or_spec
    if direction:
        spec = {**spec, "direction": direction}
    try:
        return layout(clean(spec), name, origin)
    except boards.BoardError as e:
        raise DiagramError(str(e)) from None
