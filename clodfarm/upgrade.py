"""`clodfarm upgrade`: a new clodfarm (farm daemon, UI, CLI, hooks) without stopping a single agent.

1. install the new code into the workspace volume: ``.farm/releases/<version>-<time>/lib`` (pip, no dependencies:
   they come with the image, like Python, Node and Claude Code; a release that needs new ones needs a new image);
2. check it imports and its CLI answers, on the side;
3. point ``.farm/releases/current`` at it (``previous`` keeps the one before, for --rollback and the crash guard);
4. SIGHUP every farm daemon on this box: each one lets its runs go on, execs the new release in the same process
   and adopts them (supervisor.py, runshim.py); the farm daemon then rolls the UI process with no downtime
   (uikeeper.py);
5. wait until every daemon says it runs the new release, and show that the agents' processes are the same ones.
"""

from __future__ import annotations

import os
import shutil
import signal
import subprocess
import sys
import time

from . import __version__, boot, procs

REPO = "https://github.com/matank001/clodfarm"
KEEP = 3


def _daemons(workspace: str) -> list[dict]:
    """Every farm daemon on this box: [{pid, name, release, ready, path}]."""
    d = procs.pids_dir(workspace)
    out = []
    try:
        names = sorted(os.listdir(d))
    except OSError:
        return out
    for n in names:
        if n.startswith("farmd-") and n.endswith(".json"):
            info = procs.read_json(os.path.join(d, n))
            if info.get("pid") and procs.alive(info["pid"], "clodfarm"):
                out.append({**info, "path": os.path.join(d, n)})
    return out


def agent_pids(workspace: str) -> dict[str, int]:
    """Every agent process running under the shim on this box: {run: claude pid}."""
    root = os.path.join(procs.farm_dir(workspace), "runs")
    out = {}
    for dirpath, dirnames, filenames in os.walk(root):
        if "shim.json" in filenames and "rc.json" not in filenames:
            info = procs.read_json(os.path.join(dirpath, "shim.json"))
            if procs.alive(info.get("shim"), dirpath):
                out[os.path.relpath(dirpath, root)] = int(info.get("child") or 0)
        dirnames[:] = [x for x in dirnames if x != "in"]
    return out


def ui_pids(workspace: str) -> list[int]:
    from .uikeeper import UIKeeper

    class _C:
        pass
    c = _C()
    c.workspace = workspace
    return [int(d["pid"]) for d in UIKeeper(c).running()]


def status(workspace: str) -> str:
    d = boot.releases_dir(workspace)
    cur, prev = boot.target(workspace), os.path.realpath(os.path.join(d, "previous")) \
        if os.path.islink(os.path.join(d, "previous")) else ""
    lines = [f"current release: {os.path.basename(cur) or f'image ({__version__})'}"]
    if prev:
        lines.append(f"previous:        {os.path.basename(prev)}")
    for x in _daemons(workspace):
        lines.append(f"farm daemon {x.get('name') or '?':<12} pid {x['pid']:<7} release {x.get('release')}"
                     + ("" if x.get("ready") else " (starting)"))
    for pid in ui_pids(workspace):
        lines.append(f"farm UI                  pid {pid}")
    for run, pid in sorted(agent_pids(workspace).items()):
        lines.append(f"agent  {run:<44} pid {pid}")
    try:
        rel = sorted(x for x in os.listdir(d) if os.path.isdir(os.path.join(d, x)) and not os.path.islink(
            os.path.join(d, x)))
        if rel:
            lines.append("installed: " + ", ".join(rel))
    except OSError:
        pass
    return "\n".join(lines)


def _pyenv(lib: str) -> dict:
    env = dict(os.environ)
    base = env.get("CLODFARM_BASE_PYTHONPATH", "") if env.get("CLODFARM_RELEASE") else env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = lib + (os.pathsep + base if base else "")
    env["CLODFARM_RELEASE"] = os.path.dirname(lib)  # boot.py leaves it alone: this is the code to check
    return env


def install(workspace: str, src: str) -> str:
    """Install ``src`` into a new release directory and check it. Returns the directory."""
    root = boot.releases_dir(workspace)
    os.makedirs(root, exist_ok=True)
    tmp = os.path.join(root, f".new-{os.getpid()}-{int(time.time())}")
    shutil.rmtree(tmp, ignore_errors=True)
    lib = os.path.join(tmp, "lib")
    print(f"installing {src} ...", flush=True)
    pkg = os.path.join(src, "clodfarm") if os.path.isfile(os.path.join(src, "clodfarm", "__init__.py")) else \
        src if os.path.isfile(os.path.join(src, "__init__.py")) else ""
    if pkg:  # a checkout (or the package itself): copied as is, no build and no network
        shutil.copytree(pkg, os.path.join(lib, "clodfarm"),
                        ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".DS_Store"))
    else:
        p = subprocess.run([sys.executable, "-m", "pip", "install", "--quiet", "--no-deps",
                            "--no-warn-script-location", "--disable-pip-version-check", "--target", lib, src],
                           capture_output=True, text=True)
        if p.returncode:
            shutil.rmtree(tmp, ignore_errors=True)
            raise SystemExit(f"clodfarm upgrade: pip could not install {src}:\n{(p.stdout + p.stderr)[-2000:]}")
    env = _pyenv(lib)
    check = subprocess.run([sys.executable, "-c",
                            "import sys; sys.path[:1] = []; import clodfarm, clodfarm.supervisor, clodfarm.web, "
                            "clodfarm.runshim, clodfarm.cli, clodfarm.uikeeper; print(clodfarm.__version__, "
                            "clodfarm.__file__)"], capture_output=True, text=True, env=env, cwd=tmp)
    if check.returncode or not check.stdout.strip():
        shutil.rmtree(tmp, ignore_errors=True)
        raise SystemExit(f"clodfarm upgrade: the new code doesn't import:\n{(check.stdout + check.stderr)[-2000:]}")
    version, where = check.stdout.split()[:2]
    if not os.path.realpath(where).startswith(os.path.realpath(lib)):
        shutil.rmtree(tmp, ignore_errors=True)
        raise SystemExit(f"clodfarm upgrade: the check imported {where}, not the new code")
    cli = subprocess.run([sys.executable, "-c", boot.STUB, "--help"], capture_output=True, text=True, env=env,
                         cwd=tmp, timeout=60)
    if cli.returncode:
        shutil.rmtree(tmp, ignore_errors=True)
        raise SystemExit(f"clodfarm upgrade: the new CLI fails:\n{(cli.stdout + cli.stderr)[-2000:]}")
    dest = os.path.join(root, f"{version}-{time.strftime('%Y%m%d-%H%M%S')}")
    os.replace(tmp, dest)
    print(f"installed clodfarm {version} as {os.path.basename(dest)}", flush=True)
    return dest


