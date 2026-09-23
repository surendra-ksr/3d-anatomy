"""
Metabolic cost model for the Energy Cost (Pacing) Tracker.

This module is the CANONICAL data + model definition. It is:

* validated by the data pipeline (every FMA id is checked against the FMA
  ontology shipped with BodyParts3D) via ``pipeline/run_pipeline.py validate``
* imported directly by the FastAPI service (``backend/main.py``) for the
  ``POST /api/metabolic-cost`` endpoint.

DESIGN / EVIDENCE
-----------------
The goal is a transparent, conservative ESTIMATE of the metabolic cost of
sustained muscle activity so that people with ME/CFS can plan inside their
energy envelope and reduce post-exertional malaise (PEM) risk. It is NOT a
clinical measurement. Every constant below comes from published literature or
is an explicitly-labelled modelling assumption:

1. Whole-body skeletal muscle mass fraction (Janssen et al. 2000, J Appl
   Physiol 89:81-88, MRI-based): men ~38 %, women ~30.6 % of body mass.

2. Segment masses (de Leva 1996 adjustments of Zatsiorsky's anthropometry,
   % of total body mass) and muscle fraction of each segment (composite
   cadaver composition, Dempster 1955; Clarys & Martin 1985). These are
   population approximations - they are exposed and adjustable.

3. Resting metabolic rate of skeletal muscle tissue: 13 kcal/kg/day
   (Elia 1992 "Organ and tissue contribution to metabolic rate"; consistent
   with Wang et al. 2010 Am J Clin Nutr 91:1107-17). -> ~0.63 W/kg.

4. Active muscle metabolic multiplier: voluntary sustained contraction raises
   muscle metabolic rate by roughly one order of magnitude at low effort and
   up to ~40-60x at maximal (barometry of O2 uptake in working muscle). We use
   multiplier = 1 + GAIN * a^2 (intensity a in [0,1], GAIN = 50) with a duty
   cycle for intermittent activity, all user-visible parameters.
"""
from __future__ import annotations

from typing import Any

# ---------------------------------------------------------------------------
# constants (all SI-derived from the references above)
# ---------------------------------------------------------------------------

#: skeletal-muscle resting metabolic rate, kcal per kg tissue per day [Elia 1992]
MUSCLE_RMR_KCAL_PER_KG_DAY = 13.0
#: converted to watts per kg (kcal/day * 4184 J/kcal / 86400 s/day)
MUSCLE_RMR_W_PER_KG = MUSCLE_RMR_KCAL_PER_KG_DAY * 4184.0 / 86400.0  # ~0.629

#: peak activation multiplier above resting at a=1 (literature range 40-60)
ACTIVATION_GAIN = 50.0
#: default fraction of the activity window under tension (intermittent use)
DEFAULT_DUTY_CYCLE = 0.35
#: quadratic intensity exponent (energy rises steeply with effort)
INTENSITY_EXPONENT = 2.0

#: whole-body skeletal muscle fraction of body mass [Janssen 2000]
MUSCLE_MASS_FRACTION = {
    "male": 0.38,
    "female": 0.306,
    "unspecified": 0.343,  # population midpoint used when sex is unknown
}

#: default pacing envelopes (kcal of *activity* energy before high PEM risk).
#: The "energy envelope" concept from ME/CFS pacing literature (Workwell
#: Foundation; "pacing and limits" guidance) - individualized in clinics,
#: these defaults are calibration handles, not medical advice.
PACING_BUDGETS_KCAL = {"mild": 120.0, "moderate": 60.0, "severe": 25.0}
DEFAULT_SEVERITY = "moderate"

REFERENCES = [
    "Janssen I, et al. Skeletal muscle mass and distribution in 468 men and women aged 18-88 yr. J Appl Physiol 2000;89:81-88.",
    "de Leva P. Adjustments to Zatsiorsky-Seluyanov's segment inertia parameters. J Biomech 1996;29:1223-30.",
    "Dempster WT. Space requirements of the seated operator. WADC TR 55-159, 1955 (segment composition).",
    "Clarys JP, Martin PE. Musculoskeletal segmentation and dimension estimation protocols. 1985.",
    "Elia M. Organ and tissue contribution to metabolic rate. In: Energy Metabolism: Tissue Determinants and Cellular Corollaries. Raven Press, 1992.",
    "Wang Z, et al. Specific metabolic rates of major organs and tissues across adulthood. Am J Clin Nutr 2010;91:1107-17.",
    "Workwell Foundation. Pacing / energy envelope guidance for ME/CFS (concept reference).",
]

