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
import {
  createProcedureTutorialMediaAuthoringRunCoordinator,
  ProcedureTutorialMediaAuthoringRunError,
} from '../../../services/orchestrator/src/procedure-tutorial-media-authoring-run.js';

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

function protocolSha256(value: unknown): string {
  return createHash('sha256').update(canonicalizeProtocolJsonValue(value)).digest('hex');
}

function generationFixture() {
  const input = request();
  return {
    requestId: ids.generation,
    generationId: ids.generated,
    provider: { id: descriptor.id, version: descriptor.version },
    packet: input.preparation.packet,
    tree: {},
  };
}

function materializationFixture() {
  const treeHash = protocolSha256({});
  return {
    packetContentSha256: 'c'.repeat(64),
    inputTreeContentSha256: treeHash,
    outputTreeContentSha256: treeHash,
    tree: {},
  };
}

function completedGenerationEvidenceFixture() {
  const input = request();
  const providerRequest = {
    requestId: ids.generation,
    providerId: descriptor.id,
    packet: input.preparation.packet,
  };
  return {
    eventId: `procedure-authoring-generation-completed:${ids.generation}`,
    event: {
      inputMode: 'prepared_packet',
      request: {
        requestId: ids.generation,
        providerId: descriptor.id,
        packetContentSha256: input.preparation.packet.integrity.contentSha256,
      },
      requestFingerprint: plannerProviderRequestFingerprint(providerRequest),
      result: generationFixture(),
    },
  };
}

