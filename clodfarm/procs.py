"""Processes that outlive the farm's own code: runs, Remote Control, added Claudes, the UI.

Everything long-lived is started through the run shim (runshim.py), detached, with its state in files. So `clodfarm
run` can exec a new release (SIGHUP), or crash and come back, and find the same processes still running: it adopts
them instead of starting new ones. A pid alone could be reused by the system, so a process counts as ours only if
its command line still carries the marker we started it with (a run's directory, or `--tag <id>`).
"""

from __future__ import annotations

import json
import os
import shutil
import signal
import subprocess
import sys
import time

from . import runshim

SHIM = f"runshim-v{runshim.PROTOCOL}.py"


def farm_dir(workspace: str) -> str:
    return os.path.join(workspace, ".farm")


def shim_path(workspace: str) -> str:
    """This protocol's shim, copied out of the package: a new release replaces the package, never this file's
    meaning (a new protocol gets a new file name)."""
    d = os.path.join(farm_dir(workspace), "shim")
    path = os.path.join(d, SHIM)
    src = runshim.__file__
    try:
        if open(path, "rb").read() == open(src, "rb").read():
            return path
    except OSError:
        pass
    os.makedirs(d, exist_ok=True)
    tmp = f"{path}.{os.getpid()}.tmp"
    shutil.copyfile(src, tmp)
    os.replace(tmp, path)
    return path


def runs_dir(workspace: str, farm_id: str) -> str:
    return os.path.join(farm_dir(workspace), "runs", farm_id.replace("/", "_"))


def pids_dir(workspace: str) -> str:
    return os.path.join(farm_dir(workspace), "pids")


# ----------------------------------------------------------------- liveness
def cmdline(pid: int) -> str:
    try:
        with open(f"/proc/{pid}/cmdline", "rb") as f:
            return f.read().replace(b"\0", b" ").decode(errors="replace")
    except FileNotFoundError:
        if os.path.isdir("/proc/self"):
            return ""
    except OSError:
        return ""
    try:  # macOS and other systems without /proc
        return subprocess.run(["ps", "-ww", "-o", "command=", "-p", str(pid)], capture_output=True, text=True,
                              timeout=5).stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        return ""


def alive(pid, marker: str = "") -> bool:
    """Is ``pid`` running, and (with ``marker``) still the process we started? A child of ours that exited is reaped
    here, so it doesn't linger as a zombie that looks alive."""
    try:
        pid = int(pid)
    except (TypeError, ValueError):
        return False
    if pid <= 0:
        return False
    try:
        if os.waitpid(pid, os.WNOHANG)[0] == pid:
            return False
    except ChildProcessError:
        pass
    except OSError:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        pass
    if not marker:
        return True
    cmd = cmdline(pid)
    for _ in range(20):  # mid-exec (a wrapper script execing the real program) Linux shows an empty command line
        if cmd or _zombie(pid):
            break
        time.sleep(0.025)
        cmd = cmdline(pid)
    return marker in cmd and "<defunct>" not in cmd


def _zombie(pid: int) -> bool:
    """A process that exited and waits to be reaped: its command line is empty for good."""
    try:
        with open(f"/proc/{pid}/stat") as f:
            return f.read().rsplit(")", 1)[1].split()[0] in ("Z", "X")
    except (OSError, IndexError):
        return not os.path.isdir("/proc/self")  # no /proc (macOS): ps says <defunct> instead


def read_json(path: str) -> dict:
    try:
        with open(path) as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def write_json(path: str, data: dict, mode: int = 0o600):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.{os.getpid()}.tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, mode)
    with os.fdopen(fd, "w") as f:
        json.dump(data, f)
    os.replace(tmp, path)


