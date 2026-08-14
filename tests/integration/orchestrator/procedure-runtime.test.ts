import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';

import {
  blenderActionCatalog,
  blenderInteractionCatalog,
  blenderInteractionCatalogs,
} from '@operatingline/blender-action-catalog';
import {
  buildProcedureAuthoringPromptPacket,
  computeProcedureAuthoringPromptPacketContentSha256,
  procedureAuthoringPromptPacketContent,
  startRuntime,
  type RunningRuntime,
} from '@operatingline/orchestrator';
import {
  canonicalizeProtocolJsonValue,
  procedureAuthoringMaterializationResultSchema,
  procedureAuthoringPromptPacketMaxCanonicalBytes,
  procedureAuthoringPromptPacketSchema,
  type ProcedureAuthoringPromptPacket,
} from '@operatingline/protocol';

const accessToken = 'procedure-runtime-test-token';
const headers = {
  authorization: `Bearer ${accessToken}`,
  'content-type': 'application/json',
};

interface McpToolResponse {
  result?: {
    isError?: boolean;
    content?: Array<{ text?: string }>;
    structuredContent?: unknown;
  };
}

async function callMcpTool(
  runtime: RunningRuntime,
  id: number,
  name: string,
  argumentsValue: unknown,
): Promise<McpToolResponse> {
  const response = await fetch(runtime.mcpEndpoint, {
    method: 'POST',
    headers: {
      ...headers,
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-11-25',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name, arguments: argumentsValue },
    }),
  });
  expect(response.status).toBe(200);
  const dataLine = (await response.text()).split('\n').find((line) => line.startsWith('data: '));
  expect(dataLine).toBeDefined();
  return JSON.parse(dataLine!.slice('data: '.length)) as McpToolResponse;
}

function procedureFixture(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(resolve('protocol/fixtures/v1/snowman-eye.procedure.json'), 'utf8'),
  ) as Record<string, unknown>;
}

function authoringCandidateFixture(
  packet: ProcedureAuthoringPromptPacket,
): Record<string, unknown> {
  const tree = procedureFixture();
  tree['adapterId'] = packet.context.catalogBinding.adapterId;
  tree['actionCatalogVersion'] = packet.context.catalogBinding.actionCatalog.catalogVersion;
  tree['interactionCatalogVersion'] =
    packet.context.catalogBinding.interactionCatalog.catalogVersion;
  tree['hostVersionRange'] = packet.context.catalogBinding.interactionCatalog.hostVersionRange;
  for (const node of tree['nodes'] as Array<Record<string, unknown>>) {
    if (node['kind'] !== 'leaf') continue;
    const leafId = String(node['id']);
    for (const modality of ['menu', 'shortcut', 'mcp'] as const) {
      node[`${modality}Tracks`] = [
        {
          id: `${leafId}.${modality}.unavailable`,
          availability: 'unavailable',
          title: `${modality} grounding pending`,
          reason: 'A deterministic grounding stage has not materialized this track.',
          modality,
        },
      ];
    }
  }
  const source = packet.context.goalProvenance.source;
  const evidence = { ...packet.context.goalProvenance.evidence, sourceId: source.id };
  (tree['sources'] as Array<Record<string, unknown>>).push(source);
  (tree['evidence'] as Array<Record<string, unknown>>).push(evidence);
  return tree;
}

function icosphereAuthoringCandidateFixture(
  packet: ProcedureAuthoringPromptPacket,
): Record<string, unknown> {
  const tree = authoringCandidateFixture(packet);
  const leaf = (tree['nodes'] as Array<Record<string, unknown>>).find(
    (node) => node['kind'] === 'leaf',
  );
  if (leaf === undefined) throw new Error('Expected one Icosphere authoring candidate leaf');
  leaf['action'] = {
    adapterId: 'blender',
    name: 'blender.mesh.create_icosphere',
    arguments: {
      resourceId: 'tutorial.icosphere.detail',
      objectName: 'OperatingLine.IcosphereDetail',
      subdivisions: 3,
      radius: 1.75,
      location: [-1.25, 2.5, 0.75],
    },
  };
  leaf['title'] = 'Create and configure one detailed Icosphere';
  leaf['intent'] = 'Create a named Icosphere with exact subdivisions, radius, and location.';
  const semanticOperations = leaf['semanticOperations'] as Array<Record<string, unknown>>;
  semanticOperations[0] = {
    ...semanticOperations[0],
    semanticAction: 'create_icosphere',
    description: 'Create one detailed Icosphere.',
    parameters: { subdivisions: 3, radius: 1.75 },
  };
  semanticOperations[1] = {
    ...semanticOperations[1],
    description: 'Place the Icosphere at its exact world location.',
    parameters: { location: [-1.25, 2.5, 0.75] },
  };
  semanticOperations[2] = {
    ...semanticOperations[2],
    description: 'Rename the Icosphere object.',
    parameters: { name: 'OperatingLine.IcosphereDetail' },
  };
  leaf['anchors'] = [
    { kind: 'world_position', position: [-1.25, 2.5, 0.75] },
    {
      kind: 'operator',
      operatorId: 'mesh.primitive_ico_sphere_add',
      menuPath: ['Add', 'Mesh', 'Ico Sphere'],
    },
  ];
  const observations = leaf['expectedObservations'] as Array<Record<string, unknown>>;
  observations[0] = {
    ...observations[0],
    parameters: { resourceId: 'tutorial.icosphere.detail' },
  };
  return tree;
}

function cubeAuthoringCandidateFixture(
  packet: ProcedureAuthoringPromptPacket,
): Record<string, unknown> {
  const tree = authoringCandidateFixture(packet);
  const leaf = (tree['nodes'] as Array<Record<string, unknown>>).find(
    (node) => node['kind'] === 'leaf',
  );
  if (leaf === undefined) throw new Error('Expected one Cube authoring candidate leaf');
  leaf['action'] = {
    adapterId: 'blender',
    name: 'blender.mesh.create_cube',
    arguments: {
      resourceId: 'tutorial.cube.body',
      objectName: 'OperatingLine.CubeBody',
      size: 2.5,
      location: [-1, 2, 0.5],
    },
  };
  leaf['title'] = 'Create and configure one Cube body';
  leaf['intent'] = 'Create a named Cube with exact size and location.';
  const semanticOperations = leaf['semanticOperations'] as Array<Record<string, unknown>>;
  semanticOperations[0] = {
    ...semanticOperations[0],
    semanticAction: 'create_cube',
    description: 'Create one Cube body.',
    parameters: { size: 2.5 },
  };
  semanticOperations[1] = {
    ...semanticOperations[1],
    description: 'Place the Cube at its exact world location.',
    parameters: { location: [-1, 2, 0.5] },
  };
  semanticOperations[2] = {
    ...semanticOperations[2],
    description: 'Rename the Cube object.',
    parameters: { name: 'OperatingLine.CubeBody' },
  };
  leaf['anchors'] = [
    { kind: 'world_position', position: [-1, 2, 0.5] },
    {
      kind: 'operator',
      operatorId: 'mesh.primitive_cube_add',
      menuPath: ['Add', 'Mesh', 'Cube'],
    },
  ];
  const observations = leaf['expectedObservations'] as Array<Record<string, unknown>>;
  observations[0] = {
    ...observations[0],
    parameters: { resourceId: 'tutorial.cube.body' },
  };
  return tree;
}

