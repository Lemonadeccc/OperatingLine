import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { ExecutionEventInput, StoredExecutionEvent } from '@operatingline/persistence';
import type { PlannerProvider } from '@operatingline/planner-provider-sdk';
import { describe, expect, it, vi } from 'vitest';

import {
  blenderActionCatalog,
  blenderInteractionCatalog,
} from '@operatingline/blender-action-catalog';
import {
  canonicalizeProtocolJsonValue,
  compileProcedureTreeToGuidePlan,
  plannerProviderContractVersion,
  plannerProviderDescriptorSchema,
  procedureAuthoringCandidateTreeSchema,
  procedureAuthoringValidationResultSchema,
  procedureTutorialYoutubeImportRequestSchema,
  type ProcedureAuthoringCandidateTree,
  type ProcedureAuthoringPromptPacket,
  type ProcedureTutorialTranscriptGenerateRequest,
  type ProcedureTutorialTranscriptImportRequest,
  type ProcedureTutorialYoutubeTrackSelectionCurrentResult,
} from '@operatingline/protocol';

import {
  createProcedureAuthoringGenerationCoordinator,
  restoreProcedureAuthoringProviderInvocations,
} from '../../../services/orchestrator/src/procedure-authoring-generation.js';
import { buildProcedureAuthoringPromptPacket } from '../../../services/orchestrator/src/procedure-authoring-prompt.js';
import { plannerProviderRequestFingerprint } from '../../../services/orchestrator/src/planner-provider-invocation.js';
import { createPlannerProviderRegistry } from '../../../services/orchestrator/src/planner-provider-registry.js';
import { buildProcedureTutorialTranscriptPromptPacket } from '../../../services/orchestrator/src/procedure-tutorial-transcript-import.js';
import { buildProcedureTutorialYoutubePromptPacket } from '../../../services/orchestrator/src/procedure-tutorial-youtube-import.js';
import type { ProcedureTutorialYoutubeCaptionAcquisitionResult } from '../../../services/orchestrator/src/youtube-caption-source.js';
import {
  validateGuidePlanAgainstActionCatalog,
  validateGuidePlanStructure,
} from '../../../services/orchestrator/src/guide-validation.js';

const request = {
  requestId: 'bc5ee4ab-cfda-4d78-9628-068544065522',
  providerId: 'procedure-author',
  targetAdapterId: 'blender',
  actionCatalogVersion: blenderActionCatalog.catalogVersion,
  interactionCatalogVersion: blenderInteractionCatalog.catalogVersion,
  goal: '制作雪人的头部，并创建、定位、缩放和命名左眼球体。',
  treeId: 'snowman.eye.left.procedure',
  revision: 1,
  locale: 'zh-CN',
} as const;

const tutorialRequest = {
  ...request,
  requestId: 'ac86838b-ff7d-4285-ae80-aed076048ca1',
  treeId: 'snowman.eye.left.tutorial.procedure',
  revision: 2,
  tutorial: {
    video: {
      uri: 'https://www.youtube.com/watch?v=operatingline-eye',
      title: 'Create and position a Blender eye',
      durationMs: 60_000,
      rightsStatus: 'permission_granted',
    },
    transcript: {
      origin: 'user_supplied',
      locale: 'en',
      segments: [
        {
          startMs: 5_000,
          endMs: 20_000,
          text: 'Add a UV sphere and set its size.',
          confidence: 0.98,
        },
        {
          startMs: 20_000,
          endMs: 35_000,
          text: 'Move, scale, and rename the eye.',
          confidence: 0.95,
        },
      ],
    },
  },
} as const;

const captionDocumentContent =
  '1\n00:00:05,000 --> 00:00:20,000\nAdd a <b>UV sphere</b> and set its size.\n\n2\n00:00:20,000 --> 00:00:35,000\nMove, scale, and rename the eye.\n';

