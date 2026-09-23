"""
Clinical PDF report generation (Extension 3, item 13).

Canonical model behind GET /api/export/report. Everything is rendered from
the user's own logged data:

  * executive summary statistics (days logged, average daily pain, ...)
  * the Energy Drain vs pain dual-axis chart, rendered server-side with
    matplotlib (Agg / Figure API - no global pyplot state, server-safe)
  * top symptom clusters, reuse of the Extension 2 association-rule model
    (anatomy_pipeline.analytics)
  * static front/back body pain maps: a schematic 2D silhouette with the
    most frequently logged structures highlighted (color = peak intensity,
    radius = number of days logged); coordinates come from a curated
    FMA-id -> body-surface table built on the metabolic muscle-group model
    and the ACR-1990 tender-point concepts

PDF assembly uses ReportLab (platypus). Unknown FMA ids are never silently
dropped: they appear in the structure table, only the 2D map placement is
skipped (and the report says so).
"""
from __future__ import annotations

import math
import tempfile
from collections import defaultdict
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Mapping, Sequence

import matplotlib

matplotlib.use("Agg")  # headless server rendering; must precede Figure use
from matplotlib.figure import Figure  # noqa: E402

from anatomy_pipeline import analytics  # noqa: E402
from anatomy_pipeline.metabolic import GROUP_BY_FMA, ORGAN_TO_GROUP  # noqa: E402

# ---------------------------------------------------------------------------
# pain color scale (mirrors lib/store.ts painColor)
# ---------------------------------------------------------------------------

_STOPS: list[tuple[float, tuple[float, float, float]]] = [
    (1, (0.29, 0.69, 0.31)),
    (3, (0.96, 0.85, 0.26)),
    (5, (0.98, 0.58, 0.16)),
    (8, (0.86, 0.15, 0.15)),
    (10, (0.55, 0.05, 0.18)),
]


def pain_rgb(intensity: float) -> tuple[float, float, float]:
    v = min(10.0, max(1.0, intensity))
    for i in range(len(_STOPS) - 1):
        (v0, c0), (v1, c1) = _STOPS[i], _STOPS[i + 1]
        if v <= v1:
            f = (v - v0) / (v1 - v0)
            return tuple(c0[k] + f * (c1[k] - c0[k]) for k in range(3))
    return _STOPS[-1][1]


def _hex(intensity: float) -> str:
    r, g, b = pain_rgb(intensity)
    return f"#{round(r * 255):02x}{round(g * 255):02x}{round(b * 255):02x}"


# ---------------------------------------------------------------------------
# FMA id -> schematic body-surface position (x, y in 0..1 per view)
# x: 0 = body's right edge in the drawing ... 1 = left; 0.5 = midline
# y: 0 = feet ... 1 = top of head
# ---------------------------------------------------------------------------

