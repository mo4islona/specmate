#!/usr/bin/env bash
#
# SpecMate first-run installer.
#
# Every step is a check and a fix. Running this again re-runs the checks and
# skips whatever is already true, so an interrupted install resumes where it
# stopped — in this terminal or a new one. There is no checkpoint file to go
# stale: the state is the machine itself.
#
#   ./install.sh                set up whatever is not set up yet
#   ./install.sh --check        report readiness, change nothing
#   ./install.sh --only <step>  redo one step even if it already passes
#   ./install.sh --host <ssh>   do all of that on another machine
#                               (--dir <path>, default /opt/specmate)
#
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

readonly ENV_FILE=.env
readonly OVERRIDE_FILE=docker-compose.override.yml
# The uid the api, orchestrator, and runner images all share, so the three can
# touch the same worktree. The workspace root has to belong to it.
readonly SERVICE_UID=10001

# Every step in order. A step tied to a provider runs only when `providers` has
# that one configured; the rest always run.
readonly STEPS=(
  tools
  env-file
  providers
  runtime-mode
  secrets
  workspace
  docker-group
  version-pins
  claude-token
  runner-image
  services
  claude-auth
  codex-auth
  github
)

# ─── output ───────────────────────────────────────────────────────────────────

if [[ -t 1 ]]; then
  readonly DIM=$'\e[2m' BOLD=$'\e[1m' GREEN=$'\e[32m' YELLOW=$'\e[33m' RED=$'\e[31m' RESET=$'\e[0m'
else
  readonly DIM='' BOLD='' GREEN='' YELLOW='' RED='' RESET=''
fi

pass() { printf '  %s✓%s  %-14s %s%s%s\n' "$GREEN" "$RESET" "$1" "$DIM" "$2" "$RESET"; }
todo() { printf '  %s•%s  %-14s %s\n' "$YELLOW" "$RESET" "$1" "$2"; }
say() { printf '     %s%s%s\n' "$DIM" "$1" "$RESET"; }

die() {
  printf '\n  %serror%s  %s\n\n' "$RED" "$RESET" "$1" >&2
  exit 1
}

# ─── .env ─────────────────────────────────────────────────────────────────────

# Never `source` the file: values are secrets and arbitrary text, and a stray
# backtick or $( would execute.
env_get() {
  [[ -f $ENV_FILE ]] || return 0
  awk -v key="$1" 'index($0, key "=") == 1 { print substr($0, length(key) + 2); exit }' "$ENV_FILE"
}

env_set() {
  local key=$1 value=$2 tmp
  tmp=$(mktemp)
  awk -v key="$key" -v value="$value" '
    index($0, key "=") == 1 && !done { print key "=" value; done = 1; next }
    { print }
    END { if (!done) print key "=" value }
  ' "$ENV_FILE" >"$tmp"
  mv "$tmp" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
}

env_or() {
  local value
  value=$(env_get "$1")
  printf '%s' "${value:-$2}"
}

generate_secret() { openssl rand -base64 24; }

# Only host-run commands read DATABASE_URL; the services build their own from
# the POSTGRES_* variables. Keeping the two in step avoids a `db:migrate` that
# is refused for a reason nothing on screen explains.
database_url() {
  printf 'postgres://%s:%s@localhost:%s/%s' \
    "$(env_or POSTGRES_USER specmate)" "$1" \
    "$(env_or POSTGRES_PORT 5432)" "$(env_or POSTGRES_DB specmate)"
}

# ─── providers ────────────────────────────────────────────────────────────────

# The providers a stage can actually run. `copilot` is in the database's enum
# and in nothing else, so offering it here would only build a deployment that
# fails at the first stage bound to it.
readonly PROVIDERS=(claude-code codex)

provider_label() {
  case $1 in
  claude-code) printf 'Claude Code' ;;
  codex) printf 'Codex' ;;
  esac
}

# The compose service in the `tools` profile that mounts this provider's auth
# volume, so a login run through it writes where its stages will read.
provider_service() {
  case $1 in
  claude-code) printf 'runner' ;;
  codex) printf 'runner-codex' ;;
  esac
}

# The provider a step belongs to, or nothing when it belongs to all of them.
step_provider() {
  case $1 in
  claude-token | claude-auth) printf 'claude-code' ;;
  codex-auth) printf 'codex' ;;
  esac
}

