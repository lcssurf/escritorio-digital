# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# Required Notice: Copyright (c) 2026 lcssurf (https://github.com/lcssurf/escritorio-digital)
"""The catalog of ready-made team members the HR person (RH) can offer and adapt: coordinators and specialists of a
typical law office. Nobody on the team is created from here by itself: the RH reads a model, adapts it to the office it
interviewed, and PROPOSES it; the lawyer decides."""
from __future__ import annotations

import json
import os

_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "catalog")


def _load() -> list[dict]:
    out: list[dict] = []
    try:
        names = sorted(f for f in os.listdir(_DIR) if f.endswith(".json"))
    except OSError:
        return out
    for f in names:
        try:
            with open(os.path.join(_DIR, f), encoding="utf-8") as fh:
                data = json.load(fh)
        except (OSError, ValueError):
            continue
        for e in data.get("entries") or []:
            if isinstance(e, dict) and e.get("id"):
                out.append({**e, "pack": data.get("id"), "pack_title": data.get("title")})
    return out


def entries() -> list[dict]:
    return _load()


def get(entry_id: str) -> dict | None:
    return next((e for e in _load() if e["id"] == entry_id), None)


def index_text() -> str:
    """One line per model, for the RH's briefing (the full text is read on demand with `clodfarm catalog show <id>`)."""
    lines = []
    for e in _load():
        kind = "coordenação" if e.get("kind") == "lead" else "especialista"
        lines.append(f"- {e['id']}: {e.get('title') or e.get('name')} ({kind}" + (f", equipe {e['team']}" if e.get("team") else "") + ")")
    return "\n".join(lines) or "(catálogo vazio)"


def show_text(entry_id: str) -> str:
    e = get(entry_id)
    if not e:
        return ""
    return (f"id: {e['id']}\ncargo: {e.get('title', '')}\ntipo: {'coordenação' if e.get('kind') == 'lead' else 'especialista'}"
            f"\nnome sugerido: {e.get('name', '')}\ngênero: {e.get('gender', '')}\naparência: {json.dumps(e.get('look') or {}, ensure_ascii=False)}"
            f"\n\ninstruções do modelo:\n{e.get('instructions', '')}\n")
