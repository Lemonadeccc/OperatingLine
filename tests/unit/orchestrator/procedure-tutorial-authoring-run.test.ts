import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import type { ExecutionEventInput, StoredExecutionEvent } from '@operatingline/persistence';
import { describe, expect, it, vi } from 'vitest';

import {
  blenderActionCatalog,
  blenderInteractionCatalog,
} from '@operatingline/blender-action-catalog';
import {
  compileProcedureTreeToGuidePlan,
  plannerProviderContractVersion,
  plannerProviderDescriptorSchema,
  procedureAuthoringCandidateTreeSchema,
  procedureAuthoringGenerationResultSchema,
  procedureAuthoringGenerationCompletedEventSchema,
  procedureAuthoringMaterializationResultSchema,
  procedureAuthoringPromptPacketSchema,
  procedureAuthoringValidationResultSchema,
  procedureTutorialAuthoringRunCreateRequestSchema,
  type ProcedureAuthoringCandidateTree,
  type ProcedureAuthoringPromptPacket,
  type ProcedureTutorialYoutubeTrackSelectionCurrentResult,
} from '@operatingline/protocol';

import { materializeProcedureAuthoringCandidate } from '../../../services/orchestrator/src/procedure-authoring-materialization.js';
import { computeProcedureAuthoringPromptPacketContentSha256 } from '../../../services/orchestrator/src/procedure-authoring-prompt.js';
import { plannerProviderRequestFingerprint } from '../../../services/orchestrator/src/planner-provider-invocation.js';
import {
  createProcedureTutorialAuthoringRunCoordinator,
  ProcedureTutorialAuthoringRunError,
} from '../../../services/orchestrator/src/procedure-tutorial-authoring-run.js';
import { buildProcedureTutorialYoutubePromptPacket } from '../../../services/orchestrator/src/procedure-tutorial-youtube-import.js';
import type { ProcedureTutorialYoutubeCaptionAcquisitionResult } from '../../../services/orchestrator/src/youtube-caption-source.js';

const ids = {
  request: '11111111-1111-4111-8111-111111111111',
  import: '22222222-2222-4222-8222-222222222222',
  selection: '33333333-3333-4333-8333-333333333333',
  generationRequest: '44444444-4444-4444-8444-444444444444',
  generation: '55555555-5555-4555-8555-555555555555',
} as const;

const descriptor = plannerProviderDescriptorSchema.parse({
  contractVersion: plannerProviderContractVersion,
  id: 'procedure-author',
  version: '1.0.0',
  displayName: 'Test Procedure author',
  description: 'Deterministic test Procedure author.',
  availability: { available: true },
  limits: { maxConcurrency: 1 },
  dataHandling: {
    executionLocation: 'local',
    dataTransmission: 'none',
    credentialManagement: 'provider_managed',
  },
});

const request = procedureTutorialAuthoringRunCreateRequestSchema.parse({
  formatVersion: '1.0.0',
  requestId: ids.request,
  source: {
    kind: 'selected_youtube_caption',
    captionImport: {
      formatVersion: '1.1.0',
      requestId: ids.import,
      selectionRequestId: ids.selection,
      targetAdapterId: 'blender',
      actionCatalogVersion: blenderActionCatalog.catalogVersion,
      interactionCatalogVersion: blenderInteractionCatalog.catalogVersion,
      goal: 'Create and position a Blender eye from the selected caption.',
      treeId: 'snowman.eye.left.procedure',
      revision: 1,
      locale: 'en',
      youtube: {
        videoId: 'dQw4w9WgXcQ',
        captionTrackId: 'caption-track-en',
        requestedFormat: 'webvtt',
        expectedTrackLanguage: 'en',
        defaultConfidence: 0.91,
        rightsStatus: 'permission_granted',
        authorization: {
          networkFetchApproved: true,
          quotaCostAcknowledged: true,
          videoEditPermissionExpected: true,
        },
      },
    },
  },
  provider: {
    generationRequestId: ids.generationRequest,
    authorization: {
      providerDescriptor: descriptor,
      explicitlyConfirmedByUser: true,
      dataHandlingAcknowledged: true,
      possibleProviderCostAcknowledged: true,
      confirmedAt: '2026-08-19T08:00:00Z',
    },
  },
});

const acquisition: ProcedureTutorialYoutubeCaptionAcquisitionResult = {
  video: {
    uri: `https://www.youtube.com/watch?v=${request.source.captionImport.youtube.videoId}`,
    title: 'Authorized Blender eye tutorial',
    durationMs: 20_000,
  },
  captionDocument: {
    format: 'webvtt',
    content:
      'WEBVTT\n\n00:01.000 --> 00:04.000\nAdd a UV sphere.\n\n00:05.000 --> 00:08.000\nMove it.\n',
    locale: 'en',
    acquisition: {
      source: 'youtube_data_api_v3',
      authorization: 'oauth_video_edit_permission',
      videoId: request.source.captionImport.youtube.videoId,
      captionTrackId: request.source.captionImport.youtube.captionTrackId,
      trackLanguage: 'en',
      trackKind: 'standard',
      isDraft: false,
      isAutoSynced: false,
      status: 'serving',
      lastUpdated: '2026-08-18T08:00:00Z',
      requestedFormat: 'webvtt',
    },
  },
};

