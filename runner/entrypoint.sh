#!/bin/sh
set -eu

exec /usr/local/bin/node /usr/local/lib/specmate-runner-entrypoint.mjs "$@"
