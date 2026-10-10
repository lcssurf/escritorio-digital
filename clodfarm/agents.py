"""Agents you add from the farm UI: each one is its own Claude Code login (a seat) with its own `clodfarm run`.

The container's own login is the *primary* agent; the farm daemon runs it. Every agent added in the UI gets a
Claude config dir of its own (``$CLAUDE_CONFIG_DIR/../clodfarm-agents/<id>`` by default, inside the claude-home
volume so the login survives restarts) and a child ``clodfarm run`` process with that dir. The children share the
farm's store and repo, so they join the same queue and are paced on their own account's budget, exactly like a
second box on a multi-seat farm.

Login runs ``claude auth login`` in a pseudo-terminal: the UI shows the URL it prints and types the code you paste
back into it. clodfarm never stores or logs that code, or any credential.

A *bot* (see bots.py) is an agent with a provider instead of a login: another model, through Claude Code.

FARM_MAX_CLAUDES caps how many agents (Claudes and bots, beyond the primary) the farm keeps, for a host whose plan
sizes the box: 0 means the primary is the farm's only Claude.
"""

from __future__ import annotations

import json
import os
import pty
import re
import secrets
import select
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time

from . import boot, bots, procs
from .auth import auth_status, claude_home, share_session_registry

ANSI = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Z0-9]|\x1b[=>]")
URL = re.compile(r"https://[^\s\"'<>]+")
ID_OK = re.compile(r"^[a-z0-9][a-z0-9-]{0,23}$")
_CRED_ENV = ("CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "FARM_SEAT")
HATS = ["straw", "beanie", "cap", "flower", "headphones", "bow", "crown", "leaf"]


def room_note(cap: int) -> str:
    """Why a farm at its host's cap (FARM_MAX_CLAUDES added agents) takes no more: its size, plainly."""
    total = cap + 1  # its own Claude, and the ones added
    return f"this farm has room for {total} Claude{'s' if total != 1 else ''}, and they're all here"


def slug(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:24].strip("-")
    return s or "claude-" + secrets.token_hex(2)


class LoginSession:
    """One ``claude auth login`` in a pseudo-terminal."""

    def __init__(self, claude_bin: str, config_dir: str, env: dict):
        self.config_dir, self.claude_bin = config_dir, claude_bin
        self.state = "starting"  # starting | waiting_code | checking | done | failed
        self.url: str | None = None
        self.error = ""
        self.tail = ""
        self.started = time.time()
        self._lock = threading.Lock()
        self.pid, self.fd = pty.fork()
        if self.pid == 0:  # child: become `claude auth login`
            try:
                os.execvpe(claude_bin, [claude_bin, "auth", "login", "--claudeai"], env)
            finally:
                os._exit(127)
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        buf = ""
        while True:
            try:
                r, _, _ = select.select([self.fd], [], [], 1.0)
                if not r:
                    if time.time() - self.started > 900:
                        self._finish("failed", "the login timed out after 15 minutes; start it again")
                        self.kill()
                        return
                    continue
                data = os.read(self.fd, 4096)
            except OSError:
                data = b""
            if not data:
                break
            text = ANSI.sub("", data.decode(errors="replace")).replace("\r", "\n")
            buf = (buf + text)[-8000:]
            with self._lock:
                self.tail = "\n".join(l for l in buf.splitlines() if l.strip())[-1500:]
                if not self.url:
                    # the URL can wrap over several terminal lines: join the lines that continue it
                    joined = re.sub(r"\n(?=[A-Za-z0-9%&=_.~+/-]{8,}\n?)", "", buf)
                    m = URL.search(joined)
                    if m and ("oauth" in m.group(0) or "authorize" in m.group(0) or "login" in m.group(0)):
                        self.url = m.group(0).rstrip(".,)")
                if self.url and self.state == "starting":
                    self.state = "waiting_code"
        try:
            _, status = os.waitpid(self.pid, 0)
        except ChildProcessError:
            status = 0
        ok = auth_status(self.claude_bin, self.config_dir).get("loggedIn")
        if ok:
            self._finish("done")
        else:
            last = self.tail.strip().splitlines()[-1:] or ["claude auth login exited"]
            self._finish("failed", f"not logged in ({last[0][:200]})")

    def _finish(self, state: str, error: str = ""):
        with self._lock:
            if self.state not in ("done", "failed"):
                self.state, self.error = state, error

    def submit(self, code: str):
        code = code.strip()
        if not code or len(code) > 4096 or any(c in code for c in "\r\n\x03\x04"):
            raise ValueError("that doesn't look like a login code")
        with self._lock:
            if self.state not in ("waiting_code", "starting"):
                raise ValueError(f"the login is {self.state}, not waiting for a code")
            self.state = "checking"
        os.write(self.fd, code.encode() + b"\r")

    def kill(self):
        try:
            os.kill(self.pid, signal.SIGTERM)
        except (ProcessLookupError, PermissionError):
            pass

    def view(self) -> dict:
        with self._lock:
            return {"state": self.state, "url": self.url, "error": self.error,
                    "age_s": round(time.time() - self.started)}


class AgentManager:
    """The registry of agents on this box, their child processes and their logins."""

    def __init__(self, cfg, primary_config_dir: str | None = None):
        self.cfg = cfg
        self.primary_dir = primary_config_dir or claude_home()
        # inside the claude-home volume, so an agent's login survives a new container
        self.base = os.environ.get("FARM_AGENTS_DIR") or os.path.join(self.primary_dir, "clodfarm-agents")
        self.registry = os.path.join(cfg.workspace, ".farm", "agents.json")
        self.logs = os.path.join(cfg.workspace, ".farm", "agents")
        self.logins: dict[str, LoginSession] = {}
        self._auth_cache: dict[str, tuple[float, dict]] = {}
        self._auth_busy: set[str] = set()
        self.leaving: set[str] = set()  # being released: never (re)start these
        self._lock = threading.RLock()
        self.stopping = threading.Event()

    # ------------------------------------------------------------- registry
    def _load(self) -> list[dict]:
        try:
            return json.load(open(self.registry)).get("agents", [])
        except (OSError, ValueError):
            return []

    def _save(self, agents: list[dict]):
        os.makedirs(os.path.dirname(self.registry), exist_ok=True)
        tmp = self.registry + ".tmp"
        with open(tmp, "w") as f:
            json.dump({"agents": agents}, f, indent=1)
        os.replace(tmp, self.registry)

    def primary(self) -> dict:
        return {"id": self.cfg.name, "name": self.cfg.name, "primary": True, "config_dir": self.primary_dir,
                "hat": "straw", "created": 0}

    def all(self) -> list[dict]:
        return [self.primary()] + self._load()

    def share_connectors(self):
        """A connector changed (Stripe): every Claude's tools and farm guide follow (their new sessions see it)."""
        from .auth import install_guide
        self.share_browser_tools()
        for a in self.all():
            try:
                install_guide(a["config_dir"])
            except (OSError, KeyError) as e:
                print(f"connectors: guide not updated for {a.get('id')}: {e}", flush=True)

    def share_browser_tools(self):
        """Every Claude on this box gets the MCP tools of its own browser profiles (their new sessions see a change)."""
        from .auth import install_browser_mcp
        for a in self.all():
            try:
                install_browser_mcp(os.path.join(a["config_dir"], ".claude.json") if not a.get("primary") else None,
                                    claude=a["id"], unowned=bool(a.get("primary")))
            except (OSError, KeyError) as e:
                print(f"browser: tools not given to {a.get('id')}: {e}", flush=True)

    def get(self, aid: str) -> dict | None:
        return next((a for a in self.all() if a["id"] == aid), None)

    @staticmethod
    def max_claudes() -> int | None:
        """The host's cap on added agents (FARM_MAX_CLAUDES), or None when there is none."""
        v = os.environ.get("FARM_MAX_CLAUDES", "").strip()
        return max(0, int(v)) if v.isdigit() else None

    def create(self, name: str, bot: dict | None = None, key: str = "", start: bool = True) -> dict:
        """A new agent: a Claude that waits for its login, or with ``bot`` (checked settings, see bots.parse) a bot on
        another model, whose API key is kept in its own config dir. ``start=False`` only registers it: the farm UI's
        process starts it (keep_alive), as it does for an agent registered from another process."""
        name = (name or "").strip()[:24] or ("Bot" if bot else "Claude")
        with self._lock:
            agents = self._load()
            cap = self.max_claudes()
            if cap is not None and len(agents) >= cap:
                raise ValueError(room_note(cap))
            taken = {a["id"] for a in self.all()}
            aid = slug(name)
            while aid in taken:
                aid = f"{slug(name)[:19]}-{secrets.token_hex(2)}"
            if not ID_OK.match(aid):
                raise ValueError("pick a name with letters or digits")
            d = os.path.join(self.base, aid)
            os.makedirs(d, mode=0o700, exist_ok=True)
            agent = {"id": aid, "name": name, "primary": False, "config_dir": d,
                     "hat": HATS[(len(agents) + 1) % len(HATS)], "created": time.time()}
            if bot:
                bots.save_key(d, key)
                agent.update(bot=bot, hat="headphones")
            self._save(agents + [agent])
        if start:
            self.spawn(agent)
        return agent

    def farm_id(self, aid: str) -> str:
        return f"{aid}@{socket.gethostname()}"  # what its `clodfarm run` calls itself (Config.farm_id)

    def remove(self, aid: str):
        """Release an agent: out of the registry first (so keep_alive can't bring it back), then stop its
        `clodfarm run` (which hands its tasks back), then log it out and delete its login."""
        with self._lock:
            agent = self.get(aid)
            if not agent or agent.get("primary"):
                raise ValueError("the primary agent is the farm itself; log it out with `clodfarm logout`")
            self.leaving.add(aid)
            self._save([a for a in self._load() if a["id"] != aid])
        try:
            self.stop_proc(aid)
            if agent.get("bot") and bots.relayed(agent["bot"]):
                from . import relay
                relay.stop(self.cfg.workspace, aid)
            s = self.logins.pop(aid, None)
            if s:
                s.kill()
            try:
                if not agent.get("bot"):  # a bot has no login: its key goes with its config dir
                    subprocess.run([self.cfg.claude_bin, "auth", "logout"], env=self.env_for(agent),
                                   capture_output=True, timeout=60, stdin=subprocess.DEVNULL)
            except (OSError, subprocess.TimeoutExpired):
                pass  # its login is deleted below either way
            if os.path.realpath(agent["config_dir"]).startswith(os.path.realpath(self.base) + os.sep):
                shutil.rmtree(agent["config_dir"], ignore_errors=True)
            self._auth_cache.pop(aid, None)
        finally:
            self.leaving.discard(aid)

    # ------------------------------------------------------------ processes
    def env_for(self, agent: dict) -> dict:
        env = dict(os.environ)
        env["CLAUDE_CONFIG_DIR"] = agent["config_dir"]
        if not agent.get("primary"):  # its own login only, never the container's token or key
            for k in _CRED_ENV:
                env.pop(k, None)
            env.pop("FARM_CLAUDE_NAME", None)  # that's the farm's own Claude, not this one
            env.update(FARM_NAME=agent["id"], FARM_HATCHED="1", FARM_FARM=self.cfg.farm, FARM_UI="0",
                       FARM_CONTAINER_NAME=os.environ.get("FARM_CONTAINER_NAME", "clodfarm"))
            if agent.get("bot"):
                env.update(bots.env(agent))
        return env

    # Each added Claude's `clodfarm run` is started detached, with a pid file: it keeps running while the farm daemon
    # (or the UI) that started it is replaced, and a new one finds it by that file instead of starting a second one.
    def _pidfile(self, aid: str) -> str:
        return os.path.join(procs.pids_dir(self.cfg.workspace), f"agent-{aid}.json")

    @staticmethod
    def _marker(aid: str) -> str:
        return f"--tag agent-{aid}"

    def pid(self, aid: str) -> int:
        return procs.live_pid(self._pidfile(aid), self._marker(aid))

    def spawn(self, agent: dict):
        if agent.get("primary") or self.stopping.is_set():
            return
        with self._lock:
            # the caller's copy may be stale: only start an agent that is still registered and not leaving
            if agent["id"] in self.leaving or all(a["id"] != agent["id"] for a in self._load()):
                return
            if self.pid(agent["id"]):
                return
            if self.cfg.share_sessions:  # before its sessions start: they register in the farm's one list
                try:
                    share_session_registry(agent["config_dir"], os.path.join(self.primary_dir, "sessions"))
                except OSError as e:
                    print(f"agent {agent['id']}: sessions not shared ({e}); SendMessage won't reach it", flush=True)
            os.makedirs(self.logs, exist_ok=True)
            procs.spawn_detached(self.cfg.workspace, boot.command(["run", "--tag", f"agent-{agent['id']}"]),
                                 env=self.env_for(agent), log=os.path.join(self.logs, f"{agent['id']}.log"),
                                 pidfile=self._pidfile(agent["id"]), cwd=self.cfg.workspace,
                                 meta={"agent": agent["id"]})

    def stop_proc(self, aid: str, wait: float = 20):
        """Stop its `clodfarm run`: it hands its running tasks back to the queue on the way out."""
        pid = self.pid(aid)
        if pid:
            procs.terminate(pid, self._marker(aid), grace=wait)
        try:
            os.remove(self._pidfile(aid))
        except OSError:
            pass

    def keep_alive(self):
        """Start every added agent and restart any that exit (run by the farm daemon). An agent's process that is no
        longer registered (released from another process) is stopped."""
        backoff: dict[str, float] = {}
        if os.environ.get("FARM_AGENTS_KEEP") == "0":  # a demo or load test: registered Claudes that never run
            return
        while not self.stopping.wait(5):
            try:
                os.makedirs(procs.pids_dir(self.cfg.workspace), exist_ok=True)
                draining = self._draining()
                agents = self._load()
                for a in agents:
                    if not self.pid(a["id"]) and not draining and time.time() >= backoff.get(a["id"], 0):
                        self.spawn(a)
                        backoff[a["id"]] = time.time() + 30
                ids = {a["id"] for a in agents}
                for n in os.listdir(procs.pids_dir(self.cfg.workspace)):
                    if n.startswith("agent-") and n.endswith(".json") and n[6:-5] not in ids \
                            and n[6:-5] not in self.leaving:
                        self.stop_proc(n[6:-5])
            except Exception as e:  # noqa: BLE001 - keep trying; never take the farm down
                print(f"agents: {e!r}", flush=True)

    def _draining(self) -> bool:
        """`clodfarm drain --exit`: an added Claude that finished and stopped isn't started again."""
        try:
            from .store import Store
            return bool(Store.from_config(self.cfg).box_control(socket.gethostname()).get("exit"))
        except Exception:  # noqa: BLE001
            return False

    def shutdown(self):
        self.stopping.set()
        for a in self._load():
            self.stop_proc(a["id"])
        for s in self.logins.values():
            s.kill()

    def hand_over(self):
        """SIGHUP every added Claude's `clodfarm run`: each execs the current release and keeps its runs."""
        for a in self._load():
            pid = self.pid(a["id"])
            if pid:
                try:
                    os.kill(pid, signal.SIGHUP)
                except (ProcessLookupError, PermissionError):
                    pass

    def alive(self, aid: str) -> bool:
        if aid == self.cfg.name:
            return True
        return bool(self.pid(aid))

    # ---------------------------------------------------------------- login
    def auth(self, agent: dict, max_age: float = 20, wait: bool = True, guess: dict | None = None) -> dict:
        """Its login (``claude auth status``). With ``wait=False`` (the farm UI, with a hundred Claudes) this never
        blocks: it answers from the cache, or with ``guess``, and looks again in the background."""
        if agent.get("bot"):  # no Claude login: its provider answered when it was added
            return {"loggedIn": True, "bot": True, "via": f"{bots.label(agent['bot'])} · {agent['bot']['model']}"}
        hit = self._auth_cache.get(agent["id"])
        s = self.logins.get(agent["id"])
        fresh = hit and time.time() - hit[0] < max_age and not (s and s.state == "done" and not hit[1].get("loggedIn"))
        if fresh:
            return hit[1]
        if not wait:
            self._refresh_auth(agent)
            return hit[1] if hit else (guess or {"loggedIn": False, "checking": True})
        return self._check_auth(agent)

    def _check_auth(self, agent: dict) -> dict:
        env_dir = None if agent.get("primary") else agent["config_dir"]
        st = auth_status(self.cfg.claude_bin, env_dir)
        self._auth_cache[agent["id"]] = (time.time(), st)
        return st

    def _refresh_auth(self, agent: dict):
        with self._lock:
            if agent["id"] in self._auth_busy or len(self._auth_busy) >= 4:
                return
            self._auth_busy.add(agent["id"])

        def go():
            try:
                self._check_auth(agent)
            except Exception:  # noqa: BLE001
                pass
            finally:
                self._auth_busy.discard(agent["id"])
        threading.Thread(target=go, daemon=True).start()

    def start_login(self, aid: str) -> LoginSession:
        agent = self.get(aid)
        if not agent:
            raise KeyError(aid)
        if agent.get("bot"):
            raise ValueError("a bot has no Claude login: its provider and key were checked when it was added")
        with self._lock:
            old = self.logins.get(aid)
            if old and old.state in ("starting", "waiting_code", "checking"):
                return old
            env = self.env_for(agent)
            env.setdefault("TERM", "xterm-256color")
            env["BROWSER"] = "/bin/true"  # nothing to open inside a container: the UI shows the URL instead
            s = LoginSession(self.cfg.claude_bin, agent["config_dir"], env)
            self.logins[aid] = s
            self._auth_cache.pop(aid, None)
            return s

    def login(self, aid: str) -> LoginSession | None:
        return self.logins.get(aid)
