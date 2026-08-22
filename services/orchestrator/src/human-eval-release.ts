import { createHash, randomUUID } from 'node:crypto';

import {
  buildHumanEvalReleasedManifestEnvelope,
  canonicalizeHumanEvalContent,
  validateHumanEvalReleaseCandidateManifest,
  validateHumanEvalReleasedManifest,
} from '@operatingline/eval-kit';
import type {
  DatasetReleaseRecord,
  FinalizeDatasetReleaseInput,
  FinalizeDatasetReleaseResult,
} from '@operatingline/persistence';
import {
  authoritySignedContent,
  authorityValidationReceiptSchema,
  canonicalizeAuthorityJson,
  computeProtocolCanonicalJsonSha256,
  humanEvalReleaseRequestSchema,
  humanEvalReleaseResponseSchema,
  type AuthorityValidationReceipt,
  type HumanEvalReleaseRequest,
  type HumanEvalReleaseResponse,
  type HumanEvalReleasedManifest,
} from '@operatingline/protocol';

import type { DatasetReleaseSideEffectBinding } from './authority-verifier.js';

export type HumanEvalReleaseErrorCode =
  | 'validation_receipt_mismatch'
  | 'operation_conflict'
  | 'authority_conflict'
  | 'semantic_release_conflict'
  | 'manifest_conflict'
  | 'stored_release_corrupt'
  | 'persistence_invalid'
  | 'invalid_clock';

export class HumanEvalReleaseError extends Error {
  constructor(
    readonly code: HumanEvalReleaseErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = 'HumanEvalReleaseError';
  }
}

export interface HumanEvalReleaseStore {
  readDatasetReleaseByOperation(operationId: string): DatasetReleaseRecord | null;
  finalizeDatasetReleaseIfUnused(input: FinalizeDatasetReleaseInput): FinalizeDatasetReleaseResult;
}

export interface LiveDatasetReleaseAuthorityVerifier {
  verify(request: {
    readonly record: unknown;
    readonly sideEffect: 'dataset_release';
    readonly targetSha256: string;
    readonly binding: DatasetReleaseSideEffectBinding;
  }): AuthorityValidationReceipt;
}

export interface HumanEvalReleaseCoordinatorOptions {
  readonly now?: () => Date;
}

function sha256Bytes(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value: unknown): string {
  return canonicalizeHumanEvalContent(value);
}

function authorizationContentSha256(
  authorization: HumanEvalReleaseRequest['authorization'],
): string {
  return sha256Bytes(canonicalizeAuthorityJson(authoritySignedContent(authorization)));
}

function releaseBinding(
  authorization: HumanEvalReleaseRequest['authorization'],
): DatasetReleaseSideEffectBinding {
  return {
    releaseCandidateManifestSha256: authorization.releaseCandidateManifestSha256,
    audience: authorization.audience,
    license: authorization.license,
    redactionDecisionSha256: authorization.redactionDecisionSha256,
    releaseScope: authorization.releaseScope,
  };
}

function releaseBindingSha256(
  authorityContentSha256: string,
  binding: DatasetReleaseSideEffectBinding,
): string {
  return computeProtocolCanonicalJsonSha256({ authorityContentSha256, binding });
}

function semanticReleaseKeySha256(binding: DatasetReleaseSideEffectBinding): string {
  return computeProtocolCanonicalJsonSha256({
    sideEffect: 'dataset_release',
    ...binding,
  });
}

function verifyLiveReceipt(input: {
  readonly receipt: AuthorityValidationReceipt;
  readonly request: HumanEvalReleaseRequest;
  readonly authorityContentSha256: string;
}): AuthorityValidationReceipt {
  const receipt = authorityValidationReceiptSchema.parse(input.receipt);
  const authorization = input.request.authorization;
  if (
    receipt.authorityKind !== 'DatasetReleaseAuthorization' ||
    receipt.authorityId !== authorization.authorityId ||
    receipt.authorityContentSha256 !== input.authorityContentSha256 ||
    receipt.signerId !== authorization.signature.signerId ||
    receipt.keyId !== authorization.signature.keyId ||
    receipt.targetSha256 !== input.request.releaseCandidate.integrity.contentSha256 ||
    receipt.sideEffect !== 'dataset_release'
  ) {
    throw new HumanEvalReleaseError(
      'validation_receipt_mismatch',
      'Live authority verifier returned a receipt for a different release',
    );
  }
  return receipt;
}

function storedReleaseError(message: string, cause?: unknown): HumanEvalReleaseError {
  return new HumanEvalReleaseError(
    'stored_release_corrupt',
    cause instanceof Error ? `${message}: ${cause.message}` : message,
  );
}

