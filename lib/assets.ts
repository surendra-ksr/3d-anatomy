/**
 * Mesh asset URL resolution.
 *
 * MeshAssets store a relative URL (/models/circulatory.glb). In production the
 * files live on object storage; set MESH_ASSET_BASE_URL (server-side) or
 * NEXT_PUBLIC_ASSET_BASE_URL (client-side) to an S3/CloudFront/GCS base and
 * every URL served by the API is resolved against it.
 */
export function resolveAssetUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const base =
    process.env.MESH_ASSET_BASE_URL ??
    process.env.NEXT_PUBLIC_ASSET_BASE_URL ??
    "";
  return base ? `${base.replace(/\/$/, "")}/${url.replace(/^\//, "")}` : url;
}

/**
 * Client-side asset resolution (safe in browser bundles: only reads
 * NEXT_PUBLIC_* envs, which Next.js inlines at build time).
 *
 * - NEXT_PUBLIC_MESH_ASSET_BASE_URL always wins (e.g. set to the CloudFront
 *   distribution URL in the production image build).
 * - Otherwise, when NODE_ENV === "production", assets fall back to
 *   MESH_ASSET_BASE_URL — which the production Docker/ECS build forwards to
 *   NEXT_PUBLIC_MESH_ASSET_BASE_URL — so GLBs stream from S3/CloudFront.
 * - Development serves everything locally from /public.
 */
export function assetUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const cdn =
    process.env.NEXT_PUBLIC_MESH_ASSET_BASE_URL ??
    (process.env.NODE_ENV === "production"
      ? process.env.NEXT_PUBLIC_ASSET_CDN_URL ?? ""
      : "");
  if (!cdn) return url;
  return `${cdn.replace(/\/$/, "")}/${url.replace(/^\//, "")}`;
}
