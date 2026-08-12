import type { ProviderEvalRun } from '@operatingline/protocol';

export interface HumanEvalCaptureConditionStatus {
  readonly conditionSha256: string;
  readonly liveRunCount: number;
  readonly distinctTreatmentCount: number;
}

export interface HumanEvalCaseCapturePolicyStatus {
  readonly caseId: string;
  readonly requiredDistinctTreatments: number;
  readonly conditionGroups: readonly HumanEvalCaptureConditionStatus[];
  readonly bestDistinctTreatmentCount: number;
  readonly remainingDistinctTreatments: number;
}

/** Evaluates one case's live treatment coverage under a single comparable condition. */
export function evaluateHumanEvalCaseCapturePolicy(
  caseId: string,
  runs: readonly ProviderEvalRun[],
  requiredDistinctTreatments: number,
): HumanEvalCaseCapturePolicyStatus {
  const runsByCondition = new Map<string, ProviderEvalRun[]>();
  for (const run of runs) {
    if (run.caseRef.caseId !== caseId || run.sourceKind !== 'live_provider_invocation') {
      continue;
    }
    const conditionSha256 = run.comparability.conditionSha256;
    const conditionRuns = runsByCondition.get(conditionSha256) ?? [];
    conditionRuns.push(run);
    runsByCondition.set(conditionSha256, conditionRuns);
  }
  const conditionGroups = [...runsByCondition.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([conditionSha256, conditionRuns]) => ({
      conditionSha256,
      liveRunCount: conditionRuns.length,
      distinctTreatmentCount: new Set(conditionRuns.map((run) => run.comparability.treatmentSha256))
        .size,
    }));
  const bestDistinctTreatmentCount = Math.max(
    0,
    ...conditionGroups.map((group) => group.distinctTreatmentCount),
  );
  return {
    caseId,
    requiredDistinctTreatments,
    conditionGroups,
    bestDistinctTreatmentCount,
    remainingDistinctTreatments: Math.max(
      0,
      requiredDistinctTreatments - bestDistinctTreatmentCount,
    ),
  };
}
