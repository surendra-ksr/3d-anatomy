"""
Pipeline orchestrator: STL -> classified, decimated, Draco-compressed GLB
groups + a ``manifest.json`` consumed by the Prisma seed.
"""
from __future__ import annotations

import hashlib
import json
import shutil
import sys
import time
from collections import defaultdict
from dataclasses import asdict
from pathlib import Path

import numpy as np
import trimesh

from . import config, gltf_writer, optimize, sources


def manifest_url(path: str) -> str:
    """Relative /models/... path, or absolute CDN URL in production."""
    base = config.asset_base_url()
    return f"{base}{path}" if base else path
from .fma import FmaCatalog

# anatomical atlas palette used for the default glTF materials; the frontend
# refines these at runtime (highlight, dimming, etc.)
GROUP_COLORS: dict[str, tuple[float, float, float, float]] = {
    "skeletal":     (0.898, 0.871, 0.776, 1.0),
    "muscular":     (0.749, 0.286, 0.271, 1.0),
    "circulatory":  (0.678, 0.235, 0.255, 1.0),
    "respiratory":  (0.925, 0.612, 0.612, 1.0),
    "digestive":    (0.827, 0.518, 0.255, 1.0),
    "urinary":      (0.447, 0.573, 0.729, 1.0),
    "reproductive": (0.639, 0.502, 0.761, 1.0),
    "nervous":      (0.870, 0.784, 0.420, 1.0),
    "endocrine":    (0.392, 0.663, 0.596, 1.0),
    "lymphatic":    (0.518, 0.565, 0.612, 1.0),
}
# veins / venous structures get the classic blue tint
VEIN_PATTERN = None
import re as _re
VEIN_PATTERN = _re.compile(r"\bvein(s)?\b|vena cava|coronary sinus|cardiac vein", _re.I)


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _laterality(name: str) -> str:
    n = name.lower()
    if n.startswith("left ") or " left " in n:
        return "LEFT"
    if n.startswith("right ") or " right " in n:
        return "RIGHT"
    return "MIDLINE"


