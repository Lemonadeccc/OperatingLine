import {
  canonicalizeProtocolJsonValue,
  blenderExecutionDecisionReceiptSchema,
  blenderHistoryTransitionDecisionReceiptSchema,
  computeProtocolCanonicalJsonSha256,
  decisionConsumptionEventSchema,
  computeProcedureLeafReplayAttestationContentSha256,
  computeProcedureLeafReplayBindingContentSha256,
  computeProcedureLeafReplayCurrentStateVerificationContentSha256,
  computeProcedureLeafReplayFailureRecoveryAttestationContentSha256,
  computeProcedureLeafReplayObservationContentSha256,
  guideProtocolVersion,
  procedureCompoundReplaySchema,
  procedureCompoundCurrentStateSchema,
  verifyProcedureCompoundCurrentStateIntegrity,
  verifyProcedureCompoundReplayIntegrity,
  verifyProcedureCompoundRecipeIntegrity,
  protocolJsonValueCanonicalization,
  procedureLeafReplayActionNameSchema,
  operationLevelMcpActionNameSchema,
  operationLevelMcpRecipeIdByAction,
  procedureLeafReplayAttestationSchema,
  procedureLeafReplayBindingSchema,
  procedureLeafReplayFormatVersion,
  procedureLeafReplayFailedObservationSchema,
  procedureLeafReplayObservationSchema,
  procedureLeafReplayCurrentStateVerificationSchema,
  procedureLeafReplayFailureRecoveryAttestationSchema,
  stableProcedureLeafOrder,
  validateActionArguments,
  type ActionCatalog,
  type CompanionStateReport,
  type CompanionProcedureReplayCurrentStateRequest,
  type GuideProposal,
  type GuideProposalDecision,
  type PlanningIntent,
  type ProcedureAuthoringMaterializationResult,
  type ProcedureLeafReplayActionName,
  type ProcedureLeafReplayAttestation,
  type ProcedureLeafReplayBinding,
  type ProcedureLeafReplayCurrentStateVerification,
  type ProcedureLeafReplayFailureRecoveryAttestation,
  type ProcedureLeafReplayProposalRequest,
  type ProcedureCompoundCurrentState,
  type ProcedureCompoundReplay,
  type ProcedureCompoundReplayEvidenceResolver,
} from '@operatingline/protocol';
import type { StoredManagedReplayReceipt } from '@operatingline/persistence';
import { isDeepStrictEqual } from 'node:util';

import { satisfiesStableVersionRange } from './stable-version-ranges.js';
import {
  AuthorityConsumptionCoordinator,
  blenderExecutionBindingSchema,
  blenderHistoryTransitionBindingSchema,
  InMemoryAuthorityConsumptionStore,
} from './authority-consumption.js';

export const pokeCompoundHistoryLockEventType = 'procedure.poke-compound.history-lock-state';
export const pokeCompoundTransportHistoryLockEventTypes = [
  'blender.poke-compound.queued',
  'blender.poke-compound.dispatched',
  'blender.poke-compound.recovery-required',
  'blender.poke-compound.recovery-challenged',
  'blender.poke-compound.completed',
  'blender.poke-compound.quarantined',
] as const;

interface PokeCompoundHistoryLockDatabase {
  listExecutionEventsByTypes(eventTypes: readonly string[]): readonly {
    readonly sequence: number;
    readonly payload: unknown;
  }[];
}

/** One durable reader is shared by every coordinator that can touch Blender native history. */
export function createPokeCompoundHistoryLockOwnerReader(
  database: PokeCompoundHistoryLockDatabase,
): (adapterId: 'blender', instanceId: string) => string | null {
  return (adapterId, instanceId) => {
    const latest = [
      ...database.listExecutionEventsByTypes([
        pokeCompoundHistoryLockEventType,
        ...pokeCompoundTransportHistoryLockEventTypes,
      ]),
    ]
      .sort((left, right) => right.sequence - left.sequence)
      .find((event) => {
        if (typeof event.payload !== 'object' || event.payload === null) return false;
        const payload = event.payload as {
          readonly target?: unknown;
          readonly execution?: { readonly target?: unknown };
        };
        const target = payload.target ?? payload.execution?.target;
        return (
          typeof target === 'object' &&
          target !== null &&
          (target as { readonly adapterId?: unknown }).adapterId === adapterId &&
          (target as { readonly instanceId?: unknown }).instanceId === instanceId
        );
      });
    if (latest === undefined) return null;
    const wrapped =
      typeof latest.payload === 'object' && latest.payload !== null
        ? (latest.payload as {
            readonly request?: { readonly replay?: unknown };
            readonly execution?: { readonly currentState?: unknown; readonly compoundId?: unknown };
          })
        : null;
    const wrappedReplay = wrapped?.request?.replay;
    const wrappedCurrentState = wrapped?.execution?.currentState;
    const replayCandidate = wrappedReplay ?? latest.payload;
    const parsed = procedureCompoundReplaySchema.safeParse(replayCandidate);
    const currentState =
      wrappedCurrentState === undefined
        ? parsed.success
          ? parsed.data.currentState
          : null
        : procedureCompoundCurrentStateSchema.safeParse(wrappedCurrentState);
    const validCurrentState =
      currentState === null
        ? null
        : 'success' in currentState
          ? currentState.success
            ? currentState.data
            : null
          : currentState;
    if (
      !parsed.success ||
      !verifyProcedureCompoundRecipeIntegrity(parsed.data.recipe) ||
      validCurrentState === null ||
      !verifyProcedureCompoundCurrentStateIntegrity(validCurrentState)
    ) {
      const rawRecipe = parsed.success
        ? parsed.data.recipe
        : typeof replayCandidate === 'object' && replayCandidate !== null
          ? (replayCandidate as { readonly recipe?: unknown }).recipe
          : undefined;
      const rawCompoundId =
        typeof rawRecipe === 'object' && rawRecipe !== null
          ? (rawRecipe as { readonly compoundId?: unknown }).compoundId
          : wrapped?.execution?.compoundId;
      return typeof rawCompoundId === 'string' ? rawCompoundId : 'poke-compound-history-quarantine';
    }
    return validCurrentState.historyLock === 'released' ? null : parsed.data.recipe.compoundId;
  };
}

/** Revalidate Blender-emitted decision evidence against the exact protocol/current-state binding. */
export function validatePokeCompoundDecisionEvidence(input: {
  readonly transition: 'forward' | 'back' | 'redo' | 'unlock_final' | 'abandon_baseline';
  readonly receipt: unknown;
  readonly binding: unknown;
  readonly consumption: unknown;
  readonly currentState: unknown;
  readonly planContentSha256: string;
  readonly target: { readonly adapterId: 'blender'; readonly instanceId: string };
  readonly actionCatalogVersion: string;
  readonly interactionCatalogVersion: string;
}): void {
  const currentState = procedureCompoundCurrentStateSchema.parse(input.currentState);
  if (!verifyProcedureCompoundCurrentStateIntegrity(currentState)) {
    throw new Error('Poke compound decision current-state integrity is invalid');
  }
  const consumption = decisionConsumptionEventSchema.parse(input.consumption);
  const receipt =
    input.transition === 'forward'
      ? blenderExecutionDecisionReceiptSchema.parse(input.receipt)
      : blenderHistoryTransitionDecisionReceiptSchema.parse(input.receipt);
  const binding =
    input.transition === 'forward'
      ? blenderExecutionBindingSchema.parse(input.binding)
      : blenderHistoryTransitionBindingSchema.parse(input.binding);
  const expectedBinding =
    receipt.kind === 'BlenderExecutionDecisionReceipt'
      ? {
          acceptedContentSha256: input.planContentSha256,
          acceptedContentKind: 'plan' as const,
          replayId: currentState.replayId,
          adapterId: input.target.adapterId,
          instanceId: input.target.instanceId,
          blenderSessionId: currentState.blenderSessionUid,
          documentFingerprintSha256: currentState.documentFingerprintSha256,
          actionCatalogVersion: input.actionCatalogVersion,
          interactionCatalogVersion: input.interactionCatalogVersion,
        }
      : {
          compoundId: currentState.compoundId,
          replayId: currentState.replayId,
          adapterId: input.target.adapterId,
          instanceId: input.target.instanceId,
          blenderProcessIdentitySha256: currentState.blenderProcessIdentitySha256,
          blenderSessionUid: currentState.blenderSessionUid,
          documentFingerprintSha256: currentState.documentFingerprintSha256,
          compoundContentSha256: currentState.compoundContentSha256,
          historyLockTokenSha256: currentState.historyLockTokenSha256,
          currentStateSha256: currentState.integritySha256,
          expectedHistoryHeadSha256: currentState.historyHeadSha256,
          transition: input.transition,
          expectedStatus: currentState.status,
          terminalObservationSha256: receipt.terminalObservationSha256,
          nativeHistoryLossRecorded: currentState.nativeHistoryLossRecorded,
          actionCatalogVersion: input.actionCatalogVersion,
          interactionCatalogVersion: input.interactionCatalogVersion,
        };
  if (!isDeepStrictEqual(binding, expectedBinding)) {
    throw new Error('Poke compound decision binding does not match current state');
  }
  if (
    receipt.replayId !== currentState.replayId ||
    receipt.target.adapterId !== input.target.adapterId ||
    receipt.target.instanceId !== input.target.instanceId ||
    receipt.actionCatalogVersion !== input.actionCatalogVersion ||
    receipt.interactionCatalogVersion !== input.interactionCatalogVersion ||
    (receipt.kind === 'BlenderExecutionDecisionReceipt'
      ? receipt.acceptedContentSha256 !== input.planContentSha256 ||
        receipt.blenderSessionId !== currentState.blenderSessionUid ||
        receipt.documentFingerprintSha256 !== currentState.documentFingerprintSha256
      : receipt.compoundId !== currentState.compoundId ||
        receipt.currentStateSha256 !== currentState.integritySha256 ||
        receipt.transition !== input.transition)
  ) {
    throw new Error('Poke compound decision receipt does not match its host context');
  }
  const expectedConsumptionKind =
    receipt.kind === 'BlenderExecutionDecisionReceipt'
      ? 'blender_decision_consumed'
      : 'blender_history_transition_consumed';
  const singleUseKeySha256 = computeProtocolCanonicalJsonSha256({ nonce: receipt.nonce });
  const bindingSha256 = computeProtocolCanonicalJsonSha256({
    decisionSha256: computeProtocolCanonicalJsonSha256(receipt),
    binding,
  });
  if (
    consumption.kind !== expectedConsumptionKind ||
    consumption.credentialId !== receipt.decisionId ||
    consumption.singleUseKeySha256 !== singleUseKeySha256 ||
    consumption.bindingSha256 !== bindingSha256 ||
    Date.parse(consumption.consumedAt) < Date.parse(receipt.issuedAt) ||
    Date.parse(consumption.consumedAt) >= Date.parse(receipt.expiresAt)
  ) {
    throw new Error('Poke compound trusted consumption event is invalid');
  }
  const trustedHistoryTransitionBinding =
    receipt.kind === 'BlenderHistoryTransitionDecisionReceipt'
      ? blenderHistoryTransitionBindingSchema.parse(binding)
      : null;
  const reconstructionConsumption = { ...consumption, sequence: 0 };
  const consumptionCoordinator = new AuthorityConsumptionCoordinator(
    new InMemoryAuthorityConsumptionStore([reconstructionConsumption]),
    {
      now: () => new Date(consumption.consumedAt),
      isTrustedLocalDecision: (candidate) => isDeepStrictEqual(candidate, receipt),
      resolveTrustedHistoryTransitionBinding: () => trustedHistoryTransitionBinding,
    },
  );
  const reconstructed =
    receipt.kind === 'BlenderExecutionDecisionReceipt'
      ? consumptionCoordinator.consumeBlenderDecision({
          decision: receipt,
          operationId: consumption.operationId,
          binding: blenderExecutionBindingSchema.parse(binding),
        })
      : consumptionCoordinator.consumeBlenderHistoryTransitionDecision({
          decision: receipt,
          operationId: consumption.operationId,
          binding: trustedHistoryTransitionBinding!,
        });
  if (!isDeepStrictEqual(reconstructed.consumption, reconstructionConsumption)) {
    throw new Error('Poke compound authority consumption could not be reconstructed');
  }
}

export type PokeCompoundHistoryContinuity =
  'same_live_session' | 'history_conflict' | 'history_lost';

/**
 * Verify the one supported compound shape without widening historical single-leaf replay.
 * The protocol verifier binds the consumed decision, three intent/receipt pairs, trusted host
 * attestations, and the middle leaf's Edit-only native checkpoint/Undo/Redo proof.
 */
export function validatePokeFacesCompoundReplayProof(input: {
  readonly replay: ProcedureCompoundReplay;
  readonly evidence: ProcedureCompoundReplayEvidenceResolver;
}): ProcedureCompoundReplay {
  const replay = procedureCompoundReplaySchema.parse(input.replay);
  const expectedLeaves =
    replay.recipe.kind === 'forward'
      ? ['enter_edit', 'poke', 'exit_edit']
      : replay.recipe.kind === 'back'
        ? ['enter_edit', 'native_undo_once', 'exit_edit']
        : ['enter_edit', 'native_redo_once', 'exit_edit'];
  if (
    replay.target.adapterId !== 'blender' ||
    replay.recipe.objectModeUndoRedoTransactionProven ||
    replay.recipe.leaves.some((leaf, index) => leaf.kind !== expectedLeaves[index]) ||
    replay.recipe.leaves[0].modelChanging ||
    !replay.recipe.leaves[1].modelChanging ||
    replay.recipe.leaves[2].modelChanging ||
    replay.recipe.leaves[0].nativeUndoRedoOperationCount !== 0 ||
    replay.recipe.leaves[2].nativeUndoRedoOperationCount !== 0 ||
    replay.recipe.leaves[1].nativeUndoRedoOperationCount !==
      (replay.recipe.kind === 'forward' ? 0 : 1) ||
    !verifyProcedureCompoundReplayIntegrity(replay, input.evidence)
  ) {
    throw new ProcedureLeafReplayError(
      'Poke Faces compound replay lacks the exact three-leaf native history proof',
      409,
    );
  }
  return replay;
}

/** Classify reconnect evidence without treating snapshots or managed compensation as history. */
export function classifyPokeCompoundHistoryContinuity(
  recorded: ProcedureCompoundCurrentState,
  observed: Partial<ProcedureCompoundCurrentState> | null,
): PokeCompoundHistoryContinuity {
  if (
    observed === null ||
    observed.blenderProcessIdentitySha256 === undefined ||
    observed.blenderSessionUid === undefined ||
    observed.nativeHistoryMarkerSha256 === undefined
  ) {
    return 'history_lost';
  }
  if (
    observed.blenderProcessIdentitySha256 !== recorded.blenderProcessIdentitySha256 ||
    observed.blenderSessionUid !== recorded.blenderSessionUid ||
    observed.nativeHistoryMarkerSha256 !== recorded.nativeHistoryMarkerSha256
  ) {
    return 'history_lost';
  }
  if (
    observed.compoundId !== recorded.compoundId ||
    observed.replayId !== recorded.replayId ||
    observed.compoundContentSha256 !== recorded.compoundContentSha256 ||
    observed.historyLockTokenSha256 !== recorded.historyLockTokenSha256 ||
    observed.documentFingerprintSha256 !== recorded.documentFingerprintSha256 ||
    observed.historyHeadSha256 !== recorded.historyHeadSha256 ||
    observed.objectIdentitySha256 !== recorded.objectIdentitySha256 ||
    observed.meshIdentitySha256 !== recorded.meshIdentitySha256 ||
    observed.objectPointerSha256 !== recorded.objectPointerSha256 ||
    observed.meshPointerSha256 !== recorded.meshPointerSha256 ||
    observed.meshDatablockSha256 !== recorded.meshDatablockSha256 ||
    observed.topologySha256 !== recorded.topologySha256 ||
    observed.selectionSha256 !== recorded.selectionSha256 ||
    observed.stateSha256 !== recorded.stateSha256 ||
    observed.status !== recorded.status ||
    observed.lifecycleState !== recorded.lifecycleState ||
    observed.mode !== recorded.mode ||
    observed.historyLock !== recorded.historyLock ||
    observed.historyContinuity !== recorded.historyContinuity ||
    observed.nativeHistoryLossRecorded !== recorded.nativeHistoryLossRecorded ||
    observed.inProgressLeafId !== recorded.inProgressLeafId ||
    observed.integritySha256 !== recorded.integritySha256 ||
    JSON.stringify(observed.permittedHistoryTransitions) !==
      JSON.stringify(recorded.permittedHistoryTransitions)
  ) {
    return 'history_conflict';
  }
  return 'same_live_session';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isFiniteVector3(value: unknown, bounded = false): value is [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every(
      (component) =>
        isFiniteNumber(component) && (!bounded || (component >= -1000 && component <= 1000)),
    )
  );
}

function isUnitQuaternion(value: unknown): value is [number, number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((component) => isFiniteNumber(component) && component >= -1 && component <= 1) &&
    Math.abs(Math.hypot(...value) - 1) <= 1e-6
  );
}

function isUnitAxisAngle(value: unknown): value is [number, number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every(
      (component) =>
        isFiniteNumber(component) && component >= -2 * Math.PI && component <= 2 * Math.PI,
    ) &&
    Math.abs(Math.hypot(value[1]!, value[2]!, value[3]!) - 1) <= 1e-6
  );
}

function hasReplayIdentity(parameters: Record<string, unknown>): boolean {
  return (
    typeof parameters['resourceId'] === 'string' &&
    parameters['resourceId'].length > 0 &&
    typeof parameters['objectName'] === 'string' &&
    parameters['objectName'].length > 0
  );
}

function segmentEndpointsDiffer(parameters: Record<string, unknown>): boolean {
  const start = parameters['start'];
  const end = parameters['end'];
  return (
    isFiniteVector3(start, true) &&
    isFiniteVector3(end, true) &&
    start.some((component, index) => component !== end[index])
  );
}

const logicalResourceIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function hasExactKeys(parameters: Record<string, unknown>, keys: readonly string[]): boolean {
  return (
    Object.keys(parameters).length === keys.length &&
    Object.keys(parameters).every((key) => keys.includes(key))
  );
}

function isLogicalResourceId(value: unknown): value is string {
  return typeof value === 'string' && logicalResourceIdPattern.test(value);
}

function isOperatingLineName(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('OperatingLine.') && value.length <= 180;
}

function isUniqueIntegerArray(
  value: unknown,
  minimum: number,
  maximum: number,
  maximumLength: number,
): value is number[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= maximumLength &&
    value.every(
      (item) => Number.isSafeInteger(item) && (item as number) >= minimum && item <= maximum,
    ) &&
    new Set(value).size === value.length
  );
}

function isManagedReplacementMeshParameters(
  parameters: Record<string, unknown>,
  additionalKeys: readonly string[],
): boolean {
  return (
    hasExactKeys(parameters, ['targetId', 'resultMeshId', 'resultMeshName', ...additionalKeys]) &&
    isLogicalResourceId(parameters['targetId']) &&
    isLogicalResourceId(parameters['resultMeshId']) &&
    parameters['targetId'] !== parameters['resultMeshId'] &&
    isOperatingLineName(parameters['resultMeshName'])
  );
}

function uniqueStringsInEncounterOrder(values: readonly unknown[]): string[] {
  const result: string[] = [];
  for (const value of values) {
    if (typeof value === 'string' && !result.includes(value)) result.push(value);
  }
  return result;
}

function isArmatureReplayParameters(parameters: Record<string, unknown>): boolean {
  const bones = parameters['bones'];
  const bindings = parameters['bindings'];
  if (
    !hasExactKeys(parameters, [
      'armatureId',
      'objectName',
      'dataName',
      'collectionId',
      'bones',
      'bindings',
    ]) ||
    !isLogicalResourceId(parameters['armatureId']) ||
    !isOperatingLineName(parameters['objectName']) ||
    !isOperatingLineName(parameters['dataName']) ||
    parameters['collectionId'] !== 'snowman.collection' ||
    !Array.isArray(bones) ||
    bones.length < 1 ||
    bones.length > 32 ||
    !Array.isArray(bindings) ||
    bindings.length < 1 ||
    bindings.length > 64
  ) {
    return false;
  }
  const boneNames = new Set<string>();
  for (const bone of bones) {
    if (
      typeof bone !== 'object' ||
      bone === null ||
      Array.isArray(bone) ||
      !hasExactKeys(bone as Record<string, unknown>, ['boneName', 'head', 'tail', 'parentName']) ||
      !isOperatingLineName((bone as Record<string, unknown>)['boneName']) ||
      !isFiniteVector3((bone as Record<string, unknown>)['head'], true) ||
      !isFiniteVector3((bone as Record<string, unknown>)['tail'], true) ||
      sameCanonicalValue(
        (bone as Record<string, unknown>)['head'],
        (bone as Record<string, unknown>)['tail'],
      )
    ) {
      return false;
    }
    const boneName = (bone as Record<string, unknown>)['boneName'] as string;
    if (boneNames.has(boneName)) return false;
    boneNames.add(boneName);
  }
  const targetIds = new Set<string>();
  return bindings.every((binding) => {
    if (typeof binding !== 'object' || binding === null || Array.isArray(binding)) return false;
    const value = binding as Record<string, unknown>;
    if (
      !hasExactKeys(value, ['targetId', 'boneName']) ||
      !isLogicalResourceId(value['targetId']) ||
      typeof value['boneName'] !== 'string' ||
      !boneNames.has(value['boneName']) ||
      targetIds.has(value['targetId'])
    ) {
      return false;
    }
    targetIds.add(value['targetId']);
    return true;
  });
}

