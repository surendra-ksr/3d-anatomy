"""
Curated application configuration for the Interactive Anatomy Engine.

Everything in this file is *real* anatomical data:

* Every part is identified by its Foundational Model of Anatomy (FMA) concept
  ID, exactly as published in the BodyParts3D (BP3D) 3.0 distribution
  (Database Center for Life Science, DBCLS).
* `parts_list_e.txt` ships the FMA ID -> English name table for every mesh,
  `conventional_part_of.txt` ships the containment hierarchy, and
  `FMA.csv` ships the FMA is_a ontology used by BP3D.

The selection below defines which BP3D structures ship in the MVP. The list
is deliberately explicit (literal FMA IDs) so it can be reviewed by a domain
expert and diffed over time.
"""
from __future__ import annotations

# ---------------------------------------------------------------------------
# Data sources
# ---------------------------------------------------------------------------

# Version stamped on everything produced by this pipeline.
BP3D_VERSION = "3.0"
FMA_ONTOLOGY_VERSION = "FMA 3.2.1 (as distributed with BP3D 3.0)"

# Official channels (used first when the network allows).
BP3D_SITE = "https://lifesciencedb.jp/bp3d/"
BP3D_DOWNLOAD = "https://lifesciencedb.jp/ag/bp3d/download/"
BP3D_CGI = "https://lifesciencedb.jp/bp3d/cgi-bin/data_download.cgi"
BP3D_ARCHIVE = "https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST"

# Community mirror of the BP3D 3.0 distribution (fallback for restricted
# networks). Contains the identical per-FMA-ID STL files + metadata.
BP3D_GITHUB_MIRROR = "https://github.com/Kevin-Mattheus-Moerman/BodyParts3D"

LICENSE = "CC BY-SA 2.1 JP"
RIGHTS_HOLDER = "Database Center for Life Science (DBCLS), Japan"

# ---------------------------------------------------------------------------
# Anatomical systems (top level of the layer tree)
# ---------------------------------------------------------------------------

class System:
    def __init__(self, key: str, name: str, fma_id: str, color: str, order: int):
        self.key, self.name, self.fma_id = key, name, fma_id
        self.color, self.order = color, order

SYSTEMS: list[System] = [
    System("skeletal",     "Skeletal System",       "FMA23881", "#E3D9B8", 10),
    System("muscular",     "Muscular System",       "FMA30316", "#B0413E", 20),
    System("circulatory",  "Cardiovascular System", "FMA7161",  "#A63D40", 30),
    System("respiratory",  "Respiratory System",    "FMA7158",  "#D98E8E", 40),
    System("digestive",    "Digestive System",      "FMA7152",  "#C87F3B", 50),
    System("urinary",      "Urinary System",        "FMA7159",  "#6E8FB5", 60),
    System("reproductive", "Reproductive System",   "FMA7160",  "#9B7FB8", 70),
    System("nervous",      "Nervous System",        "FMA7157",  "#D9C46B", 80),
    System("endocrine",    "Endocrine System",      "FMA9668",  "#5FA392", 90),
    System("lymphatic",    "Lymphatic System",      "FMA74594", "#7D8A97", 100),
]

# The system roots themselves must never appear as selectable organs.
SYSTEM_FMA_IDS = {s.fma_id for s in SYSTEMS}

# ---------------------------------------------------------------------------
# Mesh delivery groups  (one Draco-compressed .glb per group)
# ---------------------------------------------------------------------------

class Group:
    def __init__(self, key: str, label: str, system_key: str, order: int,
                 default_visible: bool = False):
        self.key, self.label = key, label
        self.system_key, self.order = system_key, order
        self.default_visible = default_visible

GROUPS: list[Group] = [
    Group("skull",        "Skull & Cranial Bones", "skeletal",    10),
    Group("spine-thorax", "Spine & Thorax",        "skeletal",    20),
    Group("limbs",        "Limb Girdles & Limbs",  "skeletal",    30),
    Group("circulatory",  "Heart & Great Vessels", "circulatory", 40, default_visible=True),
    Group("respiratory",  "Airways & Lungs",       "respiratory", 50, default_visible=True),
    Group("digestive",    "Digestive Tract & Organs", "digestive", 60),
    Group("urinary",      "Kidneys & Urinary Tract", "urinary",   70),
    Group("reproductive", "Reproductive Organs",   "reproductive", 80),
    Group("nervous",      "Brain, Cord & Nerves",  "nervous",     90),
    Group("muscular",     "Representative Muscles", "muscular",   100),
    Group("endocrine",    "Endocrine Glands",      "endocrine",   110),
    Group("lymphatic",    "Lymphatic Organs",      "lymphatic",   120),
]

