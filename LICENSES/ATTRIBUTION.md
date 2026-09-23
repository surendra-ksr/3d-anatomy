# Attribution & Licenses

## Anatomical data — BodyParts3D / Anatomography

This application ships 3D mesh data from **BodyParts3D**, © Database Center
for Life Science (DBCLS), licensed under **Creative Commons Attribution-Share
Alike 2.1 Japan** (CC BY-SA 2.1 JP).

* Site: https://lifesciencedb.jp/bp3d/
* License: https://creativecommons.org/licenses/by-sa/2.1/jp/deed.en
* Version used: BodyParts3D 3.0 (2013-04-11 release), including
  `parts_list_e.txt`, `conventional_part_of.txt` and the FMA ontology table
  `FMA.csv` distributed with it (kept unmodified in `pipeline/data/meta/`).

You are free to share and adapt the material, provided you attribute DBCLS and
distribute derived data under the same license. This repository satisfies
attribution through this file and the visible credits in the application UI.

If you use this project, credit as follows:

> BodyParts3D, [DBCLS], licensed under CC BY-SA 2.1 JP
> https://lifesciencedb.jp/bp3d/

## Ontology — Foundational Model of Anatomy (FMA)

Structures are identified by their FMA concept ids as published by the
Structural Informatics Group, University of Washington
(http://sig.biostr.washington.edu/projects/fm/AboutFM.html), as distributed
inside the BodyParts3D package (tree version FMA 3.2.1-inference).

## Tools

* glTF/Draco compression: `gltf-pipeline` (Apache-2.0, Cesium GS)
* Decimation: `fast-simplification` (MIT)
* Mesh I/O: `trimesh` (MIT)
* Rendering: three.js (MIT), @react-three/fiber + drei (MIT)

## Application code

MIT — see LICENSE.
