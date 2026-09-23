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
import sys
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import psycopg
import psycopg_pool
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "pipeline"))

from anatomy_pipeline import metabolic  # noqa: E402  (canonical pacing model)

DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql://postgres@127.0.0.1:5432/anatomy"
)
DEFAULT_USER = os.environ.get("ANATOMY_DEFAULT_USER", "you")
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


# ---------------------------------------------------------------------------
# profile (single-user MVP)
# ---------------------------------------------------------------------------

def get_or_create_default_user(conn) -> tuple[int, str]:
    row = conn.execute(
        "select id, name from users where name = %s", (DEFAULT_USER,)
    ).fetchone()
    if row:
        return row[0], row[1]
    row = conn.execute(
        "insert into users (name) values (%s) returning id, name",
        (DEFAULT_USER,),
    ).fetchone()
    return row[0], row[1]


@app.get("/api/me")
def me():
    with pool.connection() as conn:
        user_id, name = get_or_create_default_user(conn)
        count = conn.execute(
            'select count(*) from symptom_logs where "userId" = %s', (user_id,)
        ).fetchone()[0]
    return {"id": user_id, "name": name, "symptomLogCount": count}


# ---------------------------------------------------------------------------
# pain map logging (SymptomLog)
# ---------------------------------------------------------------------------

class PainEntry(BaseModel):
    fmaId: str = Field(min_length=3, max_length=32)
    intensity: int = Field(ge=1, le=10)
    note: str | None = Field(default=None, max_length=500)
    logDate: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")


class PainLogWrite(BaseModel):
    entries: list[PainEntry] = Field(min_length=1, max_length=200)


def _normalize_fma(raw: str) -> str:
    fid = raw.strip().upper()
    return fid if fid.startswith("FMA") else f"FMA{fid}"


@app.get("/api/pain-logs")
def pain_logs_get(
    since: str | None = None,
    From: str | None = Query(default=None, alias="from"),
    until: str | None = None,
):
    """List pain logs (optionally windowed: since / from / until, YYYY-MM-DD)."""
    with pool.connection() as conn:
        user_id, _ = get_or_create_default_user(conn)
        clauses = ['"userId" = %s']
        params: list[object] = [user_id]
        for param, value, op in (("since", since, ">="), ("from", From, ">="),
                                 ("until", until, "<=")):
            if value:
                try:
                    clauses.append(f'"logDate" {op} %s')
                    params.append(date.fromisoformat(value))
                except ValueError as exc:
                    raise HTTPException(400, f"bad '{param}' date: {exc}") from exc
        sql = f"""
            select "fmaId", intensity, note, "logDate", "timestamp"
            from symptom_logs
            where {' and '.join(clauses)}
            order by "timestamp" desc
            limit 2000
        """
        rows = conn.execute(sql, params).fetchall()
    return {
        "user": DEFAULT_USER,
        "logs": [
            {
                "fmaId": r[0],
                "intensity": r[1],
                "note": r[2],
                "logDate": r[3].isoformat(),
                "timestamp": r[4].isoformat(),
            }
            for r in rows
        ],
    }


@app.post("/api/pain-logs")
def pain_logs_post(body: PainLogWrite):
    """Upsert pain ratings (one row per structure per day). Each entry
    defaults to today (UTC); pass logDate (YYYY-MM-DD) to backfill history."""
    today = datetime.now(timezone.utc).date()
    saved = []
    with pool.connection() as conn:
        user_id, _ = get_or_create_default_user(conn)
        for entry in body.entries:
            fid = _normalize_fma(entry.fmaId)
            try:
                entry_date = date.fromisoformat(entry.logDate) if entry.logDate else today
            except ValueError as exc:
                raise HTTPException(400, f"bad logDate: {exc}") from exc
            row = conn.execute(
                """
                insert into symptom_logs
                    ("userId", "fmaId", intensity, note, "logDate", "timestamp")
                values (%s, %s, %s, %s, %s, now())
                on conflict ("userId", "fmaId", "logDate")
                do update set intensity = excluded.intensity,
                              note = excluded.note,
                              "timestamp" = now()
                returning "fmaId", intensity, "logDate", "timestamp"
                """,
                (user_id, fid, entry.intensity, entry.note, entry_date),
            ).fetchone()
            saved.append({
                "fmaId": row[0],
                "intensity": row[1],
                "logDate": row[2].isoformat(),
                "timestamp": row[3].isoformat(),
            })
    return {"saved": saved, "logDate": saved[0]["logDate"] if saved else today.isoformat()}


