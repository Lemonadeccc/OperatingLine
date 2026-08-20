import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { blenderActionCatalog, blenderActionCatalogs } from '@operatingline/blender-action-catalog';
import { evaluatePlanningQuality } from '@operatingline/orchestrator';
import {
  guidePlanSchema,
  planningBenchmarkCaseSchema,
  planningQualityReportSchema,
  type GuidePlan,
} from '@operatingline/protocol';
import { describe, expect, it } from 'vitest';

const snowmanPlan = (): GuidePlan =>
  guidePlanSchema.parse(
    JSON.parse(readFileSync(resolve('protocol/fixtures/v1/snowman-teaching.plan.json'), 'utf8')),
  );
const historicalSnowmanPlan = (): GuidePlan =>
  guidePlanSchema.parse(
    JSON.parse(readFileSync(resolve('protocol/fixtures/v1/snowman.plan.json'), 'utf8')),
  );

const historicalCatalog = blenderActionCatalogs.find(
  (catalog) => catalog.catalogVersion === '1.2.0',
)!;
const completeSnowmanCoverage = {
  policyVersion: 'catalog_capability_coverage_v1' as const,
  requirements: [
    {
      requirementId: 'ground',
      statement: 'Create a ground plane.',
      coverage: [{ capabilityId: 'geometry.ground_plane', stepIds: ['snowman.scene.ground'] }],
    },
    {
      requirementId: 'model',
      statement: 'Create the snowman primitive assembly.',
      coverage: [{ capabilityId: 'geometry.primitive_assembly', stepIds: ['snowman.model.head'] }],
    },
    {
      requirementId: 'appearance',
      statement: 'Apply snowman materials.',
      coverage: [
        {
          capabilityId: 'appearance.principled_palette',
          stepIds: ['snowman.materials.snow'],
        },
      ],
    },
    {
      requirementId: 'rig',
      statement: 'Create a rigid armature.',
      coverage: [{ capabilityId: 'animation.rigid_armature', stepIds: ['snowman.animation.rig'] }],
    },
    {
      requirementId: 'motion',
      statement: 'Create pose keyframes.',
      coverage: [
        {
          capabilityId: 'animation.rigid_pose_keyframes',
          stepIds: ['snowman.animation.pose'],
        },
      ],
    },
    {
      requirementId: 'render-setup',
      statement: 'Prepare the render scene.',
      coverage: [{ capabilityId: 'render.scene_setup', stepIds: ['snowman.lighting.scene'] }],
    },
    {
      requirementId: 'output',
      statement: 'Render a PNG preview.',
      coverage: [{ capabilityId: 'output.png_preview', stepIds: ['snowman.render.preview'] }],
    },
  ],
};

const evaluate = (plan: GuidePlan, requiredPhaseIds: string[] = []) =>
  evaluatePlanningQuality(
    {
      targetAdapterId: 'blender',
      catalogVersion: blenderActionCatalog.catalogVersion,
      goal: 'Create and render an animated snowman',
      requiredPhaseIds,
      capabilityCoverage: completeSnowmanCoverage,
      plan,
    },
    blenderActionCatalog,
  );

const subdivisionSurfacePlan = (): GuidePlan => {
  const plan = snowmanPlan();
  const root = structuredClone(plan.steps.find((step) => step.id === 'snowman')!);
  const group = structuredClone(plan.steps.find((step) => step.id === 'snowman.model')!);
  const leaf = structuredClone(plan.steps.find((step) => step.id === 'snowman.model.head')!);

  leaf.dependsOn = [];
  leaf.action = {
    adapterId: 'blender',
    name: 'blender.modifier.add_subdivision_surface',
    arguments: {
      targetId: 'tutorial.cube',
      modifierId: 'tutorial.cube.subdivision_surface',
      modifierName: 'OperatingLine.Cube.SubdivisionSurface',
      viewportLevel: 3,
    },
  };
  leaf.anchors = [
    { kind: 'object', objectName: 'Cube' },
    {
      kind: 'owned_control',
      surfaceId: 'modifier.stack',
      controlId: 'tutorial.cube.subdivision_surface',
    },
  ];
  leaf.expectedObservations = [
    {
      kind: 'modifier_ready',
      parameters: { modifierId: 'tutorial.cube.subdivision_surface' },
    },
  ];

  return guidePlanSchema.parse({
    ...plan,
    id: 'subdivision-surface-quality',
    revision: 1,
    title: 'Add a Subdivision Surface modifier',
    steps: [root, group, leaf],
  });
};

