#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Interactive Anatomy Engine - one-command dev stack
#
#   npm run dev
#
# Boots, in order:
#   1. PostgreSQL 16 (local data dir .pgdata, TCP on 127.0.0.1:5432)
#   2. Schema DDL (prisma/sql/schema.sql) + Prisma seed from the manifest
#   3. Prisma client generation (offline-safe; see scripts/engines_mirror.py)
#   4. FastAPI data service on :8000 (proxied by Next at /api/py/*)
#   5. Next.js dev server on :3000
# ---------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")/.."

export DATABASE_URL="${DATABASE_URL:-postgresql://postgres@127.0.0.1:5432/anatomy}"
export FASTAPI_URL="${FASTAPI_URL:-http://127.0.0.1:8000}"
export NEXT_TELEMETRY_DISABLED=1

# --- prisma generate (engine CDN unreachable in restricted networks) --------
if ! curl -sfI --max-time 4 https://binaries.prisma.sh >/dev/null 2>&1; then
  echo "[dev] binaries.prisma.sh unreachable - starting local engines mirror"
  python3 scripts/engines_mirror.py 9911 &
  MIRROR_PID=$!
  export PRISMA_ENGINES_MIRROR=http://127.0.0.1:9911
  export PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1
  trap '[ -n "${MIRROR_PID:-}" ] && kill $MIRROR_PID 2>/dev/null || true' EXIT
fi
PRISMA_HIDE_UPDATE_MESSAGE=1 node node_modules/prisma/build/index.js generate --schema=prisma/schema.prisma >/dev/null

# --- database ---------------------------------------------------------------
python3 scripts/dev_db.py ensure
python3 scripts/db_init.py

if [ "${SKIP_SEED:-0}" != "1" ]; then
  npx tsx prisma/seed.ts
fi

# --- FastAPI ----------------------------------------------------------------
pip3 install --break-system-packages --user --quiet -r backend/requirements.txt 2>/dev/null || true
export PYTHONUNBUFFERED=1
python3 -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload \
  --reload-dir backend \
  > /tmp/fastapi.log 2>&1 &
BACKEND_PID=$!
trap 'kill $BACKEND_PID 2>/dev/null || true' EXIT

# --- Next.js ----------------------------------------------------------------
exec npx next dev --port 3000