DISCLAIMER = (
    "Theoretical estimate for self-management planning only. Not a medical "
    "measurement and not medical advice - individual energy envelopes vary; "
    "set your budget with your clinician."
)

# ---------------------------------------------------------------------------
# segment anthropometry (see references above)
# ---------------------------------------------------------------------------

# pctBodyMass  : de Leva 1996, % of total body mass (paired segments summed)
# muscleFraction: share of segment mass that is skeletal muscle (Dempster/
#                Clarys composite cadaver composition, approximate)
SEGMENTS: dict[str, dict[str, Any]] = {
    "head_neck": {"pctBodyMass": 8.1, "muscleFraction": 0.30, "label": "Head & neck"},
    "trunk": {"pctBodyMass": 49.7, "muscleFraction": 0.50, "label": "Trunk"},
    "upper_arm": {"pctBodyMass": 5.42, "muscleFraction": 0.47, "label": "Upper arms"},
    "forearm": {"pctBodyMass": 3.24, "muscleFraction": 0.62, "label": "Forearms"},
    "hand": {"pctBodyMass": 1.22, "muscleFraction": 0.12, "label": "Hands"},
    "thigh": {"pctBodyMass": 28.86, "muscleFraction": 0.52, "label": "Thighs"},
    "shank": {"pctBodyMass": 8.74, "muscleFraction": 0.45, "label": "Shanks"},
    "foot": {"pctBodyMass": 2.74, "muscleFraction": 0.13, "label": "Feet"},
}


def segment_muscle_pct_body_mass(segment_key: str) -> float:
    s = SEGMENTS[segment_key]
    return s["pctBodyMass"] / 100.0 * s["muscleFraction"]


# ---------------------------------------------------------------------------
# muscle groups. `shareOfSegmentMuscle` = share of that segment's muscle mass
# assigned to the group (remainder is unassigned small muscles; shares within
# a segment sum to < 1.0). Every fmaId is a real FMA concept id.
# ---------------------------------------------------------------------------