const tutorialTranscriptGenerateRequest: ProcedureTutorialTranscriptGenerateRequest = {
  formatVersion: '1.0.0',
  requestId: 'e5f9a1b9-aa1e-41e0-b3e8-b0d8d38be6ca',
  providerId: request.providerId,
  targetAdapterId: request.targetAdapterId,
  actionCatalogVersion: request.actionCatalogVersion,
  interactionCatalogVersion: request.interactionCatalogVersion,
  goal: request.goal,
  treeId: 'snowman.eye.left.caption-document.procedure',
  revision: 3,
  locale: request.locale,
  tutorial: {
    video: {
      uri: 'https://www.youtube.com/watch?v=operatingline-caption-eye',
      title: 'Create and position a Blender eye from captions',
      durationMs: 60_000,
      rightsStatus: 'permission_granted',
    },
    captionDocument: {
      origin: 'user_supplied',
      format: 'srt',
      content: captionDocumentContent,
      locale: 'en',
      defaultConfidence: 0.93,
    },
  },
};

const youtubeSelectionRequestId = '68e3cc4a-fb97-42e9-8d31-c0fe7679eea0';
const youtubeImportRequest = procedureTutorialYoutubeImportRequestSchema.parse({
  formatVersion: '1.1.0',
  requestId: '8bfbbf5a-b535-4eeb-9a44-09f96d2bda19',
  selectionRequestId: youtubeSelectionRequestId,
  targetAdapterId: request.targetAdapterId,
  actionCatalogVersion: request.actionCatalogVersion,
  interactionCatalogVersion: request.interactionCatalogVersion,
  goal: request.goal,
  treeId: 'snowman.eye.left.youtube.procedure',
  revision: 4,
  locale: request.locale,
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
});

