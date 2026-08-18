import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  blenderActionCatalog,
  blenderInteractionCatalog,
} from '@operatingline/blender-action-catalog';
import {
  compileProcedureTreeToGuidePlan,
  computeProcedureLeafReplayAttestationContentSha256,
  computeProcedureLeafReplayBindingContentSha256,
  computeProcedureLeafReplayCurrentStateVerificationContentSha256,
  computeProcedureLeafReplayFailureRecoveryAttestationContentSha256,
  computeProcedureLeafReplayObservationContentSha256,
  procedureAuthoringCandidateTreeSchema,
  procedureLeafReplayAttestationSchema,
  procedureLeafReplayBindingSchema,
  procedureLeafReplayCurrentStateRequestSchema,
  procedureLeafReplayCurrentStateRequestResultSchema,
  procedureLeafReplayCurrentStateStatusRequestSchema,
  procedureLeafReplayCurrentStateStatusResultSchema,
  procedureLeafReplayCurrentStateVerificationSchema,
  procedureLeafReplayFailureRecoveryAttestationSchema,
  procedureLeafReplayFailureRecoveryFinalizeRequestSchema,
  procedureLeafReplayFailureRecoveryFinalizeResultSchema,
  procedureLeafReplayFinalizeRequestSchema,
  procedureLeafReplayFinalizeResultSchema,
  procedureLeafReplayProposalRequestSchema,
  procedureLeafReplayProposalResultSchema,
  type ProcedureAuthoringCandidateTree,
} from '@operatingline/protocol';

import { materializeProcedureAuthoringCandidate } from '../../services/orchestrator/src/procedure-authoring-materialization.js';
import { validatePublicJsonSchemaCases } from '../../services/orchestrator/test-support/public-json-schema-validator.js';

function publicSchema(filename: string): object {
  return JSON.parse(readFileSync(resolve('protocol/schemas/v1', filename), 'utf8')) as object;
}

function withoutKey<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key)) as Omit<T, K>;
}

function candidate(): ProcedureAuthoringCandidateTree {
  const tree = JSON.parse(
    readFileSync(resolve('protocol/fixtures/v1/snowman-eye.procedure.json'), 'utf8'),
  ) as Record<string, unknown>;
  tree['actionCatalogVersion'] = blenderActionCatalog.catalogVersion;
  tree['interactionCatalogVersion'] = blenderInteractionCatalog.catalogVersion;
  tree['hostVersionRange'] = blenderInteractionCatalog.hostVersionRange;
  for (const node of tree['nodes'] as Array<Record<string, unknown>>) {
    if (node['kind'] !== 'leaf') continue;
    const leafId = String(node['id']);
    for (const modality of ['menu', 'shortcut', 'mcp'] as const) {
      node[`${modality}Tracks`] = [
        {
          id: `${leafId}.${modality}.candidate`,
          availability: 'unavailable',
          title: `${modality} candidate`,
          reason: 'Awaiting deterministic materialization.',
          modality,
        },
      ];
    }
    (node['validation'] as Record<string, unknown>)['status'] = 'candidate';
    (node['validation'] as Record<string, unknown>)['validatedHostVersions'] = [];
  }
  return procedureAuthoringCandidateTreeSchema.parse(tree);
}

const replayId = '11111111-1111-4111-8111-111111111111';
const instanceId = '22222222-2222-4222-8222-222222222222';
const proposalId = '33333333-3333-4333-8333-333333333333';
const decisionId = '44444444-4444-4444-8444-444444444444';
const executionId = '55555555-5555-4555-8555-555555555555';
const reportId = '66666666-6666-4666-8666-666666666666';
const attestationId = '77777777-7777-4777-8777-777777777777';
const occurredAt = '2026-08-17T10:00:00+08:00';

