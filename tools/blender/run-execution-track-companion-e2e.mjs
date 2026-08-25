import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  blenderActionCatalogs,
  blenderInteractionCatalogs,
} from '@operatingline/blender-action-catalog';
import {
  companionExecutionTrackExecutionBindingSchema,
  companionExecutionTrackExecutionManagedStartSubmissionSchema,
  companionExecutionTrackExecutionPollDeliverySchema,
  companionExecutionTrackExecutionProgressSchema,
  companionExecutionTrackExecutionRecoveryAckSchema,
  companionExecutionTrackExecutionRecoveryPollDeliverySchema,
  companionExecutionTrackExecutionResultSchema,
  companionStateReportSchema,
  computeProtocolCanonicalJsonSha256,
} from '@operatingline/protocol';
import { startRuntime } from '@operatingline/orchestrator';

import { createBlenderExecutionTrackExecutionCoordinator } from '../../services/orchestrator/src/blender-execution-track-execution.js';
import {
  executionTrackPreflightFixture,
  preflightIds,
} from '../../tests/unit/support/execution-track-preflight-fixture.js';
import { requireBlenderBinaries } from './blender-binaries.mjs';
import { syncBlenderExtensionResources } from './sync-extension-resources.mjs';

const accessToken = 'operatingline-execution-track-e2e-token';
const childTimeoutMs = 180_000;
const fixturePath = resolve('tests/e2e/blender/execution_track_companion_round_trip.py');

class MemoryEventStore {
  events = [];

  appendEvent(input) {
    if (this.events.some((event) => event.id === input.id)) {
      throw new Error(`Duplicate execution event id: ${input.id}`);
    }
    const event = {
      ...JSON.parse(JSON.stringify(input)),
      sequence: this.events.length + 1,
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    this.events.push(event);
    return event;
  }

  listExecutionEventsByTypes(types) {
    return this.events.filter((event) => types.includes(event.eventType));
  }
}

function listen(server) {
  return new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolveListen(server.address()));
  });
}

function closeServer(server) {
  return new Promise((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });
}

function documentAuthoritySha256({ adapterId, instanceId, sessionId, documentIncarnationId }) {
  return createHash('sha256')
    .update('operatingline:blender-menu-control-proof-document-authority:v1\0')
    .update(adapterId)
    .update('\0')
    .update(instanceId)
    .update('\0')
    .update(sessionId)
    .update('\0')
    .update(documentIncarnationId)
    .digest('hex');
}

function buildPlanConfiguration() {
  const fixture = executionTrackPreflightFixture();
  const decision = fixture.binding.acceptance.decision;
  const plan = {
    protocolVersion: fixture.binding.plan.protocolVersion,
    id: fixture.binding.plan.id,
    revision: fixture.binding.plan.revision,
    title: 'Execution-track Companion host proof',
    rootStepId: fixture.binding.step.id,
    steps: [fixture.binding.step],
  };
  return {
    instanceId: preflightIds.instance,
    sessionId: preflightIds.session,
    documentIncarnationId: preflightIds.document,
    proposalId: fixture.binding.proposal.id,
    decision: {
      decisionId: decision.decisionId,
      proposalId: decision.proposalId,
      instanceId: decision.instanceId,
      adapterId: decision.adapterId,
      decision: decision.decision,
      decidedAt: decision.occurredAt,
    },
    planContentSha256: computeProtocolCanonicalJsonSha256(plan),
    plan,
  };
}