BODY_MAP_POINTS: dict[str, tuple[str, float, float]] = {
    # --- front (anterior) view ---
    "FMA48996": ("front", 0.50, 0.885),  # masseter (jaw)
    "FMA13407": ("front", 0.50, 0.815),  # sternocleidomastoid
    "FMA13343": ("front", 0.50, 0.780),  # infrahyoids / swallowing
    "FMA13295": ("front", 0.50, 0.645),  # diaphragm
    "FMA13354": ("front", 0.50, 0.665),  # intercostals
    "FMA9627": ("front", 0.50, 0.692),   # pectoralis major
    "FMA32521": ("front", 0.50, 0.705),  # deltoid (shoulder caps)
    "FMA9628": ("front", 0.50, 0.545),   # rectus abdominis
    "FMA13335": ("front", 0.50, 0.545),  # external oblique
    "FMA18060": ("front", 0.50, 0.475),  # iliopsoas
    "FMA22443": ("front", 0.50, 0.405),  # adductor magnus
    "FMA22428": ("front", 0.50, 0.325),  # quadriceps
    "FMA22532": ("front", 0.50, 0.150),  # tibialis anterior (shin)
    "FMA32862": ("front", 0.50, 0.225),  # medial knee (ACR)
    # --- back (posterior) view ---
    "FMA32582": ("back", 0.50, 0.885),   # occiput (ACR, base of skull)
    "FMA12524": ("front", 0.50, 0.795),  # low cervical (ACR, anterior C5-7)
    "FMA9626": ("back", 0.50, 0.728),    # trapezius (ACR)
    "FMA9629": ("back", 0.50, 0.685),    # supraspinatus (ACR)
    "FMA71302": ("back", 0.50, 0.585),   # erector spinae
    "FMA13357": ("back", 0.50, 0.615),   # latissimus dorsi
    "FMA22314": ("back", 0.50, 0.425),   # gluteus maximus (ACR gluteal)
    "FMA51523": ("back", 0.50, 0.400),   # greater trochanter (ACR)
    "FMA22356": ("back", 0.50, 0.320),   # hamstrings
    "FMA22541": ("back", 0.50, 0.185),   # gastrocnemius
    "FMA22542": ("back", 0.50, 0.140),   # soleus
    "FMA7882": ("front", 0.50, 0.675),   # second rib (ACR)
    "FMA23444": ("front", 0.50, 0.515),  # lateral epicondyle (ACR, elbow)
}

#: explicit left/right mesh ids get mirrored offsets on their group's point
_LR_OFFSETS: dict[str, float] = {
    "FMA13377": +0.045, "FMA13378": -0.045,   # rectus abdominis R/L
    "FMA32547": +0.05, "FMA32548": -0.05,     # infraspinatus R/L
    "FMA9756": +0.045, "FMA9757": -0.045,     # intercostal R/L
    "FMA13350": +0.025, "FMA13351": -0.025,   # sternothyroid R/L
    "FMA13346": +0.025, "FMA13347": -0.025,   # sternohyoid R/L
    "FMA13352": +0.025, "FMA13353": -0.025,   # thyrohyoid R/L
    "FMA8012": +0.10, "FMA7882": -0.10,       # second rib R/L
    "FMA23446": +0.175, "FMA23444": -0.175,   # lateral epicondyle R/L
    "FMA32863": +0.05, "FMA32862": -0.05,     # medial knee R/L
    "FMA51524": +0.10, "FMA51523": -0.10,     # trochanter R/L
}

#: bilateral groups/marks drawn as two symmetric dots (area split in half) so
#: a single group-level log never sits on the limb seam nor looks unilateral
_BILATERAL_X: dict[str, float] = {
    "FMA13407": 0.030,   # SCM
    "FMA32521": 0.105,   # deltoid
    "FMA9627": 0.075,    # pectoralis
    "FMA13335": 0.075,   # external oblique
    "FMA9629": 0.065,    # supraspinatus
    "FMA9626": 0.035,    # trapezius (ACR mid-belly)
    "FMA13357": 0.090,   # latissimus
    "FMA71302": 0.035,   # erector spinae
    "FMA32582": 0.030,   # occiput
    "FMA12524": 0.025,   # low cervical
    "FMA18060": 0.055,   # iliopsoas
    "FMA22443": 0.048,   # adductors
    "FMA22428": 0.048,   # quadriceps
    "FMA22356": 0.048,   # hamstrings
    "FMA22314": 0.060,   # gluteal
    "FMA22541": 0.048,   # gastrocnemius
    "FMA22542": 0.048,   # soleus
    "FMA22532": 0.048,   # tibialis anterior
}

DEFAULT_FALLBACK = ("front", 0.50, 0.50)


def body_map_point(fma_id: str) -> tuple[str, float, float] | None:
    fid = fma_id.upper()
    view, x, y = BODY_MAP_POINTS.get(fid) or DEFAULT_FALLBACK
    known = fid in BODY_MAP_POINTS
    offset = _LR_OFFSETS.get(fid, 0.0)
    if not known:
        group_id = ORGAN_TO_GROUP.get(fid, fid)
        if group_id in BODY_MAP_POINTS:
            view, x, y = BODY_MAP_POINTS[group_id]
            offset = _LR_OFFSETS.get(fid, 0.0)
            known = True
    if not known:
        return None
    if not offset:
        offset = _BILATERAL_X.get(fid, 0.0)
    return (view, min(0.97, max(0.03, x + offset)), y)


