import { z } from 'zod';

import { adapterStatusSchema } from './adapter.js';

export const runtimePhaseSchema = z.enum(['starting', 'ready', 'stopped', 'error']);
export type RuntimePhase = z.infer<typeof runtimePhaseSchema>;

export const runtimeStatusSchema = z.strictObject({
  version: z.string().min(1),
  phase: runtimePhaseSchema,
  database: z.enum(['starting', 'ready', 'error']),
  adapters: z.array(adapterStatusSchema),
  mcpEndpoint: z.string().url().nullable(),
  error: z.string().optional(),
});
export type RuntimeStatus = z.infer<typeof runtimeStatusSchema>;

export const runtimeStartCommandSchema = z.strictObject({
  type: z.literal('runtime.start'),
  databasePath: z.string().min(1),
  accessToken: z.string().min(16),
});

export const runtimeStopCommandSchema = z.strictObject({
  type: z.literal('runtime.stop'),
});

export const runtimeGetStatusCommandSchema = z.strictObject({
  type: z.literal('runtime.get-status'),
});

export const runtimeCommandSchema = z.discriminatedUnion('type', [
  runtimeStartCommandSchema,
  runtimeStopCommandSchema,
  runtimeGetStatusCommandSchema,
]);
export type RuntimeCommand = z.infer<typeof runtimeCommandSchema>;

export const runtimeStatusMessageSchema = z.strictObject({
  type: z.literal('runtime.status'),
  status: runtimeStatusSchema,
});

export const runtimeErrorMessageSchema = z.strictObject({
  type: z.literal('runtime.error'),
  error: z.string().min(1),
});

export const runtimeProcessMessageSchema = z.discriminatedUnion('type', [
  runtimeStatusMessageSchema,
  runtimeErrorMessageSchema,
]);
export type RuntimeProcessMessage = z.infer<typeof runtimeProcessMessageSchema>;