const selection: ProcedureTutorialYoutubeTrackSelectionCurrentResult = {
  formatVersion: '1.1.0',
  requestId: ids.selection,
  requestFingerprint: 'a'.repeat(64),
  sourceTrackList: {
    requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    videoId: request.source.captionImport.youtube.videoId,
    listedAt: '2026-08-18T09:00:00Z',
  },
  selectedTrack: {
    captionTrackId: request.source.captionImport.youtube.captionTrackId,
    lastUpdated: '2026-08-18T08:00:00Z',
    trackKind: 'standard',
    language: 'en',
    name: 'English',
    audioTrackType: 'primary',
    isCC: true,
    isLarge: false,
    isEasyReader: false,
    isDraft: false,
    isAutoSynced: false,
    status: 'serving',
  },
  confirmation: {
    explicitlyConfirmedByUser: true,
    reason: { reasonCode: 'caption_quality_review' },
  },
  recommendation: null,
  sideEffects: {
    captionTrackSelectionRecorded: true,
    networkFetched: false,
    additionalQuotaUnits: 0,
    captionContentDownloaded: false,
    videoMediaDownloaded: false,
    modelCalled: false,
    procedureStored: false,
    proposalCreated: false,
    hostExecutionStarted: false,
  },
  recordedAt: '2026-08-18T10:00:00Z',
};

function packet(): ProcedureAuthoringPromptPacket {
  return buildProcedureTutorialYoutubePromptPacket(
    request.source.captionImport,
    acquisition,
    blenderActionCatalog,
    blenderInteractionCatalog,
    selection,
  );
}

function candidate(packetInput: ProcedureAuthoringPromptPacket): ProcedureAuthoringCandidateTree {
  const tree = JSON.parse(
    readFileSync(resolve('protocol/fixtures/v1/snowman-eye.procedure.json'), 'utf8'),
  ) as Record<string, unknown>;
  tree['id'] = packetInput.context.requestedTreeId;
  tree['revision'] = packetInput.context.recommendedRevision;
  tree['adapterId'] = packetInput.context.catalogBinding.adapterId;
  tree['actionCatalogVersion'] = packetInput.context.catalogBinding.actionCatalog.catalogVersion;
  tree['interactionCatalogVersion'] =
    packetInput.context.catalogBinding.interactionCatalog.catalogVersion;
  tree['hostVersionRange'] = packetInput.context.catalogBinding.interactionCatalog.hostVersionRange;
  const goalSource = packetInput.context.goalProvenance.source;
  const goalEvidence = { ...packetInput.context.goalProvenance.evidence, sourceId: goalSource.id };
  const tutorial = packetInput.context.tutorialProvenance!;
  const tutorialEvidence = tutorial.transcript.segments.map((segment) => ({
    id: segment.id,
    sourceId: tutorial.source.id,
    locator: segment.locator,
    description: segment.text,
    confidence: segment.confidence,
  }));
  tree['sources'] = [...(tree['sources'] as unknown[]), goalSource, tutorial.source];
  tree['evidence'] = [...(tree['evidence'] as unknown[]), goalEvidence, ...tutorialEvidence];
  for (const node of tree['nodes'] as Array<Record<string, unknown>>) {
    if (node['kind'] !== 'leaf') continue;
    const leafId = String(node['id']);
    for (const modality of ['menu', 'shortcut', 'mcp'] as const) {
      node[`${modality}Tracks`] = [
        {
          id: `${leafId}.${modality}.unavailable`,
          availability: 'unavailable',
          title: `${modality} grounding pending`,
          reason: 'Provider candidates cannot assert deterministic grounding.',
          modality,
        },
      ];
    }
    for (const [index, operation] of (
      node['semanticOperations'] as Array<Record<string, unknown>>
    ).entries()) {
      operation['evidenceRefs'] = [
        ...(operation['evidenceRefs'] as string[]),
        tutorialEvidence[index % tutorialEvidence.length]!.id,
      ];
    }
  }
  return procedureAuthoringCandidateTreeSchema.parse(tree);
}

function generation(
  packetInput: ProcedureAuthoringPromptPacket,
  tree: ProcedureAuthoringCandidateTree,
) {
  const plan = compileProcedureTreeToGuidePlan(tree);
  const validation = procedureAuthoringValidationResultSchema.parse({
    formatVersion: packetInput.formatVersion,
    packetContentSha256: packetInput.integrity.contentSha256,
    validation: {
      packetIntegrity: 'validated',
      installedCatalogBinding: 'validated',
      authoringCandidateContract: 'validated',
      procedureCompilation: 'validated',
    },
    compilation: {
      formatVersion: tree.formatVersion,
      procedureTreeId: tree.id,
      procedureTreeRevision: tree.revision,
      adapterId: tree.adapterId,
      actionCatalogVersion: tree.actionCatalogVersion,
      interactionCatalogVersion: tree.interactionCatalogVersion,
      validation: {
        procedureStructure: 'validated',
        actionCatalogBinding: 'validated',
        hostVersionRange: 'validated_against_action_catalog',
        interactionTracks: 'structural_only',
      },
      plan,
      proposalCreated: false,
      hostExecutionStarted: false,
    },
    procedureStored: false,
    proposalCreated: false,
    hostExecutionStarted: false,
  });
  return procedureAuthoringGenerationResultSchema.parse({
    formatVersion: '1.0.0',
    generationId: ids.generation,
    requestId: ids.generationRequest,
    provider: { id: descriptor.id, version: descriptor.version },
    packet: packetInput,
    tree,
    validation,
    sideEffects: {
      modelCalled: true,
      procedureStored: false,
      proposalCreated: false,
      hostExecutionStarted: false,
    },
    generatedAt: '2026-08-19T08:00:04Z',
    durationMs: 2,
  });
}

