import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
import { lightTrailsLeafOperationIds } from '@operatingline/protocol';

import { requireBlenderBinaries } from './blender-binaries.mjs';
import { syncBlenderExtensionResources } from './sync-extension-resources.mjs';

const accessToken = 'operatingline-light-trails-leaf-e2e-token';
const childTimeoutMs = 240_000;
const fixturePath = resolve('tests/e2e/blender/light_trails_leaf_operation_companion.py');
const headers = {
  authorization: `Bearer ${accessToken}`,
  'content-type': 'application/json',
};
const creatorLeafId = 'snowman.head.eyes.left';
const lightTrailsLeafId = `${creatorLeafId}.light-trails`;
const lightTrailsTool = 'operatingline.blender.geometry-nodes.light-trails.execute-next';
const lightTrailsStatusTool = 'operatingline.blender.geometry-nodes.light-trails.status';
const transformTool = 'operatingline.blender.geometry-nodes.transform.execute-next';
const transformStatusTool = 'operatingline.blender.geometry-nodes.transform.status';
const expectedNodeTypes = [
  'GeometryNodeCurvePrimitiveCircle',
  'GeometryNodeCurvePrimitiveLine',
  'GeometryNodeCurveToMesh',
  'GeometryNodeInputPosition',
  'GeometryNodeInstanceOnPoints',
  'GeometryNodeInstanceOnPoints',
  'GeometryNodeJoinGeometry',
  'GeometryNodeMeshLine',
  'GeometryNodeMeshLine',
  'GeometryNodeRealizeInstances',
  'GeometryNodeRealizeInstances',
  'GeometryNodeResampleCurve',
  'GeometryNodeSetPosition',
  'GeometryNodeTransform',
  'NodeGroupInput',
  'NodeGroupOutput',
  'ShaderNodeCombineXYZ',
  'ShaderNodeMath',
  'ShaderNodeMath',
  'ShaderNodeTexNoise',
];

const lightTrailsArguments = {
  targetId: 'snowman.eye.left',
  modifierId: 'snowman.eye.left.light-trails.modifier',
  modifierName: 'OperatingLine.EyeLeft.LightTrails',
  nodeGroupId: 'snowman.eye.left.light-trails.nodes',
  nodeGroupName: 'OperatingLine.EyeLeft.LightTrailsNodes',
  trailCount: 12,
  pointsPerTrail: 48,
  tileLength: 20,
  trailSpacing: 0.22,
  noiseScale: 0.4,
  noiseDetail: 3,
  noiseRoughness: 0.55,
  noiseSeed: 7,
  height: 1.8,
  profileSides: 4,
  profileRadius: 0.025,
  tileRepeatCount: 3,
};

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

let mcpId = 1;
async function callMcpTool(runtime, name, argumentsValue) {
  const response = await fetch(runtime.mcpEndpoint, {
    method: 'POST',
    headers: {
      ...headers,
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-11-25',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: mcpId++,
      method: 'tools/call',
      params: { name, arguments: argumentsValue },
    }),
  });
  assert.equal(response.status, 200);
  const dataLine = (await response.text()).split('\n').find((line) => line.startsWith('data: '));
  assert.ok(dataLine, `${name} did not return an MCP SSE data event`);
  return JSON.parse(dataLine.slice('data: '.length));
}