function validateStoredRelease(
  record: DatasetReleaseRecord,
  expected?: {
    readonly request: HumanEvalReleaseRequest;
    readonly authorityContentSha256: string;
    readonly bindingSha256: string;
    readonly semanticSingleUseKeySha256: string;
  },
): HumanEvalReleasedManifest {
  let manifest: HumanEvalReleasedManifest;
  let receipt: AuthorityValidationReceipt;
  try {
    manifest = validateHumanEvalReleasedManifest(JSON.parse(record.manifestJson) as unknown);
    receipt = authorityValidationReceiptSchema.parse(
      JSON.parse(record.validationReceiptJson) as unknown,
    );
  } catch (error) {
    throw storedReleaseError('Stored Human Eval release cannot be parsed or verified', error);
  }

  const canonicalManifestJson = canonicalJson(manifest);
  const canonicalReceiptJson = canonicalJson(receipt);
  if (
    record.manifestJson !== canonicalManifestJson ||
    record.validationReceiptJson !== canonicalReceiptJson ||
    record.manifestSha256 !== manifest.integrity.contentSha256 ||
    record.releaseCandidateManifestSha256 !== manifest.releaseCandidate.integrity.contentSha256 ||
    record.authorizationId !== manifest.authorization.authorityId ||
    record.authorizationContentSha256 !== manifest.authorizationContentSha256 ||
    record.validationReceiptSha256 !== manifest.validationReceiptSha256 ||
    record.validationReceiptSha256 !== computeProtocolCanonicalJsonSha256(receipt) ||
    canonicalReceiptJson !== canonicalJson(manifest.validationReceipt) ||
    record.operationId !== manifest.operationId ||
    record.consumptionEvent.kind !== 'dataset_release_authorization_consumed' ||
    record.consumptionEvent.credentialId !== record.authorizationId ||
    record.consumptionEvent.operationId !== record.operationId ||
    record.consumptionEvent.bindingSha256 !== record.bindingSha256 ||
    record.consumptionEvent.singleUseKeySha256 !== record.semanticSingleUseKeySha256 ||
    record.completionEvent.kind !== 'dataset_release_completed' ||
    record.completionEvent.credentialId !== record.authorizationId ||
    record.completionEvent.operationId !== record.operationId ||
    record.completionEvent.durableReceiptSha256 !== record.manifestSha256 ||
    record.completionEvent.sequence !== record.consumptionEvent.sequence + 1 ||
    Date.parse(record.completionEvent.completedAt) < Date.parse(record.consumptionEvent.consumedAt)
  ) {
    throw storedReleaseError('Stored Human Eval release columns do not match their payloads');
  }

  if (
    expected !== undefined &&
    (record.operationId !== expected.request.operationId ||
      record.releaseCandidateManifestSha256 !==
        expected.request.releaseCandidate.integrity.contentSha256 ||
      record.authorizationId !== expected.request.authorization.authorityId ||
      record.authorizationContentSha256 !== expected.authorityContentSha256 ||
      record.bindingSha256 !== expected.bindingSha256 ||
      record.semanticSingleUseKeySha256 !== expected.semanticSingleUseKeySha256 ||
      canonicalJson(manifest.authorization) !== canonicalJson(expected.request.authorization))
  ) {
    throw new HumanEvalReleaseError(
      'operation_conflict',
      'Release operation id is already bound to a different request',
    );
  }
  return manifest;
}

function conflictFromStore(
  result: Exclude<FinalizeDatasetReleaseResult, { status: 'created' | 'already_completed' }>,
): never {
  switch (result.status) {
    case 'operation_conflict':
      throw new HumanEvalReleaseError(
        'operation_conflict',
        'Release operation id is already bound to a different request',
      );
    case 'authority_conflict':
      throw new HumanEvalReleaseError(
        'authority_conflict',
        'Dataset release authorization has already been consumed',
      );
    case 'semantic_release_conflict':
      throw new HumanEvalReleaseError(
        'semantic_release_conflict',
        'The exact dataset release scope has already been completed',
      );
    case 'manifest_conflict':
      throw new HumanEvalReleaseError(
        'manifest_conflict',
        'Released manifest hash is already bound to a different release',
      );
    case 'invalid':
      throw new HumanEvalReleaseError(
        'persistence_invalid',
        'Atomic dataset release persistence rejected its validated input',
      );
  }
}

export class HumanEvalReleaseCoordinator {
  readonly #store: HumanEvalReleaseStore;
  readonly #liveVerifier: LiveDatasetReleaseAuthorityVerifier;
  readonly #now: () => Date;

