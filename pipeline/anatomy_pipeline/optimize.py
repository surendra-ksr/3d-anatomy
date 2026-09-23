"""
Mesh optimization: quadratic decimation and Google Draco compression.

Decimation keeps web delivery snappy (BP3D source meshes go up to ~330k
triangles for the heart); Draco is applied by the ``gltf-pipeline`` CLI
(the reference Google implementation) with quantization tuned for medical
geometry.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

from . import config


def simplify_mesh(vertices, indices, max_faces: int):
    """Quadric-error-metric decimation via fast-simplification (pybind11).

    Returns (vertices, flat_indices) with `indices` always a 1-D uint32 array.
    """
    import numpy as np

    flat = np.asarray(indices, dtype=np.int64).ravel()
    if flat.size // 3 <= max_faces:
        return np.asarray(vertices), flat.astype(np.uint32)

    import fast_simplification

    points = np.asarray(vertices, dtype=np.float32)
    faces = flat.reshape(-1, 3)
    # target a small overshoot so we land on the cap without dipping under
    target = int(max_faces * 1.02)
    out_points, out_faces = fast_simplification.simplify(
        points, faces, target_count=target,
        agg=7,  # strong error-limit aggregation, preserves topology
    )
    return np.asarray(out_points, dtype=np.float32), np.asarray(out_faces, dtype=np.uint32).ravel()


def draco_compress(glb_in: Path, glb_out: Path,
                   compression_level: int = config.DRACO_COMPRESSION_LEVEL,
                   quantization_bits: int = config.DRACO_QUANTIZATION_BITS) -> dict:
    """Compress a GLB with Draco using the gltf-pipeline CLI (npx)."""
    glb_out.parent.mkdir(parents=True, exist_ok=True)
    npx = shutil.which("npx")
    if not npx:
        raise RuntimeError("npx is required for gltf-pipeline (Node.js toolchain)")
    cmd = [
        npx, "--yes", "gltf-pipeline",
        "-i", str(glb_in), "-o", str(glb_out),
        "--draco.compressionLevel", str(compression_level),
        "--draco.quantizePositionBits", str(quantization_bits),
        "--draco.quantizeNormalBits", "10",
        "--draco.quantizeTexcoordBits", "0",   # no textures in this dataset
    ]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0 or not glb_out.exists():
        raise RuntimeError(f"gltf-pipeline failed:\n{r.stdout}\n{r.stderr}")
    return {
        "compressedByteSize": glb_out.stat().st_size,
        "compressionLevel": compression_level,
        "quantizationBits": quantization_bits,
    }


def validate_glb(path: Path) -> dict:
    """Parse a Draco GLB back with gltf-pipeline and report basic stats."""
    npx = shutil.which("npx")
    out = path.with_suffix(".validate.json")
    r = subprocess.run(
        [npx, "--yes", "gltf-pipeline", "-i", str(path), "-o", str(out)],
        capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"validation decode failed for {path}:\n{r.stderr}")
    info = {"decodedByteSize": out.stat().st_size}
    out.unlink(missing_ok=True)
    return info


def summarize_manifest_size(manifest_path: Path) -> str:
    data = json.loads(manifest_path.read_text())
    total = sum(a["byteSize"] for a in data["meshAssets"])
    compressed = sum(a["compressedByteSize"] for a in data["meshAssets"])
    return (f"{len(data['meshAssets'])} meshes | raw {total/1e6:.1f} MB | "
            f"draco {compressed/1e6:.1f} MB")
