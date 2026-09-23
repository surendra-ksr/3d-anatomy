#!/usr/bin/env python3
"""
Sync WebGL mesh assets to S3 (fronted by CloudFront) for production delivery.

Uploads public/models/*.glb + manifest.json and public/draco/** (the Draco
decoder) with WebGL-appropriate Content-Type and Cache-Control headers:

  .glb        model/gltf-binary       immutable (content-addressed by name)
  .json       application/json         short TTL (manifest rotates)
  .js/.mjs    application/javascript   immutable (decoder bundles)
  .wasm       application/wasm         immutable (decoder)
  .css        text/css                 immutable

Usage:
  python3 scripts/upload_assets.py --bucket my-bucket [--prefix assets] \
      [--distribution-id E1234ABCDEF] [--delete] [--dry-run]

Env: AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION (or a profile).
If --distribution-id is given, a CloudFront invalidation is created for the
uploaded keys so the CDN picks up new manifests immediately.
"""
from __future__ import annotations

import argparse
import fnmatch
import hashlib
import mimetypes
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SOURCE_DIRS = [REPO / "public" / "models", REPO / "public" / "draco"]

CONTENT_TYPES = {
    ".glb": "model/gltf-binary",
    ".json": "application/json",
    ".js": "application/javascript",
    ".mjs": "application/javascript",
    ".wasm": "application/wasm",
    ".css": "text/css",
    ".html": "text/html; charset=utf-8",
}

#: immutable long cache for content-addressed artifacts; manifest.json gets a
#: short TTL so a re-published dataset rolls out quickly.
IMMUTABLE = "public, max-age=31536000, immutable"
MANIFEST_CACHE = "public, max-age=300, must-revalidate"


def cache_control_for(key: str) -> str:
    return MANIFEST_CACHE if key.endswith("manifest.json") else IMMUTABLE


def content_type_for(path: Path) -> str:
    return CONTENT_TYPES.get(
        path.suffix.lower(), mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    )


def collect_files(exclude_globs: list[str]) -> list[tuple[Path, str]]:
    out: list[tuple[Path, str]] = []
    for base in SOURCE_DIRS:
        if not base.is_dir():
            print(f"[warn] missing source dir: {base}", file=sys.stderr)
            continue
        for path in sorted(base.rglob("*")):
            if not path.is_file():
                continue
            rel = path.relative_to(base.parent).as_posix()  # models/... | draco/...
            if any(fnmatch.fnmatch(rel, g) for g in exclude_globs):
                continue
            out.append((path, rel))
    return out


def etag_of(path: Path) -> str:
    """S3-style ETag for a plain (non-multipart) upload."""
    data = path.read_bytes()
    return f'"{hashlib.md5(data).hexdigest()}"'


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--bucket", required=True, help="S3 bucket name")
    ap.add_argument("--prefix", default="", help="key prefix inside the bucket (no leading/trailing slash)")
    ap.add_argument("--distribution-id", default=None,
                    help="CloudFront distribution id to invalidate after upload")
    ap.add_argument("--exclude", action="append", default=[],
                    help="glob to skip (relative to public/, repeatable)")
    ap.add_argument("--delete", action="store_true",
                    help="delete remote keys that no longer exist locally")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    try:
        import boto3
    except ImportError:
        print("boto3 is required: pip install boto3", file=sys.stderr)
        return 2

    s3 = boto3.client("s3")
    prefix = f"{args.prefix.strip('/')}/" if args.prefix.strip("/") else ""
    files = collect_files(args.exclude)
    if not files:
        print("nothing to upload", file=sys.stderr)
        return 1

    uploaded = 0
    for path, rel in files:
        key = f"{prefix}{rel}"
        head = None
        try:
            head = s3.head_object(Bucket=args.bucket, Key=key)
        except head.meta.client.exceptions.ClientError:
            pass
        except Exception:
            pass
        etag = etag_of(path)
        if head and head.get("ETag") == etag:
            continue  # unchanged
        extra = {
            "ContentType": content_type_for(path),
            "CacheControl": cache_control_for(key),
        }
        if args.dry_run:
            print(f"[dry-run] {key}  ({path.stat().st_size} B, {extra['ContentType']})")
        else:
            s3.upload_file(str(path), args.bucket, key, ExtraArgs=extra)
            print(f"uploaded {key}  ({path.stat().st_size} B, {extra['ContentType']})")
        uploaded += 1

    if args.delete and not args.dry_run:
        paginator = s3.get_paginator("list_objects_v2")
        local_keys = {f"{prefix}{rel}" for _, rel in files}
        stale: list[dict] = []
        for page in paginator.paginate(Bucket=args.bucket, Prefix=prefix):
            for obj in page.get("Contents", []):
                if obj["Key"] not in local_keys:
                    stale.append({"Key": obj["Key"]})
        if stale:
            s3.delete_objects(Bucket=args.bucket, Delete={"Objects": stale})
            print(f"deleted {len(stale)} stale key(s)")

    if args.distribution_id and not args.dry_run and uploaded:
        cf = boto3.client("cloudfront")
        paths = [f"/{prefix}*"]
        res = cf.create_invalidation(
            DistributionId=args.distribution_id,
            InvalidationBatch={"Paths": {"Quantity": len(paths), "Items": paths}},
        )
        print(f"invalidation created: {res['Invalidation']['Id']}")

    print(f"done — {uploaded} object(s) {'would be ' if args.dry_run else ''}uploaded to s3://{args.bucket}/{prefix}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