def switch(workspace: str, dest: str):
    """Point ``current`` at ``dest`` in one step; ``previous`` keeps what it was."""
    root = boot.releases_dir(workspace)
    cur, prev = os.path.join(root, "current"), os.path.join(root, "previous")
    was = boot.target(workspace)
    for link, to in ((prev, was), (cur, dest)):
        if link == prev and not to:
            if os.path.lexists(prev):
                os.remove(prev)
            continue
        tmp = f"{link}.{os.getpid()}.tmp"
        if os.path.lexists(tmp):
            os.remove(tmp)
        os.symlink(to, tmp)
        os.replace(tmp, link)
    try:
        os.remove(os.path.join(root, "boot.json"))  # a fresh count for the crash guard
    except OSError:
        pass


def prune(workspace: str):
    root = boot.releases_dir(workspace)
    keep = {boot.target(workspace)}
    prev = os.path.join(root, "previous")
    if os.path.islink(prev):
        keep.add(os.path.realpath(prev))
    rel = sorted((os.path.join(root, x) for x in os.listdir(root)
                  if os.path.isdir(os.path.join(root, x)) and not os.path.islink(os.path.join(root, x))
                  and not x.startswith(".")), key=os.path.getmtime)
    for d in rel[:-KEEP]:
        if os.path.realpath(d) not in keep:
            shutil.rmtree(d, ignore_errors=True)


def hand_over(workspace: str, wait: int) -> bool:
    """SIGHUP every farm daemon here and wait until each runs the current release again."""
    want = os.path.basename(boot.target(workspace)) or "image"
    daemons = _daemons(workspace)
    if not daemons:
        print("no farm daemon is running here: the next start runs the new release", flush=True)
        return True
    before = agent_pids(workspace)
    for d in daemons:
        d["was_ready"] = bool(d.get("ready"))
    print(f"handing over {len(daemons)} farm daemon(s) with {len(before)} agent process(es) running ...", flush=True)
    for d in daemons:
        try:
            os.kill(int(d["pid"]), signal.SIGHUP)
        except (ProcessLookupError, PermissionError) as e:
            print(f"  {d.get('name')}: {e}", flush=True)
    t0 = time.time()
    while time.time() - t0 < wait:
        now = _daemons(workspace)
        for x in now:
            x["was_ready"] = next((d["was_ready"] for d in daemons if d.get("path") == x.get("path")), True)
        # a daemon waiting for its Claude's login runs the new release but is never "ready": its release is enough
        if now and all(x.get("release") == want for x in now) and \
                all(x.get("ready") or not x.get("was_ready") for x in now):
            break
        time.sleep(0.5)
    else:
        print(f"the farm didn't finish handing over in {wait}s; `clodfarm upgrade --status` shows where it is",
              flush=True)
        return False
    after = agent_pids(workspace)
    kept = [r for r, pid in before.items() if after.get(r) == pid]
    ended = [r for r in before if r not in after]
    print(f"every farm daemon runs {want}. Agents: {len(kept)} kept running (same processes)"
          + (f", {len(ended)} finished meanwhile" if ended else "") + ".", flush=True)
    return True


def main(cfg, a) -> int:
    ws = cfg.workspace
    if a.status:
        print(status(ws))
        return 0
    if a.restart_ui:
        os.makedirs(procs.pids_dir(ws), exist_ok=True)
        open(os.path.join(procs.pids_dir(ws), "ui-roll"), "a").close()
        print("the farm daemon rolls the UI within a few seconds (the page stays up)")
        return 0
    if a.rollback:
        prev = os.path.join(boot.releases_dir(ws), "previous")
        back = os.path.realpath(prev) if os.path.islink(prev) else ""
        cur = os.path.join(boot.releases_dir(ws), "current")
        if back:
            switch(ws, back)
        elif os.path.lexists(cur):
            os.remove(cur)
        print(f"back to {os.path.basename(back) or f'the image ({__version__})'}")
    else:
        src = a.src or f"git+{REPO}@{a.ref}"
        if os.path.isdir(src):
            src = os.path.abspath(src)
        dest = install(ws, src)
        switch(ws, dest)
        prune(ws)
    if a.no_handover:
        print("switched; the farm runs it after its next hand-over or start")
        return 0
    return 0 if hand_over(ws, a.wait) else 1
