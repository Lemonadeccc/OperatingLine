import { randomUUID } from 'node:crypto';

import { blenderActionCatalog } from '@operatingline/blender-action-catalog';
import { CompanionLeaseError, createCompanionLeaseManager } from '@operatingline/orchestrator';
import { describe, expect, it } from 'vitest';

const capabilities = {
  presentation: {
    taskTree: 'native',
    viewportOverlay: 'native',
    interactiveAnchors: 'emulated',
  },
  execution: {
    inspect: 'native',
    invokeActions: 'native',
    screenshot: 'native',
    rollbackModes: ['compensating_action', 'native_undo'],
  },
  runtime: {
    dispatch: 'main_thread_serial',
    network: 'native',
    persistentProjectState: 'native',
  },
} as const;

function hello(instanceId = randomUUID()) {
  return {
    contractVersion: '1.0.0' as const,
    adapterId: 'blender',
    instanceId,
    companionVersion: '0.1.0',
    hostVersion: '4.5.3',
    supportedGuideProtocolVersions: ['1.1.0', '1.4.0', '1.5.0'],
    catalogVersion: blenderActionCatalog.catalogVersion,
    capabilities,
  };
}

function helloV11(
  overrides: Partial<{
    instanceId: string;
    sessionId: string;
    documentIncarnationId: string;
  }> = {},
) {
  return {
    ...hello(overrides.instanceId),
    contractVersion: '1.1.0' as const,
    sessionId: overrides.sessionId ?? randomUUID(),
    documentIncarnationId: overrides.documentIncarnationId ?? randomUUID(),
  };
}

function heartbeatV11(request: ReturnType<typeof helloV11>, leaseId: string, sequence = 1) {
  return {
    contractVersion: '1.1.0' as const,
    leaseId,
    adapterId: request.adapterId,
    instanceId: request.instanceId,
    sessionId: request.sessionId,
    documentIncarnationId: request.documentIncarnationId,
    sequence,
  };
}

function expectConflict(action: () => unknown, code: CompanionLeaseError['code']): void {
  try {
    action();
    throw new Error('Expected a CompanionLeaseError');
  } catch (error) {
    expect(error).toBeInstanceOf(CompanionLeaseError);
    expect(error).toMatchObject({ code, statusCode: 409 });
  }
}

