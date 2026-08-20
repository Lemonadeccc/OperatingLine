import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  compileProcedureTreeToGuidePlan,
  materializeProcedureOperations,
  parseProcedureTree,
  procedureOperationSearchRequestSchema,
  procedureTreeGetRequestSchema,
  procedureTreeListRequestSchema,
  procedureTreeSchema,
  procedureTreeStoreRequestSchema,
  storedProcedureTreeSchema,
  stableProcedureLeafOrder,
  validateProcedureTree,
  type ProcedureTree,
} from '@operatingline/protocol';

function readFixture(): ProcedureTree {
  return parseProcedureTree(
    JSON.parse(readFileSync(resolve('protocol/fixtures/v1/snowman-eye.procedure.json'), 'utf8')),
  );
}

function installProjection(tree: ProcedureTree): void {
  const leaf = tree.nodes.find((node) => node.kind === 'leaf');
  if (leaf?.kind !== 'leaf') throw new Error('Expected procedure leaf');
  const semantic = (
    id: string,
    actionArgument: string,
    transform: 'identity' | 'uniform_vector3',
    operationId: string,
    name: string,
  ) => ({
    id,
    actionArgument,
    transform,
    target: {
      modality: 'semantic' as const,
      operationId,
      path: [{ kind: 'field' as const, name }],
    },
  });
  const tracked = (
    id: string,
    actionArgument: string,
    transform: 'identity' | 'uniform_vector3' | 'vector3_x' | 'vector3_y' | 'vector3_z',
    modality: 'menu' | 'shortcut',
    trackId: string,
    operationId: string,
    name: string,
  ) => ({
    id,
    actionArgument,
    transform,
    target: { modality, trackId, operationId, path: [{ kind: 'field' as const, name }] },
  });
  const bindings = [
    semantic('binding.semantic.location', 'location', 'identity', 'semantic.transform', 'location'),
    semantic('binding.semantic.scale', 'radius', 'uniform_vector3', 'semantic.transform', 'scale'),
    semantic('binding.semantic.name', 'objectName', 'identity', 'semantic.rename', 'name'),
    tracked(
      'binding.menu.location',
      'location',
      'identity',
      'menu',
      'menu.layout.default',
      'menu.location',
      'value',
    ),
    tracked(
      'binding.menu.scale',
      'radius',
      'uniform_vector3',
      'menu',
      'menu.layout.default',
      'menu.scale',
      'value',
    ),
    tracked(
      'binding.menu.name',
      'objectName',
      'identity',
      'menu',
      'menu.layout.default',
      'menu.rename',
      'value',
    ),
    tracked(
      'binding.shortcut.x',
      'location',
      'vector3_x',
      'shortcut',
      'shortcut.blender.default',
      'shortcut.move_x',
      'value',
    ),
    tracked(
      'binding.shortcut.y',
      'location',
      'vector3_y',
      'shortcut',
      'shortcut.blender.default',
      'shortcut.move_y',
      'value',
    ),
    tracked(
      'binding.shortcut.z',
      'location',
      'vector3_z',
      'shortcut',
      'shortcut.blender.default',
      'shortcut.move_z',
      'value',
    ),
    tracked(
      'binding.shortcut.scale',
      'radius',
      'identity',
      'shortcut',
      'shortcut.blender.default',
      'shortcut.scale',
      'value',
    ),
    tracked(
      'binding.shortcut.name',
      'objectName',
      'identity',
      'shortcut',
      'shortcut.blender.default',
      'shortcut.rename',
      'text',
    ),
  ];
  leaf.parameterProjection = {
    formatVersion: '1.0.0',
    provenance: {
      kind: 'interaction_catalog_materialization',
      interactionCatalogVersion: tree.interactionCatalogVersion,
      recipeId: 'blender.mesh.create_uv_sphere.native',
    },
    arguments: [
      {
        actionArgument: 'location',
        disposition: 'projected',
        bindingIds: bindings
          .filter((binding) => binding.actionArgument === 'location')
          .map((binding) => binding.id),
      },
      {
        actionArgument: 'objectName',
        disposition: 'projected',
        bindingIds: bindings
          .filter((binding) => binding.actionArgument === 'objectName')
          .map((binding) => binding.id),
      },
      {
        actionArgument: 'radius',
        disposition: 'projected',
        bindingIds: bindings
          .filter((binding) => binding.actionArgument === 'radius')
          .map((binding) => binding.id),
      },
      {
        actionArgument: 'resourceId',
        disposition: 'omitted',
        bindingIds: [],
        reason: 'Logical resource identity has no projected UI parameter.',
      },
    ],
    bindings,
  };
}

