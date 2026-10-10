"""Give the farm work from Slack: DM the farm's bot or @mention it in a channel. A sub-agent does the job and answers
in the thread; `status` and `help` answer at once.

It uses Socket Mode: the farm opens an outbound WebSocket to Slack, so it needs no public URL and no open port (the
same as Remote Control). Setup is one Slack app, created from a prefilled manifest link (the farm UI's SLACK button,
or `clodfarm slack`), and two tokens pasted back: the bot token (xoxb-…) and an app-level token with
connections:write (xapp-…). They are kept in <workspace>/.farm/slack.json (mode 600), or come from
FARM_SLACK_BOT_TOKEN / FARM_SLACK_APP_TOKEN, and are never shown again.

Who can give it work: full members of the workspace the app is installed in, never guests, bots or people from another
organisation in a shared channel. An allow list (emails or Slack user ids, in the UI or FARM_SLACK_ALLOW) narrows that.
Every message is taken once, even with several boxes connected or when Slack retries.

Standard library only: a small RFC 6455 client is below.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import random
import re
import select
import socket
import ssl
import struct
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from .store import Store, now

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
API_URL = os.environ.get("FARM_SLACK_API_URL", "https://slack.com/api")  # a stand-in Slack in the end-to-end test
FINAL = ("done", "failed", "cancelled")
BOT_SCOPES = ["app_mentions:read", "chat:write", "im:history", "im:read", "im:write", "reactions:write", "users:read",
              "users:read.email", "channels:history", "groups:history", "mpim:history"]


class SlackError(Exception):
    pass


# ------------------------------------------------------------------ websocket
class WebSocket:
    """Just enough RFC 6455 for Slack's Socket Mode: TLS, text frames, fragments, ping/pong and close."""

    def __init__(self, url: str, timeout: float = 20):
        u = urllib.parse.urlsplit(url)
        if u.scheme != "wss" or not u.hostname:
            raise ConnectionError(f"not a wss:// URL: {url[:60]}")
        raw = socket.create_connection((u.hostname, u.port or 443), timeout=timeout)
        self.sock = ssl.create_default_context().wrap_socket(raw, server_hostname=u.hostname)
        self.lock = threading.Lock()
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall((f"GET {u.path or '/'}{'?' + u.query if u.query else ''} HTTP/1.1\r\nHost: {u.hostname}\r\n"
                           f"Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\n"
                           "Sec-WebSocket-Version: 13\r\nUser-Agent: clodfarm\r\n\r\n").encode())
        head = b""
        while b"\r\n\r\n" not in head:
            chunk = self.sock.recv(4096)
            if not chunk or len(head) > 65536:
                raise ConnectionError("the WebSocket handshake did not finish")
            head += chunk
        head, self.buf = head.split(b"\r\n\r\n", 1)
        lines = head.decode("latin-1").split("\r\n")
        if len(lines[0].split()) < 2 or lines[0].split()[1] != "101":
            raise ConnectionError(f"WebSocket refused: {lines[0][:80]}")
        hdrs = {k.strip().lower(): v.strip() for k, v in (x.split(":", 1) for x in lines[1:] if ":" in x)}
        if hdrs.get("sec-websocket-accept") != base64.b64encode(hashlib.sha1((key + GUID).encode()).digest()).decode():
            raise ConnectionError("bad Sec-WebSocket-Accept")

    def _read(self, n: int) -> bytes:
        while len(self.buf) < n:
            chunk = self.sock.recv(max(4096, n - len(self.buf)))
            if not chunk:
                raise ConnectionError("Slack closed the connection")
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def send(self, payload: bytes | str, opcode: int = 1):
        data = payload.encode() if isinstance(payload, str) else payload
        n, mask = len(data), os.urandom(4)
        head = bytes([0x80 | opcode]) + (bytes([0x80 | n]) if n < 126 else
                                         bytes([0x80 | 126]) + struct.pack("!H", n) if n < 65536 else
                                         bytes([0x80 | 127]) + struct.pack("!Q", n))
        body = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
        with self.lock:
            self.sock.sendall(head + mask + body)

    def recv(self, wait: float) -> str | None:
        """The next text message, "" when nothing arrived within ``wait`` seconds, None when Slack closed it."""
        if not self.buf and not self.sock.pending() and not select.select([self.sock], [], [], wait)[0]:
            return ""
        parts: list[bytes] = []
        while True:
            b1, b2 = self._read(2)
            n = b2 & 0x7F
            if n == 126:
                n = struct.unpack("!H", self._read(2))[0]
            elif n == 127:
                n = struct.unpack("!Q", self._read(8))[0]
            mask = self._read(4) if b2 & 0x80 else None
            data = self._read(n)
            if mask:
                data = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
            op = b1 & 0x0F
            if op in (9, 10):  # ping (answer it) or pong: nothing for the caller unless a message is half read
                if op == 9:
                    self.send(data, 10)
                if not parts:
                    return ""
            elif op == 8:
                try:
                    self.send(b"", 8)
                except OSError:
                    pass
                return None
            elif op in (0, 1, 2):
                parts.append(data)
                if b1 & 0x80:
                    return b"".join(parts).decode("utf-8", "replace")

    def close(self):
        try:
            self.send(b"", 8)
        except OSError:
            pass
        try:
            self.sock.close()
        except OSError:
            pass


