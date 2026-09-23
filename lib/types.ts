/** Shared API contracts between the Next.js/FastAPI backends and the UI. */

export interface SystemDto {
  fmaId: string;
  key: string;
  name: string;
  color: string;
  sortOrder: number;
}

export interface GroupDto {
  key: string;
  label: string;
  systemKey: string;
  order: number;
  defaultVisible: boolean;
  url: string;
  byteSize: number;
  triangleCount: number;
}

export interface MeshAssetDto {
  url: string;
  nodePath: string;
  groupKey: string;
  format: string;
  compression: string;
  byteSize: number;
  vertexCount: number;
  triangleCount: number;
  sourceDataset: string;
}

export interface OrganNodeDto {
  id: number;
  fmaId: string;
  bp3dId: string | null;
  name: string;
  laterality: "LEFT" | "RIGHT" | "MIDLINE" | "PAIRED";
  hasMesh: boolean;
  mesh: MeshAssetDto | null;
  children: OrganNodeDto[];
}

export interface SystemTreeDto extends SystemDto {
  groupKeys: string[];
  organCount: number;
  roots: OrganNodeDto[];
}

export interface AnatomyTreeResponse {
  systems: SystemTreeDto[];
  meta: DatasetMetaDto;
}

export interface DatasetMetaDto {
  dataset: string;
  datasetVersion: string;
  ontology: string;
  license: string;
  rightsHolder: string;
  site: string;
}

export interface OrganDetailDto {
  id: number;
  fmaId: string;
  bp3dId: string | null;
  name: string;
  laterality: string;
  system: SystemDto;
  parent: { fmaId: string; name: string } | null;
  children: { fmaId: string; name: string; hasMesh: boolean }[];
  mesh: MeshAssetDto | null;
  ontologyLinks: { label: string; url: string }[];
}

export const fmaOntologyLinks = (fmaId: string) => {
  const numeric = fmaId.replace(/^FMA/i, "").replace(/nsn$/, "");
  return [
    {
      label: "FMA Ontology (OLS)",
      url: `https://www.ebi.ac.uk/ols4/ontologies/fma/terms?iri=http%3A%2F%2Fpurl.obolibrary.org%2Fobo%2FFMA_${numeric}`,
    },
    {
      label: "BodyParts3D",
      url: `https://lifesciencedb.jp/bp3d/?lng=en#${fmaId}`,
    },
  ];
};