function planeAuthoringCandidateFixture(
  packet: ProcedureAuthoringPromptPacket,
): Record<string, unknown> {
  const tree = authoringCandidateFixture(packet);
  const leaf = (tree['nodes'] as Array<Record<string, unknown>>).find(
    (node) => node['kind'] === 'leaf',
  );
  if (leaf === undefined) throw new Error('Expected one Plane authoring candidate leaf');
  leaf['action'] = {
    adapterId: 'blender',
    name: 'blender.mesh.create_plane',
    arguments: {
      resourceId: 'tutorial.plane.ground',
      objectName: 'OperatingLine.GroundPlane',
      size: 12.5,
      location: [0, 0, -1.25],
    },
  };
  leaf['title'] = 'Create and configure one ground Plane';
  leaf['intent'] = 'Create a named ground Plane with exact size and location.';
  const semanticOperations = leaf['semanticOperations'] as Array<Record<string, unknown>>;
  semanticOperations[0] = {
    ...semanticOperations[0],
    semanticAction: 'create_plane',
    description: 'Create one ground Plane.',
    parameters: { size: 12.5 },
  };
  semanticOperations[1] = {
    ...semanticOperations[1],
    description: 'Place the Plane at its exact world location.',
    parameters: { location: [0, 0, -1.25] },
  };
  semanticOperations[2] = {
    ...semanticOperations[2],
    description: 'Rename the Plane object.',
    parameters: { name: 'OperatingLine.GroundPlane' },
  };
  leaf['anchors'] = [
    { kind: 'world_position', position: [0, 0, -1.25] },
    {
      kind: 'operator',
      operatorId: 'mesh.primitive_plane_add',
      menuPath: ['Add', 'Mesh', 'Plane'],
    },
  ];
  const observations = leaf['expectedObservations'] as Array<Record<string, unknown>>;
  observations[0] = {
    ...observations[0],
    parameters: { resourceId: 'tutorial.plane.ground' },
  };
  return tree;
}

