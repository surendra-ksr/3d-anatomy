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

// ---------------------------------------------------------------------------
// Longitudinal analytics (Extension 2)
// ---------------------------------------------------------------------------

export interface PainLogDto {
  fmaId: string;
  intensity: number;
  note: string | null;
  logDate: string;
  timestamp: string;
}

export interface ActivityLogDto {
  id?: number;
  fmaIds: string[];
  minutes: number;
  severity: string;
  energyDrain: number;
  totalKcal: number;
  logDate: string;
  createdAt?: string;
}

export interface DailyDayDto {
  date: string;
  painAvg: number | null;
  painMax: number | null;
  painLogCount: number;
  energyDrain: number | null;
  totalKcal: number | null;
  activityCount: number;
}

export interface PemLagDto {
  byLag: { lagDays: number; pearsonR: number | null; pairs: number }[];
  bestLagDays: number | null;
  pearsonAtBest: number | null;
  daysWithPairedData: number;
  interpretation: string;
}

export interface DailyAnalyticsResponse {
  range: number;
  days: DailyDayDto[];
  pem: PemLagDto;
  summary: {
    daysWithLogs: number;
    daysWithActivity: number;
    totalPainLogs: number;
    totalActivities: number;
  };
}

export interface ClusterSideDto {
  fmaId: string;
  label: string;
}

export interface ClusterRuleDto {
  antecedent: ClusterSideDto;
  consequent: ClusterSideDto;
  confidence: number;
  reverseConfidence: number;
  support: number;
  lift: number;
  statement: string;
}

export interface RegionClusterDto {
  members: string[];
  support: number;
  shareOfFlareDays: number;
}

export interface ClustersResponse {
  pairRules: ClusterRuleDto[];
  regionClusters: RegionClusterDto[];
  summary: {
    windowDays: number;
    daysWithFlares: number;
    logRowsAnalyzed: number;
    structuresTracked?: number;
    minIntensity: number;
    minSupport: number;
  };
  note?: string;
  model: Record<string, unknown>;
  references: string[];
  disclaimer: string;
}