function stored(sequence: number, eventType: string, payload: unknown): StoredExecutionEvent {
  const eventPayload = payload as Record<string, unknown>;
  const runId = String(eventPayload['runId']);
  const suffix = eventType.slice('procedure.tutorial.media.authoring.'.length).replaceAll('.', '-');
  const prefix = `procedure-tutorial-media-authoring-${suffix}:${runId}`;
  const eventId = `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
  return {
    sequence,
    id:
      eventType === 'procedure.tutorial.media.authoring.completed'
        ? prefix
        : `${prefix}:${eventId}`,
    eventType,
    payload,
    createdAt: String(eventPayload['occurredAt']),
  };
}

function history(until: 'provider_started' | 'review_required', duplicateStart = false) {
  const input = request();
  const fingerprint = plannerProviderRequestFingerprint(input);
  const scope = {
    formatVersion: '1.1.0',
    requestId: ids.request,
    requestFingerprint: fingerprint,
    runId: ids.run,
    mediaSource,
  };
  const events = [
    stored(1, 'procedure.tutorial.media.authoring.requested', {
      ...scope,
      occurredAt: '2026-08-21T08:00:00Z',
      request: input,
    }),
    stored(2, 'procedure.tutorial.media.authoring.stage.started', {
      ...scope,
      occurredAt: '2026-08-21T08:00:01Z',
      stage: 'provider_generation',
      state: 'started',
    }),
  ];
  if (duplicateStart)
    events.push(
      stored(3, 'procedure.tutorial.media.authoring.stage.started', {
        ...scope,
        occurredAt: '2026-08-21T08:00:02Z',
        stage: 'provider_generation',
        state: 'started',
      }),
    );
  if (until === 'provider_started') return events;
  const generation = generationFixture();
  const materialization = materializationFixture();
  events.push(
    stored(4, 'procedure.tutorial.media.authoring.stage.completed', {
      ...scope,
      occurredAt: '2026-08-21T08:00:03Z',
      stage: 'provider_generation',
      state: 'completed',
      checkpoint: generation,
    }),
    stored(5, 'procedure.tutorial.media.authoring.stage.started', {
      ...scope,
      occurredAt: '2026-08-21T08:00:04Z',
      stage: 'materialization',
      state: 'started',
    }),
    stored(6, 'procedure.tutorial.media.authoring.stage.completed', {
      ...scope,
      occurredAt: '2026-08-21T08:00:05Z',
      stage: 'materialization',
      state: 'completed',
      checkpoint: materialization,
    }),
    stored(7, 'procedure.tutorial.media.authoring.review.required', {
      ...scope,
      occurredAt: '2026-08-21T08:00:06Z',
      reviewId: ids.review,
      preparation: input.preparation,
      generation,
      materialization,
    }),
  );
  return events;
}

function coordinator(
  options: {
    existingEvents?: StoredExecutionEvent[];
    find?: () => unknown;
    generateFromPacket?: () => Promise<unknown>;
    completedGenerationEvidence?: () => unknown;
    maximumConcurrentRuns?: number;
    appendEvent?: (event: ExecutionEventInput) => unknown;
  } = {},
) {
  let sequence = 0;
  const appendEvent = vi.fn(
    options.appendEvent ??
      ((event: ExecutionEventInput) => ({
        ...event,
        sequence: (sequence += 1),
      })),
  );
  const generateFromPacket = vi.fn(
    options.generateFromPacket ?? (async () => await new Promise<never>(() => undefined)),
  );
  const value = createProcedureTutorialMediaAuthoringRunCoordinator({
    currentPreparation: () => request().preparation as never,
    generateFromPacket,
    completedGenerationEvidence: (options.completedGenerationEvidence ??
      (() => completedGenerationEvidenceFixture())) as never,
    materialize: vi.fn(),
    storeWithBinding: vi.fn(),
    restoreStored: () => ({ status: 'absent' }),
    findProcedureAuthor: (options.find ?? (() => descriptor)) as never,
    existingEvents: options.existingEvents ?? [],
    appendEvent,
    now: () => '2026-08-21T08:00:10Z',
    maximumConcurrentRuns: options.maximumConcurrentRuns,
  });
  return { value, appendEvent, generateFromPacket };
}

describe('procedure tutorial media authoring run safety', () => {
  it('rejects a distinct run with capacity_exceeded while the configured slot is occupied', () => {
    const run = coordinator({ maximumConcurrentRuns: 1 });
    run.value.create(request() as never);
    const second = request();
    second.requestId = '88888888-8888-4888-8888-888888888888';
    second.provider.generationRequestId = '99999999-9999-4999-8999-999999999999';

    expect(() => run.value.create(second as never)).toThrowError(
      expect.objectContaining({ code: 'capacity_exceeded', statusCode: 429 }),
    );
    expect(run.generateFromPacket).toHaveBeenCalledTimes(1);
  });

  it('rejects new runs with runtime_stopping after beginClose', () => {
    const run = coordinator();
    run.value.beginClose();

    expect(() => run.value.create(request() as never)).toThrowError(
      expect.objectContaining({ code: 'runtime_stopping', statusCode: 503 }),
    );
    expect(run.generateFromPacket).not.toHaveBeenCalled();
  });

  it('waits for an in-flight Provider task to settle during close', async () => {
    let release!: (value: unknown) => void;
    const providerGate = new Promise<unknown>((resolve) => {
      release = resolve;
    });
    const run = coordinator({ generateFromPacket: async () => await providerGate });
    run.value.create(request() as never);

    const closing = run.value.close();
    let closed = false;
    void closing.then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);

    release({});
    await closing;
    expect(closed).toBe(true);
  });

  it('rejects a persistence adapter that returns a different stored event envelope', () => {
    const run = coordinator({
      appendEvent: (event) => ({ ...event, id: `wrong:${event.id}`, sequence: 1 }),
    });

    expect(() => run.value.create(request() as never)).toThrowError(
      expect.objectContaining({ code: 'authoring_persistence_failed', statusCode: 500 }),
    );
    expect(run.generateFromPacket).not.toHaveBeenCalled();
  });

  it('rejects request-id conflicts and unavailable or changed Provider descriptors', () => {
    const first = coordinator();
    first.value.create(request() as never);
    const changed = request();
    changed.preparation.fingerprint = 'f'.repeat(64);
    expect(() => first.value.create(changed as never)).toThrowError(
      ProcedureTutorialMediaAuthoringRunError,
    );

    const unavailable = {
      ...descriptor,
      availability: {
        available: false as const,
        reason: 'disabled' as const,
        message: 'Disabled.',
      },
    };
    expect(() => coordinator({ find: () => unavailable }).value.create(request() as never)).toThrow(
      'unavailable',
    );
    expect(() =>
      coordinator({ find: () => ({ ...descriptor, version: '1.0.1' }) }).value.create(
        request() as never,
      ),
    ).toThrow('changed');
  });

  it('rejects review timestamps before the checkpoint and mismatched hashes', () => {
    const run = coordinator({ existingEvents: history('review_required') }).value;
    const base = {
      formatVersion: '1.0.0' as const,
      requestId: ids.request,
      runId: ids.run,
      reviewId: ids.review,
    };
    expect(() =>
      run.review({ ...base, review: { decision: 'discard' }, reviewedAt: '2026-08-21T08:00:05Z' }),
    ).toThrow('precedes');
    expect(() =>
      run.review({
        ...base,
        review: {
          decision: 'store',
          preparationFingerprint: 'b'.repeat(64),
          packetContentSha256: 'c'.repeat(64),
          candidateTreeContentSha256: '0'.repeat(64),
          materializedTreeContentSha256: protocolSha256({}),
          confirmations: {
            exactPreparationReviewed: true,
            exactPacketReviewed: true,
            exactCandidateTreeReviewed: true,
            exactMaterializedTreeReviewed: true,
          },
        },
        reviewedAt: '2026-08-21T08:00:07Z',
      } as never),
    ).toThrow('hashes');
  });

  it('records an exact discard idempotently', () => {
    const run = coordinator({ existingEvents: history('review_required') });
    const review = {
      formatVersion: '1.0.0' as const,
      requestId: ids.request,
      runId: ids.run,
      reviewId: ids.review,
      review: { decision: 'discard' as const, reason: 'Not accurate.' },
      reviewedAt: '2026-08-21T08:00:07Z',
    };
    expect(run.value.review(review).status).toBe('discarded');
    expect(run.value.review(review).status).toBe('discarded');
    expect(run.appendEvent).toHaveBeenCalledTimes(2);
  });

  it('fails an interrupted Provider stage without durable completion evidence after restart', () => {
    const run = coordinator({
      existingEvents: history('provider_started'),
      completedGenerationEvidence: () => null,
    });
    expect(
      run.value.status({ formatVersion: '1.0.0', requestId: ids.request, runId: ids.run }).status,
    ).toBe('failed');
    expect(run.generateFromPacket).not.toHaveBeenCalled();
  });

  it('fails closed on duplicate or out-of-order stage evidence', () => {
    expect(() => coordinator({ existingEvents: history('provider_started', true) })).toThrow(
      'out of order',
    );
    const wrongId = history('provider_started');
    wrongId[1] = { ...wrongId[1]!, id: 'wrong-event-id' };
    expect(() => coordinator({ existingEvents: wrongId })).toThrow('event id does not match');
  });
});
