# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# Required Notice: Copyright (c) 2026 lcssurf (https://github.com/lcssurf/escritorio-digital)
"""Proposals from the RH: who to hire, whose instructions to change, who to let go. The RH writes a block in its answer;
the office reads it, checks every field as if a person had typed it, and keeps the proposal until the lawyer decides.
Nothing in the team changes before that: an agent can ask, never do."""
from __future__ import annotations

import json
import os
import re
import secrets
import tempfile
import threading
import time

from . import rh, team

MAX_ITEMS = 20
KEEP_DECIDED = 30
SEEN_CAP = 300
REF_RE = re.compile(r"[a-z0-9][a-z0-9-]{0,30}")
_BLOCK = re.compile(r"<<<EQUIPE[ \t]*\n(.*?)\n[ \t]*EQUIPE>>>", re.S)
ACTIONS = {"contratar": "hire", "alterar": "edit", "dispensar": "dismiss"}
PROTECTED = (team.CHIEF, rh.RH_ID)   # a proposal can change them, but never let them go


def split_block(text: str) -> tuple[str, str | None]:
    """What the RH said, and the raw JSON of its proposal block (None if there is none)."""
    m = _BLOCK.search(text or "")
    if not m:
        return (text or "").strip(), None
    return (text[:m.start()] + text[m.end():]).strip(), m.group(1)


def _short(v, n) -> str:
    return " ".join(str(v or "").split())[:n]


def parse(raw: str, existing: list[dict]) -> tuple[str, list[dict], int]:
    """The proposal as a list of checked items. Returns (the RH's one-line message, the items, how many it had to ignore).
    An item that does not pass the same checks as a person typing it is dropped, not repaired."""
    try:
        data = json.loads(raw)
    except ValueError:
        return "", [], 1
    if not isinstance(data, dict):
        return "", [], 1
    raw_items = data.get("itens") if isinstance(data.get("itens"), list) else []
    ids = {m["id"] for m in existing}
    items: list[dict] = []
    ignored = max(0, len(raw_items) - MAX_ITEMS)
    refs: set[str] = set()
    for it in raw_items[:MAX_ITEMS]:
        if not isinstance(it, dict) or str(it.get("acao") or "").lower() not in ACTIONS:
            ignored += 1
            continue
        action = ACTIONS[str(it["acao"]).lower()]
        reason = _short(it.get("motivo"), 300)
        test = _short(it.get("teste"), 300)
        try:
            if action == "hire":
                ref = str(it.get("ref") or "").strip()
                if ref and not REF_RE.fullmatch(ref):
                    raise team.TeamError("bad ref")
                fields = team.clean_member({"name": it.get("nome"), "title": it.get("cargo"), "gender": it.get("genero") or "m",
                                            "instructions": it.get("instrucoes"), "look": it.get("aparencia"),
                                            "lead": it.get("lider"), "parent": it.get("chefe")})
                if not fields["instructions"]:
                    raise team.TeamError("a hire needs instructions")
                if fields["parent"] != team.CHIEF and fields["parent"] not in ids and fields["parent"] not in refs:
                    raise team.TeamError("unknown boss")
                if ref:
                    refs.add(ref)
                items.append({"action": "hire", "ref": ref, "fields": fields, "reason": reason, "test": test})
            else:
                mid = str(it.get("id") or "")
                if mid not in ids or (action == "dismiss" and mid in PROTECTED):
                    raise team.TeamError("unknown or protected member")
                if action == "edit":
                    instr = str(it.get("instrucoes") or "").strip()
                    if not instr or len(instr) > 6000:
                        raise team.TeamError("bad instructions")
                    items.append({"action": "edit", "id": mid, "fields": {"instructions": instr}, "reason": reason})
                else:
                    items.append({"action": "dismiss", "id": mid, "reason": reason})
        except team.TeamError:
            ignored += 1
    return _short(data.get("mensagem"), 400), items, ignored