const subdivisionSurfaceCoverage = {
  policyVersion: 'catalog_capability_coverage_v1' as const,
  requirements: [
    {
      requirementId: 'subdivision-surface',
      statement: 'Add a Subdivision Surface modifier to the accepted Cube.',
      coverage: [
        {
          capabilityId: 'geometry.subdivision_surface_modifier',
          stepIds: ['snowman.model.head'],
        },
      ],
    },
  ],
};

const evaluateSubdivisionSurface = (
  verifiedExternalResourceConsumers?: readonly {
    readonly consumerStepId: string;
    readonly resourceId: string;
    readonly resourceType: string;
  }[],
  shortcutProof = false,
  plan = subdivisionSurfacePlan(),
) =>
  evaluatePlanningQuality(
    {
      targetAdapterId: 'blender',
      catalogVersion: blenderActionCatalog.catalogVersion,
      capabilityCoverage: subdivisionSurfaceCoverage,
      plan,
    },
    blenderActionCatalog,
    {
      verifiedExternalResourceConsumers,
      ...(shortcutProof
        ? {
            shortcutProofAuthority: {
              replayId: '11111111-1111-4111-8111-111111111111',
              leafId: 'snowman.model.head',
              targetProfile: 'factory_cube_8_12_6' as const,
            },
          }
        : {}),
    },
  );