function buildExecutionBinding(startReport) {
  const fixture = executionTrackPreflightFixture();
  const requestedAt = new Date().toISOString();
  const target = {
    adapterId: 'blender',
    instanceId: startReport.instanceId,
  };
  const plan = {
    protocolVersion: startReport.protocolVersion,
    id: startReport.plan.id,
    revision: startReport.plan.revision,
    contentSha256: startReport.planContentSha256,
  };
  const expectedState = {
    reportId: startReport.reportId,
    sequence: startReport.sequence,
  };
  const decision = {
    ...fixture.binding.acceptance.decision,
    protocolVersion: startReport.protocolVersion,
    instanceId: startReport.instanceId,
  };
  const preflightContent = {
    ...Object.fromEntries(
      Object.entries(fixture.binding).filter(([key]) => key !== 'bindingContentSha256'),
    ),
    target,
    plan,
    executionId: startReport.executionId,
    expectedState,
    acceptance: {
      decision,
      decisionContentSha256: computeProtocolCanonicalJsonSha256(decision),
      receipt: {
        ...fixture.binding.acceptance.receipt,
        instanceId: startReport.instanceId,
      },
    },
    requestedAt,
  };
  const preflightBinding = {
    ...preflightContent,
    bindingContentSha256: computeProtocolCanonicalJsonSha256(preflightContent),
  };
  const checkpoint = startReport.nativeUndoCheckpoint;
  assert.ok(checkpoint, 'Walkthrough start report must contain a native Undo checkpoint');
  const bindingContent = {
    formatVersion: '2.0.0',
    requestId: preflightBinding.requestId,
    target,
    proposalId: preflightBinding.proposal.id,
    plan,
    executionId: startReport.executionId,
    leafId: preflightBinding.leafId,
    override: preflightBinding.override,
    expectedState,
    authorizedStartState: {
      reportContentSha256: computeProtocolCanonicalJsonSha256(startReport),
      checkpoint: {
        checkpointId: checkpoint.checkpointId,
        previousCheckpointId: checkpoint.previousCheckpointId,
        operation: checkpoint.operation,
        contentSha256: computeProtocolCanonicalJsonSha256(checkpoint),
      },
      activeStepId: startReport.activeStepId,
      completedStepIds: startReport.completedStepIds,
      receiptStepIds: checkpoint.session.receiptStepIds,
      successPhase: 'completed',
    },
    proofId: randomUUID(),
    preflightBinding,
    executor: {
      executorId: 'blender.uv_sphere_menu_proven_managed_commit.v2',
      proofExecutorId: 'blender.uv_sphere_menu_controls.event_simulate.v1',
      targetProfile: 'factory_layout_three_object_ui_scale_2',
      executionBoundary: 'proof_restore_then_managed_commit',
      authorization: 'accepted_replay_next_step',
      proofOperationIds: [
        'workspace.layout',
        'menu.add',
        'menu.mesh',
        'operator.uv_sphere',
        'control.location',
        'control.scale',
        'control.object_name',
      ],
      nativeUndoDepth: 8,
      commitActionName: 'blender.mesh.create_uv_sphere',
      automaticReplay: false,
    },
    executionScope: {
      kind: 'single_leaf',
      leafId: preflightBinding.leafId,
      procedureTreeContentSha256: preflightBinding.artifacts.procedureTreeContentSha256,
    },
    requestedAt,
  };
  return companionExecutionTrackExecutionBindingSchema.parse({
    ...bindingContent,
    bindingContentSha256: computeProtocolCanonicalJsonSha256(bindingContent),
  });
}

function runBlender(blender, environment) {
  return new Promise((resolveChild, reject) => {
    const child = spawn(
      blender,
      [
        '--factory-startup',
        '--online-mode',
        '--enable-event-simulate',
        '--window-geometry',
        '80',
        '80',
        '1600',
        '1000',
        '--python-exit-code',
        '1',
        '--python',
        fixturePath,
      ],
      {
        env: { ...process.env, ...environment, PYTHONDONTWRITEBYTECODE: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });
    const deadline = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2_000).unref();
    }, childTimeoutMs);
    child.once('error', (error) => {
      clearTimeout(deadline);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(deadline);
      if (code === 0) return resolveChild({ stdout, stderr });
      reject(
        new Error(
          `Blender execution-track E2E failed (code=${String(code)}, signal=${String(signal)})\n${stdout}\n${stderr}`,
        ),
      );
    });
  });
}

