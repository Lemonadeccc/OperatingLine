import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { blenderActionCatalog, blenderActionCatalogs } from '@operatingline/blender-action-catalog';
import {
  guideRevisionRequestSchema,
  guidePlanSchema,
  plannerReplanDraftSchema,
  plannerReplanGenerateRequestSchema,
  replanningPromptPacketSchema,
  type GuidePlan,
} from '@operatingline/protocol';
import { describe, expect, it } from 'vitest';

import { createLocalReplanScope } from '../../../services/orchestrator/src/local-replan-scope.js';
import { buildReplanningPromptPacket } from '../../../services/orchestrator/src/replanning-prompt.js';

const basePlan = JSON.parse(
  readFileSync(resolve('protocol/fixtures/v1/snowman-teaching.plan.json'), 'utf8'),
) as GuidePlan;

function planWithCandidateMenuProjection(revision = basePlan.revision): GuidePlan {
  return guidePlanSchema.parse({
    ...basePlan,
    protocolVersion: '1.7.0',
    revision,
    steps: basePlan.steps.map((step) =>
      step.id !== 'snowman.model.head'
        ? step
        : {
            ...step,
            candidateMenuProjection: {
              projection: 'candidate_only',
              interactionCatalogVersion: '1.44.0',
              id: 'snowman.model.head.edit_subdivide_candidate',
              modality: 'menu',
              equivalence: 'not_equivalent_to_managed_action',
              executionAuthority: 'none',
              title: 'Edit Subdivide candidate',
              reason: 'Preserve a bounded native-menu candidate for host-side evaluation.',
              preconditions: [{ kind: 'mode', label: 'Mode', value: 'Edit Mode' }],
              operations: [
                {
                  id: 'snowman.model.head.edit_subdivide_candidate.open',
                  order: 1,
                  semanticRefs: ['snowman.model.head'],
                  description: 'Open Edit > Subdivide.',
                  evidenceRefs: [],
                  intent: 'navigate',
                  target: { kind: 'menu_item', hostId: 'mesh.subdivide' },
                  path: ['Edit', 'Subdivide'],
                  parameters: {},
                },
              ],
              omittedActionArguments: [],
              nativeEvidence: {
                kind: 'bounded_blender_ui_probe',
                executorId: 'blender-native-probe',
                hostVersions: ['4.3.0'],
                managedActionExecuted: false,
                managedReceiptCreated: false,
                managedReplacementMeshCreated: false,
                nativeMutationKind: 'mesh_subdivide',
                operationIds: ['snowman.model.head.edit_subdivide_candidate.open'],
                nativeUndoCheckpointRequired: true,
                nativeUndoDepth: 1,
                nativeRedoDepth: 1,
              },
            },
          },
    ),
  });
}

function revisionRequest(plan: GuidePlan = basePlan) {
  const requestId = randomUUID();
  return guideRevisionRequestSchema.parse({
    protocolVersion: plan.protocolVersion === '1.7.0' ? '1.7.0' : '1.1.0',
    requestId,
    adapterId: 'blender',
    catalogVersion: blenderActionCatalog.catalogVersion,
    instanceId: randomUUID(),
    basePlan: plan,
    references: [{ nodeId: 'snowman.model.head', nodeNumber: '1.2.3' }],
    message: 'Make the referenced head larger without changing the rest of the snowman.',
    revisionThread: { threadId: requestId, turn: 1, parentRequestId: null },
    ...(plan.protocolVersion === '1.7.0' ? { revisionOperation: { kind: 'revise' } } : {}),
    occurredAt: '2026-08-05T00:00:00.000Z',
  });
}