class Pipeline:
    def __init__(self, work_dir: Path, out_dir: Path, source_cli: str | None):
        self.work_dir = Path(work_dir)
        self.out_dir = Path(out_dir)
        self.raw_dir = self.work_dir / "stl"
        self.source = sources.resolve_source(source_cli, self.work_dir / "source")
        self.catalog = FmaCatalog(self.source.meta_dir)
        self.meta_dir = self.source.meta_dir

    # ------------------------------------------------------------------ #

    def validate(self) -> None:
        problems = self.catalog.validate_selection(self.raw_dir)
        problems += self.catalog.verify_system_ids()
        # missing STLs are not fatal here -- fetch_meshes() acquires them next
        problems = [p for p in problems if "STL file missing" not in p]
        if problems:
            print("Selection validation failed:", file=sys.stderr)
            for p in problems:
                print(f"  - {p}", file=sys.stderr)
            raise SystemExit(2)

    # ------------------------------------------------------------------ #

    def fetch_meshes(self) -> list[Path]:
        self.raw_dir.mkdir(parents=True, exist_ok=True)
        needed = [p.id for p in config.SELECTED_PARTS]
        missing = [pid for pid in needed
                   if not self.catalog.stl_path(pid, self.raw_dir).exists()]
        if self.source.stl_dir is not None:
            # bulk-copy the ones available locally
            for pid in needed:
                src = self.catalog.stl_path(pid, self.source.stl_dir)
                dst = self.catalog.stl_path(pid, self.raw_dir)
                if src.exists() and not dst.exists():
                    shutil.copyfile(src, dst)
        still_missing = [pid for pid in needed
                         if not self.catalog.stl_path(pid, self.raw_dir).exists()]
        fallback = self.source
        if still_missing and fallback.kind == "local":
            remote = (sources._try_official(self.work_dir / "source")
                      or sources._try_archive(self.work_dir / "source")
                      or sources._try_mirror(self.work_dir / "source"))
            if remote is not None:
                print(f"[fetch] local source lacks {len(still_missing)} files; "
                      f"falling back to '{remote.kind}' channel")
                fallback = remote
        for i, pid in enumerate(still_missing):
            print(f"[fetch] {pid} ({i + 1}/{len(still_missing)})")
            sources.ensure_stl_file(fallback, pid, self.raw_dir)
        print(f"[fetch] {len(needed)} STL files available in {self.raw_dir}")
        return [self.catalog.stl_path(pid, self.raw_dir) for pid in needed]

    # ------------------------------------------------------------------ #

    def build_hierarchy(self) -> dict[str, dict]:
        """Resolve the organ containment forest for all selected + referenced
        concepts. Returns {part_id: {name, systemKey, parentFmaId}}."""
        # candidate nodes: selected parts + their part_of ancestors + systems
        nodes: dict[str, dict] = {}

        def ensure(pid: str) -> dict | None:
            if pid in nodes:
                return nodes[pid]
            info = self.catalog.part(pid)
            name = info.name if info else self.catalog.name_of(pid)
            if not name:
                return None
            system_key = self.catalog.classify(pid, name)
            nodes[pid] = {
                "id": pid,
                "name": name,
                "systemKey": system_key,
                "hasMesh": bool(info and info.has_mesh),
                "parentFmaId": None,
                "candidateParents": list(info.parent_ids) if info else [],
            }
            return nodes[pid]

        for part in config.SELECTED_PARTS:
            ensure(part.id)
            # walk containment ancestors so unmeshed intermediates (heart,
            # lung lobes, ...) enter the tree
            seen = set()
            frontier = list(self.catalog.part(part.id).parent_ids) \
                if self.catalog.part(part.id) else []
            depth = 0
            while frontier and depth < 12:
                pid = frontier.pop(0)
                if pid in seen or pid in config.SYSTEM_FMA_IDS:
                    continue
                seen.add(pid)
                depth += 1
                node = ensure(pid)
                if node is None:
                    continue
                info = self.catalog.part(pid)
                if info:
                    frontier.extend(info.parent_ids)

        # resolve each node's parent: nearest ancestor classified into the
        # SAME system; else attach directly to the system root.
        by_system: dict[str, list[str]] = defaultdict(list)
        for pid, node in nodes.items():
            if node["systemKey"]:
                by_system[node["systemKey"]].append(pid)

        for pid, node in nodes.items():
            if not node["systemKey"]:
                continue
            parent = None
            seen = {pid}
            frontier = list(node["candidateParents"])
            depth = 0
            while frontier and depth < 16:
                cur = frontier.pop(0)
                if cur in seen:
                    continue
                seen.add(cur)
                depth += 1
                info = self.catalog.part(cur)
                if info and cur not in config.SYSTEM_FMA_IDS:
                    frontier.extend(info.parent_ids)
                elif cur in config.SYSTEM_FMA_IDS:
                    continue
                cand = nodes.get(cur)
                if cand and cand["systemKey"] == node["systemKey"]:
                    parent = cur
                    break
            node["parentFmaId"] = parent
        return nodes

    # ------------------------------------------------------------------ #

    def build_groups(self, nodes: dict[str, dict]) -> None:
        self.out_dir.mkdir(parents=True, exist_ok=True)
        groups: dict[str, list[config.Part]] = defaultdict(list)
        for part in config.SELECTED_PARTS:
            groups[part.group_key].append(part)

        group_meta: dict[str, dict] = {}
        mesh_assets: list[dict] = []

        for group in sorted(config.GROUPS, key=lambda g: g.order):
            parts = groups[group.key]
            system = next(s for s in config.SYSTEMS if s.key == group.system_key)
            color = GROUP_COLORS[group.system_key]
            part_meshes: list[gltf_writer.PartMesh] = []
            stats = []

            for part in parts:
                stl_path = self.catalog.stl_path(part.id, self.raw_dir)
                mesh = trimesh.load(stl_path, force="mesh")
                mesh.merge_vertices()
                mesh.process(validate=True)
                max_faces = config.MAX_FACES_OVERRIDES.get(
                    part.id, config.DEFAULT_MAX_FACES)
                v, f = optimize.simplify_mesh(mesh.vertices, mesh.faces, max_faces)
                # recompute smooth normals on the (possibly decimated) mesh
                m2 = trimesh.Trimesh(vertices=v, faces=f.reshape(-1, 3), process=False)
                normals = np.asarray(m2.vertex_normals, dtype=np.float32)
                info = self.catalog.part(part.id)
                name = info.name if info else part.id
                # veins are drawn blue inside the cardiovascular system
                base_color = color
                if VEIN_PATTERN.search(name):
                    base_color = (0.31, 0.42, 0.72, 1.0)
                node = nodes.get(part.id, {})
                extras = {
                    "fmaId": part.id,
                    "bp3dId": part.id,
                    "name": name,
                    "systemKey": group.system_key,
                    "systemFmaId": system.fma_id,
                    "groupKey": group.key,
                    "laterality": _laterality(name),
                    "source": f"BodyParts3D {config.BP3D_VERSION}",
                }
                # source-data bounds (BP3D mm) -- consumed by the clinical
                # overlay layers (tender points, autonomic schematic) so their
                # anchor positions derive from real anatomy
                verts_src = np.asarray(mesh.vertices)
                bmin = [float(x) for x in verts_src.min(axis=0)]
                bmax = [float(x) for x in verts_src.max(axis=0)]
                part_meshes.append(gltf_writer.PartMesh(
                    part_id=part.id, name=name,
                    vertices=np.asarray(v, dtype=np.float32),
                    normals=normals,
                    indices=np.asarray(f, dtype=np.uint32).ravel(),
                    extras=extras,
                    base_color=base_color,
                ))
                stats.append((part.id, name, len(v), len(f) // 3, stl_path, bmin, bmax))

            glb_raw = self.work_dir / f"{group.key}.glb"
            write_meta = gltf_writer.write_glb(
                glb_raw, part_meshes,
                root_extras={
                    "groupKey": group.key,
                    "label": group.label,
                    "systemKey": group.system_key,
                    "dataset": f"BodyParts3D {config.BP3D_VERSION} (DBCLS), {config.LICENSE}",
                })
            glb_out = self.out_dir / f"{group.key}.glb"
            comp = optimize.draco_compress(glb_raw, glb_out)
            glb_raw.unlink()

            for part_id, name, nv, nf, stl_path, bmin, bmax in stats:
                mesh_assets.append({
                    "fmaId": part_id,
                    "name": name,
                    "systemKey": group.system_key,
                    "groupKey": group.key,
                    "url": manifest_url(f"/models/{group.key}.glb"),
                    "nodePath": part_id,
                    "byteSize": write_meta["byteSize"],
                    "compressedByteSize": comp["compressedByteSize"],
                    "vertexCount": nv,
                    "triangleCount": nf,
                    "boundsBp3dMm": {"min": bmin, "max": bmax},
                    "sourceFile": stl_path.name,
                    "sourceSha256": _sha256(stl_path),
                })
            group_meta[group.key] = {
                "key": group.key,
                "label": group.label,
                "systemKey": group.system_key,
                "url": manifest_url(f"/models/{group.key}.glb"),
                **write_meta,
                **comp,
            }
            print(f"[group] {group.key:14s} parts={len(parts):3d} "
                  f"tris={write_meta['triangleCount']:>8,} "
                  f"raw={write_meta['byteSize']/1e6:6.1f}MB "
                  f"draco={comp['compressedByteSize']/1e6:5.2f}MB")

        self.manifest = self._manifest(nodes, mesh_assets, group_meta)

    # ------------------------------------------------------------------ #

    def _manifest(self, nodes, mesh_assets, group_meta) -> dict:
        systems = [{
            "fmaId": s.fma_id, "key": s.key, "name": s.name,
            "color": s.color, "order": s.order,
        } for s in sorted(config.SYSTEMS, key=lambda s: s.order)]
        groups = [{
            "key": g.key, "label": g.label, "systemKey": g.system_key,
            "order": g.order, "defaultVisible": g.default_visible,
            "url": manifest_url(f"/models/{g.key}.glb"),
            "byteSize": group_meta[g.key]["compressedByteSize"],
            "triangleCount": group_meta[g.key]["triangleCount"],
        } for g in sorted(config.GROUPS, key=lambda g: g.order)]

        organs = []
        for pid, node in sorted(nodes.items()):
            if not node["systemKey"]:
                continue  # unclassified region nodes are dropped
            mesh = next((a for a in mesh_assets if a["fmaId"] == pid), None)
            organs.append({
                "fmaId": pid,
                "name": node["name"],
                "systemKey": node["systemKey"],
                "parentFmaId": node["parentFmaId"],
                "hasMesh": bool(mesh),
                "laterality": _laterality(node["name"]),
            })

        return {
            "meta": {
                "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "dataset": "BodyParts3D",
                "datasetVersion": config.BP3D_VERSION,
                "ontology": config.FMA_ONTOLOGY_VERSION,
                "license": config.LICENSE,
                "rightsHolder": config.RIGHTS_HOLDER,
                "sources": {
                    "site": config.BP3D_SITE,
                    "download": config.BP3D_DOWNLOAD,
                    "archive": config.BP3D_ARCHIVE,
                    "mirror": config.BP3D_GITHUB_MIRROR,
                },
                "sourceKind": self.source.kind,
                "draco": {
                    "tool": "gltf-pipeline",
                    "compressionLevel": config.DRACO_COMPRESSION_LEVEL,
                    "quantizationBits": config.DRACO_QUANTIZATION_BITS,
                },
            },
            "systems": systems,
            "groups": groups,
            "organs": organs,
            "meshAssets": mesh_assets,
        }

    def write_manifest(self) -> Path:
        path = self.out_dir / "manifest.json"
        path.write_text(json.dumps(self.manifest, indent=2))
        # parts share one Draco GLB per group; group byteSize = artifact size
        total_drc = sum(g["byteSize"] for g in self.manifest["groups"])
        total_tri = sum(g["triangleCount"] for g in self.manifest["groups"])
        print(f"[manifest] {path}")
        print(f"[manifest] organs={len(self.manifest['organs'])} "
              f"meshes={len(self.manifest['meshAssets'])} "
              f"groups={len(self.manifest['groups'])} "
              f"| triangles={total_tri:,} "
              f"| draco artifacts {total_drc/1e6:.1f} MB")
        return path


def run_build(work_dir: Path, out_dir: Path, source: str | None) -> Path:
    pipe = Pipeline(work_dir, out_dir, source)
    print("[validate] cross-checking curated selection against BP3D tables…")
    pipe.validate()
    pipe.fetch_meshes()
    nodes = pipe.build_hierarchy()
    pipe.build_groups(nodes)
    return pipe.write_manifest()
