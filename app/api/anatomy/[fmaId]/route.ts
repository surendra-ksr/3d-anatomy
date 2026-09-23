import { NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { resolveAssetUrl } from "@/lib/assets";
import { fmaOntologyLinks, type OrganDetailDto } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/anatomy/[fmaId]
 *
 * Metadata for one anatomical part by FMA id (e.g. FMA7274 - wall of heart):
 * taxonomy (system, parent, children) plus the Draco mesh asset URL and node
 * path for on-demand loading.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ fmaId: string }> },
) {
  const { fmaId } = await params;
  const decoded = decodeURIComponent(fmaId).trim().toUpperCase();
  const normalized = decoded.startsWith("FMA") ? decoded : `FMA${decoded}`;

  const organ = await prisma.organ.findUnique({
    where: { fmaId: normalized },
    include: {
      system: true,
      parent: { select: { fmaId: true, name: true } },
      children: {
        select: { fmaId: true, name: true, mesh: { select: { id: true } } },
        orderBy: { name: "asc" },
      },
      mesh: true,
    },
  });

  if (!organ) {
    return NextResponse.json(
      {
        error: "anatomical part not found",
        fmaId: normalized,
        hint: "Browse /api/anatomy/tree for available concepts.",
      },
      { status: 404 },
    );
  }

  const dto: OrganDetailDto = {
    id: organ.id,
    fmaId: organ.fmaId,
    bp3dId: organ.bp3dId,
    name: organ.name,
    laterality: organ.laterality,
    system: {
      fmaId: organ.system.fmaId,
      key: organ.system.key,
      name: organ.system.name,
      color: organ.system.color,
      sortOrder: organ.system.sortOrder,
    },
    parent: organ.parent,
    children: organ.children.map((c) => ({
      fmaId: c.fmaId,
      name: c.name,
      hasMesh: c.mesh !== null,
    })),
    mesh: organ.mesh
      ? {
          url: resolveAssetUrl(organ.mesh.url),
          nodePath: organ.mesh.nodePath,
          groupKey: organ.mesh.groupKey,
          format: organ.mesh.format,
          compression: organ.mesh.compression,
          byteSize: organ.mesh.byteSize,
          vertexCount: organ.mesh.vertexCount,
          triangleCount: organ.mesh.triangleCount,
          sourceDataset: organ.mesh.sourceDataset,
        }
      : null,
    ontologyLinks: fmaOntologyLinks(organ.fmaId),
  };

  return NextResponse.json(dto);
}
