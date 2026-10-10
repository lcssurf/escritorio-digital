"""The office's team: the specialists a person creates, and the chief who coordinates them.

The team has three levels: the chief, the leads (orchestrators, who coordinate a team of their own) and the
specialists. A specialist is a name, a title, instructions and a look. A job given to a specialist runs as a sub-agent whose system
prompt carries the office rules and that specialist's instructions. A job given to the chief runs with the roster of
the team and is told how to hand parts of it to the specialists (`clodfarm spawn --specialist <id>`).
"""
from __future__ import annotations

import json
import os
import re
import tempfile
import threading
import unicodedata

CHIEF = "chief"
MAX_MEMBERS = 40
ID_RE = re.compile(r"[a-z0-9][a-z0-9-]{0,30}")
HEX = re.compile(r"#[0-9a-fA-F]{6}")
STYLES = ("short", "side", "beard", "long", "bun", "pony")
LOOK_COLORS = ("skin", "hair", "suit")

OFFICE_RULES = (
    "## Regras do escritório (valem sempre)\n"
    "1. Nunca use dados reais de clientes. Em testes, use apenas dados fictícios.\n"
    "2. A IA rascunha; o advogado confere e decide. Você nunca envia e-mail, mensagem ou petição a ninguém.\n"
    "3. Onde houver dúvida, escreva [CONFERIR], cite a fonte ou diga que não sabe. Não invente fatos, leis ou prazos.\n"
    "4. Não dê parecer jurídico definitivo e não prometa resultado.\n"
    "5. Trabalhe só no seu diretório de trabalho e faça commit do que produzir: o advogado aprova antes de entrar no projeto.\n"
)


class TeamError(ValueError):
    pass


def slug(text: str) -> str:
    s = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:30] or "especialista"
    return s


def _clean_look(raw) -> dict:
    out: dict = {}
    raw = raw if isinstance(raw, dict) else {}
    for k in LOOK_COLORS:
        v = raw.get(k)
        if v:
            if not isinstance(v, str) or not HEX.fullmatch(v):
                raise TeamError(f"look.{k} must be a colour like #aabbcc")
            out[k] = v.lower()
    if raw.get("style"):
        if raw["style"] not in STYLES:
            raise TeamError("look.style must be one of " + ", ".join(STYLES))
        out["style"] = raw["style"]
    if "glasses" in raw:
        out["glasses"] = bool(raw["glasses"])
    if raw.get("prop") is not None:
        try:
            p = int(raw["prop"])
        except (TypeError, ValueError):
            raise TeamError("look.prop must be a number from 0 to 4") from None
        if not 0 <= p <= 4:
            raise TeamError("look.prop must be a number from 0 to 4")
        out["prop"] = p
    return out


def clean_member(data: dict) -> dict:
    """Validate what a person typed for a team member. Never trust the client: every field is checked here."""
    if not isinstance(data, dict):
        raise TeamError("expected an object")
    name = str(data.get("name") or "").strip()
    if not 1 <= len(name) <= 40:
        raise TeamError("the name must have 1 to 40 characters")
    title = str(data.get("title") or "").strip()
    if len(title) > 60:
        raise TeamError("the title is limited to 60 characters")
    gender = data.get("gender") or "m"
    if gender not in ("m", "f"):
        raise TeamError("gender must be 'm' or 'f'")
    instructions = str(data.get("instructions") or "").strip()
    if len(instructions) > 6000:
        raise TeamError("the instructions are limited to 6000 characters")
    parent = str(data.get("parent") or "").strip() or CHIEF
    if parent != CHIEF and not ID_RE.fullmatch(parent):
        raise TeamError("parent must be a team member id")
    return {"name": name, "title": title, "gender": gender, "instructions": instructions,
            "look": _clean_look(data.get("look")), "lead": bool(data.get("lead")), "parent": parent,
            "pinned": bool(data.get("pinned"))}


def default_chief() -> dict:
    return {"id": CHIEF, "name": "Chefe", "title": "Chefe do escritório", "gender": "m", "instructions": "",
            "look": {"suit": "#2f2f3a", "glasses": True}, "lead": True, "parent": None, "pinned": True}


