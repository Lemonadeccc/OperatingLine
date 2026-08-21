import { DatabaseSync } from 'node:sqlite';

import {
  decisionCompletionEventSchema,
  decisionConsumptionEventSchema,
  decisionLifecycleEventSchema,
  type DecisionCompletionEvent,
  type DecisionConsumptionEvent,
  type DecisionLifecycleEvent,
} from '@operatingline/protocol';

const consumptionKinds = [
  'provider_authorization_consumed',
  'blender_decision_consumed',
  'blender_history_transition_consumed',
  'training_decision_consumed',
] as const satisfies readonly DecisionConsumptionEvent['kind'][];

const completionKinds = [
  'provider_call_completed',
  'blender_execution_completed',
  'blender_history_transition_completed',
  'training_run_completed',
] as const satisfies readonly DecisionCompletionEvent['kind'][];

const completionKindByConsumptionKind = {
  provider_authorization_consumed: 'provider_call_completed',
  blender_decision_consumed: 'blender_execution_completed',
  blender_history_transition_consumed: 'blender_history_transition_completed',
  training_decision_consumed: 'training_run_completed',
} as const satisfies Record<DecisionConsumptionEvent['kind'], DecisionCompletionEvent['kind']>;

const quotedConsumptionKinds = consumptionKinds.map((kind) => `'${kind}'`).join(', ');
const quotedCompletionKinds = completionKinds.map((kind) => `'${kind}'`).join(', ');

export interface AuthorityConsumptionStore {
  readAll(): readonly DecisionLifecycleEvent[];
  appendConsumptionIfUnused(
    event: Omit<DecisionConsumptionEvent, 'sequence'>,
  ): AuthorityConsumptionAppendResult;
  appendCompletionIfInFlight(
    event: Omit<DecisionCompletionEvent, 'sequence'>,
  ): AuthorityCompletionAppendResult;
}

export type AuthorityConsumptionAppendResult =
  | { readonly status: 'appended'; readonly event: DecisionConsumptionEvent }
  | { readonly status: 'credential_duplicate' }
  | { readonly status: 'single_use_key_duplicate' }
  | { readonly status: 'invalid' };

export type AuthorityCompletionAppendResult =
  | { readonly status: 'appended'; readonly event: DecisionCompletionEvent }
  | { readonly status: 'missing_consumption' }
  | { readonly status: 'already_completed' }
  | { readonly status: 'kind_conflict' }
  | { readonly status: 'operation_conflict' }
  | { readonly status: 'invalid' };

interface StoredEventRow {
  sequence: number;
  event_id: string;
  kind: string;
  credential_id: string;
  single_use_key_sha256: string | null;
  operation_id: string;
  payload: string;
}

interface SequenceStateRow {
  event_count: number;
  maximum_sequence: number | null;
}

interface ConsumptionStateRow {
  kind: DecisionConsumptionEvent['kind'];
  operation_id: string;
}

function deepFreezeClone<T>(value: T): T {
  const clone = structuredClone(value);
  const freeze = (candidate: unknown): void => {
    if (candidate === null || typeof candidate !== 'object' || Object.isFrozen(candidate)) return;
    for (const nested of Object.values(candidate)) freeze(nested);
    Object.freeze(candidate);
  };
  freeze(clone);
  return clone;
}

export class SqliteAuthorityConsumptionStore implements AuthorityConsumptionStore {
  readonly #sqlite: DatabaseSync;