describe('planning quality baseline', () => {
  it('accepts the complete teachable snowman plan deterministically', () => {
    const requiredPhaseIds = ['geometry', 'materials', 'animation', 'render_setup', 'output'];
    const first = evaluate(snowmanPlan(), requiredPhaseIds);
    const second = evaluate(snowmanPlan(), requiredPhaseIds);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      valid: true,
      summary: {
        errorCount: 0,
        warningCount: 0,
        executableStepCount: 25,
        usedPhaseCount: 5,
      },
    });
    expect(first.phases.map((phase) => phase.phaseId)).toEqual(requiredPhaseIds);
  });

  it('accepts a non-snowman robot goal without requiring animation', () => {
    const benchmark = planningBenchmarkCaseSchema.parse(
      JSON.parse(
        readFileSync(resolve('protocol/fixtures/v1/planning/robot-preview.benchmark.json'), 'utf8'),
      ),
    );
    const report = evaluatePlanningQuality(
      {
        targetAdapterId: benchmark.targetAdapterId,
        catalogVersion: benchmark.catalogVersion,
        goal: benchmark.goal,
        requiredPhaseIds: benchmark.requiredPhaseIds,
        plan: benchmark.referencePlan,
      },
      historicalCatalog,
    );
    expect(report).toMatchObject({
      valid: true,
      plan: { id: 'robot-preview-baseline' },
      summary: { executableStepCount: 6, usedPhaseCount: 4 },
      phases: [
        { phaseId: 'geometry', used: true },
        { phaseId: 'materials', used: true },
        { phaseId: 'animation', required: false, used: false },
        { phaseId: 'render_setup', used: true },
        { phaseId: 'output', used: true },
      ],
    });
  });

  it('reports missing goal phases and mixed root groups without inventing a score', () => {
    const withoutAnimation = structuredClone(snowmanPlan());
    withoutAnimation.steps = withoutAnimation.steps.filter(
      (step) => !step.id.startsWith('snowman.animation'),
    );
    withoutAnimation.steps.find((step) => step.id === 'snowman.lighting.scene')!.dependsOn = [
      'snowman.materials.ground',
    ];
    const missing = evaluate(withoutAnimation, ['geometry', 'animation', 'output']);
    expect(missing.valid).toBe(false);
    expect(missing.findings).toContainEqual(
      expect.objectContaining({ code: 'phase.required_missing', phaseIds: ['animation'] }),
    );
    expect(missing).not.toHaveProperty('score');

    const mixed = structuredClone(snowmanPlan());
    mixed.steps.find((step) => step.id === 'snowman.materials')!.parentId = 'snowman.model';
    expect(evaluate(mixed).findings).toContainEqual(
      expect.objectContaining({ code: 'phase.mixed_group', stepIds: ['snowman.model'] }),
    );
  });

  it('detects missing resource dependencies and visible guidance evidence', () => {
    const missingDependency = structuredClone(snowmanPlan());
    missingDependency.steps.find((step) => step.id === 'snowman.render.preview')!.dependsOn = [];
    expect(evaluate(missingDependency).findings).toContainEqual(
      expect.objectContaining({ code: 'resource.missing_dependency' }),
    );

    const missingGuidance = structuredClone(snowmanPlan());
    const head = missingGuidance.steps.find((step) => step.id === 'snowman.model.head')!;
    head.anchors = [];
    head.expectedObservations = [];
    head.observationPolicy = undefined;
    expect(evaluate(missingGuidance).findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(['guidance.anchor_missing', 'guidance.observation_missing']),
    );
  });

  it('rejects a single Subdivision Surface leaf whose mutate target has no creator', () => {
    const report = evaluateSubdivisionSurface();

    expect(report.valid).toBe(false);
    expect(report.findings).toContainEqual(
      expect.objectContaining({
        code: 'resource.missing_creator',
        stepIds: ['snowman.model.head'],
      }),
    );
  });

  it('accepts a single Subdivision Surface leaf with an exact verified external resource tuple', () => {
    const report = evaluateSubdivisionSurface(
      [
        {
          consumerStepId: 'snowman.model.head',
          resourceId: 'tutorial.cube',
          resourceType: 'OBJECT',
        },
      ],
      true,
    );

    expect(report.valid).toBe(true);
    expect(report.findings).toContainEqual(
      expect.objectContaining({
        code: 'resource.verified_external_input',
        severity: 'warning',
        stepIds: ['snowman.model.head'],
      }),
    );
    expect(report.findings).not.toContainEqual(
      expect.objectContaining({ code: 'resource.missing_creator' }),
    );
  });

  it.each([
    ['consumer step', 'other.step', 'tutorial.cube', 'OBJECT'],
    ['resource id', 'snowman.model.head', 'other.cube', 'OBJECT'],
    ['resource type', 'snowman.model.head', 'tutorial.cube', 'MESH'],
  ])(
    'rejects a verified external resource tuple with the wrong %s',
    (_, stepId, resourceId, type) => {
      const report = evaluateSubdivisionSurface(
        [
          {
            consumerStepId: stepId,
            resourceId,
            resourceType: type,
          },
        ],
        true,
      );

      expect(report.valid).toBe(false);
      expect(report.findings).toContainEqual(
        expect.objectContaining({
          code: 'resource.missing_creator',
          stepIds: ['snowman.model.head'],
        }),
      );
      expect(report.findings).not.toContainEqual(
        expect.objectContaining({ code: 'resource.verified_external_input' }),
      );
    },
  );

  it('does not allow an ordinary proposal to supply the external-input tuple', () => {
    const report = evaluateSubdivisionSurface([
      {
        consumerStepId: 'snowman.model.head',
        resourceId: 'tutorial.cube',
        resourceType: 'OBJECT',
      },
    ]);

    expect(report.valid).toBe(false);
    expect(report.findings).toContainEqual(
      expect.objectContaining({ code: 'resource.missing_creator' }),
    );
    expect(report.findings).not.toContainEqual(
      expect.objectContaining({ code: 'resource.verified_external_input' }),
    );
  });

  it('rejects an arbitrary target even with shortcut proof authority', () => {
    const plan = subdivisionSurfacePlan();
    const leaf = plan.steps.find((step) => step.id === 'snowman.model.head')!;
    if (leaf.action === null) throw new Error('expected action');
    leaf.action.arguments['targetId'] = 'tutorial.other';
    const report = evaluateSubdivisionSurface(
      [
        {
          consumerStepId: leaf.id,
          resourceId: 'tutorial.other',
          resourceType: 'OBJECT',
        },
      ],
      true,
      plan,
    );

    expect(report.valid).toBe(false);
    expect(report.findings).toContainEqual(
      expect.objectContaining({ code: 'resource.missing_creator' }),
    );
  });

  it('degrades honestly for a historical catalog without phase metadata', () => {
    const historicalCatalogWithoutPhases = blenderActionCatalogs.find(
      (catalog) => catalog.catalogVersion === '1.1.0',
    )!;
    const report = evaluatePlanningQuality(
      {
        targetAdapterId: 'blender',
        catalogVersion: '1.1.0',
        requiredPhaseIds: [],
        plan: historicalSnowmanPlan(),
      },
      historicalCatalogWithoutPhases,
    );
    expect(report).toMatchObject({ valid: true, summary: { warningCount: 1 } });
    expect(report.findings[0]).toMatchObject({ code: 'phase.profile_unavailable' });
    expect(report.baselineVersion).toBe('1.0.0');
  });

  it('enforces catalog-grounded capability coverage without producing a score', () => {
    const plan = snowmanPlan();
    const validCoverage = {
      policyVersion: 'catalog_capability_coverage_v1' as const,
      requirements: [
        {
          requirementId: 'snowman-head',
          statement: 'Create the snowman head.',
          coverage: [
            {
              capabilityId: 'geometry.primitive_assembly',
              stepIds: ['snowman.model.head'],
            },
          ],
        },
      ],
    };
    const valid = evaluatePlanningQuality(
      {
        targetAdapterId: 'blender',
        catalogVersion: blenderActionCatalog.catalogVersion,
        requiredPhaseIds: [],
        capabilityCoverage: validCoverage,
        plan,
      },
      blenderActionCatalog,
    );
    expect(valid).toMatchObject({ valid: true, baselineVersion: '1.1.0' });
    expect(valid.capabilityCoverage).toEqual(validCoverage);
    expect(valid).not.toHaveProperty('score');

    const missing = evaluatePlanningQuality(
      {
        targetAdapterId: 'blender',
        catalogVersion: blenderActionCatalog.catalogVersion,
        plan,
      },
      blenderActionCatalog,
    );
    expect(missing.findings).toContainEqual(expect.objectContaining({ code: 'coverage.missing' }));

    const invalidCoverage = structuredClone(validCoverage);
    invalidCoverage.requirements = [
      {
        requirementId: 'invalid',
        statement: 'Invalid mappings.',
        coverage: [
          { capabilityId: 'unknown.capability', stepIds: ['missing.step'] },
          {
            capabilityId: 'geometry.primitive_assembly',
            stepIds: ['snowman.model', 'missing.step'],
          },
          { capabilityId: 'output.png_preview', stepIds: ['snowman.model.head'] },
        ],
      },
    ];
    const invalid = evaluatePlanningQuality(
      {
        targetAdapterId: 'blender',
        catalogVersion: blenderActionCatalog.catalogVersion,
        capabilityCoverage: invalidCoverage,
        plan,
      },
      blenderActionCatalog,
      { allowedCoverageStepIds: new Set(['snowman.render.preview']) },
    );
    expect(invalid.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        'coverage.unknown_capability',
        'coverage.step_missing',
        'coverage.step_not_executable',
        'coverage.action_mismatch',
        'coverage.step_out_of_scope',
      ]),
    );

    const unsupported = evaluatePlanningQuality(
      {
        targetAdapterId: 'blender',
        catalogVersion: historicalCatalog.catalogVersion,
        capabilityCoverage: validCoverage,
        plan,
      },
      historicalCatalog,
    );
    expect(unsupported.findings).toContainEqual(
      expect.objectContaining({ code: 'coverage.profile_unavailable' }),
    );
  });

  it('emits a strict versioned report contract', () => {
    const report = evaluate(snowmanPlan());
    expect(planningQualityReportSchema.parse(report)).toEqual(report);
    expect(planningQualityReportSchema.safeParse({ ...report, score: 1 }).success).toBe(false);

    for (const filename of [
      'planning-benchmark-case.schema.json',
      'planning-quality-evaluation-request.schema.json',
      'planning-quality-report.schema.json',
    ]) {
      const schema = JSON.parse(
        readFileSync(resolve('protocol/schemas/v1', filename), 'utf8'),
      ) as Record<string, unknown>;
      expect(schema.additionalProperties, filename).toBe(false);
    }
  });
});
