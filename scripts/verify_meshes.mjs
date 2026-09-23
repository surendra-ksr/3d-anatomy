// Real end-to-end decode of every Draco-compressed GLB with draco3d WASM
import { NodeIO } from '@gltf-transform/core';
import { KHRDracoMeshCompression } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import { readdirSync } from 'node:fs';

const io = new NodeIO()
  .registerExtensions([KHRDracoMeshCompression])
  .registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
  });

let totalParts = 0, totalTris = 0, totalVerts = 0;
for (const file of readdirSync('public/models').filter((f) => f.endsWith('.glb'))) {
  const doc = await io.read(`public/models/${file}`);
  const root = doc.getRoot();
  const nodes = root.listNodes();
  let parts = 0, tris = 0, verts = 0, withExtras = 0;
  for (const node of nodes) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    parts += 1;
    for (const prim of mesh.listPrimitives()) {
      verts += prim.listAttributes()[0].getCount();
      tris += prim.getIndices().getCount() / 3;
    }
    const extras = node.getExtras();
    if (extras && extras.fmaId) withExtras += 1;
  }
  totalParts += parts; totalTris += tris; totalVerts += verts;
  console.log(`${file.padEnd(18)} nodes=${String(parts).padStart(3)} tris=${Math.round(tris).toLocaleString().padStart(9)} extras=${withExtras}/${parts}`);
}
console.log(`\nALL GROUPS DECODED: ${totalParts} parts, ${Math.round(totalVerts).toLocaleString()} verts, ${Math.round(totalTris).toLocaleString()} triangles`);