# ---------------------------------------------------------------------------
# Curated part selection  (BP3D mesh IDs; BP3D ids are FMA ids, or BP ids
# where BP3D defines an original concept).
# ---------------------------------------------------------------------------

class Part:
    """A mesh-bearing structure selected for the application."""
    def __init__(self, pid: str, group_key: str, system_key: str | None = None):
        self.id = pid
        self.group_key = group_key
        # Optional explicit classification override (recommended for parts
        # whose names defeat the keyword rules, e.g. brain ventricles or
        # papillary muscles of the heart).
        self.system_key = system_key


S = lambda pid, g, sys_=None: Part(pid, g, sys_)  # noqa: E731

SELECTED_PARTS: list[Part] = [
    # ---- Skeletal: skull -------------------------------------------------
    S("FMA52734", "skull"), S("FMA52788", "skull"), S("FMA52789", "skull"),
    S("FMA52738", "skull"), S("FMA52739", "skull"), S("FMA52735", "skull"),
    S("FMA52736", "skull"), S("FMA52740", "skull"), S("FMA52892", "skull"),
    S("FMA52893", "skull"), S("FMA53649", "skull"), S("FMA53650", "skull"),
    S("FMA53647", "skull"), S("FMA53648", "skull"), S("FMA53645", "skull"),
    S("FMA53646", "skull"), S("FMA54737", "skull"), S("FMA54738", "skull"),
    S("FMA53655", "skull"), S("FMA53656", "skull"),
    S("FMA9710", "skull"),  S("FMA52748", "skull"),
    S("FMA52749", "skull"),
    # ---- Skeletal: spine & thorax ---------------------------------------
    S("FMA12519", "spine-thorax"), S("FMA12520", "spine-thorax"),
    S("FMA12521", "spine-thorax"), S("FMA12522", "spine-thorax"),
    S("FMA12523", "spine-thorax"), S("FMA12524", "spine-thorax"),
    S("FMA12525", "spine-thorax"),
    S("FMA9165", "spine-thorax"),  S("FMA9187", "spine-thorax"),
    S("FMA9209", "spine-thorax"),  S("FMA9248", "spine-thorax"),
    S("FMA9922", "spine-thorax"),  S("FMA9945", "spine-thorax"),
    S("FMA9968", "spine-thorax"),  S("FMA9991", "spine-thorax"),
    S("FMA10014", "spine-thorax"), S("FMA10037", "spine-thorax"),
    S("FMA10059", "spine-thorax"), S("FMA10081", "spine-thorax"),
    S("FMA13072", "spine-thorax"), S("FMA13073", "spine-thorax"),
    S("FMA13074", "spine-thorax"), S("FMA13075", "spine-thorax"),
    S("FMA13076", "spine-thorax"), S("FMA16202", "spine-thorax"),
    # ribs, right first..twelfth
    S("FMA7857", "spine-thorax"), S("FMA7882", "spine-thorax"),
    S("FMA7909", "spine-thorax"), S("FMA7957", "spine-thorax"),
    S("FMA8066", "spine-thorax"), S("FMA8175", "spine-thorax"),
    S("FMA8229", "spine-thorax"), S("FMA8283", "spine-thorax"),
    S("FMA8364", "spine-thorax"), S("FMA8445", "spine-thorax"),
    S("FMA8531", "spine-thorax"), S("FMA8533", "spine-thorax"),
    # ribs, left first..twelfth
    S("FMA7987", "spine-thorax"), S("FMA8012", "spine-thorax"),
    S("FMA8039", "spine-thorax"), S("FMA8148", "spine-thorax"),
    S("FMA8093", "spine-thorax"), S("FMA8202", "spine-thorax"),
    S("FMA8256", "spine-thorax"), S("FMA8310", "spine-thorax"),
    S("FMA8391", "spine-thorax"), S("FMA8472", "spine-thorax"),
    S("FMA8532", "spine-thorax"), S("FMA8534", "spine-thorax"),
    S("FMA7486", "spine-thorax"), S("FMA7487", "spine-thorax"),
    S("FMA7488", "spine-thorax"),
    # ---- Skeletal: limbs -------------------------------------------------
    S("FMA13322", "limbs"), S("FMA13323", "limbs"),
    S("FMA13395", "limbs"), S("FMA13396", "limbs"),
    S("FMA23130", "limbs"), S("FMA23131", "limbs"),
    S("FMA23464", "limbs"), S("FMA23465", "limbs"), S("FMA23467", "limbs"),
    S("FMA23468", "limbs"),
    S("FMA16586", "limbs"), S("FMA16587", "limbs"),
    S("FMA24474", "limbs"), S("FMA24475", "limbs"),
    S("FMA24486", "limbs"), S("FMA24487", "limbs"),
    S("FMA24477", "limbs"), S("FMA24478", "limbs"),
    S("FMA24480", "limbs"), S("FMA24481", "limbs"),
    # ---- Circulatory ------------------------------------------------------
    S("FMA7274", "circulatory", "circulatory"),   # wall of heart
    S("FMA7234", "circulatory", "circulatory"),   # tricuspid valve
    S("FMA7235", "circulatory", "circulatory"),   # mitral valve
    S("FMA7246", "circulatory", "circulatory"),   # pulmonary valve
    S("FMA7260", "circulatory", "circulatory"),
    S("FMA7261", "circulatory", "circulatory"),
    S("FMA7262", "circulatory", "circulatory"),
    S("FMA7266", "circulatory", "circulatory"),
    S("FMA9352nsn", "circulatory", "circulatory"),
    S("FMA3736", "circulatory"),  # ascending aorta
    S("FMA3768", "circulatory"),  # arch of aorta
    S("FMA3784", "circulatory"),  # descending aorta
    S("FMA3932nsn", "circulatory", "circulatory"),  # brachiocephalic artery
    S("FMA3941", "circulatory"), S("FMA4058", "circulatory"),
    S("FMA3953", "circulatory"), S("FMA4694", "circulatory"),
    S("FMA66326", "circulatory", "circulatory"),  # pulmonary artery
    S("FMA66643", "circulatory", "circulatory"),  # pulmonary vein
    S("FMA4720", "circulatory"),  # SVC
    S("FMA10951", "circulatory"), # IVC
    S("FMA4751", "circulatory"), S("FMA4761", "circulatory"),
    S("FMA21387", "circulatory"), S("FMA21388", "circulatory"),
    S("FMA4706", "circulatory", "circulatory"),   # coronary sinus
    S("FMA4707", "circulatory", "circulatory"),   # great cardiac vein
    S("FMA4713", "circulatory", "circulatory"),   # middle cardiac vein
    # ---- Respiratory ------------------------------------------------------
    S("FMA7394", "respiratory"),  # trachea
    S("FMA7409", "respiratory"),  # bronchus
    S("FMA7333", "respiratory"), S("FMA7383", "respiratory"),
    S("FMA7337", "respiratory"), S("FMA7370", "respiratory"),
    S("FMA7371", "respiratory"),
    S("FMA55099", "respiratory"),  # thyroid cartilage (larynx)
    # ---- Digestive --------------------------------------------------------
    S("FMA7131", "digestive"),   # esophagus
    S("FMA7148", "digestive"),   # stomach
    S("FMA7206", "digestive"),   # duodenum
    S("FMA7207", "digestive"),   # jejunum
    S("FMA7208", "digestive"),   # ileum
    S("FMA14543nsn", "digestive", "digestive"),  # colon
    S("FMA14544", "digestive"),  # rectum
    S("FMA14542", "digestive"),  # appendix
    S("FMA7197", "digestive"),   # liver
    S("FMA7202", "digestive"),   # gallbladder
    S("FMA7198nsn", "digestive", "digestive"),   # pancreas
    # ---- Urinary ----------------------------------------------------------
    S("FMA7204", "urinary"), S("FMA7205", "urinary"),
    S("FMA15571", "urinary"), S("FMA15572", "urinary"),
    S("FMA15900", "urinary"),   # urinary bladder
    S("FMA19667", "urinary"),   # urethra
    # ---- Reproductive -----------------------------------------------------
    S("FMA7211", "reproductive"), S("FMA7212", "reproductive"),
    # ---- Nervous ----------------------------------------------------------
    S("FMA86464", "nervous", "nervous"),  # corpus callosum
    S("FMA72826", "nervous", "nervous"), S("FMA72827", "nervous", "nervous"),
    S("FMA72828", "nervous", "nervous"), S("FMA72829", "nervous", "nervous"),
    S("FMA72830", "nervous", "nervous"), S("FMA72831", "nervous", "nervous"),
    S("FMA72832", "nervous", "nervous"), S("FMA72833", "nervous", "nervous"),
    S("FMA72713", "nervous", "nervous"), S("FMA72714", "nervous", "nervous"),
    S("FMA62008nsn", "nervous", "nervous"),  # hypothalamus
    S("FMA72924", "nervous", "nervous"), S("FMA72925", "nervous", "nervous"),
    S("FMA61993nsn", "nervous", "nervous"),  # midbrain
    S("FMA67943", "nervous", "nervous"),  # pons
    S("FMA62004", "nervous", "nervous"),  # medulla oblongata
    S("FMA67944", "nervous", "nervous"),  # cerebellum
    S("FMA50875", "nervous", "nervous"), S("FMA50878", "nervous", "nervous"),
    # ---- Muscular ---------------------------------------------------------
    S("FMA13295", "muscular", "muscular"),  # diaphragm
    S("FMA32547", "muscular", "muscular"), S("FMA32548", "muscular", "muscular"),
    S("FMA9756", "muscular", "muscular"), S("FMA9757", "muscular", "muscular"),
    S("FMA9758", "muscular", "muscular"),
    S("FMA13377", "muscular", "muscular"), S("FMA13378", "muscular", "muscular"),
    # rectus abdominis (right/left)
    S("FMA13350", "muscular", "muscular"), S("FMA13351", "muscular", "muscular"),
    S("FMA13346", "muscular", "muscular"), S("FMA13347", "muscular", "muscular"),
    S("FMA13352", "muscular", "muscular"), S("FMA13353", "muscular", "muscular"),
    # ---- Endocrine --------------------------------------------------------
    S("FMA15629", "endocrine"), S("FMA15630", "endocrine"),  # adrenal glands
    S("FMA13889", "endocrine"),  # pituitary gland
    S("FMA71194", "endocrine"), S("FMA71195", "endocrine"),  # thymus lobes
    # ---- Lymphatic --------------------------------------------------------
    S("FMA7196", "lymphatic"),   # spleen
]

