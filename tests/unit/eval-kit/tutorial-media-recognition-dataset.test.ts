import { describe, expect, it } from 'vitest';
import {
  scoreTutorialMediaRecognition,
  validateTutorialMediaRecognitionDataset,
  type TutorialMediaRecognitionDataset,
} from '../../../packages/eval-kit/src/tutorial-media-recognition-dataset.js';

const hash = (character: string) => character.repeat(64);
const stratum = { host: 'blender', hostVersion: '4.5.3', uiScale: '1.0' };
const provenance = { modelSha256: hash('a'), configSha256: hash('b') };

function dataset(
  evidenceKind: 'real' | 'synthetic_fixture' = 'real',
): TutorialMediaRecognitionDataset {
  return {
    formatVersion: '1.0.0',
    sources: [
      {
        sourceId: 'source',
        sourceIdentitySha256: hash('e'),
        sourceMediaSha256: hash('f'),
        sourceVideoSha256: hash('a'),
        sourceLineageSha256: hash('b'),
        split: 'held_out',
        evidenceKind,
        rights: {
          status: 'evaluation_allowed',
          basis: 'licensed evaluation',
          evidenceSha256: hash('c'),
        },
      },
    ],
    uiGroundTruth: [
      {
        instanceId: 'ui-1',
        sourceId: 'source',
        frameSha256: hash('d'),
        timeRange: { startMs: 1_000, endMs: 1_000 },
        normalizedLabel: 'file',
        menuId: 'file',
        controlId: null,
        bounds: { x: 0, y: 0, width: 0.5, height: 0.5 },
        stratum,
        annotation: { annotatorId: 'a', policyVersion: '1' },
      },
    ],
    shortcutGroundTruth: [
      {
        eventId: 'key-1',
        sourceId: 'source',
        frameSha256: hash('d'),
        timestampMs: 1_000,
        normalizedKeys: ['Ctrl', 'S'],
        stratum,
        annotation: { annotatorId: 'a', policyVersion: '1' },
      },
    ],
    retrievalCandidates: [
      { candidateId: 'candidate-b', segmentId: 'wrong', sourceId: 'source', fixedDistractor: true },
      {
        candidateId: 'candidate-a',
        segmentId: 'right',
        sourceId: 'source',
        fixedDistractor: false,
      },
    ],
    retrievalQueries: [
      {
        queryId: 'query',
        sourceId: 'source',
        adjudicatedIntent: 'save the file',
        relevantSegmentIds: ['right'],
        stratum,
        annotation: { annotatorId: 'a', reviewerId: 'b', adjudicatorId: 'c', policyVersion: '1' },
      },
    ],
  };
}

