"""
FMA <-> BodyParts3D crosswalk and taxonomy services.

This module is the heart of the "NO DUMMY DATA" requirement: it reads the
metadata tables that ship inside the official BodyParts3D 3.0 distribution
and exposes them as a typed, queryable model:

* ``parts_list_e.txt``        -- every downloadable BP3D model, keyed by its
                                 FMA ID (or a BP3D-original ``BPnnn`` ID when
                                 no FMA concept exists), with English names.
* ``conventional_part_of.txt``-- containment hierarchy ("X part of Y")
                                 between BP3D models, the hierarchy shown by
                                 the official BP3D viewer.
* ``FMA.csv``                 -- the Foundational Model of Anatomy is_a
                                 ontology (104k+ concepts) as used by BP3D,
                                 used to resolve names for concepts without
                                 meshes and to classify parts into systems.
"""
from __future__ import annotations

import csv
import re
from dataclasses import dataclass, field
from pathlib import Path

from . import config


# ---------------------------------------------------------------------------
# Keyword classification used as a *fallback* for concepts that do not carry
# an explicit override in config. Rules are ordered: first match wins, so the
# most specific anatomy language comes first (e.g. "papillary muscle of right
# ventricle" must classify as cardiovascular, not muscular).
# ---------------------------------------------------------------------------

_CLASSIFICATION_RULES: list[tuple[str, re.Pattern[str]]] = [
    ("circulatory", re.compile(
        r"\bheart\b|cardiac|coronary|ventricle|atrium|atrial|aorta\b|aortic|"
        r"vena cava|pulmonary artery|pulmonary vein|\barter(y|ies)\b|"
        r"\bvein(s)?\b|venous|vasculum|papillary muscle|sinus coronarius")),
    ("nervous", re.compile(
        r"\bnerve\b|\bnerves\b|neural|neuraxis|spinal cord|\bbrain\b|"
        r"cerebr|cerebell|\bmedulla oblongata\b|\bpons\b|\bmidbrain\b|"
        r"thalamus|hypothalamus|epithalamus|amygdala|hippocamp|caudate|"
        r"putamen|globus pallidus|fornix|\bmeninges\b|\bganglion\b|plexus")),
    ("skeletal", re.compile(
        r"\bbone\b|\bbones\b|\brib\b|\bribs\b|\bvertebr|cartilage|\bskull\b|"
        r"\bcranium\b|mandible|maxilla|\bsternum\b|\bclavicle\b|\bscapula\b|"
        r"\bhumerus\b|\bradius\b|\bulna\b|\bfemur\b|\bpatella\b|\btibia\b|"
        r"\bfibula\b|\bmetacarpal\b|\bmetatarsal\b|\bcarpal\b|\btarsal\b|"
        r"\bhyoid\b|\bvomer\b|\bethmoid\b|\bsphenoid\b|\bsacrum\b")),
    ("muscular", re.compile(
        r"\bmuscle\b|\bmuscles\b|\bmuscular\b|\bdiaphragm\b|\btendon\b")),
    ("respiratory", re.compile(
        r"\blung\b|\blungs\b|\btrachea\b|\bbronchus\b|\bbronchi\b|\blarynx\b|"
        r"\brespiratory\b|\blaryngeal\b|\balveol")),
    ("digestive", re.compile(
        r"\bstomach\b|\besophag|\bintestine\b|\bcolon\b|\brectum\b|\bcecum\b|"
        r"\bappendix\b|\bduodenum\b|\bjejunum\b|\bileum\b|\bliver\b|"
        r"\bgallbladder\b|\bpancreas\b|\bsalivary\b|\btongue\b|\btooth\b|"
        r"\bteeth\b|\bgingiva\b|\bpalate\b|\bperitoneum\b|\bomentum\b|"
        r"\banal canal\b")),
    ("urinary", re.compile(
        r"\bkidney\b|\brenal\b|\bureter\b|\bbladder\b|\burethra\b|"
        r"\burinary\b")),
    ("reproductive", re.compile(
        r"\btestis\b|\btestes\b|\bepididymis\b|\bvas deferens\b|\bprostate\b|"
        r"\bseminal\b|\bpenis\b|\bscrotum\b|\bovary\b|\bovarian\b|\buterus\b|"
        r"\buterine\b|\bvagina\b|\breproductive\b")),
    ("endocrine", re.compile(
        r"\bthyroid gland\b|\bparathyroid\b|\badrenal\b|\bsuprarenal\b|"
        r"\bpituitary\b|\bhypophysis\b|\bendocrine\b")),
    ("lymphatic", re.compile(
        r"\bspleen\b|\bthymus\b|\blymph\b|\btonsil\b|\blymphoid\b")),
    ("integumentary", re.compile(r"\bskin\b|\bepidermis\b|\bdermis\b")),
]


