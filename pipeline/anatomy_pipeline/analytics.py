"""
Longitudinal symptom analytics for the ME/CFS & Fibromyalgia feature set.

Canonical model behind GET /api/analytics/clusters. Given the user's
SymptomLog history (one row per structure per day), it answers:
"which structures / regions tend to flare up together?"

Two complementary views, both computed from the same day-baskets:

1. Pair rules (association-rule mining, classic support/confidence/lift):
   "When <A> flared, <B> was also flaring in C% of cases (seen on D days
   together, lift L)". Lift > 1 means the pair co-occurs more often than
   chance; confidence is the conditional probability P(B | A).

2. Region clusters (co-occurrence matrix + single-linkage union-find):
   structures are bucketed into clinical regions (via the pacing model's
   muscle-group table and the ACR-1990 tender-point concepts), then regions
   that co-flare above a confidence threshold are merged into clusters.

All inputs are real logged data; with too little history the endpoint says
so instead of inventing structure.
"""
from __future__ import annotations

import math
from collections import defaultdict
from datetime import date, timedelta
from itertools import combinations
from typing import Any, Iterable, Mapping, Sequence

from anatomy_pipeline.metabolic import MUSCLE_GROUPS, ORGAN_TO_GROUP

MODEL = {
    "name": "flare co-occurrence (association rules) + single-linkage region clustering",
    "confidence": "P(B flares | A flares) over day-baskets",
    "lift": "confidence / P(B flares); >1 = co-flare more often than chance",
    "regionMergeConfidence": 0.5,
}

REFERENCES = [
    "Wolfe F. et al. The American College of Rheumatology 1990 criteria for the "
    "classification of fibromyalgia (tender-point topology).",
    "Brin S., Motwani R. et al. Dynamic itemset counting and implication rules "
    "for market basket data (support/confidence/lift). SIGMOD 1997.",
]

DISCLAIMER = (
    "Co-occurrence patterns are descriptive statistics over your own logged "
    "history, not a diagnostic or clinical finding. Small samples produce "
    "unstable rules."
)

# ACR-1990 tender-point pair concepts -> lay region labels (mirrors the
# "pair" field of public/data/clinical-overlays.json).
TENDER_POINT_REGIONS: dict[str, str] = {
    "FMA32582": "occiput (base of skull)",
    "FMA12524": "low cervical (front of neck)",
    "FMA9626": "trapezius (neck/shoulder)",
    "FMA9629": "supraspinatus (shoulder blade)",
    "FMA7882": "second rib (upper chest)",
    "FMA8012": "second rib (upper chest)",
    "FMA23444": "lateral epicondyle (elbow)",
    "FMA23446": "lateral epicondyle (elbow)",
    "FMA22314": "gluteal (buttock)",
    "FMA51523": "greater trochanter (hip)",
    "FMA51524": "greater trochanter (hip)",
    "FMA32862": "medial knee",
    "FMA32863": "medial knee",
}

_GROUP_COMMON: dict[str, str] = {
    g["fmaId"]: str(g.get("commonName") or g["name"]) for g in MUSCLE_GROUPS
}
_MESH_TO_GROUP: dict[str, str] = ORGAN_TO_GROUP


def region_label(fma_id: str, fallback_name: str | None = None) -> str:
    """Map a logged structure to a human region label (muscle groups and
    tender-point concepts collapse into shared regions; anything else stands
    for itself)."""
    fid = fma_id.upper()
    if fid in TENDER_POINT_REGIONS:
        return TENDER_POINT_REGIONS[fid]
    group_id = _MESH_TO_GROUP.get(fid, fid)
    if group_id in _GROUP_COMMON:
        return _GROUP_COMMON[group_id]
    return fallback_name or fid


def _pearson(xs: Sequence[float], ys: Sequence[float]) -> float | None:
    n = len(xs)
    if n < 3 or n != len(ys):
        return None
    mx = sum(xs) / n
    my = sum(ys) / n
    sx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    sy = math.sqrt(sum((y - my) ** 2 for y in ys))
    if sx == 0 or sy == 0:
        return None
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / (sx * sy)


def daily_series(
    rows: Iterable[Mapping[str, Any]],
    days: int,
    today: date | None = None,
) -> list[dict[str, Any]]:
    """Aggregate (logDate, intensity, energyDrain?) rows into a dense
    day-by-day series used by the dashboard's dual-axis chart and the PEM
    lag correlation. `rows` items need logDate (date), and may carry
    intensity (int) and/or energyDrain (float); a day may appear in several
    rows (one per structure / activity)."""
    today = today or date.today()
    start = today - timedelta(days=days - 1)
    buckets: dict[date, dict[str, Any]] = {}

    def bucket(d: date) -> dict[str, Any]:
        return buckets.setdefault(
            d,
            {"painSum": 0, "painCount": 0, "painMax": None, "drainSum": 0.0,
             "activityCount": 0},
        )

    for row in rows:
        d = row["logDate"]
        if isinstance(d, str):
            d = date.fromisoformat(d)
        if d < start or d > today:
            continue
        b = bucket(d)
        intensity = row.get("intensity")
        if intensity is not None:
            b["painSum"] += int(intensity)
            b["painCount"] += 1
            b["painMax"] = max(b["painMax"] or 0, int(intensity))
        drain = row.get("energyDrain")
        if drain is not None:
            b["drainSum"] += float(drain)
            b["activityCount"] += 1

    out = []
    for i in range(days):
        d = start + timedelta(days=i)
        b = buckets.get(d, {"painSum": 0, "painCount": 0, "painMax": None,
                            "drainSum": 0.0, "activityCount": 0})
        out.append({
            "date": d.isoformat(),
            "painAvg": round(b["painSum"] / b["painCount"], 2)
            if b["painCount"] else None,
            "painMax": b["painMax"],
            "painLogCount": b["painCount"],
            "energyDrain": round(b["drainSum"], 2)
            if b["activityCount"] else None,
            "activityCount": b["activityCount"],
        })
    return out