MUSCLE_GROUPS: list[dict[str, Any]] = [
    # --- trunk ---------------------------------------------------------------
    {"fmaId": "FMA71302", "name": "Erector spinae (back extensors)", "segment": "trunk",
     "shareOfSegmentMuscle": 0.12, "commonName": "back posture muscles"},
    {"fmaId": "FMA9628", "name": "Rectus abdominis", "segment": "trunk",
     "shareOfSegmentMuscle": 0.06, "commonName": "stomach muscles"},
    {"fmaId": "FMA13335", "name": "External oblique", "segment": "trunk",
     "shareOfSegmentMuscle": 0.07, "commonName": "side trunk muscles"},
    {"fmaId": "FMA9627", "name": "Pectoralis major", "segment": "trunk",
     "shareOfSegmentMuscle": 0.05, "commonName": "chest muscles"},
    {"fmaId": "FMA9626", "name": "Trapezius", "segment": "trunk",
     "shareOfSegmentMuscle": 0.05, "commonName": "neck/shoulder muscles"},
    {"fmaId": "FMA32521", "name": "Deltoid", "segment": "trunk",
     "shareOfSegmentMuscle": 0.04, "commonName": "shoulder cap muscles"},
    {"fmaId": "FMA9629", "name": "Supraspinatus", "segment": "trunk",
     "shareOfSegmentMuscle": 0.02, "commonName": "shoulder lift muscle"},
    {"fmaId": "FMA13357", "name": "Latissimus dorsi", "segment": "trunk",
     "shareOfSegmentMuscle": 0.06, "commonName": "upper back pulling muscle"},
    {"fmaId": "FMA13295", "name": "Diaphragm", "segment": "trunk",
     "shareOfSegmentMuscle": 0.03, "commonName": "main breathing muscle"},
    {"fmaId": "FMA13354", "name": "Intercostal muscles", "segment": "trunk",
     "shareOfSegmentMuscle": 0.02, "commonName": "rib breathing muscles"},
    # --- head & neck ---------------------------------------------------------
    {"fmaId": "FMA13407", "name": "Sternocleidomastoid", "segment": "head_neck",
     "shareOfSegmentMuscle": 0.15, "commonName": "neck turning muscle"},
    {"fmaId": "FMA13343", "name": "Infrahyoid muscles (sternothyroid et al.)", "segment": "head_neck",
     "shareOfSegmentMuscle": 0.04, "commonName": "swallowing/voice-box muscles"},
    {"fmaId": "FMA48996", "name": "Masseter", "segment": "head_neck",
     "shareOfSegmentMuscle": 0.06, "commonName": "jaw chewing muscles"},
    # --- upper limb ------------------------------------------------------------
    {"fmaId": "FMA37670", "name": "Biceps brachii", "segment": "upper_arm",
     "shareOfSegmentMuscle": 0.32, "commonName": "front upper-arm muscles"},
    {"fmaId": "FMA37688", "name": "Triceps brachii", "segment": "upper_arm",
     "shareOfSegmentMuscle": 0.38, "commonName": "back upper-arm muscles"},
    # --- lower limb ------------------------------------------------------------
    {"fmaId": "FMA22428", "name": "Quadriceps femoris", "segment": "thigh",
     "shareOfSegmentMuscle": 0.30, "commonName": "front thigh muscles"},
    {"fmaId": "FMA22356", "name": "Hamstrings (biceps femoris et al.)", "segment": "thigh",
     "shareOfSegmentMuscle": 0.18, "commonName": "back thigh muscles"},
    {"fmaId": "FMA22443", "name": "Adductor magnus", "segment": "thigh",
     "shareOfSegmentMuscle": 0.08, "commonName": "inner thigh muscles"},
    {"fmaId": "FMA18060", "name": "Iliopsoas (psoas major)", "segment": "thigh",
     "shareOfSegmentMuscle": 0.05, "commonName": "hip flexor muscles"},
    {"fmaId": "FMA22314", "name": "Gluteus maximus", "segment": "thigh",
     "shareOfSegmentMuscle": 0.12, "commonName": "buttock muscles"},
    {"fmaId": "FMA22541", "name": "Gastrocnemius", "segment": "shank",
     "shareOfSegmentMuscle": 0.22, "commonName": "calf muscles (upper)"},
    {"fmaId": "FMA22542", "name": "Soleus", "segment": "shank",
     "shareOfSegmentMuscle": 0.20, "commonName": "deep calf muscle"},
    {"fmaId": "FMA22532", "name": "Tibialis anterior", "segment": "shank",
     "shareOfSegmentMuscle": 0.06, "commonName": "shin muscle"},
]

#: mesh-bearing muscles in the shipped BodyParts3D subset -> group mapping
#: (so users can log pain/cost on the actual 3D structures)
ORGAN_TO_GROUP: dict[str, str] = {
    "FMA13295": "FMA13295",                      # diaphragm
    "FMA32547": "FMA9629", "FMA32548": "FMA9629",  # right/left infraspinatus
    "FMA13377": "FMA9628", "FMA13378": "FMA9628",  # right/left rectus abdominis
    "FMA9756": "FMA13354", "FMA9757": "FMA13354", "FMA9758": "FMA13354",  # intercostals
    "FMA13350": "FMA13343", "FMA13351": "FMA13343",  # sternothyroid R/L
    "FMA13346": "FMA13343", "FMA13347": "FMA13343",  # sternohyoid R/L
    "FMA13352": "FMA13343", "FMA13353": "FMA13343",  # thyrohyoid R/L
}

GROUP_BY_FMA = {g["fmaId"]: g for g in MUSCLE_GROUPS}

#: rubric bands for the 0-100 Energy Drain score
RISK_BANDS = [
    (25, "low", "Well inside a typical envelope."),
    (50, "moderate", "Useful chunk of a day's envelope - plan rest."),
    (75, "high", "High PEM risk - shorten or split the activity."),
    (101, "very high", "Above a typical envelope - strongly consider reducing."),
]


# ---------------------------------------------------------------------------
# model
# ---------------------------------------------------------------------------

def group_mass_kg(group: dict[str, Any], body_mass_kg: float, sex: str) -> float:
    """Group muscle mass = body mass x segment muscle share (de Leva/Dempster)
    x the group's share of that segment's muscle mass."""
    seg_pct = segment_muscle_pct_body_mass(group["segment"])
    return body_mass_kg * seg_pct * group["shareOfSegmentMuscle"]


