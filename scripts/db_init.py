#!/usr/bin/env python3
"""
Apply prisma/sql/schema.sql to the local PostgreSQL instance (idempotent).

The project uses Prisma's engine-free WASM query compiler, which cannot run
`prisma db push` (that requires the schema-engine binary); the DDL is applied
directly and kept in sync with schema.prisma by review + the seed step, which
exercises every column.
"""
from __future__ import annotations

import sys
from pathlib import Path

import psycopg

REPO = Path(__file__).resolve().parent.parent
SQL_PATH = REPO / "prisma" / "sql" / "schema.sql"


def database_url() -> str:
    import os

    url = os.environ.get("DATABASE_URL")
    if url:
        return url
    host = os.environ.get("ANATOMY_PGHOST", "127.0.0.1")
    port = os.environ.get("ANATOMY_PGPORT", "5432")
    name = os.environ.get("ANATOMY_DB_NAME", "anatomy")
    return f"postgresql://postgres@{host}:{port}/{name}"


def main() -> int:
    ddl = SQL_PATH.read_text()
    with psycopg.connect(database_url(), autocommit=True) as conn:
        conn.execute(ddl)
        tables = conn.execute(
            "select table_name from information_schema.tables "
            "where table_schema='public' order by table_name"
        ).fetchall()
        print("schema applied:", ", ".join(t[0] for t in tables))
    return 0


if __name__ == "__main__":
    sys.exit(main())