function isSkinWeightsReplayParameters(parameters: Record<string, unknown>): boolean {
  const weights = parameters['weights'];
  if (
    !hasExactKeys(parameters, [
      'targetId',
      'armatureId',
      'modifierId',
      'modifierName',
      'preserveVolume',
      'weights',
    ]) ||
    !isLogicalResourceId(parameters['targetId']) ||
    !isLogicalResourceId(parameters['armatureId']) ||
    !isLogicalResourceId(parameters['modifierId']) ||
    !isOperatingLineName(parameters['modifierName']) ||
    typeof parameters['preserveVolume'] !== 'boolean' ||
    !Array.isArray(weights) ||
    weights.length < 1 ||
    weights.length > 8192
  ) {
    return false;
  }
  const vertexIndices = new Set<number>();
  return weights.every((weight) => {
    if (typeof weight !== 'object' || weight === null || Array.isArray(weight)) return false;
    const value = weight as Record<string, unknown>;
    const vertexIndex = value['vertexIndex'];
    const influences = value['influences'];
    if (
      !hasExactKeys(value, ['vertexIndex', 'influences']) ||
      !Number.isSafeInteger(vertexIndex) ||
      (vertexIndex as number) < 0 ||
      (vertexIndex as number) > 8191 ||
      vertexIndices.has(vertexIndex as number) ||
      !Array.isArray(influences) ||
      influences.length < 1 ||
      influences.length > 8
    ) {
      return false;
    }
    vertexIndices.add(vertexIndex as number);
    const boneNames = new Set<string>();
    let total = 0;
    for (const influence of influences) {
      if (typeof influence !== 'object' || influence === null || Array.isArray(influence)) {
        return false;
      }
      const item = influence as Record<string, unknown>;
      if (
        !hasExactKeys(item, ['boneName', 'weight']) ||
        !isOperatingLineName(item['boneName']) ||
        boneNames.has(item['boneName']) ||
        !isFiniteNumber(item['weight']) ||
        item['weight'] < 0.000001 ||
        item['weight'] > 1
      ) {
        return false;
      }
      boneNames.add(item['boneName']);
      total += item['weight'];
    }
    return Math.abs(total - 1) <= 1e-6;
  });
}

function isPoseAnimationReplayParameters(parameters: Record<string, unknown>): boolean {
  const keyframes = parameters['keyframes'];
  if (
    !hasExactKeys(parameters, [
      'actionId',
      'actionName',
      'armatureId',
      'interpolation',
      'extrapolation',
      'keyframes',
    ]) ||
    !isLogicalResourceId(parameters['actionId']) ||
    !isOperatingLineName(parameters['actionName']) ||
    !isLogicalResourceId(parameters['armatureId']) ||
    !['BEZIER', 'LINEAR', 'CONSTANT'].includes(String(parameters['interpolation'])) ||
    !['CONSTANT', 'LINEAR'].includes(String(parameters['extrapolation'])) ||
    !Array.isArray(keyframes) ||
    keyframes.length < 2 ||
    keyframes.length > 64
  ) {
    return false;
  }
  let previousFrame = 0;
  type RotationChannel = 'rotationEuler' | 'rotationQuaternion' | 'rotationAxisAngle';
  const rotationChannelByBone = new Map<string, RotationChannel>();
  return keyframes.every((keyframe) => {
    if (typeof keyframe !== 'object' || keyframe === null || Array.isArray(keyframe)) return false;
    const value = keyframe as Record<string, unknown>;
    const frame = value['frame'];
    const poses = value['poses'];
    if (
      !hasExactKeys(value, ['frame', 'poses']) ||
      !Number.isSafeInteger(frame) ||
      (frame as number) <= previousFrame ||
      (frame as number) > 100000 ||
      !Array.isArray(poses) ||
      poses.length < 1 ||
      poses.length > 32
    ) {
      return false;
    }
    previousFrame = frame as number;
    const boneNames = new Set<string>();
    return poses.every((pose) => {
      if (typeof pose !== 'object' || pose === null || Array.isArray(pose)) return false;
      const item = pose as Record<string, unknown>;
      const keys = Object.keys(item);
      const hasEuler = keys.includes('rotationEuler');
      const hasQuaternion = keys.includes('rotationQuaternion');
      const hasAxisAngle = keys.includes('rotationAxisAngle');
      const rotationChannels = [hasEuler, hasQuaternion, hasAxisAngle].filter(Boolean).length;
      const rotationChannel: RotationChannel = hasEuler
        ? 'rotationEuler'
        : hasQuaternion
          ? 'rotationQuaternion'
          : 'rotationAxisAngle';
      const previousRotationChannel =
        typeof item['boneName'] === 'string'
          ? rotationChannelByBone.get(item['boneName'])
          : undefined;
      if (
        !keys.every((key) =>
          [
            'boneName',
            'rotationEuler',
            'rotationQuaternion',
            'rotationAxisAngle',
            'location',
            'scale',
          ].includes(key),
        ) ||
        !keys.includes('boneName') ||
        rotationChannels !== 1 ||
        !isOperatingLineName(item['boneName']) ||
        boneNames.has(item['boneName']) ||
        (hasEuler &&
          (!isFiniteVector3(item['rotationEuler']) ||
            !(item['rotationEuler'] as number[]).every(
              (component) => component >= -2 * Math.PI && component <= 2 * Math.PI,
            ))) ||
        (hasQuaternion && !isUnitQuaternion(item['rotationQuaternion'])) ||
        (hasAxisAngle && !isUnitAxisAngle(item['rotationAxisAngle'])) ||
        (previousRotationChannel !== undefined && previousRotationChannel !== rotationChannel) ||
        (item['location'] !== undefined && !isFiniteVector3(item['location'], true)) ||
        (item['scale'] !== undefined &&
          (!isFiniteVector3(item['scale']) ||
            !(item['scale'] as number[]).every(
              (component) => component >= 0.0001 && component <= 1000,
            )))
      ) {
        return false;
      }
      rotationChannelByBone.set(item['boneName'], rotationChannel);
      boneNames.add(item['boneName']);
      return true;
    });
  });
}

const replayCanonicalLightTrailsNodeTypes = [
  'GeometryNodeCurvePrimitiveCircle',
  'GeometryNodeCurvePrimitiveLine',
  'GeometryNodeCurveToMesh',
  'GeometryNodeInputPosition',
  'GeometryNodeInstanceOnPoints',
  'GeometryNodeInstanceOnPoints',
  'GeometryNodeJoinGeometry',
  'GeometryNodeMeshLine',
  'GeometryNodeMeshLine',
  'GeometryNodeRealizeInstances',
  'GeometryNodeRealizeInstances',
  'GeometryNodeResampleCurve',
  'GeometryNodeSetPosition',
  'GeometryNodeTransform',
  'NodeGroupInput',
  'NodeGroupOutput',
  'ShaderNodeCombineXYZ',
  'ShaderNodeMath',
  'ShaderNodeMath',
  'ShaderNodeTexNoise',
] as const;

const replayCanonicalTransformGeometryNodeTypes = [
  'GeometryNodeTransform',
  'NodeGroupInput',
  'NodeGroupOutput',
] as const;

function isTransformGeometryReplayParameters(parameters: Record<string, unknown>): boolean {
  return (
    hasExactKeys(parameters, ['targetId', 'modifierId', 'nodeGroupId', 'nodeTypes']) &&
    isLogicalResourceId(parameters['targetId']) &&
    isLogicalResourceId(parameters['modifierId']) &&
    isLogicalResourceId(parameters['nodeGroupId']) &&
    sameStringArray(parameters['nodeTypes'], replayCanonicalTransformGeometryNodeTypes)
  );
}

const replayCanonicalLightTrailsInterface = [
  ['INPUT', 'NodeSocketGeometry', 'Geometry'],
  ['OUTPUT', 'NodeSocketGeometry', 'Geometry'],
] as const;

const replayCanonicalLightTrailsLinks = [
  ['OperatingLine Center Noise', 'Value', 'OperatingLine Scale Height', 'Value'],
  ['OperatingLine Curve To Mesh', 'Mesh', 'OperatingLine Tile Instances', 'Instance'],
  ['OperatingLine Displace Trails', 'Geometry', 'OperatingLine Mirror Half Tile', 'Geometry'],
  ['OperatingLine Displace Trails', 'Geometry', 'OperatingLine Mirrored Tile', 'Geometry'],
  ['OperatingLine Half Tile Line', 'Curve', 'OperatingLine Trail Resolution', 'Curve'],
  ['OperatingLine Loop Tiles', 'Mesh', 'OperatingLine Tile Instances', 'Points'],
  ['OperatingLine Mirror Half Tile', 'Geometry', 'OperatingLine Mirrored Tile', 'Geometry'],
  ['OperatingLine Mirrored Tile', 'Geometry', 'OperatingLine Curve To Mesh', 'Curve'],
  ['OperatingLine Realize Tiles', 'Geometry', 'OperatingLine Output', 'GROUP_OUTPUT_GEOMETRY'],
  ['OperatingLine Realize Trails', 'Geometry', 'OperatingLine Displace Trails', 'Geometry'],
  ['OperatingLine Scale Height', 'Value', 'OperatingLine Z Offset', 'Z'],
  ['OperatingLine Terrain Noise', 'Fac', 'OperatingLine Center Noise', 'Value'],
  ['OperatingLine Tile Instances', 'Instances', 'OperatingLine Realize Tiles', 'Geometry'],
  ['OperatingLine Trail Instances', 'Instances', 'OperatingLine Realize Trails', 'Geometry'],
  ['OperatingLine Trail Position', 'Position', 'OperatingLine Terrain Noise', 'Vector'],
  ['OperatingLine Trail Profile', 'Curve', 'OperatingLine Curve To Mesh', 'Profile Curve'],
  ['OperatingLine Trail Resolution', 'Curve', 'OperatingLine Trail Instances', 'Instance'],
  ['OperatingLine Trail Rows', 'Mesh', 'OperatingLine Trail Instances', 'Points'],
  ['OperatingLine Z Offset', 'Vector', 'OperatingLine Displace Trails', 'Offset'],
] as const;

const replayLightTrailsSemanticParameterKeys = [
  'trailCount',
  'pointsPerTrail',
  'tileLength',
  'trailSpacing',
  'noiseScale',
  'noiseDetail',
  'noiseRoughness',
  'noiseSeed',
  'height',
  'profileSides',
  'profileRadius',
  'tileRepeatCount',
] as const;

function isLightTrailsReplayParameters(parameters: Record<string, unknown>): boolean {
  if (
    !hasExactKeys(parameters, [
      'targetId',
      'modifierId',
      'modifierName',
      'nodeGroupId',
      'nodeGroupName',
      ...replayLightTrailsSemanticParameterKeys,
      'nodeTypes',
    ]) ||
    !isLogicalResourceId(parameters['targetId']) ||
    !isLogicalResourceId(parameters['modifierId']) ||
    !isOperatingLineName(parameters['modifierName']) ||
    !isLogicalResourceId(parameters['nodeGroupId']) ||
    !isOperatingLineName(parameters['nodeGroupName']) ||
    !Array.isArray(parameters['nodeTypes']) ||
    !sameCanonicalValue(
      [...parameters['nodeTypes']].sort(),
      [...replayCanonicalLightTrailsNodeTypes].sort(),
    )
  ) {
    return false;
  }
  const boundedNumber = (key: string, minimum: number, maximum: number) =>
    isFiniteNumber(parameters[key]) && parameters[key] >= minimum && parameters[key] <= maximum;
  return (
    Number.isSafeInteger(parameters['trailCount']) &&
    boundedNumber('trailCount', 1, 128) &&
    Number.isSafeInteger(parameters['pointsPerTrail']) &&
    boundedNumber('pointsPerTrail', 8, 512) &&
    boundedNumber('tileLength', 0.1, 1000) &&
    boundedNumber('trailSpacing', 0.0001, 100) &&
    boundedNumber('noiseScale', 0.0001, 1000) &&
    boundedNumber('noiseDetail', 0, 15) &&
    boundedNumber('noiseRoughness', 0, 1) &&
    boundedNumber('noiseSeed', -10_000, 10_000) &&
    boundedNumber('height', 0, 100) &&
    Number.isSafeInteger(parameters['profileSides']) &&
    boundedNumber('profileSides', 3, 8) &&
    boundedNumber('profileRadius', 0.0001, 10) &&
    Number.isSafeInteger(parameters['tileRepeatCount']) &&
    boundedNumber('tileRepeatCount', 1, 5) &&
    (parameters['trailCount'] as number) *
      (parameters['pointsPerTrail'] as number) *
      (parameters['profileSides'] as number) *
      (parameters['tileRepeatCount'] as number) *
      2 <=
      3_000_000
  );
}

const replayCanonicalTrailMaterialNodeTypes = [
  'ShaderNodeBsdfPrincipled',
  'ShaderNodeMapping',
  'ShaderNodeMixRGB',
  'ShaderNodeOutputMaterial',
  'ShaderNodeTexCoord',
  'ShaderNodeTexGradient',
  'ShaderNodeTexWave',
  'ShaderNodeValToRGB',
  'ShaderNodeValToRGB',
] as const;
const replayCanonicalFloorMaterialNodeTypes = [
  'ShaderNodeBsdfPrincipled',
  'ShaderNodeBump',
  'ShaderNodeMapping',
  'ShaderNodeOutputMaterial',
  'ShaderNodeTexCoord',
  'ShaderNodeTexVoronoi',
  'ShaderNodeValToRGB',
  'ShaderNodeValToRGB',
] as const;
const replayCanonicalCompositorNodeTypes = [
  'CompositorNodeComposite',
  'CompositorNodeGlare',
  'CompositorNodeRLayers',
] as const;
const replayLightTrailsSceneIdentityKeys = [
  'collectionId',
  'trailTargetId',
  'floorTargetId',
  'sceneId',
  'sceneName',
  'worldId',
  'worldName',
  'cameraId',
  'cameraObjectName',
  'cameraDataName',
  'controllerId',
  'controllerObjectName',
  'trailMaterialId',
  'trailMaterialName',
  'floorMaterialId',
  'floorMaterialName',
  'cameraActionId',
  'cameraActionName',
] as const;
const replayLightTrailsSceneScalarKeys = [
  'frameStart',
  'frameEnd',
  'lens',
  'fStop',
  'focusDistance',
  'trailEmissionStrength',
  'gradientRotationDegrees',
  'gradientStart',
  'glowBandStart',
  'glowBandEnd',
  'gradientEnd',
  'waveScale',
  'floorEmissionStrength',
  'floorMetallic',
  'floorVoronoiScale',
  'floorRoughnessMinimum',
  'floorRoughnessMaximum',
  'floorBumpStrength',
  'floorBumpDistance',
] as const;
const replayLightTrailsSceneVectorKeys = ['cameraStart', 'cameraEnd', 'cameraTarget'] as const;
const replayLightTrailsSceneColorKeys = [
  'trailBaseColor',
  'trailGlowColor',
  'floorBaseColor',
  'floorEmissionColor',
] as const;

function isFiniteBoundedArray(
  value: unknown,
  length: number,
  minimum: number,
  maximum: number,
): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every(
      (component) => isFiniteNumber(component) && component >= minimum && component <= maximum,
    )
  );
}

function isLightTrailsSceneReplayParameters(parameters: Record<string, unknown>): boolean {
  if (
    !hasExactKeys(parameters, [
      ...replayLightTrailsSceneIdentityKeys,
      ...replayLightTrailsSceneScalarKeys,
      ...replayLightTrailsSceneVectorKeys,
      ...replayLightTrailsSceneColorKeys,
      'trailMaterialNodeTypes',
      'floorMaterialNodeTypes',
      'compositorNodeTypes',
    ]) ||
    !replayLightTrailsSceneIdentityKeys.every((key) =>
      key.endsWith('Name')
        ? isOperatingLineName(parameters[key])
        : isLogicalResourceId(parameters[key]),
    ) ||
    parameters['collectionId'] !== 'snowman.collection' ||
    !replayLightTrailsSceneVectorKeys.every((key) =>
      isFiniteBoundedArray(parameters[key], 3, -1000, 1000),
    ) ||
    !replayLightTrailsSceneColorKeys.every((key) =>
      isFiniteBoundedArray(parameters[key], 4, 0, 1),
    ) ||
    !sameCanonicalValue(
      parameters['trailMaterialNodeTypes'],
      replayCanonicalTrailMaterialNodeTypes,
    ) ||
    !sameCanonicalValue(
      parameters['floorMaterialNodeTypes'],
      replayCanonicalFloorMaterialNodeTypes,
    ) ||
    !sameCanonicalValue(parameters['compositorNodeTypes'], replayCanonicalCompositorNodeTypes)
  ) {
    return false;
  }
  const bounded = (key: string, minimum: number, maximum: number) =>
    isFiniteNumber(parameters[key]) && parameters[key] >= minimum && parameters[key] <= maximum;
  const frameStart = parameters['frameStart'];
  const frameEnd = parameters['frameEnd'];
  const cameraStart = parameters['cameraStart'] as number[];
  const cameraEnd = parameters['cameraEnd'] as number[];
  const cameraTarget = parameters['cameraTarget'] as number[];
  return (
    Number.isSafeInteger(frameStart) &&
    bounded('frameStart', 0, 99_999) &&
    Number.isSafeInteger(frameEnd) &&
    bounded('frameEnd', 1, 100_000) &&
    (frameEnd as number) > (frameStart as number) &&
    cameraStart.some((component, index) => component !== cameraEnd[index]) &&
    cameraStart.some((component, index) => component !== cameraTarget[index]) &&
    parameters['trailTargetId'] !== parameters['floorTargetId'] &&
    parameters['cameraObjectName'] !== parameters['controllerObjectName'] &&
    parameters['trailMaterialName'] !== parameters['floorMaterialName'] &&
    bounded('lens', 1, 1000) &&
    bounded('fStop', 0.1, 64) &&
    bounded('focusDistance', 0.001, 1000) &&
    bounded('trailEmissionStrength', 0, 10_000) &&
    bounded('gradientRotationDegrees', -360, 360) &&
    bounded('gradientStart', 0, 1) &&
    bounded('glowBandStart', 0, 1) &&
    bounded('glowBandEnd', 0, 1) &&
    bounded('gradientEnd', 0, 1) &&
    (parameters['gradientStart'] as number) < (parameters['glowBandStart'] as number) &&
    (parameters['glowBandStart'] as number) < (parameters['glowBandEnd'] as number) &&
    (parameters['glowBandEnd'] as number) < (parameters['gradientEnd'] as number) &&
    bounded('waveScale', 0.0001, 1000) &&
    bounded('floorEmissionStrength', 0, 10_000) &&
    bounded('floorMetallic', 0, 1) &&
    bounded('floorVoronoiScale', 0.0001, 1000) &&
    bounded('floorRoughnessMinimum', 0, 1) &&
    bounded('floorRoughnessMaximum', 0, 1) &&
    (parameters['floorRoughnessMinimum'] as number) <
      (parameters['floorRoughnessMaximum'] as number) &&
    bounded('floorBumpStrength', 0, 100) &&
    bounded('floorBumpDistance', 0.0001, 1000)
  );
}

function isSingleMaterialActionArguments(parameters: Record<string, unknown>): boolean {
  const targets = parameters['targets'];
  const baseColor = parameters['baseColor'];
  return (
    hasExactKeys(parameters, [
      'materialId',
      'materialName',
      'targets',
      'baseColor',
      'roughness',
      'metallic',
    ]) &&
    isLogicalResourceId(parameters['materialId']) &&
    isOperatingLineName(parameters['materialName']) &&
    Array.isArray(targets) &&
    targets.length >= 1 &&
    targets.length <= 64 &&
    targets.every(isLogicalResourceId) &&
    new Set(targets).size === targets.length &&
    Array.isArray(baseColor) &&
    baseColor.length === 4 &&
    baseColor.every((component) => isFiniteNumber(component) && component >= 0 && component <= 1) &&
    isFiniteNumber(parameters['roughness']) &&
    parameters['roughness'] >= 0 &&
    parameters['roughness'] <= 1 &&
    isFiniteNumber(parameters['metallic']) &&
    parameters['metallic'] >= 0 &&
    parameters['metallic'] <= 1
  );
}