function materialization(
  packetInput: ProcedureAuthoringPromptPacket,
  tree: ProcedureAuthoringCandidateTree,
) {
  const grounded = materializeProcedureAuthoringCandidate(
    tree,
    blenderActionCatalog,
    blenderInteractionCatalog,
  );
  const { interactionCatalogContentSha256, ...materialized } = grounded;
  return procedureAuthoringMaterializationResultSchema.parse({
    ...materialized,
    packetContentSha256: packetInput.integrity.contentSha256,
    catalogBinding: {
      adapterId: blenderInteractionCatalog.adapterId,
      actionCatalogVersion: blenderInteractionCatalog.actionCatalogVersion,
      interactionCatalogVersion: blenderInteractionCatalog.catalogVersion,
      interactionCatalogContentSha256,
    },
    validation: {
      packetIntegrity: 'validated',
      installedCatalogBinding: 'validated',
      authoringCandidateContract: 'validated',
      procedureCompilation: 'validated',
      interactionGrounding: 'validated_against_installed_interaction_catalog',
    },
    compilation: {
      formatVersion: grounded.tree.formatVersion,
      procedureTreeId: grounded.tree.id,
      procedureTreeRevision: grounded.tree.revision,
      adapterId: grounded.tree.adapterId,
      actionCatalogVersion: grounded.tree.actionCatalogVersion,
      interactionCatalogVersion: grounded.tree.interactionCatalogVersion,
      validation: {
        procedureStructure: 'validated',
        actionCatalogBinding: 'validated',
        hostVersionRange: 'validated_against_action_catalog',
        interactionTracks: 'structural_only',
      },
      plan: compileProcedureTreeToGuidePlan(grounded.tree),
      proposalCreated: false,
      hostExecutionStarted: false,
    },
    procedureStored: false,
    proposalCreated: false,
    hostExecutionStarted: false,
  });
}

function stored(events: readonly ExecutionEventInput[]): StoredExecutionEvent[] {
  return events.map((event, index) => ({
    sequence: index + 1,
    id: event.id,
    eventType: event.eventType,
    payload: event.payload,
    createdAt: event.createdAt ?? '2026-08-19T08:00:00Z',
  }));
}

function fixture(overrides: Record<string, unknown> = {}) {
  const preparedPacket = packet();
  const preparedCandidate = candidate(preparedPacket);
  const preparedGeneration = generation(preparedPacket, preparedCandidate);
  const preparedGenerationEvidence = {
    eventId: `procedure-authoring-generation-completed:${ids.generationRequest}`,
    event: procedureAuthoringGenerationCompletedEventSchema.parse({
      inputMode: 'prepared_packet',
      request: {
        requestId: ids.generationRequest,
        providerId: descriptor.id,
        packetContentSha256: preparedPacket.integrity.contentSha256,
      },
      requestFingerprint: plannerProviderRequestFingerprint({
        requestId: ids.generationRequest,
        providerId: descriptor.id,
        packet: preparedPacket,
      }),
      result: preparedGeneration,
    }),
  };
  const preparedMaterialization = materialization(preparedPacket, preparedCandidate);
  const events: ExecutionEventInput[] = [];
  let tick = 0;
  const storedByHash = new Map<string, ReturnType<typeof storeResult>>();
  const storedEventByHash = new Map<string, ExecutionEventInput>();
  const storeResult = (storedAt = '2026-08-19T08:00:00Z') => ({
    result: 'accepted' as const,
    record: {
      sequence: 1,
      tree: preparedMaterialization.tree,
      integrity: {
        algorithm: 'sha256' as const,
        canonicalization: 'operatingline-json-value-v1' as const,
        contentSha256: preparedMaterialization.outputTreeContentSha256,
      },
      storedAt,
    },
    validation: {
      procedureStructure: 'validated' as const,
      actionCatalogBinding: 'validated' as const,
      hostVersionRange: 'validated_against_action_catalog' as const,
      interactionTracks: 'structural_only' as const,
    },
    proposalCreated: false as const,
    hostExecutionStarted: false as const,
  });
  const options = {
    importCaption: vi.fn(async () => preparedPacket),
    completedPacket: vi.fn(() => preparedPacket),
    generateFromPacket: vi.fn(async () => preparedGeneration),
    completedGenerationEvidence: vi.fn(() => preparedGenerationEvidence),
    materialize: vi.fn(() => preparedMaterialization),
    storeWithBinding: vi.fn(({ binding, completedEvent }) => {
      const result = storeResult(completedEvent.createdAt);
      storedByHash.set(binding.integrity.contentSha256, result);
      storedEventByHash.set(binding.integrity.contentSha256, completedEvent);
      events.push(completedEvent);
      return result;
    }),
    restoreStored: vi.fn(({ binding, completedEvent }) => {
      const storedEvent = storedEventByHash.get(binding.integrity.contentSha256);
      if (storedEvent === undefined) return { status: 'absent' as const };
      if (!isDeepStrictEqual(storedEvent, completedEvent)) {
        return { status: 'invalid' as const };
      }
      const storage = storedByHash.get(binding.integrity.contentSha256);
      return storage === undefined
        ? { status: 'invalid' as const }
        : { status: 'completed' as const, storage };
    }),
    findProcedureAuthor: vi.fn(() => descriptor),
    existingEvents: [] as StoredExecutionEvent[],
    appendEvent: vi.fn((event: ExecutionEventInput) => events.push(event)),
    now: () => `2026-08-19T08:00:${String(tick++).padStart(2, '0')}Z`,
    maxConcurrency: 1,
    ...overrides,
  };
  return {
    options,
    events,
    preparedPacket,
    preparedGeneration,
    preparedGenerationEvidence,
    preparedMaterialization,
    storedByHash,
    storedEventByHash,
  };
}

