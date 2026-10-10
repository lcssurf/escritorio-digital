"""The relay: Claude Code on a model whose provider speaks OpenAI's API (OpenAI, xAI, Gemini, Groq...).

Claude Code only speaks Anthropic's Messages API. A bot on such a provider gets its own relay: a small HTTP server on
127.0.0.1, started detached by the bot's ``clodfarm run`` (``ensure``), that takes Claude Code's ``/v1/messages``
calls, asks the provider in its own API (Chat Completions, or OpenAI's Responses API for OpenAI's models) and answers
the way Anthropic's API would, streamed or not. Claude Code points
at it through ``ANTHROPIC_BASE_URL``; the provider's key stays with the relay (read from the bot's ``bot.json``).

- Text, images, tool calls and tool results are translated both ways; a model's reasoning (``reasoning_content``,
  ``reasoning``, Gemini's ``<thought>`` parts) comes back as ``thinking`` blocks, so the farm sees it think.
- Anything a provider needs to see again on the next turn with a tool call (Gemini's thought signatures) rides in the
  tool call's id, which Claude Code sends back unchanged.
- A 429 stays a 429 (the farm pauses the bot), a context overflow becomes Anthropic's "prompt is too long" (Claude Code
  compacts), anything else an Anthropic-shaped error.
- It runs detached like a sub-agent's run: a new release of the bot's ``clodfarm run`` finds it by its pid file, so the
  runs it adopts keep talking to it.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import socket
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import procs

NAME_OK = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")
ID_PREFIX = "toolu_x"  # a tool call id that carries what the provider must see again: base64url JSON
PING_EVERY = 10.0  # seconds without a word from the provider before Claude Code is sent a ping
CONTEXT_FULL = re.compile(r"context.length|context.window|maximum context|too many tokens|prompt is too long|"
                          r"input.{0,20}too long|exceeds the (maximum|max)|token limit|reduce the length", re.I)
# JSON Schema words Gemini refuses in a function's parameters
GEMINI_DROP = {"$schema", "$id", "$comment", "additionalProperties", "propertyNames", "patternProperties",
               "unevaluatedProperties", "dependentRequired", "dependentSchemas", "if", "then", "else", "examples",
               "default", "const", "exclusiveMinimum", "exclusiveMaximum", "contentEncoding", "contentMediaType"}
STOP = {"stop": "end_turn", "length": "max_tokens", "tool_calls": "tool_use", "function_call": "tool_use",
        "content_filter": "refusal"}


# ------------------------------------------------------------------ settings
def settings_from_env(env=None) -> dict:
    """What a relay needs, from the environment its bot's ``clodfarm run`` gives it (bots.env)."""
    env = os.environ if env is None else env
    try:
        opts = json.loads(env.get("FARM_BOT_OPTS") or "{}")
    except ValueError:
        opts = {}
    return {"provider": env.get("FARM_BOT_PROVIDER") or "openai-compatible",
            "dialect": "responses" if env.get("FARM_BOT_DIALECT") == "responses" else "chat",
            "url": env.get("FARM_BOT_UPSTREAM") or "",
            "model": env.get("FARM_BOT") or "", "effort": opts.get("effort") or "",
            "max_out": int(opts.get("max_out") or 0)}


# ------------------------------------------------------------------ requests: Anthropic -> OpenAI
def _text_of(content) -> str:
    if isinstance(content, str):
        return content
    out = []
    for b in content or []:
        if isinstance(b, dict) and b.get("type") == "text":
            out.append(str(b.get("text") or ""))
        elif isinstance(b, dict) and b.get("type") in ("image", "document"):
            out.append(f"[{b['type']}]")
    return "\n".join(out)


def _image(b: dict) -> dict | None:
    src = b.get("source") or {}
    if src.get("type") == "base64" and src.get("data"):
        return {"type": "image_url", "image_url": {"url": f"data:{src.get('media_type') or 'image/png'};base64,"
                                                          f"{src['data']}"}}
    if src.get("type") == "url" and src.get("url"):
        return {"type": "image_url", "image_url": {"url": src["url"]}}
    return None


def encode_id(orig: str, extra: dict | None) -> str:
    """The id Claude Code sees for a provider's tool call: plain when there's nothing to carry, else with it."""
    if not extra and orig and NAME_OK.match(orig) and not orig.startswith(ID_PREFIX):
        return orig
    raw = json.dumps({"i": orig, "x": extra or None}, separators=(",", ":")).encode()
    return ID_PREFIX + base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_id(tid: str) -> tuple[str, dict | None]:
    if not tid.startswith(ID_PREFIX):
        return tid, None
    s = tid[len(ID_PREFIX):]
    try:
        d = json.loads(base64.urlsafe_b64decode(s + "=" * (-len(s) % 4)))
        return str(d.get("i") or tid), d.get("x") or None
    except (ValueError, TypeError):
        return tid, None


def tool_name(name: str) -> str:
    """A name every provider takes (letters, digits, _ and -, at most 64)."""
    if NAME_OK.match(name):
        return name
    clean = re.sub(r"[^a-zA-Z0-9_-]", "_", name)
    return f"{clean[:50]}_{hashlib.sha1(name.encode()).hexdigest()[:8]}"