@app.delete("/api/pain-logs")
def pain_logs_delete(
    fmaId: str | None = Query(default=None),
    logDate: str | None = Query(default=None),
):
    """Clear one structure's rating, a whole day, or the whole current map."""
    today = datetime.now(timezone.utc).date()
    if logDate:
        try:
            target = date.fromisoformat(logDate)
        except ValueError as exc:
            raise HTTPException(400, f"bad logDate: {exc}") from exc
    else:
        target = today
    with pool.connection() as conn:
        user_id, _ = get_or_create_default_user(conn)
        if fmaId:
            deleted = conn.execute(
                'delete from symptom_logs where "userId" = %s and "fmaId" = %s '
                'and "logDate" = %s',
                (user_id, _normalize_fma(fmaId), target),
            ).rowcount
        else:
            deleted = conn.execute(
                'delete from symptom_logs where "userId" = %s and "logDate" = %s',
                (user_id, target),
            ).rowcount
    return {"deleted": deleted, "logDate": target.isoformat()}


# ---------------------------------------------------------------------------
# energy cost (pacing) tracker
# ---------------------------------------------------------------------------

class MetabolicCostRequest(BaseModel):
    fmaIds: list[str] = Field(min_length=1, max_length=64)
    minutes: float = Field(default=20.0, gt=0, le=24 * 60)
    bodyMassKg: float = Field(default=70.0, gt=20, le=300)
    sex: str = Field(default="unspecified", pattern="^(male|female|unspecified)$")
    intensities: dict[str, float] | None = None
    pacingBudgetKcal: float | None = Field(default=None, gt=0, le=5000)
    severity: str | None = Field(default=None, pattern="^(mild|moderate|severe)$")


@app.post("/api/metabolic-cost")
def metabolic_cost(body: MetabolicCostRequest):
    """
    Estimate the theoretical metabolic cost ("Energy Drain") of sustaining
    the given muscle groups - a pacing aid for preventing post-exertional
    malaise (PEM). Accepts muscle-group FMA ids and mesh-bearing muscle ids
    (e.g. FMA13377 right rectus abdominis). See anatomy_pipeline.metabolic
    for the documented model and references.
    """
    return metabolic.compute_energy_drain(
        body.fmaIds,
        minutes=body.minutes,
        body_mass_kg=body.bodyMassKg,
        sex=body.sex,
        intensities=body.intensities,
        pacing_budget_kcal=body.pacingBudgetKcal,
        severity=body.severity,
    )


@app.get("/api/metabolic-cost/groups")
def metabolic_groups():
    """The muscle-group table with derived masses for a reference body."""
    groups = []
    for g in metabolic.MUSCLE_GROUPS:
        mass = metabolic.group_mass_kg(g, 70.0, "unspecified")
        groups.append({**g, "referenceMassKg70": round(mass, 3)})
    return {
        "groups": groups,
        "pacingBudgetsKcal": metabolic.PACING_BUDGETS_KCAL,
        "defaultSeverity": metabolic.DEFAULT_SEVERITY,
        "references": metabolic.REFERENCES,
        "disclaimer": metabolic.DISCLAIMER,
    }


# ---------------------------------------------------------------------------
# longitudinal analytics: symptom clustering
# ---------------------------------------------------------------------------

