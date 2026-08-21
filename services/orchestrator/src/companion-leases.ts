import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';

import {
  companionHeartbeatRequestSchema,
  companionHeartbeatResponseSchema,
  companionSessionHelloRequestSchema,
  companionSessionHelloResponseSchema,
  guideProtocolVersion,
  isCompanionSessionV11,
  type ActionCatalog,
  type CompanionHeartbeatRequest,
  type CompanionHeartbeatResponse,
  type CompanionSessionHelloRequest,
  type CompanionSessionHelloRequestV11,
  type CompanionSessionHelloResponse,
  type CompanionSessionHelloResponseV11,
} from '@operatingline/protocol';

import { satisfiesStableVersionRange } from './stable-version-ranges.js';

export const companionHeartbeatIntervalMs = 5_000;
export const companionLeaseTtlMs = 15_000;

export type CompanionLeaseErrorCode =
  | 'capability_profile_mismatch'
  | 'catalog_identity_mismatch'
  | 'companion_version_incompatible'
  | 'guide_protocol_incompatible'
  | 'host_version_incompatible'
  | 'lease_identity_mismatch'
  | 'lease_not_current'
  | 'stale_heartbeat';

export class CompanionLeaseError extends Error {
  readonly code: CompanionLeaseErrorCode;
  readonly statusCode: 409 | 422;