function isSingleMaterialObservationParameters(parameters: Record<string, unknown>): boolean {
  const targets = parameters['targets'];
  return (
    hasExactKeys(parameters, ['materialId', 'targets']) &&
    isLogicalResourceId(parameters['materialId']) &&
    Array.isArray(targets) &&
    targets.length >= 1 &&
    targets.length <= 64 &&
    targets.every(isLogicalResourceId) &&
    new Set(targets).size === targets.length
  );
}

function isMaterialPaletteActionArguments(parameters: Record<string, unknown>): boolean {
  const materials = parameters['materials'];
  if (
    !hasExactKeys(parameters, ['materials']) ||
    !Array.isArray(materials) ||
    materials.length < 1 ||
    materials.length > 8 ||
    materials.some(
      (material) =>
        material === null ||
        typeof material !== 'object' ||
        Array.isArray(material) ||
        !isSingleMaterialActionArguments(material as Record<string, unknown>),
    )
  ) {
    return false;
  }
  const materialIds = materials.map((material) => material['materialId']);
  const materialNames = materials.map((material) => material['materialName']);
  const targetIds = materials.flatMap((material) => material['targets'] as string[]);
  return (
    new Set(materialIds).size === materialIds.length &&
    new Set(materialNames).size === materialNames.length &&
    new Set(targetIds).size === targetIds.length
  );
}

function materialPaletteExpectedObservationsValid(
  observations: readonly { readonly kind: string; readonly parameters: Record<string, unknown> }[],
  actionArguments: Record<string, unknown>,
): boolean {
  if (!isMaterialPaletteActionArguments(actionArguments)) return false;
  const materials = actionArguments['materials'] as Record<string, unknown>[];
  return (
    observations.length === materials.length &&
    observations.every((observation, index) => {
      const definition = materials[index]!;
      if (
        observation.kind !== 'material_assigned' ||
        !isSingleMaterialObservationParameters(observation.parameters) ||
        observation.parameters['materialId'] !== definition['materialId']
      ) {
        return false;
      }
      const acceptedTargets = definition['targets'] as string[];
      const observedTargets = observation.parameters['targets'] as string[];
      let cursor = 0;
      return observedTargets.every((targetId) => {
        const next = acceptedTargets.indexOf(targetId, cursor);
        if (next < 0) return false;
        cursor = next + 1;
        return true;
      });
    })
  );
}

const replayActionContracts = {
  'blender.mesh.create_uv_sphere': {
    observationShape: 'mesh_primitive',
    observationKind: 'uv_sphere_ready',
    geometryMatchDetailKeys: ['radiusMatches'],
    expectedParameters: (actionArguments: Record<string, unknown>) => ({
      resourceId: actionArguments['resourceId'],
      objectName: actionArguments['objectName'],
      radius: actionArguments['radius'],
      location: actionArguments['location'],
    }),
    parametersValid: (parameters: Record<string, unknown>) =>
      hasReplayIdentity(parameters) &&
      isFiniteNumber(parameters['radius']) &&
      parameters['radius'] > 0 &&
      isFiniteVector3(parameters['location']),
    expectedTopology: () => ({ vertexCount: 482, edgeCount: 992, faceCount: 512 }),
  },
  'blender.mesh.create_icosphere': {
    observationShape: 'mesh_primitive',
    observationKind: 'icosphere_ready',
    geometryMatchDetailKeys: ['radiusMatches'],
    expectedParameters: (actionArguments: Record<string, unknown>) => ({
      resourceId: actionArguments['resourceId'],
      objectName: actionArguments['objectName'],
      subdivisions: actionArguments['subdivisions'],
      radius: actionArguments['radius'],
      location: actionArguments['location'],
    }),
    parametersValid: (parameters: Record<string, unknown>) =>
      hasReplayIdentity(parameters) &&
      isFiniteNumber(parameters['subdivisions']) &&
      Number.isInteger(parameters['subdivisions']) &&
      parameters['subdivisions'] >= 1 &&
      parameters['subdivisions'] <= 5 &&
      isFiniteNumber(parameters['radius']) &&
      parameters['radius'] > 0 &&
      isFiniteVector3(parameters['location']),
    expectedTopology: (actionArguments: Record<string, unknown>) => {
      const subdivisions = actionArguments['subdivisions'];
      if (
        typeof subdivisions !== 'number' ||
        !Number.isInteger(subdivisions) ||
        subdivisions < 1 ||
        subdivisions > 5
      ) {
        return null;
      }
      const scale = 4 ** (subdivisions - 1);
      return {
        vertexCount: 10 * scale + 2,
        edgeCount: 30 * scale,
        faceCount: 20 * scale,
      };
    },
  },
  'blender.mesh.create_cube': {
    observationShape: 'mesh_primitive',
    observationKind: 'cube_ready',
    geometryMatchDetailKeys: ['sizeMatches'],
    expectedParameters: (actionArguments: Record<string, unknown>) => ({
      resourceId: actionArguments['resourceId'],
      objectName: actionArguments['objectName'],
      size: actionArguments['size'],
      location: actionArguments['location'],
    }),
    parametersValid: (parameters: Record<string, unknown>) =>
      hasReplayIdentity(parameters) &&
      isFiniteNumber(parameters['size']) &&
      parameters['size'] > 0 &&
      isFiniteVector3(parameters['location']),
    expectedTopology: () => ({ vertexCount: 8, edgeCount: 12, faceCount: 6 }),
  },
  'blender.mesh.create_plane': {
    observationShape: 'mesh_primitive',
    observationKind: 'plane_ready',
    geometryMatchDetailKeys: ['sizeMatches'],
    expectedParameters: (actionArguments: Record<string, unknown>) => ({
      resourceId: actionArguments['resourceId'],
      objectName: actionArguments['objectName'],
      size: actionArguments['size'],
      location: actionArguments['location'],
    }),
    parametersValid: (parameters: Record<string, unknown>) =>
      hasReplayIdentity(parameters) &&
      isFiniteNumber(parameters['size']) &&
      parameters['size'] > 0 &&
      isFiniteVector3(parameters['location']),
    expectedTopology: () => ({ vertexCount: 4, edgeCount: 4, faceCount: 1 }),
  },
  'blender.mesh.create_torus': {
    observationShape: 'mesh_primitive',
    observationKind: 'torus_ready',
    geometryMatchDetailKeys: ['geometryMatches'],
    expectedParameters: (actionArguments: Record<string, unknown>) => ({
      resourceId: actionArguments['resourceId'],
      objectName: actionArguments['objectName'],
      majorSegments: actionArguments['majorSegments'],
      minorSegments: actionArguments['minorSegments'],
      majorRadius: actionArguments['majorRadius'],
      minorRadius: actionArguments['minorRadius'],
      location: actionArguments['location'],
    }),
    parametersValid: (parameters: Record<string, unknown>) =>
      hasReplayIdentity(parameters) &&
      isFiniteNumber(parameters['majorSegments']) &&
      Number.isInteger(parameters['majorSegments']) &&
      parameters['majorSegments'] >= 3 &&
      parameters['majorSegments'] <= 128 &&
      isFiniteNumber(parameters['minorSegments']) &&
      Number.isInteger(parameters['minorSegments']) &&
      parameters['minorSegments'] >= 3 &&
      parameters['minorSegments'] <= 64 &&
      isFiniteNumber(parameters['majorRadius']) &&
      parameters['majorRadius'] > 0 &&
      isFiniteNumber(parameters['minorRadius']) &&
      parameters['minorRadius'] > 0 &&
      isFiniteVector3(parameters['location']),
    expectedTopology: (actionArguments: Record<string, unknown>) => {
      const majorSegments = actionArguments['majorSegments'];
      const minorSegments = actionArguments['minorSegments'];
      if (
        typeof majorSegments !== 'number' ||
        !Number.isInteger(majorSegments) ||
        majorSegments < 3 ||
        majorSegments > 128 ||
        typeof minorSegments !== 'number' ||
        !Number.isInteger(minorSegments) ||
        minorSegments < 3 ||
        minorSegments > 64
      ) {
        return null;
      }
      const vertexCount = majorSegments * minorSegments;
      return { vertexCount, edgeCount: vertexCount * 2, faceCount: vertexCount };
    },
  },
  'blender.mesh.create_cone': {
    observationShape: 'mesh_primitive',
    observationKind: 'cone_ready',
    geometryMatchDetailKeys: ['segmentGeometryMatches', 'endpointsMatch'],
    expectedParameters: (actionArguments: Record<string, unknown>) => ({
      resourceId: actionArguments['resourceId'],
      objectName: actionArguments['objectName'],
      radiusStart: actionArguments['radiusStart'],
      radiusEnd: actionArguments['radiusEnd'],
      start: actionArguments['start'],
      end: actionArguments['end'],
    }),
    parametersValid: (parameters: Record<string, unknown>) =>
      hasReplayIdentity(parameters) &&
      isFiniteNumber(parameters['radiusStart']) &&
      parameters['radiusStart'] >= 0 &&
      parameters['radiusStart'] <= 1000 &&
      isFiniteNumber(parameters['radiusEnd']) &&
      parameters['radiusEnd'] >= 0 &&
      parameters['radiusEnd'] <= 1000 &&
      (parameters['radiusStart'] > 0 || parameters['radiusEnd'] > 0) &&
      segmentEndpointsDiffer(parameters),
    expectedTopology: (actionArguments: Record<string, unknown>) => {
      const radiusStart = actionArguments['radiusStart'];
      const radiusEnd = actionArguments['radiusEnd'];
      if (!isFiniteNumber(radiusStart) || !isFiniteNumber(radiusEnd)) return null;
      return radiusStart === 0 || radiusEnd === 0
        ? { vertexCount: 33, edgeCount: 64, faceCount: 33 }
        : { vertexCount: 64, edgeCount: 96, faceCount: 34 };
    },
  },
  'blender.mesh.create_cylinder': {
    observationShape: 'mesh_primitive',
    observationKind: 'cylinder_ready',
    geometryMatchDetailKeys: ['segmentGeometryMatches', 'endpointsMatch'],
    expectedParameters: (actionArguments: Record<string, unknown>) => ({
      resourceId: actionArguments['resourceId'],
      objectName: actionArguments['objectName'],
      radius: actionArguments['radius'],
      start: actionArguments['start'],
      end: actionArguments['end'],
    }),
    parametersValid: (parameters: Record<string, unknown>) =>
      hasReplayIdentity(parameters) &&
      isFiniteNumber(parameters['radius']) &&
      parameters['radius'] >= 0.0001 &&
      parameters['radius'] <= 1000 &&
      segmentEndpointsDiffer(parameters),
    expectedTopology: () => ({ vertexCount: 64, edgeCount: 96, faceCount: 34 }),
  },
  'blender.mesh.edit_subdivide': {
    observationShape: 'managed_edit',
    observationKind: 'mesh_topology_matches',
    expectedParameters: (actionArguments: Record<string, unknown>) => ({
      targetId: actionArguments['targetId'],
      resultMeshId: actionArguments['resultMeshId'],
      resultMeshName: actionArguments['resultMeshName'],
      cuts: actionArguments['cuts'],
      smooth: actionArguments['smooth'],
    }),
    parametersValid: (parameters: Record<string, unknown>) =>
      isManagedReplacementMeshParameters(parameters, ['cuts', 'smooth']) &&
      Number.isSafeInteger(parameters['cuts']) &&
      (parameters['cuts'] as number) >= 1 &&
      (parameters['cuts'] as number) <= 8 &&
      isFiniteNumber(parameters['smooth']) &&
      parameters['smooth'] >= 0 &&
      parameters['smooth'] <= 1,
  },
  'blender.mesh.edit_triangulate': {
    observationShape: 'managed_edit',
    observationKind: 'mesh_triangulated',
    expectedParameters: (actionArguments: Record<string, unknown>) => ({
      targetId: actionArguments['targetId'],
      resultMeshId: actionArguments['resultMeshId'],
      resultMeshName: actionArguments['resultMeshName'],
    }),
    parametersValid: (parameters: Record<string, unknown>) =>
      isManagedReplacementMeshParameters(parameters, []),
  },
  'blender.mesh.edit_extrude_region': {
    observationShape: 'managed_edit',
    observationKind: 'mesh_region_extruded',
    expectedParameters: (actionArguments: Record<string, unknown>) => ({
      targetId: actionArguments['targetId'],
      resultMeshId: actionArguments['resultMeshId'],
      resultMeshName: actionArguments['resultMeshName'],
      polygonIndices: structuredClone(actionArguments['polygonIndices']),
      translation: structuredClone(actionArguments['translation']),
    }),
    parametersValid: (parameters: Record<string, unknown>) =>
      isManagedReplacementMeshParameters(parameters, ['polygonIndices', 'translation']) &&
      isUniqueIntegerArray(parameters['polygonIndices'], 0, 8191, 256) &&
      isFiniteVector3(parameters['translation'], true) &&
      Math.hypot(...parameters['translation']) >= 0.0001 &&
      Math.hypot(...parameters['translation']) <= 1000,
  },
  'blender.mesh.edit_bevel_edges': {
    observationShape: 'managed_edit',
    observationKind: 'mesh_edges_beveled',
    expectedParameters: (actionArguments: Record<string, unknown>) => ({
      targetId: actionArguments['targetId'],
      resultMeshId: actionArguments['resultMeshId'],
      resultMeshName: actionArguments['resultMeshName'],
      width: actionArguments['width'],
      segments: actionArguments['segments'],
      profile: actionArguments['profile'],
    }),
    parametersValid: (parameters: Record<string, unknown>) =>
      isManagedReplacementMeshParameters(parameters, ['width', 'segments', 'profile']) &&
      isFiniteNumber(parameters['width']) &&
      parameters['width'] >= 0.0001 &&
      parameters['width'] <= 100 &&
      Number.isSafeInteger(parameters['segments']) &&
      (parameters['segments'] as number) >= 1 &&
      (parameters['segments'] as number) <= 16 &&
      isFiniteNumber(parameters['profile']) &&
      parameters['profile'] >= 0 &&
      parameters['profile'] <= 1,
  },
  'blender.mesh.edit_inset_faces': {
    observationShape: 'managed_edit',
    observationKind: 'mesh_faces_inset',
    expectedParameters: (actionArguments: Record<string, unknown>) => ({
      targetId: actionArguments['targetId'],
      resultMeshId: actionArguments['resultMeshId'],
      resultMeshName: actionArguments['resultMeshName'],
      thickness: actionArguments['thickness'],
      depth: actionArguments['depth'],
    }),
    parametersValid: (parameters: Record<string, unknown>) =>
      isManagedReplacementMeshParameters(parameters, ['thickness', 'depth']) &&
      isFiniteNumber(parameters['thickness']) &&
      parameters['thickness'] >= 0.0001 &&
      parameters['thickness'] <= 100 &&
      isFiniteNumber(parameters['depth']) &&
      parameters['depth'] >= -100 &&
      parameters['depth'] <= 100,
  },
  'blender.mesh.edit_poke_faces': {
    observationShape: 'managed_edit',
    observationKind: 'mesh_faces_poked',
    expectedParameters: (actionArguments: Record<string, unknown>) => ({
      targetId: actionArguments['targetId'],
      resultMeshId: actionArguments['resultMeshId'],
      resultMeshName: actionArguments['resultMeshName'],
      offset: actionArguments['offset'],
    }),
    parametersValid: (parameters: Record<string, unknown>) =>
      isManagedReplacementMeshParameters(parameters, ['offset']) &&
      isFiniteNumber(parameters['offset']) &&
      parameters['offset'] >= -100 &&
      parameters['offset'] <= 100,
  },
  'blender.modifier.add_mirror': {
    observationShape: 'mirror_modifier',
    observationKind: 'modifier_ready',
    expectedParameters: (actionArguments: Record<string, unknown>) => ({
      targetId: actionArguments['targetId'],
      modifierId: actionArguments['modifierId'],
      modifierType: 'MIRROR',
      axis: actionArguments['axis'],
    }),
    parametersValid: (parameters: Record<string, unknown>) =>
      Object.keys(parameters).length === 4 &&
      typeof parameters['targetId'] === 'string' &&
      parameters['targetId'].length > 0 &&
      typeof parameters['modifierId'] === 'string' &&
      parameters['modifierId'].length > 0 &&
      parameters['modifierType'] === 'MIRROR' &&
      ['X', 'Y', 'Z'].includes(String(parameters['axis'])),
  },
  'blender.modifier.add_solidify': {
    observationShape: 'solidify_modifier',
    observationKind: 'modifier_ready',
    expectedParameters: (actionArguments: Record<string, unknown>) => ({
      targetId: actionArguments['targetId'],
      modifierId: actionArguments['modifierId'],
      modifierType: 'SOLIDIFY',
      thickness: actionArguments['thickness'],
      offset: actionArguments['offset'],
      solidifyMode: 'EXTRUDE',
      useEvenOffset: true,
      useRim: true,
      useRimOnly: false,
    }),
    parametersValid: (parameters: Record<string, unknown>) =>
      Object.keys(parameters).length === 9 &&
      typeof parameters['targetId'] === 'string' &&
      parameters['targetId'].length > 0 &&
      typeof parameters['modifierId'] === 'string' &&
      parameters['modifierId'].length > 0 &&
      parameters['modifierType'] === 'SOLIDIFY' &&
      isFiniteNumber(parameters['thickness']) &&
      parameters['thickness'] >= 0.0001 &&
      parameters['thickness'] <= 100 &&
      isFiniteNumber(parameters['offset']) &&
      parameters['offset'] >= -1 &&
      parameters['offset'] <= 1 &&
      parameters['solidifyMode'] === 'EXTRUDE' &&
      parameters['useEvenOffset'] === true &&
      parameters['useRim'] === true &&
      parameters['useRimOnly'] === false,
  },
  'blender.modifier.add_bevel': {
    observationShape: 'bevel_modifier',
    observationKind: 'modifier_ready',
    expectedParameters: (actionArguments: Record<string, unknown>) => ({
      targetId: actionArguments['targetId'],
      modifierId: actionArguments['modifierId'],
      modifierType: 'BEVEL',
      width: actionArguments['width'],
      segments: actionArguments['segments'],
      angleLimit: actionArguments['angleLimit'],
    }),
    parametersValid: (parameters: Record<string, unknown>) =>
      Object.keys(parameters).length === 6 &&
      typeof parameters['targetId'] === 'string' &&
      parameters['targetId'].length > 0 &&
      typeof parameters['modifierId'] === 'string' &&
      parameters['modifierId'].length > 0 &&
      parameters['modifierType'] === 'BEVEL' &&
      isFiniteNumber(parameters['width']) &&
      parameters['width'] >= 0.0001 &&
      parameters['width'] <= 100 &&
      Number.isInteger(parameters['segments']) &&
      Number(parameters['segments']) >= 1 &&
      Number(parameters['segments']) <= 16 &&
      isFiniteNumber(parameters['angleLimit']) &&
      parameters['angleLimit'] >= 0 &&
      parameters['angleLimit'] <= Math.PI,
  },
  'blender.material.create_and_assign': {
    observationShape: 'single_material',
    observationKind: 'material_assigned',
    expectedParameters: (actionArguments: Record<string, unknown>) => ({
      materialId: actionArguments['materialId'],
      targets: structuredClone(actionArguments['targets']),
    }),
    parametersValid: isSingleMaterialObservationParameters,
  },
  'blender.material.create_palette_and_assign': {
    observationShape: 'material_palette',
    observationKind: 'material_assigned',
    expectedParameters: (actionArguments: Record<string, unknown>) => ({
      materials: structuredClone(actionArguments['materials']),
    }),
    parametersValid: (parameters: Record<string, unknown>) =>
      isMaterialPaletteActionArguments(parameters),
  },
  'blender.modifier.add_subdivision_surface': {
    observationShape: 'subdivision_surface_modifier',
    observationKind: 'modifier_ready',
    expectedParameters: (actionArguments: Record<string, unknown>) => ({
      targetId: actionArguments['targetId'],
      modifierId: actionArguments['modifierId'],
      modifierType: 'SUBSURF',
      levels: actionArguments['viewportLevel'],
      renderLevels: 2,
      subdivisionType: 'CATMULL_CLARK',
      quality: 3,
      showOnlyControlEdges: true,
      useCreases: true,
      useLimitSurface: true,
      boundarySmooth: 'ALL',
      uvSmooth: 'PRESERVE_BOUNDARIES',
      useCustomNormals: false,
      showViewport: true,
      showRender: true,
      showInEditMode: true,
      showOnCage: false,
    }),
    parametersValid: (parameters: Record<string, unknown>) =>
      Object.keys(parameters).length === 17 &&
      typeof parameters['targetId'] === 'string' &&
      parameters['targetId'].length > 0 &&
      typeof parameters['modifierId'] === 'string' &&
      parameters['modifierId'].length > 0 &&
      parameters['modifierType'] === 'SUBSURF' &&
      Number.isSafeInteger(parameters['levels']) &&
      (parameters['levels'] as number) >= 1 &&
      (parameters['levels'] as number) <= 3 &&
      parameters['renderLevels'] === 2 &&
      parameters['subdivisionType'] === 'CATMULL_CLARK' &&
      parameters['quality'] === 3 &&
      parameters['showOnlyControlEdges'] === true &&
      parameters['useCreases'] === true &&
      parameters['useLimitSurface'] === true &&
      parameters['boundarySmooth'] === 'ALL' &&
      parameters['uvSmooth'] === 'PRESERVE_BOUNDARIES' &&
      parameters['useCustomNormals'] === false &&
      parameters['showViewport'] === true &&
      parameters['showRender'] === true &&
      parameters['showInEditMode'] === true &&
      parameters['showOnCage'] === false,
  },
  'blender.rig.create_armature': {
    observationShape: 'managed_armature',
    observationKind: 'armature_ready',
    expectedParameters: (actionArguments: Record<string, unknown>) => ({
      armatureId: actionArguments['armatureId'],
      objectName: actionArguments['objectName'],
      dataName: actionArguments['dataName'],
      collectionId: actionArguments['collectionId'],
      bones: structuredClone(actionArguments['bones']),
      bindings: structuredClone(actionArguments['bindings']),
    }),
    parametersValid: isArmatureReplayParameters,
  },
  'blender.rig.bind_skin_weights': {
    observationShape: 'managed_skin_weights',
    observationKind: 'skin_weights_ready',
    expectedParameters: (actionArguments: Record<string, unknown>) => ({
      targetId: actionArguments['targetId'],
      armatureId: actionArguments['armatureId'],
      modifierId: actionArguments['modifierId'],
      modifierName: actionArguments['modifierName'],
      preserveVolume: actionArguments['preserveVolume'],
      weights: structuredClone(actionArguments['weights']),
    }),
    parametersValid: isSkinWeightsReplayParameters,
  },
  'blender.animation.create_pose_keyframes': {
    observationShape: 'managed_pose_animation',
    observationKind: 'pose_animation_ready',
    expectedParameters: (actionArguments: Record<string, unknown>) => ({
      actionId: actionArguments['actionId'],
      actionName: actionArguments['actionName'],
      armatureId: actionArguments['armatureId'],
      interpolation: actionArguments['interpolation'] ?? 'BEZIER',
      extrapolation: actionArguments['extrapolation'] ?? 'CONSTANT',
      keyframes: structuredClone(actionArguments['keyframes']),
    }),
    parametersValid: isPoseAnimationReplayParameters,
  },
  'blender.geometry_nodes.create_light_trails': {
    observationShape: 'managed_light_trails',
    observationKind: 'light_trails_ready',
    expectedParameters: (actionArguments: Record<string, unknown>) => ({
      targetId: actionArguments['targetId'],
      modifierId: actionArguments['modifierId'],
      modifierName: actionArguments['modifierName'],
      nodeGroupId: actionArguments['nodeGroupId'],
      nodeGroupName: actionArguments['nodeGroupName'],
      trailCount: actionArguments['trailCount'],
      pointsPerTrail: actionArguments['pointsPerTrail'],
      tileLength: actionArguments['tileLength'],
      trailSpacing: actionArguments['trailSpacing'],
      noiseScale: actionArguments['noiseScale'],
      noiseDetail: actionArguments['noiseDetail'],
      noiseRoughness: actionArguments['noiseRoughness'],
      noiseSeed: actionArguments['noiseSeed'],
      height: actionArguments['height'],
      profileSides: actionArguments['profileSides'],
      profileRadius: actionArguments['profileRadius'],
      tileRepeatCount: actionArguments['tileRepeatCount'],
      nodeTypes: [...replayCanonicalLightTrailsNodeTypes],
    }),
    parametersValid: isLightTrailsReplayParameters,
  },
  'blender.geometry_nodes.create_transform': {
    observationShape: 'managed_transform_geometry',
    observationKind: 'geometry_nodes_ready',
    expectedParameters: (actionArguments: Record<string, unknown>) => ({
      targetId: actionArguments['targetId'],
      modifierId: actionArguments['modifierId'],
      nodeGroupId: actionArguments['nodeGroupId'],
      nodeTypes: [...replayCanonicalTransformGeometryNodeTypes],
    }),
    parametersValid: isTransformGeometryReplayParameters,
  },
  'blender.lookdev.create_light_trails_scene': {
    observationShape: 'managed_light_trails_scene',
    observationKind: 'light_trails_scene_ready',
    expectedParameters: (actionArguments: Record<string, unknown>) => ({
      ...Object.fromEntries(
        [
          ...replayLightTrailsSceneIdentityKeys,
          ...replayLightTrailsSceneScalarKeys,
          ...replayLightTrailsSceneVectorKeys,
          ...replayLightTrailsSceneColorKeys,
        ].map((key) => [key, structuredClone(actionArguments[key])]),
      ),
      trailMaterialNodeTypes: [...replayCanonicalTrailMaterialNodeTypes],
      floorMaterialNodeTypes: [...replayCanonicalFloorMaterialNodeTypes],
      compositorNodeTypes: [...replayCanonicalCompositorNodeTypes],
    }),
    parametersValid: isLightTrailsSceneReplayParameters,
  },
} as const satisfies Record<
  ProcedureLeafReplayActionName,
  | {
      readonly observationShape: 'mesh_primitive';
      readonly observationKind: string;
      readonly geometryMatchDetailKeys: readonly string[];
      readonly expectedParameters: (
        actionArguments: Record<string, unknown>,
      ) => Record<string, unknown>;
      readonly parametersValid: (parameters: Record<string, unknown>) => boolean;
      readonly expectedTopology: (actionArguments: Record<string, unknown>) => {
        readonly vertexCount: number;
        readonly edgeCount: number;
        readonly faceCount: number;
      } | null;
    }
  | {
      readonly observationShape: 'mirror_modifier';
      readonly observationKind: 'modifier_ready';
      readonly expectedParameters: (
        actionArguments: Record<string, unknown>,
      ) => Record<string, unknown>;
      readonly parametersValid: (parameters: Record<string, unknown>) => boolean;
    }
  | {
      readonly observationShape: 'solidify_modifier';
      readonly observationKind: 'modifier_ready';
      readonly expectedParameters: (
        actionArguments: Record<string, unknown>,
      ) => Record<string, unknown>;
      readonly parametersValid: (parameters: Record<string, unknown>) => boolean;
    }
  | {
      readonly observationShape: 'bevel_modifier';
      readonly observationKind: 'modifier_ready';
      readonly expectedParameters: (
        actionArguments: Record<string, unknown>,
      ) => Record<string, unknown>;
      readonly parametersValid: (parameters: Record<string, unknown>) => boolean;
    }
  | {
      readonly observationShape: 'single_material';
      readonly observationKind: 'material_assigned';
      readonly expectedParameters: (
        actionArguments: Record<string, unknown>,
      ) => Record<string, unknown>;
      readonly parametersValid: (parameters: Record<string, unknown>) => boolean;
    }
  | {
      readonly observationShape: 'material_palette';
      readonly observationKind: 'material_assigned';
      readonly expectedParameters: (
        actionArguments: Record<string, unknown>,
      ) => Record<string, unknown>;
      readonly parametersValid: (parameters: Record<string, unknown>) => boolean;
    }
  | {
      readonly observationShape: 'subdivision_surface_modifier';
      readonly observationKind: 'modifier_ready';
      readonly expectedParameters: (
        actionArguments: Record<string, unknown>,
      ) => Record<string, unknown>;
      readonly parametersValid: (parameters: Record<string, unknown>) => boolean;
    }
  | {
      readonly observationShape:
        | 'managed_edit'
        | 'managed_armature'
        | 'managed_skin_weights'
        | 'managed_pose_animation'
        | 'managed_transform_geometry'
        | 'managed_light_trails'
        | 'managed_light_trails_scene';
      readonly observationKind:
        | 'mesh_topology_matches'
        | 'mesh_triangulated'
        | 'mesh_region_extruded'
        | 'mesh_edges_beveled'
        | 'mesh_faces_inset'
        | 'mesh_faces_poked'
        | 'armature_ready'
        | 'skin_weights_ready'
        | 'pose_animation_ready'
        | 'geometry_nodes_ready'
        | 'light_trails_ready'
        | 'light_trails_scene_ready';
      readonly expectedParameters: (
        actionArguments: Record<string, unknown>,
      ) => Record<string, unknown>;
      readonly parametersValid: (parameters: Record<string, unknown>) => boolean;
    }
