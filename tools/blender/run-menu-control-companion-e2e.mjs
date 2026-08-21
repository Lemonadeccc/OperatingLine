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

const accessToken = 'operatingline-menu-companion-e2e-token';
const childTimeoutMs = 120_000;
const fixturePath = resolve('tests/e2e/blender/menu_control_companion_round_trip.py');
const headers = {
  authorization: `Bearer ${accessToken}`,
  'content-type': 'application/json',
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

function menuControlCandidate(packet) {
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
  const leaf = tree.nodes.find((node) => node.id === 'snowman.head.eyes.left');
  assert.ok(leaf, 'Expected the tutorial eye leaf');
  leaf.action = {
    adapterId: 'blender',
    name: 'blender.mesh.create_uv_sphere',
    arguments: {
      resourceId: 'proof.uv_sphere.eye',
      objectName: 'OperatingLine.TutorialEye',
      radius: 1.5,
      location: [1.25, -2, 0.75],
    },
  };
  const retainedIds = new Set([leaf.id]);
  let parentId = leaf.parentId;
  while (typeof parentId === 'string') {
    retainedIds.add(parentId);
    parentId = tree.nodes.find((node) => node.id === parentId)?.parentId;
  }
  tree.nodes = tree.nodes.filter((node) => retainedIds.has(node.id));
  return tree;
}

async function propose(runtime, targetInstanceId) {
  const promptResponse = await fetch(`${runtime.baseUrl}/api/v1/procedure/prompt`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      targetAdapterId: 'blender',
      actionCatalogVersion: blenderActionCatalog.catalogVersion,
      interactionCatalogVersion: blenderInteractionCatalog.catalogVersion,
      goal: 'Create the exact tutorial eye UV sphere through native menu controls.',
      treeId: `menu-control-companion-${randomUUID()}`,
      revision: 1,
      locale: 'en',
    }),
  });
  const promptBody = await promptResponse.text();
  assert.equal(promptResponse.status, 200, promptBody);
  const packet = JSON.parse(promptBody);
  const replayId = randomUUID();
  const proposed = await callMcpTool(
    runtime,
    1,
    'operatingline.procedure.menu-control-proof.propose',
    {
      formatVersion: '1.0.0',
      replayId,
      targetInstanceId,
      leafId: 'snowman.head.eyes.left',
      replayMode: 'native_menu_control_proof',
      packet,
      tree: menuControlCandidate(packet),
    },
  );
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
          `Blender menu Companion E2E failed (code=${String(code)}, signal=${String(signal)})\n${stdout}\n${stderr}`,
        ),
      );
    });
  });
}

