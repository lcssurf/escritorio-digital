# clodfarm docs

| Guide | What's in it |
|---|---|
| [architecture.md](architecture.md) | Modules, the DynamoDB data model, the task lifecycle, the git flow, failure handling |
| [budget.md](budget.md) | How the governor paces the 5-hour and weekly windows, per seat, and API-key mode |
| [multi-seat.md](multi-seat.md) | Several boxes and several Claude accounts in one farm |
| [bots.md](bots.md) | Bots: Claude Code on another model (OpenRouter, Ollama) that takes the sub-agents sent to it |
| [agents.md](agents.md) | What every Claude is told: budget, sub-agents, messages, schedules; the limits that keep a swarm sane |
| [auth.md](auth.md) | The four ways to log in, and their caveats |
| [ui.md](ui.md) | The farm UI: what you see, hatching agents, the password |
| [people.md](people.md) | Your own Claude, signing in from your phone, approvals, tools, the farm manager, private farms |
| [planner.md](planner.md) | The planner: a goal, cycles, delegating, building tools |
| [upgrades.md](upgrades.md) | New code without stopping any agent; a new image by draining |
| [dashboards.md](dashboards.md) | Dashboards the Claudes keep: the spec, stat history and trends, live dashboards |
| [browser.md](browser.md) | The farm's browser: log in to sites from the UI, the Claudes use them with their browser tools |
| [whiteboard.md](whiteboard.md) | Every Claude's whiteboard: draw together, diagrams laid out from Mermaid, the elements |
| [connectors.md](connectors.md) | Connectors: Slack, Stripe, Blender and Google Ads, connected once for every Claude |
| [slack.md](slack.md) | Give the farm work from Slack: connecting it, how it works, who can use it |
| [deploy-aws.md](deploy-aws.md) | The CloudFormation stack, costs, private repos, updating |
| [mcp.md](mcp.md) | Connect Claude Code on your computer (remote MCP, OAuth) |
| [security.md](security.md) | The threat model and hardening advice |
| [testing.md](testing.md) | The automated suite and the real-Claude and cloud test runs |