def resolve_groups(fma_ids: list[str]) -> tuple[dict[str, dict[str, Any]], list[str]]:
    """Map requested FMA ids to muscle groups.

    Accepts both group ids (e.g. FMA22428 quadriceps) and mesh-bearing organ
    ids (e.g. FMA13377 right rectus abdominis). Returns {groupId: group} and
    the list of ids that could not be resolved to a muscle group.
    """
    resolved: dict[str, dict[str, Any]] = {}
    unknown: list[str] = []
    for raw in fma_ids:
        fid = raw.strip().upper()
        if not fid.startswith("FMA"):
            fid = f"FMA{fid}"
        gid = ORGAN_TO_GROUP.get(fid, fid)
        group = GROUP_BY_FMA.get(gid)
        if group is None:
            unknown.append(fid)
            continue
        resolved[gid] = group
    return resolved, unknown


def compute_energy_drain(
    fma_ids: list[str],
    minutes: float = 20.0,
    body_mass_kg: float = 70.0,
    sex: str = "unspecified",
    intensities: dict[str, float] | None = None,
    pacing_budget_kcal: float | None = None,
    severity: str | None = None,
    duty_cycle: float = DEFAULT_DUTY_CYCLE,
) -> dict[str, Any]:
    """Estimate the metabolic cost of sustaining the given muscle groups."""
    intensities = intensities or {}
    budget = pacing_budget_kcal
    if budget is None:
        budget = PACING_BUDGETS_KCAL.get(severity or DEFAULT_SEVERITY,
                                         PACING_BUDGETS_KCAL[DEFAULT_SEVERITY])

    groups, unknown = resolve_groups(fma_ids)
    seconds = max(minutes, 0.0) * 60.0
    muscles = []
    total_kcal = 0.0
    for gid, group in sorted(groups.items()):
        a = min(max(float(intensities.get(gid, intensities.get(group["fmaId"], 0.5))), 0.0), 1.0)
        mass_kg = group_mass_kg(group, body_mass_kg, sex)
        multiplier = 1.0 + ACTIVATION_GAIN * (a ** INTENSITY_EXPONENT)
        watts = MUSCLE_RMR_W_PER_KG * multiplier * mass_kg * duty_cycle
        kcal = watts * seconds / 4184.0
        total_kcal += kcal
        muscles.append({
            "fmaId": group["fmaId"],
            "name": group["name"],
            "commonName": group.get("commonName"),
            "segment": group["segment"],
            "intensity": round(a, 3),
            "estimatedMassKg": round(mass_kg, 3),
            "watts": round(watts, 3),
            "kcal": round(kcal, 3),
        })

    drain = min(100.0, 100.0 * total_kcal / max(budget, 1e-6))
    band = next(label for limit, label, _ in RISK_BANDS if drain < limit)
    advice = next(text for limit, _, text in RISK_BANDS if drain < limit)

    return {
        "energyDrain": round(drain, 1),
        "riskBand": band,
        "advice": advice,
        "totalKcal": round(total_kcal, 2),
        "minutes": minutes,
        "pacingBudgetKcal": budget,
        "severity": severity or DEFAULT_SEVERITY,
        "bodyMassKg": body_mass_kg,
        "sex": sex,
        "muscles": muscles,
        "unknownFmaIds": sorted(set(unknown)),
        "model": {
            "restingMetabolicRatePerKg": round(MUSCLE_RMR_W_PER_KG, 4),
            "activationGain": ACTIVATION_GAIN,
            "intensityExponent": INTENSITY_EXPONENT,
            "dutyCycle": duty_cycle,
            "muscleMassFraction": MUSCLE_MASS_FRACTION.get(sex, MUSCLE_MASS_FRACTION["unspecified"]),
        },
        "references": REFERENCES,
        "disclaimer": DISCLAIMER,
    }


# ---------------------------------------------------------------------------
# pipeline validation hook
# ---------------------------------------------------------------------------

def validate_against_catalog(fma_labels: dict[str, str]) -> list[str]:
    """Check that every referenced FMA id exists in the FMA ontology."""
    problems = []
    for group in MUSCLE_GROUPS:
        if group["fmaId"] not in fma_labels:
            problems.append(
                f"metabolic group '{group['name']}': FMA id {group['fmaId']} "
                "not found in FMA.csv")
        if group["segment"] not in SEGMENTS:
            problems.append(f"metabolic group '{group['name']}': unknown segment")
    for organ_fid in ORGAN_TO_GROUP:
        if organ_fid not in fma_labels:
            problems.append(f"metabolic organ alias {organ_fid} not in FMA.csv")
    return problems