@app.get("/api/analytics/clusters")
def analytics_clusters(
    days: int = Query(default=90, ge=7, le=365),
    minIntensity: int = Query(default=1, ge=1, le=10, alias="minIntensity"),
    minSupport: int = Query(default=2, ge=2, le=60),
):
    """
    Cluster the user's flare history: which structures / regions tend to
    hurt together? Association rules (support / confidence / lift) over
    per-day flare baskets + single-linkage clustering of the region
    co-occurrence matrix. See anatomy_pipeline.analytics for the model.
    """
    from anatomy_pipeline import analytics as analytics_mod

    with pool.connection() as conn:
        user_id, _ = get_or_create_default_user(conn)
        rows = conn.execute(
            """
            select s."fmaId", s."logDate", s.intensity, o.name
            from symptom_logs s
            left join organs o on o."fmaId" = s."fmaId"
            where s."userId" = %s
            order by s."logDate"
            """,
            (user_id,),
        ).fetchall()

    return analytics_mod.compute_clusters(
        [
            {
                "fmaId": r[0],
                "logDate": r[1],
                "intensity": r[2],
                "name": r[3],
            }
            for r in rows
        ],
        days=days,
        min_intensity=minIntensity,
        min_support=minSupport,
    )


# ---------------------------------------------------------------------------
# clinical PDF export (Extension 3)
# ---------------------------------------------------------------------------

def _parse_iso_date(value: str, name: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(422, f"bad '{name}' date (need YYYY-MM-DD): {exc}") from exc


@app.get("/api/export/report")
def export_report(
    days: int = Query(default=30, ge=1, le=365),
    start: str | None = Query(default=None, description="YYYY-MM-DD (overrides days)"),
    end: str | None = Query(default=None, description="YYYY-MM-DD (default today, UTC)"),
):
    """
    Downloadable clinical PDF (ReportLab + matplotlib) summarizing the user's
    own logged data: executive summary, the Energy-Drain-vs-pain PEM chart,
    top symptom clusters (Extension 2 model) and static front/back body pain
    maps. Content-Type: application/pdf.
    """
    from anatomy_pipeline import analytics as analytics_mod
    from anatomy_pipeline import report as report_mod

    end_date = _parse_iso_date(end, "end") if end else datetime.now(timezone.utc).date()
    start_date = _parse_iso_date(start, "start") if start else (
        end_date - timedelta(days=days - 1)
    )
    if start_date > end_date:
        raise HTTPException(422, "'start' must be on or before 'end'")

    with pool.connection() as conn:
        user_id, user_name = get_or_create_default_user(conn)
        pain_rows = conn.execute(
            """
            select s."fmaId", s."logDate", s.intensity, o.name
            from symptom_logs s
            left join organs o on o."fmaId" = s."fmaId"
            where s."userId" = %s and s."logDate" >= %s and s."logDate" <= %s
            order by s."logDate"
            """,
            (user_id, start_date, end_date),
        ).fetchall()
        activity_rows = conn.execute(
            """
            select "fmaIds", "logDate", minutes, severity, "energyDrain", "totalKcal"
            from activity_logs
            where "userId" = %s and "logDate" >= %s and "logDate" <= %s
            order by "logDate"
            """,
            (user_id, start_date, end_date),
        ).fetchall()

    pain = [
        {"fmaId": r[0], "logDate": r[1], "intensity": r[2], "name": r[3]}
        for r in pain_rows
    ]
    activities = [
        {"fmaId": ",".join(r[0]) if r[0] else None, "logDate": r[1],
         "intensity": None, "energyDrain": r[4], "totalKcal": r[5],
         "minutes": r[2], "severity": r[3]}
        for r in activity_rows
    ]
    window = (end_date - start_date).days + 1
    series = analytics_mod.daily_series(
        pain + activities, days=window, today=end_date)
    pem = analytics_mod.pem_lag_analysis(series, max_lag=3)
    clusters = analytics_mod.compute_clusters(
        pain, days=window, min_intensity=1, min_support=2)

    pdf = report_mod.build_report_pdf(
        profile=user_name,
        start=start_date,
        end=end_date,
        pain_rows=pain,
        activity_rows=activities,
        series=series,
        pem=pem,
        clusters=clusters,
        generated_utc=datetime.now(timezone.utc),
    )

    from fastapi import Response

    filename = f"clinical_report_{end_date.isoformat()}.pdf"
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )
