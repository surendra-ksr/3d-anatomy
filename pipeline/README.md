# BodyParts3D → Draco GLB data pipeline

Converts the official **BodyParts3D (DBCLS)** distribution into
FMA-mapped, Draco-compressed glTF assets for the Interactive Anatomy Engine,
and emits the `manifest.json` that seeds PostgreSQL.

```
official BP3D sources ──► STL per part (BP3D/FMA id)
        │
        ├─ FMA crosswalk      parts_list_e.txt + conventional_part_of.txt + FMA.csv
        │     • mesh id  -> FMA concept id + English name
        │     • containment hierarchy (organ trees, e.g. tricuspid valve →
        │       right ventricle → heart → cardiovascular system)
        │     • system classification (curated overrides → ancestor heuristic
        │       → ordered keyword rules)
        │
        ├─ trimesh            load + merge STL soup, recompute smooth normals
        ├─ fast_simplification  quadric decimation for outlier meshes
        ├─ gltf_writer        hand-written glTF 2.0 GLB: one node per part,
        │                     node name = part id, node.extras = FMA mapping,
        │                     BP3D (mm, Z-up) → glTF (m, Y-up) root transform
        └─ gltf-pipeline      Google Draco encode (level 7, 11-bit positions)
              │
              └─► public/models/<group>.glb + manifest.json
```

## Usage

```bash
pip install -r pipeline/requirements.txt          # + node (gltf-pipeline via npx)
python3 pipeline/run_pipeline.py validate         # check selection vs BP3D tables
python3 pipeline/run_pipeline.py build            # full build
python3 pipeline/run_pipeline.py build --source /path/to/bp3d   # offline source
```

### Sources, in resolution order

1. `--source DIR` / `BP3D_SOURCE_DIR` — an unpacked BP3D distribution
   (`parts_list_e.txt`, `conventional_part_of.txt`, `FMA.csv`, `stl/*.stl`).
2. Official download service, `https://lifesciencedb.jp/bp3d/`.
3. Official batch archive, `https://dbarchive.biosciencedbc.jp/data/bodyparts3d/`.
4. Public Git mirror of the identical 3.0 files
   (github.com/Kevin-Mattheus-Moerman/BodyParts3D), sparse-cloned on demand.

Metadata tables are also committed at `pipeline/data/meta/` so `validate`
runs fully offline.

### Selection

`pipeline/anatomy_pipeline/config.py` holds the curated subset — literal FMA
ids grouped into delivery bundles (skull, spine-thorax, limbs, circulatory,
…). It is deliberately reviewable: a domain expert can diff this file.
Structures without meshes in BP3D 3.0 (e.g. `heart` itself — its geometry
ships as `wall of heart`) become taxonomy-only nodes, so the layer tree still
shows real FMA containment.

### Output

* `public/models/<group>.glb` — one Draco GLB per delivery group; each node
  named by its BP3D/FMA id with `extras = {fmaId, bp3dId, name, systemKey,
  systemFmaId, groupKey, laterality, source}`.
* `public/models/manifest.json` — systems, groups, organs (with parents) and
  mesh assets (URL, node path, triangle counts, source SHA-256, provenance).

`npm run db:seed` upserts the manifest into PostgreSQL via Prisma.
