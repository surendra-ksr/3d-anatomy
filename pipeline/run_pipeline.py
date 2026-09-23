#!/usr/bin/env python3
"""
Interactive Anatomy Engine - BodyParts3D data pipeline.

Stages
------
fetch   Ensure the curated BP3D STL subset is available locally.
build   Convert -> classify (FMA) -> decimate -> Draco-compress -> manifest.
validate  Cross-check the curated selection against the BP3D/FMA tables.

Usage
-----
    python3 pipeline/run_pipeline.py validate [--source DIR]
    python3 pipeline/run_pipeline.py fetch    [--source DIR]
    python3 pipeline/run_pipeline.py build    [--source DIR] [--out DIR]
    python3 pipeline/run_pipeline.py all      [--source DIR]
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))

from anatomy_pipeline import build as build_mod  # noqa: E402
from anatomy_pipeline import config  # noqa: E402
from anatomy_pipeline.fma import FmaCatalog  # noqa: E402
from anatomy_pipeline import sources  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("stage", choices=["validate", "fetch", "build", "all"])
    parser.add_argument("--source", default=None,
                        help="path to an unpacked BodyParts3D distribution "
                             "(or set BP3D_SOURCE_DIR)")
    parser.add_argument("--work", default=str(REPO / "pipeline" / ".work"),
                        help="scratch directory for STLs and intermediate GLBs")
    parser.add_argument("--out", default=str(REPO / "public" / "models"),
                        help="output directory for Draco GLBs + manifest.json")
    args = parser.parse_args()

    work = Path(args.work)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    work.mkdir(parents=True, exist_ok=True)

    if args.stage in ("validate", "all"):
        src = sources.resolve_source(args.source, work / "source")
        cat = FmaCatalog(src.meta_dir)
        problems = cat.validate_selection(work / "stl") + cat.verify_system_ids()
        problems = [p for p in problems if "STL file missing" not in p] \
            if args.stage == "validate" else problems
        if problems:
            print("Validation problems:")
            for p in problems:
                print(f"  - {p}")
            return 2
        print("Selection is consistent with the BodyParts3D distribution.")

    if args.stage == "fetch":
        from anatomy_pipeline import build as b
        pipe = b.Pipeline(work, out, args.source)
        pipe.validate()
        pipe.fetch_meshes()
        return 0

    if args.stage in ("build", "all"):
        manifest = build_mod.run_build(work, out, args.source)
        print(f"\nDone. Models in {out}. Seed the database with:\n"
              f"  npm run db:seed   (uses {manifest})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
