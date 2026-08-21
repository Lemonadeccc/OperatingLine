import { z } from 'zod';
import { authoritySha256Schema } from './authority.js';
import { computeProtocolCanonicalJsonSha256 } from './canonical-json-value.js';
import {
  blenderExecutionDecisionReceiptSchema,
  blenderHistoryTransitionDecisionReceiptSchema,
  decisionConsumptionEventSchema,
  type BlenderExecutionDecisionReceipt,
  type BlenderHistoryTransitionDecisionReceipt,
  type DecisionConsumptionEvent,
} from './execution-decision.js';
import { guideStepIdSchema } from './guide.js';

export const procedureCompoundReplayFormatVersion = '1.0.0' as const;
export const procedureCompoundReplayFormatVersionSchema = z.literal(
  procedureCompoundReplayFormatVersion,
);

const boundedIdSchema = z.string().trim().min(1).max(256);
const instantSchema = z.iso.datetime({ offset: true });

export const procedureCompoundRecipeKindSchema = z.enum(['forward', 'back', 'redo']);
export type ProcedureCompoundRecipeKind = z.infer<typeof procedureCompoundRecipeKindSchema>;

export const procedureCompoundReplayStatusSchema = z.enum([
  'intent_recorded',
  'recovery_required',
  'forward_applied_locked',
  'restored_locked',
  'reapplied_locked',
  'history_conflict',
  'history_lost',
  'quarantined',
  'unlocked_final',
  'abandoned_baseline',
]);
export type ProcedureCompoundReplayStatus = z.infer<typeof procedureCompoundReplayStatusSchema>;

const compoundLeafCommonShape = {
  leafId: guideStepIdSchema,
  bindingSha256: authoritySha256Schema,
  compoundContentSha256: authoritySha256Schema,
  historyLockTokenSha256: authoritySha256Schema,
} as const;

const editHistoryProofCommonShape = {
  modeScope: z.literal('edit_middle_only'),
  objectModeUndoRedoClaim: z.literal(false),
  editBaselineIdentitySha256: authoritySha256Schema,
  editFinalIdentitySha256: authoritySha256Schema,
  objectPointerSha256: authoritySha256Schema,
  meshPointerSha256: authoritySha256Schema,
  meshDatablockSha256: authoritySha256Schema,
  baselineTopologySha256: authoritySha256Schema,
  finalTopologySha256: authoritySha256Schema,
  baselineSelectionSha256: authoritySha256Schema,
  finalSelectionSha256: authoritySha256Schema,
  historyHeadBeforeSha256: authoritySha256Schema,
  historyHeadAfterSha256: authoritySha256Schema,
  checkpointSha256: authoritySha256Schema,
  journalHeadSha256: authoritySha256Schema,
} as const;

export const procedureCompoundObservedHistoryProofSchema = z.strictObject({
  ...editHistoryProofCommonShape,
  kind: z.enum(['poke_native_checkpoint', 'native_undo_once', 'native_redo_once']),
});

export const procedureCompoundEnterEditLeafSchema = z.strictObject({
  ...compoundLeafCommonShape,
  order: z.literal(1),
  kind: z.literal('enter_edit'),
  fromMode: z.literal('OBJECT'),
  toMode: z.literal('EDIT_MESH'),
  modelChanging: z.literal(false),
  nativeUndoRedoOperationCount: z.literal(0),
  historyObligation: z.null(),
});
export type ProcedureCompoundEnterEditLeaf = z.infer<typeof procedureCompoundEnterEditLeafSchema>;

export const procedureCompoundExitEditLeafSchema = z.strictObject({
  ...compoundLeafCommonShape,
  order: z.literal(3),
  kind: z.literal('exit_edit'),
  fromMode: z.literal('EDIT_MESH'),
  toMode: z.literal('OBJECT'),
  modelChanging: z.literal(false),
  nativeUndoRedoOperationCount: z.literal(0),
  historyObligation: z.null(),
});
export type ProcedureCompoundExitEditLeaf = z.infer<typeof procedureCompoundExitEditLeafSchema>;

export const procedureCompoundPokeLeafSchema = z.strictObject({
  ...compoundLeafCommonShape,
  order: z.literal(2),
  kind: z.literal('poke'),
  fromMode: z.literal('EDIT_MESH'),
  toMode: z.literal('EDIT_MESH'),
  modelChanging: z.literal(true),
  nativeUndoRedoOperationCount: z.literal(0),
  historyObligation: z.strictObject({
    kind: z.literal('poke_native_checkpoint'),
    modeScope: z.literal('edit_middle_only'),
    objectModeUndoRedoClaim: z.literal(false),
    expectedHistoryHeadBeforeSha256: authoritySha256Schema,
    expectedCheckpointSha256: z.null(),
  }),
});
export type ProcedureCompoundPokeLeaf = z.infer<typeof procedureCompoundPokeLeafSchema>;

export const procedureCompoundNativeUndoLeafSchema = z.strictObject({
  ...compoundLeafCommonShape,
  order: z.literal(2),
  kind: z.literal('native_undo_once'),
  fromMode: z.literal('EDIT_MESH'),
  toMode: z.literal('EDIT_MESH'),
  modelChanging: z.literal(true),
  nativeUndoRedoOperationCount: z.literal(1),
  historyObligation: z.strictObject({
    kind: z.literal('native_undo_once'),
    modeScope: z.literal('edit_middle_only'),
    objectModeUndoRedoClaim: z.literal(false),
    expectedHistoryHeadBeforeSha256: authoritySha256Schema,
    expectedCheckpointSha256: authoritySha256Schema,
  }),
});
export type ProcedureCompoundNativeUndoLeaf = z.infer<typeof procedureCompoundNativeUndoLeafSchema>;

export const procedureCompoundNativeRedoLeafSchema = z.strictObject({
  ...compoundLeafCommonShape,
  order: z.literal(2),
  kind: z.literal('native_redo_once'),
  fromMode: z.literal('EDIT_MESH'),
  toMode: z.literal('EDIT_MESH'),
  modelChanging: z.literal(true),
  nativeUndoRedoOperationCount: z.literal(1),
  historyObligation: z.strictObject({
    kind: z.literal('native_redo_once'),
    modeScope: z.literal('edit_middle_only'),
    objectModeUndoRedoClaim: z.literal(false),
    expectedHistoryHeadBeforeSha256: authoritySha256Schema,
    expectedCheckpointSha256: authoritySha256Schema,
  }),
});
export type ProcedureCompoundNativeRedoLeaf = z.infer<typeof procedureCompoundNativeRedoLeafSchema>;

const recipeCommonShape = {
  compoundId: z.uuid(),
  replayId: z.uuid(),
  compoundContentSha256: authoritySha256Schema,
  historyLockTokenSha256: authoritySha256Schema,
  decisionReceiptId: z.uuid(),
  decisionReceiptSha256: authoritySha256Schema,
  decisionSingleUseKeySha256: authoritySha256Schema,
  decisionStartStateProjectionSha256: authoritySha256Schema,
  stateChainSha256s: z.tuple([
    authoritySha256Schema,
    authoritySha256Schema,
    authoritySha256Schema,
    authoritySha256Schema,
  ]),
  orderedLeafBindingSha256s: z.tuple([
    authoritySha256Schema,
    authoritySha256Schema,
    authoritySha256Schema,
  ]),
  objectModeUndoRedoTransactionProven: z.literal(false),
  recordedObjectBaseline: z.strictObject({
    blenderProcessIdentitySha256: authoritySha256Schema,
    blenderSessionUid: boundedIdSchema,
    documentFingerprintSha256: authoritySha256Schema,
    nativeHistoryMarkerSha256: authoritySha256Schema,
    historyHeadSha256: authoritySha256Schema,
    objectIdentitySha256: authoritySha256Schema,
    meshIdentitySha256: authoritySha256Schema,
    objectPointerSha256: authoritySha256Schema,
    meshPointerSha256: authoritySha256Schema,
    meshDatablockSha256: authoritySha256Schema,
    topologySha256: authoritySha256Schema,
    selectionSha256: authoritySha256Schema,
    stateSha256: authoritySha256Schema,
    contentSha256: authoritySha256Schema,
  }),
} as const;

