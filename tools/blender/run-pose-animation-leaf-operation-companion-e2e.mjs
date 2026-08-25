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
import { poseAnimationLeafOperationIds } from '@operatingline/protocol';

import { requireBlenderBinaries } from './blender-binaries.mjs';
import { syncBlenderExtensionResources } from './sync-extension-resources.mjs';

const accessToken = 'operatingline-pose-animation-leaf-e2e-token';
const childTimeoutMs = 240_000;
const fixturePath = resolve('tests/e2e/blender/pose_animation_leaf_operation_companion.py');
const headers = {
  authorization: `Bearer ${accessToken}`,
  'content-type': 'application/json',
};
const creatorLeafId = 'snowman.head.eyes.left';
const poseGroupId = 'snowman.head.pose-animation';
const rigLeafId = `${creatorLeafId}.pose-rig`;
const poseAnimationLeafId = `${creatorLeafId}.pose-animation`;
const poseAnimationTool = 'operatingline.blender.animation.pose-keyframes.execute-next';
const poseAnimationStatusTool = 'operatingline.blender.animation.pose-keyframes.status';
const actionLevelTool = 'operatingline.blender.action.execute';
const transformTool = 'operatingline.blender.geometry-nodes.transform.execute-next';
const transformStatusTool = 'operatingline.blender.geometry-nodes.transform.status';

