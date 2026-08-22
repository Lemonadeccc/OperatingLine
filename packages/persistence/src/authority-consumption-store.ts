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
  'dataset_release_authorization_consumed',
] as const satisfies readonly DecisionConsumptionEvent['kind'][];

const completionKinds = [
  'provider_call_completed',
  'blender_execution_completed',
  'blender_history_transition_completed',
  'training_run_completed',
  'dataset_release_completed',
] as const satisfies readonly DecisionCompletionEvent['kind'][];

const completionKindByConsumptionKind = {
  provider_authorization_consumed: 'provider_call_completed',
  blender_decision_consumed: 'blender_execution_completed',
  blender_history_transition_consumed: 'blender_history_transition_completed',
  training_decision_consumed: 'training_run_completed',
  dataset_release_authorization_consumed: 'dataset_release_completed',
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

export interface DatasetReleaseRecord {
  readonly manifestSha256: string;
  readonly manifestJson: string;
  readonly releaseCandidateManifestSha256: string;
  readonly authorizationId: string;
  readonly authorizationContentSha256: string;
  readonly validationReceiptSha256: string;
  readonly validationReceiptJson: string;
  readonly operationId: string;
  readonly bindingSha256: string;
  readonly semanticSingleUseKeySha256: string;
  readonly consumptionEvent: DecisionConsumptionEvent & {
    readonly kind: 'dataset_release_authorization_consumed';
  };
  readonly completionEvent: DecisionCompletionEvent & {
    readonly kind: 'dataset_release_completed';
  };
}

export interface FinalizeDatasetReleaseInput extends Omit<
  DatasetReleaseRecord,
  'consumptionEvent' | 'completionEvent'
> {
  readonly consumptionEvent: Omit<DecisionConsumptionEvent, 'sequence'> & {
    readonly kind: 'dataset_release_authorization_consumed';
  };
  readonly completionEvent: Omit<DecisionCompletionEvent, 'sequence'> & {
    readonly kind: 'dataset_release_completed';
  };
}

export type FinalizeDatasetReleaseResult =
  | { readonly status: 'created'; readonly release: DatasetReleaseRecord }
  | { readonly status: 'already_completed'; readonly release: DatasetReleaseRecord }
  | { readonly status: 'operation_conflict' }
  | { readonly status: 'authority_conflict' }
  | { readonly status: 'semantic_release_conflict' }
  | { readonly status: 'manifest_conflict' }
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

interface StoredDatasetReleaseRow {
  manifest_sha256: string;
  manifest_json: string;
  release_candidate_manifest_sha256: string;
  authorization_id: string;
  authorization_content_sha256: string;
  validation_receipt_sha256: string;
  validation_receipt_json: string;
  operation_id: string;
  binding_sha256: string;
  semantic_single_use_key_sha256: string;
  consumption_event_id: string;
  completion_event_id: string;
}

const sha256Pattern = /^[a-f0-9]{64}$/u;

type DatasetReleaseConsumptionEvent = DecisionConsumptionEvent & {
  readonly kind: 'dataset_release_authorization_consumed';
};
type DatasetReleaseCompletionEvent = DecisionCompletionEvent & {
  readonly kind: 'dataset_release_completed';
};

function isDatasetReleaseConsumptionEvent(
  event: DecisionLifecycleEvent,
): event is DatasetReleaseConsumptionEvent {
  return event.kind === 'dataset_release_authorization_consumed';
}

function isDatasetReleaseCompletionEvent(
  event: DecisionLifecycleEvent,
): event is DatasetReleaseCompletionEvent {
  return event.kind === 'dataset_release_completed';
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
    this.#initializeSchema();
  }

  #createAuthorityConsumptionSchema(): void {
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

  #initializeSchema(): void {
    const definition = this.#sqlite
      .prepare(
        `SELECT sql FROM sqlite_master
         WHERE type = 'table' AND name = 'authority_consumption_events'`,
      )
      .get() as { sql: string } | undefined;
    if (definition === undefined) {
      this.#createAuthorityConsumptionSchema();
    } else if (!definition.sql.includes('dataset_release_authorization_consumed')) {
      this.#transaction(() => {
        const currentDefinition = this.#sqlite
          .prepare(
            `SELECT sql FROM sqlite_master
             WHERE type = 'table' AND name = 'authority_consumption_events'`,
          )
          .get() as { sql: string } | undefined;
        if (currentDefinition?.sql.includes('dataset_release_authorization_consumed')) return;
        this.#sqlite.exec(`
          DROP INDEX IF EXISTS authority_consumption_events_consumed_credential;
          DROP INDEX IF EXISTS authority_consumption_events_single_use_key;
          DROP INDEX IF EXISTS authority_consumption_events_completed_credential;
          ALTER TABLE authority_consumption_events RENAME TO authority_consumption_events_legacy;
        `);
        this.#createAuthorityConsumptionSchema();
        this.#sqlite.exec(`
          INSERT INTO authority_consumption_events (
            sequence, event_id, kind, credential_id, single_use_key_sha256, operation_id, payload
          )
          SELECT sequence, event_id, kind, credential_id, single_use_key_sha256, operation_id, payload
          FROM authority_consumption_events_legacy;
          DROP TABLE authority_consumption_events_legacy;
        `);
      });
    }
    this.#sqlite.exec(`
      CREATE TABLE IF NOT EXISTS human_eval_releases (
        manifest_sha256 TEXT PRIMARY KEY,
        manifest_json TEXT NOT NULL,
        release_candidate_manifest_sha256 TEXT NOT NULL,
        authorization_id TEXT NOT NULL UNIQUE,
        authorization_content_sha256 TEXT NOT NULL,
        validation_receipt_sha256 TEXT NOT NULL,
        validation_receipt_json TEXT NOT NULL,
        operation_id TEXT NOT NULL UNIQUE,
        binding_sha256 TEXT NOT NULL,
        semantic_single_use_key_sha256 TEXT NOT NULL UNIQUE,
        consumption_event_id TEXT NOT NULL UNIQUE,
        completion_event_id TEXT NOT NULL UNIQUE
      );
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
        return deepFreezeClone(this.#eventFromRow(row));
      }),
    );
  }

  appendConsumptionIfUnused(
    eventInput: Omit<DecisionConsumptionEvent, 'sequence'>,
  ): AuthorityConsumptionAppendResult {
    if (eventInput.kind === 'dataset_release_authorization_consumed') {
      return { status: 'invalid' };
    }
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

  finalizeDatasetReleaseIfUnused(input: FinalizeDatasetReleaseInput): FinalizeDatasetReleaseResult {
    return this.#transaction(() => {
      if (!this.#validDatasetReleaseInput(input)) return { status: 'invalid' };

      const operationRelease = this.#findDatasetReleaseByOperation(input.operationId);
      if (operationRelease !== undefined) {
        return this.#isExactDatasetReleaseRetry(operationRelease, input)
          ? { status: 'already_completed', release: this.#datasetReleaseRecord(operationRelease) }
          : { status: 'operation_conflict' };
      }
      if (this.#findDatasetReleaseByAuthorization(input.authorizationId) !== undefined) {
        return { status: 'authority_conflict' };
      }
      if (this.#findDatasetReleaseBySemanticKey(input.semanticSingleUseKeySha256) !== undefined) {
        return { status: 'semantic_release_conflict' };
      }
      if (this.#findDatasetReleaseByManifest(input.manifestSha256) !== undefined) {
        return { status: 'manifest_conflict' };
      }
      if (this.#eventIdExists(input.consumptionEvent.eventId)) return { status: 'invalid' };
      if (this.#eventIdExists(input.completionEvent.eventId)) return { status: 'invalid' };
      if (this.#credentialAlreadyConsumed(input.authorizationId)) {
        return { status: 'authority_conflict' };
      }
      if (this.#singleUseKeyAlreadyConsumed(input.semanticSingleUseKeySha256)) {
        return { status: 'semantic_release_conflict' };
      }

      const consumptionSequence = this.#nextSequence();
      const consumption = decisionConsumptionEventSchema.parse({
        ...input.consumptionEvent,
        sequence: consumptionSequence,
      });
      this.#insert(consumption, consumption.singleUseKeySha256);
      this.#sqlite
        .prepare(
          `INSERT INTO human_eval_releases (
             manifest_sha256, manifest_json, release_candidate_manifest_sha256,
             authorization_id, authorization_content_sha256, validation_receipt_sha256,
             validation_receipt_json, operation_id, binding_sha256,
             semantic_single_use_key_sha256, consumption_event_id, completion_event_id
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.manifestSha256,
          input.manifestJson,
          input.releaseCandidateManifestSha256,
          input.authorizationId,
          input.authorizationContentSha256,
          input.validationReceiptSha256,
          input.validationReceiptJson,
          input.operationId,
          input.bindingSha256,
          input.semanticSingleUseKeySha256,
          input.consumptionEvent.eventId,
          input.completionEvent.eventId,
        );
      const completionSequence = this.#nextSequence();
      const completion = decisionCompletionEventSchema.parse({
        ...input.completionEvent,
        sequence: completionSequence,
      });
      this.#insert(completion, null);

      const release = this.#findDatasetReleaseByManifest(input.manifestSha256);
      if (release === undefined) throw new Error('Dataset release insert was not durable');
      return { status: 'created', release: this.#datasetReleaseRecord(release) };
    });
  }

  readDatasetRelease(manifestSha256: string): DatasetReleaseRecord | null {
    if (!sha256Pattern.test(manifestSha256)) return null;
    const release = this.#findDatasetReleaseByManifest(manifestSha256);
    return release === undefined ? null : this.#datasetReleaseRecord(release);
  }

  readDatasetReleaseByOperation(operationId: string): DatasetReleaseRecord | null {
    const release = this.#findDatasetReleaseByOperation(operationId);
    return release === undefined ? null : this.#datasetReleaseRecord(release);
  }

  appendCompletionIfInFlight(
    eventInput: Omit<DecisionCompletionEvent, 'sequence'>,
  ): AuthorityCompletionAppendResult {
    if (eventInput.kind === 'dataset_release_completed') return { status: 'invalid' };
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

  #validDatasetReleaseInput(input: FinalizeDatasetReleaseInput): boolean {
    const hashes = [
      input.manifestSha256,
      input.releaseCandidateManifestSha256,
      input.authorizationContentSha256,
      input.validationReceiptSha256,
      input.bindingSha256,
      input.semanticSingleUseKeySha256,
    ];
    if (hashes.some((hash) => !sha256Pattern.test(hash))) return false;
    try {
      JSON.parse(input.manifestJson);
      JSON.parse(input.validationReceiptJson);
    } catch {
      return false;
    }
    if (
      input.consumptionEvent.kind !== 'dataset_release_authorization_consumed' ||
      input.completionEvent.kind !== 'dataset_release_completed' ||
      input.consumptionEvent.credentialId !== input.authorizationId ||
      input.completionEvent.credentialId !== input.authorizationId ||
      input.consumptionEvent.operationId !== input.operationId ||
      input.completionEvent.operationId !== input.operationId ||
      input.consumptionEvent.bindingSha256 !== input.bindingSha256 ||
      input.consumptionEvent.singleUseKeySha256 !== input.semanticSingleUseKeySha256 ||
      input.completionEvent.durableReceiptSha256 !== input.manifestSha256 ||
      input.consumptionEvent.eventId === input.completionEvent.eventId
    ) {
      return false;
    }
    return (
      decisionConsumptionEventSchema.safeParse({ ...input.consumptionEvent, sequence: 0 })
        .success &&
      decisionCompletionEventSchema.safeParse({ ...input.completionEvent, sequence: 1 }).success
    );
  }

  #isExactDatasetReleaseRetry(
    stored: StoredDatasetReleaseRow,
    input: FinalizeDatasetReleaseInput,
  ): boolean {
    return (
      stored.release_candidate_manifest_sha256 === input.releaseCandidateManifestSha256 &&
      stored.authorization_id === input.authorizationId &&
      stored.authorization_content_sha256 === input.authorizationContentSha256 &&
      stored.binding_sha256 === input.bindingSha256 &&
      stored.semantic_single_use_key_sha256 === input.semanticSingleUseKeySha256
    );
  }

  #datasetReleaseRecord(row: StoredDatasetReleaseRow): DatasetReleaseRecord {
    const consumption = this.#readEvent(row.consumption_event_id);
    if (consumption === undefined) {
      throw new Error('Dataset release record is corrupt: consumption event is missing');
    }
    if (!isDatasetReleaseConsumptionEvent(consumption)) {
      throw new Error('Dataset release record is corrupt: consumption event binding mismatch');
    }
    if (
      consumption.credentialId !== row.authorization_id ||
      consumption.operationId !== row.operation_id ||
      consumption.singleUseKeySha256 !== row.semantic_single_use_key_sha256 ||
      consumption.bindingSha256 !== row.binding_sha256
    ) {
      throw new Error('Dataset release record is corrupt: consumption event binding mismatch');
    }
    const completion = this.#readEvent(row.completion_event_id);
    if (completion === undefined) {
      throw new Error('Dataset release record is corrupt: completion event is missing');
    }
    if (!isDatasetReleaseCompletionEvent(completion)) {
      throw new Error('Dataset release record is corrupt: completion event binding mismatch');
    }
    if (
      completion.credentialId !== row.authorization_id ||
      completion.operationId !== row.operation_id
    ) {
      throw new Error('Dataset release record is corrupt: completion event binding mismatch');
    }
    return deepFreezeClone({
      manifestSha256: row.manifest_sha256,
      manifestJson: row.manifest_json,
      releaseCandidateManifestSha256: row.release_candidate_manifest_sha256,
      authorizationId: row.authorization_id,
      authorizationContentSha256: row.authorization_content_sha256,
      validationReceiptSha256: row.validation_receipt_sha256,
      validationReceiptJson: row.validation_receipt_json,
      operationId: row.operation_id,
      bindingSha256: row.binding_sha256,
      semanticSingleUseKeySha256: row.semantic_single_use_key_sha256,
      consumptionEvent: consumption,
      completionEvent: completion,
    });
  }

  #readEvent(eventId: string): DecisionLifecycleEvent | undefined {
    const row = this.#sqlite
      .prepare(
        `SELECT sequence, event_id, kind, credential_id, single_use_key_sha256,
                operation_id, payload
         FROM authority_consumption_events
         WHERE event_id = ?`,
      )
      .get(eventId) as StoredEventRow | undefined;
    return row === undefined ? undefined : this.#eventFromRow(row);
  }

  #eventFromRow(row: StoredEventRow): DecisionLifecycleEvent {
    let payload: unknown;
    try {
      payload = JSON.parse(row.payload) as unknown;
    } catch (error) {
      throw new Error('Authority consumption event payload is corrupt JSON', { cause: error });
    }
    const event = decisionLifecycleEventSchema.parse(payload);
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
    return event;
  }

  #findDatasetReleaseByManifest(manifestSha256: string): StoredDatasetReleaseRow | undefined {
    return this.#sqlite
      .prepare(`SELECT * FROM human_eval_releases WHERE manifest_sha256 = ?`)
      .get(manifestSha256) as StoredDatasetReleaseRow | undefined;
  }

  #findDatasetReleaseByOperation(operationId: string): StoredDatasetReleaseRow | undefined {
    return this.#sqlite
      .prepare(`SELECT * FROM human_eval_releases WHERE operation_id = ?`)
      .get(operationId) as StoredDatasetReleaseRow | undefined;
  }

  #findDatasetReleaseByAuthorization(authorizationId: string): StoredDatasetReleaseRow | undefined {
    return this.#sqlite
      .prepare(`SELECT * FROM human_eval_releases WHERE authorization_id = ?`)
      .get(authorizationId) as StoredDatasetReleaseRow | undefined;
  }

  #findDatasetReleaseBySemanticKey(
    singleUseKeySha256: string,
  ): StoredDatasetReleaseRow | undefined {
    return this.#sqlite
      .prepare(`SELECT * FROM human_eval_releases WHERE semantic_single_use_key_sha256 = ?`)
      .get(singleUseKeySha256) as StoredDatasetReleaseRow | undefined;
  }

  #credentialAlreadyConsumed(credentialId: string): boolean {
    return (
      this.#sqlite
        .prepare(
          `SELECT 1 FROM authority_consumption_events
           WHERE credential_id = ? AND kind IN (${quotedConsumptionKinds}) LIMIT 1`,
        )
        .get(credentialId) !== undefined
    );
  }

  #singleUseKeyAlreadyConsumed(singleUseKeySha256: string): boolean {
    return (
      this.#sqlite
        .prepare(
          `SELECT 1 FROM authority_consumption_events
           WHERE single_use_key_sha256 = ? AND kind IN (${quotedConsumptionKinds}) LIMIT 1`,
        )
        .get(singleUseKeySha256) !== undefined
    );
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
