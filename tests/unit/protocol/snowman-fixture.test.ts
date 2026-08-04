import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  stableExecutableOrder,
  validateExecutableTaskPlan,
  type TaskNode,
} from '@operatingline/domain';
import { guidePlanSchema, type GuidePlan } from '@operatingline/protocol';

const executableStepIds = [
  'snowman.scene.ground',
  'snowman.model.body_lower',
  'snowman.model.body_upper',
  'snowman.model.head',
  'snowman.details.face',
  'snowman.details.buttons',
  'snowman.details.arms',
  'snowman.materials.snow',
  'snowman.materials.accessories',
  'snowman.materials.ground',
  'snowman.lighting.scene',
  'snowman.lighting.rig',
  'snowman.render.preview',
] as const;

const stageIds = [
  'snowman.scene',
  'snowman.model',
  'snowman.details',
  'snowman.materials',
  'snowman.lighting',
  'snowman.render',
] as const;

const readPlan = (): GuidePlan =>
  guidePlanSchema.parse(
    JSON.parse(readFileSync(resolve('protocol/fixtures/v1/snowman.plan.json'), 'utf8')),
  );

const toDomainNodes = (plan: GuidePlan): TaskNode[] =>
  plan.steps.map((step) => ({
    id: step.id,
    parentId: step.parentId,
    order: step.order,
    dependsOn: [...step.dependsOn],
    title: step.title,
    intent: step.intent,
    status: step.state,
  }));

const collectKeys = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.flatMap(collectKeys);
  }
  if (typeof value !== 'object' || value === null) {
    return [];
  }
  return Object.entries(value).flatMap(([key, nested]) => [key, ...collectKeys(nested)]);
};

describe('complete snowman guide fixture', () => {
  it('validates as GuidePlan revision 2 and covers the six ordered stages', () => {
    const plan = readPlan();
    const rootChildren = plan.steps
      .filter((step) => step.parentId === plan.rootStepId)
      .sort((left, right) => left.order - right.order)
      .map((step) => step.id);

    expect(plan).toMatchObject({ id: 'snowman-demo', revision: 2, rootStepId: 'snowman' });
    expect(rootChildren).toEqual(stageIds);
  });

  it('freezes the thirteen executable leaves as one strict dependency chain', () => {
    const plan = readPlan();
    const executableSteps = plan.steps.filter((step) => step.action !== null);

    expect(executableSteps.map((step) => step.id)).toEqual(executableStepIds);
    expect(executableSteps[0]?.dependsOn).toEqual([]);
    for (let index = 1; index < executableSteps.length; index += 1) {
      expect(executableSteps[index]?.dependsOn).toEqual([executableStepIds[index - 1]]);
    }

    const nodes = toDomainNodes(plan);
    const executableIds = new Set(executableStepIds);
    expect(validateExecutableTaskPlan(nodes, executableIds)).toMatchObject({
      valid: true,
      errors: [],
    });
    expect(stableExecutableOrder(nodes, executableIds).map((node) => node.id)).toEqual(
      executableStepIds,
    );
  });

  it('keeps every action on a Blender leaf with evidence and compensation', () => {
    const plan = readPlan();
    const parentIds = new Set(
      plan.steps.flatMap((step) => (step.parentId === null ? [] : [step.parentId])),
    );
    const executableSteps = plan.steps.filter((step) => step.action !== null);

    expect(executableSteps).toHaveLength(13);
    for (const step of executableSteps) {
      expect(parentIds.has(step.id), step.id).toBe(false);
      expect(step.action?.adapterId, step.id).toBe('blender');
      expect(step.anchors.length, step.id).toBeGreaterThan(0);
      expect(step.expectedObservations.length, step.id).toBeGreaterThan(0);
      expect(step.rollback, step.id).toEqual({
        mode: 'compensating_action',
        checkpointRequired: false,
      });
    }
  });

  it('uses the generic action catalog and only supported observation kinds', () => {
    const plan = readPlan();
    const executableSteps = plan.steps.filter((step) => step.action !== null);
    const actionNames = executableSteps.map((step) => step.action?.name);
    const observationKinds = new Set(
      executableSteps.flatMap((step) =>
        step.expectedObservations.map((observation) => observation.kind),
      ),
    );

    expect(actionNames).toEqual([
      'blender.mesh.create_plane',
      'blender.mesh.create_uv_sphere',
      'blender.mesh.create_uv_sphere',
      'blender.mesh.create_uv_sphere',
      'blender.mesh.create_primitive_batch',
      'blender.mesh.create_primitive_batch',
      'blender.mesh.create_primitive_batch',
      'blender.material.create_and_assign',
      'blender.material.create_palette_and_assign',
      'blender.material.create_and_assign',
      'blender.render_scene.create',
      'blender.render_rig.create',
      'blender.render.execute_preview',
    ]);
    expect([...observationKinds].sort()).toEqual([
      'material_assigned',
      'render_artifact_exists',
      'render_rig_ready',
      'render_scene_ready',
      'resource_exists',
    ]);
  });

  it('contains no action argument that can inject an arbitrary filesystem path', () => {
    const plan = readPlan();
    const argumentKeys = plan.steps.flatMap((step) => collectKeys(step.action?.arguments));
    const renderStep = plan.steps.find((step) => step.id === 'snowman.render.preview');

    expect(argumentKeys.filter((key) => key.toLowerCase().includes('path'))).toEqual([]);
    expect(renderStep?.action?.arguments).toEqual({
      renderId: 'snowman.render.preview',
      sceneId: 'snowman.render.scene',
      engine: 'auto_eevee',
      resolutionX: 320,
      resolutionY: 320,
      resolutionPercentage: 100,
      format: 'PNG',
      destination: 'extension_temp',
      samples: 32,
    });
  });

  it('keeps all owned Blender datablock names in the OperatingLine namespace', () => {
    const plan = readPlan();
    const ownedNameEntries = plan.steps.flatMap((step) => {
      const action = step.action;
      if (action === null) {
        return [];
      }
      const entries: Array<[string, unknown]> = [];
      const visit = (value: unknown): void => {
        if (Array.isArray(value)) {
          value.forEach(visit);
          return;
        }
        if (typeof value !== 'object' || value === null) {
          return;
        }
        for (const [key, nested] of Object.entries(value)) {
          if (['objectName', 'materialName', 'sceneName', 'worldName', 'dataName'].includes(key)) {
            entries.push([key, nested]);
          }
          visit(nested);
        }
      };
      visit(action.arguments);
      return entries;
    });

    expect(ownedNameEntries.length).toBeGreaterThan(0);
    for (const [key, value] of ownedNameEntries) {
      expect(value, key).toEqual(expect.stringMatching(/^OperatingLine\./));
    }
  });
});