function lightTrailsCandidate(packet) {
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
  assert.ok(creator, 'Expected the Light Trails target creator leaf');
  const lightTrails = JSON.parse(JSON.stringify(creator));
  lightTrails.id = lightTrailsLeafId;
  lightTrails.order = 2;
  lightTrails.dependsOn = [creatorLeafId];
  lightTrails.action = {
    adapterId: 'blender',
    name: 'blender.geometry_nodes.create_light_trails',
    arguments: lightTrailsArguments,
  };
  lightTrails.title = 'Create exact no-bake Light Trails one operation at a time';
  lightTrails.intent =
    'Build, configure, connect, and verify the accepted fixed-topology Light Trails graph.';
  const semanticParameters = {
    'node.light_trails.half_tile_line': { tileLength: 0 },
    'node.light_trails.trail_resolution': { pointsPerTrail: 0 },
    'node.light_trails.trail_rows': { trailCount: 0, trailSpacing: 0 },
    'node.light_trails.terrain_noise': {
      noiseScale: 0,
      noiseDetail: 0,
      noiseRoughness: 0,
      noiseSeed: 0,
    },
    'node.light_trails.scale_height': { height: 0 },
    'node.light_trails.trail_profile': { profileSides: 0, profileRadius: 0 },
    'node.light_trails.loop_tiles': { tileRepeatCount: 0 },
  };
  lightTrails.semanticOperations = Object.entries(semanticParameters).map(
    ([semanticAction, parameters], index) => ({
      id: `semantic.light_trails.${index + 1}`,
      order: index + 1,
      semanticAction,
      description: `Configure ${semanticAction}.`,
      parameters,
      evidenceRefs: ['evidence.prompt'],
    }),
  );
  lightTrails.anchors = [
    { kind: 'object', objectName: creator.action.arguments.objectName },
    {
      kind: 'owned_control',
      surfaceId: 'geometry_nodes.editor',
      controlId: lightTrailsArguments.nodeGroupId,
    },
  ];
  lightTrails.expectedObservations = [
    {
      kind: 'light_trails_ready',
      parameters: { ...lightTrailsArguments, nodeTypes: expectedNodeTypes },
    },
  ];
  tree.nodes.push(lightTrails);
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
      goal: 'Create the accepted no-bake Light Trails graph through all 54 visible operations.',
      treeId: `light-trails-leaf-e2e-${randomUUID()}`,
      revision: 1,
      locale: 'en',
    }),
  });
  const promptBody = await promptResponse.text();
  assert.equal(promptResponse.status, 200, promptBody);
  const packet = JSON.parse(promptBody);
  const proposed = await callMcpTool(runtime, 'operatingline.procedure.replay.propose', {
    formatVersion: '1.0.0',
    replayId,
    targetInstanceId,
    leafId: lightTrailsLeafId,
    replayMode: 'managed_action',
    packet,
    tree: lightTrailsCandidate(packet),
  });
  assert.notEqual(proposed.result?.isError, true, proposed.result?.content?.[0]?.text);
  assert.equal(
    proposed.result?.structuredContent?.binding?.actionName,
    'blender.geometry_nodes.create_light_trails',
  );
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
          `Blender Light Trails leaf E2E failed (code=${String(code)}, signal=${String(signal)})\n${stdout}\n${stderr}`,
        ),
      );
    });
  });
}

