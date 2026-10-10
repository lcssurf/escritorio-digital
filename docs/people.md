# People on the farm: your own Claude, approvals, the manager

A farm is watched by many and worked by a few. The farm UI knows who is looking:

| Who | How | What they can do |
|---|---|---|
| **The public** | Nothing: a farm is public by default | Watch: every Claude and what it's doing, the tasks' titles and status, schedules, tokens burned, the planner's goal. Never prompts, results, conversations, tools, logins or the browser. **Hatch** a Claude of their own. |
| **An owner** | The browser that hatched a Claude (a cookie), or the pairing link that Claude gives them | Everything about **their** Claude: its conversations, results and tools, its skin and settings, the missions waiting for their OK, their browser profiles. |
| **The farm manager** | The person of a manager Claude: the farm's first Claude, until a manager hands it on (no password) | Everything: the planner, a private farm, hatching limits, every Claude and profile. |

> [!IMPORTANT]
> A public farm shows its Claudes' names and task titles to anyone who can reach the UI's port. Keep the port on
> localhost (the default), or make the farm private (manager panel, or `clodfarm farm private`), before you publish
> the address.

## Your own Claude

**+ ADD AGENT** (or an egg) adds one, with two big choices: **ADD CLAUDE SUBSCRIPTION** (a Claude account logs in)
or **ADD AGENT WITH API KEY** (a [bot](bots.md): Claude Code on GPT, Grok, Gemini, Groq or another model, paid by its
key; each provider's endpoint is filled in, and EDIT ENDPOINT changes it). You choose, before it joins:
- **its look:** hat, hat and band colours, body tint, an accessory. Change it any time in its SETTINGS.
- **APPROVE EVERY MISSION** (on by default): other Claudes, the planner and anyone else can't just start work on
  it. Their mission waits until you say yes, on your phone.
- **ALL TOOLS**, or pick them: Shell, Edit files, Web, Sub-agents, Messaging, the farm's browser, other MCP tools. A
  tool you turn off is denied at every call (a PreToolUse hook, so it also holds with `bypassPermissions`), and a
  change applies at its next tool call. Read, Glob and Grep always work, and so do `clodfarm ...` commands: that is
  how your Claude talks to the farm.

You can also pick a **username and password** for it: you sign in with them instead of asking your Claude for a
code. It's optional with a Claude, and a must for an agent on an API key, which has no Claude to sign you in.

The browser you hatched from is now signed in to your Claude, and it can't hatch another one. The farm manager sets
how many Claudes a farm takes, how many an address may hatch an hour, and can close hatching.

### Signing in from your phone

In the Claude app, in your Claude's conversation, say **"farm login"** (or type `/farm-login`). Your Claude runs
`clodfarm pair` and gives you a link: tap it and your phone is signed in to your Claude on the farm. The link works
once, for 10 minutes. On another computer, tap **MY CLAUDE** on the farm's page and type the 6-letter code it gave
you too. Set `FARM_PUBLIC_URL` to the farm's address (e.g. `https://farm.example.com`) so the link points there.

Or sign in **with a username**: the username and password you chose when you added your agent, or later in its
SETTINGS → SIGN IN WITH A USERNAME (set, change or remove it). The sign-in screen has both tabs. Passwords are kept as
salted PBKDF2 hashes, and five wrong tries from one address lock it out for five minutes, as with codes.

The Claudes on a farm share one container, so this is a convenience, not a wall between them: see
[security.md](security.md).

## Approvals

When your Claude approves every mission:
- a sub-agent another Claude (or the planner, a schedule someone else made, Slack, a Claude Code over MCP) starts
  **on your Claude** waits as *pending*; so does a `clodfarm msg` to it. Its own sub-agents, your own requests and
  your conversations don't wait.
- you see **N TO APPROVE** at the top of the farm; tap it for who asks, the full request, APPROVE or DENY. With an
  ntfy topic in your Claude's SETTINGS, your phone gets a push for each one, with a link straight to it.
- a denied (or, after a day, expired) request goes back to whoever asked, as a message.
- your Claude doesn't take work sent to "any Claude" either: only its own and what you approved.

From a shell the manager can use `clodfarm approvals`, `clodfarm approve ID` and `clodfarm deny ID`. A Claude can't.

## The farm manager

There's no admin password. The person of a **manager Claude** runs the farm: at first the farm's own Claude (the one
the container logged in to, e.g. matan on the jestr farm). They sign in to it like anyone ("farm login" in the Claude
app, or MY CLAUDE with its code). In the manager panel's WHO RUNS THE FARM they make another Claude a manager too, or
hand the role over; the farm always keeps at least one. From the box's shell, `clodfarm farm manager [set|add|remove]
<claude>` always works, as the way back in.

The gear on the farm (or G) opens the manager panel:
- **the planner:** on/off, its goal, which Claude it runs on, how often (see [planner.md](planner.md));
- **privacy:** public (anyone watches the tokens and the Claudes at work), or private (only the people of its Claudes);
- **hatching:** open or closed, the most Claudes, hatches per address and hour;
- **owners:** sign a Claude's person out on every device;
- **the release,** and ROLL UI (see [upgrades.md](upgrades.md)).

From a shell: `clodfarm farm private | public | hatch-open | hatch-closed`, `clodfarm planner ...`.

## Inviting someone

+ ADD AGENT → INVITE SOMEONE (or MANAGE → INVITE SOMEONE, or `clodfarm invite` from the box, or in a conversation
with your Claude) makes a link for one person. It opens the farm on the same two choices:
- **MY CLAUDE SUBSCRIPTION:** they log in with their own Claude account (Anthropic's sign-in, the same as hatching),
  and may pick a username and password too;
- **MY AGENT ON AN API KEY:** they pick the provider and model and paste their key. The farm asks the model for one
  word first and keeps the agent only if it answers. They pick a username and password to sign in with later.

Either way their agent joins the farm with them as its person. It works once, for 7 days, even when the farm is
private or its hatching is closed. It's spent when they add it, not when the link is opened, so a chat app's preview
doesn't use it up. A host's cap on Claudes (`FARM_MAX_CLAUDES`) still counts.

Someone who opens a public farm without signing in only watches: the tokens burning and the Claudes at work, with the
key (top right) to sign in.

## A farm hosted for someone

When you run farms for other people, three settings let your own site sign them in and size the farm:

- `FARM_UI_SSO_KEY=<secret>`: your site sends its customer to `https://<farm>/sso?t=<token>`, and the farm signs
  that device in as the person of its manager Claude. A token is good once, for at most five minutes. It is made
  with `clodfarm.sso.make(key, farm_name)`: base64url JSON claims `{farm, sub, exp, n}`, a dot, and their
  HMAC-SHA256. Use one key per farm. The farm's own Claudes can read it, so it opens that farm and no other.
  The link signs you in to the farm, never to Claude: the Claude login stays in Claude Code's own sign-in.
- `FARM_UI_PRIVATE=1`: the farm is private whatever its settings say. Nobody watches without signing in.
- `FARM_MAX_CLAUDES=<n>`: the most Claudes (and bots) the farm keeps beyond its own, for everyone, the manager
  included. `0` means the farm's own Claude is its only one.

## The farm's browser

The browser is a Claude's tool. Each profile belongs to one Claude: only that Claude gets its tools, and only its
person sees it (the BROWSER button shows once you're signed in to your Claude). There is no farm-wide default profile:
a person adds up to 2 profiles for their Claude on `/browser` (`FARM_BROWSER_PER_CLAUDE`). The farm manager runs
them (on and off, the proxy, whose it is: `clodfarm browser assign <profile> <claude>`) but doesn't look inside. A
profile nobody owns belongs to the farm's own Claude.

## Usage

Top left, the farm shows the tokens burned by every Claude (input, output and cache, total and today). An owner also
sees their own Claude's: its tokens today and in total, and its 5-hour and weekly usage.
