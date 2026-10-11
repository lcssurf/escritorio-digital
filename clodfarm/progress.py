# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# Required Notice: Copyright (c) 2026 lcssurf (https://github.com/lcssurf/escritorio-digital)
"""What is going on inside a job, in a form a lawyer can follow.

The farm already keeps a live feed of every agent (what it thinks, says and which tools it calls). Here that feed is
joined per job (the job and everyone it called), each line is sorted into a plain category (reading, writing, calling
a colleague...) and the tree of who called whom is built. The panel turns the categories into sentences in the
person's language; the raw line stays available as a technical detail.
"""
from __future__ import annotations

import re

WORKTREE = re.compile(r"/workspace/(?:\.worktrees/[0-9a-f]+|repo)/")
LEAD_CD = re.compile(r"^(?:cd\s+\S+\s*(?:;|&&)\s*)+")
SPAWN = re.compile(r"clodfarm\s+spawn\s+(?:\"([^\"]*)\"|'([^']*)'|(\S+))")
SPECIALIST = re.compile(r"--specialist\s+([a-z0-9-]+)")
READING = re.compile(r"^(cat|head|tail|ls|wc|grep|rg|find|file|stat|tree|sed\s+-n|less|diff)\b")
WRITING = re.compile(r"^(mkdir|cp|mv|touch|tee|printf|echo)\b|cat\s*>|>>?\s*\S")
LIMIT_STEPS = 400


def clean_path(p: str) -> str:
    return WORKTREE.sub("", str(p or "")).strip()


def classify(item: dict) -> dict:
    """One feed item as {cat, arg, who}: cat in think, say, read, write, edit, search, web, call, check, merge, save,
    compute, run, tool."""
    kind = item.get("kind")
    text = str(item.get("text") or "")
    if kind == "thought":
        return {"cat": "think", "arg": ""}
    if kind == "say":
        return {"cat": "say", "arg": text}
    tool = str(item.get("tool") or "")
    arg = text.split(": ", 1)[1] if ": " in text else ""
    if tool in ("Read", "NotebookRead"):
        return {"cat": "read", "arg": clean_path(arg)}
    if tool == "Write":
        return {"cat": "write", "arg": clean_path(arg)}
    if tool in ("Edit", "MultiEdit", "NotebookEdit"):
        return {"cat": "edit", "arg": clean_path(arg)}
    if tool in ("Glob", "Grep"):
        return {"cat": "search", "arg": arg[:120]}
    if tool in ("WebSearch", "WebFetch"):
        return {"cat": "web", "arg": arg[:120]}
    if tool in ("Task", "Agent"):
        return {"cat": "call", "arg": arg[:120], "who": ""}
    if tool == "Bash":
        cmd = LEAD_CD.sub("", arg.strip())
        m = SPAWN.search(cmd)
        if m:
            title = next((g for g in m.groups() if g), "")
            who = SPECIALIST.search(cmd)
            return {"cat": "call", "arg": title[:140], "who": who.group(1) if who else ""}
        if re.match(r"^clodfarm\s+(result|status|msg|subagents|inbox)\b", cmd):
            return {"cat": "check", "arg": ""}
        if re.search(r"\bgit\s+(?:-c\s+\S+\s+)*commit\b", cmd):
            return {"cat": "save", "arg": ""}
        if re.search(r"\bgit\s+merge\b", cmd):
            return {"cat": "merge", "arg": ""}
        if READING.match(cmd):
            return {"cat": "read", "arg": ""}
        if re.match(r"^(python3?|node)\b", cmd):
            return {"cat": "compute", "arg": ""}
        if WRITING.search(cmd):
            return {"cat": "write", "arg": ""}
        return {"cat": "run", "arg": ""}
    return {"cat": "tool", "arg": tool}


def tree(store, top_id: str, limit: int = 40) -> list[dict]:
    """The job and everyone it called (depth first), each with its state and when it started and finished."""
    out, todo, seen = [], [(top_id, 0)], set()
    while todo and len(out) < limit:
        tid, depth = todo.pop(0)
        if tid in seen:
            continue
        seen.add(tid)
        t = store.get_task(tid)
        if not t:
            continue
        out.append({"id": t["id"], "title": t.get("title") or "", "status": t.get("status"), "specialist": t.get("specialist"),
                    "started": t.get("started"), "finished": t.get("finished"), "created": t.get("created"),
                    "depth": depth, "parent": t.get("parent")})
        todo[0:0] = [(c, depth + 1) for c in (t.get("children") or [])]
    return out


def steps(store, ids: set[str], limit: int = 60) -> list[dict]:
    """The newest feed lines of those tasks, oldest first, each sorted into a category."""
    out = []
    for it in store.live(None, 500):
        if it.get("task") not in ids:
            continue
        c = classify(it)
        out.append({"at": it.get("at"), "task": it.get("task"), **c, "kind": it.get("kind"),
                    "text": str(it.get("text") or "")[:300] if it.get("kind") != "tool" else str(it.get("text") or "")[:200]})
    out.sort(key=lambda x: float(x.get("at") or 0))
    return out[-max(1, min(limit, LIMIT_STEPS)):]
