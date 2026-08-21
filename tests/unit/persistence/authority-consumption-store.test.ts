import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';

import { afterEach, describe, expect, it } from 'vitest';

import {
  SqliteAuthorityConsumptionStore,
  type AuthorityConsumptionStore,
} from '@operatingline/persistence';
import type { DecisionCompletionEvent, DecisionConsumptionEvent } from '@operatingline/protocol';

const stores: SqliteAuthorityConsumptionStore[] = [];
const h = (value: string) => value.repeat(64);

function open(filename: string): SqliteAuthorityConsumptionStore {
  const store = new SqliteAuthorityConsumptionStore(filename);
  stores.push(store);
  return store;
}

function databasePath(): string {
  return join(mkdtempSync(join(tmpdir(), 'operatingline-authority-')), 'events.sqlite');
}

function consumption(
  sequence: number,
  overrides: Partial<DecisionConsumptionEvent> = {},
): DecisionConsumptionEvent {
  return {
    formatVersion: '1.0.0',
    eventId: randomUUID(),
    sequence,
    kind: 'provider_authorization_consumed',
    credentialId: randomUUID(),
    singleUseKeySha256: h('a'),
    operationId: randomUUID(),
    bindingSha256: h('b'),
    consumedAt: '2026-08-21T12:00:00.000Z',
    ...overrides,
  } as DecisionConsumptionEvent;
}

function completion(
  source: DecisionConsumptionEvent,
  sequence: number,
  overrides: Partial<DecisionCompletionEvent> = {},
): DecisionCompletionEvent {
  const kindByConsumption = {
    provider_authorization_consumed: 'provider_call_completed',
    blender_decision_consumed: 'blender_execution_completed',
    blender_history_transition_consumed: 'blender_history_transition_completed',
    training_decision_consumed: 'training_run_completed',
  } as const;
  return {
    formatVersion: '1.0.0',
    eventId: randomUUID(),
    sequence,
    kind: kindByConsumption[source.kind],
    credentialId: source.credentialId,
    operationId: source.operationId,
    durableReceiptSha256: h('c'),
    completedAt: '2026-08-21T12:01:00.000Z',
    ...overrides,
  } as DecisionCompletionEvent;
}

