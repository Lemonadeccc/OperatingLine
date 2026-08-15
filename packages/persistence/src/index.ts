import { DatabaseSync } from 'node:sqlite';

export interface ExecutionEventInput {
  id: string;
  eventType: string;
  payload: unknown;
  createdAt?: string;
}

export interface StoredExecutionEvent {
  sequence: number;
  id: string;
  eventType: string;
  payload: unknown;
  createdAt: string;
}

export interface CompanionStateInput {
  reportId: string;
  adapterId: string;
  instanceId: string;
  sequence: number;
}

export type RecordCompanionStateResult = 'accepted' | 'duplicate' | 'stale' | 'conflict';

export interface GuideProposalInput {
  proposalId: string;
  targetAdapterId: string;
  targetInstanceId?: string | undefined;
  goalRequestId?: string | undefined;
  catalogVersion?: string | undefined;
  proposedAt: string;
  plan: {
    id: string;
    revision: number;
  };
}

export interface GuideProposalDecisionInput {
  decisionId: string;
  proposalId: string;
  adapterId: string;
  instanceId: string;
  decision: 'accepted' | 'rejected';
}

export type RecordGuideProposalDecisionResult = 'accepted' | 'duplicate' | 'conflict' | 'unknown';

export interface GuideRevisionRequestInput {
  requestId: string;
  adapterId: string;
  catalogVersion: string;
  instanceId: string;
  occurredAt: string;
  basePlan: {
    id: string;
    revision: number;
  };
  revisionThread?:
    | {
        threadId: string;
        turn: number;
        parentRequestId: string | null;
      }
    | undefined;
}

export type RecordGuideRevisionRequestResult = 'accepted' | 'duplicate' | 'conflict';

export interface GuideGoalRequestInput {
  requestId: string;
  adapterId: string;
  catalogVersion: string;
  instanceId: string;
  goal: string;
  planId: string;
  occurredAt: string;
}

export type RecordGuideGoalRequestResult = 'accepted' | 'duplicate' | 'conflict';

export interface StoredGuideRevisionThreadTurn {
  request: unknown;
  proposal: unknown | null;
  decision: unknown | null;
}

export interface CompanionReplanRunInput {
  generationRequestId: string;
  revisionRequestId: string;
  targetAdapterId: string;
  targetInstanceId: string;
  status: string;
  updatedAt: string;
}

export type RecordCompanionReplanRunResult = 'accepted' | 'duplicate' | 'conflict';

export interface CompanionInitialPlanRunInput {
  generationRequestId: string;
  goalRequestId: string;
  targetAdapterId: string;
  targetInstanceId: string;
  status: string;
  updatedAt: string;
}

export type RecordCompanionInitialPlanRunResult = 'accepted' | 'duplicate' | 'conflict';

export interface CompanionDialogueRunInput {
  dialogueRequestId: string;
  revisionRequestId: string;
  replanGenerationRequestId: string;
  targetAdapterId: string;
  targetInstanceId: string;
  status: string;
  assistantMessage: string;
  assistantMessageRevision: number;
  updatedAt: string;
}

export type RecordCompanionDialogueRunResult = 'accepted' | 'duplicate' | 'conflict';

export interface ProcedureTreeRecordInput {
  treeId: string;
  revision: number;
  title: string;
  adapterId: string;
  actionCatalogVersion: string;
  interactionCatalogVersion: string;
  hostVersionRange: string;
  contentSha256: string;
  tree: unknown;
}

export interface StoredProcedureTreeSummary {
  sequence: number;
  treeId: string;
  revision: number;
  title: string;
  adapterId: string;
  actionCatalogVersion: string;
  interactionCatalogVersion: string;
  hostVersionRange: string;
  contentSha256: string;
  storedAt: string;
}

export interface StoredProcedureTreeRecord extends StoredProcedureTreeSummary {
  tree: unknown;
}

export type RecordProcedureTreeResult =
  | {
      result: 'accepted' | 'duplicate';
      record: StoredProcedureTreeRecord;
    }
  | {
      result: 'stale' | 'conflict';
      latestRevision: number;
    };

export type ProcedureOperationIndexModality = 'semantic' | 'menu' | 'shortcut' | 'mcp';

export type ProcedureOperationIndexKind =
  | 'semantic_action'
  | 'menu_interaction'
  | 'shortcut_key_input'
  | 'operator_property_update'
  | 'mcp_call';

export interface ProcedureOperationSearchInput {
  afterSequence: number;
  limit: number;
  treeId?: string;
  treeRevision?: number;
  adapterId?: string;
  leafId?: string;
  operationId?: string;
  modality?: ProcedureOperationIndexModality;
  operationKind?: ProcedureOperationIndexKind;
  validationStatus?: 'candidate' | 'verified' | 'rejected';
  actionName?: string;
  semanticAction?: string;
  menuTargetHostId?: string;
  menuPath?: readonly string[];
  shortcutKeys?: readonly string[];
  targetHostId?: string;
  interactionPath?: readonly string[];
  surfaceOperationId?: string;
  expectedOperatorId?: string;
  mcpServerName?: string;
  mcpToolName?: string;
}

export interface StoredProcedureOperationIndex {
  sequence: number;
  treeSequence: number;
  treeId: string;
  treeRevision: number;
  adapterId: string;
  leafId: string;
  validationStatus: 'candidate' | 'verified' | 'rejected';
  actionName: string | null;
  modality: ProcedureOperationIndexModality;
  operationKind: ProcedureOperationIndexKind;
  trackId: string | null;
  operationId: string;
  semanticActions: string[];
  menuTargetHostId: string | null;
  menuPath: string[] | null;
  shortcutKeys: string[] | null;
  targetHostId: string | null;
  interactionPath: string[] | null;
  surfaceOperationId: string | null;
  expectedOperatorId: string | null;
  mcpServerName: string | null;
  mcpToolName: string | null;
}

function canonicalJson(value: unknown): string {
  const normalize = (candidate: unknown): unknown => {
    if (Array.isArray(candidate)) {
      return candidate.map(normalize);
    }
    if (candidate !== null && typeof candidate === 'object') {
      return Object.fromEntries(
        Object.entries(candidate)
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
          .map(([key, entry]) => [key, normalize(entry)]),
      );
    }
    return candidate;
  };
  return JSON.stringify(normalize(value));
}

function validateShortcutSurfaceLifecycle(tree: unknown): void {
  if (tree === null || typeof tree !== 'object') return;
  const candidateTree = tree as { formatVersion?: unknown; nodes?: unknown };
  const formatVersion = candidateTree.formatVersion;
  const fail = (reason: string): never => {
    throw new Error(`context-inconsistent procedure operation index row: ${reason}`);
  };
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
  const isNonemptyString = (value: unknown): value is string =>
    typeof value === 'string' && value.length > 0;
  const isParameterless = (value: unknown): boolean =>
    isRecord(value) && Object.keys(value).length === 0;
  const isJsonValue = (value: unknown): boolean => {
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))
    ) {
      return true;
    }
    if (Array.isArray(value)) return value.every(isJsonValue);
    return isRecord(value) && Object.values(value).every(isJsonValue);
  };
  const nodes = candidateTree.nodes;
  if (!Array.isArray(nodes)) {
    if (formatVersion === '1.1.0') fail('format 1.1.0 requires an operator property update');
    return;
  }
  let propertyOperationCount = 0;

  for (const node of nodes) {
    if (!isRecord(node) || node['kind'] !== 'leaf' || !Array.isArray(node['shortcutTracks'])) {
      continue;
    }
    for (const track of node['shortcutTracks']) {
      if (!isRecord(track) || track['availability'] !== 'available') continue;
      if (!Array.isArray(track['operations'])) {
        if (formatVersion === '1.1.0') fail('format 1.1.0 requires normalized operations');
        continue;
      }
      let openSurfaceOperationId: string | undefined;
      let expectedOperatorId: string | undefined;
      let propertyCount = 0;
      let propertyHostIds = new Set<string>();
      const operations = track['operations'];

      for (const [operationIndex, value] of operations.entries()) {
        if (!isRecord(value)) {
          if (formatVersion === '1.1.0') fail('format 1.1.0 requires normalized operations');
          if (openSurfaceOperationId !== undefined) fail('surface operation must be an object');
          continue;
        }
        if (formatVersion === '1.0.0' && Object.hasOwn(value, 'kind')) {
          fail('format 1.0.0 cannot contain extended shortcut operations');
        }
        if (
          formatVersion === '1.1.0' &&
          value['kind'] !== 'key_input' &&
          value['kind'] !== 'operator_property_update'
        ) {
          fail('format 1.1.0 requires normalized operations');
        }
        const opensSurface = value['opensSurface'];
        const closesSurfaceOperationId = value['closesSurfaceOperationId'];
        const isPropertyUpdate = value['kind'] === 'operator_property_update';
        const hasSurfaceAssociation =
          isPropertyUpdate ||
          value['surfaceOperationId'] !== undefined ||
          opensSurface !== undefined ||
          closesSurfaceOperationId !== undefined;

        if (!hasSurfaceAssociation) {
          if (openSurfaceOperationId !== undefined) {
            fail('surface property updates must be contiguous and explicitly closed');
          }
          continue;
        }
        if (!isNonemptyString(value['id'])) fail('surface operation id must be nonempty');

        if (isPropertyUpdate) {
          propertyOperationCount += 1;
          if (
            opensSurface !== undefined ||
            closesSurfaceOperationId !== undefined ||
            !isNonemptyString(value['surfaceOperationId']) ||
            value['surfaceOperationId'] !== openSurfaceOperationId
          ) {
            fail('property update references a surface that is not currently open');
          }
          const target = value['target'];
          const targetHostId = isRecord(target) ? target['hostId'] : undefined;
          const path = value['path'];
          const parameters = value['parameters'];
          if (
            !isRecord(target) ||
            target['kind'] !== 'control' ||
            !Array.isArray(path) ||
            path.length === 0 ||
            path.some((part) => !isNonemptyString(part)) ||
            !isRecord(parameters) ||
            Object.keys(parameters).length !== 1 ||
            !Object.hasOwn(parameters, 'value') ||
            !isJsonValue(parameters['value'])
          ) {
            fail('property update requires a control target, path, and single value');
          }
          const expectedPrefix = `${expectedOperatorId ?? ''}.`;
          if (
            !isNonemptyString(targetHostId) ||
            expectedOperatorId === undefined ||
            !targetHostId.startsWith(expectedPrefix) ||
            targetHostId.length === expectedPrefix.length
          ) {
            fail('property update target is outside the open surface operator');
          }
          const propertyTargetHostId = targetHostId as string;
          if (propertyHostIds.has(propertyTargetHostId)) fail('surface repeats a property target');
          propertyHostIds.add(propertyTargetHostId);
          propertyCount += 1;
          continue;
        }

        if (opensSurface !== undefined) {
          if (
            openSurfaceOperationId !== undefined ||
            closesSurfaceOperationId !== undefined ||
            !isRecord(opensSurface) ||
            opensSurface['kind'] !== 'adjust_last_operation' ||
            opensSurface['hostId'] !== 'screen.redo_last' ||
            !isNonemptyString(opensSurface['sourceOperationId']) ||
            !isNonemptyString(opensSurface['expectedOperatorId']) ||
            value['kind'] !== 'key_input' ||
            value['keyMode'] !== 'sequence' ||
            !Array.isArray(value['keys']) ||
            value['keys'].length !== 1 ||
            value['keys'][0] !== 'F9' ||
            !isParameterless(value['parameters'])
          ) {
            fail('invalid shortcut surface opener');
          }
          const surface = opensSurface as Record<string, unknown>;
          const previous = operations[operationIndex - 1];
          if (
            !isRecord(previous) ||
            previous['id'] !== surface['sourceOperationId'] ||
            !Number.isSafeInteger(previous['order']) ||
            !Number.isSafeInteger(value['order']) ||
            (value['order'] as number) !== (previous['order'] as number) + 1
          ) {
            fail('surface opener must immediately follow its source operation in order');
          }
          openSurfaceOperationId = value['id'] as string;
          expectedOperatorId = surface['expectedOperatorId'] as string;
          propertyCount = 0;
          propertyHostIds = new Set<string>();
          continue;
        }

        if (
          closesSurfaceOperationId !== openSurfaceOperationId ||
          openSurfaceOperationId === undefined ||
          propertyCount === 0 ||
          value['kind'] !== 'key_input' ||
          value['keyMode'] !== 'sequence' ||
          !Array.isArray(value['keys']) ||
          value['keys'].length !== 1 ||
          value['keys'][0] !== 'ENTER' ||
          !isParameterless(value['parameters'])
        ) {
          fail('surface closer does not close an updated open surface');
        }
        openSurfaceOperationId = undefined;
        expectedOperatorId = undefined;
        propertyCount = 0;
        propertyHostIds = new Set<string>();
      }
      if (openSurfaceOperationId !== undefined) fail('surface is not explicitly closed');
    }
  }
  if (formatVersion === '1.1.0' && propertyOperationCount === 0) {
    fail('format 1.1.0 requires an operator property update');
  }
}

const companionDialogueMutablePayloadFields = new Set([
  'status',
  'terminal',
  'assistantMessage',
  'assistantMessageRevision',
  'semanticDecision',
  'revisionRequestRecorded',
  'proposalId',
  'error',
  'needsRevision',
  'updatedAt',
]);

function companionDialogueImmutablePayload(run: CompanionDialogueRunInput): string {
  return canonicalJson(
    Object.fromEntries(
      Object.entries(run).filter(([key]) => !companionDialogueMutablePayloadFields.has(key)),
    ),
  );
}