describe('procedure tree protocol', () => {
  it('keeps concrete values at the exact semantic, menu, and shortcut operation', () => {
    const tree = readFixture();
    const leaf = tree.nodes.find((node) => node.kind === 'leaf');
    expect(leaf?.kind).toBe('leaf');
    if (leaf?.kind !== 'leaf') throw new Error('Expected procedure leaf');

    expect(leaf.semanticOperations.map((operation) => operation.semanticAction)).toEqual([
      'create_uv_sphere',
      'set_object_transform',
      'rename_object',
    ]);
    const menu = leaf.menuTracks[0]!;
    const shortcut = leaf.shortcutTracks[0]!;
    expect(menu.availability).toBe('available');
    expect(shortcut.availability).toBe('available');
    if (menu.availability !== 'available' || shortcut.availability !== 'available') {
      throw new Error('Expected available interaction tracks');
    }
    expect(
      menu.operations.find((operation) => operation.id === 'menu.location')?.parameters,
    ).toEqual({ value: [0.32, -0.86, 2.14] });
    expect(menu.operations.find((operation) => operation.id === 'menu.rename')?.parameters).toEqual(
      { value: 'OperatingLine.EyeLeft' },
    );
    expect(
      shortcut.operations.find((operation) => operation.id === 'shortcut.move_z')?.parameters,
    ).toEqual({ value: 2.14, confirm: 'ENTER' });
    expect(shortcut.operations.map((operation) => operation.keyMode)).toEqual([
      'chord',
      'sequence',
      'sequence',
      'sequence',
      'sequence',
      'sequence',
    ]);
    expect(leaf.mcpTracks[0]).toMatchObject({
      availability: 'unavailable',
      modality: 'mcp',
    });
  });

  it('validates projection coverage, non-overlapping targets, values, and catalog version', () => {
    const valid = readFixture();
    installProjection(valid);
    expect(() => validateProcedureTree(valid)).not.toThrow();

    const actionless = structuredClone(valid);
    const actionlessLeaf = actionless.nodes.find((node) => node.kind === 'leaf');
    if (actionlessLeaf?.kind !== 'leaf') throw new Error('Expected procedure leaf');
    actionlessLeaf.action = null;
    delete actionlessLeaf.observationPolicy;
    expect(() => validateProcedureTree(actionless)).toThrow(
      'Actionless procedure leaf snowman.head.eyes.left cannot declare parameter projection',
    );

    const wrongVersion = structuredClone(valid);
    const wrongVersionLeaf = wrongVersion.nodes.find((node) => node.kind === 'leaf');
    if (wrongVersionLeaf?.kind !== 'leaf' || wrongVersionLeaf.parameterProjection === undefined) {
      throw new Error('Expected projected procedure leaf');
    }
    wrongVersionLeaf.parameterProjection.provenance.interactionCatalogVersion = '999.0.0';
    expect(() => validateProcedureTree(wrongVersion)).toThrow('catalog version does not match');

    const missingCoverage = structuredClone(valid);
    const missingCoverageLeaf = missingCoverage.nodes.find((node) => node.kind === 'leaf');
    if (
      missingCoverageLeaf?.kind !== 'leaf' ||
      missingCoverageLeaf.parameterProjection === undefined
    ) {
      throw new Error('Expected projected procedure leaf');
    }
    missingCoverageLeaf.parameterProjection.arguments.pop();
    expect(() => validateProcedureTree(missingCoverage)).toThrow(
      'must cover every action argument exactly once',
    );

    const duplicateCoverage = structuredClone(valid);
    const duplicateCoverageLeaf = duplicateCoverage.nodes.find((node) => node.kind === 'leaf');
    if (
      duplicateCoverageLeaf?.kind !== 'leaf' ||
      duplicateCoverageLeaf.parameterProjection === undefined
    ) {
      throw new Error('Expected projected procedure leaf');
    }
    duplicateCoverageLeaf.parameterProjection.arguments.push(
      structuredClone(duplicateCoverageLeaf.parameterProjection.arguments[0]!),
    );
    expect(() => validateProcedureTree(duplicateCoverage)).toThrow(
      'repeats parameter coverage for location',
    );

    const mismatchedCoverage = structuredClone(valid);
    const mismatchedCoverageLeaf = mismatchedCoverage.nodes.find((node) => node.kind === 'leaf');
    if (
      mismatchedCoverageLeaf?.kind !== 'leaf' ||
      mismatchedCoverageLeaf.parameterProjection === undefined
    ) {
      throw new Error('Expected projected procedure leaf');
    }
    const locationCoverage = mismatchedCoverageLeaf.parameterProjection.arguments.find(
      (coverage) => coverage.actionArgument === 'location',
    );
    if (locationCoverage?.disposition !== 'projected') throw new Error('Expected coverage');
    locationCoverage.bindingIds = locationCoverage.bindingIds.slice(1);
    expect(() => validateProcedureTree(mismatchedCoverage)).toThrow(
      'parameter coverage for location does not match its bindings',
    );

    const overlap = structuredClone(valid);
    const overlapLeaf = overlap.nodes.find((node) => node.kind === 'leaf');
    if (overlapLeaf?.kind !== 'leaf' || overlapLeaf.parameterProjection === undefined) {
      throw new Error('Expected projected procedure leaf');
    }
    const nested = structuredClone(overlapLeaf.parameterProjection.bindings[1]!);
    nested.id = 'binding.semantic.scale.component';
    nested.transform = 'identity';
    nested.target.path.push({ kind: 'index', index: 0 });
    overlapLeaf.parameterProjection.bindings.push(nested);
    const radiusCoverage = overlapLeaf.parameterProjection.arguments.find(
      (coverage) => coverage.actionArgument === 'radius',
    );
    if (radiusCoverage?.disposition !== 'projected') throw new Error('Expected coverage');
    radiusCoverage.bindingIds.push(nested.id);
    expect(() => validateProcedureTree(overlap)).toThrow('overlap one target path');

    const wrongValue = structuredClone(valid);
    const wrongValueLeaf = wrongValue.nodes.find((node) => node.kind === 'leaf');
    if (wrongValueLeaf?.kind !== 'leaf') throw new Error('Expected procedure leaf');
    wrongValueLeaf.semanticOperations.find(
      (operation) => operation.id === 'semantic.transform',
    )!.parameters['scale'] = [9, 9, 9];
    expect(() => validateProcedureTree(wrongValue)).toThrow(
      'does not match its action argument projection',
    );

    const unknownArgument = structuredClone(valid);
    const unknownArgumentLeaf = unknownArgument.nodes.find((node) => node.kind === 'leaf');
    if (
      unknownArgumentLeaf?.kind !== 'leaf' ||
      unknownArgumentLeaf.parameterProjection === undefined
    ) {
      throw new Error('Expected projected procedure leaf');
    }
    unknownArgumentLeaf.parameterProjection.bindings[0]!.actionArgument = 'missing';
    expect(() => validateProcedureTree(unknownArgument)).toThrow(
      'references unknown action argument missing',
    );
  });

  it('accepts optional shortcut key mode while keeping legacy trees compatible', () => {
    const legacyTree = structuredClone(readFixture());
    const leaf = legacyTree.nodes.find((node) => node.kind === 'leaf');
    if (leaf?.kind !== 'leaf') throw new Error('Expected procedure leaf');
    const shortcut = leaf.shortcutTracks[0]!;
    if (shortcut.availability !== 'available') throw new Error('Expected shortcut track');
    for (const operation of shortcut.operations) delete operation.keyMode;
    expect(() => validateProcedureTree(legacyTree)).not.toThrow();

    const invalid = structuredClone(readFixture()) as unknown as Record<string, unknown>;
    const nodes = invalid['nodes'] as Array<Record<string, unknown>>;
    const invalidLeaf = nodes.find((node) => node['kind'] === 'leaf')!;
    const tracks = invalidLeaf['shortcutTracks'] as Array<Record<string, unknown>>;
    const operations = tracks[0]!['operations'] as Array<Record<string, unknown>>;
    operations[0]!['keyMode'] = 'simultaneous';
    expect(procedureTreeSchema.safeParse(invalid).success).toBe(false);
  });

  it('accepts an MCP call that covers several semantic operations with concrete arguments', () => {
    const tree = structuredClone(readFixture());
    const leaf = tree.nodes.find((node) => node.kind === 'leaf');
    if (leaf?.kind !== 'leaf') throw new Error('Expected procedure leaf');
    leaf.mcpTracks = [
      {
        id: 'mcp.blender.create_eye',
        availability: 'available',
        title: 'Blender MCP eye creation',
        modality: 'mcp',
        preconditions: [{ kind: 'mode', label: 'Mode', value: 'OBJECT' }],
        operations: [
          {
            id: 'mcp.create_eye',
            order: 1,
            semanticRefs: ['semantic.create', 'semantic.transform', 'semantic.rename'],
            description: 'Create the named eye with its final transform.',
            evidenceRefs: ['evidence.prompt'],
            serverName: 'blender',
            toolName: 'create_uv_sphere',
            arguments: {
              name: 'OperatingLine.EyeLeft',
              location: [0.32, -0.86, 2.14],
              scale: [0.12, 0.12, 0.12],
            },
            resultBinding: 'left_eye',
          },
        ],
      },
    ];

    expect(() => validateProcedureTree(tree)).not.toThrow();
  });

  it('concatenates leaves in dependency-safe presentation order', () => {
    const tree = structuredClone(readFixture());
    const first = tree.nodes.find((node) => node.kind === 'leaf');
    if (first?.kind !== 'leaf') throw new Error('Expected procedure leaf');
    const second = structuredClone(first);
    second.id = 'snowman.head.eyes.right';
    second.order = 2;
    second.dependsOn = [first.id];
    second.title = '创建并调整右眼球体';
    tree.nodes.push(second);

    expect(stableProcedureLeafOrder(tree).map((leaf) => leaf.id)).toEqual([
      'snowman.head.eyes.left',
      'snowman.head.eyes.right',
    ]);
  });

  it('compiles to the existing human-approved GuidePlan boundary', () => {
    const plan = compileProcedureTreeToGuidePlan(readFixture());
    const leaf = plan.steps.find((step) => step.id === 'snowman.head.eyes.left');

    expect(plan).toMatchObject({
      protocolVersion: '1.5.0',
      id: 'snowman.eye.left.procedure',
      rootStepId: 'snowman',
    });
    expect(leaf).toMatchObject({
      action: {
        adapterId: 'blender',
        name: 'blender.mesh.create_uv_sphere',
        arguments: {
          objectName: 'OperatingLine.EyeLeft',
          radius: 0.12,
          location: [0.32, -0.86, 2.14],
        },
      },
      observationPolicy: { mode: 'success_gate', failureStrategy: 'rollback_step' },
      rollback: { mode: 'compensating_action', checkpointRequired: false },
    });
  });

  it('materializes one explicit track per leaf with stable global operation order', () => {
    const tree = readFixture();
    const menu = materializeProcedureOperations(tree, 'menu');

    expect(menu).toHaveLength(7);
    expect(menu.map((item) => item.globalOrder)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(menu[4]).toMatchObject({
      leafId: 'snowman.head.eyes.left',
      trackId: 'menu.layout.default',
      modality: 'menu',
      operation: {
        id: 'menu.location',
        parameters: { value: [0.32, -0.86, 2.14] },
      },
    });
    expect(() => materializeProcedureOperations(tree, 'mcp')).toThrow('has no available mcp track');

    const ambiguous = structuredClone(tree);
    const leaf = ambiguous.nodes.find((node) => node.kind === 'leaf');
    if (leaf?.kind !== 'leaf') throw new Error('Expected procedure leaf');
    const alternative = structuredClone(leaf.menuTracks[0]!);
    alternative.id = 'menu.layout.alternative';
    leaf.menuTracks.push(alternative);
    expect(() => materializeProcedureOperations(ambiguous, 'menu')).toThrow(
      'ambiguous menu tracks',
    );
    expect(
      materializeProcedureOperations(ambiguous, 'menu', {
        [leaf.id]: 'menu.layout.alternative',
      })[0]?.trackId,
    ).toBe('menu.layout.alternative');
  });

  it('rejects broken semantic alignment, ordering, hierarchy, and evidence provenance', () => {
    const missingSemantic = structuredClone(readFixture());
    const missingSemanticLeaf = missingSemantic.nodes.find((node) => node.kind === 'leaf');
    if (missingSemanticLeaf?.kind !== 'leaf') throw new Error('Expected procedure leaf');
    const menu = missingSemanticLeaf.menuTracks[0]!;
    if (menu.availability !== 'available') throw new Error('Expected menu track');
    menu.operations = menu.operations.filter(
      (operation) => !operation.semanticRefs.includes('semantic.rename'),
    );
    expect(() => validateProcedureTree(missingSemantic)).toThrow(
      'does not cover semantic operations',
    );

    const noncontiguous = structuredClone(readFixture());
    const noncontiguousLeaf = noncontiguous.nodes.find((node) => node.kind === 'leaf');
    if (noncontiguousLeaf?.kind !== 'leaf') throw new Error('Expected procedure leaf');
    const shortcut = noncontiguousLeaf.shortcutTracks[0]!;
    if (shortcut.availability !== 'available') throw new Error('Expected shortcut track');
    shortcut.operations[1]!.order = 9;
    expect(() => validateProcedureTree(noncontiguous)).toThrow('orders must be contiguous from 1');

    const leafParent = structuredClone(readFixture());
    leafParent.nodes[1]!.parentId = 'snowman.head.eyes.left';
    expect(() => validateProcedureTree(leafParent)).toThrow('cannot contain child');

    const unknownEvidence = structuredClone(readFixture());
    const unknownEvidenceLeaf = unknownEvidence.nodes.find((node) => node.kind === 'leaf');
    if (unknownEvidenceLeaf?.kind !== 'leaf') throw new Error('Expected procedure leaf');
    unknownEvidenceLeaf.semanticOperations[0]!.evidenceRefs = ['evidence.missing'];
    expect(() => validateProcedureTree(unknownEvidence)).toThrow('unknown evidence');

    const wrongAdapter = structuredClone(readFixture());
    const wrongAdapterLeaf = wrongAdapter.nodes.find((node) => node.kind === 'leaf');
    if (wrongAdapterLeaf?.kind !== 'leaf' || wrongAdapterLeaf.action === null) {
      throw new Error('Expected executable procedure leaf');
    }
    wrongAdapterLeaf.action.adapterId = 'other-host';
    expect(() => validateProcedureTree(wrongAdapter)).toThrow('does not match blender');
  });

  it('emits a strict language-neutral JSON Schema', () => {
    const schema = JSON.parse(
      readFileSync(resolve('protocol/schemas/v1/procedure-tree.schema.json'), 'utf8'),
    ) as {
      additionalProperties?: boolean;
      properties?: { nodes?: { items?: { oneOf?: Array<{ additionalProperties?: boolean }> } } };
    };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties?.nodes?.items?.oneOf).toEqual(
      expect.arrayContaining([expect.objectContaining({ additionalProperties: false })]),
    );

    const extra = { ...readFixture(), unexpected: true };
    expect(procedureTreeSchema.safeParse(extra).success).toBe(false);
  });

  it('keeps storage reads strict, integrity-addressed, and query-compatible', () => {
    const tree = readFixture();
    expect(procedureTreeStoreRequestSchema.safeParse({ tree, unexpected: true }).success).toBe(
      false,
    );
    expect(procedureTreeGetRequestSchema.parse({ treeId: tree.id, revision: 1 })).toEqual({
      treeId: tree.id,
      revision: 1,
    });
    expect(
      procedureTreeGetRequestSchema.safeParse({ treeId: tree.id, revision: true }).success,
    ).toBe(false);
    expect(procedureTreeListRequestSchema.parse({ afterSequence: 7, limit: 10 })).toEqual({
      afterSequence: 7,
      limit: 10,
    });
    expect(
      procedureTreeListRequestSchema.safeParse({ afterSequence: ' ', limit: true }).success,
    ).toBe(false);
    expect(
      storedProcedureTreeSchema.parse({
        sequence: 1,
        tree,
        integrity: {
          algorithm: 'sha256',
          canonicalization: 'operatingline-json-value-v1',
          contentSha256: 'a'.repeat(64),
        },
        storedAt: '2026-08-14T00:00:00.000Z',
      }),
    ).toMatchObject({ tree: { id: tree.id, revision: 1 } });
  });

  it('rejects an operation search without an exact selector', () => {
    expect(procedureOperationSearchRequestSchema.safeParse({ limit: 10 }).success).toBe(false);
  });

  it('rejects an operation revision selector without a tree id', () => {
    expect(
      procedureOperationSearchRequestSchema.safeParse({ revision: 1, modality: 'semantic' })
        .success,
    ).toBe(false);
  });

  it('rejects string and boolean operation search numerics', () => {
    expect(
      procedureOperationSearchRequestSchema.safeParse({
        treeId: 'snowman.eye.left.procedure',
        revision: '1',
        afterSequence: '0',
        limit: true,
      }).success,
    ).toBe(false);
  });

  it('accepts an exact compound operation selector', () => {
    expect(
      procedureOperationSearchRequestSchema.parse({
        treeId: 'snowman.eye.left.procedure',
        revision: 1,
        modality: 'menu',
        menuTargetHostId: 'mesh.primitive_uv_sphere_add',
        menuPath: ['Layout', 'Add', 'Mesh', 'UV Sphere'],
        afterSequence: 0,
        limit: 10,
      }),
    ).toEqual({
      treeId: 'snowman.eye.left.procedure',
      revision: 1,
      modality: 'menu',
      menuTargetHostId: 'mesh.primitive_uv_sphere_add',
      menuPath: ['Layout', 'Add', 'Mesh', 'UV Sphere'],
      afterSequence: 0,
      limit: 10,
    });
  });

  it('accepts exact shortcut property-control selectors', () => {
    expect(
      procedureOperationSearchRequestSchema.parse({
        operationKind: 'operator_property_update',
        targetHostId: 'mesh.primitive_ico_sphere_add.subdivisions',
        interactionPath: ['Adjust Last Operation', 'Subdivisions'],
        surfaceOperationId: 'shortcut.open_adjust_last',
        expectedOperatorId: 'mesh.primitive_ico_sphere_add',
      }),
    ).toEqual({
      operationKind: 'operator_property_update',
      targetHostId: 'mesh.primitive_ico_sphere_add.subdivisions',
      interactionPath: ['Adjust Last Operation', 'Subdivisions'],
      surfaceOperationId: 'shortcut.open_adjust_last',
      expectedOperatorId: 'mesh.primitive_ico_sphere_add',
    });
  });
});
