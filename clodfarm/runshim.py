"""The run shim: keeps a process alive and reachable while the farm's own code is replaced.

Standard library only, and it imports nothing from clodfarm: the farm copies this file to
``.farm/shim/runshim-v<PROTOCOL>.py`` and starts that copy, so a new clodfarm release never changes a shim that is
already running. Change the protocol below only together with PROTOCOL.

    python3 runshim-v1.py run  <rundir>     a run: owns the process's stdin, its output goes to files
    python3 runshim-v1.py exec <spec.json>  start a long-lived process detached, and write its pid file

Both detach first (fork, new session, the parent exits), so the process that started them never has to wait for
them: they are reparented to PID 1 (tini in the container), and the farm can restart, or exec a new release,
underneath them.

A run's directory:
    cmd.json     {"argv": [...], "cwd": ..., "env": {...}, "merge_stderr": false, "stdin": "null"?}   written first
                 ("stdin": "null": its stdin is /dev/null, as for a program that reads keys from it, not a pipe)
    shim.json    {"shim": pid, "child": pid, "started": t}              written by the shim once the child runs
    out.jsonl    the child's stdout (appended as it writes)
    err.log      the child's stderr
    in/          files the shim writes to the child's stdin, in name order, then deletes
    close        once it exists (and in/ is empty) the shim closes the child's stdin
    stop         once it exists the shim stops the child's process group: SIGTERM, then SIGKILL after 5 s
    rc.json      {"rc": code, "ended": t}                               written when the child has exited
"""

from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import time

PROTOCOL = 1
POLL = 0.1


def _detach():
    """Fork away from the caller: it gets its exit status at once, and this process belongs to PID 1."""
    if os.fork():
        os._exit(0)
    os.setsid()
    if os.fork():
        os._exit(0)
    fd = os.open(os.devnull, os.O_RDWR)
    for n in (0, 1, 2):
        os.dup2(fd, n)


def _write_json(path: str, data: dict):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w") as f:
        json.dump(data, f)
    os.replace(tmp, path)


def run(rundir: str):
    spec = json.load(open(os.path.join(rundir, "cmd.json")))
    _detach()
    inbox = os.path.join(rundir, "in")
    os.makedirs(inbox, exist_ok=True)
    out = open(os.path.join(rundir, "out.jsonl"), "ab")
    err = open(os.path.join(rundir, "err.log"), "ab")
    try:
        child = subprocess.Popen(spec["argv"], cwd=spec.get("cwd") or None, env=spec.get("env"),
                                 stdin=subprocess.DEVNULL if spec.get("stdin") == "null" else subprocess.PIPE,
                                 stdout=out,
                                 stderr=subprocess.STDOUT if spec.get("merge_stderr") else err, start_new_session=True)
    except OSError as e:
        err.write(f"could not start {spec['argv'][:1]}: {e}\n".encode())
        err.flush()
        _write_json(os.path.join(rundir, "rc.json"), {"rc": 127, "ended": time.time(), "error": str(e)})
        return
    out.close()
    err.close()
    _write_json(os.path.join(rundir, "shim.json"), {"shim": os.getpid(), "child": child.pid, "started": time.time(),
                                                    "protocol": PROTOCOL})
    stdin_open, stop_at = child.stdin is not None, 0.0
    while child.poll() is None:
        if stdin_open:
            for name in sorted(n for n in os.listdir(inbox) if not n.endswith(".tmp")):
                p = os.path.join(inbox, name)
                try:
                    data = open(p, "rb").read()
                    os.remove(p)
                    child.stdin.write(data)
                    child.stdin.flush()
                except (BrokenPipeError, OSError, ValueError):
                    pass
            if os.path.exists(os.path.join(rundir, "close")) and not [n for n in os.listdir(inbox)
                                                                     if not n.endswith(".tmp")]:
                try:
                    child.stdin.close()
                except (BrokenPipeError, OSError):
                    pass
                stdin_open = False
        if os.path.exists(os.path.join(rundir, "stop")):
            if not stop_at:
                stop_at = time.time()
                _signal(child.pid, signal.SIGTERM)
            elif time.time() - stop_at > 5:
                _signal(child.pid, signal.SIGKILL)
        time.sleep(POLL)
    _write_json(os.path.join(rundir, "rc.json"), {"rc": child.returncode, "ended": time.time()})


def _signal(pgid: int, sig):
    try:
        os.killpg(pgid, sig)
    except (ProcessLookupError, PermissionError):
        pass


def exec_(spec_path: str):
    """Start ``argv`` detached, with stdout and stderr appended to ``log``, and write ``pidfile`` with its pid."""
    spec = json.load(open(spec_path))
    _detach()
    log = os.open(spec.get("log") or os.devnull, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    os.dup2(log, 1)
    os.dup2(log, 2)
    if spec.get("cwd"):
        os.chdir(spec["cwd"])
    if spec.get("pidfile"):
        _write_json(spec["pidfile"], {"pid": os.getpid(), "started": time.time(), "argv": spec["argv"],
                                      **(spec.get("meta") or {})})
    os.execvpe(spec["argv"][0], spec["argv"], spec.get("env") or dict(os.environ))


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] not in ("run", "exec"):
        sys.exit("usage: runshim.py run <rundir> | exec <spec.json>")
    run(sys.argv[2]) if sys.argv[1] == "run" else exec_(sys.argv[2])