def pem_lag_analysis(series: Sequence[Mapping[str, Any]], max_lag: int = 3) -> dict[str, Any]:
    """Cross-correlate daily energy drain with daily pain at lags 0..max_lag.
    A positive best lag (r rising after L>0 days) is the signature of the
    delayed onset of post-exertional malaise."""
    drain_by_idx: dict[int, float] = {}
    pain_by_idx: dict[int, float] = {}
    for i, day in enumerate(series):
        if day["energyDrain"] is not None:
            drain_by_idx[i] = float(day["energyDrain"])
        if day["painAvg"] is not None:
            pain_by_idx[i] = float(day["painAvg"])

    by_lag = []
    for lag in range(0, max_lag + 1):
        xs: list[float] = []
        ys: list[float] = []
        for i in drain_by_idx:
            j = i + lag
            if j in pain_by_idx:
                xs.append(drain_by_idx[i])
                ys.append(pain_by_idx[j])
        r = _pearson(xs, ys)
        by_lag.append({
            "lagDays": lag,
            "pearsonR": round(r, 3) if r is not None else None,
            "pairs": len(xs),
        })

    candidates = [e for e in by_lag if e["pearsonR"] is not None and e["pairs"] >= 3]
    max_pairs = max((e["pairs"] for e in by_lag), default=0)
    if not candidates:
        return {
            "byLag": by_lag,
            "bestLagDays": None,
            "pearsonAtBest": None,
            "daysWithPairedData": max_pairs,
            "interpretation": "Not enough days with both activity and pain logs "
            "yet — save pacing estimates and paint pain on more days to unlock "
            "the PEM lag analysis.",
        }
    best = max(candidates, key=lambda e: (e["pearsonR"], -e["lagDays"]))
    r0 = next((e["pearsonR"] for e in by_lag if e["lagDays"] == 0), None)
    if best["lagDays"] >= 1 and best["pearsonR"] >= 0.4 and (r0 is None or best["pearsonR"] > r0):
        interpretation = (
            f"Pain tends to peak ~{best['lagDays']} day(s) AFTER high energy "
            f"drain (r = {best['pearsonR']} over {best['pairs']} day pairs) - "
            "the delayed pattern typical of post-exertional malaise."
        )
    elif best["pearsonR"] >= 0.4:
        interpretation = (
            f"Pain moves in step with same-day exertion (r = {best['pearsonR']}"
            f" over {best['pairs']} day pairs) - no delayed peak visible yet."
        )
    else:
        interpretation = (
            "No strong drain→pain correlation in this window yet (|r| < 0.4). "
            "Keep logging — patterns need at least a couple of weeks."
        )
    return {
        "byLag": by_lag,
        "bestLagDays": best["lagDays"],
        "pearsonAtBest": best["pearsonR"],
        "daysWithPairedData": max_pairs,
        "interpretation": interpretation,
    }