const forwardRecipeSchema = z.strictObject({
  ...recipeCommonShape,
  kind: z.literal('forward'),
  decisionKind: z.literal('BlenderExecutionDecisionReceipt'),
  expectedStartStatus: z.literal('intent_recorded'),
  expectedTerminalStatus: z.literal('forward_applied_locked'),
  decisionCurrentStateIntegritySha256: authoritySha256Schema,
  leaves: z.tuple([
    procedureCompoundEnterEditLeafSchema,
    procedureCompoundPokeLeafSchema,
    procedureCompoundExitEditLeafSchema,
  ]),
});

const backRecipeSchema = z.strictObject({
  ...recipeCommonShape,
  kind: z.literal('back'),
  decisionKind: z.literal('BlenderHistoryTransitionDecisionReceipt'),
  decisionTransition: z.literal('back'),
  expectedStartStatus: z.enum(['forward_applied_locked', 'reapplied_locked']),
  expectedTerminalStatus: z.literal('restored_locked'),
  decisionCurrentStateIntegritySha256: authoritySha256Schema,
  leaves: z.tuple([
    procedureCompoundEnterEditLeafSchema,
    procedureCompoundNativeUndoLeafSchema,
    procedureCompoundExitEditLeafSchema,
  ]),
});

const redoRecipeSchema = z.strictObject({
  ...recipeCommonShape,
  kind: z.literal('redo'),
  decisionKind: z.literal('BlenderHistoryTransitionDecisionReceipt'),
  decisionTransition: z.literal('redo'),
  expectedStartStatus: z.literal('restored_locked'),
  expectedTerminalStatus: z.literal('reapplied_locked'),
  decisionCurrentStateIntegritySha256: authoritySha256Schema,
  leaves: z.tuple([
    procedureCompoundEnterEditLeafSchema,
    procedureCompoundNativeRedoLeafSchema,
    procedureCompoundExitEditLeafSchema,
  ]),
});

export const procedureCompoundRecipeSchema = z
  .discriminatedUnion('kind', [forwardRecipeSchema, backRecipeSchema, redoRecipeSchema])
  .superRefine((recipe, context) => {
    const leafIds = new Set(recipe.leaves.map((leaf) => leaf.leafId));
    if (leafIds.size !== 3) {
      context.addIssue({ code: 'custom', path: ['leaves'], message: 'Leaf ids must be unique' });
    }
    for (const [index, leaf] of recipe.leaves.entries()) {
      if (leaf.compoundContentSha256 !== recipe.compoundContentSha256) {
        context.addIssue({
          code: 'custom',
          path: ['leaves', index, 'compoundContentSha256'],
          message: 'Leaf compound hash does not match its recipe',
        });
      }
      if (leaf.historyLockTokenSha256 !== recipe.historyLockTokenSha256) {
        context.addIssue({
          code: 'custom',
          path: ['leaves', index, 'historyLockTokenSha256'],
          message: 'Leaf lock token does not match its recipe',
        });
      }
      if (leaf.bindingSha256 !== recipe.orderedLeafBindingSha256s[index]) {
        context.addIssue({
          code: 'custom',
          path: ['orderedLeafBindingSha256s', index],
          message: 'Ordered leaf binding hash does not match its leaf',
        });
      }
    }
    if (
      recipe.recordedObjectBaseline.contentSha256 !==
      computeProcedureCompoundRecordedBaselineSha256(recipe.recordedObjectBaseline)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['recordedObjectBaseline', 'contentSha256'],
        message: 'Recorded Object baseline must retain its canonical persisted commitment',
      });
    }
  });
export type ProcedureCompoundRecipe = z.infer<typeof procedureCompoundRecipeSchema>;

export const procedureCompoundHashDomain = {
  recipe: 'operatingline.procedure-compound.recipe.v1',
  leafBinding: 'operatingline.procedure-compound.leaf-binding.v1',
  currentState: 'operatingline.procedure-compound.current-state.v1',
  leafIntent: 'operatingline.procedure-compound.leaf-intent.v1',
  leafReceipt: 'operatingline.procedure-compound.leaf-receipt.v1',
  hostAttestation: 'operatingline.procedure-compound.host-attestation.v1',
  recordedBaseline: 'operatingline.procedure-compound.recorded-object-baseline.v1',
  decisionReceipt: 'operatingline.procedure-compound.decision-receipt.v1',
  decisionSingleUse: 'operatingline.procedure-compound.decision-single-use.v1',
  decisionStartStateProjection:
    'operatingline.procedure-compound.decision-start-state-projection.v1',
} as const;

function domainHash(domain: string, payload: unknown): string {
  return computeProtocolCanonicalJsonSha256({ domain, payload });
}

function withoutKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
}

export function computeProcedureCompoundRecordedBaselineSha256(
  baseline: ProcedureCompoundRecipe['recordedObjectBaseline'],
): string {
  return domainHash(
    procedureCompoundHashDomain.recordedBaseline,
    withoutKeys(baseline as unknown as Record<string, unknown>, ['contentSha256']),
  );
}

export function procedureCompoundRecipeHashPayload(recipe: ProcedureCompoundRecipe): unknown {
  // These exclusions are limited to values that transitively contain the recipe root. Forward
  // decision receipts are acyclic and remain committed; history receipts contain both the
  // compound root and full current-state integrity, so only those receipt hashes are excluded.
  const cyclicRootFields = [
    'compoundContentSha256',
    'orderedLeafBindingSha256s',
    'decisionCurrentStateIntegritySha256',
    'leaves',
    ...(recipe.kind === 'forward' ? [] : ['decisionReceiptSha256']),
  ];
  return {
    ...withoutKeys(recipe as unknown as Record<string, unknown>, cyclicRootFields),
    leaves: recipe.leaves.map((leaf) =>
      withoutKeys(leaf as unknown as Record<string, unknown>, [
        'bindingSha256',
        'compoundContentSha256',
      ]),
    ),
  };
}

export function computeProcedureCompoundRecipeSha256(recipe: ProcedureCompoundRecipe): string {
  return domainHash(procedureCompoundHashDomain.recipe, procedureCompoundRecipeHashPayload(recipe));
}

export function procedureCompoundLeafBindingHashPayload(
  recipe: ProcedureCompoundRecipe,
  index: number,
): unknown {
  const leaf = recipe.leaves[index];
  if (leaf === undefined) throw new RangeError('Compound leaf index is out of range');
  return {
    compoundId: recipe.compoundId,
    replayId: recipe.replayId,
    compoundContentSha256: recipe.compoundContentSha256,
    recipeKind: recipe.kind,
    leaf: withoutKeys(leaf as unknown as Record<string, unknown>, [
      'bindingSha256',
      'compoundContentSha256',
    ]),
    preStateSha256: recipe.stateChainSha256s[index],
    postStateSha256: recipe.stateChainSha256s[index + 1],
  };
}

export function computeProcedureCompoundLeafBindingSha256(
  recipe: ProcedureCompoundRecipe,
  index: number,
): string {
  return domainHash(
    procedureCompoundHashDomain.leafBinding,
    procedureCompoundLeafBindingHashPayload(recipe, index),
  );
}

export function verifyProcedureCompoundRecipeIntegrity(recipeInput: unknown): boolean {
  const parsed = procedureCompoundRecipeSchema.safeParse(recipeInput);
  if (!parsed.success) return false;
  const recipe = parsed.data;
  return (
    recipe.compoundContentSha256 === computeProcedureCompoundRecipeSha256(recipe) &&
    recipe.leaves.every(
      (leaf, index) =>
        leaf.bindingSha256 === computeProcedureCompoundLeafBindingSha256(recipe, index) &&
        recipe.orderedLeafBindingSha256s[index] === leaf.bindingSha256,
    )
  );
}

