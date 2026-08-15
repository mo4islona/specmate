# The agent runner carries the provider CLI and a toolchain manager. Prompts
# arrive on stdin, so the image needs no SpecMate source or database client.
#
# Built from the repo root:
#   docker build -f runner/Dockerfile \
#     --build-arg CLAUDE_CODE_VERSION=<version> \
#     --build-arg MISE_VERSION=<version> .
FROM node:22-bookworm-slim AS provider-runtime
RUN node -e "require('node:fs').writeFileSync('/tmp/ca-certificates.crt', require('node:tls').rootCertificates.join('\n'))"

FROM debian:bookworm-slim

# Keep the provider runtime independent from repository toolchains. The final
# filesystem is still Debian slim; this stage supplies the official Node build
# and a CA bundle before apt switches its sources to HTTPS.
COPY --from=provider-runtime /usr/local/ /usr/local/
COPY --from=provider-runtime /tmp/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt

# An unpinned provider or toolchain manager would make a recorded stage
# impossible to reproduce. Both versions are required explicitly.
ARG CLAUDE_CODE_VERSION
ARG MISE_VERSION
ARG DEBIAN_MIRROR=https://deb.debian.org/debian
ARG DEBIAN_SECURITY_MIRROR=https://deb.debian.org/debian-security
RUN test -n "$CLAUDE_CODE_VERSION" \
  || (echo "build arg CLAUDE_CODE_VERSION is required (pin the provider CLI)" >&2 && exit 1)
RUN test -n "$MISE_VERSION" \
  || (echo "build arg MISE_VERSION is required (pin mise)" >&2 && exit 1)

# The language runtimes themselves come from the repository through mise.
# These packages are the common baseline needed to fetch them and build native
# dependencies without adding repository-specific system libraries.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
  --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
  rm -f /etc/apt/apt.conf.d/docker-clean \
  && sed -i \
    -e "s|http://deb.debian.org/debian-security|${DEBIAN_SECURITY_MIRROR}|g" \
    -e "s|http://deb.debian.org/debian|${DEBIAN_MIRROR}|g" \
    /etc/apt/sources.list.d/debian.sources \
  && apt-get update \
  && apt-get install --yes --no-install-recommends \
    bash \
    build-essential \
    ca-certificates \
    curl \
    git \
    unzip \
    xz-utils

RUN --mount=type=cache,target=/root/.npm,sharing=locked \
  arch="$(dpkg --print-architecture)" \
  && case "$arch" in \
    amd64) provider_arch=x64 ;; \
    arm64) provider_arch=arm64 ;; \
    *) echo "unsupported provider architecture: $arch" >&2; exit 1 ;; \
  esac \
  && npm install --global \
    "@anthropic-ai/claude-code-linux-${provider_arch}@${CLAUDE_CODE_VERSION}" \
  && npm install --global "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
  && claude --version

RUN --mount=type=cache,target=/root/.npm,sharing=locked \
  npm install --global "mise@${MISE_VERSION}" \
  && mise --version

# The uid is fixed because the orchestrator passes it with --user. A separate
# cache-warming container writes shared installs; stage containers mount them
# read-only and keep all mise configuration and state ephemeral.
RUN groupadd --gid 10001 agent \
  && useradd --uid 10001 --gid agent --create-home --home-dir /home/agent agent \
  && mkdir -p /mise/shared/installs \
  && chown -R agent:agent /home/agent /mise

COPY --chmod=0755 runner/entrypoint.sh /usr/local/bin/specmate-runner-entrypoint
COPY --chmod=0644 runner/entrypoint.mjs /usr/local/lib/specmate-runner-entrypoint.mjs

USER agent
ENV HOME=/home/agent \
  MISE_DATA_DIR=/tmp/specmate-mise/data \
  MISE_CACHE_DIR=/tmp/specmate-mise/cache \
  MISE_CONFIG_DIR=/tmp/specmate-mise/config \
  MISE_STATE_DIR=/tmp/specmate-mise/state \
  MISE_SHARED_INSTALL_DIRS=/mise/shared/installs \
  MISE_NOT_FOUND_AUTO_INSTALL=false

ENTRYPOINT ["/usr/local/bin/specmate-runner-entrypoint"]
CMD ["claude", "--version"]