def apply(members: list[dict], items: list[dict]) -> tuple[list[dict], list[dict]]:
    """The team after the items, and what each one did. Works on a copy and raises before anything is written."""
    out = [dict(m) for m in members]
    results: list[dict] = []
    refmap: dict[str, str] = {}
    for it in items:
        if it["action"] == "hire":
            f = dict(it["fields"])
            parent = refmap.get(f["parent"], f["parent"])
            if parent != team.CHIEF and not any(m["id"] == parent and m.get("lead") for m in out):
                raise team.TeamError("a hire reports to someone who is not on the team (or not a coordinator): select that item too")
            f["parent"] = parent
            f = team.Team._fit(f, out, None)
            if len(out) >= team.MAX_MEMBERS:
                raise team.TeamError(f"the team is limited to {team.MAX_MEMBERS} people")
            base, n, new = team.slug(f["name"]), 1, None
            taken = {m["id"] for m in out} | set(refmap.values())
            while new is None or new in taken or new == team.CHIEF:
                new = base if n == 1 else f"{base}-{n}"
                n += 1
            out.append({"id": new, **f})
            if it.get("ref"):
                refmap[it["ref"]] = new
            results.append({"action": "hire", "id": new, "name": f["name"]})
        elif it["action"] == "edit":
            cur = next((m for m in out if m["id"] == it["id"]), None)
            if not cur:
                raise team.TeamError("no such team member")
            cur.update(it["fields"])
            results.append({"action": "edit", "id": cur["id"], "name": cur["name"]})
        else:
            if it["id"] in PROTECTED:
                raise team.TeamError("the chief and the RH cannot be let go")
            gone = next((m for m in out if m["id"] == it["id"]), None)
            if not gone:
                raise team.TeamError("no such team member")
            out = [m for m in out if m["id"] != it["id"]]
            for m in out:
                if m.get("parent") == it["id"]:
                    m["parent"] = team.CHIEF
            results.append({"action": "dismiss", "id": gone["id"], "name": gone["name"]})
    return out, results


class Hiring:
    """The proposals waiting for the lawyer (and the last few decided), in a small file."""

    def __init__(self, path: str):
        self.path = path
        self._lock = threading.Lock()

    def _read(self) -> dict:
        try:
            with open(self.path, encoding="utf-8") as f:
                d = json.load(f)
        except (OSError, ValueError):
            d = {}
        return {"proposals": [p for p in d.get("proposals") or [] if isinstance(p, dict)], "seen": [s for s in d.get("seen") or [] if isinstance(s, str)]}

    def _write(self, d: dict):
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        decided = [p for p in d["proposals"] if p.get("status") != "pending"][-KEEP_DECIDED:]
        d = {"proposals": [p for p in d["proposals"] if p.get("status") == "pending"] + decided, "seen": d["seen"][-SEEN_CAP:]}
        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(self.path), suffix=".tmp")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False, indent=1)
        os.replace(tmp, self.path)

    def seen(self, tid: str) -> bool:
        with self._lock:
            return tid in self._read()["seen"]

    def mark_seen(self, tid: str):
        with self._lock:
            d = self._read()
            if tid not in d["seen"]:
                d["seen"].append(tid)
                self._write(d)

    def add(self, task: str, message: str, note: str, items: list[dict], ignored: int, source: str = "") -> dict:
        p = {"id": "h" + secrets.token_hex(4), "task": task, "at": time.time(), "status": "pending", "message": message,
             "note": note[:2000], "items": items, "ignored": ignored, "source": source}
        with self._lock:
            d = self._read()
            d["proposals"].append(p)
            self._write(d)
        return p

    def get(self, pid: str) -> dict | None:
        with self._lock:
            return next((p for p in self._read()["proposals"] if p.get("id") == pid), None)

    def view(self) -> dict:
        with self._lock:
            ps = self._read()["proposals"]
        return {"pending": [p for p in ps if p.get("status") == "pending"],
                "recent": [p for p in ps if p.get("status") != "pending"][-5:]}

    def decide(self, pid: str, status: str, **extra) -> dict | None:
        with self._lock:
            d = self._read()
            p = next((x for x in d["proposals"] if x.get("id") == pid and x.get("status") == "pending"), None)
            if not p:
                return None
            p.update({"status": status, "decided": time.time(), **extra})
            self._write(d)
            return p
