import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';

import { describe, expect, it } from 'vitest';

import { openOperatingLineDatabase } from '@operatingline/persistence';

function recordWorkSlotFromWorker(
  databasePath: string,
  operation: 'goal' | 'replan' | 'procedure',
  payload: unknown,
): Promise<string> {
  return new Promise((resolveWorker, rejectWorker) => {
    const worker = new Worker(
      `
        const { parentPort, workerData } = require('node:worker_threads');
        import('@operatingline/persistence').then(({ openOperatingLineDatabase }) => {
          const database = openOperatingLineDatabase(workerData.databasePath);
          try {
            const result = workerData.operation === 'goal'
              ? database.recordGuideGoalRequest(workerData.payload)
              : workerData.operation === 'replan'
                ? database.recordCompanionReplanRun(workerData.payload)
                : database.recordProcedureTree(workerData.payload).result;
            parentPort.postMessage(result);
          } finally {
            database.close();
          }
        }).catch((error) => parentPort.postMessage({ error: String(error) }));
      `,
      {
        eval: true,
        workerData: { databasePath, operation, payload },
      },
    );
    worker.once('message', (result: unknown) => {
      if (typeof result === 'object' && result !== null && 'error' in result) {
        rejectWorker(new Error(String((result as { error: unknown }).error)));
      } else {
        resolveWorker(String(result));
      }
    });
    worker.once('error', rejectWorker);
  });
}

function guideProposal(planId = 'snowman', revision = 1) {
  return {
    protocolVersion: '1.0.0',
    proposalId: randomUUID(),
    targetAdapterId: 'blender',
    proposedAt: new Date().toISOString(),
    plan: { id: planId, revision },
  };
}

function procedureLeafReplay(proposalId: string, overrides: Record<string, unknown> = {}) {
  return {
    replayId: randomUUID(),
    proposalId,
    treeId: 'snowman.eye.procedure',
    treeRevision: 1,
    leafId: 'snowman.eye.create',
    adapterId: 'blender',
    instanceId: randomUUID(),
    bindingContentSha256: 'a'.repeat(64),
    payload: {
      contractVersion: '1.0.0',
      operationIds: ['create-eye'],
    },
    createdAt: '2026-08-17T08:00:00.000Z',
    ...overrides,
  };
}

function procedureLeafReplayAttestation(replayId: string, overrides: Record<string, unknown> = {}) {
  return {
    attestationId: randomUUID(),
    replayId,
    reportId: randomUUID(),
    executionId: randomUUID(),
    contentSha256: 'b'.repeat(64),
    payload: {
      contractVersion: '1.0.0',
      result: 'verified',
    },
    attestedAt: '2026-08-17T08:01:00.000Z',
    ...overrides,
  };
}

function proposalDecision(
  proposalId: string,
  instanceId: string,
  decision: 'accepted' | 'rejected' = 'accepted',
) {
  return {
    protocolVersion: '1.0.0',
    decisionId: randomUUID(),
    proposalId,
    adapterId: 'blender',
    instanceId,
    decision,
    occurredAt: new Date().toISOString(),
  };
}

function revisionRequest(requestId = randomUUID()) {
  return {
    protocolVersion: '1.0.0',
    requestId,
    adapterId: 'blender',
    catalogVersion: '1.0.0',
    instanceId: randomUUID(),
    basePlan: { id: 'snowman', revision: 3 },
    references: [{ nodeId: 'snowman.model.head', nodeNumber: '1.2.3' }],
    message: 'Make the head slightly larger.',
    occurredAt: new Date().toISOString(),
  };
}

function goalRequest(overrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: '1.1.0',
    requestId: randomUUID(),
    adapterId: 'canvas',
    catalogVersion: '2.0.0',
    instanceId: randomUUID(),
    goal: 'Create a launch diagram.',
    planId: 'launch-diagram',
    occurredAt: '2026-08-09T10:00:00.000Z',
    ...overrides,
  };
}

function companionReplanRun(overrides: Record<string, unknown> = {}) {
  const generationRequestId = randomUUID();
  const revisionRequestId = randomUUID();
  const targetInstanceId = randomUUID();
  return {
    contractVersion: '1.0.0',
    generationRequestId,
    revisionRequestId,
    targetAdapterId: 'blender',
    targetInstanceId,
    provider: { id: 'fake-planner', version: '0.1.0', displayName: 'Fake Planner' },
    status: 'queued',
    terminal: false,
    sceneChanged: false,
    proposalId: null,
    error: null,
    updatedAt: '2026-08-05T12:00:00.000Z',
    request: {
      generationRequestId,
      revisionRequestId,
      providerId: 'fake-planner',
      providerVersion: '0.1.0',
      targetAdapterId: 'blender',
      targetInstanceId,
      authorization: {
        disclosureVersion: '1.0.0',
        dataHandlingAcknowledged: true,
        possibleChargesAcknowledged: true,
        proposalCreationAcknowledged: true,
        authorizedAt: '2026-08-05T12:00:00.000Z',
      },
    },
    authorizedProvider: {
      contractVersion: '1.0.0',
      id: 'fake-planner',
      version: '0.1.0',
      displayName: 'Fake Planner',
      description: 'Persistence fixture provider.',
      availability: { available: true },
      limits: { maxConcurrency: 1 },
      dataHandling: {
        executionLocation: 'local',
        dataTransmission: 'none',
        credentialManagement: 'provider_managed',
      },
    },
    ...overrides,
  };
}

function companionInitialPlanRun(
  goal: ReturnType<typeof goalRequest>,
  overrides: Record<string, unknown> = {},
) {
  const generationRequestId = randomUUID();
  return {
    contractVersion: '1.0.0',
    generationRequestId,
    goalRequestId: goal.requestId,
    targetAdapterId: goal.adapterId,
    targetInstanceId: goal.instanceId,
    provider: { id: 'fake-planner', version: '0.1.0', displayName: 'Fake Planner' },
    status: 'queued',
    terminal: false,
    sceneChanged: false,
    proposalId: null,
    error: null,
    needsRevision: null,
    updatedAt: '2026-08-09T12:00:00.000Z',
    request: {
      generationRequestId,
      goalRequestId: goal.requestId,
      providerId: 'fake-planner',
      providerVersion: '0.1.0',
      targetAdapterId: goal.adapterId,
      targetInstanceId: goal.instanceId,
      authorization: {
        disclosureVersion: '1.0.0',
        dataHandlingAcknowledged: true,
        possibleChargesAcknowledged: true,
        proposalCreationAcknowledged: true,
        authorizedAt: '2026-08-09T12:00:00.000Z',
      },
    },
    ...overrides,
  };
}

function companionDialogueRun(
  revision = revisionRequest(),
  overrides: Record<string, unknown> = {},
) {
  const dialogueRequestId = randomUUID();
  const replanGenerationRequestId = randomUUID();
  return {
    contractVersion: '1.0.0',
    dialogueRequestId,
    revisionRequestId: revision.requestId,
    replanGenerationRequestId,
    targetAdapterId: revision.adapterId,
    targetInstanceId: revision.instanceId,
    provider: {
      id: 'fake-dialogue-planner',
      version: '0.1.0',
      displayName: 'Fake Dialogue Planner',
    },
    status: 'queued',
    terminal: false,
    sceneChanged: false,
    assistantMessage: '',
    assistantMessageRevision: 0,
    semanticDecision: null,
    revisionRequestRecorded: false,
    proposalId: null,
    error: null,
    needsRevision: null,
    updatedAt: '2026-08-12T12:00:00.000Z',
    request: {
      dialogueRequestId,
      replanGenerationRequestId,
      revisionRequest: revision,
      authorization: {
        disclosureVersion: '1.0.0',
        dataHandlingAcknowledged: true,
        possibleChargesAcknowledged: true,
        authorizedProviderCallLimit: 2,
        automaticReplanAcknowledged: true,
        proposalCreationAcknowledged: true,
        authorizedAt: '2026-08-12T12:00:00.000Z',
      },
    },
    authorizedProvider: {
      contractVersion: '1.0.0',
      id: 'fake-dialogue-planner',
      version: '0.1.0',
      displayName: 'Fake Dialogue Planner',
      description: 'Persistence fixture dialogue provider.',
      availability: { available: true },
      limits: { maxConcurrency: 1 },
      dataHandling: {
        executionLocation: 'local',
        dataTransmission: 'none',
        credentialManagement: 'provider_managed',
      },
    },
    ...overrides,
  };
}

function procedureTreeRecord(revision = 1, overrides: Record<string, unknown> = {}) {
  const tree = {
    formatVersion: '1.0.0',
    id: 'snowman.eye.procedure',
    revision,
    title: `Snowman eye revision ${revision}`,
    adapterId: 'blender',
    actionCatalogVersion: '1.12.0',
    interactionCatalogVersion: '1.0.0',
    hostVersionRange: '>=4.3.0 <5.0.0',
    rootNodeId: 'snowman',
    sources: [],
    evidence: [],
    nodes: [],
  };
  return {
    treeId: tree.id,
    revision: tree.revision,
    title: tree.title,
    adapterId: tree.adapterId,
    actionCatalogVersion: tree.actionCatalogVersion,
    interactionCatalogVersion: tree.interactionCatalogVersion,
    hostVersionRange: tree.hostVersionRange,
    contentSha256: String(revision % 10).repeat(64),
    tree,
    ...overrides,
  };
}

function indexedProcedureTreeRecord() {
  const tree = JSON.parse(
    readFileSync(resolve('protocol/fixtures/v1/snowman-eye.procedure.json'), 'utf8'),
  ) as Record<string, unknown>;
  return procedureTreeRecord(1, {
    treeId: tree['id'],
    title: tree['title'],
    adapterId: tree['adapterId'],
    actionCatalogVersion: tree['actionCatalogVersion'],
    interactionCatalogVersion: tree['interactionCatalogVersion'],
    hostVersionRange: tree['hostVersionRange'],
    tree,
  });
}

function extendedShortcutProcedureTreeRecord() {
  const record = indexedProcedureTreeRecord();
  const tree = structuredClone(record.tree) as {
    formatVersion: string;
    nodes: Array<{
      kind: string;
      shortcutTracks?: Array<{
        availability: string;
        operations?: Array<Record<string, unknown>>;
      }>;
    }>;
  };
  tree.formatVersion = '1.1.0';
  const leaf = tree.nodes.find((node) => node.kind === 'leaf');
  const track = leaf?.shortcutTracks?.find((candidate) => candidate.availability === 'available');
  if (track === undefined) throw new Error('Expected available shortcut track fixture');
  track.operations = [
    {
      kind: 'key_input',
      id: 'shortcut.add_icosphere',
      order: 1,
      keyMode: 'chord',
      semanticRefs: ['semantic.create'],
      description: 'Add an Icosphere.',
      evidenceRefs: ['evidence.prompt'],
      keys: ['SHIFT', 'A'],
      selectionPath: ['Mesh', 'Icosphere'],
      parameters: {},
    },
    {
      kind: 'key_input',
      id: 'shortcut.open_adjust_last',
      order: 2,
      keyMode: 'sequence',
      semanticRefs: ['semantic.create'],
      description: 'Open Adjust Last Operation.',
      evidenceRefs: ['evidence.prompt'],
      keys: ['F9'],
      parameters: {},
      opensSurface: {
        kind: 'adjust_last_operation',
        hostId: 'screen.redo_last',
        sourceOperationId: 'shortcut.add_icosphere',
        expectedOperatorId: 'mesh.primitive_ico_sphere_add',
      },
    },
    {
      kind: 'operator_property_update',
      id: 'shortcut.set_subdivisions',
      order: 3,
      semanticRefs: ['semantic.create'],
      description: 'Set Subdivisions.',
      evidenceRefs: ['evidence.prompt'],
      surfaceOperationId: 'shortcut.open_adjust_last',
      target: { kind: 'control', hostId: 'mesh.primitive_ico_sphere_add.subdivisions' },
      path: ['Adjust Last Operation', 'Subdivisions'],
      parameters: { value: 3 },
    },
    {
      kind: 'key_input',
      id: 'shortcut.close_adjust_last',
      order: 4,
      keyMode: 'sequence',
      semanticRefs: ['semantic.create'],
      description: 'Close Adjust Last Operation.',
      evidenceRefs: ['evidence.prompt'],
      keys: ['ENTER'],
      parameters: {},
      closesSurfaceOperationId: 'shortcut.open_adjust_last',
    },
  ];
  return { ...record, tree };
}

