import { createHash } from 'node:crypto';

import type { ExecutionEventInput, StoredExecutionEvent } from '@operatingline/persistence';
import {
  canonicalizeProtocolJsonValue,
  plannerProviderDescriptorSchema,
} from '@operatingline/protocol';
import type * as ProtocolModule from '@operatingline/protocol';
import { describe, expect, it, vi } from 'vitest';

import type * as MediaRunProtocolModule from '../../../packages/protocol/src/procedure-tutorial-media-authoring-run.js';

const { pass } = vi.hoisted(() => ({
  pass: {
    parse: <T>(value: T) => value,
    safeParse: <T>(value: T) => ({ success: true as const, data: value }),
  },
}));

vi.mock('@operatingline/protocol', async (importOriginal) => {
  const actual = await importOriginal<typeof ProtocolModule>();
  return {
    ...actual,
    procedureAuthoringGenerationCompletedEventSchema: pass,
    procedureAuthoringGenerationResultSchema: pass,
    procedureAuthoringMaterializationResultSchema: pass,
    procedureTreeStoreResultSchema: pass,
  };
});

vi.mock(
  '../../../packages/protocol/src/procedure-tutorial-media-authoring-run.js',
  async (importOriginal) => {
    const actual = await importOriginal<typeof MediaRunProtocolModule>();
    return {
      ...actual,
      procedureTutorialMediaAuthoringBindingSchema: pass,
      procedureTutorialMediaAuthoringCompletedEventSchema: pass,
      procedureTutorialMediaAuthoringDiscardedEventSchema: pass,
      procedureTutorialMediaAuthoringFailedEventSchema: pass,
      procedureTutorialMediaAuthoringRecoveryRequiredEventSchema: pass,
      procedureTutorialMediaAuthoringRequestedEventSchema: pass,
      procedureTutorialMediaAuthoringResumedEventSchema: pass,
      procedureTutorialMediaAuthoringReviewRequiredEventSchema: pass,
      procedureTutorialMediaAuthoringReviewedEventSchema: pass,
      procedureTutorialMediaAuthoringReviewRequestSchema: pass,
      procedureTutorialMediaAuthoringRunCreateRequestSchema: pass,
      procedureTutorialMediaAuthoringRunStatusSchema: pass,
      procedureTutorialMediaAuthoringStageEventSchema: pass,
    };
  },
);

import { plannerProviderRequestFingerprint } from '../../../services/orchestrator/src/planner-provider-invocation.js';
import { createProcedureTutorialMediaAuthoringRunCoordinator } from '../../../services/orchestrator/src/procedure-tutorial-media-authoring-run.js';

const ids = {
  request: '11111111-1111-4111-8111-111111111111',
  run: '22222222-2222-4222-8222-222222222222',
  analysis: '33333333-3333-4333-8333-333333333333',
  job: '44444444-4444-4444-8444-444444444444',
  generation: '55555555-5555-4555-8555-555555555555',
  generated: '66666666-6666-4666-8666-666666666666',
  review: '77777777-7777-4777-8777-777777777777',
} as const;

const mediaSource = {
  kind: 'authorized_youtube_download' as const,
  videoId: 'abcdefghijk',
  sourceIdentitySha256: '0'.repeat(64),
  contentSha256: '1'.repeat(64),
  rightsBasis: 'rights_holder_permission' as const,
  platformDownloadValidation: {
    authorityId: 'youtube-platform-authority-fixture',
    authorityKind: 'youtube_platform_authority',
    sideEffect: 'youtube_media_download',
    receiptContentSha256: '2'.repeat(64),
    authorityContentSha256: '3'.repeat(64),
  },
  rightsValidation: {
    authorityId: 'rights-authority-fixture',
    authorityKind: 'media_rights_authority',
    sideEffect: 'rights_validation',
    receiptContentSha256: '4'.repeat(64),
    authorityContentSha256: '5'.repeat(64),
  },
};

const descriptor = plannerProviderDescriptorSchema.parse({
  contractVersion: '1.0.0',
  id: 'procedure-author',
  version: '1.0.0',
  displayName: 'Procedure author',
  description: 'Test Provider.',
  availability: { available: true },
  limits: { maxConcurrency: 1 },
  dataHandling: {
    executionLocation: 'local',
    dataTransmission: 'none',
    credentialManagement: 'provider_managed',
  },
});

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalizeProtocolJsonValue(value)).digest('hex');
}

function request() {
  return {
    formatVersion: '1.1.0' as const,
    requestId: ids.request,
    preparation: {
      formatVersion: '1.1.0',
      status: 'ready',
      analysisRequestId: ids.analysis,
      analysisJobId: ids.job,
      analysisFingerprint: 'a'.repeat(64),
      fingerprint: 'b'.repeat(64),
      source: mediaSource,
      packet: { integrity: { contentSha256: 'c'.repeat(64) } },
    },
    provider: {
      generationRequestId: ids.generation,
      authorization: {
        providerDescriptor: descriptor,
        explicitlyConfirmedByUser: true,
        dataHandlingAcknowledged: true,
        possibleProviderCostAcknowledged: true,
        confirmedAt: '2026-08-21T08:00:00Z',
      },
    },
  };
}