function fixtures() {
  const tree = candidate();
  const leaf = tree.nodes.find((node) => node.kind === 'leaf');
  if (leaf?.kind !== 'leaf' || leaf.action === null) throw new Error('Expected managed leaf');
  const promptActionCatalog = withoutKey(blenderActionCatalog, 'adapterId');
  const promptInteractionCatalog = withoutKey(
    withoutKey(blenderInteractionCatalog, 'adapterId'),
    'actionCatalogVersion',
  );
  const source = tree.sources[0]!;
  const evidence = tree.evidence[0]!;
  const packet = {
    formatVersion: '1.0.0',
    context: {
      requestedTreeId: tree.id,
      recommendedRevision: tree.revision,
      goalProvenance: {
        source,
        evidence: {
          id: evidence.id,
          locator: evidence.locator,
          description: evidence.description,
          confidence: evidence.confidence,
        },
      },
      catalogBinding: {
        adapterId: tree.adapterId,
        actionCatalog: promptActionCatalog,
        interactionCatalog: promptInteractionCatalog,
      },
      constraints: {
        allGeneratedLeavesCandidate: true,
        validatedHostVersionsEmpty: true,
        exactParametersRemainOnSemanticOperations: true,
        allInteractionTracksUnavailable: true,
        persistenceRequiresExplicitStore: true,
      },
    },
    retrieval: {
      toolName: 'operatingline.procedure.search',
      matching: 'exact_structured_filters',
      similarityScoreProduced: false,
    },
    responseContract: { mediaType: 'application/json', schema: {} },
    workflow: {
      validationToolName: 'operatingline.procedure.authoring.validate',
      compileToolName: 'operatingline.procedure.compile',
      instructions: ['Return one candidate ProcedureTree JSON object.'],
    },
    limits: { maxCanonicalBytes: 262_144 },
    sideEffects: {
      modelCalled: false,
      procedureStored: false,
      proposalCreated: false,
      hostExecutionStarted: false,
    },
    integrity: {
      algorithm: 'sha256',
      canonicalization: 'operatingline-json-value-v1',
      contentSha256: 'a'.repeat(64),
    },
  } as const;
  const request = {
    formatVersion: '1.0.0',
    replayId,
    targetInstanceId: instanceId,
    leafId: leaf.id,
    replayMode: 'managed_action',
    packet,
    tree,
  } as const;
  const materialized = materializeProcedureAuthoringCandidate(
    tree,
    blenderActionCatalog,
    blenderInteractionCatalog,
  );
  const materializedResult = withoutKey(materialized, 'interactionCatalogContentSha256');
  const plan = compileProcedureTreeToGuidePlan(materialized.tree);
  const materialization = {
    ...materializedResult,
    packetContentSha256: packet.integrity.contentSha256,
    catalogBinding: {
      adapterId: tree.adapterId,
      actionCatalogVersion: blenderActionCatalog.catalogVersion,
      interactionCatalogVersion: blenderInteractionCatalog.catalogVersion,
      interactionCatalogContentSha256: 'b'.repeat(64),
    },
    validation: {
      packetIntegrity: 'validated',
      installedCatalogBinding: 'validated',
      authoringCandidateContract: 'validated',
      procedureCompilation: 'validated',
      interactionGrounding: 'validated_against_installed_interaction_catalog',
    },
    compilation: {
      formatVersion: materialized.tree.formatVersion,
      procedureTreeId: materialized.tree.id,
      procedureTreeRevision: materialized.tree.revision,
      adapterId: materialized.tree.adapterId,
      actionCatalogVersion: materialized.tree.actionCatalogVersion,
      interactionCatalogVersion: materialized.tree.interactionCatalogVersion,
      validation: {
        procedureStructure: 'validated',
        actionCatalogBinding: 'validated',
        hostVersionRange: 'validated_against_action_catalog',
        interactionTracks: 'structural_only',
      },
      plan,
      proposalCreated: false,
      hostExecutionStarted: false,
    },
    procedureStored: false,
    proposalCreated: false,
    hostExecutionStarted: false,
  } as const;
  const proposal = {
    protocolVersion: '1.5.0',
    proposalId,
    targetAdapterId: tree.adapterId,
    targetInstanceId: instanceId,
    plan,
    planDiff: null,
    catalogVersion: blenderActionCatalog.catalogVersion,
    proposedAt: occurredAt,
  } as const;
  return { tree, leaf, request, materialization, proposal, plan };
}

