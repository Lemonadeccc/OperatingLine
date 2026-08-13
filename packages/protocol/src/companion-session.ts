import { z } from 'zod';

import { adapterCapabilitiesSchema } from './adapter.js';
import { guideProtocolVersionSchema } from './guide.js';
import { catalogVersionSchema } from './version.js';

export const companionSessionContractVersion = '1.0.0' as const;
export const companionSessionContractVersionSchema = z.literal(companionSessionContractVersion);

const advertisedGuideProtocolVersionSchema = catalogVersionSchema;
const supportedGuideProtocolVersionsSchema = z
  .array(advertisedGuideProtocolVersionSchema)
  .min(1)
  .meta({ uniqueItems: true })
  .refine((versions) => new Set(versions).size === versions.length, {
    message: 'supportedGuideProtocolVersions must contain unique versions',
  });

export const companionSessionHelloRequestSchema = z.strictObject({
  contractVersion: companionSessionContractVersionSchema,
  adapterId: z.string().trim().min(1).max(180),
  instanceId: z.uuid(),
  companionVersion: catalogVersionSchema,
  hostVersion: z.string().trim().min(1).max(180),
  supportedGuideProtocolVersions: supportedGuideProtocolVersionsSchema,
  catalogVersion: catalogVersionSchema,
  capabilities: adapterCapabilitiesSchema,
});
export type CompanionSessionHelloRequest = z.infer<typeof companionSessionHelloRequestSchema>;

export const companionSessionHelloResponseSchema = z
  .strictObject({
    contractVersion: companionSessionContractVersionSchema,
    leaseId: z.uuid(),
    negotiatedGuideProtocolVersion: guideProtocolVersionSchema,
    catalogVersion: catalogVersionSchema,
    capabilities: adapterCapabilitiesSchema,
    heartbeatIntervalMs: z.number().int().positive().safe(),
    leaseTtlMs: z.number().int().positive().safe(),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .superRefine((response, context) => {
    if (response.leaseTtlMs <= response.heartbeatIntervalMs) {
      context.addIssue({
        code: 'custom',
        path: ['leaseTtlMs'],
        message: 'leaseTtlMs must be greater than heartbeatIntervalMs',
      });
    }
  });
export type CompanionSessionHelloResponse = z.infer<typeof companionSessionHelloResponseSchema>;

export const companionHeartbeatRequestSchema = z.strictObject({
  contractVersion: companionSessionContractVersionSchema,
  leaseId: z.uuid(),
  adapterId: z.string().trim().min(1).max(180),
  instanceId: z.uuid(),
  sequence: z.number().int().positive().safe(),
});
export type CompanionHeartbeatRequest = z.infer<typeof companionHeartbeatRequestSchema>;

export const companionHeartbeatResponseSchema = z.strictObject({
  contractVersion: companionSessionContractVersionSchema,
  leaseId: z.uuid(),
  sequence: z.number().int().positive().safe(),
  expiresAt: z.iso.datetime({ offset: true }),
});
export type CompanionHeartbeatResponse = z.infer<typeof companionHeartbeatResponseSchema>;
