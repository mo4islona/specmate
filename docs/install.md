# Installing SpecMate

A first run needs more than `docker compose up`. Some of it is generated (passwords), some is a
fact about the machine (the docker group id), some has to be built before anything can run (the
runner image), and two things live on someone else's website and only you can fetch them: a
Claude credential and a GitHub OAuth App client id.

`install.sh` walks that list.

```bash
./install.sh
```

Every step is a check and a fix. The script runs each check, prints what it found, and only
does work where the check failed. That is what makes it resumable: if it stops at step 7 —
you closed the laptop, the build failed, you didn't have the GitHub client id yet — running it
again re-checks steps 1 through 6, finds them already true, and picks up at 7. In this terminal
or a new one; there's no checkpoint file to go stale, because the state it reads is the machine
itself.

```bash
./install.sh --check              # report readiness, change nothing
./install.sh --only claude-token  # redo one step even though it passes
```

`--only` is how you rotate something later: a new Claude token, a re-authorized GitHub account.

## The steps

| Step | What it checks | If it can't fix it itself |
|---|---|---|
| `tools` | docker, compose, openssl, curl, and a daemon that answers | Install what's missing and start docker. |
| `env-file` | `.env` exists | Copies `.env.example`. |
| `runtime-mode` | `NODE_ENV=production`, `RUNNER_BACKEND=docker` | Sets both. `local` runs agents as children of the orchestrator and is a development-only mode. |
| `secrets` | `POSTGRES_PASSWORD` and `SPECMATE_PASSWORD` are set and not the placeholder | Generates both. See the Postgres note below. |
| `workspace` | `WORKSPACE_ROOT` is absolute, exists, and belongs to uid 10001 | Creates and chowns it; needs root. |
| `docker-group` | the orchestrator can reach the docker socket | Writes `docker-compose.override.yml` naming the host's docker group. |
| `version-pins` | `CLAUDE_CODE_VERSION` and `MISE_VERSION` are set | Resolves the current versions from npm. |
| `claude-token` | a Claude credential is set *and* named in `RUNNER_FORWARD_ENV` | Asks you for it — see below. |
| `runner-image` | the image exists and was built from the pinned CLI version | Builds it. Several minutes on a cold cache. |
| `services` | api and orchestrator answer `/readyz` | `docker compose up -d --build`, then waits. |
| `claude-auth` | the provider CLI actually accepts the credential | Points you back at `--only claude-token`. |
| `github` | a client id is set and a stored authorization hasn't expired | Asks for the client id, then runs the device flow. |

It finishes by printing the URL and your owner password. Every port binds to loopback, so reach
the box over a tailnet or an ssh tunnel — the service is not built to face the open internet.

## Claude access

Stages run the Claude Code CLI, and it needs a credential of your own. The default is a
long-lived token minted from your Claude subscription. Run this anywhere you're already signed
in — your laptop is fine, it doesn't have to be the server:

```bash
claude setup-token
```

It opens a browser and prints a token. Paste it when the installer asks. It's stored in `.env`
as `CLAUDE_CODE_OAUTH_TOKEN`, and `RUNNER_FORWARD_ENV` names it so the orchestrator hands it to
each stage — by name, so the value never lands on a command line where another process could
read it.

That token is a personal seat. Use it to run your own orchestrator, not to run SpecMate on other
people's behalf and not to resell access to Claude.

**Billing per token instead.** For anything commercial, use an API key:

```
ANTHROPIC_API_KEY=sk-ant-...
RUNNER_FORWARD_ENV=ANTHROPIC_API_KEY
```

The installer accepts either — `claude-token` passes as soon as `RUNNER_FORWARD_ENV` names a
variable that has a value, and `claude-auth` then proves the CLI accepts it.

**The interactive login still works.** `docker compose run --rm runner claude` signs in through a
browser and writes a session into the `specmate_claude-auth` volume, which stages mount. It needs
a terminal on the server (`ssh -t`), and it's lost if the volume is. Do it as the container's own
user, never as root — root-owned files in that volume are unreadable to stages. The token is the
better default for exactly these reasons.

## GitHub access

SpecMate clones repositories and opens pull requests as you, through an OAuth App you own:

1. <https://github.com/settings/developers> → **New OAuth App**
2. Any name and homepage URL; leave the callback URL blank
3. On the app's page, tick **Enable Device Flow**
4. Copy the Client ID

The installer stores the client id in `.env` and then runs GitHub's device flow: it prints a link
and a short code, you approve in a browser, and the resulting tokens are written to the database —
never to `.env`. The access token refreshes itself; the refresh token expires, and when it does
the `github` check goes red naming the date. Re-authorize with `./install.sh --only github`.

## When a step goes red

**The orchestrator won't start.** It refuses rather than failing every task it picks up, and it
says why on the way out:

```bash
docker compose logs orchestrator --tail 50
```

Two failures account for most of it. *The container runtime is unreachable* — the `docker-group`
step wrote the wrong group, usually because the host was reinstalled and the group id moved; re-run
`./install.sh --only docker-group`. *`<path>` resolves to a different directory on the host* — the
orchestrator hands the workspace path to the runtime, which resolves it on the host, so the two
have to mean the same thing. Use one absolute path everywhere, and don't point `WORKSPACE_ROOT` at
something only the container can see.

**A stage fails on auth.** The task fails naming the stage, and the stage's log holds the reason:

```
<WORKSPACE_ROOT>/tasks/<task-slug>/.specmate/<stage-id>-<attempt>/run.log
```

`Not logged in` means the credential is gone or was revoked. Mint a new one and re-run the task's
failed stage.

**Postgres rejects the password.** Postgres bakes its password into the role at first boot and
never reads `.env` again, so editing `POSTGRES_PASSWORD` against an existing volume leaves every
connection refused. Either restore the original value, or start the database clean:

```bash
docker compose down && docker volume rm specmate_pgdata
```

**The pinned CLI version changed but nothing did.** `CLAUDE_CODE_VERSION` and `MISE_VERSION` are
build args baked into the runner image; editing `.env` alone changes nothing. The `runner-image`
check compares the pin against a label on the image and goes red when they drift — re-running the
installer rebuilds.
