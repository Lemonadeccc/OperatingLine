import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { blenderActionCatalog } from '@operatingline/blender-action-catalog';
import {
  buildPlanningPromptPacket,
  createPlannerGenerationCoordinator,
  createPlannerProviderRegistry,
  evaluatePlanningQuality,
  PlannerGenerationRuntimeError,
  plannerGenerationErrorResponse,
  restoreInitialPlannerProviderInvocations,
} from '@operatingline/orchestrator';
import type { ExecutionEventInput, StoredExecutionEvent } from '@operatingline/persistence';
import {
  planningContextSchema,
  planningPromptPacketSchema,
  type PlannerGenerateRequest,
  type PlanningPromptPacket,
  type PlanningPromptRequest,
  type PlanningProposalDraft,
} from '@operatingline/protocol';
import { FakePlannerProvider } from '@operatingline/test-kit';
import { describe, expect, it } from 'vitest';

const snowmanFixture = JSON.parse(
  readFileSync(resolve('protocol/fixtures/v1/snowman.plan.json'), 'utf8'),
) as PlanningProposalDraft['plan'];
const requiredPhaseIds = ['geometry', 'materials', 'animation', 'render_setup', 'output'];
const capabilityCoverage = {
  policyVersion: 'catalog_capability_coverage_v1' as const,
  requirements: [
    {
      requirementId: 'complete-snowman',
      statement: 'Create and render the complete snowman.',
      coverage: [
        { capabilityId: 'geometry.primitive_assembly', stepIds: ['snowman.model.head'] },
        { capabilityId: 'output.png_preview', stepIds: ['snowman.render.preview'] },
      ],
    },
  ],
};

function packetFor(request: PlanningPromptRequest): PlanningPromptPacket {
  return buildPlanningPromptPacket(
    planningContextSchema.parse({
      protocolVersion: '1.1.0',
      targetAdapterId: request.targetAdapterId,
      goal: request.goal,
      requestedPlanId: request.planId,
      recommendedRevision: 1,
      catalog: { ...blenderActionCatalog, adapterId: request.targetAdapterId },
      companionStates: [],
      constraints: {
        singleAdapterPlan: true,
        executableActionsMustBeLeaves: true,
        dependenciesMustReferenceExecutableActions: true,
        unknownActionsMustBeRejected: true,
        semanticAnchorsOnly: true,
        immutablePlanRevisions: true,
        humanApprovalRequired: true,
        executionOrder: 'dependsOn_topology_then_order_then_id',
      },
      submission: {
        toolName: 'operatingline.guide.propose',
        targetAdapterId: request.targetAdapterId,
        description: 'Submit only after explicit generation review.',
      },
      qualityGate: {
        toolName: 'operatingline.planning.evaluate',
        baselineVersion: '1.1.0',
        requiredPhaseSelection: 'planner_declared_from_goal',
        description: 'Evaluate the generated draft.',
      },
    }),
  );
}

function validDraft(packet: PlanningPromptPacket): PlanningProposalDraft {
  return {
    targetAdapterId: packet.context.targetAdapterId,
    catalogVersion: packet.context.catalog.catalogVersion,
    planning: { goal: packet.context.goal, requiredPhaseIds, capabilityCoverage },
    plan: {
      ...structuredClone(snowmanFixture),
      id: packet.context.requestedPlanId,
      revision: packet.context.recommendedRevision,
    },
  };
}

function request(overrides: Partial<PlannerGenerateRequest> = {}): PlannerGenerateRequest {
  return {
    requestId: randomUUID(),
    providerId: 'fake-planner',
    targetAdapterId: 'blender',
    catalogVersion: blenderActionCatalog.catalogVersion,
    goal: 'Create a complete beginner-friendly snowman.',
    planId: 'provider-snowman',
    ...overrides,
  };
}

