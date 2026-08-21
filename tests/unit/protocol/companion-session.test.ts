import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  companionSessionContractVersion,
  companionSessionLegacyContractVersion,
  companionHeartbeatRequestSchema,
  companionHeartbeatResponseSchema,
  companionSessionHelloRequestSchema,
  companionSessionHelloResponseSchema,
  isCompanionSessionV11,
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

function helloRequestV10() {
  return {
    contractVersion: companionSessionLegacyContractVersion,
    adapterId: 'blender',
    instanceId: randomUUID(),
    companionVersion: '0.1.0',
    hostVersion: '4.5.3',
    supportedGuideProtocolVersions: ['1.4.0', '1.5.0'],
    catalogVersion: '1.11.0',
    capabilities,
  } as const;
}

function helloRequestV11() {
  return {
    ...helloRequestV10(),
    contractVersion: companionSessionContractVersion,
    sessionId: randomUUID(),
    documentIncarnationId: randomUUID(),
  } as const;
}

function helloResponseV10() {
  return {
    contractVersion: companionSessionLegacyContractVersion,
    leaseId: randomUUID(),
    negotiatedGuideProtocolVersion: '1.5.0',
    catalogVersion: '1.11.0',
    capabilities,
    heartbeatIntervalMs: 5_000,
    leaseTtlMs: 15_000,
    expiresAt: '2026-08-13T12:00:15.000+08:00',
  } as const;
}

function helloResponseV11() {
  return {
    ...helloResponseV10(),
    contractVersion: companionSessionContractVersion,
    sessionId: randomUUID(),
    documentIncarnationId: randomUUID(),
  } as const;
}