def compute_clusters(
    rows: Iterable[Mapping[str, Any]],
    days: int = 90,
    min_intensity: int = 1,
    min_support: int = 2,
    confidence_floor: float = 0.5,
    max_rules: int = 10,
) -> dict[str, Any]:
    """Cluster the user's flare history.

    rows: mappings with fmaId (str), logDate (date|str), intensity (int) and
    optionally name (str, display name of the structure).
    A "basket" is one UTC day; a structure is IN the basket when its rating
    that day is >= min_intensity (a "flare").
    """
    today = date.today()
    start = today - timedelta(days=days - 1)

    name_by_fma: dict[str, str] = {}
    day_baskets: dict[date, set[str]] = defaultdict(set)
    n_rows = 0
    for row in rows:
        d = row["logDate"]
        if isinstance(d, str):
            d = date.fromisoformat(d)
        if d < start or d > today:
            continue
        n_rows += 1
        fid = str(row["fmaId"]).upper()
        name_by_fma.setdefault(fid, str(row.get("name") or fid))
        if int(row["intensity"]) >= min_intensity:
            day_baskets[d].add(fid)

    n_days = len(day_baskets)
    if n_days < 2:
        return {
            "pairRules": [],
            "regionClusters": [],
            "summary": {
                "windowDays": days,
                "daysWithFlares": n_days,
                "logRowsAnalyzed": n_rows,
                "minIntensity": min_intensity,
                "minSupport": min_support,
            },
            "note": "Need at least 2 distinct days of pain logs to find "
            "co-occurrence patterns — keep painting.",
            "model": MODEL,
            "references": REFERENCES,
            "disclaimer": DISCLAIMER,
        }

    # --- item counts + pairwise co-occurrence ------------------------------
    single: dict[str, int] = defaultdict(int)
    pair: dict[tuple[str, str], int] = defaultdict(int)
    for basket in day_baskets.values():
        for fid in basket:
            single[fid] += 1
        for a, b in combinations(sorted(basket), 2):
            pair[(a, b)] += 1

    def label(fid: str) -> str:
        return region_label(fid, name_by_fma.get(fid))

    # --- 1) pair rules ------------------------------------------------------
    rules = []
    for (a, b), n_ab in pair.items():
        if n_ab < min_support:
            continue
        conf_ab = n_ab / single[a]
        conf_ba = n_ab / single[b]
        p_b = single[b] / n_days
        lift = conf_ab / p_b if p_b else 0.0
        # keep the more convincing direction, report both numbers in support
        if conf_ab >= conf_ba:
            ant, con, conf = a, b, conf_ab
            other = conf_ba
        else:
            ant, con, conf = b, a, conf_ba
            other = conf_ab
        pct = round(conf * 100)
        rules.append({
            "antecedent": {"fmaId": ant, "label": label(ant)},
            "consequent": {"fmaId": con, "label": label(con)},
            "confidence": round(conf, 3),
            "reverseConfidence": round(other, 3),
            "support": n_ab,
            "lift": round(lift, 2),
            "statement": f"When {label(ant)} flares (pain >= {min_intensity}), "
            f"{label(con)} is also flaring {pct}% of the time "
            f"({n_ab} day(s) together, lift {round(lift, 2)}).",
        })
    rules.sort(key=lambda r: (r["lift"] * math.log1p(r["support"]), r["confidence"]),
               reverse=True)
    rules = rules[:max_rules]

    # --- 2) region clusters (co-occurrence + union-find) --------------------
    day_region_baskets: dict[date, set[str]] = {}
    for d, basket in day_baskets.items():
        day_region_baskets[d] = {label(fid) for fid in basket}

    region_single: dict[str, int] = defaultdict(int)
    region_pair: dict[tuple[str, str], int] = defaultdict(int)
    for basket in day_region_baskets.values():
        for r in basket:
            region_single[r] += 1
        for a, b in combinations(sorted(basket), 2):
            region_pair[(a, b)] += 1

    parent: dict[str, str] = {r: r for r in region_single}

    def find(x: str) -> str:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for (a, b), n_ab in region_pair.items():
        if n_ab < min_support:
            continue
        if n_ab / region_single[a] >= confidence_floor or \
           n_ab / region_single[b] >= confidence_floor:
            ra, rb = find(a), find(b)
            if ra != rb:
                parent[rb] = ra

    groups: dict[str, set[str]] = defaultdict(set)
    for r in region_single:
        groups[find(r)].add(r)

    region_clusters = []
    for members in groups.values():
        if len(members) < 2:
            continue
        # support = #days where at least two members of the cluster co-flare
        sup = sum(
            1 for basket in day_region_baskets.values()
            if len(basket & members) >= 2
        )
        if sup < min_support:
            continue
        region_clusters.append({
            "members": sorted(members),
            "support": sup,
            "shareOfFlareDays": round(sup / n_days, 2),
        })
    region_clusters.sort(key=lambda c: (-c["support"], c["members"]))

    return {
        "pairRules": rules,
        "regionClusters": region_clusters,
        "summary": {
            "windowDays": days,
            "daysWithFlares": n_days,
            "logRowsAnalyzed": n_rows,
            "structuresTracked": len(single),
            "minIntensity": min_intensity,
            "minSupport": min_support,
        },
        "model": MODEL,
        "references": REFERENCES,
        "disclaimer": DISCLAIMER,
    }


def validate() -> list[str]:
    """Sanity checks used by run_pipeline.py validate: tender-point region
    concepts must be real FMA ids present in the metabolic muscle mapping or
    the overlays concept set is authoritative for them."""
    problems = []
    overlay_concepts: set[str] = set()
    try:
        import json
        from pathlib import Path

        overlays_path = (
            Path(__file__).resolve().parents[2]
            / "public" / "data" / "clinical-overlays.json"
        )
        data = json.loads(overlays_path.read_text())
        overlay_concepts = {tp["conceptFmaId"] for tp in data["tenderPoints"]}
    except Exception as exc:  # pragma: no cover
        return [f"clinical-overlays.json unreadable: {exc}"]

    for fid in TENDER_POINT_REGIONS:
        if fid not in overlay_concepts and fid not in _MESH_TO_GROUP:
            problems.append(
                f"analytics.TENDER_POINT_REGIONS id {fid} is neither in "
                "clinical-overlays.json nor the metabolic mesh aliases"
            )
    return problems
