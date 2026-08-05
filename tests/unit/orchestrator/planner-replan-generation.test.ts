import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { blenderActionCatalog } from '@operatingline/blender-action-catalog';
import type { ExecutionEventInput, StoredExecutionEvent } from '@operatingline/persistence';
import {
  guideRevisionRequestSchema,
  plannerReplanGenerationResultSchema,
  type GuidePlan,
  type PlannerReplanDraft,
  type PlannerReplanGenerateRequest,
  type ReplanningPromptPacket,
} from '@operatingline/protocol';
import { FakePlannerProvider } from '@operatingline/test-kit';
import { describe, expect, it } from 'vitest';

import { createLocalReplanScope } from '../../../services/orchestrator/src/local-replan-scope.js';
import { evaluatePlanningQuality } from '../../../services/orchestrator/src/planning-quality.js';
import {
  createPlannerProviderInvocationManager,
  plannerProviderRequestFingerprint,
} from '../../../services/orchestrator/src/planner-provider-invocation.js';
import { PlannerGenerationRuntimeError } from '../../../services/orchestrator/src/planner-provider-errors.js';
import { createPlannerProviderRegistry } from '../../../services/orchestrator/src/planner-provider-registry.js';
import {
  createPlannerReplanGenerationCoordinator,
  restoreReplanPlannerProviderInvocations,
} from '../../../services/orchestrator/src/planner-replan-generation.js';
import { buildReplanningPromptPacket } from '../../../services/orchestrator/src/replanning-prompt.js';

const basePlan = JSON.parse(
  readFileSync(resolve('protocol/fixtures/v1/snowman.plan.json'), 'utf8'),
) as GuidePlan;
const requiredPhaseIds = ['geometry', 'materials', 'animation', 'render_setup', 'output'];
const capabilityCoverage = {
  policyVersion: 'catalog_capability_coverage_v1' as const,
  requirements: [
    {
      requirementId: 'larger-head',
      statement: 'Make the referenced snowman head larger.',
      coverage: [{ capabilityId: 'geometry.primitive_assembly', stepIds: ['snowman.model.head'] }],
    },
  ],
};

function revisionRequest() {
  const requestId = randomUUID();
  return guideRevisionRequestSchema.parse({
    protocolVersion: '1.1.0',
    requestId,
    adapterId: 'blender',
    catalogVersion: blenderActionCatalog.catalogVersion,
    instanceId: randomUUID(),
    basePlan,
    references: [{ nodeId: 'snowman.model.head', nodeNumber: '1.2.3' }],
    message: 'Make only the referenced snowman head larger and easier to understand.',
    revisionThread: { threadId: requestId, turn: 1, parentRequestId: null },
    occurredAt: '2026-08-05T00:00:00.000Z',
  });
}

function packetFor(request: ReturnType<typeof revisionRequest>): ReplanningPromptPacket {
  return buildReplanningPromptPacket({
    revisionRequest: request,
    targetRevision: request.basePlan.revision + 1,
    catalog: blenderActionCatalog,
    companionState: null,
    scope: createLocalReplanScope(request),
  });
}

function generationRequest(
  request: ReturnType<typeof revisionRequest>,
  overrides: Partial<PlannerReplanGenerateRequest> = {},
): PlannerReplanGenerateRequest {
  return {
    requestId: randomUUID(),
    revisionRequestId: request.requestId,
    providerId: 'fake-planner',
    ...overrides,
  };
}

function validDraft(packet: ReplanningPromptPacket): PlannerReplanDraft {
  const plan = structuredClone(packet.context.revisionRequest.basePlan);
  plan.revision = packet.context.targetRevision;
  const head = plan.steps.find((step) => step.id === 'snowman.model.head');
  if (head === undefined) {
    throw new Error('Snowman fixture is missing the referenced head step');
  }
  head.title = 'Create a larger beginner-friendly snowman head';
  return {
    requestId: packet.context.revisionRequest.requestId,
    catalogVersion: packet.context.catalog.catalogVersion,
    planning: {
      goal: packet.context.revisionRequest.message,
      requiredPhaseIds,
      capabilityCoverage,
    },
    plan,
  };
}

