#!/usr/bin/env python3
"""
Prisma engines mirror shim.

`prisma generate` normally downloads engine binaries from
https://binaries.prisma.sh. This project uses Prisma's Rust-free driver-adapter
setup (queryCompiler WASM shipped inside the npm package), so the engine
binaries are never executed -- but the CLI still performs an eager download
preflight, which breaks `prisma generate` in network-restricted environments.

This shim serves a harmless placeholder for every request so the preflight
succeeds. It is only started by scripts/dev.sh when binaries.prisma.sh is
unreachable (e.g. this sandbox). On machines with normal internet access the
real CDN is used and this file does nothing.
"""
from __future__ import annotations

import gzip
import http.server
import sys
import threading


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        body = gzip.compress(b"placeholder")
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_HEAD(self) -> None:  # noqa: N802
        self.send_response(200)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, *args) -> None:  # silence
        pass


def main() -> int:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 9911
    try:
        server = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
    except OSError:
        # already running from a previous invocation - that's fine
        print(f"engines mirror already running on 127.0.0.1:{port}")
        return 0
    print(f"engines mirror listening on 127.0.0.1:{port}")
    server.serve_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main())
