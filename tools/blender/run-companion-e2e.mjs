import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { startRuntime } from '@operatingline/orchestrator';
import { blenderActionCatalogs } from '@operatingline/blender-action-catalog';

import { requireBlenderBinaries } from './blender-binaries.mjs';
import { syncBlenderExtensionResources } from './sync-extension-resources.mjs';

const accessToken = 'operatingline-companion-e2e-token-0001';
const planId = 'snowman-companion-e2e';
const planRevision = 41;
const rootTitle = 'Create a snowman through the live Companion';
const revisedRootTitle = 'Create a snowman with a larger reviewed head';
const twiceRevisedRootTitle = 'Create a fully reviewed snowman with a larger head';
const childTimeoutMs = 60_000;

function fullSnowmanCapabilityCoverage() {
  return {
    policyVersion: 'catalog_capability_coverage_v1',
    requirements: [
      {
        requirementId: 'ground',
        statement: 'Create a ground plane for the snowman.',
        coverage: [{ capabilityId: 'geometry.ground_plane', stepIds: ['snowman.scene.ground'] }],
      },
      {
        requirementId: 'model',
        statement: 'Assemble the complete snowman from supported primitives.',
        coverage: [
          {
            capabilityId: 'geometry.primitive_assembly',
            stepIds: [
              'snowman.model.body_lower',
              'snowman.model.body_upper',
              'snowman.model.head',
              'snowman.details.face',
              'snowman.details.buttons',
              'snowman.details.arms',
            ],
          },
        ],
      },
      {
        requirementId: 'appearance',
        statement: 'Apply the snowman material palette.',
        coverage: [
          {
            capabilityId: 'appearance.principled_palette',
            stepIds: [
              'snowman.materials.snow',
              'snowman.materials.accessories',
              'snowman.materials.ground',
            ],
          },
        ],
      },
      {
        requirementId: 'rig',
        statement: 'Create the rigid snowman armature.',
        coverage: [
          { capabilityId: 'animation.rigid_armature', stepIds: ['snowman.animation.rig'] },
        ],
      },
      {
        requirementId: 'motion',
        statement: 'Create the requested snowman pose keyframes.',
        coverage: [
          {
            capabilityId: 'animation.rigid_pose_keyframes',
            stepIds: ['snowman.animation.pose'],
          },
        ],
      },
      {
        requirementId: 'render-setup',
        statement: 'Prepare the isolated render scene, lighting, and camera.',
        coverage: [
          {
            capabilityId: 'render.scene_setup',
            stepIds: ['snowman.lighting.scene', 'snowman.lighting.rig'],
          },
        ],
      },
      {
        requirementId: 'preview',
        statement: 'Render the snowman preview as a PNG artifact.',
        coverage: [{ capabilityId: 'output.png_preview', stepIds: ['snowman.render.preview'] }],
      },
    ],
  };
}