async function runOne(blender) {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'operatingline-execution-track-'));
  const resultPath = join(temporaryDirectory, 'result.json');
  const configPath = join(temporaryDirectory, 'config.json');
  const databasePath = join(temporaryDirectory, 'runtime.db');
  const planConfiguration = buildPlanConfiguration();
  writeFileSync(configPath, `${JSON.stringify(planConfiguration, null, 2)}\n`);
  const runtime = await startRuntime({
    databasePath,
    accessToken,
    actionCatalogs: blenderActionCatalogs,
    interactionCatalogs: blenderInteractionCatalogs,
  });
  const events = new MemoryEventStore();
  const stateReports = [];
  const progressPosts = [];
  const managedStartPosts = [];
  const resultPosts = [];
  let currentLease = null;
  let currentDocumentAuthority = null;
  let queuedBinding = null;

  const coordinator = createBlenderExecutionTrackExecutionCoordinator({
    eventStore: events,
    validateManagedResult: (result) => {
      const report = stateReports.at(-1);
      assert.ok(report, 'Managed result requires a current Companion report');
      assert.equal(report.reportId, result.managedReport.reportId);
      assert.equal(report.sequence, result.managedReport.sequence);
      assert.equal(computeProtocolCanonicalJsonSha256(report), result.managedReport.contentSha256);
      assert.equal(report.transition, result.managedReport.transition);
      assert.equal(report.stepId, result.managedReport.stepId);
      assert.ok(report.nativeUndoCheckpoint, 'Managed report lost its native checkpoint');
      assert.equal(
        computeProtocolCanonicalJsonSha256(report.nativeUndoCheckpoint),
        result.managedCheckpoint.contentSha256,
      );
    },
  });

  function liveAuthority(target, leaseHeader) {
    assert.ok(currentLease, 'Execution route used before Companion session establishment');
    assert.equal(leaseHeader, currentLease.leaseId, 'Execution route used a stale lease header');
    assert.deepEqual(target, currentLease.target);
    assert.ok(currentDocumentAuthority);
    return {
      target,
      lease: currentLease,
      documentAuthoritySha256: currentDocumentAuthority,
    };
  }

  function json(response, status, payload) {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(payload));
  }

  const proxy = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const parsedBody = body.length > 0 ? JSON.parse(body.toString('utf8')) : undefined;
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const leaseHeader = request.headers['x-operatingline-companion-lease'];
    try {
      if (url.pathname === '/api/v1/companion/execution-track-execution') {
        assert.equal(request.method, 'GET');
        const target = {
          adapterId: url.searchParams.get('adapterId'),
          instanceId: url.searchParams.get('instanceId'),
        };
        const authority = liveAuthority(target, leaseHeader);
        const delivery = coordinator.poll(
          'blender',
          target.instanceId,
          authority.documentAuthoritySha256,
          authority.lease,
        );
        return json(
          response,
          200,
          companionExecutionTrackExecutionPollDeliverySchema.parse({ request: delivery }),
        );
      }
      if (url.pathname === '/api/v1/companion/execution-track-execution/progress') {
        const progress = companionExecutionTrackExecutionProgressSchema.parse(parsedBody);
        const result = coordinator.acceptProgress(
          progress,
          liveAuthority(progress.binding.target, leaseHeader),
        );
        progressPosts.push(progress);
        return json(response, 200, { result });
      }
      if (url.pathname === '/api/v1/companion/execution-track-execution/managed-start') {
        const submission =
          companionExecutionTrackExecutionManagedStartSubmissionSchema.parse(parsedBody);
        const result = coordinator.startManaged(
          submission,
          liveAuthority(submission.currentLease.target, leaseHeader),
        );
        managedStartPosts.push(submission);
        return json(response, 200, { result });
      }
      if (url.pathname === '/api/v1/companion/execution-track-execution/result') {
        const resultPayload = companionExecutionTrackExecutionResultSchema.parse(parsedBody);
        const result = coordinator.acceptResult(
          resultPayload,
          liveAuthority(resultPayload.target, leaseHeader),
        );
        resultPosts.push(resultPayload);
        return json(response, 200, { result });
      }
      if (
        url.pathname === '/api/v1/companion/execution-track-execution/recovery' &&
        request.method === 'GET'
      ) {
        const target = {
          adapterId: url.searchParams.get('adapterId'),
          instanceId: url.searchParams.get('instanceId'),
        };
        const authority = liveAuthority(target, leaseHeader);
        const recovery = coordinator.pollRecovery('blender', target.instanceId, authority.lease);
        return json(
          response,
          200,
          companionExecutionTrackExecutionRecoveryPollDeliverySchema.parse({ request: recovery }),
        );
      }
      if (
        url.pathname === '/api/v1/companion/execution-track-execution/recovery' &&
        request.method === 'POST'
      ) {
        const ack = companionExecutionTrackExecutionRecoveryAckSchema.parse(parsedBody);
        const result = coordinator.acceptRecoveryAck(
          ack,
          liveAuthority(ack.request.target, leaseHeader),
        );
        return json(response, 200, { result });
      }

      const upstream = await fetch(new URL(request.url ?? '/', runtime.baseUrl), {
        method: request.method,
        headers: {
          accept: 'application/json',
          authorization: request.headers.authorization ?? '',
          ...(typeof leaseHeader === 'string'
            ? { 'x-operatingline-companion-lease': leaseHeader }
            : {}),
          ...(body.length > 0 ? { 'content-type': 'application/json' } : {}),
        },
        body: body.length > 0 ? body : undefined,
      });
      const upstreamBody = Buffer.from(await upstream.arrayBuffer());
      const parsedUpstream =
        upstreamBody.length > 0 ? JSON.parse(upstreamBody.toString('utf8')) : undefined;

      if (request.method === 'POST' && url.pathname === '/api/v1/companion/session') {
        assert.equal(upstream.ok, true, upstreamBody.toString('utf8'));
        currentLease = {
          leaseId: parsedUpstream.leaseId,
          sessionId: parsedUpstream.sessionId,
          target: { adapterId: parsedBody.adapterId, instanceId: parsedBody.instanceId },
          documentIncarnationId: parsedUpstream.documentIncarnationId,
          expiresAt: parsedUpstream.expiresAt,
        };
        currentDocumentAuthority = documentAuthoritySha256({
          adapterId: parsedBody.adapterId,
          instanceId: parsedBody.instanceId,
          sessionId: parsedUpstream.sessionId,
          documentIncarnationId: parsedUpstream.documentIncarnationId,
        });
      }
      if (request.method === 'POST' && url.pathname === '/api/v1/companion/heartbeat') {
        assert.equal(upstream.ok, true, upstreamBody.toString('utf8'));
        assert.ok(currentLease);
        currentLease = { ...currentLease, expiresAt: parsedUpstream.expiresAt };
      }
      if (
        request.method === 'POST' &&
        url.pathname === '/api/v1/companion/state' &&
        parsedUpstream?.result !== undefined
      ) {
        const report = companionStateReportSchema.parse(parsedBody);
        stateReports.push(report);
        if (report.transition === 'walkthrough_started' && queuedBinding === null) {
          queuedBinding = buildExecutionBinding(report);
          coordinator.queue(queuedBinding, currentDocumentAuthority);
        }
      }

      response.writeHead(upstream.status, {
        'content-type': upstream.headers.get('content-type') ?? 'application/json',
      });
      response.end(upstreamBody);
    } catch (error) {
      console.error(`Execution-track proxy rejected ${request.method} ${url.pathname}:`, error);
      if (url.pathname === '/api/v1/companion/execution-track-execution/progress') {
        const { contentSha256, ...content } = parsedBody ?? {};
        console.error('Rejected execution progress:', {
          phase: parsedBody?.phase,
          sequence: parsedBody?.sequence,
          dispatchedAt: parsedBody?.dispatchedAt,
          occurredAt: parsedBody?.occurredAt,
          currentLeaseExpiresAt: parsedBody?.currentLease?.expiresAt,
          contentSha256,
          computedContentSha256: computeProtocolCanonicalJsonSha256(content),
          receiptTimes: parsedBody?.proofReceipts?.map((receipt) => receipt.occurredAt),
          operationIds: parsedBody?.proofReceipts?.map((receipt) => receipt.operationId),
          completedOperationIds: parsedBody?.completedOperationIds,
        });
      }
      json(response, 422, {
        error: 'execution_track_e2e_proxy_rejected',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  try {
    const address = await listen(proxy);
    assert.ok(address && typeof address !== 'string');
    const proxyUrl = `http://127.0.0.1:${address.port}`;
    const versionResult = await new Promise((resolveVersion, reject) => {
      const child = spawn(blender, ['--version']);
      let stdout = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => (stdout += chunk));
      child.once('error', reject);
      child.once('exit', (code) =>
        code === 0
          ? resolveVersion(stdout.split('\n')[0])
          : reject(new Error('Blender --version failed')),
      );
    });
    console.log(`Testing managed execution track with ${versionResult}`);
    await runBlender(blender, {
      OPERATINGLINE_EXECUTION_TRACK_RUNTIME_URL: proxyUrl,
      OPERATINGLINE_EXECUTION_TRACK_ACCESS_TOKEN: accessToken,
      OPERATINGLINE_EXECUTION_TRACK_CONFIG: configPath,
      OPERATINGLINE_EXECUTION_TRACK_RESULT: resultPath,
      OPERATINGLINE_EXECUTION_TRACK_TIMEOUT: '150',
    });

    const result = JSON.parse(readFileSync(resultPath, 'utf8'));
    if (result.ok !== true) {
      console.error(
        'Execution-track E2E state reports:',
        stateReports.map(({ reportId, sequence, transition, phase }) => ({
          reportId,
          sequence,
          transition,
          phase,
        })),
      );
    }
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.driverStartCount, 1);
    assert.equal(result.managedCommitCount, 1);
    assert.equal(result.nativeUndoTransitionCount, 8);
    assert.equal(result.proofObjectCount, 1);
    assert.deepEqual(result.objectLocation, [1.25, -2, 0.75]);
    assert.deepEqual(result.objectScale, [1, 1, 1]);
    assert.deepEqual(result.meshTopology, { vertices: 482, edges: 992, polygons: 512 });
    assert.equal(result.sessionCompleted, true);
    assert.equal(result.receiptCount, 1);
    assert.equal(result.checkpointOperation, 'next');
    assert.equal(result.executionOutboxPresent, false);
    assert.equal(result.proofHistoryCurrentPresent, false);
    assert.equal(result.proofHistoryStatus, 'superseded');
    assert.equal(result.redoPollAfterManagedCommit, false);

    assert.ok(queuedBinding);
    const status = coordinator.get(queuedBinding.requestId);
    assert.equal(status?.status, 'succeeded');
    assert.equal(progressPosts.length, 6);
    assert.deepEqual(
      progressPosts.map((progress) => progress.phase),
      [
        'baseline_attested',
        'proof_in_progress',
        'proof_observed_locked',
        'restore_in_progress',
        'baseline_restored',
        'commit_intent_recorded',
      ],
    );
    assert.equal(progressPosts[1].proofReceipts.length, 7);
    assert.equal(progressPosts[3].transitions.length, 1);
    assert.equal(progressPosts[4].transitions.length, 8);
    assert.deepEqual(
      progressPosts[4].transitions.map(({ order, fromCursor, toCursor }) => ({
        order,
        fromCursor,
        toCursor,
      })),
      Array.from({ length: 8 }, (_, index) => ({
        order: index + 1,
        fromCursor: 8 - index,
        toCursor: 7 - index,
      })),
    );
    assert.equal(managedStartPosts.length, 1);
    assert.equal(resultPosts.length, 1);
    assert.equal(resultPosts[0].status, 'succeeded');
    assert.equal(resultPosts[0].managedObservation.kind, 'uv_sphere_ready');
    assert.equal(resultPosts[0].managedCheckpoint.operation, 'next');
    assert.deepEqual(
      events.events.map((event) => event.eventType),
      [
        'blender.execution-track-execution.queued',
        'blender.execution-track-execution.dispatched',
        ...Array.from({ length: 6 }, () => 'blender.execution-track-execution.progressed'),
        'blender.execution-track-execution.managed-started',
        'blender.execution-track-execution.completed',
      ],
    );
    console.log(
      `Managed execution-track E2E passed ${versionResult}: seven UI receipts, eight native Undo transitions, Redo barrier, one managed commit, strong Observation terminal`,
    );
  } finally {
    if (proxy.listening) await closeServer(proxy);
    await runtime.stop();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

syncBlenderExtensionResources();
for (const blender of requireBlenderBinaries()) await runOne(blender);
