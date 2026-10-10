"""Replacing the farm's code (daemon, UI, CLI) while agents run: none of them is stopped.

These run a real `clodfarm run` in its own process (the fake claude stands in for Claude Code), then upgrade it to a
copy of this checkout with another version number, or kill it, and look at the agents' processes.
"""

import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.request

import pytest

from clodfarm import procs, upgrade

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(os.path.dirname(HERE), "clodfarm")


def wait_for(fn, timeout=40, every=0.2):
    end = time.time() + timeout
    while time.time() < end:
        v = fn()
        if v:
            return v
        time.sleep(every)
    raise AssertionError("timed out waiting")


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def cli(*args, timeout=180):
    return subprocess.run([sys.executable, "-m", "clodfarm", *args], capture_output=True, text=True, timeout=timeout)


def release_copy(tmp_path, version, broken=False):
    """This checkout's package with another version: what `clodfarm upgrade --from` installs."""
    src = tmp_path / f"src-{version}"
    shutil.copytree(SRC, src / "clodfarm", ignore=shutil.ignore_patterns("__pycache__"))
    (src / "clodfarm" / "__init__.py").write_text(f'__version__ = "{version}"\n')
    if broken:
        (src / "clodfarm" / "supervisor.py").write_text("raise SystemExit('this release is broken')\n")
    return str(src)


