import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  compileProcedureTreeToGuidePlan,
  procedureAuthoringMaterializationFormatVersion,
  procedureAuthoringMaterializationLegacyFormatVersion,
  procedureAuthoringMaterializationOrderedMenuFormatVersion,
  procedureAuthoringMaterializationRequestSchema,
  procedureAuthoringMaterializationResultSchema,
  procedureAuthoringPromptPacketMaxCanonicalBytes,
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
        reason: 'The materialization stage has not grounded this track.',
        modality: 'menu',
      },
    ];
    node.shortcutTracks = [
      {
        id: `${node.id}.shortcut.unavailable`,
        availability: 'unavailable',
        title: 'Shortcut grounding pending',
        reason: 'The materialization stage has not grounded this track.',
        modality: 'shortcut',
      },
    ];
    node.mcpTracks = [
      {
        id: `${node.id}.mcp.unavailable`,
        availability: 'unavailable',
        title: 'MCP grounding pending',
        reason: 'The materialization stage has not grounded this track.',
        modality: 'mcp',
      },
    ];
    node.validation.status = 'candidate';
    node.validation.validatedHostVersions = [];
  }
  return tree;
}

const packet = {
  formatVersion: '1.0.0',
  context: {
    requestedTreeId: 'snowman.eye.left.procedure',
    recommendedRevision: 1,
    goalProvenance: {
      source: {
        id: 'source.snowman.eye.left.goal',
        kind: 'natural_language',
        text: 'Create the left eye of a snowman.',
        locale: 'en',
      },
      evidence: {
        id: 'evidence.snowman.eye.left.goal',
        locator: { kind: 'whole_source' },
        description: 'The complete authoring goal.',
        confidence: 1,
      },
    },
    catalogBinding: {
      adapterId: 'blender',
      actionCatalog: {
        protocolVersion: '1.5.0',
        catalogVersion: '1.12.0',
        adapterVersionRange: '>=1.0.0 <2.0.0',
        hostVersionRange: '>=4.0.0 <5.0.0',
        title: 'Blender actions',
        description: 'Actions available during authoring.',
        planningNotes: [],
        actions: [
          {
            name: 'scene.create_mesh',
            title: 'Create mesh',
            description: 'Create a mesh.',
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
      },
      interactionCatalog: {
        protocolVersion: '1.5.0',
        catalogVersion: '1.9.0',
        adapterVersionRange: '>=1.0.0 <2.0.0',
        hostVersionRange: '>=4.0.0 <5.0.0',
        title: 'Blender interactions',
        description: 'Interaction recipes available during authoring.',
        recipes: [
          {
            id: 'scene.create_mesh.recipe',
            actionName: 'scene.create_mesh',
            title: 'Create mesh',
            guidance: {
              kind: 'semantic_path',
              steps: [
                {
                  id: 'scene.create_mesh.step',
                  order: 1,
                  label: 'Create the mesh',
                  intent: 'execute',
                  target: { kind: 'semantic', hostId: 'scene.create_mesh' },
                },
              ],
              reason: 'No native path is available.',
            },
          },
        ],
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

describe('public procedure authoring materialization JSON Schemas', () => {
  it('keeps the request exact and candidate-bound in Zod and public JSON Schema', async () => {
    const candidate = readCandidateProcedureTree();
    const cases = [
      { value: { packet, tree: candidate }, accepted: true },
      { value: { packet, tree: readProcedureTree() }, accepted: false },
      { value: { packet, tree: candidate, provider: 'example' }, accepted: false },
      { value: { packet: { ...packet, extra: true }, tree: candidate }, accepted: false },
    ] as const;

    for (const contractCase of cases) {
      expect(
        procedureAuthoringMaterializationRequestSchema.safeParse(contractCase.value).success,
      ).toBe(contractCase.accepted);
    }
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-authoring-materialization-request.schema.json'),
      cases,
    );
  });

  it('publishes strict grounded result evidence in Zod and public JSON Schema', async () => {
    const tree = readCandidateProcedureTree();
    const leaf = tree.nodes.find((node) => node.kind === 'leaf');
    if (leaf?.kind !== 'leaf') throw new Error('Expected procedure leaf');
    const fixtureLeaf = readProcedureTree().nodes.find((node) => node.kind === 'leaf');
    if (fixtureLeaf?.kind !== 'leaf') throw new Error('Expected fixture procedure leaf');
    leaf.menuTracks = structuredClone(fixtureLeaf.menuTracks);

    const result = {
      formatVersion: procedureAuthoringMaterializationOrderedMenuFormatVersion,
      packetContentSha256: 'a'.repeat(64),
      inputTreeContentSha256: 'b'.repeat(64),
      outputTreeContentSha256: 'c'.repeat(64),
      catalogBinding: {
        adapterId: tree.adapterId,
        actionCatalogVersion: tree.actionCatalogVersion,
        interactionCatalogVersion: tree.interactionCatalogVersion,
        interactionCatalogContentSha256: 'd'.repeat(64),
      },
      coverage: [
        {
          leafId: leaf.id,
          recipeId: 'blender.mesh.create_uv_sphere.native',
          menu: 'materialized',
          shortcut: 'unavailable',
          mcp: 'unavailable',
        },
      ],
      validation: {
        packetIntegrity: 'validated',
        installedCatalogBinding: 'validated',
        authoringCandidateContract: 'validated',
        procedureCompilation: 'validated',
        interactionGrounding: 'validated_against_installed_interaction_catalog',
      },
      tree,
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
        plan: compileProcedureTreeToGuidePlan(tree),
        proposalCreated: false,
        hostExecutionStarted: false,
      },
      procedureStored: false,
      proposalCreated: false,
      hostExecutionStarted: false,
    } as const;

    const verifiedTree = structuredClone(tree);
    const verifiedLeaf = verifiedTree.nodes.find((node) => node.kind === 'leaf');
    if (verifiedLeaf?.kind !== 'leaf') throw new Error('Expected verified procedure leaf');
    verifiedLeaf.validation.status = 'verified';
    verifiedLeaf.validation.validatedHostVersions = ['4.5.0'];

    const availableShortcutTree = structuredClone(tree);
    const availableShortcutLeaf = availableShortcutTree.nodes.find((node) => node.kind === 'leaf');
    if (availableShortcutLeaf?.kind !== 'leaf') {
      throw new Error('Expected shortcut procedure leaf');
    }
    availableShortcutLeaf.shortcutTracks = structuredClone(fixtureLeaf.shortcutTracks);
    const validAvailableShortcutTree = structuredClone(availableShortcutTree);
    const validAvailableShortcutLeaf = validAvailableShortcutTree.nodes.find(
      (node) => node.kind === 'leaf',
    );
    if (validAvailableShortcutLeaf?.kind !== 'leaf') {
      throw new Error('Expected valid shortcut procedure leaf');
    }
    const validAvailableShortcutTrack = validAvailableShortcutLeaf.shortcutTracks[0]!;
    if (validAvailableShortcutTrack.availability !== 'available') {
      throw new Error('Expected valid available shortcut track');
    }
    expect(validAvailableShortcutTrack.operations.map((operation) => operation.keyMode)).toEqual([
      'chord',
      'sequence',
      'sequence',
      'sequence',
      'sequence',
      'sequence',
    ]);
    const missingKeyModeTrack = availableShortcutLeaf.shortcutTracks[0]!;
    if (missingKeyModeTrack.availability !== 'available') {
      throw new Error('Expected invalid available shortcut track');
    }
    delete missingKeyModeTrack.operations[0]!.keyMode;

    const shortcutResult = {
      ...result,
      formatVersion: procedureAuthoringMaterializationFormatVersion,
      coverage: [
        {
          ...result.coverage[0],
          shortcut: 'materialized',
        },
      ],
      tree: validAvailableShortcutTree,
    } as const;

    const emptySelectionPathTree = structuredClone(validAvailableShortcutTree);
    const emptySelectionPathLeaf = emptySelectionPathTree.nodes.find(
      (node) => node.kind === 'leaf',
    );
    if (emptySelectionPathLeaf?.kind !== 'leaf') {
      throw new Error('Expected invalid shortcut procedure leaf');
    }
    const emptySelectionPathTrack = emptySelectionPathLeaf.shortcutTracks[0]!;
    if (emptySelectionPathTrack.availability !== 'available') {
      throw new Error('Expected invalid available shortcut track');
    }
    emptySelectionPathTrack.operations[0]!.selectionPath = [];

    const shortcutOnlyTree = structuredClone(validAvailableShortcutTree);
    const shortcutOnlyLeaf = shortcutOnlyTree.nodes.find((node) => node.kind === 'leaf');
    if (shortcutOnlyLeaf?.kind !== 'leaf') throw new Error('Expected shortcut-only leaf');
    shortcutOnlyLeaf.menuTracks = structuredClone(readCandidateProcedureTree().nodes).find(
      (node) => node.kind === 'leaf',
    )!.menuTracks;
    const shortcutOnlyResult = {
      ...shortcutResult,
      coverage: [
        {
          ...shortcutResult.coverage[0],
          menu: 'unavailable',
        },
      ],
      tree: shortcutOnlyTree,
    } as const;

    const unavailableTree = readCandidateProcedureTree();
    const unavailableResult = {
      ...result,
      formatVersion: procedureAuthoringMaterializationLegacyFormatVersion,
      coverage: [
        {
          leafId: leaf.id,
          recipeId: null,
          menu: 'unavailable',
          shortcut: 'unavailable',
          mcp: 'unavailable',
        },
      ],
      tree: unavailableTree,
    } as const;

    const duplicateMenuTree = structuredClone(tree);
    const duplicateMenuLeaf = duplicateMenuTree.nodes.find((node) => node.kind === 'leaf');
    if (duplicateMenuLeaf?.kind !== 'leaf') throw new Error('Expected duplicate menu leaf');
    duplicateMenuLeaf.menuTracks.push(structuredClone(duplicateMenuLeaf.menuTracks[0]!));

    const cases = [
      { value: result, accepted: true },
      {
        value: {
          ...result,
          formatVersion: procedureAuthoringMaterializationLegacyFormatVersion,
        },
        accepted: true,
      },
      {
        value: {
          ...result,
          formatVersion: procedureAuthoringMaterializationFormatVersion,
        },
        accepted: false,
      },
      { value: shortcutResult, accepted: true },
      { value: shortcutOnlyResult, accepted: true },
      { value: unavailableResult, accepted: true },
      {
        value: {
          ...unavailableResult,
          formatVersion: procedureAuthoringMaterializationOrderedMenuFormatVersion,
        },
        accepted: false,
      },
      {
        value: {
          ...unavailableResult,
          formatVersion: procedureAuthoringMaterializationFormatVersion,
        },
        accepted: false,
      },
      { value: { ...shortcutResult, tree: emptySelectionPathTree }, accepted: false },
      {
        value: {
          ...shortcutResult,
          formatVersion: procedureAuthoringMaterializationOrderedMenuFormatVersion,
        },
        accepted: false,
      },
      { value: { ...result, formatVersion: '1.3.0' }, accepted: false },
      { value: { ...result, procedureStored: true }, accepted: false },
      { value: { ...result, outputTreeContentSha256: 'C'.repeat(64) }, accepted: false },
      { value: { ...result, provider: 'example' }, accepted: false },
      {
        value: {
          ...result,
          catalogBinding: { ...result.catalogBinding, installed: true },
        },
        accepted: false,
      },
      {
        value: {
          ...result,
          coverage: [{ ...result.coverage[0], actionName: 'scene.create_mesh' }],
        },
        accepted: false,
      },
      {
        value: {
          ...result,
          coverage: [{ ...result.coverage[0], recipeId: null }],
        },
        accepted: false,
      },
      { value: { ...result, tree: verifiedTree }, accepted: false },
      { value: { ...shortcutResult, tree: availableShortcutTree }, accepted: false },
      { value: { ...result, tree: duplicateMenuTree }, accepted: false },
      {
        value: {
          ...result,
          validation: { ...result.validation, interactionGrounding: 'structural_only' },
        },
        accepted: false,
      },
    ] as const;

    for (const contractCase of cases) {
      expect(
        procedureAuthoringMaterializationResultSchema.safeParse(contractCase.value).success,
      ).toBe(contractCase.accepted);
    }
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-authoring-materialization-result.schema.json'),
      cases,
    );
  });
});
