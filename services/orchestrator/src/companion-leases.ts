import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import {
  companionHeartbeatRequestSchema,
  companionHeartbeatResponseSchema,
  companionSessionHelloRequestSchema,
  companionSessionHelloResponseSchema,
  guideProtocolVersion,
  type ActionCatalog,
  type CompanionHeartbeatRequest,
  type CompanionHeartbeatResponse,
  type CompanionSessionHelloRequest,
  type CompanionSessionHelloResponse,
} from '@operatingline/protocol';

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
  authorizeLegacy(adapterId: string, instanceId: string): void;
  observeLegacy(adapterId: string, instanceId: string): void;
  hasActivePresence(adapterId: string, instanceId: string): boolean;
}

function identityKey(adapterId: string, instanceId: string): string {
  return `${adapterId}\u0000${instanceId}`;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}

type StableVersion = readonly [major: number, minor: number, patch: number];

function parseStableVersion(value: string, label: string): StableVersion {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:\s|$)/.exec(value.trim());
  if (match === null) {
    throw new Error(`${label} must begin with a stable semantic version`);
  }
  const version = match.slice(1).map(Number) as unknown as StableVersion;
  if (version.some((part) => !Number.isSafeInteger(part))) {
    throw new Error(`${label} contains an unsafe semantic version component`);
  }
  return version;
}

function compareVersions(left: StableVersion, right: StableVersion): number {
  for (let index = 0; index < left.length; index += 1) {
    const difference = left[index]! - right[index]!;
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

function satisfiesVersionRange(value: string, range: string, label: string): boolean {
  const version = parseStableVersion(value, label);
  return range.split('||').some((alternative) => {
    const comparators = alternative.trim().split(/\s+/).filter(Boolean);
    if (comparators.length === 0) {
      throw new Error(`${label} range must contain at least one comparator`);
    }
    return comparators.every((comparator) => {
      const match = /^(>=|<=|>|<|=)?(\d+\.\d+\.\d+)$/.exec(comparator);
      if (match === null) {
        throw new Error(`${label} range contains an unsupported comparator: ${comparator}`);
      }
      const comparison = compareVersions(version, parseStableVersion(match[2]!, `${label} range`));
      switch (match[1] ?? '=') {
        case '>=':
          return comparison >= 0;
        case '<=':
          return comparison <= 0;
        case '>':
          return comparison > 0;
        case '<':
          return comparison < 0;
        default:
          return comparison === 0;
      }
    });
  });
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
  const currentLeaseIdByIdentity = new Map<string, string>();
  const legacyPresenceExpiryByIdentity = new Map<string, number>();
  const negotiatedIdentityKeys = new Set<string>();

  const pruneExpired = (): void => {
    const currentTime = monotonicNow();
    for (const [leaseId, record] of leasesById) {
      if (record.deadlineMs > currentTime) {
        continue;
      }
      leasesById.delete(leaseId);
      const key = identityKey(record.hello.adapterId, record.hello.instanceId);
      if (currentLeaseIdByIdentity.get(key) === leaseId) {
        currentLeaseIdByIdentity.delete(key);
      }
    }
    for (const [key, expiresAtMs] of legacyPresenceExpiryByIdentity) {
      if (expiresAtMs <= currentTime) {
        legacyPresenceExpiryByIdentity.delete(key);
      }
    }
  };

  const responseFor = (record: CompanionLeaseRecord): CompanionSessionHelloResponse =>
    companionSessionHelloResponseSchema.parse({
      contractVersion: '1.0.0',
      leaseId: record.leaseId,
      negotiatedGuideProtocolVersion: record.negotiatedGuideProtocolVersion,
      catalogVersion: record.catalogVersion,
      capabilities: record.capabilities,
      heartbeatIntervalMs: heartbeatInterval,
      leaseTtlMs: leaseTtl,
      expiresAt: new Date(record.expiresAtWallClockMs).toISOString(),
    });

  const currentRecord = (
    leaseId: string,
    adapterId: string,
    instanceId: string,
  ): CompanionLeaseRecord => {
    const record = leasesById.get(leaseId);
    if (record === undefined) {
      pruneExpired();
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
    if (currentLeaseIdByIdentity.get(key) !== leaseId) {
      throw new CompanionLeaseError(
        'lease_not_current',
        'Companion lease has been superseded by a newer session',
        409,
      );
    }
    if (record.deadlineMs <= monotonicNow()) {
      leasesById.delete(leaseId);
      currentLeaseIdByIdentity.delete(key);
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
        !satisfiesVersionRange(
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
      if (!satisfiesVersionRange(request.hostVersion, catalog.hostVersionRange, 'Host version')) {
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
      leasesById.set(leaseId, record);
      const key = identityKey(request.adapterId, request.instanceId);
      negotiatedIdentityKeys.add(key);
      const previousLeaseId = currentLeaseIdByIdentity.get(key);
      if (previousLeaseId !== undefined) {
        leasesById.delete(previousLeaseId);
      }
      currentLeaseIdByIdentity.set(key, leaseId);
      legacyPresenceExpiryByIdentity.delete(key);
      return responseFor(record);
    },

    heartbeat(input) {
      const request = companionHeartbeatRequestSchema.parse(input);
      const record = currentRecord(request.leaseId, request.adapterId, request.instanceId);
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
        contractVersion: '1.0.0',
        leaseId: record.leaseId,
        sequence: request.sequence,
        expiresAt: new Date(record.expiresAtWallClockMs).toISOString(),
      });
    },

    authorize(leaseId, adapterId, instanceId) {
      const record = currentRecord(leaseId, adapterId, instanceId);
      return { hello: record.hello, lease: responseFor(record) };
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
      return currentLeaseIdByIdentity.has(key) || legacyPresenceExpiryByIdentity.has(key);
    },
  };
}