export interface OperatingLineDatabase {
  appendEvent(event: ExecutionEventInput): void;
  countEvents(): number;
  listExecutionEvents(afterSequence: number, limit: number): StoredExecutionEvent[];
  listExecutionEventsByTypes(eventTypes: readonly string[]): StoredExecutionEvent[];
  getExecutionEvent(id: string): StoredExecutionEvent | null;
  recordGuideProposal<T extends GuideProposalInput>(proposal: T): void;
  recordGuideGoalProposal<T extends GuideProposalInput>(
    proposal: T,
    goalRequestId: string,
    generationRequestId?: string,
  ): void;
  recordGuideReplanProposal<T extends GuideProposalInput>(
    proposal: T,
    revisionRequestId: string,
    generationRequestId?: string,
  ): void;
  getPendingGuideProposal(adapterId: string, instanceId: string): unknown | null;
  listLatestGuidePlanRevisions(): Array<{ planId: string; revision: number }>;
  recordGuideProposalDecision<T extends GuideProposalDecisionInput>(
    decision: T,
  ): RecordGuideProposalDecisionResult;
  recordGuideRevisionRequest<T extends GuideRevisionRequestInput>(
    request: T,
  ): RecordGuideRevisionRequestResult;
  getGuideRevisionRequest(requestId: string): unknown | null;
  getGuideRevisionThreadHead(threadId: string): unknown | null;
  getGuideReplanProposalForRequest(requestId: string): unknown | null;
  getGuideProposalDecision(
    proposalId: string,
    adapterId: string,
    instanceId: string,
  ): unknown | null;
  listGuideRevisionThreadTurns(
    threadId: string,
    adapterId: string,
    instanceId: string,
    beforeTurn: number | null,
    limit: number,
  ): StoredGuideRevisionThreadTurn[];
  listGuideRevisionThreadHeads(
    adapterId: string,
    instanceId: string,
    planId: string,
    limit: number,
  ): StoredGuideRevisionThreadTurn[];
  listPendingGuideRevisionRequests(adapterId: string | undefined, limit: number): unknown[];
  recordGuideGoalRequest<T extends GuideGoalRequestInput>(request: T): RecordGuideGoalRequestResult;
  getGuideGoalRequest(requestId: string): unknown | null;
  getGuideGoalProposalForRequest(requestId: string): unknown | null;
  getGuideGoalProposalForGeneration(generationRequestId: string): unknown | null;
  listPendingGuideGoalRequests(adapterId: string | undefined, limit: number): unknown[];
  recordCompanionReplanRun<T extends CompanionReplanRunInput>(
    run: T,
  ): RecordCompanionReplanRunResult;
  getCompanionReplanRun(generationRequestId: string): unknown | null;
  transitionCompanionReplanRun<T extends CompanionReplanRunInput>(
    run: T,
    expectedStatuses: readonly string[],
  ): boolean;
  listNonterminalCompanionReplanRuns(): unknown[];
  recordCompanionInitialPlanRun<T extends CompanionInitialPlanRunInput>(
    run: T,
  ): RecordCompanionInitialPlanRunResult;
  getCompanionInitialPlanRun(generationRequestId: string): unknown | null;
  transitionCompanionInitialPlanRun<T extends CompanionInitialPlanRunInput>(
    run: T,
    expectedStatuses: readonly string[],
  ): boolean;
  listNonterminalCompanionInitialPlanRuns(): unknown[];
  recordCompanionDialogueRun<T extends CompanionDialogueRunInput>(
    run: T,
  ): RecordCompanionDialogueRunResult;
  getCompanionDialogueRun(dialogueRequestId: string): unknown | null;
  transitionCompanionDialogueRun<T extends CompanionDialogueRunInput>(
    run: T,
    expectedStatuses: readonly string[],
  ): boolean;
  transitionCompanionDialogueRunWithRevisionRequest<
    TRun extends CompanionDialogueRunInput,
    TRequest extends GuideRevisionRequestInput,
  >(
    run: TRun,
    request: TRequest,
    expectedStatuses: readonly string[],
  ): boolean;
  listNonterminalCompanionDialogueRuns(): unknown[];
  recordProcedureTree(input: ProcedureTreeRecordInput): RecordProcedureTreeResult;
  getProcedureTree(treeId: string, revision?: number): StoredProcedureTreeRecord | null;
  listProcedureTrees(
    afterSequence: number,
    limit: number,
    adapterId?: string,
  ): StoredProcedureTreeSummary[];
  searchProcedureOperations(input: ProcedureOperationSearchInput): StoredProcedureOperationIndex[];
  recordCompanionState<T extends CompanionStateInput>(report: T): RecordCompanionStateResult;
  listLatestCompanionStates(): unknown[];
  close(): void;
}

