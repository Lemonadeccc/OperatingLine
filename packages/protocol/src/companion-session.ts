import { z } from 'zod';

import { adapterCapabilitiesSchema } from './adapter.js';
import { guideProtocolVersionSchema } from './guide.js';
import { catalogVersionSchema } from './version.js';

export const companionSessionLegacyContractVersion = '1.0.0' as const;
export const companionSessionLegacyContractVersionSchema = z.literal(
  companionSessionLegacyContractVersion,
);
export const companionSessionContractVersion = '1.1.0' as const;
export const companionSessionContractVersionSchema = z.literal(companionSessionContractVersion);

const advertisedGuideProtocolVersionSchema = catalogVersionSchema;
const supportedGuideProtocolVersionsSchema = z
  .array(advertisedGuideProtocolVersionSchema)
  .min(1)
  .meta({ uniqueItems: true })
  .refine((versions) => new Set(versions).size === versions.length, {
    message: 'supportedGuideProtocolVersions must contain unique versions',
  });

const companionSessionHelloRequestFields = {
  adapterId: z.string().trim().min(1).max(180),
  instanceId: z.uuid(),
  companionVersion: catalogVersionSchema,
  hostVersion: z.string().trim().min(1).max(180),
  supportedGuideProtocolVersions: supportedGuideProtocolVersionsSchema,
  catalogVersion: catalogVersionSchema,
  capabilities: adapterCapabilitiesSchema,
};

export const companionSessionHelloRequestV10Schema = z.strictObject({
  contractVersion: companionSessionLegacyContractVersionSchema,
  ...companionSessionHelloRequestFields,
});
export type CompanionSessionHelloRequestV10 = z.infer<typeof companionSessionHelloRequestV10Schema>;

export const companionSessionHelloRequestV11Schema = z.strictObject({
  contractVersion: companionSessionContractVersionSchema,
  ...companionSessionHelloRequestFields,
  sessionId: z.uuid(),
  documentIncarnationId: z.uuid(),
});
export type CompanionSessionHelloRequestV11 = z.infer<typeof companionSessionHelloRequestV11Schema>;

export const companionSessionHelloRequestSchema = z.discriminatedUnion('contractVersion', [
  companionSessionHelloRequestV10Schema,
  companionSessionHelloRequestV11Schema,
]);
export type CompanionSessionHelloRequest = z.infer<typeof companionSessionHelloRequestSchema>;

const companionSessionHelloResponseFields = {
  leaseId: z.uuid(),
  negotiatedGuideProtocolVersion: guideProtocolVersionSchema,
  catalogVersion: catalogVersionSchema,
  capabilities: adapterCapabilitiesSchema,
  heartbeatIntervalMs: z.number().int().positive().safe(),
  leaseTtlMs: z.number().int().positive().safe(),
  expiresAt: z.iso.datetime({ offset: true }),
};

function validateHelloResponseLeaseTtl(
  response: { heartbeatIntervalMs: number; leaseTtlMs: number },
  context: z.RefinementCtx,
): void {
  if (response.leaseTtlMs <= response.heartbeatIntervalMs) {
    context.addIssue({
      code: 'custom',
      path: ['leaseTtlMs'],
      message: 'leaseTtlMs must be greater than heartbeatIntervalMs',
    });
  }
}

export const companionSessionHelloResponseV10Schema = z
  .strictObject({
    contractVersion: companionSessionLegacyContractVersionSchema,
    ...companionSessionHelloResponseFields,
  })
  .superRefine(validateHelloResponseLeaseTtl);
export type CompanionSessionHelloResponseV10 = z.infer<
  typeof companionSessionHelloResponseV10Schema
>;

export const companionSessionHelloResponseV11Schema = z
  .strictObject({
    contractVersion: companionSessionContractVersionSchema,
    ...companionSessionHelloResponseFields,
    sessionId: z.uuid(),
    documentIncarnationId: z.uuid(),
  })
  .superRefine(validateHelloResponseLeaseTtl);
export type CompanionSessionHelloResponseV11 = z.infer<
  typeof companionSessionHelloResponseV11Schema
>;

export const companionSessionHelloResponseSchema = z.union([
  companionSessionHelloResponseV10Schema,
  companionSessionHelloResponseV11Schema,
]);
export type CompanionSessionHelloResponse = z.infer<typeof companionSessionHelloResponseSchema>;

const companionHeartbeatRequestFields = {
  leaseId: z.uuid(),
  adapterId: z.string().trim().min(1).max(180),
  instanceId: z.uuid(),
  sequence: z.number().int().positive().safe(),
};

export const companionHeartbeatRequestV10Schema = z.strictObject({
  contractVersion: companionSessionLegacyContractVersionSchema,
  ...companionHeartbeatRequestFields,
});
export type CompanionHeartbeatRequestV10 = z.infer<typeof companionHeartbeatRequestV10Schema>;

export const companionHeartbeatRequestV11Schema = z.strictObject({
  contractVersion: companionSessionContractVersionSchema,
  ...companionHeartbeatRequestFields,
  sessionId: z.uuid(),
  documentIncarnationId: z.uuid(),
});
export type CompanionHeartbeatRequestV11 = z.infer<typeof companionHeartbeatRequestV11Schema>;

export const companionHeartbeatRequestSchema = z.discriminatedUnion('contractVersion', [
  companionHeartbeatRequestV10Schema,
  companionHeartbeatRequestV11Schema,
]);
export type CompanionHeartbeatRequest = z.infer<typeof companionHeartbeatRequestSchema>;

const companionHeartbeatResponseFields = {
  leaseId: z.uuid(),
  sequence: z.number().int().positive().safe(),
  expiresAt: z.iso.datetime({ offset: true }),
};

export const companionHeartbeatResponseV10Schema = z.strictObject({
  contractVersion: companionSessionLegacyContractVersionSchema,
  ...companionHeartbeatResponseFields,
});
export type CompanionHeartbeatResponseV10 = z.infer<typeof companionHeartbeatResponseV10Schema>;

export const companionHeartbeatResponseV11Schema = z.strictObject({
  contractVersion: companionSessionContractVersionSchema,
  ...companionHeartbeatResponseFields,
  sessionId: z.uuid(),
  documentIncarnationId: z.uuid(),
});
export type CompanionHeartbeatResponseV11 = z.infer<typeof companionHeartbeatResponseV11Schema>;

export const companionHeartbeatResponseSchema = z.discriminatedUnion('contractVersion', [
  companionHeartbeatResponseV10Schema,
  companionHeartbeatResponseV11Schema,
]);
export type CompanionHeartbeatResponse = z.infer<typeof companionHeartbeatResponseSchema>;

export function isCompanionSessionV11<T extends { readonly contractVersion: '1.0.0' | '1.1.0' }>(
  value: T,
): value is Extract<T, { readonly contractVersion: '1.1.0' }> {
  return value.contractVersion === companionSessionContractVersion;
}
