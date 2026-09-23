"""
Interactive Anatomy Engine - FastAPI data service.

Read-only retrieval API over the same PostgreSQL database the Next.js
application uses through Prisma. It is mounted by the Next.js dev server via
the /api/py/* rewrite so the browser only ever talks to the Next origin.

Endpoints
---------
GET /api/health                  liveness + database check
GET /api/systems                 anatomical systems
GET /api/tree                    full hierarchy (systems -> organs -> meshes)
GET /api/anatomy/{fma_id}        metadata + mesh URL for one FMA concept
GET /api/search?q=heart          name search
GET /api/stats                   dataset statistics

Run:  uvicorn main:app --host 0.0.0.0 --port 8000   (see scripts/dev.sh)
"""
from __future__ import annotations

import os
import re
from contextlib import asynccontextmanager
from pathlib import Path

import psycopg
import psycopg_pool
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql://postgres@127.0.0.1:5432/anatomy"
)
ASSET_BASE = os.environ.get("MESH_ASSET_BASE_URL", "").rstrip("/")
MANIFEST_PATH = Path(__file__).resolve().parent.parent / "public" / "models" / "manifest.json"

pool: psycopg_pool.ConnectionPool


def resolve_asset_url(url: str) -> str:
    if re.match(r"^https?://", url, re.I):
        return url
    return f"{ASSET_BASE}/{url.lstrip('/')}" if ASSET_BASE else url


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global pool
    pool = psycopg_pool.ConnectionPool(
        DATABASE_URL, min_size=1, max_size=8, open=True,
        kwargs={"autocommit": True},
    )
    yield
    pool.close()