describe('OperatingLine persistence', () => {
  it('stores immutable procedure revisions with stable reads, pagination, and audit events', () => {
    const directory = mkdtempSync(join(tmpdir(), 'operatingline-procedure-tree-test-'));
    const databasePath = join(directory, 'state.db');
    try {
      const first = openOperatingLineDatabase(databasePath);
      const revisionOne = procedureTreeRecord(1);
      const accepted = first.recordProcedureTree(revisionOne);
      expect(accepted).toMatchObject({ result: 'accepted', record: { revision: 1 } });
      expect(first.recordProcedureTree(revisionOne)).toEqual({
        result: 'duplicate',
        record: accepted.result === 'accepted' ? accepted.record : undefined,
      });
      expect(
        first.recordProcedureTree({
          ...revisionOne,
          tree: { ...(revisionOne.tree as Record<string, unknown>), title: 'Conflicting title' },
        }),
      ).toEqual({ result: 'conflict', latestRevision: 1 });

      const revisionThree = procedureTreeRecord(3);
      expect(first.recordProcedureTree(revisionThree)).toMatchObject({
        result: 'accepted',
        record: { revision: 3 },
      });
      expect(first.recordProcedureTree(procedureTreeRecord(2))).toEqual({
        result: 'stale',
        latestRevision: 3,
      });
      expect(first.recordProcedureTree(procedureTreeRecord(4, { adapterId: 'maya' }))).toEqual({
        result: 'conflict',
        latestRevision: 3,
      });

      const other = procedureTreeRecord(1, {
        treeId: 'maya.eye.procedure',
        title: 'Maya eye',
        adapterId: 'maya',
        tree: {
          ...(procedureTreeRecord(1).tree as Record<string, unknown>),
          id: 'maya.eye.procedure',
          title: 'Maya eye',
          adapterId: 'maya',
        },
      });
      expect(first.recordProcedureTree(other)).toMatchObject({ result: 'accepted' });

      expect(first.getProcedureTree(revisionOne.treeId, 1)).toMatchObject({
        treeId: revisionOne.treeId,
        revision: 1,
        tree: revisionOne.tree,
      });
      expect(first.getProcedureTree(revisionOne.treeId)).toMatchObject({ revision: 3 });
      const firstPage = first.listProcedureTrees(0, 1);
      expect(firstPage).toHaveLength(1);
      expect(first.listProcedureTrees(firstPage[0]!.sequence, 10)).toHaveLength(2);
      expect(first.listProcedureTrees(0, 10, 'maya')).toMatchObject([
        { treeId: 'maya.eye.procedure', adapterId: 'maya' },
      ]);
      expect(first.listExecutionEventsByTypes(['procedure.tree.stored'])).toHaveLength(3);
      first.close();

      const reopened = openOperatingLineDatabase(databasePath);
      expect(reopened.getProcedureTree(revisionOne.treeId)).toMatchObject({ revision: 3 });
      expect(reopened.recordProcedureTree(revisionThree)).toMatchObject({ result: 'duplicate' });
      reopened.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('serializes concurrent writes of the same procedure revision', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'operatingline-procedure-race-test-'));
    const databasePath = join(directory, 'state.db');
    try {
      openOperatingLineDatabase(databasePath).close();
      const procedure = procedureTreeRecord();
      await expect(
        Promise.all([
          recordWorkSlotFromWorker(databasePath, 'procedure', procedure),
          recordWorkSlotFromWorker(databasePath, 'procedure', procedure),
        ]),
      ).resolves.toEqual(expect.arrayContaining(['accepted', 'duplicate']));
      const database = openOperatingLineDatabase(databasePath);
      expect(database.listProcedureTrees(0, 10)).toHaveLength(1);
      expect(database.listExecutionEventsByTypes(['procedure.tree.stored'])).toHaveLength(1);
      database.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('searches indexed operations with exact compound filters', () => {
    const database = openOperatingLineDatabase(':memory:');
    expect(database.recordProcedureTree(indexedProcedureTreeRecord())).toMatchObject({
      result: 'accepted',
    });

    const exact = database.searchProcedureOperations({
      afterSequence: 0,
      limit: 10,
      treeId: 'snowman.eye.left.procedure',
      treeRevision: 1,
      modality: 'menu',
      semanticAction: 'create_uv_sphere',
      menuTargetHostId: 'mesh.primitive_uv_sphere_add',
      menuPath: ['Layout', 'Add', 'Mesh', 'UV Sphere'],
    });
    expect(exact).toMatchObject([
      {
        treeId: 'snowman.eye.left.procedure',
        treeRevision: 1,
        modality: 'menu',
        operationId: 'menu.uv_sphere',
        semanticActions: ['create_uv_sphere'],
      },
    ]);

    database.close();
  });

  it('indexes and searches shortcut surface context without changing legacy selectors', () => {
    const database = openOperatingLineDatabase(':memory:');
    expect(database.recordProcedureTree(extendedShortcutProcedureTreeRecord())).toMatchObject({
      result: 'accepted',
    });

    expect(
      database.searchProcedureOperations({
        afterSequence: 0,
        limit: 10,
        operationKind: 'operator_property_update',
        targetHostId: 'mesh.primitive_ico_sphere_add.subdivisions',
        interactionPath: ['Adjust Last Operation', 'Subdivisions'],
        surfaceOperationId: 'shortcut.open_adjust_last',
      }),
    ).toMatchObject([
      {
        modality: 'shortcut',
        operationKind: 'operator_property_update',
        operationId: 'shortcut.set_subdivisions',
        shortcutKeys: null,
        targetHostId: 'mesh.primitive_ico_sphere_add.subdivisions',
        expectedOperatorId: 'mesh.primitive_ico_sphere_add',
      },
    ]);
    expect(
      database.searchProcedureOperations({
        afterSequence: 0,
        limit: 10,
        shortcutKeys: ['F9'],
        targetHostId: 'screen.redo_last',
        surfaceOperationId: 'shortcut.open_adjust_last',
        expectedOperatorId: 'mesh.primitive_ico_sphere_add',
      }),
    ).toMatchObject([{ operationId: 'shortcut.open_adjust_last' }]);
    expect(
      database
        .searchProcedureOperations({
          afterSequence: 0,
          limit: 10,
          surfaceOperationId: 'shortcut.open_adjust_last',
          expectedOperatorId: 'mesh.primitive_ico_sphere_add',
        })
        .map((operation) => operation.operationId),
    ).toEqual([
      'shortcut.open_adjust_last',
      'shortcut.set_subdivisions',
      'shortcut.close_adjust_last',
    ]);
    expect(
      database.searchProcedureOperations({
        afterSequence: 0,
        limit: 10,
        menuTargetHostId: 'mesh.primitive_uv_sphere_add',
        menuPath: ['Layout', 'Add', 'Mesh', 'UV Sphere'],
      }),
    ).toHaveLength(1);

    database.close();
  });

  it('continues indexed operation search after an exact cursor', () => {
    const database = openOperatingLineDatabase(':memory:');
    expect(database.recordProcedureTree(indexedProcedureTreeRecord())).toMatchObject({
      result: 'accepted',
    });

    const firstPage = database.searchProcedureOperations({
      afterSequence: 0,
      limit: 1,
      treeId: 'snowman.eye.left.procedure',
      modality: 'semantic',
    });
    expect(firstPage).toHaveLength(1);
    expect(
      database.searchProcedureOperations({
        afterSequence: firstPage[0]!.sequence,
        limit: 10,
        treeId: 'snowman.eye.left.procedure',
        modality: 'semantic',
      }),
    ).toMatchObject([{ operationId: 'semantic.transform' }, { operationId: 'semantic.rename' }]);
    database.close();
  });

  it('does not index unavailable MCP tracks', () => {
    const database = openOperatingLineDatabase(':memory:');
    expect(database.recordProcedureTree(indexedProcedureTreeRecord())).toMatchObject({
      result: 'accepted',
    });

    expect(
      database.searchProcedureOperations({
        afterSequence: 0,
        limit: 10,
        treeId: 'snowman.eye.left.procedure',
        modality: 'mcp',
      }),
    ).toEqual([]);
    database.close();
  });

  it('preserves semantic reference order in the operation index', () => {
    const database = openOperatingLineDatabase(':memory:');
    const record = indexedProcedureTreeRecord();
    const tree = record.tree as {
      nodes: Array<{
        kind: string;
        menuTracks?: Array<{
          availability: string;
          operations?: Array<{ id: string; semanticRefs: string[] }>;
        }>;
      }>;
    };
    const leaf = tree.nodes.find((node) => node.kind === 'leaf');
    const operation = leaf?.menuTracks
      ?.find((track) => track.availability === 'available')
      ?.operations?.find((candidate) => candidate.id === 'menu.uv_sphere');
    if (operation === undefined) throw new Error('Expected indexed menu operation fixture');
    operation.semanticRefs = ['semantic.rename', 'semantic.create'];

    expect(database.recordProcedureTree(record)).toMatchObject({ result: 'accepted' });
    expect(
      database.searchProcedureOperations({
        afterSequence: 0,
        limit: 10,
        treeId: 'snowman.eye.left.procedure',
        operationId: 'menu.uv_sphere',
      }),
    ).toMatchObject([
      {
        semanticActions: ['rename_object', 'create_uv_sphere'],
      },
    ]);
    database.close();
  });

  it('backfills indexed operations for procedure trees stored before schema 13', () => {
    const directory = mkdtempSync(join(tmpdir(), 'operatingline-procedure-index-backfill-'));
    const databasePath = join(directory, 'state.db');
    try {
      const initial = openOperatingLineDatabase(databasePath);
      expect(initial.recordProcedureTree(indexedProcedureTreeRecord())).toMatchObject({
        result: 'accepted',
      });
      initial.close();

      const schemaTwelve = new DatabaseSync(databasePath);
      schemaTwelve.exec(`
        DROP TABLE procedure_operations;
        DELETE FROM schema_migrations WHERE version = 13;
      `);
      schemaTwelve.close();

      const migrated = openOperatingLineDatabase(databasePath);
      expect(
        migrated.searchProcedureOperations({
          afterSequence: 0,
          limit: 10,
          treeId: 'snowman.eye.left.procedure',
          operationId: 'menu.uv_sphere',
        }),
      ).toMatchObject([
        {
          modality: 'menu',
          operationKind: 'menu_interaction',
          semanticActions: ['create_uv_sphere'],
          targetHostId: 'mesh.primitive_uv_sphere_add',
          interactionPath: ['Layout', 'Add', 'Mesh', 'UV Sphere'],
        },
      ]);
      expect(
        migrated.searchProcedureOperations({
          afterSequence: 0,
          limit: 10,
          treeId: 'snowman.eye.left.procedure',
          operationKind: 'shortcut_key_input',
          shortcutKeys: ['SHIFT', 'A'],
        }),
      ).toMatchObject([
        {
          operationId: 'shortcut.add_sphere',
          interactionPath: ['Mesh', 'UV Sphere'],
        },
      ]);
      migrated.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rebuilds a schema-13 operation index without losing legacy procedure trees', () => {
    const directory = mkdtempSync(join(tmpdir(), 'operatingline-procedure-index-v14-'));
    const databasePath = join(directory, 'state.db');
    try {
      const initial = openOperatingLineDatabase(databasePath);
      expect(initial.recordProcedureTree(indexedProcedureTreeRecord())).toMatchObject({
        result: 'accepted',
      });
      initial.close();

      const schemaThirteen = new DatabaseSync(databasePath);
      schemaThirteen.exec(`
        DROP TRIGGER procedure_operations_context_insert;
        DROP INDEX procedure_operations_kind;
        DROP INDEX procedure_operations_target;
        DROP INDEX procedure_operations_surface;
        ALTER TABLE procedure_operations DROP COLUMN operation_kind;
        ALTER TABLE procedure_operations DROP COLUMN target_host_id;
        ALTER TABLE procedure_operations DROP COLUMN interaction_path;
        ALTER TABLE procedure_operations DROP COLUMN surface_operation_id;
        ALTER TABLE procedure_operations DROP COLUMN expected_operator_id;
        DELETE FROM schema_migrations WHERE version = 14;
      `);
      schemaThirteen.close();

      const migrated = openOperatingLineDatabase(databasePath);
      expect(migrated.listProcedureTrees(0, 10)).toMatchObject([
        { treeId: 'snowman.eye.left.procedure', revision: 1 },
      ]);
      expect(
        migrated.searchProcedureOperations({
          afterSequence: 0,
          limit: 10,
          operationKind: 'shortcut_key_input',
          interactionPath: ['Mesh', 'UV Sphere'],
        }),
      ).toMatchObject([
        {
          operationId: 'shortcut.add_sphere',
          shortcutKeys: ['SHIFT', 'A'],
        },
      ]);
      migrated.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('recovers an interrupted schema-14 operation-index rebuild', () => {
    const directory = mkdtempSync(join(tmpdir(), 'operatingline-procedure-index-v14-recovery-'));
    const databasePath = join(directory, 'state.db');
    try {
      const initial = openOperatingLineDatabase(databasePath);
      expect(initial.recordProcedureTree(indexedProcedureTreeRecord())).toMatchObject({
        result: 'accepted',
      });
      initial.close();

      const interrupted = new DatabaseSync(databasePath);
      interrupted.exec(`
        DROP TRIGGER procedure_operations_context_insert;
        UPDATE procedure_operations
        SET operation_kind = NULL,
            target_host_id = NULL,
            interaction_path = NULL,
            surface_operation_id = NULL,
            expected_operator_id = NULL;
        DELETE FROM schema_migrations WHERE version = 14;
      `);
      interrupted.close();

      const recovered = openOperatingLineDatabase(databasePath);
      expect(
        recovered.searchProcedureOperations({
          afterSequence: 0,
          limit: 10,
          operationKind: 'shortcut_key_input',
          interactionPath: ['Mesh', 'UV Sphere'],
        }),
      ).toMatchObject([
        {
          operationId: 'shortcut.add_sphere',
          targetHostId: null,
          shortcutKeys: ['SHIFT', 'A'],
        },
      ]);
      recovered.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rolls back a procedure revision when derived index data violates a constraint', () => {
    const database = openOperatingLineDatabase(':memory:');
    const base = procedureTreeRecord(1);
    const malformed = {
      ...base,
      tree: {
        ...(base.tree as Record<string, unknown>),
        nodes: [
          {
            id: 'leaf.invalid',
            kind: 'leaf',
            action: null,
            validation: { status: 'invalid' },
            semanticOperations: [
              {
                id: 'semantic.invalid',
                semanticAction: 'invalid_action',
              },
            ],
          },
        ],
      },
    };

    expect(() => database.recordProcedureTree(malformed)).toThrow();
    expect(database.listProcedureTrees(0, 10)).toEqual([]);
    expect(database.countEvents()).toBe(0);
    database.close();
  });

  it('fails closed when shortcut key-input or property-update context is incomplete', () => {
    for (const testCase of [
      {
        operationIndex: 1,
        mutate(operation: Record<string, unknown>) {
          operation['opensSurface'] = {
            kind: 'adjust_last_operation',
            hostId: 'screen.redo_last',
            sourceOperationId: 'shortcut.add_icosphere',
          };
        },
      },
      {
        operationIndex: 2,
        mutate(operation: Record<string, unknown>) {
          delete operation['target'];
        },
      },
    ]) {
      const database = openOperatingLineDatabase(':memory:');
      const record = extendedShortcutProcedureTreeRecord();
      const tree = record.tree as {
        nodes: Array<{
          kind: string;
          shortcutTracks?: Array<{ operations?: Array<Record<string, unknown>> }>;
        }>;
      };
      const operations = tree.nodes.find((node) => node.kind === 'leaf')?.shortcutTracks?.[0]
        ?.operations;
      if (operations === undefined) throw new Error('Expected extended shortcut operations');
      testCase.mutate(operations[testCase.operationIndex]!);
      expect(() => database.recordProcedureTree(record)).toThrow(
        'context-inconsistent procedure operation index row',
      );
      expect(database.listProcedureTrees(0, 10)).toEqual([]);
      database.close();
    }
  });

  it('fails closed for invalid extended shortcut surface lifecycle and associations', () => {
    const cases: Array<{
      name: string;
      mutate: (operations: Array<Record<string, unknown>>) => void;
    }> = [
      {
        name: 'property before opener',
        mutate(operations) {
          operations.splice(1, 0, operations.splice(2, 1)[0]!);
        },
      },
      {
        name: 'property outside the expected operator',
        mutate(operations) {
          const property = operations[2]!;
          property['target'] = { kind: 'control', hostId: 'mesh.primitive_cube_add.size' };
        },
      },
      {
        name: 'property with a non-control target',
        mutate(operations) {
          operations[2]!['target'] = {
            kind: 'menu_item',
            hostId: 'mesh.primitive_ico_sphere_add.subdivisions',
          };
        },
      },
      {
        name: 'property without a nonempty path',
        mutate(operations) {
          operations[2]!['path'] = [];
        },
      },
      {
        name: 'property with extra parameters',
        mutate(operations) {
          operations[2]!['parameters'] = { value: 3, unit: 'segments' };
        },
      },
      {
        name: 'property carrying an opener association',
        mutate(operations) {
          operations[2]!['opensSurface'] = structuredClone(operations[1]!['opensSurface']);
        },
      },
      {
        name: 'opener not adjacent in operation order',
        mutate(operations) {
          operations[0]!['order'] = 2;
          operations[1]!['order'] = 1;
        },
      },
      {
        name: 'opener associated with a non-adjacent source',
        mutate(operations) {
          (operations[1]!['opensSurface'] as Record<string, unknown>)['sourceOperationId'] =
            'shortcut.unrelated';
        },
      },
      {
        name: 'closer associated with another surface',
        mutate(operations) {
          operations[3]!['closesSurfaceOperationId'] = 'shortcut.other_surface';
        },
      },
      {
        name: 'opener also carrying a closer association',
        mutate(operations) {
          operations[1]!['closesSurfaceOperationId'] = 'shortcut.open_adjust_last';
        },
      },
      {
        name: 'surface without an explicit closer',
        mutate(operations) {
          operations.pop();
        },
      },
    ];

    for (const testCase of cases) {
      const database = openOperatingLineDatabase(':memory:');
      const record = extendedShortcutProcedureTreeRecord();
      const tree = record.tree as {
        nodes: Array<{
          kind: string;
          shortcutTracks?: Array<{ operations?: Array<Record<string, unknown>> }>;
        }>;
      };
      const operations = tree.nodes.find((node) => node.kind === 'leaf')?.shortcutTracks?.[0]
        ?.operations;
      if (operations === undefined) throw new Error('Expected extended shortcut operations');
      testCase.mutate(operations);

      expect(
        () => database.recordProcedureTree(record),
        `Expected ${testCase.name} to be rejected`,
      ).toThrow('context-inconsistent procedure operation index row');
      expect(database.listProcedureTrees(0, 10)).toEqual([]);
      database.close();
    }
  });

  it('enforces the public shortcut operation shape for procedure tree versions 1.0 and 1.1', () => {
    const legacyWithExtendedOperation = extendedShortcutProcedureTreeRecord();
    (legacyWithExtendedOperation.tree as { formatVersion: string }).formatVersion = '1.0.0';

    const unnormalizedExtended = extendedShortcutProcedureTreeRecord();
    const unnormalizedTree = unnormalizedExtended.tree as {
      nodes: Array<{
        kind: string;
        shortcutTracks?: Array<{ operations?: Array<Record<string, unknown>> }>;
      }>;
    };
    const unnormalizedOperations = unnormalizedTree.nodes.find((node) => node.kind === 'leaf')
      ?.shortcutTracks?.[0]?.operations;
    if (unnormalizedOperations === undefined)
      throw new Error('Expected extended shortcut operations');
    delete unnormalizedOperations[0]!['kind'];

    const extendedWithoutProperty = extendedShortcutProcedureTreeRecord();
    const noPropertyTree = extendedWithoutProperty.tree as typeof unnormalizedTree;
    const noPropertyTrack = noPropertyTree.nodes.find((node) => node.kind === 'leaf')
      ?.shortcutTracks?.[0];
    if (noPropertyTrack === undefined) throw new Error('Expected extended shortcut track');
    noPropertyTrack.operations = [noPropertyTrack.operations![0]!];

    for (const record of [
      legacyWithExtendedOperation,
      unnormalizedExtended,
      extendedWithoutProperty,
    ]) {
      const database = openOperatingLineDatabase(':memory:');
      expect(() => database.recordProcedureTree(record)).toThrow(
        'context-inconsistent procedure operation index row',
      );
      expect(database.listProcedureTrees(0, 10)).toEqual([]);
      database.close();
    }
  });

  it('atomically records a semantic revision request with its dialogue transition', () => {
    const database = openOperatingLineDatabase(':memory:');
    const revision = revisionRequest();
    const queued = companionDialogueRun(revision);

    expect(database.recordCompanionDialogueRun(queued)).toBe('accepted');
    expect(database.recordCompanionDialogueRun(queued)).toBe('duplicate');
    expect(database.recordGuideRevisionRequest(revision)).toBe('conflict');
    expect(database.listNonterminalCompanionDialogueRuns()).toEqual([queued]);
    const streaming = {
      ...queued,
      status: 'streaming',
      assistantMessage: 'Preparing a reviewable revision.',
      assistantMessageRevision: 1,
      updatedAt: '2026-08-12T12:00:01.000Z',
    };
    expect(database.transitionCompanionDialogueRun(streaming, ['queued'])).toBe(true);
    const replanning = {
      ...streaming,
      status: 'replanning',
      semanticDecision: { kind: 'replan', confidence: 0.94, threshold: 0.8 },
      revisionRequestRecorded: true,
      updatedAt: '2026-08-12T12:00:02.000Z',
    };
    expect(
      database.transitionCompanionDialogueRunWithRevisionRequest(replanning, revision, [
        'streaming',
      ]),
    ).toBe(true);
    expect(database.getGuideRevisionRequest(revision.requestId)).toEqual(revision);
    expect(database.recordGuideRevisionRequest(revision)).toBe('conflict');
    expect(database.getCompanionDialogueRun(queued.dialogueRequestId)).toEqual(replanning);
    expect(database.listNonterminalCompanionDialogueRuns()).toEqual([replanning]);
    database.close();
  });

  it('rejects non-append-only dialogue progress at the persistence boundary', () => {
    const database = openOperatingLineDatabase(':memory:');
    const queued = companionDialogueRun();
    expect(database.recordCompanionDialogueRun(queued)).toBe('accepted');
    const streaming = {
      ...queued,
      status: 'streaming',
      assistantMessage: 'First durable text',
      assistantMessageRevision: 1,
      updatedAt: '2026-08-12T12:00:01.000Z',
    };
    expect(database.transitionCompanionDialogueRun(streaming, ['queued'])).toBe(true);
    expect(
      database.transitionCompanionDialogueRun(
        {
          ...streaming,
          assistantMessage: 'Rewritten text',
          assistantMessageRevision: 2,
          updatedAt: '2026-08-12T12:00:02.000Z',
        },
        ['streaming'],
      ),
    ).toBe(false);
    expect(
      database.transitionCompanionDialogueRun(
        {
          ...streaming,
          assistantMessage: 'First durable text with a skipped revision',
          assistantMessageRevision: 3,
          updatedAt: '2026-08-12T12:00:03.000Z',
        },
        ['streaming'],
      ),
    ).toBe(false);
    expect(database.getCompanionDialogueRun(queued.dialogueRequestId)).toEqual(streaming);
    database.close();
  });

  it('permanently reserves an unrecorded dialogue candidate request id after termination', () => {
    const database = openOperatingLineDatabase(':memory:');
    const revision = revisionRequest();
    const queued = companionDialogueRun(revision);
    expect(database.recordCompanionDialogueRun(queued)).toBe('accepted');
    const answered = {
      ...queued,
      status: 'answered',
      terminal: true,
      assistantMessage: 'No revision is needed.',
      assistantMessageRevision: 1,
      semanticDecision: { kind: 'answer', replanConfidence: null, threshold: 0.8 },
      updatedAt: '2026-08-12T12:00:01.000Z',
    };

    expect(database.transitionCompanionDialogueRun(answered, ['queued'])).toBe(true);
    expect(database.recordGuideRevisionRequest(revision)).toBe('conflict');
    expect(database.getGuideRevisionRequest(revision.requestId)).toBeNull();
    expect(
      database.recordCompanionDialogueRun(
        companionDialogueRun(revision, {
          dialogueRequestId: randomUUID(),
          replanGenerationRequestId: randomUUID(),
        }),
      ),
    ).toBe('conflict');
    expect(
      database.recordCompanionDialogueRun(
        companionDialogueRun(revisionRequest(), {
          replanGenerationRequestId: queued.replanGenerationRequestId,
        }),
      ),
    ).toBe('conflict');
    database.close();
  });

  it('rejects dialogue transitions that mutate request, provider, or authorization evidence', () => {
    const database = openOperatingLineDatabase(':memory:');
    const revision = revisionRequest();
    const queued = companionDialogueRun(revision);
    expect(database.recordCompanionDialogueRun(queued)).toBe('accepted');

    const mutations = [
      {
        request: {
          ...queued.request,
          revisionRequest: { ...revision, message: 'Mutated after authorization.' },
        },
      },
      {
        provider: { ...queued.provider, version: '9.9.9' },
      },
      {
        request: {
          ...queued.request,
          authorization: {
            ...queued.request.authorization,
            authorizedProviderCallLimit: 3,
          },
        },
      },
    ];

    for (const mutation of mutations) {
      expect(
        database.transitionCompanionDialogueRun(
          {
            ...queued,
            ...mutation,
            status: 'streaming',
            updatedAt: '2026-08-12T12:00:01.000Z',
          },
          ['queued'],
        ),
      ).toBe(false);
    }
    expect(database.getCompanionDialogueRun(queued.dialogueRequestId)).toEqual(queued);
    database.close();
  });

  it('rolls back a dialogue replan transition when its candidate request changes', () => {
    const database = openOperatingLineDatabase(':memory:');
    const revision = revisionRequest();
    const queued = companionDialogueRun(revision);
    expect(database.recordCompanionDialogueRun(queued)).toBe('accepted');
    const replanning = {
      ...queued,
      status: 'replanning',
      semanticDecision: { kind: 'replan', confidence: 0.94, threshold: 0.8 },
      revisionRequestRecorded: true,
      updatedAt: '2026-08-12T12:00:02.000Z',
    };

    expect(
      database.transitionCompanionDialogueRunWithRevisionRequest(
        replanning,
        { ...revision, message: 'A different request.' },
        ['queued'],
      ),
    ).toBe(false);
    expect(database.getGuideRevisionRequest(revision.requestId)).toBeNull();
    expect(database.getCompanionDialogueRun(queued.dialogueRequestId)).toEqual(queued);
    database.close();
  });

  it('stores and compare-and-set transitions one authorized initial plan run per target', () => {
    const database = openOperatingLineDatabase(':memory:');
    const goal = goalRequest();
    const queued = companionInitialPlanRun(goal);
    expect(database.recordGuideGoalRequest(goal)).toBe('accepted');
    expect(database.recordCompanionInitialPlanRun(queued)).toBe('accepted');
    expect(database.recordCompanionInitialPlanRun(queued)).toBe('duplicate');
    expect(
      database.recordCompanionInitialPlanRun({
        ...queued,
        provider: { ...queued.provider, version: '9.9.9' },
      }),
    ).toBe('conflict');
    expect(database.listNonterminalCompanionInitialPlanRuns()).toEqual([queued]);

    const generating = {
      ...queued,
      status: 'generating',
      updatedAt: '2026-08-09T12:00:01.000Z',
    };
    expect(database.transitionCompanionInitialPlanRun(generating, ['queued'])).toBe(true);
    expect(database.transitionCompanionInitialPlanRun(generating, ['queued'])).toBe(false);
    expect(
      database.transitionCompanionInitialPlanRun({ ...generating, goalRequestId: randomUUID() }, [
        'generating',
      ]),
    ).toBe(false);
    const completed = {
      ...generating,
      status: 'proposal_created',
      terminal: true,
      proposalId: randomUUID(),
      updatedAt: '2026-08-09T12:00:02.000Z',
    };
    expect(database.transitionCompanionInitialPlanRun(completed, ['generating'])).toBe(true);
    expect(database.getCompanionInitialPlanRun(queued.generationRequestId)).toEqual(completed);
    expect(database.listNonterminalCompanionInitialPlanRuns()).toEqual([]);
    expect(
      database.listExecutionEventsByTypes([
        'companion.initial-plan-run.authorized',
        'companion.initial-plan-run.transitioned',
      ]),
    ).toMatchObject([
      { eventType: 'companion.initial-plan-run.authorized' },
      { eventType: 'companion.initial-plan-run.transitioned' },
      { eventType: 'companion.initial-plan-run.transitioned' },
    ]);
    database.close();
  });

  it('persists initial runs and exact generation-to-proposal provenance across restart', () => {
    const directory = mkdtempSync(join(tmpdir(), 'operatingline-initial-plan-run-store-'));
    const databasePath = join(directory, 'state.db');
    const goal = goalRequest({ adapterId: 'blender', catalogVersion: '1.0.0' });
    const queued = companionInitialPlanRun(goal);
    const proposal = {
      ...guideProposal(goal.planId),
      targetInstanceId: goal.instanceId,
      goalRequestId: goal.requestId,
      catalogVersion: goal.catalogVersion,
      planning: { goal: goal.goal, requiredPhaseIds: [] },
    };
    try {
      const first = openOperatingLineDatabase(databasePath);
      expect(first.recordGuideGoalRequest(goal)).toBe('accepted');
      expect(first.recordCompanionInitialPlanRun(queued)).toBe('accepted');
      expect(() => first.recordGuideGoalProposal(proposal, goal.requestId, randomUUID())).toThrow(
        'Unknown companion initial plan run',
      );
      first.recordGuideGoalProposal(proposal, goal.requestId, queued.generationRequestId);
      first.close();

      const restarted = openOperatingLineDatabase(databasePath);
      expect(restarted.getCompanionInitialPlanRun(queued.generationRequestId)).toEqual(queued);
      expect(restarted.listNonterminalCompanionInitialPlanRuns()).toEqual([queued]);
      expect(restarted.getGuideGoalProposalForGeneration(queued.generationRequestId)).toEqual(
        proposal,
      );
      expect(restarted.getGuideGoalProposalForGeneration(randomUUID())).toBeNull();
      expect(
        restarted.listExecutionEventsByTypes([
          'guide.goal.proposed',
          'planning.provider.generation.proposed',
        ]),
      ).toMatchObject([
        { eventType: 'guide.goal.proposed' },
        {
          id: `planning-generation-proposed:${queued.generationRequestId}`,
          eventType: 'planning.provider.generation.proposed',
          payload: {
            generationRequestId: queued.generationRequestId,
            goalRequestId: goal.requestId,
            proposalId: proposal.proposalId,
            occurredAt: expect.any(String),
          },
        },
      ]);
      restarted.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects initial runs without the exact pending goal or with unresolved target work', () => {
    const database = openOperatingLineDatabase(':memory:');
    const unknownGoal = goalRequest();
    expect(database.recordCompanionInitialPlanRun(companionInitialPlanRun(unknownGoal))).toBe(
      'conflict',
    );

    const goal = goalRequest({ adapterId: 'blender', catalogVersion: '1.0.0' });
    expect(database.recordGuideGoalRequest(goal)).toBe('accepted');
    const unresolved = {
      ...guideProposal('external-plan'),
      targetInstanceId: goal.instanceId,
    };
    database.recordGuideProposal(unresolved);
    expect(database.recordCompanionInitialPlanRun(companionInitialPlanRun(goal))).toBe('conflict');
    database.close();
  });

  it('stores one active companion replan run per host and transitions it with compare-and-set', () => {
    const database = openOperatingLineDatabase(':memory:');
    const queued = companionReplanRun();
    expect(
      database.recordGuideRevisionRequest({
        ...revisionRequest(queued.revisionRequestId),
        instanceId: queued.targetInstanceId,
      }),
    ).toBe('accepted');

    expect(database.recordCompanionReplanRun(queued)).toBe('accepted');
    expect(database.recordCompanionReplanRun(queued)).toBe('duplicate');
    expect(
      database.recordCompanionReplanRun({
        ...queued,
        provider: { ...queued.provider, version: '9.9.9' },
      }),
    ).toBe('conflict');
    expect(
      database.recordCompanionReplanRun(
        companionReplanRun({
          targetInstanceId: queued.targetInstanceId,
        }),
      ),
    ).toBe('conflict');
    expect(database.listNonterminalCompanionReplanRuns()).toEqual([queued]);

    const generating = {
      ...queued,
      status: 'generating',
      updatedAt: '2026-08-05T12:00:01.000Z',
    };
    expect(database.transitionCompanionReplanRun(generating, ['queued'])).toBe(true);
    expect(database.transitionCompanionReplanRun(generating, ['queued'])).toBe(false);
    const completed = {
      ...generating,
      status: 'proposal_created',
      terminal: true,
      proposalId: randomUUID(),
      updatedAt: '2026-08-05T12:00:02.000Z',
    };
    expect(database.transitionCompanionReplanRun(completed, ['generating'])).toBe(true);
    expect(database.getCompanionReplanRun(queued.generationRequestId)).toEqual(completed);
    expect(database.listNonterminalCompanionReplanRuns()).toEqual([]);
    expect(
      database.listExecutionEventsByTypes([
        'companion.replan-run.authorized',
        'companion.replan-run.transitioned',
      ]),
    ).toMatchObject([
      { eventType: 'companion.replan-run.authorized' },
      { eventType: 'companion.replan-run.transitioned' },
      { eventType: 'companion.replan-run.transitioned' },
    ]);
    database.close();
  });

  it('restores nonterminal companion replan runs with their exact authorization', () => {
    const directory = mkdtempSync(join(tmpdir(), 'operatingline-replan-run-store-'));
    const databasePath = join(directory, 'state.db');
    const queued = companionReplanRun();
    try {
      const first = openOperatingLineDatabase(databasePath);
      expect(
        first.recordGuideRevisionRequest({
          ...revisionRequest(queued.revisionRequestId),
          instanceId: queued.targetInstanceId,
        }),
      ).toBe('accepted');
      expect(first.recordCompanionReplanRun(queued)).toBe('accepted');
      first.close();

      const restarted = openOperatingLineDatabase(databasePath);
      expect(restarted.getCompanionReplanRun(queued.generationRequestId)).toEqual(queued);
      expect(restarted.listNonterminalCompanionReplanRuns()).toEqual([queued]);
      restarted.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('atomically reserves one goal or replan work slot per instance in both creation orders', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'operatingline-instance-work-slot-'));
    const databasePath = join(directory, 'state.db');
    const first = openOperatingLineDatabase(databasePath);
    const second = openOperatingLineDatabase(databasePath);
    try {
      const goalFirst = goalRequest();
      const blockedRun = companionReplanRun({
        targetAdapterId: goalFirst.adapterId,
        targetInstanceId: goalFirst.instanceId,
      });
      expect(first.recordGuideGoalRequest(goalFirst)).toBe('accepted');
      expect(second.recordCompanionReplanRun(blockedRun)).toBe('conflict');

      const runFirst = companionReplanRun({ targetAdapterId: 'canvas' });
      expect(
        first.recordGuideRevisionRequest({
          ...revisionRequest(runFirst.revisionRequestId),
          adapterId: runFirst.targetAdapterId,
          instanceId: runFirst.targetInstanceId,
        }),
      ).toBe('accepted');
      expect(second.recordCompanionReplanRun(runFirst)).toBe('accepted');
      expect(
        first.recordGuideGoalRequest(
          goalRequest({
            instanceId: runFirst.targetInstanceId,
            planId: 'blocked-by-replan',
          }),
        ),
      ).toBe('conflict');

      expect(first.listPendingGuideGoalRequests('canvas', 20)).toEqual([goalFirst]);
      expect(second.listNonterminalCompanionReplanRuns()).toEqual([runFirst]);

      const racingGoal = goalRequest({ instanceId: randomUUID(), planId: 'racing-work-slot' });
      const racingRun = companionReplanRun({
        targetAdapterId: racingGoal.adapterId,
        targetInstanceId: racingGoal.instanceId,
      });
      expect(
        first.recordGuideRevisionRequest({
          ...revisionRequest(racingRun.revisionRequestId),
          adapterId: racingRun.targetAdapterId,
          instanceId: racingRun.targetInstanceId,
        }),
      ).toBe('accepted');
      const raceResults = await Promise.all([
        recordWorkSlotFromWorker(databasePath, 'goal', racingGoal),
        recordWorkSlotFromWorker(databasePath, 'replan', racingRun),
      ]);
      expect(raceResults.sort()).toEqual(['accepted', 'conflict']);
      expect(
        Number(first.getGuideGoalRequest(racingGoal.requestId) !== null) +
          Number(first.getCompanionReplanRun(racingRun.generationRequestId) !== null),
      ).toBe(1);
    } finally {
      first.close();
      second.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('stores append-only execution events', () => {
    const database = openOperatingLineDatabase(':memory:');
    const firstId = randomUUID();
    database.appendEvent({
      id: firstId,
      eventType: 'runtime.started',
      payload: { adapter: 'fake-blender' },
      createdAt: '2026-08-04T00:00:00.000Z',
    });
    database.appendEvent({
      id: randomUUID(),
      eventType: 'guide.plan.published',
      payload: { plan: { revision: 1, id: 'snowman' } },
      createdAt: '2026-08-04T00:00:01.000Z',
    });

    expect(database.countEvents()).toBe(2);
    expect(database.listExecutionEvents(0, 1)).toEqual([
      {
        sequence: 1,
        id: firstId,
        eventType: 'runtime.started',
        payload: { adapter: 'fake-blender' },
        createdAt: '2026-08-04T00:00:00.000Z',
      },
    ]);
    expect(database.listExecutionEvents(1, 10)).toMatchObject([
      {
        sequence: 2,
        eventType: 'guide.plan.published',
        payload: { plan: { id: 'snowman', revision: 1 } },
      },
    ]);
    expect(database.listExecutionEventsByTypes(['guide.plan.published'])).toMatchObject([
      {
        sequence: 2,
        eventType: 'guide.plan.published',
        payload: { plan: { id: 'snowman', revision: 1 } },
      },
    ]);
    expect(() => database.listExecutionEventsByTypes([])).toThrow('between 1 and 100');
    expect(() => database.listExecutionEventsByTypes(['same', 'same'])).toThrow(
      'nonempty and unique',
    );
    expect(() => database.listExecutionEvents(-1, 1)).toThrow('non-negative');
    expect(() => database.listExecutionEvents(0, 10_001)).toThrow('between 1 and 10000');
    database.close();
  });

  it('records companion reports idempotently and keeps only the highest sequence current', () => {
    const database = openOperatingLineDatabase(':memory:');
    const instanceId = randomUUID();
    const first = {
      reportId: randomUUID(),
      adapterId: 'blender',
      instanceId,
      sequence: 1,
      phase: 'idle',
    };
    const stale = { ...first, reportId: randomUUID(), phase: 'error' };
    const second = { ...first, reportId: randomUUID(), sequence: 2, phase: 'ready' };
    const reusedReportId = { ...first, phase: 'error' };

    expect(database.recordCompanionState(first)).toBe('accepted');
    expect(database.recordCompanionState(first)).toBe('duplicate');
    expect(database.recordCompanionState(reusedReportId)).toBe('conflict');
    expect(database.recordCompanionState(stale)).toBe('stale');
    expect(database.recordCompanionState(second)).toBe('accepted');
    expect(database.recordCompanionState(first)).toBe('duplicate');
    expect(database.listLatestCompanionStates()).toEqual([second]);
    expect(database.countEvents()).toBe(2);
    database.close();
  });

  it('persists the latest proposal and isolates human decisions per companion instance', () => {
    const database = openOperatingLineDatabase(':memory:');
    const firstInstance = randomUUID();
    const secondInstance = randomUUID();
    const first = guideProposal('snowman', 1);
    const latest = guideProposal('snowman', 2);

    database.recordGuideProposal(first);
    database.recordGuideProposal(latest);
    expect(database.listLatestGuidePlanRevisions()).toEqual([{ planId: 'snowman', revision: 2 }]);
    expect(database.getPendingGuideProposal('blender', firstInstance)).toEqual(latest);
    expect(database.getPendingGuideProposal('maya', firstInstance)).toBeNull();

    const accepted = proposalDecision(latest.proposalId, firstInstance);
    expect(database.recordGuideProposalDecision(accepted)).toBe('accepted');
    expect(database.recordGuideProposalDecision(accepted)).toBe('duplicate');
    expect(database.getPendingGuideProposal('blender', firstInstance)).toEqual(first);
    expect(database.getPendingGuideProposal('blender', secondInstance)).toEqual(latest);

    expect(
      database.recordGuideProposalDecision({
        ...accepted,
        decisionId: randomUUID(),
        decision: 'rejected',
      }),
    ).toBe('conflict');
    expect(
      database.recordGuideProposalDecision(
        proposalDecision(randomUUID(), firstInstance, 'rejected'),
      ),
    ).toBe('unknown');
    expect(database.countEvents()).toBe(3);
    database.close();
  });

  it('atomically prevents a second unresolved proposal for the same companion target', () => {
    const database = openOperatingLineDatabase(':memory:');
    const instanceId = randomUUID();
    const otherInstanceId = randomUUID();
    const first = { ...guideProposal('snowman', 1), targetInstanceId: instanceId };

    database.recordGuideProposal(first);
    expect(() =>
      database.recordGuideProposal({
        ...guideProposal('snowman', 2),
        targetInstanceId: instanceId,
      }),
    ).toThrow('already has an unresolved proposal');
    expect(() => database.recordGuideProposal(guideProposal('snowman', 3))).toThrow(
      'already has an unresolved proposal',
    );
    expect(() =>
      database.recordGuideProposal({
        ...guideProposal('snowman', 4),
        targetInstanceId: otherInstanceId,
      }),
    ).not.toThrow();

    expect(
      database.recordGuideProposalDecision(proposalDecision(first.proposalId, instanceId)),
    ).toBe('accepted');
    expect(() =>
      database.recordGuideProposal({
        ...guideProposal('snowman', 5),
        targetInstanceId: instanceId,
      }),
    ).not.toThrow();
    database.close();
  });

  it('delivers a request-linked proposal only to its target companion instance', () => {
    const database = openOperatingLineDatabase(':memory:');
    const targetInstanceId = randomUUID();
    const otherInstanceId = randomUUID();
    const scoped = {
      ...guideProposal('snowman-revision', 4),
      targetInstanceId,
    };

    database.recordGuideProposal(scoped);

    expect(database.getPendingGuideProposal('blender', targetInstanceId)).toEqual(scoped);
    expect(database.getPendingGuideProposal('blender', otherInstanceId)).toBeNull();
    database.close();
  });

  it('restores pending proposals and revision watermarks after restart', () => {
    const directory = mkdtempSync(join(tmpdir(), 'operatingline-proposal-test-'));
    const databasePath = join(directory, 'state.db');
    const proposal = guideProposal('persistent-plan', 4);
    const instanceId = randomUUID();
    try {
      const initial = openOperatingLineDatabase(databasePath);
      initial.recordGuideProposal(proposal);
      initial.close();

      const reopened = openOperatingLineDatabase(databasePath);
      expect(reopened.getPendingGuideProposal('blender', instanceId)).toEqual(proposal);
      expect(reopened.listLatestGuidePlanRevisions()).toEqual([
        { planId: 'persistent-plan', revision: 4 },
      ]);
      reopened.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('stores revision requests idempotently and atomically links a replan proposal', () => {
    const database = openOperatingLineDatabase(':memory:');
    const request = revisionRequest();
    const otherAdapter = {
      ...revisionRequest(),
      adapterId: 'gimp',
      occurredAt: '2099-01-01T00:00:00.000Z',
    };

    expect(database.recordGuideRevisionRequest(request)).toBe('accepted');
    expect(database.recordGuideRevisionRequest(request)).toBe('duplicate');
    expect(database.recordGuideRevisionRequest({ ...request, message: 'Conflicting reuse' })).toBe(
      'conflict',
    );
    expect(database.recordGuideRevisionRequest(otherAdapter)).toBe('accepted');
    expect(database.getGuideRevisionRequest(request.requestId)).toEqual(request);
    expect(database.listPendingGuideRevisionRequests('blender', 20)).toEqual([request]);
    expect(database.listPendingGuideRevisionRequests(undefined, 1)).toEqual([request]);

    const proposal = guideProposal('snowman', 4);
    const generationRequestId = randomUUID();
    database.recordGuideReplanProposal(proposal, request.requestId, generationRequestId);
    expect(database.listPendingGuideRevisionRequests('blender', 20)).toEqual([]);
    expect(database.listPendingGuideRevisionRequests('gimp', 20)).toEqual([otherAdapter]);
    expect(database.getPendingGuideProposal('blender', randomUUID())).toEqual(proposal);
    expect(() =>
      database.recordGuideReplanProposal(guideProposal('snowman', 5), request.requestId),
    ).toThrow('already has a proposal');
    expect(() =>
      database.recordGuideReplanProposal(guideProposal('unknown', 1), randomUUID()),
    ).toThrow('Unknown guide revision request');
    expect(
      database.listExecutionEventsByTypes(['planning.provider.replan.proposed']),
    ).toMatchObject([
      {
        eventType: 'planning.provider.replan.proposed',
        payload: {
          generationRequestId,
          revisionRequestId: request.requestId,
          proposalId: proposal.proposalId,
        },
      },
    ]);
    expect(
      database.getExecutionEvent(`planning-replan-proposed:${generationRequestId}`),
    ).toMatchObject({
      eventType: 'planning.provider.replan.proposed',
      payload: { generationRequestId, revisionRequestId: request.requestId },
    });
    expect(database.getExecutionEvent('missing-event')).toBeNull();
    expect(database.countEvents()).toBe(5);
    database.close();
  });

  it('stores one pending goal request per instance and atomically links its targeted proposal', () => {
    const database = openOperatingLineDatabase(':memory:');
    const request = goalRequest();
    const otherRequest = goalRequest({
      instanceId: randomUUID(),
      planId: 'other-diagram',
      occurredAt: '2026-08-09T10:00:01.000Z',
    });

    expect(database.recordGuideGoalRequest(request)).toBe('accepted');
    expect(database.recordGuideGoalRequest(request)).toBe('duplicate');
    expect(database.recordGuideGoalRequest({ ...request, goal: 'Conflicting reuse.' })).toBe(
      'conflict',
    );
    expect(
      database.recordGuideGoalRequest(
        goalRequest({ instanceId: request.instanceId, planId: 'racing-plan' }),
      ),
    ).toBe('conflict');
    expect(database.recordGuideGoalRequest(otherRequest)).toBe('accepted');
    expect(database.getGuideGoalRequest(request.requestId)).toEqual(request);
    expect(database.listPendingGuideGoalRequests('canvas', 20)).toEqual([request, otherRequest]);

    const proposal = {
      ...guideProposal(request.planId, 1),
      targetAdapterId: request.adapterId,
      targetInstanceId: request.instanceId,
      goalRequestId: request.requestId,
      catalogVersion: request.catalogVersion,
    };
    database.recordGuideGoalProposal(proposal, request.requestId);
    expect(database.getGuideGoalProposalForRequest(request.requestId)).toEqual(proposal);
    expect(database.listPendingGuideGoalRequests('canvas', 20)).toEqual([otherRequest]);
    expect(database.getPendingGuideProposal('canvas', request.instanceId)).toEqual(proposal);
    expect(database.getPendingGuideProposal('canvas', otherRequest.instanceId)).toBeNull();
    expect(() =>
      database.recordGuideGoalProposal(
        {
          ...guideProposal(request.planId, 2),
          targetAdapterId: request.adapterId,
          targetInstanceId: request.instanceId,
          goalRequestId: request.requestId,
          catalogVersion: request.catalogVersion,
        },
        request.requestId,
      ),
    ).toThrow('already has a proposal');
    expect(
      database.recordGuideGoalRequest(
        goalRequest({ instanceId: request.instanceId, planId: 'blocked-by-review' }),
      ),
    ).toBe('conflict');
    expect(
      database.listExecutionEventsByTypes(['guide.goal.requested', 'guide.goal.proposed']),
    ).toMatchObject([
      { eventType: 'guide.goal.requested', payload: request },
      { eventType: 'guide.goal.requested', payload: otherRequest },
      {
        eventType: 'guide.goal.proposed',
        payload: { requestId: request.requestId, proposalId: proposal.proposalId },
      },
    ]);
    database.close();
  });

  it('rolls back a generated replan proposal when provenance evidence cannot be written', () => {
    const database = openOperatingLineDatabase(':memory:');
    const request = revisionRequest();
    const proposal = guideProposal('snowman', 4);
    const generationRequestId = randomUUID();
    expect(database.recordGuideRevisionRequest(request)).toBe('accepted');
    database.appendEvent({
      id: `planning-replan-proposed:${generationRequestId}`,
      eventType: 'test.provenance.conflict',
      payload: {},
    });

    expect(() =>
      database.recordGuideReplanProposal(proposal, request.requestId, generationRequestId),
    ).toThrow();

    expect(database.getGuideReplanProposalForRequest(request.requestId)).toBeNull();
    expect(database.listPendingGuideRevisionRequests('blender', 20)).toEqual([request]);
    expect(database.listLatestGuidePlanRevisions()).toEqual([]);
    database.close();
  });

  it('queries linear revision thread heads and their linked proposal payloads', () => {
    const database = openOperatingLineDatabase(':memory:');
    const firstRequest = revisionRequest();
    const firstThreadRequest = {
      ...firstRequest,
      revisionThread: {
        threadId: firstRequest.requestId,
        turn: 1,
        parentRequestId: null,
      },
    };
    const firstProposal = guideProposal('snowman', 4);

    expect(database.recordGuideRevisionRequest(firstThreadRequest)).toBe('accepted');
    expect(database.getGuideRevisionThreadHead(firstRequest.requestId)).toEqual(firstThreadRequest);
    expect(database.getGuideReplanProposalForRequest(firstRequest.requestId)).toBeNull();
    database.recordGuideReplanProposal(firstProposal, firstRequest.requestId);
    expect(database.getGuideReplanProposalForRequest(firstRequest.requestId)).toEqual(
      firstProposal,
    );
    const firstDecision = proposalDecision(firstProposal.proposalId, firstThreadRequest.instanceId);
    expect(database.recordGuideProposalDecision(firstDecision)).toBe('accepted');
    expect(
      database.getGuideProposalDecision(
        firstProposal.proposalId,
        'blender',
        firstThreadRequest.instanceId,
      ),
    ).toEqual(firstDecision);

    const secondRequest = revisionRequest();
    const secondThreadRequest = {
      ...secondRequest,
      instanceId: firstThreadRequest.instanceId,
      basePlan: { id: 'snowman', revision: 4 },
      revisionThread: {
        threadId: firstRequest.requestId,
        turn: 2,
        parentRequestId: firstRequest.requestId,
      },
    };
    expect(database.recordGuideRevisionRequest(secondThreadRequest)).toBe('accepted');
    expect(database.getGuideRevisionThreadHead(firstRequest.requestId)).toEqual(
      secondThreadRequest,
    );
    expect(
      database.listGuideRevisionThreadTurns(
        firstRequest.requestId,
        'blender',
        firstThreadRequest.instanceId,
        null,
        20,
      ),
    ).toEqual([
      { request: secondThreadRequest, proposal: null, decision: null },
      { request: firstThreadRequest, proposal: firstProposal, decision: firstDecision },
    ]);
    expect(
      database.listGuideRevisionThreadTurns(
        firstRequest.requestId,
        'blender',
        firstThreadRequest.instanceId,
        2,
        20,
      ),
    ).toEqual([{ request: firstThreadRequest, proposal: firstProposal, decision: firstDecision }]);
    expect(
      database.listGuideRevisionThreadTurns(
        firstRequest.requestId,
        'gimp',
        firstThreadRequest.instanceId,
        null,
        20,
      ),
    ).toEqual([]);
    expect(() =>
      database.listGuideRevisionThreadTurns(
        firstRequest.requestId,
        'blender',
        firstThreadRequest.instanceId,
        0,
        20,
      ),
    ).toThrow('positive safe integer');
    expect(() =>
      database.recordGuideRevisionRequest({
        ...revisionRequest(),
        instanceId: firstThreadRequest.instanceId,
        revisionThread: {
          threadId: firstRequest.requestId,
          turn: 2,
          parentRequestId: firstRequest.requestId,
        },
      }),
    ).toThrow('UNIQUE constraint failed');
    database.close();
  });

  it('persists append-only companion reports and latest state across restart', () => {
    const directory = mkdtempSync(join(tmpdir(), 'operatingline-persistence-test-'));
    const databasePath = join(directory, 'state.db');
    const instanceId = randomUUID();
    const first = {
      reportId: randomUUID(),
      adapterId: 'blender',
      instanceId,
      sequence: 1,
      phase: 'idle',
    };
    const second = { ...first, reportId: randomUUID(), sequence: 2, phase: 'ready' };
    try {
      const initial = openOperatingLineDatabase(databasePath);
      expect(initial.recordCompanionState(first)).toBe('accepted');
      expect(initial.recordCompanionState(second)).toBe('accepted');
      initial.close();

      const reopened = openOperatingLineDatabase(databasePath);
      expect(reopened.listLatestCompanionStates()).toEqual([second]);
      expect(reopened.listExecutionEvents(0, 10).map((event) => event.sequence)).toEqual([1, 2]);
      expect(reopened.recordCompanionState(second)).toBe('duplicate');
      const third = { ...second, reportId: randomUUID(), sequence: 3 };
      expect(reopened.recordCompanionState(third)).toBe('accepted');
      expect(reopened.listExecutionEvents(2, 10).map((event) => event.sequence)).toEqual([3]);
      reopened.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('tracks latest sequence independently for each adapter and instance pair', () => {
    const database = openOperatingLineDatabase(':memory:');
    const instanceId = randomUUID();
    const blender = {
      reportId: randomUUID(),
      adapterId: 'blender',
      instanceId,
      sequence: 1,
    };
    const maya = { ...blender, reportId: randomUUID(), adapterId: 'maya' };

    expect(database.recordCompanionState(blender)).toBe('accepted');
    expect(database.recordCompanionState(maya)).toBe('accepted');
    expect(database.listLatestCompanionStates()).toEqual([blender, maya]);
    database.close();
  });

  it('upgrades a real version-1 database schema', () => {
    const directory = mkdtempSync(join(tmpdir(), 'operatingline-v1-upgrade-test-'));
    const databasePath = join(directory, 'state.db');
    try {
      const versionOne = new DatabaseSync(databasePath);
      versionOne.exec(`
        CREATE TABLE schema_migrations (
          version INTEGER PRIMARY KEY,
          applied_at TEXT NOT NULL
        );
        CREATE TABLE execution_events (
          id TEXT PRIMARY KEY,
          event_type TEXT NOT NULL,
          payload TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        INSERT INTO schema_migrations (version, applied_at) VALUES (1, datetime('now'));
        INSERT INTO execution_events (id, event_type, payload, created_at)
        VALUES (
          'legacy-event',
          'legacy.recorded',
          '{"planId":"legacy-plan"}',
          '2026-08-03T00:00:00.000Z'
        );
      `);
      versionOne.close();

      const upgraded = openOperatingLineDatabase(databasePath);
      const report = {
        reportId: randomUUID(),
        adapterId: 'blender',
        instanceId: randomUUID(),
        sequence: 1,
        occurredAt: '2000-01-01T00:00:00Z',
      };
      expect(upgraded.recordCompanionState(report)).toBe('accepted');
      expect(upgraded.listExecutionEvents(0, 10)).toMatchObject([
        {
          sequence: 1,
          id: 'legacy-event',
          eventType: 'legacy.recorded',
          payload: { planId: 'legacy-plan' },
        },
        { sequence: 2, eventType: 'companion.state.reported' },
      ]);
      upgraded.close();

      const inspected = new DatabaseSync(databasePath);
      expect(inspected.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get()).toEqual({
        count: 17,
      });
      expect(
        inspected.prepare("PRAGMA table_list('procedure_leaf_replay_attestation_reports')").get(),
      ).toMatchObject({ name: 'procedure_leaf_replay_attestation_reports', strict: 1 });
      expect(
        inspected
          .prepare(
            `SELECT name FROM sqlite_master
             WHERE type = 'index' AND name = 'execution_events_type_sequence'`,
          )
          .get(),
      ).toEqual({ name: 'execution_events_type_sequence' });
      expect(
        inspected
          .prepare("SELECT name FROM pragma_table_info('execution_events') ORDER BY cid")
          .all(),
      ).toContainEqual({ name: 'sequence' });
      const event = inspected
        .prepare(
          `SELECT payload, created_at FROM execution_events
           WHERE event_type = 'companion.state.reported'`,
        )
        .get() as { payload: string; created_at: string };
      expect(JSON.parse(event.payload)).toMatchObject({ occurredAt: report.occurredAt });
      expect(event.created_at).not.toBe(report.occurredAt);
      inspected.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rolls back report and latest state when execution event insertion fails', () => {
    const directory = mkdtempSync(join(tmpdir(), 'operatingline-state-rollback-test-'));
    const databasePath = join(directory, 'state.db');
    try {
      openOperatingLineDatabase(databasePath).close();
      const injected = new DatabaseSync(databasePath);
      injected.exec(`
        CREATE TRIGGER fail_companion_event
        BEFORE INSERT ON execution_events
        WHEN NEW.event_type = 'companion.state.reported'
        BEGIN
          SELECT RAISE(FAIL, 'injected companion event failure');
        END;
      `);
      injected.close();

      const database = openOperatingLineDatabase(databasePath);
      expect(() =>
        database.recordCompanionState({
          reportId: randomUUID(),
          adapterId: 'blender',
          instanceId: randomUUID(),
          sequence: 1,
        }),
      ).toThrow('injected companion event failure');
      expect(database.listLatestCompanionStates()).toEqual([]);
      expect(database.countEvents()).toBe(0);
      database.close();

      const inspected = new DatabaseSync(databasePath);
      expect(
        inspected.prepare('SELECT COUNT(*) AS count FROM companion_state_reports').get(),
      ).toEqual({ count: 0 });
      inspected.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rolls back a procedure revision when its audit event cannot be appended', () => {
    const directory = mkdtempSync(join(tmpdir(), 'operatingline-procedure-rollback-test-'));
    const databasePath = join(directory, 'state.db');
    try {
      openOperatingLineDatabase(databasePath).close();
      const injected = new DatabaseSync(databasePath);
      injected.exec(`
        CREATE TRIGGER fail_procedure_event
        BEFORE INSERT ON execution_events
        WHEN NEW.event_type = 'procedure.tree.stored'
        BEGIN
          SELECT RAISE(FAIL, 'injected procedure event failure');
        END;
      `);
      injected.close();

      const database = openOperatingLineDatabase(databasePath);
      expect(() => database.recordProcedureTree(procedureTreeRecord())).toThrow(
        'injected procedure event failure',
      );
      expect(database.listProcedureTrees(0, 10)).toEqual([]);
      expect(
        database.searchProcedureOperations({
          afterSequence: 0,
          limit: 10,
          treeId: 'snowman.eye.procedure',
        }),
      ).toEqual([]);
      expect(database.countEvents()).toBe(0);
      database.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rolls back a proposal when its audit event cannot be appended', () => {
    const directory = mkdtempSync(join(tmpdir(), 'operatingline-proposal-rollback-test-'));
    const databasePath = join(directory, 'state.db');
    try {
      openOperatingLineDatabase(databasePath).close();
      const injected = new DatabaseSync(databasePath);
      injected.exec(`
        CREATE TRIGGER fail_proposal_event
        BEFORE INSERT ON execution_events
        WHEN NEW.event_type = 'guide.proposal.created'
        BEGIN
          SELECT RAISE(FAIL, 'injected proposal event failure');
        END;
      `);
      injected.close();

      const database = openOperatingLineDatabase(databasePath);
      expect(() => database.recordGuideProposal(guideProposal())).toThrow(
        'injected proposal event failure',
      );
      expect(database.getPendingGuideProposal('blender', randomUUID())).toBeNull();
      expect(database.listLatestGuidePlanRevisions()).toEqual([]);
      expect(database.countEvents()).toBe(0);
      database.close();

      const inspected = new DatabaseSync(databasePath);
      expect(inspected.prepare('SELECT COUNT(*) AS count FROM guide_proposals').get()).toEqual({
        count: 0,
      });
      inspected.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('stores leaf replay bindings and attestations append-only across reopen', () => {
    const directory = mkdtempSync(join(tmpdir(), 'operatingline-leaf-replay-test-'));
    const databasePath = join(directory, 'state.db');
    try {
      const proposal = guideProposal('snowman-replay', 1);
      const replay = procedureLeafReplay(proposal.proposalId);
      const attestation = procedureLeafReplayAttestation(replay.replayId);
      const failureReportId = randomUUID();
      const attestationWithEvidence = {
        ...attestation,
        evidenceReportIds: [failureReportId, attestation.reportId],
      };
      const report = {
        reportId: attestation.reportId,
        adapterId: replay.adapterId,
        instanceId: replay.instanceId,
        sequence: 1,
        occurredAt: attestation.attestedAt,
      };
      const first = openOperatingLineDatabase(databasePath);
      expect(first.recordProcedureLeafReplayProposal(proposal, replay)).toBe('accepted');
      expect(first.recordProcedureLeafReplayProposal(proposal, replay)).toBe('duplicate');
      expect(first.recordCompanionState(report)).toBe('accepted');
      expect(
        first.recordCompanionState({ ...report, reportId: failureReportId, sequence: 2 }),
      ).toBe('accepted');
      expect(first.recordProcedureLeafReplayAttestation(attestationWithEvidence)).toBe('accepted');
      expect(first.recordProcedureLeafReplayAttestation(attestationWithEvidence)).toBe('duplicate');
      expect(first.getGuideProposal(proposal.proposalId)).toEqual(proposal);
      expect(first.getCompanionStateReport(report.reportId)).toEqual(report);
      expect(first.getProcedureLeafReplay(replay.replayId)).toEqual(replay.payload);
      expect(first.getProcedureLeafReplayAttestation(replay.replayId)).toEqual(attestation.payload);
      expect(
        first.listExecutionEventsByTypes([
          'procedure.leaf-replay.proposed',
          'procedure.leaf-replay.attested',
        ]),
      ).toMatchObject([
        { eventType: 'procedure.leaf-replay.proposed', payload: replay.payload },
        { eventType: 'procedure.leaf-replay.attested', payload: attestation.payload },
      ]);
      first.close();

      const reopened = openOperatingLineDatabase(databasePath);
      expect(reopened.recordProcedureLeafReplayProposal(proposal, replay)).toBe('duplicate');
      expect(reopened.recordProcedureLeafReplayAttestation(attestationWithEvidence)).toBe(
        'duplicate',
      );
      expect(reopened.getProcedureLeafReplay(replay.replayId)).toEqual(replay.payload);
      expect(reopened.getProcedureLeafReplayAttestation(replay.replayId)).toEqual(
        attestation.payload,
      );
      reopened.close();

      const inspected = new DatabaseSync(databasePath);
      expect(
        inspected.prepare('SELECT 1 AS applied FROM schema_migrations WHERE version = 15').get(),
      ).toEqual({ applied: 1 });
      expect(
        inspected.prepare('SELECT 1 AS applied FROM schema_migrations WHERE version = 17').get(),
      ).toEqual({ applied: 1 });
      expect(
        inspected.prepare('SELECT COUNT(*) AS count FROM procedure_leaf_replays').get(),
      ).toEqual({ count: 1 });
      expect(
        inspected.prepare('SELECT COUNT(*) AS count FROM procedure_leaf_replay_attestations').get(),
      ).toEqual({ count: 1 });
      expect(
        inspected
          .prepare('SELECT COUNT(*) AS count FROM procedure_leaf_replay_attestation_reports')
          .get(),
      ).toEqual({ count: 2 });
      expect(inspected.prepare("PRAGMA foreign_key_list('procedure_leaf_replays')").all()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            table: 'guide_proposals',
            from: 'proposal_id',
            to: 'proposal_id',
          }),
        ]),
      );
      expect(
        inspected.prepare("PRAGMA foreign_key_list('procedure_leaf_replay_attestations')").all(),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            table: 'procedure_leaf_replays',
            from: 'replay_id',
            to: 'replay_id',
          }),
          expect.objectContaining({
            table: 'companion_state_reports',
            from: 'report_id',
            to: 'report_id',
          }),
        ]),
      );
      inspected.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects replay and attestation identity conflicts without appending events', () => {
    const database = openOperatingLineDatabase(':memory:');
    const proposal = guideProposal('snowman-replay-conflicts', 1);
    const replay = procedureLeafReplay(proposal.proposalId);
    const attestation = procedureLeafReplayAttestation(replay.replayId);
    expect(database.recordProcedureLeafReplayProposal(proposal, replay)).toBe('accepted');
    expect(database.recordProcedureLeafReplayProposal(proposal, replay)).toBe('duplicate');
    expect(
      database.recordProcedureLeafReplayProposal(proposal, {
        ...replay,
        payload: { ...replay.payload, operationIds: ['different'] },
      }),
    ).toBe('conflict');
    expect(
      database.recordProcedureLeafReplayProposal(proposal, {
        ...replay,
        replayId: randomUUID(),
      }),
    ).toBe('conflict');
    expect(() => database.recordProcedureLeafReplayAttestation(attestation)).toThrow(
      'FOREIGN KEY constraint failed',
    );
    expect(database.getProcedureLeafReplayAttestation(replay.replayId)).toBeNull();
    expect(
      database.recordCompanionState({
        reportId: attestation.reportId,
        adapterId: replay.adapterId,
        instanceId: replay.instanceId,
        sequence: 1,
      }),
    ).toBe('accepted');
    expect(database.recordProcedureLeafReplayAttestation(attestation)).toBe('accepted');
    const secondProposal = guideProposal('snowman-replay-conflicts-second', 1);
    const secondReplay = procedureLeafReplay(secondProposal.proposalId);
    const secondAttestation = procedureLeafReplayAttestation(secondReplay.replayId);
    expect(database.recordProcedureLeafReplayProposal(secondProposal, secondReplay)).toBe(
      'accepted',
    );
    expect(
      database.recordCompanionState({
        reportId: secondAttestation.reportId,
        adapterId: secondReplay.adapterId,
        instanceId: secondReplay.instanceId,
        sequence: 1,
      }),
    ).toBe('accepted');
    expect(
      database.recordProcedureLeafReplayAttestation({
        ...secondAttestation,
        evidenceReportIds: [attestation.reportId, secondAttestation.reportId],
      }),
    ).toBe('conflict');
    const eventCount = database.countEvents();
    expect(
      database.recordProcedureLeafReplayAttestation({
        ...attestation,
        contentSha256: 'c'.repeat(64),
      }),
    ).toBe('conflict');
    expect(
      database.recordProcedureLeafReplayAttestation({
        ...attestation,
        attestationId: randomUUID(),
      }),
    ).toBe('conflict');
    expect(() =>
      database.recordProcedureLeafReplayAttestation(procedureLeafReplayAttestation(randomUUID())),
    ).toThrow('Unknown procedure leaf replay');
    expect(database.getProcedureLeafReplay(randomUUID())).toBeNull();
    expect(database.getProcedureLeafReplayAttestation(randomUUID())).toBeNull();
    expect(database.countEvents()).toBe(eventCount);
    database.close();
  });

  it('rolls back atomic proposal creation when its replay sidecar conflicts', () => {
    const database = openOperatingLineDatabase(':memory:');
    const existingProposal = guideProposal('existing-replay-plan', 1);
    const existingReplay = procedureLeafReplay(existingProposal.proposalId);
    expect(database.recordProcedureLeafReplayProposal(existingProposal, existingReplay)).toBe(
      'accepted',
    );
    const conflictingProposal = guideProposal('rolled-back-replay-plan', 1);
    const conflictingReplay = procedureLeafReplay(conflictingProposal.proposalId, {
      replayId: existingReplay.replayId,
    });
    const eventCount = database.countEvents();
    expect(database.recordProcedureLeafReplayProposal(conflictingProposal, conflictingReplay)).toBe(
      'conflict',
    );
    expect(database.getGuideProposal(conflictingProposal.proposalId)).toBeNull();
    expect(database.getProcedureLeafReplay(existingReplay.replayId)).toEqual(
      existingReplay.payload,
    );
    expect(database.countEvents()).toBe(eventCount);
    database.close();
  });

  it('stores append-ordered managed replay trust receipts across reopen', () => {
    const directory = mkdtempSync(join(tmpdir(), 'operatingline-managed-replay-receipts-test-'));
    const databasePath = join(directory, 'state.db');
    try {
      const fingerprint = 'c'.repeat(64);
      const proposal = guideProposal('trusted-replay-plan', 1);
      const replay = procedureLeafReplay(proposal.proposalId);
      const decision = proposalDecision(proposal.proposalId, replay.instanceId);
      const report = {
        reportId: randomUUID(),
        adapterId: replay.adapterId,
        instanceId: replay.instanceId,
        sequence: 1,
        occurredAt: '2026-08-17T08:02:00.000Z',
      };
      const first = openOperatingLineDatabase(databasePath);
      expect(first.recordProcedureLeafReplayProposal(proposal, replay)).toBe('accepted');
      expect(
        first.recordGuideProposalDecision(decision, {
          sessionFingerprintSha256: fingerprint,
        }),
      ).toBe('accepted');
      expect(first.recordCompanionState(report, { sessionFingerprintSha256: fingerprint })).toBe(
        'accepted',
      );

      const proposalReceipt = first.getManagedReplayReceipt('replay_proposal', proposal.proposalId);
      const decisionReceipt = first.getManagedReplayReceipt(
        'guide_proposal_decision',
        decision.decisionId,
      );
      const reportReceipt = first.getManagedReplayReceipt(
        'companion_state_report',
        report.reportId,
      );
      expect(proposalReceipt).toMatchObject({
        subjectType: 'replay_proposal',
        subjectId: proposal.proposalId,
        authentication: 'orchestrator_internal',
        adapterId: replay.adapterId,
        instanceId: replay.instanceId,
        sessionFingerprintSha256: null,
      });
      expect(decisionReceipt).toMatchObject({
        subjectType: 'guide_proposal_decision',
        subjectId: decision.decisionId,
        authentication: 'negotiated_companion_lease',
        adapterId: replay.adapterId,
        instanceId: replay.instanceId,
        sessionFingerprintSha256: fingerprint,
      });
      expect(reportReceipt).toMatchObject({
        subjectType: 'companion_state_report',
        subjectId: report.reportId,
        authentication: 'negotiated_companion_lease',
        adapterId: replay.adapterId,
        instanceId: replay.instanceId,
        sessionFingerprintSha256: fingerprint,
      });
      expect(proposalReceipt!.sequence).toBeLessThan(decisionReceipt!.sequence);
      expect(decisionReceipt!.sequence).toBeLessThan(reportReceipt!.sequence);
      expect(Date.parse(proposalReceipt!.receivedAt)).not.toBeNaN();
      expect(Date.parse(decisionReceipt!.receivedAt)).not.toBeNaN();
      expect(Date.parse(reportReceipt!.receivedAt)).not.toBeNaN();
      first.close();

      const reopened = openOperatingLineDatabase(databasePath);
      expect(
        reopened.getManagedReplayReceipt('guide_proposal_decision', decision.decisionId),
      ).toEqual(decisionReceipt);
      expect(reopened.getManagedReplayReceipt('companion_state_report', report.reportId)).toEqual(
        reportReceipt,
      );
      reopened.close();

      const inspected = new DatabaseSync(databasePath);
      expect(
        inspected.prepare('SELECT 1 AS applied FROM schema_migrations WHERE version = 16').get(),
      ).toEqual({ applied: 1 });
      expect(inspected.prepare("PRAGMA table_list('managed_replay_receipts')").get()).toMatchObject(
        {
          strict: 1,
        },
      );
      expect(inspected.prepare("PRAGMA foreign_key_list('managed_replay_receipts')").all()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ table: 'procedure_leaf_replays', from: 'proposal_id' }),
          expect.objectContaining({ table: 'guide_proposal_decisions', from: 'decision_id' }),
          expect.objectContaining({ table: 'companion_state_reports', from: 'report_id' }),
        ]),
      );
      expect(() =>
        inspected
          .prepare(
            `
            INSERT INTO managed_replay_receipts (
              subject_type, trust_source, report_id, adapter_id, instance_id,
              session_fingerprint_sha256, received_at
            ) VALUES ('companion_state_report', 'orchestrator_internal', ?, 'blender', 'instance', ?, ?)
          `,
          )
          .run(report.reportId, fingerprint, new Date().toISOString()),
      ).toThrow('CHECK constraint failed');
      expect(() =>
        inspected
          .prepare(
            `
            INSERT INTO managed_replay_receipts (
              subject_type, trust_source, report_id, adapter_id, instance_id, received_at
            ) VALUES ('companion_state_report', 'negotiated_companion_lease', ?, 'blender', 'instance', ?)
          `,
          )
          .run(report.reportId, new Date().toISOString()),
      ).toThrow('CHECK constraint failed');
      inspected.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('allows legacy writes without lease receipts and backfills only exact authenticated retries', () => {
    const database = openOperatingLineDatabase(':memory:');
    const proposal = guideProposal('legacy-managed-replay-plan', 1);
    const replay = procedureLeafReplay(proposal.proposalId);
    const decision = proposalDecision(proposal.proposalId, replay.instanceId);
    const report = {
      reportId: randomUUID(),
      adapterId: replay.adapterId,
      instanceId: replay.instanceId,
      sequence: 1,
    };
    expect(database.recordProcedureLeafReplayProposal(proposal, replay)).toBe('accepted');
    expect(database.recordGuideProposalDecision(decision)).toBe('accepted');
    expect(database.recordCompanionState(report)).toBe('accepted');
    expect(
      database.getManagedReplayReceipt('guide_proposal_decision', decision.decisionId),
    ).toBeNull();
    expect(database.getManagedReplayReceipt('companion_state_report', report.reportId)).toBeNull();

    const fingerprint = 'd'.repeat(64);
    expect(
      database.recordGuideProposalDecision(decision, {
        sessionFingerprintSha256: fingerprint,
      }),
    ).toBe('duplicate');
    expect(database.recordCompanionState(report, { sessionFingerprintSha256: fingerprint })).toBe(
      'duplicate',
    );
    const decisionReceipt = database.getManagedReplayReceipt(
      'guide_proposal_decision',
      decision.decisionId,
    );
    const reportReceipt = database.getManagedReplayReceipt(
      'companion_state_report',
      report.reportId,
    );
    expect(decisionReceipt?.sessionFingerprintSha256).toBe(fingerprint);
    expect(reportReceipt?.sessionFingerprintSha256).toBe(fingerprint);

    expect(
      database.recordGuideProposalDecision(decision, {
        sessionFingerprintSha256: 'e'.repeat(64),
      }),
    ).toBe('duplicate');
    expect(
      database.getManagedReplayReceipt('guide_proposal_decision', decision.decisionId),
    ).toEqual(decisionReceipt);
    expect(
      database.recordCompanionState(
        { ...report, sequence: 2 },
        { sessionFingerprintSha256: 'e'.repeat(64) },
      ),
    ).toBe('conflict');
    expect(database.getManagedReplayReceipt('companion_state_report', report.reportId)).toEqual(
      reportReceipt,
    );
    expect(() =>
      database.recordCompanionState(
        { ...report, reportId: randomUUID(), sequence: 2 },
        { sessionFingerprintSha256: 'not-a-sha256' },
      ),
    ).toThrow('CHECK constraint failed');
    database.close();
  });
});