function headRevisionCapabilityCoverage(message) {
  return {
    policyVersion: 'catalog_capability_coverage_v1',
    requirements: [
      {
        requirementId: 'head-revision',
        statement: message,
        coverage: [
          {
            capabilityId: 'geometry.primitive_assembly',
            stepIds: ['snowman.model.head'],
          },
        ],
      },
    ],
  };
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

async function callMcpTool(runtime, id, name, argumentsValue) {
  const response = await fetch(runtime.mcpEndpoint, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
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

async function runBlender(blender, script, environment) {
  const args = [
    '--background',
    '--factory-startup',
    '--online-mode',
    '--python-exit-code',
    '1',
    '--python',
    script,
  ];
  await new Promise((resolveChild, reject) => {
    const child = spawn(blender, args, {
      env: { ...process.env, ...environment, PYTHONDONTWRITEBYTECODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
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
      if (code === 0) {
        resolveChild();
        return;
      }
      reject(
        new Error(
          `Blender companion E2E failed (code=${String(code)}, signal=${String(signal)})\n${stdout}\n${stderr}`,
        ),
      );
    });
  });
}

syncBlenderExtensionResources();
const [blender] = requireBlenderBinaries();
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'operatingline-companion-e2e-'));
const resultPath = join(temporaryDirectory, 'result.json');
const databasePath = join(temporaryDirectory, 'events.db');
const runtime = await startRuntime({
  databasePath,
  accessToken,
  actionCatalogs: blenderActionCatalogs,
});
const reportsById = new Map();
const mcpVisibleReportIds = new Set();
const proposalDecisions = [];
const revisionRequests = [];
const replanResults = [];
let replanWork = Promise.resolve();

const proxy = createServer(async (request, response) => {
  try {
    const chunks = [];
    for await (const chunk of request) {
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);
    if (request.method === 'GET' && request.url?.startsWith('/api/v1/companion/guide')) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 400));
    }
    const upstream = await fetch(new URL(request.url ?? '/', runtime.baseUrl), {
      method: request.method,
      headers: {
        accept: 'application/json',
        authorization: request.headers.authorization ?? '',
        ...(body.length > 0 ? { 'content-type': 'application/json' } : {}),
      },
      body: body.length > 0 ? body : undefined,
    });
    const upstreamBody = Buffer.from(await upstream.arrayBuffer());
    if (request.method === 'POST' && request.url === '/api/v1/companion/state') {
      const report = JSON.parse(body.toString('utf8'));
      reportsById.set(report.reportId, report);
      const listed = await callMcpTool(
        runtime,
        1000 + reportsById.size,
        'operatingline.companions.list',
        {},
      );
      const companions = JSON.parse(listed.result?.content?.[0]?.text ?? '[]');
      if (companions.some((candidate) => candidate.reportId === report.reportId)) {
        mcpVisibleReportIds.add(report.reportId);
      }
    }
    if (request.method === 'POST' && request.url === '/api/v1/companion/proposal-decision') {
      proposalDecisions.push(JSON.parse(body.toString('utf8')));
    }
    response.writeHead(upstream.status, {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
    });
    response.end(upstreamBody);
    if (
      upstream.ok &&
      request.method === 'POST' &&
      request.url === '/api/v1/companion/revision-request'
    ) {
      const revisionRequest = JSON.parse(body.toString('utf8'));
      revisionRequests.push(revisionRequest);
      replanWork = replanWork.then(async () => {
        const pending = await callMcpTool(
          runtime,
          2000 + revisionRequests.length,
          'operatingline.replan.requests.list',
          { targetAdapterId: 'blender' },
        );
        const pendingRequests = JSON.parse(pending.result?.content?.[0]?.text ?? '{}').requests;
        assert.ok(
          pendingRequests.some((candidate) => candidate.requestId === revisionRequest.requestId),
        );
        const revisedPlan = JSON.parse(JSON.stringify(revisionRequest.basePlan));
        revisedPlan.revision += 1;
        const revisedTitle =
          revisionRequest.revisionThread.turn === 1 ? revisedRootTitle : twiceRevisedRootTitle;
        revisedPlan.title = revisedTitle;
        revisedPlan.steps.find((step) => step.id === revisedPlan.rootStepId).title = revisedTitle;
        const head = revisedPlan.steps.find((step) => step.id === 'snowman.model.head');
        head.action.arguments.radius += 0.08;
        const replanned = await callMcpTool(
          runtime,
          2100 + revisionRequests.length,
          'operatingline.replan.propose',
          {
            requestId: revisionRequest.requestId,
            catalogVersion: revisionRequest.catalogVersion,
            planning: {
              goal: revisionRequest.message,
              requiredPhaseIds: ['geometry'],
              capabilityCoverage: headRevisionCapabilityCoverage(revisionRequest.message),
            },
            plan: revisedPlan,
          },
        );
        assert.notEqual(replanned.result?.isError, true);
        replanResults.push(JSON.parse(replanned.result?.content?.[0]?.text ?? '{}'));
      });
    }
  } catch (error) {
    response.writeHead(502, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
});

try {
  const fixture = JSON.parse(
    readFileSync(resolve('protocol/fixtures/v1/snowman.plan.json'), 'utf8'),
  );
  fixture.id = planId;
  fixture.revision = planRevision;
  fixture.title = rootTitle;
  fixture.steps.find((step) => step.id === fixture.rootStepId).title = rootTitle;
  const goal = 'Create, review, revise, execute, and fully roll back a guided snowman.';
  const planning = await callMcpTool(runtime, 0, 'operatingline.planning.context', {
    targetAdapterId: 'blender',
    goal,
    planId,
  });
  assert.notEqual(
    planning.result?.isError,
    true,
    planning.result?.content?.[0]?.text ?? 'Planning context failed',
  );
  const proposed = await callMcpTool(runtime, 1, 'operatingline.guide.propose', {
    targetAdapterId: 'blender',
    catalogVersion: '1.3.0',
    planning: {
      goal,
      requiredPhaseIds: ['geometry', 'materials', 'animation', 'render_setup', 'output'],
      capabilityCoverage: fullSnowmanCapabilityCoverage(),
    },
    plan: fixture,
  });
  assert.notEqual(
    proposed.result?.isError,
    true,
    proposed.result?.content?.[0]?.text ?? 'Initial proposal failed',
  );

  const proxyAddress = await listen(proxy);
  assert.ok(proxyAddress && typeof proxyAddress !== 'string');
  const proxyUrl = `http://127.0.0.1:${proxyAddress.port}`;
  await runBlender(blender, resolve('tests/e2e/blender/companion_round_trip.py'), {
    OPERATINGLINE_E2E_RUNTIME_URL: proxyUrl,
    OPERATINGLINE_E2E_ACCESS_TOKEN: accessToken,
    OPERATINGLINE_E2E_RESULT_PATH: resultPath,
    OPERATINGLINE_E2E_PLAN_ID: planId,
    OPERATINGLINE_E2E_PLAN_REVISION: String(planRevision),
    OPERATINGLINE_E2E_ROOT_TITLE: rootTitle,
    OPERATINGLINE_E2E_REVISED_ROOT_TITLE: revisedRootTitle,
    OPERATINGLINE_E2E_TWICE_REVISED_ROOT_TITLE: twiceRevisedRootTitle,
    OPERATINGLINE_RENDER_OUTPUT_DIR: join(temporaryDirectory, 'renders'),
  });
  await replanWork;

  const result = JSON.parse(readFileSync(resultPath, 'utf8'));
  assert.deepEqual(
    {
      planId: result.planId,
      revision: result.revision,
      rootTitle: result.rootTitle,
      lastTransition: result.lastTransition,
    },
    {
      planId,
      revision: planRevision + 2,
      rootTitle: twiceRevisedRootTitle,
      lastTransition: 'step_rolled_back',
    },
  );
  assert.ok(result.maximumPumpSeconds < 0.15);
  assert.equal(result.stepCount, 15);
  assert.equal(result.proposalReviewedBeforeExecution, true);
  assert.equal(result.requestLinkedProposalReviewedBeforeExecution, true);
  assert.equal(result.planDiffReviewedBeforeExecution, true);
  assert.equal(result.revisionHistoryReviewed, true);
  assert.equal(revisionRequests.length, 2);
  assert.equal(revisionRequests[0].requestId, result.revisionRequestId);
  assert.equal(revisionRequests[1].requestId, result.secondRevisionRequestId);
  assert.equal(revisionRequests[0].catalogVersion, '1.3.0');
  assert.deepEqual(revisionRequests[0].references, [
    { nodeId: 'snowman.model.head', nodeNumber: '1.2.3' },
  ]);
  assert.deepEqual(
    revisionRequests.map((request) => request.revisionThread),
    [
      {
        threadId: result.revisionRequestId,
        turn: 1,
        parentRequestId: null,
      },
      {
        threadId: result.revisionRequestId,
        turn: 2,
        parentRequestId: result.revisionRequestId,
      },
    ],
  );
  assert.equal(replanResults.length, 2);
  assert.deepEqual(
    replanResults.map((replan) => ({
      revision: replan.revision,
      revisionRequestId: replan.revisionRequestId,
      targetInstanceId: replan.targetInstanceId,
      revisionThread: replan.revisionThread,
      diffBaseRevision: replan.planDiff.basePlan.revision,
    })),
    [
      {
        revision: planRevision + 1,
        revisionRequestId: result.revisionRequestId,
        targetInstanceId: revisionRequests[0].instanceId,
        revisionThread: revisionRequests[0].revisionThread,
        diffBaseRevision: planRevision,
      },
      {
        revision: planRevision + 2,
        revisionRequestId: result.secondRevisionRequestId,
        targetInstanceId: revisionRequests[1].instanceId,
        revisionThread: revisionRequests[1].revisionThread,
        diffBaseRevision: planRevision + 1,
      },
    ],
  );
  assert.equal(proposalDecisions.length, 3);
  assert.deepEqual(
    {
      adapterId: proposalDecisions[0].adapterId,
      decision: proposalDecisions[0].decision,
    },
    { adapterId: 'blender', decision: 'accepted' },
  );
  assert.deepEqual(
    proposalDecisions.map((decision) => decision.decision),
    ['accepted', 'accepted', 'accepted'],
  );

  const reports = [...reportsById.values()];
  const transitions = reports.map((report) => report.transition);
  assert.deepEqual(transitions, [
    'connected',
    'plan_loaded',
    'plan_loaded',
    'plan_loaded',
    'walkthrough_started',
    ...Array.from({ length: result.stepCount }, () => 'step_succeeded'),
    ...Array.from({ length: result.stepCount }, () => 'step_rolled_back'),
  ]);
  assert.deepEqual(
    reports.map((report) => report.sequence),
    Array.from({ length: reports.length }, (_unused, index) => index + 1),
  );
  for (const report of reports.filter((candidate) => candidate.transition === 'step_succeeded')) {
    assert.ok(report.observations.length > 0, `${report.stepId} returned no observations`);
    assert.ok(
      report.observations.every((observation) => observation.satisfied === true),
      `${report.stepId} returned an unsatisfied observation`,
    );
  }
  assert.equal(mcpVisibleReportIds.size, reportsById.size);

  const companionsResponse = await fetch(`${runtime.baseUrl}/api/v1/companions`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  assert.equal(companionsResponse.status, 200);
  const companions = (await companionsResponse.json()).companions;
  assert.equal(companions.length, 1);
  assert.deepEqual(
    {
      plan: companions[0].plan,
      transition: companions[0].transition,
      activeStepId: companions[0].activeStepId,
      completedStepIds: companions[0].completedStepIds,
    },
    {
      plan: { id: planId, revision: planRevision + 2 },
      transition: 'step_rolled_back',
      activeStepId: null,
      completedStepIds: [],
    },
  );

  const evalResponse = await callMcpTool(runtime, 3_000, 'operatingline.eval.export', {
    targetAdapterId: 'blender',
    planId,
    instanceId: revisionRequests[0].instanceId,
    limit: 1_000,
  });
  assert.notEqual(
    evalResponse.result?.isError,
    true,
    evalResponse.result?.content?.[0]?.text ?? 'Eval export failed',
  );
  const evalBundle = JSON.parse(evalResponse.result?.content?.[0]?.text ?? '{}');
  assert.equal(evalBundle.formatVersion, '1.1.0');
  assert.deepEqual(evalBundle.scope, {
    targetAdapterId: 'blender',
    planId,
    instanceId: revisionRequests[0].instanceId,
  });
  assert.equal(evalBundle.catalogs.length, 1);
  assert.equal(evalBundle.catalogs[0].catalogVersion, '1.3.0');
  assert.equal(evalBundle.page.hasMore, false);
  assert.equal(evalBundle.summary.matchedEventCount, 18 + 2 * result.stepCount);
  assert.deepEqual(evalBundle.summary.decisionCounts, { accepted: 3 });
  assert.equal(evalBundle.summary.transitionCounts.connected, undefined);
  assert.equal(evalBundle.summary.transitionCounts.step_succeeded, result.stepCount);
  assert.equal(evalBundle.summary.transitionCounts.step_rolled_back, result.stepCount);
  assert.ok(
    evalBundle.events.some(
      (event) =>
        event.eventType === 'planning.context.generated' && event.payload.context.goal === goal,
    ),
  );
  assert.equal(evalBundle.summary.eventTypeCounts['planning.quality.evaluated'], 3);
  assert.ok(
    evalBundle.events.some(
      (event) =>
        event.eventType === 'planning.quality.evaluated' &&
        event.payload.report.valid === true &&
        event.payload.report.baselineVersion === '1.1.0' &&
        event.payload.report.capabilityCoverage?.policyVersion ===
          'catalog_capability_coverage_v1' &&
        !Object.hasOwn(event.payload.report, 'score'),
    ),
  );
  assert.ok(
    evalBundle.events.some(
      (event) =>
        event.eventType === 'guide.revision.requested' &&
        event.payload.requestId === result.revisionRequestId,
    ),
  );
  assert.ok(
    evalBundle.events.some(
      (event) =>
        event.eventType === 'guide.revision.requested' &&
        event.payload.requestId === result.secondRevisionRequestId &&
        event.payload.revisionThread.turn === 2,
    ),
  );
  assert.ok(
    evalBundle.events.some(
      (event) =>
        event.eventType === 'guide.proposal.created' &&
        event.payload.plan.revision === planRevision + 2 &&
        event.payload.planDiff.basePlan.revision === planRevision + 1,
    ),
  );
  assert.ok(
    evalBundle.events.some(
      (event) =>
        event.eventType === 'companion.state.reported' &&
        event.payload.transition === 'step_rolled_back',
    ),
  );

  console.log(
    `OperatingLine two-turn replan/diff and Eval export E2E passed ${result.stepCount} forward/back steps with ${reportsById.size} reports and ${evalBundle.events.length} scoped events; max main-thread pump ${result.maximumPumpSeconds.toFixed(4)}s`,
  );
} finally {
  if (proxy.listening) {
    await closeServer(proxy);
  }
  await runtime.stop();
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