@dataclass
class PartInfo:
    """A BodyParts3D model (mesh-bearing or referenced hierarchy node)."""
    id: str                    # "FMA7274" or "BP24"
    name: str                  # English name
    has_mesh: bool = False
    system_key: str | None = None
    parent_ids: list[str] = field(default_factory=list)   # containment parents


class FmaCatalog:
    """Parses and indexes the BP3D metadata distribution."""

    def __init__(self, meta_dir: Path):
        self.meta_dir = Path(meta_dir)
        self._fma_labels: dict[str, str] = {}
        self._fma_parent: dict[str, str] = {}
        self._parts: dict[str, PartInfo] = {}
        self._load_fma_csv()
        self._load_parts_list()
        self._load_part_of()
        self._resolve_names_for_unmeshed_nodes()

    # -- loading ------------------------------------------------------------

    def _load_fma_csv(self) -> None:
        path = self.meta_dir / "FMA.csv"
        with open(path, encoding="utf-8-sig", newline="") as fh:
            reader = csv.reader(fh)
            header = next(reader)
            assert header[0].strip('"') == "FMAID", f"unexpected header in {path}"
            for row in reader:
                if len(row) < 3:
                    continue
                fma_id, label, parent = (c.strip().strip('"') for c in row[:3])
                # FMA.csv stores bare numeric ids; normalize to FMAxxxxx form
                if fma_id.isdigit():
                    fma_id = f"FMA{fma_id}"
                self._fma_labels[fma_id] = label
                if parent.isdigit():
                    self._fma_parent[fma_id] = f"FMA{parent}"

    def _load_parts_list(self) -> None:
        path = self.meta_dir / "parts_list_e.txt"
        with open(path, encoding="utf-8-sig", newline="") as fh:
            reader = csv.reader(fh, delimiter="\t")
            next(reader)  # header: id \t en
            for row in reader:
                if len(row) >= 2 and row[0].strip():
                    pid = row[0].strip()
                    self._parts[pid] = PartInfo(id=pid, name=row[1].strip(), has_mesh=True)

    def _load_part_of(self) -> None:
        path = self.meta_dir / "conventional_part_of.txt"
        with open(path, encoding="utf-8-sig", newline="") as fh:
            reader = csv.reader(fh, delimiter="\t")
            next(reader)  # header: id \t name \t part id \t part name
            for row in reader:
                if len(row) < 4:
                    continue
                parent_id, _parent_name, child_id, _child_name = (c.strip() for c in row[:4])
                node = self._parts.setdefault(child_id, PartInfo(id=child_id, name=_child_name))
                node.parent_ids.append(parent_id)
                # register the parent endpoint so names resolve later
                if parent_id not in self._parts:
                    self._parts[parent_id] = PartInfo(id=parent_id, name=_parent_name)

    def _resolve_names_for_unmeshed_nodes(self) -> None:
        for node in self._parts.values():
            if not node.name and node.id in self._fma_labels:
                node.name = self._fma_labels[node.id]

    # -- accessors ----------------------------------------------------------

    def part(self, pid: str) -> PartInfo | None:
        return self._parts.get(pid)

    def meshed_parts(self) -> dict[str, PartInfo]:
        return {pid: p for pid, p in self._parts.items() if p.has_mesh}

    def name_of(self, pid: str) -> str | None:
        node = self._parts.get(pid)
        if node and node.name:
            return node.name
        return self._fma_labels.get(pid)

    def stl_path(self, pid: str, stl_dir: Path) -> Path:
        return Path(stl_dir) / f"{pid}.stl"

    # -- classification -----------------------------------------------------

    def classify(self, pid: str, name: str | None = None) -> str | None:
        """Assign an anatomical system key to a BP3D/FMA concept.

        Order: curated overrides -> ancestor chain heuristic -> keyword rules.
        """
        override = next((p.system_key for p in config.SELECTED_PARTS
                         if p.id == pid and p.system_key), None)
        if override:
            return override
        if pid in config.SYNTHETIC_PARENTS:
            return config.SYNTHETIC_PARENTS[pid]
        if pid in config.SYSTEM_FMA_IDS:
            return next(s.key for s in config.SYSTEMS if s.fma_id == pid)

        name = (name or self.name_of(pid) or "").lower()
        if not name:
            return None
        # walk up the containment/is_a chain collecting ancestor names; the
        # nearest ancestors are the most specific, so check them in order.
        candidates = [name]
        seen = {pid}
        frontier = list(self._parts.get(pid, PartInfo(pid, "")).parent_ids)
        steps = 0
        while frontier and steps < 24:
            cur = frontier.pop(0)
            if cur in seen:
                continue
            seen.add(cur)
            steps += 1
            cname = (self.name_of(cur) or "").lower()
            if cname:
                candidates.append(cname)
            node = self._parts.get(cur)
            if node:
                frontier.extend(node.parent_ids)
            if cur in self._fma_parent:
                frontier.append(self._fma_parent[cur])
        for text in candidates:
            for system_key, pattern in _CLASSIFICATION_RULES:
                if pattern.search(text):
                    return system_key
        return None

    # -- validation ---------------------------------------------------------

    def validate_selection(self, stl_dir: Path) -> list[str]:
        """Cross-checks the curated selection against the distribution.
        Returns a list of human-readable problems (empty == healthy)."""
        problems: list[str] = []
        groups = {g.key for g in config.GROUPS}
        seen: set[str] = set()
        for part in config.SELECTED_PARTS:
            if part.id in seen:
                problems.append(f"duplicate selection entry: {part.id}")
            seen.add(part.id)
            if part.group_key not in groups:
                problems.append(f"{part.id}: unknown group '{part.group_key}'")
            if part.id not in self._parts:
                problems.append(f"{part.id}: not present in parts_list_e.txt")
            elif not self._parts[part.id].has_mesh:
                problems.append(f"{part.id}: no mesh listed in parts_list_e.txt")
            stl = self.stl_path(part.id, stl_dir)
            if not stl.exists():
                problems.append(f"{part.id}: STL file missing ({stl.name})")
        for system in config.SYSTEMS:
            if system.fma_id not in self._fma_labels:
                # system roots may be referenced by part_of endpoints instead
                if system.fma_id not in self._parts:
                    problems.append(
                        f"system {system.key}: FMA id {system.fma_id} unknown "
                        f"in FMA.csv and part_of tables")
        return problems

    def verify_system_ids(self) -> list[str]:
        """Ensure the configured FMA system ids match official FMA labels."""
        expected_labels = {
            "skeletal": "skeletal system",
            "muscular": "muscle",
            "circulatory": "cardiovascular system",
            "respiratory": "respiratory system",
            "digestive": "digestive system",
            "urinary": "urinary system",
            "reproductive": "reproductive system",
            "nervous": "nervous system",
            "endocrine": "endocrine system",
            "lymphatic": "lymphatic system",
        }
        # FMA official terminology vs. friendly display names
        label_aliases = {
            "digestive system": "alimentary system",
            "reproductive system": "genital system",
            "lymphatic system": "lymphoid system",
        }
        problems = []
        for system in config.SYSTEMS:
            label = self._fma_labels.get(system.fma_id, "").lower()
            want = expected_labels[system.key]
            aliases = {want, label_aliases.get(want, want)}
            if label not in aliases:
                problems.append(
                    f"system {system.key}: FMA {system.fma_id} is '{label or '?'}', "
                    f"expected '{want}'")
        return problems
