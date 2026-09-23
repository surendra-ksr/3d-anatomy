"""
Acquisition of the BodyParts3D distribution.

Resolution order (first available wins):

1. ``--source`` / ``BP3D_SOURCE_DIR``  - an already-downloaded copy of the
   official ``bodyparts3d`` archive layout (``parts_list_e.txt``,
   ``conventional_part_of.txt``, ``FMA.csv``, ``stl/*.stl``).
2. Official download CGI at lifesciencedb.jp (the canonical DBCLS service).
3. The official Life Science Database Archive (biosciencedbc.jp) batch zips.
4. A sparse clone of the public Git mirror of the identical 3.0 distribution
   (used in network-restricted environments).

Every path yields the same version-stamped dataset, so the rest of the
pipeline is agnostic to the origin.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from . import config

META_FILES = [
    "parts_list_e.txt",
    "conventional_part_of.txt",
    "FMA.csv",
    "LICENSE_content",
    "README_e.html",
]

MIRROR_TREE_PATH = "assets/BodyParts3D_data"


@dataclass
class Source:
    kind: str          # "local" | "official" | "archive" | "mirror"
    meta_dir: Path
    stl_dir: Path | None


class FetchError(RuntimeError):
    pass


# ---------------------------------------------------------------------------
# 1. local pre-seeded source
# ---------------------------------------------------------------------------

def _try_local(source_dir: str) -> Source | None:
    root = Path(source_dir).expanduser()
    if not root.exists():
        return None
    meta_dir = root
    stl_dir = None
    # the Git mirror nests everything under assets/BodyParts3D_data/
    nested = root / MIRROR_TREE_PATH
    if nested.exists():
        meta_dir = nested
    if (meta_dir / "parts_list_e.txt").exists():
        cand_stl = meta_dir / "stl"
        if cand_stl.exists() and any(cand_stl.glob("*.stl")):
            stl_dir = cand_stl
        return Source(kind="local", meta_dir=meta_dir, stl_dir=stl_dir)
    return None


# ---------------------------------------------------------------------------
# 2./3. official remote channels
# ---------------------------------------------------------------------------

def _http_get(url: str, dest: Path, timeout: int = 60) -> bool:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "anatomy-engine-pipeline/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as resp, open(dest, "wb") as fh:
            shutil.copyfileobj(resp, fh)
        return True
    except Exception:
        return False


def _reachable(url: str, timeout: int = 8) -> bool:
    try:
        req = urllib.request.Request(url, method="HEAD",
                                     headers={"User-Agent": "anatomy-engine-pipeline/1.0"})
        urllib.request.urlopen(req, timeout=timeout)
        return True
    except Exception:
        return False


def _try_official(work_dir: Path) -> Source | None:
    """Canonical per-file download from the BP3D CGI service."""
    if not _reachable(config.BP3D_SITE):
        return None
    meta_dir = work_dir / "bp3d-official"
    meta_dir.mkdir(parents=True, exist_ok=True)
    ok = True
    for name in META_FILES:
        dest = meta_dir / name
        if dest.exists():
            continue
        url = f"{config.BP3D_DOWNLOAD}/{name}"
        if not _http_get(url, dest):
            ok = False
            break
    if not ok:
        return None
    stl_dir = meta_dir / "stl"
    stl_dir.mkdir(exist_ok=True)
    print("[sources] official BP3D channel available; STL files will be "
          f"downloaded per-part from {config.BP3D_CGI} on demand")
    return Source(kind="official", meta_dir=meta_dir, stl_dir=stl_dir)


def _try_archive(work_dir: Path) -> Source | None:
    """Batch zips published on the official Life Science Database Archive."""
    base = config.BP3D_ARCHIVE
    if not _reachable(f"{base}/"):
        return None
    meta_dir = work_dir / "bp3d-archive"
    meta_dir.mkdir(parents=True, exist_ok=True)
    import zipfile

    name = "parts_list_e.zip"
    dest = meta_dir / name
    if not dest.exists() and not _http_get(f"{base}/{name}", dest):
        return None
    try:
        with zipfile.ZipFile(dest) as zf:
            zf.extractall(meta_dir)
    except Exception:
        return None
    if not (meta_dir / "parts_list_e.txt").exists():
        return None
    print(f"[sources] official archive channel available at {base}; "
          "fetch per-structure zips on demand")
    return Source(kind="archive", meta_dir=meta_dir, stl_dir=None)


# ---------------------------------------------------------------------------
# 4. git mirror fallback
# ---------------------------------------------------------------------------

def _try_mirror(work_dir: Path) -> Source | None:
    mirror_dir = work_dir / "bp3d-mirror"
    git_dir = mirror_dir / ".git"
    env = dict(os.environ, GIT_TERMINAL_PROMPT="0")
    if not (mirror_dir.exists() and git_dir.exists()):
        mirror_dir.mkdir(parents=True, exist_ok=True)
        print(f"[sources] cloning BP3D mirror (partial clone): {config.BP3D_GITHUB_MIRROR}")
        r = subprocess.run(
            ["git", "clone", "--filter=blob:none", "--no-checkout", "--depth", "1",
             config.BP3D_GITHUB_MIRROR, str(mirror_dir)],
            capture_output=True, text=True, env=env)
        if r.returncode != 0:
            print(r.stderr.strip(), file=sys.stderr)
            return None
    def git(*args: str) -> bool:
        r = subprocess.run(["git", "-C", str(mirror_dir), *args],
                           capture_output=True, text=True, env=env)
        if r.returncode != 0:
            print(r.stderr.strip(), file=sys.stderr)
            return False
        return True

    meta = f"{MIRROR_TREE_PATH}"
    if not git("sparse-checkout", "set", "--skip-checks",
               f"{meta}/parts_list_e.txt", f"{meta}/conventional_part_of.txt",
               f"{meta}/FMA.csv", f"{meta}/LICENSE_content", f"{meta}/README_e.html"):
        return None
    meta_dir = mirror_dir / meta
    if not (meta_dir / "parts_list_e.txt").exists():
        return None
    return Source(kind="mirror", meta_dir=meta_dir, stl_dir=None)


def ensure_stl_file(source: Source, part_id: str, dest_dir: Path) -> Path:
    """Fetch a single STL through the active source into ``dest_dir``."""
    dest = dest_dir / f"{part_id}.stl"
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    dest_dir.mkdir(parents=True, exist_ok=True)

    # mirror: materialize via sparse-checkout (blobs are fetched on demand)
    if source.kind == "mirror":
        rel = f"{MIRROR_TREE_PATH}/stl/{part_id}.stl"
        env = dict(os.environ, GIT_TERMINAL_PROMPT="0")
        r = subprocess.run(
            ["git", "-C", str(source.meta_dir.parent), "sparse-checkout", "add",
             "--skip-checks", rel],
            capture_output=True, text=True, env=env)
        if r.returncode != 0:
            raise FetchError(f"mirror checkout failed for {part_id}: {r.stderr.strip()}")
        src_file = source.meta_dir / "stl" / f"{part_id}.stl"
        if src_file.exists():
            shutil.copyfile(src_file, dest)
            return dest
        raise FetchError(f"mirror has no STL for {part_id}")

    # official CGI: batch download endpoint documented by DBCLS
    if source.kind in ("official", "archive"):
        url = (f"{config.BP3D_CGI}?ids[]={part_id}&type=art_file&all_downloads=1")
        if _http_get(url, dest.with_suffix(".zip"), timeout=120):
            import zipfile
            try:
                with zipfile.ZipFile(dest.with_suffix(".zip")) as zf:
                    members = [m for m in zf.namelist()
                               if re.fullmatch(rf"{re.escape(part_id)}(_9[59])?\.stl", m)]
                    if not members:
                        raise FetchError(f"official channel returned no {part_id}.stl")
                    with zf.open(members[0]) as src, open(dest, "wb") as out:
                        shutil.copyfileobj(src, out)
                dest.with_suffix(".zip").unlink(missing_ok=True)
                return dest
            except zipfile.BadZipFile:
                dest.with_suffix(".zip").unlink(missing_ok=True)

    raise FetchError(f"unable to obtain {part_id}.stl from source '{source.kind}'")


# ---------------------------------------------------------------------------

def resolve_source(cli_source: str | None, work_dir: Path) -> Source:
    candidates: list[Source] = []
    source_dir = cli_source or os.environ.get("BP3D_SOURCE_DIR")
    if source_dir:
        src = _try_local(source_dir)
        if src:
            return src
        print(f"[sources] warning: --source {source_dir} is not a BP3D dir; "
              "falling back to remote sources")
    work_dir.mkdir(parents=True, exist_ok=True)
    for fn in (_try_local_repo, _try_official, _try_archive, _try_mirror):
        src = fn(work_dir)
        if src:
            print(f"[sources] using source: {src.kind} ({src.meta_dir})")
            return src
    raise FetchError(
        "No BodyParts3D source available. Provide --source pointing at an "
        "unpacked BP3D distribution, or allow network access to "
        "lifesciencedb.jp / dbarchive.biosciencedbc.jp / github.com.")


def _try_local_repo(work_dir: Path) -> Source | None:
    """The repository may carry the metadata in pipeline/data/meta."""
    repo_meta = Path(__file__).resolve().parent.parent / "data" / "meta"
    if (repo_meta / "parts_list_e.txt").exists():
        stl_dir = None
        repo_stl = repo_meta / "stl"
        if repo_stl.exists() and any(repo_stl.glob("*.stl")):
            stl_dir = repo_stl
        return Source(kind="local", meta_dir=repo_meta, stl_dir=stl_dir)
    return None
