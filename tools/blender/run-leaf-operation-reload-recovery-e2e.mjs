import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  blenderActionCatalog,
  blenderActionCatalogs,
  blenderInteractionCatalog,
  blenderInteractionCatalogs,
} from '@operatingline/blender-action-catalog';
import { startRuntime } from '@operatingline/orchestrator';

import { requireBlenderBinaries } from './blender-binaries.mjs';
import { syncBlenderExtensionResources } from './sync-extension-resources.mjs';

const accessToken = 'operatingline-leaf-reload-e2e-token';
const childTimeoutMs = 120_000;
const fixturePath = resolve('tests/e2e/blender/leaf_operation_reload_recovery.py');
const headers = {
  authorization: `Bearer ${accessToken}`,
  'content-type': 'application/json',
};
const creatorLeafId = 'snowman.head.eyes.left';
const transformLeafId = `${creatorLeafId}.transform`;

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

async function callMcpTool(runtime, id, name, argumentsValue) {
  const response = await fetch(runtime.mcpEndpoint, {
    method: 'POST',
    headers: {
      ...headers,
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-11-25',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name, arguments: argumentsValue },
    }),
  });
  assert.equal(response.status, 200);
  const dataLine = (await response.text()).split('\n').find((line) => line.startsWith('data: '));
  assert.ok(dataLine, `${name} did not return an MCP SSE data event`);
  return JSON.parse(dataLine.slice('data: '.length));
}

function transformCandidate(packet) {
  const tree = JSON.parse(
    readFileSync(resolve('protocol/fixtures/v1/snowman-eye.procedure.json'), 'utf8'),
  );
  tree.id = packet.context.requestedTreeId;
  tree.revision = packet.context.recommendedRevision;
  tree.adapterId = packet.context.catalogBinding.adapterId;
  tree.actionCatalogVersion = packet.context.catalogBinding.actionCatalog.catalogVersion;
  tree.interactionCatalogVersion = packet.context.catalogBinding.interactionCatalog.catalogVersion;
  tree.hostVersionRange = packet.context.catalogBinding.interactionCatalog.hostVersionRange;
  for (const node of tree.nodes) {
    if (node.kind !== 'leaf') continue;
    for (const modality of ['menu', 'shortcut', 'mcp']) {
      node[`${modality}Tracks`] = [
        {
          id: `${node.id}.${modality}.unavailable`,
          availability: 'unavailable',
          title: `${modality} grounding pending`,
          reason: 'A deterministic grounding stage has not materialized this track.',
          modality,
        },
      ];
    }
  }
  const source = packet.context.goalProvenance.source;
  tree.sources.push(source);
  tree.evidence.push({ ...packet.context.goalProvenance.evidence, sourceId: source.id });
  const creator = tree.nodes.find((node) => node.id === creatorLeafId);
  assert.ok(creator, 'Expected the Transform target creator leaf');
  const transform = JSON.parse(JSON.stringify(creator));
  transform.id = transformLeafId;
  transform.order = 2;
  transform.dependsOn = [creatorLeafId];
  const actionArguments = {
    targetId: creator.action.arguments.resourceId,
    modifierId: 'snowman.eye.left.transform.modifier',
    modifierName: 'OperatingLine.EyeLeft.Transform',
    nodeGroupId: 'snowman.eye.left.transform.nodes',
    nodeGroupName: 'OperatingLine.EyeLeft.TransformNodes',
    translation: [1, 2, 3],
    rotation: [0.1, 0.2, 0.3],
    scale: [1.5, 2, 2.5],
  };
  transform.action = {
    adapterId: 'blender',
    name: 'blender.geometry_nodes.create_transform',
    arguments: actionArguments,
  };
  transform.title = 'Create an exact Transform Geometry node group';
  transform.intent =
    'Create, configure, connect, and verify the accepted Transform Geometry graph.';
  transform.semanticOperations = [
    {
      id: 'semantic.transform_geometry',
      order: 1,
      semanticAction: 'node.transform_geometry',
      description: 'Configure the accepted Transform Geometry values.',
      parameters: { translation: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      evidenceRefs: ['evidence.prompt'],
    },
  ];
  transform.anchors = [
    { kind: 'object', objectName: creator.action.arguments.objectName },
    {
      kind: 'owned_control',
      surfaceId: 'geometry_nodes.editor',
      controlId: actionArguments.nodeGroupId,
    },
  ];
  transform.expectedObservations = [
    {
      kind: 'geometry_nodes_ready',
      parameters: {
        targetId: actionArguments.targetId,
        modifierId: actionArguments.modifierId,
        nodeGroupId: actionArguments.nodeGroupId,
        nodeTypes: ['GeometryNodeTransform', 'NodeGroupInput', 'NodeGroupOutput'],
      },
    },
  ];
  tree.nodes.push(transform);
  return tree;
}

async function propose(runtime, targetInstanceId) {
  const replayId = randomUUID();
  const promptResponse = await fetch(`${runtime.baseUrl}/api/v1/procedure/prompt`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      targetAdapterId: 'blender',
      actionCatalogVersion: blenderActionCatalog.catalogVersion,
      interactionCatalogVersion: blenderInteractionCatalog.catalogVersion,
      goal: 'Prove Transform Geometry operation 01 pre-commit rejection recovery without replay.',
      treeId: `leaf-reload-recovery-${randomUUID()}`,
      revision: 1,
      locale: 'en',
    }),
  });
  const promptBody = await promptResponse.text();
  assert.equal(promptResponse.status, 200, promptBody);
  const packet = JSON.parse(promptBody);
  const proposed = await callMcpTool(runtime, 1, 'operatingline.procedure.replay.propose', {
    formatVersion: '1.0.0',
    replayId,
    targetInstanceId,
    leafId: transformLeafId,
    replayMode: 'managed_action',
    packet,
    tree: transformCandidate(packet),
  });
  assert.notEqual(proposed.result?.isError, true, proposed.result?.content?.[0]?.text);
  return replayId;
}

