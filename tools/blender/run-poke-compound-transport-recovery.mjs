import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  blenderActionCatalog,
  blenderActionCatalogs,
  blenderInteractionCatalogs,
} from '@operatingline/blender-action-catalog';
import { companionPokeCompoundResultSchema } from '@operatingline/protocol';
import { startRuntime } from '@operatingline/orchestrator';

import { createPokeCompoundTransportFixture } from '../../tests/support/poke-compound-fixture.ts';
import { requireBlenderBinaries } from './blender-binaries.mjs';
import { syncBlenderExtensionResources } from './sync-extension-resources.mjs';

const accessToken = 'operatingline-poke-compound-transport-token';
const fixturePath = resolve('tests/e2e/blender/poke_compound_transport_recovery.py');
const childTimeoutMs = 120_000;

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
        '1200',
        '800',
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
          `Blender Poke transport E2E failed (code=${String(code)}, signal=${String(signal)})\n${stdout}\n${stderr}`,
        ),
      );
    });
  });
}

async function runOne(blender) {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'operatingline-poke-transport-'));
  const resultPath = join(temporaryDirectory, 'result.json');
  const databasePath = join(temporaryDirectory, 'events.db');
  let fixture = null;
  let delivery = null;
  let runtime = null;
  let runtimeRestarted = false;
  let resultConnectionDropped = false;
  let normalDeliveryCount = 0;
  let normalResultForwardCount = 0;
  let recoveryAckCount = 0;
  let restartPromise = null;
  const runtimeOptions = {
    databasePath,
    accessToken,
    actionCatalogs: blenderActionCatalogs,
    interactionCatalogs: blenderInteractionCatalogs,
    pokeCompoundProofTransport: {
      resolveRequest(session) {
        fixture ??= createPokeCompoundTransportFixture({
          instanceId: session.hello.instanceId,
          blenderSessionUid: session.hello.sessionId,
        });
        return fixture.request;
      },
    },
  };
  runtime = await startRuntime(runtimeOptions);

  const restartRuntime = () => {
    restartPromise ??= (async () => {
      const previous = runtime;
      runtime = null;
      await previous.stop();
      runtime = await startRuntime(runtimeOptions);
      runtimeRestarted = true;
    })();
    return restartPromise;
  };

  const proxy = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (request.method === 'GET' && requestUrl.pathname === '/probe/state') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            runtimeRestarted,
            resultConnectionDropped,
            normalDeliveryCount,
            normalResultForwardCount,
            recoveryAckCount,
          }),
        );
        return;
      }
      if (request.method === 'GET' && requestUrl.pathname === '/probe/terminal') {
        if (
          fixture === null ||
          delivery === null ||
          requestUrl.searchParams.get('deliveryId') !== delivery.deliveryId
        ) {
          response.writeHead(409, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ error: 'terminal_fixture_unavailable' }));
          return;
        }
        const result = companionPokeCompoundResultSchema.parse({
          formatVersion: '1.0.0',
          requestId: delivery.requestId,
          deliveryId: delivery.deliveryId,
          deliveryContentSha256: delivery.deliveryContentSha256,
          target: delivery.target,
          replayId: delivery.replayId,
          compoundId: delivery.compoundId,
          compoundContentSha256: delivery.compoundContentSha256,
          historyLockTokenSha256: delivery.historyLockTokenSha256,
          status: 'succeeded',
          replay: fixture.terminalReplay,
          terminalEvidence: fixture.terminalEvidence,
          observedCurrentState: null,
          error: null,
          occurredAt: new Date().toISOString(),
        });
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ result }));
        return;
      }

      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      if (
        request.method === 'POST' &&
        requestUrl.pathname === '/api/v1/companion/poke-compound-result'
      ) {
        resultConnectionDropped = true;
        request.socket.destroy();
        void restartRuntime();
        return;
      }
      const activeRuntime = runtime;
      if (activeRuntime === null) {
        response.writeHead(503, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'runtime_restarting' }));
        return;
      }
      const leaseHeader = request.headers['x-operatingline-companion-lease'];
      const upstream = await fetch(new URL(request.url ?? '/', activeRuntime.baseUrl), {
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
      if (
        request.method === 'GET' &&
        requestUrl.pathname === '/api/v1/companion/poke-compound' &&
        parsedUpstream?.request
      ) {
        delivery = parsedUpstream.request;
        normalDeliveryCount += 1;
      }
      if (
        request.method === 'POST' &&
        requestUrl.pathname === '/api/v1/companion/poke-compound-result'
      ) {
        normalResultForwardCount += 1;
      }
      if (
        request.method === 'POST' &&
        requestUrl.pathname === '/api/v1/companion/poke-compound-recovery' &&
        upstream.ok
      ) {
        recoveryAckCount += 1;
      }
      response.writeHead(upstream.status, {
        'content-type': upstream.headers.get('content-type') ?? 'application/json',
      });
      response.end(upstreamBody);
    } catch (error) {
      if (!response.headersSent) {
        response.writeHead(500, { 'content-type': 'application/json' });
      }
      response.end(JSON.stringify({ error: String(error) }));
    }
  });

  try {
    const address = await listen(proxy);
    await runBlender(blender, {
      OPERATINGLINE_POKE_TRANSPORT_RESULT: resultPath,
      OPERATINGLINE_POKE_TRANSPORT_RUNTIME_URL: `http://127.0.0.1:${address.port}`,
      OPERATINGLINE_POKE_TRANSPORT_ACCESS_TOKEN: accessToken,
    });
    await restartPromise;
    const evidence = JSON.parse(readFileSync(resultPath, 'utf8'));
    assert.equal(evidence.ok, true, JSON.stringify(evidence));
    assert.equal(evidence.checks?.automaticReplayForbidden, true);
    assert.equal(evidence.checks?.normalResultNeverCommitted, true);
    assert.equal(evidence.checks?.recoveryAckCommitted, true);
    assert.equal(normalDeliveryCount, 1);
    assert.equal(normalResultForwardCount, 0);
    assert.equal(recoveryAckCount, 1);
    console.log(
      `POKE_COMPOUND_TRANSPORT_RECOVERY_PASS ${JSON.stringify({ blender, blenderVersion: evidence.blenderVersion, checks: evidence.checks })}`,
    );
  } finally {
    await restartPromise?.catch(() => undefined);
    if (runtime !== null) await runtime.stop().catch(() => undefined);
    await closeServer(proxy).catch(() => undefined);
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

syncBlenderExtensionResources();
assert.ok(blenderActionCatalog.catalogVersion.length > 0);
for (const blender of requireBlenderBinaries()) {
  await runOne(blender);
}
