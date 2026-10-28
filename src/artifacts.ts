import type { Artifact, Challenge, Vignette } from "./state";

type VignetteManifest = { cases: Vignette[] };
type ConditionManifest = { conditions: Record<string, Record<string, Artifact>> };
type ChallengeManifest = { cases: Record<string, Challenge> };

export type ArtifactBundle = { cases: Vignette[]; conditions: ConditionManifest["conditions"]; challenges: Record<string, Challenge> };

export async function loadArtifactBundle(base = "./artifacts/HG2-0004"): Promise<ArtifactBundle> {
  const [vignettes, condition, challenges] = await Promise.all([
    fetch(`${base}/EXPERIMENT_VIGNETTE_MANIFEST.json`).then(response => response.json() as Promise<VignetteManifest>),
    fetch(`${base}/CONDITION_ARTIFACTS.json`).then(response => response.json() as Promise<ConditionManifest>),
    fetch(`${base}/STANDARDIZED_CHALLENGE_MANIFEST.json`).then(response => response.json() as Promise<ChallengeManifest>),
  ]);
  return { cases: vignettes.cases, conditions: condition.conditions, challenges: challenges.cases ?? {} };
}

export function firstGroupForCase(_bundle: ArtifactBundle, caseId: string): string {
  return caseId;
}
