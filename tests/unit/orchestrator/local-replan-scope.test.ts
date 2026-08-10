import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { guideRevisionRequestSchema, type GuidePlan } from '@operatingline/protocol';
import { describe, expect, it } from 'vitest';

import {
  createLocalReplanScope,
  evaluateLocalReplanScope,
  localReplanCoverageStepIds,
} from '../../../services/orchestrator/src/local-replan-scope.js';

const basePlan = JSON.parse(
  readFileSync(resolve('protocol/fixtures/v1/snowman-teaching.plan.json'), 'utf8'),
) as GuidePlan;

function request(references: Array<{ nodeId: string; nodeNumber: string }>) {
  const requestId = randomUUID();
  return guideRevisionRequestSchema.parse({
    protocolVersion: '1.1.0',
    requestId,
    adapterId: 'blender',
    catalogVersion: '1.2.0',
    instanceId: randomUUID(),
    basePlan,
    references,
    message: 'Make only the referenced snowman area rougher and easier to understand.',
    revisionThread: { threadId: requestId, turn: 1, parentRequestId: null },
    occurredAt: new Date().toISOString(),
  });
}

function targetPlan(): GuidePlan {
  return { ...structuredClone(basePlan), revision: basePlan.revision + 1 };
}

function step(plan: GuidePlan, stepId: string) {
  const result = plan.steps.find((candidate) => candidate.id === stepId);
  if (result === undefined) {
    throw new Error(`Missing test step ${stepId}`);
  }
  return result;
}

function findingCodes(result: ReturnType<typeof evaluateLocalReplanScope>): string[] {
  return result.locality.findings.map((finding) => finding.code);
}

describe('referenced-subtree local replan scope', () => {
  it('allows changes and additions inside one referenced subtree', () => {
    const revisionRequest = request([{ nodeId: 'snowman.model', nodeNumber: '1.2' }]);
    const target = targetPlan();
    step(target, 'snowman.model.head').title = 'Create a larger rough snow head';
    const added = structuredClone(step(target, 'snowman.model.head'));
    added.id = 'snowman.model.scarf_preview';
    added.parentId = 'snowman.model';
    added.order = 4;
    added.title = 'Preview a scarf attachment';
    target.steps.push(added);

    const result = evaluateLocalReplanScope(revisionRequest, target);

    expect(result.locality).toMatchObject({
      valid: true,
      scopeRootIds: ['snowman.model'],
      findings: [],
    });
    expect(result.planDiff).toMatchObject({
      summary: { addedSteps: 1, updatedSteps: 1 },
    });
  });

  it('normalizes overlapping references to their shared ancestor scope', () => {
    const revisionRequest = request([
      { nodeId: 'snowman.model.head', nodeNumber: '1.2.3' },
      { nodeId: 'snowman.model', nodeNumber: '1.2' },
    ]);

    expect(createLocalReplanScope(revisionRequest)).toMatchObject({
      referencedRootIds: ['snowman.model.head', 'snowman.model'],
      normalizedRootIds: ['snowman.model'],
    });
    expect([...localReplanCoverageStepIds(revisionRequest, targetPlan())].sort()).toEqual(
      basePlan.steps
        .filter(
          (candidate) =>
            candidate.id === 'snowman.model' || candidate.id.startsWith('snowman.model.'),
        )
        .map((candidate) => candidate.id)
        .sort(),
    );
  });

  it('allows a Plan-root reference to cover every descendant but not Plan fields', () => {
    const revisionRequest = request([{ nodeId: 'snowman', nodeNumber: '1' }]);
    const target = targetPlan();
    step(target, 'snowman.render.preview').explanation = 'Render the approved rough snowman.';
    expect(evaluateLocalReplanScope(revisionRequest, target).locality.valid).toBe(true);

    target.title = 'Changed plan title';
    expect(findingCodes(evaluateLocalReplanScope(revisionRequest, target))).toContain(
      'plan_title_changed',
    );
  });

  it('rejects scope escape, root attachment changes, outside additions, and no-op output', () => {
    const revisionRequest = request([
      { nodeId: 'snowman.model', nodeNumber: '1.2' },
      { nodeId: 'snowman.details', nodeNumber: '1.3' },
    ]);

    const outsideChange = targetPlan();
    step(outsideChange, 'snowman.scene').title = 'Changed outside scope';
    expect(findingCodes(evaluateLocalReplanScope(revisionRequest, outsideChange))).toContain(
      'step_changed_outside_scope',
    );

    const rootMove = targetPlan();
    step(rootMove, 'snowman.model').order = 20;
    expect(findingCodes(evaluateLocalReplanScope(revisionRequest, rootMove))).toContain(
      'scope_root_attachment_changed',
    );

    const crossScopeMove = targetPlan();
    step(crossScopeMove, 'snowman.model.head').parentId = 'snowman.details';
    step(crossScopeMove, 'snowman.model.head').order = 4;
    expect(findingCodes(evaluateLocalReplanScope(revisionRequest, crossScopeMove))).toContain(
      'step_moved_across_scope',
    );

    const outsideAddition = targetPlan();
    const added = structuredClone(step(outsideAddition, 'snowman.model.head'));
    added.id = 'snowman.scene.unscoped_addition';
    added.parentId = 'snowman.scene';
    added.order = 2;
    outsideAddition.steps.push(added);
    expect(findingCodes(evaluateLocalReplanScope(revisionRequest, outsideAddition))).toContain(
      'step_added_outside_scope',
    );

    expect(findingCodes(evaluateLocalReplanScope(revisionRequest, targetPlan()))).toContain(
      'no_local_change',
    );
  });

  it('rejects deletion of a referenced root and structurally invalid complete plans', () => {
    const revisionRequest = request([{ nodeId: 'snowman.model', nodeNumber: '1.2' }]);
    const missingRoot = targetPlan();
    missingRoot.steps = missingRoot.steps.filter((candidate) => candidate.id !== 'snowman.model');

    const result = evaluateLocalReplanScope(revisionRequest, missingRoot);
    expect(findingCodes(result)).toEqual(
      expect.arrayContaining(['plan_structure_invalid', 'scope_root_missing']),
    );
    expect(result.planDiff).toBeNull();
  });
});
