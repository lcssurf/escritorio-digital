# Security model

clodfarm gives autonomous agents a shell. Be deliberate about what that shell can reach.

## What the agents can do

- By default they run with `--permission-mode bypassPermissions` **inside the container**, as the unprivileged
  user `farm`. They can read and write anything that user can, run any program in the image, install packages in
  their home directory, and reach the network.
- They can read the Claude Code config volume, which includes your login. The farm guide tells them never to print
  or copy credentials, but **a prompt is not a security boundary.** A prompt injection (a malicious README, issue or
  web page) could try to make an agent leak what it can read.

## Recommendations

1. **Mount only what the agents may change.** By default that's `/workspace` and the Claude home volume. Don't
   mount the Docker socket, your home directory or cloud credentials.
2. **Least-privilege credentials.** Give git a deploy key for one repo, not a personal token. On AWS the instance
   role can touch only the farm's own table.
3. **Stricter permission modes** if the work allows:
   - `FARM_PERMISSION_MODE=auto`: Claude Code's safety classifier decides, and anything it would ask about is
     denied (nobody is there to answer).
   - `acceptEdits` or `dontAsk`, combined with `permissions.allow` / `deny` rules in
     `/home/farm/.claude/settings.json`.
4. **Network egress:** the agents need `api.anthropic.com`, `claude.ai`, your git host and whatever your work
   needs. Tighten the rest with a firewall or an egress proxy if the work is sensitive.
5. **Review before trusting.** With `FARM_PUSH=1` the farm pushes `main`. Point it at a branch-protected repo
   that requires review, or at a fork, if unreviewed code on main is unacceptable.
6. **Token hygiene:** if you use `CLAUDE_CODE_OAUTH_TOKEN`, keep `.env` out of git and prefer a secret store.
   Revoke tokens you no longer use.

## Who can see and do what on the farm UI

See [people.md](people.md). In short: a public farm (the default) shows every Claude's name, status and task titles
to anyone who can reach the UI's port, and lets them hatch one Claude (which runs code in your container). Keep the
port on localhost, make the farm private (`clodfarm farm private`: only the people of its Claudes see it), or close hatching
(`clodfarm farm hatch-closed`) before you expose it. Prompts, results, conversations, tools, logins and the browser
are only ever shown to a Claude's own person and to the farm manager.

- **Owner cookies** are HMAC-signed with a key of their own (`.farm/ui-keys.json`), last a year, are HttpOnly and
  SameSite=Lax (so the pairing link opened from the Claude app works), and are revoked by the manager's SIGN OUT
  (which bumps that Claude's owner version) or by releasing the Claude.
- **Pairing links** (`clodfarm pair`) work once, for 10 minutes; only their hash is stored. A pairing code is 6
  characters and counts toward the same per-address lockout as a wrong password.
- **Usernames and passwords** (optional for a Claude's person, a must for an agent on an API key) are kept as salted
  PBKDF2-SHA256 hashes (600,000 rounds) in the store (`LOGIN/<username>`), never the password. Five wrong tries from one
  address in five minutes lock it out. A username signs in to one Claude; releasing that Claude deletes it.
- **The Claudes share one container.** A Claude with a shell can read what the farm's user can read, including other
  Claudes' logins, and could run `clodfarm pair` as another Claude. Ownership, approvals and tool choices keep honest
  Claudes (and prompt injections that follow the farm's rules) in their lane; they are not a sandbox between Claudes.
  Give a Claude you don't trust no shell (its tools), or run it on its own box.
- **Tool choices** are enforced by a PreToolUse hook at every tool call (it holds with `bypassPermissions`), plus
  `--disallowedTools` for the built-in tools. A Claude without the shell can still run `clodfarm ...` commands
  (only single commands, no `;`, `|`, `&`, `$` or redirects).
- **Approvals** are given only by a person: the farm UI (the Claude's owner or the manager) or `clodfarm approve` from
  a shell; a Claude can't approve (the CLI refuses when it runs inside Claude Code).

## The farm's browser

Every site you log in to in a profile of the farm's browser ([browser.md](browser.md)) is open to the Claude that
profile belongs to, to that Claude's person and to the farm manager (and, through the shared container, to any Claude
with a shell that goes looking), and a web page the agents read could try a prompt injection with those sessions
in reach. Log in only to accounts you want the farm to act on (a separate account where the site allows it), and
log out there, or remove that profile, to take access back. Its DevTools and VNC ports
listen on 127.0.0.1 inside the container only; the screen reaches you only through the farm UI, behind its
password. Chromium runs with `--no-sandbox`: the container is its sandbox.

The browser's proxy login (SET PROXY) is kept in `/workspace/.farm/browser-proxy.json`, readable by the farm's user
only, and the UI never shows it again. The relay that adds the login listens on 127.0.0.1 in the container, so
anything on that box (every Claude, too) could send traffic through your proxy plan. It answers only proxy requests,
so a web page can't use it. The login travels to the proxy the way HTTP proxies take it: in the clear, as with any
tool that uses that proxy.

## Bots

A [bot](bots.md) sends its sub-agents' prompts, and the files they read, to its provider (OpenRouter, your Ollama, a
gateway), under that provider's terms: free tiers may log them. Its API key is kept in the bot's own Claude config
dir (`bot.json`, readable by the farm's user only) and the UI never shows it again. The container's Claude login is
never passed to a bot.

## The optional apps role

With [`deploy.sh apps-role`](deploy-aws.md#let-the-farm-build-apps-on-aws-optional) the agents can create real AWS
resources, and running apps cost real money. The role is fenced: serverless services only, a permissions boundary on
every role they create (so they can't widen their own rights), no IAM users, keys, email or domain purchases, and a
budget that locks the role at 100%. The boundary is what makes that hold; a prompt is not. Still:
- put the apps in **their own AWS account**, so a mistake or a prompt injection can only reach the farm's own apps;
- keep `--budget` at what you'd accept losing in a month, and read the 50% alert;
- remember that anything the agents deploy is public on the internet: review what they launch.

## What clodfarm itself does and doesn't do

- It never reads your credentials. It runs `claude auth status` and prints what that reports: logged in or not, the
  plan type, the email.
- The only network calls it makes itself go to DynamoDB. With the apps role on, it also writes an `apps` profile into
  the container's AWS CLI config; it never calls AWS with it itself. Everything else is Claude Code and the agents.
- It doesn't send messages, spend money, post publicly or create accounts. The guide tells agents not to either,
  unless the person they work for explicitly asks.

## Reporting a vulnerability

See [SECURITY.md](../SECURITY.md).