# Spaces stripped, not just commas split: `claude-code, codex` is accepted
# everywhere else that reads this, and matching it literally would silently skip
# the second provider's steps.
provider_selected() {
  local configured
  configured=$(env_or AVAILABLE_PROVIDERS claude-code)
  [[ ",${configured// /}," == *",$1,"* ]]
}

# The names in a provider's forward list are what the orchestrator hands to a
# stage, so a credential that is set but not listed there never reaches the
# agent.
provider_forwarded() {
  local forwarded name
  forwarded=$(env_get "$(tr 'a-z-' 'A-Z_' <<<"$1")_FORWARD_ENV")

  for name in ${forwarded//,/ }; do
    if [[ -n $(env_get "$name") ]]; then
      printf '%s' "$name"
      return 0
    fi
  done

  return 1
}

runner_image() { env_or RUNNER_IMAGE specmate/runner-universal:local; }

# `compose run` would build a missing image, which is minutes of work inside
# what is supposed to be a probe.
runner_image_built() { docker image inspect "$(runner_image)" >/dev/null 2>&1; }

# Runs a command against one provider's session. Its forwarded credential is
# exported inside the subshell and passed by name: the value never appears in
# any process's arguments, where other users on the box could read it.
provider_run() {
  local provider=$1
  shift
  (
    local credential
    credential=$(provider_forwarded "$provider") || credential=

    if [[ -z $credential ]]; then
      docker compose --profile tools run --rm --no-deps -T \
        "$(provider_service "$provider")" "$@" 2>&1
      return
    fi

    export "${credential}=$(env_get "$credential")"
    docker compose --profile tools run --rm --no-deps -T -e "$credential" \
      "$(provider_service "$provider")" "$@" 2>&1
  )
}

# ─── host ─────────────────────────────────────────────────────────────────────

path_uid() {
  if [[ $(uname -s) == Darwin ]]; then
    stat -f '%u' "$1" 2>/dev/null
  else
    stat -c '%u' "$1" 2>/dev/null
  fi
}

socket_gid() { stat -c '%g' /var/run/docker.sock 2>/dev/null; }

as_root() {
  if [[ $EUID -eq 0 ]]; then
    "$@"
  elif command -v sudo >/dev/null; then
    sudo "$@"
  else
    die "this step needs root and sudo is not installed: $*"
  fi
}

npm_latest() {
  curl -fsS -m 20 "https://registry.npmjs.org/$1/latest" |
    grep -o '"version":"[^"]*"' | head -1 | cut -d'"' -f4
}

psql_query() {
  docker compose exec -T postgres \
    psql -U "$(env_or POSTGRES_USER specmate)" -d "$(env_or POSTGRES_DB specmate)" -tAc "$1" 2>/dev/null
}

# ─── steps ────────────────────────────────────────────────────────────────────
#
# A check prints one line saying why it passed or failed, and returns 0 or 1.
# A fix does the work, or dies with what the operator has to do by hand.

check_tools() {
  local missing=()
  command -v docker >/dev/null || missing+=(docker)
  docker compose version >/dev/null 2>&1 || missing+=("docker compose")
  command -v openssl >/dev/null || missing+=(openssl)
  command -v curl >/dev/null || missing+=(curl)
  if ((${#missing[@]})); then
    echo "not installed: ${missing[*]}"
    return 1
  fi
  if ! docker version >/dev/null 2>&1; then
    echo "the docker daemon is not answering"
    return 1
  fi
  echo "docker, compose, openssl, curl"
}

fix_tools() {
  die "install what is missing and make sure the docker daemon is running, then run this again"
}

check_env_file() {
  [[ -f $ENV_FILE ]] || {
    echo "no .env yet"
    return 1
  }
  echo ".env exists"
}

fix_env_file() {
  cp .env.example "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  say "copied .env.example to .env"
}

check_providers() {
  local configured provider chosen=()
  configured=$(env_get AVAILABLE_PROVIDERS)
  [[ -n $configured ]] || {
    echo "no agent has been chosen yet"
    return 1
  }

  for provider in ${configured//,/ }; do
    # shellcheck disable=SC2076
    [[ " ${PROVIDERS[*]} " == *" $provider "* ]] || {
      echo "AVAILABLE_PROVIDERS names $provider, which no stage here can run"
      return 1
    }
    chosen+=("$provider")
  done

  # Read back from what was validated rather than echoed as written, so a value
  # spelled with spaces does not print with doubled ones.
  echo "${chosen[*]}"
}

# A ticked list rather than a numbered menu: what is being answered is a set,
# and a menu would have to carry a line per combination of it. Drawn by
# repainting the same rows in place, so the choice reads as one thing being
# edited rather than a transcript of every keystroke.
#
# The answer lands in CHOSEN_PROVIDERS instead of on stdout, because a command
# substitution would capture the drawing along with it.
CHOSEN_PROVIDERS=

choose_providers() {
  local total=${#PROVIDERS[@]}
  local ticked=() cursor=0 index drawn=0 key tail mark pointer
  local hint='↑↓ move · space ticks · enter confirms'

  # Opens on whatever is configured, so running this again edits the answer
  # rather than asking for it from nothing.
  for ((index = 0; index < total; index++)); do
    if provider_selected "${PROVIDERS[index]}"; then ticked[index]=1; else ticked[index]=0; fi
  done

  printf '\e[?25l'
  trap 'printf "\e[?25h"' EXIT

  while :; do
    ((drawn)) && printf '\e[%dA' $((total + 1))

    for ((index = 0; index < total; index++)); do
      mark=' '
      ((ticked[index])) && mark='x'
      pointer='  '
      ((index == cursor)) && pointer="${BOLD}❯${RESET} "
      printf '\r\e[K  %s[%s]  %s\n' "$pointer" "$mark" "$(provider_label "${PROVIDERS[index]}")"
    done
    printf '\r\e[K  %s%s%s\n' "$DIM" "$hint" "$RESET"
    drawn=1

    IFS= read -rsn1 key || key=''

    # Every branch ends on an assignment. An arithmetic command that evaluates
    # to zero reports failure, and as the last thing a branch does that would
    # take the whole script down under errexit.
    case $key in
    '')
      # Nothing ticked is not an installation, so enter has nothing to confirm.
      for ((index = 0; index < total; index++)); do
        ((ticked[index])) && break 2
      done
      hint='pick at least one agent'
      ;;
    ' ') ticked[cursor]=$((1 - ticked[cursor])) ;;
    [1-9])
      index=$((key - 1))
      if ((index < total)); then
        ticked[index]=$((1 - ticked[index]))
        cursor=$index
      fi
      ;;
    k) cursor=$(((cursor - 1 + total) % total)) ;;
    j) cursor=$(((cursor + 1) % total)) ;;
    $'\e')
      # An arrow arrives as ESC [ A. Read the rest of it, or the bracket lands
      # on the list as a keystroke of its own.
      IFS= read -rsn2 tail || tail=''
      case $tail in
      '[A') cursor=$(((cursor - 1 + total) % total)) ;;
      '[B') cursor=$(((cursor + 1) % total)) ;;
      esac
      ;;
    esac
  done

  printf '\e[?25h'
  trap - EXIT

  local chosen=()
  for ((index = 0; index < total; index++)); do
    ((ticked[index])) && chosen+=("${PROVIDERS[index]}")
  done

  local IFS=,
  CHOSEN_PROVIDERS="${chosen[*]}"
}