async function runOne(blender) {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'operatingline-menu-companion-'));
  const resultPath = join(temporaryDirectory, 'result.json');
  const databasePath = join(temporaryDirectory, 'events.db');
  let runtime = await startRuntime({
    databasePath,
    accessToken,
    actionCatalogs: blenderActionCatalogs,
    interactionCatalogs: blenderInteractionCatalogs,
  });
  let replayId;
  let executionRequestId;
  let preparePromise;
  let executePromise;
  let restartPromise;
  let originalTerminalAccepted = false;
  let terminalResult;
  const sessions = [];
  const progress = [];
  const ordinaryDeliveries = [];
  const reconciliationDeliveries = [];
  const recoveryAcks = [];

  const proxy = createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      if (restartPromise) await restartPromise;
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
      const parsedBody = body.length > 0 ? JSON.parse(body.toString('utf8')) : undefined;
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
        assert.equal(upstream.ok, true, upstreamBody.toString('utf8'));
        if (parsedBody.transition === 'walkthrough_started' && !executePromise) {
          executePromise = (async () => {
            await preparePromise;
            executionRequestId = randomUUID();
            const queued = await callMcpTool(
              runtime,
              2,
              'operatingline.blender.menu-control-proof.execute',
              {
                formatVersion: '1.0.0',
                requestId: executionRequestId,
                replayId,
                expectedState: {
                  reportId: parsedBody.reportId,
                  sequence: parsedBody.sequence,
                },
              },
            );
            assert.notEqual(queued.result?.isError, true, queued.result?.content?.[0]?.text);
          })();
        }
      }
      if (
        request.method === 'GET' &&
        request.url?.startsWith('/api/v1/companion/menu-control-proof') &&
        parsedUpstream?.request
      ) {
        if (parsedUpstream.request.kind === 'native_terminal_reconcile') {
          reconciliationDeliveries.push(parsedUpstream.request);
        } else {
          ordinaryDeliveries.push(parsedUpstream.request);
        }
      }
      if (
        request.method === 'POST' &&
        request.url === '/api/v1/companion/menu-control-proof-progress'
      ) {
        assert.equal(upstream.ok, true, upstreamBody.toString('utf8'));
        progress.push(parsedBody);
      }
      if (
        request.method === 'POST' &&
        request.url === '/api/v1/companion/menu-control-proof-recovery'
      ) {
        assert.equal(upstream.ok, true, upstreamBody.toString('utf8'));
        recoveryAcks.push(parsedBody);
      }
      if (
        request.method === 'POST' &&
        request.url === '/api/v1/companion/menu-control-proof-result' &&
        !originalTerminalAccepted
      ) {
        assert.equal(upstream.ok, true, upstreamBody.toString('utf8'));
        originalTerminalAccepted = true;
        terminalResult = parsedBody;
        if (parsedBody.status !== 'succeeded') {
          response.writeHead(upstream.status, {
            'content-type': upstream.headers.get('content-type') ?? 'application/json',
          });
          response.end(upstreamBody);
          return;
        }
        response.writeHead(503, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'injected_terminal_ack_loss' }));
        restartPromise = (async () => {
          await runtime.stop();
          runtime = await startRuntime({
            databasePath,
            accessToken,
            actionCatalogs: blenderActionCatalogs,
            interactionCatalogs: blenderInteractionCatalogs,
          });
        })().finally(() => {
          restartPromise = undefined;
        });
        return;
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
    console.log(`Testing live menu-control Companion with ${versionResult}`);
    await runBlender(blender, {
      OPERATINGLINE_MENU_COMPANION_RUNTIME_URL: proxyUrl,
      OPERATINGLINE_MENU_COMPANION_ACCESS_TOKEN: accessToken,
      OPERATINGLINE_MENU_COMPANION_RESULT: resultPath,
      OPERATINGLINE_MENU_COMPANION_TIMEOUT: '100',
    });
    await preparePromise;
    await executePromise;
    if (restartPromise) await restartPromise;
    const result = JSON.parse(readFileSync(resultPath, 'utf8'));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.driverStartCount, 1);
    assert.equal(result.nativeHistoryCursor, 8);
    assert.deepEqual(result.objectLocation, [1.25, -2, 0.75]);
    assert.deepEqual(result.objectScale, [1.5, 1.5, 1.5]);
    assert.equal(ordinaryDeliveries.length, 1, 'Native input delivery must not replay');
    assert.equal(progress.length, 7, 'Expected seven logical progress receipts');
    assert.deepEqual(
      progress.map((item) => item.completedOperationIds.length),
      [1, 2, 3, 4, 5, 6, 7],
    );
    assert.equal(terminalResult.status, 'succeeded');
    assert.equal(terminalResult.terminalEvidence.kind, 'succeeded_locked');
    assert.ok(sessions.length >= 2, 'Runtime restart must establish a replacement lease');
    assert.notEqual(sessions[0].lease.leaseId, sessions.at(-1).lease.leaseId);
    assert.ok(reconciliationDeliveries.length >= 1, 'Expected native terminal reconciliation');
    assert.equal(recoveryAcks.length, 1);
    assert.equal(recoveryAcks[0].result.requestId, executionRequestId);
    assert.equal(recoveryAcks[0].terminalResultContentSha256, result.terminalResultContentSha256);
    assert.equal(recoveryAcks[0].expectedMarkerContentSha256, result.terminalMarkerContentSha256);
    console.log(
      `Live menu-control Companion E2E passed ${versionResult}: 7 progress receipts, one native input delivery, ${sessions.length} leases, terminal marker reconciliation without replay`,
    );
  } finally {
    if (proxy.listening) await closeServer(proxy);
    if (restartPromise) await restartPromise;
    await runtime.stop();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

syncBlenderExtensionResources();
for (const blender of requireBlenderBinaries()) await runOne(blender);
