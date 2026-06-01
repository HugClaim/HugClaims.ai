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

has_foundry_key=0
if [ -n "${ANTHROPIC_API_KEY:-}" ] || [ -n "${ANTHROPIC_FOUNDRY_API_KEY:-}" ] || [ -n "${AZURE_FOUNDRY_API_KEY:-}" ]; then
  has_foundry_key=1
fi

has_azure_openai=0
if [ -n "${AZURE_OPENAI_API_KEY:-}" ] && [ -n "${AZURE_OPENAI_ENDPOINT:-}" ] && [ -n "${AZURE_OPENAI_DEPLOYMENT:-}" ]; then
  has_azure_openai=1
fi

if [ "$has_foundry_key" -ne 1 ] && [ "$has_azure_openai" -ne 1 ]; then
  echo "error: no LLM credentials configured"
  echo "use ONE of:"
  echo "  1) ANTHROPIC_API_KEY (or ANTHROPIC_FOUNDRY_API_KEY / AZURE_FOUNDRY_API_KEY)"
  echo "  2) AZURE_OPENAI_API_KEY + AZURE_OPENAI_ENDPOINT + AZURE_OPENAI_DEPLOYMENT"
  exit 1
fi

exec python server.py
