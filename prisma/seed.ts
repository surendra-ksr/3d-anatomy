/**
 * Seed the PostgreSQL database from the pipeline manifest.
 *
 *   npm run db:seed
 *
 * Idempotent: systems/organs/mesh-assets are upserted by their FMA ids, so
 * re-running after a pipeline rebuild only touches what changed. Organs are
 * inserted parents-first (topological order) so self-relations resolve.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

interface ManifestOrgan {
  fmaId: string;
  name: string;
  systemKey: string;
  parentFmaId: string | null;
  hasMesh: boolean;
  laterality: string;
}
interface ManifestMesh {
  fmaId: string;
  url: string;
  nodePath: string;
  groupKey: string;
  byteSize: number;
  compressedByteSize: number;
  vertexCount: number;
  triangleCount: number;
  sourceFile: string;
  sourceSha256: string;
}
interface Manifest {
  meta: Record<string, unknown>;
  systems: { fmaId: string; key: string; name: string; color: string; order: number }[];
  groups: { key: string; label: string; systemKey: string; order: number; defaultVisible: boolean; url: string; byteSize: number; triangleCount: number }[];
  organs: ManifestOrgan[];
  meshAssets: ManifestMesh[];
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set. Run scripts/dev.sh or export it manually.");
  process.exit(1);
}

const manifestPath = resolve(process.cwd(), "public/models/manifest.json");
const manifest: Manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const adapter = new PrismaPg({ connectionString, max: 4 });
const prisma = new PrismaClient({ adapter });

const LATERALITY = new Set(["LEFT", "RIGHT", "MIDLINE", "PAIRED"]);
const laterality = (raw: string) =>
  (LATERALITY.has(raw) ? raw : "MIDLINE") as "LEFT" | "RIGHT" | "MIDLINE" | "PAIRED";

async function main() {
  console.log(`seeding from ${manifestPath}`);
  console.log(`dataset: ${JSON.stringify(manifest.meta.dataset)} ${manifest.meta.datasetVersion}`);

  // -- systems -------------------------------------------------------------
  const systemIdByKey = new Map<string, number>();
  for (const s of manifest.systems) {
    const row = await prisma.anatomicalSystem.upsert({
      where: { fmaId: s.fmaId },
      create: { fmaId: s.fmaId, key: s.key, name: s.name, color: s.color, sortOrder: s.order },
      update: { key: s.key, name: s.name, color: s.color, sortOrder: s.order },
    });
    systemIdByKey.set(s.key, row.id);
  }
  console.log(`systems: ${manifest.systems.length}`);

  // -- organs, parents first ------------------------------------------------
  const byParent = new Map<string | null, ManifestOrgan[]>();
  for (const o of manifest.organs) {
    const list = byParent.get(o.parentFmaId) ?? [];
    list.push(o);
    byParent.set(o.parentFmaId, list);
  }
  const organIdByFma = new Map<string, number>();

  // Multi-pass insert: each pass upserts every organ whose parent is already
  // stored, so containment chains (ventricle -> heart -> system) resolve no
  // matter how they are ordered in the manifest. A cycle would stall the loop,
  // so bail out if a pass stops making progress.
  let pending = [...manifest.organs];
  let processed = 0;
  while (pending.length > 0) {
    const next: ManifestOrgan[] = [];
    for (const organ of pending) {
      if (organIdByFma.has(organ.fmaId)) continue;
      const parentId = organ.parentFmaId
        ? organIdByFma.get(organ.parentFmaId)
        : undefined;
      if (organ.parentFmaId && !parentId) {
        next.push(organ);
        continue;
      }
      const mesh = manifest.meshAssets.find((m) => m.fmaId === organ.fmaId);
      const row = await prisma.organ.upsert({
        where: { fmaId: organ.fmaId },
        create: {
          fmaId: organ.fmaId,
          bp3dId: mesh && mesh.nodePath !== organ.fmaId ? mesh.nodePath : null,
          name: organ.name,
          laterality: laterality(organ.laterality),
          systemId: systemIdByKey.get(organ.systemKey)!,
          parentId: parentId ?? null,
        },
        update: {
          name: organ.name,
          laterality: laterality(organ.laterality),
          systemId: systemIdByKey.get(organ.systemKey)!,
          parentId: parentId ?? null,
        },
      });
      organIdByFma.set(organ.fmaId, row.id);
      processed += 1;
    }
    if (next.length === pending.length) {
      throw new Error(
        `hierarchy stalled; unresolved parents for: ${next
          .slice(0, 5)
          .map((o) => `${o.fmaId} (parent ${o.parentFmaId})`)
          .join(", ")}`,
      );
    }
    pending = next;
  }
  console.log(`organs: ${processed}`);

  // -- mesh assets -----------------------------------------------------------
  let meshes = 0;
  for (const m of manifest.meshAssets) {
    const organId = organIdByFma.get(m.fmaId);
    if (!organId) throw new Error(`mesh ${m.fmaId} has no organ row`);
    await prisma.meshAsset.upsert({
      where: { organId },
      create: {
        organId,
        url: m.url,
        nodePath: m.nodePath,
        groupKey: m.groupKey,
        byteSize: m.compressedByteSize,
        vertexCount: m.vertexCount,
        triangleCount: m.triangleCount,
        sourceFile: m.sourceFile,
        sourceSha256: m.sourceSha256,
      },
      update: {
        url: m.url,
        nodePath: m.nodePath,
        groupKey: m.groupKey,
        byteSize: m.compressedByteSize,
        vertexCount: m.vertexCount,
        triangleCount: m.triangleCount,
        sourceFile: m.sourceFile,
        sourceSha256: m.sourceSha256,
      },
    });
    meshes += 1;
  }
  console.log(`mesh assets: ${meshes}`);

  // -- default user (single-profile MVP; see model comment in schema) -------
  const userName = process.env.ANATOMY_DEFAULT_USER ?? "you";
  await prisma.user.upsert({
    where: { name: userName },
    create: { name: userName },
    update: {},
  });
  console.log(`user: ${userName}`);

  const counts = await prisma.$transaction([
    prisma.anatomicalSystem.count(),
    prisma.organ.count(),
    prisma.meshAsset.count(),
  ]);
  console.log(`done: ${counts[0]} systems / ${counts[1]} organs / ${counts[2]} meshes`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
