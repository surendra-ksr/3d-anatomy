#!/usr/bin/env python3
"""
FastAPI launcher used by scripts/dev.sh (kept separate so the backend can
also be started standalone:  python3 scripts/dev.py
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("DATABASE_URL", "postgresql://postgres@127.0.0.1:5432/anatomy")

import uvicorn  # noqa: E402

if __name__ == "__main__":
    uvicorn.run("backend.main:app", host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))
