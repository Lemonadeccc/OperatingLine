import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  compileProcedureTreeToGuidePlan,
  procedureAuthoringPromptContextSchema,
  procedureAuthoringGenerateRequestSchema,
  procedureAuthoringGenerationResultSchema,
  procedureAuthoringPromptPacketSchema,
  procedureAuthoringPromptPacketMaxCanonicalBytes,
  procedureAuthoringPromptRequestSchema,
  procedureAuthoringValidationRequestSchema,
  procedureAuthoringValidationResultSchema,
  procedureAuthoringCandidateTreeSchema,
  type ProcedureTree,
} from '@operatingline/protocol';

import { validatePublicJsonSchemaCases } from '../../services/orchestrator/test-support/public-json-schema-validator.js';

function publicSchema(filename: string): object {
  return JSON.parse(readFileSync(resolve('protocol/schemas/v1', filename), 'utf8')) as object;
}

function readProcedureTree(): ProcedureTree {
  return JSON.parse(
    readFileSync(resolve('protocol/fixtures/v1/snowman-eye.procedure.json'), 'utf8'),
  ) as ProcedureTree;
}

function readCandidateProcedureTree(): ProcedureTree {
  const tree = readProcedureTree();
  for (const node of tree.nodes) {
    if (node.kind !== 'leaf') continue;
    node.menuTracks = [
      {
        id: `${node.id}.menu.unavailable`,
        availability: 'unavailable',
        title: 'Menu grounding pending',
        reason: 'A deterministic grounding stage has not materialized this track.',
        modality: 'menu',
      },
    ];
    node.shortcutTracks = [
      {
        id: `${node.id}.shortcut.unavailable`,
        availability: 'unavailable',
        title: 'Shortcut grounding pending',
        reason: 'A deterministic grounding stage has not materialized this track.',
        modality: 'shortcut',
      },
    ];
    node.mcpTracks = [
      {
        id: `${node.id}.mcp.unavailable`,
        availability: 'unavailable',
        title: 'MCP grounding pending',
        reason: 'A deterministic grounding stage has not materialized this track.',
        modality: 'mcp',
      },
    ];
  }
  return tree;
}

const actionCatalog = {
  protocolVersion: '1.5.0',
  catalogVersion: '1.0.0',
  adapterId: 'example',
  adapterVersionRange: '>=1.0.0 <2.0.0',
  hostVersionRange: '>=4.0.0 <5.0.0',
  title: 'Example actions',
  description: 'Actions used by the authoring contract test.',
  planningNotes: [],
  actions: [
    {
      name: 'example.create',
      title: 'Create',
      description: 'Create an example resource.',
      argumentsSchema: { type: 'object', properties: {}, additionalProperties: false },
      resourceEffects: [],
      supportedAnchorKinds: ['unavailable'],
      supportedObservationKinds: ['result'],
      rollbackModes: ['compensating_action'],
      safety: {
        sideEffect: 'scene_write',
        requiresPlanApproval: true,
        networkAccess: false,
        fileAccess: 'none',
      },
    },
  ],
} as const;

const interactionCatalog = {
  protocolVersion: '1.5.0',
  catalogVersion: '1.0.0',
  adapterId: 'example',
  actionCatalogVersion: '1.0.0',
  adapterVersionRange: '>=1.0.0 <2.0.0',
  hostVersionRange: '>=4.0.0 <5.0.0',
  title: 'Example interactions',
  description: 'Interactions used by the authoring contract test.',
  recipes: [
    {
      id: 'example.create.recipe',
      actionName: 'example.create',
      title: 'Create example',
      guidance: {
        kind: 'semantic_path',
        steps: [
          {
            id: 'example.create.step',
            order: 1,
            label: 'Create the resource',
            intent: 'execute',
            target: { kind: 'semantic', hostId: 'example.create' },
          },
        ],
        reason: 'No grounded native interaction is available.',
      },
    },
  ],
} as const;