describe('procedure compilation runtime', () => {
  it('builds one provider-neutral candidate authoring packet without side effects', async () => {
    const unavailableLegacyInteractionCatalog = blenderInteractionCatalogs.find(
      (catalog) => catalog.catalogVersion === '1.9.0',
    );
    const legacyMaterializingInteractionCatalog = blenderInteractionCatalogs.find(
      (catalog) => catalog.catalogVersion === '1.10.0',
    );
    const orderedMenuInteractionCatalog = blenderInteractionCatalogs.find(
      (catalog) => catalog.catalogVersion === '1.11.0',
    );
    const shortcutInteractionCatalog = blenderInteractionCatalogs.find(
      (catalog) => catalog.catalogVersion === '1.12.0',
    );
    const icosphereInteractionCatalog = blenderInteractionCatalogs.find(
      (catalog) => catalog.catalogVersion === '1.13.0',
    );
    const cubeInteractionCatalog = blenderInteractionCatalogs.find(
      (catalog) => catalog.catalogVersion === '1.14.0',
    );
    if (unavailableLegacyInteractionCatalog === undefined) {
      throw new Error('Expected the immutable Blender InteractionCatalog 1.9.0 snapshot');
    }
    if (legacyMaterializingInteractionCatalog === undefined) {
      throw new Error('Expected the immutable Blender InteractionCatalog 1.10.0 snapshot');
    }
    if (orderedMenuInteractionCatalog === undefined) {
      throw new Error('Expected the immutable Blender InteractionCatalog 1.11.0 snapshot');
    }
    if (shortcutInteractionCatalog === undefined) {
      throw new Error('Expected the immutable Blender InteractionCatalog 1.12.0 snapshot');
    }
    if (icosphereInteractionCatalog === undefined) {
      throw new Error('Expected the immutable Blender InteractionCatalog 1.13.0 snapshot');
    }
    if (cubeInteractionCatalog === undefined) {
      throw new Error('Expected the immutable Blender InteractionCatalog 1.14.0 snapshot');
    }
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: [blenderActionCatalog],
      interactionCatalogs: [
        unavailableLegacyInteractionCatalog,
        legacyMaterializingInteractionCatalog,
        orderedMenuInteractionCatalog,
        shortcutInteractionCatalog,
        icosphereInteractionCatalog,
        cubeInteractionCatalog,
        blenderInteractionCatalog,
      ],
    });
    try {
      const request = {
        targetAdapterId: 'blender',
        actionCatalogVersion: blenderActionCatalog.catalogVersion,
        interactionCatalogVersion: blenderInteractionCatalog.catalogVersion,
        goal: '制作雪人的头部，并创建、定位、缩放和命名左眼球体。',
        treeId: 'snowman.eye.left.procedure',
        revision: 1,
        locale: 'zh-CN',
      };
      const mcp = await callMcpTool(runtime, 1, 'operatingline.procedure.prompt.get', request);
      expect(mcp.result?.isError).not.toBe(true);
      const packet = procedureAuthoringPromptPacketSchema.parse(mcp.result?.structuredContent);
      expect(packet).toMatchObject({
        context: {
          requestedTreeId: request.treeId,
          recommendedRevision: 1,
          goalProvenance: {
            source: {
              id: 'source.snowman.eye.left.procedure.revision.1.goal',
              text: request.goal,
            },
            evidence: {
              id: 'evidence.snowman.eye.left.procedure.revision.1.goal',
            },
          },
          catalogBinding: {
            adapterId: 'blender',
            actionCatalog: { catalogVersion: blenderActionCatalog.catalogVersion },
            interactionCatalog: { catalogVersion: blenderInteractionCatalog.catalogVersion },
          },
          constraints: { allInteractionTracksUnavailable: true },
        },
        retrieval: {
          toolName: 'operatingline.procedure.search',
          matching: 'exact_structured_filters',
          similarityScoreProduced: false,
        },
        workflow: {
          validationToolName: 'operatingline.procedure.authoring.validate',
          compileToolName: 'operatingline.procedure.compile',
        },
        sideEffects: {
          modelCalled: false,
          procedureStored: false,
          proposalCreated: false,
          hostExecutionStarted: false,
        },
      });
      expect(packet).not.toHaveProperty('renderedPrompt');
      expect(JSON.parse(mcp.result?.content?.[0]?.text ?? '{}')).toMatchObject({
        packetContentSha256: packet.integrity.contentSha256,
      });
      expect(packet.integrity.contentSha256).toBe(
        computeProcedureAuthoringPromptPacketContentSha256(
          procedureAuthoringPromptPacketContent(packet),
        ),
      );
      expect(canonicalizeProtocolJsonValue(packet).byteLength).toBeLessThanOrEqual(
        procedureAuthoringPromptPacketMaxCanonicalBytes,
      );

      const http = await fetch(`${runtime.baseUrl}/api/v1/procedure/prompt`, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
      });
      expect(http.status).toBe(200);
      await expect(http.json()).resolves.toEqual(packet);

      const candidate = authoringCandidateFixture(packet);
      const candidateLeaf = (candidate['nodes'] as Array<Record<string, unknown>>).find(
        (node) => node['id'] === 'snowman.head.eyes.left',
      );
      if (candidateLeaf === undefined) throw new Error('Expected one authoring candidate leaf');
      const semanticOperations = candidateLeaf['semanticOperations'] as Array<
        Record<string, unknown>
      >;
      semanticOperations[1]!['parameters'] = {
        location: [9, 9, 9],
        scale: [8, 8, 8],
      };
      semanticOperations[2]!['parameters'] = { name: 'Forged.Semantic.Name' };
      const validated = await callMcpTool(
        runtime,
        2,
        'operatingline.procedure.authoring.validate',
        { packet, tree: candidate },
      );
      expect(validated.result?.isError).not.toBe(true);
      const validationResult = JSON.parse(validated.result?.content?.[0]?.text ?? '{}') as Record<
        string,
        unknown
      >;
      expect(validationResult).toMatchObject({
        packetContentSha256: packet.integrity.contentSha256,
        validation: {
          packetIntegrity: 'validated',
          installedCatalogBinding: 'validated',
          authoringCandidateContract: 'validated',
          procedureCompilation: 'validated',
        },
        compilation: {
          procedureTreeId: request.treeId,
          procedureTreeRevision: 1,
          proposalCreated: false,
          hostExecutionStarted: false,
        },
        procedureStored: false,
        proposalCreated: false,
        hostExecutionStarted: false,
      });
      expect(validated.result?.structuredContent).toEqual(validationResult);

      const httpValidation = await fetch(`${runtime.baseUrl}/api/v1/procedure/authoring/validate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ packet, tree: candidate }),
      });
      expect(httpValidation.status).toBe(200);
      await expect(httpValidation.json()).resolves.toEqual(validationResult);

      const materializedMcp = await callMcpTool(
        runtime,
        3,
        'operatingline.procedure.authoring.materialize',
        { packet, tree: candidate },
      );
      expect(materializedMcp.result?.isError).not.toBe(true);
      const materialization = procedureAuthoringMaterializationResultSchema.parse(
        materializedMcp.result?.structuredContent,
      );
      expect(materialization).toMatchObject({
        formatVersion: '1.2.0',
        packetContentSha256: packet.integrity.contentSha256,
        catalogBinding: {
          adapterId: 'blender',
          actionCatalogVersion: blenderActionCatalog.catalogVersion,
          interactionCatalogVersion: blenderInteractionCatalog.catalogVersion,
        },
        coverage: [
          {
            leafId: 'snowman.head.eyes.left',
            recipeId: 'blender.mesh.create_uv_sphere.native',
            menu: 'materialized',
            shortcut: 'materialized',
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
        procedureStored: false,
        proposalCreated: false,
        hostExecutionStarted: false,
      });
      expect(materializedMcp.result?.content?.[0]?.text).toBe(JSON.stringify(materialization));
      const materializedLeaf = materialization.tree.nodes.find(
        (node) => node.id === 'snowman.head.eyes.left',
      );
      expect(materializedLeaf?.kind).toBe('leaf');
      if (materializedLeaf?.kind !== 'leaf' || materializedLeaf.action === null) {
        throw new Error('Expected one materialized executable leaf');
      }
      const menuTrack = materializedLeaf.menuTracks[0]!;
      expect(menuTrack.availability).toBe('available');
      if (menuTrack.availability !== 'available') {
        throw new Error('Expected one catalog-grounded menu track');
      }
      expect(menuTrack.operations.map((operation) => operation.path)).toEqual([
        ['Layout'],
        ['Layout', 'Add'],
        ['Layout', 'Add', 'Mesh'],
        ['Layout', 'Add', 'Mesh', 'UV Sphere'],
        ['Sidebar', 'Item', 'Transform', 'Location'],
        ['Sidebar', 'Item', 'Transform', 'Scale'],
        ['Outliner', 'Object Name'],
      ]);
      expect(menuTrack.operations.map((operation) => operation.parameters)).toEqual([
        {},
        {},
        {},
        { radius: 1 },
        { value: [0.32, -0.86, 2.14] },
        { value: [0.12, 0.12, 0.12] },
        { value: 'OperatingLine.EyeLeft' },
      ]);
      expect(
        menuTrack.operations.flatMap((operation) => Object.keys(operation.parameters)),
      ).not.toContain('resourceId');
      expect(materializedLeaf.action.arguments['resourceId']).toBe('snowman.eye.left');
      expect(materializedLeaf.semanticOperations[1]!.parameters).toEqual({
        location: [9, 9, 9],
        scale: [8, 8, 8],
      });
      expect(materializedLeaf.semanticOperations[2]!.parameters).toEqual({
        name: 'Forged.Semantic.Name',
      });
      const shortcutTrack = materializedLeaf.shortcutTracks[0];
      if (shortcutTrack?.availability !== 'available') {
        throw new Error('Expected one catalog-grounded shortcut track');
      }
      expect(
        shortcutTrack.operations.map(({ keyMode, keys, selectionPath, parameters }) => ({
          keyMode,
          keys,
          selectionPath,
          parameters,
        })),
      ).toEqual([
        {
          keyMode: 'chord',
          keys: ['SHIFT', 'A'],
          selectionPath: ['Mesh', 'UV Sphere'],
          parameters: { radius: 1, location: [0, 0, 0] },
        },
        {
          keyMode: 'sequence',
          keys: ['G', 'X'],
          selectionPath: undefined,
          parameters: { value: 0.32, confirm: 'ENTER' },
        },
        {
          keyMode: 'sequence',
          keys: ['G', 'Y'],
          selectionPath: undefined,
          parameters: { value: -0.86, confirm: 'ENTER' },
        },
        {
          keyMode: 'sequence',
          keys: ['G', 'Z'],
          selectionPath: undefined,
          parameters: { value: 2.14, confirm: 'ENTER' },
        },
        {
          keyMode: 'sequence',
          keys: ['S'],
          selectionPath: undefined,
          parameters: { value: 0.12, confirm: 'ENTER' },
        },
        {
          keyMode: 'sequence',
          keys: ['F2'],
          selectionPath: undefined,
          parameters: { text: 'OperatingLine.EyeLeft', confirm: 'ENTER' },
        },
      ]);
      expect(materializedLeaf.mcpTracks).toEqual([
        expect.objectContaining({ availability: 'unavailable', modality: 'mcp' }),
      ]);
      expect(materializedLeaf.validation).toMatchObject({
        status: 'candidate',
        validatedHostVersions: [],
      });

      const httpMaterialization = await fetch(
        `${runtime.baseUrl}/api/v1/procedure/authoring/materialize`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ packet, tree: candidate }),
        },
      );
      expect(httpMaterialization.status).toBe(200);
      await expect(httpMaterialization.json()).resolves.toEqual(materialization);

      const icosphereMaterialization = procedureAuthoringMaterializationResultSchema.parse(
        (
          await callMcpTool(runtime, 11, 'operatingline.procedure.authoring.materialize', {
            packet,
            tree: icosphereAuthoringCandidateFixture(packet),
          })
        ).result?.structuredContent,
      );
      expect(icosphereMaterialization).toMatchObject({
        formatVersion: '1.1.0',
        coverage: [
          {
            leafId: 'snowman.head.eyes.left',
            recipeId: 'blender.mesh.create_icosphere.native',
            menu: 'materialized',
            shortcut: 'unavailable',
            mcp: 'unavailable',
          },
        ],
      });
      const icosphereLeaf = icosphereMaterialization.tree.nodes.find(
        (node) => node.id === 'snowman.head.eyes.left',
      );
      if (icosphereLeaf?.kind !== 'leaf' || icosphereLeaf.action === null) {
        throw new Error('Expected one materialized Icosphere leaf');
      }
      const icosphereMenu = icosphereLeaf.menuTracks[0];
      if (icosphereMenu?.availability !== 'available') {
        throw new Error('Expected one catalog-grounded Icosphere menu track');
      }
      expect(icosphereMenu.operations.map((operation) => operation.parameters)).toEqual([
        {},
        {},
        {},
        { subdivisions: 3, radius: 1.75 },
        { value: [-1.25, 2.5, 0.75] },
        { value: 'OperatingLine.IcosphereDetail' },
      ]);
      expect(
        icosphereMenu.operations.flatMap((operation) => Object.keys(operation.parameters)),
      ).not.toContain('resourceId');
      expect(icosphereLeaf.shortcutTracks[0]).toMatchObject({ availability: 'unavailable' });
      expect(icosphereLeaf.mcpTracks[0]).toMatchObject({ availability: 'unavailable' });
      const icosphereHttpMaterialization = await fetch(
        `${runtime.baseUrl}/api/v1/procedure/authoring/materialize`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            packet,
            tree: icosphereAuthoringCandidateFixture(packet),
          }),
        },
      );
      expect(icosphereHttpMaterialization.status).toBe(200);
      await expect(icosphereHttpMaterialization.json()).resolves.toEqual(icosphereMaterialization);

      const cubePrompt = await callMcpTool(runtime, 14, 'operatingline.procedure.prompt.get', {
        ...request,
        interactionCatalogVersion: cubeInteractionCatalog.catalogVersion,
      });
      const cubePacket = procedureAuthoringPromptPacketSchema.parse(
        cubePrompt.result?.structuredContent,
      );
      const cubeMcp = await callMcpTool(
        runtime,
        18,
        'operatingline.procedure.authoring.materialize',
        { packet: cubePacket, tree: cubeAuthoringCandidateFixture(cubePacket) },
      );
      expect(cubeMcp.result?.isError).not.toBe(true);
      const cubeMaterialization = procedureAuthoringMaterializationResultSchema.parse(
        cubeMcp.result?.structuredContent,
      );
      expect(cubeMaterialization).toMatchObject({
        formatVersion: '1.1.0',
        catalogBinding: { interactionCatalogVersion: '1.14.0' },
        coverage: [
          {
            leafId: 'snowman.head.eyes.left',
            recipeId: 'blender.mesh.create_cube.native',
            menu: 'materialized',
            shortcut: 'unavailable',
            mcp: 'unavailable',
          },
        ],
      });
      const cubeLeaf = cubeMaterialization.tree.nodes.find(
        (node) => node.id === 'snowman.head.eyes.left',
      );
      if (cubeLeaf?.kind !== 'leaf' || cubeLeaf.action === null) {
        throw new Error('Expected one materialized Cube leaf');
      }
      const cubeMenu = cubeLeaf.menuTracks[0];
      if (cubeMenu?.availability !== 'available') {
        throw new Error('Expected one catalog-grounded Cube menu track');
      }
      expect(cubeMenu.operations.map((operation) => operation.parameters)).toEqual([
        {},
        {},
        {},
        { size: 2.5 },
        { value: [-1, 2, 0.5] },
        { value: 'OperatingLine.CubeBody' },
      ]);
      expect(
        cubeMenu.operations.flatMap((operation) => Object.keys(operation.parameters)),
      ).not.toContain('resourceId');
      expect(cubeLeaf.action.arguments).toEqual({
        resourceId: 'tutorial.cube.body',
        objectName: 'OperatingLine.CubeBody',
        size: 2.5,
        location: [-1, 2, 0.5],
      });
      expect(cubeLeaf.shortcutTracks).toEqual([
        expect.objectContaining({
          availability: 'unavailable',
          modality: 'shortcut',
          reason: 'No verified shortcut procedure is available.',
        }),
      ]);
      expect(cubeLeaf.mcpTracks).toEqual([
        expect.objectContaining({
          availability: 'unavailable',
          modality: 'mcp',
          reason: 'No approved action-level MCP tool is available.',
        }),
      ]);
      expect(cubeMcp.result?.content?.[0]?.text).toBe(JSON.stringify(cubeMaterialization));
      const cubeHttp = await fetch(`${runtime.baseUrl}/api/v1/procedure/authoring/materialize`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          packet: cubePacket,
          tree: cubeAuthoringCandidateFixture(cubePacket),
        }),
      });
      expect(cubeHttp.status).toBe(200);
      await expect(cubeHttp.json()).resolves.toEqual(cubeMaterialization);

      const historicalPlane = procedureAuthoringMaterializationResultSchema.parse(
        (
          await callMcpTool(runtime, 19, 'operatingline.procedure.authoring.materialize', {
            packet: cubePacket,
            tree: planeAuthoringCandidateFixture(cubePacket),
          })
        ).result?.structuredContent,
      );
      expect(historicalPlane).toMatchObject({
        formatVersion: '1.0.0',
        catalogBinding: { interactionCatalogVersion: '1.14.0' },
        coverage: [
          {
            leafId: 'snowman.head.eyes.left',
            recipeId: 'blender.mesh.create_plane.native',
            menu: 'unavailable',
            shortcut: 'unavailable',
            mcp: 'unavailable',
          },
        ],
      });

      const planeMcp = await callMcpTool(
        runtime,
        20,
        'operatingline.procedure.authoring.materialize',
        { packet, tree: planeAuthoringCandidateFixture(packet) },
      );
      expect(planeMcp.result?.isError).not.toBe(true);
      const planeMaterialization = procedureAuthoringMaterializationResultSchema.parse(
        planeMcp.result?.structuredContent,
      );
      expect(planeMaterialization).toMatchObject({
        formatVersion: '1.1.0',
        catalogBinding: { interactionCatalogVersion: '1.15.0' },
        coverage: [
          {
            leafId: 'snowman.head.eyes.left',
            recipeId: 'blender.mesh.create_plane.native',
            menu: 'materialized',
            shortcut: 'unavailable',
            mcp: 'unavailable',
          },
        ],
      });
      const planeLeaf = planeMaterialization.tree.nodes.find(
        (node) => node.id === 'snowman.head.eyes.left',
      );
      if (planeLeaf?.kind !== 'leaf' || planeLeaf.action === null) {
        throw new Error('Expected one materialized Plane leaf');
      }
      const planeMenu = planeLeaf.menuTracks[0];
      if (planeMenu?.availability !== 'available') {
        throw new Error('Expected one catalog-grounded Plane menu track');
      }
      expect(planeMenu.operations.map((operation) => operation.parameters)).toEqual([
        {},
        {},
        {},
        { size: 12.5 },
        { value: [0, 0, -1.25] },
        { value: 'OperatingLine.GroundPlane' },
      ]);
      expect(
        planeMenu.operations.flatMap((operation) => Object.keys(operation.parameters)),
      ).not.toContain('resourceId');
      expect(planeLeaf.action.arguments).toEqual({
        resourceId: 'tutorial.plane.ground',
        objectName: 'OperatingLine.GroundPlane',
        size: 12.5,
        location: [0, 0, -1.25],
      });
      expect(planeLeaf.shortcutTracks).toEqual([
        expect.objectContaining({
          availability: 'unavailable',
          modality: 'shortcut',
          reason: 'No verified shortcut procedure is available.',
        }),
      ]);
      expect(planeLeaf.mcpTracks).toEqual([
        expect.objectContaining({
          availability: 'unavailable',
          modality: 'mcp',
          reason: 'No approved action-level MCP tool is available.',
        }),
      ]);
      expect(planeMcp.result?.content?.[0]?.text).toBe(JSON.stringify(planeMaterialization));
      const planeHttp = await fetch(`${runtime.baseUrl}/api/v1/procedure/authoring/materialize`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ packet, tree: planeAuthoringCandidateFixture(packet) }),
      });
      expect(planeHttp.status).toBe(200);
      await expect(planeHttp.json()).resolves.toEqual(planeMaterialization);

      const icospherePrompt = await callMcpTool(runtime, 15, 'operatingline.procedure.prompt.get', {
        ...request,
        interactionCatalogVersion: icosphereInteractionCatalog.catalogVersion,
      });
      const icospherePacket = procedureAuthoringPromptPacketSchema.parse(
        icospherePrompt.result?.structuredContent,
      );
      const historicalIcosphere = procedureAuthoringMaterializationResultSchema.parse(
        (
          await callMcpTool(runtime, 16, 'operatingline.procedure.authoring.materialize', {
            packet: icospherePacket,
            tree: icosphereAuthoringCandidateFixture(icospherePacket),
          })
        ).result?.structuredContent,
      );
      expect(historicalIcosphere.coverage).toEqual([
        {
          leafId: 'snowman.head.eyes.left',
          recipeId: 'blender.mesh.create_icosphere.native',
          menu: 'materialized',
          shortcut: 'unavailable',
          mcp: 'unavailable',
        },
      ]);
      const historicalCube = procedureAuthoringMaterializationResultSchema.parse(
        (
          await callMcpTool(runtime, 17, 'operatingline.procedure.authoring.materialize', {
            packet: icospherePacket,
            tree: cubeAuthoringCandidateFixture(icospherePacket),
          })
        ).result?.structuredContent,
      );
      expect(historicalCube).toMatchObject({
        formatVersion: '1.0.0',
        catalogBinding: { interactionCatalogVersion: '1.13.0' },
        coverage: [
          {
            leafId: 'snowman.head.eyes.left',
            recipeId: 'blender.mesh.create_cube.native',
            menu: 'unavailable',
            shortcut: 'unavailable',
            mcp: 'unavailable',
          },
        ],
      });

      const rebuiltPacket = buildProcedureAuthoringPromptPacket(
        request,
        blenderActionCatalog,
        blenderInteractionCatalog,
      );
      expect(rebuiltPacket).toEqual(packet);

      const procedures = await fetch(`${runtime.baseUrl}/api/v1/procedures`, { headers });
      await expect(procedures.json()).resolves.toEqual({
        procedures: [],
        nextAfterSequence: null,
      });
      const guide = await fetch(`${runtime.baseUrl}/api/v1/guide`, { headers });
      await expect(guide.json()).resolves.toEqual({ plan: null });

      const orderedMenuPrompt = await callMcpTool(
        runtime,
        9,
        'operatingline.procedure.prompt.get',
        {
          ...request,
          interactionCatalogVersion: orderedMenuInteractionCatalog.catalogVersion,
        },
      );
      const orderedMenuPacket = procedureAuthoringPromptPacketSchema.parse(
        orderedMenuPrompt.result?.structuredContent,
      );
      const orderedMenuMaterialization = procedureAuthoringMaterializationResultSchema.parse(
        (
          await callMcpTool(runtime, 10, 'operatingline.procedure.authoring.materialize', {
            packet: orderedMenuPacket,
            tree: authoringCandidateFixture(orderedMenuPacket),
          })
        ).result?.structuredContent,
      );
      expect(orderedMenuMaterialization.formatVersion).toBe('1.1.0');
      expect(orderedMenuMaterialization.coverage).toEqual([
        {
          leafId: 'snowman.head.eyes.left',
          recipeId: 'blender.mesh.create_uv_sphere.native',
          menu: 'materialized',
          shortcut: 'unavailable',
          mcp: 'unavailable',
        },
      ]);

      const shortcutPrompt = await callMcpTool(runtime, 12, 'operatingline.procedure.prompt.get', {
        ...request,
        interactionCatalogVersion: shortcutInteractionCatalog.catalogVersion,
      });
      const shortcutPacket = procedureAuthoringPromptPacketSchema.parse(
        shortcutPrompt.result?.structuredContent,
      );
      const shortcutMaterialization = procedureAuthoringMaterializationResultSchema.parse(
        (
          await callMcpTool(runtime, 13, 'operatingline.procedure.authoring.materialize', {
            packet: shortcutPacket,
            tree: authoringCandidateFixture(shortcutPacket),
          })
        ).result?.structuredContent,
      );
      expect(shortcutMaterialization).toMatchObject({
        formatVersion: '1.2.0',
        catalogBinding: { interactionCatalogVersion: '1.12.0' },
        coverage: [
          {
            leafId: 'snowman.head.eyes.left',
            recipeId: 'blender.mesh.create_uv_sphere.native',
            menu: 'materialized',
            shortcut: 'materialized',
            mcp: 'unavailable',
          },
        ],
      });

      const legacyMaterializingPrompt = await callMcpTool(
        runtime,
        4,
        'operatingline.procedure.prompt.get',
        {
          ...request,
          interactionCatalogVersion: legacyMaterializingInteractionCatalog.catalogVersion,
        },
      );
      const legacyMaterializingPacket = procedureAuthoringPromptPacketSchema.parse(
        legacyMaterializingPrompt.result?.structuredContent,
      );
      const legacyMaterializingCandidate = authoringCandidateFixture(legacyMaterializingPacket);
      const legacyMaterialization = procedureAuthoringMaterializationResultSchema.parse(
        (
          await callMcpTool(runtime, 5, 'operatingline.procedure.authoring.materialize', {
            packet: legacyMaterializingPacket,
            tree: legacyMaterializingCandidate,
          })
        ).result?.structuredContent,
      );
      expect(legacyMaterialization.formatVersion).toBe('1.0.0');
      const legacyMaterializedLeaf = legacyMaterialization.tree.nodes.find(
        (node) => node.id === 'snowman.head.eyes.left',
      );
      if (legacyMaterializedLeaf?.kind !== 'leaf' || legacyMaterializedLeaf.action === null) {
        throw new Error('Expected one legacy materialized leaf');
      }
      const legacyMenuTrack = legacyMaterializedLeaf.menuTracks[0];
      if (legacyMenuTrack?.availability !== 'available') {
        throw new Error('Expected one legacy catalog-grounded menu track');
      }
      expect(legacyMenuTrack.operations).toHaveLength(4);
      expect(legacyMenuTrack.operations.at(-1)?.parameters).toEqual(
        legacyMaterializedLeaf.action.arguments,
      );

      const unavailableLegacyPrompt = await callMcpTool(
        runtime,
        6,
        'operatingline.procedure.prompt.get',
        {
          ...request,
          interactionCatalogVersion: unavailableLegacyInteractionCatalog.catalogVersion,
        },
      );
      const unavailableLegacyPacket = procedureAuthoringPromptPacketSchema.parse(
        unavailableLegacyPrompt.result?.structuredContent,
      );
      const unavailableLegacyCandidate = authoringCandidateFixture(unavailableLegacyPacket);
      const unavailableLegacyMaterialization = procedureAuthoringMaterializationResultSchema.parse(
        (
          await callMcpTool(runtime, 7, 'operatingline.procedure.authoring.materialize', {
            packet: unavailableLegacyPacket,
            tree: unavailableLegacyCandidate,
          })
        ).result?.structuredContent,
      );
      expect(unavailableLegacyMaterialization.formatVersion).toBe('1.0.0');
      expect(unavailableLegacyMaterialization.coverage).toEqual([
        {
          leafId: 'snowman.head.eyes.left',
          recipeId: 'blender.mesh.create_uv_sphere.native',
          menu: 'unavailable',
          shortcut: 'unavailable',
          mcp: 'unavailable',
        },
      ]);

      const unavailable = await callMcpTool(runtime, 8, 'operatingline.procedure.prompt.get', {
        ...request,
        interactionCatalogVersion: '9.9.9',
      });
      expect(unavailable.result).toMatchObject({ isError: true });
      expect(unavailable.result?.content?.[0]?.text).toContain(
        'procedure_authoring_prompt_unavailable',
      );
    } finally {
      await runtime.stop();
    }
  }, 15_000);

  it('rejects tampered, resealed, identity-drifted, and non-candidate authoring input', async () => {
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: [blenderActionCatalog],
      interactionCatalogs: [blenderInteractionCatalog],
    });
    try {
      const promptRequest = {
        targetAdapterId: 'blender',
        goal: 'Create the left eye sphere.',
        treeId: 'snowman.eye.left.procedure',
        revision: 1,
      };
      const packet = buildProcedureAuthoringPromptPacket(
        promptRequest,
        blenderActionCatalog,
        blenderInteractionCatalog,
      );
      const candidate = authoringCandidateFixture(packet);

      const badIntegrity = structuredClone(packet);
      badIntegrity.integrity.contentSha256 = '0'.repeat(64);
      const badIntegrityMcp = await callMcpTool(
        runtime,
        1,
        'operatingline.procedure.authoring.validate',
        { packet: badIntegrity, tree: candidate },
      );
      expect(badIntegrityMcp.result).toMatchObject({ isError: true });
      expect(badIntegrityMcp.result?.content?.[0]?.text).toContain(
        'procedure_authoring_validation_failed',
      );

      const resealed = structuredClone(packet);
      resealed.workflow.instructions = [
        ...resealed.workflow.instructions,
        'A client-added instruction must not become part of the installed packet.',
      ];
      resealed.integrity.contentSha256 = computeProcedureAuthoringPromptPacketContentSha256(
        procedureAuthoringPromptPacketContent(resealed),
      );
      const resealedHttp = await fetch(`${runtime.baseUrl}/api/v1/procedure/authoring/validate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ packet: resealed, tree: candidate }),
      });
      expect(resealedHttp.status).toBe(422);
      await expect(resealedHttp.json()).resolves.toMatchObject({
        error: 'procedure_authoring_validation_failed',
        message: 'Procedure authoring packet does not match the installed catalog snapshots',
      });
      const resealedMaterializationHttp = await fetch(
        `${runtime.baseUrl}/api/v1/procedure/authoring/materialize`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ packet: resealed, tree: candidate }),
        },
      );
      expect(resealedMaterializationHttp.status).toBe(422);
      await expect(resealedMaterializationHttp.json()).resolves.toMatchObject({
        error: 'procedure_authoring_materialization_failed',
        message: 'Procedure authoring packet does not match the installed catalog snapshots',
      });

      const changedIdentity = structuredClone(candidate);
      changedIdentity['id'] = 'different.procedure';
      const changedIdentityHttp = await fetch(
        `${runtime.baseUrl}/api/v1/procedure/authoring/validate`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ packet, tree: changedIdentity }),
        },
      );
      expect(changedIdentityHttp.status).toBe(422);
      await expect(changedIdentityHttp.json()).resolves.toMatchObject({
        error: 'procedure_authoring_validation_failed',
      });

      const changedSource = structuredClone(candidate);
      const goalSource = (changedSource['sources'] as Array<Record<string, unknown>>).find(
        (source) => source['id'] === packet.context.goalProvenance.source.id,
      );
      if (goalSource === undefined) throw new Error('Expected packet-bound goal source');
      goalSource['text'] = 'Changed after the packet was built.';
      const changedSourceHttp = await fetch(
        `${runtime.baseUrl}/api/v1/procedure/authoring/validate`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ packet, tree: changedSource }),
        },
      );
      expect(changedSourceHttp.status).toBe(422);

      const compileInvalid = structuredClone(candidate);
      const actionLeaf = (compileInvalid['nodes'] as Array<Record<string, unknown>>).find(
        (node) => node['kind'] === 'leaf',
      );
      if (actionLeaf === undefined) throw new Error('Expected action leaf');
      const action = actionLeaf['action'] as Record<string, unknown>;
      action['name'] = 'blender.unknown_action';
      const compileInvalidHttp = await fetch(
        `${runtime.baseUrl}/api/v1/procedure/authoring/validate`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ packet, tree: compileInvalid }),
        },
      );
      expect(compileInvalidHttp.status).toBe(422);
      await expect(compileInvalidHttp.json()).resolves.toMatchObject({
        error: 'procedure_authoring_validation_failed',
      });

      const availableTracks = procedureFixture();
      availableTracks['sources'] = candidate['sources'];
      availableTracks['evidence'] = candidate['evidence'];
      const availableHttp = await fetch(`${runtime.baseUrl}/api/v1/procedure/authoring/validate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ packet, tree: availableTracks }),
      });
      expect(availableHttp.status).toBe(400);
      await expect(availableHttp.json()).resolves.toMatchObject({
        error: 'invalid_procedure_authoring_validation_request',
      });
      const availableMaterializationHttp = await fetch(
        `${runtime.baseUrl}/api/v1/procedure/authoring/materialize`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ packet, tree: availableTracks }),
        },
      );
      expect(availableMaterializationHttp.status).toBe(400);
      await expect(availableMaterializationHttp.json()).resolves.toMatchObject({
        error: 'invalid_procedure_authoring_materialization_request',
      });

      const procedures = await fetch(`${runtime.baseUrl}/api/v1/procedures`, { headers });
      await expect(procedures.json()).resolves.toMatchObject({ procedures: [] });
      const guide = await fetch(`${runtime.baseUrl}/api/v1/guide`, { headers });
      await expect(guide.json()).resolves.toEqual({ plan: null });
    } finally {
      await runtime.stop();
    }
  });

  it('classifies persistence failures as internal without exposing SQLite details', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'operatingline-procedure-failure-'));
    const databasePath = join(directory, 'state.db');
    const runtime = await startRuntime({
      databasePath,
      accessToken,
      actionCatalogs: [blenderActionCatalog],
    });
    try {
      const injected = new DatabaseSync(databasePath);
      injected.exec(`
        CREATE TRIGGER fail_procedure_storage
        BEFORE INSERT ON procedure_trees
        BEGIN
          SELECT RAISE(FAIL, 'injected private sqlite detail');
        END;
      `);
      injected.close();

      const http = await fetch(`${runtime.baseUrl}/api/v1/procedure/store`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ tree: procedureFixture() }),
      });
      expect(http.status).toBe(500);
      const httpError = JSON.stringify(await http.json());
      expect(httpError).toContain('procedure_tree_storage_failed');
      expect(httpError).not.toContain('injected private sqlite detail');

      const mcp = await callMcpTool(runtime, 1, 'operatingline.procedure.store', {
        tree: procedureFixture(),
      });
      expect(mcp.result).toMatchObject({ isError: true });
      expect(mcp.result?.content?.[0]?.text).toContain('procedure_tree_storage_failed');
      expect(mcp.result?.content?.[0]?.text).not.toContain('injected private sqlite detail');
    } finally {
      await runtime.stop();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('stores immutable revisions and serves exact, latest, and paginated reads across restart', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'operatingline-procedure-runtime-'));
    const databasePath = join(directory, 'state.db');
    let runtime: RunningRuntime | undefined;
    try {
      runtime = await startRuntime({
        databasePath,
        accessToken,
        actionCatalogs: [blenderActionCatalog],
      });
      const revisionOne = procedureFixture();
      const storedMcp = await callMcpTool(runtime, 1, 'operatingline.procedure.store', {
        tree: revisionOne,
      });
      expect(storedMcp.result?.isError).not.toBe(true);
      const stored = JSON.parse(storedMcp.result?.content?.[0]?.text ?? '{}') as {
        result?: string;
        record?: {
          sequence?: number;
          tree?: { id?: string; revision?: number };
          integrity?: { contentSha256?: string; canonicalization?: string };
          storedAt?: string;
        };
      };
      expect(stored).toMatchObject({
        result: 'accepted',
        record: {
          tree: { id: 'snowman.eye.left.procedure', revision: 1 },
          integrity: { canonicalization: 'operatingline-json-value-v1' },
        },
        validation: { interactionTracks: 'structural_only' },
        proposalCreated: false,
        hostExecutionStarted: false,
      });
      expect(stored.record?.integrity?.contentSha256).toMatch(/^[a-f0-9]{64}$/);

      const duplicate = await fetch(`${runtime.baseUrl}/api/v1/procedure/store`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ tree: revisionOne }),
      });
      expect(duplicate.status).toBe(200);
      await expect(duplicate.json()).resolves.toMatchObject({
        result: 'duplicate',
        record: {
          sequence: stored.record?.sequence,
          storedAt: stored.record?.storedAt,
          integrity: { contentSha256: stored.record?.integrity?.contentSha256 },
        },
      });

      const revisionThree = procedureFixture();
      revisionThree['revision'] = 3;
      revisionThree['title'] = 'Snowman left eye revision 3';
      const newer = await fetch(`${runtime.baseUrl}/api/v1/procedure/store`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ tree: revisionThree }),
      });
      expect(newer.status).toBe(200);
      await expect(newer.json()).resolves.toMatchObject({
        result: 'accepted',
        record: { tree: { revision: 3 } },
      });

      const revisionTwo = procedureFixture();
      revisionTwo['revision'] = 2;
      const stale = await fetch(`${runtime.baseUrl}/api/v1/procedure/store`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ tree: revisionTwo }),
      });
      expect(stale.status).toBe(409);
      await expect(stale.json()).resolves.toMatchObject({
        error: 'procedure_tree_revision_stale',
        result: 'stale',
        latestRevision: 3,
      });

      const conflicting = procedureFixture();
      conflicting['title'] = 'Conflicting immutable revision';
      const conflict = await callMcpTool(runtime, 2, 'operatingline.procedure.store', {
        tree: conflicting,
      });
      expect(conflict.result?.isError).toBe(true);
      expect(conflict.result?.content?.[0]?.text).toContain('procedure_tree_revision_conflict');

      const exact = await fetch(
        `${runtime.baseUrl}/api/v1/procedure?treeId=snowman.eye.left.procedure&revision=1`,
        { headers },
      );
      expect(exact.status).toBe(200);
      await expect(exact.json()).resolves.toMatchObject({ tree: { revision: 1 } });

      const latest = await callMcpTool(runtime, 3, 'operatingline.procedure.get', {
        treeId: 'snowman.eye.left.procedure',
      });
      expect(latest.result?.isError).not.toBe(true);
      expect(JSON.parse(latest.result?.content?.[0]?.text ?? '{}')).toMatchObject({
        tree: { revision: 3 },
      });

      const firstPage = await callMcpTool(runtime, 4, 'operatingline.procedure.list', {
        limit: 1,
      });
      const page = JSON.parse(firstPage.result?.content?.[0]?.text ?? '{}') as {
        procedures?: Array<{ sequence?: number; revision?: number; tree?: unknown }>;
        nextAfterSequence?: number | null;
      };
      expect(page.procedures).toMatchObject([{ revision: 1 }]);
      expect(page.procedures?.[0]).not.toHaveProperty('tree');
      expect(page.nextAfterSequence).toBe(page.procedures?.[0]?.sequence);
      const secondPage = await fetch(
        `${runtime.baseUrl}/api/v1/procedures?afterSequence=${page.nextAfterSequence}&limit=1&adapterId=blender`,
        { headers },
      );
      expect(secondPage.status).toBe(200);
      await expect(secondPage.json()).resolves.toMatchObject({
        procedures: [{ revision: 3 }],
        nextAfterSequence: null,
      });

      const semanticSearch = await callMcpTool(runtime, 5, 'operatingline.procedure.search', {
        treeId: 'snowman.eye.left.procedure',
        revision: 1,
        semanticAction: 'create_uv_sphere',
      });
      expect(semanticSearch.result?.isError).not.toBe(true);
      const semanticHits = JSON.parse(semanticSearch.result?.content?.[0]?.text ?? '{}') as {
        operations?: Array<{
          modality?: string;
          semanticActions?: string[];
          tree?: { treeId?: string; revision?: number; integrity?: unknown };
          nodePath?: Array<{ id?: string }>;
          operation?: { id?: string; parameters?: unknown };
          sources?: unknown[];
          evidence?: unknown[];
        }>;
        matching?: string;
        similarityScoreProduced?: boolean;
        hostExecutionStarted?: boolean;
      };
      expect(semanticHits.operations).toHaveLength(6);
      expect(semanticHits.operations?.map((hit) => hit.modality)).toEqual([
        'semantic',
        'menu',
        'menu',
        'menu',
        'menu',
        'shortcut',
      ]);
      expect(semanticHits.operations?.[0]).toMatchObject({
        semanticActions: ['create_uv_sphere'],
        tree: {
          treeId: 'snowman.eye.left.procedure',
          revision: 1,
          integrity: { algorithm: 'sha256' },
        },
        nodePath: [
          { id: 'snowman' },
          { id: 'snowman.head' },
          { id: 'snowman.head.eyes' },
          { id: 'snowman.head.eyes.left' },
        ],
        sources: [{ id: 'source.prompt' }],
        evidence: [{ id: 'evidence.prompt' }],
      });
      expect(semanticHits).toMatchObject({
        matching: 'exact_structured_filters',
        similarityScoreProduced: false,
        hostExecutionStarted: false,
      });

      const firstSearchPage = await callMcpTool(runtime, 6, 'operatingline.procedure.search', {
        treeId: 'snowman.eye.left.procedure',
        revision: 1,
        semanticAction: 'create_uv_sphere',
        limit: 2,
      });
      const firstSearchPageResult = JSON.parse(
        firstSearchPage.result?.content?.[0]?.text ?? '{}',
      ) as {
        operations?: Array<{ indexSequence?: number }>;
        nextAfterSequence?: number | null;
      };
      expect(firstSearchPageResult.operations).toHaveLength(2);
      expect(firstSearchPageResult.nextAfterSequence).toBe(
        firstSearchPageResult.operations?.[1]?.indexSequence,
      );
      const secondSearchPage = await fetch(`${runtime.baseUrl}/api/v1/procedure/search`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          treeId: 'snowman.eye.left.procedure',
          revision: 1,
          semanticAction: 'create_uv_sphere',
          afterSequence: firstSearchPageResult.nextAfterSequence,
          limit: 4,
        }),
      });
      expect(secondSearchPage.status).toBe(200);
      await expect(secondSearchPage.json()).resolves.toMatchObject({
        operations: [{}, {}, {}, {}],
        nextAfterSequence: null,
      });

      const menuSearch = await fetch(`${runtime.baseUrl}/api/v1/procedure/search`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          modality: 'menu',
          menuTargetHostId: 'mesh.primitive_uv_sphere_add',
          menuPath: ['Layout', 'Add', 'Mesh', 'UV Sphere'],
        }),
      });
      expect(menuSearch.status).toBe(200);
      await expect(menuSearch.json()).resolves.toMatchObject({
        operations: [
          {
            modality: 'menu',
            operation: {
              id: 'menu.uv_sphere',
              parameters: { radius: 1, location: [0, 0, 0] },
            },
          },
          {
            modality: 'menu',
            operation: {
              id: 'menu.uv_sphere',
              parameters: { radius: 1, location: [0, 0, 0] },
            },
          },
        ],
      });

      const unavailableMcpSearch = await callMcpTool(runtime, 6, 'operatingline.procedure.search', {
        modality: 'mcp',
        mcpToolName: 'create_uv_sphere',
      });
      expect(JSON.parse(unavailableMcpSearch.result?.content?.[0]?.text ?? '{}')).toMatchObject({
        operations: [],
        nextAfterSequence: null,
      });

      const invalidSearch = await fetch(`${runtime.baseUrl}/api/v1/procedure/search`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ limit: 10 }),
      });
      expect(invalidSearch.status).toBe(400);

      const guide = await fetch(`${runtime.baseUrl}/api/v1/guide`, { headers });
      await expect(guide.json()).resolves.toEqual({ plan: null });
      await runtime.stop();
      runtime = undefined;

      runtime = await startRuntime({
        databasePath,
        accessToken,
        actionCatalogs: [blenderActionCatalog],
      });
      const restarted = await fetch(
        `${runtime.baseUrl}/api/v1/procedure?treeId=snowman.eye.left.procedure`,
        { headers },
      );
      expect(restarted.status).toBe(200);
      await expect(restarted.json()).resolves.toMatchObject({ tree: { revision: 3 } });
      const restartedSearch = await fetch(`${runtime.baseUrl}/api/v1/procedure/search`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          treeId: 'snowman.eye.left.procedure',
          operationId: 'menu.uv_sphere',
          modality: 'menu',
        }),
      });
      expect(restartedSearch.status).toBe(200);
      await expect(restartedSearch.json()).resolves.toMatchObject({
        operations: [{ tree: { revision: 1 } }, { tree: { revision: 3 } }],
      });
    } finally {
      await runtime?.stop();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('compiles through MCP and HTTP without publishing, proposing, or executing', async () => {
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: [blenderActionCatalog],
    });
    try {
      const tree = procedureFixture();
      const mcp = await callMcpTool(runtime, 1, 'operatingline.procedure.compile', { tree });
      expect(mcp.result?.isError).not.toBe(true);
      const result = JSON.parse(mcp.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
      expect(result).toMatchObject({
        formatVersion: '1.0.0',
        procedureTreeId: 'snowman.eye.left.procedure',
        adapterId: 'blender',
        actionCatalogVersion: blenderActionCatalog.catalogVersion,
        validation: {
          procedureStructure: 'validated',
          actionCatalogBinding: 'validated',
          hostVersionRange: 'validated_against_action_catalog',
          interactionTracks: 'structural_only',
        },
        plan: {
          protocolVersion: '1.5.0',
          rootStepId: 'snowman',
        },
        proposalCreated: false,
        hostExecutionStarted: false,
      });
      expect(mcp.result?.structuredContent).toEqual(result);

      const http = await fetch(`${runtime.baseUrl}/api/v1/procedure/compile`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ tree }),
      });
      expect(http.status).toBe(200);
      await expect(http.json()).resolves.toEqual(result);

      const guide = await fetch(`${runtime.baseUrl}/api/v1/guide`, { headers });
      expect(guide.status).toBe(200);
      await expect(guide.json()).resolves.toEqual({ plan: null });
    } finally {
      await runtime.stop();
    }
  });

  it('fails closed for malformed trees and mismatched host-version boundaries', async () => {
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: [blenderActionCatalog],
    });
    try {
      const malformed = await callMcpTool(runtime, 2, 'operatingline.procedure.compile', {
        tree: { unexpected: true },
      });
      expect(malformed.result).toMatchObject({ isError: true });
      expect(malformed.result?.content?.[0]?.text).toContain(
        'invalid_procedure_compilation_request',
      );

      const mismatched = procedureFixture();
      mismatched['hostVersionRange'] = '>=6.0.0 <6.1.0';
      const mcp = await callMcpTool(runtime, 3, 'operatingline.procedure.compile', {
        tree: mismatched,
      });
      expect(mcp.result).toMatchObject({ isError: true });
      expect(mcp.result?.content?.[0]?.text).toContain('is not contained by blender@1.12.0 range');

      const http = await fetch(`${runtime.baseUrl}/api/v1/procedure/compile`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ tree: mismatched }),
      });
      expect(http.status).toBe(422);
      await expect(http.json()).resolves.toMatchObject({
        error: 'procedure_compilation_failed',
      });

      const rejectedStore = await callMcpTool(runtime, 4, 'operatingline.procedure.store', {
        tree: mismatched,
      });
      expect(rejectedStore.result).toMatchObject({ isError: true });
      expect(rejectedStore.result?.content?.[0]?.text).toContain(
        'procedure_tree_validation_failed',
      );
      const rejectedStoreHttp = await fetch(`${runtime.baseUrl}/api/v1/procedure/store`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ tree: mismatched }),
      });
      expect(rejectedStoreHttp.status).toBe(422);
      await expect(rejectedStoreHttp.json()).resolves.toMatchObject({
        error: 'procedure_tree_validation_failed',
      });

      const booleanRevision = await callMcpTool(runtime, 5, 'operatingline.procedure.get', {
        treeId: 'snowman.eye.left.procedure',
        revision: true,
      });
      expect(booleanRevision.result).toMatchObject({ isError: true });
      const booleanLimit = await callMcpTool(runtime, 6, 'operatingline.procedure.list', {
        limit: true,
      });
      expect(booleanLimit.result).toMatchObject({ isError: true });
      const invalidHttpRevision = await fetch(
        `${runtime.baseUrl}/api/v1/procedure?treeId=snowman.eye.left.procedure&revision=true`,
        { headers },
      );
      expect(invalidHttpRevision.status).toBe(400);
    } finally {
      await runtime.stop();
    }
  });
});
