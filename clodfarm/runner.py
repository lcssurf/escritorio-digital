"""Run one headless Claude Code agent and read its stream-json output.

claude runs under the run shim (runshim.py), detached from the farm's process, with its output in files. The farm
reads those files, so a new release of the farm can take over a run that is still going (``adopt``).
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from dataclasses import dataclass, field

from . import procs
from .governor import Snapshot

# Claude Code's wording when the subscription limit is hit and no rate_limit_event says so. Only ever matched
# against an *error* result, never against what the agent wrote (a task about rate limiting is not a rate limit).
LIMIT_TEXT = re.compile(r"usage limit|limit reached|limit will reset|out of (extra )?usage", re.I)


@dataclass
class RunResult:
    ok: bool
    text: str
    session_id: str | None = None
    cost_usd: float = 0.0
    usage: dict = field(default_factory=dict)
    terminal_reason: str | None = None
    num_turns: int = 0
    duration_s: float = 0.0
    snapshots: list = field(default_factory=list)
    rate_limited: bool = False
    timed_out: bool = False
    error_text: str = ""  # the result text when Claude Code reported an error
    init: dict = field(default_factory=dict)  # Claude Code's init event: its tools, MCP servers, skills, plugins
    abandoned: bool = False  # the farm handed over to a new release while it ran: it goes on, adopted there


def session_name(cfg, what: str = "") -> str:
    """How a farm session is named in the Claude app and claude.ai/code: always marked [clodfarm]."""
    who = cfg.name if cfg.name == cfg.farm else f"{cfg.farm} · {cfg.name}"
    return f"[clodfarm] {who}" + (f" · {what}" if what else "")


def build_cmd(cfg, system_prompt: str, resume_session: str | None = None, name: str = "", live: bool = False,
              disallowed: list[str] | None = None) -> list[str]:
    cmd = [cfg.claude_bin, "-p", "--output-format", "stream-json", "--verbose", "--name", name or session_name(cfg),
           "--model", cfg.model, "--permission-mode", cfg.permission_mode,
           "--append-system-prompt", system_prompt]
    if live:
        cmd += ["--input-format", "stream-json"]
    if getattr(cfg, "task_budget_usd", 0) and cfg.policy.api_mode:
        cmd += ["--max-budget-usd", str(cfg.task_budget_usd)]
    if getattr(cfg, "effort", ""):
        cmd += ["--effort", cfg.effort]
    if disallowed:  # the tools its person turned off (the PreToolUse hook enforces them too)
        cmd += ["--disallowedTools", ",".join(disallowed)]
    if resume_session:
        cmd += ["--resume", resume_session]
    return cmd


def _user_line(text: str) -> str:
    return json.dumps({"type": "user", "message": {"role": "user", "content": text}, "parent_tool_use_id": None,
                       "session_id": "default"}) + "\n"


class RunHandle:
    """A run started through the shim: the claude process lives on its own, and this reads its files. It stands in
    for the ``subprocess.Popen`` the farm used to hold (``pid``, ``poll``), and a new release adopts it by its
    directory."""

    def __init__(self, rundir: str):
        self.rundir = rundir
        self._rc: dict | None = None
        self._pid = 0

    def _shim(self) -> dict:
        return procs.read_json(os.path.join(self.rundir, "shim.json"))

    @property
    def pid(self) -> int:
        self._pid = self._pid or int(self._shim().get("child") or 0)
        return self._pid

    def rc(self) -> dict | None:
        if self._rc is None:
            self._rc = procs.read_json(os.path.join(self.rundir, "rc.json")) or None
        return self._rc

    def started(self) -> bool:
        return os.path.exists(os.path.join(self.rundir, "shim.json"))

    def shim_alive(self) -> bool:
        return procs.alive(self._shim().get("shim"), self.rundir)

    def poll(self):
        """None while it runs, else its exit code (-9 when its shim vanished without saying: the box died)."""
        rc = self.rc()
        if rc:
            return rc.get("rc")
        if not self._pid and self.started():
            self.pid  # noqa: B018 - remember it, for after the directory is gone
        if self._pid and not os.path.isdir(self.rundir):
            return -1  # finished, and the farm has cleaned up after it
        if self.started() and not self.shim_alive():
            rc = self.rc()  # it may have finished between the two looks
            return rc.get("rc") if rc else -9
        return None

    def send(self, data: str):
        d = os.path.join(self.rundir, "in")
        os.makedirs(d, exist_ok=True)
        name = os.path.join(d, f"{time.time_ns():020d}")
        with open(name + ".tmp", "w") as f:
            f.write(data)
        os.replace(name + ".tmp", name)

    def close_stdin(self):
        open(os.path.join(self.rundir, "close"), "a").close()

    def stop(self):
        """SIGTERM to its process group, SIGKILL after 5 s (the shim does both)."""
        try:
            open(os.path.join(self.rundir, "stop"), "a").close()
        except OSError:
            pass

    def wait(self, timeout: float | None = None):
        t0 = time.time()
        while self.poll() is None:
            if timeout is not None and time.time() - t0 > timeout:
                return None
            time.sleep(0.1)
        return self.poll()


def start_run(workspace: str, rundir: str, cmd: list[str], cwd: str, env: dict, meta: dict | None = None,
              stdin: str | None = None, close: bool = True, merge_stderr: bool = False,
              stdin_null: bool = False) -> RunHandle:
    """Start ``cmd`` through the shim in ``rundir`` (created fresh), with ``stdin`` handed to it first; ``close``
    closes its stdin after that. Returns once the process runs (or failed to start)."""
    shutil.rmtree(rundir, ignore_errors=True)
    os.makedirs(os.path.join(rundir, "in"), mode=0o700)
    h = RunHandle(rundir)
    if meta is not None:
        procs.write_json(os.path.join(rundir, "meta.json"), meta)
    if stdin:
        h.send(stdin)
    if close:
        h.close_stdin()
    env = {k: v for k, v in env.items() if k not in ("CLODFARM_UI_FD", "FARM_UI_FD")}  # the UI's socket stays there
    procs.write_json(os.path.join(rundir, "cmd.json"), {"argv": cmd, "cwd": cwd, "env": env,
                                                        "merge_stderr": merge_stderr,
                                                        **({"stdin": "null"} if stdin_null else {})})
    subprocess.run([sys.executable, procs.shim_path(workspace), "run", rundir], check=True, timeout=60,
                   stdin=subprocess.DEVNULL)
    t0 = time.time()
    while not h.started() and not h.rc() and time.time() - t0 < 30:
        time.sleep(0.02)
    return h


class Live:
    """The open stdin of a sub-agent started with ``--input-format stream-json``: the farm can interrupt it and hand
    it a message while it works. stdin is closed at the run's last result, so the process then exits as with a plain
    prompt; a message handed over mid-run means one more turn, and one more result, before that. The count is kept
    next to the run, so a farm that adopts it closes stdin at the right result too."""

    def __init__(self):
        self.proc: RunHandle | None = None
        self.lock = threading.Lock()
        self.asked = 1  # turns asked for: the prompt, and one per message handed over
        self.results = 0  # results read
        self.closed = False

    def _write(self, data: str) -> bool:
        if self.closed or not self.proc:
            return False
        try:
            self.proc.send(data)
            return True
        except OSError:
            self.closed = True
            return False

    def interrupt(self, text: str) -> bool:
        """Stop what the agent is doing (a running tool is cancelled) and give it ``text`` as a new turn."""
        with self.lock:
            if self.closed or not self.proc:
                return False
            ok = self._write(json.dumps({"type": "control_request", "request_id": f"farm-{time.time():.6f}",
                                         "request": {"subtype": "interrupt"}}) + "\n") and self._write(_user_line(text))
            if ok:
                self.asked += 1
                try:
                    procs.write_json(os.path.join(self.proc.rundir, "live.json"), {"asked": self.asked})
                except OSError:
                    pass
            return ok

    def result(self):
        """A result arrived: close stdin unless a turn is still to come."""
        with self.lock:
            self.results += 1
            if self.results >= self.asked:
                self.close()

    def close(self):
        if not self.closed and self.proc:
            self.closed = True
            try:
                self.proc.close_stdin()
            except OSError:
                pass

    def load(self):
        """Adopting a run: the turns asked for so far; its results are read again from the first line."""
        self.asked = int(procs.read_json(os.path.join(self.proc.rundir, "live.json")).get("asked") or 1)
        self.results = 0
        self.closed = os.path.exists(os.path.join(self.proc.rundir, "close"))


def run_agent(cmd: list[str], prompt: str, cwd: str, env: dict, timeout: int,
              on_snapshot=None, on_line=None, on_start=None, live: Live | None = None, rundir: str | None = None,
              workspace: str | None = None, meta: dict | None = None, stop: threading.Event | None = None,
              adopt: bool = False, started: float | None = None) -> RunResult:
    """Start claude, feed the prompt on stdin, and parse events as they stream.

    The prompt goes on stdin, not argv: some flags are variadic and would swallow it,
    and long prompts don't fit on a command line. With ``live`` (the command has ``--input-format stream-json``)
    it is one stream-json user message, and stdin stays open until the last result (see ``Live``).

    claude runs under the shim in ``rundir``, so it doesn't depend on this process: with ``adopt`` this reads a run
    another farm process started (from its first line: parsing is the same every time), and when ``stop`` is set
    (the farm is handing over to a new release) this returns with ``abandoned`` and leaves the run going.
    """
    workspace = workspace or env.get("FARM_WORKSPACE") or os.environ.get("FARM_WORKSPACE") or "/workspace"
    if not rundir:
        rundir = os.path.join(procs.runs_dir(workspace, "misc"), f"{os.getpid()}-{time.time_ns()}")
    t0 = started or time.time()
    if adopt:
        proc = RunHandle(rundir)
    else:
        first = _user_line(prompt) if live else prompt
        proc = start_run(workspace, rundir, cmd, cwd, env, meta, stdin=first, close=not live)
    if live:
        live.proc = proc
        if adopt:
            live.load()
    if on_start:
        on_start(proc)
    deadline = t0 + timeout
    timed_out = False

    res = RunResult(ok=False, text="")
    last_text = ""
    turns = 0
    out_path = os.path.join(rundir, "out.jsonl")
    buf = b""
    pos = 0
    ended = False
    while True:
        chunk = b""
        try:
            with open(out_path, "rb") as f:
                f.seek(pos)
                chunk = f.read()
        except FileNotFoundError:
            pass
        pos += len(chunk)
        buf += chunk
        *lines, buf = buf.split(b"\n")
        for raw in lines:
            line = raw.decode(errors="replace").strip()
            if not line:
                continue
            try:
                ev = json.loads(line)
            except ValueError:
                continue
            if not isinstance(ev, dict):
                continue
            if on_line:
                on_line(ev)
            typ = ev.get("type")
            if typ == "system" and ev.get("subtype") == "init":
                res.session_id = ev.get("session_id")
                res.init = ev
            elif typ == "rate_limit_event":
                snap = Snapshot.from_event(ev.get("rate_limit_info") or {}, time.time())
                res.snapshots.append(snap)
                if snap.status == "rejected":
                    res.rate_limited = True
                if on_snapshot:
                    on_snapshot(snap)
            elif typ == "assistant":
                for block in (ev.get("message") or {}).get("content") or []:
                    if block.get("type") == "text" and block.get("text"):
                        last_text = block["text"]
            elif typ == "result":
                res.session_id = ev.get("session_id") or res.session_id
                res.text = ev.get("result") or last_text
                # one process, one running total (an interrupted turn's result comes before the next turn's)
                res.cost_usd = max(res.cost_usd, float(ev.get("total_cost_usd") or 0))
                res.usage = ev.get("usage") or {}
                res.terminal_reason = ev.get("terminal_reason")
                turns += int(ev.get("num_turns") or 0)
                res.num_turns = turns
                res.ok = not ev.get("is_error") and ev.get("subtype", "success") == "success"
                res.error_text = ""
                if not res.ok:
                    res.error_text = str(ev.get("result") or ev.get("subtype") or "")[:2000]
                    if ev.get("api_error_status") == 429:
                        res.rate_limited = True
                if live:
                    live.result()
        if chunk:
            continue
        if ended:
            break
        if proc.poll() is not None:
            ended = True  # one more read: whatever it wrote before it exited
            continue
        if stop is not None and stop.is_set():
            res.abandoned = True
            res.duration_s = time.time() - t0
            return res
        if not timed_out and time.time() >= deadline:
            timed_out = True
            proc.stop()
        time.sleep(0.1)
    if live:
        live.close()
    rc = proc.rc() or {"rc": proc.poll()}
    code = rc.get("rc")
    res.duration_s = time.time() - t0
    if not res.text:
        res.text = last_text or _tail(os.path.join(rundir, "err.log")) or rc.get("error") or \
            f"claude exited with code {code}"
    if code not in (0, None) and res.ok:
        res.ok = False
    if timed_out:
        # checked first: a timeout must never be mistaken for a usage limit
        res.ok, res.timed_out, res.rate_limited = False, True, False
        res.text = f"timed out after {timeout}s. Last output: {res.text[-1500:]}"
    elif not res.ok and not res.rate_limited and LIMIT_TEXT.search(res.error_text):
        res.rate_limited = True
    if meta is None and not adopt:  # a one-off run (a usage check): nothing adopts it later
        shutil.rmtree(rundir, ignore_errors=True)
    return res


def _tail(path: str, n: int = 2000) -> str:
    try:
        with open(path, "rb") as f:
            f.seek(max(0, os.path.getsize(path) - n))
            return f.read().decode(errors="replace")
    except OSError:
        return ""


def kill_tree(proc):
    """Stop a run and everything it started (it leads its own process group): SIGTERM, then SIGKILL after 5 s.
    On SIGTERM Claude Code stops the running command's process tree and runs its SessionEnd hooks."""
    if isinstance(proc, RunHandle):
        proc.stop()
        proc.wait(8)
        return
    try:
        os.killpg(proc.pid, 15)
        time.sleep(5)
        os.killpg(proc.pid, 9)
    except (ProcessLookupError, PermissionError):
        pass