/** Seal order is baseline commitment -> compound root (including state chain) -> leaf bindings. */
export function sealProcedureCompoundRecipe(
  recipeInput: ProcedureCompoundRecipe,
): ProcedureCompoundRecipe {
  const withBaseline = {
    ...recipeInput,
    recordedObjectBaseline: {
      ...recipeInput.recordedObjectBaseline,
      contentSha256: computeProcedureCompoundRecordedBaselineSha256(
        recipeInput.recordedObjectBaseline,
      ),
    },
  } as ProcedureCompoundRecipe;
  const compoundContentSha256 = computeProcedureCompoundRecipeSha256(withBaseline);
  const withCompound = { ...withBaseline, compoundContentSha256 } as ProcedureCompoundRecipe;
  const orderedLeafBindingSha256s = withCompound.leaves.map((_, index) =>
    computeProcedureCompoundLeafBindingSha256(withCompound, index),
  ) as [string, string, string];
  return procedureCompoundRecipeSchema.parse({
    ...withCompound,
    orderedLeafBindingSha256s,
    leaves: withCompound.leaves.map((leaf, index) => ({
      ...leaf,
      compoundContentSha256,
      bindingSha256: orderedLeafBindingSha256s[index],
    })),
  });
}

const currentStateEvidenceShape = {
  compoundId: z.uuid(),
  replayId: z.uuid(),
  compoundContentSha256: authoritySha256Schema,
  historyLockTokenSha256: authoritySha256Schema,
  blenderProcessIdentitySha256: authoritySha256Schema,
  blenderSessionUid: boundedIdSchema,
  documentFingerprintSha256: authoritySha256Schema,
  nativeHistoryMarkerSha256: authoritySha256Schema,
  historyHeadSha256: authoritySha256Schema,
  objectIdentitySha256: authoritySha256Schema,
  meshIdentitySha256: authoritySha256Schema,
  objectPointerSha256: authoritySha256Schema,
  meshPointerSha256: authoritySha256Schema,
  meshDatablockSha256: authoritySha256Schema,
  topologySha256: authoritySha256Schema,
  selectionSha256: authoritySha256Schema,
  stateSha256: authoritySha256Schema,
  integritySha256: authoritySha256Schema,
} as const;

const liveState = <T extends z.ZodRawShape>(shape: T) =>
  z.strictObject({
    ...currentStateEvidenceShape,
    ...shape,
    historyContinuity: z.literal('same_live_session'),
    nativeHistoryLossRecorded: z.literal(false),
  });

export const procedureCompoundCurrentStateSchema = z.union([
  liveState({
    status: z.literal('intent_recorded'),
    lifecycleState: z.literal('object_baseline'),
    mode: z.literal('OBJECT'),
    historyLock: z.literal('held'),
    inProgressLeafId: z.null(),
    permittedHistoryTransitions: z.tuple([]),
  }),
  liveState({
    status: z.literal('recovery_required'),
    lifecycleState: z.literal('unknown'),
    mode: z.literal('UNKNOWN'),
    historyLock: z.literal('held'),
    inProgressLeafId: guideStepIdSchema,
    permittedHistoryTransitions: z.tuple([]),
  }),
  liveState({
    status: z.literal('forward_applied_locked'),
    lifecycleState: z.literal('object_final'),
    mode: z.literal('OBJECT'),
    historyLock: z.literal('held'),
    inProgressLeafId: z.null(),
    permittedHistoryTransitions: z.tuple([z.literal('back'), z.literal('unlock_final')]),
  }),
  liveState({
    status: z.literal('restored_locked'),
    lifecycleState: z.literal('object_baseline'),
    mode: z.literal('OBJECT'),
    historyLock: z.literal('held'),
    inProgressLeafId: z.null(),
    permittedHistoryTransitions: z.tuple([z.literal('redo'), z.literal('abandon_baseline')]),
  }),
  liveState({
    status: z.literal('reapplied_locked'),
    lifecycleState: z.literal('object_final'),
    mode: z.literal('OBJECT'),
    historyLock: z.literal('held'),
    inProgressLeafId: z.null(),
    permittedHistoryTransitions: z.tuple([z.literal('back'), z.literal('unlock_final')]),
  }),
  liveState({
    status: z.literal('history_conflict'),
    lifecycleState: z.literal('unknown'),
    mode: z.literal('UNKNOWN'),
    historyLock: z.literal('quarantined'),
    inProgressLeafId: z.null(),
    permittedHistoryTransitions: z.tuple([]),
  }),
  liveState({
    status: z.literal('quarantined'),
    lifecycleState: z.literal('unknown'),
    mode: z.literal('UNKNOWN'),
    historyLock: z.literal('quarantined'),
    inProgressLeafId: z.null(),
    permittedHistoryTransitions: z.tuple([]),
  }),
  liveState({
    status: z.literal('unlocked_final'),
    lifecycleState: z.literal('object_final'),
    mode: z.literal('OBJECT'),
    historyLock: z.literal('released'),
    inProgressLeafId: z.null(),
    permittedHistoryTransitions: z.tuple([]),
  }),
  liveState({
    status: z.literal('abandoned_baseline'),
    lifecycleState: z.literal('object_baseline'),
    mode: z.literal('OBJECT'),
    historyLock: z.literal('released'),
    inProgressLeafId: z.null(),
    permittedHistoryTransitions: z.tuple([]),
  }),
  z.strictObject({
    ...currentStateEvidenceShape,
    status: z.literal('history_lost'),
    lifecycleState: z.literal('unknown'),
    mode: z.literal('UNKNOWN'),
    historyLock: z.literal('quarantined'),
    historyContinuity: z.literal('lost_permanently'),
    nativeHistoryLossRecorded: z.literal(true),
    inProgressLeafId: z.null(),
    permittedHistoryTransitions: z.tuple([z.literal('abandon_baseline')]),
  }),
  z.strictObject({
    ...currentStateEvidenceShape,
    status: z.literal('abandoned_baseline'),
    lifecycleState: z.literal('object_baseline'),
    mode: z.literal('OBJECT'),
    historyLock: z.literal('released'),
    historyContinuity: z.literal('lost_permanently'),
    nativeHistoryLossRecorded: z.literal(true),
    inProgressLeafId: z.null(),
    permittedHistoryTransitions: z.tuple([]),
  }),
]);
export type ProcedureCompoundCurrentState = z.infer<typeof procedureCompoundCurrentStateSchema>;

export function computeProcedureCompoundCurrentStateSha256(
  state: ProcedureCompoundCurrentState,
): string {
  return domainHash(
    procedureCompoundHashDomain.currentState,
    procedureCompoundCurrentStateHashPayload(state),
  );
}

export function procedureCompoundCurrentStateHashPayload(
  state: ProcedureCompoundCurrentState,
): unknown {
  return withoutKeys(state as unknown as Record<string, unknown>, ['integritySha256']);
}

/**
 * A non-cyclic commitment to the complete decision start state. The full state integrity and
 * recipe-derived compound root are excluded because each transitively depends on the recipe root.
 */
export function computeProcedureCompoundDecisionStartStateProjectionSha256(
  state: ProcedureCompoundCurrentState,
): string {
  return domainHash(
    procedureCompoundHashDomain.decisionStartStateProjection,
    withoutKeys(state as unknown as Record<string, unknown>, [
      'integritySha256',
      'compoundContentSha256',
    ]),
  );
}

export function sealProcedureCompoundCurrentState(
  state: ProcedureCompoundCurrentState,
  recipe: Pick<
    ProcedureCompoundRecipe,
    'compoundId' | 'replayId' | 'compoundContentSha256' | 'historyLockTokenSha256'
  >,
): ProcedureCompoundCurrentState {
  const boundState = {
    ...state,
    compoundId: recipe.compoundId,
    replayId: recipe.replayId,
    compoundContentSha256: recipe.compoundContentSha256,
    historyLockTokenSha256: recipe.historyLockTokenSha256,
  } as ProcedureCompoundCurrentState;
  return procedureCompoundCurrentStateSchema.parse({
    ...boundState,
    integritySha256: computeProcedureCompoundCurrentStateSha256(boundState),
  });
}

