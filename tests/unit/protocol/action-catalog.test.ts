import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { blenderActionCatalog, blenderActionCatalogs } from '@operatingline/blender-action-catalog';
import {
  actionCatalogSchema,
  planningIntentSchema,
  planningContextSchema,
  planningPromptPacketSchema,
  planningQualityReportSchema,
  replanningPromptPacketSchema,
  validateActionCatalog,
} from '@operatingline/protocol';

describe('action catalog protocol', () => {
  it('validates the versioned Blender allowlist and argument contracts', () => {
    const catalog = actionCatalogSchema.parse(blenderActionCatalog);

    expect(catalog.catalogVersion).toBe('1.3.0');
    expect(catalog.adapterId).toBe('blender');
    expect(catalog.actions.map((action) => action.name)).toEqual([
      'blender.mesh.create_uv_sphere',
      'blender.mesh.create_plane',
      'blender.mesh.create_primitive_batch',
      'blender.material.create_and_assign',
      'blender.material.create_palette_and_assign',
      'blender.rig.create_armature',
      'blender.animation.create_pose_keyframes',
      'blender.render_scene.create',
      'blender.render_rig.create',
      'blender.render.execute_preview',
    ]);
    expect(
      catalog.actions.find((action) => action.name === 'blender.render.execute_preview')?.safety,
    ).toMatchObject({ sideEffect: 'managed_file_write', fileAccess: 'managed_temp' });
    expect(catalog.planningPhases?.map((phase) => phase.id)).toEqual([
      'geometry',
      'materials',
      'animation',
      'render_setup',
      'output',
    ]);
    expect(catalog.semanticCapabilities?.map((capability) => capability.id)).toEqual([
      'geometry.ground_plane',
      'geometry.primitive_assembly',
      'appearance.principled_palette',
      'animation.rigid_armature',
      'animation.rigid_pose_keyframes',
      'render.scene_setup',
      'output.png_preview',
    ]);
    expect(
      blenderActionCatalogs.map((versionedCatalog) => versionedCatalog.catalogVersion),
    ).toEqual(['1.0.0', '1.1.0', '1.2.0', '1.3.0']);
  });

  it('rejects duplicate actions and required argument names absent from properties', () => {
    const duplicate = structuredClone(blenderActionCatalog);
    duplicate.actions.push(structuredClone(duplicate.actions[0]!));
    expect(() => validateActionCatalog(duplicate)).toThrow('duplicate action');

    const unknownRequired = structuredClone(blenderActionCatalog);
    unknownRequired.actions[0]!.argumentsSchema.required?.push('missingProperty');
    expect(() => validateActionCatalog(unknownRequired)).toThrow(
      'requires unknown argument property',
    );

    const unknownKeyword = structuredClone(blenderActionCatalog);
    const propertySchema = unknownKeyword.actions[0]!.argumentsSchema.properties.resourceId as {
      format?: string;
    };
    propertySchema.format = 'uuid';
    expect(() => validateActionCatalog(unknownKeyword)).toThrow('unknown keyword format');

    const repeatedPhaseAction = structuredClone(blenderActionCatalog);
    repeatedPhaseAction.planningPhases![1]!.actionNames.push(
      repeatedPhaseAction.planningPhases![0]!.actionNames[0]!,
    );
    expect(() => validateActionCatalog(repeatedPhaseAction)).toThrow(
      'assigned to more than one planning phase',
    );

    const duplicateCapability = structuredClone(blenderActionCatalog);
    duplicateCapability.semanticCapabilities!.push(
      structuredClone(duplicateCapability.semanticCapabilities![0]!),
    );
    expect(() => validateActionCatalog(duplicateCapability)).toThrow(
      'duplicate semantic capability',
    );

    const unknownCapabilityAction = structuredClone(blenderActionCatalog);
    unknownCapabilityAction.semanticCapabilities![0]!.actionNames.push('blender.unknown.action');
    expect(() => validateActionCatalog(unknownCapabilityAction)).toThrow(
      'references unknown action',
    );

    const duplicateCapabilityAction = structuredClone(blenderActionCatalog);
    duplicateCapabilityAction.semanticCapabilities![0]!.actionNames.push(
      duplicateCapabilityAction.semanticCapabilities![0]!.actionNames[0]!,
    );
    expect(actionCatalogSchema.safeParse(duplicateCapabilityAction).success).toBe(false);
    expect(() => validateActionCatalog(duplicateCapabilityAction)).toThrow(
      'contains duplicate action',
    );

    const capabilitiesWithoutPhases = structuredClone(blenderActionCatalog);
    delete capabilitiesWithoutPhases.planningPhases;
    expect(() => validateActionCatalog(capabilitiesWithoutPhases)).toThrow(
      'cannot declare semantic capabilities without planning phases',
    );
  });

  it('accepts strict catalog capability coverage with unique structural ids', () => {
    const planningIntent = {
      goal: 'Build and render a colored primitive scene.',
      requiredPhaseIds: ['geometry', 'materials', 'render_setup', 'output'],
      capabilityCoverage: {
        policyVersion: 'catalog_capability_coverage_v1',
        requirements: [
          {
            requirementId: 'ground',
            statement: 'Add a ground plane.',
            coverage: [{ capabilityId: 'geometry.ground_plane', stepIds: ['step-ground'] }],
          },
        ],
      },
    } as const;

    expect(planningIntentSchema.parse(planningIntent)).toEqual(planningIntent);
    expect(
      planningIntentSchema.safeParse({
        ...planningIntent,
        capabilityCoverage: {
          ...planningIntent.capabilityCoverage,
          score: 1,
        },
      }).success,
    ).toBe(false);

    const duplicateRequirement = structuredClone(planningIntent);
    duplicateRequirement.capabilityCoverage.requirements.push(
      structuredClone(duplicateRequirement.capabilityCoverage.requirements[0]!),
    );
    expect(planningIntentSchema.safeParse(duplicateRequirement).success).toBe(false);

    const duplicateCapability = structuredClone(planningIntent);
    duplicateCapability.capabilityCoverage.requirements[0]!.coverage.push(
      structuredClone(duplicateCapability.capabilityCoverage.requirements[0]!.coverage[0]!),
    );
    expect(planningIntentSchema.safeParse(duplicateCapability).success).toBe(false);

    const duplicateStep = structuredClone(planningIntent);
    duplicateStep.capabilityCoverage.requirements[0]!.coverage[0]!.stepIds.push('step-ground');
    expect(planningIntentSchema.safeParse(duplicateStep).success).toBe(false);

    expect(
      planningIntentSchema.safeParse({
        goal: planningIntent.goal,
        requiredPhaseIds: planningIntent.requiredPhaseIds,
      }).success,
    ).toBe(true);
  });

  it('emits strict language-neutral catalog and planning-context schemas', () => {
    for (const filename of ['action-catalog.schema.json', 'planning-context.schema.json']) {
      const schema = JSON.parse(readFileSync(resolve('protocol/schemas/v1', filename), 'utf8')) as {
        additionalProperties?: boolean;
      };
      expect(schema.additionalProperties).toBe(false);
    }

    for (const filename of [
      'planning-prompt-packet.schema.json',
      'replanning-prompt-packet.schema.json',
    ]) {
      const schema = JSON.parse(readFileSync(resolve('protocol/schemas/v1', filename), 'utf8')) as {
        properties?: { formatVersion?: { enum?: string[] } };
      };
      expect(schema.properties?.formatVersion?.enum).toEqual(['1.0.0', '1.1.0']);
    }

    expect(
      planningContextSchema.safeParse({
        protocolVersion: '1.0.0',
        targetAdapterId: 'blender',
        goal: null,
        requestedPlanId: null,
        recommendedRevision: null,
        catalog: blenderActionCatalog,
        companionStates: [],
        constraints: {
          singleAdapterPlan: true,
          executableActionsMustBeLeaves: true,
          dependenciesMustReferenceExecutableActions: true,
          unknownActionsMustBeRejected: true,
          semanticAnchorsOnly: true,
          immutablePlanRevisions: true,
          humanApprovalRequired: true,
          executionOrder: 'dependsOn_topology_then_order_then_id',
        },
        submission: {
          toolName: 'operatingline.guide.propose',
          targetAdapterId: 'blender',
          description: 'Submit the complete plan.',
        },
        qualityGate: {
          toolName: 'operatingline.planning.evaluate',
          baselineVersion: '1.1.0',
          requiredPhaseSelection: 'planner_declared_from_goal',
          description: 'Evaluate phase coverage.',
        },
      }).success,
    ).toBe(true);
  });

  it('rejects planning context adapter mismatches and phase/gate mismatches', () => {
    const context = {
      protocolVersion: '1.1.0',
      targetAdapterId: 'blender',
      goal: null,
      requestedPlanId: null,
      recommendedRevision: null,
      catalog: blenderActionCatalog,
      companionStates: [],
      constraints: {
        singleAdapterPlan: true,
        executableActionsMustBeLeaves: true,
        dependenciesMustReferenceExecutableActions: true,
        unknownActionsMustBeRejected: true,
        semanticAnchorsOnly: true,
        immutablePlanRevisions: true,
        humanApprovalRequired: true,
        executionOrder: 'dependsOn_topology_then_order_then_id',
      },
      submission: {
        toolName: 'operatingline.guide.propose',
        targetAdapterId: 'blender',
        description: 'Submit the complete plan.',
      },
      qualityGate: {
        toolName: 'operatingline.planning.evaluate',
        baselineVersion: '1.1.0',
        requiredPhaseSelection: 'planner_declared_from_goal',
        description: 'Evaluate phase coverage.',
      },
    } as const;

    expect(planningContextSchema.safeParse(context).success).toBe(true);
    expect(
      planningContextSchema.safeParse({
        ...context,
        qualityGate: { ...context.qualityGate, baselineVersion: '1.0.0' },
      }).success,
    ).toBe(false);

    expect(
      planningContextSchema.safeParse({
        ...context,
        companionStates: [
          {
            protocolVersion: '1.1.0',
            reportId: '00000000-0000-4000-8000-000000000010',
            sequence: 1,
            adapterId: 'other',
            instanceId: '00000000-0000-4000-8000-000000000011',
            companionVersion: '0.1.0',
            hostVersion: '5.1.1',
            plan: null,
            phase: 'idle',
            activeStepId: null,
            completedStepIds: [],
            transition: 'snapshot',
            stepId: null,
            observations: [],
            error: null,
            occurredAt: '2026-08-05T00:00:00.000Z',
          },
        ],
      }).success,
    ).toBe(false);
    expect(planningContextSchema.safeParse({ ...context, targetAdapterId: 'other' }).success).toBe(
      false,
    );
    expect(
      planningContextSchema.safeParse({
        ...context,
        submission: { ...context.submission, targetAdapterId: 'other' },
      }).success,
    ).toBe(false);
    expect(planningContextSchema.safeParse({ ...context, qualityGate: undefined }).success).toBe(
      false,
    );

    const historicalContext = {
      ...context,
      catalog: blenderActionCatalogs[0],
      qualityGate: undefined,
    };
    expect(planningContextSchema.safeParse(historicalContext).success).toBe(true);
    expect(
      planningContextSchema.safeParse({
        ...historicalContext,
        qualityGate: context.qualityGate,
      }).success,
    ).toBe(false);

    expect(
      planningContextSchema.safeParse({
        ...context,
        catalog: blenderActionCatalogs[2],
        qualityGate: { ...context.qualityGate, baselineVersion: '1.0.0' },
      }).success,
    ).toBe(true);
    expect(
      planningContextSchema.safeParse({
        ...context,
        catalog: blenderActionCatalogs[2],
        qualityGate: { ...context.qualityGate, baselineVersion: '1.1.0' },
      }).success,
    ).toBe(false);
  });

  it('selects packet format 1.1.0 exactly when semantic capabilities exist', () => {
    const planningContext = {
      protocolVersion: '1.1.0',
      targetAdapterId: 'blender',
      goal: 'Build a scene.',
      requestedPlanId: 'scene-plan',
      recommendedRevision: 1,
      catalog: blenderActionCatalog,
      companionStates: [],
      constraints: {
        singleAdapterPlan: true,
        executableActionsMustBeLeaves: true,
        dependenciesMustReferenceExecutableActions: true,
        unknownActionsMustBeRejected: true,
        semanticAnchorsOnly: true,
        immutablePlanRevisions: true,
        humanApprovalRequired: true,
        executionOrder: 'dependsOn_topology_then_order_then_id',
      },
      submission: {
        toolName: 'operatingline.guide.propose',
        targetAdapterId: 'blender',
        description: 'Submit the plan.',
      },
      qualityGate: {
        toolName: 'operatingline.planning.evaluate',
        baselineVersion: '1.1.0',
        requiredPhaseSelection: 'planner_declared_from_goal',
        description: 'Evaluate the plan.',
      },
    } as const;
    const planningPacket = {
      formatVersion: '1.1.0',
      context: planningContext,
      responseContract: { mediaType: 'application/json', schema: {} },
      workflow: {
        evaluateToolName: 'operatingline.planning.evaluate',
        submitToolName: 'operatingline.guide.propose',
        instructions: ['Return JSON.'],
      },
      renderedPrompt: 'Prompt.',
    } as const;
    expect(planningPromptPacketSchema.safeParse(planningPacket).success).toBe(true);
    expect(
      planningPromptPacketSchema.safeParse({ ...planningPacket, formatVersion: '1.0.0' }).success,
    ).toBe(false);

    const historicalPlanningPacket = {
      ...planningPacket,
      formatVersion: '1.0.0',
      context: {
        ...planningContext,
        catalog: blenderActionCatalogs[2],
        qualityGate: { ...planningContext.qualityGate, baselineVersion: '1.0.0' },
      },
    } as const;
    expect(planningPromptPacketSchema.safeParse(historicalPlanningPacket).success).toBe(true);
    expect(
      planningPromptPacketSchema.safeParse({
        ...historicalPlanningPacket,
        formatVersion: '1.1.0',
      }).success,
    ).toBe(false);

    const basePlan = JSON.parse(
      readFileSync(resolve('protocol/fixtures/v1/snowman.plan.json'), 'utf8'),
    ) as unknown;
    const revisionRequestBase = {
      protocolVersion: '1.1.0',
      requestId: '00000000-0000-4000-8000-000000000001',
      adapterId: 'blender',
      instanceId: '00000000-0000-4000-8000-000000000002',
      basePlan,
      references: [{ nodeId: 'snowman.model.head', nodeNumber: '1.2.3' }],
      message: 'Make the head larger.',
      revisionThread: {
        threadId: '00000000-0000-4000-8000-000000000001',
        turn: 1,
        parentRequestId: null,
      },
      occurredAt: '2026-08-05T00:00:00.000Z',
    } as const;
    const scope = {
      policyVersion: 'referenced_subtrees_v1',
      mode: 'referenced_subtrees',
      referencedRootIds: ['snowman.model.head'],
      normalizedRootIds: ['snowman.model.head'],
      rules: {
        completePlanRequired: true,
        planTitleMutable: false,
        rootStepIdMutable: false,
        outsideScopeMutable: false,
        referencedRootAttachmentMutable: false,
        descendantMoves: 'within_same_normalized_root',
        newSteps: 'within_normalized_roots',
        noOpAllowed: false,
      },
    } as const;
    const replanningPacket = {
      formatVersion: '1.1.0',
      operation: 'local_replan',
      context: {
        revisionRequest: {
          ...revisionRequestBase,
          catalogVersion: blenderActionCatalog.catalogVersion,
        },
        targetRevision: 5,
        catalog: blenderActionCatalog,
        companionState: null,
        scope,
      },
      responseContract: { mediaType: 'application/json', schema: {} },
      workflow: {
        evaluateToolName: 'operatingline.planning.evaluate',
        submitToolName: 'operatingline.replan.propose',
        instructions: ['Return JSON.'],
      },
      renderedPrompt: 'Prompt.',
    } as const;
    expect(replanningPromptPacketSchema.safeParse(replanningPacket).success).toBe(true);
    expect(
      replanningPromptPacketSchema.safeParse({
        ...replanningPacket,
        formatVersion: '1.0.0',
      }).success,
    ).toBe(false);

    const historicalReplanningPacket = {
      ...replanningPacket,
      formatVersion: '1.0.0',
      context: {
        ...replanningPacket.context,
        revisionRequest: {
          ...revisionRequestBase,
          catalogVersion: blenderActionCatalogs[2]!.catalogVersion,
        },
        catalog: blenderActionCatalogs[2],
      },
    } as const;
    expect(replanningPromptPacketSchema.safeParse(historicalReplanningPacket).success).toBe(true);
    expect(
      replanningPromptPacketSchema.safeParse({
        ...historicalReplanningPacket,
        formatVersion: '1.1.0',
      }).success,
    ).toBe(false);
  });

  it('keeps capability coverage out of quality baseline 1.0 reports', () => {
    const capabilityCoverage = {
      policyVersion: 'catalog_capability_coverage_v1',
      requirements: [
        {
          requirementId: 'ground',
          statement: 'Add a ground plane.',
          coverage: [{ capabilityId: 'geometry.ground_plane', stepIds: ['step-ground'] }],
        },
      ],
    } as const;
    const report = {
      protocolVersion: '1.1.0',
      baselineVersion: '1.1.0',
      targetAdapterId: 'blender',
      catalogVersion: '1.3.0',
      goal: 'Build a scene.',
      plan: { id: 'scene-plan', revision: 1 },
      requiredPhaseIds: [],
      valid: true,
      summary: {
        errorCount: 0,
        warningCount: 0,
        executableStepCount: 1,
        groupStepCount: 0,
        usedPhaseCount: 0,
        requiredPhaseCount: 0,
      },
      phases: [],
      capabilityCoverage,
      findings: [],
    } as const;

    expect(planningQualityReportSchema.safeParse(report).success).toBe(true);
    expect(
      planningQualityReportSchema.safeParse({ ...report, capabilityCoverage: undefined }).success,
    ).toBe(false);
    expect(
      planningQualityReportSchema.safeParse({
        ...report,
        capabilityCoverage: undefined,
        valid: false,
        summary: { ...report.summary, errorCount: 1 },
        findings: [
          {
            code: 'coverage.missing',
            severity: 'error',
            message: 'Capability coverage is required.',
            stepIds: [],
            phaseIds: [],
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      planningQualityReportSchema.safeParse({
        ...report,
        valid: false,
        summary: { ...report.summary, errorCount: 1 },
        findings: [
          {
            code: 'coverage.missing',
            severity: 'error',
            message: 'Capability coverage is required.',
            stepIds: [],
            phaseIds: [],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      planningQualityReportSchema.safeParse({ ...report, baselineVersion: '1.0.0' }).success,
    ).toBe(false);
    expect(
      planningQualityReportSchema.safeParse({
        ...report,
        baselineVersion: '1.0.0',
        capabilityCoverage: undefined,
      }).success,
    ).toBe(true);
  });
});
