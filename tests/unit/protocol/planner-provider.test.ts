import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  plannerGenerateRequestSchema,
  plannerGenerationErrorSchema,
  plannerGenerationResultSchema,
  plannerProviderContractVersion,
  plannerProviderDescriptorSchema,
  plannerProviderListSchema,
} from '@operatingline/protocol';
import { describe, expect, it } from 'vitest';

const descriptor = {
  contractVersion: plannerProviderContractVersion,
  id: 'local-test',
  version: '0.1.0',
  displayName: 'Local Test Planner',
  description: 'A provider descriptor without credentials or vendor configuration.',
  availability: { available: true as const },
  limits: { maxConcurrency: 1 },
  dataHandling: {
    executionLocation: 'local' as const,
    dataTransmission: 'none' as const,
    credentialManagement: 'provider_managed' as const,
  },
};

function generationResult() {
  const benchmark = JSON.parse(
    readFileSync(resolve('protocol/fixtures/v1/planning/robot-preview.benchmark.json'), 'utf8'),
  ) as {
    goal: string;
    requiredPhaseIds: string[];
    referencePlan: { id: string; revision: number };
  };
  const draft = {
    targetAdapterId: 'blender',
    catalogVersion: '1.2.0',
    planning: {
      goal: benchmark.goal,
      requiredPhaseIds: benchmark.requiredPhaseIds,
    },
    plan: benchmark.referencePlan,
  };
  return {
    formatVersion: '1.0.0',
    generationId: '00000000-0000-4000-8000-000000000001',
    requestId: '00000000-0000-4000-8000-000000000002',
    provider: { id: descriptor.id, version: descriptor.version },
    packetFormatVersion: '1.0.0',
    status: 'ready',
    draft,
    planningQuality: {
      protocolVersion: '1.1.0',
      baselineVersion: '1.0.0',
      targetAdapterId: draft.targetAdapterId,
      catalogVersion: draft.catalogVersion,
      goal: draft.planning.goal,
      plan: { id: draft.plan.id, revision: draft.plan.revision },
      requiredPhaseIds: draft.planning.requiredPhaseIds,
      valid: true,
      summary: {
        errorCount: 0,
        warningCount: 0,
        executableStepCount: 6,
        groupStepCount: 5,
        usedPhaseCount: draft.planning.requiredPhaseIds.length,
        requiredPhaseCount: draft.planning.requiredPhaseIds.length,
      },
      phases: draft.planning.requiredPhaseIds.map((phaseId, index) => ({
        phaseId,
        order: index + 1,
        title: phaseId,
        required: true,
        used: true,
        groupStepIds: [`robot.phase.${phaseId}`],
        actionStepIds: [],
      })),
      findings: [],
    },
    proposalCreated: false,
    generatedAt: '2026-08-05T00:00:00.000Z',
    durationMs: 42,
  };
}

describe('planner provider protocol', () => {
  it('publishes strict credential-free provider discovery', () => {
    expect(plannerProviderDescriptorSchema.parse(descriptor)).toEqual(descriptor);
    expect(
      plannerProviderDescriptorSchema.safeParse({ ...descriptor, apiKey: 'must-not-exist' })
        .success,
    ).toBe(false);
    expect(
      plannerProviderDescriptorSchema.safeParse({
        ...descriptor,
        dataHandling: {
          executionLocation: 'remote',
          dataTransmission: 'none',
          credentialManagement: 'provider_managed',
        },
      }).success,
    ).toBe(false);
    expect(
      plannerProviderDescriptorSchema.safeParse({
        ...descriptor,
        dataHandling: {
          executionLocation: 'local',
          dataTransmission: 'provider_managed',
          credentialManagement: 'provider_managed',
        },
      }).success,
    ).toBe(false);
    expect(
      plannerProviderListSchema.parse({
        contractVersion: plannerProviderContractVersion,
        generationAvailable: true,
        providers: [descriptor],
      }),
    ).toMatchObject({ generationAvailable: true });
    expect(
      plannerProviderListSchema.safeParse({
        contractVersion: plannerProviderContractVersion,
        generationAvailable: false,
        providers: [descriptor],
      }).success,
    ).toBe(false);
  });

  it('rejects provider discovery lists with duplicate provider ids', () => {
    expect(
      plannerProviderListSchema.safeParse({
        contractVersion: plannerProviderContractVersion,
        generationAvailable: true,
        providers: [descriptor, { ...descriptor, version: '0.2.0' }],
      }).success,
    ).toBe(false);
  });

  it('requires explicit provider and idempotency identities without accepting secrets', () => {
    const request = {
      requestId: '00000000-0000-4000-8000-000000000010',
      providerId: descriptor.id,
      targetAdapterId: 'blender',
      catalogVersion: '1.2.0',
      goal: 'Create a robot preview',
      planId: 'robot-preview',
    };
    expect(plannerGenerateRequestSchema.parse(request)).toEqual(request);
    expect(plannerGenerateRequestSchema.safeParse({ ...request, apiKey: 'secret' }).success).toBe(
      false,
    );
  });

  it('ties generation status and quality evidence to an unsubmitted draft', () => {
    const result = generationResult();
    expect(plannerGenerationResultSchema.parse(result)).toEqual(result);
    expect(
      plannerGenerationResultSchema.safeParse({ ...result, proposalCreated: true }).success,
    ).toBe(false);
    expect(
      plannerGenerationResultSchema.safeParse({
        ...result,
        planningQuality: {
          ...result.planningQuality,
          plan: { ...result.planningQuality.plan, id: 'different-plan' },
        },
      }).success,
    ).toBe(false);
    expect(
      plannerGenerationResultSchema.safeParse({ ...result, status: 'needs_revision' }).success,
    ).toBe(false);
    expect(
      plannerGenerationResultSchema.safeParse({
        ...result,
        packetFormatVersion: '1.1.0',
      }).success,
    ).toBe(false);
  });

  it('publishes explicit request-id retry modes instead of an ambiguous boolean', () => {
    const error = {
      error: 'planner_generation_timeout',
      requestId: '00000000-0000-4000-8000-000000000010',
      message: 'The provider timed out after the durable request boundary.',
      retryMode: 'new_request_id',
    };
    expect(plannerGenerationErrorSchema.parse(error)).toEqual(error);
    expect(
      plannerGenerationErrorSchema.safeParse({ ...error, retryMode: undefined, retryable: true })
        .success,
    ).toBe(false);
  });

  it('generates strict public provider schemas', () => {
    for (const filename of [
      'planner-provider-descriptor.schema.json',
      'planner-provider-list.schema.json',
      'planner-generate-request.schema.json',
      'planner-generation-result.schema.json',
      'planner-generation-error.schema.json',
    ]) {
      const schema = JSON.parse(readFileSync(resolve('protocol/schemas/v1', filename), 'utf8')) as {
        additionalProperties?: boolean;
      };
      expect(schema.additionalProperties, filename).toBe(false);
    }
  });
});