# ---------------------------------------------------------------- detached
def spawn_detached(workspace: str, argv: list[str], env: dict | None = None, log: str | None = None,
                   pidfile: str | None = None, cwd: str | None = None, meta: dict | None = None,
                   wait: float = 10, pass_fds: tuple = ()) -> int:
    """Start ``argv`` detached from this process (it keeps running when this one execs or dies) and return its pid,
    read back from ``pidfile``. ``meta`` goes in the pid file; its ``marker``, when there is one, is what the command
    line must hold (see live_pid)."""
    spec = {"argv": argv, "env": env or dict(os.environ), "log": log, "pidfile": pidfile, "cwd": cwd, "meta": meta}
    d = os.path.join(farm_dir(workspace), "spawn")
    specf = os.path.join(d, f"{os.getpid()}-{time.time_ns()}.json")
    write_json(specf, spec)
    if pidfile:
        os.makedirs(os.path.dirname(pidfile), exist_ok=True)
        try:
            os.remove(pidfile)
        except OSError:
            pass
    try:
        subprocess.run([sys.executable, shim_path(workspace), "exec", specf], check=True, timeout=30,
                       stdin=subprocess.DEVNULL, pass_fds=pass_fds)
        if not pidfile:
            return 0
        t0 = time.time()
        while time.time() - t0 < wait:
            pid = read_json(pidfile).get("pid")
            if pid:
                # the pid file is written just before the exec: wait until the process is the command
                marker = (meta or {}).get("marker") or default_marker(argv)
                while time.time() - t0 < wait and alive(pid) and not alive(pid, marker):
                    time.sleep(0.01)
                return int(pid)
            time.sleep(0.02)
        return 0
    finally:
        # the shim has read it by the time it writes the pid file; it holds the environment, so don't leave it
        for _ in range(50):
            if not pidfile or read_json(pidfile).get("pid"):
                break
            time.sleep(0.02)
        try:
            os.remove(specf)
        except OSError:
            pass


def default_marker(argv: list) -> str:
    """What tells a process we started apart: its first arguments, not its program (a wrapper script, or macOS's
    framework Python, execs into another path)."""
    argv = [str(a) for a in argv or []]
    return " ".join(argv[1:4]) if len(argv) > 1 else (argv[0] if argv else "")


def live_pid(pidfile: str, marker: str | None = None) -> int:
    """The pid in ``pidfile`` if that process is still ours and running, else 0. Without a ``marker``, the pid file's
    own marker, or else the start of the command line it was started with (kept in the pid file), must still be in its
    command line. A command that is a wrapper script execs something else, often with its own arguments first: it
    needs its own marker, or it never looks like ours again."""
    d = read_json(pidfile)
    pid = d.get("pid")
    if marker is None:  # the marker it was started with, else the start of its command line
        marker = d.get("marker") or default_marker(d.get("argv"))
    return int(pid) if pid and alive(pid, marker) else 0


def find(marker: str) -> list[int]:
    """Every running process of this user whose command line carries ``marker`` (to adopt one instead of starting a
    second: a wrapper script, like Debian's /usr/bin/chromium, execs into another command line)."""
    out = []
    if os.path.isdir("/proc/self"):
        for n in os.listdir("/proc"):
            if n.isdigit() and int(n) != os.getpid():
                cmd = cmdline(int(n))
                if marker in cmd and "<defunct>" not in cmd:
                    out.append(int(n))
        return sorted(out)
    try:
        lines = subprocess.run(["ps", "-axww", "-o", "pid=,command="], capture_output=True, text=True,
                               timeout=10).stdout.splitlines()
    except (OSError, subprocess.TimeoutExpired):
        return out
    for line in lines:
        pid, _, cmd = line.strip().partition(" ")
        if pid.isdigit() and int(pid) != os.getpid() and marker in cmd:
            out.append(int(pid))
    return sorted(out)


def terminate(pid: int, marker: str = "", grace: float = 20, group: bool = True) -> bool:
    """SIGTERM (its process group when ``group``), SIGKILL after ``grace`` seconds. True if it was running."""
    if not alive(pid, marker):
        return False
    try:
        # the double fork (runshim) leaves it in the group its first child made, not one of its own: ask for it
        pgid = os.getpgid(pid) if group else 0
    except (ProcessLookupError, PermissionError):
        return False
    send = (lambda s: os.killpg(pgid, s)) if group and pgid > 1 else (lambda s: os.kill(pid, s))
    try:
        send(signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        return False
    t0 = time.time()
    while time.time() - t0 < grace:
        if not alive(pid):
            return True
        time.sleep(0.1)
    try:
        send(signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass
    return True