def body_map_points_bilateral(fma_id: str) -> list[tuple[str, float, float]]:
    """Placement points for a logged id: two symmetric dots for bilateral
    group-level ids, one dot for explicit L/R or midline concepts."""
    fid = fma_id.upper()
    point = body_map_point(fid)
    if point is None:
        return []
    if fid in _LR_OFFSETS or fid not in _BILATERAL_X:
        return [point]
    view, x, y = point
    base = BODY_MAP_POINTS.get(ORGAN_TO_GROUP.get(fid, fid), BODY_MAP_POINTS.get(fid))
    cx = base[1] if base else x
    return [(view, cx - _BILATERAL_X[fid], y), (view, cx + _BILATERAL_X[fid], y)]


# ---------------------------------------------------------------------------
# matplotlib renders
# ---------------------------------------------------------------------------

def _draw_silhouette(ax, view: str) -> None:
    """Schematic human outline (units: x 0..1, y 0..1)."""
    from matplotlib.patches import Circle, Polygon, FancyBboxPatch

    body_fc, body_ec = "#eef2f7", "#94a3b8"
    ax.add_patch(Circle((0.5, 0.935), 0.055, fc=body_fc, ec=body_ec, lw=1.4))
    ax.add_patch(FancyBboxPatch((0.475, 0.845), 0.05, 0.045,
                                boxstyle="round,pad=0.005",
                                fc=body_fc, ec=body_ec, lw=1.2))
    # torso
    ax.add_patch(Polygon([
        (0.36, 0.775), (0.64, 0.775), (0.655, 0.66), (0.63, 0.475),
        (0.585, 0.43), (0.415, 0.43), (0.37, 0.475), (0.345, 0.66),
    ], closed=True, fc=body_fc, ec=body_ec, lw=1.4))
    # arms (slightly out)
    for sx in (1, -1):
        ax.add_patch(FancyBboxPatch(
            (0.655 if sx > 0 else 0.305, 0.44), 0.055, 0.335,
            boxstyle="round,pad=0.012", fc=body_fc, ec=body_ec, lw=1.2))
        ax.add_patch(Circle((0.6825 if sx > 0 else 0.3175, 0.435), 0.028,
                            fc=body_fc, ec=body_ec, lw=1.2))
    # legs
    for sx in (1, -1):
        ax.add_patch(FancyBboxPatch(
            (0.51 if sx > 0 else 0.415, 0.05), 0.075, 0.375,
            boxstyle="round,pad=0.012", fc=body_fc, ec=body_ec, lw=1.2))
        ax.add_patch(FancyBboxPatch(
            (0.505 if sx > 0 else 0.41, 0.015), 0.09, 0.035,
            boxstyle="round,pad=0.006", fc=body_fc, ec=body_ec, lw=1.2))
    if view == "back":
        ax.plot([0.5, 0.5], [0.46, 0.77], color="#b6c2d2", lw=1.6,
                zorder=1, solid_capstyle="round")
        for sx in (1, -1):
            ax.add_patch(Polygon([
                (0.5 + sx * 0.045, 0.745), (0.5 + sx * 0.13, 0.715),
                (0.5 + sx * 0.125, 0.645), (0.5 + sx * 0.05, 0.665),
            ], closed=True, fc="#e2e8f0", ec="#b6c2d2", lw=0.8))
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.set_aspect("equal")
    ax.axis("off")


