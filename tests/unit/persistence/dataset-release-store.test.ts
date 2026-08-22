import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';

import { afterEach, describe, expect, it } from 'vitest';

import {
  SqliteAuthorityConsumptionStore,
  type FinalizeDatasetReleaseInput,
} from '@operatingline/persistence';

const stores: SqliteAuthorityConsumptionStore[] = [];
const h = (value: string) => value.repeat(64);

function databasePath(): string {
  return join(mkdtempSync(join(tmpdir(), 'operatingline-dataset-release-')), 'release.sqlite');
}

function open(filename: string): SqliteAuthorityConsumptionStore {
  const store = new SqliteAuthorityConsumptionStore(filename);
  stores.push(store);
  return store;
}

function releaseInput(
  overrides: Partial<FinalizeDatasetReleaseInput> = {},
): FinalizeDatasetReleaseInput {
  const authorizationId = overrides.authorizationId ?? randomUUID();
  const operationId = overrides.operationId ?? randomUUID();
  const manifestSha256 = overrides.manifestSha256 ?? h('a');
  const bindingSha256 = overrides.bindingSha256 ?? h('e');
  const semanticSingleUseKeySha256 = overrides.semanticSingleUseKeySha256 ?? h('f');
  return {
    manifestSha256,
    manifestJson: '{"kind":"HumanEvalReleasedManifest","value":"first"}',
    releaseCandidateManifestSha256: h('b'),
    authorizationId,
    authorizationContentSha256: h('c'),
    validationReceiptSha256: h('d'),
    validationReceiptJson: '{"kind":"AuthorityValidationReceipt","value":"first"}',
    operationId,
    bindingSha256,
    semanticSingleUseKeySha256,
    consumptionEvent: {
      formatVersion: '1.0.0',
      eventId: randomUUID(),
      kind: 'dataset_release_authorization_consumed',
      credentialId: authorizationId,
      singleUseKeySha256: semanticSingleUseKeySha256,
      operationId,
      bindingSha256,
      consumedAt: '2026-08-23T10:00:00.000Z',
    },
    completionEvent: {
      formatVersion: '1.0.0',
      eventId: randomUUID(),
      kind: 'dataset_release_completed',
      credentialId: authorizationId,
      operationId,
      durableReceiptSha256: manifestSha256,
      completedAt: '2026-08-23T10:00:01.000Z',
    },
    ...overrides,
  };
}

