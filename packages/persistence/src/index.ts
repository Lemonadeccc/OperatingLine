import { DatabaseSync } from 'node:sqlite';

export interface ExecutionEventInput {
  id: string;
  eventType: string;
  payload: unknown;
  createdAt?: string;
}

export interface CompanionStateInput {
  reportId: string;
  adapterId: string;
  instanceId: string;
  sequence: number;
}

export type RecordCompanionStateResult = 'accepted' | 'duplicate' | 'stale' | 'conflict';

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
      id TEXT PRIMARY KEY,
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
  `);

  const insertEvent = sqlite.prepare(`
    INSERT INTO execution_events (id, event_type, payload, created_at)
    VALUES (?, ?, ?, ?)
  `);
  const countEvents = sqlite.prepare('SELECT COUNT(*) AS value FROM execution_events');
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
        JSON.stringify(event.payload),
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
