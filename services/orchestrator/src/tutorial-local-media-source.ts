import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, rm, type FileHandle } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

import {
  authoritySignedContent,
  authorityValidationReceiptSchema,
  canonicalizeAuthorityJson,
  canonicalizeProtocolJsonValue,
  localMediaImportAuthorizationSchema,
  mediaRightsEvidenceSchema,
  procedureTutorialMediaAnalysisStartRequestSchema,
  procedureTutorialTranscriptDocumentMaxBytes,
  type AuthorityValidationReceipt,
  type LocalMediaImportAuthorization,
  type MediaRightsEvidence,
  type ProcedureTutorialMediaAnalysisRequest,
} from '@operatingline/protocol';
import { z } from 'zod';

import type {
  LocalMediaImportSideEffectBinding,
  MediaRightsSideEffectBinding,
} from './authority-verifier.js';

const defaultMaximumImportBytes = 8 * 1_024 * 1_024 * 1_024;
const copyChunkBytes = 1 * 1_024 * 1_024;
const sha256Pattern = /^[a-f0-9]{64}$/u;

type LocalAnalysisRequest = Extract<
  ProcedureTutorialMediaAnalysisRequest,
  {
    readonly formatVersion: '1.1.0';
    readonly source: { readonly kind: 'user_supplied_local_file' };
  }
>;

const tutorialLocalCaptionInputSchema = z.strictObject({
  origin: z.literal('user_supplied'),
  format: z.enum(['webvtt', 'srt']),
  content: z.string().min(1).max(procedureTutorialTranscriptDocumentMaxBytes).regex(/\S/u),
  locale: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/u),
  defaultConfidence: z.number().min(0).max(1),
  contentSha256: z.string().regex(sha256Pattern),
});

export type TutorialLocalCaptionInput = z.infer<typeof tutorialLocalCaptionInputSchema>;

export interface TutorialLocalMediaRegistration {
  readonly path: string;
  readonly importAuthorization: LocalMediaImportAuthorization;
  readonly rightsEvidence: MediaRightsEvidence;
  readonly importValidationReceipt: AuthorityValidationReceipt;
  readonly rightsValidationReceipt: AuthorityValidationReceipt;
  readonly caption?: TutorialLocalCaptionInput | undefined;
}

export interface TutorialLocalMediaAuthorityVerifier {
  verifyLocalMediaImport(input: {
    readonly importAuthorization: LocalMediaImportAuthorization;
    readonly rightsEvidence: MediaRightsEvidence;
    readonly contentSha256: string;
    readonly sourceIdentitySha256: string;
    readonly importBinding: LocalMediaImportSideEffectBinding;
    readonly rightsBinding: MediaRightsSideEffectBinding;
  }): readonly [AuthorityValidationReceipt, AuthorityValidationReceipt];
}

export interface TutorialLocalMediaImport {
  readonly mediaPath: string;
  readonly contentSha256: string;
  readonly sourceIdentitySha256: string;
  readonly byteLength: number;
  readonly historicalValidationReceipts: readonly [
    AuthorityValidationReceipt,
    AuthorityValidationReceipt,
  ];
  readonly liveValidationReceipts: readonly [
    AuthorityValidationReceipt,
    AuthorityValidationReceipt,
  ];
  readonly caption: TutorialLocalCaptionInput | null;
}

export interface TutorialLocalMediaSource {
  import(input: {
    readonly request: LocalAnalysisRequest;
    readonly jobDirectory: string;
    readonly signal?: AbortSignal | undefined;
  }): Promise<TutorialLocalMediaImport>;
}

export interface TutorialLocalMediaSourceOptions {
  readonly registrations: readonly TutorialLocalMediaRegistration[];
  readonly authorityVerifier: TutorialLocalMediaAuthorityVerifier;
  readonly maximumImportBytes?: number | undefined;
  readonly expectedOwnerUid?: number | undefined;
}

export type TutorialLocalMediaSourceErrorCode =
  | 'invalid_input'
  | 'source_not_registered'
  | 'unsafe_source'
  | 'source_too_large'
  | 'unsupported_media'
  | 'content_changed'
  | 'authorization_required'
  | 'unsupported_retention'
  | 'caption_hash_mismatch'
  | 'aborted'
  | 'import_failed';