function stored(input: ExecutionEventInput, sequence: number): StoredExecutionEvent {
  return {
    sequence,
    id: input.id,
    eventType: input.eventType,
    payload: structuredClone(input.payload),
    createdAt: input.createdAt!,
  };
}

function replayOptions(existingEvents: StoredExecutionEvent[]) {
  return {
    currentPreparation: () => request().preparation as never,
    generateFromPacket: vi.fn(async () => generation),
    completedGenerationEvidence: () => generationEvidence as never,
    materialize: vi.fn(() => materialization),
    storeWithBinding: vi.fn(),
    restoreStored: vi.fn(() => ({ status: 'absent' as const })),
    findProcedureAuthor: () => descriptor,
    existingEvents,
    appendEvent: vi.fn((input: ExecutionEventInput) => stored(input, existingEvents.length + 1)),
    now: () => '2026-08-21T09:00:00Z',
  };
}

const candidateTree = { candidate: true };
const materializedTree = { id: 'tree-1', revision: 1, materialized: true };
const generation = {
  requestId: ids.generation,
  generationId: ids.generated,
  provider: { id: descriptor.id, version: descriptor.version },
  packet: request().preparation.packet,
  tree: candidateTree,
};
const materialization = {
  packetContentSha256: request().preparation.packet.integrity.contentSha256,
  inputTreeContentSha256: sha256(candidateTree),
  outputTreeContentSha256: sha256(materializedTree),
  tree: materializedTree,
  compilation: {},
};
const storage = {
  result: 'accepted' as const,
  record: {
    tree: materializedTree,
    integrity: { contentSha256: materialization.outputTreeContentSha256 },
  },
  validation: {},
  proposalCreated: false as const,
  hostExecutionStarted: false as const,
};
const generationEvidence = {
  eventId: `procedure-authoring-generation-completed:${ids.generation}`,
  event: {
    inputMode: 'prepared_packet',
    request: {
      requestId: ids.generation,
      providerId: descriptor.id,
      packetContentSha256: request().preparation.packet.integrity.contentSha256,
    },
    requestFingerprint: plannerProviderRequestFingerprint({
      requestId: ids.generation,
      providerId: descriptor.id,
      packet: request().preparation.packet,
    }),
    result: generation,
  },
};

function storeReview(runId: string, reviewId: string) {
  return {
    formatVersion: '1.0.0' as const,
    requestId: ids.request,
    runId,
    reviewId,
    review: {
      decision: 'store' as const,
      preparationFingerprint: request().preparation.fingerprint,
      packetContentSha256: request().preparation.packet.integrity.contentSha256,
      candidateTreeContentSha256: materialization.inputTreeContentSha256,
      materializedTreeContentSha256: materialization.outputTreeContentSha256,
      confirmations: {
        exactPreparationReviewed: true as const,
        exactPacketReviewed: true as const,
        exactCandidateTreeReviewed: true as const,
        exactMaterializedTreeReviewed: true as const,
      },
    },
    reviewedAt: '2026-08-21T09:00:00Z',
  };
}

function baseHistory() {
  const input = request();
  const scope = {
    formatVersion: '1.1.0',
    requestId: ids.request,
    requestFingerprint: plannerProviderRequestFingerprint(input),
    runId: ids.run,
    mediaSource,
  };
  const make = (
    sequence: number,
    suffix: string,
    occurredAt: string,
    payload: Record<string, unknown>,
  ): StoredExecutionEvent => ({
    sequence,
    id: `procedure-tutorial-media-authoring-${suffix.replaceAll('.', '-')}:${ids.run}:${crypto.randomUUID()}`,
    eventType: `procedure.tutorial.media.authoring.${suffix}`,
    payload: { ...scope, occurredAt, ...payload },
    createdAt: occurredAt,
  });
  return {
    scope,
    make,
    requested: make(1, 'requested', '2026-08-21T08:00:00Z', { request: input }),
  };
}