export function verifyProcedureCompoundCurrentStateIntegrity(stateInput: unknown): boolean {
  const parsed = procedureCompoundCurrentStateSchema.safeParse(stateInput);
  return (
    parsed.success &&
    parsed.data.integritySha256 === computeProcedureCompoundCurrentStateSha256(parsed.data)
  );
}

const leafProgressSchema = z.strictObject({
  leafId: guideStepIdSchema,
  intentSha256: authoritySha256Schema.nullable(),
  receiptSha256: authoritySha256Schema.nullable(),
});

export const procedureCompoundReplaySchema = z
  .strictObject({
    formatVersion: procedureCompoundReplayFormatVersionSchema,
    planContentSha256: authoritySha256Schema,
    target: z.strictObject({ adapterId: boundedIdSchema, instanceId: z.uuid() }),
    actionCatalogVersion: boundedIdSchema,
    interactionCatalogVersion: boundedIdSchema,
    recipe: procedureCompoundRecipeSchema,
    currentState: procedureCompoundCurrentStateSchema,
    leafProgress: z.tuple([leafProgressSchema, leafProgressSchema, leafProgressSchema]),
  })
  .superRefine((replay, context) => {
    if (
      replay.currentState.compoundId !== replay.recipe.compoundId ||
      replay.currentState.replayId !== replay.recipe.replayId ||
      replay.currentState.compoundContentSha256 !== replay.recipe.compoundContentSha256 ||
      replay.currentState.historyLockTokenSha256 !== replay.recipe.historyLockTokenSha256
    ) {
      context.addIssue({
        code: 'custom',
        path: ['currentState'],
        message: 'Current state must bind the exact compound, replay, content, and lock',
      });
    }
    for (const [index, progress] of replay.leafProgress.entries()) {
      if (progress.leafId !== replay.recipe.leaves[index]!.leafId) {
        context.addIssue({
          code: 'custom',
          path: ['leafProgress', index, 'leafId'],
          message: 'Leaf progress must preserve recipe order',
        });
      }
      if (progress.receiptSha256 !== null && progress.intentSha256 === null) {
        context.addIssue({
          code: 'custom',
          path: ['leafProgress', index],
          message: 'A leaf receipt requires an earlier durable intent',
        });
      }
      if (
        index > 0 &&
        progress.intentSha256 !== null &&
        replay.leafProgress[index - 1]?.receiptSha256 === null
      ) {
        context.addIssue({
          code: 'custom',
          path: ['leafProgress', index],
          message: 'A later leaf cannot start before the previous receipt',
        });
      }
    }
    const terminalStatuses = new Set<ProcedureCompoundReplayStatus>([
      replay.recipe.expectedTerminalStatus,
      'unlocked_final',
      'abandoned_baseline',
    ]);
    const pending = replay.leafProgress
      .map((progress, index) => ({ progress, index }))
      .filter(({ progress }) => progress.intentSha256 !== null && progress.receiptSha256 === null);
    if (replay.currentState.status === 'recovery_required') {
      if (
        pending.length !== 1 ||
        replay.currentState.inProgressLeafId !== pending[0]?.progress.leafId
      ) {
        context.addIssue({
          code: 'custom',
          path: ['currentState', 'inProgressLeafId'],
          message: 'Recovery must identify the unique durable intent without a receipt',
        });
      }
    } else if (pending.length !== 0) {
      context.addIssue({
        code: 'custom',
        path: ['leafProgress'],
        message: 'Only recovery_required may retain one pending durable intent',
      });
    }
    if (
      terminalStatuses.has(replay.currentState.status) &&
      replay.leafProgress.some((progress) => progress.receiptSha256 === null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['leafProgress'],
        message: 'A terminal compound recipe requires intent-before and receipt-after every leaf',
      });
    }
    if (
      replay.currentState.status === replay.recipe.expectedTerminalStatus &&
      replay.currentState.stateSha256 !== replay.recipe.stateChainSha256s[3]
    ) {
      context.addIssue({
        code: 'custom',
        path: ['currentState', 'stateSha256'],
        message: 'Terminal current state does not match the recipe final state',
      });
    }
  });
export type ProcedureCompoundReplay = z.infer<typeof procedureCompoundReplaySchema>;

/** Trust-boundary verifier for relational and cryptographic invariants omitted by JSON Schema. */
export type ProcedureCompoundDecisionEvidence =
  BlenderExecutionDecisionReceipt | BlenderHistoryTransitionDecisionReceipt;

export interface ProcedureCompoundReplayEvidenceResolver {
  readonly decisionReceipt: unknown;
  readonly trustedDecisionConsumptionEvent: unknown;
  resolveLeafEvidence(
    leafId: string,
    order: 1 | 2 | 3,
  ): {
    readonly intent: unknown;
    readonly receipt: unknown | null;
    readonly hostAttestation: unknown | null;
    readonly trustedHostAttestationSha256: string | null;
  } | null;
}

export function computeProcedureCompoundDecisionReceiptSha256(
  receipt: ProcedureCompoundDecisionEvidence,
): string {
  return domainHash(procedureCompoundHashDomain.decisionReceipt, receipt);
}

export function computeProcedureCompoundDecisionSingleUseKeySha256(
  receipt: ProcedureCompoundDecisionEvidence,
): string {
  return computeProtocolCanonicalJsonSha256({ nonce: receipt.nonce });
}

function verifyProcedureCompoundDecisionEvidence(
  replay: ProcedureCompoundReplay,
  evidenceInput: unknown,
  consumptionInput: unknown,
): evidenceInput is ProcedureCompoundDecisionEvidence {
  const result =
    replay.recipe.kind === 'forward'
      ? blenderExecutionDecisionReceiptSchema.safeParse(evidenceInput)
      : blenderHistoryTransitionDecisionReceiptSchema.safeParse(evidenceInput);
  if (!result.success) return false;
  const decision = result.data;
  const consumptionResult = decisionConsumptionEventSchema.safeParse(consumptionInput);
  if (!consumptionResult.success) return false;
  const consumption = consumptionResult.data;
  const binding =
    decision.kind === 'BlenderExecutionDecisionReceipt'
      ? {
          acceptedContentSha256: decision.acceptedContentSha256,
          acceptedContentKind: decision.acceptedContentKind,
          replayId: decision.replayId,
          adapterId: decision.target.adapterId,
          instanceId: decision.target.instanceId,
          blenderSessionId: decision.blenderSessionId,
          documentFingerprintSha256: decision.documentFingerprintSha256,
          actionCatalogVersion: decision.actionCatalogVersion,
          interactionCatalogVersion: decision.interactionCatalogVersion,
        }
      : historyTransitionBinding(decision);
  const consumptionMatches =
    consumption.kind ===
      (decision.kind === 'BlenderExecutionDecisionReceipt'
        ? 'blender_decision_consumed'
        : 'blender_history_transition_consumed') &&
    consumption.credentialId === decision.decisionId &&
    consumption.singleUseKeySha256 ===
      computeProcedureCompoundDecisionSingleUseKeySha256(decision) &&
    consumption.bindingSha256 ===
      computeProtocolCanonicalJsonSha256({
        decisionSha256: computeProtocolCanonicalJsonSha256(decision),
        binding,
      });
  const commonMatches =
    decision.decisionId === replay.recipe.decisionReceiptId &&
    decision.replayId === replay.recipe.replayId &&
    decision.target.adapterId === replay.target.adapterId &&
    decision.target.instanceId === replay.target.instanceId &&
    decision.documentFingerprintSha256 === replay.currentState.documentFingerprintSha256 &&
    decision.actionCatalogVersion === replay.actionCatalogVersion &&
    decision.interactionCatalogVersion === replay.interactionCatalogVersion &&
    replay.recipe.decisionReceiptSha256 ===
      computeProcedureCompoundDecisionReceiptSha256(decision) &&
    replay.recipe.decisionSingleUseKeySha256 ===
      computeProcedureCompoundDecisionSingleUseKeySha256(decision) &&
    consumptionMatches;
  if (!commonMatches) return false;
  if (decision.kind === 'BlenderExecutionDecisionReceipt') {
    return (
      replay.recipe.kind === 'forward' &&
      decision.acceptedContentSha256 === replay.planContentSha256 &&
      decision.blenderSessionId === replay.currentState.blenderSessionUid
    );
  }
  const middleObligation = replay.recipe.leaves[1].historyObligation;
  return (
    replay.recipe.kind !== 'forward' &&
    decision.transition === replay.recipe.kind &&
    decision.expectedStatus === replay.recipe.expectedStartStatus &&
    decision.compoundId === replay.recipe.compoundId &&
    decision.blenderProcessIdentitySha256 === replay.currentState.blenderProcessIdentitySha256 &&
    decision.blenderSessionUid === replay.currentState.blenderSessionUid &&
    decision.compoundContentSha256 === replay.recipe.compoundContentSha256 &&
    decision.historyLockTokenSha256 === replay.recipe.historyLockTokenSha256 &&
    decision.currentStateSha256 === replay.recipe.decisionCurrentStateIntegritySha256 &&
    decision.expectedHistoryHeadSha256 === middleObligation.expectedHistoryHeadBeforeSha256
  );
}

