import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { blenderActionCatalog } from '@operatingline/blender-action-catalog';
import {
  authoritySignatureDomainPrefix,
  authoritySignedContent,
  canonicalizeProtocolJsonValue,
  type PlannerProviderDescriptor,
  type ProviderCallAuthorization,
  type CompanionReplanRun,
  type GuidePlan,
  type ReplanningPromptPacket,
} from '@operatingline/protocol';
import { FakePlannerProvider } from '@operatingline/test-kit';
import {
  companionReplanDisclosedDataSha256,
  companionReplanGenerationRequestSha256,
  startRuntime as startOperatingLineRuntime,
  type RunningRuntime,
} from '@operatingline/orchestrator';
import { describe, expect, it } from 'vitest';

const accessToken = 'companion-replan-run-test-token';
const headers = {
  authorization: `Bearer ${accessToken}`,
  'content-type': 'application/json',
};
const basePlan = JSON.parse(
  readFileSync(resolve('protocol/fixtures/v1/snowman-teaching.plan.json'), 'utf8'),
) as GuidePlan;
const requiredPhaseIds = ['geometry', 'materials', 'animation', 'render_setup', 'output'];
const capabilityCoverage = {
  policyVersion: 'catalog_capability_coverage_v1' as const,
  requirements: [
    {
      requirementId: 'larger-head',
      statement: 'Make the referenced snowman head larger.',
      coverage: [{ capabilityId: 'geometry.primitive_assembly', stepIds: ['snowman.model.head'] }],
    },
  ],
};
const authorityKeys = generateKeyPairSync('ed25519');
const authorizationByGenerationRequestId = new Map<string, ProviderCallAuthorization>();
const providerDescriptor = {
  contractVersion: '1.0.0',
  id: 'fake-planner',
  version: '0.1.0',
  displayName: 'Fake Planner',
  description: 'Deterministic replanner for asynchronous companion tests.',
  availability: { available: true },
  limits: { maxConcurrency: 1 },
  dataHandling: {
    executionLocation: 'local',
    dataTransmission: 'none',
    credentialManagement: 'provider_managed',
  },
} as const satisfies PlannerProviderDescriptor;

function authorityMessage(kind: string, content: unknown): Buffer {
  return Buffer.concat([
    Buffer.from(authoritySignatureDomainPrefix(kind as never)),
    Buffer.from(canonicalizeProtocolJsonValue(content)),
  ]);
}

async function startRuntime(options: Parameters<typeof startOperatingLineRuntime>[0]) {
  const registry = {
    version: 'companion-replan-integration-v1',
    revocationLog: {
      length: 0,
      headSha256: createHash('sha256').update(canonicalizeProtocolJsonValue([])).digest('hex'),
    },
    signers: [
      {
        signerId: 'operator',
        keyId: 'companion-key',
        algorithm: 'ed25519' as const,
        canonicalization: 'operatingline-authority-json-v1' as const,
        publicKeyPem: authorityKeys.publicKey.export({ format: 'pem', type: 'spki' }).toString(),
        roles: ['provider_call_authorizer' as const],
      },
    ],
  };
  return startOperatingLineRuntime({
    ...options,
    companionReplanProviderAuthority: {
      trustSource: {
        readSnapshot: () => ({ registry, revocations: [] }),
      },
    },
  });
}

function validDraft(packet: ReplanningPromptPacket) {
  const plan = structuredClone(packet.context.revisionRequest.basePlan);
  plan.revision = packet.context.targetRevision;
  const head = plan.steps.find((step) => step.id === 'snowman.model.head');
  if (head === undefined) {
    throw new Error('Snowman fixture is missing its head step');
  }
  head.title = 'Create a larger provider-revised snowman head';
  return {
    requestId: packet.context.revisionRequest.requestId,
    catalogVersion: packet.context.catalog.catalogVersion,
    planning: {
      goal: packet.context.revisionRequest.message,
      requiredPhaseIds,
      capabilityCoverage,
    },
    plan,
  };
}