const packet = {
  formatVersion: '1.0.0',
  context: {
    requestedTreeId: 'example.create.procedure',
    recommendedRevision: 1,
    goalProvenance: {
      source: {
        id: 'source.example.create.procedure.revision.1.goal',
        kind: 'natural_language',
        text: 'Create the example resource.',
        locale: 'en',
      },
      evidence: {
        id: 'evidence.example.create.procedure.revision.1.goal',
        locator: { kind: 'whole_source' },
        description: 'The complete authoring goal.',
        confidence: 1,
      },
    },
    catalogBinding: {
      adapterId: 'example',
      actionCatalog: {
        protocolVersion: actionCatalog.protocolVersion,
        catalogVersion: actionCatalog.catalogVersion,
        adapterVersionRange: actionCatalog.adapterVersionRange,
        hostVersionRange: actionCatalog.hostVersionRange,
        title: actionCatalog.title,
        description: actionCatalog.description,
        planningNotes: actionCatalog.planningNotes,
        actions: actionCatalog.actions,
      },
      interactionCatalog: {
        protocolVersion: interactionCatalog.protocolVersion,
        catalogVersion: interactionCatalog.catalogVersion,
        adapterVersionRange: interactionCatalog.adapterVersionRange,
        hostVersionRange: interactionCatalog.hostVersionRange,
        title: interactionCatalog.title,
        description: interactionCatalog.description,
        recipes: interactionCatalog.recipes,
      },
    },
    constraints: {
      allGeneratedLeavesCandidate: true,
      validatedHostVersionsEmpty: true,
      exactParametersRemainOnSemanticOperations: true,
      allInteractionTracksUnavailable: true,
      persistenceRequiresExplicitStore: true,
    },
  },
  retrieval: {
    toolName: 'operatingline.procedure.search',
    matching: 'exact_structured_filters',
    similarityScoreProduced: false,
  },
  responseContract: { mediaType: 'application/json', schema: {} },
  workflow: {
    validationToolName: 'operatingline.procedure.authoring.validate',
    compileToolName: 'operatingline.procedure.compile',
    instructions: ['Return one candidate ProcedureTree JSON object.'],
  },
  limits: { maxCanonicalBytes: procedureAuthoringPromptPacketMaxCanonicalBytes },
  sideEffects: {
    modelCalled: false,
    procedureStored: false,
    proposalCreated: false,
    hostExecutionStarted: false,
  },
  integrity: {
    algorithm: 'sha256',
    canonicalization: 'operatingline-json-value-v1',
    contentSha256: 'a'.repeat(64),
  },
} as const;

const tutorialInput = {
  video: {
    uri: 'https://www.youtube.com/watch?v=example-tutorial',
    title: 'Example tutorial',
    durationMs: 60_000,
    rightsStatus: 'license_verified',
    license: 'CC-BY-4.0',
  },
  transcript: {
    origin: 'user_supplied',
    locale: 'en',
    segments: [
      {
        startMs: 1_000,
        endMs: 5_000,
        text: 'Create the example resource.',
        confidence: 0.95,
      },
    ],
  },
} as const;

const tutorialContext = {
  ...packet.context,
  tutorialProvenance: {
    source: {
      id: 'source.example.create.procedure.revision.1.tutorial',
      kind: 'tutorial_video',
      ...tutorialInput.video,
    },
    transcript: {
      origin: tutorialInput.transcript.origin,
      locale: tutorialInput.transcript.locale,
      segments: [
        {
          id: 'evidence.example.create.procedure.revision.1.tutorial.segment.0001',
          order: 1,
          locator: { kind: 'video_segment', startMs: 1_000, endMs: 5_000 },
          text: tutorialInput.transcript.segments[0].text,
          confidence: tutorialInput.transcript.segments[0].confidence,
        },
      ],
    },
  },
  constraints: {
    ...packet.context.constraints,
    allSemanticOperationsTutorialEvidenceBound: true,
  },
} as const;

const tutorialPacket = {
  ...packet,
  formatVersion: '1.1.0',
  context: tutorialContext,
} as const;