@pytest.fixture
def farmd(env, monkeypatch):
    """A farm daemon in its own process, with its UI (so the roll can be watched), and a way to stop it."""
    if env.name.endswith("dynamodb]") or os.environ.get("FARM_STORE") == "dynamodb":
        pytest.skip("one backend is enough: the processes are the point here")
    port = free_port()
    monkeypatch.setenv("FARM_UI", "1")
    monkeypatch.setenv("FARM_UI_PORT", str(port))
    monkeypatch.setenv("FARM_UI_HOST", "127.0.0.1")
    monkeypatch.setenv("FARM_UI_PASSWORD", "pw")
    monkeypatch.setenv("FARM_TICK_SECONDS", "1")
    monkeypatch.setenv("FARM_MANAGE_CLAUDE_CONFIG", "0")
    monkeypatch.setenv("FARM_BROWSER", "0")
    ws = os.environ["FARM_WORKSPACE"]
    os.makedirs(ws, exist_ok=True)
    started = []

    def start():
        log = open(env / f"farmd-{len(started)}.log", "ab")
        p = subprocess.Popen([sys.executable, "-m", "clodfarm", "run"], cwd=str(env), stdout=log,
                             stderr=subprocess.STDOUT, start_new_session=True)
        started.append(p)
        wait_for(lambda: procs.read_json(os.path.join(procs.pids_dir(ws), "farmd-primary.json")).get("ready")
                 and procs.read_json(os.path.join(procs.pids_dir(ws), "farmd-primary.json")).get("pid") == p.pid,
                 timeout=60)
        return p

    yield {"start": start, "ws": ws, "port": port, "env": env}
    for p in started:
        if p.poll() is None:
            p.send_signal(signal.SIGTERM)
            try:
                p.wait(30)
            except subprocess.TimeoutExpired:
                p.kill()
    for pid in upgrade.agent_pids(ws).values():  # nothing may outlive the test
        try:
            os.killpg(pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass
    for pid in upgrade.ui_pids(ws):
        try:
            os.kill(pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass


def health(port):
    with urllib.request.urlopen(f"http://127.0.0.1:{port}/healthz", timeout=5) as r:
        return json.loads(r.read())


def health_or_none(port):
    """For waiting: a UI that isn't listening yet is "not yet", not a failure."""
    try:
        return health(port)
    except OSError:
        return {}


def tasks_running(ws):
    return {k: v for k, v in upgrade.agent_pids(ws).items() if "remote-control" not in k}


def repo_files(env):
    return set(os.listdir(env / "workspace" / "repo"))


def test_upgrade_keeps_every_agent_running(farmd, tmp_path):
    ws, port = farmd["ws"], farmd["port"]
    p = farmd["start"]()
    wait_for(lambda: health_or_none(port).get("ok"), timeout=60)
    ids = [json.loads(cli("spawn", f"slow {n}", "--prompt", f"SLOW 14 COMMIT slow{n}", "--json").stdout)["id"]
           for n in (1, 2)]
    before = wait_for(lambda: (lambda r: r if len(r) == 2 else None)(tasks_running(ws)), timeout=40)
    rc_before = {k: v for k, v in upgrade.agent_pids(ws).items() if "remote-control" in k}
    ui_before = upgrade.ui_pids(ws)
    assert rc_before and ui_before

    refused = []

    def poll_ui(stop):  # someone watching the farm the whole time
        while not stop.is_set():
            try:
                health(port)
            except OSError as e:
                refused.append(f"{time.time():.2f} {e!r}")
            time.sleep(0.05)
    stop = threading.Event()
    watcher = threading.Thread(target=poll_ui, args=(stop,), daemon=True)
    watcher.start()

    r = cli("upgrade", "--from", release_copy(tmp_path, "9.9.1"), "--wait", "90")
    assert r.returncode == 0, r.stdout + r.stderr
    assert "2 kept running" in r.stdout or "kept running" in r.stdout, r.stdout

    info = procs.read_json(os.path.join(procs.pids_dir(ws), "farmd-primary.json"))
    assert info["pid"] == p.pid, "the same process, exec'd into the new release"
    assert info["release"].startswith("9.9.1-")
    after = tasks_running(ws)
    for run, pid in before.items():
        assert after.get(run, pid) == pid, "an agent that was running is the same process"
    assert {k: v for k, v in upgrade.agent_pids(ws).items() if "remote-control" in k} == rc_before, \
        "Remote Control (the phone conversations) wasn't restarted"
    wait_for(lambda: health_or_none(port).get("version") == "9.9.1", timeout=40)
    wait_for(lambda: upgrade.ui_pids(ws) and not set(upgrade.ui_pids(ws)) & set(ui_before), timeout=40)
    wait_for(lambda: not any(procs.alive(pid) for pid in ui_before), timeout=40)  # the old UI is gone, not just forgotten
    stop.set()
    watcher.join(5)
    if refused:  # what the farm was doing then
        print(open(farmd["env"] / "farmd-0.log").read()[-6000:])
        print(open(os.path.join(ws, ".farm", "ui.log")).read()[-3000:])
    assert not refused, f"the UI was unreachable during the roll: {refused[:3]}"

    # the adopted runs finish and land, once each
    for tid in ids:
        wait_for(lambda: json.loads(cli("result", tid, "--json").stdout).get("status") == "done", timeout=60)
    assert {"slow1.txt", "slow2.txt"} <= repo_files(farmd["env"])
    log = [json.loads(line) for line in open(farmd["env"] / "claude.log")]
    for tid in ids:
        assert len([c for c in log if c.get("task") == tid]) == 1, "adopted, not run again"


def test_a_killed_farm_adopts_its_runs_when_it_comes_back(farmd):
    ws = farmd["ws"]
    p = farmd["start"]()
    tid = json.loads(cli("spawn", "slow", "--prompt", "SLOW 10 COMMIT survivor", "--json").stdout)["id"]
    before = wait_for(lambda: tasks_running(ws), timeout=40)
    os.killpg(p.pid, signal.SIGKILL)  # the farm daemon dies; its process group too (not the detached agents)
    p.wait(10)
    time.sleep(1)
    assert tasks_running(ws) == before, "the agent didn't die with the farm daemon"
    farmd["start"]()
    wait_for(lambda: json.loads(cli("result", tid, "--json").stdout).get("status") == "done", timeout=60)
    assert "survivor.txt" in repo_files(farmd["env"])
    log = [json.loads(line) for line in open(farmd["env"] / "claude.log")]
    assert len([c for c in log if c.get("task") == tid]) == 1, "adopted, not run again"


def test_a_release_that_keeps_crashing_is_rolled_back(env, tmp_path, monkeypatch):
    monkeypatch.setenv("FARM_MANAGE_CLAUDE_CONFIG", "0")
    ws = os.environ["FARM_WORKSPACE"]
    os.makedirs(ws, exist_ok=True)
    good = upgrade.install(ws, release_copy(tmp_path, "9.9.2"))
    upgrade.switch(ws, good)
    bad = upgrade.install(ws, release_copy(tmp_path, "9.9.3"))
    # it passed the checks, and still dies at start (a bug that shows only when the farm runs)
    with open(os.path.join(bad, "lib", "clodfarm", "supervisor.py"), "w") as f:
        f.write("raise SystemExit('this release is broken')\n")
    upgrade.switch(ws, bad)
    for _ in range(2):
        r = subprocess.run([sys.executable, "-m", "clodfarm", "run"], capture_output=True, text=True, timeout=60,
                           cwd=str(env))
        assert r.returncode != 0 and "broken" in r.stderr
    from clodfarm import boot
    assert boot.target(ws) == bad
    # the third start in a row goes back to the release before, and the farm comes up on it
    p = subprocess.Popen([sys.executable, "-m", "clodfarm", "run"], cwd=str(env), stdout=subprocess.DEVNULL,
                         stderr=subprocess.PIPE, text=True, start_new_session=True)
    try:
        pidfile = os.path.join(procs.pids_dir(ws), "farmd-primary.json")
        wait_for(lambda: procs.read_json(pidfile).get("pid") == p.pid, timeout=60)
        assert boot.target(ws) == good
        assert procs.read_json(pidfile)["release"] == os.path.basename(good)
        assert "back to 9.9.2" in open(os.path.join(boot.releases_dir(ws), "rollback.log")).read()
    finally:
        p.send_signal(signal.SIGTERM)
        p.wait(30)


def test_upgrade_status_and_rollback(env, tmp_path, monkeypatch):
    ws = os.environ["FARM_WORKSPACE"]
    os.makedirs(ws, exist_ok=True)
    r = cli("upgrade", "--from", release_copy(tmp_path, "9.9.4"))
    assert r.returncode == 0, r.stdout + r.stderr
    assert "no farm daemon is running" in r.stdout
    assert "9.9.4-" in cli("upgrade", "--status").stdout
    r = cli("upgrade", "--rollback")
    assert r.returncode == 0 and "the image" in r.stdout
    from clodfarm import boot
    assert boot.target(ws) == ""


def test_a_claude_waiting_for_its_login_hands_over_too(env, tmp_path, monkeypatch):
    """An added Claude whose person never finished logging in waits in its `clodfarm run`: an upgrade execs it too
    (same process, new release) instead of stopping it, and `upgrade` doesn't wait for it to become ready."""
    monkeypatch.setenv("FARM_MANAGE_CLAUDE_CONFIG", "0")
    monkeypatch.setenv("FAKE_LOGGED_IN", "0")
    ws = os.environ["FARM_WORKSPACE"]
    os.makedirs(ws, exist_ok=True)
    p = subprocess.Popen([sys.executable, "-m", "clodfarm", "run"], cwd=str(env), stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL, start_new_session=True)
    try:
        pidfile = os.path.join(procs.pids_dir(ws), "farmd-primary.json")
        wait_for(lambda: procs.read_json(pidfile).get("pid") == p.pid, timeout=60)
        assert not procs.read_json(pidfile).get("ready"), "it waits for its login"
        r = cli("upgrade", "--from", release_copy(tmp_path, "9.9.5"), "--wait", "60")
        assert r.returncode == 0, r.stdout + r.stderr
        info = procs.read_json(pidfile)
        assert info["pid"] == p.pid and info["release"].startswith("9.9.5-") and p.poll() is None
    finally:
        p.send_signal(signal.SIGTERM)
        p.wait(30)