fix_providers() {
  # The remote path runs without a terminal, and so does CI. Choosing the
  # default beats hanging on a read nobody is there to answer.
  if [[ ! -t 0 || ! -t 1 ]]; then
    env_set AVAILABLE_PROVIDERS claude-code
    say "no terminal to ask on — chose claude-code; change it with ./install.sh --only providers"
    return 0
  fi

  cat <<EOF

  ${BOLD}Agents${RESET}
  Every stage runs on one of these. Tick the ones this deployment may use: a
  role's binding then picks among them, and a task can only have its work
  checked by a different agent than wrote it when there is more than one.

  Each brings its own credential, and only the ones ticked here are asked for.

EOF

  choose_providers
  env_set AVAILABLE_PROVIDERS "$CHOSEN_PROVIDERS"

  echo
  say "recorded AVAILABLE_PROVIDERS=$CHOSEN_PROVIDERS"
}

check_runtime_mode() {
  local node_env runner_backend
  node_env=$(env_get NODE_ENV)
  runner_backend=$(env_get RUNNER_BACKEND)
  if [[ $node_env != production || $runner_backend != docker ]]; then
    echo "NODE_ENV=${node_env:-unset}, RUNNER_BACKEND=${runner_backend:-unset}"
    return 1
  fi
  echo "production, one container per stage"
}