export function verifyProcedureCompoundReplayIntegrity(
  replayInput: unknown,
  evidence: ProcedureCompoundReplayEvidenceResolver,
): boolean {
  const result = procedureCompoundReplaySchema.safeParse(replayInput);
  if (!result.success) return false;
  const replay = result.data;
  if (
    !verifyProcedureCompoundRecipeIntegrity(replay.recipe) ||
    !verifyProcedureCompoundCurrentStateIntegrity(replay.currentState) ||
    !verifyProcedureCompoundDecisionEvidence(
      replay,
      evidence.decisionReceipt,
      evidence.trustedDecisionConsumptionEvent,
    )
  ) {
    return false;
  }
  let previousReceipt: ProcedureCompoundLeafReceipt | null = null;
  for (const [index, progress] of replay.leafProgress.entries()) {
    const order = (index + 1) as 1 | 2 | 3;
    const typed = evidence.resolveLeafEvidence(progress.leafId, order);
    if (progress.intentSha256 === null) {
      if (typed !== null || progress.receiptSha256 !== null) return false;
      continue;
    }
    if (typed === null) return false;
    const intentResult = procedureCompoundLeafIntentSchema.safeParse(typed.intent);
    if (!intentResult.success) return false;
    const intent = intentResult.data;
    const previousReceiptSha256 = previousReceipt?.receiptSha256 ?? null;
    if (
      progress.intentSha256 !== computeProcedureCompoundLeafIntentSha256(intent) ||
      !verifyProcedureCompoundLeafIntent(intent, replay.recipe, previousReceiptSha256) ||
      (previousReceipt !== null &&
        Date.parse(intent.recordedAt) < Date.parse(previousReceipt.recordedAt))
    ) {
      return false;
    }
    if (progress.receiptSha256 === null) {
      if (
        typed.receipt !== null ||
        typed.hostAttestation !== null ||
        typed.trustedHostAttestationSha256 !== null
      )
        return false;
      continue;
    }
    const receiptResult = procedureCompoundLeafReceiptSchema.safeParse(typed.receipt);
    if (!receiptResult.success || typed.trustedHostAttestationSha256 === null) return false;
    const receipt = receiptResult.data;
    if (
      progress.receiptSha256 !== receipt.receiptSha256 ||
      !verifyProcedureCompoundLeafReceipt(
        receipt,
        intent,
        replay.recipe,
        typed.hostAttestation,
        typed.trustedHostAttestationSha256,
      )
    ) {
      return false;
    }
    previousReceipt = receipt;
  }
  return true;
}

export const procedureCompoundLeafIntentSchema = z.strictObject({
  formatVersion: procedureCompoundReplayFormatVersionSchema,
  kind: z.literal('compound_leaf_intent'),
  eventId: z.uuid(),
  compoundId: z.uuid(),
  recipeKind: procedureCompoundRecipeKindSchema,
  leafId: guideStepIdSchema,
  order: z.number().int().min(1).max(3),
  historyLockTokenSha256: authoritySha256Schema,
  preStateSha256: authoritySha256Schema,
  expectedPostStateSha256: authoritySha256Schema,
  previousReceiptSha256: authoritySha256Schema.nullable(),
  recordedAt: instantSchema,
});
export type ProcedureCompoundLeafIntent = z.infer<typeof procedureCompoundLeafIntentSchema>;

export const procedureCompoundHostAttestationSchema = z.strictObject({
  formatVersion: procedureCompoundReplayFormatVersionSchema,
  kind: z.literal('compound_leaf_host_attestation'),
  attestationId: z.uuid(),
  compoundId: z.uuid(),
  replayId: z.uuid(),
  leafId: guideStepIdSchema,
  order: z.number().int().min(1).max(3),
  intentSha256: authoritySha256Schema,
  preStateSha256: authoritySha256Schema,
  postStateSha256: authoritySha256Schema,
  historyProof: procedureCompoundObservedHistoryProofSchema.nullable(),
  checkpointSha256: authoritySha256Schema.nullable(),
  historyHeadSha256: authoritySha256Schema,
  nativeUndoRedoOperationCount: z.number().int().min(0).max(1),
  observedAt: instantSchema,
  contentSha256: authoritySha256Schema,
});
export type ProcedureCompoundHostAttestation = z.infer<
  typeof procedureCompoundHostAttestationSchema
>;

export function computeProcedureCompoundHostAttestationSha256(
  attestation: ProcedureCompoundHostAttestation,
): string {
  return domainHash(
    procedureCompoundHashDomain.hostAttestation,
    withoutKeys(attestation as unknown as Record<string, unknown>, ['contentSha256']),
  );
}

export function computeProcedureCompoundLeafIntentSha256(
  intent: ProcedureCompoundLeafIntent,
): string {
  return domainHash(
    procedureCompoundHashDomain.leafIntent,
    procedureCompoundLeafIntentHashPayload(intent),
  );
}

export function procedureCompoundLeafIntentHashPayload(
  intent: ProcedureCompoundLeafIntent,
): unknown {
  return intent;
}

export function verifyProcedureCompoundLeafIntent(
  intentInput: unknown,
  recipeInput: unknown,
  previousReceiptSha256: string | null,
): boolean {
  const intentResult = procedureCompoundLeafIntentSchema.safeParse(intentInput);
  const recipeResult = procedureCompoundRecipeSchema.safeParse(recipeInput);
  if (!intentResult.success || !recipeResult.success) return false;
  const intent = intentResult.data;
  const recipe = recipeResult.data;
  const leaf = recipe.leaves[intent.order - 1];
  return (
    leaf !== undefined &&
    intent.compoundId === recipe.compoundId &&
    intent.recipeKind === recipe.kind &&
    intent.leafId === leaf.leafId &&
    intent.historyLockTokenSha256 === recipe.historyLockTokenSha256 &&
    intent.preStateSha256 === recipe.stateChainSha256s[intent.order - 1] &&
    intent.expectedPostStateSha256 === recipe.stateChainSha256s[intent.order] &&
    intent.previousReceiptSha256 === previousReceiptSha256
  );
}