# Parts whose FMA parents should be *synthesized* into the organ tree even
# though BP3D ships no mesh for them (names resolved from FMA.csv). These give
# the layer tree real depth (e.g. Wall of heart -> Heart -> Cardiovascular).
SYNTHETIC_PARENTS: dict[str, str | None] = {
    # fma_id: system_key
    "FMA7088": "circulatory",   # heart
    "FMA7309": "respiratory",   # right lung
    "FMA7310": "respiratory",   # left lung
    "FMA7334": "respiratory",   # upper lobe of lung
    "FMA7335": "respiratory",   # lower lobe of lung
    "FMA7195": "respiratory",   # lung
    "FMA61992": "nervous",      # forebrain
    "FMA62003": "nervous",      # metencephalon
    "FMA61817": "nervous",      # cerebral hemisphere
    "FMA62007": "nervous",      # thalamus
}

# ---------------------------------------------------------------------------
# Mesh optimization
# ---------------------------------------------------------------------------

# Quadratic decimation caps (triangles) per part id; parts not listed use
# DEFAULT_MAX_FACES.
DEFAULT_MAX_FACES = 120_000
MAX_FACES_OVERRIDES: dict[str, int] = {
    "FMA7274": 200_000,   # wall of heart - the showpiece
    "FMA67944": 160_000,  # cerebellum
    "FMA13295": 140_000,  # diaphragm
    "FMA66326": 140_000,  # pulmonary artery
    "FMA66643": 140_000,  # pulmonary vein
    "FMA13395": 90_000, "FMA13396": 90_000,   # scapulae
    "FMA13398": 90_000, "FMA13399": 90_000,
}

DRACO_COMPRESSION_LEVEL = 7
DRACO_QUANTIZATION_BITS = 11  # position quantization (web-standard)


def asset_base_url() -> str:
    """Absolute CDN base for manifest/asset URLs.

    In production (NODE_ENV=production, as set by the Docker/ECS images)
    MESH_ASSET_BASE_URL points at the S3+CloudFront distribution and manifest
    URLs are written absolute. Development keeps relative /models/ paths
    unless ANATOMY_FORCE_CDN=1 (for local CDN testing).
    """
    import os

    base = os.environ.get("MESH_ASSET_BASE_URL", "").rstrip("/")
    if not base:
        return ""
    if os.environ.get("NODE_ENV") == "production" or os.environ.get("ANATOMY_FORCE_CDN") == "1":
        return base
    return ""