function runBlender(blender, environment) {
  return new Promise((resolveChild, reject) => {
    const child = spawn(
      blender,
      [
        '--factory-startup',
        '--online-mode',
        '--window-geometry',
        '80',
        '80',
        '1400',
        '900',
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
          `Blender leaf reload E2E failed (code=${String(code)}, signal=${String(signal)})\n${stdout}\n${stderr}`,
        ),
      );
    });
  });
}

async function runOne(blender) {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'operatingline-leaf-reload-'));
  const resultPath = join(temporaryDirectory, 'result.json');
  const databasePath = join(temporaryDirectory, 'events.db');
  const runtime = await startRuntime({
    databasePath,
    accessToken,
    actionCatalogs: blenderActionCatalogs,
    interactionCatalogs: blenderInteractionCatalogs,
  });
  let preparePromise;
  let replayId;
  let executionRequest;
  let executePromise;
  let injectedResult;
  const sessions = [];
  const deliveries = [];
  const stateReports = [];
  const rejectedStateReports = [];
  const recoveryChallenges = [];
  const recoveryPolls = [];
  const recoveryAcks = [];

  const proxy = createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const parsedBody = body.length > 0 ? JSON.parse(body.toString('utf8')) : undefined;

      if (
        request.method === 'POST' &&
        request.url === '/api/v1/companion/leaf-operation-result' &&
        injectedResult === undefined
      ) {
        injectedResult = parsedBody;
        response.writeHead(409, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            error: 'injected_result_precommit_rejection',
            message: 'Injected permanent pre-commit result rejection for reload recovery E2E.',
          }),
        );
        return;
      }

      const companionLeaseHeader = request.headers['x-operatingline-companion-lease'];
      const upstream = await fetch(new URL(request.url ?? '/', runtime.baseUrl), {
        method: request.method,
        headers: {
          accept: 'application/json',
          authorization: request.headers.authorization ?? '',
          ...(typeof companionLeaseHeader === 'string'
            ? { 'x-operatingline-companion-lease': companionLeaseHeader }
            : {}),
          ...(body.length > 0 ? { 'content-type': 'application/json' } : {}),
        },
        body: body.length > 0 ? body : undefined,
      });
      const upstreamBody = Buffer.from(await upstream.arrayBuffer());
      const parsedUpstream =
        upstreamBody.length > 0 ? JSON.parse(upstreamBody.toString('utf8')) : undefined;

      if (request.method === 'POST' && request.url === '/api/v1/companion/session') {
        assert.equal(upstream.ok, true, upstreamBody.toString('utf8'));
        sessions.push({ hello: parsedBody, lease: parsedUpstream });
        if (!preparePromise) {
          preparePromise = propose(runtime, parsedBody.instanceId).then((value) => {
            replayId = value;
          });
        }
      }
      if (request.method === 'POST' && request.url === '/api/v1/companion/state') {
        const stateReport = {
          reportId: parsedBody?.reportId,
          sequence: parsedBody?.sequence,
          transition: parsedBody?.transition,
          leaseId: typeof companionLeaseHeader === 'string' ? companionLeaseHeader : null,
          status: upstream.status,
          response: parsedUpstream,
        };
        stateReports.push(stateReport);
        if (!upstream.ok) rejectedStateReports.push(stateReport);
      }
      if (
        request.method === 'POST' &&
        request.url === '/api/v1/companion/state' &&
        parsedBody?.transition === 'step_succeeded' &&
        parsedBody?.stepId === creatorLeafId &&
        !executePromise
      ) {
        executePromise = (async () => {
          await preparePromise;
          executionRequest = {
            formatVersion: '1.0.0',
            requestId: randomUUID(),
            replayId,
            expectedState: {
              reportId: parsedBody.reportId,
              sequence: parsedBody.sequence,
            },
          };
          const queued = await callMcpTool(
            runtime,
            2,
            'operatingline.blender.geometry-nodes.transform.execute-next',
            executionRequest,
          );
          assert.notEqual(queued.result?.isError, true, queued.result?.content?.[0]?.text);
          assert.equal(queued.result?.structuredContent?.operationOrdinal, 1);
          assert.equal(queued.result?.structuredContent?.status, 'queued');
        })();
      }
      if (
        request.method === 'GET' &&
        request.url?.startsWith('/api/v1/companion/leaf-operation?') &&
        parsedUpstream?.request
      ) {
        deliveries.push(parsedUpstream.request);
      }
      if (
        request.method === 'GET' &&
        request.url?.startsWith('/api/v1/companion/leaf-operation-recovery?')
      ) {
        recoveryPolls.push({ status: upstream.status, body: parsedUpstream });
        if (parsedUpstream?.request) recoveryChallenges.push(parsedUpstream.request);
      }
      if (
        request.method === 'POST' &&
        request.url === '/api/v1/companion/leaf-operation-recovery'
      ) {
        assert.equal(upstream.ok, true, upstreamBody.toString('utf8'));
        recoveryAcks.push({ acknowledgement: parsedUpstream, body: parsedBody });
      }

      response.writeHead(upstream.status, {
        'content-type': upstream.headers.get('content-type') ?? 'application/json',
      });
      response.end(upstreamBody);
    } catch (error) {
      response.writeHead(502, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      );
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
    console.log(`Testing live leaf reload recovery with ${versionResult}`);
    await runBlender(blender, {
      OPERATINGLINE_LEAF_RELOAD_RUNTIME_URL: proxyUrl,
      OPERATINGLINE_LEAF_RELOAD_ACCESS_TOKEN: accessToken,
      OPERATINGLINE_LEAF_RELOAD_RESULT: resultPath,
      OPERATINGLINE_LEAF_RELOAD_TIMEOUT: process.env.OPERATINGLINE_LEAF_RELOAD_TIMEOUT ?? '90',
    });
    await preparePromise;
    await executePromise;
    const result = JSON.parse(readFileSync(resultPath, 'utf8'));
    if (result.ok !== true) {
      const diagnosticStatus = executionRequest
        ? await callMcpTool(runtime, 99, 'operatingline.blender.geometry-nodes.transform.status', {
            requestId: executionRequest.requestId,
          })
        : null;
      console.error(
        JSON.stringify(
          {
            sessions: sessions.map(({ hello, lease }) => ({
              sessionId: hello.sessionId,
              instanceId: hello.instanceId,
              documentIncarnationId: hello.documentIncarnationId,
              leaseId: lease.leaseId,
            })),
            deliveries: deliveries.map((delivery) => ({
              requestId: delivery.requestId,
              operationOrdinal: delivery.operationOrdinal,
              expectedState: delivery.expectedState,
            })),
            rejectedStateReports: rejectedStateReports.slice(-5),
            recoveryPolls: recoveryPolls.slice(-5).map(({ status, body }) => ({
              status,
              error: body?.error,
              message: body?.message,
              challenge: body?.request
                ? {
                    recoveryId: body.request.recoveryId,
                    requestId: body.request.originalDelivery?.requestId,
                    expectedState: body.request.expectedState,
                  }
                : null,
            })),
            recoveryAcks: recoveryAcks.map(({ acknowledgement, body }) => ({
              acknowledgement,
              outcome: body.outcome,
            })),
            diagnosticStatus: diagnosticStatus?.result?.structuredContent,
          },
          null,
          2,
        ),
      );
    }
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.status, 'Current Blender document quarantined');
    assert.equal(result.rejectionObserved, true);
    assert.equal(result.creatorObjectExistsAfterReload, false);
    assert.equal(result.transformNodeGroupExists, false);
    assert.ok(sessions.length >= 2, 'Reload must establish a replacement Companion session');
    const first = sessions[0].hello;
    const replacementSession = sessions.find((entry) => entry.hello.sessionId !== first.sessionId);
    assert.ok(replacementSession, 'Expected a hello with a replacement sessionId');
    const replacement = replacementSession.hello;
    assert.equal(replacement.instanceId, first.instanceId);
    assert.equal(replacement.documentIncarnationId, first.documentIncarnationId);
    assert.notEqual(replacement.sessionId, first.sessionId);
    assert.deepEqual(rejectedStateReports, [], 'Replacement reports must not reset state sequence');
    const replacementConnected = stateReports.find(
      (report) =>
        report.leaseId === replacementSession.lease.leaseId && report.transition === 'connected',
    );
    assert.ok(replacementConnected, 'Replacement session must publish its connected state');
    assert.ok(
      replacementConnected.sequence > injectedResult.expectedState.sequence,
      'Replacement report sequence must continue above the pre-reload accepted state',
    );
    assert.equal(deliveries.length, 1, 'The retired operation must never replay');
    assert.equal(deliveries[0].operationOrdinal, 1);
    assert.equal(injectedResult?.status, 'succeeded');
    assert.equal(injectedResult?.progress?.completedOperationIds?.length, 1);
    assert.equal(injectedResult?.progress?.latestObservation?.details?.mutating, false);
    assert.equal(
      injectedResult?.progress?.latestObservation?.details?.operationId,
      'semantic.preflight_transform_geometry_resources',
    );
    assert.equal(recoveryChallenges.length, 1);
    assert.equal(recoveryChallenges[0].originalDelivery.requestId, executionRequest.requestId);
    assert.equal(recoveryChallenges[0].acceptedPrefix.completedOperationIds.length, 0);
    assert.equal(recoveryAcks.length, 1);
    assert.equal(recoveryAcks[0].acknowledgement.result, 'accepted');
    assert.equal(recoveryAcks[0].body.outcome, 'document_incarnation_retired');
    assert.equal(recoveryAcks[0].body.evidence.reason, 'runtime_recovery_evidence_lost');

    const status = await callMcpTool(
      runtime,
      3,
      'operatingline.blender.geometry-nodes.transform.status',
      { requestId: executionRequest.requestId },
    );
    assert.notEqual(status.result?.isError, true, status.result?.content?.[0]?.text);
    assert.equal(status.result?.structuredContent?.status, 'failed');
    assert.match(
      status.result?.structuredContent?.result?.error ?? '',
      /document incarnation is retired/,
    );
    const quarantined = await callMcpTool(
      runtime,
      4,
      'operatingline.blender.geometry-nodes.transform.execute-next',
      executionRequest,
    );
    assert.equal(quarantined.result?.isError, true);
    assert.match(
      quarantined.result?.content?.[0]?.text ?? '',
      /leaf_operation_document_incarnation_retired/,
    );
    assert.equal(deliveries.length, 1, 'Quarantine must isolate same-request execute-next');
    console.log(
      `Live leaf reload recovery E2E passed ${versionResult}: op01 pre-commit rejection, session rotation, automatic retirement, and durable quarantine verified without operation replay`,
    );
  } finally {
    if (proxy.listening) await closeServer(proxy);
    await runtime.stop();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

syncBlenderExtensionResources();
for (const blender of requireBlenderBinaries()) await runOne(blender);
