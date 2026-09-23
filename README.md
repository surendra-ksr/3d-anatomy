# Interactive Anatomy Engine

A production-ready web MVP for exploring real, medically accurate human anatomy
in the browser.

* **Data** — [BodyParts3D/Anatomography](https://lifesciencedb.jp/bp3d/) v3.0
  (Database Center for Life Science / DBCLS, Japan), mapped to the
  [Foundational Model of Anatomy (FMA)](https://si.washington.edu/projects/fm)
  ontology. **No dummy data.** Every mesh node carries its FMA concept id in
  glTF `extras` (e.g. `wall of heart` → `FMA7274`, child of `heart` → `FMA7088`).
* **Delivery** — meshes are packed per anatomical region into binary glTF
  (`.glb`) files and compressed with **Google Draco** (`gltf-pipeline`),
  ~13× smaller than the source STLs (~9 MB total for 190 structures).
* **Stack** — Next.js (React 19, TypeScript) + react-three-fiber/drei/Three.js
  on the front, **FastAPI** + **PostgreSQL** with **Prisma ORM** on the back.

![stack](https://img.shields.io/badge/data-BodyParts3D_3.0-blue) ![license](https://img.shields.io/badge/mesh%20license-CC%20BY--SA%202.1%20JP-green)

---

## Quick start

Requirements: Node 20+, Python 3.11+, and either `pip` or a running PostgreSQL.
`npm run dev` bootstraps **everything**, including a local PostgreSQL 16
(via the `pgserver` pip package — no system install needed):

```bash
npm install
pip3 install -r backend/requirements.txt trimesh numpy scipy fast_simplification
npm run dev          # postgres -> DDL -> seed -> FastAPI :8000 -> Next :3000
```

Open **http://localhost:3000**.

| Layer | What happens |
|---|---|
| PostgreSQL | `scripts/dev_db.py` starts Postgres 16 on `127.0.0.1:5432` (data in `.pgdata/`) |
| Schema | `prisma/sql/schema.sql` applied by `scripts/db_init.py` (idempotent) |
| Seed | `prisma/seed.ts` upserts 10 systems / 359 organs / 190 mesh assets from `public/models/manifest.json` |
| FastAPI | `backend/main.py` on `:8000` — read-only data service |
| Next.js | `:3000` — UI + Prisma-backed API routes, proxies `/api/py/*` → FastAPI |

### Production-style build

```bash
npm run build && npm start          # Next.js
uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

Set `DATABASE_URL`, and `MESH_ASSET_BASE_URL` /
`NEXT_PUBLIC_ASSET_BASE_URL` to your S3/CDN base to serve the Draco GLBs from
object storage — every API response resolves mesh URLs against it.

---

## Rebuilding the dataset (the data pipeline)

`pipeline/` contains a Python package that fetches the official BodyParts3D
distribution, maps every mesh to FMA, decimates outliers, and emits
Draco-compressed GLBs + a seeding manifest:

```bash
python3 pipeline/run_pipeline.py validate   # cross-check selection vs BP3D tables
python3 pipeline/run_pipeline.py build      # STL -> FMA-mapped Draco GLBs + manifest
python3 pipeline/run_pipeline.py all        # both
```

* **Sources** (first available wins): local `--source DIR`, the official
  `lifesciencedb.jp` CGI, the official `dbarchive.biosciencedbc.jp` archive, or
  a sparse clone of the public Git mirror of the same files.
* **Mapping** — `pipeline/anatomy_pipeline/fma.py` parses
  `parts_list_e.txt` (BP3D model ⇄ FMA id ⇄ English name),
  `conventional_part_of.txt` (containment hierarchy) and
  `FMA.csv` (the FMA is_a ontology) and classifies every concept into an
  anatomical system (curated overrides → containment-ancestor heuristic →
  keyword rules).
* **Optimization** — quadric decimation caps outliers (330k-tri heart → 200k),
  then `gltf-pipeline --draco.compressionLevel 7 --draco.quantizePositionBits 11`.
* **Output** — `public/models/<group>.glb` (one GLB per region, nodes named by
  FMA id with `extras: {fmaId, name, systemKey, laterality, ...}`) and
  `public/models/manifest.json`.

See `pipeline/README.md` for the full design.

---

## Application architecture

```
components/AnatomyViewer.tsx   R3F canvas: useGLTF(+Draco), explicit pointer
                               raycasting → FMA selection, medical lighting rig,
                               OrbitControls, per-part visibility/opacity/highlight
components/LayerTree.tsx       nested checkbox tree (systems → organs), tri-state
                               checkboxes, cascade, search, opacity sliders
components/InfoPanel.tsx       FMA metadata + mesh provenance for the selection
lib/store.ts                   zustand bridge between DOM tree and 3D scene
app/api/anatomy/tree/route.ts  full hierarchy (Prisma → PostgreSQL)
app/api/anatomy/[fmaId]/route.ts   one concept by FMA id + mesh URL
backend/main.py                FastAPI data service (same database, psycopg)
prisma/schema.prisma           AnatomicalSystem / Organ / MeshAsset (+ enums)
pipeline/                      Python data pipeline (see above)
```

### API examples

```bash
curl localhost:3000/api/anatomy/FMA7274      # wall of heart (Next/Prisma)
curl localhost:3000/api/py/anatomy/FMA7088   # heart       (FastAPI via proxy)
curl localhost:3000/api/py/search?q=ventricle
```

```jsonc
// GET /api/anatomy/FMA7274
{
  "fmaId": "FMA7274",
  "name": "wall of heart",
  "system": { "key": "circulatory", "name": "Cardiovascular System", "fmaId": "FMA7161" },
  "parent": { "fmaId": "FMA7088", "name": "heart" },
  "mesh": {
    "url": "/models/circulatory.glb",
    "nodePath": "FMA7274",
    "compression": "draco",
    "triangleCount": 200000,
    "sourceDataset": "BodyParts3D 3.0"
  }
}
```

---

## Notes on Prisma (engine-free)

This project uses Prisma with `engineType = "client"` (WASM query compiler) +
`@prisma/adapter-pg`, so **no Rust engine binary is downloaded or executed**.
`scripts/dev.sh` additionally points `PRISMA_ENGINES_MIRROR` at a local shim
(`scripts/engines_mirror.py`) when `binaries.prisma.sh` is unreachable — the
CLI's engine preflight is otherwise a hard dependency of `prisma generate`.
DDL is applied from `prisma/sql/schema.sql` (mirrors `schema.prisma`) because
`prisma db push` requires the schema-engine binary.

---

## License / attribution

* **Anatomical meshes & ontology tables**: BodyParts3D, © DBCLS,
  [CC BY-SA 2.1 JP](https://creativecommons.org/licenses/by-sa/2.1/jp/deed.en) —
  see `LICENSES/ATTRIBUTION.md`. The metadata tables in `pipeline/data/meta/`
  are unmodified copies of the official 3.0 distribution.
* **Application code**: MIT (this repository).
