import { NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { resolveAssetUrl } from "@/lib/assets";
import type { AnatomyTreeResponse, OrganNodeDto, SystemTreeDto } from "@/lib/types";

export const dynamic = "force-dynamic";

interface OrganRow {
  id: number;
  fmaId: string;
  bp3dId: string | null;
  name: string;
  laterality: "LEFT" | "RIGHT" | "MIDLINE" | "PAIRED";
  systemId: number;
  parentId: number | null;
  mesh: {
    url: string;
    nodePath: string;
    groupKey: string;
    format: string;
    compression: string;
    byteSize: number;
    vertexCount: number;
    triangleCount: number;
    sourceDataset: string;
  } | null;
}

function buildNode(row: OrganRow, byParent: Map<number | null, OrganRow[]>): OrganNodeDto {
  const kids = byParent.get(row.id) ?? [];
  return {
    id: row.id,
    fmaId: row.fmaId,
    bp3dId: row.bp3dId,
    name: row.name,
    laterality: row.laterality,
    hasMesh: row.mesh !== null,
    mesh: row.mesh
      ? {
          ...row.mesh,
          url: resolveAssetUrl(row.mesh.url),
        }
      : null,
    children: kids
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((child) => buildNode(child, byParent)),
  };
}

/**
 * GET /api/anatomy/tree
 *
 * The full anatomical hierarchy (systems -> organs -> sub-organ) with mesh
 * delivery info, consumed by the LayerTree component.
 */
export async function GET() {
  const [systems, organRows, groupRows] = await Promise.all([
    prisma.anatomicalSystem.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.organ.findMany({
      include: {
        mesh: {
          select: {
            url: true,
            nodePath: true,
            groupKey: true,
            format: true,
            compression: true,
            byteSize: true,
            vertexCount: true,
            triangleCount: true,
            sourceDataset: true,
          },
        },
      },
    }),
    // delivery groups mirror the pipeline manifest; expose them per system
    prisma.meshAsset.findMany({
      select: { groupKey: true, organ: { select: { systemId: true } } },
      distinct: ["groupKey"],
    }),
  ]);

  const byParent = new Map<number | null, OrganRow[]>();
  for (const row of organRows) {
    const list = byParent.get(row.parentId) ?? [];
    list.push(row);
    byParent.set(row.parentId, list);
  }

  const groupKeyBySystem = new Map<number, Set<string>>();
  for (const g of groupRows) {
    const set = groupKeyBySystem.get(g.organ.systemId) ?? new Set<string>();
    set.add(g.groupKey);
    groupKeyBySystem.set(g.organ.systemId, set);
  }

  const tree: SystemTreeDto[] = systems.map((system) => {
    const roots = (byParent.get(null) ?? [])
      .filter((row) => row.systemId === system.id)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((row) => buildNode(row, byParent));
    return {
      fmaId: system.fmaId,
      key: system.key,
      name: system.name,
      color: system.color,
      sortOrder: system.sortOrder,
      groupKeys: [...(groupKeyBySystem.get(system.id) ?? [])].sort(),
      organCount: organRows.filter((r) => r.systemId === system.id).length,
      roots,
    };
  });

  const body: AnatomyTreeResponse = {
    systems: tree,
    meta: {
      dataset: "BodyParts3D",
      datasetVersion: "3.0",
      ontology: "Foundational Model of Anatomy (FMA)",
      license: "CC BY-SA 2.1 JP",
      rightsHolder: "Database Center for Life Science (DBCLS), Japan",
      site: "https://lifesciencedb.jp/bp3d/",
    },
  };
  return NextResponse.json(body);
}
