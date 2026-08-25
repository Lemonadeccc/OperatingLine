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
import { subdivisionSurfaceLeafOperationIds } from '@operatingline/protocol';

import { requireBlenderBinaries } from './blender-binaries.mjs';
import { syncBlenderExtensionResources } from './sync-extension-resources.mjs';

const accessToken = 'operatingline-subdivision-surface-leaf-e2e-token';
const childTimeoutMs = 240_000;
const fixturePath = resolve('tests/e2e/blender/subdivision_surface_leaf_operation_companion.py');
const headers = {
  authorization: `Bearer ${accessToken}`,
  'content-type': 'application/json',
};
const creatorLeafId = 'snowman.head.eyes.left';
const subdivisionSurfaceGroupId = 'snowman.head.subdivision_surface';
const subdivisionSurfaceLeafId = `${creatorLeafId}.subdivision_surface`;
const subdivisionSurfaceTool = 'operatingline.blender.modifier.subdivision-surface.execute-next';
const subdivisionSurfaceStatusTool = 'operatingline.blender.modifier.subdivision-surface.status';
const actionLevelTool = 'operatingline.blender.action.execute';
const transformTool = 'operatingline.blender.geometry-nodes.transform.execute-next';
const transformStatusTool = 'operatingline.blender.geometry-nodes.transform.status';