  constructor(
    store: HumanEvalReleaseStore,
    liveVerifier: LiveDatasetReleaseAuthorityVerifier,
    options: HumanEvalReleaseCoordinatorOptions = {},
  ) {
    this.#store = store;
    this.#liveVerifier = liveVerifier;
    this.#now = options.now ?? (() => new Date());
  }

  finalize(input: unknown): HumanEvalReleaseResponse {
    const request = humanEvalReleaseRequestSchema.parse(input);
    validateHumanEvalReleaseCandidateManifest(request.releaseCandidate);

    const authorityContentHash = authorizationContentSha256(request.authorization);
    const binding = releaseBinding(request.authorization);
    const bindingSha256 = releaseBindingSha256(authorityContentHash, binding);
    const semanticSingleUseKey = semanticReleaseKeySha256(binding);
    const expected = {
      request,
      authorityContentSha256: authorityContentHash,
      bindingSha256,
      semanticSingleUseKeySha256: semanticSingleUseKey,
    };

    let existing: DatasetReleaseRecord | null;
    try {
      existing = this.#store.readDatasetReleaseByOperation(request.operationId);
    } catch (error) {
      throw storedReleaseError('Stored Human Eval release lifecycle cannot be read', error);
    }
    if (existing !== null) {
      const manifest = validateStoredRelease(existing, expected);
      return humanEvalReleaseResponseSchema.parse({
        formatVersion: '1.0.0',
        operationId: request.operationId,
        status: 'already_completed',
        releasedManifestSha256: manifest.integrity.contentSha256,
        releasedManifest: manifest,
      });
    }

    if (!this.#liveVerifier || typeof this.#liveVerifier.verify !== 'function') {
      throw new HumanEvalReleaseError(
        'validation_receipt_mismatch',
        'Live dataset release authority verification is required',
      );
    }
    const receipt = verifyLiveReceipt({
      receipt: this.#liveVerifier.verify({
        record: request.authorization,
        sideEffect: 'dataset_release',
        targetSha256: request.releaseCandidate.integrity.contentSha256,
        binding,
      }),
      request,
      authorityContentSha256: authorityContentHash,
    });
    const manifest = buildHumanEvalReleasedManifestEnvelope({
      operationId: request.operationId,
      releaseCandidate: request.releaseCandidate,
      authorization: request.authorization,
      validationReceipt: receipt,
    });
    const committedAt = this.#safeNow().toISOString();
    const manifestJson = canonicalJson(manifest);
    const validationReceiptJson = canonicalJson(receipt);
    let result: FinalizeDatasetReleaseResult;
    try {
      result = this.#store.finalizeDatasetReleaseIfUnused({
        manifestSha256: manifest.integrity.contentSha256,
        manifestJson,
        releaseCandidateManifestSha256: request.releaseCandidate.integrity.contentSha256,
        authorizationId: request.authorization.authorityId,
        authorizationContentSha256: authorityContentHash,
        validationReceiptSha256: manifest.validationReceiptSha256,
        validationReceiptJson,
        operationId: request.operationId,
        bindingSha256,
        semanticSingleUseKeySha256: semanticSingleUseKey,
        consumptionEvent: {
          formatVersion: '1.0.0',
          eventId: randomUUID(),
          kind: 'dataset_release_authorization_consumed',
          credentialId: request.authorization.authorityId,
          singleUseKeySha256: semanticSingleUseKey,
          operationId: request.operationId,
          bindingSha256,
          consumedAt: committedAt,
        },
        completionEvent: {
          formatVersion: '1.0.0',
          eventId: randomUUID(),
          kind: 'dataset_release_completed',
          credentialId: request.authorization.authorityId,
          operationId: request.operationId,
          durableReceiptSha256: manifest.integrity.contentSha256,
          completedAt: committedAt,
        },
      });
    } catch (error) {
      throw new HumanEvalReleaseError(
        'persistence_invalid',
        error instanceof Error
          ? `Atomic dataset release persistence failed: ${error.message}`
          : 'Atomic dataset release persistence failed',
      );
    }
    if (result.status !== 'created' && result.status !== 'already_completed') {
      return conflictFromStore(result);
    }
    const durableManifest = validateStoredRelease(result.release, expected);
    return humanEvalReleaseResponseSchema.parse({
      formatVersion: '1.0.0',
      operationId: request.operationId,
      status: result.status,
      releasedManifestSha256: durableManifest.integrity.contentSha256,
      releasedManifest: durableManifest,
    });
  }

  #safeNow(): Date {
    const now = this.#now();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new HumanEvalReleaseError('invalid_clock', 'Release clock returned an invalid instant');
    }
    return now;
  }
}