async function concurrentlyAppend(
  filename: string,
  operations: readonly (
    | { readonly method: 'appendConsumptionIfUnused'; readonly event: DecisionConsumptionEvent }
    | { readonly method: 'appendCompletionIfInFlight'; readonly event: DecisionCompletionEvent }
  )[],
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
        const result = store[workerData.operation.method](workerData.operation.event);
        store.close();
        parentPort.postMessage({ result });
      } catch (error) {
        parentPort.postMessage({ error: error instanceof Error ? error.stack : String(error) });
      }
    });
  `;
  const workers = operations.map(
    (operation) =>
      new Worker(new URL(`data:text/javascript,${encodeURIComponent(source)}`), {
        execArgv: ['--import', 'tsx'],
        workerData: { filename, operation },
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
  const results = workers.map(
    (worker) =>
      new Promise<unknown>((resolve, reject) => {
        worker.once('error', reject);
        worker.once('message', (message: { result?: unknown; error?: string }) => {
          if (message.error) reject(new Error(message.error));
          else resolve(message.result);
        });
        worker.postMessage('go');
      }),
  );
  return Promise.all(results);
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe('SqliteAuthorityConsumptionStore', () => {
  it('persists strict sequence order across restart', () => {
    const filename = databasePath();
    const first = open(filename);
    const consumed = consumption(0);
    const completed = completion(consumed, 1);
    expect(first.appendConsumptionIfUnused(consumed)).toEqual({
      status: 'appended',
      event: consumed,
    });
    expect(first.appendCompletionIfInFlight(completed)).toEqual({
      status: 'appended',
      event: completed,
    });
    first.close();
    stores.splice(stores.indexOf(first), 1);

    const restarted = open(filename);
    expect(restarted.readAll()).toEqual([consumed, completed]);
  });

  it('atomically rejects duplicate credentials and cross-credential single-use keys', () => {
    const store = open(databasePath());
    const first = consumption(0);
    expect(store.appendConsumptionIfUnused(first).status).toBe('appended');
    expect(
      store.appendConsumptionIfUnused(
        consumption(1, { credentialId: first.credentialId, singleUseKeySha256: h('d') }),
      ),
    ).toEqual({ status: 'credential_duplicate' });
    expect(
      store.appendConsumptionIfUnused(
        consumption(1, {
          credentialId: randomUUID(),
          singleUseKeySha256: first.singleUseKeySha256,
        }),
      ),
    ).toEqual({ status: 'single_use_key_duplicate' });
    expect(store.readAll()).toEqual([first]);
  });

  it('preserves the global local-decision nonce key across kinds and restart', () => {
    const kinds = [
      'blender_decision_consumed',
      'blender_history_transition_consumed',
      'training_decision_consumed',
    ] as const;
    for (const firstKind of kinds) {
      for (const secondKind of kinds) {
        if (firstKind === secondKind) continue;
        const filename = databasePath();
        const firstStore = open(filename);
        const first = consumption(0, {
          kind: firstKind,
          singleUseKeySha256: h('d'),
        });
        expect(firstStore.appendConsumptionIfUnused(first).status).toBe('appended');
        firstStore.close();
        stores.splice(stores.indexOf(firstStore), 1);

        const restarted = open(filename);
        expect(
          restarted.appendConsumptionIfUnused(
            consumption(1, {
              kind: secondKind,
              singleUseKeySha256: first.singleUseKeySha256,
            }),
          ),
        ).toEqual({ status: 'single_use_key_duplicate' });
        expect(restarted.readAll()).toEqual([first]);
      }
    }
  });

  it('returns invalid for a validly shaped event whose event id conflicts', () => {
    const store = open(databasePath());
    const first = consumption(0);
    expect(store.appendConsumptionIfUnused(first).status).toBe('appended');
    expect(
      store.appendConsumptionIfUnused(
        consumption(1, {
          eventId: first.eventId,
          singleUseKeySha256: h('d'),
        }),
      ),
    ).toEqual({ status: 'invalid' });
  });

  it('only completes an in-flight matching credential, operation, and kind once', () => {
    const store = open(databasePath());
    const consumed = consumption(0, { kind: 'blender_history_transition_consumed' });
    expect(store.appendConsumptionIfUnused(consumed).status).toBe('appended');
    expect(
      store.appendCompletionIfInFlight(completion(consumed, 1, { credentialId: randomUUID() })),
    ).toEqual({ status: 'missing_consumption' });
    expect(
      store.appendCompletionIfInFlight(completion(consumed, 1, { operationId: randomUUID() })),
    ).toEqual({ status: 'operation_conflict' });
    expect(
      store.appendCompletionIfInFlight(
        completion(consumed, 1, { kind: 'blender_execution_completed' }),
      ),
    ).toEqual({ status: 'kind_conflict' });
    const completed = completion(consumed, 1);
    expect(store.appendCompletionIfInFlight(completed).status).toBe('appended');
    expect(store.appendCompletionIfInFlight(completion(consumed, 2))).toEqual({
      status: 'already_completed',
    });
    expect(store.readAll()).toEqual([consumed, completed]);
  });

  it('allows exactly one truly concurrent connection to claim the same authority', async () => {
    const filename = databasePath();
    const store = open(filename);
    const event = consumption(0);
    const competing = consumption(0, {
      credentialId: event.credentialId,
      singleUseKeySha256: event.singleUseKeySha256,
    });

    const results = await concurrentlyAppend(filename, [
      { method: 'appendConsumptionIfUnused', event },
      { method: 'appendConsumptionIfUnused', event: competing },
    ]);
    expect(results).toContainEqual({ status: 'credential_duplicate' });
    expect(
      results.filter((result) => (result as { status: string }).status === 'appended'),
    ).toHaveLength(1);
    expect(store.readAll()).toHaveLength(1);
  });

  it('persists both truly concurrent unrelated appends with contiguous sequences', async () => {
    const filename = databasePath();
    const store = open(filename);
    const first = consumption(99, { singleUseKeySha256: h('d') });
    const second = consumption(99, { singleUseKeySha256: h('e') });
    const results = await concurrentlyAppend(filename, [
      { method: 'appendConsumptionIfUnused', event: first },
      { method: 'appendConsumptionIfUnused', event: second },
    ]);
    expect(results.every((result) => (result as { status: string }).status === 'appended')).toBe(
      true,
    );
    const persisted = store.readAll();
    expect(persisted.map((event) => event.sequence)).toEqual([0, 1]);
    expect(new Set(persisted.map((event) => event.credentialId))).toEqual(
      new Set([first.credentialId, second.credentialId]),
    );
  });

  it('persists an unrelated append racing a valid completion', async () => {
    const filename = databasePath();
    const store = open(filename);
    const consumed = consumption(50, { singleUseKeySha256: h('d') });
    const appended = store.appendConsumptionIfUnused(consumed);
    expect(appended.status).toBe('appended');
    if (appended.status !== 'appended') throw new Error('Expected seed consumption');
    const unrelated = consumption(50, { singleUseKeySha256: h('e') });
    const completed = completion(appended.event, 50);
    const results = await concurrentlyAppend(filename, [
      { method: 'appendConsumptionIfUnused', event: unrelated },
      { method: 'appendCompletionIfInFlight', event: completed },
    ]);
    expect(results.every((result) => (result as { status: string }).status === 'appended')).toBe(
      true,
    );
    const persisted = store.readAll();
    expect(persisted.map((event) => event.sequence)).toEqual([0, 1, 2]);
    expect(persisted.some((event) => event.eventId === unrelated.eventId)).toBe(true);
    expect(persisted.some((event) => event.eventId === completed.eventId)).toBe(true);
  });

  it('returns recursively frozen snapshots that cannot mutate persisted payloads', () => {
    const store = open(databasePath());
    const event = consumption(0);
    expect(store.appendConsumptionIfUnused(event).status).toBe('appended');
    const first = store.readAll();
    const second = store.readAll();
    expect(first[0]).not.toBe(second[0]);
    expect(Object.isFrozen(first[0])).toBe(true);
    expect(() => Object.assign(first[0]!, { bindingSha256: h('f') })).toThrow();
    expect(store.readAll()[0]!.bindingSha256).toBe(event.bindingSha256);
  });

  it('is structurally compatible with the orchestrator store contract', () => {
    const store: AuthorityConsumptionStore = open(databasePath());
    expect(store.readAll()).toEqual([]);
  });
});
