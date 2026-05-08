#!/usr/bin/env bash
set -euo pipefail

node dist/index.js &
api_pid=$!

node dist/worker.js &
worker_pid=$!

terminate() {
  kill "$api_pid" "$worker_pid" 2>/dev/null || true
}

trap terminate INT TERM

wait -n "$api_pid" "$worker_pid"
exit_code=$?

terminate
wait "$api_pid" "$worker_pid" 2>/dev/null || true

exit "$exit_code"
