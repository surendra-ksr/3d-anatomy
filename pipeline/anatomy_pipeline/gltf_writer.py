"""
Minimal, dependency-free glTF 2.0 writer.

The pipeline needs exact control over the glTF document: per-part node names
(BP3D/FMA ids), per-node ``extras`` carrying the FMA mapping consumed by the
React viewer, deterministic buffer packing, and BP3D -> glTF coordinate
correction (BP3D is millimetres with +Z up; glTF is metres with +Y up).
"""
from __future__ import annotations

import json
import struct
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

#  quaternion rotating BP3D (mm, Z-up, right-handed) into glTF (m, Y-up):
#  rotation about X by -90 deg maps (x, y, z) -> (x, z, -y)  [proper rotation]
BP3D_TO_GLTF_QUAT = _q = (np.sqrt(0.5), 0.0, 0.0, -np.sqrt(0.5))  # x,y,z,w
MM_TO_M = 0.001


@dataclass
class PartMesh:
    part_id: str
    name: str
    vertices: np.ndarray            # (n,3) float32, BP3D millimetres
    normals: np.ndarray             # (n,3) float32
    indices: np.ndarray             # (m,)  uint32
    extras: dict = field(default_factory=dict)
    base_color: tuple[float, float, float, float] = (0.85, 0.82, 0.75, 1.0)


def _pad(data: bytes, alignment: int = 4) -> bytes:
    return data + b"\x00" * ((alignment - len(data) % alignment) % alignment)


def write_glb(path: Path, parts: list[PartMesh], root_extras: dict | None = None) -> dict:
    """Write a single .glb containing one node per part."""
    binary = bytearray()
    buffer_views: list[dict] = []
    accessors: list[dict] = []
    meshes: list[dict] = []
    nodes: list[dict] = []
    materials: list[dict] = []
    mat_index_of: dict[tuple, int] = {}

    def add_view(data: bytes) -> int:
        offset = len(binary)
        while len(binary) % 4:
            binary.append(0)
        offset = len(binary)
        binary.extend(data)
        buffer_views.append({
            "buffer": 0, "byteOffset": offset, "byteLength": len(data),
        })
        return len(buffer_views) - 1

    def material_for(color: tuple[float, float, float, float]) -> int:
        key = tuple(round(c, 4) for c in color)
        if key not in mat_index_of:
            mat_index_of[key] = len(materials)
            materials.append({
                "name": f"mat-{len(materials)}",
                "doubleSided": False,
                "pbrMetallicRoughness": {
                    "baseColorFactor": list(color),
                    "metallicFactor": 0.0,
                    "roughnessFactor": 0.62,
                },
            })
        return mat_index_of[key]

    total_vertices = 0
    total_triangles = 0
    scene_min = np.full(3, np.inf, dtype=np.float64)
    scene_max = np.full(3, -np.inf, dtype=np.float64)

    for part in parts:
        v = np.ascontiguousarray(part.vertices, dtype="<f4")
        n = np.ascontiguousarray(part.normals, dtype="<f4")
        i = np.ascontiguousarray(part.indices, dtype="<u4")

        pos_view = add_view(v.tobytes())
        nrm_view = add_view(n.tobytes())
        idx_view = add_view(i.tobytes())

        v_min, v_max = v.min(axis=0), v.max(axis=0)
        accessors.append({  # POSITION
            "bufferView": pos_view, "componentType": 5126, "count": int(len(v)),
            "type": "VEC3", "min": [float(x) for x in v_min],
            "max": [float(x) for x in v_max],
        })
        accessors.append({  # NORMAL
            "bufferView": nrm_view, "componentType": 5126,
            "count": int(len(n)), "type": "VEC3",
        })
        accessors.append({  # indices
            "bufferView": idx_view, "componentType": 5125,
            "count": int(i.size), "type": "SCALAR",
        })
        prim = {
            "attributes": {"POSITION": len(accessors) - 3, "NORMAL": len(accessors) - 2},
            "indices": len(accessors) - 1,
            "material": material_for(part.base_color),
            "mode": 4,
        }
        if part.extras:
            prim["extras"] = part.extras
        meshes.append({
            "name": part.part_id,
            "primitives": [prim],
            "extras": {"triangleCount": int(i.size // 3), "vertexCount": int(len(v))},
        })
        nodes.append({
            "name": part.part_id,
            "mesh": len(meshes) - 1,
            "extras": part.extras or {"partId": part.part_id},
        })
        total_vertices += int(len(v))
        total_triangles += int(i.size // 3)
        scene_min = np.minimum(scene_min, v_min)
        scene_max = np.maximum(scene_max, v_max)

    # root node: BP3D millimetre Z-up space -> glTF metre Y-up space
    root = {
        "name": "BP3D_ROOT",
        "rotation": [0.7071067811865476, 0.0, 0.0, -0.7071067811865476],
        "scale": [MM_TO_M, MM_TO_M, MM_TO_M],
        "children": list(range(len(parts))),
    }
    if root_extras is not None:
        root["extras"] = root_extras

    gltf = {
        "asset": {
            "version": "2.0",
            "generator": "anatomy-engine pipeline (BodyParts3D -> glTF 2.0)",
        },
        "scene": 0,
        "scenes": [{"name": "anatomy", "nodes": [len(nodes)]}],
        "nodes": [*nodes, root],
        "meshes": meshes,
        "materials": materials,
        "accessors": accessors,
        "bufferViews": buffer_views,
        "buffers": [{"byteLength": len(binary)}],
        "extras": root_extras or {},
    }

    json_chunk = _pad(json.dumps(gltf, separators=(",", ":")).encode("utf-8"))
    # GLB 2.0 spec: the JSON chunk must be padded with SPACES (0x20)
    json_chunk = json_chunk.replace(b"\x00", b" ")
    bin_chunk = _pad(bytes(binary))
    total = 12 + 8 + len(json_chunk) + 8 + len(bin_chunk)

    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(struct.pack("<III", 0x46546C67, 2, total))          # glTF, v2
        fh.write(struct.pack("<II", len(json_chunk), 0x4E4F534A))    # JSON
        fh.write(json_chunk)
        fh.write(struct.pack("<II", len(bin_chunk), 0x004E4942))     # BIN
        fh.write(bin_chunk)

    meta = {
        "byteSize": total,
        "vertexCount": total_vertices,
        "triangleCount": total_triangles,
        "partCount": len(parts),
        "boundsBp3dMm": {
            "min": [float(x) for x in scene_min],
            "max": [float(x) for x in scene_max],
        },
    }
    return meta