>;

export class ProcedureLeafReplayError extends Error {
  constructor(
    message: string,
    readonly statusCode: 404 | 409 | 422 = 422,
  ) {
    super(message);
    this.name = 'ProcedureLeafReplayError';
  }
}

function sameCanonicalValue(left: unknown, right: unknown): boolean {
  const leftBytes = canonicalizeProtocolJsonValue(left);
  const rightBytes = canonicalizeProtocolJsonValue(right);
  return (
    leftBytes.byteLength === rightBytes.byteLength &&
    leftBytes.every((value, index) => value === rightBytes[index])
  );
}

export const sameProcedureLeafReplayValue = sameCanonicalValue;

export function procedureLeafReplayExecutableSteps(binding: ProcedureLeafReplayBinding) {
  const stepById = new Map(binding.proposal.plan.steps.map((step) => [step.id, step] as const));
  const executableSteps = stableProcedureLeafOrder(binding.materialization.tree)
    .filter((leaf) => leaf.action !== null)
    .map((leaf) => stepById.get(leaf.id));
  if (
    executableSteps.some((step) => step?.action === null || step?.action === undefined) ||
    executableSteps.length !==
      binding.proposal.plan.steps.filter((step) => step.action !== null).length
  ) {
    throw new ProcedureLeafReplayError(
      'Replay proposal executable steps do not match the canonical materialized leaf order',
      409,
    );
  }
  return executableSteps as Array<NonNullable<(typeof executableSteps)[number]>>;
}

function procedureLeafReplayExecutablePrefix(binding: ProcedureLeafReplayBinding): string[] {
  const executableSteps = procedureLeafReplayExecutableSteps(binding);
  const targetStepIndex = executableSteps.findIndex((step) => step.id === binding.leafId);
  if (targetStepIndex < 0) {
    throw new ProcedureLeafReplayError(
      'Replay proposal does not contain its managed target leaf',
      409,
    );
  }
  return executableSteps.slice(0, targetStepIndex).map((step) => step.id);
}

function sameStepIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((stepId, index) => stepId === right[index]);
}

export interface PreparedProcedureLeafReplay {
  readonly actionName: ProcedureLeafReplayActionName;
  readonly recipeId: string;
  readonly planning: PlanningIntent;
}

export function prepareProcedureLeafReplay(
  request: ProcedureLeafReplayProposalRequest,
  materialization: ProcedureAuthoringMaterializationResult,
  actionCatalog: ActionCatalog,
): PreparedProcedureLeafReplay {
  if (
    materialization.catalogBinding.adapterId !== actionCatalog.adapterId ||
    materialization.catalogBinding.actionCatalogVersion !== actionCatalog.catalogVersion
  ) {
    throw new ProcedureLeafReplayError(
      'Replay materialization does not match the installed ActionCatalog',
    );
  }

  const leaf = materialization.tree.nodes.find((node) => node.id === request.leafId);
  if (leaf?.kind !== 'leaf' || leaf.action === null) {
    throw new ProcedureLeafReplayError('Replay leafId does not identify an executable leaf');
  }
  const parsedActionName = procedureLeafReplayActionNameSchema.safeParse(leaf.action.name);
  if (!parsedActionName.success || leaf.action.adapterId !== 'blender') {
    throw new ProcedureLeafReplayError(`Managed leaf replay does not support ${leaf.action.name}`);
  }
  const actionName = parsedActionName.data;
  const actionContract = replayActionContracts[actionName];

  const planStep = materialization.compilation.plan.steps.find((step) => step.id === leaf.id);
  if (
    planStep === undefined ||
    planStep.action?.name !== actionName ||
    !sameCanonicalValue(planStep.action.arguments, leaf.action.arguments)
  ) {
    throw new ProcedureLeafReplayError(
      'Replay compilation must preserve the selected materialized leaf action exactly',
    );
  }

  if (
    leaf.observationPolicy?.mode !== 'success_gate' ||
    !['rollback_step', 'retain_for_repair'].includes(leaf.observationPolicy.failureStrategy) ||
    leaf.rollback.mode !== 'compensating_action'
  ) {
    throw new ProcedureLeafReplayError(
      'Managed leaf replay requires a rollback_step or retain_for_repair success gate and compensating action',
    );
  }
  if (actionContract.observationShape === 'material_palette') {
    if (
      !materialPaletteExpectedObservationsValid(leaf.expectedObservations, leaf.action.arguments)
    ) {
      throw new ProcedureLeafReplayError(
        'Managed material palette replay requires one ordered material_assigned success gate per palette entry',
      );
    }
  } else {
    const expectedObservationParameters = actionContract.expectedParameters(leaf.action.arguments);
    if (
      leaf.expectedObservations.length !== 1 ||
      leaf.expectedObservations[0]?.kind !== actionContract.observationKind ||
      !sameCanonicalValue(leaf.expectedObservations[0].parameters, expectedObservationParameters)
    ) {
      throw new ProcedureLeafReplayError(
        `Managed ${actionName} replay requires one exact ${actionContract.observationKind} success gate`,
      );
    }
  }

  const leafCoverage = materialization.coverage.find((entry) => entry.leafId === leaf.id);
  const expectedMenuTrackAvailability =
    leafCoverage?.menu === 'materialized'
      ? 'available'
      : leafCoverage?.menu === 'unavailable'
        ? 'unavailable'
        : null;
  const shortcutCoverageValid =
    leafCoverage?.shortcut === 'materialized' || leafCoverage?.shortcut === 'unavailable';
  const expectedMcpTrackAvailability =
    leafCoverage?.mcp === 'materialized'
      ? 'available'
      : leafCoverage?.mcp === 'unavailable'
        ? 'unavailable'
        : null;
  if (
    leafCoverage === undefined ||
    expectedMenuTrackAvailability === null ||
    !shortcutCoverageValid ||
    expectedMcpTrackAvailability === null ||
    leafCoverage.recipeId === null
  ) {
    throw new ProcedureLeafReplayError(
      'Replay leaf requires catalog-grounded menu/shortcut/MCP coverage for its managed action',
    );
  }
  if (
    leaf.menuTracks.length !== 1 ||
    leaf.menuTracks[0]?.availability !== expectedMenuTrackAvailability ||
    leaf.shortcutTracks.length !== 1 ||
    leaf.shortcutTracks[0]?.availability !==
      (leafCoverage.shortcut === 'materialized' ? 'available' : 'unavailable') ||
    leaf.mcpTracks.length !== 1 ||
    leaf.mcpTracks[0]?.availability !== expectedMcpTrackAvailability
  ) {
    throw new ProcedureLeafReplayError(
      'Replay materialization tracks do not match the bounded catalog-grounding contract',
    );
  }

  const actionEntry = actionCatalog.actions.find((entry) => entry.name === actionName);
  if (!actionEntry?.supportedObservationKinds.includes(actionContract.observationKind)) {
    throw new ProcedureLeafReplayError(
      `ActionCatalog ${actionCatalog.catalogVersion} does not support ${actionContract.observationKind}`,
    );
  }
  const operationLevelAction = operationLevelMcpActionNameSchema.safeParse(actionName);
  if (operationLevelAction.success) {
    if (leafCoverage.recipeId !== operationLevelMcpRecipeIdByAction[operationLevelAction.data]) {
      throw new ProcedureLeafReplayError(
        'Guided Geometry replay requires its exact operation-level semantic recipe',
      );
    }
    const argumentErrors = validateActionArguments(
      leaf.action.arguments,
      actionEntry.argumentsSchema,
    );
    if (argumentErrors.length > 0) {
      throw new ProcedureLeafReplayError(
        `Guided Geometry replay action arguments violate the installed ActionCatalog: ${argumentErrors.join('; ')}`,
      );
    }
  }
  const phases = (actionCatalog.planningPhases ?? []).filter((phase) =>
    phase.actionNames.includes(actionName),
  );
  const capabilities = (actionCatalog.semanticCapabilities ?? []).filter((capability) =>
    capability.actionNames.includes(actionName),
  );
  if (phases.length !== 1 || capabilities.length !== 1) {
    throw new ProcedureLeafReplayError(
      'Replay action must have one unambiguous planning phase and semantic capability',
    );
  }

  return {
    actionName,
    recipeId: leafCoverage.recipeId,
    planning: {
      goal: request.packet.context.goalProvenance.source.text,
      requiredPhaseIds: [phases[0]!.id],
      capabilityCoverage: {
        policyVersion: 'catalog_capability_coverage_v1',
        requirements: [
          {
            requirementId: `${leaf.id}.replay_requirement`,
            statement: request.packet.context.goalProvenance.source.text,
            coverage: [{ capabilityId: capabilities[0]!.id, stepIds: [leaf.id] }],
          },
        ],
      },
    },
  };
}

export function buildProcedureLeafReplayBinding(input: {
  readonly request: ProcedureLeafReplayProposalRequest;
  readonly materialization: ProcedureAuthoringMaterializationResult;
  readonly proposal: GuideProposal;
  readonly planContentSha256: string;
  readonly recipeId: string;
  readonly actionName: ProcedureLeafReplayActionName;
  readonly createdAt: string;
}): ProcedureLeafReplayBinding {
  const leafCoverage = input.materialization.coverage.find(
    (entry) => entry.leafId === input.request.leafId,
  );
  const content: Omit<ProcedureLeafReplayBinding, 'integrity'> = {
    formatVersion: procedureLeafReplayFormatVersion,
    replayId: input.request.replayId,
    targetInstanceId: input.request.targetInstanceId,
    leafId: input.request.leafId,
    replayMode: input.request.replayMode,
    request: input.request,
    materialization: input.materialization,
    proposal: input.proposal,
    planContentSha256: input.planContentSha256,
    recipeId: input.recipeId,
    actionName: input.actionName,
    claims: {
      materialization: 'catalog_grounded',
      approval: 'pending',
      hostExecutionStarted: false,
      managedActionResult: 'pending',
      menuTrack:
        leafCoverage?.menu === 'materialized' ? 'catalog_grounded_not_executed' : 'unavailable',
      shortcutTrack:
        leafCoverage?.shortcut === 'materialized' ? 'candidate_not_executed' : 'unavailable',
      mcpTrack:
        leafCoverage?.mcp === 'materialized' ? 'catalog_grounded_not_executed' : 'unavailable',
    },
    createdAt: input.createdAt,
  };
  return procedureLeafReplayBindingSchema.parse({
    ...content,
    integrity: {
      algorithm: 'sha256',
      canonicalization: protocolJsonValueCanonicalization,
      contentSha256: computeProcedureLeafReplayBindingContentSha256(content),
    },
  });
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function sameStringArray(value: unknown, expected: readonly string[]): boolean {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((item, index) => item === expected[index])
  );
}

function exactDetailKeys(details: Record<string, unknown>, keys: readonly string[]): boolean {
  return hasExactKeys(details, keys);
}

function validMeshCounts(details: Record<string, unknown>): boolean {
  return (
    Number.isSafeInteger(details['sourceVertexCount']) &&
    (details['sourceVertexCount'] as number) > 0 &&
    (details['sourceVertexCount'] as number) <= 8192 &&
    Number.isSafeInteger(details['sourceEdgeCount']) &&
    (details['sourceEdgeCount'] as number) > 0 &&
    (details['sourceEdgeCount'] as number) <= 16384 &&
    Number.isSafeInteger(details['sourceFaceCount']) &&
    (details['sourceFaceCount'] as number) > 0 &&
    (details['sourceFaceCount'] as number) <= 8192 &&
    Number.isSafeInteger(details['vertexCount']) &&
    (details['vertexCount'] as number) > 0 &&
    (details['vertexCount'] as number) <= 8192 &&
    Number.isSafeInteger(details['edgeCount']) &&
    (details['edgeCount'] as number) > 0 &&
    (details['edgeCount'] as number) <= 16384 &&
    Number.isSafeInteger(details['faceCount']) &&
    (details['faceCount'] as number) > 0 &&
    (details['faceCount'] as number) <= 8192
  );
}

