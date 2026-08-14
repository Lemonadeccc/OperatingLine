import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  compileProcedureTreeToGuidePlan,
  procedureAuthoringPromptContextSchema,
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

    const packetCases = [
      { value: packet, accepted: true },
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
});
