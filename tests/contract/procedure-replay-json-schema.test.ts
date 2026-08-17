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
  procedureAuthoringCandidateTreeSchema,
  procedureLeafReplayAttestationSchema,
  procedureLeafReplayBindingSchema,
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
    const attest = (candidate: typeof content) =>
      ({
        ...candidate,
        integrity: {
          algorithm: 'sha256',
          canonicalization: 'operatingline-json-value-v1',
          contentSha256: computeProcedureLeafReplayAttestationContentSha256(candidate),
        },
      }) as const;
    const attestation = attest(content);
    expect(attestation.integrity.contentSha256).toBe(
      createHash('sha256').update(canonicalizeProtocolJsonValue(content)).digest('hex'),
    );
    expect(procedureLeafReplayAttestationSchema.safeParse(attestation).success).toBe(true);
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
              action: { ...attestation.execution.action, name: 'blender.mesh.create_cube' },
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
  });
});
