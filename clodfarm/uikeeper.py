"""The farm UI runs in its own process, kept by the farm daemon.

So the UI can be replaced (a new release, or a crash) without touching anything that runs agents, and the page stays
up while it is. The farm daemon opens the UI's listening socket once and hands that same socket to every UI process
(it survives the daemon's own exec into a new release): a new UI process starts accepting on it next to the old one,
says it's ready in its pid file, and only then is the old one stopped; the old one finishes what it was answering. The
two share one queue of waiting connections, so none is dropped (separate sockets with SO_REUSEPORT would reset the
ones queued on the old socket when it closes). The farm daemon rolls the UI by itself when it finds one running an
older release than the current one (after `clodfarm upgrade`), or when `clodfarm upgrade --restart-ui` asks.
"""

from __future__ import annotations

import os
import secrets
import socket
import sys
import threading
import time

from . import boot, procs

READY_WAIT = 30


def listener() -> int | None:
    """The UI's listening socket, as an inheritable file descriptor: the one this process (or the farm daemon it
    exec'd from) already opened, else a new one. None when the port can't be had (the UI then binds by itself)."""
    host, port = os.environ.get("FARM_UI_HOST", "0.0.0.0"), int(os.environ.get("FARM_UI_PORT", "8080"))
    fd = os.environ.get("CLODFARM_UI_FD")
    if fd and fd.isdigit():
        try:
            s = socket.fromfd(int(fd), socket.AF_INET6 if ":" in host else socket.AF_INET, socket.SOCK_STREAM)
            ok = s.getsockname()[1] == port
            s.close()
            if ok:
                return int(fd)
        except OSError:
            pass
    try:
        s = socket.socket(socket.AF_INET6 if ":" in host else socket.AF_INET, socket.SOCK_STREAM)
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        if hasattr(socket, "SO_REUSEPORT"):  # next to UI processes left from before a crash of the daemon
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
        s.bind((host, port))
        s.listen(256)
    except OSError as e:
        print(f"farm UI: can't hold port {port} ({e}); each UI process binds it itself", flush=True)
        return None
    fd = s.detach()
    os.set_inheritable(fd, True)  # through this daemon's exec into a new release, and into each UI process
    os.environ["CLODFARM_UI_FD"] = str(fd)
    return fd


class UIKeeper:
    def __init__(self, cfg):
        self.cfg = cfg
        self.fd: int | None = None  # the listening socket: opened by keep() only, in the farm daemon
        self.dir = procs.pids_dir(cfg.workspace)
        self.log = os.path.join(procs.farm_dir(cfg.workspace), "ui.log")
        self._lock = threading.Lock()
        self.roll_file = os.path.join(self.dir, "ui-roll")

    def running(self) -> list[dict]:
        """The UI processes up now: [{pid, tag, release, ready, path}], oldest first."""
        out = []
        try:
            names = os.listdir(self.dir)
        except OSError:
            return out
        for n in names:
            if not (n.startswith("ui-") and n.endswith(".json")):
                continue
            path = os.path.join(self.dir, n)
            d = procs.read_json(path)
            tag = d.get("tag") or ""
            if tag and procs.alive(d.get("pid"), f"--tag {tag}"):
                out.append({**d, "path": path})
            elif time.time() - float(d.get("started") or 0) > READY_WAIT:
                try:
                    os.remove(path)
                except OSError:
                    pass
        return sorted(out, key=lambda d: float(d.get("started") or 0))

    def start(self) -> dict | None:
        tag = f"ui-{secrets.token_hex(4)}"
        pidfile = os.path.join(self.dir, f"{tag}.json")
        env = {**os.environ, "FARM_UI_REUSEPORT": "1", "FARM_UI_PIDFILE": pidfile}
        env.pop("CLODFARM_UI_FD", None)
        if self.fd is not None:
            env["FARM_UI_FD"] = str(self.fd)
        pid = procs.spawn_detached(self.cfg.workspace, boot.command(["ui", "--tag", tag]), env=env, log=self.log,
                                   pidfile=pidfile, cwd=self.cfg.workspace,
                                   meta={"tag": tag, "release": os.path.basename(boot.target()) or "image"},
                                   pass_fds=(self.fd,) if self.fd is not None else ())
        t0 = time.time()
        while pid and time.time() - t0 < READY_WAIT:
            if procs.read_json(pidfile).get("ready"):
                return {**procs.read_json(pidfile), "path": pidfile}
            if not procs.alive(pid, f"--tag {tag}"):
                break
            time.sleep(0.1)
        print(f"farm UI: a new UI process didn't come up (see {self.log})", flush=True)
        if pid:
            procs.terminate(pid, f"--tag {tag}", grace=5)
        return None

    def roll(self, reason: str):
        """A new UI first; once it answers, stop the old ones. The page never sees the port closed."""
        with self._lock:
            old = self.running()
            new = self.start()
            if not new:
                return False
            for d in old:
                procs.terminate(int(d["pid"]), f"--tag {d['tag']}", grace=15)
                try:
                    os.remove(d["path"])
                except OSError:
                    pass
            print(f"farm UI: rolled ({reason}): pid {new.get('pid')} on release {new.get('release')}", flush=True)
            return True

    def keep(self, stop: threading.Event, every: float = 2.0):
        # only the process that keeps the UI holds the port: anything that merely lists the UI processes (upgrade
        # --status) must not, or the kernel would hand it connections it never accepts
        self.fd = listener()
        want = os.path.basename(boot.target()) or "image"
        backoff = 0.0
        while not stop.is_set():
            try:
                live = self.running()
                if os.path.exists(self.roll_file):
                    os.remove(self.roll_file)
                    self.roll("asked for")
                elif not live:
                    if time.time() >= backoff:
                        if not self.start():
                            backoff = time.time() + 30
                elif any(d.get("release") != want for d in live):
                    self.roll(f"release {want}")
                elif len(live) > 1:  # a roll that was cut short: keep the newest
                    for d in live[:-1]:
                        procs.terminate(int(d["pid"]), f"--tag {d['tag']}", grace=15)
            except Exception as e:  # noqa: BLE001 - never take the farm down for the UI
                print(f"farm UI keeper: {e!r}", flush=True)
            stop.wait(every)

    def shutdown(self):
        for d in self.running():
            procs.terminate(int(d["pid"]), f"--tag {d['tag']}", grace=10)


def mark_ready():
    """Called by a UI process once it listens: the keeper stops the old one only after this."""
    path = os.environ.get("FARM_UI_PIDFILE")
    if path:
        d = procs.read_json(path)
        if d:
            procs.write_json(path, {**d, "ready": True, "pid": os.getpid()})


if __name__ == "__main__":  # pragma: no cover
    sys.exit("run by the farm daemon")
