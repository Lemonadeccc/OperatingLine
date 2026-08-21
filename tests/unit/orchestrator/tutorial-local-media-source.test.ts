import { createHash, randomUUID } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  authoritySignedContent,
  canonicalizeAuthorityJson,
  canonicalizeProtocolJsonValue,
  type AuthorityValidationReceipt,
  type LocalMediaImportAuthorization,
  type MediaRightsEvidence,
  type ProcedureTutorialMediaAnalysisRequest,
} from '@operatingline/protocol';
import {
  computeTutorialLocalMediaReceiptContentSha256,
  computeTutorialLocalMediaSourceIdentitySha256,
  createTutorialLocalMediaSource,
  TutorialLocalMediaSourceError,
  type TutorialLocalMediaRegistration,
} from '../../../services/orchestrator/src/tutorial-local-media-source.js';

const roots: string[] = [];
const localStages = ['import', 'probe', 'audio', 'asr', 'frames', 'ocr', 'segmentation'] as const;
const processingStages = ['probe', 'audio', 'asr', 'frames', 'ocr', 'segmentation'] as const;

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function authorityContentSha256(
  value: LocalMediaImportAuthorization | MediaRightsEvidence,
): string {
  return sha256(canonicalizeAuthorityJson(authoritySignedContent(value)));
}

async function temporaryDirectory(label: string): Promise<string> {
  const created = await mkdtemp(join(tmpdir(), `operatingline-${label}-`));
  roots.push(created);
  return realpath(created);
}

function mp4Bytes(marker = 1): Buffer {
  return Buffer.from([
    0x00,
    0x00,
    0x00,
    0x18,
    0x66,
    0x74,
    0x79,
    0x70,
    0x69,
    0x73,
    0x6f,
    0x6d,
    0x00,
    0x00,
    0x02,
    0x00,
    0x69,
    0x73,
    0x6f,
    0x6d,
    0x69,
    0x73,
    0x6f,
    marker,
  ]);
}

function commonAuthority() {
  return {
    formatVersion: '1.0.0' as const,
    canonicalization: 'operatingline-authority-json-v1' as const,
    issuer: 'operator',
    notBefore: '2026-08-21T00:00:00.000Z',
    expiresAt: '2026-08-22T00:00:00.000Z',
    signature: {
      signerId: 'operator',
      keyId: 'key-1',
      algorithm: 'ed25519' as const,
      signature: 'A'.repeat(86),
      signedAt: '2026-08-21T00:00:00.000Z',
    },
  };
}

function validationReceipt(input: {
  authorityKind: 'LocalMediaImportAuthorization' | 'MediaRightsEvidence';
  authorityId: string;
  authorityContentSha256: string;
  targetSha256: string;
  sideEffect: 'local_media_import' | 'media_rights_validation';
}): AuthorityValidationReceipt {
  return {
    formatVersion: '1.0.0',
    receiptId: randomUUID(),
    ...input,
    signerId: 'operator',
    keyId: 'key-1',
    registryVersion: 'registry-1',
    validatedAt: '2026-08-21T01:00:00.000Z',
    revocationLogHeadSha256: sha256(canonicalizeProtocolJsonValue([])),
  };
}

interface Fixture {
  readonly mediaPath: string;
  readonly content: Buffer;
  readonly request: Extract<
    ProcedureTutorialMediaAnalysisRequest,
    { formatVersion: '1.1.0'; source: { kind: 'user_supplied_local_file' } }
  >;
  readonly registration: TutorialLocalMediaRegistration;
  readonly receipts: readonly [AuthorityValidationReceipt, AuthorityValidationReceipt];
}