function validateManagedEditReplayDetails(
  observationKind:
    | 'mesh_topology_matches'
    | 'mesh_triangulated'
    | 'mesh_region_extruded'
    | 'mesh_edges_beveled'
    | 'mesh_faces_inset'
    | 'mesh_faces_poked',
  details: Record<string, unknown>,
  expectedParameters: Record<string, unknown>,
): boolean {
  const commonKeys = [
    'parameters',
    'supported',
    'targetId',
    'resultMeshId',
    'parametersValid',
    'replayParametersValid',
    'assigned',
    'receiptMatches',
    'contentIntact',
    'sourceContentIntact',
    'withinLimits',
    'resultNameMatches',
    'sourceVertexCount',
    'sourceEdgeCount',
    'sourceFaceCount',
    'vertexCount',
    'edgeCount',
    'faceCount',
    'sourceMeshContentSha256',
    'resultMeshContentSha256',
    'receiptContentSha256',
    'actionArgumentsSha256',
    'topologyMatches',
    'attestationContentSha256',
  ] as const;
  const extraKeysByKind = {
    mesh_topology_matches: ['topologyGrew'],
    mesh_triangulated: [
      'nonempty',
      'allTriangles',
      'sourceLoopCount',
      'expectedVertexCount',
      'expectedEdgeCount',
      'expectedFaceCount',
    ],
    mesh_region_extruded: [
      'topologyGrew',
      'selectedFaceCount',
      'selectedEdgeCount',
      'selectedVertexCount',
      'boundaryEdgeCount',
      'expectedVertexCount',
      'expectedEdgeCount',
      'expectedFaceCount',
    ],
    mesh_edges_beveled: ['topologyGrew'],
    mesh_faces_inset: [
      'resultNondegenerate',
      'sourceLoopCount',
      'expectedVertexCount',
      'expectedEdgeCount',
      'expectedFaceCount',
    ],
    mesh_faces_poked: [
      'resultContentIntact',
      'allTriangles',
      'resultNondegenerate',
      'sourceLoopCount',
      'expectedVertexCount',
      'expectedEdgeCount',
      'expectedFaceCount',
    ],
  } as const;
  const requiredTrueKeys = [
    'supported',
    'parametersValid',
    'replayParametersValid',
    'assigned',
    'receiptMatches',
    'contentIntact',
    'sourceContentIntact',
    'withinLimits',
    'resultNameMatches',
    'topologyMatches',
  ] as const;
  const extraKeys = extraKeysByKind[observationKind];
  if (
    !exactDetailKeys(details, [...commonKeys, ...extraKeys]) ||
    details['targetId'] !== expectedParameters['targetId'] ||
    details['resultMeshId'] !== expectedParameters['resultMeshId'] ||
    requiredTrueKeys.some((key) => details[key] !== true) ||
    !validMeshCounts(details) ||
    !isSha256(details['sourceMeshContentSha256']) ||
    !isSha256(details['resultMeshContentSha256']) ||
    !isSha256(details['receiptContentSha256']) ||
    !isSha256(details['actionArgumentsSha256']) ||
    !isSha256(details['attestationContentSha256'])
  ) {
    return false;
  }
  if (['mesh_topology_matches', 'mesh_edges_beveled'].includes(observationKind)) {
    return (
      details['topologyGrew'] === true &&
      (details['vertexCount'] as number) > (details['sourceVertexCount'] as number) &&
      (details['edgeCount'] as number) > (details['sourceEdgeCount'] as number) &&
      (details['faceCount'] as number) > (details['sourceFaceCount'] as number)
    );
  }
  if (observationKind === 'mesh_region_extruded') {
    const selectedFaceCount = details['selectedFaceCount'];
    const selectedEdgeCount = details['selectedEdgeCount'];
    const selectedVertexCount = details['selectedVertexCount'];
    const boundaryEdgeCount = details['boundaryEdgeCount'];
    const polygonIndices = expectedParameters['polygonIndices'];
    const sourceVertexCount = details['sourceVertexCount'] as number;
    const sourceEdgeCount = details['sourceEdgeCount'] as number;
    const sourceFaceCount = details['sourceFaceCount'] as number;
    return (
      details['topologyGrew'] === true &&
      Array.isArray(polygonIndices) &&
      Number.isSafeInteger(selectedFaceCount) &&
      selectedFaceCount === polygonIndices.length &&
      Number.isSafeInteger(selectedEdgeCount) &&
      (selectedEdgeCount as number) > 0 &&
      Number.isSafeInteger(selectedVertexCount) &&
      (selectedVertexCount as number) > 0 &&
      Number.isSafeInteger(boundaryEdgeCount) &&
      (boundaryEdgeCount as number) > 0 &&
      details['expectedVertexCount'] === sourceVertexCount + (selectedVertexCount as number) &&
      details['expectedEdgeCount'] ===
        sourceEdgeCount + (selectedEdgeCount as number) + (boundaryEdgeCount as number) &&
      details['expectedFaceCount'] === sourceFaceCount + (boundaryEdgeCount as number) &&
      details['vertexCount'] === details['expectedVertexCount'] &&
      details['edgeCount'] === details['expectedEdgeCount'] &&
      details['faceCount'] === details['expectedFaceCount']
    );
  }
  if (observationKind === 'mesh_triangulated') {
    const sourceLoopCount = details['sourceLoopCount'];
    const sourceVertexCount = details['sourceVertexCount'] as number;
    const sourceEdgeCount = details['sourceEdgeCount'] as number;
    const sourceFaceCount = details['sourceFaceCount'] as number;
    return (
      details['nonempty'] === true &&
      details['allTriangles'] === true &&
      Number.isSafeInteger(sourceLoopCount) &&
      (sourceLoopCount as number) > 0 &&
      details['expectedVertexCount'] === details['vertexCount'] &&
      details['expectedEdgeCount'] === details['edgeCount'] &&
      details['expectedFaceCount'] === details['faceCount'] &&
      details['expectedVertexCount'] === sourceVertexCount &&
      details['expectedEdgeCount'] ===
        sourceEdgeCount + (sourceLoopCount as number) - 3 * sourceFaceCount &&
      details['expectedFaceCount'] === (sourceLoopCount as number) - 2 * sourceFaceCount
    );
  }
  const expectedCountsMatch =
    Number.isSafeInteger(details['sourceLoopCount']) &&
    (details['sourceLoopCount'] as number) > 0 &&
    details['expectedVertexCount'] === details['vertexCount'] &&
    details['expectedEdgeCount'] === details['edgeCount'] &&
    details['expectedFaceCount'] === details['faceCount'] &&
    details['resultNondegenerate'] === true;
  const sourceLoopCount = details['sourceLoopCount'] as number;
  const sourceVertexCount = details['sourceVertexCount'] as number;
  const sourceEdgeCount = details['sourceEdgeCount'] as number;
  const sourceFaceCount = details['sourceFaceCount'] as number;
  if (observationKind === 'mesh_faces_inset') {
    return (
      expectedCountsMatch &&
      details['expectedVertexCount'] === sourceVertexCount + sourceLoopCount &&
      details['expectedEdgeCount'] === sourceEdgeCount + 2 * sourceLoopCount &&
      details['expectedFaceCount'] === sourceFaceCount + sourceLoopCount
    );
  }
  return (
    expectedCountsMatch &&
    details['expectedVertexCount'] === sourceVertexCount + sourceFaceCount &&
    details['expectedEdgeCount'] === sourceEdgeCount + sourceLoopCount &&
    details['expectedFaceCount'] === sourceLoopCount &&
    details['resultContentIntact'] === true &&
    details['allTriangles'] === true
  );
}

function validateManagedArmatureReplayDetails(
  details: Record<string, unknown>,
  expectedParameters: Record<string, unknown>,
): boolean {
  const bones = expectedParameters['bones'];
  const bindings = expectedParameters['bindings'];
  if (!Array.isArray(bones) || !Array.isArray(bindings)) return false;
  const expectedBoneNames = bones.map((bone) =>
    typeof bone === 'object' && bone !== null && !Array.isArray(bone)
      ? String((bone as Record<string, unknown>)['boneName'])
      : '',
  );
  const expectedTargetIds = bindings.map((binding) =>
    typeof binding === 'object' && binding !== null && !Array.isArray(binding)
      ? String((binding as Record<string, unknown>)['targetId'])
      : '',
  );
  const trueKeys = [
    'supported',
    'parametersValid',
    'receiptMatches',
    'ownershipMatches',
    'bonesMatch',
    'bindingsMatch',
  ] as const;
  return (
    exactDetailKeys(details, [
      'parameters',
      'supported',
      'armatureId',
      'boneNames',
      'availableBoneNames',
      'boundTargetIds',
      'parametersValid',
      'receiptMatches',
      'ownershipMatches',
      'bonesMatch',
      'bindingsMatch',
      'actionArgumentsSha256',
      'armatureContentSha256',
      'receiptContentSha256',
      'attestationContentSha256',
    ]) &&
    details['armatureId'] === expectedParameters['armatureId'] &&
    sameStringArray(details['boneNames'], expectedBoneNames) &&
    sameStringArray(details['availableBoneNames'], expectedBoneNames) &&
    sameStringArray(details['boundTargetIds'], expectedTargetIds) &&
    trueKeys.every((key) => details[key] === true) &&
    isSha256(details['actionArgumentsSha256']) &&
    isSha256(details['armatureContentSha256']) &&
    isSha256(details['receiptContentSha256']) &&
    isSha256(details['attestationContentSha256'])
  );
}

function replaySkinBoneNames(parameters: Record<string, unknown>): string[] {
  const weights = parameters['weights'];
  if (!Array.isArray(weights)) return [];
  return uniqueStringsInEncounterOrder(
    weights.flatMap((weight) => {
      if (typeof weight !== 'object' || weight === null || Array.isArray(weight)) return [];
      const influences = (weight as Record<string, unknown>)['influences'];
      return Array.isArray(influences)
        ? influences.map((influence) =>
            typeof influence === 'object' && influence !== null && !Array.isArray(influence)
              ? (influence as Record<string, unknown>)['boneName']
              : null,
          )
        : [];
    }),
  );
}

function validateManagedSkinWeightsReplayDetails(
  details: Record<string, unknown>,
  expectedParameters: Record<string, unknown>,
): boolean {
  const expectedBoneNames = replaySkinBoneNames(expectedParameters);
  const weights = expectedParameters['weights'];
  const trueKeys = [
    'supported',
    'parametersValid',
    'receiptMatches',
    'ownershipMatches',
    'assignmentMatches',
    'modifierMatches',
    'meshContentIntact',
    'preserveVolumeMatches',
  ] as const;
  return (
    Array.isArray(weights) &&
    exactDetailKeys(details, [
      'parameters',
      'supported',
      'targetId',
      'armatureId',
      'modifierId',
      'boneNames',
      'deformBoneNames',
      'vertexCount',
      'parametersValid',
      'receiptMatches',
      'ownershipMatches',
      'assignmentMatches',
      'modifierMatches',
      'meshContentIntact',
      'preserveVolumeMatches',
      'actionArgumentsSha256',
      'weightsContentSha256',
      'modifierContentSha256',
      'receiptContentSha256',
      'attestationContentSha256',
    ]) &&
    details['targetId'] === expectedParameters['targetId'] &&
    details['armatureId'] === expectedParameters['armatureId'] &&
    details['modifierId'] === expectedParameters['modifierId'] &&
    sameStringArray(details['boneNames'], expectedBoneNames) &&
    sameStringArray(details['deformBoneNames'], expectedBoneNames) &&
    details['vertexCount'] === weights.length &&
    trueKeys.every((key) => details[key] === true) &&
    isSha256(details['actionArgumentsSha256']) &&
    isSha256(details['weightsContentSha256']) &&
    isSha256(details['modifierContentSha256']) &&
    isSha256(details['receiptContentSha256']) &&
    isSha256(details['attestationContentSha256'])
  );
}

function validateManagedPoseAnimationReplayDetails(
  details: Record<string, unknown>,
  expectedParameters: Record<string, unknown>,
): boolean {
  const keyframes = expectedParameters['keyframes'];
  if (!Array.isArray(keyframes) || keyframes.length < 2) return false;
  const frame = (entry: unknown) =>
    typeof entry === 'object' && entry !== null && !Array.isArray(entry)
      ? (entry as Record<string, unknown>)['frame']
      : null;
  const expectedRange = [frame(keyframes[0]), frame(keyframes.at(-1))];
  const trueKeys = [
    'supported',
    'parametersValid',
    'receiptMatches',
    'ownershipMatches',
    'assigned',
    'curvesMatch',
    'valuesMatch',
    'interpolationMatches',
    'extrapolationMatches',
    'actionContentIntact',
  ] as const;
  return (
    exactDetailKeys(details, [
      'parameters',
      'supported',
      'armatureId',
      'actionId',
      'parametersValid',
      'receiptMatches',
      'ownershipMatches',
      'assigned',
      'frameRange',
      'expectedFrameRange',
      'curveCount',
      'expectedCurveCount',
      'curvesMatch',
      'valuesMatch',
      'interpolationMatches',
      'extrapolationMatches',
      'actionContentIntact',
      'actionArgumentsSha256',
      'actionContentSha256',
      'receiptContentSha256',
      'attestationContentSha256',
    ]) &&
    details['armatureId'] === expectedParameters['armatureId'] &&
    details['actionId'] === expectedParameters['actionId'] &&
    sameCanonicalValue(details['frameRange'], expectedRange) &&
    sameCanonicalValue(details['expectedFrameRange'], expectedRange) &&
    Number.isSafeInteger(details['curveCount']) &&
    (details['curveCount'] as number) > 0 &&
    details['curveCount'] === details['expectedCurveCount'] &&
    trueKeys.every((key) => details[key] === true) &&
    isSha256(details['actionArgumentsSha256']) &&
    isSha256(details['actionContentSha256']) &&
    isSha256(details['receiptContentSha256']) &&
    isSha256(details['attestationContentSha256'])
  );
}

function validateManagedLightTrailsReplayDetails(
  details: Record<string, unknown>,
  expectedParameters: Record<string, unknown>,
): boolean {
  const resolvedParameters = details['resolvedParameters'];
  if (
    typeof resolvedParameters !== 'object' ||
    resolvedParameters === null ||
    Array.isArray(resolvedParameters)
  ) {
    return false;
  }
  const expectedEvaluatedVertexCount =
    (expectedParameters['trailCount'] as number) *
    (expectedParameters['pointsPerTrail'] as number) *
    (expectedParameters['profileSides'] as number) *
    (expectedParameters['tileRepeatCount'] as number) *
    2;
  const semanticParametersMatch = replayLightTrailsSemanticParameterKeys.every((key) => {
    const expected = expectedParameters[key];
    const actual = (resolvedParameters as Record<string, unknown>)[key];
    return (
      isFiniteNumber(expected) &&
      isFiniteNumber(actual) &&
      Math.abs(expected - actual) <=
        Math.max(1e-6, 1e-6 * Math.max(Math.abs(expected), Math.abs(actual)))
    );
  });
  return (
    exactDetailKeys(details, [
      'parameters',
      'supported',
      'targetId',
      'modifierId',
      'modifierName',
      'nodeGroupId',
      'nodeGroupName',
      'nodeTypes',
      'interfaceSignature',
      'interfaceMatches',
      'linkTopology',
      'linkTopologyMatches',
      'forbiddenNodeTypes',
      'bakeCount',
      'bakeDirectory',
      'semanticSignatureMatches',
      'fixedSemanticsMatch',
      'resolvedParameters',
      'semanticParametersMatch',
      'evaluatedVertexCount',
      'expectedEvaluatedVertexCount',
      'evaluatedVertexCountMatches',
      'evaluatedEdgeCount',
      'evaluatedPolygonCount',
      'evaluatedFinite',
    ]) &&
    details['targetId'] === expectedParameters['targetId'] &&
    details['modifierId'] === expectedParameters['modifierId'] &&
    details['modifierName'] === expectedParameters['modifierName'] &&
    details['nodeGroupId'] === expectedParameters['nodeGroupId'] &&
    details['nodeGroupName'] === expectedParameters['nodeGroupName'] &&
    Array.isArray(details['nodeTypes']) &&
    sameCanonicalValue(
      [...details['nodeTypes']].sort(),
      [...replayCanonicalLightTrailsNodeTypes].sort(),
    ) &&
    sameCanonicalValue(details['interfaceSignature'], replayCanonicalLightTrailsInterface) &&
    details['interfaceMatches'] === true &&
    sameCanonicalValue(details['linkTopology'], replayCanonicalLightTrailsLinks) &&
    details['linkTopologyMatches'] === true &&
    Array.isArray(details['forbiddenNodeTypes']) &&
    details['forbiddenNodeTypes'].length === 0 &&
    details['bakeCount'] === 0 &&
    details['bakeDirectory'] === '' &&
    details['semanticSignatureMatches'] === true &&
    details['fixedSemanticsMatch'] === true &&
    hasExactKeys(resolvedParameters as Record<string, unknown>, [
      ...replayLightTrailsSemanticParameterKeys,
    ]) &&
    semanticParametersMatch &&
    details['semanticParametersMatch'] === true &&
    details['expectedEvaluatedVertexCount'] === expectedEvaluatedVertexCount &&
    details['evaluatedVertexCount'] === expectedEvaluatedVertexCount &&
    details['evaluatedVertexCountMatches'] === true &&
    Number.isSafeInteger(details['evaluatedEdgeCount']) &&
    (details['evaluatedEdgeCount'] as number) > 0 &&
    (details['evaluatedEdgeCount'] as number) <= 12_000_000 &&
    Number.isSafeInteger(details['evaluatedPolygonCount']) &&
    (details['evaluatedPolygonCount'] as number) > 0 &&
    (details['evaluatedPolygonCount'] as number) <= 12_000_000 &&
    details['evaluatedFinite'] === true
  );
}

function validateManagedTransformGeometryReplayDetails(
  details: Record<string, unknown>,
  expectedParameters: Record<string, unknown>,
): boolean {
  return (
    exactDetailKeys(details, [
      'parameters',
      'supported',
      'targetId',
      'modifierId',
      'nodeGroupId',
      'nodeTypes',
    ]) &&
    details['targetId'] === expectedParameters['targetId'] &&
    details['modifierId'] === expectedParameters['modifierId'] &&
    details['nodeGroupId'] === expectedParameters['nodeGroupId'] &&
    sameStringArray(details['nodeTypes'], replayCanonicalTransformGeometryNodeTypes)
  );
}

function validateManagedLightTrailsSceneReplayDetails(
  details: Record<string, unknown>,
  expectedParameters: Record<string, unknown>,
): boolean {
  const proofKeys = [
    'sceneMatches',
    'collectionMatches',
    'worldMatches',
    'cameraMatches',
    'controllerMatches',
    'animationMatches',
    'trailMaterialMatches',
    'floorMaterialMatches',
    'compositorMatches',
    'noBakeNodes',
    'noRenderArtifacts',
  ] as const;
  return (
    exactDetailKeys(details, [
      'parameters',
      'supported',
      'shape',
      ...replayLightTrailsSceneIdentityKeys,
      ...proofKeys,
      'frameStart',
      'frameEnd',
      'cameraKeyframeCount',
      'trailMaterialNodeTypes',
      'floorMaterialNodeTypes',
      'compositorNodeTypes',
    ]) &&
    details['shape'] === 'managed_light_trails_scene' &&
    replayLightTrailsSceneIdentityKeys.every((key) => details[key] === expectedParameters[key]) &&
    proofKeys.every((key) => details[key] === true) &&
    details['frameStart'] === expectedParameters['frameStart'] &&
    details['frameEnd'] === expectedParameters['frameEnd'] &&
    details['cameraKeyframeCount'] === 6 &&
    sameCanonicalValue(details['trailMaterialNodeTypes'], replayCanonicalTrailMaterialNodeTypes) &&
    sameCanonicalValue(details['floorMaterialNodeTypes'], replayCanonicalFloorMaterialNodeTypes) &&
    sameCanonicalValue(details['compositorNodeTypes'], replayCanonicalCompositorNodeTypes)
  );
}