describe('tutorial media recognition evaluation', () => {
  it('scores exact UI/key matches at inclusive boundaries and resolves retrieval ties by candidate id', () => {
    const report = scoreTutorialMediaRecognition(dataset(), {
      ui: [
        {
          candidateId: 'ui-p',
          sourceId: 'source',
          frameSha256: hash('d'),
          timestampMs: 1_500,
          normalizedLabel: 'file',
          bounds: { x: 0, y: 0, width: 1, height: 0.5 },
          stratum,
        },
      ],
      shortcuts: [
        {
          candidateId: 'key-p',
          sourceId: 'source',
          frameSha256: hash('d'),
          timestampMs: 1_500,
          normalizedKeys: ['Ctrl', 'S'],
          stratum,
        },
      ],
      retrieval: [
        { queryId: 'query', candidateId: 'candidate-b', score: 1 },
        { queryId: 'query', candidateId: 'candidate-a', score: 1 },
      ],
    });
    expect(report.ui).toMatchObject({
      truePositives: 1,
      falsePositives: 0,
      falseNegatives: 0,
      macroF1: 1,
    });
    expect(report.shortcuts).toMatchObject({
      truePositives: 1,
      falsePositives: 0,
      falseNegatives: 0,
    });
    expect(report.retrieval).toEqual({ queryCount: 1, recallAt1: 1, recallAt5: 1, mrr: 1 });
    expect(report.strata[0]?.availability).toBe('unavailable');
  });

  it('is deterministic under record and prediction reordering and synthetic data never satisfies the real gate', () => {
    const input = dataset('synthetic_fixture');
    const predictions = {
      ui: [],
      shortcuts: [],
      retrieval: [
        { queryId: 'query', candidateId: 'candidate-a', score: 1 },
        { queryId: 'query', candidateId: 'candidate-b', score: 0 },
      ],
    };
    const first = scoreTutorialMediaRecognition(input, predictions);
    const second = scoreTutorialMediaRecognition(
      { ...input, retrievalCandidates: [...input.retrievalCandidates].reverse() },
      { ...predictions, retrieval: [...predictions.retrieval].reverse() },
    );
    expect(second).toEqual(first);
    expect(first.realCalibrationEligible).toBe(false);
  });

  it('rejects split leakage and non-independent adjudication', () => {
    const input = dataset();
    expect(() =>
      validateTutorialMediaRecognitionDataset({
        ...input,
        sources: [...input.sources, { ...input.sources[0]!, sourceId: 'leak', split: 'train' }],
      }),
    ).toThrow(/invalid/u);
    expect(() =>
      validateTutorialMediaRecognitionDataset({
        ...input,
        retrievalQueries: [
          {
            ...input.retrievalQueries[0]!,
            annotation: {
              annotatorId: 'same',
              reviewerId: 'same',
              adjudicatorId: 'c',
              policyVersion: '1',
            },
          },
        ],
      }),
    ).toThrow(/invalid/u);
  });

  it('enables a stratum only from the required real query, UI, and shortcut support', () => {
    const input = dataset();
    const supported: TutorialMediaRecognitionDataset = {
      ...input,
      uiGroundTruth: Array.from({ length: 20 }, (_, index) => ({
        ...input.uiGroundTruth[0]!,
        instanceId: `ui-${index}`,
        frameSha256: index.toString(16).padStart(64, '0'),
      })),
      shortcutGroundTruth: Array.from({ length: 20 }, (_, index) => ({
        ...input.shortcutGroundTruth[0]!,
        eventId: `key-${index}`,
        frameSha256: (index + 20).toString(16).padStart(64, '0'),
      })),
      retrievalQueries: Array.from({ length: 10 }, (_, index) => ({
        ...input.retrievalQueries[0]!,
        queryId: `query-${index}`,
      })),
    };
    const report = scoreTutorialMediaRecognition(supported, {
      provenance,
      ui: supported.uiGroundTruth.map((item) => ({
        candidateId: `prediction-${item.instanceId}`,
        sourceId: item.sourceId,
        frameSha256: item.frameSha256,
        timestampMs: item.timeRange.startMs,
        normalizedLabel: item.normalizedLabel,
        bounds: item.bounds,
        stratum: item.stratum,
      })),
      shortcuts: supported.shortcutGroundTruth.map((item) => ({
        candidateId: `prediction-${item.eventId}`,
        sourceId: item.sourceId,
        frameSha256: item.frameSha256,
        timestampMs: item.timestampMs,
        normalizedKeys: item.normalizedKeys,
        stratum: item.stratum,
      })),
      retrieval: supported.retrievalQueries.flatMap((query) => [
        { queryId: query.queryId, candidateId: 'candidate-a', score: 1 },
        { queryId: query.queryId, candidateId: 'candidate-b', score: 0 },
      ]),
    });
    expect(report.strata[0]).toMatchObject({
      availability: 'available',
      realSupport: { retrievalQueries: 10, uiInstances: 20, shortcutEvents: 20 },
      ui: { precision: 1, recall: 1, f1: 1, macroF1: 1 },
      shortcuts: { precision: 1, recall: 1, f1: 1 },
      retrieval: { recallAt5: 1, mrr: 1 },
      maximumAggregateDrop: 0,
      qualityGate: 'pass',
    });
    expect(report.realCalibrationEligible).toBe(true);
    expect(report.aggregateQualityGate).toBe('pass');
    expect(report.bindings).toMatchObject(provenance);
    expect(Object.values(report.bindings)).toSatisfy((values: unknown[]) =>
      values.every((value) => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value)),
    );
    const allZero = scoreTutorialMediaRecognition(supported, {
      provenance,
      ui: [],
      shortcuts: [],
      retrieval: supported.retrievalQueries.flatMap((query) => [
        { queryId: query.queryId, candidateId: 'candidate-a', score: 1 },
        { queryId: query.queryId, candidateId: 'candidate-b', score: 0 },
      ]),
    });
    expect(allZero.aggregateQualityGate).toBe('fail');
    expect(allZero.realCalibrationEligible).toBe(false);
  });

  it('scores only real held-out samples and hashes that evaluated corpus deterministically', () => {
    const input = dataset();
    const excludedSources = [
      {
        ...input.sources[0]!,
        sourceId: 'train-real',
        sourceIdentitySha256: hash('1'),
        sourceMediaSha256: hash('2'),
        sourceVideoSha256: hash('3'),
        sourceLineageSha256: hash('4'),
        split: 'train' as const,
      },
      {
        ...input.sources[0]!,
        sourceId: 'held-out-synthetic',
        sourceIdentitySha256: hash('5'),
        sourceMediaSha256: hash('6'),
        sourceVideoSha256: hash('7'),
        sourceLineageSha256: hash('8'),
        split: 'held_out' as const,
        evidenceKind: 'synthetic_fixture' as const,
      },
    ];
    const contaminated: TutorialMediaRecognitionDataset = {
      ...input,
      sources: [...input.sources, ...excludedSources],
      uiGroundTruth: [
        ...input.uiGroundTruth,
        {
          ...input.uiGroundTruth[0]!,
          instanceId: 'train-ui',
          sourceId: 'train-real',
          frameSha256: hash('9'),
        },
        {
          ...input.uiGroundTruth[0]!,
          instanceId: 'synthetic-ui',
          sourceId: 'held-out-synthetic',
          frameSha256: hash('0'),
        },
      ],
      shortcutGroundTruth: [
        ...input.shortcutGroundTruth,
        { ...input.shortcutGroundTruth[0]!, eventId: 'train-key', sourceId: 'train-real' },
        {
          ...input.shortcutGroundTruth[0]!,
          eventId: 'synthetic-key',
          sourceId: 'held-out-synthetic',
        },
      ],
      retrievalCandidates: [
        ...input.retrievalCandidates,
        {
          candidateId: 'train-candidate',
          segmentId: 'train-right',
          sourceId: 'train-real',
          fixedDistractor: false,
        },
        {
          candidateId: 'synthetic-candidate',
          segmentId: 'synthetic-right',
          sourceId: 'held-out-synthetic',
          fixedDistractor: false,
        },
      ],
      retrievalQueries: [
        ...input.retrievalQueries,
        {
          ...input.retrievalQueries[0]!,
          queryId: 'train-query',
          sourceId: 'train-real',
          relevantSegmentIds: ['train-right'],
        },
        {
          ...input.retrievalQueries[0]!,
          queryId: 'synthetic-query',
          sourceId: 'held-out-synthetic',
          relevantSegmentIds: ['synthetic-right'],
        },
      ],
    };
    const predictions = {
      ui: [
        {
          candidateId: 'excluded-ui-prediction',
          sourceId: 'train-real',
          frameSha256: hash('9'),
          timestampMs: 1_000,
          normalizedLabel: 'file',
          bounds: { x: 0, y: 0, width: 0.5, height: 0.5 },
          stratum,
        },
      ],
      shortcuts: [],
      retrieval: [
        { queryId: 'query', candidateId: 'candidate-a', score: 1 },
        { queryId: 'query', candidateId: 'candidate-b', score: 0 },
        { queryId: 'train-query', candidateId: 'train-candidate', score: 1 },
        { queryId: 'synthetic-query', candidateId: 'synthetic-candidate', score: 1 },
      ],
    };
    const first = scoreTutorialMediaRecognition(contaminated, predictions);
    const clean = scoreTutorialMediaRecognition(input, {
      ui: [],
      shortcuts: [],
      retrieval: predictions.retrieval.slice(0, 2),
    });
    const reordered = scoreTutorialMediaRecognition(
      {
        ...contaminated,
        sources: [...contaminated.sources].reverse(),
        uiGroundTruth: [...contaminated.uiGroundTruth].reverse(),
        shortcutGroundTruth: [...contaminated.shortcutGroundTruth].reverse(),
        retrievalCandidates: [...contaminated.retrievalCandidates].reverse(),
        retrievalQueries: [...contaminated.retrievalQueries].reverse(),
      },
      predictions,
    );
    expect(first).toMatchObject({
      evaluatedSplit: 'held_out',
      evidenceKind: 'real',
      ui: { truePositives: 0, falsePositives: 0, falseNegatives: 1 },
      shortcuts: { truePositives: 0, falsePositives: 0, falseNegatives: 1 },
      retrieval: { queryCount: 1, recallAt1: 1 },
    });
    expect(first.evaluatedCorpusSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(first).toEqual(clean);
    expect(reordered.evaluatedCorpusSha256).toBe(first.evaluatedCorpusSha256);
    expect(reordered.reportSha256).toBe(first.reportSha256);
  });

  it('uses maximum bipartite matching instead of losing true positives greedily', () => {
    const input: TutorialMediaRecognitionDataset = {
      ...dataset(),
      uiGroundTruth: [
        { ...dataset().uiGroundTruth[0]!, instanceId: 'ui-a' },
        {
          ...dataset().uiGroundTruth[0]!,
          instanceId: 'ui-b',
          bounds: { x: 1 / 6, y: 0, width: 0.5, height: 0.5 },
        },
      ],
      shortcutGroundTruth: [
        { ...dataset().shortcutGroundTruth[0]!, eventId: 'key-a', timestampMs: 1_000 },
        { ...dataset().shortcutGroundTruth[0]!, eventId: 'key-b', timestampMs: 1_400 },
      ],
    };
    const predictions = {
      ui: [
        {
          candidateId: 'ui-best-shared',
          sourceId: 'source',
          frameSha256: hash('d'),
          timestampMs: 1_000,
          normalizedLabel: 'file',
          bounds: { x: 0, y: 0, width: 0.5, height: 0.5 },
          stratum,
        },
        {
          candidateId: 'ui-only-a',
          sourceId: 'source',
          frameSha256: hash('d'),
          timestampMs: 1_000,
          normalizedLabel: 'file',
          bounds: { x: 0, y: 0, width: 1 / 3, height: 0.5 },
          stratum,
        },
      ],
      shortcuts: [
        {
          candidateId: 'key-best-shared',
          sourceId: 'source',
          frameSha256: hash('d'),
          timestampMs: 1_000,
          normalizedKeys: ['Ctrl', 'S'],
          stratum,
        },
        {
          candidateId: 'key-only-a',
          sourceId: 'source',
          frameSha256: hash('d'),
          timestampMs: 600,
          normalizedKeys: ['Ctrl', 'S'],
          stratum,
        },
      ],
      retrieval: [
        { queryId: 'query', candidateId: 'candidate-a', score: 1 },
        { queryId: 'query', candidateId: 'candidate-b', score: 0 },
      ],
    };
    const report = scoreTutorialMediaRecognition(input, predictions);
    const reordered = scoreTutorialMediaRecognition(input, {
      ui: [...predictions.ui].reverse(),
      shortcuts: [...predictions.shortcuts].reverse(),
      retrieval: [...predictions.retrieval].reverse(),
    });
    expect(report.ui).toMatchObject({ truePositives: 2, falsePositives: 0, falseNegatives: 0 });
    expect(report.shortcuts).toMatchObject({
      truePositives: 2,
      falsePositives: 0,
      falseNegatives: 0,
    });
    expect(reordered).toEqual(report);
  });

  it('fails a supported stratum when its quality drops more than 0.10 below aggregate', () => {
    const weakStratum = { host: 'blender', hostVersion: '4.4.0', uiScale: '2.0' };
    const input = dataset();
    const supported: TutorialMediaRecognitionDataset = {
      ...input,
      uiGroundTruth: [stratum, weakStratum].flatMap((current, stratumIndex) =>
        Array.from({ length: 20 }, (_, index) => ({
          ...input.uiGroundTruth[0]!,
          instanceId: `ui-${stratumIndex}-${index}`,
          frameSha256: (stratumIndex * 100 + index).toString(16).padStart(64, '0'),
          stratum: current,
        })),
      ),
      shortcutGroundTruth: [stratum, weakStratum].flatMap((current, stratumIndex) =>
        Array.from({ length: 20 }, (_, index) => ({
          ...input.shortcutGroundTruth[0]!,
          eventId: `key-${stratumIndex}-${index}`,
          frameSha256: (stratumIndex * 100 + 40 + index).toString(16).padStart(64, '0'),
          stratum: current,
        })),
      ),
      retrievalQueries: [stratum, weakStratum].flatMap((current, stratumIndex) =>
        Array.from({ length: 10 }, (_, index) => ({
          ...input.retrievalQueries[0]!,
          queryId: `query-${stratumIndex}-${index}`,
          stratum: current,
        })),
      ),
    };
    const strongFrames = new Set(
      supported.uiGroundTruth
        .filter((item) => stratumKeyForTest(item.stratum) === stratumKeyForTest(stratum))
        .map((item) => item.frameSha256),
    );
    const report = scoreTutorialMediaRecognition(supported, {
      provenance,
      ui: supported.uiGroundTruth
        .filter((item) => strongFrames.has(item.frameSha256))
        .map((item) => ({
          candidateId: `prediction-${item.instanceId}`,
          sourceId: item.sourceId,
          frameSha256: item.frameSha256,
          timestampMs: 1_000,
          normalizedLabel: item.normalizedLabel,
          bounds: item.bounds,
          stratum: item.stratum,
        })),
      shortcuts: supported.shortcutGroundTruth
        .filter((item) => stratumKeyForTest(item.stratum) === stratumKeyForTest(stratum))
        .map((item) => ({
          candidateId: `prediction-${item.eventId}`,
          sourceId: item.sourceId,
          frameSha256: item.frameSha256,
          timestampMs: item.timestampMs,
          normalizedKeys: item.normalizedKeys,
          stratum: item.stratum,
        })),
      retrieval: supported.retrievalQueries.flatMap((query) => [
        {
          queryId: query.queryId,
          candidateId: 'candidate-a',
          score: stratumKeyForTest(query.stratum) === stratumKeyForTest(stratum) ? 1 : 0,
        },
        {
          queryId: query.queryId,
          candidateId: 'candidate-b',
          score: stratumKeyForTest(query.stratum) === stratumKeyForTest(stratum) ? 0 : 1,
        },
      ]),
    });
    const weak = report.strata.find(
      (item) => stratumKeyForTest(item.stratum) === stratumKeyForTest(weakStratum),
    );
    expect(weak).toMatchObject({
      qualityGate: 'fail',
      availability: 'unavailable',
      ui: { precision: 0, recall: 0, f1: 0 },
      shortcuts: { precision: 0, recall: 0, f1: 0 },
    });
    expect(weak!.maximumAggregateDrop).toBeGreaterThan(0.1);
    expect(report.realCalibrationEligible).toBe(false);
  });

  it('rejects candidate-pool and stratum collision attacks', () => {
    const input = dataset();
    expect(() =>
      validateTutorialMediaRecognitionDataset({
        ...input,
        retrievalCandidates: [
          ...input.retrievalCandidates,
          {
            candidateId: 'duplicate-segment',
            segmentId: input.retrievalCandidates[0]!.segmentId,
            sourceId: 'source',
            fixedDistractor: false,
          },
        ],
      }),
    ).toThrow(/invalid/u);
    expect(() =>
      validateTutorialMediaRecognitionDataset({
        ...input,
        retrievalCandidates: input.retrievalCandidates.map((candidate) =>
          candidate.candidateId === 'candidate-a'
            ? { ...candidate, fixedDistractor: true }
            : candidate,
        ),
      }),
    ).toThrow(/invalid/u);
    expect(() =>
      validateTutorialMediaRecognitionDataset({
        ...input,
        retrievalCandidates: [
          {
            ...input.retrievalCandidates[0]!,
            fixedDistractor: 'yes' as unknown as boolean,
          },
          input.retrievalCandidates[1]!,
        ],
      }),
    ).toThrow(/invalid/u);
    expect(() =>
      validateTutorialMediaRecognitionDataset({
        ...input,
        uiGroundTruth: [
          { ...input.uiGroundTruth[0]!, stratum: { ...stratum, host: 'blender\0spoof' } },
        ],
      }),
    ).toThrow(/invalid/u);
    expect(() =>
      validateTutorialMediaRecognitionDataset({
        ...input,
        shortcutGroundTruth: [
          { ...input.shortcutGroundTruth[0]!, stratum: { ...stratum, uiScale: ' ' } },
        ],
      }),
    ).toThrow(/invalid/u);
  });

  it('does not let synthetic fixed distractors enter the release candidate pool', () => {
    const input = dataset();
    const poisoned: TutorialMediaRecognitionDataset = {
      ...input,
      sources: [
        ...input.sources,
        {
          ...input.sources[0]!,
          sourceId: 'synthetic',
          sourceIdentitySha256: hash('1'),
          sourceMediaSha256: hash('2'),
          sourceVideoSha256: hash('3'),
          sourceLineageSha256: hash('4'),
          evidenceKind: 'synthetic_fixture',
        },
      ],
      retrievalCandidates: [
        ...input.retrievalCandidates,
        {
          candidateId: 'synthetic-fixed',
          segmentId: 'poison',
          sourceId: 'synthetic',
          fixedDistractor: true,
        },
      ],
    };
    const predictions = {
      ui: [],
      shortcuts: [],
      retrieval: [
        { queryId: 'query', candidateId: 'candidate-a', score: 1 },
        { queryId: 'query', candidateId: 'candidate-b', score: 0 },
        { queryId: 'query', candidateId: 'synthetic-fixed', score: 100 },
      ],
    };
    const clean = scoreTutorialMediaRecognition(input, {
      ...predictions,
      retrieval: predictions.retrieval.slice(0, 2),
    });
    const report = scoreTutorialMediaRecognition(poisoned, predictions);
    expect(report.retrieval).toEqual(clean.retrieval);
    expect(report.bindings.candidatePoolSha256).toBe(clean.bindings.candidatePoolSha256);
    expect(report.evaluatedCorpusSha256).toBe(clean.evaluatedCorpusSha256);
  });

  it('includes prediction-only UI classes in macro F1 and requires provenance for eligibility', () => {
    const input = dataset();
    const basePredictions = {
      ui: [
        {
          candidateId: 'correct',
          sourceId: 'source',
          frameSha256: hash('d'),
          timestampMs: 1_000,
          normalizedLabel: 'file',
          bounds: input.uiGroundTruth[0]!.bounds,
          stratum,
        },
        {
          candidateId: 'prediction-only-class',
          sourceId: 'source',
          frameSha256: hash('d'),
          timestampMs: 1_000,
          normalizedLabel: 'phantom',
          bounds: input.uiGroundTruth[0]!.bounds,
          stratum,
        },
      ],
      shortcuts: [],
      retrieval: [
        { queryId: 'query', candidateId: 'candidate-a', score: 1 },
        { queryId: 'query', candidateId: 'candidate-b', score: 0 },
      ],
    };
    const withoutProvenance = scoreTutorialMediaRecognition(input, basePredictions);
    const withProvenance = scoreTutorialMediaRecognition(input, {
      ...basePredictions,
      provenance,
    });
    expect(withProvenance.ui.perClass.map((item) => item.label)).toEqual(['file', 'phantom']);
    expect(withProvenance.ui.macroF1).toBe(0.5);
    expect(withoutProvenance.realCalibrationEligible).toBe(false);
    expect(withoutProvenance.bindings.modelSha256).toBeNull();
  });
});

function stratumKeyForTest(value: typeof stratum): string {
  return `${value.host}/${value.hostVersion}/${value.uiScale}`;
}