function provider(
  handler: (input: { packet: ReplanningPromptPacket }) => unknown | Promise<unknown>,
) {
  return new FakePlannerProvider(
    () => {
      throw new Error('Initial generation must not run in companion replan tests');
    },
    providerDescriptor,
    handler,
    undefined,
    (operation) => ({
      profile: {
        descriptor: providerDescriptor,
        vendor: 'OperatingLine test fixture',
        implementation: { name: 'fake-planner', version: '0.1.0' },
        model: {
          requested: 'fake-v1',
          resolvedRevision: 'fake-v1',
          resolution: 'resolved',
        },
        api: {
          surface: operation,
          version: '1.0.0',
          sdkName: '@operatingline/test-kit',
          sdkVersion: '0.1.0',
          endpointClass: 'local',
          serviceTier: null,
          region: null,
        },
      },
      generationSettings: {
        normalizedParameters: { modelName: 'fake-v1' },
        seed: null,
        determinism: 'deterministic',
      },
      costPolicy: {
        possibleProviderCost: false,
        basis: 'no_provider_cost',
        publicStatement: 'This deterministic test Provider has no external cost.',
      },
    }),
  );
}

async function submitRevision(runtime: RunningRuntime, instanceId = randomUUID()) {
  const revisionRequestId = randomUUID();
  const response = await fetch(`${runtime.baseUrl}/api/v1/companion/revision-request`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      protocolVersion: '1.1.0',
      requestId: revisionRequestId,
      adapterId: 'blender',
      catalogVersion: blenderActionCatalog.catalogVersion,
      instanceId,
      basePlan,
      references: [{ nodeId: 'snowman.model.head', nodeNumber: '1.2.3' }],
      message: 'Make the referenced head larger without changing other branches.',
      revisionThread: {
        threadId: revisionRequestId,
        turn: 1,
        parentRequestId: null,
      },
      occurredAt: new Date().toISOString(),
    }),
  });
  expect(response.status).toBe(200);
  return { revisionRequestId, instanceId };
}

function runRequest(
  revisionRequestId: string,
  instanceId: string,
  generationRequestId = randomUUID(),
): Omit<
  CompanionReplanRun,
  | 'contractVersion'
  | 'provider'
  | 'status'
  | 'terminal'
  | 'sceneChanged'
  | 'proposalId'
  | 'error'
  | 'needsRevision'
  | 'updatedAt'
> & {
  readonly providerId: string;
  readonly providerVersion: string;
  readonly authorization?: unknown;
} {
  return {
    generationRequestId,
    revisionRequestId,
    providerId: 'fake-planner',
    providerVersion: '0.1.0',
    targetAdapterId: 'blender',
    targetInstanceId: instanceId,
  };
}

async function createRun(runtime: RunningRuntime, request: ReturnType<typeof runRequest>) {
  let authorization = request.authorization;
  if (authorization === undefined) {
    authorization = authorizationByGenerationRequestId.get(request.generationRequestId);
    if (authorization === undefined) {
      const promptResponse = await fetch(`${runtime.baseUrl}/api/v1/replan/prompt`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ revisionRequestId: request.revisionRequestId }),
      });
      expect(promptResponse.status).toBe(200);
      const disclosedPacket = await promptResponse.json();
      const now = new Date();
      const unsigned = {
        formatVersion: '1.0.0',
        canonicalization: 'operatingline-authority-json-v1',
        kind: 'ProviderCallAuthorization',
        authorityId: randomUUID(),
        issuer: 'operator',
        notBefore: new Date(now.getTime() - 60_000).toISOString(),
        expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
        provider: {
          providerId: request.providerId,
          descriptorVersion: request.providerVersion,
          model: 'fake-v1',
        },
        operation: 'semantic_replan_generation',
        generationRequestSha256: companionReplanGenerationRequestSha256(request),
        disclosedDataSha256: companionReplanDisclosedDataSha256(disclosedPacket),
        maximumCallCount: 1,
        signature: {
          signerId: 'operator',
          keyId: 'companion-key',
          algorithm: 'ed25519',
          signature: 'A'.repeat(86),
          signedAt: now.toISOString(),
        },
      } as const;
      authorization = {
        ...unsigned,
        signature: {
          ...unsigned.signature,
          signature: sign(
            null,
            authorityMessage(unsigned.kind, authoritySignedContent(unsigned)),
            authorityKeys.privateKey,
          ).toString('base64url'),
        },
      } satisfies ProviderCallAuthorization;
      authorizationByGenerationRequestId.set(
        request.generationRequestId,
        authorization as ProviderCallAuthorization,
      );
    }
  }
  return fetch(`${runtime.baseUrl}/api/v1/companion/replan-run`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...request, authorization }),
  });
}