app = FastAPI(
    title="Interactive Anatomy Engine API",
    description="BodyParts3D (DBCLS) meshes mapped to the FMA ontology.",
    version="1.0.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

SYSTEM_SQL = """
    select id, "fmaId", key, name, color, "sortOrder"
    from anatomical_systems order by "sortOrder"
"""

ORGANS_SQL = """
    select o.id, o."fmaId", o."bp3dId", o.name, o.laterality,
           o."systemId", o."parentId",
           m.url, m."nodePath", m."groupKey", m.format, m.compression,
           m."byteSize", m."vertexCount", m."triangleCount",
           m."sourceDataset"
    from organs o
    left join mesh_assets m on m."organId" = o.id
"""


def rows_to_organ_nodes(rows) -> list[dict]:
    by_parent: dict[int | None, list[dict]] = {}
    for r in rows:
        node = {
            "id": r[0],
            "fmaId": r[1],
            "bp3dId": r[2],
            "name": r[3],
            "laterality": r[4],
            "hasMesh": r[7] is not None,
            "mesh": None if r[7] is None else {
                "url": resolve_asset_url(r[7]),
                "nodePath": r[8],
                "groupKey": r[9],
                "format": r[10],
                "compression": r[11],
                "byteSize": r[12],
                "vertexCount": r[13],
                "triangleCount": r[14],
                "sourceDataset": r[15],
            },
            "children": [],
        }
        by_parent.setdefault(r[6], []).append(node)

    def attach(nodes: list[dict]) -> list[dict]:
        for n in nodes:
            kids = by_parent.get(n["id"], [])
            kids.sort(key=lambda k: k["name"])
            n["children"] = kids
            attach(kids)
        return nodes

    roots = sorted(by_parent.get(None, []), key=lambda k: k["name"])
    return attach(roots)


def dataset_meta() -> dict:
    return {
        "dataset": "BodyParts3D",
        "datasetVersion": "3.0",
        "ontology": "Foundational Model of Anatomy (FMA)",
        "license": "CC BY-SA 2.1 JP",
        "rightsHolder": "Database Center for Life Science (DBCLS), Japan",
        "site": "https://lifesciencedb.jp/bp3d/",
    }


# ---------------------------------------------------------------------------
# endpoints
# ---------------------------------------------------------------------------

@app.get("/api/health")
def health():
    with pool.connection() as conn:
        version = conn.execute("select version()").fetchone()[0]
        counts = conn.execute(
            """
            select (select count(*) from anatomical_systems),
                   (select count(*) from organs),
                   (select count(*) from mesh_assets)
            """
        ).fetchone()
    return {
        "status": "ok",
        "postgres": version.split(",")[0],
        "systems": counts[0],
        "organs": counts[1],
        "meshAssets": counts[2],
    }


@app.get("/api/systems")
def systems():
    with pool.connection() as conn:
        rows = conn.execute(SYSTEM_SQL).fetchall()
    return {
        "systems": [
            {
                "fmaId": r[1], "key": r[2], "name": r[3],
                "color": r[4], "sortOrder": r[5],
            }
            for r in rows
        ],
        "meta": dataset_meta(),
    }


@app.get("/api/tree")
def tree():
    with pool.connection() as conn:
        sys_rows = conn.execute(SYSTEM_SQL).fetchall()
        organ_rows = conn.execute(ORGANS_SQL).fetchall()
        group_rows = conn.execute(
            "select distinct m.\"groupKey\", o.\"systemId\" from mesh_assets m "
            "join organs o on o.id = m.\"organId\""
        ).fetchall()

    nodes = rows_to_organ_nodes(organ_rows)
    roots_by_system: dict[int, list[dict]] = {}
    # index organs by id -> systemId for grouping roots
    organ_system = {r[0]: r[5] for r in organ_rows}
    for root in nodes:
        roots_by_system.setdefault(organ_system[root["id"]], []).append(root)

    groups_by_system: dict[int, list[str]] = {}
    for group_key, system_id in group_rows:
        groups_by_system.setdefault(system_id, []).append(group_key)

    return {
        "systems": [
            {
                "fmaId": r[1], "key": r[2], "name": r[3], "color": r[4],
                "sortOrder": r[5],
                "groupKeys": sorted(groups_by_system.get(r[0], [])),
                "organCount": sum(1 for x in organ_rows if x[5] == r[0]),
                "roots": roots_by_system.get(r[0], []),
            }
            for r in sys_rows
        ],
        "meta": dataset_meta(),
    }


@app.get("/api/anatomy/{fma_id}")
def anatomy(fma_id: str):
    normalized = fma_id.strip().upper()
    if not normalized.startswith("FMA"):
        normalized = f"FMA{normalized}"
    with pool.connection() as conn:
        row = conn.execute(
            ORGANS_SQL + ' where o."fmaId" = %s',
            (normalized,),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail=f"unknown FMA id {normalized}")
        system = conn.execute(
            'select id, "fmaId", key, name, color, "sortOrder" '
            "from anatomical_systems where id = %s",
            (row[5],),
        ).fetchone()
        parent = conn.execute(
            'select "fmaId", name from organs where id = %s', (row[6],)
        ).fetchone() if row[6] else None
        children = conn.execute(
            'select o."fmaId", o.name, (m.id is not null) as has_mesh '
            "from organs o left join mesh_assets m on m.\"organId\" = o.id "
            'where o."parentId" = %s order by o.name',
            (row[0],),
        ).fetchall()

    numeric = re.sub(r"[^0-9]", "", normalized)
    return {
        "id": row[0],
        "fmaId": row[1],
        "bp3dId": row[2],
        "name": row[3],
        "laterality": row[4],
        "system": {
            "fmaId": system[1], "key": system[2], "name": system[3],
            "color": system[4], "sortOrder": system[5],
        },
        "parent": {"fmaId": parent[0], "name": parent[1]} if parent else None,
        "children": [
            {"fmaId": c[0], "name": c[1], "hasMesh": c[2]} for c in children
        ],
        "mesh": None if row[7] is None else {
            "url": resolve_asset_url(row[7]),
            "nodePath": row[8],
            "groupKey": row[9],
            "format": row[10],
            "compression": row[11],
            "byteSize": row[12],
            "vertexCount": row[13],
            "triangleCount": row[14],
            "sourceDataset": row[15],
        },
        "ontologyLinks": [
            {
                "label": "FMA Ontology (OLS)",
                "url": f"https://www.ebi.ac.uk/ols4/ontologies/fma/terms?iri=http%3A%2F%2Fpurl.obolibrary.org%2Fobo%2FFMA_{numeric}",
            },
            {
                "label": "BodyParts3D",
                "url": f"https://lifesciencedb.jp/bp3d/?lng=en#{normalized}",
            },
        ],
    }


@app.get("/api/search")
def search(q: str = Query(min_length=2, max_length=80)):
    pattern = f"%{q.lower()}%"
    with pool.connection() as conn:
        rows = conn.execute(
            """
            select o."fmaId", o.name, s.key, s.name,
                   (m.id is not null) as has_mesh
            from organs o
            join anatomical_systems s on s.id = o."systemId"
            left join mesh_assets m on m."organId" = o.id
            where lower(o.name) like %s
            order by length(o.name), o.name
            limit 40
            """,
            (pattern,),
        ).fetchall()
    return {
        "query": q,
        "results": [
            {
                "fmaId": r[0], "name": r[1], "systemKey": r[2],
                "systemName": r[3], "hasMesh": r[4],
            }
            for r in rows
        ],
    }


@app.get("/api/stats")
def stats():
    with pool.connection() as conn:
        row = conn.execute(
            """
            select (select count(*) from anatomical_systems),
                   (select count(*) from organs),
                   (select count(*) from mesh_assets),
                   (select coalesce(sum("triangleCount"), 0) from mesh_assets)
            """,
        ).fetchone()
        # artifact bytes are per-group; count each GLB once
        artifacts = conn.execute(
            'select "groupKey", max("byteSize") from mesh_assets group by "groupKey"'
        ).fetchall()
    artifact_bytes = sum(r[1] for r in artifacts)
    return {
        "systems": row[0],
        "organs": row[1],
        "meshAssets": row[2],
        "triangles": row[3],
        "artifactBytes": artifact_bytes,
        "meta": dataset_meta(),
    }