function providerDescriptor(id: string, maxConcurrency: number) {
  return {
    contractVersion: '1.0.0' as const,
    id,
    version: '0.1.0',
    displayName: `Fake Planner ${id}`,
    description: 'Deterministic planner provider used to isolate concurrency controls.',
    availability: { available: true as const },
    limits: { maxConcurrency },
    dataHandling: {
      executionLocation: 'local' as const,
      dataTransmission: 'none' as const,
      credentialManagement: 'provider_managed' as const,
    },
  };
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

function harnessForProviders(
  providers: readonly FakePlannerProvider[],
  options: {
    timeoutMs?: number;
    existingEvents?: readonly StoredExecutionEvent[];
    appendEvent?: (event: ExecutionEventInput, events: ExecutionEventInput[]) => void;
  } = {},
) {
  const events: ExecutionEventInput[] = [];
  const registry = createPlannerProviderRegistry(providers);
  const coordinator = createPlannerGenerationCoordinator({
    registry,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    existingEvents: options.existingEvents ?? [],
    buildPacket: packetFor,
    evaluateDraft: (packet, draft) =>
      evaluatePlanningQuality(
        {
          targetAdapterId: draft.targetAdapterId,
          catalogVersion: draft.catalogVersion,
          goal: draft.planning.goal,
          requiredPhaseIds: draft.planning.requiredPhaseIds,
          capabilityCoverage: draft.planning.capabilityCoverage,
          plan: draft.plan,
        },
        packet.context.catalog,
      ),
    appendEvent: (event) => {
      if (options.appendEvent === undefined) {
        events.push(event);
      } else {
        options.appendEvent(event, events);
      }
    },
  });
  return { coordinator, events, registry };
}

function harness(
  provider: FakePlannerProvider,
  options: Parameters<typeof harnessForProviders>[1] = {},
) {
  return harnessForProviders([provider], options);
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

describe('planner generation coordinator', () => {
  it('rejects duplicate planner provider ids during registry construction', () => {
    const first = new FakePlannerProvider(() => {
      throw new Error('must not invoke');
    });
    const duplicate = new FakePlannerProvider(() => {
      throw new Error('must not invoke');
    });

    expect(() => createPlannerProviderRegistry([first, duplicate])).toThrow(
      'Duplicate planner provider fake-planner',
    );
  });

  it('returns a validated draft without creating or implying a proposal', async () => {
    const provider = new FakePlannerProvider(({ packet }) => validDraft(packet));
    const { coordinator, events, registry } = harness(provider);
    const input = request();

    const result = await coordinator.generate(input);

    expect(result).toMatchObject({
      requestId: input.requestId,
      provider: { id: 'fake-planner', version: '0.1.0' },
      status: 'ready',
      proposalCreated: false,
      draft: { plan: { id: input.planId, revision: 1 } },
      planningQuality: { valid: true },
    });
    expect(provider.inputs).toHaveLength(1);
    expect(planningPromptPacketSchema.parse(provider.inputs[0]?.packet)).toEqual(
      provider.inputs[0]?.packet,
    );
    expect(registry.list()).toMatchObject({ generationAvailable: true });
    expect(events.map((event) => event.eventType)).toEqual([
      'planning.context.generated',
      'planning.prompt.generated',
      'planning.provider.generation.requested',
      'planning.quality.evaluated',
      'planning.provider.generation.completed',
    ]);
    expect(events.some((event) => event.eventType.startsWith('guide.proposal'))).toBe(false);
    await coordinator.close();
    expect(provider.closeCalls).toBe(1);
  });

  it('returns needs_revision for a schema-valid capability draft missing coverage', async () => {
    const provider = new FakePlannerProvider(({ packet }) => {
      const draft = validDraft(packet);
      delete draft.planning.capabilityCoverage;
      return draft;
    });
    const { coordinator } = harness(provider);

    const result = await coordinator.generate(request());

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

  it('fails before packet construction for missing or unavailable providers', async () => {
    let packetBuilds = 0;
    const emptyRegistry = createPlannerProviderRegistry([]);
    const coordinator = createPlannerGenerationCoordinator({
      registry: emptyRegistry,
      existingEvents: [],
      buildPacket: (input) => {
        packetBuilds += 1;
        return packetFor(input);
      },
      evaluateDraft: () => {
        throw new Error('must not evaluate');
      },
      appendEvent: () => undefined,
    });
    const missingError = await expectRuntimeError(
      coordinator.generate(request()),
      'planner_provider_not_found',
    );
    expect(missingError.retryMode).toBe('same_request_id');
    expect(packetBuilds).toBe(0);
    await coordinator.close();

    const unavailable = new FakePlannerProvider(
      () => {
        throw new Error('must not invoke');
      },
      {
        contractVersion: '1.0.0',
        id: 'fake-planner',
        version: '0.1.0',
        displayName: 'Unavailable Planner',
        description: 'Intentionally unavailable for testing.',
        availability: {
          available: false,
          reason: 'not_configured',
          message: 'No provider credential was configured.',
        },
        limits: { maxConcurrency: 1 },
        dataHandling: {
          executionLocation: 'remote',
          dataTransmission: 'provider_managed',
          credentialManagement: 'provider_managed',
        },
      },
    );
    const unavailableHarness = harness(unavailable);
    const unavailableError = await expectRuntimeError(
      unavailableHarness.coordinator.generate(request()),
      'planner_provider_unavailable',
    );
    expect(unavailableError.retryMode).toBe('same_request_id');
    expect(unavailable.inputs).toHaveLength(0);
    expect(unavailableHarness.events).toHaveLength(0);
    await unavailableHarness.coordinator.close();
  });

  it('deduplicates exact requests and rejects conflicting or parallel plan generation', async () => {
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolvePromise) => {
      release = resolvePromise;
    });
    const provider = new FakePlannerProvider(async ({ packet }) => {
      await blocked;
      return validDraft(packet);
    });
    const { coordinator } = harness(provider);
    const firstRequest = request();
    const first = coordinator.generate(firstRequest);
    const duplicate = coordinator.generate(firstRequest);
    await expectRuntimeError(
      coordinator.generate({ ...firstRequest, goal: 'Different input' }),
      'planner_generation_conflict',
    );
    await expectRuntimeError(
      coordinator.generate(request({ planId: firstRequest.planId })),
      'planner_generation_busy',
    );
    release?.();
    const [firstResult, duplicateResult] = await Promise.all([first, duplicate]);
    expect(duplicateResult).toEqual(firstResult);
    expect(provider.inputs).toHaveLength(1);
    await expect(coordinator.generate(firstRequest)).resolves.toEqual(firstResult);
    expect(provider.inputs).toHaveLength(1);
    await coordinator.close();
  });

  it('enforces the declared provider concurrency limit independently of plan locks', async () => {
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolvePromise) => {
      release = resolvePromise;
    });
    let startedCount = 0;
    let markTwoStarted: (() => void) | undefined;
    const twoStarted = new Promise<void>((resolvePromise) => {
      markTwoStarted = resolvePromise;
    });
    const provider = new FakePlannerProvider(
      async ({ packet }) => {
        startedCount += 1;
        if (startedCount === 2) {
          markTwoStarted?.();
        }
        await blocked;
        return validDraft(packet);
      },
      providerDescriptor('fake-planner', 2),
    );
    const { coordinator } = harness(provider);
    const first = coordinator.generate(request({ planId: 'provider-cap-one' }));
    const second = coordinator.generate(request({ planId: 'provider-cap-two' }));
    await twoStarted;

    const busyError = await expectRuntimeError(
      coordinator.generate(request({ planId: 'provider-cap-three' })),
      'planner_generation_busy',
    );
    expect(busyError.retryMode).toBe('same_request_id');
    release?.();
    await Promise.all([first, second]);
    expect(provider.inputs).toHaveLength(2);
    await coordinator.close();
  });

  it('enforces the global concurrency limit independently of provider capacity', async () => {
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolvePromise) => {
      release = resolvePromise;
    });
    let startedCount = 0;
    let markFourStarted: (() => void) | undefined;
    const fourStarted = new Promise<void>((resolvePromise) => {
      markFourStarted = resolvePromise;
    });
    const provider = new FakePlannerProvider(
      async ({ packet }) => {
        startedCount += 1;
        if (startedCount === 4) {
          markFourStarted?.();
        }
        await blocked;
        return validDraft(packet);
      },
      providerDescriptor('fake-planner', 8),
    );
    const { coordinator } = harness(provider);
    const running = Array.from({ length: 4 }, (_value, index) =>
      coordinator.generate(request({ planId: `global-cap-${index + 1}` })),
    );
    await fourStarted;

    await expectRuntimeError(
      coordinator.generate(request({ planId: 'global-cap-five' })),
      'planner_generation_busy',
    );
    release?.();
    await Promise.all(running);
    expect(provider.inputs).toHaveLength(4);
    await coordinator.close();
  });

  it('locks one adapter plan across different providers', async () => {
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolvePromise) => {
      release = resolvePromise;
    });
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolvePromise) => {
      markStarted = resolvePromise;
    });
    const firstProvider = new FakePlannerProvider(
      async ({ packet }) => {
        markStarted?.();
        await blocked;
        return validDraft(packet);
      },
      providerDescriptor('planner-a', 2),
    );
    const secondProvider = new FakePlannerProvider(
      ({ packet }) => validDraft(packet),
      providerDescriptor('planner-b', 2),
    );
    const { coordinator } = harnessForProviders([firstProvider, secondProvider]);
    const planId = 'cross-provider-plan-lock';
    const first = coordinator.generate(request({ providerId: 'planner-a', planId }));
    await started;

    await expectRuntimeError(
      coordinator.generate(request({ providerId: 'planner-b', planId })),
      'planner_generation_busy',
    );
    expect(secondProvider.inputs).toHaveLength(0);
    release?.();
    await first;
    await coordinator.close();
  });

  it('uses collision-free adapter and plan identities for concurrency locks', async () => {
    let startedCount = 0;
    let markTwoStarted: (() => void) | undefined;
    const twoStarted = new Promise<void>((resolvePromise) => {
      markTwoStarted = resolvePromise;
    });
    const provider = new FakePlannerProvider(
      ({ signal }) =>
        new Promise((_resolve, reject) => {
          startedCount += 1;
          if (startedCount === 2) {
            markTwoStarted?.();
          }
          signal.addEventListener('abort', () => reject(new Error('test shutdown')), {
            once: true,
          });
        }),
      providerDescriptor('fake-planner', 2),
    );
    const { coordinator } = harness(provider);
    const first = coordinator.generate(request({ targetAdapterId: 'a', planId: 'b\u0000c' }));
    const second = coordinator.generate(request({ targetAdapterId: 'a\u0000b', planId: 'c' }));
    const firstSettled = first.catch((error: unknown) => error);
    const secondFailedEarly = second.then(
      () => new Error('second generation unexpectedly completed'),
      (error: unknown) => error,
    );

    await Promise.race([
      twoStarted,
      secondFailedEarly.then((error) => {
        throw error;
      }),
    ]);
    expect(provider.inputs).toHaveLength(2);
    await coordinator.close();
    await Promise.all([firstSettled, secondFailedEarly]);
  });

  it('restores completed request idempotency from versioned evidence', async () => {
    const originalProvider = new FakePlannerProvider(({ packet }) => validDraft(packet));
    const original = harness(originalProvider);
    const input = request();
    const expected = await original.coordinator.generate(input);
    const storedEvents = asStoredEvents(original.events);
    await original.coordinator.close();

    const restoredProvider = new FakePlannerProvider(() => {
      throw new Error('restored result must not call provider');
    });
    const restored = harness(restoredProvider, { existingEvents: storedEvents });
    await expect(restored.coordinator.generate(input)).resolves.toEqual(expected);
    expect(restoredProvider.inputs).toHaveLength(0);
    await restored.coordinator.close();
  });

  it('rejects forged restored ready evidence without capability coverage or exact versions', async () => {
    const originalProvider = new FakePlannerProvider(({ packet }) => validDraft(packet));
    const original = harness(originalProvider);
    const input = request();
    await original.coordinator.generate(input);
    const completed = asStoredEvents(original.events).find(
      (event) => event.eventType === 'planning.provider.generation.completed',
    );
    await original.coordinator.close();
    if (completed === undefined) {
      throw new Error('Expected completed planner generation evidence');
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
    expect(() => restoreInitialPlannerProviderInvocations([missingCoverage])).toThrow();

    const mismatchedVersion = structuredClone(completed);
    (
      mismatchedVersion.payload as {
        result: { packetFormatVersion: string };
      }
    ).result.packetFormatVersion = '1.0.0';
    expect(() => restoreInitialPlannerProviderInvocations([mismatchedVersion])).toThrow();
  });

  it.each([
    'planning.provider.generation.requested',
    'planning.provider.generation.failed',
  ] as const)('restores at-most-once protection from %s evidence', async (retainedEventType) => {
    const originalProvider = new FakePlannerProvider(() => {
      throw new Error('intentional provider failure');
    });
    const original = harness(originalProvider);
    const input = request();
    await expectRuntimeError(original.coordinator.generate(input), 'planner_provider_failed');
    const retainedEvidence = asStoredEvents(
      original.events.filter((event) => event.eventType === retainedEventType),
    );
    await original.coordinator.close();

    const restoredProvider = new FakePlannerProvider(() => {
      throw new Error('restored attempt must not invoke provider');
    });
    const restored = harness(restoredProvider, { existingEvents: retainedEvidence });
    await expectRuntimeError(
      restored.coordinator.generate(input),
      'planner_generation_already_attempted',
    );
    await expectRuntimeError(
      restored.coordinator.generate({ ...input, goal: 'different restored input' }),
      'planner_generation_conflict',
    );
    expect(restoredProvider.inputs).toHaveLength(0);
    await restored.coordinator.close();
  });

  it('returns isolated result copies without letting callers mutate replay evidence', async () => {
    const provider = new FakePlannerProvider(({ packet }) => validDraft(packet));
    const { coordinator, events } = harness(provider);
    const input = request();

    const first = await coordinator.generate(input);
    first.draft.plan.id = 'caller-mutated-plan-id';
    const replay = await coordinator.generate(input);

    expect(replay.draft.plan.id).toBe(input.planId);
    expect(JSON.stringify(events)).not.toContain('caller-mutated-plan-id');
    expect(provider.inputs).toHaveLength(1);
    await coordinator.close();
  });

  it('returns needs_revision for catalog-invalid nested arguments', async () => {
    const provider = new FakePlannerProvider(({ packet }) => {
      const draft = validDraft(packet);
      const executable = draft.plan.steps.find(
        (step) => step.action?.name === 'blender.mesh.create_uv_sphere',
      );
      if (executable?.action === null || executable === undefined) {
        throw new Error('fixture has no executable step');
      }
      executable.action.arguments['radius'] = 'not-a-number';
      return draft;
    });
    const { coordinator } = harness(provider);
    const result = await coordinator.generate(request());
    expect(result.status).toBe('needs_revision');
    expect(result.planningQuality).toMatchObject({
      valid: false,
      findings: [
        expect.objectContaining({
          code: 'plan.catalog_contract',
          message: expect.stringContaining('radius must be number'),
        }),
      ],
    });
    await coordinator.close();
  });

  it('rejects invalid or identity-changing output without persisting raw provider data', async () => {
    const invalidProvider = new FakePlannerProvider(({ packet }) => ({
      ...validDraft(packet),
      privateReasoning: 'must not persist',
    }));
    const invalid = harness(invalidProvider);
    await expectRuntimeError(invalid.coordinator.generate(request()), 'planner_output_invalid');
    expect(JSON.stringify(invalid.events)).not.toContain('privateReasoning');
    await invalid.coordinator.close();

    const identityProvider = new FakePlannerProvider(({ packet }) => ({
      ...validDraft(packet),
      plan: { ...validDraft(packet).plan, id: 'provider-changed-plan-id' },
    }));
    const identity = harness(identityProvider);
    await expectRuntimeError(identity.coordinator.generate(request()), 'planner_identity_mismatch');
    await identity.coordinator.close();

    const secretProvider = new FakePlannerProvider(() => {
      throw new Error('Authorization: Bearer SHOULD_NOT_LEAK');
    });
    const secret = harness(secretProvider);
    const input = request();
    const error = await expectRuntimeError(
      secret.coordinator.generate(input),
      'planner_provider_failed',
    );
    const response = plannerGenerationErrorResponse(error, input.requestId);
    expect(JSON.stringify({ response, events: secret.events })).not.toContain('SHOULD_NOT_LEAK');
    await secret.coordinator.close();
  });

  it('isolates deterministic validation from provider mutations of its packet copy', async () => {
    const provider = new FakePlannerProvider(({ packet }) => {
      const mutableContext = packet.context as { requestedPlanId: string };
      mutableContext.requestedPlanId = 'provider-mutated-plan-id';
      return validDraft(packet);
    });
    const { coordinator } = harness(provider);

    await expectRuntimeError(coordinator.generate(request()), 'planner_identity_mismatch');
    await coordinator.close();
  });

  it('reports requested-evidence failures safely before invoking a provider', async () => {
    const provider = new FakePlannerProvider(({ packet }) => validDraft(packet));
    const { coordinator, events } = harness(provider, {
      appendEvent: (event, recorded) => {
        if (event.eventType === 'planning.provider.generation.requested') {
          throw new Error('sqlite path and SECRET must not escape');
        }
        recorded.push(event);
      },
    });
    const input = request();

    const error = await expectRuntimeError(
      coordinator.generate(input),
      'planner_persistence_failed',
    );

    expect(error.retryMode).toBe('same_request_id');
    expect(provider.inputs).toHaveLength(0);
    expect(events.map((event) => event.eventType)).toEqual([
      'planning.context.generated',
      'planning.prompt.generated',
    ]);
    expect(JSON.stringify(plannerGenerationErrorResponse(error, input.requestId))).not.toContain(
      'SECRET',
    );
    await coordinator.close();
  });

  it('records a safe terminal failure when completed evidence cannot be persisted', async () => {
    const provider = new FakePlannerProvider(({ packet }) => validDraft(packet));
    const { coordinator, events } = harness(provider, {
      appendEvent: (event, recorded) => {
        if (event.eventType === 'planning.provider.generation.completed') {
          throw new Error('completed persistence SECRET');
        }
        recorded.push(event);
      },
    });
    const input = request();

    const error = await expectRuntimeError(
      coordinator.generate(input),
      'planner_persistence_failed',
    );

    expect(error.retryMode).toBe('new_request_id');
    expect(events.map((event) => event.eventType)).toEqual([
      'planning.context.generated',
      'planning.prompt.generated',
      'planning.provider.generation.requested',
      'planning.quality.evaluated',
      'planning.provider.generation.failed',
    ]);
    expect(events.at(-1)?.payload).toMatchObject({ error: 'planner_persistence_failed' });
    await expectRuntimeError(coordinator.generate(input), 'planner_generation_already_attempted');
    await coordinator.close();
  });

  it('sanitizes a failed-evidence persistence error after provider failure', async () => {
    const provider = new FakePlannerProvider(() => {
      throw new Error('provider SECRET');
    });
    const { coordinator, events } = harness(provider, {
      appendEvent: (event, recorded) => {
        if (event.eventType === 'planning.provider.generation.failed') {
          throw new Error('failed persistence SECRET');
        }
        recorded.push(event);
      },
    });
    const input = request();

    const error = await expectRuntimeError(
      coordinator.generate(input),
      'planner_persistence_failed',
    );

    expect(error.retryMode).toBe('new_request_id');
    expect(
      JSON.stringify({ error: plannerGenerationErrorResponse(error, input.requestId), events }),
    ).not.toContain('SECRET');
    expect(events.map((event) => event.eventType)).toEqual([
      'planning.context.generated',
      'planning.prompt.generated',
      'planning.provider.generation.requested',
    ]);
    await coordinator.close();
  });

  it('aborts timeouts, records no late success, and closes providers once', async () => {
    let aborted = false;
    const provider = new FakePlannerProvider(
      ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              aborted = true;
              reject(new Error('late secret failure'));
            },
            { once: true },
          );
        }),
    );
    const { coordinator, events } = harness(provider, { timeoutMs: 100 });
    const timeoutError = await expectRuntimeError(
      coordinator.generate(request()),
      'planner_generation_timeout',
    );
    expect(timeoutError.retryMode).toBe('new_request_id');
    expect(aborted).toBe(true);
    expect(events.map((event) => event.eventType)).toEqual([
      'planning.context.generated',
      'planning.prompt.generated',
      'planning.provider.generation.requested',
      'planning.provider.generation.failed',
    ]);
    await coordinator.close();
    await coordinator.close();
    expect(provider.closeCalls).toBe(1);
  });

  it('waits for an aborted generation failure event before closing its provider once', async () => {
    let markProviderStarted: (() => void) | undefined;
    const providerStarted = new Promise<void>((resolvePromise) => {
      markProviderStarted = resolvePromise;
    });
    let aborted = false;
    let releaseProviderClose: (() => void) | undefined;
    const providerCloseGate = new Promise<void>((resolvePromise) => {
      releaseProviderClose = resolvePromise;
    });
    let markProviderCloseStarted: (() => void) | undefined;
    const providerCloseStarted = new Promise<void>((resolvePromise) => {
      markProviderCloseStarted = resolvePromise;
    });
    const provider = new FakePlannerProvider(
      ({ signal }) =>
        new Promise((_resolve, reject) => {
          markProviderStarted?.();
          signal.addEventListener(
            'abort',
            () => {
              aborted = true;
              reject(new Error('provider stopped'));
            },
            { once: true },
          );
        }),
    );
    provider.close = async () => {
      provider.closeCalls += 1;
      markProviderCloseStarted?.();
      await providerCloseGate;
    };
    const { coordinator, events } = harness(provider);
    const generation = coordinator.generate(request()).then(
      () => null,
      (error: unknown) => error,
    );
    await providerStarted;

    const firstClose = coordinator.close();
    const firstCloseOutcome = firstClose.then(() => true);
    await providerCloseStarted;
    const secondClose = coordinator.close();
    expect(secondClose).toBe(firstClose);
    let secondCloseSettled = false;
    void secondClose.then(() => {
      secondCloseSettled = true;
    });
    await Promise.resolve();
    expect(secondCloseSettled).toBe(false);
    expect(events.map((event) => event.eventType)).toEqual([
      'planning.context.generated',
      'planning.prompt.generated',
      'planning.provider.generation.requested',
      'planning.provider.generation.failed',
    ]);
    releaseProviderClose?.();
    await expect(firstCloseOutcome).resolves.toBe(true);
    await secondClose;
    const error = await generation;

    expect(error).toBeInstanceOf(PlannerGenerationRuntimeError);
    expect((error as PlannerGenerationRuntimeError).code).toBe('planner_runtime_stopping');
    expect((error as PlannerGenerationRuntimeError).retryMode).toBe('new_request_id');
    expect(aborted).toBe(true);
    expect(events.map((event) => event.eventType)).toEqual([
      'planning.context.generated',
      'planning.prompt.generated',
      'planning.provider.generation.requested',
      'planning.provider.generation.failed',
    ]);
    expect(provider.closeCalls).toBe(1);
  });

  it('sanitizes provider close failures and replays the same close outcome', async () => {
    const provider = new FakePlannerProvider(() => {
      throw new Error('must not generate');
    });
    provider.close = () => {
      provider.closeCalls += 1;
      throw new Error('Authorization: Bearer CLOSE_SECRET');
    };
    const { coordinator } = harness(provider);

    const firstClose = coordinator.close();
    const secondClose = coordinator.close();
    expect(secondClose).toBe(firstClose);
    const [firstOutcome, secondOutcome] = await Promise.allSettled([firstClose, secondClose]);

    expect(firstOutcome.status).toBe('rejected');
    expect(secondOutcome.status).toBe('rejected');
    expect(String(firstOutcome.status === 'rejected' ? firstOutcome.reason : '')).toContain(
      'Planner provider fake-planner failed to close',
    );
    expect(JSON.stringify([firstOutcome, secondOutcome])).not.toContain('CLOSE_SECRET');
    expect(provider.closeCalls).toBe(1);
  });

  it('bounds hanging provider closes and still closes other providers in parallel', async () => {
    const hangingProvider = new FakePlannerProvider(
      () => {
        throw new Error('must not generate');
      },
      providerDescriptor('hanging-planner', 1),
    );
    hangingProvider.close = () => {
      hangingProvider.closeCalls += 1;
      return new Promise<void>(() => undefined);
    };
    const healthyProvider = new FakePlannerProvider(
      () => {
        throw new Error('must not generate');
      },
      providerDescriptor('healthy-planner', 1),
    );
    const registry = createPlannerProviderRegistry([hangingProvider, healthyProvider], {
      closeTimeoutMs: 100,
    });

    const outcome = await registry.close().then(
      () => null,
      (error: unknown) => error,
    );

    expect(String(outcome)).toContain(
      'Planner provider hanging-planner timed out while closing after 100ms',
    );
    expect(hangingProvider.closeCalls).toBe(1);
    expect(healthyProvider.closeCalls).toBe(1);
  });
});
