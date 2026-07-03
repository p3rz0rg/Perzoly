#!/usr/bin/env bash
# Perzoly local dev: starts the FastAPI backend (:8000) and Vite frontend (:5173).
set -euo pipefail
cd "$(dirname "$0")"

# load nvm if node isn't on PATH
if ! command -v node >/dev/null 2>&1 && [ -s "$HOME/.nvm/nvm.sh" ]; then
  export NVM_DIR="$HOME/.nvm"
  . "$NVM_DIR/nvm.sh"
fi

if [ ! -d backend/.venv ]; then
  echo "Creating backend virtualenv..."
  if command -v uv >/dev/null 2>&1 || [ -x "$HOME/.local/bin/uv" ]; then
    export PATH="$HOME/.local/bin:$PATH"
    uv venv backend/.venv
    uv pip install -p backend/.venv/bin/python -r backend/requirements.txt
  else
    python3 -m venv backend/.venv
    backend/.venv/bin/pip install -r backend/requirements.txt
  fi
fi

if [ ! -d frontend/node_modules ]; then
  echo "Installing frontend dependencies..."
  (cd frontend && npm install)
fi

trap 'kill 0' EXIT

(cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000) &
(cd frontend && npm run dev) &

echo ""
echo "  Perzoly backend:  http://localhost:8000  (API docs: /docs)"
echo "  Perzoly frontend: http://localhost:5173"
echo ""
wait
