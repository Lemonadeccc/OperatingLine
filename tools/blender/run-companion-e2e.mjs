import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { startRuntime } from '@operatingline/orchestrator';

import { requireBlenderBinaries } from './blender-binaries.mjs';
import { syncBlenderExtensionResources } from './sync-extension-resources.mjs';

const accessToken = 'operatingline-companion-e2e-token-0001';
const planId = 'snowman-companion-e2e';
const planRevision = 41;
const rootTitle = 'Create a snowman through the live Companion';
const childTimeoutMs = 20_000;

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
const runtime = await startRuntime({ databasePath, accessToken });
const reportsById = new Map();
const mcpVisibleReportIds = new Set();

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
    response.writeHead(upstream.status, {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
    });
    response.end(upstreamBody);
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
  const published = await callMcpTool(runtime, 1, 'operatingline.guide.publish', fixture);
  assert.notEqual(published.result?.isError, true);

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
  });

  const result = JSON.parse(readFileSync(resultPath, 'utf8'));
  assert.deepEqual(
    {
      planId: result.planId,
      revision: result.revision,
      rootTitle: result.rootTitle,
      lastTransition: result.lastTransition,
    },
    { planId, revision: planRevision, rootTitle, lastTransition: 'step_rolled_back' },
  );
  assert.ok(result.maximumPumpSeconds < 0.15);

  const reports = [...reportsById.values()];
  const transitions = reports.map((report) => report.transition);
  assert.deepEqual(transitions, [
    'connected',
    'plan_loaded',
    'walkthrough_started',
    'step_succeeded',
    'step_rolled_back',
  ]);
  assert.deepEqual(
    reports.map((report) => report.sequence),
    [1, 2, 3, 4, 5],
  );
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
      plan: { id: planId, revision: planRevision },
      transition: 'step_rolled_back',
      activeStepId: null,
      completedStepIds: [],
    },
  );

  console.log(
    `OperatingLine live Companion E2E passed with ${reportsById.size} reports; max main-thread pump ${result.maximumPumpSeconds.toFixed(4)}s`,
  );
} finally {
  if (proxy.listening) {
    await closeServer(proxy);
  }
  await runtime.stop();
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