async function getRun(runtime: RunningRuntime, generationRequestId: string) {
  const url = new URL('/api/v1/companion/replan-run', runtime.baseUrl);
  url.searchParams.set('generationRequestId', generationRequestId);
  const response = await fetch(url, { headers });
  expect(response.status).toBe(200);
  return (await response.json()) as CompanionReplanRun;
}

async function waitForTerminal(runtime: RunningRuntime, generationRequestId: string) {
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    const run = await getRun(runtime, generationRequestId);
    if (run.terminal) {
      return run;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  throw new Error(`Replan run ${generationRequestId} did not become terminal`);
}

function rewindRunTerminalTransition(
  databasePath: string,
  generationRequestId: string,
  terminalStatus: 'needs_revision' | 'proposal_created',
) {
  const sqlite = new DatabaseSync(databasePath);
  try {
    const row = sqlite
      .prepare('SELECT payload FROM companion_replan_runs WHERE generation_request_id = ?')
      .get(generationRequestId) as { payload: string };
    const payload = JSON.parse(row.payload) as Record<string, unknown>;
    Object.assign(payload, {
      status: 'generating',
      terminal: false,
      proposalId: null,
      error: null,
      needsRevision: null,
      updatedAt: new Date().toISOString(),
    });
    sqlite
      .prepare(
        `UPDATE companion_replan_runs
         SET status = 'generating', updated_at = ?, payload = ?
         WHERE generation_request_id = ?`,
      )
      .run(payload['updatedAt'], JSON.stringify(payload), generationRequestId);
    sqlite
      .prepare('DELETE FROM execution_events WHERE id = ?')
      .run(`companion-replan-run:${generationRequestId}:${terminalStatus}`);
  } finally {
    sqlite.close();
  }
}

function removeProposalEvidence(
  databasePath: string,
  generationRequestId: string,
  revisionRequestId: string,
  proposalId: string,
) {
  const sqlite = new DatabaseSync(databasePath);
  try {
    sqlite.exec('BEGIN IMMEDIATE;');
    sqlite
      .prepare('DELETE FROM guide_revision_request_proposals WHERE request_id = ?')
      .run(revisionRequestId);
    sqlite.prepare('DELETE FROM guide_proposals WHERE proposal_id = ?').run(proposalId);
    for (const eventId of [
      `guide-proposal:${proposalId}`,
      `guide-revision-proposal:${revisionRequestId}`,
      `planning-replan-proposed:${generationRequestId}`,
    ]) {
      sqlite.prepare('DELETE FROM execution_events WHERE id = ?').run(eventId);
    }
    sqlite.exec('COMMIT;');
  } catch (error) {
    sqlite.exec('ROLLBACK;');
    throw error;
  } finally {
    sqlite.close();
  }
}

describe('asynchronous companion replan runs', () => {
  it('reports the Provider side-effect route unavailable without operator trust configuration', async () => {
    const fakeProvider = provider(({ packet }) => validDraft(packet));
    const runtime = await startOperatingLineRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: [blenderActionCatalog],
      plannerProviders: [fakeProvider],
    });
    try {
      const response = await fetch(`${runtime.baseUrl}/api/v1/companion/replan-run`, {
        method: 'POST',
        headers,
        body: JSON.stringify({}),
      });
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        error: 'provider_authority_unavailable',
        message: 'Companion Provider calls require configured operator authority verification',
      });
      expect(fakeProvider.replanInputs).toHaveLength(0);
    } finally {
      await runtime.stop();
    }
  });

  it.each([
    ['initial', 'queued'],
    ['initial', 'generating'],
    ['dialogue', 'queued'],
    ['dialogue', 'streaming'],
    ['dialogue', 'replanning'],
  ] as const)(
    'retires a pre-upgrade %s %s row without replay and releases the signed replan slot',
    async (kind, status) => {
      const directory = mkdtempSync(join(tmpdir(), 'operatingline-legacy-provider-run-'));
      const databasePath = join(directory, 'runtime.sqlite');
      const instanceId = randomUUID();
      const sqlite = new DatabaseSync(databasePath);
      sqlite.close();

      const initialized = await startOperatingLineRuntime({
        databasePath,
        accessToken,
        actionCatalogs: [blenderActionCatalog],
      });
      await initialized.stop();

      const seeded = new DatabaseSync(databasePath);
      seeded.exec('PRAGMA foreign_keys = OFF;');
      const now = new Date().toISOString();
      const providerIdentity = {
        id: 'fake-planner',
        version: '0.1.0',
        displayName: 'Fake Planner',
      };
      let legacyId: string;
      if (kind === 'initial') {
        legacyId = randomUUID();
        const payload = {
          contractVersion: '1.0.0',
          generationRequestId: legacyId,
          goalRequestId: randomUUID(),
          targetAdapterId: 'blender',
          targetInstanceId: instanceId,
          provider: providerIdentity,
          status,
          terminal: false,
          sceneChanged: false,
          proposalId: null,
          error: null,
          needsRevision: null,
          updatedAt: now,
          request: {},
          authorizedProvider: {},
          goalRequest: {},
        };
        seeded
          .prepare(
            `INSERT INTO companion_initial_plan_runs
             (generation_request_id, goal_request_id, target_adapter_id, target_instance_id,
              status, updated_at, payload)
             VALUES (?, ?, 'blender', ?, ?, ?, ?)`,
          )
          .run(legacyId, payload.goalRequestId, instanceId, status, now, JSON.stringify(payload));
      } else {
        legacyId = randomUUID();
        const revisionRequestId = randomUUID();
        const assistantMessage = status === 'queued' ? '' : 'Legacy partial response';
        const payload = {
          contractVersion: '1.0.0',
          dialogueRequestId: legacyId,
          revisionRequestId,
          replanGenerationRequestId: randomUUID(),
          targetAdapterId: 'blender',
          targetInstanceId: instanceId,
          provider: providerIdentity,
          status,
          terminal: false,
          sceneChanged: false,
          assistantMessage,
          assistantMessageRevision: assistantMessage.length === 0 ? 0 : 1,
          semanticDecision:
            status === 'replanning' ? { kind: 'replan', confidence: 0.9, threshold: 0.8 } : null,
          revisionRequestRecorded: status === 'replanning',
          proposalId: null,
          error: null,
          needsRevision: null,
          updatedAt: now,
          request: {},
          authorizedProvider: {},
        };
        seeded
          .prepare(
            `INSERT INTO companion_dialogue_runs
             (dialogue_request_id, revision_request_id, replan_generation_request_id,
              target_adapter_id, target_instance_id, status, assistant_message_revision,
              updated_at, payload)
             VALUES (?, ?, ?, 'blender', ?, ?, ?, ?, ?)`,
          )
          .run(
            legacyId,
            revisionRequestId,
            payload.replanGenerationRequestId,
            instanceId,
            status,
            payload.assistantMessageRevision,
            now,
            JSON.stringify(payload),
          );
      }
      seeded.close();

      const fakeProvider = provider(({ packet }) => validDraft(packet));
      const runtime = await startRuntime({
        databasePath,
        accessToken,
        actionCatalogs: [blenderActionCatalog],
        plannerProviders: [fakeProvider],
      });
      try {
        const revision = await submitRevision(runtime, instanceId);
        const request = runRequest(revision.revisionRequestId, instanceId);
        expect((await createRun(runtime, request)).status).toBe(202);
        await expect(waitForTerminal(runtime, request.generationRequestId)).resolves.toMatchObject({
          status: 'proposal_created',
        });
        expect(fakeProvider.inputs).toHaveLength(0);
        expect(fakeProvider.dialogueInputs).toHaveLength(0);
        expect(fakeProvider.replanInputs).toHaveLength(1);

        const inspected = new DatabaseSync(databasePath);
        const table =
          kind === 'initial' ? 'companion_initial_plan_runs' : 'companion_dialogue_runs';
        const idColumn = kind === 'initial' ? 'generation_request_id' : 'dialogue_request_id';
        const row = inspected
          .prepare(`SELECT status, payload FROM ${table} WHERE ${idColumn} = ?`)
          .get(legacyId) as { status: string; payload: string };
        inspected.close();
        expect(row.status).toBe('interrupted');
        expect(JSON.parse(row.payload)).toMatchObject({
          terminal: true,
          error: {
            code: 'planner_provider_unavailable',
            retryMode: 'never',
            message: expect.stringContaining('provider_authority_unavailable'),
          },
        });
      } finally {
        await runtime.stop();
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );

  it('shares the durable instance work slot with pending host goals in both creation orders', async () => {
    let releaseProvider!: () => void;
    const providerGate = new Promise<void>((resolveGate) => {
      releaseProvider = resolveGate;
    });
    const fakeProvider = provider(async ({ packet }) => {
      await providerGate;
      return validDraft(packet);
    });
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: [blenderActionCatalog],
      plannerProviders: [fakeProvider],
    });
    const submitGoal = (instanceId: string, suffix: string) =>
      fetch(`${runtime.baseUrl}/api/v1/companion/goal-request`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          protocolVersion: '1.1.0',
          requestId: randomUUID(),
          adapterId: 'blender',
          catalogVersion: blenderActionCatalog.catalogVersion,
          instanceId,
          goal: `Create the ${suffix} host guide.`,
          planId: `work-slot-${suffix}`,
          occurredAt: new Date().toISOString(),
        }),
      });

    try {
      const goalFirst = await submitRevision(runtime);
      expect((await submitGoal(goalFirst.instanceId, 'goal-first')).status).toBe(200);
      const blockedRun = await createRun(
        runtime,
        runRequest(goalFirst.revisionRequestId, goalFirst.instanceId),
      );
      expect(blockedRun.status).toBe(409);
      await expect(blockedRun.json()).resolves.toMatchObject({ error: 'replan_run_conflict' });

      const runFirst = await submitRevision(runtime);
      const acceptedRequest = runRequest(runFirst.revisionRequestId, runFirst.instanceId);
      const acceptedRun = await createRun(runtime, acceptedRequest);
      expect(acceptedRun.status).toBe(202);
      const blockedGoal = await submitGoal(runFirst.instanceId, 'run-first');
      expect(blockedGoal.status).toBe(409);
      await expect(blockedGoal.json()).resolves.toMatchObject({ result: 'conflict' });
      releaseProvider();
      await waitForTerminal(runtime, acceptedRequest.generationRequestId);
    } finally {
      releaseProvider();
      await runtime.stop();
    }
  });

  it('requires bearer authorization, a strict consent envelope, and an explicit provider', async () => {
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: [blenderActionCatalog],
    });
    try {
      const { revisionRequestId, instanceId } = await submitRevision(runtime);
      const request = runRequest(revisionRequestId, instanceId);

      for (const [method, url, body] of [
        ['GET', `${runtime.baseUrl}/api/v1/replan/providers`, undefined],
        [
          'GET',
          `${runtime.baseUrl}/api/v1/companion/replan-run?generationRequestId=${request.generationRequestId}`,
          undefined,
        ],
        ['POST', `${runtime.baseUrl}/api/v1/companion/replan-run`, request],
      ] as const) {
        const response = await fetch(url, {
          method,
          ...(body === undefined
            ? {}
            : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
        });
        expect(response.status).toBe(401);
      }

      const providersResponse = await fetch(`${runtime.baseUrl}/api/v1/replan/providers`, {
        headers,
      });
      await expect(providersResponse.json()).resolves.toEqual({
        contractVersion: '1.0.0',
        generationAvailable: false,
        providers: [],
      });

      const invalidConsent = await createRun(runtime, {
        ...request,
        authorization: { ...request.authorization, possibleChargesAcknowledged: false as true },
      });
      expect(invalidConsent.status).toBe(400);

      const unavailable = await createRun(runtime, request);
      expect(unavailable.status).toBe(404);
      await expect(unavailable.json()).resolves.toMatchObject({ error: 'provider_not_found' });
    } finally {
      await runtime.stop();
    }
  });

  it('rejects stale provider and host bindings before invoking the provider', async () => {
    const fakeProvider = provider(({ packet }) => validDraft(packet));
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: [blenderActionCatalog],
      plannerProviders: [fakeProvider],
    });
    try {
      const { revisionRequestId, instanceId } = await submitRevision(runtime);
      const request = runRequest(revisionRequestId, instanceId);

      const wrongInstance = await createRun(runtime, {
        ...request,
        targetInstanceId: randomUUID(),
      });
      expect(wrongInstance.status).toBe(409);
      await expect(wrongInstance.json()).resolves.toMatchObject({
        error: 'target_binding_mismatch',
      });

      const staleProvider = await createRun(runtime, {
        ...request,
        generationRequestId: randomUUID(),
        providerVersion: '9.9.9',
      });
      expect(staleProvider.status).toBe(409);
      await expect(staleProvider.json()).resolves.toMatchObject({
        error: 'provider_binding_mismatch',
      });
      expect(fakeProvider.replanInputs).toHaveLength(0);
    } finally {
      await runtime.stop();
    }
  });

  it('returns 202 before a slow provider completes and keeps unrelated APIs responsive', async () => {
    let releaseProvider!: () => void;
    const providerGate = new Promise<void>((resolveGate) => {
      releaseProvider = resolveGate;
    });
    const fakeProvider = provider(async ({ packet }) => {
      await providerGate;
      return validDraft(packet);
    });
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: [blenderActionCatalog],
      plannerProviders: [fakeProvider],
    });
    try {
      const { revisionRequestId, instanceId } = await submitRevision(runtime);
      const request = runRequest(revisionRequestId, instanceId);

      const response = await Promise.race([
        createRun(runtime, request),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('POST replan-run blocked on its provider')), 500),
        ),
      ]);
      expect(response.status).toBe(202);
      await expect(response.json()).resolves.toMatchObject({
        generationRequestId: request.generationRequestId,
        status: 'queued',
        terminal: false,
        sceneChanged: false,
      });

      const responsive = await Promise.race([
        Promise.all([
          fetch(`${runtime.baseUrl}/health`),
          fetch(`${runtime.baseUrl}/api/v1/replan/providers`, { headers }),
        ]),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Slow provider blocked unrelated APIs')), 500),
        ),
      ]);
      expect(responsive.map((item) => item.status)).toEqual([200, 200]);

      const concurrent = await createRun(runtime, runRequest(revisionRequestId, instanceId));
      expect(concurrent.status).toBe(409);
      await expect(concurrent.json()).resolves.toMatchObject({ error: 'replan_run_conflict' });

      releaseProvider();
      const completed = await waitForTerminal(runtime, request.generationRequestId);
      expect(completed).toMatchObject({
        status: 'proposal_created',
        terminal: true,
        sceneChanged: false,
        proposalId: expect.any(String),
        error: null,
      });
      expect(fakeProvider.replanInputs).toHaveLength(1);

      const guideUrl = new URL('/api/v1/companion/guide', runtime.baseUrl);
      guideUrl.searchParams.set('adapterId', 'blender');
      guideUrl.searchParams.set('instanceId', instanceId);
      await expect(fetch(guideUrl, { headers }).then((item) => item.json())).resolves.toMatchObject(
        {
          plan: null,
          proposal: { proposalId: completed.proposalId, revisionRequestId },
        },
      );

      const replay = await createRun(runtime, request);
      expect(replay.status).toBe(202);
      await expect(replay.json()).resolves.toEqual(completed);
      expect(fakeProvider.replanInputs).toHaveLength(1);
    } finally {
      releaseProvider();
      await runtime.stop();
    }
  });

  it('exposes needs-revision and safe failure states and retries only with a new authorization', async () => {
    let invocation = 0;
    const fakeProvider = provider(({ packet }) => {
      invocation += 1;
      if (invocation === 1) {
        const draft = validDraft(packet);
        draft.plan.title = 'Illegal global title change';
        return draft;
      }
      if (invocation === 2) {
        throw new Error('PRIVATE_PROVIDER_FAILURE_DETAIL');
      }
      return validDraft(packet);
    });
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: [blenderActionCatalog],
      plannerProviders: [fakeProvider],
    });
    try {
      const { revisionRequestId, instanceId } = await submitRevision(runtime);

      const needsRequest = runRequest(revisionRequestId, instanceId);
      expect((await createRun(runtime, needsRequest)).status).toBe(202);
      const needsRevision = await waitForTerminal(runtime, needsRequest.generationRequestId);
      expect(needsRevision).toMatchObject({
        status: 'needs_revision',
        terminal: true,
        proposalId: null,
        error: null,
        needsRevision: {
          planning: { errorCount: expect.any(Number), warningCount: expect.any(Number) },
          locality: { valid: false, findings: expect.any(Array) },
          planDiffAvailable: expect.any(Boolean),
        },
      });

      const failedRequest = runRequest(revisionRequestId, instanceId);
      expect((await createRun(runtime, failedRequest)).status).toBe(202);
      const failed = await waitForTerminal(runtime, failedRequest.generationRequestId);
      expect(failed).toMatchObject({
        status: 'failed',
        terminal: true,
        proposalId: null,
        error: { code: 'planner_provider_failed', retryMode: 'new_request_id' },
      });
      expect(JSON.stringify(failed)).not.toContain('PRIVATE_PROVIDER_FAILURE_DETAIL');

      const retryRequest = runRequest(revisionRequestId, instanceId);
      expect(retryRequest.generationRequestId).not.toBe(failedRequest.generationRequestId);
      expect((await createRun(runtime, retryRequest)).status).toBe(202);
      const retried = await waitForTerminal(runtime, retryRequest.generationRequestId);
      expect(retried.status).toBe('proposal_created');
      expect(fakeProvider.replanInputs).toHaveLength(3);
    } finally {
      await runtime.stop();
    }
  });

  it('keeps one unresolved proposal when an external proposal wins the provider-await race', async () => {
    let invocation = 0;
    let releaseRun!: () => void;
    const runGate = new Promise<void>((resolveGate) => {
      releaseRun = resolveGate;
    });
    const fakeProvider = provider(async ({ packet }) => {
      invocation += 1;
      if (invocation === 2) {
        await runGate;
      }
      return validDraft(packet);
    });
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: [blenderActionCatalog],
      plannerProviders: [fakeProvider],
    });
    try {
      const instanceId = randomUUID();
      const externalRevision = await submitRevision(runtime, instanceId);
      const externalGenerationId = randomUUID();
      const generatedResponse = await fetch(`${runtime.baseUrl}/api/v1/replan/generate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          requestId: externalGenerationId,
          revisionRequestId: externalRevision.revisionRequestId,
          providerId: 'fake-planner',
        }),
      });
      expect(generatedResponse.status).toBe(200);
      const generated = (await generatedResponse.json()) as {
        requestId: string;
        revisionRequestId: string;
        draft: {
          catalogVersion: string;
          planning: unknown;
          plan: unknown;
        };
      };

      const runRevision = await submitRevision(runtime, instanceId);
      const request = runRequest(runRevision.revisionRequestId, instanceId);
      expect((await createRun(runtime, request)).status).toBe(202);
      while (fakeProvider.replanInputs.length < 2) {
        await new Promise((resolveWait) => setTimeout(resolveWait, 5));
      }

      const externalProposalResponse = await fetch(`${runtime.baseUrl}/api/v1/replan/propose`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          generationRequestId: generated.requestId,
          requestId: generated.revisionRequestId,
          catalogVersion: generated.draft.catalogVersion,
          planning: generated.draft.planning,
          plan: generated.draft.plan,
        }),
      });
      expect(externalProposalResponse.status).toBe(200);
      const externalProposal = (await externalProposalResponse.json()) as { proposalId: string };

      releaseRun();
      const completed = await waitForTerminal(runtime, request.generationRequestId);
      expect(completed).toMatchObject({
        status: 'failed',
        terminal: true,
        proposalId: null,
        error: { retryMode: 'never' },
      });

      const guideUrl = new URL('/api/v1/companion/guide', runtime.baseUrl);
      guideUrl.searchParams.set('adapterId', 'blender');
      guideUrl.searchParams.set('instanceId', instanceId);
      await expect(fetch(guideUrl, { headers }).then((item) => item.json())).resolves.toMatchObject(
        {
          proposal: { proposalId: externalProposal.proposalId },
        },
      );
    } finally {
      releaseRun();
      await runtime.stop();
    }
  });

  it('marks an in-flight run interrupted across restart without auto-retrying it', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'operatingline-replan-run-restart-'));
    const databasePath = join(directory, 'events.db');
    let releaseProvider!: () => void;
    let markProviderStarted!: () => void;
    const providerStarted = new Promise<void>((resolveStarted) => {
      markProviderStarted = resolveStarted;
    });
    const providerGate = new Promise<void>((resolveGate) => {
      releaseProvider = resolveGate;
    });
    const firstProvider = provider(async ({ packet }) => {
      markProviderStarted();
      await providerGate;
      return validDraft(packet);
    });
    const first = await startRuntime({
      databasePath,
      accessToken,
      actionCatalogs: [blenderActionCatalog],
      plannerProviders: [firstProvider],
    });
    try {
      const { revisionRequestId, instanceId } = await submitRevision(first);
      const request = runRequest(revisionRequestId, instanceId);
      expect((await createRun(first, request)).status).toBe(202);

      await providerStarted;
      await first.stop();
      releaseProvider();

      const restartedProvider = provider(({ packet }) => validDraft(packet));
      const restarted = await startRuntime({
        databasePath,
        accessToken,
        actionCatalogs: [blenderActionCatalog],
        plannerProviders: [restartedProvider],
      });
      try {
        const restored = await getRun(restarted, request.generationRequestId);
        expect(restored).toMatchObject({
          status: 'interrupted',
          terminal: true,
          proposalId: null,
          sceneChanged: false,
          error: { code: 'planner_runtime_stopping', retryMode: 'new_request_id' },
        });
        expect(restartedProvider.replanInputs).toHaveLength(0);
      } finally {
        await restarted.stop();
      }
    } finally {
      releaseProvider();
      await first.stop();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('reconciles completed proposal and needs-revision crash windows without provider retry', async () => {
    for (const expectedStatus of ['proposal_created', 'needs_revision'] as const) {
      const directory = mkdtempSync(join(tmpdir(), `operatingline-${expectedStatus}-recovery-`));
      const databasePath = join(directory, 'events.db');
      const firstProvider = provider(({ packet }) => {
        const draft = validDraft(packet);
        if (expectedStatus === 'needs_revision') {
          draft.plan.title = 'Illegal global title change';
        }
        return draft;
      });
      const first = await startRuntime({
        databasePath,
        accessToken,
        actionCatalogs: [blenderActionCatalog],
        plannerProviders: [firstProvider],
      });
      try {
        const { revisionRequestId, instanceId } = await submitRevision(first);
        const request = runRequest(revisionRequestId, instanceId);
        expect((await createRun(first, request)).status).toBe(202);
        const original = await waitForTerminal(first, request.generationRequestId);
        expect(original.status).toBe(expectedStatus);
        await first.stop();

        rewindRunTerminalTransition(databasePath, request.generationRequestId, expectedStatus);
        const restartedProvider = provider(({ packet }) => validDraft(packet));
        const restarted = await startRuntime({
          databasePath,
          accessToken,
          actionCatalogs: [blenderActionCatalog],
          plannerProviders: [restartedProvider],
        });
        try {
          const recovered = await getRun(restarted, request.generationRequestId);
          expect(recovered).toMatchObject({
            status: expectedStatus,
            terminal: true,
            sceneChanged: false,
            proposalId: expectedStatus === 'proposal_created' ? original.proposalId : null,
          });
          expect(restartedProvider.replanInputs).toHaveLength(0);
        } finally {
          await restarted.stop();
        }
      } finally {
        await first.stop();
        rmSync(directory, { recursive: true, force: true });
      }
    }
  });

  it('creates the authorized proposal from a durable ready generation after a pre-proposal crash', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'operatingline-ready-recovery-'));
    const databasePath = join(directory, 'events.db');
    const firstProvider = provider(({ packet }) => validDraft(packet));
    const first = await startRuntime({
      databasePath,
      accessToken,
      actionCatalogs: [blenderActionCatalog],
      plannerProviders: [firstProvider],
    });
    try {
      const { revisionRequestId, instanceId } = await submitRevision(first);
      const request = runRequest(revisionRequestId, instanceId);
      expect((await createRun(first, request)).status).toBe(202);
      const original = await waitForTerminal(first, request.generationRequestId);
      expect(original.status).toBe('proposal_created');
      expect(original.proposalId).not.toBeNull();
      await first.stop();

      rewindRunTerminalTransition(databasePath, request.generationRequestId, 'proposal_created');
      removeProposalEvidence(
        databasePath,
        request.generationRequestId,
        revisionRequestId,
        original.proposalId!,
      );

      const restartedProvider = provider(({ packet }) => validDraft(packet));
      const restarted = await startRuntime({
        databasePath,
        accessToken,
        actionCatalogs: [blenderActionCatalog],
        plannerProviders: [restartedProvider],
      });
      try {
        const recovered = await getRun(restarted, request.generationRequestId);
        expect(recovered).toMatchObject({
          status: 'proposal_created',
          terminal: true,
          sceneChanged: false,
          proposalId: expect.any(String),
        });
        expect(recovered.proposalId).not.toBe(original.proposalId);
        expect(restartedProvider.replanInputs).toHaveLength(0);
      } finally {
        await restarted.stop();
      }
    } finally {
      await first.stop();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