fix_runtime_mode() {
  env_set NODE_ENV production
  env_set RUNNER_BACKEND docker
  say "set NODE_ENV=production and RUNNER_BACKEND=docker"
}

check_secrets() {
  local database owner
  database=$(env_get POSTGRES_PASSWORD)
  owner=$(env_get SPECMATE_PASSWORD)
  if [[ -z $database || $database == change-me-in-production ]]; then
    echo "POSTGRES_PASSWORD is unset or still the placeholder"
    return 1
  fi
  if [[ -z $owner ]]; then
    echo "SPECMATE_PASSWORD is unset"
    return 1
  fi

  # A password written into .env by hand satisfies the two checks above while
  # leaving the example's URL, and its placeholder password, untouched.
  if [[ $(env_get DATABASE_URL) != "$(database_url "$database")" ]]; then
    echo "DATABASE_URL does not carry POSTGRES_PASSWORD"
    return 1
  fi

  echo "database and owner passwords set"
}

fix_secrets() {
  local database owner
  database=$(env_get POSTGRES_PASSWORD)
  owner=$(env_get SPECMATE_PASSWORD)

  if [[ -z $database || $database == change-me-in-production ]]; then
    # Postgres bakes the password into its role at first boot and never reads
    # .env again, so generating a fresh one against an existing volume would
    # leave every connection rejected.
    if docker volume inspect specmate_pgdata >/dev/null 2>&1; then
      die "the specmate_pgdata volume already exists, but POSTGRES_PASSWORD is unset here.
     That database has its own password baked in and will reject a new one.
     Put the original value in .env, or start clean:
       docker compose down && docker volume rm specmate_pgdata"
    fi
    # Goes into DATABASE_URL, where a / or + would be parsed as URL syntax.
    database=$(openssl rand -hex 24)
    env_set POSTGRES_PASSWORD "$database"
    say "generated POSTGRES_PASSWORD"
  fi

  if [[ -z $owner ]]; then
    owner=$(generate_secret)
    env_set SPECMATE_PASSWORD "$owner"
    say "generated SPECMATE_PASSWORD — printed at the end, it is your login"
  fi

  env_set DATABASE_URL "$(database_url "$database")"
}

