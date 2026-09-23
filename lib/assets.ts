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
