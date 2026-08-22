import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  authoritySignatureDomainPrefix,
  authoritySignedContent,
  canonicalizeProtocolJsonValue,
  humanEvalReleaseResponseSchema,
  type DatasetReleaseAuthorization,
} from '@operatingline/protocol';
import { startRuntime, type RunningRuntime } from '@operatingline/orchestrator';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildDatasetReleaseAuthorizationFixture,
  buildHumanEvalReleaseCandidateFixture,
} from '../../support/human-eval-release-fixtures.js';

const accessToken = 'human-eval-release-runtime-token';
const authorizationHeaders = {
  authorization: `Bearer ${accessToken}`,
  'content-type': 'application/json',
};
const authorityKeys = generateKeyPairSync('ed25519');
const runtimes: RunningRuntime[] = [];
const temporaryDirectories: string[] = [];

function authorityMessage(kind: 'DatasetReleaseAuthorization', content: unknown): Buffer {
  return Buffer.concat([
    Buffer.from(authoritySignatureDomainPrefix(kind)),
    Buffer.from(canonicalizeProtocolJsonValue(content)),
  ]);
}

function signedAuthorization(
  candidate = buildHumanEvalReleaseCandidateFixture(),
  overrides: Partial<DatasetReleaseAuthorization> = {},
): DatasetReleaseAuthorization {
  const now = new Date();
  const unsigned = buildDatasetReleaseAuthorizationFixture(candidate, {
    authorityId: randomUUID(),
    notBefore: new Date(now.getTime() - 60_000).toISOString(),
    expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
    signature: {
      signerId: 'release.operator',
      keyId: 'release-key-1',
      algorithm: 'ed25519',
      signature: 'A'.repeat(86),
      signedAt: now.toISOString(),
    },
    ...overrides,
  });
  return {
    ...unsigned,
    signature: {
      ...unsigned.signature,
      signature: sign(
        null,
        authorityMessage(unsigned.kind, authoritySignedContent(unsigned)),
        authorityKeys.privateKey,
      ).toString('base64url'),
    },
  };
}

async function createRuntime(configured = true): Promise<RunningRuntime> {
  const directory = mkdtempSync(join(tmpdir(), 'operatingline-eval-release-runtime-'));
  temporaryDirectories.push(directory);
  const registry = {
    version: 'human-eval-release-integration-v1',
    revocationLog: {
      length: 0,
      headSha256: createHash('sha256').update(canonicalizeProtocolJsonValue([])).digest('hex'),
    },
    signers: [
      {
        signerId: 'release.operator',
        keyId: 'release-key-1',
        algorithm: 'ed25519' as const,
        canonicalization: 'operatingline-authority-json-v1' as const,
        publicKeyPem: authorityKeys.publicKey.export({ format: 'pem', type: 'spki' }).toString(),
        roles: ['dataset_release_authorizer' as const],
      },
    ],
  };
  const runtime = await startRuntime({
    databasePath: join(directory, 'runtime.db'),
    accessToken,
    ...(configured
      ? {
          humanEvalReleaseAuthority: {
            trustSource: { readSnapshot: () => ({ registry, revocations: [] }) },
          },
        }
      : {}),
  });
  runtimes.push(runtime);
  return runtime;
}

function releaseRequest(authorization = signedAuthorization(), operationId = randomUUID()) {
  return {
    formatVersion: '1.0.0' as const,
    operationId,
    releaseCandidate: buildHumanEvalReleaseCandidateFixture(),
    authorization,
  };
}