const youtubeAcquisition: ProcedureTutorialYoutubeCaptionAcquisitionResult = {
  video: {
    uri: `https://www.youtube.com/watch?v=${youtubeImportRequest.youtube.videoId}`,
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
      videoId: youtubeImportRequest.youtube.videoId,
      captionTrackId: youtubeImportRequest.youtube.captionTrackId,
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

function buildSelectedYoutubePacket(
  requestFingerprint = 'a'.repeat(64),
): ProcedureAuthoringPromptPacket {
  const selection: ProcedureTutorialYoutubeTrackSelectionCurrentResult = {
    formatVersion: '1.1.0',
    requestId: youtubeSelectionRequestId,
    requestFingerprint,
    sourceTrackList: {
      requestId: 'af653187-ac15-42eb-8652-d4b71b6c43ee',
      videoId: youtubeImportRequest.youtube.videoId,
      listedAt: '2026-08-18T09:00:00Z',
    },
    selectedTrack: {
      captionTrackId: youtubeImportRequest.youtube.captionTrackId,
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
  return buildProcedureTutorialYoutubePromptPacket(
    youtubeImportRequest,
    youtubeAcquisition,
    blenderActionCatalog,
    blenderInteractionCatalog,
    selection,
  );
}

function buildPacket(): ProcedureAuthoringPromptPacket {
  return buildProcedureAuthoringPromptPacket(
    {
      targetAdapterId: request.targetAdapterId,
      actionCatalogVersion: request.actionCatalogVersion,
      interactionCatalogVersion: request.interactionCatalogVersion,
      goal: request.goal,
      treeId: request.treeId,
      revision: request.revision,
      locale: request.locale,
    },
    blenderActionCatalog,
    blenderInteractionCatalog,
  );
}

function buildTutorialTranscriptPacket(
  importRequest: ProcedureTutorialTranscriptImportRequest,
): ProcedureAuthoringPromptPacket {
  return buildProcedureTutorialTranscriptPromptPacket(
    importRequest,
    blenderActionCatalog,
    blenderInteractionCatalog,
  );
}

function candidate(packet = buildPacket()): ProcedureAuthoringCandidateTree {
  const tree = JSON.parse(
    readFileSync(resolve('protocol/fixtures/v1/snowman-eye.procedure.json'), 'utf8'),
  ) as Record<string, unknown>;
  tree['id'] = packet.context.requestedTreeId;
  tree['revision'] = packet.context.recommendedRevision;
  tree['adapterId'] = packet.context.catalogBinding.adapterId;
  tree['actionCatalogVersion'] = packet.context.catalogBinding.actionCatalog.catalogVersion;
  tree['interactionCatalogVersion'] =
    packet.context.catalogBinding.interactionCatalog.catalogVersion;
  tree['hostVersionRange'] = packet.context.catalogBinding.interactionCatalog.hostVersionRange;
  const source = packet.context.goalProvenance.source;
  const evidence = { ...packet.context.goalProvenance.evidence, sourceId: source.id };
  tree['sources'] = [...(tree['sources'] as unknown[]), source];
  tree['evidence'] = [...(tree['evidence'] as unknown[]), evidence];
  const tutorial = packet.context.tutorialProvenance;
  const tutorialEvidence =
    tutorial === undefined
      ? []
      : tutorial.transcript.segments.map((segment) => ({
          id: segment.id,
          sourceId: tutorial.source.id,
          locator: segment.locator,
          description: segment.text,
          confidence: segment.confidence,
        }));
  if (tutorial !== undefined) {
    tree['sources'] = [...(tree['sources'] as unknown[]), tutorial.source];
    tree['evidence'] = [...(tree['evidence'] as unknown[]), ...tutorialEvidence];
  }
  for (const node of tree['nodes'] as Array<Record<string, unknown>>) {
    if (node['kind'] !== 'leaf') continue;
    const leafId = String(node['id']);
    node['menuTracks'] = [
      {
        id: `${leafId}.menu.unavailable`,
        availability: 'unavailable',
        title: 'Menu grounding pending',
        reason: 'Provider candidates cannot assert catalog grounding.',
        modality: 'menu',
      },
    ];
    node['shortcutTracks'] = [
      {
        id: `${leafId}.shortcut.unavailable`,
        availability: 'unavailable',
        title: 'Shortcut grounding pending',
        reason: 'Provider candidates cannot assert shortcut verification.',
        modality: 'shortcut',
      },
    ];
    node['mcpTracks'] = [
      {
        id: `${leafId}.mcp.unavailable`,
        availability: 'unavailable',
        title: 'MCP grounding pending',
        reason: 'Provider candidates cannot invent action-level tools.',
        modality: 'mcp',
      },
    ];
    for (const [index, operation] of (
      node['semanticOperations'] as Array<Record<string, unknown>>
    ).entries()) {
      if (tutorialEvidence.length === 0) continue;
      operation['evidenceRefs'] = [
        ...(operation['evidenceRefs'] as string[]),
        tutorialEvidence[index % tutorialEvidence.length]!.id,
      ];
    }
  }
  return procedureAuthoringCandidateTreeSchema.parse(tree);
}

function provider(output: (packet: ProcedureAuthoringPromptPacket) => unknown): PlannerProvider {
  const descriptor = plannerProviderDescriptorSchema.parse({
    contractVersion: plannerProviderContractVersion,
    id: request.providerId,
    version: '1.0.0',
    displayName: 'Procedure author test provider',
    description: 'Returns a deterministic ProcedureTree candidate for tests.',
    availability: { available: true },
    limits: { maxConcurrency: 1 },
    dataHandling: {
      executionLocation: 'local',
      dataTransmission: 'none',
      credentialManagement: 'provider_managed',
    },
  });
  return {
    descriptor,
    describeRuntimeTreatment: (operation) => ({
      profile: {
        descriptor,
        vendor: 'test',
        implementation: { name: 'procedure-author-test', version: '1.0.0' },
        model: {
          requested: 'deterministic-test',
          resolvedRevision: 'deterministic-test-1',
          resolution: 'resolved',
        },
        api: {
          surface: operation,
          version: '1.0.0',
          sdkName: 'test',
          sdkVersion: '1.0.0',
          endpointClass: 'local',
          serviceTier: null,
          region: null,
        },
      },
      generationSettings: {
        normalizedParameters: { mode: 'deterministic' },
        seed: null,
        determinism: 'deterministic',
      },
    }),
    generate: async () => ({}),
    authorProcedure: vi.fn(async ({ packet, renderedPrompt }) => {
      expect(renderedPrompt).toBe(
        Buffer.from(canonicalizeProtocolJsonValue(packet)).toString('utf8'),
      );
      return output(packet);
    }),
  };
}

function validateCandidate(
  packet: ProcedureAuthoringPromptPacket,
  tree: ProcedureAuthoringCandidateTree,
) {
  const plan = compileProcedureTreeToGuidePlan(tree);
  validateGuidePlanStructure(plan);
  validateGuidePlanAgainstActionCatalog(plan, blenderActionCatalog);
  return procedureAuthoringValidationResultSchema.parse({
    formatVersion: packet.formatVersion,
    packetContentSha256: packet.integrity.contentSha256,
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
}

function stored(events: readonly ExecutionEventInput[]): StoredExecutionEvent[] {
  return events.map((event, index) => ({
    sequence: index + 1,
    id: event.id,
    eventType: event.eventType,
    payload: event.payload,
    createdAt: event.createdAt ?? '2026-08-18T00:00:00.000Z',
  }));
}

describe('Procedure authoring provider generation', () => {
  it('calls the explicit capability, validates the candidate, audits it, and is idempotent', async () => {
    const expected = candidate();
    const selectedProvider = provider(() => expected);
    const events: ExecutionEventInput[] = [];
    const registry = createPlannerProviderRegistry([selectedProvider]);
    const coordinator = createProcedureAuthoringGenerationCoordinator({
      registry,
      existingEvents: [],
      buildPacket: () => buildPacket(),
      buildTutorialTranscriptPacket,
      validateCandidate,
      appendEvent: (event) => events.push(event),
    });

    expect(registry.listProcedureAuthors()).toMatchObject({
      generationAvailable: true,
      providers: [{ id: request.providerId }],
    });
    const first = await coordinator.generate(request);
    const second = await coordinator.generate(request);

    expect(second).toEqual(first);
    expect(selectedProvider.authorProcedure).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({
      requestId: request.requestId,
      provider: { id: request.providerId, version: '1.0.0' },
      packet: { context: { requestedTreeId: request.treeId } },
      tree: { id: request.treeId, revision: 1 },
      sideEffects: {
        modelCalled: true,
        procedureStored: false,
        proposalCreated: false,
        hostExecutionStarted: false,
      },
    });
    expect(events.map((event) => event.eventType)).toEqual([
      'procedure.authoring.provider.generation.requested',
      'procedure.authoring.provider.generation.completed',
    ]);
    expect(events[0]?.payload).toMatchObject({
      runtimeTreatment: { operation: 'procedure_authoring' },
    });
    expect(events[1]?.payload).toMatchObject({
      runtimeAttestation: {
        operation: 'procedure_authoring',
        treatment: { operation: 'procedure_authoring' },
      },
    });
    expect(restoreProcedureAuthoringProviderInvocations(stored(events))).toMatchObject([
      { operation: 'procedure_authoring' },
      { operation: 'procedure_authoring', result: first },
    ]);
    await coordinator.close();

    const restartedProvider = provider(() => {
      throw new Error('A completed generation must restore without another provider call.');
    });
    const restarted = createProcedureAuthoringGenerationCoordinator({
      registry: createPlannerProviderRegistry([restartedProvider]),
      existingEvents: stored(events),
      buildPacket: () => buildPacket(),
      buildTutorialTranscriptPacket,
      validateCandidate,
      appendEvent: () => {
        throw new Error('A restored completed generation must not append duplicate evidence.');
      },
    });
    await expect(restarted.generate(request)).resolves.toEqual(first);
    expect(restartedProvider.authorProcedure).not.toHaveBeenCalled();
    await restarted.close();
  });

  it('fails closed on packet identity changes and records one terminal failure', async () => {
    const changed = structuredClone(candidate());
    changed.id = 'different.procedure';
    const events: ExecutionEventInput[] = [];
    const selectedProvider = provider(() => changed);
    const coordinator = createProcedureAuthoringGenerationCoordinator({
      registry: createPlannerProviderRegistry([selectedProvider]),
      existingEvents: [],
      buildPacket: () => buildPacket(),
      buildTutorialTranscriptPacket,
      validateCandidate,
      appendEvent: (event) => events.push(event),
    });

    await expect(coordinator.generate(request)).rejects.toMatchObject({
      code: 'planner_identity_mismatch',
      retryMode: 'new_request_id',
    });
    await expect(coordinator.generate(request)).rejects.toMatchObject({
      code: 'planner_generation_already_attempted',
    });
    expect(events.map((event) => event.eventType)).toEqual([
      'procedure.authoring.provider.generation.requested',
      'procedure.authoring.provider.generation.failed',
    ]);
    await coordinator.close();
  });

  it('carries exact tutorial transcript provenance through explicit Provider generation', async () => {
    const events: ExecutionEventInput[] = [];
    const selectedProvider = provider((packet) => candidate(packet));
    const coordinator = createProcedureAuthoringGenerationCoordinator({
      registry: createPlannerProviderRegistry([selectedProvider]),
      existingEvents: [],
      buildPacket: (promptRequest) =>
        buildProcedureAuthoringPromptPacket(
          promptRequest,
          blenderActionCatalog,
          blenderInteractionCatalog,
        ),
      buildTutorialTranscriptPacket,
      validateCandidate,
      appendEvent: (event) => events.push(event),
    });

    const result = await coordinator.generate(tutorialRequest);
    expect(result.packet.formatVersion).toBe('1.1.0');
    expect(result.packet.context).toMatchObject({
      requestedTreeId: tutorialRequest.treeId,
      recommendedRevision: tutorialRequest.revision,
      tutorialProvenance: {
        source: {
          uri: tutorialRequest.tutorial.video.uri,
          rightsStatus: 'permission_granted',
        },
        transcript: {
          origin: 'user_supplied',
        },
      },
      constraints: { allSemanticOperationsTutorialEvidenceBound: true },
    });
    expect(result.packet.context.tutorialProvenance?.transcript.segments).toHaveLength(2);
    expect(result.packet.context.tutorialProvenance?.transcript.segments[0]).toMatchObject({
      locator: { kind: 'video_segment', startMs: 5_000, endMs: 20_000 },
      text: tutorialRequest.tutorial.transcript.segments[0].text,
    });
    expect(events.at(-1)?.payload).toMatchObject({
      request: { tutorial: tutorialRequest.tutorial },
      result: {
        packet: {
          context: {
            tutorialProvenance: {
              source: { uri: tutorialRequest.tutorial.video.uri },
            },
          },
        },
      },
    });
    await coordinator.close();
  });

  it('generates from a caption document once and restores without persisting raw document syntax', async () => {
    const events: ExecutionEventInput[] = [];
    const selectedProvider = provider((packet) => candidate(packet));
    const coordinator = createProcedureAuthoringGenerationCoordinator({
      registry: createPlannerProviderRegistry([selectedProvider]),
      existingEvents: [],
      buildPacket: () => buildPacket(),
      buildTutorialTranscriptPacket,
      validateCandidate,
      appendEvent: (event) => events.push(event),
    });

    const first = await coordinator.generateTutorialTranscript(tutorialTranscriptGenerateRequest);
    const second = await coordinator.generateTutorialTranscript(tutorialTranscriptGenerateRequest);

    expect(second).toEqual(first);
    expect(selectedProvider.authorProcedure).toHaveBeenCalledTimes(1);
    await expect(
      coordinator.generateTutorialTranscript({
        ...tutorialTranscriptGenerateRequest,
        tutorial: {
          ...tutorialTranscriptGenerateRequest.tutorial,
          captionDocument: {
            ...tutorialTranscriptGenerateRequest.tutorial.captionDocument,
            content: `${captionDocumentContent}\n`,
          },
        },
      }),
    ).rejects.toMatchObject({
      code: 'planner_generation_conflict',
      retryMode: 'new_request_id',
    });
    expect(selectedProvider.authorProcedure).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({
      requestId: tutorialTranscriptGenerateRequest.requestId,
      packet: {
        formatVersion: '1.2.0',
        context: {
          requestedTreeId: tutorialTranscriptGenerateRequest.treeId,
          tutorialProvenance: {
            transcript: {
              document: {
                format: 'srt',
                contentSha256: createHash('sha256')
                  .update(captionDocumentContent, 'utf8')
                  .digest('hex'),
                contentBytes: Buffer.byteLength(captionDocumentContent, 'utf8'),
                cueCount: 2,
                confidence: { origin: 'user_declared_default', value: 0.93 },
              },
              segments: [
                { order: 1, text: 'Add a UV sphere and set its size.' },
                { order: 2, text: 'Move, scale, and rename the eye.' },
              ],
            },
          },
          constraints: { tutorialTranscriptDocumentBound: true },
        },
      },
      tree: { id: tutorialTranscriptGenerateRequest.treeId, revision: 3 },
      sideEffects: {
        modelCalled: true,
        procedureStored: false,
        proposalCreated: false,
        hostExecutionStarted: false,
      },
    });
    expect(events.map((event) => event.eventType)).toEqual([
      'procedure.authoring.provider.generation.requested',
      'procedure.authoring.provider.generation.completed',
    ]);
    expect(events[1]?.payload).toMatchObject({
      requestFingerprint: plannerProviderRequestFingerprint(tutorialTranscriptGenerateRequest),
      request: {
        requestId: tutorialTranscriptGenerateRequest.requestId,
        tutorial: {
          transcript: {
            origin: 'user_supplied',
            segments: [
              { startMs: 5_000, endMs: 20_000 },
              { startMs: 20_000, endMs: 35_000 },
            ],
          },
        },
      },
    });
    const serializedEvidence = JSON.stringify(events);
    expect(serializedEvidence).not.toContain('captionDocument');
    expect(serializedEvidence).not.toContain(captionDocumentContent);
    await coordinator.close();

    const restartedProvider = provider(() => {
      throw new Error('Restored caption generation must not call the Provider again.');
    });
    const restarted = createProcedureAuthoringGenerationCoordinator({
      registry: createPlannerProviderRegistry([restartedProvider]),
      existingEvents: stored(events),
      buildPacket: () => buildPacket(),
      buildTutorialTranscriptPacket,
      validateCandidate,
      appendEvent: () => {
        throw new Error('Restored caption generation must not append duplicate evidence.');
      },
    });
    await expect(
      restarted.generateTutorialTranscript(tutorialTranscriptGenerateRequest),
    ).resolves.toEqual(first);
    expect(restartedProvider.authorProcedure).not.toHaveBeenCalled();
    await restarted.close();
  });

  it('generates idempotently from the exact supplied selected-caption packet', async () => {
    const packet = buildSelectedYoutubePacket();
    const events: ExecutionEventInput[] = [];
    const selectedProvider = provider((providerPacket) => candidate(providerPacket));
    const coordinator = createProcedureAuthoringGenerationCoordinator({
      registry: createPlannerProviderRegistry([selectedProvider]),
      existingEvents: [],
      buildPacket: () => buildPacket(),
      buildTutorialTranscriptPacket,
      validateCandidate,
      appendEvent: (event) => events.push(event),
    });
    const input = {
      requestId: '8a8f752a-a5a5-4a32-b7ad-e102593cd7b5',
      providerId: request.providerId,
      packet,
    };

    const first = await coordinator.generateFromPacket(input);
    const second = await coordinator.generateFromPacket(input);

    expect(second).toEqual(first);
    expect(selectedProvider.authorProcedure).toHaveBeenCalledTimes(1);
    expect(selectedProvider.authorProcedure).toHaveBeenCalledWith(
      expect.objectContaining({ packet }),
    );
    expect(first.packet).toEqual(packet);
    expect(first.packet.context.tutorialProvenance?.transcript.document?.acquisition).toEqual(
      packet.context.tutorialProvenance?.transcript.document?.acquisition,
    );
    expect(events[0]?.payload).toMatchObject({
      inputMode: 'prepared_packet',
      packetContentSha256: packet.integrity.contentSha256,
    });
    expect(events[1]?.payload).toMatchObject({
      inputMode: 'prepared_packet',
      requestFingerprint: plannerProviderRequestFingerprint({
        requestId: input.requestId,
        providerId: input.providerId,
        packet,
      }),
      request: {
        requestId: input.requestId,
        providerId: input.providerId,
        packetContentSha256: packet.integrity.contentSha256,
      },
      result: { packet },
    });
    expect(JSON.stringify(events[1]?.payload)).not.toContain('user_supplied');
    const completedEvidence = coordinator.completedEvidence(input.requestId);
    expect(completedEvidence).toEqual({
      eventId: `procedure-authoring-generation-completed:${input.requestId}`,
      event: events[1]?.payload,
    });
    await coordinator.close();

    const restartedProvider = provider(() => {
      throw new Error('Restored packet generation must not call the Provider again.');
    });
    const restarted = createProcedureAuthoringGenerationCoordinator({
      registry: createPlannerProviderRegistry([restartedProvider]),
      existingEvents: stored(events),
      buildPacket: () => buildPacket(),
      buildTutorialTranscriptPacket,
      validateCandidate,
      appendEvent: () => {
        throw new Error('Restored packet generation must not append duplicate evidence.');
      },
    });
    await expect(restarted.generateFromPacket(input)).resolves.toEqual(first);
    expect(restarted.completedEvidence(input.requestId)).toEqual(completedEvidence);
    expect(restartedProvider.authorProcedure).not.toHaveBeenCalled();
    await restarted.close();
  });

  it('conflicts when the same packet-generation request id selects another caption packet', async () => {
    const firstPacket = buildSelectedYoutubePacket('a'.repeat(64));
    const secondPacket = buildSelectedYoutubePacket('b'.repeat(64));
    const selectedProvider = provider((providerPacket) => candidate(providerPacket));
    const coordinator = createProcedureAuthoringGenerationCoordinator({
      registry: createPlannerProviderRegistry([selectedProvider]),
      existingEvents: [],
      buildPacket: () => buildPacket(),
      buildTutorialTranscriptPacket,
      validateCandidate,
      appendEvent: () => undefined,
    });
    const identity = {
      requestId: '3002c13f-cdc7-4de1-b454-1f7c996b956e',
      providerId: request.providerId,
    };

    await coordinator.generateFromPacket({ ...identity, packet: firstPacket });
    await expect(
      coordinator.generateFromPacket({ ...identity, packet: secondPacket }),
    ).rejects.toMatchObject({
      code: 'planner_generation_conflict',
      retryMode: 'new_request_id',
    });
    expect(selectedProvider.authorProcedure).toHaveBeenCalledTimes(1);
    await coordinator.close();
  });

  it('rejects invalid supplied packet integrity before calling the Provider', async () => {
    const packet = structuredClone(buildSelectedYoutubePacket());
    packet.integrity.contentSha256 = '0'.repeat(64);
    const events: ExecutionEventInput[] = [];
    const selectedProvider = provider((providerPacket) => candidate(providerPacket));
    const coordinator = createProcedureAuthoringGenerationCoordinator({
      registry: createPlannerProviderRegistry([selectedProvider]),
      existingEvents: [],
      buildPacket: () => buildPacket(),
      buildTutorialTranscriptPacket,
      validateCandidate,
      appendEvent: (event) => events.push(event),
    });

    await expect(
      coordinator.generateFromPacket({
        requestId: 'bbce8791-a4c1-40df-8c2b-bd3357e84c38',
        providerId: request.providerId,
        packet,
      }),
    ).rejects.toThrow('Procedure authoring packet integrity check failed');
    expect(selectedProvider.authorProcedure).not.toHaveBeenCalled();
    expect(events).toEqual([]);
    await coordinator.close();
  });

  it('rejects providers without the explicit Procedure authoring method before any call', async () => {
    const selectedProvider = provider(() => candidate());
    delete (selectedProvider as { authorProcedure?: unknown }).authorProcedure;
    const events: ExecutionEventInput[] = [];
    const registry = createPlannerProviderRegistry([selectedProvider]);
    const coordinator = createProcedureAuthoringGenerationCoordinator({
      registry,
      existingEvents: [],
      buildPacket: () => buildPacket(),
      buildTutorialTranscriptPacket,
      validateCandidate,
      appendEvent: (event) => events.push(event),
    });

    expect(registry.listProcedureAuthors()).toMatchObject({
      generationAvailable: false,
      providers: [],
    });
    await expect(coordinator.generate(request)).rejects.toMatchObject({
      code: 'planner_procedure_authoring_not_supported',
      retryMode: 'same_request_id',
    });
    expect(events).toEqual([]);
    await coordinator.close();
  });
});