async function fixture(
  root: string,
  options: {
    readonly path?: string;
    readonly content?: Buffer;
    readonly retention?: LocalMediaImportAuthorization['retention'];
  } = {},
): Promise<Fixture> {
  const content = options.content ?? mp4Bytes();
  const mediaPath = options.path ?? join(root, 'tutorial.mp4');
  if (options.path === undefined) await writeFile(mediaPath, content, { mode: 0o600 });
  const sourceIdentitySha256 = computeTutorialLocalMediaSourceIdentitySha256(mediaPath);
  const contentSha256 = sha256(content);
  const importAuthorization: LocalMediaImportAuthorization = {
    ...commonAuthority(),
    kind: 'LocalMediaImportAuthorization',
    authorityId: randomUUID(),
    source: {
      canonicalPathSha256: sourceIdentitySha256,
      contentSha256,
      byteLength: content.byteLength,
    },
    allowedProcessingStages: [...processingStages],
    retention: options.retention ?? 'private_cas_indefinite',
  };
  const rightsEvidence: MediaRightsEvidence = {
    ...commonAuthority(),
    kind: 'MediaRightsEvidence',
    authorityId: randomUUID(),
    mediaSha256: contentSha256,
    sourceIdentitySha256,
    rightsBasis: 'rights_holder_permission',
    rightsHolder: 'Tutorial owner',
    evidenceReference: 'operator-supplied-rights-record',
    allowedPurposes: ['private_analysis'],
  };
  const importReceipt = validationReceipt({
    authorityKind: 'LocalMediaImportAuthorization',
    authorityId: importAuthorization.authorityId,
    authorityContentSha256: authorityContentSha256(importAuthorization),
    targetSha256: contentSha256,
    sideEffect: 'local_media_import',
  });
  const rightsReceipt = validationReceipt({
    authorityKind: 'MediaRightsEvidence',
    authorityId: rightsEvidence.authorityId,
    authorityContentSha256: authorityContentSha256(rightsEvidence),
    targetSha256: contentSha256,
    sideEffect: 'media_rights_validation',
  });
  const source = {
    kind: 'user_supplied_local_file' as const,
    sourceIdentitySha256,
    contentSha256,
    rightsBasis: rightsEvidence.rightsBasis,
    importValidation: {
      authorityKind: 'local_import_authority' as const,
      authorityId: importAuthorization.authorityId,
      sideEffect: 'local_media_import' as const,
      receiptContentSha256: computeTutorialLocalMediaReceiptContentSha256(importReceipt),
      authorityContentSha256: importReceipt.authorityContentSha256,
    },
    rightsValidation: {
      authorityKind: 'media_rights_authority' as const,
      authorityId: rightsEvidence.authorityId,
      sideEffect: 'rights_validation' as const,
      receiptContentSha256: computeTutorialLocalMediaReceiptContentSha256(rightsReceipt),
      authorityContentSha256: rightsReceipt.authorityContentSha256,
    },
  };
  const request = {
    formatVersion: '1.1.0' as const,
    requestId: randomUUID(),
    source,
    analysisProfile: 'local_tutorial_evidence_v1' as const,
    locale: 'en-US',
    analysisWindow: { startMs: 0, endMs: 1_000 },
    requestedStages: [...localStages],
    approvals: {
      networkAccessApproved: false as const,
      mediaDownloadApproved: false as const,
      retentionApproved: true as const,
    },
  } satisfies ProcedureTutorialMediaAnalysisRequest;
  return {
    mediaPath,
    content,
    request,
    registration: {
      path: mediaPath,
      importAuthorization,
      rightsEvidence,
      importValidationReceipt: importReceipt,
      rightsValidationReceipt: rightsReceipt,
      caption: {
        origin: 'user_supplied',
        format: 'srt',
        content: '1\n00:00:00,000 --> 00:00:01,000\nCreate the eye.\n',
        locale: 'en-US',
        defaultConfidence: 0.8,
        contentSha256: sha256('1\n00:00:00,000 --> 00:00:01,000\nCreate the eye.\n'),
      },
    },
    receipts: [importReceipt, rightsReceipt],
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('tutorial local media source', () => {
  it('copies one immutable MP4 into private staging and revalidates both authorities', async () => {
    const root = await temporaryDirectory('local-source');
    const jobDirectory = await temporaryDirectory('local-job');
    const value = await fixture(root);
    const verifyLocalMediaImport = vi.fn(() => value.receipts);
    const source = createTutorialLocalMediaSource({
      registrations: [value.registration],
      authorityVerifier: { verifyLocalMediaImport },
    });

    const imported = await source.import({ request: value.request, jobDirectory });

    expect(await readFile(imported.mediaPath)).toEqual(value.content);
    expect(imported.contentSha256).toBe(value.request.source.contentSha256);
    expect(imported.sourceIdentitySha256).toBe(value.request.source.sourceIdentitySha256);
    expect(imported.caption).toEqual(value.registration.caption);
    expect(imported.historicalValidationReceipts).toEqual(value.receipts);
    expect(imported.liveValidationReceipts).toEqual(value.receipts);
    expect(verifyLocalMediaImport).toHaveBeenCalledOnce();
    expect(verifyLocalMediaImport.mock.calls[0]?.[0]).toMatchObject({
      contentSha256: value.request.source.contentSha256,
      sourceIdentitySha256: value.request.source.sourceIdentitySha256,
      importBinding: {
        byteLength: value.content.byteLength,
        processingStages,
        retention: 'private_cas_indefinite',
      },
      rightsBinding: { purpose: 'private_analysis' },
    });
    const sourceDirectoryInfo = await lstat(join(jobDirectory, 'source'));
    const stagedFileInfo = await lstat(imported.mediaPath);
    if (process.platform !== 'win32') {
      expect(sourceDirectoryInfo.mode & 0o777).toBe(0o700);
      expect(stagedFileInfo.mode & 0o777).toBe(0o600);
    }
    if (typeof process.getuid === 'function') {
      expect(sourceDirectoryInfo.uid).toBe(process.getuid());
      expect(stagedFileInfo.uid).toBe(process.getuid());
    }
  });

  it.each(['private_cas_until_expiry', 'delete_after_processing'] as const)(
    'rejects the unenforceable %s retention lifecycle before staging or authority consumption',
    async (retention) => {
      const root = await temporaryDirectory(`local-retention-${retention}`);
      const jobDirectory = await temporaryDirectory('local-job');
      const value = await fixture(root, { retention });
      const verifyLocalMediaImport = vi.fn(() => value.receipts);
      const source = createTutorialLocalMediaSource({
        registrations: [value.registration],
        authorityVerifier: { verifyLocalMediaImport },
      });

      await expect(source.import({ request: value.request, jobDirectory })).rejects.toMatchObject({
        code: 'unsupported_retention',
      });
      expect(verifyLocalMediaImport).not.toHaveBeenCalled();
      await expect(lstat(join(jobDirectory, 'source'))).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );

  it('rejects a wrong owner policy and world-writable source before reading bytes', async () => {
    const root = await temporaryDirectory('local-ownership');
    const wrongOwner = await fixture(root);
    const verifier = vi.fn(() => wrongOwner.receipts);
    const actualUid = typeof process.getuid === 'function' ? process.getuid() : 0;
    const wrongOwnerSource = createTutorialLocalMediaSource({
      registrations: [wrongOwner.registration],
      authorityVerifier: { verifyLocalMediaImport: verifier },
      expectedOwnerUid: actualUid + 1,
    });
    await expect(
      wrongOwnerSource.import({
        request: wrongOwner.request,
        jobDirectory: await temporaryDirectory('local-job'),
      }),
    ).rejects.toMatchObject({ code: 'unsafe_source' });

    if (process.platform !== 'win32') {
      const writableRoot = await temporaryDirectory('local-permissions');
      const worldWritable = await fixture(writableRoot);
      await chmod(worldWritable.mediaPath, 0o622);
      const worldWritableSource = createTutorialLocalMediaSource({
        registrations: [worldWritable.registration],
        authorityVerifier: { verifyLocalMediaImport: verifier },
      });
      await expect(
        worldWritableSource.import({
          request: worldWritable.request,
          jobDirectory: await temporaryDirectory('local-job'),
        }),
      ).rejects.toMatchObject({ code: 'unsafe_source' });
    }
    expect(verifier).not.toHaveBeenCalled();
  });

  it('rejects any symlinked source path before reading or authority consumption', async () => {
    const root = await temporaryDirectory('local-symlink');
    const target = join(root, 'target.mp4');
    const linked = join(root, 'linked.mp4');
    const content = mp4Bytes();
    await writeFile(target, content, { mode: 0o600 });
    await symlink(target, linked);
    const value = await fixture(root, { path: linked, content });
    const verifyLocalMediaImport = vi.fn(() => value.receipts);
    const source = createTutorialLocalMediaSource({
      registrations: [value.registration],
      authorityVerifier: { verifyLocalMediaImport },
    });

    await expect(
      source.import({
        request: value.request,
        jobDirectory: await temporaryDirectory('local-job'),
      }),
    ).rejects.toMatchObject({ code: 'unsafe_source' });
    expect(verifyLocalMediaImport).not.toHaveBeenCalled();
  });

  it('rejects directories, oversized files, and unsupported media before authority consumption', async () => {
    const root = await temporaryDirectory('local-invalid');
    const verifyLocalMediaImport = vi.fn();

    const directoryValue = await fixture(root, { path: root, content: mp4Bytes() });
    const directorySource = createTutorialLocalMediaSource({
      registrations: [directoryValue.registration],
      authorityVerifier: { verifyLocalMediaImport },
    });
    await expect(
      directorySource.import({
        request: directoryValue.request,
        jobDirectory: await temporaryDirectory('local-job'),
      }),
    ).rejects.toMatchObject({ code: 'unsafe_source' });

    const oversizedValue = await fixture(root, {
      path: join(root, 'oversized.mp4'),
      content: mp4Bytes(),
    });
    await writeFile(oversizedValue.mediaPath, oversizedValue.content, { mode: 0o600 });
    const oversizedSource = createTutorialLocalMediaSource({
      registrations: [oversizedValue.registration],
      authorityVerifier: { verifyLocalMediaImport },
      maximumImportBytes: oversizedValue.content.byteLength - 1,
    });
    await expect(
      oversizedSource.import({
        request: oversizedValue.request,
        jobDirectory: await temporaryDirectory('local-job'),
      }),
    ).rejects.toMatchObject({ code: 'source_too_large' });

    const unsupportedValue = await fixture(root, {
      path: join(root, 'unsupported.mp4'),
      content: Buffer.from('not-an-mp4'),
    });
    await writeFile(unsupportedValue.mediaPath, unsupportedValue.content, { mode: 0o600 });
    const unsupportedSource = createTutorialLocalMediaSource({
      registrations: [unsupportedValue.registration],
      authorityVerifier: { verifyLocalMediaImport },
    });
    await expect(
      unsupportedSource.import({
        request: unsupportedValue.request,
        jobDirectory: await temporaryDirectory('local-job'),
      }),
    ).rejects.toMatchObject({ code: 'unsupported_media' });
    expect(verifyLocalMediaImport).not.toHaveBeenCalled();
  });

  it('removes staged bytes when the registered path changes during live authority verification', async () => {
    const root = await temporaryDirectory('local-drift');
    const jobDirectory = await temporaryDirectory('local-job');
    const value = await fixture(root);
    const replacement = join(root, 'replacement.mp4');
    const verifyLocalMediaImport = vi.fn(() => {
      writeFileSync(replacement, mp4Bytes(2), { mode: 0o600 });
      renameSync(replacement, value.mediaPath);
      return value.receipts;
    });
    const source = createTutorialLocalMediaSource({
      registrations: [value.registration],
      authorityVerifier: { verifyLocalMediaImport },
    });

    await expect(source.import({ request: value.request, jobDirectory })).rejects.toMatchObject({
      code: 'content_changed',
    });
    await expect(readFile(join(jobDirectory, 'source', 'media.mp4'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('rejects missing registrations and substituted historical receipts', async () => {
    const root = await temporaryDirectory('local-authority');
    const value = await fixture(root);
    const verifier = { verifyLocalMediaImport: vi.fn(() => value.receipts) };
    const emptySource = createTutorialLocalMediaSource({
      registrations: [],
      authorityVerifier: verifier,
    });
    await expect(
      emptySource.import({
        request: value.request,
        jobDirectory: await temporaryDirectory('local-job'),
      }),
    ).rejects.toMatchObject({ code: 'source_not_registered' });

    const substituted = structuredClone(value.request);
    substituted.source.rightsValidation.receiptContentSha256 = 'f'.repeat(64);
    const source = createTutorialLocalMediaSource({
      registrations: [value.registration],
      authorityVerifier: verifier,
    });
    await expect(
      source.import({
        request: substituted,
        jobDirectory: await temporaryDirectory('local-job'),
      }),
    ).rejects.toMatchObject({ code: 'authorization_required' });
    expect(verifier.verifyLocalMediaImport).not.toHaveBeenCalled();
  });

  it('rejects a caption whose declared hash does not match its exact UTF-8 bytes', async () => {
    const root = await temporaryDirectory('local-caption');
    const value = await fixture(root);
    const registration = structuredClone(value.registration);
    registration.caption!.contentSha256 = 'f'.repeat(64);

    expect(() =>
      createTutorialLocalMediaSource({
        registrations: [registration],
        authorityVerifier: { verifyLocalMediaImport: () => value.receipts },
      }),
    ).toThrowError(TutorialLocalMediaSourceError);
    expect(() =>
      createTutorialLocalMediaSource({
        registrations: [registration],
        authorityVerifier: { verifyLocalMediaImport: () => value.receipts },
      }),
    ).toThrow(expect.objectContaining({ code: 'caption_hash_mismatch' }));
  });
});
