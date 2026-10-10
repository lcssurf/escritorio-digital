"""Every `clodfarm` command starts here: it runs the farm's current release.

`clodfarm upgrade` installs a new release of clodfarm into the workspace volume (``.farm/releases/<version>-<time>/lib``)
and points ``.farm/releases/current`` at it. From then on every `clodfarm` process, the farm daemon after its
hand-over, the UI, and each `clodfarm hook` that a running Claude Code session calls, execs itself with that release
first on ``PYTHONPATH``. The image's own copy is the fallback: with no release, or after a rollback, it runs as is.

Kept small and free of imports from the rest of clodfarm, so a broken release can't break the way back.
"""

from __future__ import annotations

import json
import os
import sys
import time

CRASH_WINDOW = 180  # seconds: this many starts of the farm daemon on one release within it ...
CRASH_STARTS = 3  # ... and the release is taken back


def releases_dir(workspace: str | None = None) -> str:
    return os.path.join(workspace or os.environ.get("FARM_WORKSPACE") or "/workspace", ".farm", "releases")


def target(workspace: str | None = None) -> str:
    """The release every process should run: the real path of ``current``, or "" for the image's own code."""
    cur = os.path.join(releases_dir(workspace), "current")
    real = os.path.realpath(cur)
    return real if os.path.islink(cur) and os.path.isdir(os.path.join(real, "lib", "clodfarm")) else ""


def _ver(v: str) -> tuple:
    out = []
    for part in v.split("+")[0].split("-")[0].split("."):
        out.append(int(part) if part.isdigit() else 0)
    return tuple(out)


def _image_newer(tgt: str) -> bool:
    """A new image (`deploy.sh roll`) is newer than the release left in the volume by an older `clodfarm upgrade`:
    the image wins, or it would never take effect."""
    if not tgt or os.environ.get("CLODFARM_RELEASE"):
        return False  # only the image's own code (not a release) decides this
    try:
        from . import __version__ as mine
    except ImportError:
        return False
    return _ver(mine) > _ver(os.path.basename(tgt))


def running() -> str:
    """The release this process runs: its directory name, or "image"."""
    r = os.environ.get("CLODFARM_RELEASE", "")
    return os.path.basename(r) if r else "image"


def _crash_guard(workspace: str | None, tgt: str) -> str:
    """The farm daemon keeps dying right after it starts on a new release: go back to the one before."""
    d = releases_dir(workspace)
    path = os.path.join(d, "boot.json")
    try:
        seen = json.load(open(path))
    except (OSError, ValueError):
        seen = {}
    t = time.time()
    starts = [s for s in seen.get("starts", []) if t - s < CRASH_WINDOW] \
        if seen.get("release") == tgt and not seen.get("clean") else []
    starts.append(t)
    try:
        with open(path + ".tmp", "w") as f:
            json.dump({"release": tgt, "starts": starts}, f)
        os.replace(path + ".tmp", path)
    except OSError:
        return tgt
    if len(starts) < CRASH_STARTS:
        return tgt
    prev = os.path.join(d, "previous")
    back = os.path.realpath(prev) if os.path.islink(prev) else ""
    cur = os.path.join(d, "current")
    try:
        if back and os.path.isdir(back) and back != tgt:
            tmp = cur + ".tmp"
            if os.path.lexists(tmp):
                os.remove(tmp)
            os.symlink(back, tmp)
            os.replace(tmp, cur)
        else:
            os.remove(cur)
            back = ""
        with open(os.path.join(d, "rollback.log"), "a") as f:
            f.write(f"{time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())} {os.path.basename(tgt)} started "
                    f"{len(starts)} times in {CRASH_WINDOW}s: back to {os.path.basename(back) or 'the image'}\n")
        print(f"clodfarm: release {os.path.basename(tgt)} keeps crashing at start; back to "
              f"{os.path.basename(back) or 'the image'}", file=sys.stderr, flush=True)
    except OSError:
        return tgt
    return back


def mark_clean(workspace: str | None = None):
    """The farm daemon stopped on purpose (drained, or the container stopping): its next start isn't a crash."""
    path = os.path.join(releases_dir(workspace), "boot.json")
    try:
        seen = json.load(open(path))
        seen["clean"] = True
        with open(path + ".tmp", "w") as f:
            json.dump(seen, f)
        os.replace(path + ".tmp", path)
    except (OSError, ValueError):
        pass


def boot(argv: list[str] | None = None):
    """Exec into the current release when this process isn't running it yet; otherwise return."""
    if os.environ.get("CLODFARM_NO_RELEASE"):
        return
    argv = sys.argv[1:] if argv is None else argv
    have = os.environ.get("CLODFARM_RELEASE", "")
    tgt = target()
    if _image_newer(tgt):
        tgt = ""
    if argv[:1] == ["run"] and tgt and not os.environ.get("FARM_HATCHED") and tgt != have:
        tgt = _crash_guard(None, tgt)
    if tgt == have:
        return
    env = dict(os.environ)
    base = env.get("CLODFARM_BASE_PYTHONPATH", "") if have else env.get("PYTHONPATH", "")
    env["CLODFARM_BASE_PYTHONPATH"] = base
    if tgt:
        env["PYTHONPATH"] = os.path.join(tgt, "lib") + (os.pathsep + base if base else "")
        env["CLODFARM_RELEASE"] = tgt
    else:
        env.pop("CLODFARM_RELEASE", None)
        if base:
            env["PYTHONPATH"] = base
        else:
            env.pop("PYTHONPATH", None)
    sys.stdout.flush()
    sys.stderr.flush()
    os.execve(sys.executable, command(argv), env)


# `python -m` would put the working directory first on sys.path, ahead of the release; this doesn't
STUB = "import sys; sys.path[:1] = []; from clodfarm.boot import main; main()"


def command(argv: list[str]) -> list[str]:
    """The command line that runs `clodfarm <argv>` on the release in PYTHONPATH (or the image's copy)."""
    return [sys.executable, "-c", STUB, *argv]


def main():
    boot()
    from .cli import main as cli_main
    sys.exit(cli_main())
