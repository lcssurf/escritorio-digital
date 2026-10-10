# The planner

One Claude that works toward a goal all the time. The farm manager gives it the goal and switches it on; it then
runs in cycles, and between cycles it rests.

```bash
clodfarm planner goal "Get the onboarding funnel above 40%: find what's losing people and fix it"
clodfarm planner on                 # or the manager panel on the farm
clodfarm planner every 30m          # how long it rests between cycles (default 15m)
clodfarm planner host gil           # run it on another Claude (its person must allow it in SETTINGS)
clodfarm planner host gemini        # or on a bot: it thinks on Gemini, the Claudes write the code
clodfarm planner status | notes | off
```

Each cycle is a sub-agent of kind `plan` on the planner's Claude, so it's paced on that account's budget like any
other work, and you see it on the farm (the scarecrow) and on TASKS (PLANNER). In a cycle it:
1. reads its notebook (`/workspace/.farm/planner/NOTES.md`): its only memory between cycles;
2. looks at the farm: every Claude's usage, whether its person approves missions, and the tools, MCP servers and
   skills each one has (from its last run);
3. **delegates** the next steps as its own sub-agents, on the Claude whose budget and tools fit
   (`clodfarm spawn --on <claude>`). A Claude whose person approves every mission asks them first;
4. **builds tools** the goal needs and nobody has: a sub-agent writes a script, CLI, MCP server or skill into the
   repo's `tools/`, with tests, and it lands on main when the check passes;
5. tracks progress on a dashboard (`clodfarm dashboard metric planner ...`), rewrites its notebook and ends.

It is resumed with its sub-agents' results like any parent, and the next cycle starts once its wait (`every`) is up.
When there's nothing useful to do, it says so (`clodfarm planner idle 1h`). One farm daemon drives the planner, on
one box, whatever the number of boxes.

The planner is held to the farm's safety rules like every Claude: no email, posting, spending or accounts unless the
goal says the manager wants that.

## The planner on another model

The planner can run on a [bot](bots.md): GPT, Grok, Gemini or any other model the farm has a bot for. Pick it under
**MANAGE → THE PLANNER → RUNS ON**, or `clodfarm planner host <bot>`. A bot the farm manager added (from the manager's
panel, or `clodfarm bot add` on the box) may host it right away: it spends the provider key the manager gave the farm,
not a person's subscription. A bot someone else hatched needs their yes in its SETTINGS, like any Claude.

On a bot, each cycle is told that it is a bot and on which model, and how the work splits:

- **Coding goes to the Claudes:** anything that changes the repo is sent `--on <claude>`, so Claude Code on Claude
  writes, tests and lands the code.
- **Research, writing, analysis and reviews** stay on the bot (a sub-agent without `--on` stays on it) or go to the
  other bots with `--on <bot>`.
- The planner sees every bot's model and what it spent today at list price, next to every Claude's usage, so it
  can send cheap work to cheap models.

