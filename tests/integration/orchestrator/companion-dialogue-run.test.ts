import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { blenderActionCatalog } from '@operatingline/blender-action-catalog';
import {
  companionDialogueRunCreateRequestSchema,
  plannerDialogueMaximumMessageCharacters,
  type CompanionDialogueRun,
  type GuidePlan,
  type ReplanningPromptPacket,
} from '@operatingline/protocol';
import { FakePlannerProvider } from '@operatingline/test-kit';
import { startRuntime, type RunningRuntime } from '@operatingline/orchestrator';
import { describe, expect, it } from 'vitest';

const accessToken = 'companion-dialogue-run-test-token';
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

function validDraft(packet: ReplanningPromptPacket) {
  const plan = structuredClone(packet.context.revisionRequest.basePlan);
  plan.revision = packet.context.targetRevision;
  const head = plan.steps.find((step) => step.id === 'snowman.model.head');
  if (head === undefined) {
    throw new Error('Snowman fixture is missing its head step');
  }
  head.title = 'Create a larger dialogue-revised snowman head';
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

function createProvider(
  dialogue: NonNullable<ConstructorParameters<typeof FakePlannerProvider>[3]>,
  replan: NonNullable<ConstructorParameters<typeof FakePlannerProvider>[2]> = ({ packet }) =>
    validDraft(packet),
) {
  return new FakePlannerProvider(
    () => {
      throw new Error('Initial generation must not run in dialogue tests');
    },
    {
      contractVersion: '1.0.0',
      id: 'fake-dialogue-planner',
      version: '0.1.0',
      displayName: 'Fake Dialogue Planner',
      description: 'Deterministic streamed dialogue and replanning provider.',
      availability: { available: true },
      limits: { maxConcurrency: 1 },
      dataHandling: {
        executionLocation: 'local',
        dataTransmission: 'none',
        credentialManagement: 'provider_managed',
      },
    },
    replan,
    dialogue,
  );
}

function runRequest(
  instanceId = randomUUID(),
  history: readonly { readonly role: 'user' | 'assistant'; readonly message: string }[] = [],
) {
  const dialogueRequestId = randomUUID();
  const revisionRequestId = randomUUID();
  return companionDialogueRunCreateRequestSchema.parse({
    dialogueRequestId,
    replanGenerationRequestId: randomUUID(),
    providerId: 'fake-dialogue-planner',
    providerVersion: '0.1.0',
    targetAdapterId: 'blender',
    targetInstanceId: instanceId,
    revisionRequest: {
      protocolVersion: '1.4.0',
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
      revisionOperation: { kind: 'revise' },
      occurredAt: new Date().toISOString(),
    },
    history,
    authorization: {
      disclosureVersion: '1.0.0',
      dataHandlingAcknowledged: true,
      possibleChargesAcknowledged: true,
      authorizedProviderCallLimit: 2,
      automaticReplanAcknowledged: true,
      proposalCreationAcknowledged: true,
      authorizedAt: new Date().toISOString(),
    },
  });
}

async function createRun(runtime: RunningRuntime, request: ReturnType<typeof runRequest>) {
  return fetch(`${runtime.baseUrl}/api/v1/companion/dialogue-run`, {
    method: 'POST',
    headers,
    body: JSON.stringify(request),
  });
}

async function getRun(runtime: RunningRuntime, dialogueRequestId: string) {
  const url = new URL('/api/v1/companion/dialogue-run', runtime.baseUrl);
  url.searchParams.set('dialogueRequestId', dialogueRequestId);
  const response = await fetch(url, { headers });
  expect(response.status).toBe(200);
  return (await response.json()) as CompanionDialogueRun;
}

async function waitFor(
  runtime: RunningRuntime,
  dialogueRequestId: string,
  predicate: (run: CompanionDialogueRun) => boolean,
) {
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    const run = await getRun(runtime, dialogueRequestId);
    if (predicate(run)) {
      return run;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  throw new Error(`Dialogue run ${dialogueRequestId} did not reach the expected state`);
}

describe('streamed companion dialogue runs', () => {
  it('publishes durable text progress and blocks a below-threshold semantic replan', async () => {
    let releaseDialogue!: () => void;
    const gate = new Promise<void>((resolveGate) => {
      releaseDialogue = resolveGate;
    });
    const partial = 'A'.repeat(300);
    const provider = createProvider(async ({ emit }) => {
      emit({ type: 'assistant_text_delta', delta: partial });
      await gate;
      const suffix = ' The request needs clarification.';
      emit({ type: 'assistant_text_delta', delta: suffix });
      return {
        assistantMessage: partial + suffix,
        decision: { kind: 'replan', confidence: 0.79 },
      };
    });
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: [blenderActionCatalog],
      plannerProviders: [provider],
    });
    const request = runRequest();

    try {
      const providers = await fetch(`${runtime.baseUrl}/api/v1/dialogue/providers`, { headers });
      expect(providers.status).toBe(200);
      await expect(providers.json()).resolves.toMatchObject({
        providers: [{ id: 'fake-dialogue-planner' }],
      });

      const response = await createRun(runtime, request);
      expect(response.status).toBe(202);
      await expect(response.json()).resolves.toMatchObject({
        dialogueRequestId: request.dialogueRequestId,
        status: 'queued',
        sceneChanged: false,
      });
      const streaming = await waitFor(
        runtime,
        request.dialogueRequestId,
        (run) => run.status === 'streaming' && run.assistantMessage.length === partial.length,
      );
      expect(streaming.assistantMessageRevision).toBeGreaterThan(0);

      const prematureRevision = await fetch(
        `${runtime.baseUrl}/api/v1/companion/revision-request`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(request.revisionRequest),
        },
      );
      expect(prematureRevision.status).toBe(409);
      await expect(prematureRevision.json()).resolves.toEqual({ result: 'conflict' });

      releaseDialogue();
      const answered = await waitFor(runtime, request.dialogueRequestId, (run) => run.terminal);
      expect(answered).toMatchObject({
        status: 'answered',
        sceneChanged: false,
        revisionRequestRecorded: false,
        proposalId: null,
        semanticDecision: {
          kind: 'answer',
          replanConfidence: 0.79,
          threshold: 0.8,
        },
      });
      expect(provider.replanInputs).toHaveLength(0);

      const terminalRevision = await fetch(`${runtime.baseUrl}/api/v1/companion/revision-request`, {
        method: 'POST',
        headers,
        body: JSON.stringify(request.revisionRequest),
      });
      expect(terminalRevision.status).toBe(409);
      await expect(terminalRevision.json()).resolves.toEqual({ result: 'conflict' });

      const prompt = await fetch(`${runtime.baseUrl}/api/v1/replan/prompt`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ revisionRequestId: request.revisionRequest.requestId }),
      });
      expect(prompt.status).toBe(404);
    } finally {
      releaseDialogue();
      await runtime.stop();
    }
  });

  it('fails closed on a maximum-length whitespace reply without recording its candidate', async () => {
    const whitespace = ' '.repeat(plannerDialogueMaximumMessageCharacters);
    const provider = createProvider(async ({ emit }) => {
      emit({ type: 'assistant_text_delta', delta: whitespace });
      return {
        assistantMessage: whitespace,
        decision: { kind: 'replan', confidence: 0.79 },
      };
    });
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: [blenderActionCatalog],
      plannerProviders: [provider],
    });
    const request = runRequest();

    try {
      expect((await createRun(runtime, request)).status).toBe(202);
      const failed = await waitFor(runtime, request.dialogueRequestId, (run) => run.terminal);
      expect(failed).toMatchObject({
        status: 'failed',
        assistantMessage: whitespace,
        assistantMessageRevision: 1,
        revisionRequestRecorded: false,
        proposalId: null,
        semanticDecision: null,
        error: { code: 'planner_output_invalid', retryMode: 'new_request_id' },
      });
      expect(provider.replanInputs).toHaveLength(0);

      const candidate = await fetch(`${runtime.baseUrl}/api/v1/companion/revision-request`, {
        method: 'POST',
        headers,
        body: JSON.stringify(request.revisionRequest),
      });
      expect(candidate.status).toBe(409);
      const prompt = await fetch(`${runtime.baseUrl}/api/v1/replan/prompt`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ revisionRequestId: request.revisionRequest.requestId }),
      });
      expect(prompt.status).toBe(404);
    } finally {
      await runtime.stop();
    }
  });

  it('carries the largest legal assistant reply into a second authorized turn', async () => {
    const maximumReply = 'A'.repeat(plannerDialogueMaximumMessageCharacters);
    let dialogueCall = 0;
    const provider = createProvider(async ({ packet, emit }) => {
      dialogueCall += 1;
      if (dialogueCall === 1) {
        emit({ type: 'assistant_text_delta', delta: maximumReply });
        return { assistantMessage: maximumReply, decision: { kind: 'answer' } };
      }
      expect(packet.context.history).toEqual([
        {
          role: 'user',
          message: 'Make the referenced head larger without changing other branches.',
        },
        { role: 'assistant', message: maximumReply },
      ]);
      const secondReply = 'The prior answer remains available in this bounded turn.';
      emit({ type: 'assistant_text_delta', delta: secondReply });
      return { assistantMessage: secondReply, decision: { kind: 'answer' } };
    });
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: [blenderActionCatalog],
      plannerProviders: [provider],
    });
    const instanceId = randomUUID();
    const firstRequest = runRequest(instanceId);

    try {
      expect((await createRun(runtime, firstRequest)).status).toBe(202);
      const first = await waitFor(runtime, firstRequest.dialogueRequestId, (run) => run.terminal);
      expect(first).toMatchObject({ status: 'answered', assistantMessage: maximumReply });

      const secondRequest = runRequest(instanceId, [
        { role: 'user', message: firstRequest.revisionRequest.message },
        { role: 'assistant', message: maximumReply },
      ]);
      expect((await createRun(runtime, secondRequest)).status).toBe(202);
      const second = await waitFor(runtime, secondRequest.dialogueRequestId, (run) => run.terminal);
      expect(second).toMatchObject({ status: 'answered' });
      expect(provider.dialogueInputs).toHaveLength(2);
    } finally {
      await runtime.stop();
    }
  });

  it('returns a stable conflict when a terminal run identifier is reused across runs', async () => {
    const provider = createProvider(async ({ emit }) => {
      const assistantMessage = 'No revision is needed.';
      emit({ type: 'assistant_text_delta', delta: assistantMessage });
      return { assistantMessage, decision: { kind: 'answer' } };
    });
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: [blenderActionCatalog],
      plannerProviders: [provider],
    });
    const instanceId = randomUUID();
    const firstRequest = runRequest(instanceId);

    try {
      expect((await createRun(runtime, firstRequest)).status).toBe(202);
      await waitFor(runtime, firstRequest.dialogueRequestId, (run) => run.terminal);

      const candidateReuse = companionDialogueRunCreateRequestSchema.parse({
        ...runRequest(instanceId),
        revisionRequest: firstRequest.revisionRequest,
      });
      const candidateConflict = await createRun(runtime, candidateReuse);
      expect(candidateConflict.status).toBe(409);
      await expect(candidateConflict.json()).resolves.toMatchObject({
        error: 'dialogue_run_conflict',
      });

      const generationReuse = companionDialogueRunCreateRequestSchema.parse({
        ...runRequest(instanceId),
        replanGenerationRequestId: firstRequest.replanGenerationRequestId,
      });
      const generationConflict = await createRun(runtime, generationReuse);
      expect(generationConflict.status).toBe(409);
      await expect(generationConflict.json()).resolves.toMatchObject({
        error: 'dialogue_run_conflict',
      });
      expect(provider.dialogueInputs).toHaveLength(1);
      expect(provider.replanInputs).toHaveLength(0);
    } finally {
      await runtime.stop();
    }
  });

  it('treats the exact threshold as replan and preserves deterministic gate failure', async () => {
    const assistantMessage = 'I will prepare that bounded change for review.';
    const provider = createProvider(
      async ({ emit }) => {
        emit({ type: 'assistant_text_delta', delta: assistantMessage });
        return {
          assistantMessage,
          decision: { kind: 'replan', confidence: 0.8 },
        };
      },
      ({ packet }) => {
        const draft = validDraft(packet);
        draft.plan.title = 'Illegal out-of-scope global title change';
        return draft;
      },
    );
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: [blenderActionCatalog],
      plannerProviders: [provider],
    });
    const request = runRequest();

    try {
      expect((await createRun(runtime, request)).status).toBe(202);
      const completed = await waitFor(runtime, request.dialogueRequestId, (run) => run.terminal);
      expect(completed).toMatchObject({
        status: 'needs_revision',
        sceneChanged: false,
        revisionRequestRecorded: true,
        proposalId: null,
        semanticDecision: { kind: 'replan', confidence: 0.8, threshold: 0.8 },
        needsRevision: {
          locality: { valid: false },
        },
      });
      expect(provider.dialogueInputs).toHaveLength(1);
      expect(provider.replanInputs).toHaveLength(1);
    } finally {
      await runtime.stop();
    }
  });

  it('automatically replans above threshold but stops at a pending host Proposal', async () => {
    const assistantMessage = 'I will prepare a larger head as a reviewable Plan revision.';
    const provider = createProvider(async ({ emit }) => {
      emit({ type: 'assistant_text_delta', delta: assistantMessage });
      return {
        assistantMessage,
        decision: { kind: 'replan', confidence: 0.94 },
      };
    });
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: [blenderActionCatalog],
      plannerProviders: [provider],
    });
    const request = runRequest();

    try {
      expect((await createRun(runtime, request)).status).toBe(202);
      const completed = await waitFor(runtime, request.dialogueRequestId, (run) => run.terminal);
      expect(completed).toMatchObject({
        status: 'proposal_created',
        sceneChanged: false,
        assistantMessage,
        revisionRequestRecorded: true,
        semanticDecision: {
          kind: 'replan',
          confidence: 0.94,
          threshold: 0.8,
        },
      });
      expect(completed.proposalId).not.toBeNull();
      expect(provider.dialogueInputs).toHaveLength(1);
      expect(provider.replanInputs).toHaveLength(1);

      const deliveryUrl = new URL('/api/v1/companion/guide', runtime.baseUrl);
      deliveryUrl.searchParams.set('adapterId', 'blender');
      deliveryUrl.searchParams.set('instanceId', request.targetInstanceId);
      const deliveryResponse = await fetch(deliveryUrl, { headers });
      expect(deliveryResponse.status).toBe(200);
      await expect(deliveryResponse.json()).resolves.toMatchObject({
        plan: null,
        proposal: {
          proposalId: completed.proposalId,
          revisionRequestId: request.revisionRequest.requestId,
          targetInstanceId: request.targetInstanceId,
        },
      });
    } finally {
      await runtime.stop();
    }
  });

  it('restores an interrupted streamed turn without calling the provider again', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'operatingline-dialogue-restart-'));
    const databasePath = join(directory, 'events.db');
    let releaseDialogue!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolveStarted) => {
      markStarted = resolveStarted;
    });
    const gate = new Promise<void>((resolveGate) => {
      releaseDialogue = resolveGate;
    });
    const firstProvider = createProvider(async () => {
      markStarted();
      await gate;
      return { assistantMessage: 'Late response.', decision: { kind: 'answer' } };
    });
    const first = await startRuntime({
      databasePath,
      accessToken,
      actionCatalogs: [blenderActionCatalog],
      plannerProviders: [firstProvider],
    });
    const request = runRequest();

    try {
      expect((await createRun(first, request)).status).toBe(202);
      await started;
      const stopping = first.stop();
      releaseDialogue();
      await stopping;

      const restartedProvider = createProvider(async () => ({
        assistantMessage: 'Must not run.',
        decision: { kind: 'answer' },
      }));
      const restarted = await startRuntime({
        databasePath,
        accessToken,
        actionCatalogs: [blenderActionCatalog],
        plannerProviders: [restartedProvider],
      });
      try {
        const restored = await getRun(restarted, request.dialogueRequestId);
        expect(restored).toMatchObject({
          status: 'interrupted',
          terminal: true,
          sceneChanged: false,
          proposalId: null,
          error: { code: 'planner_runtime_stopping', retryMode: 'new_request_id' },
        });
        expect(restartedProvider.dialogueInputs).toHaveLength(0);
        expect(restartedProvider.replanInputs).toHaveLength(0);
      } finally {
        await restarted.stop();
      }
    } finally {
      releaseDialogue();
      await first.stop();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