async function awaitingReview(setup: ReturnType<typeof fixture>) {
  const coordinator = createProcedureTutorialAuthoringRunCoordinator(setup.options);
  const accepted = coordinator.create(request);
  let status = coordinator.status({
    formatVersion: '1.0.0',
    requestId: request.requestId,
    runId: accepted.runId,
  });
  for (let attempt = 0; attempt < 20 && status.status !== 'awaiting_review'; attempt += 1) {
    await new Promise<void>((resolveWait) => setImmediate(resolveWait));
    status = coordinator.status({
      formatVersion: '1.0.0',
      requestId: request.requestId,
      runId: accepted.runId,
    });
  }
  expect(status.status).toBe('awaiting_review');
  return { coordinator, status: status as Extract<typeof status, { status: 'awaiting_review' }> };
}

describe('selected-caption Procedure tutorial authoring run', () => {
  it('preflights the provider before evidence and provides create idempotency/conflict', () => {
    const setup = fixture({ findProcedureAuthor: vi.fn(() => null) });
    const coordinator = createProcedureTutorialAuthoringRunCoordinator(setup.options);
    expect(() => coordinator.create(request)).toThrowError(
      expect.objectContaining({ code: 'provider_not_found' }),
    );
    expect(setup.events).toHaveLength(0);

    const disclosureMismatch = fixture();
    const disclosureCoordinator = createProcedureTutorialAuthoringRunCoordinator(
      disclosureMismatch.options,
    );
    expect(() =>
      disclosureCoordinator.create({
        ...request,
        requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        provider: {
          ...request.provider,
          authorization: {
            ...request.provider.authorization,
            providerDescriptor: {
              ...request.provider.authorization.providerDescriptor,
              description: 'A disclosure the live Provider did not publish.',
            },
          },
        },
      }),
    ).toThrowError(expect.objectContaining({ code: 'provider_descriptor_mismatch' }));
    expect(disclosureMismatch.events).toHaveLength(0);

    const available = fixture();
    const live = createProcedureTutorialAuthoringRunCoordinator(available.options);
    const first = live.create(request);
    expect(live.create(request).runId).toBe(first.runId);
    expect(() =>
      live.create({
        ...request,
        provider: {
          ...request.provider,
          authorization: {
            ...request.provider.authorization,
            providerDescriptor: {
              ...request.provider.authorization.providerDescriptor,
              version: '2.0.0',
            },
          },
        },
      }),
    ).toThrowError(expect.objectContaining({ code: 'run_conflict' }));
  });

  it('rejects a packet for another selected caption before calling the Provider', async () => {
    const setup = fixture();
    const alteredPacket = structuredClone(setup.preparedPacket);
    const alteredSelection =
      alteredPacket.context.tutorialProvenance?.transcript.document?.acquisition?.selection;
    if (alteredSelection === undefined) throw new Error('expected selected-caption packet');
    alteredSelection.requestId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const { integrity: _integrity, ...content } = alteredPacket;
    void _integrity;
    alteredPacket.integrity.contentSha256 =
      computeProcedureAuthoringPromptPacketContentSha256(content);
    const mismatchedPacket = procedureAuthoringPromptPacketSchema.parse(alteredPacket);
    setup.options.importCaption = vi.fn(async () => mismatchedPacket);
    const coordinator = createProcedureTutorialAuthoringRunCoordinator(setup.options);
    const accepted = coordinator.create(request);
    await new Promise<void>((resolveWait) => setImmediate(resolveWait));
    await coordinator.close();
    expect(
      coordinator.status({
        formatVersion: '1.0.0',
        requestId: request.requestId,
        runId: accepted.runId,
      }),
    ).toMatchObject({ status: 'failed', error: { stage: 'caption_import', retryable: false } });
    expect(setup.options.generateFromPacket).not.toHaveBeenCalled();
  });

  it('reaches exact review, rejects hash drift, then atomically stores the reviewed tree', async () => {
    const setup = fixture();
    const { coordinator, status } = await awaitingReview(setup);
    expect(setup.options.storeWithBinding).not.toHaveBeenCalled();
    const review = {
      formatVersion: '1.0.0' as const,
      requestId: request.requestId,
      runId: status.runId,
      reviewId: status.reviewId,
      review: {
        decision: 'store' as const,
        packetContentSha256: status.preview.generation.packet.integrity.contentSha256,
        candidateTreeContentSha256: status.preview.materialization.inputTreeContentSha256,
        materializedTreeContentSha256: status.preview.materialization.outputTreeContentSha256,
        confirmations: {
          exactPacketReviewed: true as const,
          exactCandidateTreeReviewed: true as const,
          exactMaterializedTreeReviewed: true as const,
        },
      },
      reviewedAt: status.awaitingReviewSince,
    };
    expect(() =>
      coordinator.review({
        ...review,
        review: { ...review.review, packetContentSha256: 'f'.repeat(64) },
      }),
    ).toThrowError(expect.objectContaining({ code: 'review_evidence_mismatch' }));
    expect(() =>
      coordinator.review({ ...review, reviewedAt: '2026-08-19T07:59:59Z' }),
    ).toThrowError(expect.objectContaining({ code: 'review_timestamp_invalid' }));
    expect(() =>
      coordinator.review({ ...review, reviewedAt: '2100-01-01T00:00:00Z' }),
    ).toThrowError(expect.objectContaining({ code: 'review_timestamp_invalid' }));
    const running = coordinator.review(review);
    expect(running).toMatchObject({ status: 'running', currentStage: 'storage' });
    await coordinator.close();
    const completed = coordinator.status({
      formatVersion: '1.0.0',
      requestId: request.requestId,
      runId: status.runId,
    });
    expect(completed).toMatchObject({
      status: 'completed',
      result: {
        binding: {
          source: {
            captionImportRequestFingerprint: plannerProviderRequestFingerprint(
              request.source.captionImport,
            ),
            selectionRequestFingerprint: selection.requestFingerprint,
          },
        },
      },
    });
    expect(coordinator.review(review)).toEqual(completed);
    const atomic = setup.options.storeWithBinding.mock.calls[0]![0];
    const storageStartedAt = setup.events.find(
      (event) =>
        event.eventType === 'procedure.tutorial.authoring.stage.started' &&
        (event.payload as { stage?: string }).stage === 'storage',
    )?.createdAt;
    expect(atomic.completedEvent.createdAt).not.toBe(storageStartedAt);
    expect(completed).toMatchObject({
      result: {
        completedAt: atomic.completedEvent.createdAt,
        storage: { record: { storedAt: atomic.completedEvent.createdAt } },
      },
    });
  });

  it('discards without storage and restores awaiting-review and completed evidence', async () => {
    const discardedSetup = fixture();
    const { coordinator, status } = await awaitingReview(discardedSetup);
    const discardReview = {
      formatVersion: '1.0.0' as const,
      requestId: request.requestId,
      runId: status.runId,
      reviewId: status.reviewId,
      review: { decision: 'discard' as const, reason: 'Not suitable.' },
      reviewedAt: status.awaitingReviewSince,
    };
    const discarded = coordinator.review(discardReview);
    expect(discarded).toMatchObject({ status: 'discarded' });
    expect(discardedSetup.options.storeWithBinding).not.toHaveBeenCalled();

    const restoredDiscarded = createProcedureTutorialAuthoringRunCoordinator({
      ...discardedSetup.options,
      existingEvents: stored(discardedSetup.events),
      appendEvent: vi.fn(),
    });
    expect(restoredDiscarded.review(discardReview)).toEqual(discarded);
    expect(
      restoredDiscarded.status({
        formatVersion: '1.0.0',
        requestId: request.requestId,
        runId: status.runId,
      }),
    ).toEqual(discarded);

    const waitingSetup = fixture();
    const waiting = await awaitingReview(waitingSetup);
    const restoredWaiting = createProcedureTutorialAuthoringRunCoordinator({
      ...waitingSetup.options,
      existingEvents: stored(waitingSetup.events),
      appendEvent: vi.fn(),
    });
    expect(
      restoredWaiting.status({
        formatVersion: '1.0.0',
        requestId: request.requestId,
        runId: waiting.status.runId,
      }),
    ).toEqual(waiting.status);
  });

  it('uses a fresh atomic timestamp after confirmed storage absence and restores completion', async () => {
    const setup = fixture();
    let firstAtomic: ExecutionEventInput | undefined;
    setup.options.storeWithBinding = vi.fn(({ binding, completedEvent }) => {
      const result = {
        result: 'duplicate' as const,
        record: {
          sequence: 1,
          tree: setup.preparedMaterialization.tree,
          integrity: {
            algorithm: 'sha256' as const,
            canonicalization: 'operatingline-json-value-v1' as const,
            contentSha256: setup.preparedMaterialization.outputTreeContentSha256,
          },
          storedAt: completedEvent.createdAt,
        },
        validation: {
          procedureStructure: 'validated' as const,
          actionCatalogBinding: 'validated' as const,
          hostVersionRange: 'validated_against_action_catalog' as const,
          interactionTracks: 'structural_only' as const,
        },
        proposalCreated: false as const,
        hostExecutionStarted: false as const,
      };
      setup.storedByHash.set(binding.integrity.contentSha256, result);
      if (firstAtomic === undefined) {
        firstAtomic = structuredClone(completedEvent);
        throw new Error('commit acknowledgement lost');
      }
      expect(completedEvent.id).toBe(firstAtomic.id);
      expect(completedEvent.createdAt).not.toBe(firstAtomic.createdAt);
      expect((completedEvent.payload as { binding: unknown }).binding).toEqual(
        (firstAtomic.payload as { binding: unknown }).binding,
      );
      setup.storedEventByHash.set(binding.integrity.contentSha256, completedEvent);
      setup.events.push(completedEvent);
      return result;
    });
    const { coordinator, status } = await awaitingReview(setup);
    coordinator.review({
      formatVersion: '1.0.0',
      requestId: request.requestId,
      runId: status.runId,
      reviewId: status.reviewId,
      review: {
        decision: 'store',
        packetContentSha256: status.preview.generation.packet.integrity.contentSha256,
        candidateTreeContentSha256: status.preview.materialization.inputTreeContentSha256,
        materializedTreeContentSha256: status.preview.materialization.outputTreeContentSha256,
        confirmations: {
          exactPacketReviewed: true,
          exactCandidateTreeReviewed: true,
          exactMaterializedTreeReviewed: true,
        },
      },
      reviewedAt: status.awaitingReviewSince,
    });
    let recovery = coordinator.status({
      formatVersion: '1.0.0',
      requestId: request.requestId,
      runId: status.runId,
    });
    for (let attempt = 0; attempt < 20 && recovery.status !== 'recovery_required'; attempt += 1) {
      await new Promise<void>((resolveWait) => setImmediate(resolveWait));
      recovery = coordinator.status({
        formatVersion: '1.0.0',
        requestId: request.requestId,
        runId: status.runId,
      });
    }
    if (recovery.status !== 'recovery_required') throw new Error('expected storage recovery');
    const resume = {
      formatVersion: '1.0.0',
      requestId: request.requestId,
      runId: status.runId,
      recoveryId: recovery.recoveryId,
      retryFromStage: 'storage' as const,
    } as const;
    coordinator.resume(resume);
    await coordinator.close();
    const completed = coordinator.status({
      formatVersion: '1.0.0',
      requestId: request.requestId,
      runId: status.runId,
    });
    expect(completed).toMatchObject({
      status: 'completed',
      result: { storage: { result: 'accepted' } },
    });
    expect(coordinator.resume(resume)).toEqual(completed);

    const restored = createProcedureTutorialAuthoringRunCoordinator({
      ...setup.options,
      existingEvents: stored(setup.events),
      appendEvent: vi.fn(),
    });
    expect(
      restored.status({
        formatVersion: '1.0.0',
        requestId: request.requestId,
        runId: status.runId,
      }),
    ).toEqual(completed);
    expect(restored.resume(resume)).toEqual(completed);
  });

  it('reconciles an exact atomic completion when the commit acknowledgement is lost', async () => {
    const setup = fixture();
    const committedStore = setup.options.storeWithBinding;
    setup.options.storeWithBinding = vi.fn((input) => {
      committedStore(input);
      throw new Error('commit acknowledgement lost');
    });
    const { coordinator, status } = await awaitingReview(setup);
    coordinator.review({
      formatVersion: '1.0.0',
      requestId: request.requestId,
      runId: status.runId,
      reviewId: status.reviewId,
      review: {
        decision: 'store',
        packetContentSha256: status.preview.generation.packet.integrity.contentSha256,
        candidateTreeContentSha256: status.preview.materialization.inputTreeContentSha256,
        materializedTreeContentSha256: status.preview.materialization.outputTreeContentSha256,
        confirmations: {
          exactPacketReviewed: true,
          exactCandidateTreeReviewed: true,
          exactMaterializedTreeReviewed: true,
        },
      },
      reviewedAt: status.awaitingReviewSince,
    });
    await coordinator.close();
    const completed = coordinator.status({
      formatVersion: '1.0.0',
      requestId: request.requestId,
      runId: status.runId,
    });
    expect(completed.status).toBe('completed');
    expect(
      setup.events.some(
        (event) => event.eventType === 'procedure.tutorial.authoring.recovery.required',
      ),
    ).toBe(false);

    const restored = createProcedureTutorialAuthoringRunCoordinator({
      ...setup.options,
      existingEvents: stored(setup.events),
      appendEvent: vi.fn(),
    });
    expect(
      restored.status({
        formatVersion: '1.0.0',
        requestId: request.requestId,
        runId: status.runId,
      }),
    ).toEqual(completed);
  });

  it('does not append recovery after committed completion evidence is found invalid', async () => {
    const setup = fixture();
    setup.options.storeWithBinding = vi.fn(({ binding, completedEvent }) => {
      setup.storedEventByHash.set(binding.integrity.contentSha256, completedEvent);
      setup.events.push(completedEvent);
      throw new Error('stored completion could not be decoded');
    });
    const { coordinator, status } = await awaitingReview(setup);
    coordinator.review({
      formatVersion: '1.0.0',
      requestId: request.requestId,
      runId: status.runId,
      reviewId: status.reviewId,
      review: {
        decision: 'store',
        packetContentSha256: status.preview.generation.packet.integrity.contentSha256,
        candidateTreeContentSha256: status.preview.materialization.inputTreeContentSha256,
        materializedTreeContentSha256: status.preview.materialization.outputTreeContentSha256,
        confirmations: {
          exactPacketReviewed: true,
          exactCandidateTreeReviewed: true,
          exactMaterializedTreeReviewed: true,
        },
      },
      reviewedAt: status.awaitingReviewSince,
    });
    await coordinator.close();
    expect(() =>
      coordinator.status({
        formatVersion: '1.0.0',
        requestId: request.requestId,
        runId: status.runId,
      }),
    ).toThrowError(expect.objectContaining({ code: 'authoring_persistence_failed' }));
    expect(
      setup.events.some(
        (event) => event.eventType === 'procedure.tutorial.authoring.recovery.required',
      ),
    ).toBe(false);
    expect(() =>
      createProcedureTutorialAuthoringRunCoordinator({
        ...setup.options,
        existingEvents: stored(setup.events),
        appendEvent: vi.fn(),
      }),
    ).toThrowError(/no exact stored tree/);
  });

  it('fails deterministic storage conflicts instead of offering an endless recovery', async () => {
    const setup = fixture({
      storeWithBinding: vi.fn(() => {
        throw new Error('deterministic revision conflict');
      }),
      isStorageFailureRetryable: vi.fn(() => false),
    });
    const { coordinator, status } = await awaitingReview(setup);
    coordinator.review({
      formatVersion: '1.0.0',
      requestId: request.requestId,
      runId: status.runId,
      reviewId: status.reviewId,
      review: {
        decision: 'store',
        packetContentSha256: status.preview.generation.packet.integrity.contentSha256,
        candidateTreeContentSha256: status.preview.materialization.inputTreeContentSha256,
        materializedTreeContentSha256: status.preview.materialization.outputTreeContentSha256,
        confirmations: {
          exactPacketReviewed: true,
          exactCandidateTreeReviewed: true,
          exactMaterializedTreeReviewed: true,
        },
      },
      reviewedAt: status.awaitingReviewSince,
    });
    await coordinator.close();
    expect(
      coordinator.status({
        formatVersion: '1.0.0',
        requestId: request.requestId,
        runId: status.runId,
      }),
    ).toMatchObject({
      status: 'failed',
      error: { retryable: false, stage: 'storage' },
    });
    expect(
      setup.events.some(
        (event) => event.eventType === 'procedure.tutorial.authoring.recovery.required',
      ),
    ).toBe(false);
  });

  it('fails closed on interrupted external work and recovers only deterministic materialization', async () => {
    const external = fixture();
    const coordinator = createProcedureTutorialAuthoringRunCoordinator(external.options);
    const accepted = coordinator.create(request);
    for (let attempt = 0; attempt < 20 && external.events.length < 7; attempt += 1) {
      await new Promise<void>((resolveWait) => setImmediate(resolveWait));
    }
    const captionStartIndex = external.events.findIndex(
      (event) => event.eventType === 'procedure.tutorial.authoring.stage.started',
    );
    const interrupted = createProcedureTutorialAuthoringRunCoordinator({
      ...external.options,
      existingEvents: stored(external.events.slice(0, captionStartIndex + 1)),
      appendEvent: (event) => external.events.push(event),
    });
    expect(
      interrupted.status({
        formatVersion: '1.0.0',
        requestId: request.requestId,
        runId: accepted.runId,
      }),
    ).toMatchObject({ status: 'failed', error: { retryable: false, stage: 'caption_import' } });
    expect(external.options.importCaption).toHaveBeenCalledTimes(1);

    const localEvents = external.events.filter((event) => {
      if (event.eventType !== 'procedure.tutorial.authoring.stage.completed') return true;
      return (event.payload as { stage: string }).stage !== 'materialization';
    });
    const local = createProcedureTutorialAuthoringRunCoordinator({
      ...external.options,
      existingEvents: stored(
        localEvents.slice(
          0,
          localEvents.findIndex(
            (event) => event.eventType === 'procedure.tutorial.authoring.review.required',
          ),
        ),
      ),
      appendEvent: (event) => external.events.push(event),
    });
    const recovery = local.status({
      formatVersion: '1.0.0',
      requestId: request.requestId,
      runId: accepted.runId,
    });
    expect(recovery).toMatchObject({
      status: 'recovery_required',
      retryFromStage: 'materialization',
    });
    if (recovery.status !== 'recovery_required') throw new Error('expected recovery');
    local.resume({
      formatVersion: '1.0.0',
      requestId: request.requestId,
      runId: accepted.runId,
      recoveryId: recovery.recoveryId,
      retryFromStage: 'materialization',
    });
    await local.close();
    expect(
      local.status({ formatVersion: '1.0.0', requestId: request.requestId, runId: accepted.runId }),
    ).toMatchObject({ status: 'awaiting_review' });
  });

  it('persists a replayable rollback when materialization completed before review evidence', async () => {
    const setup = fixture();
    const original = await awaitingReview(setup);
    const reviewRequiredIndex = setup.events.findIndex(
      (event) => event.eventType === 'procedure.tutorial.authoring.review.required',
    );
    expect(reviewRequiredIndex).toBeGreaterThan(0);
    const gapEvents = setup.events.slice(0, reviewRequiredIndex);
    const firstRestart = createProcedureTutorialAuthoringRunCoordinator({
      ...setup.options,
      existingEvents: stored(gapEvents),
      appendEvent: (event) => gapEvents.push(event),
    });
    const recovery = firstRestart.status({
      formatVersion: '1.0.0',
      requestId: request.requestId,
      runId: original.status.runId,
    });
    expect(recovery).toMatchObject({
      status: 'recovery_required',
      retryFromStage: 'materialization',
      completedStages: ['caption_import', 'provider_generation'],
    });
    await firstRestart.close();

    const secondRestart = createProcedureTutorialAuthoringRunCoordinator({
      ...setup.options,
      existingEvents: stored(gapEvents),
      appendEvent: (event) => gapEvents.push(event),
    });
    expect(
      secondRestart.status({
        formatVersion: '1.0.0',
        requestId: request.requestId,
        runId: original.status.runId,
      }),
    ).toEqual(recovery);
    if (recovery.status !== 'recovery_required') throw new Error('expected recovery receipt');
    secondRestart.resume({
      formatVersion: '1.0.0',
      requestId: request.requestId,
      runId: original.status.runId,
      recoveryId: recovery.recoveryId,
      retryFromStage: recovery.retryFromStage,
    });
    await secondRestart.close();
    const awaiting = secondRestart.status({
      formatVersion: '1.0.0',
      requestId: request.requestId,
      runId: original.status.runId,
    });
    expect(awaiting.status).toBe('awaiting_review');

    const thirdRestart = createProcedureTutorialAuthoringRunCoordinator({
      ...setup.options,
      existingEvents: stored(gapEvents),
      appendEvent: vi.fn(),
    });
    expect(
      thirdRestart.status({
        formatVersion: '1.0.0',
        requestId: request.requestId,
        runId: original.status.runId,
      }),
    ).toEqual(awaiting);
  });

  it('recovers when review-checkpoint persistence fails after materialization completion', async () => {
    const setup = fixture();
    let rejectReviewCheckpoint = true;
    setup.options.appendEvent = vi.fn((event: ExecutionEventInput) => {
      if (
        rejectReviewCheckpoint &&
        event.eventType === 'procedure.tutorial.authoring.review.required'
      ) {
        rejectReviewCheckpoint = false;
        throw new Error('/private/provider-secret');
      }
      setup.events.push(event);
    });
    const coordinator = createProcedureTutorialAuthoringRunCoordinator(setup.options);
    const accepted = coordinator.create(request);
    let recovery = coordinator.status({
      formatVersion: '1.0.0',
      requestId: request.requestId,
      runId: accepted.runId,
    });
    for (let attempt = 0; attempt < 20 && recovery.status !== 'recovery_required'; attempt += 1) {
      await new Promise<void>((resolveWait) => setImmediate(resolveWait));
      recovery = coordinator.status({
        formatVersion: '1.0.0',
        requestId: request.requestId,
        runId: accepted.runId,
      });
    }
    await coordinator.close();
    expect(recovery).toMatchObject({
      status: 'recovery_required',
      completedStages: ['caption_import', 'provider_generation'],
      retryFromStage: 'materialization',
    });
    expect(JSON.stringify(recovery)).not.toContain('provider-secret');

    const restarted = createProcedureTutorialAuthoringRunCoordinator({
      ...setup.options,
      existingEvents: stored(setup.events),
      appendEvent: (event) => setup.events.push(event),
    });
    expect(
      restarted.status({
        formatVersion: '1.0.0',
        requestId: request.requestId,
        runId: accepted.runId,
      }),
    ).toEqual(recovery);
    if (recovery.status !== 'recovery_required') throw new Error('expected recovery receipt');
    restarted.resume({
      formatVersion: '1.0.0',
      requestId: request.requestId,
      runId: accepted.runId,
      recoveryId: recovery.recoveryId,
      retryFromStage: recovery.retryFromStage,
    });
    await restarted.close();
    expect(
      restarted.status({
        formatVersion: '1.0.0',
        requestId: request.requestId,
        runId: accepted.runId,
      }),
    ).toMatchObject({ status: 'awaiting_review' });
  });

  it('waits for in-flight work during close and sanitizes callback failures', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });
    const setup = fixture({
      importCaption: vi.fn(async () => {
        await gate;
        throw new Error('/private/token/provider-secret');
      }),
    });
    const coordinator = createProcedureTutorialAuthoringRunCoordinator(setup.options);
    const accepted = coordinator.create(request);
    const closing = coordinator.close();
    let closed = false;
    void closing.then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    release();
    await closing;
    const failed = coordinator.status({
      formatVersion: '1.0.0',
      requestId: request.requestId,
      runId: accepted.runId,
    });
    expect(JSON.stringify(failed)).not.toContain('provider-secret');
    expect(failed).toMatchObject({ status: 'failed' });
    expect(() =>
      coordinator.create({ ...request, requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }),
    ).toThrowError(ProcedureTutorialAuthoringRunError);
  });
});
