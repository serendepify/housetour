export const PIPELINE_STAGES = [
  { id: "ingest", label: "Ingest & validate assets", weight: 8 },
  { id: "features", label: "Feature extraction", weight: 14 },
  { id: "match", label: "Image matching", weight: 14 },
  { id: "sparse", label: "Sparse reconstruction", weight: 16 },
  { id: "dense", label: "Spatial depth solve", weight: 16 },
  { id: "mesh", label: "Visual + navigation asset", weight: 14 },
  { id: "nav", label: "Connect room walkthrough", weight: 10 },
  { id: "publish", label: "Prepare viewer", weight: 8 },
] as const;

export type StageId = (typeof PIPELINE_STAGES)[number]["id"];

export type StageState = {
  id: StageId;
  label: string;
  status: "pending" | "running" | "succeeded" | "failed" | "skipped";
  detail?: string;
  startedAt?: string;
  finishedAt?: string;
};

export function initialStages(): StageState[] {
  return PIPELINE_STAGES.map((s) => ({
    id: s.id,
    label: s.label,
    status: "pending",
  }));
}

export function progressFromStages(stages: StageState[]): number {
  let done = 0;
  let total = 0;
  for (let i = 0; i < PIPELINE_STAGES.length; i++) {
    const w = PIPELINE_STAGES[i].weight;
    total += w;
    const st = stages[i]?.status;
    if (st === "succeeded" || st === "skipped") done += w;
    else if (st === "running") done += w * 0.5;
  }
  return Math.min(99, Math.round((done / total) * 100));
}
