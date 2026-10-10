# Slack

Give the farm work from Slack. DM the farm's app, or @mention it in a channel, and a sub-agent does the job and answers
in the thread. It's the same as asking your Claude in the Claude app, from wherever your team already talks.

```
you     @clodfarm-jestr add CSV export to the report page
farm    🌱 On it: sub-agent `a1b2c3d4` on matan's account. I'll answer here when it's done.   (👀 on your message)
farm    *Done.* CSV export is on the report page, with tests. Landed on main as 3f2a1c9.        (✅)
you     @clodfarm-jestr and make the delimiter configurable      (a follow-up: it gets the thread so far)
```

- `status`: the Claudes on the farm, their usage and what's running. It answers at once and starts nothing.
- **Who runs it:** your own Claude, if you have one on the farm (your Slack email is the email of that Claude
  account). If you don't, a random Claude that has room for a sub-agent right now, or any Claude that is up when none
  has room. The reply says which one and why. The match compares seat ids (`gil-3f2a`, a short hash of the email),
  so the farm still never stores anyone's email.
- `gil: review the open PRs`: runs it on gil's account, whoever asks. Any Claude on the farm works.
- `help`: what it understands.

Each request is an ordinary sub-agent. You see it on the farm next to its Claude, it's paced by the budget governor,
and it lands on `main` only when `FARM_VERIFY_CMD` passes.

## Connect it (about two minutes, once)

Open the farm UI and click the **Slack** button, the one with the Slack logo (key `S`):

1. **CREATE THE SLACK APP.** On the Slack page, click Create an App → From a manifest → Continue. The manifest is
   already filled in (name, bot, scopes, events, Socket Mode): Next → Create, picking your workspace if it asks.
2. **Install to Workspace → Allow.** Then go to OAuth & Permissions and copy the *Bot User OAuth Token* (`xoxb-…`).
3. **Basic Information → App-Level Tokens → Generate Token and Scopes.** Give it any name, add `connections:write`,
   click Generate and copy the token (`xapp-…`).
4. Paste both tokens and click **CONNECT**. The farm checks them with Slack and connects. The button's dot turns
   green.

Without the UI, `clodfarm slack` prints the same link and steps. Set `FARM_SLACK_BOT_TOKEN` and
`FARM_SLACK_APP_TOKEN` (and optionally `FARM_SLACK_ALLOW`), then restart the farm.

In a channel, invite the app first (`/invite @clodfarm-<farm>`). A DM needs nothing.

Step 3 can't be skipped: Slack has no way to create an app-level token from the manifest. If your workspace
requires admin approval for new apps, an admin approves it after step 2.

## How it works

- **Socket Mode.** The farm opens an outbound WebSocket to Slack. It needs no public URL and no open port, so it
  works on a laptop, behind NAT and on the AWS deploy with no inbound ports, the same as Remote Control. The client
  uses the Python standard library only.
- **Events:** `app_mention` (channels) and `message.im` (DMs). The bot's scopes are `app_mentions:read`, `chat:write`,
  `im:history`/`im:read`/`im:write`, `reactions:write`, `users:read` and `users:read.email` (for the allow list), plus
  `channels:history`/`groups:history`/`mpim:history`, which let it read a thread you follow up in.
- **Each message is taken once**, even when Slack retries or several boxes of a multi-box farm hold a connection. The
  message is recorded in the store with a create-only write. The answer is also posted once: the box that deletes the
  pending record posts it.
- The sub-agent is told who asked, where, and the thread so far. Its final message is posted to the thread (Markdown
  turned into Slack's format, about 3,500 characters at most; `clodfarm result <id>` has all of it).

## Who can give it work

A request from Slack is a sub-agent with the farm's permissions, so it's limited:

- **By default:** full members of the workspace the app is installed in.
- **Never:** guests (single- and multi-channel), bots (including itself), deleted users, or people from another
  organisation in a Slack Connect channel. Each of them gets a polite no.
- **Narrow it** to a list of emails or Slack member IDs: WHO CAN GIVE IT WORK in the SLACK dialog, or
  `FARM_SLACK_ALLOW=gil@example.com,U012ABC`.

The tokens are kept in `<workspace>/.farm/slack.json` (mode 600) or come from the environment. The UI never shows
them again. **DISCONNECT** deletes the file. To revoke the tokens as well, remove the app in Slack.