def render_body_maps(
    logs: Sequence[Mapping[str, Any]],
    start: date,
    end: date,
    path: str | Path,
) -> int:
    """Front + back schematic pain maps.

    logs: rows with fmaId, intensity (peak per structure wins), name.
    Returns the number of placed points; unmapped ids are not drawn but are
    reported by the caller.
    """
    per_fma: dict[str, dict[str, Any]] = {}
    for row in logs:
        fid = str(row["fmaId"]).upper()
        entry = per_fma.setdefault(fid, {"peak": 0, "days": 0, "name": row.get("name")})
        entry["peak"] = max(entry["peak"], int(row["intensity"]))
        entry["days"] += 1

    fig = Figure(figsize=(9.0, 4.9), dpi=150)
    fig.patch.set_facecolor("white")
    axes = {"front": fig.add_axes([0.04, 0.115, 0.44, 0.75]),
            "back": fig.add_axes([0.52, 0.115, 0.44, 0.75])}
    _draw_silhouette(axes["front"], "front")
    _draw_silhouette(axes["back"], "back")
    axes["front"].set_title("ANTERIOR (front)", fontsize=11, color="#334155", pad=2)
    axes["back"].set_title("POSTERIOR (back)", fontsize=11, color="#334155", pad=2)

    placed = 0
    max_days = max((e["days"] for e in per_fma.values()), default=1)
    for fid, entry in per_fma.items():
        points = body_map_points_bilateral(fid)
        if not points:
            continue
        size = 30 + 190 * math.sqrt(entry["days"] / max(max_days, 1))
        size = size / len(points)  # split area across the symmetric dots
        r, g, b = pain_rgb(entry["peak"])
        for view, x, y in points:
            axes[view].scatter([x], [y], s=size, c=[(r, g, b)], alpha=0.88,
                               edgecolors="white", linewidths=0.7, zorder=5)
            placed += 1

    if placed == 0:
        for ax in axes.values():
            ax.text(0.5, 0.52, "no mappable pain\nlogs in range",
                    ha="center", va="center", fontsize=10, color="#94a3b8")

    # legend: peak-intensity color scale + size meaning
    cax = fig.add_axes([0.24, 0.045, 0.52, 0.022])
    import numpy as np

    from matplotlib.colors import LinearSegmentedColormap

    cmap = LinearSegmentedColormap.from_list(
        "pain", [pain_rgb(v / 10) for v in range(1, 11)])
    import matplotlib.colors as mcolors

    cax.imshow(np.linspace(1, 10, 256)[None, :], aspect="auto",
               cmap=cmap, vmin=1, vmax=10)
    cax.set_xticks([0, 63, 127, 191, 255], labels=["1", "3", "5", "8", "10"])
    cax.set_yticks([])
    cax.tick_params(labelsize=7, colors="#475569")
    for spine in cax.spines.values():
        spine.set_visible(False)
    cax.set_title("peak pain intensity (color) · dot size = days logged",
                  fontsize=7.5, color="#475569", pad=2)

    fig.suptitle(f"Pain distribution · {start.isoformat()} → {end.isoformat()}",
                 fontsize=12, color="#0f172a", y=0.975)
    fig.savefig(path, format="png", facecolor="white")
    return placed


