import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractSignatureBlock } from '@anthropic-ai/mcpb/node';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const artifactDirectory = join(repositoryRoot, 'artifacts/claude-desktop');
const unsignedArtifact = join(artifactDirectory, 'operating-line-0.1.0.mcpb');

function parseMode(args) {
  const modeIndex = args.indexOf('--mode');
  const mode = modeIndex === -1 ? undefined : args[modeIndex + 1];
  if (args.length !== 2 || modeIndex !== 0 || !['development', 'production'].includes(mode)) {
    throw new Error('Usage: sign-claude-desktop.mjs --mode development|production');
  }
  return mode;
}

async function run(command, args, label) {
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: process.env,
      stdio: 'ignore',
    });
    child.once('error', () => rejectRun(new Error(`${label} could not start`)));
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolveRun();
        return;
      }
      rejectRun(
        new Error(
          signal === null
            ? `${label} failed with exit code ${String(code)}`
            : `${label} stopped from signal ${signal}`,
        ),
      );
    });
  });
}

async function runMcpb(args) {
  await run('pnpm', ['exec', 'mcpb', ...args], 'The MCPB signing command');
}

async function runOpenSsl(args) {
  await run('openssl', args, 'OpenSSL signature verification');
}

async function requireRegularFile(path, label) {
  let metadata;
  try {
    metadata = await stat(path);
  } catch {
    throw new Error(`${label} is required and must reference a readable regular file`);
  }
  if (!metadata.isFile()) {
    throw new Error(`${label} must reference a regular file`);
  }
  return metadata;
}

function requiredEnvironmentPath(name) {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`${name} is required for production MCPB signing`);
  }
  if (value !== value.trim() || value.includes('\0')) {
    throw new Error(`${name} must not contain surrounding whitespace or NUL`);
  }
  return resolve(value);
}

function intermediatePaths() {
  const raw = process.env.MCPB_SIGN_INTERMEDIATE_PATHS?.trim();
  if (!raw) {
    return [];
  }
  return raw.split(delimiter).map((path) => resolve(path));
}

async function productionSigningArguments() {
  const certificatePath = requiredEnvironmentPath('MCPB_SIGN_CERT_PATH');
  const privateKeyPath = requiredEnvironmentPath('MCPB_SIGN_KEY_PATH');
  const privateKeyMetadata = await requireRegularFile(privateKeyPath, 'MCPB_SIGN_KEY_PATH');
  await requireRegularFile(certificatePath, 'MCPB_SIGN_CERT_PATH');
  if (process.platform !== 'win32' && (privateKeyMetadata.mode & 0o077) !== 0) {
    throw new Error('MCPB_SIGN_KEY_PATH must not be group- or world-accessible');
  }
  const intermediates = intermediatePaths();
  for (const path of intermediates) {
    await requireRegularFile(path, 'MCPB_SIGN_INTERMEDIATE_PATHS entry');
  }
  return [
    '--cert',
    certificatePath,
    '--key',
    privateKeyPath,
    ...(intermediates.length === 0 ? [] : ['--intermediate', ...intermediates]),
  ];
}

async function developmentSigningArguments(temporaryRoot) {
  const certificatePath = join(temporaryRoot, 'development-cert.pem');
  const privateKeyPath = join(temporaryRoot, 'development-key.pem');
  await runOpenSsl([
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-sha256',
    '-nodes',
    '-keyout',
    privateKeyPath,
    '-out',
    certificatePath,
    '-days',
    '1',
    '-subj',
    '/CN=OperatingLine Development',
  ]);
  await chmod(privateKeyPath, 0o600);
  return ['--cert', certificatePath, '--key', privateKeyPath];
}

async function verifySignedArtifact(signedArtifact, expectedUnsignedArtifact, temporaryRoot, mode) {
  const signedBytes = await readFile(signedArtifact);
  const expectedUnsignedBytes = await readFile(expectedUnsignedArtifact);
  const { originalContent, pkcs7Signature } = extractSignatureBlock(signedBytes);
  if (pkcs7Signature === undefined || pkcs7Signature.length === 0) {
    throw new Error('The signed MCPB artifact does not contain an MCPB signature block');
  }
  if (!originalContent.equals(expectedUnsignedBytes)) {
    throw new Error('The MCPB signature is not bound to the expected unsigned artifact');
  }

  const contentPath = join(temporaryRoot, 'unsigned-content.mcpb');
  const signaturePath = join(temporaryRoot, 'signature.der');
  const verifiedContentPath = join(temporaryRoot, 'verified-content.mcpb');
  await writeFile(contentPath, originalContent, { mode: 0o600 });
  await writeFile(signaturePath, pkcs7Signature, { mode: 0o600 });
  await runOpenSsl([
    'cms',
    '-verify',
    '-binary',
    '-inform',
    'DER',
    '-in',
    signaturePath,
    '-content',
    contentPath,
    ...(mode === 'development' ? ['-noverify'] : ['-purpose', 'codesign']),
    '-verify_retcode',
    '-out',
    verifiedContentPath,
  ]);
  const verifiedContent = await readFile(verifiedContentPath);
  if (!verifiedContent.equals(originalContent)) {
    throw new Error('The verified MCPB content differs from the signed content');
  }
}

async function main() {
  const mode = parseMode(process.argv.slice(2));
  await requireRegularFile(unsignedArtifact, 'Unsigned MCPB artifact');
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'operating-line-mcpb-sign-'));
  try {
    const temporaryArtifact = join(temporaryRoot, 'operating-line-0.1.0.mcpb');
    await copyFile(unsignedArtifact, temporaryArtifact);
    const signArguments =
      mode === 'development'
        ? await developmentSigningArguments(temporaryRoot)
        : await productionSigningArguments();
    await runMcpb(['sign', temporaryArtifact, ...signArguments]);
    // MCPB 2.1.2's `verify` path calls node-forge's unimplemented PKCS#7 verify method.
    // OpenSSL validates the detached CMS signature and, in production mode, its trust chain.
    await verifySignedArtifact(temporaryArtifact, unsignedArtifact, temporaryRoot, mode);

    const suffix = mode === 'development' ? 'dev-signed' : 'signed';
    const outputPath = join(artifactDirectory, `operating-line-0.1.0.${suffix}.mcpb`);
    await mkdir(artifactDirectory, { recursive: true });
    const stagedArtifact = `${outputPath}.tmp`;
    await copyFile(temporaryArtifact, stagedArtifact);
    await rename(stagedArtifact, outputPath);

    const bytes = await readFile(outputPath);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    process.stdout.write(
      `created: ${outputPath}\nsha256: ${sha256}\nverification: ${mode === 'development' ? 'valid CMS signature (self-signed development certificate)' : 'valid CMS signature and trusted certificate chain'}\n`,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