async function postRelease(runtime: RunningRuntime, body: unknown, authenticated = true) {
  return fetch(`${runtime.baseUrl}/api/v1/eval/releases`, {
    method: 'POST',
    headers: authenticated ? authorizationHeaders : { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.stop()));
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('Human Eval authorized release runtime', () => {
  it('protects the release endpoint with the runtime Bearer token', async () => {
    const runtime = await createRuntime();
    const response = await postRelease(runtime, {}, false);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'unauthorized' });
  });

  it('returns 503 when dataset release authority is not configured', async () => {
    const runtime = await createRuntime(false);
    const response = await postRelease(runtime, releaseRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: 'human_eval_release_authority_unavailable',
    });
  });

  it('rejects strict body and candidate integrity failures with 400', async () => {
    const runtime = await createRuntime();
    const invalidBody = await postRelease(runtime, { unexpected: true });
    expect(invalidBody.status).toBe(400);
    await expect(invalidBody.json()).resolves.toMatchObject({
      error: 'invalid_human_eval_release_request',
    });

    const request = structuredClone(releaseRequest()) as unknown as {
      releaseCandidate: { suite: { contentSha256: string } };
    };
    request.releaseCandidate.suite.contentSha256 = 'f'.repeat(64);
    const invalidIntegrity = await postRelease(runtime, request);
    expect(invalidIntegrity.status).toBe(400);
    await expect(invalidIntegrity.json()).resolves.toMatchObject({
      error: 'invalid_human_eval_release_candidate',
    });
  });

  it('creates one signed durable release and replays the exact operation', async () => {
    const runtime = await createRuntime();
    const candidate = buildHumanEvalReleaseCandidateFixture();
    const request = {
      formatVersion: '1.0.0' as const,
      operationId: randomUUID(),
      releaseCandidate: candidate,
      authorization: signedAuthorization(candidate),
    };

    const createdResponse = await postRelease(runtime, request);
    expect(createdResponse.status).toBe(200);
    const created = humanEvalReleaseResponseSchema.parse(await createdResponse.json());
    expect(created.status).toBe('created');
    expect(created.releasedManifest.dataHandling.trainingUse).toBe('not_authorized');

    const replayResponse = await postRelease(runtime, request);
    expect(replayResponse.status).toBe(200);
    const replay = humanEvalReleaseResponseSchema.parse(await replayResponse.json());
    expect(replay.status).toBe('already_completed');
    expect(replay.releasedManifestSha256).toBe(created.releasedManifestSha256);
    expect(replay.releasedManifest).toEqual(created.releasedManifest);

    const signatureDrift = structuredClone(request);
    signatureDrift.authorization.signature.signature = 'B'.repeat(86);
    const driftResponse = await postRelease(runtime, signatureDrift);
    expect(driftResponse.status).toBe(409);
    await expect(driftResponse.json()).resolves.toMatchObject({
      error: 'human_eval_release_conflict',
      code: 'operation_conflict',
    });
  });

  it('rejects an invalid live signature without consuming the release projection', async () => {
    const runtime = await createRuntime();
    const candidate = buildHumanEvalReleaseCandidateFixture();
    const invalidAuthorization = signedAuthorization(candidate);
    invalidAuthorization.signature.signature = 'B'.repeat(86);

    const rejected = await postRelease(runtime, {
      formatVersion: '1.0.0',
      operationId: randomUUID(),
      releaseCandidate: candidate,
      authorization: invalidAuthorization,
    });
    expect(rejected.status).toBe(409);
    await expect(rejected.json()).resolves.toMatchObject({
      error: 'human_eval_release_authority_rejected',
      code: 'invalid_signature',
    });

    const accepted = await postRelease(runtime, {
      formatVersion: '1.0.0',
      operationId: randomUUID(),
      releaseCandidate: candidate,
      authorization: signedAuthorization(candidate),
    });
    expect(accepted.status).toBe(200);
    expect(humanEvalReleaseResponseSchema.parse(await accepted.json()).status).toBe('created');
  });

  it('rejects authorization reuse and duplicate semantic releases', async () => {
    const runtime = await createRuntime();
    const candidate = buildHumanEvalReleaseCandidateFixture();
    const authorization = signedAuthorization(candidate);
    const first = await postRelease(runtime, {
      formatVersion: '1.0.0',
      operationId: randomUUID(),
      releaseCandidate: candidate,
      authorization,
    });
    expect(first.status).toBe(200);

    const conflict = await postRelease(runtime, {
      formatVersion: '1.0.0',
      operationId: randomUUID(),
      releaseCandidate: candidate,
      authorization,
    });
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      error: 'human_eval_release_conflict',
      code: 'authority_conflict',
    });

    const releaseConflict = await postRelease(runtime, {
      formatVersion: '1.0.0',
      operationId: randomUUID(),
      releaseCandidate: candidate,
      authorization: signedAuthorization(candidate),
    });
    expect(releaseConflict.status).toBe(409);
    await expect(releaseConflict.json()).resolves.toMatchObject({
      error: 'human_eval_release_conflict',
      code: 'semantic_release_conflict',
    });
  });
});