function strongMaterialObservationMatches(
  observation: CompanionStateReport['observations'][number],
  acceptedActionArguments: Record<string, unknown>,
  expectedParameters: Record<string, unknown>,
): boolean {
  const strongDetailKeys = new Set([
    'parameters',
    'supported',
    'materialId',
    'materialName',
    'targetIds',
    'assignedTargetIds',
    'useNodes',
    'principledNodeCount',
    'outputNodeCount',
    'baseColor',
    'roughness',
    'metallic',
    'receiptMatches',
    'ownershipMatches',
    'materialSurfaceMatches',
    'assignmentsMatch',
    'sourceContentIntact',
  ]);
  const proofKeys = [
    'useNodes',
    'receiptMatches',
    'ownershipMatches',
    'materialSurfaceMatches',
    'assignmentsMatch',
    'sourceContentIntact',
  ] as const;
  const observedBaseColor = observation.details['baseColor'];
  const acceptedBaseColor = acceptedActionArguments['baseColor'];
  const numberMatches = (observed: unknown, accepted: unknown) =>
    isFiniteNumber(observed) &&
    isFiniteNumber(accepted) &&
    Math.abs(observed - accepted) <= Math.max(1e-6, Math.abs(accepted) * 1e-6);
  return (
    isSingleMaterialActionArguments(acceptedActionArguments) &&
    Object.keys(observation.details).length === strongDetailKeys.size &&
    Object.keys(observation.details).every((key) => strongDetailKeys.has(key)) &&
    observation.details['materialId'] === acceptedActionArguments['materialId'] &&
    observation.details['materialId'] === expectedParameters['materialId'] &&
    observation.details['materialName'] === acceptedActionArguments['materialName'] &&
    sameCanonicalValue(observation.details['targetIds'], expectedParameters['targets']) &&
    sameCanonicalValue(observation.details['assignedTargetIds'], expectedParameters['targets']) &&
    proofKeys.every((key) => observation.details[key] === true) &&
    observation.details['principledNodeCount'] === 1 &&
    observation.details['outputNodeCount'] === 1 &&
    Array.isArray(observedBaseColor) &&
    Array.isArray(acceptedBaseColor) &&
    observedBaseColor.length === 4 &&
    acceptedBaseColor.length === 4 &&
    observedBaseColor.every((component, index) =>
      numberMatches(component, acceptedBaseColor[index]),
    ) &&
    numberMatches(observation.details['roughness'], acceptedActionArguments['roughness']) &&
    numberMatches(observation.details['metallic'], acceptedActionArguments['metallic'])
  );
}

export function validateStrongProcedureLeafReplayObservation(
  binding: ProcedureLeafReplayBinding,
  report: CompanionStateReport,
) {
  const actionContract = replayActionContracts[binding.actionName];
  const expectedStep = binding.proposal.plan.steps.find((step) => step.id === binding.leafId);
  if (actionContract.observationShape === 'material_palette') {
    const acceptedActionArguments = expectedStep?.action?.arguments;
    if (
      expectedStep?.action?.name !== binding.actionName ||
      acceptedActionArguments === undefined ||
      !materialPaletteExpectedObservationsValid(
        expectedStep.expectedObservations,
        acceptedActionArguments,
      ) ||
      report.observations.length !== expectedStep.expectedObservations.length
    ) {
      throw new ProcedureLeafReplayError(
        'Companion report lacks the exact ordered managed Material Palette observations',
        409,
      );
    }
    const materials = acceptedActionArguments['materials'] as Record<string, unknown>[];
    const valid = report.observations.every((observation, index) => {
      const expectedObservation = expectedStep.expectedObservations[index];
      const definition = materials[index];
      return (
        expectedObservation !== undefined &&
        definition !== undefined &&
        observation.kind === 'material_assigned' &&
        observation.satisfied === true &&
        observation.details['supported'] === true &&
        sameCanonicalValue(observation.details['parameters'], expectedObservation.parameters) &&
        strongMaterialObservationMatches(observation, definition, expectedObservation.parameters)
      );
    });
    if (!valid) {
      throw new ProcedureLeafReplayError(
        'Companion report lacks the exact ordered managed Material Palette observations',
        409,
      );
    }
    return report.observations.map((observation) =>
      procedureLeafReplayObservationSchema.parse({
        kind: observation.kind,
        satisfied: true,
        details: structuredClone(observation.details),
      }),
    );
  }
  const expectedObservation = expectedStep?.expectedObservations[0];
  const observation = report.observations[0];
  const expectedParameters = expectedObservation?.parameters;
  if (
    expectedStep?.action?.name !== binding.actionName ||
    expectedStep.expectedObservations.length !== 1 ||
    expectedObservation === undefined ||
    expectedObservation?.kind !== actionContract.observationKind ||
    report.observations.length !== 1 ||
    observation === undefined ||
    observation.kind !== actionContract.observationKind ||
    observation.satisfied !== true ||
    observation.details['supported'] !== true ||
    !sameCanonicalValue(observation.details['parameters'], expectedObservation.parameters) ||
    expectedParameters === undefined ||
    !actionContract.parametersValid(expectedParameters)
  ) {
    throw new ProcedureLeafReplayError(
      `Companion report lacks the exact satisfied ${actionContract.observationKind} observation`,
      409,
    );
  }

  if (actionContract.observationShape === 'subdivision_surface_modifier') {
    const strongDetailKeys = new Set([
      'parameters',
      'supported',
      'targetId',
      'modifierId',
      'modifierType',
      'propertiesMatch',
      'sourceContentIntact',
      'evaluatedVertexCount',
      'evaluatedEdgeCount',
      'evaluatedFaceCount',
      'evaluatedFinite',
      'evaluatedWithinLimits',
    ]);
    const booleanDetailKeys = [
      'propertiesMatch',
      'sourceContentIntact',
      'evaluatedFinite',
      'evaluatedWithinLimits',
    ] as const;
    const evaluatedCounts = [
      ['evaluatedVertexCount', 8192],
      ['evaluatedEdgeCount', 16384],
      ['evaluatedFaceCount', 8192],
    ] as const;
    if (
      Object.keys(observation.details).length !== strongDetailKeys.size ||
      Object.keys(observation.details).some((key) => !strongDetailKeys.has(key)) ||
      observation.details['targetId'] !== expectedParameters['targetId'] ||
      observation.details['modifierId'] !== expectedParameters['modifierId'] ||
      observation.details['modifierType'] !== 'SUBSURF' ||
      booleanDetailKeys.some((key) => observation.details[key] !== true) ||
      evaluatedCounts.some(([key, maximum]) => {
        const value = observation.details[key];
        return (
          !Number.isSafeInteger(value) || (value as number) <= 0 || (value as number) > maximum
        );
      })
    ) {
      throw new ProcedureLeafReplayError(
        'Companion report lacks the exact satisfied managed Subdivision Surface observation',
        409,
      );
    }
  } else if (actionContract.observationShape === 'bevel_modifier') {
    const strongDetailKeys = new Set([
      'parameters',
      'supported',
      'targetId',
      'modifierId',
      'modifierType',
      'propertiesMatch',
      'width',
      'segments',
      'angleLimit',
      'limitMethod',
      'bevelFixedStateMatches',
      'sourceContentIntact',
      'evaluatedVertexCount',
      'evaluatedEdgeCount',
      'evaluatedFaceCount',
      'evaluatedFinite',
      'evaluatedWithinLimits',
    ]);
    const booleanDetailKeys = [
      'propertiesMatch',
      'bevelFixedStateMatches',
      'sourceContentIntact',
      'evaluatedFinite',
      'evaluatedWithinLimits',
    ] as const;
    const evaluatedCounts = [
      ['evaluatedVertexCount', 8192],
      ['evaluatedEdgeCount', 16384],
      ['evaluatedFaceCount', 8192],
    ] as const;
    if (
      Object.keys(observation.details).length !== strongDetailKeys.size ||
      Object.keys(observation.details).some((key) => !strongDetailKeys.has(key)) ||
      observation.details['targetId'] !== expectedParameters['targetId'] ||
      observation.details['modifierId'] !== expectedParameters['modifierId'] ||
      observation.details['modifierType'] !== 'BEVEL' ||
      !isFiniteNumber(observation.details['width']) ||
      !isFiniteNumber(expectedParameters['width']) ||
      Math.abs(observation.details['width'] - expectedParameters['width']) > 1e-6 ||
      observation.details['segments'] !== expectedParameters['segments'] ||
      !isFiniteNumber(observation.details['angleLimit']) ||
      !isFiniteNumber(expectedParameters['angleLimit']) ||
      Math.abs(observation.details['angleLimit'] - expectedParameters['angleLimit']) > 1e-6 ||
      observation.details['limitMethod'] !== 'ANGLE' ||
      booleanDetailKeys.some((key) => observation.details[key] !== true) ||
      evaluatedCounts.some(([key, maximum]) => {
        const value = observation.details[key];
        return (
          !Number.isSafeInteger(value) || (value as number) <= 0 || (value as number) > maximum
        );
      })
    ) {
      throw new ProcedureLeafReplayError(
        'Companion report lacks the exact satisfied managed Bevel Modifier observation',
        409,
      );
    }
  } else if (actionContract.observationShape === 'single_material') {
    const acceptedActionArguments = expectedStep.action?.arguments;
    const strongDetailKeys = new Set([
      'parameters',
      'supported',
      'materialId',
      'materialName',
      'targetIds',
      'assignedTargetIds',
      'useNodes',
      'principledNodeCount',
      'outputNodeCount',
      'baseColor',
      'roughness',
      'metallic',
      'receiptMatches',
      'ownershipMatches',
      'materialSurfaceMatches',
      'assignmentsMatch',
      'sourceContentIntact',
    ]);
    const proofKeys = [
      'useNodes',
      'receiptMatches',
      'ownershipMatches',
      'materialSurfaceMatches',
      'assignmentsMatch',
      'sourceContentIntact',
    ] as const;
    const observedBaseColor = observation.details['baseColor'];
    const acceptedBaseColor = acceptedActionArguments?.['baseColor'];
    const observedRoughness = observation.details['roughness'];
    const acceptedRoughness = acceptedActionArguments?.['roughness'];
    const observedMetallic = observation.details['metallic'];
    const acceptedMetallic = acceptedActionArguments?.['metallic'];
    const numberMatches = (observed: unknown, accepted: unknown) =>
      isFiniteNumber(observed) &&
      isFiniteNumber(accepted) &&
      Math.abs(observed - accepted) <= Math.max(1e-6, Math.abs(accepted) * 1e-6);
    if (
      acceptedActionArguments === undefined ||
      !isSingleMaterialActionArguments(acceptedActionArguments) ||
      Object.keys(observation.details).length !== strongDetailKeys.size ||
      Object.keys(observation.details).some((key) => !strongDetailKeys.has(key)) ||
      observation.details['materialId'] !== acceptedActionArguments['materialId'] ||
      observation.details['materialId'] !== expectedParameters['materialId'] ||
      observation.details['materialName'] !== acceptedActionArguments['materialName'] ||
      !sameCanonicalValue(observation.details['targetIds'], acceptedActionArguments['targets']) ||
      !sameCanonicalValue(
        observation.details['assignedTargetIds'],
        acceptedActionArguments['targets'],
      ) ||
      proofKeys.some((key) => observation.details[key] !== true) ||
      observation.details['principledNodeCount'] !== 1 ||
      observation.details['outputNodeCount'] !== 1 ||
      !Array.isArray(observedBaseColor) ||
      !Array.isArray(acceptedBaseColor) ||
      observedBaseColor.length !== 4 ||
      acceptedBaseColor.length !== 4 ||
      observedBaseColor.some(
        (component, index) => !numberMatches(component, acceptedBaseColor[index]),
      ) ||
      !numberMatches(observedRoughness, acceptedRoughness) ||
      !numberMatches(observedMetallic, acceptedMetallic)
    ) {
      throw new ProcedureLeafReplayError(
        'Companion report lacks the exact satisfied managed Single Material observation',
        409,
      );
    }
  } else if (actionContract.observationShape === 'solidify_modifier') {
    const strongDetailKeys = new Set([
      'parameters',
      'supported',
      'targetId',
      'modifierId',
      'modifierType',
      'propertiesMatch',
      'thickness',
      'offset',
      'solidifyMode',
      'useEvenOffset',
      'useRim',
      'useRimOnly',
      'solidifyFixedStateMatches',
      'sourceContentIntact',
      'evaluatedVertexCount',
      'evaluatedEdgeCount',
      'evaluatedFaceCount',
      'evaluatedFinite',
      'evaluatedWithinLimits',
    ]);
    const booleanDetailKeys = [
      'propertiesMatch',
      'useEvenOffset',
      'useRim',
      'solidifyFixedStateMatches',
      'sourceContentIntact',
      'evaluatedFinite',
      'evaluatedWithinLimits',
    ] as const;
    const evaluatedCounts = [
      ['evaluatedVertexCount', 8192],
      ['evaluatedEdgeCount', 16384],
      ['evaluatedFaceCount', 8192],
    ] as const;
    if (
      Object.keys(observation.details).length !== strongDetailKeys.size ||
      Object.keys(observation.details).some((key) => !strongDetailKeys.has(key)) ||
      observation.details['targetId'] !== expectedParameters['targetId'] ||
      observation.details['modifierId'] !== expectedParameters['modifierId'] ||
      observation.details['modifierType'] !== 'SOLIDIFY' ||
      !isFiniteNumber(observation.details['thickness']) ||
      !isFiniteNumber(expectedParameters['thickness']) ||
      Math.abs(observation.details['thickness'] - expectedParameters['thickness']) > 1e-6 ||
      !isFiniteNumber(observation.details['offset']) ||
      !isFiniteNumber(expectedParameters['offset']) ||
      Math.abs(observation.details['offset'] - expectedParameters['offset']) > 1e-6 ||
      observation.details['solidifyMode'] !== 'EXTRUDE' ||
      booleanDetailKeys.some((key) => observation.details[key] !== true) ||
      observation.details['useRimOnly'] !== false ||
      evaluatedCounts.some(([key, maximum]) => {
        const value = observation.details[key];
        return (
          !Number.isSafeInteger(value) || (value as number) <= 0 || (value as number) > maximum
        );
      })
    ) {
      throw new ProcedureLeafReplayError(
        'Companion report lacks the exact satisfied managed Solidify observation',
        409,
      );
    }
  } else if (actionContract.observationShape === 'mirror_modifier') {
    const strongDetailKeys = new Set([
      'parameters',
      'supported',
      'targetId',
      'modifierId',
      'modifierType',
      'propertiesMatch',
      'axis',
      'expectedAxis',
      'mirrorFixedStateMatches',
      'mirrorObjectAbsent',
      'sourceContentIntact',
      'evaluatedVertexCount',
      'evaluatedEdgeCount',
      'evaluatedFaceCount',
      'evaluatedFinite',
      'evaluatedWithinLimits',
    ]);
    const booleanDetailKeys = [
      'propertiesMatch',
      'mirrorFixedStateMatches',
      'mirrorObjectAbsent',
      'sourceContentIntact',
      'evaluatedFinite',
      'evaluatedWithinLimits',
    ] as const;
    const evaluatedCounts = [
      ['evaluatedVertexCount', 8192],
      ['evaluatedEdgeCount', 16384],
      ['evaluatedFaceCount', 8192],
    ] as const;
    const expectedTargetId = expectedParameters['targetId'];
    const expectedModifierId = expectedParameters['modifierId'];
    const expectedAxis = expectedParameters['axis'];
    if (
      Object.keys(observation.details).length !== strongDetailKeys.size ||
      Object.keys(observation.details).some((key) => !strongDetailKeys.has(key)) ||
      observation.details['targetId'] !== expectedTargetId ||
      observation.details['modifierId'] !== expectedModifierId ||
      observation.details['modifierType'] !== 'MIRROR' ||
      observation.details['axis'] !== expectedAxis ||
      observation.details['expectedAxis'] !== expectedAxis ||
      booleanDetailKeys.some((key) => observation.details[key] !== true) ||
      evaluatedCounts.some(([key, maximum]) => {
        const value = observation.details[key];
        return (
          !Number.isSafeInteger(value) || (value as number) <= 0 || (value as number) > maximum
        );
      })
    ) {
      throw new ProcedureLeafReplayError(
        'Companion report lacks the exact satisfied managed Mirror observation',
        409,
      );
    }
  } else if (actionContract.observationShape === 'managed_edit') {
    if (
      !validateManagedEditReplayDetails(
        actionContract.observationKind,
        observation.details,
        expectedParameters,
      )
    ) {
      throw new ProcedureLeafReplayError(
        `Companion report lacks the exact satisfied managed ${actionContract.observationKind} observation`,
        409,
      );
    }
  } else if (actionContract.observationShape === 'managed_armature') {
    if (!validateManagedArmatureReplayDetails(observation.details, expectedParameters)) {
      throw new ProcedureLeafReplayError(
        'Companion report lacks the exact satisfied managed armature observation',
        409,
      );
    }
  } else if (actionContract.observationShape === 'managed_skin_weights') {
    if (!validateManagedSkinWeightsReplayDetails(observation.details, expectedParameters)) {
      throw new ProcedureLeafReplayError(
        'Companion report lacks the exact satisfied managed skin-weights observation',
        409,
      );
    }
  } else if (actionContract.observationShape === 'managed_pose_animation') {
    if (!validateManagedPoseAnimationReplayDetails(observation.details, expectedParameters)) {
      throw new ProcedureLeafReplayError(
        'Companion report lacks the exact satisfied managed pose-animation observation',
        409,
      );
    }
  } else if (actionContract.observationShape === 'managed_transform_geometry') {
    if (!validateManagedTransformGeometryReplayDetails(observation.details, expectedParameters)) {
      throw new ProcedureLeafReplayError(
        'Companion report lacks the exact satisfied managed Transform Geometry observation',
        409,
      );
    }
  } else if (actionContract.observationShape === 'managed_light_trails') {
    if (!validateManagedLightTrailsReplayDetails(observation.details, expectedParameters)) {
      throw new ProcedureLeafReplayError(
        'Companion report lacks the exact satisfied managed light-trails observation',
        409,
      );
    }
  } else if (actionContract.observationShape === 'managed_light_trails_scene') {
    if (!validateManagedLightTrailsSceneReplayDetails(observation.details, expectedParameters)) {
      throw new ProcedureLeafReplayError(
        'Companion report lacks the exact satisfied managed light-trails scene observation',
        409,
      );
    }
  } else {
    const expectedResourceId = expectedParameters['resourceId'];
    const expectedObjectName = expectedParameters['objectName'];
    const meshContentSha256 = observation.details['meshContentSha256'];
    const expectedTopology = actionContract.expectedTopology(expectedParameters);
    const strongBooleanDetailKeys = [
      'parametersValid',
      'objectOwned',
      'meshOwned',
      'collectionOwned',
      'receiptMatches',
      'objectDataMatches',
      'collectionLinkMatches',
      'nameMatches',
      'locationMatches',
      'rotationMatches',
      'scaleMatches',
      'transformIsolated',
      'modifiersAbsent',
      'shapeKeysAbsent',
      'materialsAbsent',
      'contentIntact',
      'topologyMatches',
      'finiteCoordinates',
      ...actionContract.geometryMatchDetailKeys,
    ] as const;
    const strongDetailKeys = new Set<string>([
      'parameters',
      'supported',
      'resourceId',
      'objectName',
      'meshId',
      'collectionId',
      ...strongBooleanDetailKeys,
      'vertexCount',
      'edgeCount',
      'faceCount',
      'meshContentSha256',
    ]);
    if (
      Object.keys(observation.details).length !== strongDetailKeys.size ||
      Object.keys(observation.details).some((key) => !strongDetailKeys.has(key)) ||
      typeof expectedResourceId !== 'string' ||
      typeof expectedObjectName !== 'string' ||
      expectedTopology === null ||
      observation.details['resourceId'] !== expectedResourceId ||
      observation.details['objectName'] !== expectedObjectName ||
      observation.details['meshId'] !== `${expectedResourceId}.mesh` ||
      observation.details['collectionId'] !== 'snowman.collection' ||
      strongBooleanDetailKeys.some((key) => observation.details[key] !== true) ||
      observation.details['vertexCount'] !== expectedTopology.vertexCount ||
      observation.details['edgeCount'] !== expectedTopology.edgeCount ||
      observation.details['faceCount'] !== expectedTopology.faceCount ||
      typeof meshContentSha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(meshContentSha256)
    ) {
      throw new ProcedureLeafReplayError(
        `Companion report lacks the exact satisfied ${actionContract.observationKind} observation`,
        409,
      );
    }
  }
  return [
    procedureLeafReplayObservationSchema.parse({
      kind: actionContract.observationKind,
      satisfied: true,
      details: structuredClone(observation.details),
    }),
  ];
}