check_workspace() {
  local root uid
  root=$(env_get WORKSPACE_ROOT)
  [[ -n $root ]] || {
    echo "WORKSPACE_ROOT is unset"
    return 1
  }
  # The orchestrator hands this path to the container runtime, which resolves it
  # on the host — a relative path means different things on the two sides.
  [[ $root == /* ]] || {
    echo "WORKSPACE_ROOT must be absolute, got $root"
    return 1
  }
  [[ -d $root ]] || {
    echo "$root does not exist"
    return 1
  }
  uid=$(path_uid "$root")
  [[ $uid == "$SERVICE_UID" ]] || {
    echo "$root belongs to uid ${uid:-unknown}, not $SERVICE_UID"
    return 1
  }
  echo "$root"
}

fix_workspace() {
  local root
  root=$(env_get WORKSPACE_ROOT)
  [[ -n $root ]] || die "set WORKSPACE_ROOT in .env to an absolute path first"
  [[ $root == /* ]] || die "WORKSPACE_ROOT must be an absolute path, got $root"

  as_root mkdir -p "$root"
  as_root chown -R "$SERVICE_UID:$SERVICE_UID" "$root"
  say "created $root and gave it to uid $SERVICE_UID"
}

# The groups the orchestrator ends up in once compose has merged every file it
# is going to read. Asking the assembled config rather than the override on
# disk is the whole point: COMPOSE_FILE, when set, replaces compose's own file
# discovery, and an override that is not named in that list goes unread however
# right its contents are.
orchestrator_groups() {
  docker compose config 2>/dev/null | awk '
    /^  [a-z][a-z-]*:/ { service = substr($1, 1, length($1) - 1) }
    service == "orchestrator" && /^    group_add:/ { list = 1; next }
    list && /^    [a-z]/ { list = 0 }
    list && /^      - / { gsub(/[^0-9]/, ""); if (length($0)) print }
  '
}

check_docker_group() {
  if [[ $(uname -s) != Linux ]]; then
    echo "not Linux — the socket is not group-owned here"
    return 0
  fi

  local gid
  gid=$(socket_gid) || true
  [[ -n $gid ]] || {
    echo "cannot read /var/run/docker.sock"
    return 1
  }

  grep -qx "$gid" <<<"$(orchestrator_groups)" || {
    echo "nothing compose reads puts the orchestrator in group $gid"
    return 1
  }
  echo "orchestrator joins docker group $gid"
}

fix_docker_group() {
  local gid
  gid=$(socket_gid) || true
  [[ -n $gid ]] || die "/var/run/docker.sock is not readable — is the docker daemon running?"

  cat >"$OVERRIDE_FILE" <<EOF
# Written by install.sh. Not committed: the docker group id is a fact about
# this machine.
#
# The orchestrator runs as an unprivileged uid that belongs to no host group,
# and the mounted docker socket is root:docker 0660. Without this it cannot
# start a stage.
services:
  orchestrator:
    group_add:
      - '${gid}'
EOF
  say "wrote $OVERRIDE_FILE for docker group $gid"

  if grep -qx "$gid" <<<"$(orchestrator_groups)"; then
    return 0
  fi

  # Written, but not read. A COMPOSE_FILE list is exactly the set of files
  # compose loads, and a file just created is not among them.
  local compose_file
  compose_file=$(env_get COMPOSE_FILE)
  if [[ -n $compose_file ]]; then
    die "COMPOSE_FILE is set in .env, so compose never reads $OVERRIDE_FILE.
     Add it to the end of that list:
       COMPOSE_FILE=${compose_file}:${OVERRIDE_FILE}"
  fi
}

check_version_pins() {
  local claude codex mise
  claude=$(env_get CLAUDE_CODE_VERSION)
  codex=$(env_get CODEX_VERSION)
  mise=$(env_get MISE_VERSION)
  if [[ -z $claude || -z $codex || -z $mise ]]; then
    echo "CLAUDE_CODE_VERSION=${claude:-unset}, CODEX_VERSION=${codex:-unset}, MISE_VERSION=${mise:-unset}"
    return 1
  fi
  echo "claude-code $claude, codex $codex, mise $mise"
}

fix_version_pins() {
  # Pinned, not floating: a stage's environment has to be reproducible, and the
  # image bakes every version in at build time. Both provider CLIs are pinned
  # whether or not both are in AVAILABLE_PROVIDERS — one image carries both, so
  # turning the second one on must not need a rebuild.
  local claude codex mise
  claude=$(env_get CLAUDE_CODE_VERSION)
  codex=$(env_get CODEX_VERSION)
  mise=$(env_get MISE_VERSION)

  if [[ -z $claude ]]; then
    claude=$(npm_latest @anthropic-ai/claude-code) ||
      die "could not reach the npm registry to resolve the latest claude-code"
    [[ -n $claude ]] || die "the npm registry returned no version for @anthropic-ai/claude-code"
    env_set CLAUDE_CODE_VERSION "$claude"
    say "pinned claude-code to $claude"
  fi

  if [[ -z $codex ]]; then
    codex=$(npm_latest @openai/codex) ||
      die "could not reach the npm registry to resolve the latest codex"
    [[ -n $codex ]] || die "the npm registry returned no version for @openai/codex"
    env_set CODEX_VERSION "$codex"
    say "pinned codex to $codex"
  fi

  if [[ -z $mise ]]; then
    mise=$(npm_latest mise) || die "could not reach the npm registry to resolve the latest mise"
    [[ -n $mise ]] || die "the npm registry returned no version for mise"
    env_set MISE_VERSION "$mise"
    say "pinned mise to $mise"
  fi
}

check_claude_token() {
  local name
  name=$(provider_forwarded claude-code) || {
    echo "no Claude credential is set and forwarded to stages"
    return 1
  }
  echo "$name is set and forwarded"
}

fix_claude_token() {
  cat <<EOF

  ${BOLD}Claude access${RESET}
  Stages run the Claude Code CLI, which needs your own credential. The default
  is a long-lived token minted from your Claude subscription. On any machine
  where you are already signed in — your laptop is fine — run:

      ${BOLD}claude setup-token${RESET}

  It opens a browser, then prints a token. Paste it below. Nothing is echoed.

  Prefer per-token API billing instead? Leave this blank, put ANTHROPIC_API_KEY
  in .env, and set CLAUDE_CODE_FORWARD_ENV=ANTHROPIC_API_KEY.

EOF
  local token
  read -rsp "  token: " token
  echo
  [[ -n $token ]] || die "no token entered — nothing was changed, run ./install.sh again when you have one"

  env_set CLAUDE_CODE_OAUTH_TOKEN "$token"
  env_set CLAUDE_CODE_FORWARD_ENV CLAUDE_CODE_OAUTH_TOKEN
  say "stored the token in .env and set it to be forwarded into stages"
}

check_runner_image() {
  local image built pinned
  image=$(runner_image)
  runner_image_built || {
    echo "$image is not built yet"
    return 1
  }

  # The pins are build args baked into the image, so an .env edit alone leaves
  # the old CLI running. The labels are how the two are told apart.
  built=$(docker image inspect --format \
    '{{index .Config.Labels "com.specmate.claude-code-version"}}' "$image" 2>/dev/null)
  pinned=$(env_get CLAUDE_CODE_VERSION)
  if [[ -n $pinned && $built != "$pinned" ]]; then
    echo "$image carries claude-code ${built:-unknown}, but .env pins $pinned"
    return 1
  fi

  local built_codex pinned_codex
  built_codex=$(docker image inspect --format \
    '{{index .Config.Labels "com.specmate.codex-version"}}' "$image" 2>/dev/null)
  pinned_codex=$(env_get CODEX_VERSION)
  if [[ -n $pinned_codex && $built_codex != "$pinned_codex" ]]; then
    echo "$image carries codex ${built_codex:-unknown}, but .env pins $pinned_codex"
    return 1
  fi
  echo "$image, claude-code ${built:-unlabelled}, codex ${built_codex:-unlabelled}"
}

fix_runner_image() {
  say "building the runner image — it pulls a Debian base and the pinned CLI, so give it a few minutes"
  docker compose --profile tools build runner
}

check_services() {
  curl -fsS -m 5 "http://127.0.0.1:$(env_or API_PORT 4000)/readyz" >/dev/null 2>&1 || {
    echo "the api does not answer /readyz"
    return 1
  }
  curl -fsS -m 5 "http://127.0.0.1:$(env_or ORCHESTRATOR_PORT 4100)/readyz" >/dev/null 2>&1 || {
    echo "the orchestrator does not answer /readyz"
    return 1
  }
  echo "api and orchestrator are ready"
}

fix_services() {
  say "starting postgres, migrations, api, orchestrator, web"
  docker compose up -d --build

  local waited=0
  while ((waited < 180)); do
    if check_services >/dev/null 2>&1; then
      say "services are up"
      return 0
    fi
    sleep 3
    waited=$((waited + 3))
  done

  docker compose ps
  die "the services did not become ready within three minutes.
     The orchestrator exits when it cannot reach docker or the workspace root:
       docker compose logs orchestrator --tail 50"
}

check_claude_auth() {
  local output
  provider_forwarded claude-code >/dev/null || {
    echo "no credential to check"
    return 1
  }
  runner_image_built || {
    echo "the runner image is not built yet"
    return 1
  }

  output=$(provider_run claude-code claude auth status --json) || {
    echo "the provider CLI would not run: $(tr '\n' ' ' <<<"$output" | tail -c 120)"
    return 1
  }

  grep -q '"loggedIn": *true' <<<"$output" || {
    echo "the provider reports no valid session"
    return 1
  }
  echo "the provider accepts the credential"
}

fix_claude_auth() {
  cat <<EOF

  The credential in .env did not authenticate. Either it was mistyped, or it has
  been revoked. Mint a fresh one with ${BOLD}claude setup-token${RESET} and record it with:

      ./install.sh --only claude-token

EOF
  die "Claude access is not working yet"
}

check_codex_auth() {
  local output
  runner_image_built || {
    echo "the runner image is not built yet"
    return 1
  }

  # Nothing to ask for in JSON: `codex login status` says it in one line and in
  # its exit code. It reads the stored session, not the environment — an API key
  # forwarded by name authenticates nothing here.
  output=$(provider_run codex codex login status) || {
    echo "the provider CLI reports: $(tr '\n' ' ' <<<"$output" | tail -c 120)"
    return 1
  }
  echo "the provider accepts the credential"
}

fix_codex_auth() {
  local stored key prompt
  stored=$(env_get CODEX_API_KEY)

  [[ -t 0 ]] || die "signing Codex in needs a terminal.
     Reach the box with ssh -t, or put an OpenAI key in CODEX_API_KEY and run:
       ./install.sh --only codex-auth"

  cat <<EOF

  ${BOLD}Codex access${RESET}
  Stages run the Codex CLI, which authenticates from a session file of its own
  rather than from the environment. Whichever way you go below writes that file
  into the volume the stages mount.

  Paste an OpenAI API key to bill per token. It is kept in .env as well, so a
  lost volume can be refilled without asking you for it again.

EOF

  # Blank means the stored key when there is one, and the other way in when
  # there is not — so the prompt has to say which.
  if [[ -n $stored ]]; then
    prompt="  api key (blank to reuse the one in .env): "
  else
    cat <<EOF
  Leave it blank to sign in with a ChatGPT account instead: a link and a short
  code are printed here, and it waits for you.

EOF
    prompt="  api key (blank to sign in with ChatGPT): "
  fi

  read -rsp "$prompt" key
  echo

  if [[ -z $key && -z $stored ]]; then
    say "opening the device sign-in"
    docker compose --profile tools run --rm --no-deps runner-codex codex login --device-auth
    return 0
  fi

  if [[ -n $key ]]; then
    env_set CODEX_API_KEY "$key"
    say "stored the key in .env"
  else
    key=$stored
  fi

  printf '%s' "$key" |
    docker compose --profile tools run --rm --no-deps -T runner-codex codex login --with-api-key
}

check_github() {
  local client_id expires
  client_id=$(env_get GITHUB_APP_CLIENT_ID)
  [[ -n $client_id ]] || {
    echo "GITHUB_APP_CLIENT_ID is unset"
    return 1
  }

  expires=$(psql_query "select value->>'refreshTokenExpiresAt' from app_settings where key = 'github-auth'") || {
    echo "could not read the database"
    return 1
  }
  [[ -n $expires ]] || {
    echo "no GitHub authorization is stored"
    return 1
  }
  # Both sides are ISO-8601 UTC, so the seconds prefix compares as text.
  if [[ ${expires:0:19} < $(date -u +%Y-%m-%dT%H:%M:%S) ]]; then
    echo "the stored authorization expired on ${expires:0:10}"
    return 1
  fi
  echo "authorized, valid until ${expires:0:10}"
}

fix_github() {
  local client_id
  client_id=$(env_get GITHUB_APP_CLIENT_ID)

  if [[ -z $client_id ]]; then
    cat <<EOF

  ${BOLD}GitHub access${RESET}
  SpecMate clones repositories and opens pull requests as you, through an OAuth
  App you own. Create one — it takes a minute:

      1. https://github.com/settings/developers → New OAuth App
      2. Any name and homepage URL; leave the callback URL blank
      3. On the app's page, tick ${BOLD}Enable Device Flow${RESET}
      4. Copy the Client ID

EOF
    read -rp "  Client ID: " client_id
    [[ -n $client_id ]] || die "a client id is required — run ./install.sh again once you have one"
    env_set GITHUB_APP_CLIENT_ID "$client_id"
    say "recording it and restarting the services that read it"
    docker compose up -d api orchestrator
  fi

  echo
  say "open the link below and enter the code, then approve on the page after it"
  say "this waits for you"
  echo
  docker compose exec -T orchestrator bun apps/orchestrator/src/admin.ts github-login
}

# ─── driver ───────────────────────────────────────────────────────────────────

run_step() {
  local step=$1 fn=${1//-/_} reason status=0

  reason=$("check_$fn") || status=$?
  if ((status == 0)); then
    pass "$step" "$reason"
    return 0
  fi

  todo "$step" "$reason"
  if [[ $MODE == check ]]; then
    return 1
  fi

  "fix_$fn"

  status=0
  reason=$("check_$fn") || status=$?
  if ((status != 0)); then
    die "$step is still not satisfied: $reason"
  fi
  pass "$step" "$reason"
}

summary() {
  local port owner agents
  port=$(env_or WEB_PORT 5173)
  owner=$(env_get SPECMATE_PASSWORD)
  agents=$(env_or AVAILABLE_PROVIDERS claude-code)
  agents=${agents// /}

  cat <<EOF

  ${GREEN}${BOLD}SpecMate is ready.${RESET}

  Open      http://127.0.0.1:${port}
  Password  ${owner}
  Agents    ${agents//,/ }

  Every port binds to loopback: reach the box over a tailnet or an ssh tunnel,
  not the open internet. The password is in .env if you need it again.

EOF

  if provider_selected claude-code; then
    cat <<EOF
  Claude runs on your own subscription seat. Keep it to your own orchestrator —
  see docs/install.md.

EOF
  fi
}

# Every step here reads one machine: whether its docker daemon answers, what
# group owns its socket, who owns its workspace root. Asking all of that from a
# laptop would be this same script with ssh around each line and a worse story
# when a connection drops, so the script travels to the machine and runs there.
remote_install() {
  local args=''
  ((${#PASSTHROUGH[@]})) && args=$(printf ' %q' "${PASSTHROUGH[@]}")

  command -v rsync >/dev/null || die "--host needs rsync here, to copy the source over"
  ssh "$HOST" "mkdir -p $(printf %q "$DIR")" || die "cannot reach $HOST over ssh"

  printf '\n  %sSpecMate%s  %sinstalling on %s%s\n\n' "$BOLD" "$RESET" "$DIM" "$HOST" "$RESET"
  say "copying the source to $HOST:$DIR"

  # .env, the override and the workspaces belong to the target — they are
  # written by the run that happens there, and ours would overwrite them with
  # this machine's answers.
  rsync -a --exclude=.git/ --exclude=node_modules/ --exclude=dist/ \
    --exclude=.env --exclude="$OVERRIDE_FILE" --exclude=workspaces/ \
    ./ "$HOST:$DIR/" || die "the copy to $HOST failed"

  local remote="cd $(printf %q "$DIR") && ./install.sh$args"

  # The token prompt and the GitHub device code both want a terminal, so ask
  # for one — but only when we were given one to pass along.
  if [[ -t 0 ]]; then
    ssh -t "$HOST" "$remote"
  else
    ssh "$HOST" "$remote"
  fi
}

MODE=install
ONLY=
HOST=
DIR=/opt/specmate
PASSTHROUGH=()

while (($#)); do
  case $1 in
  --check)
    MODE=check
    PASSTHROUGH+=(--check)
    ;;
  --only)
    shift
    ONLY=${1:-}
    [[ -n $ONLY ]] || die "--only needs a step name: ${STEPS[*]}"
    PASSTHROUGH+=(--only "$ONLY")
    ;;
  --host)
    shift
    HOST=${1:-}
    [[ -n $HOST ]] || die "--host needs an ssh target, like root@10.0.0.5"
    ;;
  --dir)
    shift
    DIR=${1:-}
    [[ $DIR == /* ]] || die "--dir needs an absolute path, got ${DIR:-nothing}"
    ;;
  -h | --help)
    sed -n '2,15p' "${BASH_SOURCE[0]}" | sed 's/^#\{1,2\} \{0,1\}//'
    exit 0
    ;;
  *) die "unknown option: $1 (try --help)" ;;
  esac
  shift
done

if [[ -n $ONLY ]]; then
  # shellcheck disable=SC2076
  [[ " ${STEPS[*]} " == *" $ONLY "* ]] || die "unknown step: $ONLY (known: ${STEPS[*]})"
fi

if [[ -n $HOST ]]; then
  remote_install
  exit 0
fi

if [[ -n $ONLY ]]; then
  printf '\n  %sSpecMate — %s%s\n\n' "$BOLD" "$ONLY" "$RESET"
  # Errexit off for the fix, as in run_step: a fix that fails part way through
  # should still reach the check below, which says what is missing and why.
  "fix_${ONLY//-/_}" || true
  # Verify only: run_step would otherwise run the fix a second time.
  MODE=check
  run_step "$ONLY" || die "$ONLY is still not satisfied"
  echo
  exit 0
fi

printf '\n  %sSpecMate installer%s  %severy step is checked before it is run%s\n\n' \
  "$BOLD" "$RESET" "$DIM" "$RESET"

# `providers` runs inside this loop and the ones that depend on it come after,
# so the skip is decided per step rather than by pruning the list up front —
# which a `for` over an array could not see anyway.
failed=0
for step in "${STEPS[@]}"; do
  provider=$(step_provider "$step")
  if [[ -n $provider ]] && ! provider_selected "$provider"; then
    continue
  fi

  run_step "$step" || failed=1
done

if [[ $MODE == check ]]; then
  echo
  ((failed == 0)) || die "not ready — run ./install.sh to fix the steps above"
  say "ready"
  echo
  exit 0
fi

summary
