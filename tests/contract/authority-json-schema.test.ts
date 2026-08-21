import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { randomUUID } from 'node:crypto';
import { describe, it } from 'vitest';

import { validatePublicJsonSchemaCases } from '../../services/orchestrator/test-support/public-json-schema-validator.js';

const hash = 'a'.repeat(64);
const signature = {
  signerId: 'operator',
  keyId: 'key',
  algorithm: 'ed25519',
  signature: 'A'.repeat(86),
  signedAt: '2026-08-21T00:00:00.000Z',
};
const readSchema = (name: string): object =>
  JSON.parse(readFileSync(resolve('protocol/schemas/v1', name), 'utf8')) as object;

describe('public authority and decision JSON schemas', () => {
  it('round-trips the external authority union and rejects extensions/substitution', async () => {
    const record = {
      formatVersion: '1.0.0',
      canonicalization: 'operatingline-authority-json-v1',
      kind: 'ProviderCallAuthorization',
      authorityId: randomUUID(),
      issuer: 'operator',
      notBefore: '2026-08-21T00:00:00.000Z',
      expiresAt: '2026-08-22T00:00:00.000Z',
      provider: { providerId: 'provider', descriptorVersion: '1', model: 'model' },
      operation: 'planning_generation',
      generationRequestSha256: hash,
      disclosedDataSha256: hash,
      maximumCallCount: 1,
      signature,
    };
    await validatePublicJsonSchemaCases(readSchema('external-authority-record.schema.json'), [
      { value: record, accepted: true },
      { value: { ...record, publicKey: 'forbidden' }, accepted: false },
      { value: { ...record, kind: 'TrainingUseAuthorization' }, accepted: false },
      { value: { ...record, signature: { ...signature, algorithm: 'EdDSA' } }, accepted: false },
    ]);
  });

  it('round-trips local decisions and append-only lifecycle events', async () => {
    const decision = {
      formatVersion: '1.0.0',
      kind: 'BlenderExecutionDecisionReceipt',
      decisionId: randomUUID(),
      nonce: 'nonce_nonce_nonce_1',
      issuedAt: '2026-08-21T00:00:00.000Z',
      expiresAt: '2026-08-21T00:05:00.000Z',
      acceptedContentSha256: hash,
      acceptedContentKind: 'proposal',
      replayId: randomUUID(),
      target: { adapterId: 'blender', instanceId: randomUUID() },
      blenderSessionId: 'session',
      documentFingerprintSha256: hash,
      actionCatalogVersion: '1.22.0',
      interactionCatalogVersion: '1.40.0',
    };
    await validatePublicJsonSchemaCases(
      readSchema('blender-execution-decision-receipt.schema.json'),
      [
        { value: decision, accepted: true },
        { value: { ...decision, authorized: true }, accepted: false },
      ],
    );
    const event = {
      formatVersion: '1.0.0',
      eventId: randomUUID(),
      sequence: 0,
      kind: 'blender_decision_consumed',
      credentialId: decision.decisionId,
      singleUseKeySha256: hash,
      operationId: randomUUID(),
      bindingSha256: hash,
      consumedAt: '2026-08-21T00:00:01.000Z',
    };
    await validatePublicJsonSchemaCases(readSchema('decision-lifecycle-event.schema.json'), [
      { value: event, accepted: true },
      {
        value: Object.fromEntries(
          Object.entries(event).filter(([key]) => key !== 'singleUseKeySha256'),
        ),
        accepted: false,
      },
    ]);
  });
});