describe('public procedure authoring JSON Schemas', () => {
  it('matches strict request and packet literals in Zod and public JSON Schema', async () => {
    const requestCases = [
      {
        value: {
          targetAdapterId: 'example',
          goal: 'Create the example resource.',
          treeId: 'example.create.procedure',
          revision: 1,
        },
        accepted: true,
      },
      {
        value: {
          targetAdapterId: 'example',
          goal: 'Create the example resource from the tutorial.',
          treeId: 'example.create.tutorial.procedure',
          revision: 1,
          tutorial: tutorialInput,
        },
        accepted: true,
      },
      {
        value: {
          targetAdapterId: 'example',
          goal: 'Create the example resource from the tutorial.',
          treeId: 'example.create.tutorial.procedure',
          revision: 1,
          tutorial: {
            ...tutorialInput,
            video: {
              uri: tutorialInput.video.uri,
              title: tutorialInput.video.title,
              durationMs: tutorialInput.video.durationMs,
              rightsStatus: 'license_verified',
            },
          },
        },
        accepted: false,
      },
      {
        value: {
          targetAdapterId: 'example',
          goal: 'Create the example resource from the tutorial.',
          treeId: 'example.create.tutorial.procedure',
          revision: 1,
          tutorial: {
            ...tutorialInput,
            video: { ...tutorialInput.video, uri: 'http://example.com/tutorial' },
          },
        },
        accepted: false,
      },
      {
        value: {
          targetAdapterId: 'example',
          goal: '   ',
          treeId: 'example.create.procedure',
          revision: 1,
        },
        accepted: false,
      },
      {
        value: {
          targetAdapterId: 'example',
          goal: 'Create the example resource.',
          treeId: 'example.create.procedure',
          revision: 0,
        },
        accepted: false,
      },
      {
        value: {
          targetAdapterId: ' example ',
          goal: 'Create the example resource.',
          treeId: 'example.create.procedure',
          revision: 1,
        },
        accepted: false,
      },
      {
        value: {
          targetAdapterId: 'example',
          goal: 'Create the example resource.',
          treeId: 'example.create.procedure',
          revision: 1,
          locale: '   ',
        },
        accepted: false,
      },
    ] as const;
    for (const contractCase of requestCases) {
      expect(procedureAuthoringPromptRequestSchema.safeParse(contractCase.value).success).toBe(
        contractCase.accepted,
      );
    }
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-authoring-prompt-request.schema.json'),
      requestCases,
    );
    expect(
      procedureAuthoringPromptRequestSchema.safeParse({
        targetAdapterId: 'example',
        goal: 'Create the example resource from the tutorial.',
        treeId: 'example.create.tutorial.procedure',
        revision: 1,
        tutorial: {
          ...tutorialInput,
          transcript: {
            ...tutorialInput.transcript,
            segments: [
              tutorialInput.transcript.segments[0],
              {
                startMs: 4_000,
                endMs: 6_000,
                text: 'This overlaps the previous segment.',
                confidence: 0.9,
              },
            ],
          },
        },
      }).success,
    ).toBe(false);

    const packetCases = [
      { value: packet, accepted: true },
      { value: tutorialPacket, accepted: true },
      {
        value: { ...tutorialPacket, formatVersion: '1.0.0' },
        accepted: false,
      },
      {
        value: { ...packet, formatVersion: '1.1.0' },
        accepted: false,
      },
      {
        value: {
          ...packet,
          retrieval: { ...packet.retrieval, similarityScoreProduced: true },
        },
        accepted: false,
      },
      {
        value: { ...packet, sideEffects: { ...packet.sideEffects, modelCalled: true } },
        accepted: false,
      },
      {
        value: { ...packet, renderedPrompt: 'Duplicated packet content.' },
        accepted: false,
      },
      {
        value: {
          ...packet,
          integrity: { ...packet.integrity, contentSha256: 'A'.repeat(64) },
        },
        accepted: false,
      },
    ] as const;
    for (const contractCase of packetCases) {
      expect(procedureAuthoringPromptPacketSchema.safeParse(contractCase.value).success).toBe(
        contractCase.accepted,
      );
    }
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-authoring-prompt-packet.schema.json'),
      packetCases,
    );
  });

  it('forces every candidate leaf to remain unvalidated in Zod and public JSON Schema', async () => {
    const candidate = readCandidateProcedureTree();
    const availableTracks = readProcedureTree();
    const blankSource = structuredClone(candidate);
    blankSource.sources.push({
      id: 'source.blank',
      kind: 'natural_language',
      text: '   ',
    });
    const spacedSource = structuredClone(candidate);
    spacedSource.sources.push({
      id: 'source.spaced',
      kind: 'natural_language',
      text: '  Preserve these spaces.  ',
    });
    const verified = structuredClone(candidate);
    const verifiedLeaf = verified.nodes.find((node) => node.kind === 'leaf');
    if (verifiedLeaf?.kind !== 'leaf') throw new Error('Expected procedure leaf');
    verifiedLeaf.validation.status = 'verified';
    verifiedLeaf.validation.validatedHostVersions = ['4.3.0'];

    const cases = [
      { value: candidate, accepted: true },
      { value: availableTracks, accepted: false },
      { value: blankSource, accepted: false },
      { value: spacedSource, accepted: true },
      { value: verified, accepted: false },
    ] as const;
    for (const contractCase of cases) {
      expect(procedureAuthoringCandidateTreeSchema.safeParse(contractCase.value).success).toBe(
        contractCase.accepted,
      );
    }
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-authoring-candidate-tree.schema.json'),
      cases,
    );
    const parsedSpacedSource = procedureAuthoringCandidateTreeSchema
      .parse(spacedSource)
      .sources.at(-1);
    expect(parsedSpacedSource?.kind).toBe('natural_language');
    if (parsedSpacedSource?.kind !== 'natural_language') {
      throw new Error('Expected natural-language source');
    }
    expect(parsedSpacedSource.text).toBe('  Preserve these spaces.  ');
  });

  it('uses one normalized authoring binding in Zod and public JSON Schema', async () => {
    const context = packet.context;
    const cases = [
      { value: context, accepted: true },
      { value: tutorialContext, accepted: true },
      {
        value: {
          ...tutorialContext,
          constraints: packet.context.constraints,
        },
        accepted: false,
      },
      {
        value: { ...context, goal: 'A duplicated goal.' },
        accepted: false,
      },
      {
        value: {
          ...context,
          goalProvenance: {
            ...context.goalProvenance,
            evidence: { ...context.goalProvenance.evidence, sourceId: 'source.other' },
          },
        },
        accepted: false,
      },
      {
        value: {
          ...context,
          catalogBinding: {
            ...context.catalogBinding,
            interactionCatalog: {
              ...context.catalogBinding.interactionCatalog,
              actionCatalogVersion: '2.0.0',
            },
          },
        },
        accepted: false,
      },
      {
        value: { ...context, hostVersionRange: '>=4.1.0 <5.0.0' },
        accepted: false,
      },
    ] as const;

    for (const contractCase of cases) {
      expect(procedureAuthoringPromptContextSchema.safeParse(contractCase.value).success).toBe(
        contractCase.accepted,
      );
    }
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-authoring-prompt-context.schema.json'),
      cases,
    );
  });

  it('publishes strict packet-bound validation request and result contracts', async () => {
    const candidate = readCandidateProcedureTree();
    const availableTracks = readProcedureTree();
    const validationRequestCases = [
      { value: { packet, tree: candidate }, accepted: true },
      { value: { packet, tree: availableTracks }, accepted: false },
      {
        value: { packet, tree: candidate, packetContentSha256: 'a'.repeat(64) },
        accepted: false,
      },
    ] as const;
    for (const contractCase of validationRequestCases) {
      expect(procedureAuthoringValidationRequestSchema.safeParse(contractCase.value).success).toBe(
        contractCase.accepted,
      );
    }
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-authoring-validation-request.schema.json'),
      validationRequestCases,
    );

    const result = {
      formatVersion: '1.0.0',
      packetContentSha256: 'a'.repeat(64),
      validation: {
        packetIntegrity: 'validated',
        installedCatalogBinding: 'validated',
        authoringCandidateContract: 'validated',
        procedureCompilation: 'validated',
      },
      compilation: {
        formatVersion: candidate.formatVersion,
        procedureTreeId: candidate.id,
        procedureTreeRevision: candidate.revision,
        adapterId: candidate.adapterId,
        actionCatalogVersion: candidate.actionCatalogVersion,
        interactionCatalogVersion: candidate.interactionCatalogVersion,
        validation: {
          procedureStructure: 'validated',
          actionCatalogBinding: 'validated',
          hostVersionRange: 'validated_against_action_catalog',
          interactionTracks: 'structural_only',
        },
        plan: compileProcedureTreeToGuidePlan(candidate),
        proposalCreated: false,
        hostExecutionStarted: false,
      },
      procedureStored: false,
      proposalCreated: false,
      hostExecutionStarted: false,
    } as const;
    const validationResultCases = [
      { value: result, accepted: true },
      {
        value: { ...result, procedureStored: true },
        accepted: false,
      },
      {
        value: {
          ...result,
          validation: { ...result.validation, packetIntegrity: 'unchecked' },
        },
        accepted: false,
      },
    ] as const;
    for (const contractCase of validationResultCases) {
      expect(procedureAuthoringValidationResultSchema.safeParse(contractCase.value).success).toBe(
        contractCase.accepted,
      );
    }
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-authoring-validation-result.schema.json'),
      validationResultCases,
    );
  });

  it('publishes strict explicit Provider generation request and result contracts', async () => {
    const candidate = readCandidateProcedureTree();
    const generationPacket = structuredClone(packet);
    generationPacket.context.requestedTreeId = candidate.id;
    generationPacket.context.recommendedRevision = candidate.revision;
    generationPacket.context.catalogBinding.adapterId = candidate.adapterId;
    generationPacket.context.catalogBinding.actionCatalog.catalogVersion =
      candidate.actionCatalogVersion;
    generationPacket.context.catalogBinding.interactionCatalog.catalogVersion =
      candidate.interactionCatalogVersion;
    generationPacket.context.catalogBinding.interactionCatalog.hostVersionRange =
      candidate.hostVersionRange;

    const generationRequest = {
      requestId: 'bc5ee4ab-cfda-4d78-9628-068544065522',
      providerId: 'procedure-author',
      targetAdapterId: candidate.adapterId,
      actionCatalogVersion: candidate.actionCatalogVersion,
      interactionCatalogVersion: candidate.interactionCatalogVersion,
      goal: generationPacket.context.goalProvenance.source.text,
      treeId: candidate.id,
      revision: candidate.revision,
      locale: 'en',
    } as const;
    const requestCases = [
      { value: generationRequest, accepted: true },
      { value: { ...generationRequest, requestId: 'not-a-uuid' }, accepted: false },
      { value: { ...generationRequest, providerId: '' }, accepted: false },
      { value: { ...generationRequest, apiKey: 'forbidden' }, accepted: false },
    ] as const;
    for (const contractCase of requestCases) {
      expect(procedureAuthoringGenerateRequestSchema.safeParse(contractCase.value).success).toBe(
        contractCase.accepted,
      );
    }
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-authoring-generate-request.schema.json'),
      requestCases,
    );

    const validation = {
      formatVersion: '1.0.0',
      packetContentSha256: generationPacket.integrity.contentSha256,
      validation: {
        packetIntegrity: 'validated',
        installedCatalogBinding: 'validated',
        authoringCandidateContract: 'validated',
        procedureCompilation: 'validated',
      },
      compilation: {
        formatVersion: candidate.formatVersion,
        procedureTreeId: candidate.id,
        procedureTreeRevision: candidate.revision,
        adapterId: candidate.adapterId,
        actionCatalogVersion: candidate.actionCatalogVersion,
        interactionCatalogVersion: candidate.interactionCatalogVersion,
        validation: {
          procedureStructure: 'validated',
          actionCatalogBinding: 'validated',
          hostVersionRange: 'validated_against_action_catalog',
          interactionTracks: 'structural_only',
        },
        plan: compileProcedureTreeToGuidePlan(candidate),
        proposalCreated: false,
        hostExecutionStarted: false,
      },
      procedureStored: false,
      proposalCreated: false,
      hostExecutionStarted: false,
    } as const;
    const result = {
      formatVersion: '1.0.0',
      generationId: 'a884189c-f4f9-42b0-8f7f-c50a25ad3d98',
      requestId: generationRequest.requestId,
      provider: { id: generationRequest.providerId, version: '1.0.0' },
      packet: generationPacket,
      tree: candidate,
      validation,
      sideEffects: {
        modelCalled: true,
        procedureStored: false,
        proposalCreated: false,
        hostExecutionStarted: false,
      },
      generatedAt: '2026-08-18T00:00:00.000Z',
      durationMs: 25,
    } as const;
    const documentPacket = {
      ...generationPacket,
      formatVersion: '1.2.0',
      context: {
        ...generationPacket.context,
        tutorialProvenance: {
          ...tutorialContext.tutorialProvenance,
          transcript: {
            ...tutorialContext.tutorialProvenance.transcript,
            document: {
              format: 'srt',
              contentSha256: 'b'.repeat(64),
              contentBytes: 64,
              cueCount: 1,
              normalization: 'operatingline-caption-cues-v1',
              confidence: { origin: 'user_declared_default', value: 0.95 },
            },
          },
        },
        constraints: {
          ...generationPacket.context.constraints,
          allSemanticOperationsTutorialEvidenceBound: true,
          tutorialTranscriptDocumentBound: true,
        },
      },
    } as const;
    const resultCases = [
      { value: result, accepted: true },
      {
        value: {
          ...result,
          packet: documentPacket,
          validation: { ...result.validation, formatVersion: '1.2.0' },
        },
        accepted: true,
      },
      {
        value: { ...result, sideEffects: { ...result.sideEffects, procedureStored: true } },
        accepted: false,
      },
      {
        value: { ...result, sideEffects: { ...result.sideEffects, modelCalled: false } },
        accepted: false,
      },
      { value: { ...result, generatedAt: 'not-an-instant' }, accepted: false },
    ] as const;
    for (const contractCase of resultCases) {
      expect(procedureAuthoringGenerationResultSchema.safeParse(contractCase.value).success).toBe(
        contractCase.accepted,
      );
    }
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-authoring-generation-result.schema.json'),
      resultCases,
    );
  });
});
