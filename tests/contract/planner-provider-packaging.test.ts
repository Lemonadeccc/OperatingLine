import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { plannerProviderContractVersion } from '@operatingline/protocol';
import { describe, expect, it } from 'vitest';

interface PackageManifest {
  readonly dependencies?: Readonly<Record<string, string>>;
}

const defaultRuntimeAccessToken = 'default-runtime-isolation-token';

function manifest(path: string): PackageManifest {
  return JSON.parse(readFileSync(resolve(path), 'utf8')) as PackageManifest;
}

function waitForRuntimeEndpoint(
  child: ChildProcessWithoutNullStreams,
  stderr: { value: string },
): Promise<string> {
  return new Promise((resolveEndpoint, reject) => {
    let stdout = '';
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Default runtime did not start. stderr: ${stderr.value}`));
    }, 10_000);
    const onData = (chunk: Buffer): void => {
      stdout += chunk.toString();
      const match = /"mcpEndpoint":"([^"]+)"/.exec(stdout);
      if (match?.[1]) {
        cleanup();
        resolveEndpoint(match[1]);
      }
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      cleanup();
      reject(
        new Error(
          `Default runtime exited before ready (code ${String(code)}, signal ${String(signal)}). stderr: ${stderr.value}`,
        ),
      );
    };
    const cleanup = (): void => {
      clearTimeout(timeout);
      child.stdout.off('data', onData);
      child.off('exit', onExit);
    };
    child.stdout.on('data', onData);
    child.once('exit', onExit);
  });
}

async function stopChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  const exited = new Promise<void>((resolveExit) => {
    child.once('exit', () => resolveExit());
  });
  const forceStop = setTimeout(() => child.kill('SIGKILL'), 3_000);
  child.kill('SIGINT');
  await exited;
  clearTimeout(forceStop);
}

describe('planner provider packaging boundary', () => {
  it('keeps the core protocol, SDK, orchestrator, and default standalone vendor-free', () => {
    for (const path of [
      'packages/protocol/package.json',
      'packages/planner-provider-sdk/package.json',
      'services/orchestrator/package.json',
    ]) {
      const dependencyNames = Object.keys(manifest(path).dependencies ?? {});
      expect(dependencyNames, path).not.toContain('openai');
      expect(dependencyNames, path).not.toContain('@operatingline/openai-planner-provider');
      expect(dependencyNames, path).not.toContain('@operatingline/cli-planner-provider');
    }

    const defaultStandalone = readFileSync(
      resolve('services/orchestrator/src/standalone.ts'),
      'utf8',
    );
    expect(defaultStandalone).not.toContain('OPENAI_API_KEY');
    expect(defaultStandalone).not.toContain('openai-planner-provider');
    expect(defaultStandalone).not.toContain('cli-planner-provider');
  });

  it('contains vendor dependencies only in the provider and explicit composition root', () => {
    expect(manifest('packages/openai-planner-provider/package.json').dependencies).toMatchObject({
      '@operatingline/planner-provider-sdk': 'workspace:*',
      openai: '7.4.0',
    });
    expect(manifest('services/openai-runtime/package.json').dependencies).toMatchObject({
      '@operatingline/openai-planner-provider': 'workspace:*',
      '@operatingline/orchestrator': 'workspace:*',
    });
    expect(manifest('packages/cli-planner-provider/package.json').dependencies).toMatchObject({
      '@operatingline/planner-provider-sdk': 'workspace:*',
    });
    expect(manifest('services/cli-runtime/package.json').dependencies).toMatchObject({
      '@operatingline/cli-planner-provider': 'workspace:*',
      '@operatingline/orchestrator': 'workspace:*',
    });
  });

  it('starts the default standalone with vendor imports rejected and an empty provider registry', async () => {
    const temporaryDirectory = mkdtempSync(resolve(tmpdir(), 'operating-line-default-runtime-'));
    const stderr = { value: '' };
    const child = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        '--import',
        pathToFileURL(resolve('tests/contract/reject-openai-imports.mjs')).href,
        resolve('services/orchestrator/src/standalone.ts'),
      ],
      {
        cwd: resolve('.'),
        env: {
          ...process.env,
          OPERATINGLINE_ACCESS_TOKEN: defaultRuntimeAccessToken,
          OPERATINGLINE_DATABASE_PATH: resolve(temporaryDirectory, 'runtime.db'),
          OPERATINGLINE_PORT: '0',
          OPENAI_API_KEY: 'sk-ambient-key-must-not-be-read',
          OPENAI_BASE_URL: 'https://unexpected.invalid/v9',
          OPENAI_LOG: 'debug',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    child.stderr.on('data', (chunk: Buffer) => {
      stderr.value += chunk.toString();
    });

    try {
      const mcpEndpoint = await waitForRuntimeEndpoint(child, stderr);
      const providersEndpoint = new URL('/api/v1/planner/providers', mcpEndpoint);
      const response = await fetch(providersEndpoint, {
        headers: { authorization: `Bearer ${defaultRuntimeAccessToken}` },
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        contractVersion: plannerProviderContractVersion,
        generationAvailable: false,
        providers: [],
      });
    } finally {
      await stopChild(child);
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }, 20_000);

  it('starts the explicit CLI composition root and publishes both provider descriptors', async () => {
    const temporaryDirectory = mkdtempSync(resolve(tmpdir(), 'operating-line-cli-runtime-'));
    const stderr = { value: '' };
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', resolve('services/cli-runtime/src/index.ts')],
      {
        cwd: resolve('.'),
        env: {
          ...process.env,
          OPERATINGLINE_ACCESS_TOKEN: defaultRuntimeAccessToken,
          OPERATINGLINE_DATABASE_PATH: resolve(temporaryDirectory, 'runtime.db'),
          OPERATINGLINE_PORT: '0',
          OPERATINGLINE_CODEX_BIN: process.execPath,
          OPERATINGLINE_CLAUDE_BIN: process.execPath,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    child.stderr.on('data', (chunk: Buffer) => {
      stderr.value += chunk.toString();
    });

    try {
      const mcpEndpoint = await waitForRuntimeEndpoint(child, stderr);
      const providersEndpoint = new URL('/api/v1/planner/providers', mcpEndpoint);
      const response = await fetch(providersEndpoint, {
        headers: { authorization: `Bearer ${defaultRuntimeAccessToken}` },
      });
      expect(response.status).toBe(200);
      const providerList = (await response.json()) as {
        contractVersion: string;
        generationAvailable: boolean;
        providers: unknown[];
      };
      expect(providerList).toMatchObject({
        contractVersion: plannerProviderContractVersion,
        generationAvailable: true,
      });
      expect(providerList.providers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'codex-cli',
            availability: { available: true },
            dataHandling: {
              executionLocation: 'remote',
              dataTransmission: 'provider_managed',
              credentialManagement: 'provider_managed',
            },
          }),
          expect.objectContaining({
            id: 'claude-code-cli',
            availability: { available: true },
            dataHandling: {
              executionLocation: 'remote',
              dataTransmission: 'provider_managed',
              credentialManagement: 'provider_managed',
            },
          }),
        ]),
      );
    } finally {
      await stopChild(child);
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }, 20_000);
});
