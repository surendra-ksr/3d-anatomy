#!/usr/bin/env python3
"""
Interactive Anatomy Engine - BodyParts3D data pipeline.

Stages
------
fetch   Ensure the curated BP3D STL subset is available locally.
build   Convert -> classify (FMA) -> decimate -> Draco-compress -> manifest.
validate  Cross-check the curated selection, the metabolic pacing model and
          the clinical overlay config against the BP3D/FMA tables.

Usage
-----
    python3 pipeline/run_pipeline.py validate [--source DIR]
    python3 pipeline/run_pipeline.py fetch    [--source DIR]
    python3 pipeline/run_pipeline.py build    [--source DIR] [--out DIR]
    python3 pipeline/run_pipeline.py all      [--source DIR]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))

from anatomy_pipeline import build as build_mod  # noqa: E402
from anatomy_pipeline import config  # noqa: E402
from anatomy_pipeline import metabolic  # noqa: E402
from anatomy_pipeline import analytics as analytics_mod  # noqa: E402
from anatomy_pipeline.fma import FmaCatalog  # noqa: E402
from anatomy_pipeline import sources  # noqa: E402

OVERLAYS_PATH = REPO / "public" / "data" / "clinical-overlays.json"
MANIFEST_PATH = REPO / "public" / "models" / "manifest.json"


def _validate_overlays(fma_labels: dict[str, str], catalog) -> list[str]:
    """Every FMA reference in the clinical overlay config must exist in the
    FMA ontology, and every mesh anchor must exist in the built manifest
    (bounds are used to derive anchor positions from real anatomy)."""
    if not OVERLAYS_PATH.exists():
        return [f"missing {OVERLAYS_PATH.relative_to(REPO)}"]
    problems: list[str] = []
    data = json.loads(OVERLAYS_PATH.read_text())

    mesh_ids: set[str] = set()
    if MANIFEST_PATH.exists():
        manifest = json.loads(MANIFEST_PATH.read_text())
        mesh_ids = {a["fmaId"] for a in manifest["meshAssets"]}

    def check_concept(fid: str, ctx: str) -> None:
        # FMA ontology ids AND BP3D-original ids (e.g. "FMA7198nsn") are real
        # published concepts - the latter live in parts_list_e.txt
        if fid not in fma_labels and fid not in catalog._parts:
            problems.append(f"{ctx}: FMA id {fid} unknown in FMA.csv/parts list")

    def check_anchor(anchor: dict, ctx: str) -> None:
        for endpoint in ("a", "b"):
            ep = anchor.get(endpoint)
            if not ep:
                continue
            fid = ep.get("fmaId", "")
            check_concept(fid, ctx)
            if mesh_ids and fid not in mesh_ids:
                problems.append(
                    f"{ctx}: anchor mesh {fid} is not in the manifest "
                    "(add it to the curated selection)")

    for conn in data.get("autonomic", {}).get("connections", []):
        ctx = f"autonomic connection {conn.get('id')}"
        for fid in conn.get("conceptFmaIds", []):
            check_concept(fid, ctx)
        for point in conn.get("via", []):
            check_anchor(point, ctx)
    for node in data.get("autonomic", {}).get("nodes", []):
        check_concept(node.get("fmaId", ""), f"autonomic node {node.get('id')}")
    for tp in data.get("tenderPoints", []):
        ctx = f"tender point {tp.get('id')}"
        check_concept(tp.get("conceptFmaId", ""), ctx)
        check_anchor(tp["anchor"], ctx)
    return problems


def _validate_analytics(fma_labels: dict[str, str]) -> list[str]:
    """The analytics region tables must line up with the FMA data."""
    problems = list(analytics_mod.validate())
    for fid in analytics_mod.TENDER_POINT_REGIONS:
        if fma_labels and fid not in fma_labels:
            problems.append(
                f"analytics tender-region id {fid} is not in FMA.csv"
            )
    return problems


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
        problems += metabolic.validate_against_catalog(cat._fma_labels)
        problems += _validate_overlays(cat._fma_labels, cat)
        problems += _validate_analytics(cat._fma_labels)
        problems = [p for p in problems if "STL file missing" not in p] \
            if args.stage == "validate" else problems
        if problems:
            print("Validation problems:")
            for p in problems:
                print(f"  - {p}")
            return 2
        print("Selection, metabolic model, clinical overlays and analytics "
              "are consistent with the BodyParts3D/FMA data.")

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