  constructor(filename: string) {
    this.#sqlite = new DatabaseSync(filename, { timeout: 5_000 });
    if (filename !== ':memory:') this.#sqlite.exec('PRAGMA journal_mode = WAL;');
    this.#sqlite.exec(`
      CREATE TABLE IF NOT EXISTS authority_consumption_events (
        sequence INTEGER PRIMARY KEY CHECK (sequence >= 0),
        event_id TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL CHECK (kind IN (${quotedConsumptionKinds}, ${quotedCompletionKinds})),
        credential_id TEXT NOT NULL,
        single_use_key_sha256 TEXT,
        operation_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        CHECK (
          (kind IN (${quotedConsumptionKinds}) AND single_use_key_sha256 IS NOT NULL) OR
          (kind IN (${quotedCompletionKinds}) AND single_use_key_sha256 IS NULL)
        )
      );

      CREATE UNIQUE INDEX IF NOT EXISTS authority_consumption_events_consumed_credential
      ON authority_consumption_events (credential_id)
      WHERE kind IN (${quotedConsumptionKinds});

      CREATE UNIQUE INDEX IF NOT EXISTS authority_consumption_events_single_use_key
      ON authority_consumption_events (single_use_key_sha256)
      WHERE kind IN (${quotedConsumptionKinds});

      CREATE UNIQUE INDEX IF NOT EXISTS authority_consumption_events_completed_credential
      ON authority_consumption_events (credential_id)
      WHERE kind IN (${quotedCompletionKinds});
    `);
  }

  readAll(): readonly DecisionLifecycleEvent[] {
    const rows = this.#sqlite
      .prepare(
        `SELECT sequence, event_id, kind, credential_id, single_use_key_sha256,
                operation_id, payload
         FROM authority_consumption_events
         ORDER BY sequence`,
      )
      .all() as unknown as StoredEventRow[];

    return Object.freeze(
      rows.map((row, index) => {
        if (row.sequence !== index) {
          throw new Error('Authority consumption event sequence is not contiguous');
        }
        const event = decisionLifecycleEventSchema.parse(JSON.parse(row.payload) as unknown);
        if (
          event.sequence !== row.sequence ||
          event.eventId !== row.event_id ||
          event.kind !== row.kind ||
          event.credentialId !== row.credential_id ||
          event.operationId !== row.operation_id ||
          ('singleUseKeySha256' in event
            ? event.singleUseKeySha256 !== row.single_use_key_sha256
            : row.single_use_key_sha256 !== null)
        ) {
          throw new Error('Authority consumption event columns do not match its payload');
        }
        return deepFreezeClone(event);
      }),
    );
  }

  appendConsumptionIfUnused(
    eventInput: Omit<DecisionConsumptionEvent, 'sequence'>,
  ): AuthorityConsumptionAppendResult {
    return this.#transaction(() => {
      const sequence = this.#nextSequence();
      const parsed = decisionConsumptionEventSchema.safeParse({ ...eventInput, sequence });
      if (!parsed.success) return { status: 'invalid' };
      const event = parsed.data;
      const credential = this.#sqlite
        .prepare(
          `SELECT 1
           FROM authority_consumption_events
           WHERE kind IN (${quotedConsumptionKinds})
             AND credential_id = ?
           LIMIT 1`,
        )
        .get(event.credentialId);
      if (credential !== undefined) return { status: 'credential_duplicate' };
      const singleUseKey = this.#sqlite
        .prepare(
          `SELECT 1
           FROM authority_consumption_events
           WHERE kind IN (${quotedConsumptionKinds})
             AND single_use_key_sha256 = ?
           LIMIT 1`,
        )
        .get(event.singleUseKeySha256);
      if (singleUseKey !== undefined) return { status: 'single_use_key_duplicate' };
      if (this.#eventIdExists(event.eventId)) return { status: 'invalid' };
      this.#insert(event, event.singleUseKeySha256);
      return { status: 'appended', event: deepFreezeClone(event) };
    });
  }

  appendCompletionIfInFlight(
    eventInput: Omit<DecisionCompletionEvent, 'sequence'>,
  ): AuthorityCompletionAppendResult {
    return this.#transaction(() => {
      const sequence = this.#nextSequence();
      const parsed = decisionCompletionEventSchema.safeParse({ ...eventInput, sequence });
      if (!parsed.success) return { status: 'invalid' };
      const event = parsed.data;
      const consumption = this.#sqlite
        .prepare(
          `SELECT kind, operation_id
           FROM authority_consumption_events
           WHERE credential_id = ? AND kind IN (${quotedConsumptionKinds})`,
        )
        .get(event.credentialId) as ConsumptionStateRow | undefined;
      if (consumption === undefined) return { status: 'missing_consumption' };
      if (consumption.operation_id !== event.operationId) return { status: 'operation_conflict' };
      if (completionKindByConsumptionKind[consumption.kind] !== event.kind) {
        return { status: 'kind_conflict' };
      }
      const completion = this.#sqlite
        .prepare(
          `SELECT 1
           FROM authority_consumption_events
           WHERE credential_id = ? AND kind IN (${quotedCompletionKinds})
           LIMIT 1`,
        )
        .get(event.credentialId);
      if (completion !== undefined) return { status: 'already_completed' };
      if (this.#eventIdExists(event.eventId)) return { status: 'invalid' };
      this.#insert(event, null);
      return { status: 'appended', event: deepFreezeClone(event) };
    });
  }

  close(): void {
    this.#sqlite.close();
  }

  #nextSequence(): number {
    const state = this.#sqlite
      .prepare(
        `SELECT COUNT(*) AS event_count, MAX(sequence) AS maximum_sequence
         FROM authority_consumption_events`,
      )
      .get() as unknown as SequenceStateRow;
    if (
      (state.event_count === 0 && state.maximum_sequence !== null) ||
      (state.event_count > 0 && state.maximum_sequence !== state.event_count - 1)
    ) {
      throw new Error('Authority consumption event sequence is not contiguous');
    }
    return state.event_count;
  }

  #insert(event: DecisionLifecycleEvent, singleUseKeySha256: string | null): void {
    this.#sqlite
      .prepare(
        `INSERT INTO authority_consumption_events (
           sequence, event_id, kind, credential_id, single_use_key_sha256, operation_id, payload
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.sequence,
        event.eventId,
        event.kind,
        event.credentialId,
        singleUseKeySha256,
        event.operationId,
        JSON.stringify(event),
      );
  }

  #eventIdExists(eventId: string): boolean {
    return (
      this.#sqlite
        .prepare(
          `SELECT 1
           FROM authority_consumption_events
           WHERE event_id = ?
           LIMIT 1`,
        )
        .get(eventId) !== undefined
    );
  }

  #transaction<T>(operation: () => T): T {
    this.#sqlite.exec('BEGIN IMMEDIATE;');
    try {
      const result = operation();
      this.#sqlite.exec('COMMIT;');
      return result;
    } catch (error) {
      try {
        this.#sqlite.exec('ROLLBACK;');
      } catch {
        // Preserve the original database or validation error.
      }
      throw error;
    }
  }
}