export function openOperatingLineDatabase(filename: string): OperatingLineDatabase {
  const sqlite = new DatabaseSync(filename, { timeout: 5_000 });
  sqlite.exec('PRAGMA foreign_keys = ON;');
  if (filename !== ':memory:') {
    sqlite.exec('PRAGMA journal_mode = WAL;');
  }

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS execution_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    INSERT OR IGNORE INTO schema_migrations (version, applied_at)
    VALUES (1, datetime('now'));

    CREATE TABLE IF NOT EXISTS companion_state_reports (
      report_id TEXT PRIMARY KEY,
      adapter_id TEXT NOT NULL,
      instance_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      payload TEXT NOT NULL,
      UNIQUE (adapter_id, instance_id, sequence)
    );

    CREATE TABLE IF NOT EXISTS companion_latest_states (
      adapter_id TEXT NOT NULL,
      instance_id TEXT NOT NULL,
      report_id TEXT NOT NULL UNIQUE,
      sequence INTEGER NOT NULL,
      payload TEXT NOT NULL,
      PRIMARY KEY (adapter_id, instance_id),
      FOREIGN KEY (report_id) REFERENCES companion_state_reports(report_id)
    );

    INSERT OR IGNORE INTO schema_migrations (version, applied_at)
    VALUES (2, datetime('now'));

    CREATE TABLE IF NOT EXISTS guide_proposals (
      proposal_id TEXT PRIMARY KEY,
      target_adapter_id TEXT NOT NULL,
      plan_id TEXT NOT NULL,
      plan_revision INTEGER NOT NULL CHECK (plan_revision > 0),
      proposed_at TEXT NOT NULL,
      payload TEXT NOT NULL,
      UNIQUE (plan_id, plan_revision)
    );

    CREATE INDEX IF NOT EXISTS guide_proposals_target_order
    ON guide_proposals (target_adapter_id, proposed_at DESC);

    CREATE TABLE IF NOT EXISTS guide_proposal_decisions (
      decision_id TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL,
      adapter_id TEXT NOT NULL,
      instance_id TEXT NOT NULL,
      decision TEXT NOT NULL CHECK (decision IN ('accepted', 'rejected')),
      payload TEXT NOT NULL,
      UNIQUE (proposal_id, adapter_id, instance_id),
      FOREIGN KEY (proposal_id) REFERENCES guide_proposals(proposal_id)
    );

    INSERT OR IGNORE INTO schema_migrations (version, applied_at)
    VALUES (3, datetime('now'));

    CREATE TABLE IF NOT EXISTS guide_revision_requests (
      request_id TEXT PRIMARY KEY,
      adapter_id TEXT NOT NULL,
      instance_id TEXT NOT NULL,
      base_plan_id TEXT NOT NULL,
      base_revision INTEGER NOT NULL CHECK (base_revision > 0),
      occurred_at TEXT NOT NULL,
      payload TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS guide_revision_requests_pending_order
    ON guide_revision_requests (adapter_id, occurred_at, request_id);

    CREATE TABLE IF NOT EXISTS guide_revision_request_proposals (
      request_id TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL UNIQUE,
      linked_at TEXT NOT NULL,
      FOREIGN KEY (request_id) REFERENCES guide_revision_requests(request_id),
      FOREIGN KEY (proposal_id) REFERENCES guide_proposals(proposal_id)
    );

    INSERT OR IGNORE INTO schema_migrations (version, applied_at)
    VALUES (4, datetime('now'));
  `);

  const executionEventColumns = sqlite.prepare("PRAGMA table_info('execution_events')").all();
  const hasExecutionEventSequence = executionEventColumns.some(
    (row) => (row as { name?: unknown }).name === 'sequence',
  );
  if (!hasExecutionEventSequence) {
    try {
      sqlite.exec(`
        BEGIN IMMEDIATE;

        CREATE TABLE execution_events_v5 (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT,
          id TEXT NOT NULL UNIQUE,
          event_type TEXT NOT NULL,
          payload TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        INSERT INTO execution_events_v5 (sequence, id, event_type, payload, created_at)
        SELECT rowid, id, event_type, payload, created_at
        FROM execution_events
        ORDER BY rowid;

        DROP TABLE execution_events;
        ALTER TABLE execution_events_v5 RENAME TO execution_events;

        COMMIT;
      `);
    } catch (error) {
      try {
        sqlite.exec('ROLLBACK;');
      } catch {
        // The migration may have failed before opening a transaction.
      }
      throw error;
    }
  }
  sqlite
    .prepare(
      "INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (5, datetime('now'))",
    )
    .run();
  sqlite.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS guide_revision_requests_thread_turn
    ON guide_revision_requests (
      json_extract(payload, '$.revisionThread.threadId'),
      CAST(json_extract(payload, '$.revisionThread.turn') AS INTEGER)
    )
    WHERE json_extract(payload, '$.revisionThread.threadId') IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS guide_revision_requests_parent
    ON guide_revision_requests (json_extract(payload, '$.revisionThread.parentRequestId'))
    WHERE json_extract(payload, '$.revisionThread.parentRequestId') IS NOT NULL;

    INSERT OR IGNORE INTO schema_migrations (version, applied_at)
    VALUES (6, datetime('now'));

    CREATE INDEX IF NOT EXISTS execution_events_type_sequence
    ON execution_events (event_type, sequence);

    INSERT OR IGNORE INTO schema_migrations (version, applied_at)
    VALUES (7, datetime('now'));

    CREATE TABLE IF NOT EXISTS companion_replan_runs (
      generation_request_id TEXT PRIMARY KEY,
      revision_request_id TEXT NOT NULL,
      target_adapter_id TEXT NOT NULL,
      target_instance_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (
        status IN (
          'queued',
          'generating',
          'needs_revision',
          'proposal_created',
          'failed',
          'interrupted'
        )
      ),
      updated_at TEXT NOT NULL,
      payload TEXT NOT NULL,
      FOREIGN KEY (revision_request_id) REFERENCES guide_revision_requests(request_id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS companion_replan_runs_active_target
    ON companion_replan_runs (target_adapter_id, target_instance_id)
    WHERE status IN ('queued', 'generating');

    INSERT OR IGNORE INTO schema_migrations (version, applied_at)
    VALUES (8, datetime('now'));

    CREATE TABLE IF NOT EXISTS guide_goal_requests (
      request_id TEXT PRIMARY KEY,
      adapter_id TEXT NOT NULL,
      catalog_version TEXT NOT NULL,
      instance_id TEXT NOT NULL,
      plan_id TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      payload TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS guide_goal_requests_pending_order
    ON guide_goal_requests (adapter_id, occurred_at, request_id);

    CREATE TABLE IF NOT EXISTS guide_goal_request_proposals (
      request_id TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL UNIQUE,
      linked_at TEXT NOT NULL,
      FOREIGN KEY (request_id) REFERENCES guide_goal_requests(request_id),
      FOREIGN KEY (proposal_id) REFERENCES guide_proposals(proposal_id)
    );

    INSERT OR IGNORE INTO schema_migrations (version, applied_at)
    VALUES (9, datetime('now'));

    CREATE TABLE IF NOT EXISTS companion_initial_plan_runs (
      generation_request_id TEXT PRIMARY KEY,
      goal_request_id TEXT NOT NULL,
      target_adapter_id TEXT NOT NULL,
      target_instance_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (
        status IN (
          'queued',
          'generating',
          'needs_revision',
          'proposal_created',
          'failed',
          'interrupted'
        )
      ),
      updated_at TEXT NOT NULL,
      payload TEXT NOT NULL,
      FOREIGN KEY (goal_request_id) REFERENCES guide_goal_requests(request_id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS companion_initial_plan_runs_active_target
    ON companion_initial_plan_runs (target_adapter_id, target_instance_id)
    WHERE status IN ('queued', 'generating');

  `);

  const goalProposalColumns = sqlite
    .prepare("PRAGMA table_info('guide_goal_request_proposals')")
    .all();
  const hasGoalProposalGenerationRequestId = goalProposalColumns.some(
    (row) => (row as { name?: unknown }).name === 'generation_request_id',
  );
  if (!hasGoalProposalGenerationRequestId) {
    sqlite.exec(`
      ALTER TABLE guide_goal_request_proposals
      ADD COLUMN generation_request_id TEXT;
    `);
  }
  sqlite.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS guide_goal_proposals_generation_request
    ON guide_goal_request_proposals (generation_request_id)
    WHERE generation_request_id IS NOT NULL;

    INSERT OR IGNORE INTO schema_migrations (version, applied_at)
    VALUES (10, datetime('now'));
  `);
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS companion_dialogue_runs (
      dialogue_request_id TEXT PRIMARY KEY,
      revision_request_id TEXT NOT NULL UNIQUE,
      replan_generation_request_id TEXT NOT NULL UNIQUE,
      target_adapter_id TEXT NOT NULL,
      target_instance_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (
        status IN (
          'queued',
          'streaming',
          'replanning',
          'answered',
          'needs_revision',
          'proposal_created',
          'failed',
          'interrupted'
        )
      ),
      assistant_message_revision INTEGER NOT NULL CHECK (assistant_message_revision >= 0),
      updated_at TEXT NOT NULL,
      payload TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS companion_dialogue_runs_active_target
    ON companion_dialogue_runs (target_adapter_id, target_instance_id)
    WHERE status IN ('queued', 'streaming', 'replanning');

    INSERT OR IGNORE INTO schema_migrations (version, applied_at)
    VALUES (11, datetime('now'));
  `);
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS procedure_trees (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      tree_id TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK (revision > 0),
      title TEXT NOT NULL,
      adapter_id TEXT NOT NULL,
      action_catalog_version TEXT NOT NULL,
      interaction_catalog_version TEXT NOT NULL,
      host_version_range TEXT NOT NULL,
      content_sha256 TEXT NOT NULL CHECK (
        length(content_sha256) = 64 AND content_sha256 NOT GLOB '*[^0-9a-f]*'
      ),
      stored_at TEXT NOT NULL,
      payload TEXT NOT NULL,
      UNIQUE (tree_id, revision)
    );

    CREATE INDEX IF NOT EXISTS procedure_trees_adapter_sequence
    ON procedure_trees (adapter_id, sequence);

    CREATE INDEX IF NOT EXISTS procedure_trees_latest_revision
    ON procedure_trees (tree_id, revision DESC);

    INSERT OR IGNORE INTO schema_migrations (version, applied_at)
    VALUES (12, datetime('now'));
  `);
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS procedure_operations (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      tree_sequence INTEGER NOT NULL,
      tree_id TEXT NOT NULL,
      tree_revision INTEGER NOT NULL CHECK (tree_revision > 0),
      adapter_id TEXT NOT NULL,
      leaf_id TEXT NOT NULL,
      leaf_validation_status TEXT NOT NULL CHECK (
        leaf_validation_status IN ('candidate', 'verified', 'rejected')
      ),
      leaf_action_name TEXT,
      modality TEXT NOT NULL CHECK (modality IN ('semantic', 'menu', 'shortcut', 'mcp')),
      track_id TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      semantic_actions TEXT NOT NULL CHECK (json_valid(semantic_actions)),
      menu_target_host_id TEXT,
      menu_path TEXT CHECK (menu_path IS NULL OR json_valid(menu_path)),
      shortcut_keys TEXT CHECK (shortcut_keys IS NULL OR json_valid(shortcut_keys)),
      mcp_server_name TEXT,
      mcp_tool_name TEXT,
      UNIQUE (tree_id, tree_revision, leaf_id, modality, track_id, operation_id),
      FOREIGN KEY (tree_sequence) REFERENCES procedure_trees(sequence),
      FOREIGN KEY (tree_id, tree_revision) REFERENCES procedure_trees(tree_id, revision)
    );

    CREATE INDEX IF NOT EXISTS procedure_operations_tree_sequence
    ON procedure_operations (tree_id, tree_revision, sequence);

    CREATE INDEX IF NOT EXISTS procedure_operations_adapter_modality
    ON procedure_operations (adapter_id, modality, sequence);

    CREATE INDEX IF NOT EXISTS procedure_operations_action
    ON procedure_operations (leaf_action_name, sequence)
    WHERE leaf_action_name IS NOT NULL;

    CREATE INDEX IF NOT EXISTS procedure_operations_menu
    ON procedure_operations (menu_target_host_id, menu_path, sequence)
    WHERE modality = 'menu';

    CREATE INDEX IF NOT EXISTS procedure_operations_shortcut
    ON procedure_operations (shortcut_keys, sequence)
    WHERE modality = 'shortcut';

    CREATE INDEX IF NOT EXISTS procedure_operations_mcp
    ON procedure_operations (mcp_server_name, mcp_tool_name, sequence)
    WHERE modality = 'mcp';

    INSERT OR IGNORE INTO schema_migrations (version, applied_at)
    VALUES (13, datetime('now'));
  `);

  const procedureOperationColumns = new Set(
    sqlite
      .prepare("PRAGMA table_info('procedure_operations')")
      .all()
      .map((row) => (row as { name: string }).name),
  );
  const procedureOperationMigrationApplied =
    sqlite.prepare('SELECT 1 AS applied FROM schema_migrations WHERE version = 14').get() !==
    undefined;
  const procedureOperationIndexColumns = [
    [
      'operation_kind',
      "TEXT CHECK (operation_kind IS NULL OR operation_kind IN ('semantic_action', 'menu_interaction', 'shortcut_key_input', 'operator_property_update', 'mcp_call'))",
    ],
    ['target_host_id', 'TEXT'],
    ['interaction_path', 'TEXT CHECK (interaction_path IS NULL OR json_valid(interaction_path))'],
    ['surface_operation_id', 'TEXT'],
    ['expected_operator_id', 'TEXT'],
  ] as const;
  const needsProcedureOperationIndexRebuild =
    !procedureOperationMigrationApplied ||
    procedureOperationIndexColumns.some(([name]) => !procedureOperationColumns.has(name));
  for (const [name, declaration] of procedureOperationIndexColumns) {
    if (!procedureOperationColumns.has(name)) {
      sqlite.exec(`ALTER TABLE procedure_operations ADD COLUMN ${name} ${declaration};`);
    }
  }
  if (needsProcedureOperationIndexRebuild) {
    sqlite.exec('DELETE FROM procedure_operations;');
  }
  sqlite.exec(`
    DROP TRIGGER IF EXISTS procedure_operations_context_insert;

    CREATE INDEX IF NOT EXISTS procedure_operations_kind
    ON procedure_operations (operation_kind, sequence);

    CREATE INDEX IF NOT EXISTS procedure_operations_target
    ON procedure_operations (target_host_id, interaction_path, sequence)
    WHERE target_host_id IS NOT NULL OR interaction_path IS NOT NULL;

    CREATE INDEX IF NOT EXISTS procedure_operations_surface
    ON procedure_operations (surface_operation_id, expected_operator_id, sequence)
    WHERE surface_operation_id IS NOT NULL OR expected_operator_id IS NOT NULL;

    CREATE TRIGGER IF NOT EXISTS procedure_operations_context_insert
    BEFORE INSERT ON procedure_operations
    WHEN NOT COALESCE((
      (NEW.modality = 'semantic'
        AND NEW.operation_kind = 'semantic_action'
        AND NEW.track_id = ''
        AND NEW.menu_target_host_id IS NULL
        AND NEW.menu_path IS NULL
        AND NEW.shortcut_keys IS NULL
        AND NEW.target_host_id IS NULL
        AND NEW.interaction_path IS NULL
        AND NEW.surface_operation_id IS NULL
        AND NEW.expected_operator_id IS NULL
        AND NEW.mcp_server_name IS NULL
        AND NEW.mcp_tool_name IS NULL)
      OR (NEW.modality = 'menu'
        AND NEW.operation_kind = 'menu_interaction'
        AND NEW.track_id <> ''
        AND NEW.menu_target_host_id IS NOT NULL
        AND length(NEW.menu_target_host_id) > 0
        AND NEW.menu_path IS NOT NULL
        AND json_array_length(NEW.menu_path) > 0
        AND NEW.shortcut_keys IS NULL
        AND NEW.target_host_id = NEW.menu_target_host_id
        AND NEW.interaction_path = NEW.menu_path
        AND NEW.surface_operation_id IS NULL
        AND NEW.expected_operator_id IS NULL
        AND NEW.mcp_server_name IS NULL
        AND NEW.mcp_tool_name IS NULL)
      OR (NEW.modality = 'shortcut'
        AND NEW.operation_kind = 'shortcut_key_input'
        AND NEW.track_id <> ''
        AND NEW.menu_target_host_id IS NULL
        AND NEW.menu_path IS NULL
        AND NEW.shortcut_keys IS NOT NULL
        AND json_array_length(NEW.shortcut_keys) > 0
        AND NEW.mcp_server_name IS NULL
        AND NEW.mcp_tool_name IS NULL
        AND (
          (NEW.target_host_id IS NULL
            AND NEW.surface_operation_id IS NULL
            AND NEW.expected_operator_id IS NULL)
          OR (NEW.target_host_id IS NULL
            AND NEW.surface_operation_id IS NOT NULL
            AND length(NEW.surface_operation_id) > 0
            AND NEW.expected_operator_id IS NOT NULL
            AND length(NEW.expected_operator_id) > 0)
          OR (NEW.target_host_id IS NOT NULL
            AND length(NEW.target_host_id) > 0
            AND NEW.surface_operation_id IS NOT NULL
            AND length(NEW.surface_operation_id) > 0
            AND NEW.expected_operator_id IS NOT NULL
            AND length(NEW.expected_operator_id) > 0)
        ))
      OR (NEW.modality = 'shortcut'
        AND NEW.operation_kind = 'operator_property_update'
        AND NEW.track_id <> ''
        AND NEW.menu_target_host_id IS NULL
        AND NEW.menu_path IS NULL
        AND NEW.shortcut_keys IS NULL
        AND NEW.target_host_id IS NOT NULL
        AND length(NEW.target_host_id) > 0
        AND NEW.interaction_path IS NOT NULL
        AND json_array_length(NEW.interaction_path) > 0
        AND NEW.surface_operation_id IS NOT NULL
        AND length(NEW.surface_operation_id) > 0
        AND NEW.expected_operator_id IS NOT NULL
        AND length(NEW.expected_operator_id) > 0
        AND NEW.mcp_server_name IS NULL
        AND NEW.mcp_tool_name IS NULL)
      OR (NEW.modality = 'mcp'
        AND NEW.operation_kind = 'mcp_call'
        AND NEW.track_id <> ''
        AND NEW.menu_target_host_id IS NULL
        AND NEW.menu_path IS NULL
        AND NEW.shortcut_keys IS NULL
        AND NEW.target_host_id IS NULL
        AND NEW.interaction_path IS NULL
        AND NEW.surface_operation_id IS NULL
        AND NEW.expected_operator_id IS NULL
        AND NEW.mcp_server_name IS NOT NULL
        AND NEW.mcp_tool_name IS NOT NULL)
    ), 0)
    BEGIN
      SELECT RAISE(ABORT, 'context-inconsistent procedure operation index row');
    END;

    INSERT OR IGNORE INTO schema_migrations (version, applied_at)
    VALUES (14, datetime('now'));
  `);

  const insertEvent = sqlite.prepare(`
    INSERT INTO execution_events (id, event_type, payload, created_at)
    VALUES (?, ?, ?, ?)
  `);
  const countEvents = sqlite.prepare('SELECT COUNT(*) AS value FROM execution_events');
  const listEvents = sqlite.prepare(`
    SELECT sequence, id, event_type, payload, created_at
    FROM execution_events
    WHERE sequence > ?
    ORDER BY sequence
    LIMIT ?
  `);
  const findEvent = sqlite.prepare(`
    SELECT sequence, id, event_type, payload, created_at
    FROM execution_events
    WHERE id = ?
  `);
  const insertProcedureTree = sqlite.prepare(`
    INSERT INTO procedure_trees (
      tree_id,
      revision,
      title,
      adapter_id,
      action_catalog_version,
      interaction_catalog_version,
      host_version_range,
      content_sha256,
      stored_at,
      payload
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const findProcedureTree = sqlite.prepare(`
    SELECT
      sequence,
      tree_id,
      revision,
      title,
      adapter_id,
      action_catalog_version,
      interaction_catalog_version,
      host_version_range,
      content_sha256,
      stored_at,
      payload
    FROM procedure_trees
    WHERE tree_id = ? AND revision = ?
  `);
  const findLatestProcedureTree = sqlite.prepare(`
    SELECT
      sequence,
      tree_id,
      revision,
      title,
      adapter_id,
      action_catalog_version,
      interaction_catalog_version,
      host_version_range,
      content_sha256,
      stored_at,
      payload
    FROM procedure_trees
    WHERE tree_id = ?
    ORDER BY revision DESC
    LIMIT 1
  `);
  const listProcedureTreeRows = sqlite.prepare(`
    SELECT
      sequence,
      tree_id,
      revision,
      title,
      adapter_id,
      action_catalog_version,
      interaction_catalog_version,
      host_version_range,
      content_sha256,
      stored_at
    FROM procedure_trees
    WHERE sequence > ?
    ORDER BY sequence
    LIMIT ?
  `);
  const listProcedureTreeRowsByAdapter = sqlite.prepare(`
    SELECT
      sequence,
      tree_id,
      revision,
      title,
      adapter_id,
      action_catalog_version,
      interaction_catalog_version,
      host_version_range,
      content_sha256,
      stored_at
    FROM procedure_trees
    WHERE sequence > ? AND adapter_id = ?
    ORDER BY sequence
    LIMIT ?
  `);
  const indexSemanticProcedureOperations = sqlite.prepare(`
    INSERT INTO procedure_operations (
      tree_sequence,
      tree_id,
      tree_revision,
      adapter_id,
      leaf_id,
      leaf_validation_status,
      leaf_action_name,
      modality,
      track_id,
      operation_id,
      semantic_actions,
      menu_target_host_id,
      menu_path,
      shortcut_keys,
      operation_kind,
      target_host_id,
      interaction_path,
      surface_operation_id,
      expected_operator_id,
      mcp_server_name,
      mcp_tool_name
    )
    SELECT
      tree.sequence,
      tree.tree_id,
      tree.revision,
      tree.adapter_id,
      json_extract(node.value, '$.id'),
      json_extract(node.value, '$.validation.status'),
      json_extract(node.value, '$.action.name'),
      'semantic',
      '',
      json_extract(operation.value, '$.id'),
      json_array(json_extract(operation.value, '$.semanticAction')),
      NULL,
      NULL,
      NULL,
      'semantic_action',
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL
    FROM procedure_trees AS tree,
      json_each(tree.payload, '$.nodes') AS node,
      json_each(node.value, '$.semanticOperations') AS operation
    WHERE json_extract(node.value, '$.kind') = 'leaf'
      AND (? IS NULL OR (tree.tree_id = ? AND tree.revision = ?))
    ORDER BY tree.sequence, CAST(node.key AS INTEGER), CAST(operation.key AS INTEGER)
    ON CONFLICT (tree_id, tree_revision, leaf_id, modality, track_id, operation_id)
    DO NOTHING
  `);
  const indexMenuProcedureOperations = sqlite.prepare(`
    INSERT INTO procedure_operations (
      tree_sequence,
      tree_id,
      tree_revision,
      adapter_id,
      leaf_id,
      leaf_validation_status,
      leaf_action_name,
      modality,
      track_id,
      operation_id,
      semantic_actions,
      menu_target_host_id,
      menu_path,
      shortcut_keys,
      operation_kind,
      target_host_id,
      interaction_path,
      surface_operation_id,
      expected_operator_id,
      mcp_server_name,
      mcp_tool_name
    )
    SELECT
      tree.sequence,
      tree.tree_id,
      tree.revision,
      tree.adapter_id,
      json_extract(node.value, '$.id'),
      json_extract(node.value, '$.validation.status'),
      json_extract(node.value, '$.action.name'),
      'menu',
      json_extract(track.value, '$.id'),
      json_extract(operation.value, '$.id'),
      (
        SELECT json_group_array(aligned.semantic_action)
        FROM (
          SELECT json_extract(semantic.value, '$.semanticAction') AS semantic_action
          FROM json_each(operation.value, '$.semanticRefs') AS reference
          JOIN json_each(node.value, '$.semanticOperations') AS semantic
            ON json_extract(semantic.value, '$.id') = reference.value
          ORDER BY CAST(reference.key AS INTEGER)
        ) AS aligned
      ),
      json_extract(operation.value, '$.target.hostId'),
      json_extract(operation.value, '$.path'),
      NULL,
      'menu_interaction',
      json_extract(operation.value, '$.target.hostId'),
      json_extract(operation.value, '$.path'),
      NULL,
      NULL,
      NULL,
      NULL
    FROM procedure_trees AS tree,
      json_each(tree.payload, '$.nodes') AS node,
      json_each(node.value, '$.menuTracks') AS track,
      json_each(track.value, '$.operations') AS operation
    WHERE json_extract(node.value, '$.kind') = 'leaf'
      AND json_extract(track.value, '$.availability') = 'available'
      AND (? IS NULL OR (tree.tree_id = ? AND tree.revision = ?))
    ORDER BY
      tree.sequence,
      CAST(node.key AS INTEGER),
      CAST(track.key AS INTEGER),
      CAST(operation.key AS INTEGER)
    ON CONFLICT (tree_id, tree_revision, leaf_id, modality, track_id, operation_id)
    DO NOTHING
  `);
  const indexShortcutProcedureOperations = sqlite.prepare(`
    INSERT INTO procedure_operations (
      tree_sequence,
      tree_id,
      tree_revision,
      adapter_id,
      leaf_id,
      leaf_validation_status,
      leaf_action_name,
      modality,
      track_id,
      operation_id,
      semantic_actions,
      menu_target_host_id,
      menu_path,
      shortcut_keys,
      operation_kind,
      target_host_id,
      interaction_path,
      surface_operation_id,
      expected_operator_id,
      mcp_server_name,
      mcp_tool_name
    )
    SELECT
      tree.sequence,
      tree.tree_id,
      tree.revision,
      tree.adapter_id,
      json_extract(node.value, '$.id'),
      json_extract(node.value, '$.validation.status'),
      json_extract(node.value, '$.action.name'),
      'shortcut',
      json_extract(track.value, '$.id'),
      json_extract(operation.value, '$.id'),
      (
        SELECT json_group_array(aligned.semantic_action)
        FROM (
          SELECT json_extract(semantic.value, '$.semanticAction') AS semantic_action
          FROM json_each(operation.value, '$.semanticRefs') AS reference
          JOIN json_each(node.value, '$.semanticOperations') AS semantic
            ON json_extract(semantic.value, '$.id') = reference.value
          ORDER BY CAST(reference.key AS INTEGER)
        ) AS aligned
      ),
      NULL,
      NULL,
      CASE
        WHEN json_extract(operation.value, '$.kind') = 'operator_property_update' THEN NULL
        ELSE json_extract(operation.value, '$.keys')
      END,
      CASE
        WHEN json_extract(operation.value, '$.kind') = 'operator_property_update'
          THEN 'operator_property_update'
        WHEN json_extract(operation.value, '$.kind') = 'key_input'
          OR json_extract(operation.value, '$.kind') IS NULL
          THEN 'shortcut_key_input'
        ELSE json_extract(operation.value, '$.kind')
      END,
      CASE
        WHEN json_extract(operation.value, '$.kind') = 'operator_property_update'
          THEN json_extract(operation.value, '$.target.hostId')
        ELSE json_extract(operation.value, '$.opensSurface.hostId')
      END,
      CASE
        WHEN json_extract(operation.value, '$.kind') = 'operator_property_update'
          THEN json_extract(operation.value, '$.path')
        ELSE json_extract(operation.value, '$.selectionPath')
      END,
      CASE
        WHEN json_extract(operation.value, '$.kind') = 'operator_property_update'
          THEN json_extract(operation.value, '$.surfaceOperationId')
        WHEN json_extract(operation.value, '$.opensSurface') IS NOT NULL
          THEN json_extract(operation.value, '$.id')
        ELSE json_extract(operation.value, '$.closesSurfaceOperationId')
      END,
      CASE
        WHEN json_extract(operation.value, '$.opensSurface.expectedOperatorId') IS NOT NULL
          THEN json_extract(operation.value, '$.opensSurface.expectedOperatorId')
        ELSE (
          SELECT json_extract(surface.value, '$.opensSurface.expectedOperatorId')
          FROM json_each(track.value, '$.operations') AS surface
          WHERE json_extract(surface.value, '$.id') = COALESCE(
            json_extract(operation.value, '$.surfaceOperationId'),
            json_extract(operation.value, '$.closesSurfaceOperationId')
          )
          LIMIT 1
        )
      END,
      NULL,
      NULL
    FROM procedure_trees AS tree,
      json_each(tree.payload, '$.nodes') AS node,
      json_each(node.value, '$.shortcutTracks') AS track,
      json_each(track.value, '$.operations') AS operation
    WHERE json_extract(node.value, '$.kind') = 'leaf'
      AND json_extract(track.value, '$.availability') = 'available'
      AND (? IS NULL OR (tree.tree_id = ? AND tree.revision = ?))
    ORDER BY
      tree.sequence,
      CAST(node.key AS INTEGER),
      CAST(track.key AS INTEGER),
      CAST(operation.key AS INTEGER)
    ON CONFLICT (tree_id, tree_revision, leaf_id, modality, track_id, operation_id)
    DO NOTHING
  `);
  const indexMcpProcedureOperations = sqlite.prepare(`
    INSERT INTO procedure_operations (
      tree_sequence,
      tree_id,
      tree_revision,
      adapter_id,
      leaf_id,
      leaf_validation_status,
      leaf_action_name,
      modality,
      track_id,
      operation_id,
      semantic_actions,
      menu_target_host_id,
      menu_path,
      shortcut_keys,
      operation_kind,
      target_host_id,
      interaction_path,
      surface_operation_id,
      expected_operator_id,
      mcp_server_name,
      mcp_tool_name
    )
    SELECT
      tree.sequence,
      tree.tree_id,
      tree.revision,
      tree.adapter_id,
      json_extract(node.value, '$.id'),
      json_extract(node.value, '$.validation.status'),
      json_extract(node.value, '$.action.name'),
      'mcp',
      json_extract(track.value, '$.id'),
      json_extract(operation.value, '$.id'),
      (
        SELECT json_group_array(aligned.semantic_action)
        FROM (
          SELECT json_extract(semantic.value, '$.semanticAction') AS semantic_action
          FROM json_each(operation.value, '$.semanticRefs') AS reference
          JOIN json_each(node.value, '$.semanticOperations') AS semantic
            ON json_extract(semantic.value, '$.id') = reference.value
          ORDER BY CAST(reference.key AS INTEGER)
        ) AS aligned
      ),
      NULL,
      NULL,
      NULL,
      'mcp_call',
      NULL,
      NULL,
      NULL,
      NULL,
      json_extract(operation.value, '$.serverName'),
      json_extract(operation.value, '$.toolName')
    FROM procedure_trees AS tree,
      json_each(tree.payload, '$.nodes') AS node,
      json_each(node.value, '$.mcpTracks') AS track,
      json_each(track.value, '$.operations') AS operation
    WHERE json_extract(node.value, '$.kind') = 'leaf'
      AND json_extract(track.value, '$.availability') = 'available'
      AND (? IS NULL OR (tree.tree_id = ? AND tree.revision = ?))
    ORDER BY
      tree.sequence,
      CAST(node.key AS INTEGER),
      CAST(track.key AS INTEGER),
      CAST(operation.key AS INTEGER)
    ON CONFLICT (tree_id, tree_revision, leaf_id, modality, track_id, operation_id)
    DO NOTHING
  `);
  const indexProcedureOperations = (treeId: string | null, revision: number | null): void => {
    const parameters =
      treeId === null ? ([null, null, null] as const) : ([treeId, treeId, revision] as const);
    indexSemanticProcedureOperations.run(...parameters);
    indexMenuProcedureOperations.run(...parameters);
    indexShortcutProcedureOperations.run(...parameters);
    indexMcpProcedureOperations.run(...parameters);
  };
  const searchProcedureOperationRows = sqlite.prepare(`
    SELECT
      sequence,
      tree_sequence,
      tree_id,
      tree_revision,
      adapter_id,
      leaf_id,
      leaf_validation_status,
      leaf_action_name,
      modality,
      track_id,
      operation_id,
      semantic_actions,
      menu_target_host_id,
      menu_path,
      shortcut_keys,
      operation_kind,
      target_host_id,
      interaction_path,
      surface_operation_id,
      expected_operator_id,
      mcp_server_name,
      mcp_tool_name
    FROM procedure_operations AS indexed
    WHERE indexed.sequence > ?
      AND (? IS NULL OR indexed.tree_id = ?)
      AND (? IS NULL OR indexed.tree_revision = ?)
      AND (? IS NULL OR indexed.adapter_id = ?)
      AND (? IS NULL OR indexed.leaf_id = ?)
      AND (? IS NULL OR indexed.operation_id = ?)
      AND (? IS NULL OR indexed.modality = ?)
      AND (? IS NULL OR indexed.operation_kind = ?)
      AND (? IS NULL OR indexed.leaf_validation_status = ?)
      AND (? IS NULL OR indexed.leaf_action_name = ?)
      AND (
        ? IS NULL OR EXISTS (
          SELECT 1
          FROM json_each(indexed.semantic_actions) AS semantic
          WHERE semantic.value = ?
        )
      )
      AND (? IS NULL OR indexed.menu_target_host_id = ?)
      AND (? IS NULL OR indexed.menu_path = ?)
      AND (? IS NULL OR indexed.shortcut_keys = ?)
      AND (? IS NULL OR indexed.target_host_id = ?)
      AND (? IS NULL OR indexed.interaction_path = ?)
      AND (? IS NULL OR indexed.surface_operation_id = ?)
      AND (? IS NULL OR indexed.expected_operator_id = ?)
      AND (? IS NULL OR indexed.mcp_server_name = ?)
      AND (? IS NULL OR indexed.mcp_tool_name = ?)
    ORDER BY indexed.sequence
    LIMIT ?
  `);

  sqlite.exec('BEGIN IMMEDIATE;');
  try {
    indexProcedureOperations(null, null);
    sqlite.exec('COMMIT;');
  } catch (error) {
    sqlite.exec('ROLLBACK;');
    throw error;
  }
  const insertGuideProposal = sqlite.prepare(`
    INSERT INTO guide_proposals (
      proposal_id,
      target_adapter_id,
      plan_id,
      plan_revision,
      proposed_at,
      payload
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  const findPendingGuideProposal = sqlite.prepare(`
    SELECT proposal.payload
    FROM guide_proposals AS proposal
    WHERE proposal.target_adapter_id = ?
      AND (
        json_extract(proposal.payload, '$.targetInstanceId') IS NULL
        OR json_extract(proposal.payload, '$.targetInstanceId') = ?
      )
      AND NOT EXISTS (
      SELECT 1
      FROM guide_proposal_decisions AS decision
      WHERE decision.proposal_id = proposal.proposal_id
        AND decision.adapter_id = ?
        AND decision.instance_id = ?
      )
    ORDER BY proposal.rowid DESC
    LIMIT 1
  `);
  const findAnyUnresolvedTargetedGuideProposalForAdapter = sqlite.prepare(`
    SELECT proposal.proposal_id
    FROM guide_proposals AS proposal
    WHERE proposal.target_adapter_id = ?
      AND json_extract(proposal.payload, '$.targetInstanceId') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM guide_proposal_decisions AS decision
        WHERE decision.proposal_id = proposal.proposal_id
          AND decision.adapter_id = proposal.target_adapter_id
          AND decision.instance_id = json_extract(proposal.payload, '$.targetInstanceId')
      )
    LIMIT 1
  `);
  const findRevisionRequest = sqlite.prepare(`
    SELECT adapter_id, instance_id, base_plan_id, base_revision, payload
    FROM guide_revision_requests
    WHERE request_id = ?
  `);
  const findGoalRequest = sqlite.prepare(`
    SELECT adapter_id, catalog_version, instance_id, plan_id, payload
    FROM guide_goal_requests
    WHERE request_id = ?
  `);
  const insertGoalRequest = sqlite.prepare(`
    INSERT INTO guide_goal_requests (
      request_id,
      adapter_id,
      catalog_version,
      instance_id,
      plan_id,
      occurred_at,
      payload
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const listPendingGoalRequests = sqlite.prepare(`
    SELECT request.payload
    FROM guide_goal_requests AS request
    LEFT JOIN guide_goal_request_proposals AS linked
      ON linked.request_id = request.request_id
    WHERE linked.request_id IS NULL
      AND (? IS NULL OR request.adapter_id = ?)
    ORDER BY request.occurred_at, request.request_id
    LIMIT ?
  `);
  const findPendingGoalRequestForTarget = sqlite.prepare(`
    SELECT request.request_id
    FROM guide_goal_requests AS request
    LEFT JOIN guide_goal_request_proposals AS linked
      ON linked.request_id = request.request_id
    WHERE linked.request_id IS NULL
      AND request.adapter_id = ?
      AND request.instance_id = ?
    LIMIT 1
  `);
  const findGoalRequestProposal = sqlite.prepare(`
    SELECT proposal_id
    FROM guide_goal_request_proposals
    WHERE request_id = ?
  `);
  const findGoalRequestProposalPayload = sqlite.prepare(`
    SELECT proposal.payload
    FROM guide_goal_request_proposals AS linked
    JOIN guide_proposals AS proposal ON proposal.proposal_id = linked.proposal_id
    WHERE linked.request_id = ?
  `);
  const findGoalRequestProposalByGenerationPayload = sqlite.prepare(`
    SELECT proposal.payload
    FROM guide_goal_request_proposals AS linked
    JOIN guide_proposals AS proposal ON proposal.proposal_id = linked.proposal_id
    WHERE linked.generation_request_id = ?
  `);
  const insertGoalRequestProposal = sqlite.prepare(`
    INSERT INTO guide_goal_request_proposals (
      request_id,
      proposal_id,
      linked_at,
      generation_request_id
    ) VALUES (?, ?, ?, ?)
  `);
  const insertRevisionRequest = sqlite.prepare(`
    INSERT INTO guide_revision_requests (
      request_id,
      adapter_id,
      instance_id,
      base_plan_id,
      base_revision,
      occurred_at,
      payload
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const listPendingRevisionRequests = sqlite.prepare(`
    SELECT request.payload
    FROM guide_revision_requests AS request
    LEFT JOIN guide_revision_request_proposals AS linked
      ON linked.request_id = request.request_id
    WHERE linked.request_id IS NULL
      AND (? IS NULL OR request.adapter_id = ?)
    ORDER BY request.occurred_at, request.request_id
    LIMIT ?
  `);
  const findRevisionRequestProposal = sqlite.prepare(`
    SELECT proposal_id
    FROM guide_revision_request_proposals
    WHERE request_id = ?
  `);
  const findRevisionRequestProposalPayload = sqlite.prepare(`
    SELECT proposal.payload
    FROM guide_revision_request_proposals AS linked
    JOIN guide_proposals AS proposal ON proposal.proposal_id = linked.proposal_id
    WHERE linked.request_id = ?
  `);
  const findRevisionThreadHead = sqlite.prepare(`
    SELECT payload
    FROM guide_revision_requests
    WHERE json_extract(payload, '$.revisionThread.threadId') = ?
    ORDER BY CAST(json_extract(payload, '$.revisionThread.turn') AS INTEGER) DESC
    LIMIT 1
  `);
  const listRevisionThreadTurns = sqlite.prepare(`
    SELECT
      request.payload AS request_payload,
      proposal.payload AS proposal_payload,
      decision.payload AS decision_payload
    FROM guide_revision_requests AS request
    LEFT JOIN guide_revision_request_proposals AS linked
      ON linked.request_id = request.request_id
    LEFT JOIN guide_proposals AS proposal
      ON proposal.proposal_id = linked.proposal_id
    LEFT JOIN guide_proposal_decisions AS decision
      ON decision.proposal_id = proposal.proposal_id
      AND decision.adapter_id = request.adapter_id
      AND decision.instance_id = request.instance_id
    WHERE json_extract(request.payload, '$.revisionThread.threadId') = ?
      AND request.adapter_id = ?
      AND request.instance_id = ?
      AND (
        ? IS NULL
        OR CAST(json_extract(request.payload, '$.revisionThread.turn') AS INTEGER) < ?
      )
    ORDER BY CAST(json_extract(request.payload, '$.revisionThread.turn') AS INTEGER) DESC
    LIMIT ?
  `);
  const listRevisionThreadHeads = sqlite.prepare(`
    SELECT
      request.payload AS request_payload,
      proposal.payload AS proposal_payload,
      decision.payload AS decision_payload
    FROM guide_revision_requests AS request
    LEFT JOIN guide_revision_request_proposals AS linked
      ON linked.request_id = request.request_id
    LEFT JOIN guide_proposals AS proposal
      ON proposal.proposal_id = linked.proposal_id
    LEFT JOIN guide_proposal_decisions AS decision
      ON decision.proposal_id = proposal.proposal_id
      AND decision.adapter_id = request.adapter_id
      AND decision.instance_id = request.instance_id
    WHERE request.adapter_id = ?
      AND request.instance_id = ?
      AND request.base_plan_id = ?
      AND json_extract(request.payload, '$.revisionThread.threadId') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM guide_revision_requests AS newer
        WHERE json_extract(newer.payload, '$.revisionThread.threadId') =
              json_extract(request.payload, '$.revisionThread.threadId')
          AND CAST(json_extract(newer.payload, '$.revisionThread.turn') AS INTEGER) >
              CAST(json_extract(request.payload, '$.revisionThread.turn') AS INTEGER)
      )
    ORDER BY request.occurred_at DESC, request.request_id DESC
    LIMIT ?
  `);
  const insertRevisionRequestProposal = sqlite.prepare(`
    INSERT INTO guide_revision_request_proposals (request_id, proposal_id, linked_at)
    VALUES (?, ?, ?)
  `);
  const listLatestGuideRevisions = sqlite.prepare(`
    SELECT plan_id, MAX(plan_revision) AS revision
    FROM guide_proposals
    GROUP BY plan_id
    ORDER BY plan_id
  `);
  const findGuideProposalTarget = sqlite.prepare(`
    SELECT target_adapter_id
    FROM guide_proposals
    WHERE proposal_id = ?
  `);
  const findGuideProposalDecisionById = sqlite.prepare(`
    SELECT proposal_id, adapter_id, instance_id, decision, payload
    FROM guide_proposal_decisions
    WHERE decision_id = ?
  `);
  const findGuideProposalDecision = sqlite.prepare(`
    SELECT decision, payload
    FROM guide_proposal_decisions
    WHERE proposal_id = ? AND adapter_id = ? AND instance_id = ?
  `);
  const insertGuideProposalDecision = sqlite.prepare(`
    INSERT INTO guide_proposal_decisions (
      decision_id,
      proposal_id,
      adapter_id,
      instance_id,
      decision,
      payload
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  const findStateReport = sqlite.prepare(`
    SELECT adapter_id, instance_id, sequence, payload
    FROM companion_state_reports
    WHERE report_id = ?
  `);
  const findLatestState = sqlite.prepare(`
    SELECT report_id, sequence
    FROM companion_latest_states
    WHERE adapter_id = ? AND instance_id = ?
  `);
  const insertStateReport = sqlite.prepare(`
    INSERT INTO companion_state_reports (report_id, adapter_id, instance_id, sequence, payload)
    VALUES (?, ?, ?, ?, ?)
  `);
  const upsertLatestState = sqlite.prepare(`
    INSERT INTO companion_latest_states (adapter_id, instance_id, report_id, sequence, payload)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(adapter_id, instance_id) DO UPDATE SET
      report_id = excluded.report_id,
      sequence = excluded.sequence,
      payload = excluded.payload
  `);
  const listLatestStates = sqlite.prepare(`
    SELECT payload FROM companion_latest_states ORDER BY adapter_id, instance_id
  `);
  const findCompanionReplanRun = sqlite.prepare(`
    SELECT status, payload
    FROM companion_replan_runs
    WHERE generation_request_id = ?
  `);
  const findActiveCompanionReplanRun = sqlite.prepare(`
    SELECT generation_request_id
    FROM companion_replan_runs
    WHERE target_adapter_id = ?
      AND target_instance_id = ?
      AND status IN ('queued', 'generating')
    LIMIT 1
  `);
  const insertCompanionReplanRun = sqlite.prepare(`
    INSERT INTO companion_replan_runs (
      generation_request_id,
      revision_request_id,
      target_adapter_id,
      target_instance_id,
      status,
      updated_at,
      payload
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const updateCompanionReplanRun = sqlite.prepare(`
    UPDATE companion_replan_runs
    SET status = ?, updated_at = ?, payload = ?
    WHERE generation_request_id = ? AND status = ?
  `);
  const listNonterminalCompanionReplanRunRows = sqlite.prepare(`
    SELECT payload
    FROM companion_replan_runs
    WHERE status IN ('queued', 'generating')
    ORDER BY rowid
  `);
  const findCompanionInitialPlanRun = sqlite.prepare(`
    SELECT status, payload
    FROM companion_initial_plan_runs
    WHERE generation_request_id = ?
  `);
  const findActiveCompanionInitialPlanRun = sqlite.prepare(`
    SELECT generation_request_id
    FROM companion_initial_plan_runs
    WHERE target_adapter_id = ?
      AND target_instance_id = ?
      AND status IN ('queued', 'generating')
    LIMIT 1
  `);
  const insertCompanionInitialPlanRun = sqlite.prepare(`
    INSERT INTO companion_initial_plan_runs (
      generation_request_id,
      goal_request_id,
      target_adapter_id,
      target_instance_id,
      status,
      updated_at,
      payload
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const updateCompanionInitialPlanRun = sqlite.prepare(`
    UPDATE companion_initial_plan_runs
    SET status = ?, updated_at = ?, payload = ?
    WHERE generation_request_id = ? AND status = ?
  `);
  const listNonterminalCompanionInitialPlanRunRows = sqlite.prepare(`
    SELECT payload
    FROM companion_initial_plan_runs
    WHERE status IN ('queued', 'generating')
    ORDER BY rowid
  `);
  const findCompanionDialogueRun = sqlite.prepare(`
    SELECT status, payload
    FROM companion_dialogue_runs
    WHERE dialogue_request_id = ?
  `);
  const findCompanionDialogueRunByRevisionRequest = sqlite.prepare(`
    SELECT dialogue_request_id
    FROM companion_dialogue_runs
    WHERE revision_request_id = ?
  `);
  const findCompanionDialogueRunByReplanGenerationRequest = sqlite.prepare(`
    SELECT dialogue_request_id
    FROM companion_dialogue_runs
    WHERE replan_generation_request_id = ?
  `);
  const findActiveCompanionDialogueRun = sqlite.prepare(`
    SELECT dialogue_request_id, revision_request_id
    FROM companion_dialogue_runs
    WHERE target_adapter_id = ?
      AND target_instance_id = ?
      AND status IN ('queued', 'streaming', 'replanning')
    LIMIT 1
  `);
  const insertCompanionDialogueRun = sqlite.prepare(`
    INSERT INTO companion_dialogue_runs (
      dialogue_request_id,
      revision_request_id,
      replan_generation_request_id,
      target_adapter_id,
      target_instance_id,
      status,
      assistant_message_revision,
      updated_at,
      payload
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateCompanionDialogueRun = sqlite.prepare(`
    UPDATE companion_dialogue_runs
    SET status = ?, assistant_message_revision = ?, updated_at = ?, payload = ?
    WHERE dialogue_request_id = ? AND status = ?
  `);
  const listNonterminalCompanionDialogueRunRows = sqlite.prepare(`
    SELECT payload
    FROM companion_dialogue_runs
    WHERE status IN ('queued', 'streaming', 'replanning')
    ORDER BY rowid
  `);

  const parseExecutionEventRow = (row: unknown): StoredExecutionEvent => {
    const candidate = row as {
      sequence?: unknown;
      id?: unknown;
      event_type?: unknown;
      payload?: unknown;
      created_at?: unknown;
    };
    if (
      typeof candidate.sequence !== 'number' ||
      typeof candidate.id !== 'string' ||
      typeof candidate.event_type !== 'string' ||
      typeof candidate.payload !== 'string' ||
      typeof candidate.created_at !== 'string'
    ) {
      throw new Error('SQLite returned an invalid execution event');
    }
    return {
      sequence: candidate.sequence,
      id: candidate.id,
      eventType: candidate.event_type,
      payload: JSON.parse(candidate.payload) as unknown,
      createdAt: candidate.created_at,
    };
  };

  const parseProcedureTreeSummaryRow = (row: unknown): StoredProcedureTreeSummary => {
    const candidate = row as {
      sequence?: unknown;
      tree_id?: unknown;
      revision?: unknown;
      title?: unknown;
      adapter_id?: unknown;
      action_catalog_version?: unknown;
      interaction_catalog_version?: unknown;
      host_version_range?: unknown;
      content_sha256?: unknown;
      stored_at?: unknown;
    };
    if (
      typeof candidate.sequence !== 'number' ||
      typeof candidate.tree_id !== 'string' ||
      typeof candidate.revision !== 'number' ||
      typeof candidate.title !== 'string' ||
      typeof candidate.adapter_id !== 'string' ||
      typeof candidate.action_catalog_version !== 'string' ||
      typeof candidate.interaction_catalog_version !== 'string' ||
      typeof candidate.host_version_range !== 'string' ||
      typeof candidate.content_sha256 !== 'string' ||
      typeof candidate.stored_at !== 'string'
    ) {
      throw new Error('SQLite returned an invalid procedure tree summary');
    }
    return {
      sequence: candidate.sequence,
      treeId: candidate.tree_id,
      revision: candidate.revision,
      title: candidate.title,
      adapterId: candidate.adapter_id,
      actionCatalogVersion: candidate.action_catalog_version,
      interactionCatalogVersion: candidate.interaction_catalog_version,
      hostVersionRange: candidate.host_version_range,
      contentSha256: candidate.content_sha256,
      storedAt: candidate.stored_at,
    };
  };

  const parseProcedureTreeRow = (row: unknown): StoredProcedureTreeRecord => {
    const summary = parseProcedureTreeSummaryRow(row);
    const payload = (row as { payload?: unknown }).payload;
    if (typeof payload !== 'string') {
      throw new Error('SQLite returned an invalid procedure tree payload');
    }
    return { ...summary, tree: JSON.parse(payload) as unknown };
  };

  const parseIndexedStringArray = (payload: unknown, field: string): string[] => {
    if (typeof payload !== 'string') {
      throw new Error(`SQLite returned an invalid procedure operation ${field}`);
    }
    const parsed = JSON.parse(payload) as unknown;
    if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== 'string')) {
      throw new Error(`SQLite returned an invalid procedure operation ${field}`);
    }
    return parsed;
  };

  const parseNullableIndexedStringArray = (payload: unknown, field: string): string[] | null =>
    payload === null ? null : parseIndexedStringArray(payload, field);

  const parseProcedureOperationIndexRow = (row: unknown): StoredProcedureOperationIndex => {
    const candidate = row as {
      sequence?: unknown;
      tree_sequence?: unknown;
      tree_id?: unknown;
      tree_revision?: unknown;
      adapter_id?: unknown;
      leaf_id?: unknown;
      leaf_validation_status?: unknown;
      leaf_action_name?: unknown;
      modality?: unknown;
      operation_kind?: unknown;
      track_id?: unknown;
      operation_id?: unknown;
      semantic_actions?: unknown;
      menu_target_host_id?: unknown;
      menu_path?: unknown;
      shortcut_keys?: unknown;
      target_host_id?: unknown;
      interaction_path?: unknown;
      surface_operation_id?: unknown;
      expected_operator_id?: unknown;
      mcp_server_name?: unknown;
      mcp_tool_name?: unknown;
    };
    if (
      typeof candidate.sequence !== 'number' ||
      !Number.isSafeInteger(candidate.sequence) ||
      candidate.sequence < 1 ||
      typeof candidate.tree_sequence !== 'number' ||
      !Number.isSafeInteger(candidate.tree_sequence) ||
      candidate.tree_sequence < 1 ||
      typeof candidate.tree_id !== 'string' ||
      typeof candidate.tree_revision !== 'number' ||
      !Number.isSafeInteger(candidate.tree_revision) ||
      candidate.tree_revision < 1 ||
      typeof candidate.adapter_id !== 'string' ||
      typeof candidate.leaf_id !== 'string' ||
      !['candidate', 'verified', 'rejected'].includes(String(candidate.leaf_validation_status)) ||
      (candidate.leaf_action_name !== null && typeof candidate.leaf_action_name !== 'string') ||
      !['semantic', 'menu', 'shortcut', 'mcp'].includes(String(candidate.modality)) ||
      ![
        'semantic_action',
        'menu_interaction',
        'shortcut_key_input',
        'operator_property_update',
        'mcp_call',
      ].includes(String(candidate.operation_kind)) ||
      typeof candidate.track_id !== 'string' ||
      typeof candidate.operation_id !== 'string' ||
      (candidate.menu_target_host_id !== null &&
        typeof candidate.menu_target_host_id !== 'string') ||
      (candidate.target_host_id !== null && typeof candidate.target_host_id !== 'string') ||
      (candidate.surface_operation_id !== null &&
        typeof candidate.surface_operation_id !== 'string') ||
      (candidate.expected_operator_id !== null &&
        typeof candidate.expected_operator_id !== 'string') ||
      (candidate.mcp_server_name !== null && typeof candidate.mcp_server_name !== 'string') ||
      (candidate.mcp_tool_name !== null && typeof candidate.mcp_tool_name !== 'string')
    ) {
      throw new Error('SQLite returned an invalid procedure operation index row');
    }
    const modality = candidate.modality as ProcedureOperationIndexModality;
    const semanticActions = parseIndexedStringArray(candidate.semantic_actions, 'semantic actions');
    const menuPath = parseNullableIndexedStringArray(candidate.menu_path, 'menu path');
    const shortcutKeys = parseNullableIndexedStringArray(candidate.shortcut_keys, 'shortcut keys');
    const interactionPath = parseNullableIndexedStringArray(
      candidate.interaction_path,
      'interaction path',
    );
    const trackId = candidate.track_id.length === 0 ? null : candidate.track_id;
    const operationKind = candidate.operation_kind as ProcedureOperationIndexKind;
    const contextIsValid =
      semanticActions.length > 0 &&
      ((modality === 'semantic' &&
        operationKind === 'semantic_action' &&
        trackId === null &&
        candidate.menu_target_host_id === null &&
        menuPath === null &&
        shortcutKeys === null &&
        candidate.target_host_id === null &&
        interactionPath === null &&
        candidate.surface_operation_id === null &&
        candidate.expected_operator_id === null &&
        candidate.mcp_server_name === null &&
        candidate.mcp_tool_name === null) ||
        (modality === 'menu' &&
          operationKind === 'menu_interaction' &&
          trackId !== null &&
          candidate.menu_target_host_id !== null &&
          candidate.menu_target_host_id.length > 0 &&
          menuPath !== null &&
          menuPath.length > 0 &&
          shortcutKeys === null &&
          candidate.target_host_id === candidate.menu_target_host_id &&
          JSON.stringify(interactionPath) === JSON.stringify(menuPath) &&
          candidate.surface_operation_id === null &&
          candidate.expected_operator_id === null &&
          candidate.mcp_server_name === null &&
          candidate.mcp_tool_name === null) ||
        (modality === 'shortcut' &&
          operationKind === 'shortcut_key_input' &&
          trackId !== null &&
          candidate.menu_target_host_id === null &&
          menuPath === null &&
          shortcutKeys !== null &&
          shortcutKeys.length > 0 &&
          ((candidate.target_host_id === null &&
            candidate.surface_operation_id === null &&
            candidate.expected_operator_id === null) ||
            (candidate.target_host_id === null &&
              candidate.surface_operation_id !== null &&
              candidate.surface_operation_id.length > 0 &&
              candidate.expected_operator_id !== null &&
              candidate.expected_operator_id.length > 0) ||
            (candidate.target_host_id !== null &&
              candidate.target_host_id.length > 0 &&
              candidate.surface_operation_id !== null &&
              candidate.surface_operation_id.length > 0 &&
              candidate.expected_operator_id !== null &&
              candidate.expected_operator_id.length > 0)) &&
          candidate.mcp_server_name === null &&
          candidate.mcp_tool_name === null) ||
        (modality === 'shortcut' &&
          operationKind === 'operator_property_update' &&
          trackId !== null &&
          candidate.menu_target_host_id === null &&
          menuPath === null &&
          shortcutKeys === null &&
          candidate.target_host_id !== null &&
          candidate.target_host_id.length > 0 &&
          interactionPath !== null &&
          interactionPath.length > 0 &&
          candidate.surface_operation_id !== null &&
          candidate.surface_operation_id.length > 0 &&
          candidate.expected_operator_id !== null &&
          candidate.expected_operator_id.length > 0 &&
          candidate.mcp_server_name === null &&
          candidate.mcp_tool_name === null) ||
        (modality === 'mcp' &&
          operationKind === 'mcp_call' &&
          trackId !== null &&
          candidate.menu_target_host_id === null &&
          menuPath === null &&
          shortcutKeys === null &&
          candidate.target_host_id === null &&
          interactionPath === null &&
          candidate.surface_operation_id === null &&
          candidate.expected_operator_id === null &&
          candidate.mcp_server_name !== null &&
          candidate.mcp_tool_name !== null));
    if (!contextIsValid) {
      throw new Error('SQLite returned a context-inconsistent procedure operation index row');
    }
    return {
      sequence: candidate.sequence,
      treeSequence: candidate.tree_sequence,
      treeId: candidate.tree_id,
      treeRevision: candidate.tree_revision,
      adapterId: candidate.adapter_id,
      leafId: candidate.leaf_id,
      validationStatus: candidate.leaf_validation_status as 'candidate' | 'verified' | 'rejected',
      actionName: candidate.leaf_action_name,
      modality,
      operationKind,
      trackId,
      operationId: candidate.operation_id,
      semanticActions,
      menuTargetHostId: candidate.menu_target_host_id,
      menuPath,
      shortcutKeys,
      targetHostId: candidate.target_host_id,
      interactionPath,
      surfaceOperationId: candidate.surface_operation_id,
      expectedOperatorId: candidate.expected_operator_id,
      mcpServerName: candidate.mcp_server_name,
      mcpToolName: candidate.mcp_tool_name,
    };
  };

  return {
    appendEvent(event) {
      insertEvent.run(
        event.id,
        event.eventType,
        canonicalJson(event.payload),
        event.createdAt ?? new Date().toISOString(),
      );
    },
    countEvents() {
      const value = countEvents.get()?.value;
      if (typeof value !== 'number') {
        throw new Error('SQLite returned an invalid event count');
      }
      return value;
    },
    listExecutionEvents(afterSequence, limit) {
      if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
        throw new Error('Execution event cursor must be a non-negative safe integer');
      }
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
        throw new Error('Execution event limit must be an integer between 1 and 10000');
      }
      return listEvents.all(afterSequence, limit).map(parseExecutionEventRow);
    },
    listExecutionEventsByTypes(eventTypes) {
      if (eventTypes.length < 1 || eventTypes.length > 100) {
        throw new Error('Execution event type query must contain between 1 and 100 values');
      }
      if (
        eventTypes.some((eventType) => eventType.trim().length === 0) ||
        new Set(eventTypes).size !== eventTypes.length
      ) {
        throw new Error('Execution event type query values must be nonempty and unique');
      }
      const placeholders = eventTypes.map(() => '?').join(', ');
      return sqlite
        .prepare(
          `SELECT sequence, id, event_type, payload, created_at
           FROM execution_events
           WHERE event_type IN (${placeholders})
           ORDER BY sequence`,
        )
        .all(...eventTypes)
        .map(parseExecutionEventRow);
    },
    getExecutionEvent(id) {
      if (id.trim().length === 0) {
        throw new Error('Execution event id must be nonempty');
      }
      const row = findEvent.get(id);
      return row === undefined ? null : parseExecutionEventRow(row);
    },
    recordProcedureTree(input) {
      if (
        input.treeId.trim().length === 0 ||
        input.title.trim().length === 0 ||
        input.adapterId.trim().length === 0 ||
        input.actionCatalogVersion.trim().length === 0 ||
        input.interactionCatalogVersion.trim().length === 0 ||
        input.hostVersionRange.trim().length === 0
      ) {
        throw new Error('Procedure tree identity fields must be nonempty');
      }
      if (!Number.isSafeInteger(input.revision) || input.revision < 1) {
        throw new Error('Procedure tree revision must be a positive safe integer');
      }
      if (!/^[a-f0-9]{64}$/.test(input.contentSha256)) {
        throw new Error('Procedure tree content SHA-256 must be lowercase hexadecimal');
      }
      validateShortcutSurfaceLifecycle(input.tree);
      const payload = canonicalJson(input.tree);
      sqlite.exec('BEGIN IMMEDIATE;');
      try {
        const latestRow = findLatestProcedureTree.get(input.treeId);
        const latest = latestRow === undefined ? null : parseProcedureTreeRow(latestRow);
        const existingRow = findProcedureTree.get(input.treeId, input.revision);
        if (existingRow !== undefined) {
          const existing = parseProcedureTreeRow(existingRow);
          const duplicate =
            existing.title === input.title &&
            existing.adapterId === input.adapterId &&
            existing.actionCatalogVersion === input.actionCatalogVersion &&
            existing.interactionCatalogVersion === input.interactionCatalogVersion &&
            existing.hostVersionRange === input.hostVersionRange &&
            existing.contentSha256 === input.contentSha256 &&
            canonicalJson(existing.tree) === payload;
          sqlite.exec('COMMIT;');
          return duplicate
            ? { result: 'duplicate', record: existing }
            : { result: 'conflict', latestRevision: latest?.revision ?? existing.revision };
        }
        if (latest !== null && latest.adapterId !== input.adapterId) {
          sqlite.exec('COMMIT;');
          return { result: 'conflict', latestRevision: latest.revision };
        }
        if (latest !== null && input.revision <= latest.revision) {
          sqlite.exec('COMMIT;');
          return { result: 'stale', latestRevision: latest.revision };
        }

        const storedAt = new Date().toISOString();
        insertProcedureTree.run(
          input.treeId,
          input.revision,
          input.title,
          input.adapterId,
          input.actionCatalogVersion,
          input.interactionCatalogVersion,
          input.hostVersionRange,
          input.contentSha256,
          storedAt,
          payload,
        );
        indexProcedureOperations(input.treeId, input.revision);
        insertEvent.run(
          `procedure-tree:${input.treeId}:${input.revision}`,
          'procedure.tree.stored',
          canonicalJson({
            treeId: input.treeId,
            revision: input.revision,
            title: input.title,
            adapterId: input.adapterId,
            actionCatalogVersion: input.actionCatalogVersion,
            interactionCatalogVersion: input.interactionCatalogVersion,
            hostVersionRange: input.hostVersionRange,
            contentSha256: input.contentSha256,
            storedAt,
          }),
          storedAt,
        );
        const storedRow = findProcedureTree.get(input.treeId, input.revision);
        if (storedRow === undefined) {
          throw new Error('Procedure tree insertion could not be read back');
        }
        const record = parseProcedureTreeRow(storedRow);
        sqlite.exec('COMMIT;');
        return { result: 'accepted', record };
      } catch (error) {
        sqlite.exec('ROLLBACK;');
        throw error;
      }
    },
    getProcedureTree(treeId, revision) {
      if (treeId.trim().length === 0) {
        throw new Error('Procedure tree id must be nonempty');
      }
      if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 1)) {
        throw new Error('Procedure tree revision must be a positive safe integer');
      }
      const row =
        revision === undefined
          ? findLatestProcedureTree.get(treeId)
          : findProcedureTree.get(treeId, revision);
      return row === undefined ? null : parseProcedureTreeRow(row);
    },
    listProcedureTrees(afterSequence, limit, adapterId) {
      if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
        throw new Error('Procedure tree cursor must be a non-negative safe integer');
      }
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
        throw new Error('Procedure tree limit must be an integer between 1 and 10000');
      }
      if (adapterId !== undefined && adapterId.trim().length === 0) {
        throw new Error('Procedure tree adapter id must be nonempty');
      }
      const rows =
        adapterId === undefined
          ? listProcedureTreeRows.all(afterSequence, limit)
          : listProcedureTreeRowsByAdapter.all(afterSequence, adapterId, limit);
      return rows.map(parseProcedureTreeSummaryRow);
    },
    searchProcedureOperations(input) {
      if (!Number.isSafeInteger(input.afterSequence) || input.afterSequence < 0) {
        throw new Error('Procedure operation cursor must be a non-negative safe integer');
      }
      if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 10_000) {
        throw new Error('Procedure operation limit must be an integer between 1 and 10000');
      }
      if (
        input.treeRevision !== undefined &&
        (!Number.isSafeInteger(input.treeRevision) || input.treeRevision < 1)
      ) {
        throw new Error('Procedure operation tree revision must be a positive safe integer');
      }
      if (input.treeRevision !== undefined && input.treeId === undefined) {
        throw new Error('Procedure operation revision filtering requires a tree id');
      }
      const stringFilters = [
        input.treeId,
        input.adapterId,
        input.leafId,
        input.operationId,
        input.actionName,
        input.semanticAction,
        input.menuTargetHostId,
        input.targetHostId,
        input.surfaceOperationId,
        input.expectedOperatorId,
        input.mcpServerName,
        input.mcpToolName,
      ];
      if (stringFilters.some((value) => value !== undefined && value.trim().length === 0)) {
        throw new Error('Procedure operation search strings must be nonempty');
      }
      const menuPath = input.menuPath === undefined ? null : canonicalJson(input.menuPath);
      const shortcutKeys =
        input.shortcutKeys === undefined ? null : canonicalJson(input.shortcutKeys);
      const interactionPath =
        input.interactionPath === undefined ? null : canonicalJson(input.interactionPath);
      if (input.menuPath !== undefined && input.menuPath.length === 0) {
        throw new Error('Procedure operation menu path must be nonempty');
      }
      if (input.shortcutKeys !== undefined && input.shortcutKeys.length === 0) {
        throw new Error('Procedure operation shortcut keys must be nonempty');
      }
      if (input.interactionPath !== undefined && input.interactionPath.length === 0) {
        throw new Error('Procedure operation interaction path must be nonempty');
      }
      const nullable = <T>(value: T | undefined): T | null => value ?? null;
      return searchProcedureOperationRows
        .all(
          input.afterSequence,
          nullable(input.treeId),
          nullable(input.treeId),
          nullable(input.treeRevision),
          nullable(input.treeRevision),
          nullable(input.adapterId),
          nullable(input.adapterId),
          nullable(input.leafId),
          nullable(input.leafId),
          nullable(input.operationId),
          nullable(input.operationId),
          nullable(input.modality),
          nullable(input.modality),
          nullable(input.operationKind),
          nullable(input.operationKind),
          nullable(input.validationStatus),
          nullable(input.validationStatus),
          nullable(input.actionName),
          nullable(input.actionName),
          nullable(input.semanticAction),
          nullable(input.semanticAction),
          nullable(input.menuTargetHostId),
          nullable(input.menuTargetHostId),
          menuPath,
          menuPath,
          shortcutKeys,
          shortcutKeys,
          nullable(input.targetHostId),
          nullable(input.targetHostId),
          interactionPath,
          interactionPath,
          nullable(input.surfaceOperationId),
          nullable(input.surfaceOperationId),
          nullable(input.expectedOperatorId),
          nullable(input.expectedOperatorId),
          nullable(input.mcpServerName),
          nullable(input.mcpServerName),
          nullable(input.mcpToolName),
          nullable(input.mcpToolName),
          input.limit,
        )
        .map(parseProcedureOperationIndexRow);
    },
    recordGuideProposal(proposal) {
      const payload = canonicalJson(proposal);
      sqlite.exec('BEGIN IMMEDIATE;');
      try {
        const unresolvedProposal =
          proposal.targetInstanceId === undefined
            ? findAnyUnresolvedTargetedGuideProposalForAdapter.get(proposal.targetAdapterId)
            : findPendingGuideProposal.get(
                proposal.targetAdapterId,
                proposal.targetInstanceId,
                proposal.targetAdapterId,
                proposal.targetInstanceId,
              );
        if (unresolvedProposal !== undefined) {
          throw new Error(
            `Guide target already has an unresolved proposal: ${proposal.targetAdapterId}/${proposal.targetInstanceId ?? '*'}`,
          );
        }
        insertGuideProposal.run(
          proposal.proposalId,
          proposal.targetAdapterId,
          proposal.plan.id,
          proposal.plan.revision,
          proposal.proposedAt,
          payload,
        );
        insertEvent.run(
          `guide-proposal:${proposal.proposalId}`,
          'guide.proposal.created',
          payload,
          new Date().toISOString(),
        );
        sqlite.exec('COMMIT;');
      } catch (error) {
        sqlite.exec('ROLLBACK;');
        throw error;
      }
    },
    recordGuideGoalProposal(proposal, goalRequestId, generationRequestId) {
      const payload = canonicalJson(proposal);
      sqlite.exec('BEGIN IMMEDIATE;');
      try {
        const request = findGoalRequest.get(goalRequestId) as
          | {
              adapter_id: string;
              catalog_version: string;
              instance_id: string;
              plan_id: string;
            }
          | undefined;
        if (request === undefined) {
          throw new Error(`Unknown guide goal request: ${goalRequestId}`);
        }
        if (findGoalRequestProposal.get(goalRequestId) !== undefined) {
          throw new Error(`Guide goal request already has a proposal: ${goalRequestId}`);
        }
        if (
          proposal.goalRequestId !== goalRequestId ||
          proposal.targetAdapterId !== request.adapter_id ||
          proposal.targetInstanceId !== request.instance_id ||
          proposal.catalogVersion !== request.catalog_version ||
          proposal.plan.id !== request.plan_id
        ) {
          throw new Error(`Guide goal proposal does not match request: ${goalRequestId}`);
        }
        if (generationRequestId !== undefined) {
          const run = findCompanionInitialPlanRun.get(generationRequestId) as
            { payload?: unknown } | undefined;
          if (run === undefined || typeof run.payload !== 'string') {
            throw new Error(`Unknown companion initial plan run: ${generationRequestId}`);
          }
          const storedRun = JSON.parse(run.payload) as CompanionInitialPlanRunInput;
          if (
            storedRun.goalRequestId !== goalRequestId ||
            storedRun.targetAdapterId !== request.adapter_id ||
            storedRun.targetInstanceId !== request.instance_id
          ) {
            throw new Error(
              `Companion initial plan run does not match goal request: ${generationRequestId}`,
            );
          }
        }
        if (
          findPendingGuideProposal.get(
            request.adapter_id,
            request.instance_id,
            request.adapter_id,
            request.instance_id,
          ) !== undefined
        ) {
          throw new Error(
            `Guide target already has an unresolved proposal: ${request.adapter_id}/${request.instance_id}`,
          );
        }
        insertGuideProposal.run(
          proposal.proposalId,
          proposal.targetAdapterId,
          proposal.plan.id,
          proposal.plan.revision,
          proposal.proposedAt,
          payload,
        );
        const linkedAt = new Date().toISOString();
        insertEvent.run(
          `guide-proposal:${proposal.proposalId}`,
          'guide.proposal.created',
          payload,
          linkedAt,
        );
        insertGoalRequestProposal.run(
          goalRequestId,
          proposal.proposalId,
          linkedAt,
          generationRequestId ?? null,
        );
        insertEvent.run(
          `guide-goal-proposal:${goalRequestId}`,
          'guide.goal.proposed',
          canonicalJson({ requestId: goalRequestId, proposalId: proposal.proposalId }),
          linkedAt,
        );
        if (generationRequestId !== undefined) {
          insertEvent.run(
            `planning-generation-proposed:${generationRequestId}`,
            'planning.provider.generation.proposed',
            canonicalJson({
              generationRequestId,
              goalRequestId,
              proposalId: proposal.proposalId,
              occurredAt: linkedAt,
            }),
            linkedAt,
          );
        }
        sqlite.exec('COMMIT;');
      } catch (error) {
        sqlite.exec('ROLLBACK;');
        throw error;
      }
    },
    recordGuideReplanProposal(proposal, revisionRequestId, generationRequestId) {
      const payload = canonicalJson(proposal);
      sqlite.exec('BEGIN IMMEDIATE;');
      try {
        const request = findRevisionRequest.get(revisionRequestId) as
          { adapter_id: string; instance_id: string } | undefined;
        if (request === undefined) {
          throw new Error(`Unknown guide revision request: ${revisionRequestId}`);
        }
        if (findRevisionRequestProposal.get(revisionRequestId) !== undefined) {
          throw new Error(`Guide revision request already has a proposal: ${revisionRequestId}`);
        }
        const targetInstanceId = proposal.targetInstanceId ?? request.instance_id;
        if (
          findPendingGuideProposal.get(
            proposal.targetAdapterId,
            targetInstanceId,
            proposal.targetAdapterId,
            targetInstanceId,
          ) !== undefined
        ) {
          throw new Error(
            `Guide target already has an unresolved proposal: ${proposal.targetAdapterId}/${targetInstanceId}`,
          );
        }
        insertGuideProposal.run(
          proposal.proposalId,
          proposal.targetAdapterId,
          proposal.plan.id,
          proposal.plan.revision,
          proposal.proposedAt,
          payload,
        );
        const linkedAt = new Date().toISOString();
        insertEvent.run(
          `guide-proposal:${proposal.proposalId}`,
          'guide.proposal.created',
          payload,
          linkedAt,
        );
        insertRevisionRequestProposal.run(revisionRequestId, proposal.proposalId, linkedAt);
        insertEvent.run(
          `guide-revision-proposal:${revisionRequestId}`,
          'guide.revision.proposed',
          canonicalJson({
            requestId: revisionRequestId,
            proposalId: proposal.proposalId,
          }),
          linkedAt,
        );
        if (generationRequestId !== undefined) {
          insertEvent.run(
            `planning-replan-proposed:${generationRequestId}`,
            'planning.provider.replan.proposed',
            canonicalJson({
              generationRequestId,
              revisionRequestId,
              proposalId: proposal.proposalId,
              occurredAt: linkedAt,
            }),
            linkedAt,
          );
        }
        sqlite.exec('COMMIT;');
      } catch (error) {
        sqlite.exec('ROLLBACK;');
        throw error;
      }
    },
    getPendingGuideProposal(adapterId, instanceId) {
      const row = findPendingGuideProposal.get(adapterId, instanceId, adapterId, instanceId) as
        { payload?: unknown } | undefined;
      if (row === undefined) {
        return null;
      }
      if (typeof row.payload !== 'string') {
        throw new Error('SQLite returned an invalid guide proposal payload');
      }
      return JSON.parse(row.payload) as unknown;
    },
    listLatestGuidePlanRevisions() {
      return listLatestGuideRevisions.all().map((row) => {
        const candidate = row as { plan_id?: unknown; revision?: unknown };
        if (typeof candidate.plan_id !== 'string' || typeof candidate.revision !== 'number') {
          throw new Error('SQLite returned an invalid guide proposal revision');
        }
        return { planId: candidate.plan_id, revision: candidate.revision };
      });
    },
    recordGuideProposalDecision(decision) {
      const payload = canonicalJson(decision);
      sqlite.exec('BEGIN IMMEDIATE;');
      try {
        const existingById = findGuideProposalDecisionById.get(decision.decisionId) as
          | {
              proposal_id: string;
              adapter_id: string;
              instance_id: string;
              decision: string;
              payload: string;
            }
          | undefined;
        if (existingById !== undefined) {
          sqlite.exec('COMMIT;');
          return existingById.proposal_id === decision.proposalId &&
            existingById.adapter_id === decision.adapterId &&
            existingById.instance_id === decision.instanceId &&
            existingById.decision === decision.decision &&
            existingById.payload === payload
            ? 'duplicate'
            : 'conflict';
        }

        const proposal = findGuideProposalTarget.get(decision.proposalId) as
          { target_adapter_id: string } | undefined;
        if (proposal === undefined) {
          sqlite.exec('COMMIT;');
          return 'unknown';
        }
        if (proposal.target_adapter_id !== decision.adapterId) {
          sqlite.exec('COMMIT;');
          return 'conflict';
        }

        const existingDecision = findGuideProposalDecision.get(
          decision.proposalId,
          decision.adapterId,
          decision.instanceId,
        ) as { decision: string } | undefined;
        if (existingDecision !== undefined) {
          sqlite.exec('COMMIT;');
          return existingDecision.decision === decision.decision ? 'duplicate' : 'conflict';
        }

        insertGuideProposalDecision.run(
          decision.decisionId,
          decision.proposalId,
          decision.adapterId,
          decision.instanceId,
          decision.decision,
          payload,
        );
        insertEvent.run(
          `guide-proposal-decision:${decision.decisionId}`,
          'guide.proposal.decided',
          payload,
          new Date().toISOString(),
        );
        sqlite.exec('COMMIT;');
        return 'accepted';
      } catch (error) {
        sqlite.exec('ROLLBACK;');
        throw error;
      }
    },
    recordGuideRevisionRequest(request) {
      const payload = canonicalJson(request);
      sqlite.exec('BEGIN IMMEDIATE;');
      try {
        const existing = findRevisionRequest.get(request.requestId) as
          | {
              adapter_id: string;
              instance_id: string;
              base_plan_id: string;
              base_revision: number;
              payload: string;
            }
          | undefined;
        if (findCompanionDialogueRunByRevisionRequest.get(request.requestId) !== undefined) {
          sqlite.exec('COMMIT;');
          return 'conflict';
        }
        if (existing !== undefined) {
          sqlite.exec('COMMIT;');
          return existing.adapter_id === request.adapterId &&
            existing.instance_id === request.instanceId &&
            existing.base_plan_id === request.basePlan.id &&
            existing.base_revision === request.basePlan.revision &&
            existing.payload === payload
            ? 'duplicate'
            : 'conflict';
        }
        if (
          findActiveCompanionDialogueRun.get(request.adapterId, request.instanceId) !== undefined
        ) {
          sqlite.exec('COMMIT;');
          return 'conflict';
        }
        insertRevisionRequest.run(
          request.requestId,
          request.adapterId,
          request.instanceId,
          request.basePlan.id,
          request.basePlan.revision,
          request.occurredAt,
          payload,
        );
        insertEvent.run(
          `guide-revision-request:${request.requestId}`,
          'guide.revision.requested',
          payload,
          new Date().toISOString(),
        );
        sqlite.exec('COMMIT;');
        return 'accepted';
      } catch (error) {
        sqlite.exec('ROLLBACK;');
        throw error;
      }
    },
    getGuideRevisionRequest(requestId) {
      const row = findRevisionRequest.get(requestId) as { payload?: unknown } | undefined;
      if (row === undefined) {
        return null;
      }
      if (typeof row.payload !== 'string') {
        throw new Error('SQLite returned an invalid guide revision request payload');
      }
      return JSON.parse(row.payload) as unknown;
    },
    getGuideRevisionThreadHead(threadId) {
      const row = findRevisionThreadHead.get(threadId) as { payload?: unknown } | undefined;
      if (row === undefined) {
        return null;
      }
      if (typeof row.payload !== 'string') {
        throw new Error('SQLite returned an invalid guide revision thread payload');
      }
      return JSON.parse(row.payload) as unknown;
    },
    getGuideReplanProposalForRequest(requestId) {
      const row = findRevisionRequestProposalPayload.get(requestId) as
        { payload?: unknown } | undefined;
      if (row === undefined) {
        return null;
      }
      if (typeof row.payload !== 'string') {
        throw new Error('SQLite returned an invalid guide replan proposal payload');
      }
      return JSON.parse(row.payload) as unknown;
    },
    getGuideProposalDecision(proposalId, adapterId, instanceId) {
      const row = findGuideProposalDecision.get(proposalId, adapterId, instanceId) as
        { payload?: unknown } | undefined;
      if (row === undefined) {
        return null;
      }
      if (typeof row.payload !== 'string') {
        throw new Error('SQLite returned an invalid guide proposal decision payload');
      }
      return JSON.parse(row.payload) as unknown;
    },
    listGuideRevisionThreadTurns(threadId, adapterId, instanceId, beforeTurn, limit) {
      if (beforeTurn !== null && (!Number.isSafeInteger(beforeTurn) || beforeTurn < 1)) {
        throw new Error('Revision history cursor must be a positive safe integer or null');
      }
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 101) {
        throw new Error('Revision history limit must be an integer between 1 and 101');
      }
      return listRevisionThreadTurns
        .all(threadId, adapterId, instanceId, beforeTurn, beforeTurn, limit)
        .map((row) => {
          const candidate = row as {
            request_payload?: unknown;
            proposal_payload?: unknown;
            decision_payload?: unknown;
          };
          if (typeof candidate.request_payload !== 'string') {
            throw new Error('SQLite returned an invalid guide revision history request');
          }
          if (
            candidate.proposal_payload !== null &&
            typeof candidate.proposal_payload !== 'string'
          ) {
            throw new Error('SQLite returned an invalid guide revision history proposal');
          }
          if (
            candidate.decision_payload !== null &&
            typeof candidate.decision_payload !== 'string'
          ) {
            throw new Error('SQLite returned an invalid guide revision history decision');
          }
          return {
            request: JSON.parse(candidate.request_payload) as unknown,
            proposal:
              candidate.proposal_payload === null
                ? null
                : (JSON.parse(candidate.proposal_payload) as unknown),
            decision:
              candidate.decision_payload === null
                ? null
                : (JSON.parse(candidate.decision_payload) as unknown),
          };
        });
    },
    listGuideRevisionThreadHeads(adapterId, instanceId, planId, limit) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        throw new Error('Revision branch limit must be an integer between 1 and 100');
      }
      return listRevisionThreadHeads.all(adapterId, instanceId, planId, limit).map((row) => {
        const candidate = row as {
          request_payload?: unknown;
          proposal_payload?: unknown;
          decision_payload?: unknown;
        };
        if (typeof candidate.request_payload !== 'string') {
          throw new Error('SQLite returned an invalid guide revision branch request');
        }
        if (candidate.proposal_payload !== null && typeof candidate.proposal_payload !== 'string') {
          throw new Error('SQLite returned an invalid guide revision branch proposal');
        }
        if (candidate.decision_payload !== null && typeof candidate.decision_payload !== 'string') {
          throw new Error('SQLite returned an invalid guide revision branch decision');
        }
        return {
          request: JSON.parse(candidate.request_payload) as unknown,
          proposal:
            candidate.proposal_payload === null
              ? null
              : (JSON.parse(candidate.proposal_payload) as unknown),
          decision:
            candidate.decision_payload === null
              ? null
              : (JSON.parse(candidate.decision_payload) as unknown),
        };
      });
    },
    listPendingGuideRevisionRequests(adapterId, limit) {
      return listPendingRevisionRequests
        .all(adapterId ?? null, adapterId ?? null, limit)
        .map((row) => {
          const payload = (row as { payload?: unknown }).payload;
          if (typeof payload !== 'string') {
            throw new Error('SQLite returned an invalid guide revision request payload');
          }
          return JSON.parse(payload) as unknown;
        });
    },
    recordGuideGoalRequest(request) {
      const payload = canonicalJson(request);
      sqlite.exec('BEGIN IMMEDIATE;');
      try {
        const existing = findGoalRequest.get(request.requestId) as
          | {
              adapter_id: string;
              catalog_version: string;
              instance_id: string;
              plan_id: string;
              payload: string;
            }
          | undefined;
        if (existing !== undefined) {
          sqlite.exec('COMMIT;');
          return existing.adapter_id === request.adapterId &&
            existing.catalog_version === request.catalogVersion &&
            existing.instance_id === request.instanceId &&
            existing.plan_id === request.planId &&
            existing.payload === payload
            ? 'duplicate'
            : 'conflict';
        }
        if (
          findPendingGoalRequestForTarget.get(request.adapterId, request.instanceId) !==
            undefined ||
          findActiveCompanionReplanRun.get(request.adapterId, request.instanceId) !== undefined ||
          findActiveCompanionInitialPlanRun.get(request.adapterId, request.instanceId) !==
            undefined ||
          findActiveCompanionDialogueRun.get(request.adapterId, request.instanceId) !== undefined ||
          findPendingGuideProposal.get(
            request.adapterId,
            request.instanceId,
            request.adapterId,
            request.instanceId,
          ) !== undefined
        ) {
          sqlite.exec('COMMIT;');
          return 'conflict';
        }
        insertGoalRequest.run(
          request.requestId,
          request.adapterId,
          request.catalogVersion,
          request.instanceId,
          request.planId,
          request.occurredAt,
          payload,
        );
        insertEvent.run(
          `guide-goal-request:${request.requestId}`,
          'guide.goal.requested',
          payload,
          new Date().toISOString(),
        );
        sqlite.exec('COMMIT;');
        return 'accepted';
      } catch (error) {
        sqlite.exec('ROLLBACK;');
        throw error;
      }
    },
    getGuideGoalRequest(requestId) {
      const row = findGoalRequest.get(requestId) as { payload?: unknown } | undefined;
      if (row === undefined) {
        return null;
      }
      if (typeof row.payload !== 'string') {
        throw new Error('SQLite returned an invalid guide goal request payload');
      }
      return JSON.parse(row.payload) as unknown;
    },
    getGuideGoalProposalForRequest(requestId) {
      const row = findGoalRequestProposalPayload.get(requestId) as
        { payload?: unknown } | undefined;
      if (row === undefined) {
        return null;
      }
      if (typeof row.payload !== 'string') {
        throw new Error('SQLite returned an invalid guide goal proposal payload');
      }
      return JSON.parse(row.payload) as unknown;
    },
    getGuideGoalProposalForGeneration(generationRequestId) {
      const row = findGoalRequestProposalByGenerationPayload.get(generationRequestId) as
        { payload?: unknown } | undefined;
      if (row === undefined) {
        return null;
      }
      if (typeof row.payload !== 'string') {
        throw new Error('SQLite returned an invalid generated guide goal proposal payload');
      }
      return JSON.parse(row.payload) as unknown;
    },
    listPendingGuideGoalRequests(adapterId, limit) {
      return listPendingGoalRequests.all(adapterId ?? null, adapterId ?? null, limit).map((row) => {
        const payload = (row as { payload?: unknown }).payload;
        if (typeof payload !== 'string') {
          throw new Error('SQLite returned an invalid guide goal request payload');
        }
        return JSON.parse(payload) as unknown;
      });
    },
    recordCompanionReplanRun(run) {
      const payload = canonicalJson(run);
      sqlite.exec('BEGIN IMMEDIATE;');
      try {
        const existing = findCompanionReplanRun.get(run.generationRequestId) as
          { status: string; payload: string } | undefined;
        if (existing !== undefined) {
          sqlite.exec('COMMIT;');
          return existing.payload === payload ? 'duplicate' : 'conflict';
        }
        const active = findActiveCompanionReplanRun.get(run.targetAdapterId, run.targetInstanceId);
        const activeInitial = findActiveCompanionInitialPlanRun.get(
          run.targetAdapterId,
          run.targetInstanceId,
        );
        const pendingGoal = findPendingGoalRequestForTarget.get(
          run.targetAdapterId,
          run.targetInstanceId,
        );
        if (
          active !== undefined ||
          activeInitial !== undefined ||
          findActiveCompanionDialogueRun.get(run.targetAdapterId, run.targetInstanceId) !==
            undefined ||
          pendingGoal !== undefined ||
          findPendingGuideProposal.get(
            run.targetAdapterId,
            run.targetInstanceId,
            run.targetAdapterId,
            run.targetInstanceId,
          ) !== undefined
        ) {
          sqlite.exec('COMMIT;');
          return 'conflict';
        }
        insertCompanionReplanRun.run(
          run.generationRequestId,
          run.revisionRequestId,
          run.targetAdapterId,
          run.targetInstanceId,
          run.status,
          run.updatedAt,
          payload,
        );
        insertEvent.run(
          `companion-replan-run:${run.generationRequestId}:authorized`,
          'companion.replan-run.authorized',
          payload,
          run.updatedAt,
        );
        sqlite.exec('COMMIT;');
        return 'accepted';
      } catch (error) {
        sqlite.exec('ROLLBACK;');
        throw error;
      }
    },
    getCompanionReplanRun(generationRequestId) {
      const row = findCompanionReplanRun.get(generationRequestId) as
        { payload?: unknown } | undefined;
      if (row === undefined) {
        return null;
      }
      if (typeof row.payload !== 'string') {
        throw new Error('SQLite returned an invalid companion replan run payload');
      }
      return JSON.parse(row.payload) as unknown;
    },
    transitionCompanionReplanRun(run, expectedStatuses) {
      if (expectedStatuses.length === 0) {
        throw new Error('Companion replan run transition requires an expected status');
      }
      const payload = canonicalJson(run);
      sqlite.exec('BEGIN IMMEDIATE;');
      try {
        const existing = findCompanionReplanRun.get(run.generationRequestId) as
          { status: string; payload: string } | undefined;
        if (existing === undefined || !expectedStatuses.includes(existing.status)) {
          sqlite.exec('COMMIT;');
          return false;
        }
        const updated = updateCompanionReplanRun.run(
          run.status,
          run.updatedAt,
          payload,
          run.generationRequestId,
          existing.status,
        );
        if (updated.changes !== 1) {
          throw new Error('Companion replan run transition lost its expected state');
        }
        insertEvent.run(
          `companion-replan-run:${run.generationRequestId}:${run.status}`,
          'companion.replan-run.transitioned',
          payload,
          run.updatedAt,
        );
        sqlite.exec('COMMIT;');
        return true;
      } catch (error) {
        sqlite.exec('ROLLBACK;');
        throw error;
      }
    },
    listNonterminalCompanionReplanRuns() {
      return listNonterminalCompanionReplanRunRows.all().map((row) => {
        const payload = (row as { payload?: unknown }).payload;
        if (typeof payload !== 'string') {
          throw new Error('SQLite returned an invalid companion replan run payload');
        }
        return JSON.parse(payload) as unknown;
      });
    },
    recordCompanionInitialPlanRun(run) {
      const payload = canonicalJson(run);
      sqlite.exec('BEGIN IMMEDIATE;');
      try {
        const existing = findCompanionInitialPlanRun.get(run.generationRequestId) as
          { status: string; payload: string } | undefined;
        if (existing !== undefined) {
          sqlite.exec('COMMIT;');
          return existing.payload === payload ? 'duplicate' : 'conflict';
        }
        const goal = findGoalRequest.get(run.goalRequestId) as
          { adapter_id: string; instance_id: string } | undefined;
        const pendingGoal = findPendingGoalRequestForTarget.get(
          run.targetAdapterId,
          run.targetInstanceId,
        ) as { request_id?: unknown } | undefined;
        if (
          goal === undefined ||
          goal.adapter_id !== run.targetAdapterId ||
          goal.instance_id !== run.targetInstanceId ||
          pendingGoal?.request_id !== run.goalRequestId ||
          findGoalRequestProposal.get(run.goalRequestId) !== undefined ||
          findActiveCompanionInitialPlanRun.get(run.targetAdapterId, run.targetInstanceId) !==
            undefined ||
          findActiveCompanionReplanRun.get(run.targetAdapterId, run.targetInstanceId) !==
            undefined ||
          findActiveCompanionDialogueRun.get(run.targetAdapterId, run.targetInstanceId) !==
            undefined ||
          findPendingGuideProposal.get(
            run.targetAdapterId,
            run.targetInstanceId,
            run.targetAdapterId,
            run.targetInstanceId,
          ) !== undefined
        ) {
          sqlite.exec('COMMIT;');
          return 'conflict';
        }
        insertCompanionInitialPlanRun.run(
          run.generationRequestId,
          run.goalRequestId,
          run.targetAdapterId,
          run.targetInstanceId,
          run.status,
          run.updatedAt,
          payload,
        );
        insertEvent.run(
          `companion-initial-plan-run:${run.generationRequestId}:authorized`,
          'companion.initial-plan-run.authorized',
          payload,
          run.updatedAt,
        );
        sqlite.exec('COMMIT;');
        return 'accepted';
      } catch (error) {
        sqlite.exec('ROLLBACK;');
        throw error;
      }
    },
    getCompanionInitialPlanRun(generationRequestId) {
      const row = findCompanionInitialPlanRun.get(generationRequestId) as
        { payload?: unknown } | undefined;
      if (row === undefined) {
        return null;
      }
      if (typeof row.payload !== 'string') {
        throw new Error('SQLite returned an invalid companion initial plan run payload');
      }
      return JSON.parse(row.payload) as unknown;
    },
    transitionCompanionInitialPlanRun(run, expectedStatuses) {
      if (expectedStatuses.length === 0) {
        throw new Error('Companion initial plan run transition requires an expected status');
      }
      const payload = canonicalJson(run);
      sqlite.exec('BEGIN IMMEDIATE;');
      try {
        const existing = findCompanionInitialPlanRun.get(run.generationRequestId) as
          { status: string; payload: string } | undefined;
        if (existing === undefined || !expectedStatuses.includes(existing.status)) {
          sqlite.exec('COMMIT;');
          return false;
        }
        const stored = JSON.parse(existing.payload) as CompanionInitialPlanRunInput;
        if (
          stored.goalRequestId !== run.goalRequestId ||
          stored.targetAdapterId !== run.targetAdapterId ||
          stored.targetInstanceId !== run.targetInstanceId
        ) {
          sqlite.exec('COMMIT;');
          return false;
        }
        const updated = updateCompanionInitialPlanRun.run(
          run.status,
          run.updatedAt,
          payload,
          run.generationRequestId,
          existing.status,
        );
        if (updated.changes !== 1) {
          throw new Error('Companion initial plan run transition lost its expected state');
        }
        insertEvent.run(
          `companion-initial-plan-run:${run.generationRequestId}:${run.status}`,
          'companion.initial-plan-run.transitioned',
          payload,
          run.updatedAt,
        );
        sqlite.exec('COMMIT;');
        return true;
      } catch (error) {
        sqlite.exec('ROLLBACK;');
        throw error;
      }
    },
    listNonterminalCompanionInitialPlanRuns() {
      return listNonterminalCompanionInitialPlanRunRows.all().map((row) => {
        const payload = (row as { payload?: unknown }).payload;
        if (typeof payload !== 'string') {
          throw new Error('SQLite returned an invalid companion initial plan run payload');
        }
        return JSON.parse(payload) as unknown;
      });
    },
    recordCompanionDialogueRun(run) {
      const payload = canonicalJson(run);
      sqlite.exec('BEGIN IMMEDIATE;');
      try {
        const existing = findCompanionDialogueRun.get(run.dialogueRequestId) as
          { status: string; payload: string } | undefined;
        if (existing !== undefined) {
          sqlite.exec('COMMIT;');
          return existing.payload === payload ? 'duplicate' : 'conflict';
        }
        if (
          findRevisionRequest.get(run.revisionRequestId) !== undefined ||
          findCompanionDialogueRunByRevisionRequest.get(run.revisionRequestId) !== undefined ||
          findCompanionDialogueRunByReplanGenerationRequest.get(run.replanGenerationRequestId) !==
            undefined ||
          findActiveCompanionDialogueRun.get(run.targetAdapterId, run.targetInstanceId) !==
            undefined ||
          findActiveCompanionInitialPlanRun.get(run.targetAdapterId, run.targetInstanceId) !==
            undefined ||
          findActiveCompanionReplanRun.get(run.targetAdapterId, run.targetInstanceId) !==
            undefined ||
          findPendingGoalRequestForTarget.get(run.targetAdapterId, run.targetInstanceId) !==
            undefined ||
          findPendingGuideProposal.get(
            run.targetAdapterId,
            run.targetInstanceId,
            run.targetAdapterId,
            run.targetInstanceId,
          ) !== undefined
        ) {
          sqlite.exec('COMMIT;');
          return 'conflict';
        }
        insertCompanionDialogueRun.run(
          run.dialogueRequestId,
          run.revisionRequestId,
          run.replanGenerationRequestId,
          run.targetAdapterId,
          run.targetInstanceId,
          run.status,
          run.assistantMessageRevision,
          run.updatedAt,
          payload,
        );
        insertEvent.run(
          `companion-dialogue-run:${run.dialogueRequestId}:authorized`,
          'companion.dialogue-run.authorized',
          payload,
          run.updatedAt,
        );
        sqlite.exec('COMMIT;');
        return 'accepted';
      } catch (error) {
        sqlite.exec('ROLLBACK;');
        throw error;
      }
    },
    getCompanionDialogueRun(dialogueRequestId) {
      const row = findCompanionDialogueRun.get(dialogueRequestId) as
        { payload?: unknown } | undefined;
      if (row === undefined) {
        return null;
      }
      if (typeof row.payload !== 'string') {
        throw new Error('SQLite returned an invalid companion dialogue run payload');
      }
      return JSON.parse(row.payload) as unknown;
    },
    transitionCompanionDialogueRun(run, expectedStatuses) {
      if (expectedStatuses.length === 0) {
        throw new Error('Companion dialogue run transition requires an expected status');
      }
      const payload = canonicalJson(run);
      sqlite.exec('BEGIN IMMEDIATE;');
      try {
        const existing = findCompanionDialogueRun.get(run.dialogueRequestId) as
          { status: string; payload: string } | undefined;
        if (existing === undefined || !expectedStatuses.includes(existing.status)) {
          sqlite.exec('COMMIT;');
          return false;
        }
        const stored = JSON.parse(existing.payload) as CompanionDialogueRunInput;
        const assistantProgressIsValid =
          run.assistantMessageRevision === stored.assistantMessageRevision
            ? run.assistantMessage === stored.assistantMessage
            : run.assistantMessageRevision === stored.assistantMessageRevision + 1 &&
              run.assistantMessage.startsWith(stored.assistantMessage);
        if (
          stored.revisionRequestId !== run.revisionRequestId ||
          stored.replanGenerationRequestId !== run.replanGenerationRequestId ||
          stored.targetAdapterId !== run.targetAdapterId ||
          stored.targetInstanceId !== run.targetInstanceId ||
          companionDialogueImmutablePayload(stored) !== companionDialogueImmutablePayload(run) ||
          !assistantProgressIsValid
        ) {
          sqlite.exec('COMMIT;');
          return false;
        }
        const updated = updateCompanionDialogueRun.run(
          run.status,
          run.assistantMessageRevision,
          run.updatedAt,
          payload,
          run.dialogueRequestId,
          existing.status,
        );
        if (updated.changes !== 1) {
          throw new Error('Companion dialogue run transition lost its expected state');
        }
        insertEvent.run(
          `companion-dialogue-run:${run.dialogueRequestId}:${run.status}:${run.assistantMessageRevision}`,
          'companion.dialogue-run.transitioned',
          payload,
          run.updatedAt,
        );
        sqlite.exec('COMMIT;');
        return true;
      } catch (error) {
        sqlite.exec('ROLLBACK;');
        throw error;
      }
    },
    transitionCompanionDialogueRunWithRevisionRequest(run, request, expectedStatuses) {
      if (expectedStatuses.length === 0) {
        throw new Error('Companion dialogue replan transition requires an expected status');
      }
      const runPayload = canonicalJson(run);
      const requestPayload = canonicalJson(request);
      sqlite.exec('BEGIN IMMEDIATE;');
      try {
        const existingRun = findCompanionDialogueRun.get(run.dialogueRequestId) as
          { status: string; payload: string } | undefined;
        if (existingRun === undefined || !expectedStatuses.includes(existingRun.status)) {
          sqlite.exec('COMMIT;');
          return false;
        }
        const storedRun = JSON.parse(existingRun.payload) as CompanionDialogueRunInput & {
          request?: { revisionRequest?: unknown };
        };
        const assistantProgressIsValid =
          run.assistantMessageRevision === storedRun.assistantMessageRevision
            ? run.assistantMessage === storedRun.assistantMessage
            : run.assistantMessageRevision === storedRun.assistantMessageRevision + 1 &&
              run.assistantMessage.startsWith(storedRun.assistantMessage);
        if (
          storedRun.revisionRequestId !== run.revisionRequestId ||
          storedRun.replanGenerationRequestId !== run.replanGenerationRequestId ||
          storedRun.targetAdapterId !== run.targetAdapterId ||
          storedRun.targetInstanceId !== run.targetInstanceId ||
          companionDialogueImmutablePayload(storedRun) !== companionDialogueImmutablePayload(run) ||
          !assistantProgressIsValid ||
          request.requestId !== run.revisionRequestId ||
          request.adapterId !== run.targetAdapterId ||
          request.instanceId !== run.targetInstanceId ||
          canonicalJson(storedRun.request?.revisionRequest) !== requestPayload
        ) {
          sqlite.exec('COMMIT;');
          return false;
        }

        const existingRequest = findRevisionRequest.get(request.requestId) as
          | {
              adapter_id: string;
              instance_id: string;
              base_plan_id: string;
              base_revision: number;
              payload: string;
            }
          | undefined;
        if (
          existingRequest !== undefined &&
          (existingRequest.adapter_id !== request.adapterId ||
            existingRequest.instance_id !== request.instanceId ||
            existingRequest.base_plan_id !== request.basePlan.id ||
            existingRequest.base_revision !== request.basePlan.revision ||
            existingRequest.payload !== requestPayload)
        ) {
          sqlite.exec('COMMIT;');
          return false;
        }
        if (existingRequest === undefined) {
          insertRevisionRequest.run(
            request.requestId,
            request.adapterId,
            request.instanceId,
            request.basePlan.id,
            request.basePlan.revision,
            request.occurredAt,
            requestPayload,
          );
          insertEvent.run(
            `guide-revision-request:${request.requestId}`,
            'guide.revision.requested',
            requestPayload,
            new Date().toISOString(),
          );
        }

        const updated = updateCompanionDialogueRun.run(
          run.status,
          run.assistantMessageRevision,
          run.updatedAt,
          runPayload,
          run.dialogueRequestId,
          existingRun.status,
        );
        if (updated.changes !== 1) {
          throw new Error('Companion dialogue replan transition lost its expected state');
        }
        insertEvent.run(
          `companion-dialogue-run:${run.dialogueRequestId}:${run.status}:${run.assistantMessageRevision}`,
          'companion.dialogue-run.transitioned',
          runPayload,
          run.updatedAt,
        );
        sqlite.exec('COMMIT;');
        return true;
      } catch (error) {
        sqlite.exec('ROLLBACK;');
        throw error;
      }
    },
    listNonterminalCompanionDialogueRuns() {
      return listNonterminalCompanionDialogueRunRows.all().map((row) => {
        const payload = (row as { payload?: unknown }).payload;
        if (typeof payload !== 'string') {
          throw new Error('SQLite returned an invalid companion dialogue run payload');
        }
        return JSON.parse(payload) as unknown;
      });
    },
    recordCompanionState(report) {
      const payload = canonicalJson(report);
      sqlite.exec('BEGIN IMMEDIATE;');
      try {
        const existingReport = findStateReport.get(report.reportId) as
          | { adapter_id: string; instance_id: string; sequence: number; payload: string }
          | undefined;
        if (existingReport !== undefined) {
          sqlite.exec('COMMIT;');
          return existingReport.adapter_id === report.adapterId &&
            existingReport.instance_id === report.instanceId &&
            existingReport.sequence === report.sequence &&
            existingReport.payload === payload
            ? 'duplicate'
            : 'conflict';
        }

        const latestState = findLatestState.get(report.adapterId, report.instanceId) as
          { report_id: string; sequence: number } | undefined;
        if (latestState !== undefined && report.sequence <= latestState.sequence) {
          sqlite.exec('COMMIT;');
          return 'stale';
        }

        insertStateReport.run(
          report.reportId,
          report.adapterId,
          report.instanceId,
          report.sequence,
          payload,
        );
        upsertLatestState.run(
          report.adapterId,
          report.instanceId,
          report.reportId,
          report.sequence,
          payload,
        );
        insertEvent.run(
          `companion-state:${report.reportId}`,
          'companion.state.reported',
          payload,
          new Date().toISOString(),
        );
        sqlite.exec('COMMIT;');
        return 'accepted';
      } catch (error) {
        sqlite.exec('ROLLBACK;');
        throw error;
      }
    },
    listLatestCompanionStates() {
      return listLatestStates.all().map((row) => {
        const payload = (row as { payload?: unknown }).payload;
        if (typeof payload !== 'string') {
          throw new Error('SQLite returned an invalid companion state payload');
        }
        return JSON.parse(payload) as unknown;
      });
    },
    close() {
      sqlite.close();
    },
  };
}
