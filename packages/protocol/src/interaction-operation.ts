import { z } from 'zod';

const boundedStableIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z][A-Za-z0-9_.:/-]*$/u);

export const interactionOperationKindValues = [
  'invoke_menu',
  'select_menu_item',
  'send_shortcut',
  'open_adjust_last_operation',
  'set_f9_control',
  'confirm_f9',
  'assert_interaction_state',
] as const;
export const interactionOperationKindSchema = z.enum(interactionOperationKindValues);
export type InteractionOperationKind = z.infer<typeof interactionOperationKindSchema>;

export const invokeMenuInteractionOperationSchema = z.strictObject({
  kind: z.literal('invoke_menu'),
  menuHostId: boundedStableIdSchema,
});
export type InvokeMenuInteractionOperation = z.infer<typeof invokeMenuInteractionOperationSchema>;

export const selectMenuItemInteractionOperationSchema = z.strictObject({
  kind: z.literal('select_menu_item'),
  menuHostId: boundedStableIdSchema,
  itemOperatorId: boundedStableIdSchema,
});
export type SelectMenuItemInteractionOperation = z.infer<
  typeof selectMenuItemInteractionOperationSchema
>;

export const sendShortcutInteractionOperationSchema = z.strictObject({
  kind: z.literal('send_shortcut'),
  shortcutId: boundedStableIdSchema,
});
export type SendShortcutInteractionOperation = z.infer<
  typeof sendShortcutInteractionOperationSchema
>;

export const openAdjustLastOperationInteractionOperationSchema = z.strictObject({
  kind: z.literal('open_adjust_last_operation'),
  expectedOperatorId: boundedStableIdSchema,
});
export type OpenAdjustLastOperationInteractionOperation = z.infer<
  typeof openAdjustLastOperationInteractionOperationSchema
>;

const boundedTypedNumberSchema = z.number().finite().min(-1_000_000_000_000).max(1_000_000_000_000);

export const f9TypedValueSchema = z.union([
  z.string().trim().min(1).max(1_000),
  boundedTypedNumberSchema,
  z.boolean(),
  z.array(boundedTypedNumberSchema).min(1).max(4),
]);
export type F9TypedValue = z.infer<typeof f9TypedValueSchema>;

export const setF9ControlInteractionOperationSchema = z.strictObject({
  kind: z.literal('set_f9_control'),
  expectedOperatorId: boundedStableIdSchema,
  controlHostId: boundedStableIdSchema,
  typedValue: f9TypedValueSchema,
});
export type SetF9ControlInteractionOperation = z.infer<
  typeof setF9ControlInteractionOperationSchema
>;

export const confirmF9InteractionOperationSchema = z.strictObject({
  kind: z.literal('confirm_f9'),
  expectedOperatorId: boundedStableIdSchema,
});
export type ConfirmF9InteractionOperation = z.infer<typeof confirmF9InteractionOperationSchema>;

export const assertInteractionStateOperationSchema = z.strictObject({
  kind: z.literal('assert_interaction_state'),
  workspace: boundedStableIdSchema,
  editor: boundedStableIdSchema,
  mode: boundedStableIdSchema,
  selection: boundedStableIdSchema,
  modalState: boundedStableIdSchema,
});
export type AssertInteractionStateOperation = z.infer<typeof assertInteractionStateOperationSchema>;

/**
 * Closed catalog-driven interaction surface. Coordinates, raw HID events, free-form
 * keys, Python, and arbitrary operator invocation have no representable variant.
 */
export const interactionOperationSchema = z.discriminatedUnion('kind', [
  invokeMenuInteractionOperationSchema,
  selectMenuItemInteractionOperationSchema,
  sendShortcutInteractionOperationSchema,
  openAdjustLastOperationInteractionOperationSchema,
  setF9ControlInteractionOperationSchema,
  confirmF9InteractionOperationSchema,
  assertInteractionStateOperationSchema,
]);
export type InteractionOperation = z.infer<typeof interactionOperationSchema>;

/** Catalog boundary used by hosts to authorize syntactically valid interaction ids. */
export interface InteractionOperationCatalogResolver {
  isAuthorizedInteractionId(
    field: 'menuHostId' | 'itemOperatorId' | 'shortcutId' | 'expectedOperatorId' | 'controlHostId',
    id: string,
    operation: InteractionOperation,
  ): boolean;
}

export function isInteractionOperationCatalogAuthorized(
  input: unknown,
  resolver: InteractionOperationCatalogResolver,
): input is InteractionOperation {
  const parsed = interactionOperationSchema.safeParse(input);
  if (!parsed.success) return false;
  const operation = parsed.data;
  const ids: Array<
    [
      'menuHostId' | 'itemOperatorId' | 'shortcutId' | 'expectedOperatorId' | 'controlHostId',
      string,
    ]
  > = [];
  if ('menuHostId' in operation) ids.push(['menuHostId', operation.menuHostId]);
  if ('itemOperatorId' in operation) ids.push(['itemOperatorId', operation.itemOperatorId]);
  if ('shortcutId' in operation) ids.push(['shortcutId', operation.shortcutId]);
  if ('expectedOperatorId' in operation)
    ids.push(['expectedOperatorId', operation.expectedOperatorId]);
  if ('controlHostId' in operation) ids.push(['controlHostId', operation.controlHostId]);
  return ids.every(([field, id]) => resolver.isAuthorizedInteractionId(field, id, operation));
}

export function assertInteractionOperationCatalogAuthorized(
  input: unknown,
  resolver: InteractionOperationCatalogResolver,
): InteractionOperation {
  const operation = interactionOperationSchema.parse(input);
  if (!isInteractionOperationCatalogAuthorized(operation, resolver)) {
    throw new Error('Interaction operation contains an id not authorized by the bound catalog');
  }
  return operation;
}
