import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  companionSessionContractVersion,
  companionHeartbeatRequestSchema,
  companionHeartbeatResponseSchema,
  companionSessionHelloRequestSchema,
  companionSessionHelloResponseSchema,
} from '@operatingline/protocol';
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
    rollbackModes: ['native_undo'],
  },
  runtime: {
    dispatch: 'main_thread_serial',
    network: 'native',
    persistentProjectState: 'native',
  },
} as const;

function helloRequest() {
  return {
    contractVersion: companionSessionContractVersion,
    adapterId: 'blender',
    instanceId: randomUUID(),
    companionVersion: '0.1.0',
    hostVersion: '4.5.3',
    supportedGuideProtocolVersions: ['1.4.0', '1.5.0'],
    catalogVersion: '1.11.0',
    capabilities,
  } as const;
}

function helloResponse() {
  return {
    contractVersion: companionSessionContractVersion,
    leaseId: randomUUID(),
    negotiatedGuideProtocolVersion: '1.5.0',
    catalogVersion: '1.11.0',
    capabilities,
    heartbeatIntervalMs: 5_000,
    leaseTtlMs: 15_000,
    expiresAt: '2026-08-13T12:00:15.000+08:00',
  } as const;
}

describe('companion session protocol', () => {
  it('accepts a strict hello request with unique advertised guide versions', () => {
    const request = helloRequest();
    expect(companionSessionHelloRequestSchema.parse(request)).toEqual(request);

    for (const invalid of [
      { ...request, contractVersion: '1.1.0' },
      { ...request, instanceId: 'not-a-uuid' },
      { ...request, companionVersion: 'next' },
      { ...request, supportedGuideProtocolVersions: [] },
      { ...request, supportedGuideProtocolVersions: ['1.5.0', '1.5.0'] },
      { ...request, ambientConsent: true },
    ]) {
      expect(companionSessionHelloRequestSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it('requires a hello lease TTL longer than the heartbeat interval', () => {
    const response = helloResponse();
    expect(companionSessionHelloResponseSchema.parse(response)).toEqual(response);

    for (const invalid of [
      { ...response, negotiatedGuideProtocolVersion: '2.0.0' },
      { ...response, heartbeatIntervalMs: 0 },
      { ...response, leaseTtlMs: response.heartbeatIntervalMs },
      { ...response, leaseTtlMs: response.heartbeatIntervalMs - 1 },
      { ...response, expiresAt: '2026-08-13T12:00:15' },
      { ...response, extra: true },
    ]) {
      expect(companionSessionHelloResponseSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it('binds heartbeat renewal to the exact lease and companion instance', () => {
    const request = {
      contractVersion: companionSessionContractVersion,
      leaseId: randomUUID(),
      adapterId: 'blender',
      instanceId: randomUUID(),
      sequence: 1,
    } as const;
    const response = {
      contractVersion: companionSessionContractVersion,
      leaseId: request.leaseId,
      sequence: request.sequence,
      expiresAt: '2026-08-13T12:00:20.000Z',
    } as const;

    expect(companionHeartbeatRequestSchema.parse(request)).toEqual(request);
    expect(companionHeartbeatResponseSchema.parse(response)).toEqual(response);

    expect(companionHeartbeatRequestSchema.safeParse({ ...request, sequence: 0 }).success).toBe(
      false,
    );
    expect(companionHeartbeatRequestSchema.safeParse({ ...request, adapterId: ' ' }).success).toBe(
      false,
    );
    expect(
      companionHeartbeatResponseSchema.safeParse({ ...response, leaseId: 'expired' }).success,
    ).toBe(false);
    expect(companionHeartbeatResponseSchema.safeParse({ ...response, renewed: true }).success).toBe(
      false,
    );
  });

  it('generates four strict language-neutral schemas', () => {
    const filenames = [
      'companion-session-hello-request.schema.json',
      'companion-session-hello-response.schema.json',
      'companion-session-heartbeat-request.schema.json',
      'companion-session-heartbeat-response.schema.json',
    ];

    for (const filename of filenames) {
      const schema = JSON.parse(readFileSync(resolve('protocol/schemas/v1', filename), 'utf8')) as {
        $id?: string;
        additionalProperties?: boolean;
      };
      expect(schema.$id).toBe(
        `https://operatingline.dev/schema/v1/${filename.replace('.schema.json', '.json')}`,
      );
      expect(schema.additionalProperties).toBe(false);
    }

    const helloRequestSchema = JSON.parse(
      readFileSync(
        resolve('protocol/schemas/v1/companion-session-hello-request.schema.json'),
        'utf8',
      ),
    ) as {
      properties?: {
        supportedGuideProtocolVersions?: { uniqueItems?: boolean; minItems?: number };
      };
    };
    expect(helloRequestSchema.properties?.supportedGuideProtocolVersions).toMatchObject({
      minItems: 1,
      uniqueItems: true,
    });
  });
});