describe('public single-leaf procedure replay JSON Schemas', () => {
  it('keeps proposal requests managed-action-only and embeds packet plus candidate tree', async () => {
    const { request } = fixtures();
    const cases = [
      { value: request, accepted: true },
      { value: { ...request, replayMode: 'menu' }, accepted: false },
      { value: { ...request, packet: undefined }, accepted: false },
      { value: { ...request, extra: true }, accepted: false },
    ] as const;
    for (const contractCase of cases) {
      const parsed = procedureLeafReplayProposalRequestSchema.safeParse(contractCase.value);
      expect(parsed.success, parsed.success ? undefined : JSON.stringify(parsed.error.issues)).toBe(
        contractCase.accepted,
      );
    }
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-leaf-replay-proposal-request.schema.json'),
      cases,
    );
  });

  it('binds materialization, proposal, pending claims, and canonical integrity', async () => {
    const { request, materialization, proposal, leaf, plan } = fixtures();
    const { createHash } = await import('node:crypto');
    const { canonicalizeProtocolJsonValue } = await import('@operatingline/protocol');
    const planContentSha256 = createHash('sha256')
      .update(canonicalizeProtocolJsonValue(plan))
      .digest('hex');
    const content = {
      formatVersion: '1.0.0',
      replayId,
      targetInstanceId: instanceId,
      leafId: leaf.id,
      replayMode: 'managed_action',
      request,
      materialization,
      proposal,
      planContentSha256,
      recipeId: materialization.coverage[0]!.recipeId,
      actionName: leaf.action!.name,
      claims: {
        materialization: 'catalog_grounded',
        approval: 'pending',
        hostExecutionStarted: false,
        managedActionResult: 'pending',
        menuTrack: 'catalog_grounded_not_executed',
        shortcutTrack: 'candidate_not_executed',
        mcpTrack: 'unavailable',
      },
      createdAt: occurredAt,
    } as const;
    const binding = {
      ...content,
      integrity: {
        algorithm: 'sha256',
        canonicalization: 'operatingline-json-value-v1',
        contentSha256: computeProcedureLeafReplayBindingContentSha256(content),
      },
    } as const;
    expect(binding.integrity.contentSha256).toBe(
      createHash('sha256').update(canonicalizeProtocolJsonValue(content)).digest('hex'),
    );
    const parsedBinding = procedureLeafReplayBindingSchema.safeParse(binding);
    expect(
      parsedBinding.success,
      parsedBinding.success ? undefined : JSON.stringify(parsedBinding.error.issues),
    ).toBe(true);
    expect(
      procedureLeafReplayBindingSchema.safeParse({
        ...binding,
        claims: { ...binding.claims, menuTrack: 'verified' },
      }).success,
    ).toBe(false);
    const mismatchedShortcutContent = {
      ...content,
      claims: { ...content.claims, shortcutTrack: 'unavailable' as const },
    };
    expect(
      procedureLeafReplayBindingSchema.safeParse({
        ...mismatchedShortcutContent,
        integrity: {
          algorithm: 'sha256',
          canonicalization: 'operatingline-json-value-v1',
          contentSha256: computeProcedureLeafReplayBindingContentSha256(mismatchedShortcutContent),
        },
      }).success,
    ).toBe(false);
    expect(
      procedureLeafReplayBindingSchema.safeParse({
        ...binding,
        integrity: { ...binding.integrity, contentSha256: 'f'.repeat(64) },
      }).success,
    ).toBe(false);

    const resultCases = [
      { value: { status: 'accepted', binding }, accepted: true },
      { value: { status: 'duplicate', binding }, accepted: true },
      { value: { status: 'executed', binding }, accepted: false },
    ] as const;
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-leaf-replay-proposal-result.schema.json'),
      resultCases,
    );
    for (const contractCase of resultCases) {
      expect(procedureLeafReplayProposalResultSchema.safeParse(contractCase.value).success).toBe(
        contractCase.accepted,
      );
    }
    await validatePublicJsonSchemaCases(publicSchema('procedure-leaf-replay-binding.schema.json'), [
      { value: binding, accepted: true },
      {
        value: {
          ...binding,
          claims: { ...binding.claims, shortcutTrack: 'verified' },
        },
        accepted: false,
      },
    ]);
  });

  it('accepts only terminal successful managed-action attestations', async () => {
    const { request, materialization, proposal, leaf, plan } = fixtures();
    const { createHash } = await import('node:crypto');
    const { canonicalizeProtocolJsonValue } = await import('@operatingline/protocol');
    const planContentSha256 = createHash('sha256')
      .update(canonicalizeProtocolJsonValue(plan))
      .digest('hex');
    const bindingContent = {
      formatVersion: '1.0.0',
      replayId,
      targetInstanceId: instanceId,
      leafId: leaf.id,
      replayMode: 'managed_action',
      request,
      materialization,
      proposal,
      planContentSha256,
      recipeId: materialization.coverage[0]!.recipeId,
      actionName: leaf.action!.name,
      claims: {
        materialization: 'catalog_grounded',
        approval: 'pending',
        hostExecutionStarted: false,
        managedActionResult: 'pending',
        menuTrack: 'catalog_grounded_not_executed',
        shortcutTrack: 'candidate_not_executed',
        mcpTrack: 'unavailable',
      },
      createdAt: occurredAt,
    } as const;
    const bindingContentSha256 = computeProcedureLeafReplayBindingContentSha256(bindingContent);
    const resourceId = leaf.action!.arguments['resourceId'];
    const objectName = leaf.action!.arguments['objectName'];
    if (typeof resourceId !== 'string' || typeof objectName !== 'string') {
      throw new Error('Expected UV Sphere replay identifiers');
    }
    const observations = [
      {
        kind: 'uv_sphere_ready',
        satisfied: true,
        details: {
          parameters: {
            resourceId,
            objectName,
            radius: leaf.action!.arguments['radius'],
            location: leaf.action!.arguments['location'],
          },
          supported: true,
          resourceId,
          objectName,
          meshId: `${resourceId}.mesh`,
          collectionId: 'snowman.collection',
          parametersValid: true,
          objectOwned: true,
          meshOwned: true,
          collectionOwned: true,
          receiptMatches: true,
          objectDataMatches: true,
          collectionLinkMatches: true,
          nameMatches: true,
          locationMatches: true,
          rotationMatches: true,
          scaleMatches: true,
          transformIsolated: true,
          modifiersAbsent: true,
          shapeKeysAbsent: true,
          materialsAbsent: true,
          contentIntact: true,
          topologyMatches: true,
          finiteCoordinates: true,
          radiusMatches: true,
          vertexCount: 482,
          edgeCount: 992,
          faceCount: 512,
          meshContentSha256: '9'.repeat(64),
        },
      },
    ] as const;
    const report = {
      protocolVersion: '1.5.0',
      reportId,
      sequence: 1,
      adapterId: 'blender',
      instanceId,
      companionVersion: '0.1.0',
      hostVersion: '4.5.3',
      plan: { id: plan.id, revision: plan.revision },
      planContentSha256,
      executionId,
      phase: 'completed',
      activeStepId: leaf.id,
      completedStepIds: [leaf.id],
      transition: 'step_succeeded',
      stepId: leaf.id,
      observations,
      observationGate: null,
      artifactAttestation: null,
      error: null,
      occurredAt,
    } as const;
    const content = {
      formatVersion: '1.0.0',
      replayId,
      attestationId,
      decision: {
        protocolVersion: '1.5.0',
        decisionId,
        proposalId,
        adapterId: 'blender',
        instanceId,
        decision: 'accepted',
        occurredAt,
      },
      report,
      evidenceClass: 'companion_reported_managed_action_leaf_replay',
      provenance: {
        authentication: 'negotiated_companion_lease',
        sessionFingerprintSha256: '8'.repeat(64),
        proposalReceipt: { sequence: 1, receivedAt: occurredAt },
        decisionReceipt: { sequence: 2, receivedAt: occurredAt },
        reportReceipt: { sequence: 3, receivedAt: occurredAt },
      },
      bindingContentSha256,
      execution: {
        host: { adapterId: 'blender', instanceId, version: '4.5.3' },
        companion: { version: '0.1.0' },
        plan: { id: plan.id, revision: plan.revision, contentSha256: planContentSha256 },
        execution: { id: executionId },
        step: { id: leaf.id },
        action: { adapterId: 'blender', name: leaf.action!.name },
        occurredAt,
      },
      successGate: { observations, allSatisfied: true },
      verificationScope: {
        managedActionResult: 'verified',
        menuTrack: 'catalog_grounded_not_executed',
        shortcutTrack: 'candidate_not_executed',
        mcpTrack: 'unavailable',
      },
      attestedAt: occurredAt,
    } as const;
    const attest = <T extends Record<string, unknown>>(candidate: T) =>
      ({
        ...candidate,
        integrity: {
          algorithm: 'sha256',
          canonicalization: 'operatingline-json-value-v1',
          contentSha256: computeProcedureLeafReplayAttestationContentSha256(
            candidate as Parameters<typeof computeProcedureLeafReplayAttestationContentSha256>[0],
          ),
        },
      }) as const;
    const attestation = attest(content);
    expect(attestation.integrity.contentSha256).toBe(
      createHash('sha256').update(canonicalizeProtocolJsonValue(content)).digest('hex'),
    );
    expect(procedureLeafReplayAttestationSchema.safeParse(attestation).success).toBe(true);

    const nativeUndoCheckpoint = {
      formatVersion: '1.0.0',
      evidenceClass: 'companion_reported_native_undo_checkpoint',
      checkpointId: 'b217922f-f130-4689-bc9a-b6ac4d00d3ae',
      previousCheckpointId: '2e20d994-06b8-43e1-8aa0-b46173b87f26',
      operation: 'next',
      committedAt: occurredAt,
      marker: {
        key: '_operating_line_native_history_v1',
        matched: true,
      },
      journal: {
        entryPresent: true,
        snapshotMatchesSession: true,
        artifactsBackedUp: true,
      },
      session: {
        plan: { id: plan.id, revision: plan.revision },
        planContentSha256,
        executionId,
        activeStepId: leaf.id,
        completedStepIds: [leaf.id],
        receiptStepIds: [leaf.id],
      },
    } as const;
    const checkpointContent = {
      ...content,
      report: { ...content.report, nativeUndoCheckpoint },
      verificationScope: {
        ...content.verificationScope,
        nativeUndoCheckpoint: 'companion_reported_current_at_report',
        currentHostStateAfterReport: 'not_verified',
      },
    } as const;
    const checkpointAttestation = attest(checkpointContent);
    expect(procedureLeafReplayAttestationSchema.safeParse(checkpointAttestation).success).toBe(
      true,
    );
    expect(
      procedureLeafReplayAttestationSchema.safeParse(
        attest({ ...checkpointContent, verificationScope: content.verificationScope }),
      ).success,
    ).toBe(false);

    const verificationId = 'bd5de2ab-2de5-4e7d-8a24-83d30a349ce9';
    const currentStateRequest = {
      formatVersion: '1.0.0',
      verificationId,
      replayId,
      attestationId,
      attestationContentSha256: checkpointAttestation.integrity.contentSha256,
      target: { adapterId: 'blender', instanceId },
      plan: { id: plan.id, revision: plan.revision },
      planContentSha256,
      executionId,
      stepId: leaf.id,
      expectedObservation: {
        kind: observations[0].kind,
        contentSha256: computeProcedureLeafReplayObservationContentSha256(observations[0]),
      },
      requestedAt: occurredAt,
    } as const;
    const currentStateReport = {
      ...checkpointContent.report,
      reportId: 'd932d853-158f-4407-b7f4-9fe21ce249dd',
      transition: 'current_state_rechecked',
      procedureReplayCurrentStateRequest: currentStateRequest,
    } as const;
    const currentStateContent = {
      formatVersion: '1.0.0',
      verificationId,
      replayId,
      attestationId,
      attestationContentSha256: checkpointAttestation.integrity.contentSha256,
      evidenceClass: 'companion_reported_managed_action_current_state',
      request: currentStateRequest,
      report: currentStateReport,
      outcome: 'verified',
      reason: 'verified',
      provenance: {
        authentication: 'negotiated_companion_lease',
        sessionFingerprintSha256: '9'.repeat(64),
        reportReceipt: { sequence: 4, receivedAt: occurredAt },
      },
      verificationScope: {
        managedActionCurrentState: 'verified_at_report',
        nativeUndoCheckpoint: 'companion_reported_current_at_report',
        currentHostStateAfterReport: 'not_verified',
      },
      recordedAt: occurredAt,
    } as const;
    const currentStateVerification = {
      ...currentStateContent,
      integrity: {
        algorithm: 'sha256',
        canonicalization: 'operatingline-json-value-v1',
        contentSha256:
          computeProcedureLeafReplayCurrentStateVerificationContentSha256(currentStateContent),
      },
    } as const;
    expect(
      procedureLeafReplayCurrentStateRequestSchema.safeParse({ replayId, verificationId }).success,
    ).toBe(true);
    expect(
      procedureLeafReplayCurrentStateRequestResultSchema.safeParse({
        status: 'accepted',
        request: currentStateRequest,
      }).success,
    ).toBe(true);
    expect(
      procedureLeafReplayCurrentStateStatusRequestSchema.safeParse({ verificationId }).success,
    ).toBe(true);
    expect(
      procedureLeafReplayCurrentStateVerificationSchema.safeParse(currentStateVerification).success,
    ).toBe(true);
    expect(
      procedureLeafReplayCurrentStateStatusResultSchema.safeParse({
        status: 'pending',
        request: currentStateRequest,
      }).success,
    ).toBe(true);
    expect(
      procedureLeafReplayCurrentStateStatusResultSchema.safeParse({
        status: 'completed',
        verification: currentStateVerification,
      }).success,
    ).toBe(true);
    expect(
      procedureLeafReplayCurrentStateVerificationSchema.safeParse({
        ...currentStateVerification,
        outcome: 'not_verified',
      }).success,
    ).toBe(false);

    const failedObservationReport = {
      ...currentStateReport,
      observations: [
        {
          ...currentStateReport.observations[0],
          satisfied: false,
          details: {
            ...currentStateReport.observations[0].details,
            contentIntact: false,
          },
        },
      ],
    } as const;
    const failedCurrentStateContent = {
      ...currentStateContent,
      report: failedObservationReport,
      outcome: 'not_verified',
      reason: 'observation_mismatch',
      verificationScope: {
        ...currentStateContent.verificationScope,
        managedActionCurrentState: 'not_verified_at_report',
      },
    } as const;
    expect(
      procedureLeafReplayCurrentStateVerificationSchema.safeParse({
        ...failedCurrentStateContent,
        integrity: {
          algorithm: 'sha256',
          canonicalization: 'operatingline-json-value-v1',
          contentSha256:
            computeProcedureLeafReplayCurrentStateVerificationContentSha256(
              failedCurrentStateContent,
            ),
        },
      }).success,
    ).toBe(true);

    const retainedFailureCheckpoint = {
      ...nativeUndoCheckpoint,
      operation: 'next',
      session: {
        ...nativeUndoCheckpoint.session,
        completedStepIds: [],
        receiptStepIds: [leaf.id],
      },
    } as const;
    const retainedFailureReport = {
      ...checkpointContent.report,
      reportId: 'a1af3ca0-31dd-464c-919e-1364d03c880d',
      phase: 'blocked',
      completedStepIds: [],
      transition: 'step_observation_failed',
      observations: [
        {
          ...observations[0],
          satisfied: false,
          details: {
            parameters: observations[0].details.parameters,
            supported: true,
            contentIntact: false,
          },
        },
      ],
      observationGate: {
        stepId: leaf.id,
        status: 'repair_required',
        failureStrategy: 'retain_for_repair',
        message: 'Repair the retained managed step.',
      },
      nativeUndoCheckpoint: retainedFailureCheckpoint,
    } as const;
    const recoveredCheckpoint = {
      ...nativeUndoCheckpoint,
      checkpointId: '21fa8537-5482-423e-b940-3fb087244141',
      operation: 'recheck',
    } as const;
    const recoveryReport = {
      ...checkpointContent.report,
      reportId: '5f42c16a-644e-4ec6-af8b-97065ac55ae0',
      transition: 'observation_recovered',
      observationGate: {
        stepId: leaf.id,
        status: 'recovered',
        failureStrategy: 'retain_for_repair',
        message: 'The repaired managed step passed its Observation.',
      },
      nativeUndoCheckpoint: recoveredCheckpoint,
    } as const;
    const failureRecoveryContent = {
      formatVersion: '1.0.0',
      replayId,
      attestationId: 'c25e7e52-c4f0-413b-b03e-253177be6e04',
      decision: content.decision,
      failureReport: retainedFailureReport,
      recoveryReport,
      evidenceClass: 'companion_reported_managed_action_failure_recovery',
      outcome: 'recovered_after_repair',
      provenance: {
        authentication: 'negotiated_companion_lease',
        executionSessionFingerprintSha256: '9'.repeat(64),
        recoverySessionFingerprintSha256: '8'.repeat(64),
        proposalReceipt: { sequence: 1, receivedAt: occurredAt },
        decisionReceipt: { sequence: 2, receivedAt: occurredAt },
        failureReportReceipt: { sequence: 3, receivedAt: occurredAt },
        recoveryReportReceipt: { sequence: 4, receivedAt: occurredAt },
      },
      bindingContentSha256: content.bindingContentSha256,
      execution: content.execution,
      verificationScope: {
        managedActionAttempt: 'observation_failed',
        rollbackOutcome: 'not_requested',
        recoveryOutcome: 'companion_reported_verified',
        menuTrack: 'catalog_grounded_not_executed',
        shortcutTrack: 'candidate_not_executed',
        mcpTrack: 'unavailable',
        failureNativeUndoCheckpoint: 'companion_reported_current_at_failure_report',
        terminalNativeUndoCheckpoint: 'companion_reported_current_at_recovery_report',
        currentHostStateAfterReport: 'not_verified',
      },
      attestedAt: occurredAt,
    } as const;
    const failureRecoveryAttestation = {
      ...failureRecoveryContent,
      integrity: {
        algorithm: 'sha256',
        canonicalization: 'operatingline-json-value-v1',
        contentSha256:
          computeProcedureLeafReplayFailureRecoveryAttestationContentSha256(failureRecoveryContent),
      },
    } as const;
    expect(
      procedureLeafReplayFailureRecoveryFinalizeRequestSchema.safeParse({
        replayId,
        attestationId: failureRecoveryContent.attestationId,
        failureReportId: retainedFailureReport.reportId,
        recoveryReportId: recoveryReport.reportId,
      }).success,
    ).toBe(true);
    const parsedFailureRecovery = procedureLeafReplayFailureRecoveryAttestationSchema.safeParse(
      failureRecoveryAttestation,
    );
    expect(parsedFailureRecovery.success, parsedFailureRecovery.error?.message).toBe(true);
    expect(
      procedureLeafReplayFailureRecoveryFinalizeResultSchema.safeParse({
        status: 'accepted',
        attestation: failureRecoveryAttestation,
      }).success,
    ).toBe(true);
    expect(
      procedureLeafReplayFailureRecoveryAttestationSchema.safeParse({
        ...failureRecoveryAttestation,
        recoveryReport: null,
      }).success,
    ).toBe(false);
    const retainedWithoutCheckpointContent = {
      ...failureRecoveryContent,
      failureReport: withoutKey(retainedFailureReport, 'nativeUndoCheckpoint'),
      verificationScope: {
        ...failureRecoveryContent.verificationScope,
        failureNativeUndoCheckpoint: 'not_verified_at_failure_report',
      },
    } as const;
    expect(
      procedureLeafReplayFailureRecoveryAttestationSchema.safeParse({
        ...retainedWithoutCheckpointContent,
        integrity: {
          algorithm: 'sha256',
          canonicalization: 'operatingline-json-value-v1',
          contentSha256: computeProcedureLeafReplayFailureRecoveryAttestationContentSha256(
            retainedWithoutCheckpointContent,
          ),
        },
      }).success,
    ).toBe(false);

    const rolledBackFailureReport = {
      ...withoutKey(retainedFailureReport, 'nativeUndoCheckpoint'),
      reportId: '79fa8fd5-a4fe-4f6d-8f4a-92406a835940',
      phase: 'running',
      activeStepId: null,
      observationGate: {
        ...retainedFailureReport.observationGate,
        status: 'failed_rolled_back',
        failureStrategy: 'rollback_step',
      },
    } as const;
    const rolledBackContent = {
      ...failureRecoveryContent,
      attestationId: 'c7293796-0d76-4c1f-bfc0-0c25cebb3291',
      failureReport: rolledBackFailureReport,
      recoveryReport: null,
      outcome: 'automatically_rolled_back',
      provenance: {
        ...failureRecoveryContent.provenance,
        recoverySessionFingerprintSha256: null,
        recoveryReportReceipt: null,
      },
      verificationScope: {
        ...failureRecoveryContent.verificationScope,
        rollbackOutcome: 'companion_reported_succeeded',
        recoveryOutcome: 'not_required',
        failureNativeUndoCheckpoint: 'not_verified_at_failure_report',
        terminalNativeUndoCheckpoint: 'not_applicable_no_retained_step',
      },
    } as const;
    expect(
      procedureLeafReplayFailureRecoveryAttestationSchema.safeParse({
        ...rolledBackContent,
        integrity: {
          algorithm: 'sha256',
          canonicalization: 'operatingline-json-value-v1',
          contentSha256:
            computeProcedureLeafReplayFailureRecoveryAttestationContentSha256(rolledBackContent),
        },
      }).success,
    ).toBe(true);
    expect(
      procedureLeafReplayAttestationSchema.safeParse(
        attest({
          ...checkpointContent,
          report: {
            ...checkpointContent.report,
            nativeUndoCheckpoint: {
              ...nativeUndoCheckpoint,
              session: { ...nativeUndoCheckpoint.session, receiptStepIds: ['different.step'] },
            },
          },
        }),
      ).success,
    ).toBe(false);

    const icosphereObservation = {
      ...observations[0],
      kind: 'icosphere_ready',
      details: {
        ...observations[0].details,
        parameters: {
          ...observations[0].details.parameters,
          subdivisions: 3,
        },
        vertexCount: 162,
        edgeCount: 480,
        faceCount: 320,
      },
    } as const;
    const icosphereContent = {
      ...content,
      report: { ...content.report, observations: [icosphereObservation] },
      execution: {
        ...content.execution,
        action: {
          adapterId: 'blender',
          name: 'blender.mesh.create_icosphere',
        },
      },
      successGate: { observations: [icosphereObservation], allSatisfied: true },
    } as const;
    const icosphereAttestation = attest(icosphereContent);
    expect(procedureLeafReplayAttestationSchema.safeParse(icosphereAttestation).success).toBe(true);
    const wrongIcosphereTopologyContent = {
      ...icosphereContent,
      report: {
        ...icosphereContent.report,
        observations: [
          {
            ...icosphereObservation,
            details: { ...icosphereObservation.details, vertexCount: 42 },
          },
        ],
      },
      successGate: {
        observations: [
          {
            ...icosphereObservation,
            details: { ...icosphereObservation.details, vertexCount: 42 },
          },
        ],
        allSatisfied: true,
      },
    } as const;
    expect(
      procedureLeafReplayAttestationSchema.safeParse(attest(wrongIcosphereTopologyContent)).success,
    ).toBe(false);
    const sizedPrimitiveDetails = Object.fromEntries(
      Object.entries(observations[0].details).filter(([key]) => key !== 'radiusMatches'),
    );
    const sizedPrimitiveAttestations = [
      {
        actionName: 'blender.mesh.create_cube',
        observationKind: 'cube_ready',
        topology: { vertexCount: 8, edgeCount: 12, faceCount: 6 },
      },
      {
        actionName: 'blender.mesh.create_plane',
        observationKind: 'plane_ready',
        topology: { vertexCount: 4, edgeCount: 4, faceCount: 1 },
      },
    ].map(({ actionName, observationKind, topology }) => {
      const sizedObservation = {
        kind: observationKind,
        satisfied: true,
        details: {
          ...sizedPrimitiveDetails,
          parameters: {
            resourceId,
            objectName,
            size: 2.5,
            location: leaf.action!.arguments['location'],
          },
          sizeMatches: true,
          ...topology,
        },
      };
      const sizedContent = {
        ...content,
        report: { ...content.report, observations: [sizedObservation] },
        execution: {
          ...content.execution,
          action: { adapterId: 'blender', name: actionName },
        },
        successGate: { observations: [sizedObservation], allSatisfied: true },
      };
      const sizedAttestation = attest(sizedContent);
      expect(procedureLeafReplayAttestationSchema.safeParse(sizedAttestation).success).toBe(true);
      return sizedAttestation;
    });
    const torusObservation = {
      kind: 'torus_ready',
      satisfied: true,
      details: {
        ...sizedPrimitiveDetails,
        parameters: {
          resourceId,
          objectName,
          majorSegments: 16,
          minorSegments: 8,
          majorRadius: 0.25,
          minorRadius: 0.75,
          location: leaf.action!.arguments['location'],
        },
        geometryMatches: true,
        vertexCount: 128,
        edgeCount: 256,
        faceCount: 128,
      },
    } as const;
    const torusContent = {
      ...content,
      report: { ...content.report, observations: [torusObservation] },
      execution: {
        ...content.execution,
        action: { adapterId: 'blender', name: 'blender.mesh.create_torus' },
      },
      successGate: { observations: [torusObservation], allSatisfied: true },
      verificationScope: { ...content.verificationScope, shortcutTrack: 'unavailable' },
    } as const;
    const torusAttestation = attest(torusContent);
    expect(procedureLeafReplayAttestationSchema.safeParse(torusAttestation).success).toBe(true);
    expect(
      procedureLeafReplayAttestationSchema.safeParse(
        attest({
          ...torusContent,
          report: {
            ...torusContent.report,
            observations: [
              {
                ...torusObservation,
                details: { ...torusObservation.details, edgeCount: 255 },
              },
            ],
          },
          successGate: {
            observations: [
              {
                ...torusObservation,
                details: { ...torusObservation.details, edgeCount: 255 },
              },
            ],
            allSatisfied: true,
          },
        }),
      ).success,
    ).toBe(false);
    const segmentPrimitiveDetails = Object.fromEntries(
      Object.entries(observations[0].details).filter(([key]) => key !== 'radiusMatches'),
    );
    const segmentAttestations = [
      {
        actionName: 'blender.mesh.create_cone',
        observationKind: 'cone_ready',
        parameters: {
          resourceId,
          objectName,
          radiusStart: 1.25,
          radiusEnd: 0.25,
          start: [1, 2, 3],
          end: [4, 6, 3],
        },
        topology: { vertexCount: 64, edgeCount: 96, faceCount: 34 },
      },
      {
        actionName: 'blender.mesh.create_cone',
        observationKind: 'cone_ready',
        parameters: {
          resourceId,
          objectName,
          radiusStart: 0,
          radiusEnd: 0.25,
          start: [1, 2, 3],
          end: [4, 6, 3],
        },
        topology: { vertexCount: 33, edgeCount: 64, faceCount: 33 },
      },
      {
        actionName: 'blender.mesh.create_cylinder',
        observationKind: 'cylinder_ready',
        parameters: {
          resourceId,
          objectName,
          radius: 0.75,
          start: [1, 2, 3],
          end: [4, 6, 3],
        },
        topology: { vertexCount: 64, edgeCount: 96, faceCount: 34 },
      },
    ].map(({ actionName, observationKind, parameters, topology }) => {
      const segmentObservation = {
        kind: observationKind,
        satisfied: true,
        details: {
          ...segmentPrimitiveDetails,
          parameters,
          segmentGeometryMatches: true,
          endpointsMatch: true,
          ...topology,
        },
      };
      const segmentContent = {
        ...content,
        report: { ...content.report, observations: [segmentObservation] },
        execution: {
          ...content.execution,
          action: { adapterId: 'blender', name: actionName },
        },
        successGate: { observations: [segmentObservation], allSatisfied: true },
        verificationScope: { ...content.verificationScope, shortcutTrack: 'unavailable' },
      };
      const segmentAttestation = attest(segmentContent);
      expect(procedureLeafReplayAttestationSchema.safeParse(segmentAttestation).success).toBe(true);
      return segmentAttestation;
    });
    const pointedCone = segmentAttestations[1]!;
    const pointedConeContent = withoutKey(pointedCone, 'integrity');
    const wrongPointedObservation = {
      ...pointedCone.report.observations[0],
      details: {
        ...pointedCone.report.observations[0]!.details,
        vertexCount: 64,
        edgeCount: 96,
        faceCount: 34,
      },
    };
    expect(
      procedureLeafReplayAttestationSchema.safeParse(
        attest({
          ...pointedConeContent,
          report: { ...pointedCone.report, observations: [wrongPointedObservation] },
          successGate: {
            observations: [wrongPointedObservation],
            allSatisfied: true,
          },
        }),
      ).success,
    ).toBe(false);
    expect(
      procedureLeafReplayAttestationSchema.safeParse({
        ...attestation,
        verificationScope: { ...attestation.verificationScope, menuTrack: 'verified' },
      }).success,
    ).toBe(false);
    expect(
      procedureLeafReplayAttestationSchema.safeParse({
        ...attestation,
        decision: { ...attestation.decision, decision: 'rejected' },
      }).success,
    ).toBe(false);
    const invalidContents = [
      {
        ...content,
        execution: {
          ...content.execution,
          host: { ...content.execution.host, adapterId: 'maya' },
        },
      },
      {
        ...content,
        execution: {
          ...content.execution,
          action: { ...content.execution.action, name: 'blender.mesh.create_cube' },
        },
      },
      {
        ...content,
        report: { ...content.report, activeStepId: 'other.step' },
      },
      {
        ...content,
        report: { ...content.report, completedStepIds: [] },
      },
      {
        ...content,
        provenance: {
          ...content.provenance,
          decisionReceipt: { ...content.provenance.decisionReceipt, sequence: 3 },
        },
      },
      {
        ...content,
        report: {
          ...content.report,
          observations: [
            {
              ...content.report.observations[0],
              kind: 'object_exists',
            },
          ],
        },
      },
      {
        ...content,
        report: {
          ...content.report,
          observations: [
            {
              ...content.report.observations[0],
              details: {
                ...content.report.observations[0].details,
                rotationMatches: false,
              },
            },
          ],
        },
      },
    ];
    for (const invalidContent of invalidContents) {
      const integrity = {
        algorithm: 'sha256',
        canonicalization: 'operatingline-json-value-v1',
        contentSha256: computeProcedureLeafReplayAttestationContentSha256(
          invalidContent as typeof content,
        ),
      } as const;
      expect(
        procedureLeafReplayAttestationSchema.safeParse({ ...invalidContent, integrity }).success,
      ).toBe(false);
    }

    const finalizeRequest = { replayId, attestationId, reportId };
    expect(procedureLeafReplayFinalizeRequestSchema.safeParse(finalizeRequest).success).toBe(true);
    const resultCases = [
      { value: { status: 'accepted', attestation }, accepted: true },
      { value: { status: 'duplicate', attestation }, accepted: true },
      { value: { status: 'rejected', attestation }, accepted: false },
    ] as const;
    for (const contractCase of resultCases) {
      expect(procedureLeafReplayFinalizeResultSchema.safeParse(contractCase.value).success).toBe(
        contractCase.accepted,
      );
    }
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-leaf-replay-finalize-request.schema.json'),
      [
        { value: finalizeRequest, accepted: true },
        { value: { ...finalizeRequest, reportId: 'bad' }, accepted: false },
      ],
    );
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-leaf-replay-attestation.schema.json'),
      [
        { value: attestation, accepted: true },
        { value: icosphereAttestation, accepted: true },
        ...sizedPrimitiveAttestations.map((value) => ({ value, accepted: true as const })),
        { value: torusAttestation, accepted: true },
        ...segmentAttestations.map((value) => ({ value, accepted: true as const })),
        {
          value: {
            ...attestation,
            verificationScope: { ...attestation.verificationScope, shortcutTrack: 'verified' },
          },
          accepted: false,
        },
        {
          value: {
            ...attestation,
            execution: {
              ...attestation.execution,
              action: {
                ...attestation.execution.action,
                name: 'blender.mesh.create_primitive_batch',
              },
            },
          },
          accepted: false,
        },
        {
          value: {
            ...attestation,
            report: { ...attestation.report, activeStepId: null },
          },
          accepted: false,
        },
        {
          value: {
            ...attestation,
            report: {
              ...attestation.report,
              observations: [
                {
                  ...attestation.report.observations[0],
                  details: {
                    ...attestation.report.observations[0].details,
                    materialsAbsent: false,
                  },
                },
              ],
            },
          },
          accepted: false,
        },
        {
          value: withoutKey(attestation, 'provenance'),
          accepted: false,
        },
      ],
    );
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-leaf-replay-finalize-result.schema.json'),
      resultCases,
    );
    const failureRecoveryFinalizeRequest = {
      replayId,
      attestationId: failureRecoveryAttestation.attestationId,
      failureReportId: retainedFailureReport.reportId,
      recoveryReportId: recoveryReport.reportId,
    };
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-leaf-replay-failure-recovery-finalize-request.schema.json'),
      [
        { value: failureRecoveryFinalizeRequest, accepted: true },
        {
          value: { ...failureRecoveryFinalizeRequest, recoveryReportId: 'bad' },
          accepted: false,
        },
      ],
    );
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-leaf-replay-failure-recovery-attestation.schema.json'),
      [
        { value: failureRecoveryAttestation, accepted: true },
        { value: withoutKey(failureRecoveryAttestation, 'integrity'), accepted: false },
        {
          value: {
            ...failureRecoveryAttestation,
            failureReport: withoutKey(retainedFailureReport, 'nativeUndoCheckpoint'),
            verificationScope: {
              ...failureRecoveryAttestation.verificationScope,
              failureNativeUndoCheckpoint: 'not_verified_at_failure_report',
            },
          },
          accepted: false,
        },
      ],
    );
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-leaf-replay-failure-recovery-finalize-result.schema.json'),
      [
        {
          value: { status: 'accepted', attestation: failureRecoveryAttestation },
          accepted: true,
        },
        {
          value: { status: 'rejected', attestation: failureRecoveryAttestation },
          accepted: false,
        },
      ],
    );
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-leaf-replay-current-state-request.schema.json'),
      [
        { value: { replayId, verificationId }, accepted: true },
        { value: { replayId, verificationId: 'bad' }, accepted: false },
      ],
    );
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-leaf-replay-current-state-request-result.schema.json'),
      [
        {
          value: { status: 'accepted', request: currentStateRequest },
          accepted: true,
        },
        {
          value: { status: 'rejected', request: currentStateRequest },
          accepted: false,
        },
      ],
    );
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-leaf-replay-current-state-status-request.schema.json'),
      [
        { value: { verificationId }, accepted: true },
        { value: { verificationId: 'bad' }, accepted: false },
      ],
    );
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-leaf-replay-current-state-verification.schema.json'),
      [
        { value: currentStateVerification, accepted: true },
        { value: withoutKey(currentStateVerification, 'integrity'), accepted: false },
      ],
    );
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-leaf-replay-current-state-status-result.schema.json'),
      [
        { value: { status: 'pending', request: currentStateRequest }, accepted: true },
        {
          value: { status: 'completed', verification: currentStateVerification },
          accepted: true,
        },
      ],
    );
  });
});