def render_pem_chart(
    series: Sequence[Mapping[str, Any]],
    pem: Mapping[str, Any],
    start: date,
    end: date,
    path: str | Path,
) -> None:
    """Static dual-axis Energy-Drain vs pain chart (dashboard parity)."""
    import matplotlib.dates as mdates

    dates = [date.fromisoformat(str(d["date"])) for d in series]
    drain = [float(d["energyDrain"]) if d["energyDrain"] is not None else None
             for d in series]
    pain = [float(d["painAvg"]) if d["painAvg"] is not None else None
            for d in series]

    fig = Figure(figsize=(9.0, 3.7), dpi=150)
    fig.patch.set_facecolor("white")
    ax1 = fig.add_axes([0.075, 0.16, 0.83, 0.72])
    ax2 = ax1.twinx()

    def _plot(ax, ys, color, label):
        xs = [d for d, y in zip(dates, ys) if y is not None]
        vs = [y for y in ys if y is not None]
        if xs:
            ax.plot(xs, vs, color=color, lw=2.0, marker="o", ms=3.2, label=label)
            ax.fill_between(xs, 0, vs, color=color, alpha=0.08)

    _plot(ax1, drain, "#f97316", "Energy Drain (activity)")
    _plot(ax2, pain, "#f43f5e", "Pain, avg of painted (0-10)")
    drain_max = max((v for v in drain if v is not None), default=1)
    ax1.set_ylim(0, drain_max * 1.3)

    ax1.set_ylabel("Energy Drain", color="#f97316", fontsize=9)
    ax2.set_ylabel("pain (avg 0-10)", color="#f43f5e", fontsize=9)
    ax2.set_ylim(0, 10.5)
    ax1.tick_params(axis="y", labelcolor="#f97316", labelsize=8)
    ax2.tick_params(axis="y", labelcolor="#f43f5e", labelsize=8)
    ax1.tick_params(axis="x", labelsize=8)
    ax1.xaxis.set_major_formatter(mdates.DateFormatter("%b %d"))
    ax1.xaxis.set_major_locator(mdates.AutoDateLocator(minticks=4, maxticks=10))
    for spine in list(ax1.spines.values()) + list(ax2.spines.values()):
        spine.set_color("#cbd5e1")
    ax1.grid(True, color="#e2e8f0", lw=0.6, ls="--")
    ax1.set_axisbelow(True)

    best = pem.get("bestLagDays")
    r = pem.get("pearsonAtBest")
    title = f"Energy Drain vs pain · {start.isoformat()} → {end.isoformat()}"
    if best is not None:
        title += f"   (best correlation at +{best} day lag, r = {r})"
    ax1.set_title(title, fontsize=10.5, color="#0f172a", pad=8)
    if not any(v is not None for v in drain) and not any(v is not None for v in pain):
        ax1.text(0.5, 0.5, "no activity or pain logs in this range",
                 ha="center", va="center", transform=ax1.transAxes,
                 fontsize=10, color="#94a3b8")
    h1, l1 = ax1.get_legend_handles_labels()
    h2, l2 = ax2.get_legend_handles_labels()
    if h1 or h2:
        ax1.legend(h1 + h2, l1 + l2, loc="upper left", fontsize=8,
                   frameon=False)
    fig.savefig(path, format="png", facecolor="white")


# ---------------------------------------------------------------------------
# PDF assembly (ReportLab platypus)
# ---------------------------------------------------------------------------

def _struct_label(fma_id: str, fallback: str | None) -> str:
    fid = fma_id.upper()
    group_id = ORGAN_TO_GROUP.get(fid, fid)
    group = GROUP_BY_FMA.get(group_id)
    if group:
        return str(group.get("commonName") or group["name"])
    return analytics.region_label(fid, fallback)


