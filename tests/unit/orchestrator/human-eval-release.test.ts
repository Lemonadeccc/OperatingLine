import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { HumanEvalDatasetError } from '@operatingline/eval-kit';
import { SqliteAuthorityConsumptionStore } from '@operatingline/persistence';
import {
  authoritySignedContent,
  computeProtocolCanonicalJsonSha256,
  datasetReleaseAuthorizationSchema,
  type AuthorityValidationReceipt,
  type DatasetReleaseAuthorization,
  type TrainingRunDecisionReceipt,
  type TrainingUseAuthorization,
} from '@operatingline/protocol';
import {
  AuthorityConsumptionCoordinator,
  InMemoryAuthorityConsumptionStore,
} from '../../../services/orchestrator/src/authority-consumption.js';
import {
  HumanEvalReleaseCoordinator,
  type HumanEvalReleaseError,
  type LiveDatasetReleaseAuthorityVerifier,
} from '../../../services/orchestrator/src/human-eval-release.js';
import {
  buildDatasetReleaseAuthorizationFixture,
  buildDatasetReleaseValidationReceiptFixture,
  buildHumanEvalReleaseCandidateFixture,
} from '../../support/human-eval-release-fixtures.js';

const operationId = '50000000-0000-4000-8000-000000000001';
const stores: SqliteAuthorityConsumptionStore[] = [];

function databasePath(): string {
  return join(mkdtempSync(join(tmpdir(), 'operatingline-eval-release-')), 'release.sqlite');
}

function open(filename = ':memory:'): SqliteAuthorityConsumptionStore {
  const store = new SqliteAuthorityConsumptionStore(filename);
  stores.push(store);
  return store;
}

class FixtureVerifier implements LiveDatasetReleaseAuthorityVerifier {
  callCount = 0;
  receiptOverride: Partial<AuthorityValidationReceipt> = {};
  failure: Error | null = null;

  verify(input: { readonly record: unknown }): AuthorityValidationReceipt {
    this.callCount += 1;
    if (this.failure !== null) throw this.failure;
    const authorization = datasetReleaseAuthorizationSchema.parse(input.record);
    return buildDatasetReleaseValidationReceiptFixture(authorization, this.receiptOverride);
  }
}

function request(
  authorizationOverride: Partial<DatasetReleaseAuthorization> = {},
  requestedOperationId = operationId,
) {
  const releaseCandidate = buildHumanEvalReleaseCandidateFixture();
  const authorization = buildDatasetReleaseAuthorizationFixture(
    releaseCandidate,
    authorizationOverride,
  );
  return {
    formatVersion: '1.0.0' as const,
    operationId: requestedOperationId,
    releaseCandidate,
    authorization,
  };
}