export class TutorialLocalMediaSourceError extends Error {
  constructor(
    readonly code: TutorialLocalMediaSourceErrorCode,
    options?: ErrorOptions,
  ) {
    super(
      code === 'invalid_input'
        ? 'The local tutorial media import input is invalid.'
        : code === 'source_not_registered'
          ? 'The local tutorial media source is not registered.'
          : code === 'unsafe_source'
            ? 'The local tutorial media source or staging path is unsafe.'
            : code === 'source_too_large'
              ? 'The local tutorial media source exceeds its configured byte limit.'
              : code === 'unsupported_media'
                ? 'The local tutorial media source is not a supported MP4 file.'
                : code === 'content_changed'
                  ? 'The local tutorial media source changed during import.'
                  : code === 'authorization_required'
                    ? 'Matching local import and media-rights authority is required.'
                    : code === 'unsupported_retention'
                      ? 'The authorized local media retention lifecycle is not enforceable by this runtime.'
                      : code === 'caption_hash_mismatch'
                        ? 'The user-supplied caption content does not match its declared hash.'
                        : code === 'aborted'
                          ? 'The local tutorial media import was aborted.'
                          : 'The local tutorial media import failed.',
      options,
    );
    this.name = 'TutorialLocalMediaSourceError';
  }
}

interface ParsedRegistration extends TutorialLocalMediaRegistration {
  readonly importAuthorization: LocalMediaImportAuthorization;
  readonly rightsEvidence: MediaRightsEvidence;
  readonly importValidationReceipt: AuthorityValidationReceipt;
  readonly rightsValidationReceipt: AuthorityValidationReceipt;
  readonly caption?: TutorialLocalCaptionInput | undefined;
}