def build_report_pdf(
    *,
    profile: str,
    start: date,
    end: date,
    pain_rows: Sequence[Mapping[str, Any]],
    activity_rows: Sequence[Mapping[str, Any]],
    series: Sequence[Mapping[str, Any]],
    pem: Mapping[str, Any],
    clusters: Mapping[str, Any],
    generated_utc: datetime,
) -> bytes:
    """Assemble the PDF. Returns the bytes; temp images are cleaned up."""
    from io import BytesIO

    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import (Image, PageBreak, Paragraph,
                                    SimpleDocTemplate, Spacer, Table,
                                    TableStyle)

    W, H = A4
    SLATE = colors.HexColor("#0f172a")
    MUTED = colors.HexColor("#475569")
    LINE = colors.HexColor("#cbd5e1")
    ACCENT = colors.HexColor("#f43f5e")

    styles = getSampleStyleSheet()
    st_title = ParagraphStyle("t", parent=styles["Title"], fontSize=20,
                              textColor=SLATE, spaceAfter=2)
    st_h2 = ParagraphStyle("h2", parent=styles["Heading2"], fontSize=13,
                           textColor=SLATE, spaceBefore=10, spaceAfter=4)
    st_body = ParagraphStyle("b", parent=styles["BodyText"], fontSize=9.5,
                             textColor=colors.HexColor("#1e293b"), leading=13.5)
    st_small = ParagraphStyle("s", parent=st_body, fontSize=8, textColor=MUTED,
                              leading=11)
    st_cell = ParagraphStyle("c", parent=st_body, fontSize=8.5, leading=11)

    # ---- summary stats ----------------------------------------------------
    days_in_range = (end - start).days + 1
    pain_by_day: dict[date, list[int]] = defaultdict(list)
    struct: dict[str, dict[str, Any]] = {}
    unmapped_names: list[str] = []
    for row in pain_rows:
        d = row["logDate"]
        if isinstance(d, str):
            d = date.fromisoformat(d)
        pain_by_day[d].append(int(row["intensity"]))
        fid = str(row["fmaId"]).upper()
        e = struct.setdefault(fid, {"days": 0, "sum": 0, "peak": 0,
                                    "name": row.get("name")})
        e["days"] += 1
        e["sum"] += int(row["intensity"])
        e["peak"] = max(e["peak"], int(row["intensity"]))
        if body_map_point(fid) is None and len(unmapped_names) < 6:
            unmapped_names.append(f"{_struct_label(fid, row.get('name'))} ({fid})")

    avg_daily = (
        round(sum(sum(v) for v in pain_by_day.values())
              / sum(len(v) for v in pain_by_day.values()), 1)
        if pain_by_day else None
    )
    peak_pain = max((max(v) for v in pain_by_day.values()), default=None)
    total_drain = round(sum(float(a.get("energyDrain") or 0) for a in activity_rows), 1)
    active_days = len({(a["logDate"] if isinstance(a["logDate"], date)
                        else date.fromisoformat(str(a["logDate"])))
                       for a in activity_rows})

    if pain_by_day:
        summary = (
            f"Patient profile “{profile}” logged <b>{len(pain_by_day)} day(s)</b> of "
            f"symptom data between {start.isoformat()} and {end.isoformat()} "
            f"({days_in_range}-day window): <b>{sum(len(v) for v in pain_by_day.values())} "
            f"pain ratings</b> across {len(struct)} structures, average daily pain "
            f"<b>{avg_daily}/10</b>"
            + (f", peak {peak_pain}/10" if peak_pain else "")
            + ". "
            + (f"{len(activity_rows)} activity estimate(s) were saved "
               f"(total modeled Energy Drain {total_drain} over {active_days} day(s)). "
               if activity_rows else "No activity estimates were saved in this window. ")
        )
    else:
        summary = (
            f"No pain ratings were logged for profile “{profile}” between "
            f"{start.isoformat()} and {end.isoformat()}. The charts below show "
            "empty axes; ask the patient to paint pain on the 3D model and log "
            "activities to populate the report."
        )
    if pem.get("bestLagDays") is not None:
        summary += f" {pem.get('interpretation', '')}"

    # ---- temp images -------------------------------------------------------
    tmp = Path(tempfile.mkdtemp(prefix="anatomy-report-"))
    chart_path = tmp / "pem.png"
    maps_path = tmp / "maps.png"
    try:
        render_pem_chart(series, pem, start, end, chart_path)
        render_body_maps(pain_rows, start, end, maps_path)

        def img(path: Path, width: float) -> Image:
            from PIL import Image as PILImage  # reportlab ships with pillow
            with PILImage.open(path) as im:
                w, h = im.size
            return Image(str(path), width=width, height=width * h / w)

        story: list = []
        story.append(Paragraph("Clinical Symptom Report", st_title))
        story.append(Paragraph(
            f"Profile “{profile}” · window {start.isoformat()} → {end.isoformat()} · "
            f"generated {generated_utc.strftime('%Y-%m-%d %H:%M UTC')}",
            st_small))
        story.append(Spacer(1, 4))
        hdr = Table(
            [[Paragraph(
                "Self-tracked ME/CFS &amp; fibromyalgia data from the Interactive "
                "Anatomy Engine (BodyParts3D/FMA). All values derive from the "
                "patient's own logs.", st_small)]],
            colWidths=[W - 30 * mm],
        )
        hdr.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f1f5f9")),
            ("BOX", (0, 0), (-1, -1), 0.5, LINE),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        story.append(hdr)

        # 1 - executive summary
        story.append(Paragraph("1 · Executive summary", st_h2))
        story.append(Paragraph(summary, st_body))
        stats: list[list[Any]] = [
            ["Days with logs", str(len(pain_by_day))],
            ["Pain ratings", str(sum(len(v) for v in pain_by_day.values()))],
            ["Average daily pain", f"{avg_daily}/10" if avg_daily is not None else "–"],
            ["Peak pain", f"{peak_pain}/10" if peak_pain is not None else "–"],
            ["Distinct structures", str(len(struct))],
            ["Activities logged", str(len(activity_rows))],
            ["Total Energy Drain", f"{total_drain}" if activity_rows else "–"],
            ["PEM best lag",
             f"+{pem['bestLagDays']} d (r = {pem['pearsonAtBest']})"
             if pem.get("bestLagDays") is not None else "insufficient data"],
        ]
        stat_tbl = Table(
            [[Paragraph(f"<b>{k}</b>", st_cell), Paragraph(v, st_cell)]
             for k, v in stats],
            colWidths=[55 * mm, 50 * mm],
        )
        stat_tbl.setStyle(TableStyle([
            ("GRID", (0, 0), (-1, -1), 0.4, LINE),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 2.5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
        ]))
        story.append(Spacer(1, 4))
        story.append(stat_tbl)

        # 2 - PEM chart
        story.append(Paragraph("2 · Energy drain vs symptom pain (PEM)", st_h2))
        story.append(img(chart_path, W - 40 * mm))
        story.append(Paragraph(
            str(pem.get("interpretation", "")) +
            " Pearson r over day pairs where both an activity estimate and a "
            "pain rating exist; a positive best lag with rising r is the "
            "delayed pattern typical of post-exertional malaise.", st_small))

        # 3 - clusters
        story.append(Paragraph("3 · Top symptom clusters", st_h2))
        rules = clusters.get("pairRules") or []
        region_clusters = clusters.get("regionClusters") or []
        if not rules and not region_clusters:
            story.append(Paragraph(
                str(clusters.get("note") or
                    "Not enough overlapping flare days to compute clusters in "
                    "this window."), st_body))
        else:
            for rule in rules[:6]:
                story.append(Paragraph(
                    f"• {rule['statement']} "
                    f"<font color='#64748b'>(confidence "
                    f"{round(rule['confidence'] * 100)}%, lift {rule['lift']})</font>",
                    st_body))
            for cluster in region_clusters[:4]:
                story.append(Paragraph(
                    "• Region cluster: " + ", ".join(cluster["members"]) +
                    f" <font color='#64748b'>(co-flared on {cluster['support']} "
                    f"day(s))</font>", st_body))
            story.append(Paragraph(
                "Method: association rules (support/confidence/lift) over "
                "per-day flare baskets + single-linkage clustering of the "
                "region co-occurrence matrix.", st_small))

        # 4 - body maps
        story.append(Paragraph("4 · Pain distribution maps", st_h2))
        story.append(img(maps_path, W - 40 * mm))
        caption = (
            "Schematic body maps; marker color = peak logged intensity, "
            "marker size = number of days the structure was logged.")
        if unmapped_names:
            caption += (" Placed on the nearest covered region are the muscle "
                        "groups and ACR tender-point concepts; not mappable on "
                        "the 2D silhouette (still counted above): "
                        + ", ".join(unmapped_names) + ".")
        story.append(Paragraph(caption, st_small))

        # 5 - most-logged structures table
        if struct:
            story.append(Paragraph("5 · Most frequently logged structures", st_h2))
            rows_out = sorted(
                struct.items(),
                key=lambda kv: (-kv[1]["days"], -kv[1]["peak"]),
            )[:12]
            tbl = Table(
                [[Paragraph("<b>Structure</b>", st_cell),
                  Paragraph("<b>FMA id</b>", st_cell),
                  Paragraph("<b>Days</b>", st_cell),
                  Paragraph("<b>Avg</b>", st_cell),
                  Paragraph("<b>Peak</b>", st_cell)]]
                + [
                    [Paragraph(_struct_label(fid, e["name"]), st_cell),
                     Paragraph(fid, st_cell),
                     Paragraph(str(e["days"]), st_cell),
                     Paragraph(f"{e['sum'] / e['days']:.1f}", st_cell),
                     Paragraph(
                         f"<font color='{_hex(e['peak'])}'><b>{e['peak']}</b></font>",
                         st_cell)]
                    for fid, e in rows_out
                ],
                colWidths=[82 * mm, 26 * mm, 16 * mm, 16 * mm, 18 * mm],
            )
            tbl.setStyle(TableStyle([
                ("GRID", (0, 0), (-1, -1), 0.4, LINE),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
            ]))
            story.append(tbl)

        # appendix - day-by-day table
        story.append(PageBreak())
        story.append(Paragraph("Appendix · Day-by-day log", st_h2))
        app_rows: list[list[Any]] = [[
            Paragraph("<b>Date</b>", st_cell),
            Paragraph("<b>Pain ratings</b>", st_cell),
            Paragraph("<b>Avg / peak</b>", st_cell),
            Paragraph("<b>Energy Drain</b>", st_cell),
        ]]
        for day in series:
            if day["painLogCount"] == 0 and day["activityCount"] == 0:
                continue
            peak = day.get("painMax")
            app_rows.append([
                Paragraph(str(day["date"]), st_cell),
                Paragraph(str(day["painLogCount"]), st_cell),
                Paragraph(
                    f"{day['painAvg']} / {peak if peak is not None else '–'}"
                    if day["painAvg"] is not None else "–", st_cell),
                Paragraph(str(day["energyDrain"])
                          if day["energyDrain"] is not None else "–", st_cell),
            ])
        if len(app_rows) == 1:
            app_rows.append([Paragraph("No logs in range.", st_cell), "", "", ""])
        app = Table(app_rows, colWidths=[35 * mm, 30 * mm, 35 * mm, 35 * mm],
                    repeatRows=1)
        app.setStyle(TableStyle([
            ("GRID", (0, 0), (-1, -1), 0.4, LINE),
            ("TOPPADDING", (0, 0), (-1, -1), 2),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ]))
        story.append(app)

        story.append(Spacer(1, 10))
        story.append(Paragraph(
            "<b>Disclaimer.</b> This report summarizes patient self-tracked "
            "pain ratings and modeled activity-energy estimates. It is not a "
            "diagnosis; energy-drain and cluster outputs are descriptive "
            "aids built on published anthropometry (de Leva/Dempster, Elia) "
            "and the patient's own entries.", st_small))

        buf = BytesIO()
        doc = SimpleDocTemplate(
            buf, pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm,
            topMargin=14 * mm, bottomMargin=14 * mm,
            title=f"Clinical Symptom Report {start}→{end}",
            author="Interactive Anatomy Engine",
        )

        def _footer(canvas, _doc):
            canvas.saveState()
            canvas.setFont("Helvetica", 7)
            canvas.setFillColor(MUTED)
            canvas.drawString(15 * mm, 9 * mm,
                              "Interactive Anatomy Engine — self-tracked symptom report")
            canvas.drawRightString(W - 15 * mm, 9 * mm, f"page {canvas.getPageNumber()}")
            canvas.restoreState()

        doc.build(story, onFirstPage=_footer, onLaterPages=_footer)
        return buf.getvalue()
    finally:
        for p in (chart_path, maps_path):
            try:
                p.unlink()
            except OSError:
                pass
        try:
            tmp.rmdir()
        except OSError:
            pass