function mutateLifecycleEvent(
  filename: string,
  kind: 'dataset_release_authorization_consumed' | 'dataset_release_completed',
  mutate: (event: Record<string, unknown>) => void,
): void {
  const sqlite = new DatabaseSync(filename);
  const row = sqlite
    .prepare(`SELECT event_id, payload FROM authority_consumption_events WHERE kind = ?`)
    .get(kind) as { event_id: string; payload: string };
  const event = JSON.parse(row.payload) as Record<string, unknown>;
  mutate(event);
  sqlite
    .prepare(`UPDATE authority_consumption_events SET payload = ? WHERE event_id = ?`)
    .run(JSON.stringify(event), row.event_id);
  sqlite.close();
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe('HumanEvalReleaseCoordinator', () => {
  it('live-verifies and atomically commits an authorization-bound release', () => {
    const store = open();
    const verifier = new FixtureVerifier();
    const coordinator = new HumanEvalReleaseCoordinator(store, verifier, {
      now: () => new Date('2026-08-22T11:01:00.000Z'),
    });

    const response = coordinator.finalize(request());

    expect(response.status).toBe('created');
    expect(response.releasedManifestSha256).toBe(response.releasedManifest.integrity.contentSha256);
    expect(response.releasedManifest.dataHandling.trainingUse).toBe('not_authorized');
    expect(verifier.callCount).toBe(1);
    expect(store.readAll().map((event) => event.kind)).toEqual([
      'dataset_release_authorization_consumed',
      'dataset_release_completed',
    ]);
    expect(store.readAll()[1]).toEqual(
      expect.objectContaining({ durableReceiptSha256: response.releasedManifestSha256 }),
    );
    expect(
      new AuthorityConsumptionCoordinator(store).stateFor(
        response.releasedManifest.authorization.authorityId,
      ),
    ).toEqual(expect.objectContaining({ status: 'completed' }));
  });

  it('returns the first durable manifest on exact retries without re-verifying authority', () => {
    const filename = databasePath();
    const firstStore = open(filename);
    const firstVerifier = new FixtureVerifier();
    const firstCoordinator = new HumanEvalReleaseCoordinator(firstStore, firstVerifier, {
      now: () => new Date('2026-08-22T11:01:00.000Z'),
    });
    const first = firstCoordinator.finalize(request());
    firstStore.close();
    stores.splice(stores.indexOf(firstStore), 1);

    const restarted = open(filename);
    const unavailableVerifier = new FixtureVerifier();
    unavailableVerifier.failure = new Error('authority is now revoked');
    const restartedCoordinator = new HumanEvalReleaseCoordinator(restarted, unavailableVerifier);
    const retry = restartedCoordinator.finalize(request());

    expect(retry.status).toBe('already_completed');
    expect(retry.releasedManifest).toEqual(first.releasedManifest);
    expect(retry.releasedManifestSha256).toBe(first.releasedManifestSha256);
    expect(unavailableVerifier.callCount).toBe(0);
    expect(restarted.readAll()).toHaveLength(2);
  });

  it('rejects detached-signature drift on an otherwise exact operation retry', () => {
    const store = open();
    const verifier = new FixtureVerifier();
    const coordinator = new HumanEvalReleaseCoordinator(store, verifier, {
      now: () => new Date('2026-08-22T11:01:00.000Z'),
    });
    const original = request();
    coordinator.finalize(original);
    const changedSignature = structuredClone(original);
    changedSignature.authorization.signature.signature = 'B'.repeat(86);

    expect(() => coordinator.finalize(changedSignature)).toThrowError(
      expect.objectContaining({ code: 'operation_conflict' }),
    );
    expect(verifier.callCount).toBe(1);
    expect(store.readAll()).toHaveLength(2);
  });

  it('rejects candidate mutation before calling the live verifier or writing events', () => {
    const store = open();
    const verifier = new FixtureVerifier();
    const coordinator = new HumanEvalReleaseCoordinator(store, verifier);
    const input = request();
    input.releaseCandidate.suite.suiteVersion = '1.0.1';

    expect(() => coordinator.finalize(input)).toThrow(HumanEvalDatasetError);
    expect(verifier.callCount).toBe(0);
    expect(store.readAll()).toEqual([]);
  });

  it('rejects a mismatched live receipt before consuming release authority', () => {
    const store = open();
    const verifier = new FixtureVerifier();
    verifier.receiptOverride = { targetSha256: '0'.repeat(64) };
    const coordinator = new HumanEvalReleaseCoordinator(store, verifier);

    expect(() => coordinator.finalize(request())).toThrowError(
      expect.objectContaining<Partial<HumanEvalReleaseError>>({
        code: 'validation_receipt_mismatch',
      }),
    );
    expect(store.readAll()).toEqual([]);
  });

  it('leaves no records when live revocation verification fails', () => {
    const store = open();
    const verifier = new FixtureVerifier();
    verifier.failure = new Error('revoked');
    const coordinator = new HumanEvalReleaseCoordinator(store, verifier);

    expect(() => coordinator.finalize(request())).toThrow('revoked');
    expect(store.readAll()).toEqual([]);
  });

  it('rejects operation, authority, and semantic release reuse independently', () => {
    const store = open();
    const verifier = new FixtureVerifier();
    const coordinator = new HumanEvalReleaseCoordinator(store, verifier, {
      now: () => new Date('2026-08-22T11:01:00.000Z'),
    });
    coordinator.finalize(request());

    expect(() =>
      coordinator.finalize(request({ releaseScope: 'different approved scope' }, operationId)),
    ).toThrowError(expect.objectContaining({ code: 'operation_conflict' }));
    expect(() =>
      coordinator.finalize(request({}, '50000000-0000-4000-8000-000000000002')),
    ).toThrowError(expect.objectContaining({ code: 'authority_conflict' }));
    expect(() =>
      coordinator.finalize(
        request(
          { authorityId: '30000000-0000-4000-8000-000000000002' },
          '50000000-0000-4000-8000-000000000003',
        ),
      ),
    ).toThrowError(expect.objectContaining({ code: 'semantic_release_conflict' }));
    expect(store.readAll()).toHaveLength(2);
  });

  it('detects durable manifest payload tampering on restart-safe retry', () => {
    const filename = databasePath();
    const store = open(filename);
    const verifier = new FixtureVerifier();
    const coordinator = new HumanEvalReleaseCoordinator(store, verifier, {
      now: () => new Date('2026-08-22T11:01:00.000Z'),
    });
    coordinator.finalize(request());

    const sqlite = new DatabaseSync(filename);
    sqlite
      .prepare(`UPDATE human_eval_releases SET manifest_json = ? WHERE operation_id = ?`)
      .run('{}', operationId);
    sqlite.close();

    expect(() => coordinator.finalize(request())).toThrowError(
      expect.objectContaining({ code: 'stored_release_corrupt' }),
    );
    expect(verifier.callCount).toBe(1);
  });

  it('detects tampered or missing lifecycle evidence on restart-safe retry', () => {
    const scenarios = [
      {
        name: 'consumption binding',
        mutate(filename: string) {
          mutateLifecycleEvent(filename, 'dataset_release_authorization_consumed', (event) => {
            event['bindingSha256'] = '0'.repeat(64);
          });
        },
      },
      {
        name: 'completion receipt',
        mutate(filename: string) {
          mutateLifecycleEvent(filename, 'dataset_release_completed', (event) => {
            event['durableReceiptSha256'] = '0'.repeat(64);
          });
        },
      },
      {
        name: 'missing completion',
        mutate(filename: string) {
          const sqlite = new DatabaseSync(filename);
          sqlite
            .prepare(`DELETE FROM authority_consumption_events WHERE kind = ?`)
            .run('dataset_release_completed');
          sqlite.close();
        },
      },
    ] as const;

    for (const scenario of scenarios) {
      const filename = databasePath();
      const store = open(filename);
      const verifier = new FixtureVerifier();
      const coordinator = new HumanEvalReleaseCoordinator(store, verifier, {
        now: () => new Date('2026-08-22T11:01:00.000Z'),
      });
      coordinator.finalize(request());
      scenario.mutate(filename);

      expect(() => coordinator.finalize(request()), scenario.name).toThrowError(
        expect.objectContaining({ code: 'stored_release_corrupt' }),
      );
      expect(verifier.callCount, scenario.name).toBe(1);
    }
  });

  it('keeps training isolated behind a later authorization for the final manifest hash', () => {
    const releaseStore = open();
    const release = new HumanEvalReleaseCoordinator(releaseStore, new FixtureVerifier(), {
      now: () => new Date('2026-08-22T11:01:00.000Z'),
    }).finalize(request());
    const candidateSha256 = release.releasedManifest.releaseCandidate.integrity.contentSha256;
    const releasedManifestSha256 = release.releasedManifestSha256;
    expect(candidateSha256).not.toBe(releasedManifestSha256);

    const trainingAuthorization: TrainingUseAuthorization = {
      formatVersion: '1.0.0',
      canonicalization: 'operatingline-authority-json-v1',
      kind: 'TrainingUseAuthorization',
      authorityId: '60000000-0000-4000-8000-000000000001',
      issuer: 'training.operator',
      notBefore: '2026-08-22T10:00:00.000Z',
      expiresAt: '2026-08-22T12:00:00.000Z',
      releasedManifestSha256: candidateSha256,
      purpose: 'fine-tuning',
      modelFamily: 'family',
      scope: 'export_and_run',
      signature: {
        signerId: 'training.operator',
        keyId: 'training-key-1',
        algorithm: 'ed25519',
        signature: 'A'.repeat(86),
        signedAt: '2026-08-22T10:00:00.000Z',
      },
    };
    const trainingReceipt: AuthorityValidationReceipt = {
      formatVersion: '1.0.0',
      receiptId: '60000000-0000-4000-8000-000000000002',
      authorityKind: 'TrainingUseAuthorization',
      authorityId: trainingAuthorization.authorityId,
      authorityContentSha256: computeProtocolCanonicalJsonSha256(
        authoritySignedContent(trainingAuthorization),
      ),
      signerId: trainingAuthorization.signature.signerId,
      keyId: trainingAuthorization.signature.keyId,
      registryVersion: 'registry-1',
      validatedAt: '2026-08-22T11:00:00.000Z',
      revocationLogHeadSha256: 'f'.repeat(64),
      targetSha256: candidateSha256,
      sideEffect: 'training_export',
    };
    const decision: TrainingRunDecisionReceipt = {
      formatVersion: '1.0.0',
      kind: 'TrainingRunDecisionReceipt',
      decisionId: '60000000-0000-4000-8000-000000000003',
      nonce: 'training_release_nonce_1',
      issuedAt: '2026-08-22T11:00:00.000Z',
      expiresAt: '2026-08-22T11:02:00.000Z',
      trainingUseValidationReceipt: trainingReceipt,
      releasedManifestSha256,
      trainingExportSha256: 'a'.repeat(64),
      codeSha256: 'b'.repeat(64),
      configSha256: 'c'.repeat(64),
      modelFamilySha256: computeProtocolCanonicalJsonSha256(trainingAuthorization.modelFamily),
      runId: '60000000-0000-4000-8000-000000000004',
    };
    const binding = {
      releasedManifestSha256,
      trainingExportSha256: decision.trainingExportSha256,
      codeSha256: decision.codeSha256,
      configSha256: decision.configSha256,
      modelFamilySha256: decision.modelFamilySha256,
      runId: decision.runId,
    };
    const trainingStore = new InMemoryAuthorityConsumptionStore();

    expect(() =>
      new AuthorityConsumptionCoordinator(trainingStore, {
        now: () => new Date('2026-08-22T11:01:00.000Z'),
        isTrustedLocalDecision: () => true,
      }).consumeTrainingDecision({
        decision,
        trainingUseAuthorization: trainingAuthorization,
        liveVerifier: { verify: () => trainingReceipt },
        operationId: '60000000-0000-4000-8000-000000000005',
        binding,
      }),
    ).toThrow(/decision_mismatch/u);
    expect(trainingStore.readAll()).toEqual([]);
  });
});
