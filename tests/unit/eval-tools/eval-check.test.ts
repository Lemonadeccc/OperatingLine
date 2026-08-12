import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseEvalCheckCliOptions, runEvalCheckCli } from '../../../tools/eval/check-cli.js';

describe('Eval check CLI', () => {
  it('preserves the default aggregate-only response', async () => {
    const result = await runEvalCheckCli([]);

    expect(result).toMatchObject({
      valid: true,
      suiteId: 'blender.core_planning',
      status: 'collecting',
      caseCount: 7,
      runCount: 0,
      blindSignoffCount: 0,
      annotationCount: 0,
      adjudicationCount: 0,
      numericScoring: false,
      providerRanking: false,
    });
    expect(result).not.toHaveProperty('worklist');
  });

  it('adds an honest deterministic collection worklist only when requested', async () => {
    const first = await runEvalCheckCli(['--worklist']);
    const second = await runEvalCheckCli(['--worklist']);

    expect(first.worklist).toEqual(second.worklist);
    expect(first.worklist).toMatchObject({
      suite: {
        suiteId: 'blender.core_planning',
        suiteVersion: '1.0.0',
        status: 'collecting',
      },
      target: 'collection_policy_minimums',
      actionability: 'actionable',
      releaseReadiness: 'not_assessed',
      reviewStage: { status: 'open', blockedByUnsignedRunIds: [] },
      collectionPolicyMinimumsMet: false,
    });
    expect(first.worklist?.captureStatusByCase).toHaveLength(7);
    expect(
      first.worklist?.captureStatusByCase.every(
        (capture) => capture.remainingDistinctTreatments === 2,
      ),
    ).toBe(true);
    expect(first.worklist?.signoffs).toEqual([]);
    expect(first.worklist?.reviews).toEqual([]);
    expect(first.worklist?.adjudications).toEqual([]);
    expect(JSON.stringify(first)).not.toContain('providerAssignment');
    expect(JSON.stringify(first)).not.toContain('nextRunId');
  });

  it('parses one optional dataset and rejects ambiguous flags', () => {
    expect(parseEvalCheckCliOptions(['fixtures', '--worklist'])).toEqual({
      datasetDirectory: resolve('fixtures'),
      includeWorklist: true,
    });
    expect(() => parseEvalCheckCliOptions(['--worklist', '--worklist'])).toThrow(/Duplicate/);
    expect(() => parseEvalCheckCliOptions(['--unknown'])).toThrow(/Unknown/);
    expect(() => parseEvalCheckCliOptions(['one', 'two'])).toThrow(/at most one/);
  });
});