describe('typed replanning prompt packet', () => {
  it('builds deterministic complete-plan instructions from immutable host facts', () => {
    const request = revisionRequest();
    const context = {
      revisionRequest: request,
      targetRevision: basePlan.revision + 1,
      catalog: blenderActionCatalog,
      companionState: null,
      scope: createLocalReplanScope(request),
    };

    const first = buildReplanningPromptPacket(context);
    const second = buildReplanningPromptPacket(structuredClone(context));

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      formatVersion: '1.1.0',
      operation: 'local_replan',
      context: {
        revisionRequest: {
          requestId: request.requestId,
          basePlan: { id: basePlan.id, revision: basePlan.revision },
          references: [{ nodeId: 'snowman.model.head', nodeNumber: '1.2.3' }],
          message: request.message,
          revisionThread: { threadId: request.requestId, turn: 1 },
        },
        targetRevision: basePlan.revision + 1,
        catalog: { adapterId: 'blender', catalogVersion: blenderActionCatalog.catalogVersion },
        scope: {
          policyVersion: 'referenced_subtrees_v1',
          normalizedRootIds: ['snowman.model.head'],
        },
      },
      workflow: { submitToolName: 'operatingline.replan.propose' },
    });
    expect(first.renderedPrompt).toContain('never JSON Patch');
    expect(first.renderedPrompt).toContain('Proposal');
    expect(first.renderedPrompt).toContain(request.message);
    expect(first.renderedPrompt).toContain('output.planning.capabilityCoverage');
  });

  it('keeps packet, generation request, and complete draft contracts strict', () => {
    const request = revisionRequest();
    const packet = buildReplanningPromptPacket({
      revisionRequest: request,
      targetRevision: basePlan.revision + 1,
      catalog: blenderActionCatalog,
      companionState: null,
      scope: createLocalReplanScope(request),
    });

    expect(replanningPromptPacketSchema.safeParse({ ...packet, extra: true }).success).toBe(false);
    expect(
      plannerReplanGenerateRequestSchema.safeParse({
        requestId: request.requestId,
        revisionRequestId: request.requestId,
        providerId: 'fake-planner',
      }).success,
    ).toBe(false);
    expect(
      plannerReplanDraftSchema.safeParse({
        requestId: request.requestId,
        catalogVersion: blenderActionCatalog.catalogVersion,
        planning: { goal: request.message, requiredPhaseIds: ['geometry'] },
        patch: [{ op: 'replace', path: '/steps/0/title', value: 'partial output' }],
      }).success,
    ).toBe(false);
  });

  it('keeps host-owned menu candidates outside the Provider replan boundary', () => {
    const candidatePlan = planWithCandidateMenuProjection();
    const request = revisionRequest(candidatePlan);
    const packet = buildReplanningPromptPacket({
      revisionRequest: request,
      targetRevision: candidatePlan.revision + 1,
      catalog: blenderActionCatalog,
      companionState: null,
      scope: createLocalReplanScope(request),
    });

    expect(candidatePlan.steps.find((step) => step.id === 'snowman.model.head')).toMatchObject({
      candidateMenuProjection: {
        nativeEvidence: { kind: 'bounded_blender_ui_probe' },
      },
    });
    expect(JSON.stringify(packet.context)).not.toContain('candidateMenuProjection');
    expect(JSON.stringify(packet.context)).not.toContain('bounded_blender_ui_probe');
    expect(packet.renderedPrompt).not.toContain('candidateMenuProjection');
    expect(packet.renderedPrompt).not.toContain('bounded_blender_ui_probe');
    expect(JSON.stringify(packet.responseContract.schema)).not.toContain('candidateMenuProjection');
    expect(JSON.stringify(packet.responseContract.schema)).not.toContain(
      'bounded_blender_ui_probe',
    );

    const providerDraft = {
      requestId: request.requestId,
      catalogVersion: blenderActionCatalog.catalogVersion,
      planning: { goal: request.message, requiredPhaseIds: ['geometry'] },
      plan: candidatePlan,
    };
    expect(plannerReplanDraftSchema.safeParse(providerDraft).success).toBe(false);
    const projectedPlan = packet.context.revisionRequest.basePlan;
    expect(
      plannerReplanDraftSchema.safeParse({ ...providerDraft, plan: projectedPlan }).success,
    ).toBe(true);
  });

  it('projects host-owned menu candidates out of every merge Plan', () => {
    const commonAncestorPlan = planWithCandidateMenuProjection(basePlan.revision - 2);
    const sourcePlan = planWithCandidateMenuProjection(basePlan.revision - 1);
    const targetPlan = planWithCandidateMenuProjection();
    const expectedMergedPlan = planWithCandidateMenuProjection(basePlan.revision + 1);
    const requestId = randomUUID();
    const sourceThreadId = randomUUID();
    const sourceRequestId = randomUUID();
    const request = guideRevisionRequestSchema.parse({
      protocolVersion: '1.7.0',
      requestId,
      adapterId: 'blender',
      catalogVersion: blenderActionCatalog.catalogVersion,
      instanceId: randomUUID(),
      basePlan: targetPlan,
      references: [{ nodeId: 'snowman.model.head', nodeNumber: '1.2.3' }],
      message: 'Merge the source branch.',
      revisionThread: { threadId: randomUUID(), turn: 2, parentRequestId: randomUUID() },
      revisionOperation: { kind: 'merge', sourceThreadId, sourceRequestId },
      occurredAt: '2026-08-05T00:00:00.000Z',
    });
    const packet = buildReplanningPromptPacket({
      revisionRequest: request,
      targetRevision: expectedMergedPlan.revision,
      catalog: blenderActionCatalog,
      companionState: null,
      scope: createLocalReplanScope(request),
      merge: {
        sourceThreadId,
        sourceRequestId,
        commonAncestorRequestId: randomUUID(),
        commonAncestorPlan,
        sourcePlan,
        expectedMergedPlan,
      },
    });

    expect(JSON.stringify(packet.context)).not.toContain('candidateMenuProjection');
    expect(JSON.stringify(packet.context)).not.toContain('bounded_blender_ui_probe');
    expect(packet.renderedPrompt).not.toContain('candidateMenuProjection');
    expect(packet.renderedPrompt).not.toContain('bounded_blender_ui_probe');
  });

  it('preserves the historical 1.0 replan packet contract without capabilities', () => {
    const request = revisionRequest();
    const historicalCatalog = blenderActionCatalogs.find(
      (catalog) => catalog.catalogVersion === '1.2.0',
    );
    expect(historicalCatalog).toBeDefined();
    const historicalRequest = guideRevisionRequestSchema.parse({
      ...request,
      catalogVersion: historicalCatalog?.catalogVersion,
    });
    const packet = buildReplanningPromptPacket({
      revisionRequest: historicalRequest,
      targetRevision: basePlan.revision + 1,
      catalog: historicalCatalog!,
      companionState: null,
      scope: createLocalReplanScope(historicalRequest),
    });
    expect(packet.formatVersion).toBe('1.0.0');
    expect(packet.renderedPrompt).not.toContain('output.planning.capabilityCoverage');
  });

  it('publishes strict JSON Schemas for non-TypeScript replan clients', () => {
    for (const filename of [
      'replanning-prompt-context.schema.json',
      'replanning-prompt-request.schema.json',
      'replanning-prompt-packet.schema.json',
      'planner-replan-draft.schema.json',
      'planner-replan-generate-request.schema.json',
      'planner-replan-generation-result.schema.json',
    ]) {
      const schema = JSON.parse(readFileSync(resolve('protocol/schemas/v1', filename), 'utf8')) as {
        additionalProperties?: boolean;
      };
      expect(schema.additionalProperties, filename).toBe(false);
    }

    const draftSchema = JSON.parse(
      readFileSync(resolve('protocol/schemas/v1/planner-replan-draft.schema.json'), 'utf8'),
    ) as {
      properties?: {
        plan?: {
          allOf?: unknown[];
          properties?: { steps?: { items?: { allOf?: unknown[] } } };
        };
      };
    };
    expect(draftSchema.properties?.plan?.allOf).toHaveLength(3);
    expect(draftSchema.properties?.plan?.properties?.steps?.items?.allOf).toHaveLength(3);
  });
});