function providerWithReplan(
  replan: ConstructorParameters<typeof FakePlannerProvider>[2],
  maxConcurrency = 1,
): FakePlannerProvider {
  return new FakePlannerProvider(
    () => {
      throw new Error('Initial generation must not be invoked by replan tests');
    },
    {
      contractVersion: '1.0.0',
      id: 'fake-planner',
      version: '0.1.0',
      displayName: 'Fake Replanner',
      description: 'Deterministic local replanner used by coordinator tests.',
      availability: { available: true },
      limits: { maxConcurrency },
      dataHandling: {
        executionLocation: 'local',
        dataTransmission: 'none',
        credentialManagement: 'provider_managed',
      },
    },
    replan,
  );
}

function asStoredEvents(events: readonly ExecutionEventInput[]): StoredExecutionEvent[] {
  return events.map((event, index) => ({
    sequence: index + 1,
    id: event.id,
    eventType: event.eventType,
    payload: event.payload,
    createdAt: event.createdAt ?? '2026-08-05T00:00:00.000Z',
  }));
}

function harness(
  provider: FakePlannerProvider,
  request: ReturnType<typeof revisionRequest>,
  options: {
    timeoutMs?: number;
    existingEvents?: readonly StoredExecutionEvent[];
    invocationManager?: ReturnType<typeof createPlannerProviderInvocationManager>;
  } = {},
) {
  const events: ExecutionEventInput[] = [];
  const registry = createPlannerProviderRegistry([provider]);
  const coordinator = createPlannerReplanGenerationCoordinator({
    registry,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.invocationManager === undefined
      ? {}
      : { invocationManager: options.invocationManager }),
    existingEvents: options.existingEvents ?? [],
    buildPacket: ({ revisionRequestId }) => {
      if (revisionRequestId !== request.requestId) {
        throw new Error('Unknown revision request');
      }
      return packetFor(request);
    },
    evaluateDraft: (packet, draft) =>
      evaluatePlanningQuality(
        {
          targetAdapterId: packet.context.revisionRequest.adapterId,
          catalogVersion: draft.catalogVersion,
          goal: draft.planning.goal,
          requiredPhaseIds: draft.planning.requiredPhaseIds,
          capabilityCoverage: draft.planning.capabilityCoverage,
          plan: draft.plan,
        },
        packet.context.catalog,
      ),
    appendEvent: (event) => events.push(event),
  });
  return { coordinator, events, registry };
}

async function expectRuntimeError(
  promise: Promise<unknown>,
  code: PlannerGenerationRuntimeError['code'],
): Promise<PlannerGenerationRuntimeError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(PlannerGenerationRuntimeError);
    expect((error as PlannerGenerationRuntimeError).code).toBe(code);
    return error as PlannerGenerationRuntimeError;
  }
  throw new Error(`Expected planner generation error ${code}`);
}

