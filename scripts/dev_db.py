#!/usr/bin/env python3
"""
Local development PostgreSQL supervisor.

Uses the PostgreSQL 16 server binaries bundled with the `pgserver` pip package
to run a plain TCP PostgreSQL instance inside the repository (data dir is
git-ignored). Idempotent: safe to call repeatedly.

Usage:
    python3 scripts/dev_db.py ensure          # start if not running (default)
    python3 scripts/dev_db.py status          # print connection info
    python3 scripts/dev_db.py stop
"""
from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PGDATA = Path(os.environ.get("ANATOMY_PGDATA", REPO / ".pgdata"))
PGPORT = int(os.environ.get("ANATOMY_PGPORT", "5432"))
PGHOST = "127.0.0.1"
DB_NAME = os.environ.get("ANATOMY_DB_NAME", "anatomy")
DB_USER = "postgres"


def _bin(name: str) -> str:
    from pgserver import _commands  # bundled PostgreSQL binaries via pip

    return str(Path(_commands.POSTGRES_BIN_PATH) / name)


def _pid_running() -> bool:
    pidfile = PGDATA / "postmaster.pid"
    if not pidfile.exists():
        return False
    try:
        pid = int(pidfile.read_text().splitlines()[0])
        os.kill(pid, 0)
        return True
    except (ValueError, ProcessLookupError, PermissionError, OSError):
        return False


def _run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def ensure() -> int:
    if _tcp_ready():
        print(f"postgres already running on {PGHOST}:{PGPORT}")
        return 0
    PGDATA.mkdir(parents=True, exist_ok=True)
    if not (PGDATA / "PG_VERSION").exists() or not _pid_running():
        if not (PGDATA / "PG_VERSION").exists():
            r = _run([_bin("initdb"), "-D", str(PGDATA), "-U", DB_USER,
                      "--auth=trust", "--encoding=UTF8", "--no-locale"])
            if r.returncode != 0:
                sys.stderr.write(r.stderr)
                return r.returncode
        # Start with TCP on localhost. `pg_ctl -o` passes options to postgres.
        logfile = PGDATA / "postgres.log"
        r = _run([_bin("pg_ctl"), "-D", str(PGDATA), "-w", "-t", "60",
                  "-o", f'-h "{PGHOST}" -p {PGPORT} -k "{PGDATA}"',
                  "-l", str(logfile), "start"])
        if r.returncode != 0:
            sys.stderr.write(r.stdout + r.stderr)
            return r.returncode
    _ensure_db()
    return 0


def _tcp_ready() -> bool:
    import socket

    with socket.socket() as s:
        s.settimeout(1.0)
        try:
            s.connect((PGHOST, PGPORT))
            return True
        except OSError:
            return False


def _ensure_db() -> None:
    for _ in range(50):
        if _tcp_ready():
            break
        time.sleep(0.2)
    else:
        raise RuntimeError("postgres did not start")
    r = _run([_bin("psql"), "-h", PGHOST, "-p", str(PGPORT), "-U", DB_USER,
              "-d", "postgres", "-tAc",
              f"select 1 from pg_database where datname='{DB_NAME}'"])
    if r.stdout.strip() != "1":
        _run([_bin("createdb"), "-h", PGHOST, "-p", str(PGPORT), "-U", DB_USER, DB_NAME])
    print(f"database ready: postgresql://{DB_USER}@{PGHOST}:{PGPORT}/{DB_NAME}")


def status() -> int:
    up = _tcp_ready() and _pid_running()
    print(f"data-dir : {PGDATA}")
    print(f"running  : {up}")
    print(f"dsn      : postgresql://{DB_USER}@{PGHOST}:{PGPORT}/{DB_NAME}")
    return 0


def stop() -> int:
    if PGDATA.exists():
        _run([_bin("pg_ctl"), "-D", str(PGDATA), "-m", "fast", "stop"])
    print("postgres stopped")
    return 0


if __name__ == "__main__":
    cmd = (sys.argv[1] if len(sys.argv) > 1 else "ensure").lower()
    sys.exit({"ensure": ensure, "status": status, "stop": stop}[cmd]())