const subdivisionSurfaceArguments = {
  targetId: 'snowman.eye.left',
  modifierId: 'guided.subdivision_surface.modifier',
  modifierName: 'OperatingLine.GuidedSubdivisionSurface',
  viewportLevel: 2,
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

function unavailableTracks(node) {
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

function subdivisionSurfaceCandidate(packet) {
  const tree = JSON.parse(
    readFileSync(resolve('protocol/fixtures/v1/snowman-eye.procedure.json'), 'utf8'),
  );
  tree.id = packet.context.requestedTreeId;
  tree.revision = packet.context.recommendedRevision;
  tree.adapterId = packet.context.catalogBinding.adapterId;
  tree.actionCatalogVersion = packet.context.catalogBinding.actionCatalog.catalogVersion;
  tree.interactionCatalogVersion = packet.context.catalogBinding.interactionCatalog.catalogVersion;
  tree.hostVersionRange = packet.context.catalogBinding.interactionCatalog.hostVersionRange;
  tree.nodes.filter((node) => node.kind === 'leaf').forEach(unavailableTracks);
  const source = packet.context.goalProvenance.source;
  tree.sources.push(source);
  tree.evidence.push({ ...packet.context.goalProvenance.evidence, sourceId: source.id });

  const creator = tree.nodes.find((node) => node.id === creatorLeafId);
  assert.ok(creator, 'Expected the Subdivision Surface target creator leaf');
  const eyesGroup = tree.nodes.find((node) => node.id === 'snowman.head.eyes');
  assert.ok(eyesGroup, 'Expected the creator parent group');

  const subdivisionSurfaceGroup = JSON.parse(JSON.stringify(eyesGroup));
  subdivisionSurfaceGroup.id = subdivisionSurfaceGroupId;
  subdivisionSurfaceGroup.parentId = 'snowman';
  subdivisionSurfaceGroup.order = 2;
  subdivisionSurfaceGroup.title = 'Subdivision Surface';

  const subdivisionSurface = JSON.parse(JSON.stringify(creator));
  subdivisionSurface.id = subdivisionSurfaceLeafId;
  subdivisionSurface.parentId = subdivisionSurfaceGroupId;
  subdivisionSurface.order = 1;
  subdivisionSurface.dependsOn = [creatorLeafId];
  subdivisionSurface.action = {
    adapterId: 'blender',
    name: 'blender.modifier.add_subdivision_surface',
    arguments: subdivisionSurfaceArguments,
  };
  subdivisionSurface.title = 'Add the Subdivision Surface modifier one operation at a time';
  subdivisionSurface.intent =
    'Author and verify the accepted Subdivision Surface through four visible operations.';
  subdivisionSurface.semanticOperations = [
    {
      id: 'semantic.subdivision_surface.create',
      order: 1,
      semanticAction: 'add_subdivision_surface_modifier',
      description: 'Add one Subdivision Surface modifier to the accepted mesh.',
      parameters: { viewportLevel: 2 },
      evidenceRefs: ['evidence.prompt'],
    },
    {
      id: 'semantic.subdivision_surface.target',
      order: 2,
      semanticAction: 'select_owned_mesh',
      description: 'Keep the accepted mesh as the Object Mode modifier target.',
      parameters: { targetId: subdivisionSurfaceArguments.targetId },
      evidenceRefs: ['evidence.prompt'],
    },
    {
      id: 'semantic.subdivision_surface.identity',
      order: 3,
      semanticAction: 'track_modifier_identity',
      description: 'Track the managed Subdivision Surface modifier identity and name.',
      parameters: {
        modifierId: subdivisionSurfaceArguments.modifierId,
        modifierName: subdivisionSurfaceArguments.modifierName,
      },
      evidenceRefs: ['evidence.prompt'],
    },
  ];
  subdivisionSurface.anchors = [
    { kind: 'object', objectName: 'OperatingLine.EyeLeft' },
    {
      kind: 'owned_control',
      surfaceId: 'modifier.stack',
      controlId: subdivisionSurfaceArguments.modifierId,
    },
  ];
  subdivisionSurface.expectedObservations = [
    {
      kind: 'modifier_ready',
      parameters: {
        targetId: subdivisionSurfaceArguments.targetId,
        modifierId: subdivisionSurfaceArguments.modifierId,
        modifierType: 'SUBSURF',
        levels: subdivisionSurfaceArguments.viewportLevel,
        renderLevels: 2,
        subdivisionType: 'CATMULL_CLARK',
        quality: 3,
        showOnlyControlEdges: true,
        useCreases: true,
        useLimitSurface: true,
        boundarySmooth: 'ALL',
        uvSmooth: 'PRESERVE_BOUNDARIES',
        useCustomNormals: false,
        showViewport: true,
        showRender: true,
        showInEditMode: true,
        showOnCage: false,
      },
    },
  ];
  unavailableTracks(subdivisionSurface);
  tree.nodes.push(subdivisionSurfaceGroup, subdivisionSurface);
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
      goal: 'Add the accepted Subdivision Surface modifier through all four visible operations.',
      treeId: `subdivision-surface-leaf-e2e-${randomUUID()}`,
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
    leafId: subdivisionSurfaceLeafId,
    replayMode: 'managed_action',
    packet,
    tree: subdivisionSurfaceCandidate(packet),
  });
  assert.notEqual(proposed.result?.isError, true, proposed.result?.content?.[0]?.text);
  assert.equal(
    proposed.result?.structuredContent?.binding?.actionName,
    'blender.modifier.add_subdivision_surface',
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
          `Blender Subdivision Surface leaf E2E failed (code=${String(code)}, signal=${String(signal)})\n${stdout}\n${stderr}`,
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
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'operatingline-subdivision-surface-leaf-'));
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
  let actionLevelExecutorRejected = false;
  let wrongProfileRejected = false;
  let wrongStatusRejected = false;
  let forgedCreateReceiptRejected = false;
  let forgedPropertyReceiptRejected = false;
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
          results: results.map((result) => ({
            operationOrdinal: result.operationOrdinal,
            status: result.status,
            error: result.error,
          })),
          stateReports: stateReports.map((report) => ({
            reportId: report?.reportId ?? null,
            sequence: report?.sequence ?? null,
            transition: report?.transition ?? null,
            stepId: report?.stepId ?? null,
          })),
          proxyErrors,
          hiddenFieldsRejected,
          actionLevelExecutorRejected,
          wrongProfileRejected,
          wrongStatusRejected,
          forgedCreateReceiptRejected,
          forgedPropertyReceiptRejected,
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
    writeFileSync(failurePath, `${JSON.stringify({ error: message, ...details }, null, 2)}\n`);
    persistDiagnostic('proxy_failed', details);
  };

  const queueOrdinal = async (ordinal) => {
    const request = {
      formatVersion: '1.0.0',
      requestId: randomUUID(),
      replayId,
      expectedState,
    };
    const queued = await callMcpTool(runtime, subdivisionSurfaceTool, request);
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
        parsedBody?.operationOrdinal === 3 &&
        !forgedCreateReceiptRejected
      ) {
        const forged = JSON.parse(JSON.stringify(parsedBody));
        forged.progress.latestObservation.details.evidence.rnaSubdivisionSurfaceModifierMutations[0].modifierId =
          'forged.subdivision_surface.modifier';
        const forgedResponse = await fetch(new URL(request.url, runtime.baseUrl), {
          method: request.method,
          headers: upstreamHeaders,
          body: JSON.stringify(forged),
        });
        const forgedBody = await forgedResponse.json();
        forgedCreateReceiptRejected =
          forgedResponse.status === 409 &&
          forgedBody?.error === 'leaf_operation_observation_mismatch';
        assert.equal(
          forgedCreateReceiptRejected,
          true,
          `Runtime accepted a forged Subdivision Surface creation receipt: ${JSON.stringify(forgedBody)}`,
        );
      }
      if (
        request.method === 'POST' &&
        request.url === '/api/v1/companion/leaf-operation-result' &&
        parsedBody?.operationOrdinal === 4 &&
        !forgedPropertyReceiptRejected
      ) {
        const forged = JSON.parse(JSON.stringify(parsedBody));
        const viewportLevelWrite =
          forged.progress.latestObservation.details.evidence.rnaSubdivisionSurfaceModifierMutations.find(
            (mutation) => mutation.propertyName === 'levels',
          );
        assert.ok(viewportLevelWrite, 'Expected the Subdivision Surface levels RNA write');
        viewportLevelWrite.acceptedValue = 3;
        viewportLevelWrite.observedValue = 3;
        const forgedResponse = await fetch(new URL(request.url, runtime.baseUrl), {
          method: request.method,
          headers: upstreamHeaders,
          body: JSON.stringify(forged),
        });
        const forgedBody = await forgedResponse.json();
        forgedPropertyReceiptRejected =
          forgedResponse.status === 409 &&
          forgedBody?.error === 'leaf_operation_observation_mismatch';
        assert.equal(
          forgedPropertyReceiptRejected,
          true,
          `Runtime accepted a forged Subdivision Surface property receipt: ${JSON.stringify(forgedBody)}`,
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
          const wrongExecutor = await callMcpTool(runtime, actionLevelTool, {
            formatVersion: '1.0.0',
            requestId: randomUUID(),
            replayId,
            expectedState,
          });
          actionLevelExecutorRejected = wrongExecutor.result?.isError === true;
          const hidden = await callMcpTool(runtime, subdivisionSurfaceTool, {
            formatVersion: '1.0.0',
            requestId: randomUUID(),
            replayId,
            expectedState,
            operationOrdinal: 4,
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
          resultStatus: parsedBody.status,
          resultError: parsedBody.error,
        });
        assert.equal(
          parsedBody.status,
          'succeeded',
          `Operation ${String(parsedBody.operationOrdinal)} failed: ${String(parsedBody.error)}`,
        );
        const ordinal = parsedBody.operationOrdinal;
        if (ordinal < subdivisionSurfaceLeafOperationIds.length) {
          await queueOrdinal(ordinal + 1);
        } else {
          const finalStatus = await callMcpTool(runtime, subdivisionSurfaceStatusTool, {
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
    console.log(`Testing live four-step Subdivision Surface MCP with ${version}`);
    await runBlender(blender, {
      OPERATINGLINE_SUBDIVISION_SURFACE_LEAF_RUNTIME_URL: proxyUrl,
      OPERATINGLINE_SUBDIVISION_SURFACE_LEAF_ACCESS_TOKEN: accessToken,
      OPERATINGLINE_SUBDIVISION_SURFACE_LEAF_RESULT: resultPath,
      OPERATINGLINE_SUBDIVISION_SURFACE_LEAF_FINAL_ACCEPTED: finalAcceptedPath,
      OPERATINGLINE_SUBDIVISION_SURFACE_LEAF_PROXY_FAILURE: failurePath,
      OPERATINGLINE_SUBDIVISION_SURFACE_LEAF_DIAGNOSTIC: diagnosticPath,
      OPERATINGLINE_SUBDIVISION_SURFACE_LEAF_TIMEOUT:
        process.env.OPERATINGLINE_SUBDIVISION_SURFACE_LEAF_TIMEOUT ?? '180',
    });
    await preparePromise;
    await executionPromise;
    assert.deepEqual(proxyErrors, []);
    const result = JSON.parse(readFileSync(resultPath, 'utf8'));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.modifierCount, 1);
    assert.equal(result.observationSatisfied, true);
    assert.equal(result.propertiesMatch, true);
    assert.equal(result.sourceContentIntact, true);
    assert.equal(result.evaluatedWithinLimits, true);
    assert.equal(result.operationReceiptCount, 4);
    assert.equal(deliveries.length, 4);
    assert.equal(results.length, 4);
    assert.equal(executionRequests.length, 4);
    assert.equal(new Set(executionRequests.map(({ requestId }) => requestId)).size, 4);
    assert.deepEqual(
      deliveries.map(({ operationOrdinal }) => operationOrdinal),
      Array.from({ length: 4 }, (_, index) => index + 1),
    );
    assert.ok(
      deliveries.every(
        (delivery) =>
          delivery.actionName === 'blender.modifier.add_subdivision_surface' &&
          delivery.recipeId === 'blender.modifier.add_subdivision_surface.semantic' &&
          JSON.stringify(delivery.operationIds) ===
            JSON.stringify(subdivisionSurfaceLeafOperationIds) &&
          JSON.stringify(delivery.expectedState) === JSON.stringify(expectedState),
      ),
    );
    assert.deepEqual(deliveries[0].operationParameters, {
      targetId: subdivisionSurfaceArguments.targetId,
      modifierId: subdivisionSurfaceArguments.modifierId,
    });
    assert.deepEqual(deliveries[1].operationParameters, {});
    assert.deepEqual(deliveries[2].operationParameters, {});
    assert.deepEqual(deliveries[3].operationParameters, {
      modifierName: subdivisionSurfaceArguments.modifierName,
      viewportLevel: subdivisionSurfaceArguments.viewportLevel,
    });
    assert.ok(results.slice(0, -1).every((entry) => entry.progress?.finalReport === null));
    assert.equal(results.at(-1)?.progress?.leafCompleted, true);
    assert.equal(results.at(-1)?.progress?.completedOperationIds?.length, 4);
    assert.ok(results.at(-1)?.progress?.finalReport);
    assert.equal(
      results[2]?.progress?.latestObservation?.details?.evidence
        ?.rnaSubdivisionSurfaceModifierMutations?.length,
      1,
    );
    assert.equal(
      results[3]?.progress?.latestObservation?.details?.evidence
        ?.rnaSubdivisionSurfaceModifierMutations?.length,
      15,
    );
    assert.equal(hiddenFieldsRejected, true);
    assert.equal(actionLevelExecutorRejected, true);
    assert.equal(wrongProfileRejected, true);
    assert.equal(wrongStatusRejected, true);
    assert.equal(forgedCreateReceiptRejected, true);
    assert.equal(forgedPropertyReceiptRejected, true);
    assert.equal(
      stateReports.filter(
        (report) =>
          report.transition === 'step_succeeded' && report.stepId === subdivisionSurfaceLeafId,
      ).length,
      1,
    );
    console.log(
      `Live Subdivision Surface MCP E2E passed ${version}: four derived operations, exact create/name/property RNA receipts, strong Observation, native checkpoint`,
    );
    completedSuccessfully = true;
  } catch (error) {
    persistDiagnostic('runner_failed', {
      runnerError: error instanceof Error ? (error.stack ?? error.message) : String(error),
    });
    console.error(`Subdivision Surface MCP E2E diagnostics preserved at ${temporaryDirectory}`);
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