export function buildProcedureLeafReplayAttestation(input: {
  readonly binding: ProcedureLeafReplayBinding;
  readonly decision: GuideProposalDecision;
  readonly report: CompanionStateReport;
  readonly actionExecutionRequestId: string;
  readonly authorizedStartReport: CompanionStateReport;
  readonly proposalReceipt: StoredManagedReplayReceipt;
  readonly decisionReceipt: StoredManagedReplayReceipt;
  readonly startReportReceipt: StoredManagedReplayReceipt;
  readonly reportReceipt: StoredManagedReplayReceipt;
  readonly attestationId: string;
  readonly attestedAt: string;
}): ProcedureLeafReplayAttestation {
  const { binding, decision, report } = input;
  const proposal = binding.proposal;
  const completedPrefix = procedureLeafReplayExecutablePrefix(binding);
  const terminalCompletedStepIds = [...completedPrefix, binding.leafId];
  const executableStepIds = procedureLeafReplayExecutableSteps(binding).map((step) => step.id);
  const terminalPhase: 'running' | 'completed' = sameStepIds(
    terminalCompletedStepIds,
    executableStepIds,
  )
    ? 'completed'
    : 'running';
  const authorizedStartCheckpoint = input.authorizedStartReport.nativeUndoCheckpoint;
  if (
    decision.proposalId !== proposal.proposalId ||
    decision.decision !== 'accepted' ||
    decision.adapterId !== proposal.targetAdapterId ||
    decision.instanceId !== binding.targetInstanceId
  ) {
    throw new ProcedureLeafReplayError(
      'Replay attestation requires the exact accepted proposal decision',
      409,
    );
  }
  const { proposalReceipt, decisionReceipt, startReportReceipt, reportReceipt } = input;
  if (
    proposalReceipt.subjectType !== 'replay_proposal' ||
    proposalReceipt.subjectId !== proposal.proposalId ||
    proposalReceipt.authentication !== 'orchestrator_internal' ||
    proposalReceipt.adapterId !== proposal.targetAdapterId ||
    proposalReceipt.instanceId !== binding.targetInstanceId ||
    proposalReceipt.sessionFingerprintSha256 !== null ||
    decisionReceipt.subjectType !== 'guide_proposal_decision' ||
    decisionReceipt.subjectId !== decision.decisionId ||
    decisionReceipt.authentication !== 'negotiated_companion_lease' ||
    decisionReceipt.adapterId !== proposal.targetAdapterId ||
    decisionReceipt.instanceId !== binding.targetInstanceId ||
    decisionReceipt.sessionFingerprintSha256 === null ||
    startReportReceipt.subjectType !== 'companion_state_report' ||
    startReportReceipt.subjectId !== input.authorizedStartReport.reportId ||
    startReportReceipt.authentication !== 'negotiated_companion_lease' ||
    startReportReceipt.adapterId !== proposal.targetAdapterId ||
    startReportReceipt.instanceId !== binding.targetInstanceId ||
    startReportReceipt.sessionFingerprintSha256 !== decisionReceipt.sessionFingerprintSha256 ||
    reportReceipt.subjectType !== 'companion_state_report' ||
    reportReceipt.subjectId !== report.reportId ||
    reportReceipt.authentication !== 'negotiated_companion_lease' ||
    reportReceipt.adapterId !== proposal.targetAdapterId ||
    reportReceipt.instanceId !== binding.targetInstanceId ||
    reportReceipt.sessionFingerprintSha256 !== decisionReceipt.sessionFingerprintSha256 ||
    proposalReceipt.sequence >= decisionReceipt.sequence ||
    decisionReceipt.sequence >= startReportReceipt.sequence ||
    startReportReceipt.sequence >= reportReceipt.sequence ||
    Date.parse(proposalReceipt.receivedAt) > Date.parse(decisionReceipt.receivedAt) ||
    Date.parse(decisionReceipt.receivedAt) > Date.parse(startReportReceipt.receivedAt) ||
    Date.parse(startReportReceipt.receivedAt) > Date.parse(reportReceipt.receivedAt)
  ) {
    throw new ProcedureLeafReplayError(
      'Replay attestation requires one ordered authenticated Companion session receipt chain',
      409,
    );
  }
  if (
    Date.parse(decision.occurredAt) > Date.parse(input.authorizedStartReport.occurredAt) ||
    Date.parse(input.authorizedStartReport.occurredAt) > Date.parse(report.occurredAt)
  ) {
    throw new ProcedureLeafReplayError('Replay execution reports predate their authorization', 409);
  }
  if (
    input.authorizedStartReport.protocolVersion !== proposal.protocolVersion ||
    input.authorizedStartReport.adapterId !== proposal.targetAdapterId ||
    input.authorizedStartReport.instanceId !== binding.targetInstanceId ||
    input.authorizedStartReport.plan?.id !== proposal.plan.id ||
    input.authorizedStartReport.plan.revision !== proposal.plan.revision ||
    input.authorizedStartReport.planContentSha256 !== binding.planContentSha256 ||
    input.authorizedStartReport.executionId === null ||
    input.authorizedStartReport.phase !== 'running' ||
    input.authorizedStartReport.transition !==
      (completedPrefix.length === 0 ? 'walkthrough_started' : 'step_succeeded') ||
    input.authorizedStartReport.activeStepId !== (completedPrefix.at(-1) ?? null) ||
    input.authorizedStartReport.stepId !== (completedPrefix.at(-1) ?? null) ||
    !sameStepIds(input.authorizedStartReport.completedStepIds, completedPrefix) ||
    authorizedStartCheckpoint === undefined ||
    authorizedStartCheckpoint.operation !== (completedPrefix.length === 0 ? 'start' : 'next') ||
    (authorizedStartCheckpoint.previousCheckpointId === null) !== (completedPrefix.length === 0) ||
    input.authorizedStartReport.observationGate !== null ||
    input.authorizedStartReport.artifactAttestation !== null ||
    input.authorizedStartReport.error !== null
  ) {
    throw new ProcedureLeafReplayError(
      'Replay authorization does not prove the exact canonical executable start prefix',
      409,
    );
  }
  if (
    report.protocolVersion !== proposal.protocolVersion ||
    report.adapterId !== proposal.targetAdapterId ||
    report.instanceId !== binding.targetInstanceId ||
    report.plan?.id !== proposal.plan.id ||
    report.plan.revision !== proposal.plan.revision ||
    report.planContentSha256 !== binding.planContentSha256 ||
    report.executionId === null ||
    report.executionId !== input.authorizedStartReport.executionId ||
    report.phase !== terminalPhase ||
    report.transition !== 'step_succeeded' ||
    report.stepId !== binding.leafId ||
    report.activeStepId !== binding.leafId ||
    !sameStepIds(report.completedStepIds, terminalCompletedStepIds) ||
    report.observationGate !== null ||
    report.artifactAttestation !== null ||
    report.error !== null
  ) {
    throw new ProcedureLeafReplayError(
      'Companion report does not prove the exact terminal replay execution',
      409,
    );
  }
  const replayStep = proposal.plan.steps.find((step) => step.id === binding.leafId);
  const retryPolicy =
    replayStep?.observationPolicy?.mode === 'success_gate'
      ? replayStep.observationPolicy.retryPolicy
      : undefined;
  const retryEvidence = report.observationRetry;
  if (
    retryEvidence !== undefined &&
    (retryPolicy?.mode !== 'automatic_bounded' ||
      retryEvidence.mode !== retryPolicy.mode ||
      retryEvidence.maxAttempts !== retryPolicy.maxAttempts)
  ) {
    throw new ProcedureLeafReplayError(
      'Companion retry success evidence does not match the accepted replay policy',
      409,
    );
  }
  const nativeUndoCheckpoint = report.nativeUndoCheckpoint;
  if (
    nativeUndoCheckpoint === undefined ||
    nativeUndoCheckpoint.operation !== 'next' ||
    !sameStepIds(nativeUndoCheckpoint.session.receiptStepIds, [
      ...authorizedStartCheckpoint.session.receiptStepIds,
      binding.leafId,
    ])
  ) {
    throw new ProcedureLeafReplayError(
      'Companion report does not prove a current native Undo checkpoint for the replay step',
      409,
    );
  }
  if (
    !satisfiesStableVersionRange(
      report.hostVersion,
      binding.materialization.tree.hostVersionRange,
      'Replay host version',
    )
  ) {
    throw new ProcedureLeafReplayError(
      `Host version ${report.hostVersion} is outside the replay tree hostVersionRange`,
      409,
    );
  }

  const attestedObservations = validateStrongProcedureLeafReplayObservation(binding, report);
  if (
    Date.parse(report.occurredAt) > Date.parse(input.attestedAt) ||
    Date.parse(reportReceipt.receivedAt) > Date.parse(input.attestedAt)
  ) {
    throw new ProcedureLeafReplayError('Replay attestation predates its companion evidence', 409);
  }

  const sessionFingerprintSha256 = decisionReceipt.sessionFingerprintSha256;
  if (sessionFingerprintSha256 === null) {
    throw new ProcedureLeafReplayError('Replay decision receipt lacks a session fingerprint', 409);
  }
  const attestedDecision = {
    ...decision,
    adapterId: 'blender' as const,
    decision: 'accepted' as const,
  };
  const attestedReport = {
    ...report,
    adapterId: 'blender' as const,
    plan: { id: proposal.plan.id, revision: proposal.plan.revision },
    planContentSha256: binding.planContentSha256,
    executionId: report.executionId,
    phase: terminalPhase,
    activeStepId: binding.leafId,
    completedStepIds: [...report.completedStepIds],
    transition: 'step_succeeded' as const,
    stepId: binding.leafId,
    observations: attestedObservations,
    observationGate: null,
    artifactAttestation: null,
    error: null,
  };
  const content: Omit<ProcedureLeafReplayAttestation, 'integrity'> = {
    formatVersion: procedureLeafReplayFormatVersion,
    replayId: binding.replayId,
    attestationId: input.attestationId,
    decision: attestedDecision,
    authorization: {
      actionExecutionRequestId: input.actionExecutionRequestId,
      startState: {
        reportId: input.authorizedStartReport.reportId,
        sequence: input.authorizedStartReport.sequence,
        reportContentSha256: computeProtocolCanonicalJsonSha256(input.authorizedStartReport),
        checkpointId: authorizedStartCheckpoint.checkpointId,
        checkpointContentSha256: computeProtocolCanonicalJsonSha256(authorizedStartCheckpoint),
        phase: 'running',
        activeStepId: input.authorizedStartReport.activeStepId,
        checkpointOperation: authorizedStartCheckpoint.operation,
        completedStepIds: [...input.authorizedStartReport.completedStepIds],
        receiptStepIds: [...authorizedStartCheckpoint.session.receiptStepIds],
      },
    },
    report: attestedReport,
    evidenceClass: 'companion_reported_managed_action_leaf_replay',
    provenance: {
      authentication: 'negotiated_companion_lease',
      sessionFingerprintSha256,
      proposalReceipt: {
        sequence: proposalReceipt.sequence,
        receivedAt: proposalReceipt.receivedAt,
      },
      decisionReceipt: {
        sequence: decisionReceipt.sequence,
        receivedAt: decisionReceipt.receivedAt,
      },
      startReportReceipt: {
        sequence: startReportReceipt.sequence,
        receivedAt: startReportReceipt.receivedAt,
      },
      reportReceipt: {
        sequence: reportReceipt.sequence,
        receivedAt: reportReceipt.receivedAt,
      },
    },
    bindingContentSha256: binding.integrity.contentSha256,
    execution: {
      host: {
        adapterId: 'blender',
        instanceId: report.instanceId,
        version: report.hostVersion,
      },
      companion: { version: report.companionVersion },
      plan: {
        id: report.plan.id,
        revision: report.plan.revision,
        contentSha256: report.planContentSha256,
      },
      execution: { id: report.executionId },
      step: { id: binding.leafId },
      action: {
        adapterId: 'blender',
        name: binding.actionName,
      },
      occurredAt: report.occurredAt,
    },
    successGate: {
      observations: attestedObservations,
      allSatisfied: true,
    },
    verificationScope: {
      managedActionResult: 'verified',
      menuTrack: binding.claims.menuTrack,
      shortcutTrack: binding.claims.shortcutTrack,
      mcpTrack: binding.claims.mcpTrack,
      nativeUndoCheckpoint: 'companion_reported_current_at_report',
      currentHostStateAfterReport: 'not_verified',
    },
    attestedAt: input.attestedAt,
  };
  return procedureLeafReplayAttestationSchema.parse({
    ...content,
    integrity: {
      algorithm: 'sha256',
      canonicalization: protocolJsonValueCanonicalization,
      contentSha256: computeProcedureLeafReplayAttestationContentSha256(content),
    },
  });
}