export const procedureCompoundLeafReceiptSchema = z
  .strictObject({
    formatVersion: procedureCompoundReplayFormatVersionSchema,
    kind: z.literal('compound_leaf_receipt'),
    eventId: z.uuid(),
    compoundId: z.uuid(),
    recipeKind: procedureCompoundRecipeKindSchema,
    leafId: guideStepIdSchema,
    order: z.number().int().min(1).max(3),
    intentSha256: authoritySha256Schema,
    previousReceiptSha256: authoritySha256Schema.nullable(),
    preStateSha256: authoritySha256Schema,
    postStateSha256: authoritySha256Schema,
    historyHeadSha256: authoritySha256Schema,
    nativeUndoRedoOperationCount: z.number().int().min(0).max(1),
    checkpointSha256: authoritySha256Schema.nullable(),
    historyProof: procedureCompoundObservedHistoryProofSchema.nullable(),
    hostAttestationSha256: authoritySha256Schema,
    receiptSha256: authoritySha256Schema,
    recordedAt: instantSchema,
  })
  .superRefine((receipt, context) => {
    if (
      receipt.order !== 2 &&
      (receipt.historyProof !== null ||
        receipt.checkpointSha256 !== null ||
        receipt.nativeUndoRedoOperationCount !== 0)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['historyProof'],
        message: 'Only the middle leaf may carry observed native history proof',
      });
    }
    if (receipt.order === 2 && receipt.historyProof === null) {
      context.addIssue({
        code: 'custom',
        path: ['historyProof'],
        message: 'The middle receipt requires the complete observed native history proof',
      });
    }
  });
export type ProcedureCompoundLeafReceipt = z.infer<typeof procedureCompoundLeafReceiptSchema>;

export function computeProcedureCompoundLeafReceiptSha256(
  receipt: ProcedureCompoundLeafReceipt,
): string {
  return domainHash(
    procedureCompoundHashDomain.leafReceipt,
    procedureCompoundLeafReceiptHashPayload(receipt),
  );
}

export function procedureCompoundLeafReceiptHashPayload(
  receipt: ProcedureCompoundLeafReceipt,
): unknown {
  return withoutKeys(receipt as unknown as Record<string, unknown>, ['receiptSha256']);
}

export function sealProcedureCompoundLeafReceipt(
  receipt: Omit<ProcedureCompoundLeafReceipt, 'receiptSha256'>,
): ProcedureCompoundLeafReceipt {
  const candidate = { ...receipt, receiptSha256: '0'.repeat(64) };
  return procedureCompoundLeafReceiptSchema.parse({
    ...candidate,
    receiptSha256: computeProcedureCompoundLeafReceiptSha256(candidate),
  });
}

export function verifyProcedureCompoundLeafReceipt(
  receiptInput: unknown,
  intentInput: unknown,
  recipeInput: unknown,
  hostAttestationInput: unknown,
  trustedHostAttestationSha256?: string,
): boolean {
  const receiptResult = procedureCompoundLeafReceiptSchema.safeParse(receiptInput);
  const intentResult = procedureCompoundLeafIntentSchema.safeParse(intentInput);
  const recipeResult = procedureCompoundRecipeSchema.safeParse(recipeInput);
  if (!receiptResult.success || !intentResult.success || !recipeResult.success) return false;
  const receipt = receiptResult.data;
  const intent = intentResult.data;
  const recipe = recipeResult.data;
  const leaf = recipe.leaves[receipt.order - 1];
  if (leaf === undefined) return false;
  const proof = receipt.historyProof;
  const obligation = leaf.historyObligation;
  const attestationResult = procedureCompoundHostAttestationSchema.safeParse(hostAttestationInput);
  if (!attestationResult.success) return false;
  const attestation = attestationResult.data;
  const attestationSha256 = computeProcedureCompoundHostAttestationSha256(attestation);
  return (
    receipt.compoundId === recipe.compoundId &&
    receipt.recipeKind === recipe.kind &&
    receipt.leafId === leaf.leafId &&
    intent.compoundId === receipt.compoundId &&
    intent.recipeKind === receipt.recipeKind &&
    intent.leafId === receipt.leafId &&
    intent.order === receipt.order &&
    intent.historyLockTokenSha256 === recipe.historyLockTokenSha256 &&
    intent.preStateSha256 === recipe.stateChainSha256s[receipt.order - 1] &&
    intent.expectedPostStateSha256 === recipe.stateChainSha256s[receipt.order] &&
    intent.previousReceiptSha256 === receipt.previousReceiptSha256 &&
    verifyProcedureCompoundLeafIntent(intent, recipe, receipt.previousReceiptSha256) &&
    receipt.intentSha256 === computeProcedureCompoundLeafIntentSha256(intent) &&
    receipt.preStateSha256 === recipe.stateChainSha256s[receipt.order - 1] &&
    receipt.postStateSha256 === recipe.stateChainSha256s[receipt.order] &&
    receipt.nativeUndoRedoOperationCount === leaf.nativeUndoRedoOperationCount &&
    receipt.hostAttestationSha256 === trustedHostAttestationSha256 &&
    attestation.contentSha256 === attestationSha256 &&
    attestationSha256 === trustedHostAttestationSha256 &&
    attestation.compoundId === recipe.compoundId &&
    attestation.replayId === recipe.replayId &&
    attestation.leafId === receipt.leafId &&
    attestation.order === receipt.order &&
    attestation.intentSha256 === receipt.intentSha256 &&
    attestation.preStateSha256 === receipt.preStateSha256 &&
    attestation.postStateSha256 === receipt.postStateSha256 &&
    attestation.checkpointSha256 === receipt.checkpointSha256 &&
    attestation.historyHeadSha256 === receipt.historyHeadSha256 &&
    attestation.nativeUndoRedoOperationCount === receipt.nativeUndoRedoOperationCount &&
    computeProtocolCanonicalJsonSha256(attestation.historyProof) ===
      computeProtocolCanonicalJsonSha256(receipt.historyProof) &&
    Date.parse(attestation.observedAt) >= Date.parse(intent.recordedAt) &&
    Date.parse(attestation.observedAt) <= Date.parse(receipt.recordedAt) &&
    (obligation === null
      ? proof === null && receipt.checkpointSha256 === null
      : proof !== null &&
        proof.kind === obligation.kind &&
        proof.modeScope === obligation.modeScope &&
        proof.objectModeUndoRedoClaim === false &&
        receipt.checkpointSha256 === proof.checkpointSha256 &&
        receipt.historyHeadSha256 === proof.historyHeadAfterSha256 &&
        proof.historyHeadBeforeSha256 === obligation.expectedHistoryHeadBeforeSha256 &&
        (obligation.expectedCheckpointSha256 === null ||
          proof.checkpointSha256 === obligation.expectedCheckpointSha256)) &&
    Date.parse(receipt.recordedAt) >= Date.parse(intent.recordedAt) &&
    receipt.receiptSha256 === computeProcedureCompoundLeafReceiptSha256(receipt)
  );
}

const transitionSnapshotSchema = z.strictObject({
  status: procedureCompoundReplayStatusSchema,
  inProgressLeafId: guideStepIdSchema.nullable(),
  historyHeadSha256: authoritySha256Schema,
  checkpointSha256: authoritySha256Schema.nullable(),
  terminalObservationSha256: authoritySha256Schema.nullable(),
});

export const procedureCompoundTerminalObservationSchema = z.strictObject({
  kind: z.enum(['fresh_object_baseline', 'fresh_object_final']),
  observedAt: instantSchema,
  blenderProcessIdentitySha256: authoritySha256Schema,
  blenderSessionUid: boundedIdSchema,
  documentFingerprintSha256: authoritySha256Schema,
  nativeHistoryMarkerSha256: authoritySha256Schema,
  historyHeadSha256: authoritySha256Schema,
  objectIdentitySha256: authoritySha256Schema,
  meshIdentitySha256: authoritySha256Schema,
  objectPointerSha256: authoritySha256Schema,
  meshPointerSha256: authoritySha256Schema,
  meshDatablockSha256: authoritySha256Schema,
  topologySha256: authoritySha256Schema,
  selectionSha256: authoritySha256Schema,
  stateSha256: authoritySha256Schema,
  contentSha256: authoritySha256Schema,
});
export type ProcedureCompoundTerminalObservation = z.infer<
  typeof procedureCompoundTerminalObservationSchema
>;

export function computeProcedureCompoundTerminalObservationSha256(
  observation: ProcedureCompoundTerminalObservation,
): string {
  return domainHash(
    'operatingline.procedure-compound.terminal-observation.v1',
    withoutKeys(observation as unknown as Record<string, unknown>, ['contentSha256']),
  );
}