def clean_schema(s, provider: str):
    if isinstance(s, list):
        return [clean_schema(x, provider) for x in s]
    if not isinstance(s, dict):
        return s
    drop = GEMINI_DROP if provider == "gemini" else {"$schema"}
    out = {}
    for k, v in s.items():
        if k in drop:
            continue
        if provider == "gemini" and k == "format" and v not in ("enum", "date-time"):
            continue
        if k in ("properties", "$defs", "definitions", "patternProperties") and isinstance(v, dict):
            out[k] = {pk: clean_schema(pv, provider) for pk, pv in v.items()}
        else:
            out[k] = clean_schema(v, provider)
    if out.get("type") == "object" and "properties" not in out:
        out["properties"] = {}
    return out


def to_chat(req: dict, st: dict) -> tuple[dict, dict]:
    """A Messages API request as a Chat Completions request for ``st`` (settings_from_env). Returns it and the map of
    tool names back to Claude Code's."""
    provider = st["provider"]
    msgs: list[dict] = []
    system = req.get("system")
    if system:
        msgs.append({"role": "system", "content": _text_of(system)})
    for m in req.get("messages") or []:
        role, content = m.get("role"), m.get("content")
        if isinstance(content, str):
            msgs.append({"role": role, "content": content})
            continue
        blocks = [b for b in content or [] if isinstance(b, dict)]
        if role == "assistant":
            text = "".join(str(b.get("text") or "") for b in blocks if b.get("type") == "text")
            extra = next((x for x in (unsign(str(b.get("signature") or "")) for b in blocks
                                      if b.get("type") == "thinking") if x), None)
            calls = []
            for b in blocks:
                if b.get("type") == "tool_use":
                    orig, extra = decode_id(str(b.get("id") or ""))
                    call = {"id": orig, "type": "function",
                            "function": {"name": tool_name(str(b.get("name") or "")),
                                         "arguments": json.dumps(b.get("input") or {})}}
                    if extra:
                        call["extra_content"] = extra
                    calls.append(call)
            out = {"role": "assistant", "content": text or None}
            if calls:
                out["tool_calls"] = calls
            if extra:
                out["extra_content"] = extra
            if text or calls:
                msgs.append(out)
            continue
        later_images = []
        for b in blocks:  # tool results first: they must follow the assistant's tool calls
            if b.get("type") != "tool_result":
                continue
            c = b.get("content")
            text = _text_of(c)
            if isinstance(c, list):
                later_images += [i for i in (_image(x) for x in c if isinstance(x, dict) and x.get("type") == "image")
                                 if i]
            msgs.append({"role": "tool", "tool_call_id": decode_id(str(b.get("tool_use_id") or ""))[0],
                         "content": ("Error: " if b.get("is_error") else "") + (text or "(no output)")})
        parts = []
        for b in blocks:
            t = b.get("type")
            if t == "text" and b.get("text"):
                parts.append({"type": "text", "text": b["text"]})
            elif t == "image":
                img = _image(b)
                if img:
                    parts.append(img)
            elif t == "document":
                parts.append({"type": "text", "text": "[a document was attached; it can't be shown to this model]"})
        parts += later_images
        if parts:
            only_text = all(p["type"] == "text" for p in parts)
            msgs.append({"role": "user", "content": "\n\n".join(p["text"] for p in parts) if only_text else parts})
    names: dict[str, str] = {}
    tools = []
    for t in req.get("tools") or []:
        if not isinstance(t, dict) or t.get("type") not in (None, "custom") or not t.get("name"):
            continue  # Anthropic's own server tools (web search...) have no counterpart
        n = tool_name(t["name"])
        names[n] = t["name"]
        tools.append({"type": "function", "function": {"name": n, "description": str(t.get("description") or "")[:4000],
                                                       "parameters": clean_schema(t.get("input_schema") or
                                                                                  {"type": "object"}, provider)}})
    out = {"model": st["model"], "messages": msgs}
    if tools:
        out["tools"] = tools
        tc = req.get("tool_choice") or {}
        kind = tc.get("type")
        if kind == "any":
            out["tool_choice"] = "required"
        elif kind == "tool" and tc.get("name"):
            out["tool_choice"] = {"type": "function", "function": {"name": tool_name(tc["name"])}}
        elif kind == "none":
            out["tool_choice"] = "none"
        if tc.get("disable_parallel_tool_use") and provider != "gemini":
            out["parallel_tool_calls"] = False
    mx = int(req.get("max_tokens") or 0)
    if st.get("max_out"):
        mx = min(mx, st["max_out"]) if mx else st["max_out"]
    if mx:
        out["max_completion_tokens" if provider in ("openai", "groq") else "max_tokens"] = mx
    if req.get("temperature") is not None and provider not in ("openai",):
        out["temperature"] = req["temperature"]
    if req.get("stop_sequences"):
        out["stop"] = list(req["stop_sequences"])[:4]
    if st.get("effort"):
        out["reasoning_effort"] = st["effort"]
    if provider == "gemini" and not st.get("no_thoughts"):
        out["extra_body"] = {"google": {"thinking_config": {"include_thoughts": True}}}
    if req.get("stream"):
        out["stream"] = True
        out["stream_options"] = {"include_usage": True}
    return out, names


