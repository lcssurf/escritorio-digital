# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# Required Notice: Copyright (c) 2026 lcssurf (https://github.com/lcssurf/escritorio-digital)
"""Talking to a member of the team from the overlay.

Each message from the lawyer becomes a short job for that person (a sub-agent working as them); its result is the reply.
The conversation is kept in a small file so the panel can show it and the next message carries the recent context.
"""
from __future__ import annotations

import json
import os
import re
import tempfile
import threading
import time

MAX_TEXT = 4000
KEEP = 60          # messages kept per member
CONTEXT = 8        # messages of context handed to the next job
MAX_PENDING = 3    # unanswered messages per member at once
_GIT_TAIL = re.compile(r"\n*\[git\][\s\S]*$")
_PLAN = re.compile(r"```plano\s*(.*?)\s*```", re.S)
MAX_STEPS = 8


class ChatError(ValueError):
    pass


def clean_reply(result: str) -> str:
    return _GIT_TAIL.sub("", result or "").strip()


def split_plan(text: str, valid_ids) -> tuple[str, dict | None]:
    """The chief proposes before acting: a short text and a ```plano block listing who does what. Returns the text
    without the block and the plan (only steps for people who really are on the team), or None."""
    m = _PLAN.search(text or "")
    if not m:
        return (text or "").strip(), None
    clean = (text[:m.start()] + text[m.end():]).strip()
    try:
        raw = json.loads(m.group(1)).get("passos") or []
    except (ValueError, AttributeError):
        return clean, None
    steps = []
    for st in raw if isinstance(raw, list) else []:
        who, what = str((st or {}).get("quem") or ""), " ".join(str((st or {}).get("tarefa") or "").split())[:300]
        if who in valid_ids and what:
            steps.append({"who": who, "task": what})
    return clean, ({"steps": steps[:MAX_STEPS], "status": "proposed"} if steps else None)


class Chat:
    def __init__(self, path: str):
        self.path = path
        self._lock = threading.Lock()

    # --------------------------------------------------------------- storage
    def _read(self) -> dict:
        try:
            with open(self.path, encoding="utf-8") as f:
                data = json.load(f)
            return data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            return {}

    def _write(self, data: dict):
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(self.path), suffix=".tmp")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        os.replace(tmp, self.path)

    # --------------------------------------------------------------- queries
    def history(self, member: str) -> list[dict]:
        with self._lock:
            return list(self._read().get(member) or [])

    def pending(self, member: str) -> list[dict]:
        msgs = self.history(member)
        answered = {m.get("reply_to") for m in msgs if m["role"] == "assistant" and m.get("kind", "answer") == "answer"}
        return [m for m in msgs if m["role"] == "user" and m["id"] not in answered]

    def members_waiting(self) -> list[str]:
        with self._lock:
            data = self._read()
        out = []
        for member, msgs in data.items():
            answered = {m.get("reply_to") for m in msgs if m["role"] == "assistant" and m.get("kind", "answer") == "answer"}
            started = any(m.get("plan", {}).get("status") == "started" and not m.get("plan", {}).get("done") for m in msgs if m["role"] == "assistant")
            if started or any(m["role"] == "user" and m["id"] not in answered for m in msgs):
                out.append(member)
        return out

    # --------------------------------------------------------------- changes
    def add_user(self, member: str, text: str, task: str, mode: str = "direct") -> dict:
        text = str(text or "").strip()
        if not text:
            raise ChatError("write something")
        if len(text) > MAX_TEXT:
            raise ChatError(f"messages are limited to {MAX_TEXT} characters")
        with self._lock:
            data = self._read()
            msgs = data.setdefault(member, [])
            answered = {m.get("reply_to") for m in msgs if m["role"] == "assistant" and m.get("kind", "answer") == "answer"}
            if len([m for m in msgs if m["role"] == "user" and m["id"] not in answered]) >= MAX_PENDING:
                raise ChatError("wait for the earlier answers before sending more")
            msg = {"id": (msgs[-1]["id"] + 1) if msgs else 1, "role": "user", "text": text, "at": time.time(), "task": task, "mode": mode}
            msgs.append(msg)
            data[member] = msgs[-KEEP:]
            self._write(data)
            return msg

    def add_reply(self, member: str, reply_to: int, text: str, ok: bool = True, waiting: bool = False,
                  plan: dict | None = None, kind: str = "answer") -> dict | None:
        with self._lock:
            data = self._read()
            msgs = data.get(member) or []
            if any(m.get("reply_to") == reply_to and m.get("kind", "answer") == kind for m in msgs if m["role"] == "assistant"):
                return None   # already answered (two settles at once)
            msg = {"id": (msgs[-1]["id"] + 1) if msgs else 1, "role": "assistant", "text": text, "at": time.time(),
                   "reply_to": reply_to, "ok": ok, "waiting": waiting, "kind": kind}
            if plan:
                msg["plan"] = plan
            msgs.append(msg)
            data[member] = msgs[-KEEP:]
            self._write(data)
            return msg

    def update_plan(self, member: str, msg_id: int, **fields) -> dict | None:
        with self._lock:
            data = self._read()
            for m in data.get(member) or []:
                if m["id"] == msg_id and m.get("plan"):
                    m["plan"].update(fields)
                    self._write(data)
                    return m
        return None

    def get(self, member: str, msg_id: int) -> dict | None:
        return next((m for m in self.history(member) if m["id"] == msg_id), None)

    # --------------------------------------------------------------- prompts
    def prompt(self, member: dict, text: str, plan: bool = False) -> str:
        she = member.get("gender") == "f"
        lines = []
        for m in self.history(member["id"])[-CONTEXT:]:
            if m["role"] == "user":
                lines.append("Advogado: " + m["text"])
            elif m.get("ok", True):
                lines.append("Você: " + m["text"])
        who = member["name"] + (f", {member['title']}" if member.get("title") else "")
        return (f"Conversa direta com o advogado do escritório. Você é {who}. Responda como num chat: curto, claro, em "
                f"português, falando de si no {'feminino' if she else 'masculino'}. Se ele pedir um trabalho, faça-o (rascunhos "
                "em arquivos, com commit; o advogado aprova antes de entrar no projeto) e diga em uma ou duas frases o que fez "
                "e onde ficou. Se faltar informação, pergunte. Você não envia nada a ninguém.\n"
                + ("\nConversa até agora:\n" + "\n".join(lines) + "\n" if lines else "")
                + ("\nPlaneje antes de agir: NÃO execute nada ainda e NÃO rode `clodfarm spawn`. Responda em 1 a 3 frases e, se o "
                   "pedido exigir trabalho da equipe, termine com um bloco exatamente assim:\n```plano\n"
                   '{"passos":[{"quem":"<id da equipe>","tarefa":"<o que essa pessoa fará, em uma frase>"}]}\n```\n'
                   "Use só ids da sua equipe e, no máximo, 8 passos. Se for só uma pergunta ou conversa, responda sem o bloco.\n" if plan else "")
                + "\nMensagem nova do advogado:\n" + str(text).strip())
