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
