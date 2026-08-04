import { z } from 'zod';

export const capabilitySupportSchema = z.enum(['native', 'emulated', 'unsupported']);
export type CapabilitySupport = z.infer<typeof capabilitySupportSchema>;

export const rollbackModeSchema = z.enum([
  'native_undo',
  'checkpoint_restore',
  'compensating_action',
  'unsupported',
]);
export type RollbackMode = z.infer<typeof rollbackModeSchema>;

export const adapterCapabilitiesSchema = z.strictObject({
  presentation: z.strictObject({
    taskTree: capabilitySupportSchema,
    viewportOverlay: capabilitySupportSchema,
    interactiveAnchors: capabilitySupportSchema,
  }),
  execution: z.strictObject({
    inspect: capabilitySupportSchema,
    invokeActions: capabilitySupportSchema,
    screenshot: capabilitySupportSchema,
    rollbackModes: z.array(rollbackModeSchema),
  }),
  runtime: z.strictObject({
    dispatch: z.enum(['main_thread_serial', 'host_managed', 'external_process']),
    network: capabilitySupportSchema,
    persistentProjectState: capabilitySupportSchema,
  }),
});
export type AdapterCapabilities = z.infer<typeof adapterCapabilitiesSchema>;

export const adapterStatusSchema = z.strictObject({
  id: z.string().min(1),
  version: z.string().min(1),
  hostVersion: z.string().min(1).optional(),
  protocolVersions: z.array(z.string().min(1)).min(1),
  connected: z.boolean(),
  capabilities: adapterCapabilitiesSchema,
});
export type AdapterStatus = z.infer<typeof adapterStatusSchema>;
