#!/bin/bash
set -e
cd "$(dirname "$0")"

if [ ! -d .venv ]; then
  echo "creating .venv ..."
  python3 -m venv .venv
fi
source .venv/bin/activate

if [ ! -f .venv/.deps_installed ]; then
  echo "installing deps ..."
  pip install -q -r requirements.txt
  touch .venv/.deps_installed
fi

# Auto-load local env vars when available.
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "error: ANTHROPIC_API_KEY not set"
  echo "run: export ANTHROPIC_API_KEY=... && ./run.sh"
  exit 1
fi

exec python server.py