def estimate_tokens(req: dict) -> int:
    """About how many tokens a request is (count_tokens, and message_start before the provider says)."""
    n = len(json.dumps(req.get("system") or "")) + len(json.dumps(req.get("messages") or [])) + \
        len(json.dumps(req.get("tools") or []))
    return max(1, n // 4)


# ------------------------------------------------------------------ answers: OpenAI -> Anthropic
def usage_of(u: dict | None) -> dict:
    u = u or {}
    prompt = int(u.get("prompt_tokens") or 0)
    cached = int((u.get("prompt_tokens_details") or {}).get("cached_tokens") or 0)
    return {"input_tokens": max(0, prompt - cached), "output_tokens": int(u.get("completion_tokens") or 0),
            "cache_read_input_tokens": cached, "cache_creation_input_tokens": 0}


def _reasoning(d: dict) -> str:
    for k in ("reasoning_content", "reasoning", "reasoning_text", "thinking"):
        v = d.get(k)
        if isinstance(v, str) and v:
            return v
    return ""


class Thoughts:
    """Splits Gemini's ``<thought>...</thought>`` parts out of streamed text (a tag may be cut across two chunks)."""
    OPEN, CLOSE = "<thought>", "</thought>"

    def __init__(self):
        self.buf, self.inside = "", False

    def feed(self, s: str) -> list[tuple[str, str]]:
        self.buf += s
        out: list[tuple[str, str]] = []
        while self.buf:
            tag = self.CLOSE if self.inside else self.OPEN
            i = self.buf.find(tag)
            if i >= 0:
                if i:
                    out.append(("thinking" if self.inside else "text", self.buf[:i]))
                self.buf, self.inside = self.buf[i + len(tag):], not self.inside
                continue
            keep = next((k for k in range(min(len(tag) - 1, len(self.buf)), 0, -1) if tag.startswith(self.buf[-k:])), 0)
            emit = self.buf[:len(self.buf) - keep]
            if emit:
                out.append(("thinking" if self.inside else "text", emit))
            self.buf = self.buf[len(self.buf) - keep:]
            break
        return out

    def flush(self) -> list[tuple[str, str]]:
        out = [("thinking" if self.inside else "text", self.buf)] if self.buf else []
        self.buf = ""
        return out


SIGNATURE = "clodfarm-relay"


def sign(extra: dict | None) -> str:
    """A thinking block's signature: ours, carrying what the provider must see again with this message (Gemini's
    thought signature), which Claude Code sends back unchanged."""
    if not extra:
        return SIGNATURE
    return SIGNATURE + ":" + base64.urlsafe_b64encode(json.dumps(extra, separators=(",", ":")).encode()).decode()


def unsign(sig: str) -> dict | None:
    if not (sig or "").startswith(SIGNATURE + ":"):
        return None
    try:
        d = json.loads(base64.urlsafe_b64decode(sig[len(SIGNATURE) + 1:]))
        return d if isinstance(d, dict) else None
    except (ValueError, TypeError):
        return None


def from_chat(resp: dict, model: str, names: dict | None = None, provider: str = "") -> dict:
    """A whole Chat Completions answer as a Messages API answer."""
    names = names or {}
    ch = (resp.get("choices") or [{}])[0] or {}
    msg = ch.get("message") or {}
    content = []
    thought = _reasoning(msg)
    text = msg.get("content") if isinstance(msg.get("content"), str) else ""
    if provider == "gemini":
        t = Thoughts()
        pieces = t.feed(text) + t.flush()
    else:
        pieces = [("text", text)] if text else []
    if thought:
        content.append({"type": "thinking", "thinking": thought, "signature": SIGNATURE})
    for kind, s in pieces:
        if kind == "thinking":
            content.append({"type": "thinking", "thinking": s, "signature": SIGNATURE})
        elif s.strip() or not content:
            content.append({"type": "text", "text": s})
    for tc in msg.get("tool_calls") or []:
        fn = tc.get("function") or {}
        try:
            args = json.loads(fn.get("arguments") or "{}")
        except ValueError:
            args = {"_raw": fn.get("arguments")}
        content.append({"type": "tool_use", "id": encode_id(tc.get("id") or f"call_{secrets.token_hex(6)}",
                                                            tc.get("extra_content")),
                        "name": names.get(fn.get("name"), fn.get("name") or ""), "input": args if isinstance(args, dict)
                        else {"value": args}})
    if msg.get("extra_content"):  # the message's own signature rides on its (last) thinking block
        th = [b for b in content if b["type"] == "thinking"]
        if th:
            th[-1]["signature"] = sign(msg["extra_content"])
        else:
            content.insert(0, {"type": "thinking", "thinking": "", "signature": sign(msg["extra_content"])})
    stop = "tool_use" if msg.get("tool_calls") else STOP.get(ch.get("finish_reason") or "stop", "end_turn")
    return {"id": f"msg_{resp.get('id') or secrets.token_hex(8)}", "type": "message", "role": "assistant",
            "model": model, "content": content or [{"type": "text", "text": ""}], "stop_reason": stop,
            "stop_sequence": None, "usage": usage_of(resp.get("usage"))}


def sse(event: str, data: dict) -> bytes:
    return f"event: {event}\ndata: {json.dumps(data, separators=(',', ':'))}\n\n".encode()


class Stream:
    """Turns a Chat Completions stream (its chunks, in order) into Messages API stream events. Text and thinking
    stream as they come; tool calls are collected and sent whole at the end (parallel calls may interleave)."""

    def __init__(self, model: str, names: dict | None = None, input_estimate: int = 0, provider: str = ""):
        self.model, self.names = model, names or {}
        self.index = -1
        self.open: str | None = None  # the kind of the content block being streamed
        self.calls: dict[int, dict] = {}
        self.finish: str | None = None
        self.usage: dict = {}
        self.thoughts = Thoughts() if provider == "gemini" else None
        self.extra: dict | None = None  # the message's own signature (Gemini), sent back with it next turn
        # Gemini sends that signature after the text: its text is held to the end, so the signature goes on the
        # thinking before it (Claude Code takes a run's result from the last block of its last message)
        self.held: list[str] | None = [] if provider == "gemini" else None
        self.started = False
        self.input_estimate = input_estimate

    def start(self) -> list[bytes]:
        self.started = True
        return [sse("message_start", {"type": "message_start", "message": {
            "id": f"msg_{secrets.token_hex(12)}", "type": "message", "role": "assistant", "model": self.model,
            "content": [], "stop_reason": None, "stop_sequence": None,
            "usage": {"input_tokens": self.input_estimate, "output_tokens": 1, "cache_read_input_tokens": 0,
                      "cache_creation_input_tokens": 0}}})]

    def _close(self, extra: dict | None = None) -> list[bytes]:
        if self.open is None:
            return []
        out = []
        if self.open == "thinking":
            out.append(sse("content_block_delta", {"type": "content_block_delta", "index": self.index,
                                                   "delta": {"type": "signature_delta", "signature": sign(extra)}}))
        out.append(sse("content_block_stop", {"type": "content_block_stop", "index": self.index}))
        self.open = None
        return out

    def _put(self, kind: str, s: str) -> list[bytes]:
        if not s:
            return []
        if kind == "text" and self.held is not None:
            self.held.append(s)
            return []
        out = []
        if self.open != kind:
            out += self._close()
            self.index += 1
            self.open = kind
            block = {"type": "thinking", "thinking": "", "signature": ""} if kind == "thinking" else \
                {"type": "text", "text": ""}
            out.append(sse("content_block_start", {"type": "content_block_start", "index": self.index,
                                                   "content_block": block}))
        delta = {"type": "thinking_delta", "thinking": s} if kind == "thinking" else {"type": "text_delta", "text": s}
        out.append(sse("content_block_delta", {"type": "content_block_delta", "index": self.index, "delta": delta}))
        return out

    def feed(self, chunk: dict) -> list[bytes]:
        out = [] if self.started else self.start()
        if chunk.get("usage"):
            self.usage = chunk["usage"]
        for ch in chunk.get("choices") or []:
            d = ch.get("delta") or {}
            if d.get("extra_content") and not d.get("tool_calls"):
                self.extra = d["extra_content"]
            out += self._put("thinking", _reasoning(d))
            text = d.get("content")
            if isinstance(text, str) and text:
                for kind, s in (self.thoughts.feed(text) if self.thoughts else [("text", text)]):
                    out += self._put(kind, s)
            for tc in d.get("tool_calls") or []:
                k = int(tc.get("index") if tc.get("index") is not None else len(self.calls))
                c = self.calls.setdefault(k, {"id": "", "name": "", "args": "", "extra": None})
                c["id"] = c["id"] or tc.get("id") or ""
                fn = tc.get("function") or {}
                if fn.get("name") and not c["name"]:
                    c["name"] = fn["name"]
                c["args"] += fn.get("arguments") or ""
                if tc.get("extra_content"):
                    c["extra"] = tc["extra_content"]
            if ch.get("finish_reason"):
                self.finish = ch["finish_reason"]
        return out

    def end(self) -> list[bytes]:
        out = [] if self.started else self.start()
        if self.thoughts:
            for kind, s in self.thoughts.flush():
                out += self._put(kind, s)
        if self.extra and self.open != "thinking":  # nothing to carry it: an empty thinking block of its own
            out += self._close()
            self.index += 1
            self.open = "thinking"
            out.append(sse("content_block_start", {"type": "content_block_start", "index": self.index,
                                                   "content_block": {"type": "thinking", "thinking": "",
                                                                     "signature": ""}}))
        out += self._close(self.extra)
        held, self.held = "".join(self.held or []), None
        out += self._put("text", held)
        out += self._close()
        for k in sorted(self.calls):
            c = self.calls[k]
            self.index += 1
            tid = encode_id(c["id"] or f"call_{secrets.token_hex(6)}", c["extra"])
            out.append(sse("content_block_start", {"type": "content_block_start", "index": self.index, "content_block": {
                "type": "tool_use", "id": tid, "name": self.names.get(c["name"], c["name"]), "input": {}}}))
            args = c["args"].strip() or "{}"
            try:
                json.loads(args)
            except ValueError:
                args = json.dumps({"_raw": c["args"]})
            out.append(sse("content_block_delta", {"type": "content_block_delta", "index": self.index,
                                                   "delta": {"type": "input_json_delta", "partial_json": args}}))
            out.append(sse("content_block_stop", {"type": "content_block_stop", "index": self.index}))
        stop = "tool_use" if self.calls else STOP.get(self.finish or "stop", "end_turn")
        out.append(sse("message_delta", {"type": "message_delta", "delta": {"stop_reason": stop, "stop_sequence": None},
                                         "usage": usage_of(self.usage)}))
        out.append(sse("message_stop", {"type": "message_stop"}))
        return out


# ------------------------------------------------------------------ OpenAI's Responses API
# OpenAI's newest models take tools with reasoning only there (not in Chat Completions), and it is the one that
# returns reasoning summaries. Its reasoning items (encrypted, as the farm keeps nothing on OpenAI's side) go back on
# the next turn, carried in the thinking block's signature like Gemini's thought signatures.
def to_responses(req: dict, st: dict) -> tuple[dict, dict]:
    items: list[dict] = []
    for m in req.get("messages") or []:
        role, content = m.get("role"), m.get("content")
        if isinstance(content, str):
            content = [{"type": "text", "text": content}]
        blocks = [b for b in content or [] if isinstance(b, dict)]
        if role == "assistant":
            for b in blocks:
                t = b.get("type")
                if t == "thinking":
                    x = unsign(str(b.get("signature") or "")) or {}
                    if isinstance(x.get("openai"), dict):
                        items.append(x["openai"])
                elif t == "text" and b.get("text"):
                    items.append({"type": "message", "role": "assistant",
                                  "content": [{"type": "output_text", "text": b["text"]}]})
                elif t == "tool_use":
                    items.append({"type": "function_call", "call_id": decode_id(str(b.get("id") or ""))[0],
                                  "name": tool_name(str(b.get("name") or "")),
                                  "arguments": json.dumps(b.get("input") or {})})
            continue
        parts = []
        for b in blocks:
            t = b.get("type")
            if t == "tool_result":
                c = b.get("content")
                items.append({"type": "function_call_output", "call_id": decode_id(str(b.get("tool_use_id") or ""))[0],
                              "output": ("Error: " if b.get("is_error") else "") + (_text_of(c) or "(no output)")})
                for x in c if isinstance(c, list) else []:
                    img = _image(x) if isinstance(x, dict) and x.get("type") == "image" else None
                    if img:
                        parts.append({"type": "input_image", "image_url": img["image_url"]["url"]})
            elif t == "text" and b.get("text"):
                parts.append({"type": "input_text", "text": b["text"]})
            elif t == "image":
                img = _image(b)
                if img:
                    parts.append({"type": "input_image", "image_url": img["image_url"]["url"]})
            elif t == "document":
                parts.append({"type": "input_text", "text": "[a document was attached; it can't be shown to this model]"})
        if parts:
            items.append({"role": "developer" if role == "system" else "user", "content": parts})
    names: dict[str, str] = {}
    tools = []
    for t in req.get("tools") or []:
        if not isinstance(t, dict) or t.get("type") not in (None, "custom") or not t.get("name"):
            continue
        n = tool_name(t["name"])
        names[n] = t["name"]
        tools.append({"type": "function", "name": n, "description": str(t.get("description") or "")[:4000],
                      "parameters": clean_schema(t.get("input_schema") or {"type": "object"}, "openai"),
                      "strict": False})
    out = {"model": st["model"], "input": items, "store": False}
    if req.get("system"):
        out["instructions"] = _text_of(req["system"])
    if tools:
        out["tools"] = tools
        tc = req.get("tool_choice") or {}
        if tc.get("type") == "any":
            out["tool_choice"] = "required"
        elif tc.get("type") == "tool" and tc.get("name"):
            out["tool_choice"] = {"type": "function", "name": tool_name(tc["name"])}
        elif tc.get("type") == "none":
            out["tool_choice"] = "none"
        if tc.get("disable_parallel_tool_use"):
            out["parallel_tool_calls"] = False
    mx = int(req.get("max_tokens") or 0)
    if st.get("max_out"):
        mx = min(mx, st["max_out"]) if mx else st["max_out"]
    if mx:
        out["max_output_tokens"] = max(mx, 16)
    if not st.get("no_reasoning"):
        out["reasoning"] = {"summary": "auto", **({"effort": st["effort"]} if st.get("effort") else {})}
        out["include"] = ["reasoning.encrypted_content"]
    if req.get("stream"):
        out["stream"] = True
    return out, names


def usage_of_responses(u: dict | None) -> dict:
    u = u or {}
    inp = int(u.get("input_tokens") or 0)
    cached = int((u.get("input_tokens_details") or {}).get("cached_tokens") or 0)
    return {"input_tokens": max(0, inp - cached), "output_tokens": int(u.get("output_tokens") or 0),
            "cache_read_input_tokens": cached, "cache_creation_input_tokens": 0}


def _reasoning_item(item: dict) -> dict:
    """What goes back next turn: the reasoning item as OpenAI gave it (its id, summary and encrypted content)."""
    return {k: item[k] for k in ("type", "id", "summary", "encrypted_content") if k in item}


def _summary(item: dict) -> str:
    return "\n\n".join(str(p.get("text") or "") for p in item.get("summary") or [] if isinstance(p, dict)).strip()


def from_responses(resp: dict, model: str, names: dict | None = None) -> dict:
    names = names or {}
    content, calls = [], False
    for item in resp.get("output") or []:
        t = item.get("type")
        if t == "reasoning":
            content.append({"type": "thinking", "thinking": _summary(item),
                            "signature": sign({"openai": _reasoning_item(item)})})
        elif t == "message":
            text = "".join(str(c.get("text") or "") for c in item.get("content") or [] if c.get("type") == "output_text")
            if text:
                content.append({"type": "text", "text": text})
        elif t == "function_call":
            calls = True
            try:
                args = json.loads(item.get("arguments") or "{}")
            except ValueError:
                args = {"_raw": item.get("arguments")}
            content.append({"type": "tool_use", "id": encode_id(item.get("call_id") or f"call_{secrets.token_hex(6)}",
                                                                None),
                            "name": names.get(item.get("name"), item.get("name") or ""),
                            "input": args if isinstance(args, dict) else {"value": args}})
    incomplete = (resp.get("incomplete_details") or {}).get("reason")
    stop = "tool_use" if calls else "max_tokens" if incomplete == "max_output_tokens" else "end_turn"
    return {"id": f"msg_{resp.get('id') or secrets.token_hex(8)}", "type": "message", "role": "assistant",
            "model": model, "content": content or [{"type": "text", "text": ""}], "stop_reason": stop,
            "stop_sequence": None, "usage": usage_of_responses(resp.get("usage"))}


class ResponsesStream(Stream):
    """A Responses API stream (its events, in order) as Messages API stream events: reasoning summaries stream as
    thinking, text as text, function calls are sent whole at the end."""

    def __init__(self, model: str, names: dict | None = None, input_estimate: int = 0, provider: str = ""):
        super().__init__(model, names, input_estimate, provider="")
        self.calls_list: list[dict] = []
        self.incomplete = ""
        self.failed = False

    def feed(self, ev: dict) -> list[bytes]:
        out = [] if self.started else self.start()
        t = ev.get("type") or ""
        if t == "response.reasoning_summary_text.delta":
            out += self._put("thinking", ev.get("delta") or "")
        elif t == "response.reasoning_summary_part.added" and self.open == "thinking":
            out += self._put("thinking", "\n\n")
        elif t == "response.output_text.delta":
            out += self._put("text", ev.get("delta") or "")
        elif t == "response.output_item.done":
            item = ev.get("item") or {}
            if item.get("type") == "reasoning":  # its summary streamed already: close it, carrying the item
                if self.open != "thinking":
                    out += self._close()
                    self.index += 1
                    self.open = "thinking"
                    out.append(sse("content_block_start", {"type": "content_block_start", "index": self.index,
                                                           "content_block": {"type": "thinking", "thinking": "",
                                                                             "signature": ""}}))
                out += self._close({"openai": _reasoning_item(item)})
            elif item.get("type") == "function_call":
                self.calls_list.append(item)
        elif t in ("response.completed", "response.incomplete"):
            r = ev.get("response") or {}
            self.usage = r.get("usage") or {}
            self.incomplete = (r.get("incomplete_details") or {}).get("reason") or ""
        elif t in ("response.failed", "error"):
            err = (ev.get("response") or {}).get("error") or ev
            self.failed = True
            out.append(sse("error", error_of(500, json.dumps({"error": err}).encode())[1]))
        return out

    def end(self) -> list[bytes]:
        out = [] if self.started else self.start()
        out += self._close()
        for i, c in enumerate(self.calls_list):
            self.calls[i] = {"id": c.get("call_id") or "", "name": c.get("name") or "", "args": c.get("arguments") or "",
                             "extra": None}
        self.finish = "tool_calls" if self.calls else "length" if self.incomplete == "max_output_tokens" else "stop"
        self.held = None
        usage, self.usage = self.usage, {}
        frames = super().end()
        # Stream.end reports Chat Completions usage: put the Responses figures in its message_delta
        for k, f in enumerate(frames):
            if f.startswith(b"event: message_delta"):
                d = json.loads(f.split(b"data: ", 1)[1])
                d["usage"] = usage_of_responses(usage)
                frames[k] = sse("message_delta", d)
        return out + frames


def error_of(code: int, body: bytes) -> tuple[int, dict]:
    """A provider's error as Anthropic's API would say it."""
    try:
        d = json.loads(body or b"{}")
    except ValueError:
        d = {}
    err = d[0] if isinstance(d, list) and d else d  # Gemini answers some errors as a list
    e = err.get("error") if isinstance(err, dict) else None
    msg = (e.get("message") if isinstance(e, dict) else e if isinstance(e, str) else "") or \
        (body or b"").decode("utf-8", "replace")[:300] or f"the provider answered {code}"
    msg = str(msg)[:1000]
    if code in (400, 413, 422) and CONTEXT_FULL.search(msg):
        return 400, _err("invalid_request_error", f"prompt is too long: {msg}")
    kind = {400: "invalid_request_error", 401: "authentication_error", 403: "permission_error", 404: "not_found_error",
            413: "request_too_large", 422: "invalid_request_error", 429: "rate_limit_error"}.get(code)
    if kind:
        return code, _err(kind, msg)
    if code == 503:
        return 529, _err("overloaded_error", msg)
    return (code if code >= 500 else 500), _err("api_error", msg)


def _err(kind: str, msg: str) -> dict:
    return {"type": "error", "error": {"type": kind, "message": msg}}


# ------------------------------------------------------------------ the server
class Relay:
    def __init__(self, st: dict, key: str, token: str, timeout: float = 600):
        self.st, self.key, self.token, self.timeout = dict(st), key, token, timeout
        self.lock = threading.Lock()

    @property
    def responses(self) -> bool:
        return self.st.get("dialect") == "responses"

    def _call(self, body: dict):
        headers = {"Content-Type": "application/json", "User-Agent": "clodfarm-relay"}
        if self.key:
            headers["Authorization"] = f"Bearer {self.key}"
        req = urllib.request.Request(self.st["url"].rstrip("/") + ("/responses" if self.responses else
                                                                   "/chat/completions"),
                                     data=json.dumps(body).encode(), headers=headers, method="POST")
        return urllib.request.urlopen(req, timeout=self.timeout)

    def ask(self, req: dict):
        """Send it on, once more without Gemini's thoughts (or OpenAI's reasoning summaries) if the model doesn't
        take them. Returns the open response, and the tool names map; raises HTTPError/URLError/OSError."""
        body, names = (to_responses if self.responses else to_chat)(req, self.st)
        try:
            return self._call(body), names
        except urllib.error.HTTPError as e:
            extra = "reasoning" if self.responses else "extra_body"
            if e.code != 400 or extra not in body:
                raise
            detail = e.read(1 << 16)
            if not re.search(rb"extra_body|thinking|thought|reasoning|summary|encrypted|include|unknown|invalid",
                             detail, re.I):
                raise urllib.error.HTTPError(e.url, e.code, e.msg, e.headers, _Body(detail)) from None
            with self.lock:
                self.st["no_reasoning" if self.responses else "no_thoughts"] = True
            for k in ("reasoning", "include", "extra_body"):
                body.pop(k, None)
            return self._call(body), names

    def answer(self, got: dict, names: dict) -> dict:
        """A whole answer from the provider, as Anthropic's API would give it."""
        if self.responses:
            return from_responses(got, self.st["model"], names)
        return from_chat(got, self.st["model"], names, self.st["provider"])

    def stream(self, names: dict, req: dict) -> Stream:
        cls = ResponsesStream if self.responses else Stream
        return cls(self.st["model"], names, estimate_tokens(req), self.st["provider"])


class _Body:
    def __init__(self, data: bytes):
        self.data = data

    def read(self, *_):
        d, self.data = self.data, b""
        return d

    def close(self):
        pass


def make_handler(relay: Relay):
    class H(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *a):
            pass

        def _send(self, code: int, data: dict, headers: dict | None = None):
            raw = json.dumps(data).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            for k, v in (headers or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(raw)

        def _authed(self) -> bool:
            got = self.headers.get("x-api-key") or ""
            auth = self.headers.get("Authorization") or ""
            if auth.lower().startswith("bearer "):
                got = auth[7:].strip()
            return hmac.compare_digest(got.encode(), relay.token.encode())

        def do_GET(self):
            if self.path in ("/healthz", "/"):
                return self._send(200, {"ok": True, "model": relay.st["model"], "provider": relay.st["provider"]})
            self._send(404, _err("not_found_error", "no such route"))

        def do_HEAD(self):
            self.send_response(200)
            self.send_header("Content-Length", "0")
            self.end_headers()

        def do_POST(self):
            path = self.path.split("?")[0]
            try:
                n = int(self.headers.get("Content-Length") or 0)
                req = json.loads(self.rfile.read(n) or b"{}")
            except (ValueError, OSError):
                return self._send(400, _err("invalid_request_error", "the body isn't JSON"))
            if not self._authed():
                return self._send(401, _err("authentication_error", "this relay belongs to another bot"))
            if path == "/v1/messages/count_tokens":
                return self._send(200, {"input_tokens": estimate_tokens(req)})
            if path != "/v1/messages":
                return self._send(404, _err("not_found_error", f"no route {path}"))
            try:
                resp, names = relay.ask(req)
            except urllib.error.HTTPError as e:
                code, body = error_of(e.code, e.read(1 << 20))
                ra = e.headers.get("retry-after") if e.headers else None
                return self._send(code, body, {"retry-after": ra} if ra else None)
            except (urllib.error.URLError, OSError, socket.timeout) as e:
                return self._send(529, _err("overloaded_error", f"can't reach the provider: "
                                                                f"{getattr(e, 'reason', e)}"))
            with resp:
                if not req.get("stream"):
                    try:
                        got = json.loads(resp.read())
                    except ValueError:
                        return self._send(502, _err("api_error", "the provider's answer isn't JSON"))
                    return self._send(200, relay.answer(got, names))
                self._stream(resp, relay.stream(names, req))

        def _stream(self, resp, s: Stream):
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "close")
            self.end_headers()
            self.close_connection = True
            lock, done = threading.Lock(), threading.Event()
            last = [time.time()]

            def write(frames: list[bytes]):
                if not frames:
                    return
                with lock:
                    self.wfile.write(b"".join(frames))
                    self.wfile.flush()
                    last[0] = time.time()

            def pinger():  # a reasoning model can think for minutes before its first word
                while not done.wait(1):
                    if time.time() - last[0] >= PING_EVERY:
                        try:
                            write([sse("ping", {"type": "ping"})])
                        except OSError:
                            return
            threading.Thread(target=pinger, daemon=True).start()
            try:
                write(s.start())
                for raw in resp:
                    line = raw.decode("utf-8", "replace").strip()
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                    except ValueError:
                        continue
                    if isinstance(chunk, dict) and chunk.get("error") and "type" not in chunk:
                        _, err = error_of(500, json.dumps(chunk).encode())
                        write([sse("error", err)])
                        return
                    write(s.feed(chunk))
                    if getattr(s, "failed", False):
                        return
                write(s.end())
            except (OSError, socket.timeout) as e:
                try:
                    write([sse("error", _err("overloaded_error", f"the provider's stream broke: {e}"))])
                except OSError:
                    pass
            finally:
                done.set()
    return H


def serve(relay: Relay, port: int = 0, ready=None) -> ThreadingHTTPServer:
    try:
        srv = ThreadingHTTPServer(("127.0.0.1", port), make_handler(relay))
    except OSError:
        srv = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(relay))  # its old port is taken: any port
    srv.daemon_threads = True
    if ready:
        ready(srv.server_address[1])
    return srv


