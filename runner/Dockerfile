# The agent runner: a provider CLI and nothing of SpecMate. Prompts are
# assembled by the orchestrator and arrive on stdin, so this image needs no
# repository code, no database client, and no git — the worktree it is handed is
# a git worktree whose object store is deliberately not mounted.
#
# Built from the repo root: docker build -f runner/Dockerfile --build-arg CLAUDE_CODE_VERSION=<version> .
FROM node:22-alpine

# No default: an unpinned agent CLI is an unpinned agent. The build fails until
# a version is named, and that version is what a stage records having run with.
ARG CLAUDE_CODE_VERSION
RUN test -n "$CLAUDE_CODE_VERSION" \
  || (echo "build arg CLAUDE_CODE_VERSION is required (pin the provider CLI)" >&2 && exit 1)

# bash is the shell the agent's own tooling expects; ca-certificates is what
# lets it reach the provider's API at all.
RUN apk add --no-cache bash ca-certificates \
  && npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
  && npm cache clean --force

# The uid is fixed because the orchestrator passes it with --user and the auth
# volume is owned by it; a drifting uid means an unwritable session directory.
RUN addgroup -g 10001 -S agent \
  && adduser -u 10001 -S agent -G agent -h /home/agent \
  && mkdir -p /home/agent \
  && chown -R agent:agent /home/agent
USER agent
ENV HOME=/home/agent

# Every invocation is explicit; there is no default stage to run.
CMD ["claude", "--version"]
