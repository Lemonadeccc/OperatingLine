import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { guidePlanSchema } from '@operatingline/protocol';

describe('guide plan protocol fixture', () => {
  const readFixture = (): Record<string, unknown> =>
    JSON.parse(
      readFileSync(resolve('protocol/fixtures/v1/snowman-teaching.plan.json'), 'utf8'),
    ) as Record<string, unknown>;

  it('validates the language-neutral snowman fixture', () => {
    const fixture = readFixture();

    const plan = guidePlanSchema.parse(fixture);
    expect(plan.steps.filter((step) => step.action !== null)).toHaveLength(25);
    expect(plan.steps.some((step) => step.anchors[0]?.kind === 'world_position')).toBe(true);
  });

  it('rejects non-portable step ids before cross-language scheduling', () => {
    const fixture = readFixture() as { steps: Array<Record<string, unknown>> };
    fixture.steps[0] = { ...fixture.steps[0], id: '雪人' };

    expect(guidePlanSchema.safeParse(fixture).success).toBe(false);
  });

  it('rejects unknown fields instead of silently changing the signed payload', () => {
    const rootExtra = { ...readFixture(), unexpected: true };
    const stepExtra = readFixture() as { steps: Array<Record<string, unknown>> };
    stepExtra.steps[0] = { ...stepExtra.steps[0], unexpected: true };

    expect(guidePlanSchema.safeParse(rootExtra).success).toBe(false);
    expect(guidePlanSchema.safeParse(stepExtra).success).toBe(false);
  });

  it('versions observation success gates without changing legacy telemetry semantics', () => {
    const gated = readFixture() as {
      protocolVersion: string;
      steps: Array<Record<string, unknown>>;
    };
    const executable = gated.steps.find((step) => step.action !== null);
    expect(executable).toBeDefined();
    gated.protocolVersion = '1.2.0';
    executable!.observationPolicy = {
      mode: 'success_gate',
      failureStrategy: 'rollback_step',
    };
    expect(guidePlanSchema.safeParse(gated).success).toBe(true);

    gated.protocolVersion = '1.1.0';
    expect(guidePlanSchema.safeParse(gated).success).toBe(false);

    gated.protocolVersion = '1.2.0';
    executable!.expectedObservations = [];
    expect(guidePlanSchema.safeParse(gated).success).toBe(false);

    delete executable!.observationPolicy;
    const group = gated.steps.find((step) => step.action === null);
    expect(group).toBeDefined();
    group!.observationPolicy = { mode: 'telemetry' };
    expect(guidePlanSchema.safeParse(gated).success).toBe(false);
  });

  it('bounds automatic Observation retries and requires rollback between attempts', () => {
    const retrying = readFixture() as {
      protocolVersion: string;
      steps: Array<Record<string, unknown>>;
    };
    retrying.protocolVersion = '1.5.0';
    const executable = retrying.steps.find((step) => step.action !== null);
    expect(executable).toBeDefined();
    executable!.observationPolicy = {
      mode: 'success_gate',
      failureStrategy: 'rollback_step',
      retryPolicy: { mode: 'automatic_bounded', maxAttempts: 2 },
    };

    expect(guidePlanSchema.safeParse(retrying).success).toBe(true);
    executable!.observationPolicy = {
      mode: 'success_gate',
      failureStrategy: 'rollback_step',
      retryPolicy: { mode: 'automatic_bounded', maxAttempts: 3 },
    };
    expect(guidePlanSchema.safeParse(retrying).success).toBe(true);

    retrying.protocolVersion = '1.4.0';
    expect(guidePlanSchema.safeParse(retrying).success).toBe(false);
    retrying.protocolVersion = '1.5.0';

    for (const maxAttempts of [1, 4]) {
      executable!.observationPolicy = {
        mode: 'success_gate',
        failureStrategy: 'rollback_step',
        retryPolicy: { mode: 'automatic_bounded', maxAttempts },
      };
      expect(guidePlanSchema.safeParse(retrying).success).toBe(false);
    }

    executable!.observationPolicy = {
      mode: 'success_gate',
      failureStrategy: 'retain_for_repair',
      retryPolicy: { mode: 'automatic_bounded', maxAttempts: 2 },
    };
    expect(guidePlanSchema.safeParse(retrying).success).toBe(false);
  });

  it('keeps Zod and the emitted JSON Schema aligned for 3D positions', () => {
    const extraCoordinate = readFixture() as { steps: Array<Record<string, unknown>> };
    const anchorStep = extraCoordinate.steps.find(
      (step) => Array.isArray(step.anchors) && step.anchors.length > 0,
    );
    const anchors = anchorStep?.anchors as Array<Record<string, unknown>>;
    anchors[0] = { ...anchors[0], position: [0, 0, 1.5, 99] };
    expect(guidePlanSchema.safeParse(extraCoordinate).success).toBe(false);

    const emitted = JSON.parse(
      readFileSync(resolve('protocol/schemas/v1/guide-plan.schema.json'), 'utf8'),
    ) as {
      additionalProperties?: unknown;
      allOf?: unknown[];
      properties?: {
        steps?: {
          items?: {
            additionalProperties?: unknown;
            properties?: {
              anchors?: {
                items?: {
                  oneOf?: Array<{
                    properties?: {
                      position?: { minItems?: number; maxItems?: number };
                    };
                  }>;
                };
              };
            };
          };
        };
      };
    };
    expect(emitted.additionalProperties).toBe(false);
    const stepSchema = emitted.properties?.steps?.items;
    expect(stepSchema?.additionalProperties).toBe(false);
    const positionSchema = stepSchema?.properties?.anchors?.items?.oneOf?.find(
      (candidate) => candidate.properties?.position,
    )?.properties?.position;
    expect(positionSchema).toMatchObject({ minItems: 3, maxItems: 3 });
    expect(emitted.allOf).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          if: expect.objectContaining({
            properties: {
              protocolVersion: { enum: ['1.2.0', '1.3.0', '1.4.0', '1.5.0'] },
            },
          }),
        }),
      ]),
    );
  });
});