describe('companion lease manager', () => {
  it('negotiates the newest shared Guide version and renews idempotently', () => {
    let wallClockNow = Date.parse('2026-08-13T04:00:00.000Z');
    let monotonicNow = 1_000;
    const manager = createCompanionLeaseManager({
      monotonicNow: () => monotonicNow,
      wallClockNow: () => wallClockNow,
      heartbeatIntervalMs: 100,
      leaseTtlMs: 300,
    });
    const request = hello();
    const lease = manager.establish(request, blenderActionCatalog);

    expect(lease).toMatchObject({
      negotiatedGuideProtocolVersion: '1.5.0',
      catalogVersion: blenderActionCatalog.catalogVersion,
      capabilities,
      heartbeatIntervalMs: 100,
      leaseTtlMs: 300,
      expiresAt: '2026-08-13T04:00:00.300Z',
    });
    expect(manager.hasActivePresence(request.adapterId, request.instanceId)).toBe(true);

    monotonicNow += 100;
    wallClockNow += 100;
    const heartbeat = {
      contractVersion: '1.0.0' as const,
      leaseId: lease.leaseId,
      adapterId: request.adapterId,
      instanceId: request.instanceId,
      sequence: 1,
    };
    expect(manager.heartbeat(heartbeat)).toMatchObject({
      leaseId: lease.leaseId,
      sequence: 1,
      expiresAt: '2026-08-13T04:00:00.400Z',
    });
    monotonicNow += 50;
    wallClockNow += 50;
    expect(manager.heartbeat(heartbeat).expiresAt).toBe('2026-08-13T04:00:00.400Z');
  });

  it('echoes v1.1 session identity and preserves it across heartbeat and runtime restart', () => {
    let wallClockNow = Date.parse('2026-08-13T04:00:00.000Z');
    let monotonicNow = 1_000;
    const options = {
      monotonicNow: () => monotonicNow,
      wallClockNow: () => wallClockNow,
      heartbeatIntervalMs: 100,
      leaseTtlMs: 300,
    };
    const request = helloV11();
    const manager = createCompanionLeaseManager(options);
    const lease = manager.establish(request, blenderActionCatalog);

    expect(lease).toMatchObject({
      contractVersion: '1.1.0',
      sessionId: request.sessionId,
      documentIncarnationId: request.documentIncarnationId,
    });
    monotonicNow += 100;
    wallClockNow += 100;
    const heartbeat = manager.heartbeat(heartbeatV11(request, lease.leaseId));
    expect(heartbeat).toMatchObject({
      contractVersion: '1.1.0',
      leaseId: lease.leaseId,
      sessionId: request.sessionId,
      documentIncarnationId: request.documentIncarnationId,
      expiresAt: '2026-08-13T04:00:00.400Z',
    });
    expect(manager.authorizeDocumentSession(lease.leaseId, 'blender', request.instanceId)).toEqual({
      hello: request,
      lease: { ...lease, expiresAt: '2026-08-13T04:00:00.400Z' },
    });

    const reconnected = manager.establish(request, blenderActionCatalog);
    expect(reconnected.leaseId).not.toBe(lease.leaseId);
    expectConflict(
      () => manager.authorizeDocumentSession(lease.leaseId, 'blender', request.instanceId),
      'lease_not_current',
    );
    expect(
      manager.authorizeDocumentSession(reconnected.leaseId, 'blender', request.instanceId),
    ).toMatchObject({ hello: request, lease: { leaseId: reconnected.leaseId } });

    const restarted = createCompanionLeaseManager(options);
    const replacement = restarted.establish(request, blenderActionCatalog);
    expect(replacement.leaseId).not.toBe(reconnected.leaseId);
    expect(replacement).toMatchObject({
      sessionId: request.sessionId,
      documentIncarnationId: request.documentIncarnationId,
    });
  });

  it('supersedes by session across target and document rotation and cleans both indexes', () => {
    const manager = createCompanionLeaseManager();
    const sessionId = randomUUID();
    const firstRequest = helloV11({ sessionId });
    const first = manager.establish(firstRequest, blenderActionCatalog);
    const secondRequest = helloV11({ sessionId });
    const second = manager.establish(secondRequest, blenderActionCatalog);

    expect(firstRequest.instanceId).not.toBe(secondRequest.instanceId);
    expect(firstRequest.documentIncarnationId).not.toBe(secondRequest.documentIncarnationId);
    expect(manager.hasActivePresence('blender', firstRequest.instanceId)).toBe(false);
    expect(manager.hasActivePresence('blender', secondRequest.instanceId)).toBe(true);
    expectConflict(
      () => manager.heartbeat(heartbeatV11(firstRequest, first.leaseId)),
      'lease_not_current',
    );
    expectConflict(
      () => manager.authorize(first.leaseId, 'blender', firstRequest.instanceId),
      'lease_not_current',
    );
    expect(
      manager.authorizeDocumentSession(second.leaseId, 'blender', secondRequest.instanceId),
    ).toMatchObject({
      hello: {
        sessionId,
        documentIncarnationId: secondRequest.documentIncarnationId,
      },
    });
  });

  it('supersedes a target on process/session rotation and removes the old session index', () => {
    const manager = createCompanionLeaseManager();
    const instanceId = randomUUID();
    const firstRequest = helloV11({ instanceId });
    const first = manager.establish(firstRequest, blenderActionCatalog);
    const secondRequest = helloV11({ instanceId });
    const second = manager.establish(secondRequest, blenderActionCatalog);

    expect(firstRequest.sessionId).not.toBe(secondRequest.sessionId);
    expectConflict(
      () => manager.authorizeDocumentSession(first.leaseId, 'blender', instanceId),
      'lease_not_current',
    );
    expect(manager.authorizeDocumentSession(second.leaseId, 'blender', instanceId).hello).toEqual(
      secondRequest,
    );

    const movedFirstSession = helloV11({ sessionId: firstRequest.sessionId });
    const movedLease = manager.establish(movedFirstSession, blenderActionCatalog);
    expect(manager.hasActivePresence('blender', instanceId)).toBe(true);
    expect(manager.hasActivePresence('blender', movedFirstSession.instanceId)).toBe(true);
    expect(
      manager.authorizeDocumentSession(movedLease.leaseId, 'blender', movedFirstSession.instanceId)
        .hello.sessionId,
    ).toBe(firstRequest.sessionId);
  });

  it('cleans the session and target indexes when a v1.1 lease expires', () => {
    let monotonicNow = 1_000;
    const manager = createCompanionLeaseManager({
      monotonicNow: () => monotonicNow,
      heartbeatIntervalMs: 100,
      leaseTtlMs: 300,
    });
    const request = helloV11();
    const lease = manager.establish(request, blenderActionCatalog);

    monotonicNow = 1_301;
    expect(manager.hasActivePresence('blender', request.instanceId)).toBe(false);
    expectConflict(
      () => manager.authorizeDocumentSession(lease.leaseId, 'blender', request.instanceId),
      'lease_not_current',
    );

    const movedRequest = helloV11({ sessionId: request.sessionId });
    const movedLease = manager.establish(movedRequest, blenderActionCatalog);
    expect(manager.hasActivePresence('blender', request.instanceId)).toBe(false);
    expect(
      manager.authorizeDocumentSession(movedLease.leaseId, 'blender', movedRequest.instanceId),
    ).toMatchObject({ hello: { sessionId: request.sessionId } });
  });

  it('rejects heartbeat contract or document identity mismatch without renewing', () => {
    let monotonicNow = 1_000;
    let wallClockNow = Date.parse('2026-08-13T04:00:00.000Z');
    const manager = createCompanionLeaseManager({
      monotonicNow: () => monotonicNow,
      wallClockNow: () => wallClockNow,
      heartbeatIntervalMs: 100,
      leaseTtlMs: 300,
    });
    const request = helloV11();
    const lease = manager.establish(request, blenderActionCatalog);

    monotonicNow += 100;
    wallClockNow += 100;
    expectConflict(
      () =>
        manager.heartbeat({
          ...heartbeatV11(request, lease.leaseId),
          documentIncarnationId: randomUUID(),
        }),
      'lease_identity_mismatch',
    );
    expectConflict(
      () =>
        manager.heartbeat({
          contractVersion: '1.0.0',
          leaseId: lease.leaseId,
          adapterId: request.adapterId,
          instanceId: request.instanceId,
          sequence: 1,
        }),
      'lease_identity_mismatch',
    );
    expect(manager.authorize(lease.leaseId, 'blender', request.instanceId).lease.expiresAt).toBe(
      '2026-08-13T04:00:00.300Z',
    );
  });

  it('rejects v1.0 leases for document authorization without inventing identity', () => {
    const manager = createCompanionLeaseManager();
    const request = hello();
    const lease = manager.establish(request, blenderActionCatalog);
    expectConflict(
      () => manager.authorizeDocumentSession(lease.leaseId, request.adapterId, request.instanceId),
      'lease_identity_mismatch',
    );
    expect(manager.authorize(lease.leaseId, request.adapterId, request.instanceId).hello).toEqual(
      request,
    );
  });

  it('rejects historical-only clients because payload version projection is not implemented', () => {
    const manager = createCompanionLeaseManager();
    expect(() =>
      manager.establish(
        { ...hello(), supportedGuideProtocolVersions: ['1.0.0', '1.1.0', '1.4.0'] },
        blenderActionCatalog,
      ),
    ).toThrow(/version projection is not available/);
  });

  it('expires idle leases and rejects stale or superseded heartbeats', () => {
    let monotonicNow = 1_000;
    const manager = createCompanionLeaseManager({
      monotonicNow: () => monotonicNow,
      heartbeatIntervalMs: 100,
      leaseTtlMs: 300,
    });
    const request = hello();
    const first = manager.establish(request, blenderActionCatalog);
    const second = manager.establish(request, blenderActionCatalog);

    expect(() =>
      manager.heartbeat({
        contractVersion: '1.0.0',
        leaseId: first.leaseId,
        adapterId: request.adapterId,
        instanceId: request.instanceId,
        sequence: 1,
      }),
    ).toThrowError(CompanionLeaseError);

    manager.heartbeat({
      contractVersion: '1.0.0',
      leaseId: second.leaseId,
      adapterId: request.adapterId,
      instanceId: request.instanceId,
      sequence: 2,
    });
    expect(() =>
      manager.heartbeat({
        contractVersion: '1.0.0',
        leaseId: second.leaseId,
        adapterId: request.adapterId,
        instanceId: request.instanceId,
        sequence: 1,
      }),
    ).toThrowError(/older than/);

    monotonicNow = 1_301;
    expect(manager.hasActivePresence(request.adapterId, request.instanceId)).toBe(false);
    expect(() => manager.authorize(second.leaseId, request.adapterId, request.instanceId)).toThrow(
      /unknown|expired/,
    );
  });

  it('provides bounded legacy presence without allowing it to impersonate a negotiated lease', () => {
    let monotonicNow = 2_000;
    const manager = createCompanionLeaseManager({
      monotonicNow: () => monotonicNow,
      heartbeatIntervalMs: 100,
      leaseTtlMs: 300,
    });
    const request = hello();

    manager.authorizeLegacy(request.adapterId, request.instanceId);
    expect(manager.hasActivePresence(request.adapterId, request.instanceId)).toBe(false);
    manager.observeLegacy(request.adapterId, request.instanceId);
    expect(manager.hasActivePresence(request.adapterId, request.instanceId)).toBe(true);
    monotonicNow = 2_301;
    expect(manager.hasActivePresence(request.adapterId, request.instanceId)).toBe(false);

    const lease = manager.establish(request, blenderActionCatalog);
    expect(() => manager.observeLegacy(request.adapterId, request.instanceId)).toThrow(/forbidden/);
    monotonicNow = 2_500;
    expect(manager.hasActivePresence(request.adapterId, request.instanceId)).toBe(true);
    expect(manager.authorize(lease.leaseId, request.adapterId, request.instanceId).hello).toEqual(
      request,
    );
    monotonicNow = 2_801;
    expect(manager.hasActivePresence(request.adapterId, request.instanceId)).toBe(false);
    expect(() => manager.authorizeLegacy(request.adapterId, request.instanceId)).toThrow(
      /downgrade is forbidden/,
    );
    expect(() => manager.observeLegacy(request.adapterId, request.instanceId)).toThrow(
      /downgrade is forbidden/,
    );
  });

  it('uses a monotonic deadline when the system wall clock jumps', () => {
    let monotonicNow = 5_000;
    let wallClockNow = Date.parse('2026-08-13T04:00:00.000Z');
    const manager = createCompanionLeaseManager({
      monotonicNow: () => monotonicNow,
      wallClockNow: () => wallClockNow,
      heartbeatIntervalMs: 100,
      leaseTtlMs: 300,
    });
    const request = hello();
    const lease = manager.establish(request, blenderActionCatalog);

    wallClockNow -= 86_400_000;
    monotonicNow = 5_299;
    expect(manager.hasActivePresence(request.adapterId, request.instanceId)).toBe(true);
    wallClockNow += 10 * 86_400_000;
    expect(manager.authorize(lease.leaseId, request.adapterId, request.instanceId).hello).toEqual(
      request,
    );

    monotonicNow = 5_301;
    expect(manager.hasActivePresence(request.adapterId, request.instanceId)).toBe(false);
  });

  it('can fail closed when legacy companion compatibility is disabled', () => {
    const manager = createCompanionLeaseManager({ allowLegacyCompanions: false });
    expect(() => manager.authorizeLegacy('blender', randomUUID())).toThrow(/requires a negotiated/);
    expect(() => manager.observeLegacy('blender', randomUUID())).toThrow(/requires a negotiated/);
  });

  it('fails closed for incompatible protocols and catalog identities', () => {
    const manager = createCompanionLeaseManager();
    expect(() =>
      manager.establish(
        { ...hello(), supportedGuideProtocolVersions: ['2.0.0'] },
        blenderActionCatalog,
      ),
    ).toThrow(/action catalog protocol|do not share/);
    expect(() =>
      manager.establish({ ...hello(), catalogVersion: '1.0.0' }, blenderActionCatalog),
    ).toThrow(/catalog identity/);
    expect(() =>
      manager.establish({ ...hello(), companionVersion: '0.2.0' }, blenderActionCatalog),
    ).toThrow(/adapter range/);
    expect(() =>
      manager.establish({ ...hello(), hostVersion: '5.2.0' }, blenderActionCatalog),
    ).toThrow(/host range/);
    expect(() =>
      manager.establish(
        { ...hello(), supportedGuideProtocolVersions: ['1.4.0', '1.5.0'] },
        { ...blenderActionCatalog, protocolVersion: '1.1.0' },
      ),
    ).toThrow(/action catalog protocol/);
  });

  it('rejects capability profiles that cannot execute the installed catalog', () => {
    const manager = createCompanionLeaseManager();
    expect(() =>
      manager.establish(
        {
          ...hello(),
          capabilities: {
            ...capabilities,
            execution: { ...capabilities.execution, rollbackModes: ['native_undo'] },
          },
        },
        blenderActionCatalog,
      ),
    ).toThrow(/do not cover/);
    expect(() =>
      manager.establish(
        {
          ...hello(),
          capabilities: {
            ...capabilities,
            execution: { ...capabilities.execution, invokeActions: 'unsupported' as const },
          },
        },
        blenderActionCatalog,
      ),
    ).toThrow(/action invocation unsupported/);
  });
});