export function buildProcedureLeafReplayFailureRecoveryAttestation(input: {
  readonly binding: ProcedureLeafReplayBinding;
  readonly decision: GuideProposalDecision;
  readonly failureReport: CompanionStateReport;
  readonly recoveryReport: CompanionStateReport | null;
  readonly actionExecutionRequestId: string;
  readonly authorizedStartReport: CompanionStateReport;
  readonly proposalReceipt: StoredManagedReplayReceipt;
  readonly decisionReceipt: StoredManagedReplayReceipt;
  readonly startReportReceipt: StoredManagedReplayReceipt;
  readonly failureReportReceipt: StoredManagedReplayReceipt;
  readonly recoveryReportReceipt: StoredManagedReplayReceipt | null;
  readonly attestationId: string;
  readonly attestedAt: string;
}): ProcedureLeafReplayFailureRecoveryAttestation {
  const {
    binding,
    decision,
    failureReport,
    recoveryReport,
    authorizedStartReport,
    proposalReceipt,
    decisionReceipt,
    startReportReceipt,
    failureReportReceipt,
    recoveryReportReceipt,
  } = input;
  const proposal = binding.proposal;
  const completedPrefix = procedureLeafReplayExecutablePrefix(binding);
  const terminalCompletedStepIds = [...completedPrefix, binding.leafId];
  const executableStepIds = procedureLeafReplayExecutableSteps(binding).map((step) => step.id);
  const terminalPhase: 'running' | 'completed' = sameStepIds(
    terminalCompletedStepIds,
    executableStepIds,
  )
    ? 'completed'
    : 'running';
  const authorizedStartCheckpoint = authorizedStartReport.nativeUndoCheckpoint;
  const leaf = binding.materialization.tree.nodes.find((node) => node.id === binding.leafId);
  const observationPolicy = leaf?.kind === 'leaf' ? leaf.observationPolicy : undefined;
  const failureStrategy =
    observationPolicy?.mode === 'success_gate' ? observationPolicy.failureStrategy : undefined;
  const retryPolicy =
    observationPolicy?.mode === 'success_gate' ? observationPolicy.retryPolicy : undefined;
  if (
    decision.proposalId !== proposal.proposalId ||
    decision.decision !== 'accepted' ||
    decision.adapterId !== proposal.targetAdapterId ||
    decision.instanceId !== binding.targetInstanceId ||
    (failureStrategy !== 'rollback_step' && failureStrategy !== 'retain_for_repair')
  ) {
    throw new ProcedureLeafReplayError(
      'Failure/recovery attestation requires the exact accepted replay decision and gate policy',
      409,
    );
  }
  const executionFingerprint = decisionReceipt.sessionFingerprintSha256;
  const recoveryFingerprint = recoveryReportReceipt?.sessionFingerprintSha256 ?? null;
  const recoveryReceiptsMatch =
    recoveryReport === null
      ? recoveryReportReceipt === null
      : recoveryReportReceipt !== null &&
        recoveryReportReceipt.subjectType === 'companion_state_report' &&
        recoveryReportReceipt.subjectId === recoveryReport.reportId &&
        recoveryReportReceipt.authentication === 'negotiated_companion_lease' &&
        recoveryReportReceipt.adapterId === proposal.targetAdapterId &&
        recoveryReportReceipt.instanceId === binding.targetInstanceId &&
        recoveryFingerprint !== null &&
        failureReportReceipt.sequence < recoveryReportReceipt.sequence &&
        Date.parse(failureReportReceipt.receivedAt) <= Date.parse(recoveryReportReceipt.receivedAt);
  if (
    proposalReceipt.subjectType !== 'replay_proposal' ||
    proposalReceipt.subjectId !== proposal.proposalId ||
    proposalReceipt.authentication !== 'orchestrator_internal' ||
    proposalReceipt.adapterId !== proposal.targetAdapterId ||
    proposalReceipt.instanceId !== binding.targetInstanceId ||
    proposalReceipt.sessionFingerprintSha256 !== null ||
    decisionReceipt.subjectType !== 'guide_proposal_decision' ||
    decisionReceipt.subjectId !== decision.decisionId ||
    decisionReceipt.authentication !== 'negotiated_companion_lease' ||
    decisionReceipt.adapterId !== proposal.targetAdapterId ||
    decisionReceipt.instanceId !== binding.targetInstanceId ||
    executionFingerprint === null ||
    startReportReceipt.subjectType !== 'companion_state_report' ||
    startReportReceipt.subjectId !== authorizedStartReport.reportId ||
    startReportReceipt.authentication !== 'negotiated_companion_lease' ||
    startReportReceipt.adapterId !== proposal.targetAdapterId ||
    startReportReceipt.instanceId !== binding.targetInstanceId ||
    startReportReceipt.sessionFingerprintSha256 !== executionFingerprint ||
    failureReportReceipt.subjectType !== 'companion_state_report' ||
    failureReportReceipt.subjectId !== failureReport.reportId ||
    failureReportReceipt.authentication !== 'negotiated_companion_lease' ||
    failureReportReceipt.adapterId !== proposal.targetAdapterId ||
    failureReportReceipt.instanceId !== binding.targetInstanceId ||
    failureReportReceipt.sessionFingerprintSha256 !== executionFingerprint ||
    proposalReceipt.sequence >= decisionReceipt.sequence ||
    decisionReceipt.sequence >= startReportReceipt.sequence ||
    startReportReceipt.sequence >= failureReportReceipt.sequence ||
    Date.parse(proposalReceipt.receivedAt) > Date.parse(decisionReceipt.receivedAt) ||
    Date.parse(decisionReceipt.receivedAt) > Date.parse(startReportReceipt.receivedAt) ||
    Date.parse(startReportReceipt.receivedAt) > Date.parse(failureReportReceipt.receivedAt) ||
    !recoveryReceiptsMatch
  ) {
    throw new ProcedureLeafReplayError(
      'Failure/recovery attestation requires an ordered authenticated receipt chain',
      409,
    );
  }
  if (
    authorizedStartReport.protocolVersion !== proposal.protocolVersion ||
    authorizedStartReport.adapterId !== proposal.targetAdapterId ||
    authorizedStartReport.instanceId !== binding.targetInstanceId ||
    authorizedStartReport.plan?.id !== proposal.plan.id ||
    authorizedStartReport.plan.revision !== proposal.plan.revision ||
    authorizedStartReport.planContentSha256 !== binding.planContentSha256 ||
    authorizedStartReport.executionId === null ||
    authorizedStartReport.phase !== 'running' ||
    authorizedStartReport.transition !==
      (completedPrefix.length === 0 ? 'walkthrough_started' : 'step_succeeded') ||
    authorizedStartReport.activeStepId !== (completedPrefix.at(-1) ?? null) ||
    authorizedStartReport.stepId !== (completedPrefix.at(-1) ?? null) ||
    !sameStepIds(authorizedStartReport.completedStepIds, completedPrefix) ||
    authorizedStartCheckpoint === undefined ||
    authorizedStartCheckpoint.operation !== (completedPrefix.length === 0 ? 'start' : 'next') ||
    (authorizedStartCheckpoint.previousCheckpointId === null) !== (completedPrefix.length === 0) ||
    authorizedStartReport.observationGate !== null ||
    authorizedStartReport.artifactAttestation !== null ||
    authorizedStartReport.error !== null
  ) {
    throw new ProcedureLeafReplayError(
      'Failure/recovery authorization does not prove the exact executable start prefix',
      409,
    );
  }
  if (
    failureReport.protocolVersion !== proposal.protocolVersion ||
    failureReport.adapterId !== proposal.targetAdapterId ||
    failureReport.instanceId !== binding.targetInstanceId ||
    failureReport.plan?.id !== proposal.plan.id ||
    failureReport.plan.revision !== proposal.plan.revision ||
    failureReport.planContentSha256 !== binding.planContentSha256 ||
    failureReport.executionId === null ||
    failureReport.executionId !== authorizedStartReport.executionId ||
    failureReport.transition !== 'step_observation_failed' ||
    failureReport.stepId !== binding.leafId ||
    !sameStepIds(failureReport.completedStepIds, completedPrefix) ||
    failureReport.observationGate === undefined ||
    failureReport.observationGate === null ||
    failureReport.observationGate.status === 'recovered' ||
    failureReport.observationGate.stepId !== binding.leafId ||
    failureReport.observationGate.failureStrategy !== failureStrategy ||
    failureReport.artifactAttestation !== null ||
    failureReport.error !== null
  ) {
    throw new ProcedureLeafReplayError(
      'Failure report does not prove the exact managed replay observation failure',
      409,
    );
  }
  const expectedStep = proposal.plan.steps.find((step) => step.id === binding.leafId);
  const expectedObservation = expectedStep?.expectedObservations[0];
  const failedObservation = failureReport.observations[0];
  const actionContract = replayActionContracts[binding.actionName];
  if (actionContract.observationShape === 'material_palette') {
    const acceptedActionArguments = expectedStep?.action?.arguments;
    const paletteFailureValid =
      expectedStep?.action?.name === binding.actionName &&
      acceptedActionArguments !== undefined &&
      materialPaletteExpectedObservationsValid(
        expectedStep.expectedObservations,
        acceptedActionArguments,
      ) &&
      failureReport.observations.length === expectedStep.expectedObservations.length &&
      failureReport.observations.every((observation, index) => {
        const expected = expectedStep.expectedObservations[index];
        return (
          expected !== undefined &&
          observation.kind === 'material_assigned' &&
          observation.satisfied === false &&
          observation.details['supported'] === true &&
          sameCanonicalValue(observation.details['parameters'], expected.parameters)
        );
      });
    if (!paletteFailureValid) {
      throw new ProcedureLeafReplayError(
        'Failure report lacks the exact ordered unsatisfied Material Palette observations',
        409,
      );
    }
  } else if (
    expectedStep?.action?.name !== binding.actionName ||
    expectedStep.expectedObservations.length !== 1 ||
    expectedObservation?.kind !== actionContract.observationKind ||
    failureReport.observations.length !== 1 ||
    failedObservation?.kind !== actionContract.observationKind ||
    failedObservation.satisfied !== false ||
    failedObservation.details['supported'] !== true ||
    !sameCanonicalValue(failedObservation.details['parameters'], expectedObservation.parameters)
  ) {
    throw new ProcedureLeafReplayError(
      `Failure report lacks the exact unsatisfied ${actionContract.observationKind} observation`,
      409,
    );
  }
  const failureGate = failureReport.observationGate;
  const automaticRollback = failureGate.status === 'failed_rolled_back';
  const retryEvidence = failureGate.retry;
  if (
    automaticRollback &&
    (retryPolicy === undefined
      ? retryEvidence !== undefined
      : retryEvidence?.mode !== 'automatic_bounded' ||
        retryEvidence.disposition !== 'exhausted' ||
        retryEvidence.attempt !== retryPolicy.maxAttempts ||
        retryEvidence.maxAttempts !== retryPolicy.maxAttempts ||
        retryEvidence.remainingAttempts !== 0)
  ) {
    throw new ProcedureLeafReplayError(
      'Terminal rollback retry evidence does not match the accepted replay policy',
      409,
    );
  }
  const failureCheckpoint = failureReport.nativeUndoCheckpoint;
  if (
    automaticRollback
      ? failureStrategy !== 'rollback_step' ||
        failureReport.phase !== 'running' ||
        failureReport.activeStepId !== (completedPrefix.at(-1) ?? null) ||
        failureCheckpoint !== undefined ||
        recoveryReport !== null
      : failureReport.phase !== 'blocked' ||
        failureReport.activeStepId !== binding.leafId ||
        failureCheckpoint === undefined ||
        failureCheckpoint.operation !== 'next' ||
        failureCheckpoint.previousCheckpointId !== authorizedStartCheckpoint.checkpointId ||
        !sameStepIds(failureCheckpoint.session.receiptStepIds, [
          ...authorizedStartCheckpoint.session.receiptStepIds,
          binding.leafId,
        ]) ||
        recoveryReport === null
  ) {
    throw new ProcedureLeafReplayError(
      'Failure report does not match an automatic rollback or checkpointed repair path',
      409,
    );
  }
  if (
    !satisfiesStableVersionRange(
      failureReport.hostVersion,
      binding.materialization.tree.hostVersionRange,
      'Replay host version',
    )
  ) {
    throw new ProcedureLeafReplayError(
      `Host version ${failureReport.hostVersion} is outside the replay tree hostVersionRange`,
      409,
    );
  }

  let recoveredObservations: ReturnType<
    typeof validateStrongProcedureLeafReplayObservation
  > | null = null;
  if (recoveryReport !== null) {
    if (
      recoveryReport.protocolVersion !== proposal.protocolVersion ||
      recoveryReport.adapterId !== failureReport.adapterId ||
      recoveryReport.instanceId !== failureReport.instanceId ||
      recoveryReport.hostVersion !== failureReport.hostVersion ||
      recoveryReport.companionVersion !== failureReport.companionVersion ||
      recoveryReport.plan?.id !== proposal.plan.id ||
      recoveryReport.plan.revision !== proposal.plan.revision ||
      recoveryReport.planContentSha256 !== binding.planContentSha256 ||
      recoveryReport.executionId !== failureReport.executionId ||
      recoveryReport.phase !== terminalPhase ||
      recoveryReport.activeStepId !== binding.leafId ||
      !sameStepIds(recoveryReport.completedStepIds, terminalCompletedStepIds) ||
      recoveryReport.transition !== 'observation_recovered' ||
      recoveryReport.stepId !== binding.leafId ||
      recoveryReport.observationGate === undefined ||
      recoveryReport.observationGate === null ||
      recoveryReport.observationGate.status !== 'recovered' ||
      recoveryReport.observationGate.stepId !== binding.leafId ||
      recoveryReport.observationGate.failureStrategy !== failureStrategy ||
      recoveryReport.artifactAttestation !== null ||
      recoveryReport.nativeUndoCheckpoint === undefined ||
      recoveryReport.nativeUndoCheckpoint.operation !== 'recheck' ||
      recoveryReport.nativeUndoCheckpoint.previousCheckpointId !==
        failureCheckpoint?.checkpointId ||
      !sameStepIds(recoveryReport.nativeUndoCheckpoint.session.receiptStepIds, [
        ...authorizedStartCheckpoint.session.receiptStepIds,
        binding.leafId,
      ]) ||
      recoveryReport.error !== null ||
      Date.parse(recoveryReport.occurredAt) < Date.parse(failureReport.occurredAt)
    ) {
      throw new ProcedureLeafReplayError(
        'Recovery report does not prove the exact repaired replay execution',
        409,
      );
    }
    recoveredObservations = validateStrongProcedureLeafReplayObservation(binding, recoveryReport);
  }
  const finalReport = recoveryReport ?? failureReport;
  const finalReceipt = recoveryReportReceipt ?? failureReportReceipt;
  if (
    Date.parse(decision.occurredAt) > Date.parse(authorizedStartReport.occurredAt) ||
    Date.parse(authorizedStartReport.occurredAt) > Date.parse(failureReport.occurredAt) ||
    Date.parse(finalReport.occurredAt) > Date.parse(input.attestedAt) ||
    Date.parse(finalReceipt.receivedAt) > Date.parse(input.attestedAt)
  ) {
    throw new ProcedureLeafReplayError(
      'Failure/recovery attestation predates its companion evidence',
      409,
    );
  }
  const attestedDecision = {
    ...decision,
    adapterId: 'blender' as const,
    decision: 'accepted' as const,
  };
  const attestedFailureReport = {
    ...failureReport,
    protocolVersion: guideProtocolVersion,
    adapterId: 'blender' as const,
    plan: { id: proposal.plan.id, revision: proposal.plan.revision },
    planContentSha256: binding.planContentSha256,
    executionId: failureReport.executionId,
    phase: failureReport.phase as 'running' | 'blocked',
    completedStepIds: [...failureReport.completedStepIds],
    transition: 'step_observation_failed' as const,
    stepId: binding.leafId,
    observations: failureReport.observations.map((observation) =>
      procedureLeafReplayFailedObservationSchema.parse({
        kind: observation.kind,
        satisfied: false,
        details: structuredClone(observation.details),
      }),
    ),
    observationGate: {
      ...structuredClone(failureGate),
      status: failureGate.status as 'failed_rolled_back' | 'repair_required' | 'rollback_failed',
    },
    artifactAttestation: null,
    error: null,
  };
  const attestedRecoveryReport =
    recoveryReport === null || recoveredObservations === null
      ? null
      : {
          ...recoveryReport,
          protocolVersion: guideProtocolVersion,
          adapterId: 'blender' as const,
          plan: { id: proposal.plan.id, revision: proposal.plan.revision },
          planContentSha256: binding.planContentSha256,
          executionId: failureReport.executionId,
          phase: terminalPhase,
          activeStepId: binding.leafId,
          completedStepIds: [...recoveryReport.completedStepIds],
          transition: 'observation_recovered' as const,
          stepId: binding.leafId,
          observations: recoveredObservations,
          observationGate: {
            ...structuredClone(recoveryReport.observationGate!),
            status: 'recovered' as const,
          },
          artifactAttestation: null,
          nativeUndoCheckpoint: recoveryReport.nativeUndoCheckpoint!,
          error: null,
        };
  const content: Omit<ProcedureLeafReplayFailureRecoveryAttestation, 'integrity'> = {
    formatVersion: procedureLeafReplayFormatVersion,
    replayId: binding.replayId,
    attestationId: input.attestationId,
    decision: attestedDecision,
    authorization: {
      actionExecutionRequestId: input.actionExecutionRequestId,
      startState: {
        reportId: authorizedStartReport.reportId,
        sequence: authorizedStartReport.sequence,
        reportContentSha256: computeProtocolCanonicalJsonSha256(authorizedStartReport),
        checkpointId: authorizedStartCheckpoint.checkpointId,
        checkpointContentSha256: computeProtocolCanonicalJsonSha256(authorizedStartCheckpoint),
        phase: 'running',
        activeStepId: authorizedStartReport.activeStepId,
        checkpointOperation: authorizedStartCheckpoint.operation,
        completedStepIds: [...authorizedStartReport.completedStepIds],
        receiptStepIds: [...authorizedStartCheckpoint.session.receiptStepIds],
      },
    },
    failureReport: attestedFailureReport,
    recoveryReport: attestedRecoveryReport,
    evidenceClass: 'companion_reported_managed_action_failure_recovery',
    outcome: automaticRollback ? 'automatically_rolled_back' : 'recovered_after_repair',
    provenance: {
      authentication: 'negotiated_companion_lease',
      executionSessionFingerprintSha256: executionFingerprint,
      recoverySessionFingerprintSha256: recoveryFingerprint,
      proposalReceipt: {
        sequence: proposalReceipt.sequence,
        receivedAt: proposalReceipt.receivedAt,
      },
      decisionReceipt: {
        sequence: decisionReceipt.sequence,
        receivedAt: decisionReceipt.receivedAt,
      },
      startReportReceipt: {
        sequence: startReportReceipt.sequence,
        receivedAt: startReportReceipt.receivedAt,
      },
      failureReportReceipt: {
        sequence: failureReportReceipt.sequence,
        receivedAt: failureReportReceipt.receivedAt,
      },
      recoveryReportReceipt:
        recoveryReportReceipt === null
          ? null
          : {
              sequence: recoveryReportReceipt.sequence,
              receivedAt: recoveryReportReceipt.receivedAt,
            },
    },
    bindingContentSha256: binding.integrity.contentSha256,
    execution: {
      host: {
        adapterId: 'blender',
        instanceId: failureReport.instanceId,
        version: failureReport.hostVersion,
      },
      companion: { version: failureReport.companionVersion },
      plan: {
        id: failureReport.plan.id,
        revision: failureReport.plan.revision,
        contentSha256: failureReport.planContentSha256,
      },
      execution: { id: failureReport.executionId },
      step: { id: binding.leafId },
      action: { adapterId: 'blender', name: binding.actionName },
      occurredAt: failureReport.occurredAt,
    },
    verificationScope: {
      managedActionAttempt: 'observation_failed',
      rollbackOutcome:
        failureGate.status === 'failed_rolled_back'
          ? 'companion_reported_succeeded'
          : failureGate.status === 'rollback_failed'
            ? 'companion_reported_failed'
            : 'not_requested',
      recoveryOutcome: automaticRollback ? 'not_required' : 'companion_reported_verified',
      menuTrack: binding.claims.menuTrack,
      shortcutTrack: binding.claims.shortcutTrack,
      mcpTrack: binding.claims.mcpTrack,
      failureNativeUndoCheckpoint:
        failureCheckpoint === undefined
          ? 'not_verified_at_failure_report'
          : 'companion_reported_current_at_failure_report',
      terminalNativeUndoCheckpoint: automaticRollback
        ? 'not_applicable_no_retained_step'
        : 'companion_reported_current_at_recovery_report',
      currentHostStateAfterReport: 'not_verified',
    },
    attestedAt: input.attestedAt,
  };
  return procedureLeafReplayFailureRecoveryAttestationSchema.parse({
    ...content,
    integrity: {
      algorithm: 'sha256',
      canonicalization: protocolJsonValueCanonicalization,
      contentSha256: computeProcedureLeafReplayFailureRecoveryAttestationContentSha256(content),
    },
  });
}

export function buildProcedureLeafReplayCurrentStateRequest(input: {
  readonly attestation:
    ProcedureLeafReplayAttestation | ProcedureLeafReplayFailureRecoveryAttestation;
  readonly verificationId: string;
  readonly requestedAt: string;
}): CompanionProcedureReplayCurrentStateRequest {
  const { attestation } = input;
  const directSuccess = 'successGate' in attestation;
  const observations = directSuccess
    ? attestation.successGate.observations
    : attestation.recoveryReport?.observations;
  const observation = observations?.[0];
  const terminalReport = directSuccess ? attestation.report : attestation.recoveryReport;
  const terminalCheckpoint = terminalReport?.nativeUndoCheckpoint;
  const checkpointBacked = directSuccess
    ? attestation.verificationScope.nativeUndoCheckpoint === 'companion_reported_current_at_report'
    : attestation.outcome === 'recovered_after_repair' &&
      attestation.recoveryReport !== null &&
      attestation.verificationScope.terminalNativeUndoCheckpoint ===
        'companion_reported_current_at_recovery_report';
  if (
    !checkpointBacked ||
    attestation.verificationScope.currentHostStateAfterReport !== 'not_verified' ||
    observations === undefined ||
    observation === undefined ||
    terminalReport === null ||
    terminalCheckpoint === undefined ||
    (terminalCheckpoint.operation !== 'next' && terminalCheckpoint.operation !== 'recheck')
  ) {
    throw new ProcedureLeafReplayError(
      'Current-state verification requires a checkpoint-backed replay attestation',
      409,
    );
  }
  return {
    formatVersion: procedureLeafReplayFormatVersion,
    verificationId: input.verificationId,
    replayId: attestation.replayId,
    attestationId: attestation.attestationId,
    attestationContentSha256: attestation.integrity.contentSha256,
    target: {
      adapterId: 'blender',
      instanceId: attestation.execution.host.instanceId,
    },
    plan: {
      id: attestation.execution.plan.id,
      revision: attestation.execution.plan.revision,
    },
    planContentSha256: attestation.execution.plan.contentSha256,
    executionId: attestation.execution.execution.id,
    stepId: attestation.execution.step.id,
    expectedPhase: terminalReport.phase,
    expectedCompletedStepIds: [...terminalReport.completedStepIds],
    expectedReceiptStepIds: [...terminalCheckpoint.session.receiptStepIds],
    expectedCheckpoint: {
      checkpointId: terminalCheckpoint.checkpointId,
      operation: terminalCheckpoint.operation,
      contentSha256: computeProtocolCanonicalJsonSha256(terminalCheckpoint),
    },
    expectedObservation: {
      kind: observation.kind,
      contentSha256:
        observations.length === 1
          ? computeProcedureLeafReplayObservationContentSha256(observation)
          : computeProtocolCanonicalJsonSha256(observations),
    },
    requestedAt: input.requestedAt,
  };
}

export function buildProcedureLeafReplayCurrentStateVerification(input: {
  readonly attestation:
    ProcedureLeafReplayAttestation | ProcedureLeafReplayFailureRecoveryAttestation;
  readonly request: CompanionProcedureReplayCurrentStateRequest;
  readonly report: CompanionStateReport;
  readonly reportReceipt: StoredManagedReplayReceipt;
  readonly recordedAt: string;
}): ProcedureLeafReplayCurrentStateVerification {
  const { attestation, request, report, reportReceipt } = input;
  const baselineObservations =
    'successGate' in attestation
      ? attestation.successGate.observations
      : attestation.recoveryReport?.observations;
  const expectedRequest = buildProcedureLeafReplayCurrentStateRequest({
    attestation,
    verificationId: request.verificationId,
    requestedAt: request.requestedAt,
  });
  if (!sameCanonicalValue(request, expectedRequest)) {
    throw new ProcedureLeafReplayError(
      'Current-state request does not match its replay attestation',
      409,
    );
  }
  if (
    report.protocolVersion !== guideProtocolVersion ||
    report.transition !== 'current_state_rechecked' ||
    report.procedureReplayCurrentStateRequest === undefined ||
    !sameCanonicalValue(report.procedureReplayCurrentStateRequest, request) ||
    report.adapterId !== request.target.adapterId ||
    report.instanceId !== request.target.instanceId ||
    reportReceipt.subjectType !== 'companion_state_report' ||
    reportReceipt.subjectId !== report.reportId ||
    reportReceipt.authentication !== 'negotiated_companion_lease' ||
    reportReceipt.adapterId !== request.target.adapterId ||
    reportReceipt.instanceId !== request.target.instanceId ||
    reportReceipt.sessionFingerprintSha256 === null ||
    Date.parse(reportReceipt.receivedAt) < Date.parse(request.requestedAt) ||
    Date.parse(input.recordedAt) < Date.parse(reportReceipt.receivedAt)
  ) {
    throw new ProcedureLeafReplayError(
      'Current-state report lacks the exact authenticated verification request chain',
      409,
    );
  }

  const sessionMatches =
    report.plan?.id === request.plan.id &&
    report.plan?.revision === request.plan.revision &&
    report.planContentSha256 === request.planContentSha256 &&
    report.executionId === request.executionId;
  const stepMatches =
    report.phase === request.expectedPhase &&
    report.activeStepId === request.stepId &&
    report.stepId === request.stepId &&
    sameStepIds(report.completedStepIds, request.expectedCompletedStepIds) &&
    report.observationGate === null &&
    report.artifactAttestation === null &&
    report.error === null;
  const observation = report.observations[0];
  const observationContent = report.observations.length === 1 ? observation : report.observations;
  const observationMatches =
    report.observations.length >= 1 &&
    report.observations.length <= 8 &&
    report.observations.every(
      (candidate) =>
        candidate.kind === request.expectedObservation.kind && candidate.satisfied === true,
    ) &&
    baselineObservations !== undefined &&
    sameCanonicalValue(report.observations, baselineObservations) &&
    observationContent !== undefined &&
    (report.observations.length === 1
      ? computeProcedureLeafReplayObservationContentSha256(
          procedureLeafReplayObservationSchema.parse(observation),
        )
      : computeProtocolCanonicalJsonSha256(observationContent)) ===
      request.expectedObservation.contentSha256;
  const checkpoint = report.nativeUndoCheckpoint;
  const checkpointMatches =
    checkpoint !== undefined &&
    checkpoint.checkpointId === request.expectedCheckpoint.checkpointId &&
    checkpoint.operation === request.expectedCheckpoint.operation &&
    computeProtocolCanonicalJsonSha256(checkpoint) === request.expectedCheckpoint.contentSha256 &&
    checkpoint.session.plan.id === request.plan.id &&
    checkpoint.session.plan.revision === request.plan.revision &&
    checkpoint.session.planContentSha256 === request.planContentSha256 &&
    checkpoint.session.executionId === request.executionId &&
    checkpoint.session.activeStepId === request.stepId &&
    sameStepIds(checkpoint.session.completedStepIds, request.expectedCompletedStepIds) &&
    sameStepIds(checkpoint.session.receiptStepIds, request.expectedReceiptStepIds);
  const reason = !sessionMatches
    ? 'session_identity_mismatch'
    : !stepMatches
      ? 'step_state_mismatch'
      : !observationMatches
        ? 'observation_mismatch'
        : !checkpointMatches
          ? 'native_undo_checkpoint_mismatch'
          : 'verified';
  const verified = reason === 'verified';
  const content: Omit<ProcedureLeafReplayCurrentStateVerification, 'integrity'> = {
    formatVersion: procedureLeafReplayFormatVersion,
    verificationId: request.verificationId,
    replayId: request.replayId,
    attestationId: request.attestationId,
    attestationContentSha256: request.attestationContentSha256,
    evidenceClass: 'companion_reported_managed_action_current_state',
    request,
    report: {
      ...report,
      protocolVersion: guideProtocolVersion,
      adapterId: 'blender',
      transition: 'current_state_rechecked',
      procedureReplayCurrentStateRequest: request,
      artifactAttestation: null,
    },
    outcome: verified ? 'verified' : 'not_verified',
    reason,
    provenance: {
      authentication: 'negotiated_companion_lease',
      sessionFingerprintSha256: reportReceipt.sessionFingerprintSha256,
      reportReceipt: {
        sequence: reportReceipt.sequence,
        receivedAt: reportReceipt.receivedAt,
      },
    },
    verificationScope: {
      managedActionCurrentState: verified ? 'verified_at_report' : 'not_verified_at_report',
      nativeUndoCheckpoint: checkpointMatches
        ? 'companion_reported_current_at_report'
        : 'not_verified_at_report',
      currentHostStateAfterReport: 'not_verified',
    },
    recordedAt: input.recordedAt,
  };
  return procedureLeafReplayCurrentStateVerificationSchema.parse({
    ...content,
    integrity: {
      algorithm: 'sha256',
      canonicalization: protocolJsonValueCanonicalization,
      contentSha256: computeProcedureLeafReplayCurrentStateVerificationContentSha256(content),
    },
  });
}