# ------------------------------------------------------------------ Slack API
def api(method: str, token: str, **params) -> dict:
    """Call a Slack Web API method (form-encoded, so it works for read and write methods alike)."""
    body = urllib.parse.urlencode({k: json.dumps(v) if isinstance(v, (list, dict)) else v
                                   for k, v in params.items() if v is not None}).encode()
    for attempt in range(3):
        req = urllib.request.Request(f"{API_URL}/{method}", data=body, method="POST", headers={
            "Authorization": f"Bearer {token}", "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "clodfarm"})
        try:
            with urllib.request.urlopen(req, timeout=15, context=ssl.create_default_context()) as r:
                out = json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < 2:
                time.sleep(min(30, int(e.headers.get("Retry-After") or 1)))
                continue
            raise SlackError(f"{method}: HTTP {e.code}") from None
        if not out.get("ok"):
            raise SlackError(f"{method}: {out.get('error', 'failed')}")
        return out
    raise SlackError(f"{method}: rate limited")


def manifest(farm: str) -> dict:
    name = (f"clodfarm {farm}" if farm != "clodfarm" else "clodfarm")[:35]
    return {
        "display_information": {"name": name, "background_color": "#4f6b25",
                                "description": "Your clodfarm: DM it or @mention it and a Claude does the job.",
                                "long_description": "Talk to your clodfarm from Slack. DM this app or @mention it in a "
                                "channel: a Claude Code sub-agent on your farm does the job and answers in the thread. "
                                "Type status for the farm's Claudes and their usage."},
        "features": {"app_home": {"home_tab_enabled": False, "messages_tab_enabled": True,
                                  "messages_tab_read_only_enabled": False},
                     "bot_user": {"display_name": re.sub(r"[^a-z0-9._-]", "-", name.lower())[:80], "always_online": True}},
        "oauth_config": {"scopes": {"bot": BOT_SCOPES}},
        "settings": {"event_subscriptions": {"bot_events": ["app_mention", "message.im"]},
                     "interactivity": {"is_enabled": False}, "org_deploy_enabled": False,
                     "socket_mode_enabled": True, "token_rotation_enabled": False},
    }


def manifest_url(farm: str) -> str:
    """Slack's "create an app from this manifest" link, prefilled: pick the workspace and click Create."""
    return "https://api.slack.com/apps?new_app=1&manifest_json=" + urllib.parse.quote(
        json.dumps(manifest(farm), separators=(",", ":")))


def to_mrkdwn(md: str) -> str:
    """Claude writes Markdown; Slack reads mrkdwn. Headings and **bold** to *bold*, [t](u) to <u|t>, - to •."""
    out, code = [], False
    for line in md.splitlines():
        if line.lstrip().startswith("```"):
            code = not code
            out.append("```")
            continue
        if code:
            out.append(line)
            continue
        line = line.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        line = re.sub(r"^#{1,6}\s+(.+?)\s*#*$", r"*\1*", line)
        line = re.sub(r"\*\*(.+?)\*\*", r"*\1*", line)
        line = re.sub(r"\[([^\]]+)\]\((https?://[^)\s]+)\)", r"<\2|\1>", line)
        line = re.sub(r"^(\s*)[-*+]\s+", r"\1• ", line)
        out.append(line)
    return "\n".join(out)


# ------------------------------------------------------------------ settings
def settings_path(cfg) -> str:
    return os.path.join(cfg.workspace, ".farm", "slack.json")


def load_settings(cfg) -> dict:
    try:
        d = json.load(open(settings_path(cfg)))
    except (OSError, ValueError):
        d = {}
    for key, env in (("bot_token", "FARM_SLACK_BOT_TOKEN"), ("app_token", "FARM_SLACK_APP_TOKEN"),
                     ("allow", "FARM_SLACK_ALLOW")):
        if os.environ.get(env):
            d[key], d[key + "_from_env"] = os.environ[env], True
    if isinstance(d.get("allow"), str):
        d["allow"] = [x.strip() for x in re.split(r"[,\s]+", d["allow"]) if x.strip()]
    return d


def save_settings(cfg, d: dict):
    path = settings_path(cfg)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    keep = {k: v for k, v in d.items() if not k.endswith("_from_env")}
    tmp = path + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(keep, f)
    os.replace(tmp, path)


# -------------------------------------------------------------------- bridge
HELP = ("I'm this farm's Claude. Ask me for anything, like you would in the Claude app: a sub-agent does it and "
        "answers in this thread.\n"
        "• `status`: the Claudes on the farm, their usage and what's running\n"
        "• it runs on your own Claude if you have one on the farm, else on a random Claude with room\n"
        "• `gil: review the open PRs`: run it on gil's account (any Claude on the farm)\n"
        "• reply in the thread to follow up (in a channel, @mention me there)")


class SlackBridge:
    def __init__(self, cfg, store: Store):
        self.cfg, self.store = cfg, store
        self.state, self.error, self.info = "off", "", {}
        self.last: dict | None = None
        self._stop = threading.Event()
        self._threads: list[threading.Thread] = []
        self._ws: WebSocket | None = None
        self._users: dict[str, tuple[float, dict]] = {}

    # ------------------------------------------------------ lifecycle
    def settings(self) -> dict:
        return load_settings(self.cfg)

    def start(self):
        s = self.settings()
        if not (s.get("bot_token") and s.get("app_token")):
            self.state = "off"
            return
        self._stop = threading.Event()
        self.info = s.get("info") or {}
        self.state, self.error = "connecting", ""
        stop = self._stop
        self._threads = [threading.Thread(target=self._run, args=(stop,), name="slack", daemon=True),
                         threading.Thread(target=self._deliver_loop, args=(stop,), name="slack-results", daemon=True)]
        for t in self._threads:
            t.start()

    def stop(self):
        self._stop.set()
        ws, self._ws = self._ws, None
        if ws:
            ws.close()
        self.state = "off"

    def connect(self, bot_token: str, app_token: str, allow: list[str] | None = None, ui_url: str = "") -> dict:
        """Check both tokens with Slack, save them and connect. Raises ValueError with a message a person can act on."""
        bot_token, app_token = bot_token.strip(), app_token.strip()
        if not bot_token.startswith("xoxb-"):
            raise ValueError("the bot token starts with xoxb- (OAuth & Permissions → Bot User OAuth Token)")
        if not app_token.startswith("xapp-"):
            raise ValueError("the app-level token starts with xapp- (Basic Information → App-Level Tokens)")
        try:
            who = api("auth.test", bot_token)
        except SlackError as e:
            raise ValueError(f"Slack refused the bot token ({e}). Is the app installed to the workspace?") from None
        try:
            api("apps.connections.open", app_token)
        except SlackError as e:
            hint = " Is Socket Mode on, and does the token have connections:write?" if "not_allowed" in str(e) or \
                "missing_scope" in str(e) else ""
            raise ValueError(f"Slack refused the app-level token ({e}).{hint}") from None
        s = self.settings()
        s.update(bot_token=bot_token, app_token=app_token, allow=allow if allow is not None else s.get("allow", []),
                 ui_url=ui_url or s.get("ui_url", ""), connected_at=now(),
                 info={"team": who.get("team"), "team_id": who.get("team_id"), "url": who.get("url"),
                       "bot_user_id": who.get("user_id"), "bot_name": who.get("user"), "bot_id": who.get("bot_id")})
        save_settings(self.cfg, s)
        self.stop()
        self.start()
        self.store.event("slack.connected", f"Slack connected: {who.get('team')} as @{who.get('user')}", by="ui")
        return self.view()

    def disconnect(self):
        self.stop()
        try:
            os.remove(settings_path(self.cfg))
        except FileNotFoundError:
            pass
        self.info, self.error = {}, ""
        self.store.event("slack.disconnected", "Slack disconnected", by="ui")

    def set_allow(self, allow: list[str]):
        s = self.settings()
        s["allow"] = allow
        save_settings(self.cfg, s)

    def view(self) -> dict:
        """For the UI: never the tokens."""
        s, info = self.settings(), self.info or self.settings().get("info") or {}
        dm = (f"https://slack.com/app_redirect?app={info['app_id']}&team={info.get('team_id', '')}"
              if info.get("app_id") else info.get("url"))
        return {"configured": bool(s.get("bot_token") and s.get("app_token")), "state": self.state,
                "error": self.error, "team": info.get("team"), "bot": info.get("bot_name"), "workspace_url": info.get("url"),
                "dm_url": dm, "allow": s.get("allow") or [], "from_env": bool(s.get("bot_token_from_env")),
                "last": self.last, "manifest_url": manifest_url(self.cfg.farm)}

    # --------------------------------------------------- the connection
    def _run(self, stop: threading.Event):
        backoff = 2
        while not stop.is_set():
            try:
                self._session(stop)
                backoff = 2
            except (OSError, ConnectionError, SlackError, ValueError) as e:
                self.state, self.error = "retrying", str(e)[:200]
                if "invalid_auth" in str(e) or "token_revoked" in str(e) or "not_allowed" in str(e):
                    self.state = "error"
                    return  # a token that stopped working: wait for new ones from the UI
                stop.wait(backoff)
                backoff = min(backoff * 2, 60)

    def _session(self, stop: threading.Event):
        s = self.settings()
        ws = WebSocket(api("apps.connections.open", s["app_token"])["url"])
        self._ws, last_rx = ws, time.time()
        try:
            while not stop.is_set():
                msg = ws.recv(5)
                if msg is None:
                    return  # Slack closed it: reconnect
                if msg == "":
                    if time.time() - last_rx > 60:
                        ws.send(b"", 9)  # nothing for a minute: a ping keeps it honest
                    if time.time() - last_rx > 150:
                        return
                    continue
                last_rx = time.time()
                env = json.loads(msg)
                if env.get("envelope_id"):
                    ws.send(json.dumps({"envelope_id": env["envelope_id"]}))  # ack first: Slack retries after 3 s
                kind = env.get("type")
                if kind == "hello":
                    self.state, self.error = "live", ""
                    app_id = (env.get("connection_info") or {}).get("app_id")
                    if app_id and self.info.get("app_id") != app_id:
                        self.info["app_id"] = app_id
                        s = self.settings()
                        s["info"] = {**(s.get("info") or {}), "app_id": app_id}
                        save_settings(self.cfg, s)
                elif kind == "disconnect":
                    return
                elif kind == "events_api":
                    threading.Thread(target=self._safe_handle, args=(env.get("payload") or {},), daemon=True).start()
        finally:
            ws.close()
            if self._ws is ws:
                self._ws = None

    def _safe_handle(self, payload: dict):
        try:
            self.handle(payload)
        except Exception as e:  # noqa: BLE001 - one bad message must never take the bridge down
            self.store.event("slack.error", f"a Slack message failed: {type(e).__name__}: {str(e)[:160]}", by="slack")

    # ----------------------------------------------------- one message
    def handle(self, payload: dict) -> dict | None:
        """Take one Slack event. Returns the sub-agent it started, if any."""
        ev, s = payload.get("event") or {}, self.settings()
        bot, token = (s.get("info") or {}).get("bot_user_id"), s.get("bot_token")
        kind = ev.get("type")
        if kind == "message" and ev.get("channel_type") != "im":
            return None
        if kind not in ("message", "app_mention") or ev.get("subtype") or ev.get("bot_id") or not ev.get("user") \
                or ev.get("user") == bot:
            return None  # edits, joins, other bots and our own replies
        channel, ts = ev["channel"], ev["ts"]
        thread = ev.get("thread_ts") or ts
        # once per message: Slack retries, and every box of a multi-box farm may hold a connection
        if not self.store.b.put({"PK": "SLACKSEEN", "SK": f"{channel}#{ts}", "ver": 1,
                                 "expires_at": int(now() + 7 * 86400)}, expect_ver=0):
            return None
        text = re.sub(rf"<@{bot}>", "", ev.get("text") or "").strip() if bot else (ev.get("text") or "").strip()
        say = lambda t: api("chat.postMessage", token, channel=channel, thread_ts=thread, text=t,  # noqa: E731
                            unfurl_links=False, unfurl_media=False)
        user = self._user(ev["user"], token)
        ok, why = self._allowed(user, s)
        if not ok:
            say(why)
            return None
        asker = (user.get("profile") or {}).get("display_name") or user.get("real_name") or user.get("name") or "someone"
        self.last = {"at": now(), "from": asker, "text": text[:140]}
        cmd = text.lower().strip(" .!?")
        if cmd in ("", "help", "hi", "hello", "hey"):
            say(HELP)
            return None
        if cmd == "status":
            say(self._status())
            return None
        from .cli import _claudes
        from .config import _claude_name
        me, rows = _claude_name(self.cfg.farm, self.cfg.workspace), _claudes(self.cfg, self.store)
        m = re.match(r"^@?([a-z0-9._-]+)\s*[:,]\s*(.+)$", text, re.S)
        if m and m.group(1).lower() in {c["name"] for c in rows}:
            to, why, text = m.group(1).lower(), "", m.group(2).strip()  # "gil: ..." picks gil
        else:
            to, why = self._pick(user, rows)
        context = self._thread(channel, thread, ts, token, bot) if thread != ts else ""
        where = "in a direct message" if ev.get("channel_type") == "im" else f"in the Slack channel <#{channel}>"
        prompt = (f"{asker} asked you this in Slack ({where}):\n\n{text}\n\n"
                  + (f"Earlier in that Slack thread (oldest first):\n{context}\n\n" if context else "")
                  + f"Your final message is posted back to that Slack thread as your answer, so end with a reply "
                  f"written for {asker}: short and plain, Slack formatting (*bold*, `code`, bullet lines), at most "
                  "about 300 words. Say what you did, what's left, and anything you need from them. Anything that "
                  "needs a person (spending money, messages or posts outside the farm, credentials, deleting data): "
                  "don't do it, ask for it in your answer.")
        title = re.sub(r"\s+", " ", text.splitlines()[0] if text else "Slack request")[:80]
        t = self.store.add_task(title, prompt, created_by=f"slack:{asker}", to=to, owner=to or me,
                                max_depth=self.cfg.max_depth, max_attempts=self.cfg.max_attempts)
        self.store.b.put({"PK": "SLACKTASK", "SK": t["id"], "ver": 1, "channel": channel, "thread": thread, "ts": ts,
                          "asker": asker, "at": now(), "expires_at": int(now() + 14 * 86400)})
        self.store.event("slack.received", f"{asker} in Slack: {text[:160]}", task=t["id"], by=f"slack:{asker}")
        self._react(token, channel, ts, "eyes")
        link = s.get("ui_url")
        say(f"🌱 On it: sub-agent `{t['id']}` on {to or me}'s account{why}. I'll answer here when it's done."
            + (f" <{link}|Watch it on the farm>" if link else ""))
        return t

    @staticmethod
    def _pick(user: dict, rows: list[dict]) -> tuple[str | None, str]:
        """Which Claude runs a Slack request: the sender's own (their Slack email is the account's email), else a
        random Claude with room for a sub-agent now (or any Claude that is up). Returns (name, why) for the reply."""
        from .auth import seat_for
        email = ((user.get("profile") or {}).get("email") or "").strip()
        own = [c for c in rows if email and c.get("seat") == seat_for(email)]
        if own:
            c = own[0]
            return c["name"], " (yours)" + ("" if c["can_start"] else f": it's resting ({c['reason']}), it starts when it has room")
        pool = [c for c in rows if c["can_start"]] or rows
        if not pool:
            return None, ""  # no Claude is up: the first one that comes up takes it
        return random.choice(pool)["name"], " (picked at random: you have no Claude on this farm)"

    def _react(self, token, channel, ts, name, remove=False):
        try:
            api("reactions.remove" if remove else "reactions.add", token, channel=channel, timestamp=ts, name=name)
        except SlackError:
            pass  # a reaction is a nicety

    def _user(self, uid: str, token: str) -> dict:
        hit = self._users.get(uid)
        if hit and time.time() - hit[0] < 600:
            return hit[1]
        try:
            u = api("users.info", token, user=uid)["user"]
        except SlackError:
            u = {}
        self._users[uid] = (time.time(), u)
        return u

    def _allowed(self, u: dict, s: dict) -> tuple[bool, str]:
        team = (s.get("info") or {}).get("team_id")
        if not u or u.get("deleted") or u.get("is_bot"):
            return False, "Sorry, I only take work from people in this workspace."
        if team and u.get("team_id") not in (None, team):
            return False, "Sorry, I only take work from people in my own workspace, not from shared channels."
        if u.get("is_restricted") or u.get("is_ultra_restricted"):
            return False, "Sorry, guests can't give this farm work. Ask a member of the workspace."
        allow = [a.lower() for a in s.get("allow") or []]
        if allow:
            who = {u.get("id", "").lower(), (u.get("profile") or {}).get("email", "").lower(), u.get("name", "").lower()}
            if not who & set(allow):
                return False, "Sorry, you're not on this farm's list of people who can give it work. Ask its owner."
        return True, ""

    def _thread(self, channel, thread, ts, token, bot) -> str:
        try:
            msgs = api("conversations.replies", token, channel=channel, ts=thread, limit=40)["messages"]
        except SlackError:
            return ""
        lines = []
        for m in msgs:
            if m.get("ts") == ts:
                continue
            who = "you (the farm)" if m.get("user") == bot or m.get("bot_id") else \
                (self._user(m.get("user", ""), token).get("real_name") or "someone")
            lines.append(f"- {who}: {(m.get('text') or '')[:1500]}")
        return "\n".join(lines[-20:])

    def _status(self) -> str:
        from .cli import _claude_line, _claudes
        rows = _claudes(self.cfg, self.store)
        busy = self.store.list_tasks("running") + self.store.list_tasks("waiting") + self.store.list_tasks("queued", 20)
        ctl = self.store.control()
        return (f"*{self.cfg.farm}*" + (f" (paused: {ctl.get('reason') or 'by hand'})" if ctl.get("paused") else "")
                + "\n```" + ("\n".join(_claude_line(c).strip() for c in rows) or "no Claude is up") + "```\n"
                + (f"{len(busy)} sub-agent{'s' if len(busy) != 1 else ''} running or waiting:\n"
                   + "\n".join(f"• `{t['id']}` {t['status']}: {t['title'][:70]}" for t in busy[:10])
                   if busy else "No sub-agents running."))

    # ------------------------------------------------------- answers
    def _deliver_loop(self, stop: threading.Event):
        while not stop.wait(4):
            try:
                self.deliver()
            except Exception as e:  # noqa: BLE001
                self.error = f"posting results: {str(e)[:160]}"

    def deliver(self) -> int:
        """Post the answer of every finished Slack sub-agent in its thread. Returns how many were posted."""
        s = self.settings()
        token, n = s.get("bot_token"), 0
        if not token:
            return 0
        for rec in self.store.b.query("SLACKTASK"):
            t = self.store.get_task(rec["SK"])
            if t and t.get("status") not in FINAL:
                continue
            if not self.store.b.delete("SLACKTASK", rec["SK"], expect_ver=rec.get("ver")):
                continue  # another box posted it
            status = (t or {}).get("status", "lost")
            result = to_mrkdwn((t or {}).get("result") or "").strip()
            if len(result) > 3500:
                result = result[:3500].rsplit("\n", 1)[0] + f"\n… (the rest: `clodfarm result {rec['SK']}`)"
            text = {"done": result or "Done (no summary).",
                    "failed": f"I couldn't finish this. What happened:\n{result or '(no details)'}",
                    "cancelled": "This was cancelled on the farm.",
                    }.get(status, "I lost track of this job (the farm no longer has it).")
            api("chat.postMessage", token, channel=rec["channel"], thread_ts=rec["thread"], text=text[:3900],
                unfurl_links=False, unfurl_media=False)
            self._react(token, rec["channel"], rec["ts"], "eyes", remove=True)
            self._react(token, rec["channel"], rec["ts"], "white_check_mark" if status == "done" else "x")
            n += 1
        return n