async function concurrentlyFinalize(
  filename: string,
  inputs: readonly FinalizeDatasetReleaseInput[],
): Promise<unknown[]> {
  const storeModuleUrl = new URL(
    '../../../packages/persistence/src/authority-consumption-store.ts',
    import.meta.url,
  ).href;
  const source = `
    import { parentPort, workerData } from 'node:worker_threads';
    import { SqliteAuthorityConsumptionStore } from ${JSON.stringify(storeModuleUrl)};
    const store = new SqliteAuthorityConsumptionStore(workerData.filename);
    parentPort.postMessage({ ready: true });
    parentPort.once('message', () => {
      try {
        const result = store.finalizeDatasetReleaseIfUnused(workerData.input);
        store.close();
        parentPort.postMessage({ result });
      } catch (error) {
        parentPort.postMessage({ error: error instanceof Error ? error.stack : String(error) });
      }
    });
  `;
  const workers = inputs.map(
    (input) =>
      new Worker(new URL(`data:text/javascript,${encodeURIComponent(source)}`), {
        execArgv: ['--import', 'tsx'],
        workerData: { filename, input },
      }),
  );
  await Promise.all(
    workers.map(
      (worker) =>
        new Promise<void>((resolve, reject) => {
          worker.once('error', reject);
          worker.once('message', (message: { ready?: boolean }) => {
            if (message.ready) resolve();
            else reject(new Error('Worker failed before reaching the barrier'));
          });
        }),
    ),
  );
  return Promise.all(
    workers.map(
      (worker) =>
        new Promise<unknown>((resolve, reject) => {
          worker.once('error', reject);
          worker.once('message', (message: { result?: unknown; error?: string }) => {
            if (message.error) reject(new Error(message.error));
            else resolve(message.result);
          });
          worker.postMessage('go');
        }),
    ),
  );
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe('atomic Human Eval dataset release persistence', () => {
  it('commits the exact manifest between matching consumption and completion events', () => {
    const store = open(databasePath());
    const input = releaseInput();

    expect(store.finalizeDatasetReleaseIfUnused(input)).toEqual({
      status: 'created',
      release: expect.objectContaining({
        manifestSha256: input.manifestSha256,
        manifestJson: input.manifestJson,
        validationReceiptJson: input.validationReceiptJson,
      }),
    });
    expect(store.readDatasetRelease(input.manifestSha256)).toMatchObject({
      manifestJson: input.manifestJson,
      validationReceiptJson: input.validationReceiptJson,
      consumptionEvent: { ...input.consumptionEvent, sequence: 0 },
      completionEvent: { ...input.completionEvent, sequence: 1 },
    });
    expect(store.readDatasetReleaseByOperation(input.operationId)).toEqual(
      store.readDatasetRelease(input.manifestSha256),
    );
    expect(Object.isFrozen(store.readDatasetReleaseByOperation(input.operationId))).toBe(true);
    expect(
      Object.isFrozen(store.readDatasetReleaseByOperation(input.operationId)?.completionEvent),
    ).toBe(true);
    expect(store.readAll()).toEqual([
      { ...input.consumptionEvent, sequence: 0 },
      { ...input.completionEvent, sequence: 1 },
    ]);
  });

  it('rejects dataset release events through the non-atomic append APIs', () => {
    const store = open(databasePath());
    const input = releaseInput();

    expect(store.appendConsumptionIfUnused(input.consumptionEvent)).toEqual({ status: 'invalid' });
    expect(store.appendCompletionIfInFlight(input.completionEvent)).toEqual({ status: 'invalid' });
    expect(store.readAll()).toEqual([]);
  });

  it('returns the first exact stored bytes for an idempotent retry after restart', () => {
    const filename = databasePath();
    const input = releaseInput();
    const first = open(filename);
    expect(first.finalizeDatasetReleaseIfUnused(input).status).toBe('created');
    first.close();
    stores.splice(stores.indexOf(first), 1);

    const restarted = open(filename);
    const retry = releaseInput({
      ...input,
      manifestSha256: h('1'),
      manifestJson: '{"different":true}',
      validationReceiptSha256: h('2'),
      validationReceiptJson: '{"different":"receipt"}',
      consumptionEvent: { ...input.consumptionEvent, eventId: randomUUID() },
      completionEvent: {
        ...input.completionEvent,
        eventId: randomUUID(),
        durableReceiptSha256: h('1'),
      },
    });
    const result = restarted.finalizeDatasetReleaseIfUnused(retry);
    expect(result).toEqual({
      status: 'already_completed',
      release: expect.objectContaining({
        manifestSha256: input.manifestSha256,
        manifestJson: input.manifestJson,
        validationReceiptJson: input.validationReceiptJson,
      }),
    });
    expect(restarted.readAll()).toHaveLength(2);
  });

  it('migrates the legacy event kind constraint without losing existing events', () => {
    const filename = databasePath();
    const credentialId = randomUUID();
    const operationId = randomUUID();
    const existing = {
      formatVersion: '1.0.0',
      eventId: randomUUID(),
      sequence: 0,
      kind: 'provider_authorization_consumed',
      credentialId,
      singleUseKeySha256: h('7'),
      operationId,
      bindingSha256: h('6'),
      consumedAt: '2026-08-23T09:00:00.000Z',
    } as const;
    const legacy = new DatabaseSync(filename);
    legacy.exec(`
      CREATE TABLE authority_consumption_events (
        sequence INTEGER PRIMARY KEY CHECK (sequence >= 0),
        event_id TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL CHECK (kind IN (
          'provider_authorization_consumed', 'blender_decision_consumed',
          'blender_history_transition_consumed', 'training_decision_consumed',
          'provider_call_completed', 'blender_execution_completed',
          'blender_history_transition_completed', 'training_run_completed'
        )),
        credential_id TEXT NOT NULL,
        single_use_key_sha256 TEXT,
        operation_id TEXT NOT NULL,
        payload TEXT NOT NULL
      );
    `);
    legacy
      .prepare(
        `INSERT INTO authority_consumption_events
         (sequence, event_id, kind, credential_id, single_use_key_sha256, operation_id, payload)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        existing.sequence,
        existing.eventId,
        existing.kind,
        existing.credentialId,
        existing.singleUseKeySha256,
        existing.operationId,
        JSON.stringify(existing),
      );
    legacy.close();

    const migrated = open(filename);
    expect(migrated.readAll()).toEqual([existing]);
    const input = releaseInput();
    expect(migrated.finalizeDatasetReleaseIfUnused(input).status).toBe('created');
    expect(migrated.readAll().map((event) => event.sequence)).toEqual([0, 1, 2]);
  });

  it('distinguishes operation, authority, semantic release, and manifest conflicts', () => {
    const store = open(databasePath());
    const first = releaseInput();
    expect(store.finalizeDatasetReleaseIfUnused(first).status).toBe('created');

    expect(
      store.finalizeDatasetReleaseIfUnused(
        releaseInput({ operationId: first.operationId, bindingSha256: h('9') }),
      ),
    ).toEqual({ status: 'operation_conflict' });
    expect(
      store.finalizeDatasetReleaseIfUnused(
        releaseInput({ authorizationId: first.authorizationId }),
      ),
    ).toEqual({ status: 'authority_conflict' });
    expect(
      store.finalizeDatasetReleaseIfUnused(
        releaseInput({ semanticSingleUseKeySha256: first.semanticSingleUseKeySha256 }),
      ),
    ).toEqual({ status: 'semantic_release_conflict' });
    expect(
      store.finalizeDatasetReleaseIfUnused(
        releaseInput({
          manifestSha256: first.manifestSha256,
          semanticSingleUseKeySha256: h('8'),
        }),
      ),
    ).toEqual({ status: 'manifest_conflict' });
    expect(store.readAll()).toHaveLength(2);
  });

  it('allows only one concurrent connection to create an exact release', async () => {
    const filename = databasePath();
    const observer = open(filename);
    const input = releaseInput();
    const competing = releaseInput({
      ...input,
      consumptionEvent: { ...input.consumptionEvent, eventId: randomUUID() },
      completionEvent: { ...input.completionEvent, eventId: randomUUID() },
    });

    const results = await concurrentlyFinalize(filename, [input, competing]);
    expect(results.map((result) => (result as { status: string }).status).sort()).toEqual([
      'already_completed',
      'created',
    ]);
    expect(observer.readAll()).toHaveLength(2);
    expect(observer.readDatasetRelease(input.manifestSha256)?.manifestJson).toBe(
      input.manifestJson,
    );
  });

  it('rolls back consumption, manifest, and completion when the final insert fails', () => {
    const filename = databasePath();
    const initialized = open(filename);
    initialized.close();
    stores.splice(stores.indexOf(initialized), 1);
    const injector = new DatabaseSync(filename);
    injector.exec(`
      CREATE TRIGGER reject_dataset_release_completion
      BEFORE INSERT ON authority_consumption_events
      WHEN NEW.kind = 'dataset_release_completed'
      BEGIN
        SELECT RAISE(ABORT, 'injected completion failure');
      END;
    `);
    injector.close();

    const store = open(filename);
    const input = releaseInput();
    expect(() => store.finalizeDatasetReleaseIfUnused(input)).toThrow(
      /injected completion failure/u,
    );
    expect(store.readAll()).toEqual([]);
    expect(store.readDatasetRelease(input.manifestSha256)).toBeNull();
  });

  it('returns a structurally valid tampered durable hash for upper-layer integrity checks', () => {
    const filename = databasePath();
    const store = open(filename);
    const input = releaseInput();
    expect(store.finalizeDatasetReleaseIfUnused(input).status).toBe('created');
    const mutator = new DatabaseSync(filename);
    const row = mutator
      .prepare(`SELECT payload FROM authority_consumption_events WHERE event_id = ?`)
      .get(input.completionEvent.eventId) as { payload: string };
    const payload = JSON.parse(row.payload) as Record<string, unknown>;
    payload.durableReceiptSha256 = h('9');
    mutator
      .prepare(`UPDATE authority_consumption_events SET payload = ? WHERE event_id = ?`)
      .run(JSON.stringify(payload), input.completionEvent.eventId);
    mutator.close();

    expect(
      store.readDatasetRelease(input.manifestSha256)?.completionEvent.durableReceiptSha256,
    ).toBe(h('9'));
  });

  it('throws a corruption error when a referenced lifecycle event is missing', () => {
    const filename = databasePath();
    const store = open(filename);
    const input = releaseInput();
    expect(store.finalizeDatasetReleaseIfUnused(input).status).toBe('created');
    const mutator = new DatabaseSync(filename);
    mutator
      .prepare(`DELETE FROM authority_consumption_events WHERE event_id = ?`)
      .run(input.completionEvent.eventId);
    mutator.close();

    expect(() => store.readDatasetRelease(input.manifestSha256)).toThrow(
      /Dataset release record is corrupt: completion event is missing/u,
    );
  });

  it('throws a corruption error when event columns no longer match their payload', () => {
    const filename = databasePath();
    const store = open(filename);
    const input = releaseInput();
    expect(store.finalizeDatasetReleaseIfUnused(input).status).toBe('created');
    const mutator = new DatabaseSync(filename);
    mutator
      .prepare(`UPDATE authority_consumption_events SET operation_id = ? WHERE event_id = ?`)
      .run(randomUUID(), input.completionEvent.eventId);
    mutator.close();

    expect(() => store.readDatasetReleaseByOperation(input.operationId)).toThrow(
      /Authority consumption event columns do not match its payload/u,
    );
  });

  it('throws a corruption error when a referenced event has the wrong lifecycle kind', () => {
    const filename = databasePath();
    const store = open(filename);
    const input = releaseInput();
    expect(store.finalizeDatasetReleaseIfUnused(input).status).toBe('created');
    const mutator = new DatabaseSync(filename);
    const row = mutator
      .prepare(`SELECT payload FROM authority_consumption_events WHERE event_id = ?`)
      .get(input.completionEvent.eventId) as { payload: string };
    const payload = JSON.parse(row.payload) as Record<string, unknown>;
    payload.kind = 'training_run_completed';
    mutator
      .prepare(`UPDATE authority_consumption_events SET kind = ?, payload = ? WHERE event_id = ?`)
      .run('training_run_completed', JSON.stringify(payload), input.completionEvent.eventId);
    mutator.close();

    expect(() => store.readDatasetRelease(input.manifestSha256)).toThrow(
      /Dataset release record is corrupt: completion event binding mismatch/u,
    );
  });
});
