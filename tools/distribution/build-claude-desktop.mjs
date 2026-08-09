import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { build } from 'esbuild';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const distributionRoot = join(repositoryRoot, 'distributions/claude-desktop');
const manifestPath = join(distributionRoot, 'manifest.json');
const artifactDirectory = join(repositoryRoot, 'artifacts/claude-desktop');
const artifactPath = join(artifactDirectory, 'operating-line-0.1.0.mcpb');

async function run(command, args, options = {}) {
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repositoryRoot,
      env: process.env,
      stdio: options.stdio ?? 'inherit',
    });
    child.once('error', rejectRun);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolveRun();
        return;
      }
      rejectRun(
        new Error(
          `${command} ${args.join(' ')} failed${signal === null ? ` with exit code ${String(code)}` : ` from signal ${signal}`}`,
        ),
      );
    });
  });
}

async function main() {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'operating-line-mcpb-'));
  try {
    const bundleRoot = join(temporaryRoot, 'bundle');
    const serverDirectory = join(bundleRoot, 'server');
    const thirdPartyLicenseDirectory = join(bundleRoot, 'THIRD_PARTY_LICENSES');
    const temporaryArtifact = join(temporaryRoot, 'operating-line-0.1.0.mcpb');
    await mkdir(serverDirectory, { recursive: true });
    await mkdir(thirdPartyLicenseDirectory, { recursive: true });
    await copyFile(manifestPath, join(bundleRoot, 'manifest.json'));
    await copyFile(join(distributionRoot, '.mcpbignore'), join(bundleRoot, '.mcpbignore'));
    await copyFile(join(repositoryRoot, 'LICENSE'), join(bundleRoot, 'LICENSE'));
    await copyFile(
      join(repositoryRoot, 'THIRD_PARTY_NOTICES.md'),
      join(bundleRoot, 'THIRD_PARTY_NOTICES.md'),
    );
    await copyFile(
      join(repositoryRoot, 'node_modules/@modelcontextprotocol/client/LICENSE'),
      join(thirdPartyLicenseDirectory, 'MODEL_CONTEXT_PROTOCOL_SDK_LICENSE.txt'),
    );

    await build({
      entryPoints: [join(repositoryRoot, 'packages/mcp-stdio-bridge/src/cli.ts')],
      outfile: join(serverDirectory, 'index.mjs'),
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node20',
      sourcemap: false,
      legalComments: 'eof',
      banner: { js: '#!/usr/bin/env node' },
    });

    await run('pnpm', ['exec', 'mcpb', 'validate', join(bundleRoot, 'manifest.json')]);
    await run('pnpm', ['exec', 'mcpb', 'pack', bundleRoot, temporaryArtifact]);

    await mkdir(artifactDirectory, { recursive: true });
    const stagedArtifact = `${artifactPath}.tmp`;
    await copyFile(temporaryArtifact, stagedArtifact);
    await rename(stagedArtifact, artifactPath);
    const bytes = await readFile(artifactPath);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    process.stdout.write(`created: ${artifactPath}\nsha256: ${sha256}\n`);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