class Team:
    def __init__(self, path: str):
        self.path = path
        self._lock = threading.Lock()

    # --------------------------------------------------------------- storage
    def _read(self) -> list[dict]:
        try:
            with open(self.path, encoding="utf-8") as f:
                members = json.load(f).get("members") or []
        except (OSError, ValueError):
            members = []
        members = [m for m in members if isinstance(m, dict) and m.get("id")]
        if not any(m["id"] == CHIEF for m in members):
            members.insert(0, default_chief())
        for m in members:  # records saved before the hierarchy existed
            m.setdefault("lead", m["id"] == CHIEF)
            m.setdefault("pinned", m["id"] == CHIEF)
            if m["id"] == CHIEF:
                m["parent"] = None
            else:
                m.setdefault("parent", CHIEF)
        return members

    def _write(self, members: list[dict]):
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(self.path), suffix=".tmp")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump({"members": members}, f, ensure_ascii=False, indent=1)
        os.replace(tmp, self.path)

    # --------------------------------------------------------------- queries
    def all(self) -> list[dict]:
        with self._lock:
            members = self._read()
        return sorted(members, key=lambda m: m["id"] != CHIEF)  # the chief first, the rest in creation order

    def get(self, mid: str | None) -> dict | None:
        return next((m for m in self.all() if m["id"] == mid), None)

    # --------------------------------------------------------------- changes
    @staticmethod
    def _fit(fields: dict, members: list[dict], mid: str | None) -> dict:
        """The three levels: the chief on top, leads under the chief, specialists under the chief or a lead."""
        if mid == CHIEF:
            return {**fields, "lead": True, "parent": None, "pinned": True}
        parent = fields["parent"]
        if parent != CHIEF:
            boss = next((m for m in members if m["id"] == parent), None)
            if not boss or not boss.get("lead") or boss["id"] == mid:
                raise TeamError("a team member can only report to the chief or to a lead")
            if fields["lead"]:
                raise TeamError("a lead reports to the chief")
        return fields

    def upsert(self, data: dict, mid: str | None = None) -> dict:
        fields = clean_member(data)
        with self._lock:
            members = self._read()
            if mid:
                cur = next((m for m in members if m["id"] == mid), None)
                if not cur:
                    raise TeamError("no such team member")
                fields = self._fit(fields, members, mid)
                if cur.get("lead") and not fields["lead"] and any(m.get("parent") == mid for m in members):
                    raise TeamError("move this lead's team elsewhere first")
                cur.update(fields)
                self._write(members)
                return cur
            fields = self._fit(fields, members, None)
            if len(members) >= MAX_MEMBERS:
                raise TeamError(f"the team is limited to {MAX_MEMBERS} people")
            base, n, new = slug(fields["name"]), 1, None
            taken = {m["id"] for m in members}
            while new is None or new in taken or new == CHIEF:
                new = base if n == 1 else f"{base}-{n}"
                n += 1
            member = {"id": new, **fields}
            members.append(member)
            self._write(members)
            return member

    def delete(self, mid: str):
        if mid == CHIEF:
            raise TeamError("the chief cannot be removed")
        with self._lock:
            members = self._read()
            keep = [m for m in members if m["id"] != mid]
            if len(keep) == len(members):
                raise TeamError("no such team member")
            for m in keep:  # the people of a removed lead go back under the chief
                if m.get("parent") == mid:
                    m["parent"] = CHIEF
            self._write(keep)

    # --------------------------------------------------------------- prompts
    def reports(self, boss: str) -> list[dict]:
        return [m for m in self.all() if m["id"] != CHIEF and (m.get("parent") or CHIEF) == boss]

    def roster(self, boss: str = CHIEF) -> str:
        """The people ``boss`` can hand work to: its direct reports (a lead is listed with its own team)."""
        lines = []
        for m in self.reports(boss):
            gist = " ".join((m.get("instructions") or "").split())[:200]
            line = f"- {m['id']}: {m['name']}" + (f", {m['title']}" if m.get("title") else "")
            if m.get("lead"):
                team = self.reports(m["id"])
                line += " (coordena: " + (", ".join(t["id"] for t in team) or "ninguém ainda") + ")"
            lines.append(line + (f". {gist}" if gist else ""))
        return "\n".join(lines) or "(ninguém ainda: faça você mesmo)"

    def briefing(self, task: dict) -> str:
        """What a run for a team member is told on top of the farm guide (empty for any other sub-agent)."""
        m = self.get(task.get("specialist"))
        if not m:
            return ""
        she = m.get("gender") == "f"
        head = (f"\n## Quem você é\nVocê é {m['name']}" + (f", {m['title']}" if m.get("title") else "") +
                f", do escritório de advocacia. Ao falar de si, use o {'feminino' if she else 'masculino'}.\n")
        own = "\n## Suas instruções\n" + m["instructions"] + "\n" if m.get("instructions") else ""
        if m.get("lead"):   # the chief and the leads coordinate a team
            boss = "chefe do escritório" if m["id"] == CHIEF else "coordenação"
            return (head + OFFICE_RULES + own + "\n## Sua equipe\n" + self.roster(m["id"]) + "\n\n## Como delegar\n"
                    f"Você é a {boss}: divide o trabalho e entrega cada parte a quem da sua equipe sabe fazer. Para cada parte, rode\n"
                    "`clodfarm spawn \"<título curto>\" --specialist <id> --prompt \"<tarefa completa e autocontida>\"`.\n"
                    "Eles trabalham em paralelo, cada um na sua branch. Se uma etapa depende da outra, faça em rodadas: "
                    "espere a anterior terminar. Quando terminarem, você é retomado: junte as branches, confira o conjunto e "
                    "entregue um resumo claro do que foi feito e do que precisa de conferência.\n"
                    "Se a tarefa for pequena, faça você mesmo. Use só os ids da lista acima.\n")
        return head + OFFICE_RULES + "\n## Suas instruções\n" + (m.get("instructions") or "(sem instruções específicas: faça o melhor trabalho dentro das regras)") + "\n"