describe('companion session protocol', () => {
  it('publishes 1.1 as latest while preserving the exact strict 1.0 hello request', () => {
    expect(companionSessionContractVersion).toBe('1.1.0');
    expect(companionSessionLegacyContractVersion).toBe('1.0.0');

    const legacy = helloRequestV10();
    const current = helloRequestV11();
    expect(companionSessionHelloRequestSchema.parse(legacy)).toEqual(legacy);
    expect(companionSessionHelloRequestSchema.parse(current)).toEqual(current);
    expect(isCompanionSessionV11(legacy)).toBe(false);
    expect(isCompanionSessionV11(current)).toBe(true);

    for (const invalid of [
      { ...legacy, sessionId: randomUUID() },
      { ...legacy, documentIncarnationId: randomUUID() },
      { ...current, sessionId: undefined },
      { ...current, documentIncarnationId: undefined },
      { ...current, sessionId: 'not-a-uuid' },
      { ...current, ambientConsent: true },
      { ...current, supportedGuideProtocolVersions: [] },
      { ...current, supportedGuideProtocolVersions: ['1.5.0', '1.5.0'] },
    ]) {
      expect(companionSessionHelloRequestSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it('keeps hello responses strict, version-correlated, and TTL constrained', () => {
    const legacy = helloResponseV10();
    const current = helloResponseV11();
    expect(companionSessionHelloResponseSchema.parse(legacy)).toEqual(legacy);
    expect(companionSessionHelloResponseSchema.parse(current)).toEqual(current);

    for (const invalid of [
      { ...legacy, sessionId: randomUUID() },
      { ...current, documentIncarnationId: undefined },
      { ...current, leaseTtlMs: current.heartbeatIntervalMs },
      { ...current, expiresAt: '2026-08-13T12:00:15' },
      { ...current, extra: true },
    ]) {
      expect(companionSessionHelloResponseSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it('requires and echoes document identity only in 1.1 heartbeat shapes', () => {
    const legacyRequest = {
      contractVersion: companionSessionLegacyContractVersion,
      leaseId: randomUUID(),
      adapterId: 'blender',
      instanceId: randomUUID(),
      sequence: 1,
    } as const;
    const currentRequest = {
      ...legacyRequest,
      contractVersion: companionSessionContractVersion,
      sessionId: randomUUID(),
      documentIncarnationId: randomUUID(),
    } as const;
    const legacyResponse = {
      contractVersion: companionSessionLegacyContractVersion,
      leaseId: legacyRequest.leaseId,
      sequence: 1,
      expiresAt: '2026-08-13T12:00:20.000Z',
    } as const;
    const currentResponse = {
      ...legacyResponse,
      contractVersion: companionSessionContractVersion,
      sessionId: currentRequest.sessionId,
      documentIncarnationId: currentRequest.documentIncarnationId,
    } as const;

    expect(companionHeartbeatRequestSchema.parse(legacyRequest)).toEqual(legacyRequest);
    expect(companionHeartbeatRequestSchema.parse(currentRequest)).toEqual(currentRequest);
    expect(companionHeartbeatResponseSchema.parse(legacyResponse)).toEqual(legacyResponse);
    expect(companionHeartbeatResponseSchema.parse(currentResponse)).toEqual(currentResponse);

    for (const [schema, invalid] of [
      [companionHeartbeatRequestSchema, { ...legacyRequest, sessionId: randomUUID() }],
      [companionHeartbeatRequestSchema, { ...currentRequest, documentIncarnationId: undefined }],
      [companionHeartbeatRequestSchema, { ...currentRequest, sequence: 0 }],
      [
        companionHeartbeatResponseSchema,
        { ...legacyResponse, documentIncarnationId: randomUUID() },
      ],
      [companionHeartbeatResponseSchema, { ...currentResponse, sessionId: undefined }],
      [companionHeartbeatResponseSchema, { ...currentResponse, renewed: true }],
    ] as const) {
      expect(schema.safeParse(invalid).success).toBe(false);
    }
  });

  it('generates four schemas with two strict, non-mixable version branches', () => {
    const filenames = [
      'companion-session-hello-request.schema.json',
      'companion-session-hello-response.schema.json',
      'companion-session-heartbeat-request.schema.json',
      'companion-session-heartbeat-response.schema.json',
    ];

    for (const filename of filenames) {
      const schema = JSON.parse(readFileSync(resolve('protocol/schemas/v1', filename), 'utf8')) as {
        $id?: string;
        oneOf?: JsonSchemaBranch[];
        anyOf?: JsonSchemaBranch[];
      };
      expect(schema.$id).toBe(
        `https://operatingline.dev/schema/v1/${filename.replace('.schema.json', '.json')}`,
      );
      const variants = schema.oneOf ?? schema.anyOf;
      expect(variants).toHaveLength(2);
      expect(variants?.map((variant) => variant.properties?.contractVersion?.const)).toEqual([
        '1.0.0',
        '1.1.0',
      ]);
      for (const variant of variants ?? []) {
        expect(variant.additionalProperties).toBe(false);
        const isCurrent = variant.properties?.contractVersion?.const === '1.1.0';
        expect(variant.required?.includes('sessionId')).toBe(isCurrent);
        expect(variant.required?.includes('documentIncarnationId')).toBe(isCurrent);
        expect('sessionId' in (variant.properties ?? {})).toBe(isCurrent);
        expect('documentIncarnationId' in (variant.properties ?? {})).toBe(isCurrent);
      }
    }

    const helloRequest = JSON.parse(
      readFileSync(
        resolve('protocol/schemas/v1/companion-session-hello-request.schema.json'),
        'utf8',
      ),
    ) as { oneOf?: JsonSchemaBranch[] };
    for (const variant of helloRequest.oneOf ?? []) {
      expect(variant.properties?.supportedGuideProtocolVersions).toMatchObject({
        minItems: 1,
        uniqueItems: true,
      });
    }
  });
});

interface JsonSchemaBranch {
  readonly properties?: Record<
    string,
    { readonly const?: string; readonly minItems?: number; readonly uniqueItems?: boolean }
  >;
  readonly required?: string[];
  readonly additionalProperties?: boolean;
}
