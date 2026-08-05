import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { blenderActionCatalog, blenderActionCatalogs } from '@operatingline/blender-action-catalog';
import {
  guideRevisionRequestSchema,
  plannerReplanDraftSchema,
  plannerReplanGenerateRequestSchema,
  replanningPromptPacketSchema,
  type GuidePlan,
} from '@operatingline/protocol';
import { describe, expect, it } from 'vitest';

import { createLocalReplanScope } from '../../../services/orchestrator/src/local-replan-scope.js';
import { buildReplanningPromptPacket } from '../../../services/orchestrator/src/replanning-prompt.js';

const basePlan = JSON.parse(
  readFileSync(resolve('protocol/fixtures/v1/snowman.plan.json'), 'utf8'),
) as GuidePlan;

function revisionRequest() {
  const requestId = randomUUID();
  return guideRevisionRequestSchema.parse({
    protocolVersion: '1.1.0',
    requestId,
    adapterId: 'blender',
    catalogVersion: blenderActionCatalog.catalogVersion,
    instanceId: randomUUID(),
    basePlan,
    references: [{ nodeId: 'snowman.model.head', nodeNumber: '1.2.3' }],
    message: 'Make the referenced head larger without changing the rest of the snowman.',
    revisionThread: { threadId: requestId, turn: 1, parentRequestId: null },
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
  });
});
