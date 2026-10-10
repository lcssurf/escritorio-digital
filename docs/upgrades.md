# Upgrading without stopping the agents

A new clodfarm (the farm daemon, the UI, the CLI and the hooks) goes in while every agent keeps running: the
sub-agents mid-run, the conversations people have from the Claude app, the Claudes added in the UI and the farm's
browser. Nothing is interrupted and nothing is re-run.

```bash
docker exec clodfarm clodfarm upgrade                    # the newest main from GitHub
docker exec clodfarm clodfarm upgrade --ref v0.11.1      # a tag or branch
docker exec clodfarm clodfarm upgrade --from /src        # a checkout (or wheel, or pip/git URL) you have there
docker exec clodfarm clodfarm upgrade --status           # the release, and every process running on it
docker exec clodfarm clodfarm upgrade --rollback         # back to the release before
docker exec clodfarm clodfarm upgrade --restart-ui       # only restart the UI process (the page stays up)
deploy/aws/deploy.sh upgrade [--ref v0.11.1]             # the same on AWS, over SSM
curl -fsSL https://raw.githubusercontent.com/matank001/clodfarm/main/scripts/install.sh | sh -s upgrade
```

`upgrade` ends by showing that the agents are the same processes:

```
installed clodfarm 0.11.1 as 0.11.1-20261002-091500
handing over 3 farm daemon(s) with 5 agent process(es) running ...
every farm daemon runs 0.11.1-20261002-091500. Agents: 5 kept running (same processes).
```

## How it works

```
tini
└─ clodfarm run          the farm daemon: workers, schedules, mail, the planner, keeps the rest running
   ├─ run shim → claude -p ...                  every sub-agent run            detached, adopted
   ├─ run shim → claude remote-control ...      each Claude's phone sessions   detached, adopted
   ├─ clodfarm run --tag agent-<id>             each Claude added in the UI    detached, adopted
   ├─ Xvfb, x11vnc, Chromium per profile        the farm's browser             detached, adopted
   └─ clodfarm ui --tag ui-<id>                 the farm UI, its own process   rolled with no downtime
```

- **Runs outlive the daemon.** Every `claude` process is started by a small shim (`clodfarm/runshim.py`) that
  detaches from the daemon and keeps the process's stdin, output and exit code in files
  (`/workspace/.farm/runs/<claude>/<run>/`). The daemon reads those files instead of holding pipes. The shim is
  copied out of the package under a protocol name (`.farm/shim/runshim-v1.py`), so a new release never changes a
  shim that is running.
- **Hand-over.** `clodfarm upgrade` installs the new code into the workspace volume
  (`.farm/releases/<version>-<time>/lib`), checks that it imports and that its CLI answers, points
  `.farm/releases/current` at it, and sends SIGHUP to every farm daemon on the box. A daemon that gets SIGHUP stops
  taking new work, lets a worker that is landing finished work (merge, check) finish that, and execs the new release
  in the same process (tini and Docker see nothing). The new code adopts each run by its directory: it renews the
  task's lease and slot, and does the after-run steps (landing, results, retries) when it ends, as if nothing had
  happened. The added Claudes' daemons do the same, and the farm daemon rolls the UI.
- **The UI is its own process.** A new UI process binds the same port next to the old one (`SO_REUSEPORT`), says
  it's ready, and only then is the old one stopped: the page never sees the port closed. Watchers only ever talk to
  the UI process, so a crowd watching the farm never slows the agents.
- **Every `clodfarm` command runs the current release** (`clodfarm/boot.py`), including the hooks that running
  Claude Code sessions call. That is why hook payloads and store records stay backward compatible across releases.
- **A crash doesn't lose work either.** If the daemon is killed, its runs keep going; when it comes back it adopts
  them. If it stays down longer than a lease (5 minutes), the task goes back to the queue as before.
- **A release that keeps crashing is taken back.** Three starts of the daemon on one release within 3 minutes and
  boot points `current` back at the release before (or the image), and says so in `.farm/releases/rollback.log`.

## A new image

The in-place upgrade replaces Python code. Claude Code itself, system packages and new Python dependencies come
with a new image, and a container can't be replaced with its processes still in it. So a new image **drains** the
box instead of killing it:

```bash
docker exec clodfarm clodfarm drain --exit    # no new sub-agents here; running ones finish; then the farm stops
docker compose pull && docker compose up -d   # the new image
deploy/aws/deploy.sh roll                     # both, on AWS
```

While a box drains, the other boxes of a multi-box farm take the queue. A draining box waits for its conversations
to be between turns before it stops. `clodfarm drain --undo` takes work again. Claude Code updates itself in place
(`FARM_CLAUDE_UPDATE`), so an image roll is rare.