describe('procedure tutorial media authoring strict recovery', () => {
  it('locks an outcome-unknown requested append against same-process retry', () => {
    const events: StoredExecutionEvent[] = [];
    const options = replayOptions(events);
    options.appendEvent.mockImplementation((input) => {
      const value = stored(input, events.length + 1);
      events.push(value);
      return { ...value, id: `untrusted:${value.id}` };
    });
    const coordinator = createProcedureTutorialMediaAuthoringRunCoordinator(options);

    expect(() => coordinator.create(request() as never)).toThrowError(
      expect.objectContaining({ code: 'authoring_persistence_failed', statusCode: 500 }),
    );
    expect(() => coordinator.create(request() as never)).toThrowError(
      expect.objectContaining({ code: 'authoring_persistence_failed', statusCode: 500 }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe('procedure.tutorial.media.authoring.requested');
    expect(options.generateFromPacket).not.toHaveBeenCalled();
  });

  it.each([
    ['failed', 'procedure.tutorial.media.authoring.failed'],
    ['recovery', 'procedure.tutorial.media.authoring.recovery.required'],
  ] as const)(
    'observes a background task when its %s evidence append also fails',
    async (mode, failingEventType) => {
      const events: StoredExecutionEvent[] = [];
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => unhandled.push(reason);
      process.on('unhandledRejection', onUnhandled);
      try {
        const options = replayOptions(events);
        if (mode === 'failed') {
          options.generateFromPacket.mockRejectedValue(new Error('Provider failed'));
        } else {
          options.materialize.mockImplementation(() => {
            throw new Error('Materialization failed');
          });
        }
        options.appendEvent.mockImplementation((input) => {
          if (input.eventType === failingEventType) throw new Error('evidence append failed');
          const value = stored(input, events.length + 1);
          events.push(value);
          return value;
        });
        const coordinator = createProcedureTutorialMediaAuthoringRunCoordinator(options);
        const accepted = coordinator.create(request() as never);

        await new Promise<void>((resolve) => setImmediate(resolve));

        expect(unhandled).toEqual([]);
        expect(() =>
          coordinator.status({
            formatVersion: '1.0.0',
            requestId: ids.request,
            runId: accepted.runId,
          }),
        ).toThrowError(
          expect.objectContaining({ code: 'authoring_persistence_failed', statusCode: 500 }),
        );
        await coordinator.close();
      } finally {
        process.off('unhandledRejection', onUnhandled);
      }
    },
  );

  it('does not append a second terminal event when closing failure has an outcome-unknown envelope', async () => {
    const events: StoredExecutionEvent[] = [];
    let closeDuringCreate = false;
    const runtime: {
      coordinator?: ReturnType<typeof createProcedureTutorialMediaAuthoringRunCoordinator>;
    } = {};
    const options = replayOptions(events);
    options.appendEvent.mockImplementation((input) => {
      const value = stored(input, events.length + 1);
      events.push(value);
      if (input.eventType === 'procedure.tutorial.media.authoring.failed')
        return { ...value, id: `untrusted:${value.id}` };
      return value;
    });
    const coordinator = createProcedureTutorialMediaAuthoringRunCoordinator({
      ...options,
      now: () => {
        if (closeDuringCreate) runtime.coordinator?.beginClose();
        return '2026-08-21T09:00:00Z';
      },
    });
    runtime.coordinator = coordinator;
    closeDuringCreate = true;

    expect(() => coordinator.create(request() as never)).toThrowError(
      expect.objectContaining({ code: 'authoring_persistence_failed', statusCode: 500 }),
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    await coordinator.close();
    expect(
      events.filter((value) => value.eventType === 'procedure.tutorial.media.authoring.failed'),
    ).toHaveLength(1);
    expect(options.generateFromPacket).not.toHaveBeenCalled();
  });

  it('recovers exact durable generation evidence after the outer completion crash window without recalling the Provider', async () => {
    const events: StoredExecutionEvent[] = [];
    const generateFromPacket = vi.fn(async () => generation);
    let providerStageCompletionAttempts = 0;
    const crashed = createProcedureTutorialMediaAuthoringRunCoordinator({
      ...replayOptions(events),
      generateFromPacket,
      appendEvent: (input) => {
        if (
          input.eventType === 'procedure.tutorial.media.authoring.stage.completed' &&
          providerStageCompletionAttempts++ === 0
        ) {
          throw new Error('simulated process crash');
        }
        const value = stored(input, events.length + 1);
        events.push(value);
        return value;
      },
    });

    const accepted = crashed.create(request() as never);
    await new Promise<void>((resolve) => setImmediate(resolve));
    await crashed.close();
    expect(generateFromPacket).toHaveBeenCalledTimes(1);
    expect(() =>
      crashed.status({
        formatVersion: '1.0.0',
        requestId: ids.request,
        runId: accepted.runId,
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'authoring_persistence_failed', statusCode: 500 }),
    );
    expect(events).not.toContainEqual(
      expect.objectContaining({ eventType: 'procedure.tutorial.media.authoring.failed' }),
    );
    expect(events.map((value) => value.eventType)).toEqual([
      'procedure.tutorial.media.authoring.requested',
      'procedure.tutorial.media.authoring.stage.started',
    ]);

    const restartedOptions = {
      ...replayOptions(events),
      generateFromPacket,
    };
    const restarted = createProcedureTutorialMediaAuthoringRunCoordinator(restartedOptions);

    const recovery = restarted.status({
      formatVersion: '1.0.0',
      requestId: ids.request,
      runId: accepted.runId,
    });
    expect(recovery).toMatchObject({
      status: 'recovery_required',
      completedStages: ['provider_generation'],
      retryFromStage: 'materialization',
    });
    if (recovery.status !== 'recovery_required') throw new Error('Expected local recovery');
    expect(
      restarted.resume({
        formatVersion: '1.0.0',
        requestId: ids.request,
        runId: accepted.runId,
        recoveryId: recovery.recoveryId,
        retryFromStage: 'materialization',
      }),
    ).toMatchObject({ status: 'awaiting_review' });
    expect(restartedOptions.materialize).toHaveBeenCalledWith({
      packet: request().preparation.packet,
      tree: candidateTree,
    });
    expect(generateFromPacket).toHaveBeenCalledTimes(1);
  });

  it('rejects mismatched durable generation evidence in the outer completion crash window', () => {
    const history = baseHistory();
    const events = [
      history.requested,
      history.make(2, 'stage.started', '2026-08-21T08:00:01Z', {
        stage: 'provider_generation',
        state: 'started',
      }),
    ];
    const options = replayOptions(events);
    options.completedGenerationEvidence = () =>
      ({
        ...generationEvidence,
        event: {
          ...generationEvidence.event,
          requestFingerprint: 'f'.repeat(64),
        },
      }) as never;

    expect(() => createProcedureTutorialMediaAuthoringRunCoordinator(options)).toThrow(
      'generation evidence does not bind the exact preparation and Provider result',
    );
    expect(options.generateFromPacket).not.toHaveBeenCalled();
    expect(options.appendEvent).not.toHaveBeenCalled();
  });

  it('reconstructs review after its first append fails without repeating Provider or materialization', async () => {
    const events: StoredExecutionEvent[] = [];
    const generateFromPacket = vi.fn(async () => generation);
    const materialize = vi.fn(() => materialization);
    let reviewCheckpointAttempts = 0;
    const crashed = createProcedureTutorialMediaAuthoringRunCoordinator({
      ...replayOptions(events),
      generateFromPacket,
      materialize,
      appendEvent: (input) => {
        if (
          input.eventType === 'procedure.tutorial.media.authoring.review.required' &&
          reviewCheckpointAttempts++ === 0
        ) {
          throw new Error('simulated review checkpoint crash');
        }
        const value = stored(input, events.length + 1);
        events.push(value);
        return value;
      },
    });

    const accepted = crashed.create(request() as never);
    await new Promise<void>((resolve) => setImmediate(resolve));
    await crashed.close();
    expect(() =>
      crashed.status({
        formatVersion: '1.0.0',
        requestId: ids.request,
        runId: accepted.runId,
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'authoring_persistence_failed', statusCode: 500 }),
    );
    expect(events).not.toContainEqual(
      expect.objectContaining({
        eventType: expect.stringMatching(/\.(?:recovery\.required|failed)$/),
      }),
    );

    const restartedOptions = {
      ...replayOptions(events),
      generateFromPacket,
      materialize,
    };
    const restarted = createProcedureTutorialMediaAuthoringRunCoordinator(restartedOptions);

    expect(
      restarted.status({
        formatVersion: '1.0.0',
        requestId: ids.request,
        runId: accepted.runId,
      }),
    ).toMatchObject({
      status: 'awaiting_review',
      completedStages: ['provider_generation', 'materialization'],
    });
    expect(restartedOptions.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'procedure.tutorial.media.authoring.review.required',
      }),
    );
    expect(generateFromPacket).toHaveBeenCalledTimes(1);
    expect(materialize).toHaveBeenCalledTimes(1);
  });

  it('does not append recovery when materialization completion has an outcome-unknown envelope', async () => {
    const events: StoredExecutionEvent[] = [];
    const generateFromPacket = vi.fn(async () => generation);
    const materialize = vi.fn(() => materialization);
    const options = {
      ...replayOptions(events),
      generateFromPacket,
      materialize,
      appendEvent: (input: ExecutionEventInput) => {
        const value = stored(input, events.length + 1);
        events.push(value);
        const payload = input.payload as { stage?: string };
        if (
          input.eventType === 'procedure.tutorial.media.authoring.stage.completed' &&
          payload.stage === 'materialization'
        ) {
          return { ...value, id: `untrusted:${value.id}` };
        }
        return value;
      },
    };
    const coordinator = createProcedureTutorialMediaAuthoringRunCoordinator(options);
    const accepted = coordinator.create(request() as never);
    await new Promise<void>((resolve) => setImmediate(resolve));
    await coordinator.close();

    expect(events).not.toContainEqual(
      expect.objectContaining({
        eventType: expect.stringMatching(/\.(?:recovery\.required|failed)$/),
      }),
    );
    expect(() =>
      coordinator.status({
        formatVersion: '1.0.0',
        requestId: ids.request,
        runId: accepted.runId,
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'authoring_persistence_failed', statusCode: 500 }),
    );

    const replay = replayOptions(events);
    replay.generateFromPacket = generateFromPacket;
    replay.materialize = materialize;
    expect(
      createProcedureTutorialMediaAuthoringRunCoordinator(replay).status({
        formatVersion: '1.0.0',
        requestId: ids.request,
        runId: accepted.runId,
      }),
    ).toMatchObject({ status: 'awaiting_review' });
    expect(generateFromPacket).toHaveBeenCalledTimes(1);
    expect(materialize).toHaveBeenCalledTimes(1);
  });

  it('reconstructs review after resume persists materialization but its review append fails', async () => {
    const events: StoredExecutionEvent[] = [];
    const generateFromPacket = vi.fn(async () => generation);
    const materialize = vi.fn(() => materialization);
    let materializationStartAttempts = 0;
    let reviewCheckpointAttempts = 0;
    const options = {
      ...replayOptions(events),
      generateFromPacket,
      materialize,
      appendEvent: (input: ExecutionEventInput) => {
        const payload = input.payload as { stage?: string };
        if (
          input.eventType === 'procedure.tutorial.media.authoring.stage.started' &&
          payload.stage === 'materialization' &&
          materializationStartAttempts++ === 0
        ) {
          throw new Error('simulated materialization start checkpoint crash');
        }
        if (
          input.eventType === 'procedure.tutorial.media.authoring.review.required' &&
          reviewCheckpointAttempts++ === 0
        ) {
          throw new Error('simulated review checkpoint crash during resume');
        }
        const value = stored(input, events.length + 1);
        events.push(value);
        return value;
      },
    };
    const coordinator = createProcedureTutorialMediaAuthoringRunCoordinator(options);
    const accepted = coordinator.create(request() as never);
    await coordinator.close();
    const recovery = coordinator.status({
      formatVersion: '1.0.0',
      requestId: ids.request,
      runId: accepted.runId,
    });
    if (recovery.status !== 'recovery_required') throw new Error('Expected local recovery');
    const recoveryEventsBeforeResume = events.filter(
      (value) => value.eventType === 'procedure.tutorial.media.authoring.recovery.required',
    ).length;

    expect(() =>
      coordinator.resume({
        formatVersion: '1.0.0',
        requestId: ids.request,
        runId: accepted.runId,
        recoveryId: recovery.recoveryId,
        retryFromStage: 'materialization',
      }),
    ).toThrow('evidence could not be persisted');

    expect(
      events.filter(
        (value) => value.eventType === 'procedure.tutorial.media.authoring.recovery.required',
      ),
    ).toHaveLength(recoveryEventsBeforeResume);
    expect(events).not.toContainEqual(
      expect.objectContaining({ eventType: 'procedure.tutorial.media.authoring.failed' }),
    );
    expect(() =>
      coordinator.status({
        formatVersion: '1.0.0',
        requestId: ids.request,
        runId: accepted.runId,
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'authoring_persistence_failed', statusCode: 500 }),
    );

    const restartedOptions = {
      ...replayOptions(events),
      generateFromPacket,
      materialize,
    };
    const restarted = createProcedureTutorialMediaAuthoringRunCoordinator(restartedOptions);
    expect(
      restarted.status({
        formatVersion: '1.0.0',
        requestId: ids.request,
        runId: accepted.runId,
      }),
    ).toMatchObject({
      status: 'awaiting_review',
      completedStages: ['provider_generation', 'materialization'],
    });
    expect(generateFromPacket).toHaveBeenCalledTimes(1);
    expect(materialize).toHaveBeenCalledTimes(1);
  });

  it('enters storage recovery when review cannot persist the storage start checkpoint', async () => {
    const events: StoredExecutionEvent[] = [];
    const options = replayOptions(events);
    options.appendEvent.mockImplementation((input) => {
      const payload = input.payload as { stage?: string };
      if (
        input.eventType === 'procedure.tutorial.media.authoring.stage.started' &&
        payload.stage === 'storage'
      ) {
        throw new Error('storage start append failed');
      }
      const value = stored(input, events.length + 1);
      events.push(value);
      return value;
    });
    const coordinator = createProcedureTutorialMediaAuthoringRunCoordinator(options);
    const accepted = coordinator.create(request() as never);
    await coordinator.close();
    const awaiting = coordinator.status({
      formatVersion: '1.0.0',
      requestId: ids.request,
      runId: accepted.runId,
    });
    if (awaiting.status !== 'awaiting_review') throw new Error('Expected review checkpoint');

    expect(
      coordinator.review(storeReview(accepted.runId, awaiting.reviewId) as never),
    ).toMatchObject({ status: 'recovery_required', retryFromStage: 'storage' });
    expect(options.storeWithBinding).not.toHaveBeenCalled();
  });

  it('surfaces a volatile fault when storage start and recovery evidence both fail', async () => {
    const events: StoredExecutionEvent[] = [];
    const options = replayOptions(events);
    options.appendEvent.mockImplementation((input) => {
      const payload = input.payload as { stage?: string };
      if (
        (input.eventType === 'procedure.tutorial.media.authoring.stage.started' &&
          payload.stage === 'storage') ||
        input.eventType === 'procedure.tutorial.media.authoring.recovery.required'
      ) {
        throw new Error('storage recovery persistence failed');
      }
      const value = stored(input, events.length + 1);
      events.push(value);
      return value;
    });
    const coordinator = createProcedureTutorialMediaAuthoringRunCoordinator(options);
    const accepted = coordinator.create(request() as never);
    await coordinator.close();
    const awaiting = coordinator.status({
      formatVersion: '1.0.0',
      requestId: ids.request,
      runId: accepted.runId,
    });
    if (awaiting.status !== 'awaiting_review') throw new Error('Expected review checkpoint');

    expect(() =>
      coordinator.review(storeReview(accepted.runId, awaiting.reviewId) as never),
    ).toThrowError(
      expect.objectContaining({ code: 'authoring_persistence_failed', statusCode: 500 }),
    );
    expect(() =>
      coordinator.status({
        formatVersion: '1.0.0',
        requestId: ids.request,
        runId: accepted.runId,
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'authoring_persistence_failed', statusCode: 500 }),
    );
  });

  it('surfaces a volatile fault when atomic storage and its recovery append both fail', async () => {
    const events: StoredExecutionEvent[] = [];
    const options = replayOptions(events);
    options.storeWithBinding.mockImplementation(() => {
      throw new Error('atomic storage failed');
    });
    options.appendEvent.mockImplementation((input) => {
      if (input.eventType === 'procedure.tutorial.media.authoring.recovery.required')
        throw new Error('storage recovery append failed');
      const value = stored(input, events.length + 1);
      events.push(value);
      return value;
    });
    const coordinator = createProcedureTutorialMediaAuthoringRunCoordinator(options);
    const accepted = coordinator.create(request() as never);
    await coordinator.close();
    const awaiting = coordinator.status({
      formatVersion: '1.0.0',
      requestId: ids.request,
      runId: accepted.runId,
    });
    if (awaiting.status !== 'awaiting_review') throw new Error('Expected review checkpoint');

    expect(() =>
      coordinator.review(storeReview(accepted.runId, awaiting.reviewId) as never),
    ).toThrowError(
      expect.objectContaining({ code: 'authoring_persistence_failed', statusCode: 500 }),
    );
    expect(() =>
      coordinator.status({
        formatVersion: '1.0.0',
        requestId: ids.request,
        runId: accepted.runId,
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'authoring_persistence_failed', statusCode: 500 }),
    );
  });

  it.each([
    'restore_throws',
    'restore_invalid',
    'stored_tree_mismatch',
    'retry_classifier_throws',
  ] as const)('surfaces a volatile fault for storage reconciliation case %s', async (mode) => {
    const events: StoredExecutionEvent[] = [];
    const options = replayOptions(events);
    options.storeWithBinding.mockReturnValue(storage as never);
    if (mode === 'restore_throws') {
      options.restoreStored.mockImplementation(() => {
        throw new Error('restore failed');
      });
    } else if (mode === 'restore_invalid') {
      options.restoreStored.mockReturnValue({ status: 'invalid' });
    } else if (mode === 'stored_tree_mismatch') {
      const mismatched = structuredClone(storage);
      mismatched.record.tree.id = 'different-tree';
      options.restoreStored.mockReturnValue({
        status: 'completed',
        storage: mismatched as never,
      });
    } else {
      options.storeWithBinding.mockImplementation(() => {
        throw new Error('storage failed');
      });
    }
    const coordinator = createProcedureTutorialMediaAuthoringRunCoordinator({
      ...options,
      ...(mode === 'retry_classifier_throws'
        ? {
            isStorageFailureRetryable: () => {
              throw new Error('classification failed');
            },
          }
        : {}),
    });
    const accepted = coordinator.create(request() as never);
    await coordinator.close();
    const awaiting = coordinator.status({
      formatVersion: '1.0.0',
      requestId: ids.request,
      runId: accepted.runId,
    });
    if (awaiting.status !== 'awaiting_review') throw new Error('Expected review checkpoint');

    expect(() =>
      coordinator.review(storeReview(accepted.runId, awaiting.reviewId) as never),
    ).toThrowError(
      expect.objectContaining({ code: 'authoring_persistence_failed', statusCode: 500 }),
    );
    expect(() =>
      coordinator.status({
        formatVersion: '1.0.0',
        requestId: ids.request,
        runId: accepted.runId,
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'authoring_persistence_failed', statusCode: 500 }),
    );
  });

  it('surfaces discard finalization failure until replay reconciles the durable review', async () => {
    const events: StoredExecutionEvent[] = [];
    const options = replayOptions(events);
    options.appendEvent.mockImplementation((input) => {
      if (input.eventType === 'procedure.tutorial.media.authoring.discarded')
        throw new Error('discard finalization persistence failed');
      const value = stored(input, events.length + 1);
      events.push(value);
      return value;
    });
    const coordinator = createProcedureTutorialMediaAuthoringRunCoordinator(options);
    const accepted = coordinator.create(request() as never);
    await coordinator.close();
    const awaiting = coordinator.status({
      formatVersion: '1.0.0',
      requestId: ids.request,
      runId: accepted.runId,
    });
    if (awaiting.status !== 'awaiting_review') throw new Error('Expected review checkpoint');

    expect(() =>
      coordinator.review({
        formatVersion: '1.0.0',
        requestId: ids.request,
        runId: accepted.runId,
        reviewId: awaiting.reviewId,
        review: { decision: 'discard' },
        reviewedAt: '2026-08-21T09:00:00Z',
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'authoring_persistence_failed', statusCode: 500 }),
    );
    expect(() =>
      coordinator.status({
        formatVersion: '1.0.0',
        requestId: ids.request,
        runId: accepted.runId,
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'authoring_persistence_failed', statusCode: 500 }),
    );

    const replay = replayOptions(events);
    expect(
      createProcedureTutorialMediaAuthoringRunCoordinator(replay).status({
        formatVersion: '1.0.0',
        requestId: ids.request,
        runId: accepted.runId,
      }),
    ).toMatchObject({ status: 'discarded' });
  });

  it('re-enters storage recovery when resume cannot persist a new storage start checkpoint', async () => {
    const events: StoredExecutionEvent[] = [];
    const options = replayOptions(events);
    let failStorageStart = false;
    options.storeWithBinding.mockImplementation(() => {
      throw new Error('retryable storage failure');
    });
    options.appendEvent.mockImplementation((input) => {
      const payload = input.payload as { stage?: string };
      if (
        failStorageStart &&
        input.eventType === 'procedure.tutorial.media.authoring.stage.started' &&
        payload.stage === 'storage'
      ) {
        throw new Error('resumed storage start append failed');
      }
      const value = stored(input, events.length + 1);
      events.push(value);
      return value;
    });
    const coordinator = createProcedureTutorialMediaAuthoringRunCoordinator(options);
    const accepted = coordinator.create(request() as never);
    await coordinator.close();
    const awaiting = coordinator.status({
      formatVersion: '1.0.0',
      requestId: ids.request,
      runId: accepted.runId,
    });
    if (awaiting.status !== 'awaiting_review') throw new Error('Expected review checkpoint');
    const recovery = coordinator.review(storeReview(accepted.runId, awaiting.reviewId) as never);
    if (recovery.status !== 'recovery_required') throw new Error('Expected storage recovery');
    const recoveryCount = events.filter(
      (value) => value.eventType === 'procedure.tutorial.media.authoring.recovery.required',
    ).length;

    failStorageStart = true;
    expect(
      coordinator.resume({
        formatVersion: '1.0.0',
        requestId: ids.request,
        runId: accepted.runId,
        recoveryId: recovery.recoveryId,
        retryFromStage: 'storage',
      }),
    ).toMatchObject({ status: 'recovery_required', retryFromStage: 'storage' });
    expect(
      events.filter(
        (value) => value.eventType === 'procedure.tutorial.media.authoring.recovery.required',
      ),
    ).toHaveLength(recoveryCount + 1);
    expect(options.storeWithBinding).toHaveBeenCalledTimes(1);
  });

  it('rejects requested evidence whose fingerprint is not recomputed from its bound request', () => {
    const history = baseHistory();
    const corrupted = structuredClone(history.requested);
    (corrupted.payload as Record<string, unknown>)['requestFingerprint'] = 'f'.repeat(64);

    expect(() =>
      createProcedureTutorialMediaAuthoringRunCoordinator(replayOptions([corrupted])),
    ).toThrow('requested evidence is not exactly bound');
  });

  it('reconstructs a missing review-required event after a durable materialization checkpoint', () => {
    const history = baseHistory();
    const events = [
      history.requested,
      history.make(2, 'stage.started', '2026-08-21T08:00:01Z', {
        stage: 'provider_generation',
        state: 'started',
      }),
      history.make(3, 'stage.completed', '2026-08-21T08:00:02Z', {
        stage: 'provider_generation',
        state: 'completed',
        checkpoint: generation,
      }),
      history.make(4, 'stage.started', '2026-08-21T08:00:03Z', {
        stage: 'materialization',
        state: 'started',
      }),
      history.make(5, 'stage.completed', '2026-08-21T08:00:04Z', {
        stage: 'materialization',
        state: 'completed',
        checkpoint: materialization,
      }),
    ];
    const options = replayOptions(events);
    const coordinator = createProcedureTutorialMediaAuthoringRunCoordinator(options);

    expect(
      coordinator.status({ formatVersion: '1.0.0', requestId: ids.request, runId: ids.run }),
    ).toMatchObject({
      status: 'awaiting_review',
      completedStages: ['provider_generation', 'materialization'],
    });
    expect(options.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'procedure.tutorial.media.authoring.review.required' }),
    );
  });

  it('rejects an unbound or out-of-order review checkpoint', () => {
    const history = baseHistory();
    const events = [
      history.requested,
      history.make(2, 'review.required', '2026-08-21T08:00:01Z', {
        reviewId: ids.review,
        preparation: request().preparation,
        generation,
        materialization,
      }),
    ];

    expect(() =>
      createProcedureTutorialMediaAuthoringRunCoordinator(replayOptions(events)),
    ).toThrow('review checkpoint is out of order or unbound');
  });

  it('persists the missing discard terminal after replaying an exact discard review', () => {
    const history = baseHistory();
    const events = [history.requested];
    const append = (suffix: string, payload: Record<string, unknown>) =>
      events.push(
        history.make(events.length + 1, suffix, `2026-08-21T08:00:0${events.length}Z`, payload),
      );
    append('stage.started', { stage: 'provider_generation', state: 'started' });
    append('stage.completed', {
      stage: 'provider_generation',
      state: 'completed',
      checkpoint: generation,
    });
    append('stage.started', { stage: 'materialization', state: 'started' });
    append('stage.completed', {
      stage: 'materialization',
      state: 'completed',
      checkpoint: materialization,
    });
    append('review.required', {
      reviewId: ids.review,
      preparation: request().preparation,
      generation,
      materialization,
    });
    const review = {
      formatVersion: '1.0.0',
      requestId: ids.request,
      runId: ids.run,
      reviewId: ids.review,
      review: { decision: 'discard' },
      reviewedAt: '2026-08-21T08:00:06Z',
    };
    append('reviewed', { review });
    const options = replayOptions(events);
    const coordinator = createProcedureTutorialMediaAuthoringRunCoordinator(options);

    expect(
      coordinator.status({ formatVersion: '1.0.0', requestId: ids.request, runId: ids.run }),
    ).toMatchObject({ status: 'discarded', reviewId: ids.review });
    expect(options.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'procedure.tutorial.media.authoring.discarded' }),
    );
  });

  it('fails closed when appendEvent does not return the exact persisted envelope', () => {
    const history = baseHistory();
    const options = replayOptions([history.requested]);
    options.appendEvent.mockImplementation((input) => ({
      ...stored(input, 2),
      eventType: 'tampered',
    }));

    expect(() => createProcedureTutorialMediaAuthoringRunCoordinator(options)).toThrow(
      'evidence could not be persisted',
    );
  });

  it('rebuilds a completed binding from prior stages and verifies the exact stored tree', async () => {
    const events: StoredExecutionEvent[] = [];
    let atomicCompletion: ExecutionEventInput | undefined;
    const live = createProcedureTutorialMediaAuthoringRunCoordinator({
      currentPreparation: () => request().preparation as never,
      generateFromPacket: async () => generation as never,
      completedGenerationEvidence: () => generationEvidence as never,
      materialize: () => materialization as never,
      storeWithBinding: ({ completedEvent }) => {
        atomicCompletion = completedEvent;
        return storage as never;
      },
      restoreStored: () => ({ status: 'completed', storage: storage as never }),
      findProcedureAuthor: () => descriptor,
      existingEvents: [],
      appendEvent: (input) => {
        const value = stored(input, events.length + 1);
        events.push(value);
        return value;
      },
      now: () => '2026-08-21T09:00:00Z',
    });
    const accepted = live.create(request() as never);
    await live.close();
    const awaiting = live.status({
      formatVersion: '1.0.0',
      requestId: ids.request,
      runId: accepted.runId,
    });
    expect(awaiting.status).toBe('awaiting_review');
    if (awaiting.status !== 'awaiting_review') throw new Error('Expected review checkpoint');
    live.review({
      formatVersion: '1.0.0',
      requestId: ids.request,
      runId: accepted.runId,
      reviewId: awaiting.reviewId,
      review: {
        decision: 'store',
        preparationFingerprint: request().preparation.fingerprint,
        packetContentSha256: request().preparation.packet.integrity.contentSha256,
        candidateTreeContentSha256: materialization.inputTreeContentSha256,
        materializedTreeContentSha256: materialization.outputTreeContentSha256,
        confirmations: {
          exactPreparationReviewed: true,
          exactPacketReviewed: true,
          exactCandidateTreeReviewed: true,
          exactMaterializedTreeReviewed: true,
        },
      },
      reviewedAt: '2026-08-21T09:00:00Z',
    } as never);
    expect(atomicCompletion).toBeDefined();
    events.push(stored(atomicCompletion!, events.length + 1));

    const replay = replayOptions(events);
    replay.restoreStored.mockReturnValue({ status: 'completed', storage: storage as never });
    const restored = createProcedureTutorialMediaAuthoringRunCoordinator(replay);
    expect(
      restored.status({
        formatVersion: '1.0.0',
        requestId: ids.request,
        runId: accepted.runId,
      }),
    ).toMatchObject({ status: 'completed' });

    const corrupted = structuredClone(events);
    const completed = corrupted.at(-1)!;
    const payload = completed.payload as {
      binding: { storage: { treeId: string } };
    };
    payload.binding.storage.treeId = 'different-tree';
    expect(() =>
      createProcedureTutorialMediaAuthoringRunCoordinator({
        ...replayOptions(corrupted),
        restoreStored: () => ({ status: 'completed', storage: storage as never }),
      }),
    ).toThrow('completion binding does not match replayed evidence');
  });
});