interface FileIdentity {
  readonly dev: number;
  readonly ino: number;
  readonly size: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function computeTutorialLocalMediaSourceIdentitySha256(canonicalPath: string): string {
  if (
    typeof canonicalPath !== 'string' ||
    canonicalPath.includes('\0') ||
    !isAbsolute(canonicalPath) ||
    resolve(canonicalPath) !== canonicalPath
  ) {
    throw new TutorialLocalMediaSourceError('invalid_input');
  }
  return sha256(Buffer.from(canonicalPath, 'utf8'));
}

export function computeTutorialLocalMediaReceiptContentSha256(
  receipt: AuthorityValidationReceipt,
): string {
  return sha256(canonicalizeProtocolJsonValue(authorityValidationReceiptSchema.parse(receipt)));
}

function authorityContentSha256(
  record: LocalMediaImportAuthorization | MediaRightsEvidence,
): string {
  return sha256(canonicalizeAuthorityJson(authoritySignedContent(record)));
}

function absoluteNormalizedPath(value: string): boolean {
  return (
    typeof value === 'string' &&
    !value.includes('\0') &&
    isAbsolute(value) &&
    resolve(value) === value
  );
}

function parseRegistration(registration: TutorialLocalMediaRegistration): ParsedRegistration {
  if (!absoluteNormalizedPath(registration.path)) {
    throw new TutorialLocalMediaSourceError('invalid_input');
  }
  const importAuthorization = localMediaImportAuthorizationSchema.safeParse(
    registration.importAuthorization,
  );
  const rightsEvidence = mediaRightsEvidenceSchema.safeParse(registration.rightsEvidence);
  const importValidationReceipt = authorityValidationReceiptSchema.safeParse(
    registration.importValidationReceipt,
  );
  const rightsValidationReceipt = authorityValidationReceiptSchema.safeParse(
    registration.rightsValidationReceipt,
  );
  const caption =
    registration.caption === undefined
      ? undefined
      : tutorialLocalCaptionInputSchema.safeParse(registration.caption);
  if (
    !importAuthorization.success ||
    !rightsEvidence.success ||
    !importValidationReceipt.success ||
    !rightsValidationReceipt.success ||
    (caption !== undefined && !caption.success)
  ) {
    throw new TutorialLocalMediaSourceError('invalid_input');
  }
  if (
    caption !== undefined &&
    (Buffer.byteLength(caption.data.content, 'utf8') >
      procedureTutorialTranscriptDocumentMaxBytes ||
      sha256(Buffer.from(caption.data.content, 'utf8')) !== caption.data.contentSha256)
  ) {
    throw new TutorialLocalMediaSourceError('caption_hash_mismatch');
  }
  return Object.freeze({
    path: registration.path,
    importAuthorization: structuredClone(importAuthorization.data),
    rightsEvidence: structuredClone(rightsEvidence.data),
    importValidationReceipt: structuredClone(importValidationReceipt.data),
    rightsValidationReceipt: structuredClone(rightsValidationReceipt.data),
    ...(caption === undefined ? {} : { caption: structuredClone(caption.data) }),
  });
}

function receiptBindingMatches(
  request: LocalAnalysisRequest,
  registration: ParsedRegistration,
): boolean {
  const source = request.source;
  const importReceipt = registration.importValidationReceipt;
  const rightsReceipt = registration.rightsValidationReceipt;
  return (
    importReceipt.authorityKind === 'LocalMediaImportAuthorization' &&
    importReceipt.sideEffect === 'local_media_import' &&
    importReceipt.targetSha256 === source.contentSha256 &&
    source.importValidation.authorityId === importReceipt.authorityId &&
    source.importValidation.authorityId === registration.importAuthorization.authorityId &&
    source.importValidation.authorityContentSha256 === importReceipt.authorityContentSha256 &&
    source.importValidation.authorityContentSha256 ===
      authorityContentSha256(registration.importAuthorization) &&
    source.importValidation.receiptContentSha256 ===
      computeTutorialLocalMediaReceiptContentSha256(importReceipt) &&
    rightsReceipt.authorityKind === 'MediaRightsEvidence' &&
    rightsReceipt.sideEffect === 'media_rights_validation' &&
    rightsReceipt.targetSha256 === source.contentSha256 &&
    source.rightsValidation.authorityId === rightsReceipt.authorityId &&
    source.rightsValidation.authorityId === registration.rightsEvidence.authorityId &&
    source.rightsValidation.authorityContentSha256 === rightsReceipt.authorityContentSha256 &&
    source.rightsValidation.authorityContentSha256 ===
      authorityContentSha256(registration.rightsEvidence) &&
    source.rightsValidation.receiptContentSha256 ===
      computeTutorialLocalMediaReceiptContentSha256(rightsReceipt)
  );
}

function sameFileIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

function statNumber(value: number | bigint, requireSafeInteger: boolean): number {
  const normalized = typeof value === 'bigint' ? Number(value) : value;
  if (!Number.isFinite(normalized) || (requireSafeInteger && !Number.isSafeInteger(normalized))) {
    throw new TutorialLocalMediaSourceError('unsafe_source');
  }
  return normalized;
}

function identityOf(info: Awaited<ReturnType<FileHandle['stat']>>): FileIdentity {
  return {
    dev: statNumber(info.dev, true),
    ino: statNumber(info.ino, true),
    size: statNumber(info.size, true),
    mtimeMs: statNumber(info.mtimeMs, false),
    ctimeMs: statNumber(info.ctimeMs, false),
  };
}

function validateRegularSource(
  info: Awaited<ReturnType<FileHandle['stat']>>,
  expectedBytes: number,
  maximumImportBytes: number,
  expectedOwnerUid: number | undefined,
): void {
  if (
    !info.isFile() ||
    info.nlink !== 1 ||
    info.size <= 0 ||
    (expectedOwnerUid !== undefined && statNumber(info.uid, true) !== expectedOwnerUid) ||
    (process.platform !== 'win32' && (statNumber(info.mode, true) & 0o022) !== 0)
  ) {
    throw new TutorialLocalMediaSourceError('unsafe_source');
  }
  if (info.size > maximumImportBytes) {
    throw new TutorialLocalMediaSourceError('source_too_large');
  }
  if (info.size !== expectedBytes) {
    throw new TutorialLocalMediaSourceError('content_changed');
  }
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new TutorialLocalMediaSourceError('aborted');
}

async function closeQuietly(handle: FileHandle | undefined): Promise<void> {
  await handle?.close().catch(() => undefined);
}

async function writeAll(handle: FileHandle, value: Uint8Array, position: number): Promise<void> {
  let written = 0;
  while (written < value.byteLength) {
    const result = await handle.write(
      value,
      written,
      value.byteLength - written,
      position + written,
    );
    if (result.bytesWritten <= 0) throw new TutorialLocalMediaSourceError('import_failed');
    written += result.bytesWritten;
  }
}

async function prepareDestination(
  jobDirectory: string,
  expectedOwnerUid: number | undefined,
): Promise<string> {
  if (!absoluteNormalizedPath(jobDirectory)) {
    throw new TutorialLocalMediaSourceError('invalid_input');
  }
  const jobInfo = await lstat(jobDirectory).catch(() => undefined);
  if (
    jobInfo === undefined ||
    jobInfo.isSymbolicLink() ||
    !jobInfo.isDirectory() ||
    (expectedOwnerUid !== undefined && jobInfo.uid !== expectedOwnerUid) ||
    (process.platform !== 'win32' && (jobInfo.mode & 0o777) !== 0o700) ||
    (await realpath(jobDirectory).catch(() => '')) !== jobDirectory
  ) {
    throw new TutorialLocalMediaSourceError('unsafe_source');
  }
  const sourceDirectory = join(jobDirectory, 'source');
  try {
    await mkdir(sourceDirectory, { mode: 0o700 });
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) {
      throw new TutorialLocalMediaSourceError('import_failed', { cause: error });
    }
  }
  const sourceDirectoryInfo = await lstat(sourceDirectory).catch(() => undefined);
  if (
    sourceDirectoryInfo === undefined ||
    sourceDirectoryInfo.isSymbolicLink() ||
    !sourceDirectoryInfo.isDirectory() ||
    (expectedOwnerUid !== undefined && sourceDirectoryInfo.uid !== expectedOwnerUid) ||
    (process.platform !== 'win32' && (sourceDirectoryInfo.mode & 0o777) !== 0o700) ||
    (await realpath(sourceDirectory).catch(() => '')) !== sourceDirectory ||
    (await readdir(sourceDirectory)).length !== 0
  ) {
    throw new TutorialLocalMediaSourceError('unsafe_source');
  }
  return join(sourceDirectory, 'media.mp4');
}

