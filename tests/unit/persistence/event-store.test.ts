import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';

import { openOperatingLineDatabase } from '@operatingline/persistence';

function guideProposal(planId = 'snowman', revision = 1) {
  return {
    protocolVersion: '1.0.0',
    proposalId: randomUUID(),
    targetAdapterId: 'blender',
    proposedAt: new Date().toISOString(),
    plan: { id: planId, revision },
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

describe('OperatingLine persistence', () => {
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
    expect(database.getPendingGuideProposal('blender', firstInstance)).toBeNull();
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
    database.recordGuideReplanProposal(proposal, request.requestId);
    expect(database.listPendingGuideRevisionRequests('blender', 20)).toEqual([]);
    expect(database.listPendingGuideRevisionRequests('gimp', 20)).toEqual([otherAdapter]);
    expect(database.getPendingGuideProposal('blender', randomUUID())).toEqual(proposal);
    expect(() =>
      database.recordGuideReplanProposal(guideProposal('snowman', 5), request.requestId),
    ).toThrow('already has a proposal');
    expect(() =>
      database.recordGuideReplanProposal(guideProposal('unknown', 1), randomUUID()),
    ).toThrow('Unknown guide revision request');
    expect(database.countEvents()).toBe(4);
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
        count: 6,
      });
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
});