# ------------------------------------------------------------------ its process
def state_path(workspace: str, aid: str) -> str:
    return os.path.join(workspace, ".farm", "relay", f"{aid}.json")


def _pidfile(workspace: str, aid: str) -> str:
    return os.path.join(procs.pids_dir(workspace), f"relay-{aid}.json")


def _marker(aid: str) -> str:
    return f"--tag relay-{aid}"


def main(aid: str):
    """``clodfarm relay --tag relay-<bot>``: run this bot's relay until it is stopped."""
    from . import boot, bots
    workspace = os.environ.get("FARM_WORKSPACE") or "/workspace"
    st = settings_from_env()
    if not st["url"] or not st["model"]:
        print("relay: no provider (FARM_BOT_UPSTREAM) or model (FARM_BOT)", file=sys.stderr)
        return 2
    path = state_path(workspace, aid)
    old = procs.read_json(path)
    token = old.get("token") or secrets.token_urlsafe(24)  # the same one: runs that outlive this relay keep it
    relay = Relay(st, bots.load_key(os.environ.get("CLAUDE_CONFIG_DIR") or ""), token)

    def ready(port: int):
        os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
        procs.write_json(path, {"pid": os.getpid(), "port": port, "token": token, "release": boot.running(),
                                "provider": st["provider"], "model": st["model"], "at": time.time()})
    srv = serve(relay, int(old.get("port") or 0), ready)
    print(f"relay for {aid}: {st['model']} at {st['url']} on 127.0.0.1:{srv.server_address[1]}", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


def ensure(workspace: str, aid: str, env: dict, wait: float = 15) -> tuple[str, str]:
    """This bot's relay, started if it isn't running (or runs an older release). Returns its base URL and token."""
    from . import boot
    pidfile, marker = _pidfile(workspace, aid), _marker(aid)
    pid = procs.live_pid(pidfile, marker)
    st = procs.read_json(state_path(workspace, aid))
    if pid and st.get("pid") == pid and st.get("port") and st.get("release") == boot.running():
        return f"http://127.0.0.1:{st['port']}", st["token"]
    if pid:
        procs.terminate(pid, marker, grace=5)
    os.makedirs(os.path.join(workspace, ".farm", "agents"), exist_ok=True)
    pid = procs.spawn_detached(workspace, boot.command(["relay", "--tag", f"relay-{aid}"]), env=env,
                               log=os.path.join(workspace, ".farm", "agents", f"relay-{aid}.log"), pidfile=pidfile,
                               cwd=workspace, meta={"relay": aid, "marker": marker})
    t0 = time.time()
    while time.time() - t0 < wait:
        st = procs.read_json(state_path(workspace, aid))
        if pid and st.get("pid") == pid and st.get("port"):
            return f"http://127.0.0.1:{st['port']}", st["token"]
        if pid and not procs.alive(pid):
            break
        time.sleep(0.05)
    raise RuntimeError(f"the relay for {aid} didn't start (see .farm/agents/relay-{aid}.log)")


def stop(workspace: str, aid: str):
    pid = procs.live_pid(_pidfile(workspace, aid), _marker(aid))
    if pid:
        procs.terminate(pid, _marker(aid), grace=5)
    for p in (_pidfile(workspace, aid), state_path(workspace, aid)):
        try:
            os.remove(p)
        except OSError:
            pass
