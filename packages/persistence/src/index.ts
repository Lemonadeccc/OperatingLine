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

export interface OperatingLineDatabase {
  appendEvent(event: ExecutionEventInput): void;
  countEvents(): number;
  listExecutionEvents(afterSequence: number, limit: number): StoredExecutionEvent[];
  recordGuideProposal<T extends GuideProposalInput>(proposal: T): void;
  recordGuideReplanProposal<T extends GuideProposalInput>(
    proposal: T,
    revisionRequestId: string,
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
  listPendingGuideRevisionRequests(adapterId: string | undefined, limit: number): unknown[];
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
    WITH latest AS (
      SELECT proposal_id, payload
      FROM guide_proposals
      WHERE target_adapter_id = ?
        AND (
          json_extract(payload, '$.targetInstanceId') IS NULL
          OR json_extract(payload, '$.targetInstanceId') = ?
        )
      ORDER BY rowid DESC
      LIMIT 1
    )
    SELECT latest.payload
    FROM latest
    WHERE NOT EXISTS (
      SELECT 1
      FROM guide_proposal_decisions AS decision
      WHERE decision.proposal_id = latest.proposal_id
        AND decision.adapter_id = ?
        AND decision.instance_id = ?
    )
  `);
  const findRevisionRequest = sqlite.prepare(`
    SELECT adapter_id, instance_id, base_plan_id, base_revision, payload
    FROM guide_revision_requests
    WHERE request_id = ?
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
    SELECT decision
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
      return listEvents.all(afterSequence, limit).map((row) => {
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
      });
    },
    recordGuideProposal(proposal) {
      const payload = canonicalJson(proposal);
      sqlite.exec('BEGIN IMMEDIATE;');
      try {
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
    recordGuideReplanProposal(proposal, revisionRequestId) {
      const payload = canonicalJson(proposal);
      sqlite.exec('BEGIN IMMEDIATE;');
      try {
        const request = findRevisionRequest.get(revisionRequestId);
        if (request === undefined) {
          throw new Error(`Unknown guide revision request: ${revisionRequestId}`);
        }
        if (findRevisionRequestProposal.get(revisionRequestId) !== undefined) {
          throw new Error(`Guide revision request already has a proposal: ${revisionRequestId}`);
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
