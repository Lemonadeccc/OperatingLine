import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { blenderActionCatalog } from '@operatingline/blender-action-catalog';
import { evalExportBundleSchema, evalExportRequestSchema } from '@operatingline/protocol';

describe('eval export protocol', () => {
  it('defaults bounded pagination and rejects unknown request fields', () => {
    expect(
      evalExportRequestSchema.parse({ targetAdapterId: 'blender', planId: 'snowman-demo' }),
    ).toEqual({
      targetAdapterId: 'blender',
      planId: 'snowman-demo',
      afterSequence: 0,
      limit: 250,
    });
    expect(
      evalExportRequestSchema.safeParse({
        targetAdapterId: 'blender',
        planId: 'snowman-demo',
        limit: 1_001,
      }).success,
    ).toBe(false);
    expect(
      evalExportRequestSchema.safeParse({
        targetAdapterId: 'blender',
        planId: 'snowman-demo',
        afterSequence: 1,
      }).success,
    ).toBe(false);
    expect(
      evalExportRequestSchema.safeParse({
        targetAdapterId: 'blender',
        planId: 'snowman-demo',
        snapshotId: randomUUID(),
      }).success,
    ).toBe(false);
    expect(
      evalExportRequestSchema.safeParse({
        targetAdapterId: 'blender',
        planId: 'snowman-demo',
        afterSequence: 3,
        snapshotId: randomUUID(),
        snapshotUpperSequence: 2,
      }).success,
    ).toBe(false);
    expect(
      evalExportRequestSchema.safeParse({
        targetAdapterId: 'blender',
        planId: 'snowman-demo',
        unknown: true,
      }).success,
    ).toBe(false);
  });

  it('validates a language-neutral bundle with explicit raw-data and integrity metadata', () => {
    const exportedAt = '2026-08-04T00:00:00.000Z';
    const currentBundle = {
      protocolVersion: '1.0.0',
      formatVersion: '1.1.0',
      exportId: randomUUID(),
      exportedAt,
      scope: { targetAdapterId: 'blender', planId: 'snowman-demo', instanceId: null },
      catalogs: [blenderActionCatalog],
      events: [
        {
          sequence: 1,
          id: randomUUID(),
          eventType: 'planning.context.generated',
          payload: { context: { requestedPlanId: 'snowman-demo' } },
          createdAt: exportedAt,
        },
      ],
      page: {
        snapshotId: randomUUID(),
        snapshotUpperSequence: 1,
        afterSequence: 0,
        nextAfterSequence: 1,
        hasMore: false,
      },
      summary: {
        matchedEventCount: 1,
        eventTypeCounts: { 'planning.context.generated': 1 },
        transitionCounts: {},
        decisionCounts: {},
      },
      dataHandling: {
        redaction: 'none',
        containsPotentiallySensitiveContent: true,
        warning: 'Review before sharing.',
      },
      integrity: {
        algorithm: 'sha256',
        canonicalization: 'operatingline-json-sort-v1',
        contentSha256: 'a'.repeat(64),
      },
    };
    const parsed = evalExportBundleSchema.parse(currentBundle);

    expect(parsed.catalogs[0]?.catalogVersion).toBe('1.4.0');

    const legacy = evalExportBundleSchema.parse({
      ...currentBundle,
      formatVersion: '1.0.0',
      page: {
        afterSequence: 0,
        nextAfterSequence: 1,
        hasMore: false,
      },
    });
    expect(legacy).toMatchObject({
      formatVersion: '1.0.0',
      page: { afterSequence: 0, nextAfterSequence: 1, hasMore: false },
    });
    for (const filename of ['eval-export-request.schema.json', 'eval-export-bundle.schema.json']) {
      const schema = JSON.parse(readFileSync(resolve('protocol/schemas/v1', filename), 'utf8')) as {
        additionalProperties?: boolean;
        anyOf?: Array<{ additionalProperties?: boolean }>;
        oneOf?: Array<{ additionalProperties?: boolean }>;
      };
      expect(schema.oneOf ?? schema.anyOf ?? [schema]).toSatisfy((variants) =>
        variants.every((variant) => variant.additionalProperties === false),
      );
    }
  });
});