describe('planner replan generation coordinator', () => {
  it('returns a ready local draft without creating a proposal and records evidence in order', async () => {
    const revision = revisionRequest();
    const provider = providerWithReplan(({ packet }) => validDraft(packet));
    const { coordinator, events, registry } = harness(provider, revision);
    const input = generationRequest(revision);

    const result = await coordinator.generate(input);

    expect(result).toMatchObject({
      requestId: input.requestId,
      revisionRequestId: revision.requestId,
      status: 'ready',
      proposalCreated: false,
      planningQuality: { valid: true },
      locality: { valid: true, scopeRootIds: ['snowman.model.head'] },
      planDiff: { summary: { updatedSteps: 1 } },
    });
    expect(provider.replanInputs).toHaveLength(1);
    expect(registry.listReplanners()).toMatchObject({
      generationAvailable: true,
      providers: [{ id: 'fake-planner' }],
    });
    expect(events.map((event) => event.eventType)).toEqual([
      'planning.replan.context.generated',
      'planning.replan.prompt.generated',
      'planning.provider.replan.requested',
      'planning.quality.evaluated',
      'planning.provider.replan.completed',
    ]);
    expect(events.some((event) => event.eventType.startsWith('guide.proposal'))).toBe(false);
    if (result.planDiff === null) {
      throw new Error('Ready replan result must include a deterministic Plan diff');
    }
    expect(
      plannerReplanGenerationResultSchema.safeParse({
        ...result,
        planDiff: {
          ...result.planDiff,
          targetPlan: {
            ...result.planDiff.targetPlan,
            revision: result.planDiff.targetPlan.revision + 1,
          },
        },
      }).success,
    ).toBe(false);
    expect(
      plannerReplanGenerationResultSchema.safeParse({
        ...result,
        packetFormatVersion: '1.0.0',
      }).success,
    ).toBe(false);
    await coordinator.close();
  });

  it('returns needs_revision for a schema-valid local draft missing capability coverage', async () => {
    const revision = revisionRequest();
    const provider = providerWithReplan(({ packet }) => {
      const draft = validDraft(packet);
      delete draft.planning.capabilityCoverage;
      return draft;
    });
    const { coordinator } = harness(provider, revision);

    const result = await coordinator.generate(generationRequest(revision));

    expect(result).toMatchObject({
      status: 'needs_revision',
      proposalCreated: false,
      planningQuality: {
        valid: false,
        findings: [expect.objectContaining({ code: 'coverage.missing' })],
      },
    });
    await coordinator.close();
  });

  it('rejects strict-contract output without persisting provider-only fields', async () => {
    const revision = revisionRequest();
    const provider = providerWithReplan(({ packet }) => ({
      ...validDraft(packet),
      privateReasoning: 'DO_NOT_PERSIST_THIS_SECRET',
    }));
    const { coordinator, events } = harness(provider, revision);

    await expectRuntimeError(
      coordinator.generate(generationRequest(revision)),
      'planner_output_invalid',
    );

    expect(JSON.stringify(events)).not.toContain('DO_NOT_PERSIST_THIS_SECRET');
    expect(events.at(-1)).toMatchObject({
      eventType: 'planning.provider.replan.failed',
      payload: { error: 'planner_output_invalid' },
    });
    await coordinator.close();
  });

  it('rejects output that changes immutable replan identity', async () => {
    const revision = revisionRequest();
    const provider = providerWithReplan(({ packet }) => ({
      ...validDraft(packet),
      requestId: randomUUID(),
    }));
    const { coordinator, events } = harness(provider, revision);

    await expectRuntimeError(
      coordinator.generate(generationRequest(revision)),
      'planner_identity_mismatch',
    );

    expect(events.at(-1)).toMatchObject({
      eventType: 'planning.provider.replan.failed',
      payload: { error: 'planner_identity_mismatch' },
    });
    await coordinator.close();
  });

  it('isolates deterministic validation from provider mutations of its packet copy', async () => {
    const revision = revisionRequest();
    const provider = providerWithReplan(({ packet }) => {
      const mutableContext = packet.context as { targetRevision: number };
      mutableContext.targetRevision += 7;
      return validDraft(packet);
    });
    const { coordinator } = harness(provider, revision);

    await expectRuntimeError(
      coordinator.generate(generationRequest(revision)),
      'planner_identity_mismatch',
    );
    await coordinator.close();
  });

  it.each([
    {
      name: 'outside-scope change',
      mutate: (draft: PlannerReplanDraft) => {
        const outside = draft.plan.steps.find((step) => step.id === 'snowman.scene');
        if (outside === undefined) throw new Error('Fixture is missing snowman.scene');
        outside.title = 'Changed outside the referenced subtree';
      },
      finding: 'step_changed_outside_scope',
    },
    {
      name: 'no local change',
      mutate: (draft: PlannerReplanDraft, packet: ReplanningPromptPacket) => {
        draft.plan = {
          ...structuredClone(packet.context.revisionRequest.basePlan),
          revision: packet.context.targetRevision,
        };
      },
      finding: 'no_local_change',
    },
  ])('returns needs_revision for $name', async ({ mutate, finding }) => {
    const revision = revisionRequest();
    const provider = providerWithReplan(({ packet }) => {
      const draft = validDraft(packet);
      mutate(draft, packet);
      return draft;
    });
    const { coordinator } = harness(provider, revision);

    const result = await coordinator.generate(generationRequest(revision));

    expect(result.status).toBe('needs_revision');
    expect(result.proposalCreated).toBe(false);
    expect(result.locality.findings).toEqual([expect.objectContaining({ code: finding })]);
    await coordinator.close();
  });

  it('deduplicates the same generation request id and returns isolated replay copies', async () => {
    const revision = revisionRequest();
    const provider = providerWithReplan(({ packet }) => validDraft(packet));
    const { coordinator } = harness(provider, revision);
    const input = generationRequest(revision);

    const first = await coordinator.generate(input);
    first.draft.plan.title = 'Caller mutation';
    const replay = await coordinator.generate(input);

    expect(replay.draft.plan.title).toBe(basePlan.title);
    expect(provider.replanInputs).toHaveLength(1);
    await coordinator.close();
  });

  it('rejects a request id already claimed by the initial-plan operation', async () => {
    const revision = revisionRequest();
    const input = generationRequest(revision);
    const provider = providerWithReplan(({ packet }) => validDraft(packet));
    const registry = createPlannerProviderRegistry([provider]);
    const manager = createPlannerProviderInvocationManager({
      registry,
      restoredInvocations: [
        {
          requestId: input.requestId,
          operation: 'initial_plan',
          fingerprint: plannerProviderRequestFingerprint(input),
        },
      ],
    });
    const { coordinator, events } = harness(provider, revision, { invocationManager: manager });

    await expectRuntimeError(coordinator.generate(input), 'planner_generation_conflict');

    expect(provider.replanInputs).toHaveLength(0);
    expect(events).toHaveLength(0);
    await coordinator.close();
  });

  it('shares one plan lock across initial generation and local replanning operations', async () => {
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolvePromise) => {
      release = resolvePromise;
    });
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolvePromise) => {
      markStarted = resolvePromise;
    });
    const provider = providerWithReplan(({ packet }) => validDraft(packet), 2);
    const registry = createPlannerProviderRegistry([provider]);
    const manager = createPlannerProviderInvocationManager({ registry });
    const initialRequestId = randomUUID();
    const initial = manager.execute({
      requestId: initialRequestId,
      operation: 'initial_plan',
      fingerprint: plannerProviderRequestFingerprint({ operation: 'initial_plan' }),
      providerId: 'fake-planner',
      planKey: ['blender', basePlan.id],
      requiresReplan: false,
      attempt: async (context) => {
        context.markAttempted();
        return context.invoke(async () => {
          markStarted?.();
          await blocked;
          return { completed: true };
        });
      },
    });
    await started;

    await expectRuntimeError(
      manager.execute({
        requestId: randomUUID(),
        operation: 'local_replan',
        fingerprint: plannerProviderRequestFingerprint({ operation: 'local_replan' }),
        providerId: 'fake-planner',
        planKey: ['blender', basePlan.id],
        requiresReplan: true,
        attempt: () => {
          throw new Error('Busy local replan must not begin');
        },
      }),
      'planner_generation_busy',
    );
    release?.();
    await initial;
    await manager.close();
  });

  it('restores completed replan results without invoking the provider again', async () => {
    const revision = revisionRequest();
    const originalProvider = providerWithReplan(({ packet }) => validDraft(packet));
    const original = harness(originalProvider, revision);
    const input = generationRequest(revision);
    const expected = await original.coordinator.generate(input);
    const storedEvents = asStoredEvents(original.events);
    await original.coordinator.close();

    const restoredProvider = providerWithReplan(() => {
      throw new Error('Restored completion must not invoke provider');
    });
    const restored = harness(restoredProvider, revision, { existingEvents: storedEvents });

    await expect(restored.coordinator.generate(input)).resolves.toEqual(expected);
    expect(restored.coordinator.completedResult(input.requestId)).toEqual(expected);
    expect(restoredProvider.replanInputs).toHaveLength(0);
    await restored.coordinator.close();
  });

  it('rejects forged restored ready replan evidence without coverage or exact versions', async () => {
    const revision = revisionRequest();
    const originalProvider = providerWithReplan(({ packet }) => validDraft(packet));
    const original = harness(originalProvider, revision);
    await original.coordinator.generate(generationRequest(revision));
    const completed = asStoredEvents(original.events).find(
      (event) => event.eventType === 'planning.provider.replan.completed',
    );
    await original.coordinator.close();
    if (completed === undefined) {
      throw new Error('Expected completed planner replan evidence');
    }

    const missingCoverage = structuredClone(completed);
    const missingCoverageResult = (
      missingCoverage.payload as {
        result: {
          draft: { planning: { capabilityCoverage?: unknown } };
          planningQuality: { capabilityCoverage?: unknown };
        };
      }
    ).result;
    delete missingCoverageResult.draft.planning.capabilityCoverage;
    delete missingCoverageResult.planningQuality.capabilityCoverage;
    expect(() => restoreReplanPlannerProviderInvocations([missingCoverage])).toThrow();

    const mismatchedVersion = structuredClone(completed);
    (
      mismatchedVersion.payload as {
        result: { packetFormatVersion: string };
      }
    ).result.packetFormatVersion = '1.0.0';
    expect(() => restoreReplanPlannerProviderInvocations([mismatchedVersion])).toThrow();
  });

  it.each(['planning.provider.replan.requested', 'planning.provider.replan.failed'] as const)(
    'restores at-most-once protection from %s evidence',
    async (eventType) => {
      const revision = revisionRequest();
      const originalProvider = providerWithReplan(() => {
        throw new Error('Intentional replan failure');
      });
      const original = harness(originalProvider, revision);
      const input = generationRequest(revision);
      await expectRuntimeError(original.coordinator.generate(input), 'planner_provider_failed');
      const retained = asStoredEvents(
        original.events.filter((event) => event.eventType === eventType),
      );
      await original.coordinator.close();

      const restoredProvider = providerWithReplan(() => {
        throw new Error('Restored attempt must not invoke provider');
      });
      const restored = harness(restoredProvider, revision, { existingEvents: retained });

      await expectRuntimeError(
        restored.coordinator.generate(input),
        'planner_generation_already_attempted',
      );
      expect(restoredProvider.replanInputs).toHaveLength(0);
      await restored.coordinator.close();
    },
  );

  it('rejects providers that do not implement local replanning before recording evidence', async () => {
    const revision = revisionRequest();
    const provider = new FakePlannerProvider(() => {
      throw new Error('Provider must not be invoked');
    });
    const { coordinator, events, registry } = harness(provider, revision);

    const error = await expectRuntimeError(
      coordinator.generate(generationRequest(revision)),
      'planner_replan_not_supported',
    );

    expect(error.retryMode).toBe('same_request_id');
    expect(provider.inputs).toHaveLength(0);
    expect(events).toHaveLength(0);
    expect(registry.listReplanners()).toMatchObject({
      generationAvailable: false,
      providers: [],
    });
    await coordinator.close();
  });

  it('aborts a timed-out replan and records a terminal safe failure', async () => {
    const revision = revisionRequest();
    let aborted = false;
    const provider = providerWithReplan(
      ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              aborted = true;
              reject(new Error('SECRET provider timeout detail'));
            },
            { once: true },
          );
        }),
    );
    const { coordinator, events } = harness(provider, revision, { timeoutMs: 100 });

    await expectRuntimeError(
      coordinator.generate(generationRequest(revision)),
      'planner_generation_timeout',
    );

    expect(aborted).toBe(true);
    expect(events.at(-1)).toMatchObject({
      eventType: 'planning.provider.replan.failed',
      payload: { error: 'planner_generation_timeout' },
    });
    expect(JSON.stringify(events)).not.toContain('SECRET');
    await coordinator.close();
  });
});