const rootBone = 'OperatingLine.GuidedRoot';
const tipBone = 'OperatingLine.GuidedTip';
const axisBone = 'OperatingLine.GuidedAxis';
const armatureArguments = {
  armatureId: 'guided.pose.armature',
  objectName: 'OperatingLine.GuidedPoseRig',
  dataName: 'OperatingLine.GuidedPoseRigData',
  collectionId: 'snowman.collection',
  bones: [
    {
      boneName: rootBone,
      head: [0, 0, 0],
      tail: [0, 0, 1],
      parentName: null,
    },
    {
      boneName: tipBone,
      head: [0, 0, 1],
      tail: [0, 0, 2],
      parentName: rootBone,
    },
    {
      boneName: axisBone,
      head: [0, 0, 2],
      tail: [0, 0, 3],
      parentName: tipBone,
    },
  ],
  bindings: [{ targetId: 'snowman.eye.left', boneName: rootBone }],
};
const poseAnimationArguments = {
  actionId: 'guided.pose.action',
  actionName: 'OperatingLine.GuidedPoseAction',
  armatureId: armatureArguments.armatureId,
  interpolation: 'LINEAR',
  extrapolation: 'LINEAR',
  keyframes: [
    {
      frame: 1,
      poses: [
        {
          boneName: rootBone,
          rotationEuler: [0, 0, 0],
          location: [0, 0, 0],
          scale: [1, 1, 1],
        },
        {
          boneName: tipBone,
          rotationQuaternion: [1, 0, 0, 0],
          location: [0, 0, 0],
          scale: [1, 1, 1],
        },
        {
          boneName: axisBone,
          rotationAxisAngle: [0, 0, 0, 1],
          location: [0, 0, 0],
          scale: [1, 1, 1],
        },
      ],
    },
    {
      frame: 10,
      poses: [
        {
          boneName: rootBone,
          rotationEuler: [0, 0, 0.2],
          location: [0.1, 0, 0],
          scale: [1, 1, 1],
        },
        {
          boneName: tipBone,
          rotationQuaternion: [Math.cos(0.3), 0, Math.sin(0.3), 0],
          location: [0, 0.15, 0],
          scale: [1, 1.1, 1],
        },
        {
          boneName: axisBone,
          rotationAxisAngle: [0.5, 0, 0, 1],
          location: [0, 0, 0.1],
          scale: [1.1, 1, 1],
        },
      ],
    },
    {
      frame: 20,
      poses: [
        {
          boneName: rootBone,
          rotationEuler: [0, 0, 0],
          location: [0, 0, 0],
          scale: [1, 1, 1],
        },
        {
          boneName: tipBone,
          rotationQuaternion: [1, 0, 0, 0],
          location: [0, 0, 0],
          scale: [1, 1, 1],
        },
        {
          boneName: axisBone,
          rotationAxisAngle: [0, 0, 0, 1],
          location: [0, 0, 0],
          scale: [1, 1, 1],
        },
      ],
    },
  ],
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

function poseAnimationCandidate(packet) {
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
  assert.ok(creator, 'Expected the Pose Animation target creator leaf');
  const eyesGroup = tree.nodes.find((node) => node.id === 'snowman.head.eyes');
  assert.ok(eyesGroup, 'Expected the creator parent group');
  const poseGroup = JSON.parse(JSON.stringify(eyesGroup));
  poseGroup.id = poseGroupId;
  poseGroup.parentId = 'snowman';
  poseGroup.order = 2;
  poseGroup.title = 'Pose Animation';

  const rig = JSON.parse(JSON.stringify(creator));
  rig.id = rigLeafId;
  rig.parentId = poseGroupId;
  rig.order = 1;
  rig.dependsOn = [creatorLeafId];
  rig.action = {
    adapterId: 'blender',
    name: 'blender.rig.create_armature',
    arguments: armatureArguments,
  };
  rig.title = 'Create the owned three-bone Pose rig';
  rig.intent = 'Create and bind the exact accepted armature before animation.';
  rig.semanticOperations = [
    {
      id: 'semantic.pose.rig.create',
      order: 1,
      semanticAction: 'menu.add_armature',
      description: 'Create and name the accepted bounded three-bone armature.',
      parameters: { objectName: '', dataName: '' },
      evidenceRefs: ['evidence.prompt'],
    },
    {
      id: 'semantic.pose.rig.bones',
      order: 2,
      semanticAction: 'mode.edit_bones',
      description: 'Create the exact ordered three-bone hierarchy.',
      parameters: { bones: [] },
      evidenceRefs: ['evidence.prompt'],
    },
    {
      id: 'semantic.pose.rig.bindings',
      order: 3,
      semanticAction: 'semantic.rigid_parent',
      description: 'Bind the accepted target to the root bone.',
      parameters: { bindings: [] },
      evidenceRefs: ['evidence.prompt'],
    },
  ];
  rig.anchors = [{ kind: 'object', objectName: armatureArguments.objectName }];
  rig.expectedObservations = [{ kind: 'armature_ready', parameters: armatureArguments }];
  unavailableTracks(rig);

  const poseAnimation = JSON.parse(JSON.stringify(creator));
  poseAnimation.id = poseAnimationLeafId;
  poseAnimation.parentId = poseGroupId;
  poseAnimation.order = 2;
  poseAnimation.dependsOn = [rigLeafId];
  poseAnimation.action = {
    adapterId: 'blender',
    name: 'blender.animation.create_pose_keyframes',
    arguments: poseAnimationArguments,
  };
  poseAnimation.title = 'Create exact Pose keyframes one operation at a time';
  poseAnimation.intent =
    'Author and verify the accepted Pose Action through 12 visible operations.';
  poseAnimation.semanticOperations = [
    {
      id: 'semantic.pose.create_action',
      order: 1,
      semanticAction: 'semantic.create_pose_action',
      description: 'Create the exact managed Action.',
      parameters: { actionName: '' },
      evidenceRefs: ['evidence.prompt'],
    },
    {
      id: 'semantic.pose.keyframes',
      order: 2,
      semanticAction: 'operator.insert_keyframe',
      description: 'Insert the exact per-bone transform keyframes.',
      parameters: { keyframes: [] },
      evidenceRefs: ['evidence.prompt'],
    },
    {
      id: 'semantic.pose.interpolation',
      order: 3,
      semanticAction: 'control.pose_interpolation',
      description: 'Set interpolation on every authored key.',
      parameters: { interpolation: '' },
      evidenceRefs: ['evidence.prompt'],
    },
    {
      id: 'semantic.pose.extrapolation',
      order: 4,
      semanticAction: 'control.pose_extrapolation',
      description: 'Set extrapolation on every authored curve.',
      parameters: { extrapolation: '' },
      evidenceRefs: ['evidence.prompt'],
    },
  ];
  poseAnimation.anchors = [{ kind: 'object', objectName: armatureArguments.objectName }];
  poseAnimation.expectedObservations = [
    { kind: 'pose_animation_ready', parameters: poseAnimationArguments },
  ];
  unavailableTracks(poseAnimation);
  tree.nodes.push(poseGroup, rig, poseAnimation);
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
      goal: 'Create the accepted Pose Animation through all 12 visible operations.',
      treeId: `pose-animation-leaf-e2e-${randomUUID()}`,
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
    leafId: poseAnimationLeafId,
    replayMode: 'managed_action',
    packet,
    tree: poseAnimationCandidate(packet),
  });
  assert.notEqual(proposed.result?.isError, true, proposed.result?.content?.[0]?.text);
  assert.equal(
    proposed.result?.structuredContent?.binding?.actionName,
    'blender.animation.create_pose_keyframes',
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
          `Blender Pose Animation leaf E2E failed (code=${String(code)}, signal=${String(signal)})\n${stdout}\n${stderr}`,
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
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'operatingline-pose-animation-leaf-'));
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
  let forgedKeyframeReceiptRejected = false;
  let forgedAnimationPropertyReceiptRejected = false;
  let forgedActionResourceReceiptRejected = false;
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
          forgedKeyframeReceiptRejected,
          forgedAnimationPropertyReceiptRejected,
          forgedActionResourceReceiptRejected,
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
    const queued = await callMcpTool(runtime, poseAnimationTool, request);
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
        parsedBody?.operationOrdinal === 4 &&
        !forgedActionResourceReceiptRejected
      ) {
        const forged = JSON.parse(JSON.stringify(parsedBody));
        for (const mutation of forged.progress.latestObservation.details.evidence
          .rnaActionResourceMutations) {
          mutation.actionId = 'forged.animation.action';
        }
        const forgedResponse = await fetch(new URL(request.url, runtime.baseUrl), {
          method: request.method,
          headers: upstreamHeaders,
          body: JSON.stringify(forged),
        });
        const forgedBody = await forgedResponse.json();
        forgedActionResourceReceiptRejected =
          forgedResponse.status === 409 &&
          forgedBody?.error === 'leaf_operation_observation_mismatch';
        assert.equal(
          forgedActionResourceReceiptRejected,
          true,
          `Runtime accepted a forged Pose Action resource receipt: ${JSON.stringify(forgedBody)}`,
        );
      }
      if (
        request.method === 'POST' &&
        request.url === '/api/v1/companion/leaf-operation-result' &&
        parsedBody?.operationOrdinal === 7 &&
        !forgedKeyframeReceiptRejected
      ) {
        const forged = JSON.parse(JSON.stringify(parsedBody));
        for (const insertion of forged.progress.latestObservation.details.evidence
          .rnaKeyframeInsertions) {
          insertion.actionId = 'forged.animation.action';
        }
        const forgedResponse = await fetch(new URL(request.url, runtime.baseUrl), {
          method: request.method,
          headers: upstreamHeaders,
          body: JSON.stringify(forged),
        });
        const forgedBody = await forgedResponse.json();
        forgedKeyframeReceiptRejected =
          forgedResponse.status === 409 &&
          forgedBody?.error === 'leaf_operation_observation_mismatch';
        assert.equal(
          forgedKeyframeReceiptRejected,
          true,
          `Runtime accepted a forged Pose keyframe receipt: ${JSON.stringify(forgedBody)}`,
        );
      }
      if (
        request.method === 'POST' &&
        request.url === '/api/v1/companion/leaf-operation-result' &&
        parsedBody?.operationOrdinal === 9 &&
        !forgedAnimationPropertyReceiptRejected
      ) {
        const forged = JSON.parse(JSON.stringify(parsedBody));
        for (const write of forged.progress.latestObservation.details.evidence
          .rnaAnimationPropertyWrites) {
          write.actionId = 'forged.animation.action';
        }
        const forgedResponse = await fetch(new URL(request.url, runtime.baseUrl), {
          method: request.method,
          headers: upstreamHeaders,
          body: JSON.stringify(forged),
        });
        const forgedBody = await forgedResponse.json();
        forgedAnimationPropertyReceiptRejected =
          forgedResponse.status === 409 &&
          forgedBody?.error === 'leaf_operation_observation_mismatch';
        assert.equal(
          forgedAnimationPropertyReceiptRejected,
          true,
          `Runtime accepted a forged Pose animation property receipt: ${JSON.stringify(forgedBody)}`,
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
        parsedBody?.stepId === rigLeafId &&
        !executionPromise
      ) {
        executionPromise = (async () => {
          await preparePromise;
          expectedState = { reportId: parsedBody.reportId, sequence: parsedBody.sequence };
          persistDiagnostic('rig_state_authorized');
          const wrongExecutor = await callMcpTool(runtime, actionLevelTool, {
            formatVersion: '1.0.0',
            requestId: randomUUID(),
            replayId,
            expectedState,
          });
          actionLevelExecutorRejected = wrongExecutor.result?.isError === true;
          const hidden = await callMcpTool(runtime, poseAnimationTool, {
            formatVersion: '1.0.0',
            requestId: randomUUID(),
            replayId,
            expectedState,
            operationOrdinal: 12,
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
        if (ordinal < poseAnimationLeafOperationIds.length) {
          await queueOrdinal(ordinal + 1);
        } else {
          const finalStatus = await callMcpTool(runtime, poseAnimationStatusTool, {
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
    console.log(`Testing live 12-step Pose Animation MCP with ${version}`);
    await runBlender(blender, {
      OPERATINGLINE_POSE_ANIMATION_LEAF_RUNTIME_URL: proxyUrl,
      OPERATINGLINE_POSE_ANIMATION_LEAF_ACCESS_TOKEN: accessToken,
      OPERATINGLINE_POSE_ANIMATION_LEAF_RESULT: resultPath,
      OPERATINGLINE_POSE_ANIMATION_LEAF_FINAL_ACCEPTED: finalAcceptedPath,
      OPERATINGLINE_POSE_ANIMATION_LEAF_PROXY_FAILURE: failurePath,
      OPERATINGLINE_POSE_ANIMATION_LEAF_DIAGNOSTIC: diagnosticPath,
      OPERATINGLINE_POSE_ANIMATION_LEAF_TIMEOUT:
        process.env.OPERATINGLINE_POSE_ANIMATION_LEAF_TIMEOUT ?? '180',
    });
    await preparePromise;
    await executionPromise;
    assert.deepEqual(proxyErrors, []);
    const result = JSON.parse(readFileSync(resultPath, 'utf8'));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.curveCount, 29);
    assert.equal(result.keyframePointCount, 87);
    assert.equal(result.observationSatisfied, true);
    assert.equal(result.receiptMatches, true);
    assert.equal(result.actionContentIntact, true);
    assert.equal(result.operationReceiptCount, 12);
    assert.equal(deliveries.length, 12);
    assert.equal(results.length, 12);
    assert.equal(executionRequests.length, 12);
    assert.equal(new Set(executionRequests.map(({ requestId }) => requestId)).size, 12);
    assert.deepEqual(
      deliveries.map(({ operationOrdinal }) => operationOrdinal),
      Array.from({ length: 12 }, (_, index) => index + 1),
    );
    assert.ok(
      deliveries.every(
        (delivery) =>
          delivery.actionName === 'blender.animation.create_pose_keyframes' &&
          delivery.recipeId === 'blender.animation.create_pose_keyframes.semantic' &&
          JSON.stringify(delivery.operationIds) === JSON.stringify(poseAnimationLeafOperationIds) &&
          JSON.stringify(delivery.expectedState) === JSON.stringify(expectedState),
      ),
    );
    assert.deepEqual(deliveries[0].operationParameters, {
      actionId: poseAnimationArguments.actionId,
      armatureId: poseAnimationArguments.armatureId,
    });
    assert.deepEqual(deliveries[4].operationParameters, {
      actionName: poseAnimationArguments.actionName,
    });
    assert.deepEqual(deliveries[6].operationParameters, {
      keyframes: poseAnimationArguments.keyframes,
    });
    assert.deepEqual(deliveries[8].operationParameters, { interpolation: 'LINEAR' });
    assert.deepEqual(deliveries[10].operationParameters, { extrapolation: 'LINEAR' });
    assert.deepEqual(deliveries[11].operationParameters, {});
    const keyframeInsertions =
      results[6]?.progress?.latestObservation?.details?.evidence?.rnaKeyframeInsertions;
    assert.equal(keyframeInsertions?.length, 27);
    assert.deepEqual(
      keyframeInsertions.map((insertion) => insertion.order),
      Array.from({ length: 27 }, (_, index) => index + 1),
    );
    assert.equal(
      keyframeInsertions.reduce((total, insertion) => total + insertion.observedPoints.length, 0),
      87,
    );
    const interpolationWrites =
      results[8]?.progress?.latestObservation?.details?.evidence?.rnaAnimationPropertyWrites;
    const extrapolationWrites =
      results[10]?.progress?.latestObservation?.details?.evidence?.rnaAnimationPropertyWrites;
    assert.equal(interpolationWrites?.length, 87);
    assert.equal(extrapolationWrites?.length, 29);
    assert.equal(
      results[3]?.progress?.latestObservation?.details?.evidence?.rnaActionResourceMutations
        ?.length,
      2,
    );
    assert.equal(
      results[4]?.progress?.latestObservation?.details?.evidence?.rnaActionResourceMutations
        ?.length,
      1,
    );
    assert.ok(results.slice(0, -1).every((entry) => entry.progress?.finalReport === null));
    assert.equal(results.at(-1)?.progress?.leafCompleted, true);
    assert.equal(results.at(-1)?.progress?.completedOperationIds?.length, 12);
    assert.ok(results.at(-1)?.progress?.finalReport);
    assert.equal(hiddenFieldsRejected, true);
    assert.equal(actionLevelExecutorRejected, true);
    assert.equal(wrongProfileRejected, true);
    assert.equal(wrongStatusRejected, true);
    assert.equal(forgedKeyframeReceiptRejected, true);
    assert.equal(forgedAnimationPropertyReceiptRejected, true);
    assert.equal(forgedActionResourceReceiptRejected, true);
    assert.equal(
      stateReports.filter(
        (report) => report.transition === 'step_succeeded' && report.stepId === poseAnimationLeafId,
      ).length,
      1,
    );
    console.log(
      `Live Pose Animation MCP E2E passed ${version}: 12 derived operations, 29 FCurves, 87 points, strong Observation, native checkpoint`,
    );
    completedSuccessfully = true;
  } catch (error) {
    persistDiagnostic('runner_failed', {
      runnerError: error instanceof Error ? (error.stack ?? error.message) : String(error),
    });
    console.error(`Pose Animation MCP E2E diagnostics preserved at ${temporaryDirectory}`);
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
