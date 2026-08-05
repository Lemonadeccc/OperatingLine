import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it } from 'vitest';

import {
  buildHumanEvalComparisonReport,
  sealHumanEvalAdjudication,
  validateHumanEvalDataset,
} from '@operatingline/eval-kit';

import {
  buildHumanEvalAnnotationFixture,
  buildHumanEvalSuiteFixture,
  buildProviderEvalRunFixture,
} from '../support/human-eval-fixtures.js';
import {
  validatePublicJsonSchemaCases,
  type PublicJsonSchemaCase,
} from '../../services/orchestrator/test-support/public-json-schema-validator.js';

function publicSchema(filename: string): object {
  return JSON.parse(readFileSync(resolve('protocol/schemas/v1', filename), 'utf8')) as object;
}

async function expectPublicSchema(
  filename: string,
  ...cases: readonly PublicJsonSchemaCase[]
): Promise<void> {
  await validatePublicJsonSchemaCases(publicSchema(filename), cases);
}

describe('public Human Eval JSON Schema contracts', () => {
  it('accepts canonical records and rejects score/ranking extensions', async () => {
    const suite = buildHumanEvalSuiteFixture();
    const run = buildProviderEvalRunFixture(suite);
    const annotation = buildHumanEvalAnnotationFixture(
      suite,
      run,
      'reviewer.alpha',
      '30000000-0000-4000-8000-000000000001',
    );
    const secondAnnotation = buildHumanEvalAnnotationFixture(
      suite,
      run,
      'reviewer.beta',
      '30000000-0000-4000-8000-000000000002',
      'not_met',
    );
    const adjudication = sealHumanEvalAdjudication({
      formatVersion: '1.0.0',
      adjudicationId: '30000000-0000-4000-8000-000000000003',
      caseRef: run.caseRef,
      runId: run.runId,
      annotationRefs: [annotation, secondAnnotation].map((entry) => ({
        annotationId: entry.annotationId,
        annotationContentSha256: entry.integrity.contentSha256,
      })),
      adjudicatorPseudonym: 'reviewer.gamma',
      completedAt: '2026-08-05T00:00:02.000Z',
      judgments: annotation.review.judgments,
      sourceKind: 'human_adjudication',
      dataHandling: run.dataHandling,
    });
    const report = buildHumanEvalComparisonReport(
      validateHumanEvalDataset({ suite, runs: [run], annotations: [annotation] }),
      { generatedAt: '2026-08-05T00:00:00.000Z', audience: 'development' },
    );

    await expectPublicSchema(
      'human-eval-suite.schema.json',
      { value: suite, accepted: true },
      { value: { ...suite, score: 1 }, accepted: false },
    );
    await expectPublicSchema(
      'provider-eval-run.schema.json',
      { value: run, accepted: true },
      { value: { ...run, winner: true }, accepted: false },
      {
        value: { ...run, sourceKind: 'live_provider_invocation' },
        accepted: false,
      },
      {
        value: {
          ...run,
          profile: {
            ...run.profile,
            model: {
              ...run.profile.model,
              resolution: 'provider_did_not_disclose',
              resolvedRevision: run.profile.model.resolvedRevision,
            },
          },
        },
        accepted: false,
      },
      {
        value: {
          ...run,
          generationSettings: {
            ...run.generationSettings,
            determinism: 'seeded_best_effort',
            seed: 42,
          },
        },
        accepted: false,
      },
      {
        value: {
          ...run,
          generationSettings: {
            ...run.generationSettings,
            determinism: 'seeded_best_effort',
            seed: 42,
          },
          comparability: {
            ...run.comparability,
            reproducibility: 'best_effort',
          },
        },
        accepted: true,
      },
      {
        value: {
          ...run,
          environment: { ...run.environment, sourceCommit: null },
        },
        accepted: false,
      },
      {
        value: {
          ...run,
          generationSettings: {
            ...run.generationSettings,
            determinism: 'seeded_best_effort',
            seed: null,
          },
        },
        accepted: false,
      },
      {
        value: {
          ...run,
          artifacts: [
            {
              artifactId: 'render.preview',
              kind: 'rendered_image',
              mediaType: 'image/png',
              uri: 'render.png',
              contentSha256: 'a'.repeat(64),
              metadata: {},
            },
          ],
        },
        accepted: false,
      },
    );
    await expectPublicSchema(
      'human-eval-annotation.schema.json',
      { value: annotation, accepted: true },
      { value: { ...annotation, aggregateScore: 0.9 }, accepted: false },
    );
    await expectPublicSchema(
      'human-eval-adjudication.schema.json',
      { value: adjudication, accepted: true },
      { value: { ...adjudication, annotationIds: [] }, accepted: false },
    );
    await expectPublicSchema(
      'human-eval-comparison-report.schema.json',
      { value: report, accepted: true },
      { value: { ...report, providerRanking: ['fixture.canvas_planner'] }, accepted: false },
    );
  });

  it('publishes strict top-level schemas for every Human Eval record', async () => {
    for (const filename of [
      'human-eval-suite.schema.json',
      'provider-eval-run.schema.json',
      'human-eval-annotation.schema.json',
      'human-eval-adjudication.schema.json',
      'human-eval-comparison-report.schema.json',
    ]) {
      await expectPublicSchema(filename, { value: {}, accepted: false });
    }
  });
});