async function validatePathIdentity(
  path: string,
  canonicalPath: string,
  expected: FileIdentity,
): Promise<void> {
  const pathInfo = await lstat(path).catch(() => undefined);
  if (
    pathInfo === undefined ||
    pathInfo.isSymbolicLink() ||
    !pathInfo.isFile() ||
    pathInfo.nlink !== 1 ||
    (await realpath(path).catch(() => '')) !== canonicalPath ||
    !sameFileIdentity(identityOf(pathInfo), expected)
  ) {
    throw new TutorialLocalMediaSourceError('content_changed');
  }
}

function validateMp4Header(header: Uint8Array): void {
  if (header.byteLength < 12 || Buffer.from(header.subarray(4, 8)).toString('ascii') !== 'ftyp') {
    throw new TutorialLocalMediaSourceError('unsupported_media');
  }
}

function validateLiveReceipts(
  receipts: readonly [AuthorityValidationReceipt, AuthorityValidationReceipt],
  registration: ParsedRegistration,
  contentSha256: string,
): readonly [AuthorityValidationReceipt, AuthorityValidationReceipt] {
  const importReceipt = authorityValidationReceiptSchema.safeParse(receipts[0]);
  const rightsReceipt = authorityValidationReceiptSchema.safeParse(receipts[1]);
  if (
    !importReceipt.success ||
    !rightsReceipt.success ||
    importReceipt.data.authorityKind !== 'LocalMediaImportAuthorization' ||
    importReceipt.data.authorityId !== registration.importAuthorization.authorityId ||
    importReceipt.data.authorityContentSha256 !==
      authorityContentSha256(registration.importAuthorization) ||
    importReceipt.data.sideEffect !== 'local_media_import' ||
    importReceipt.data.targetSha256 !== contentSha256 ||
    rightsReceipt.data.authorityKind !== 'MediaRightsEvidence' ||
    rightsReceipt.data.authorityId !== registration.rightsEvidence.authorityId ||
    rightsReceipt.data.authorityContentSha256 !==
      authorityContentSha256(registration.rightsEvidence) ||
    rightsReceipt.data.sideEffect !== 'media_rights_validation' ||
    rightsReceipt.data.targetSha256 !== contentSha256
  ) {
    throw new TutorialLocalMediaSourceError('authorization_required');
  }
  return [importReceipt.data, rightsReceipt.data];
}