export const procedureCompoundTransitionEventSchema = z
  .strictObject({
    formatVersion: procedureCompoundReplayFormatVersionSchema,
    kind: z.literal('compound_transition'),
    eventId: z.uuid(),
    sequence: z.number().int().nonnegative(),
    compoundId: z.uuid(),
    authorizationOperationId: z.uuid().nullable(),
    previousEventSha256: authoritySha256Schema.nullable(),
    previous: transitionSnapshotSchema,
    next: transitionSnapshotSchema,
    observedFreshBaseline: z.boolean(),
    observedFreshFinal: z.boolean(),
    recordedAt: instantSchema,
  })
  .superRefine((event, context) => {
    if ((event.sequence === 0) !== (event.previousEventSha256 === null)) {
      context.addIssue({
        code: 'custom',
        path: ['previousEventSha256'],
        message: 'Only the first append-only transition event has no predecessor',
      });
    }
  });
export type ProcedureCompoundTransitionEvent = z.infer<
  typeof procedureCompoundTransitionEventSchema
>;

export interface ProcedureCompoundTrustedTransitionContext {
  readonly compoundId: string;
  readonly previousCheckpointSha256: string | null;
  readonly nextCheckpointSha256: string | null;
  readonly previousTerminalObservationSha256: string | null;
  readonly nextTerminalObservationSha256: string | null;
  readonly trustedPreviousEventSequence: number | null;
  readonly trustedPreviousEventSha256: string | null;
  readonly replay: ProcedureCompoundReplay;
  readonly transitionDecisionReceipt: unknown | null;
  readonly trustedConsumptionEvent: unknown | null;
  readonly terminalObservation: unknown | null;
  readonly replayEvidenceResolver: ProcedureCompoundReplayEvidenceResolver | null;
}

function historyTransitionBinding(
  decision: BlenderHistoryTransitionDecisionReceipt,
): Record<string, unknown> {
  return {
    compoundId: decision.compoundId,
    replayId: decision.replayId,
    adapterId: decision.target.adapterId,
    instanceId: decision.target.instanceId,
    blenderProcessIdentitySha256: decision.blenderProcessIdentitySha256,
    blenderSessionUid: decision.blenderSessionUid,
    documentFingerprintSha256: decision.documentFingerprintSha256,
    compoundContentSha256: decision.compoundContentSha256,
    historyLockTokenSha256: decision.historyLockTokenSha256,
    currentStateSha256: decision.currentStateSha256,
    expectedHistoryHeadSha256: decision.expectedHistoryHeadSha256,
    transition: decision.transition,
    expectedStatus: decision.expectedStatus,
    terminalObservationSha256: decision.terminalObservationSha256,
    nativeHistoryLossRecorded: decision.nativeHistoryLossRecorded,
    actionCatalogVersion: decision.actionCatalogVersion,
    interactionCatalogVersion: decision.interactionCatalogVersion,
  };
}

function terminalReleaseStateMatches(
  previous: ProcedureCompoundCurrentState,
  next: ProcedureCompoundCurrentState,
  replay: ProcedureCompoundReplay,
): boolean {
  const expected =
    previous.status === 'history_lost' ? replay.recipe.recordedObjectBaseline : previous;
  return (
    next.blenderProcessIdentitySha256 === expected.blenderProcessIdentitySha256 &&
    next.blenderSessionUid === expected.blenderSessionUid &&
    next.documentFingerprintSha256 === expected.documentFingerprintSha256 &&
    next.nativeHistoryMarkerSha256 === expected.nativeHistoryMarkerSha256 &&
    next.historyHeadSha256 === expected.historyHeadSha256 &&
    next.objectIdentitySha256 === expected.objectIdentitySha256 &&
    next.meshIdentitySha256 === expected.meshIdentitySha256 &&
    next.objectPointerSha256 === expected.objectPointerSha256 &&
    next.meshPointerSha256 === expected.meshPointerSha256 &&
    next.meshDatablockSha256 === expected.meshDatablockSha256 &&
    next.topologySha256 === expected.topologySha256 &&
    next.selectionSha256 === expected.selectionSha256 &&
    next.stateSha256 === expected.stateSha256
  );
}

function verifyTerminalTransitionAuthorization(
  previous: ProcedureCompoundCurrentState,
  next: ProcedureCompoundCurrentState,
  event: ProcedureCompoundTransitionEvent,
  context: ProcedureCompoundTrustedTransitionContext,
): boolean {
  const decisionResult = blenderHistoryTransitionDecisionReceiptSchema.safeParse(
    context.transitionDecisionReceipt,
  );
  const consumptionResult = decisionConsumptionEventSchema.safeParse(
    context.trustedConsumptionEvent,
  );
  const observationResult = procedureCompoundTerminalObservationSchema.safeParse(
    context.terminalObservation,
  );
  if (!decisionResult.success || !consumptionResult.success || !observationResult.success)
    return false;
  const decision = decisionResult.data;
  const consumption: DecisionConsumptionEvent = consumptionResult.data;
  const observation = observationResult.data;
  const replay = context.replay;
  const expectedTransition = next.status === 'unlocked_final' ? 'unlock_final' : 'abandon_baseline';
  const expectedObservationKind =
    next.status === 'unlocked_final' ? 'fresh_object_final' : 'fresh_object_baseline';
  const observationSha256 = computeProcedureCompoundTerminalObservationSha256(observation);
  const expectedBindingSha256 = computeProtocolCanonicalJsonSha256({
    decisionSha256: computeProtocolCanonicalJsonSha256(decision),
    binding: historyTransitionBinding(decision),
  });
  return (
    context.replayEvidenceResolver === null &&
    verifyProcedureCompoundRecipeIntegrity(replay.recipe) &&
    verifyProcedureCompoundCurrentStateIntegrity(previous) &&
    verifyProcedureCompoundCurrentStateIntegrity(next) &&
    previous.compoundId === replay.recipe.compoundId &&
    previous.replayId === replay.recipe.replayId &&
    previous.compoundContentSha256 === replay.recipe.compoundContentSha256 &&
    previous.historyLockTokenSha256 === replay.recipe.historyLockTokenSha256 &&
    next.compoundId === replay.recipe.compoundId &&
    next.replayId === replay.recipe.replayId &&
    next.compoundContentSha256 === replay.recipe.compoundContentSha256 &&
    next.historyLockTokenSha256 === replay.recipe.historyLockTokenSha256 &&
    decision.transition === expectedTransition &&
    decision.compoundId === replay.recipe.compoundId &&
    decision.replayId === replay.recipe.replayId &&
    decision.target.adapterId === replay.target.adapterId &&
    decision.target.instanceId === replay.target.instanceId &&
    decision.blenderProcessIdentitySha256 === previous.blenderProcessIdentitySha256 &&
    decision.blenderSessionUid === previous.blenderSessionUid &&
    decision.documentFingerprintSha256 === previous.documentFingerprintSha256 &&
    decision.compoundContentSha256 === replay.recipe.compoundContentSha256 &&
    decision.historyLockTokenSha256 === replay.recipe.historyLockTokenSha256 &&
    decision.currentStateSha256 === previous.integritySha256 &&
    decision.expectedHistoryHeadSha256 === previous.historyHeadSha256 &&
    decision.expectedStatus === previous.status &&
    decision.terminalObservationSha256 === observationSha256 &&
    event.next.terminalObservationSha256 === observationSha256 &&
    decision.nativeHistoryLossRecorded === previous.nativeHistoryLossRecorded &&
    decision.actionCatalogVersion === replay.actionCatalogVersion &&
    decision.interactionCatalogVersion === replay.interactionCatalogVersion &&
    consumption.kind === 'blender_history_transition_consumed' &&
    consumption.credentialId === decision.decisionId &&
    consumption.operationId === event.authorizationOperationId &&
    consumption.singleUseKeySha256 ===
      computeProcedureCompoundDecisionSingleUseKeySha256(decision) &&
    consumption.bindingSha256 === expectedBindingSha256 &&
    observation.kind === expectedObservationKind &&
    observation.contentSha256 === observationSha256 &&
    Date.parse(observation.observedAt) >= Date.parse(decision.issuedAt) &&
    Date.parse(observation.observedAt) <= Date.parse(event.recordedAt) &&
    observation.blenderProcessIdentitySha256 === next.blenderProcessIdentitySha256 &&
    observation.blenderSessionUid === next.blenderSessionUid &&
    observation.documentFingerprintSha256 === next.documentFingerprintSha256 &&
    observation.nativeHistoryMarkerSha256 === next.nativeHistoryMarkerSha256 &&
    observation.historyHeadSha256 === next.historyHeadSha256 &&
    observation.objectIdentitySha256 === next.objectIdentitySha256 &&
    observation.meshIdentitySha256 === next.meshIdentitySha256 &&
    observation.objectPointerSha256 === next.objectPointerSha256 &&
    observation.meshPointerSha256 === next.meshPointerSha256 &&
    observation.meshDatablockSha256 === next.meshDatablockSha256 &&
    observation.topologySha256 === next.topologySha256 &&
    observation.selectionSha256 === next.selectionSha256 &&
    observation.stateSha256 === next.stateSha256 &&
    terminalReleaseStateMatches(previous, next, replay)
  );
}