  constructor(code: CompanionLeaseErrorCode, message: string, statusCode: 409 | 422) {
    super(message);
    this.name = 'CompanionLeaseError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface ActiveCompanionSession {
  readonly hello: CompanionSessionHelloRequest;
  readonly lease: CompanionSessionHelloResponse;
}

export interface ActiveCompanionDocumentSession {
  readonly hello: CompanionSessionHelloRequestV11;
  readonly lease: CompanionSessionHelloResponseV11;
}

export interface CompanionDocumentSessionIdentity {
  readonly adapterId: string;
  readonly instanceId: string;
  readonly sessionId: string;
  readonly documentIncarnationId: string;
}

interface CompanionLeaseRecord {
  readonly hello: CompanionSessionHelloRequest;
  readonly leaseId: string;
  readonly negotiatedGuideProtocolVersion: CompanionSessionHelloResponse['negotiatedGuideProtocolVersion'];
  readonly catalogVersion: string;
  readonly capabilities: CompanionSessionHelloResponse['capabilities'];
  lastHeartbeatSequence: number;
  deadlineMs: number;
  expiresAtWallClockMs: number;
}

export interface CompanionLeaseManagerOptions {
  readonly monotonicNow?: () => number;
  readonly wallClockNow?: () => number;
  readonly heartbeatIntervalMs?: number;
  readonly leaseTtlMs?: number;
  readonly allowLegacyCompanions?: boolean;
}

export interface CompanionLeaseManager {
  establish(
    request: CompanionSessionHelloRequest,
    catalog: ActionCatalog,
  ): CompanionSessionHelloResponse;
  heartbeat(request: CompanionHeartbeatRequest): CompanionHeartbeatResponse;
  authorize(leaseId: string, adapterId: string, instanceId: string): ActiveCompanionSession;
  authorizeDocumentSession(
    leaseId: string,
    adapterId: string,
    instanceId: string,
  ): ActiveCompanionDocumentSession;
  authorizeDocumentSessionForReceiptFingerprint(
    sessionFingerprintSha256: string,
    adapterId: string,
    instanceId: string,
  ): ActiveCompanionDocumentSession;
  rememberDocumentSessionFingerprint(
    sessionFingerprintSha256: string,
    identity: CompanionDocumentSessionIdentity,
  ): void;
  authorizeLegacy(adapterId: string, instanceId: string): void;
  observeLegacy(adapterId: string, instanceId: string): void;
  hasActivePresence(adapterId: string, instanceId: string): boolean;
}

function identityKey(adapterId: string, instanceId: string): string {
  return `${adapterId}\u0000${instanceId}`;
}

function leaseFingerprintSha256(leaseId: string): string {
  return createHash('sha256').update(leaseId).digest('hex');
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}

function validateCapabilitiesAgainstCatalog(
  request: CompanionSessionHelloRequest,
  catalog: ActionCatalog,
): void {
  const declared = request.capabilities;
  const catalogRollbackModes = new Set(catalog.actions.flatMap((action) => action.rollbackModes));
  const declaredRollbackModes = new Set(declared.execution.rollbackModes);
  const missingRollbackModes = [...catalogRollbackModes].filter(
    (mode) => !declaredRollbackModes.has(mode),
  );
  if (missingRollbackModes.length > 0) {
    throw new CompanionLeaseError(
      'capability_profile_mismatch',
      `Companion rollback modes do not cover the installed action catalog: ${missingRollbackModes.join(', ')}`,
      422,
    );
  }

  if (catalog.actions.length > 0 && declared.execution.invokeActions === 'unsupported') {
    throw new CompanionLeaseError(
      'capability_profile_mismatch',
      'Companion cannot declare action invocation unsupported for a non-empty action catalog',
      422,
    );
  }
}

export function createCompanionLeaseManager(
  options: CompanionLeaseManagerOptions = {},
): CompanionLeaseManager {
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  const wallClockNow = options.wallClockNow ?? Date.now;
  const allowLegacyCompanions = options.allowLegacyCompanions ?? true;
  const heartbeatInterval = positiveInteger(
    options.heartbeatIntervalMs ?? companionHeartbeatIntervalMs,
    'Companion heartbeat interval',
  );
  const leaseTtl = positiveInteger(
    options.leaseTtlMs ?? companionLeaseTtlMs,
    'Companion lease TTL',
  );
  if (leaseTtl <= heartbeatInterval) {
    throw new Error('Companion lease TTL must be greater than the heartbeat interval');
  }

  const leasesById = new Map<string, CompanionLeaseRecord>();
  const currentLeaseIdByTarget = new Map<string, string>();
  const currentLeaseIdBySessionId = new Map<string, string>();
  const legacyPresenceExpiryByIdentity = new Map<string, number>();
  const negotiatedIdentityKeys = new Set<string>();
  const documentSessionByLeaseFingerprint = new Map<string, CompanionDocumentSessionIdentity>();

  const removeLease = (leaseId: string): void => {
    const record = leasesById.get(leaseId);
    if (record === undefined) {
      return;
    }
    leasesById.delete(leaseId);
    const targetKey = identityKey(record.hello.adapterId, record.hello.instanceId);
    if (currentLeaseIdByTarget.get(targetKey) === leaseId) {
      currentLeaseIdByTarget.delete(targetKey);
    }
    if (
      isCompanionSessionV11(record.hello) &&
      currentLeaseIdBySessionId.get(record.hello.sessionId) === leaseId
    ) {
      currentLeaseIdBySessionId.delete(record.hello.sessionId);
    }
  };

  const pruneExpired = (): void => {
    const currentTime = monotonicNow();
    for (const [leaseId, record] of leasesById) {
      if (record.deadlineMs > currentTime) {
        continue;
      }
      removeLease(leaseId);
    }
    for (const [key, expiresAtMs] of legacyPresenceExpiryByIdentity) {
      if (expiresAtMs <= currentTime) {
        legacyPresenceExpiryByIdentity.delete(key);
      }
    }
  };

  const responseFor = (record: CompanionLeaseRecord): CompanionSessionHelloResponse => {
    const identity = isCompanionSessionV11(record.hello)
      ? {
          sessionId: record.hello.sessionId,
          documentIncarnationId: record.hello.documentIncarnationId,
        }
      : {};
    return companionSessionHelloResponseSchema.parse({
      contractVersion: record.hello.contractVersion,
      leaseId: record.leaseId,
      negotiatedGuideProtocolVersion: record.negotiatedGuideProtocolVersion,
      catalogVersion: record.catalogVersion,
      capabilities: record.capabilities,
      heartbeatIntervalMs: heartbeatInterval,
      leaseTtlMs: leaseTtl,
      expiresAt: new Date(record.expiresAtWallClockMs).toISOString(),
      ...identity,
    });
  };

  const currentRecord = (
    leaseId: string,
    adapterId: string,
    instanceId: string,
  ): CompanionLeaseRecord => {
    pruneExpired();
    const record = leasesById.get(leaseId);
    if (record === undefined) {
      throw new CompanionLeaseError(
        'lease_not_current',
        'Companion lease is unknown or has been superseded',
        409,
      );
    }
    if (record.hello.adapterId !== adapterId || record.hello.instanceId !== instanceId) {
      throw new CompanionLeaseError(
        'lease_identity_mismatch',
        'Companion lease does not belong to this adapter instance',
        409,
      );
    }
    const key = identityKey(adapterId, instanceId);
    if (currentLeaseIdByTarget.get(key) !== leaseId) {
      throw new CompanionLeaseError(
        'lease_not_current',
        'Companion lease has been superseded by a newer session',
        409,
      );
    }
    if (
      isCompanionSessionV11(record.hello) &&
      currentLeaseIdBySessionId.get(record.hello.sessionId) !== leaseId
    ) {
      throw new CompanionLeaseError(
        'lease_not_current',
        'Companion lease has been superseded by a newer session',
        409,
      );
    }
    if (record.deadlineMs <= monotonicNow()) {
      removeLease(leaseId);
      throw new CompanionLeaseError(
        'lease_not_current',
        'Companion lease is unknown, expired, or has been superseded',
        409,
      );
    }
    return record;
  };

  return {
    establish(input, catalog) {
      const request = companionSessionHelloRequestSchema.parse(input);
      if (
        catalog.adapterId !== request.adapterId ||
        catalog.catalogVersion !== request.catalogVersion
      ) {
        throw new CompanionLeaseError(
          'catalog_identity_mismatch',
          'Companion catalog identity does not match the installed action catalog',
          422,
        );
      }
      if (
        !satisfiesStableVersionRange(
          request.companionVersion,
          catalog.adapterVersionRange,
          'Companion version',
        )
      ) {
        throw new CompanionLeaseError(
          'companion_version_incompatible',
          'Companion version is outside the installed action catalog adapter range',
          422,
        );
      }
      if (
        !satisfiesStableVersionRange(request.hostVersion, catalog.hostVersionRange, 'Host version')
      ) {
        throw new CompanionLeaseError(
          'host_version_incompatible',
          'Host version is outside the installed action catalog host range',
          422,
        );
      }
      const advertisedVersions = new Set(request.supportedGuideProtocolVersions);
      if (!advertisedVersions.has(catalog.protocolVersion)) {
        throw new CompanionLeaseError(
          'guide_protocol_incompatible',
          'Companion does not support the installed action catalog protocol version',
          422,
        );
      }
      if (!advertisedVersions.has(guideProtocolVersion)) {
        throw new CompanionLeaseError(
          'guide_protocol_incompatible',
          `Companion must support the runtime Guide protocol ${guideProtocolVersion}; version projection is not available`,
          422,
        );
      }
      validateCapabilitiesAgainstCatalog(request, catalog);
      const negotiatedGuideProtocolVersion = guideProtocolVersion;

      pruneExpired();
      const establishedAt = monotonicNow();
      const establishedAtWallClock = wallClockNow();
      const leaseId = randomUUID();
      const record: CompanionLeaseRecord = {
        hello: request,
        leaseId,
        negotiatedGuideProtocolVersion,
        catalogVersion: catalog.catalogVersion,
        capabilities: request.capabilities,
        lastHeartbeatSequence: 0,
        deadlineMs: establishedAt + leaseTtl,
        expiresAtWallClockMs: establishedAtWallClock + leaseTtl,
      };
      const key = identityKey(request.adapterId, request.instanceId);
      negotiatedIdentityKeys.add(key);
      const supersededLeaseIds = new Set<string>();
      const previousTargetLeaseId = currentLeaseIdByTarget.get(key);
      if (previousTargetLeaseId !== undefined) {
        supersededLeaseIds.add(previousTargetLeaseId);
      }
      if (isCompanionSessionV11(request)) {
        const previousSessionLeaseId = currentLeaseIdBySessionId.get(request.sessionId);
        if (previousSessionLeaseId !== undefined) {
          supersededLeaseIds.add(previousSessionLeaseId);
        }
      }
      for (const supersededLeaseId of supersededLeaseIds) {
        removeLease(supersededLeaseId);
      }
      leasesById.set(leaseId, record);
      currentLeaseIdByTarget.set(key, leaseId);
      if (isCompanionSessionV11(request)) {
        currentLeaseIdBySessionId.set(request.sessionId, leaseId);
        documentSessionByLeaseFingerprint.set(leaseFingerprintSha256(leaseId), {
          adapterId: request.adapterId,
          instanceId: request.instanceId,
          sessionId: request.sessionId,
          documentIncarnationId: request.documentIncarnationId,
        });
      }
      legacyPresenceExpiryByIdentity.delete(key);
      return responseFor(record);
    },

    heartbeat(input) {
      const request = companionHeartbeatRequestSchema.parse(input);
      const record = currentRecord(request.leaseId, request.adapterId, request.instanceId);
      if (record.hello.contractVersion !== request.contractVersion) {
        throw new CompanionLeaseError(
          'lease_identity_mismatch',
          'Companion heartbeat contract version does not match the negotiated lease',
          409,
        );
      }
      if (
        isCompanionSessionV11(request) &&
        (!isCompanionSessionV11(record.hello) ||
          request.sessionId !== record.hello.sessionId ||
          request.documentIncarnationId !== record.hello.documentIncarnationId)
      ) {
        throw new CompanionLeaseError(
          'lease_identity_mismatch',
          'Companion heartbeat session identity does not match the negotiated lease',
          409,
        );
      }
      if (request.sequence < record.lastHeartbeatSequence) {
        throw new CompanionLeaseError(
          'stale_heartbeat',
          'Companion heartbeat sequence is older than the latest acknowledged heartbeat',
          409,
        );
      }
      if (request.sequence > record.lastHeartbeatSequence) {
        record.lastHeartbeatSequence = request.sequence;
        record.deadlineMs = monotonicNow() + leaseTtl;
        record.expiresAtWallClockMs = wallClockNow() + leaseTtl;
      }
      return companionHeartbeatResponseSchema.parse({
        contractVersion: request.contractVersion,
        leaseId: record.leaseId,
        sequence: request.sequence,
        expiresAt: new Date(record.expiresAtWallClockMs).toISOString(),
        ...(isCompanionSessionV11(request)
          ? {
              sessionId: request.sessionId,
              documentIncarnationId: request.documentIncarnationId,
            }
          : {}),
      });
    },

    authorize(leaseId, adapterId, instanceId) {
      const record = currentRecord(leaseId, adapterId, instanceId);
      return { hello: record.hello, lease: responseFor(record) };
    },

    authorizeDocumentSession(leaseId, adapterId, instanceId) {
      const record = currentRecord(leaseId, adapterId, instanceId);
      if (!isCompanionSessionV11(record.hello)) {
        throw new CompanionLeaseError(
          'lease_identity_mismatch',
          'Companion document authorization requires a version 1.1 session lease',
          409,
        );
      }
      const lease = responseFor(record);
      if (!isCompanionSessionV11(lease)) {
        throw new Error('Version 1.1 companion lease produced a mismatched response');
      }
      return { hello: record.hello, lease };
    },

    authorizeDocumentSessionForReceiptFingerprint(sessionFingerprintSha256, adapterId, instanceId) {
      const remembered = documentSessionByLeaseFingerprint.get(sessionFingerprintSha256);
      if (
        remembered === undefined ||
        remembered.adapterId !== adapterId ||
        remembered.instanceId !== instanceId
      ) {
        throw new CompanionLeaseError(
          'lease_identity_mismatch',
          'Receipt fingerprint is not bound to a known version 1.1 Companion document session',
          409,
        );
      }
      pruneExpired();
      const currentLeaseId = currentLeaseIdByTarget.get(identityKey(adapterId, instanceId));
      if (currentLeaseId === undefined) {
        throw new CompanionLeaseError(
          'lease_not_current',
          'The receipt-bound Companion document session is not currently connected',
          409,
        );
      }
      const current = currentRecord(currentLeaseId, adapterId, instanceId);
      if (
        !isCompanionSessionV11(current.hello) ||
        current.hello.sessionId !== remembered.sessionId ||
        current.hello.documentIncarnationId !== remembered.documentIncarnationId
      ) {
        throw new CompanionLeaseError(
          'lease_identity_mismatch',
          'The current Companion process or document differs from the receipt-bound session',
          409,
        );
      }
      const lease = responseFor(current);
      if (!isCompanionSessionV11(lease)) {
        throw new Error('Version 1.1 companion lease produced a mismatched response');
      }
      return { hello: current.hello, lease };
    },

    rememberDocumentSessionFingerprint(sessionFingerprintSha256, identity) {
      if (!/^[a-f0-9]{64}$/.test(sessionFingerprintSha256)) {
        throw new Error('Companion document-session fingerprint must be a SHA-256 digest');
      }
      const existing = documentSessionByLeaseFingerprint.get(sessionFingerprintSha256);
      if (existing !== undefined && !isDeepStrictEqual(existing, identity)) {
        throw new Error('Companion document-session fingerprint history conflicts');
      }
      documentSessionByLeaseFingerprint.set(sessionFingerprintSha256, identity);
    },

    authorizeLegacy(adapterId, instanceId) {
      if (!allowLegacyCompanions) {
        throw new CompanionLeaseError(
          'lease_not_current',
          'This runtime requires a negotiated companion lease',
          409,
        );
      }
      pruneExpired();
      const key = identityKey(adapterId, instanceId);
      if (negotiatedIdentityKeys.has(key)) {
        throw new CompanionLeaseError(
          'lease_not_current',
          'A negotiated session owns this companion identity; legacy downgrade is forbidden',
          409,
        );
      }
    },

    observeLegacy(adapterId, instanceId) {
      if (!allowLegacyCompanions) {
        throw new CompanionLeaseError(
          'lease_not_current',
          'This runtime requires a negotiated companion lease',
          409,
        );
      }
      pruneExpired();
      const key = identityKey(adapterId, instanceId);
      if (negotiatedIdentityKeys.has(key)) {
        throw new CompanionLeaseError(
          'lease_not_current',
          'A negotiated session owns this companion identity; legacy downgrade is forbidden',
          409,
        );
      }
      legacyPresenceExpiryByIdentity.set(key, monotonicNow() + leaseTtl);
    },

    hasActivePresence(adapterId, instanceId) {
      pruneExpired();
      const key = identityKey(adapterId, instanceId);
      return currentLeaseIdByTarget.has(key) || legacyPresenceExpiryByIdentity.has(key);
    },
  };
}