export function createTutorialLocalMediaSource(
  options: TutorialLocalMediaSourceOptions,
): TutorialLocalMediaSource {
  const maximumImportBytes = options.maximumImportBytes ?? defaultMaximumImportBytes;
  const expectedOwnerUid =
    options.expectedOwnerUid ??
    (typeof process.getuid === 'function' ? process.getuid() : undefined);
  if (
    options.authorityVerifier === null ||
    typeof options.authorityVerifier?.verifyLocalMediaImport !== 'function' ||
    !Array.isArray(options.registrations) ||
    !Number.isSafeInteger(maximumImportBytes) ||
    maximumImportBytes <= 0 ||
    maximumImportBytes > 10_737_418_240 ||
    (expectedOwnerUid !== undefined &&
      (!Number.isSafeInteger(expectedOwnerUid) || expectedOwnerUid < 0))
  ) {
    throw new TutorialLocalMediaSourceError('invalid_input');
  }
  const registrations = options.registrations.map(parseRegistration);
  const registrationsByIdentity = new Map<string, ParsedRegistration>();
  for (const registration of registrations) {
    const identity = registration.importAuthorization.source.canonicalPathSha256;
    if (registrationsByIdentity.has(identity)) {
      throw new TutorialLocalMediaSourceError('invalid_input');
    }
    registrationsByIdentity.set(identity, registration);
  }

  return Object.freeze({
    async import(
      input: Parameters<TutorialLocalMediaSource['import']>[0],
    ): Promise<TutorialLocalMediaImport> {
      const requestResult = procedureTutorialMediaAnalysisStartRequestSchema.safeParse(
        input.request,
      );
      if (!requestResult.success || requestResult.data.source.kind !== 'user_supplied_local_file') {
        throw new TutorialLocalMediaSourceError('invalid_input');
      }
      const request = requestResult.data as LocalAnalysisRequest;
      const registration = registrationsByIdentity.get(request.source.sourceIdentitySha256);
      if (registration === undefined) {
        throw new TutorialLocalMediaSourceError('source_not_registered');
      }
      if (!receiptBindingMatches(request, registration)) {
        throw new TutorialLocalMediaSourceError('authorization_required');
      }
      if (registration.importAuthorization.retention !== 'private_cas_indefinite') {
        throw new TutorialLocalMediaSourceError('unsupported_retention');
      }
      const expectedStages = request.requestedStages.filter(
        (stage): stage is Exclude<(typeof request.requestedStages)[number], 'import'> =>
          stage !== 'import',
      );
      if (
        request.source.contentSha256 !== registration.importAuthorization.source.contentSha256 ||
        request.source.contentSha256 !== registration.rightsEvidence.mediaSha256 ||
        request.source.sourceIdentitySha256 !==
          registration.importAuthorization.source.canonicalPathSha256 ||
        request.source.sourceIdentitySha256 !== registration.rightsEvidence.sourceIdentitySha256 ||
        request.source.rightsBasis !== registration.rightsEvidence.rightsBasis ||
        JSON.stringify(expectedStages) !==
          JSON.stringify(registration.importAuthorization.allowedProcessingStages)
      ) {
        throw new TutorialLocalMediaSourceError('authorization_required');
      }

      assertNotAborted(input.signal);
      let sourceHandle: FileHandle | undefined;
      let destinationHandle: FileHandle | undefined;
      let destinationPath: string | undefined;
      try {
        const canonicalPath = await realpath(registration.path).catch(() => '');
        if (
          canonicalPath !== registration.path ||
          computeTutorialLocalMediaSourceIdentitySha256(canonicalPath) !==
            request.source.sourceIdentitySha256
        ) {
          throw new TutorialLocalMediaSourceError('unsafe_source');
        }
        const pathInfo = await lstat(registration.path).catch(() => undefined);
        if (pathInfo === undefined || pathInfo.isSymbolicLink()) {
          throw new TutorialLocalMediaSourceError('unsafe_source');
        }
        validateRegularSource(
          pathInfo,
          registration.importAuthorization.source.byteLength,
          maximumImportBytes,
          expectedOwnerUid,
        );
        const noFollow = 'O_NOFOLLOW' in fsConstants ? fsConstants.O_NOFOLLOW : 0;
        sourceHandle = await open(registration.path, fsConstants.O_RDONLY | noFollow);
        const before = await sourceHandle.stat();
        validateRegularSource(
          before,
          registration.importAuthorization.source.byteLength,
          maximumImportBytes,
          expectedOwnerUid,
        );
        const beforeIdentity = identityOf(before);
        if (!sameFileIdentity(beforeIdentity, identityOf(pathInfo))) {
          throw new TutorialLocalMediaSourceError('content_changed');
        }

        destinationPath = await prepareDestination(input.jobDirectory, expectedOwnerUid);
        destinationHandle = await open(
          destinationPath,
          fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | noFollow,
          0o600,
        );
        const destinationInfo = await destinationHandle.stat();
        if (
          !destinationInfo.isFile() ||
          destinationInfo.nlink !== 1 ||
          (expectedOwnerUid !== undefined &&
            statNumber(destinationInfo.uid, true) !== expectedOwnerUid) ||
          (process.platform !== 'win32' &&
            (statNumber(destinationInfo.mode, true) & 0o777) !== 0o600)
        ) {
          throw new TutorialLocalMediaSourceError('unsafe_source');
        }
        const digest = createHash('sha256');
        const buffer = Buffer.allocUnsafe(copyChunkBytes);
        const header = Buffer.alloc(12);
        let headerBytes = 0;
        let position = 0;
        while (true) {
          assertNotAborted(input.signal);
          const { bytesRead } = await sourceHandle.read(buffer, 0, buffer.byteLength, position);
          if (bytesRead === 0) break;
          if (position + bytesRead > maximumImportBytes) {
            throw new TutorialLocalMediaSourceError('source_too_large');
          }
          const bytes = buffer.subarray(0, bytesRead);
          if (headerBytes < header.byteLength) {
            const copied = Math.min(header.byteLength - headerBytes, bytesRead);
            bytes.copy(header, headerBytes, 0, copied);
            headerBytes += copied;
          }
          digest.update(bytes);
          await writeAll(destinationHandle, bytes, position);
          position += bytesRead;
        }
        validateMp4Header(header.subarray(0, headerBytes));
        const contentSha256 = digest.digest('hex');
        if (
          position !== before.size ||
          contentSha256 !== request.source.contentSha256 ||
          contentSha256 !== registration.importAuthorization.source.contentSha256
        ) {
          throw new TutorialLocalMediaSourceError('content_changed');
        }
        const after = await sourceHandle.stat();
        if (!sameFileIdentity(beforeIdentity, identityOf(after))) {
          throw new TutorialLocalMediaSourceError('content_changed');
        }
        await validatePathIdentity(registration.path, canonicalPath, beforeIdentity);
        await destinationHandle.sync();
        await closeQuietly(destinationHandle);
        destinationHandle = undefined;

        let liveReceipts: readonly [AuthorityValidationReceipt, AuthorityValidationReceipt];
        try {
          liveReceipts = validateLiveReceipts(
            options.authorityVerifier.verifyLocalMediaImport({
              importAuthorization: registration.importAuthorization,
              rightsEvidence: registration.rightsEvidence,
              contentSha256,
              sourceIdentitySha256: request.source.sourceIdentitySha256,
              importBinding: {
                canonicalPathSha256: request.source.sourceIdentitySha256,
                contentSha256,
                byteLength: position,
                processingStages: expectedStages,
                retention: registration.importAuthorization.retention,
              },
              rightsBinding: {
                mediaSha256: contentSha256,
                sourceIdentitySha256: request.source.sourceIdentitySha256,
                rightsBasis: registration.rightsEvidence.rightsBasis,
                rightsHolder: registration.rightsEvidence.rightsHolder,
                evidenceReference: registration.rightsEvidence.evidenceReference,
                purpose: 'private_analysis',
              },
            }),
            registration,
            contentSha256,
          );
        } catch (error) {
          if (error instanceof TutorialLocalMediaSourceError) throw error;
          throw new TutorialLocalMediaSourceError('authorization_required', { cause: error });
        }
        await validatePathIdentity(registration.path, canonicalPath, beforeIdentity);
        assertNotAborted(input.signal);
        const historicalValidationReceipts = Object.freeze([
          structuredClone(registration.importValidationReceipt),
          structuredClone(registration.rightsValidationReceipt),
        ] as const);
        const frozenLiveReceipts = Object.freeze([
          structuredClone(liveReceipts[0]),
          structuredClone(liveReceipts[1]),
        ] as const);
        return Object.freeze({
          mediaPath: destinationPath,
          contentSha256,
          sourceIdentitySha256: request.source.sourceIdentitySha256,
          byteLength: position,
          historicalValidationReceipts,
          liveValidationReceipts: frozenLiveReceipts,
          caption:
            registration.caption === undefined
              ? null
              : Object.freeze(structuredClone(registration.caption)),
        });
      } catch (error) {
        await closeQuietly(destinationHandle);
        if (destinationPath !== undefined) {
          await rm(destinationPath, { force: true }).catch(() => undefined);
        }
        if (error instanceof TutorialLocalMediaSourceError) throw error;
        throw new TutorialLocalMediaSourceError('import_failed', { cause: error });
      } finally {
        await closeQuietly(sourceHandle);
      }
    },
  });
}