export function verifyProcedureCompoundTransition(
  previous: ProcedureCompoundCurrentState,
  next: ProcedureCompoundCurrentState,
  eventInput: unknown,
  context: ProcedureCompoundTrustedTransitionContext,
): boolean {
  const result = procedureCompoundTransitionEventSchema.safeParse(eventInput);
  if (!result.success) return false;
  const event = result.data;
  const previousResult = procedureCompoundCurrentStateSchema.safeParse(previous);
  const nextResult = procedureCompoundCurrentStateSchema.safeParse(next);
  const replay = context.replay;
  if (
    !previousResult.success ||
    !nextResult.success ||
    !verifyProcedureCompoundCurrentStateIntegrity(previousResult.data) ||
    !verifyProcedureCompoundCurrentStateIntegrity(nextResult.data) ||
    !verifyProcedureCompoundRecipeIntegrity(replay.recipe) ||
    context.compoundId !== replay.recipe.compoundId ||
    previous.compoundId !== replay.recipe.compoundId ||
    previous.replayId !== replay.recipe.replayId ||
    previous.compoundContentSha256 !== replay.recipe.compoundContentSha256 ||
    previous.historyLockTokenSha256 !== replay.recipe.historyLockTokenSha256 ||
    next.compoundId !== replay.recipe.compoundId ||
    next.replayId !== replay.recipe.replayId ||
    next.compoundContentSha256 !== replay.recipe.compoundContentSha256 ||
    next.historyLockTokenSha256 !== replay.recipe.historyLockTokenSha256
  ) {
    return false;
  }
  if (
    event.sequence !== (context.trustedPreviousEventSequence ?? -1) + 1 ||
    event.previousEventSha256 !== context.trustedPreviousEventSha256
  ) {
    return false;
  }
  const previousSnapshot = {
    status: previous.status,
    inProgressLeafId: previous.inProgressLeafId,
    historyHeadSha256: previous.historyHeadSha256,
    checkpointSha256: context.previousCheckpointSha256,
    terminalObservationSha256: context.previousTerminalObservationSha256,
  };
  const nextSnapshot = {
    status: next.status,
    inProgressLeafId: next.inProgressLeafId,
    historyHeadSha256: next.historyHeadSha256,
    checkpointSha256: context.nextCheckpointSha256,
    terminalObservationSha256: context.nextTerminalObservationSha256,
  };
  if (JSON.stringify(event.previous) !== JSON.stringify(previousSnapshot)) return false;
  if (JSON.stringify(event.next) !== JSON.stringify(nextSnapshot)) return false;
  if (event.compoundId !== context.compoundId) return false;
  if (previous.nativeHistoryLossRecorded && !next.nativeHistoryLossRecorded) return false;
  if (previous.status === 'history_lost') {
    return (
      next.status === 'abandoned_baseline' &&
      event.observedFreshBaseline &&
      !event.observedFreshFinal &&
      event.next.terminalObservationSha256 !== null &&
      next.historyLock === 'released' &&
      next.lifecycleState === 'object_baseline' &&
      verifyTerminalTransitionAuthorization(previous, next, event, context)
    );
  }
  const allowedNext: Partial<
    Record<ProcedureCompoundReplayStatus, readonly ProcedureCompoundReplayStatus[]>
  > = {
    intent_recorded: [
      'recovery_required',
      'forward_applied_locked',
      'history_conflict',
      'history_lost',
      'quarantined',
    ],
    recovery_required: [
      'forward_applied_locked',
      'restored_locked',
      'reapplied_locked',
      'history_conflict',
      'history_lost',
      'quarantined',
    ],
    forward_applied_locked: [
      'restored_locked',
      'unlocked_final',
      'history_conflict',
      'history_lost',
    ],
    restored_locked: ['reapplied_locked', 'abandoned_baseline', 'history_conflict', 'history_lost'],
    reapplied_locked: ['restored_locked', 'unlocked_final', 'history_conflict', 'history_lost'],
    history_conflict: ['recovery_required', 'history_lost', 'quarantined'],
    quarantined: ['recovery_required', 'history_lost'],
  };
  if (!(allowedNext[previous.status] ?? []).includes(next.status)) return false;
  const replayCompletion =
    previous.status === 'intent_recorded' && next.status === 'forward_applied_locked'
      ? 'forward'
      : previous.status === 'forward_applied_locked' && next.status === 'restored_locked'
        ? 'back'
        : previous.status === 'reapplied_locked' && next.status === 'restored_locked'
          ? 'back'
          : previous.status === 'restored_locked' && next.status === 'reapplied_locked'
            ? 'redo'
            : null;
  if (replayCompletion !== null) {
    const resolver = context.replayEvidenceResolver;
    const consumptionResult = decisionConsumptionEventSchema.safeParse(
      resolver?.trustedDecisionConsumptionEvent,
    );
    return (
      resolver !== null &&
      replay.recipe.kind === replayCompletion &&
      replay.recipe.expectedStartStatus === previous.status &&
      replay.recipe.decisionStartStateProjectionSha256 ===
        computeProcedureCompoundDecisionStartStateProjectionSha256(previous) &&
      replay.recipe.decisionCurrentStateIntegritySha256 === previous.integritySha256 &&
      replay.currentState.integritySha256 === next.integritySha256 &&
      event.next.terminalObservationSha256 === next.integritySha256 &&
      event.authorizationOperationId !== null &&
      consumptionResult.success &&
      consumptionResult.data.kind ===
        (replayCompletion === 'forward'
          ? 'blender_decision_consumed'
          : 'blender_history_transition_consumed') &&
      consumptionResult.data.operationId === event.authorizationOperationId &&
      verifyProcedureCompoundReplayIntegrity(replay, resolver)
    );
  }
  if (next.status === replay.recipe.expectedTerminalStatus) return false;
  if (next.status === 'abandoned_baseline') {
    return (
      event.observedFreshBaseline &&
      !event.observedFreshFinal &&
      event.next.terminalObservationSha256 !== null &&
      verifyTerminalTransitionAuthorization(previous, next, event, context)
    );
  }
  if (next.status === 'unlocked_final') {
    return (
      !event.observedFreshBaseline &&
      event.observedFreshFinal &&
      event.next.terminalObservationSha256 !== null &&
      verifyTerminalTransitionAuthorization(previous, next, event, context)
    );
  }
  if (
    event.authorizationOperationId !== null ||
    context.transitionDecisionReceipt !== null ||
    context.trustedConsumptionEvent !== null ||
    context.terminalObservation !== null
  )
    return false;
  if (context.replayEvidenceResolver !== null) return false;
  if (event.observedFreshBaseline || event.observedFreshFinal) return false;
  if (
    next.status === 'forward_applied_locked' ||
    next.status === 'restored_locked' ||
    next.status === 'reapplied_locked'
  ) {
    return false;
  }
  return true;
}