async function blenderVersion(blender) {
  return await new Promise((resolveVersion, reject) => {
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
}

async function runOne(blender) {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'operatingline-light-trails-leaf-'));
  const resultPath = join(temporaryDirectory, 'result.json');
  const finalAcceptedPath = join(temporaryDirectory, 'final-accepted.json');
  const failurePath = join(temporaryDirectory, 'proxy-failure.json');
  const diagnosticPath = join(temporaryDirectory, 'diagnostic.json');
  const databasePath = join(temporaryDirectory, 'events.db');
  const runtime = await startRuntime({
    databasePath,
    accessToken,
    actionCatalogs: blenderActionCatalogs,
    interactionCatalogs: blenderInteractionCatalogs,
  });
  let preparePromise;
  let replayId;
  let executionPromise;
  let expectedState;
  const executionRequests = [];
  const deliveries = [];
  const results = [];
  const stateReports = [];
  const proxyErrors = [];
  let hiddenFieldsRejected = false;
  let wrongProfileRejected = false;
  let wrongStatusRejected = false;
  let forgedResourceReceiptRejected = false;
  let forgedLinkReceiptRejected = false;
  let forgedStructureReceiptRejected = false;
  let completedSuccessfully = false;

  const persistDiagnostic = (stage, extra = {}) => {
    writeFileSync(
      diagnosticPath,
      `${JSON.stringify(
        {
          stage,
          temporaryDirectory,
          replayId: replayId ?? null,
          expectedState: expectedState ?? null,
          executionRequestOrdinals: executionRequests.map((_request, index) => index + 1),
          deliveryOrdinals: deliveries.map((delivery) => delivery.operationOrdinal),
          resultOrdinals: results.map((result) => result.operationOrdinal),
          stateReports: stateReports.map((report) => ({
            reportId: report?.reportId ?? null,
            sequence: report?.sequence ?? null,
            transition: report?.transition ?? null,
            stepId: report?.stepId ?? null,
          })),
          proxyErrors,
          hiddenFieldsRejected,
          wrongProfileRejected,
          wrongStatusRejected,
          forgedResourceReceiptRejected,
          forgedLinkReceiptRejected,
          forgedStructureReceiptRejected,
          ...extra,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
  };

  const recordProxyFailure = (message, details = {}) => {
    proxyErrors.push(message);
    writeFileSync(
      failurePath,
      `${JSON.stringify({ error: message, ...details }, null, 2)}\n`,
      'utf8',
    );
    persistDiagnostic('proxy_failed', details);
  };

  const queueOrdinal = async (ordinal) => {
    const request = {
      formatVersion: '1.0.0',
      requestId: randomUUID(),
      replayId,
      expectedState,
    };
    const queued = await callMcpTool(runtime, lightTrailsTool, request);
    assert.notEqual(queued.result?.isError, true, queued.result?.content?.[0]?.text);
    assert.equal(queued.result?.structuredContent?.status, 'queued');
    assert.equal(queued.result?.structuredContent?.operationOrdinal, ordinal);
    executionRequests.push(request);
    persistDiagnostic('operation_queued', { queuedOrdinal: ordinal });
  };

  const proxy = createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const parsedBody = body.length > 0 ? JSON.parse(body.toString('utf8')) : undefined;
      const companionLeaseHeader = request.headers['x-operatingline-companion-lease'];
      const upstreamHeaders = {
        accept: 'application/json',
        authorization: request.headers.authorization ?? '',
        ...(typeof companionLeaseHeader === 'string'
          ? { 'x-operatingline-companion-lease': companionLeaseHeader }
          : {}),
        ...(body.length > 0 ? { 'content-type': 'application/json' } : {}),
      };
      if (
        request.method === 'POST' &&
        request.url === '/api/v1/companion/leaf-operation-result' &&
        parsedBody?.operationOrdinal === 2 &&
        !forgedResourceReceiptRejected
      ) {
        const forged = JSON.parse(JSON.stringify(parsedBody));
        for (const mutation of forged.progress.latestObservation.details.evidence
          .rnaResourceMutations) {
          mutation.targetId = 'forged.light_trails.target';
        }
        const forgedResponse = await fetch(new URL(request.url, runtime.baseUrl), {
          method: request.method,
          headers: upstreamHeaders,
          body: JSON.stringify(forged),
        });
        const forgedBody = await forgedResponse.json();
        forgedResourceReceiptRejected =
          forgedResponse.status === 409 &&
          forgedBody?.error === 'leaf_operation_observation_mismatch';
        assert.equal(
          forgedResourceReceiptRejected,
          true,
          `Runtime accepted a forged RNA resource receipt: ${JSON.stringify(forgedBody)}`,
        );
      }
      if (
        request.method === 'POST' &&
        request.url === '/api/v1/companion/leaf-operation-result' &&
        parsedBody?.operationOrdinal === 3 &&
        !forgedStructureReceiptRejected
      ) {
        const forged = JSON.parse(JSON.stringify(parsedBody));
        forged.progress.latestObservation.details.evidence.rnaStructureCreations[0].nodeGroupId =
          'forged.light-trails.group';
        const forgedResponse = await fetch(new URL(request.url, runtime.baseUrl), {
          method: request.method,
          headers: upstreamHeaders,
          body: JSON.stringify(forged),
        });
        const forgedBody = await forgedResponse.json();
        forgedStructureReceiptRejected =
          forgedResponse.status === 409 &&
          forgedBody?.error === 'leaf_operation_observation_mismatch';
        assert.equal(
          forgedStructureReceiptRejected,
          true,
          `Runtime accepted a forged RNA structure receipt: ${JSON.stringify(forgedBody)}`,
        );
      }
      if (
        request.method === 'POST' &&
        request.url === '/api/v1/companion/leaf-operation-result' &&
        parsedBody?.operationOrdinal === 35 &&
        !forgedLinkReceiptRejected
      ) {
        const forged = JSON.parse(JSON.stringify(parsedBody));
        forged.progress.latestObservation.details.evidence.rnaLinkCreations[0].nodeGroupId =
          'forged.light-trails.group';
        const forgedResponse = await fetch(new URL(request.url, runtime.baseUrl), {
          method: request.method,
          headers: upstreamHeaders,
          body: JSON.stringify(forged),
        });
        const forgedBody = await forgedResponse.json();
        forgedLinkReceiptRejected =
          forgedResponse.status === 409 &&
          forgedBody?.error === 'leaf_operation_observation_mismatch';
        assert.equal(
          forgedLinkReceiptRejected,
          true,
          `Runtime accepted a forged RNA link receipt: ${JSON.stringify(forgedBody)}`,
        );
      }
      const upstream = await fetch(new URL(request.url ?? '/', runtime.baseUrl), {
        method: request.method,
        headers: upstreamHeaders,
        body: body.length > 0 ? body : undefined,
      });
      const upstreamBody = Buffer.from(await upstream.arrayBuffer());
      const parsedUpstream =
        upstreamBody.length > 0 ? JSON.parse(upstreamBody.toString('utf8')) : undefined;

      if (request.method === 'POST' && request.url === '/api/v1/companion/session') {
        assert.equal(upstream.ok, true, upstreamBody.toString('utf8'));
        if (!preparePromise) {
          preparePromise = propose(runtime, parsedBody.instanceId).then((value) => {
            replayId = value;
            persistDiagnostic('proposal_ready');
          });
        }
      }
      if (request.method === 'POST' && request.url === '/api/v1/companion/state') {
        stateReports.push(parsedBody);
        persistDiagnostic('state_reported');
      }
      if (
        request.method === 'POST' &&
        request.url === '/api/v1/companion/state' &&
        parsedBody?.transition === 'step_succeeded' &&
        parsedBody?.stepId === creatorLeafId &&
        !executionPromise
      ) {
        executionPromise = (async () => {
          await preparePromise;
          expectedState = { reportId: parsedBody.reportId, sequence: parsedBody.sequence };
          persistDiagnostic('creator_state_authorized');
          const hidden = await callMcpTool(runtime, lightTrailsTool, {
            formatVersion: '1.0.0',
            requestId: randomUUID(),
            replayId,
            expectedState,
            operationOrdinal: 54,
          });
          hiddenFieldsRejected = hidden.result?.isError === true;
          const wrongProfile = await callMcpTool(runtime, transformTool, {
            formatVersion: '1.0.0',
            requestId: randomUUID(),
            replayId,
            expectedState,
          });
          wrongProfileRejected = wrongProfile.result?.isError === true;
          await queueOrdinal(1);
        })().catch((error) => {
          const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
          recordProxyFailure(message, { phase: 'initial_operation_queue' });
          throw error;
        });
      }
      if (
        request.method === 'GET' &&
        request.url?.startsWith('/api/v1/companion/leaf-operation?') &&
        parsedUpstream?.request
      ) {
        deliveries.push(parsedUpstream.request);
        persistDiagnostic('operation_delivered', {
          deliveredOrdinal: parsedUpstream.request.operationOrdinal,
        });
      }
      if (request.method === 'POST' && request.url === '/api/v1/companion/leaf-operation-result') {
        if (!upstream.ok) {
          const message = `Runtime rejected operation ${String(
            parsedBody?.operationOrdinal,
          )} result (${upstream.status}): ${upstreamBody.toString('utf8')}`;
          recordProxyFailure(message, {
            phase: 'operation_result',
            operationOrdinal: parsedBody?.operationOrdinal ?? null,
            upstreamStatus: upstream.status,
            upstreamBody: upstreamBody.toString('utf8'),
          });
          throw new Error(message);
        }
        assert.equal(parsedUpstream?.result, 'accepted');
        results.push(parsedBody);
        persistDiagnostic('operation_result_accepted', {
          acceptedOrdinal: parsedBody.operationOrdinal,
        });
        const ordinal = parsedBody.operationOrdinal;
        if (ordinal < lightTrailsLeafOperationIds.length) {
          await queueOrdinal(ordinal + 1);
        } else {
          const finalStatus = await callMcpTool(runtime, lightTrailsStatusTool, {
            requestId: parsedBody.requestId,
          });
          assert.notEqual(
            finalStatus.result?.isError,
            true,
            finalStatus.result?.content?.[0]?.text,
          );
          assert.equal(finalStatus.result?.structuredContent?.status, 'succeeded');
          const wrongStatus = await callMcpTool(runtime, transformStatusTool, {
            requestId: parsedBody.requestId,
          });
          wrongStatusRejected = wrongStatus.result?.isError === true;
          writeFileSync(
            finalAcceptedPath,
            `${JSON.stringify({ status: 'succeeded', requestId: parsedBody.requestId })}\n`,
            'utf8',
          );
          persistDiagnostic('final_result_accepted');
        }
      }

      response.writeHead(upstream.status, {
        'content-type': upstream.headers.get('content-type') ?? 'application/json',
      });
      response.end(upstreamBody);
    } catch (error) {
      const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
      if (!proxyErrors.includes(message)) recordProxyFailure(message, { phase: 'proxy_handler' });
      if (!response.headersSent) {
        response.writeHead(502, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: message }));
      } else if (!response.writableEnded) {
        response.end();
      }
    }
  });

  try {
    const address = await listen(proxy);
    assert.ok(address && typeof address !== 'string');
    const proxyUrl = `http://127.0.0.1:${address.port}`;
    const version = await blenderVersion(blender);
    console.log(`Testing live 54-step Light Trails MCP with ${version}`);
    await runBlender(blender, {
      OPERATINGLINE_LIGHT_TRAILS_LEAF_RUNTIME_URL: proxyUrl,
      OPERATINGLINE_LIGHT_TRAILS_LEAF_ACCESS_TOKEN: accessToken,
      OPERATINGLINE_LIGHT_TRAILS_LEAF_RESULT: resultPath,
      OPERATINGLINE_LIGHT_TRAILS_LEAF_FINAL_ACCEPTED: finalAcceptedPath,
      OPERATINGLINE_LIGHT_TRAILS_LEAF_PROXY_FAILURE: failurePath,
      OPERATINGLINE_LIGHT_TRAILS_LEAF_DIAGNOSTIC: diagnosticPath,
      OPERATINGLINE_LIGHT_TRAILS_LEAF_TIMEOUT:
        process.env.OPERATINGLINE_LIGHT_TRAILS_LEAF_TIMEOUT ?? '180',
    });
    await preparePromise;
    await executionPromise;
    assert.deepEqual(proxyErrors, []);
    const result = JSON.parse(readFileSync(resultPath, 'utf8'));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.nodeCount, 20);
    assert.equal(result.linkCount, 19);
    assert.equal(result.bakeCount, 0);
    assert.equal(result.observationSatisfied, true);
    assert.equal(result.operationReceiptCount, 54);
    assert.equal(result.evaluatedVertexCount, 13_824);
    assert.equal(deliveries.length, 54);
    assert.equal(results.length, 54);
    assert.equal(executionRequests.length, 54);
    assert.equal(new Set(executionRequests.map(({ requestId }) => requestId)).size, 54);
    assert.deepEqual(
      deliveries.map(({ operationOrdinal }) => operationOrdinal),
      Array.from({ length: 54 }, (_, index) => index + 1),
    );
    assert.ok(
      deliveries.every(
        (delivery) =>
          delivery.actionName === 'blender.geometry_nodes.create_light_trails' &&
          delivery.recipeId === 'blender.geometry_nodes.create_light_trails.semantic' &&
          JSON.stringify(delivery.operationIds) === JSON.stringify(lightTrailsLeafOperationIds) &&
          JSON.stringify(delivery.expectedState) === JSON.stringify(expectedState),
      ),
    );
    assert.deepEqual(deliveries[0].operationParameters, {
      targetId: lightTrailsArguments.targetId,
      modifierId: lightTrailsArguments.modifierId,
      modifierName: lightTrailsArguments.modifierName,
      nodeGroupId: lightTrailsArguments.nodeGroupId,
      nodeGroupName: lightTrailsArguments.nodeGroupName,
    });
    assert.deepEqual(deliveries[4].operationParameters, { tileLength: 20 });
    assert.deepEqual(deliveries[30].operationParameters, { tileRepeatCount: 3 });
    assert.deepEqual(deliveries[53].operationParameters, {});
    assert.ok(results.slice(0, -1).every((entry) => entry.progress?.finalReport === null));
    assert.equal(results.at(-1)?.progress?.leafCompleted, true);
    assert.equal(results.at(-1)?.progress?.completedOperationIds?.length, 54);
    assert.ok(results.at(-1)?.progress?.finalReport);
    assert.equal(hiddenFieldsRejected, true);
    assert.equal(wrongProfileRejected, true);
    assert.equal(wrongStatusRejected, true);
    assert.equal(forgedResourceReceiptRejected, true);
    assert.equal(forgedLinkReceiptRejected, true);
    assert.equal(forgedStructureReceiptRejected, true);
    assert.equal(
      stateReports.filter(
        (report) => report.transition === 'step_succeeded' && report.stepId === lightTrailsLeafId,
      ).length,
      1,
    );
    console.log(
      `Live Light Trails MCP E2E passed ${version}: 54 derived operations, strong Observation, native checkpoint, no Bake`,
    );
    completedSuccessfully = true;
  } catch (error) {
    persistDiagnostic('runner_failed', {
      runnerError: error instanceof Error ? (error.stack ?? error.message) : String(error),
    });
    console.error(`Light Trails MCP E2E diagnostics preserved at ${temporaryDirectory}`);
    console.error(readFileSync(diagnosticPath, 'utf8'));
    throw error;
  } finally {
    if (proxy.listening) await closeServer(proxy);
    await runtime.stop();
    if (completedSuccessfully) rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

syncBlenderExtensionResources();
for (const blender of requireBlenderBinaries()) await runOne(blender);
