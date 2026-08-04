import { DatabaseSync } from 'node:sqlite';

export interface ExecutionEventInput {
  id: string;
  eventType: string;
  payload: unknown;
  createdAt?: string;
}

export interface OperatingLineDatabase {
  appendEvent(event: ExecutionEventInput): void;
  countEvents(): number;
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
  `);

  const insertEvent = sqlite.prepare(`
    INSERT INTO execution_events (id, event_type, payload, created_at)
    VALUES (?, ?, ?, ?)
  `);
  const countEvents = sqlite.prepare('SELECT COUNT(*) AS value FROM execution_events');

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
    close() {
      sqlite.close();
    },
  };
}
