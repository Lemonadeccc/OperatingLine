import {
  actionCatalogSchema,
  guideProtocolVersion,
  planningQualityBaselineVersion,
  planningQualityEvaluationRequestSchema,
  planningQualityReportSchema,
  type ActionCatalog,
  type GuidePlan,
  type GuideStep,
  type PlanningQualityEvaluationRequest,
  type PlanningQualityFinding,
  type PlanningQualityReport,
} from '@operatingline/protocol';

import {
  validateGuidePlanAgainstActionCatalog,
  validateProposalTarget,
} from './guide-validation.js';

function valuesAtArgumentPath(
  argumentsValue: Record<string, unknown>,
  argumentPath: string,
): unknown[] {
  if (argumentPath.startsWith('$managed.')) {
    return [argumentPath.slice('$managed.'.length)];
  }
  let values: unknown[] = [argumentsValue];
  for (const rawSegment of argumentPath.split('.')) {
    const expandsArray = rawSegment.endsWith('[]');
    const segment = expandsArray ? rawSegment.slice(0, -2) : rawSegment;
    const nextValues: unknown[] = [];
    for (const value of values) {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        continue;
      }
      const child = (value as Record<string, unknown>)[segment];
      if (expandsArray) {
        if (Array.isArray(child)) {
          nextValues.push(...child);
        }
      } else if (child !== undefined) {
        nextValues.push(child);
      }
    }
    values = nextValues;
  }
  return values;
}

function directRootChild(
  step: GuideStep,
  rootStepId: string,
  stepsById: ReadonlyMap<string, GuideStep>,
): GuideStep | null {
  let current = step;
  while (current.parentId !== rootStepId) {
    if (current.parentId === null) {
      return null;
    }
    const parent = stepsById.get(current.parentId);
    if (parent === undefined) {
      return null;
    }
    current = parent;
  }
  return current;
}

function dependencyAncestors(plan: GuidePlan): ReadonlyMap<string, ReadonlySet<string>> {
  const dependencies = new Map(plan.steps.map((step) => [step.id, step.dependsOn]));
  const memo = new Map<string, ReadonlySet<string>>();
  const collect = (stepId: string): ReadonlySet<string> => {
    const cached = memo.get(stepId);
    if (cached !== undefined) {
      return cached;
    }
    const result = new Set<string>();
    for (const dependency of dependencies.get(stepId) ?? []) {
      result.add(dependency);
      for (const ancestor of collect(dependency)) {
        result.add(ancestor);
      }
    }
    memo.set(stepId, result);
    return result;
  };
  for (const step of plan.steps) {
    collect(step.id);
  }
  return memo;
}

function sortedFindings(findings: PlanningQualityFinding[]): PlanningQualityFinding[] {
  return findings.sort(
    (left, right) =>
      (left.severity === right.severity ? 0 : left.severity === 'error' ? -1 : 1) ||
      left.code.localeCompare(right.code) ||
      left.stepIds.join(',').localeCompare(right.stepIds.join(',')) ||
      left.message.localeCompare(right.message),
  );
}

export function evaluatePlanningQuality(
  input: PlanningQualityEvaluationRequest,
  catalogInput: ActionCatalog,
  options: {
    readonly allowedCoverageStepIds?: ReadonlySet<string>;
    readonly verifiedExternalResourceConsumers?: readonly {
      readonly consumerStepId: string;
      readonly resourceId: string;
      readonly resourceType: string;
    }[];
    readonly shortcutProofAuthority?: {
      readonly replayId: string;
      readonly leafId: string;
      readonly targetProfile: 'factory_cube_8_12_6';
    };
    readonly managedActionReplayAuthority?: {
      readonly replayId: string;
      readonly leafId: string;
    } & (
      | {
          readonly actionName:
            | 'blender.modifier.add_bevel'
            | 'blender.modifier.add_mirror'
            | 'blender.modifier.add_solidify'
            | 'blender.modifier.add_subdivision_surface';
          readonly targetId: string;
        }
      | {
          readonly actionName:
            'blender.material.create_and_assign' | 'blender.material.create_palette_and_assign';
          readonly targetIds: readonly string[];
        }
    );
  } = {},
): PlanningQualityReport {
  const request = planningQualityEvaluationRequestSchema.parse(input);
  const catalog = actionCatalogSchema.parse(catalogInput);
  if (catalog.adapterId !== request.targetAdapterId) {
    throw new Error(
      `Planning quality catalog targets ${catalog.adapterId}, not ${request.targetAdapterId}`,
    );
  }
  if (request.catalogVersion !== undefined && request.catalogVersion !== catalog.catalogVersion) {
    throw new Error(
      `Planning quality catalog ${catalog.catalogVersion} does not match requested ${request.catalogVersion}`,
    );
  }

  const findings: PlanningQualityFinding[] = [];
  const verifiedExternalResourceConsumerKeys = new Set<string>();
  const verifiedExternalResourceConsumers = options.verifiedExternalResourceConsumers ?? [];
  const shortcutProofAuthority = options.shortcutProofAuthority;
  if (verifiedExternalResourceConsumers.length > 0 && shortcutProofAuthority !== undefined) {
    const shortcutStep = request.plan.steps.find(
      (step) => step.id === shortcutProofAuthority.leafId,
    );
    const action = shortcutStep?.action;
    const exactShortcutBoundary =
      shortcutProofAuthority.targetProfile === 'factory_cube_8_12_6' &&
      request.targetAdapterId === 'blender' &&
      action?.adapterId === 'blender' &&
      action.name === 'blender.modifier.add_subdivision_surface' &&
      action.arguments['targetId'] === 'tutorial.cube' &&
      action.arguments['modifierId'] === 'tutorial.cube.subdivision_surface' &&
      action.arguments['modifierName'] === 'OperatingLine.Cube.SubdivisionSurface' &&
      shortcutStep?.anchors.filter((anchor) => anchor.kind === 'object').length === 1 &&
      shortcutStep.anchors.some(
        (anchor) => anchor.kind === 'object' && anchor.objectName === 'Cube',
      );
    const exactTuple =
      verifiedExternalResourceConsumers.length === 1
        ? verifiedExternalResourceConsumers[0]
        : undefined;
    if (
      exactShortcutBoundary &&
      exactTuple?.consumerStepId === shortcutProofAuthority.leafId &&
      exactTuple.resourceId === 'tutorial.cube' &&
      exactTuple.resourceType === 'OBJECT'
    ) {
      verifiedExternalResourceConsumerKeys.add(
        `${exactTuple.consumerStepId}\u0000${exactTuple.resourceType}\u0000${exactTuple.resourceId}`,
      );
    }
  }
  const managedActionReplayAuthority = options.managedActionReplayAuthority;
  if (verifiedExternalResourceConsumers.length > 0 && managedActionReplayAuthority !== undefined) {
    const replayStep = request.plan.steps.find(
      (step) => step.id === managedActionReplayAuthority.leafId,
    );
    const action = replayStep?.action;
    const targetId = action?.arguments['targetId'];
    const modifierId = action?.arguments['modifierId'];
    const axis = action?.arguments['axis'];
    const expectedObservation = replayStep?.expectedObservations[0];
    const observationParameters = expectedObservation?.parameters;
    const authorityTargetId =
      'targetId' in managedActionReplayAuthority
        ? managedActionReplayAuthority.targetId
        : undefined;
    const exactMirrorBoundary =
      managedActionReplayAuthority.actionName === 'blender.modifier.add_mirror' &&
      action?.name === 'blender.modifier.add_mirror' &&
      ['X', 'Y', 'Z'].includes(String(axis)) &&
      Object.keys(action.arguments).length === 4 &&
      observationParameters !== undefined &&
      Object.keys(observationParameters).length === 4 &&
      observationParameters['modifierType'] === 'MIRROR' &&
      observationParameters['axis'] === axis;
    const thickness = action?.arguments['thickness'];
    const offset = action?.arguments['offset'];
    const exactSolidifyBoundary =
      managedActionReplayAuthority.actionName === 'blender.modifier.add_solidify' &&
      action?.name === 'blender.modifier.add_solidify' &&
      typeof thickness === 'number' &&
      Number.isFinite(thickness) &&
      thickness >= 0.0001 &&
      thickness <= 100 &&
      typeof offset === 'number' &&
      Number.isFinite(offset) &&
      offset >= -1 &&
      offset <= 1 &&
      Object.keys(action.arguments).length === 5 &&
      observationParameters !== undefined &&
      Object.keys(observationParameters).length === 9 &&
      observationParameters['modifierType'] === 'SOLIDIFY' &&
      observationParameters['thickness'] === thickness &&
      observationParameters['offset'] === offset &&
      observationParameters['solidifyMode'] === 'EXTRUDE' &&
      observationParameters['useEvenOffset'] === true &&
      observationParameters['useRim'] === true &&
      observationParameters['useRimOnly'] === false;
    const width = action?.arguments['width'];
    const segments = action?.arguments['segments'];
    const angleLimit = action?.arguments['angleLimit'];
    const exactBevelBoundary =
      managedActionReplayAuthority.actionName === 'blender.modifier.add_bevel' &&
      action?.name === 'blender.modifier.add_bevel' &&
      typeof width === 'number' &&
      Number.isFinite(width) &&
      width >= 0.0001 &&
      width <= 100 &&
      Number.isSafeInteger(segments) &&
      (segments as number) >= 1 &&
      (segments as number) <= 16 &&
      typeof angleLimit === 'number' &&
      Number.isFinite(angleLimit) &&
      angleLimit >= 0 &&
      angleLimit <= Math.PI &&
      Object.keys(action.arguments).length === 6 &&
      observationParameters !== undefined &&
      Object.keys(observationParameters).length === 6 &&
      observationParameters['modifierType'] === 'BEVEL' &&
      observationParameters['width'] === width &&
      observationParameters['segments'] === segments &&
      observationParameters['angleLimit'] === angleLimit;
    const viewportLevel = action?.arguments['viewportLevel'];
    const exactSubdivisionSurfaceBoundary =
      managedActionReplayAuthority.actionName === 'blender.modifier.add_subdivision_surface' &&
      action?.name === 'blender.modifier.add_subdivision_surface' &&
      Number.isSafeInteger(viewportLevel) &&
      (viewportLevel as number) >= 1 &&
      (viewportLevel as number) <= 3 &&
      Object.keys(action.arguments).length === 4 &&
      observationParameters !== undefined &&
      Object.keys(observationParameters).length === 17 &&
      observationParameters['modifierType'] === 'SUBSURF' &&
      observationParameters['levels'] === viewportLevel &&
      observationParameters['renderLevels'] === 2 &&
      observationParameters['subdivisionType'] === 'CATMULL_CLARK' &&
      observationParameters['quality'] === 3 &&
      observationParameters['showOnlyControlEdges'] === true &&
      observationParameters['useCreases'] === true &&
      observationParameters['useLimitSurface'] === true &&
      observationParameters['boundarySmooth'] === 'ALL' &&
      observationParameters['uvSmooth'] === 'PRESERVE_BOUNDARIES' &&
      observationParameters['useCustomNormals'] === false &&
      observationParameters['showViewport'] === true &&
      observationParameters['showRender'] === true &&
      observationParameters['showInEditMode'] === true &&
      observationParameters['showOnCage'] === false;
    const exactManagedActionBoundary =
      request.targetAdapterId === 'blender' &&
      action?.adapterId === 'blender' &&
      action.name === managedActionReplayAuthority.actionName &&
      targetId === authorityTargetId &&
      typeof modifierId === 'string' &&
      modifierId.length > 0 &&
      typeof action.arguments['modifierName'] === 'string' &&
      (exactBevelBoundary ||
        exactMirrorBoundary ||
        exactSolidifyBoundary ||
        exactSubdivisionSurfaceBoundary) &&
      replayStep?.anchors.filter((anchor) => anchor.kind === 'object').length === 1 &&
      replayStep.anchors.filter((anchor) => anchor.kind === 'owned_control').length === 1 &&
      replayStep.anchors.some(
        (anchor) =>
          anchor.kind === 'owned_control' &&
          anchor.surfaceId === 'modifier.stack' &&
          anchor.controlId === modifierId,
      ) &&
      replayStep.expectedObservations.length === 1 &&
      expectedObservation?.kind === 'modifier_ready' &&
      observationParameters?.['targetId'] === targetId &&
      observationParameters['modifierId'] === modifierId;
    const materialTargets = action?.arguments['targets'];
    const materialBaseColor = action?.arguments['baseColor'];
    const exactSingleMaterialBoundary =
      managedActionReplayAuthority.actionName === 'blender.material.create_and_assign' &&
      request.targetAdapterId === 'blender' &&
      action?.adapterId === 'blender' &&
      action.name === 'blender.material.create_and_assign' &&
      Object.keys(action.arguments).length === 6 &&
      typeof action.arguments['materialId'] === 'string' &&
      /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(action.arguments['materialId']) &&
      typeof action.arguments['materialName'] === 'string' &&
      action.arguments['materialName'].startsWith('OperatingLine.') &&
      Array.isArray(materialTargets) &&
      materialTargets.length >= 1 &&
      materialTargets.length <= 64 &&
      materialTargets.every(
        (candidate) =>
          typeof candidate === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(candidate),
      ) &&
      new Set(materialTargets).size === materialTargets.length &&
      JSON.stringify(materialTargets) === JSON.stringify(managedActionReplayAuthority.targetIds) &&
      Array.isArray(materialBaseColor) &&
      materialBaseColor.length === 4 &&
      materialBaseColor.every(
        (component) =>
          typeof component === 'number' &&
          Number.isFinite(component) &&
          component >= 0 &&
          component <= 1,
      ) &&
      typeof action.arguments['roughness'] === 'number' &&
      Number.isFinite(action.arguments['roughness']) &&
      action.arguments['roughness'] >= 0 &&
      action.arguments['roughness'] <= 1 &&
      typeof action.arguments['metallic'] === 'number' &&
      Number.isFinite(action.arguments['metallic']) &&
      action.arguments['metallic'] >= 0 &&
      action.arguments['metallic'] <= 1 &&
      replayStep?.expectedObservations.length === 1 &&
      expectedObservation?.kind === 'material_assigned' &&
      observationParameters !== undefined &&
      Object.keys(observationParameters).length === 2 &&
      observationParameters['materialId'] === action.arguments['materialId'] &&
      JSON.stringify(observationParameters['targets']) === JSON.stringify(materialTargets);
    const paletteMaterials = action?.arguments['materials'];
    const paletteDefinitions = Array.isArray(paletteMaterials)
      ? paletteMaterials.filter(
          (material): material is Record<string, unknown> =>
            material !== null && typeof material === 'object' && !Array.isArray(material),
        )
      : [];
    const paletteTargetIds = paletteDefinitions.flatMap((material) =>
      Array.isArray(material['targets']) ? material['targets'] : [],
    );
    const paletteMaterialIds = paletteDefinitions.map((material) => material['materialId']);
    const paletteMaterialNames = paletteDefinitions.map((material) => material['materialName']);
    const exactPaletteBoundary =
      managedActionReplayAuthority.actionName === 'blender.material.create_palette_and_assign' &&
      request.targetAdapterId === 'blender' &&
      action?.adapterId === 'blender' &&
      action.name === 'blender.material.create_palette_and_assign' &&
      Object.keys(action.arguments).length === 1 &&
      Array.isArray(paletteMaterials) &&
      paletteMaterials.length >= 1 &&
      paletteMaterials.length <= 8 &&
      paletteDefinitions.length === paletteMaterials.length &&
      paletteDefinitions.every((material) => {
        const targets = material['targets'];
        const baseColor = material['baseColor'];
        return (
          Object.keys(material).length === 6 &&
          typeof material['materialId'] === 'string' &&
          /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(material['materialId']) &&
          typeof material['materialName'] === 'string' &&
          material['materialName'].startsWith('OperatingLine.') &&
          Array.isArray(targets) &&
          targets.length >= 1 &&
          targets.length <= 64 &&
          targets.every(
            (targetId) =>
              typeof targetId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(targetId),
          ) &&
          new Set(targets).size === targets.length &&
          Array.isArray(baseColor) &&
          baseColor.length === 4 &&
          baseColor.every(
            (component) =>
              typeof component === 'number' &&
              Number.isFinite(component) &&
              component >= 0 &&
              component <= 1,
          ) &&
          typeof material['roughness'] === 'number' &&
          Number.isFinite(material['roughness']) &&
          material['roughness'] >= 0 &&
          material['roughness'] <= 1 &&
          typeof material['metallic'] === 'number' &&
          Number.isFinite(material['metallic']) &&
          material['metallic'] >= 0 &&
          material['metallic'] <= 1
        );
      }) &&
      new Set(paletteMaterialIds).size === paletteMaterialIds.length &&
      new Set(paletteMaterialNames).size === paletteMaterialNames.length &&
      new Set(paletteTargetIds).size === paletteTargetIds.length &&
      JSON.stringify(paletteTargetIds) === JSON.stringify(managedActionReplayAuthority.targetIds) &&
      replayStep?.expectedObservations.length === paletteDefinitions.length &&
      replayStep.expectedObservations.every((observation, index) => {
        const definition = paletteDefinitions[index];
        const targets = definition?.['targets'];
        const observationTargets = observation.parameters['targets'];
        if (
          definition === undefined ||
          observation.kind !== 'material_assigned' ||
          Object.keys(observation.parameters).length !== 2 ||
          observation.parameters['materialId'] !== definition['materialId'] ||
          !Array.isArray(targets) ||
          !Array.isArray(observationTargets) ||
          observationTargets.length < 1
        ) {
          return false;
        }
        let cursor = 0;
        return observationTargets.every((targetId) => {
          const next = targets.indexOf(targetId, cursor);
          if (next < 0) return false;
          cursor = next + 1;
          return true;
        });
      });
    const exactMaterialBoundary = exactSingleMaterialBoundary || exactPaletteBoundary;
    if (exactMaterialBoundary) {
      const exactConsumerKeys = new Set(
        verifiedExternalResourceConsumers.map(
          (consumer) =>
            `${consumer.consumerStepId}\u0000${consumer.resourceType}\u0000${consumer.resourceId}`,
        ),
      );
      const expectedConsumerKeys = new Set(
        managedActionReplayAuthority.targetIds.map(
          (resourceId) => `${managedActionReplayAuthority.leafId}\u0000OBJECT[]\u0000${resourceId}`,
        ),
      );
      if (
        exactConsumerKeys.size === expectedConsumerKeys.size &&
        [...expectedConsumerKeys].every((key) => exactConsumerKeys.has(key))
      ) {
        for (const key of expectedConsumerKeys) verifiedExternalResourceConsumerKeys.add(key);
      }
    }
    const exactTuple =
      verifiedExternalResourceConsumers.length === 1
        ? verifiedExternalResourceConsumers[0]
        : undefined;
    if (
      exactManagedActionBoundary &&
      exactTuple?.consumerStepId === managedActionReplayAuthority.leafId &&
      exactTuple.resourceId === authorityTargetId &&
      exactTuple.resourceType === 'OBJECT'
    ) {
      verifiedExternalResourceConsumerKeys.add(
        `${exactTuple.consumerStepId}\u0000${exactTuple.resourceType}\u0000${exactTuple.resourceId}`,
      );
    }
  }
  const findingKeys = new Set<string>();
  const addFinding = (finding: PlanningQualityFinding): void => {
    const key = JSON.stringify(finding);
    if (!findingKeys.has(key)) {
      findingKeys.add(key);
      findings.push(finding);
    }
  };

  let structureValid = true;
  try {
    validateProposalTarget(request.plan, request.targetAdapterId);
  } catch (error) {
    structureValid = false;
    addFinding({
      code: 'plan.structure',
      severity: 'error',
      message: error instanceof Error ? error.message : 'Guide plan structure is invalid',
      stepIds: [],
      phaseIds: [],
    });
  }
  let catalogValid = true;
  try {
    validateGuidePlanAgainstActionCatalog(request.plan, catalog);
  } catch (error) {
    catalogValid = false;
    addFinding({
      code: 'plan.catalog_contract',
      severity: 'error',
      message: error instanceof Error ? error.message : 'Guide plan violates the action catalog',
      stepIds: [],
      phaseIds: [],
    });
  }

  const requiredPhaseIds = new Set(request.requiredPhaseIds);
  const planningPhases = [...(catalog.planningPhases ?? [])].sort(
    (left, right) => left.order - right.order || left.id.localeCompare(right.id),
  );
  const knownPhaseIds = new Set(planningPhases.map((phase) => phase.id));
  for (const requiredPhaseId of request.requiredPhaseIds) {
    if (!knownPhaseIds.has(requiredPhaseId)) {
      addFinding({
        code: 'phase.unknown_required',
        severity: 'error',
        message: `Required planning phase ${requiredPhaseId} is absent from ${catalog.adapterId}@${catalog.catalogVersion}`,
        stepIds: [],
        phaseIds: [requiredPhaseId],
      });
    }
  }

  const actionPhaseIds = new Map<string, string>();
  const phaseActionStepIds = new Map<string, Set<string>>();
  const phaseGroupStepIds = new Map<string, Set<string>>();
  for (const phase of planningPhases) {
    phaseActionStepIds.set(phase.id, new Set());
    phaseGroupStepIds.set(phase.id, new Set());
    for (const actionName of phase.actionNames) {
      actionPhaseIds.set(actionName, phase.id);
    }
  }

  const executableSteps = request.plan.steps.filter(
    (step): step is GuideStep & { action: NonNullable<GuideStep['action']> } =>
      step.action !== null,
  );
  const stepsById = new Map(request.plan.steps.map((step) => [step.id, step]));

  const semanticCapabilities = catalog.semanticCapabilities;
  if (semanticCapabilities === undefined) {
    if (request.capabilityCoverage !== undefined) {
      addFinding({
        code: 'coverage.profile_unavailable',
        severity: 'error',
        message: `Action catalog ${catalog.adapterId}@${catalog.catalogVersion} has no semantic capability profile`,
        stepIds: [],
        phaseIds: [],
      });
    }
  } else if (request.capabilityCoverage === undefined) {
    addFinding({
      code: 'coverage.missing',
      severity: 'error',
      message: `A concrete requirement-to-capability-to-step coverage mapping is required for ${catalog.adapterId}@${catalog.catalogVersion}`,
      stepIds: [],
      phaseIds: [],
    });
  } else {
    const capabilitiesById = new Map(
      semanticCapabilities.map((capability) => [capability.id, capability] as const),
    );
    for (const requirement of request.capabilityCoverage.requirements) {
      for (const coverage of requirement.coverage) {
        const capability = capabilitiesById.get(coverage.capabilityId);
        if (capability === undefined) {
          addFinding({
            code: 'coverage.unknown_capability',
            severity: 'error',
            message: `Requirement ${requirement.requirementId} references unknown capability ${coverage.capabilityId}`,
            stepIds: [...coverage.stepIds].sort(),
            phaseIds: [],
          });
        }
        const allowedActions = new Set(capability?.actionNames ?? []);
        for (const stepId of coverage.stepIds) {
          const step = stepsById.get(stepId);
          if (step === undefined) {
            addFinding({
              code: 'coverage.step_missing',
              severity: 'error',
              message: `Requirement ${requirement.requirementId} maps capability ${coverage.capabilityId} to nonexistent step ${stepId}`,
              stepIds: [stepId],
              phaseIds: [],
            });
            continue;
          }
          if (step.action === null) {
            addFinding({
              code: 'coverage.step_not_executable',
              severity: 'error',
              message: `Requirement ${requirement.requirementId} maps capability ${coverage.capabilityId} to actionless step ${stepId}`,
              stepIds: [stepId],
              phaseIds: [],
            });
            continue;
          }
          if (capability !== undefined && !allowedActions.has(step.action.name)) {
            addFinding({
              code: 'coverage.action_mismatch',
              severity: 'error',
              message: `Step ${stepId} action ${step.action.name} does not implement capability ${capability.id}`,
              stepIds: [stepId],
              phaseIds: [],
            });
          }
          if (
            options.allowedCoverageStepIds !== undefined &&
            !options.allowedCoverageStepIds.has(stepId)
          ) {
            addFinding({
              code: 'coverage.step_out_of_scope',
              severity: 'error',
              message: `Step ${stepId} is outside the allowed capability coverage scope`,
              stepIds: [stepId],
              phaseIds: [],
            });
          }
        }
      }
    }
  }

  if (planningPhases.length === 0) {
    addFinding({
      code: 'phase.profile_unavailable',
      severity: request.requiredPhaseIds.length > 0 ? 'error' : 'warning',
      message: `Action catalog ${catalog.adapterId}@${catalog.catalogVersion} has no planning phase profile`,
      stepIds: [],
      phaseIds: request.requiredPhaseIds,
    });
  } else if (structureValid && catalogValid) {
    const groupPhases = new Map<string, Set<string>>();
    for (const step of executableSteps) {
      const phaseId = actionPhaseIds.get(step.action.name);
      if (phaseId === undefined) {
        addFinding({
          code: 'phase.unclassified_action',
          severity: 'error',
          message: `Action ${step.action.name} has no planning phase`,
          stepIds: [step.id],
          phaseIds: [],
        });
        continue;
      }
      phaseActionStepIds.get(phaseId)?.add(step.id);
      const group = directRootChild(step, request.plan.rootStepId, stepsById);
      if (group === null || group.action !== null) {
        addFinding({
          code: 'phase.missing_group',
          severity: 'error',
          message: `Executable step ${step.id} must be nested under a root-level phase group`,
          stepIds: [step.id],
          phaseIds: [phaseId],
        });
        continue;
      }
      const phases = groupPhases.get(group.id) ?? new Set<string>();
      phases.add(phaseId);
      groupPhases.set(group.id, phases);
      phaseGroupStepIds.get(phaseId)?.add(group.id);
    }

    const orderedGroups = request.plan.steps
      .filter((step) => step.parentId === request.plan.rootStepId)
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
    let previousPhaseOrder = 0;
    for (const group of orderedGroups) {
      const groupPhaseIds = [...(groupPhases.get(group.id) ?? [])].sort();
      if (groupPhaseIds.length > 1) {
        addFinding({
          code: 'phase.mixed_group',
          severity: 'error',
          message: `Root group ${group.id} mixes planning phases ${groupPhaseIds.join(', ')}`,
          stepIds: [group.id],
          phaseIds: groupPhaseIds,
        });
        continue;
      }
      const phase = planningPhases.find((candidate) => candidate.id === groupPhaseIds[0]);
      if (phase === undefined) {
        continue;
      }
      if (phase.order < previousPhaseOrder) {
        addFinding({
          code: 'phase.order',
          severity: 'error',
          message: `Root group ${group.id} places phase ${phase.id} after a later phase`,
          stepIds: [group.id],
          phaseIds: [phase.id],
        });
      }
      previousPhaseOrder = Math.max(previousPhaseOrder, phase.order);
    }

    for (const phase of planningPhases) {
      if (requiredPhaseIds.has(phase.id) && phaseActionStepIds.get(phase.id)?.size === 0) {
        addFinding({
          code: 'phase.required_missing',
          severity: 'error',
          message: `Plan does not implement required phase ${phase.id}`,
          stepIds: [],
          phaseIds: [phase.id],
        });
      }
    }

    const catalogEntries = new Map(catalog.actions.map((action) => [action.name, action]));
    for (const step of executableSteps) {
      const entry = catalogEntries.get(step.action.name);
      const phaseId = actionPhaseIds.get(step.action.name);
      if (step.anchors.length === 0) {
        addFinding({
          code: 'guidance.anchor_missing',
          severity: 'error',
          message: `Executable step ${step.id} has no semantic guidance anchor`,
          stepIds: [step.id],
          phaseIds: phaseId === undefined ? [] : [phaseId],
        });
      }
      if (
        (entry?.supportedObservationKinds.length ?? 0) > 0 &&
        step.expectedObservations.length === 0
      ) {
        addFinding({
          code: 'guidance.observation_missing',
          severity: 'error',
          message: `Executable step ${step.id} has no expected observation`,
          stepIds: [step.id],
          phaseIds: phaseId === undefined ? [] : [phaseId],
        });
      }
    }

    const creators = new Map<string, Set<string>>();
    const managedResourceIds = new Set<string>();
    for (const step of executableSteps) {
      const entry = catalogEntries.get(step.action.name);
      for (const effect of entry?.resourceEffects ?? []) {
        if (effect.access !== 'create' && effect.access !== 'artifact') {
          continue;
        }
        const resourceIds = valuesAtArgumentPath(step.action.arguments, effect.argumentPath).filter(
          (value): value is string => typeof value === 'string' && value.length > 0,
        );
        for (const resourceId of resourceIds) {
          const stepIds = creators.get(resourceId) ?? new Set<string>();
          stepIds.add(step.id);
          creators.set(resourceId, stepIds);
          if (effect.argumentPath.startsWith('$managed.')) {
            managedResourceIds.add(resourceId);
          }
        }
      }
    }
    for (const [resourceId, stepIds] of creators) {
      if (stepIds.size > 1 && !managedResourceIds.has(resourceId)) {
        addFinding({
          code: 'resource.duplicate_creator',
          severity: 'error',
          message: `Logical resource ${resourceId} is created by multiple steps`,
          stepIds: [...stepIds].sort(),
          phaseIds: [],
        });
      }
    }

    const ancestors = dependencyAncestors(request.plan);
    for (const step of executableSteps) {
      const entry = catalogEntries.get(step.action.name);
      const consumedResources = new Map<
        string,
        { readonly resourceId: string; readonly resourceType: string }
      >();
      for (const effect of entry?.resourceEffects ?? []) {
        if (effect.access !== 'read' && effect.access !== 'mutate') {
          continue;
        }
        for (const value of valuesAtArgumentPath(step.action.arguments, effect.argumentPath)) {
          if (typeof value === 'string' && value.length > 0) {
            consumedResources.set(`${effect.resourceType}\u0000${value}`, {
              resourceId: value,
              resourceType: effect.resourceType,
            });
          }
        }
      }
      for (const { resourceId, resourceType } of [...consumedResources.values()].sort(
        (left, right) =>
          left.resourceId.localeCompare(right.resourceId) ||
          left.resourceType.localeCompare(right.resourceType),
      )) {
        const creatorStepIds = creators.get(resourceId);
        if (creatorStepIds === undefined || creatorStepIds.size === 0) {
          if (
            verifiedExternalResourceConsumerKeys.has(
              `${step.id}\u0000${resourceType}\u0000${resourceId}`,
            )
          ) {
            addFinding({
              code: 'resource.verified_external_input',
              severity: 'warning',
              message: `Step ${step.id} consumes verified external ${resourceType} resource ${resourceId}`,
              stepIds: [step.id],
              phaseIds: [],
            });
            continue;
          }
          addFinding({
            code: 'resource.missing_creator',
            severity: 'error',
            message: `Step ${step.id} consumes logical resource ${resourceId} without a plan creator`,
            stepIds: [step.id],
            phaseIds: [],
          });
          continue;
        }
        const dependencySet = ancestors.get(step.id) ?? new Set<string>();
        if (![...creatorStepIds].some((creatorStepId) => dependencySet.has(creatorStepId))) {
          addFinding({
            code: 'resource.missing_dependency',
            severity: 'error',
            message: `Step ${step.id} must depend on a creator of logical resource ${resourceId}`,
            stepIds: [step.id, ...creatorStepIds].sort(),
            phaseIds: [],
          });
        }
      }
    }
  }

  const phases = planningPhases.map((phase) => {
    const actionStepIds = [...(phaseActionStepIds.get(phase.id) ?? [])].sort();
    return {
      phaseId: phase.id,
      order: phase.order,
      title: phase.title,
      required: requiredPhaseIds.has(phase.id),
      used: actionStepIds.length > 0,
      groupStepIds: [...(phaseGroupStepIds.get(phase.id) ?? [])].sort(),
      actionStepIds,
    };
  });
  const orderedFindings = sortedFindings(findings);
  const errorCount = orderedFindings.filter((finding) => finding.severity === 'error').length;
  return planningQualityReportSchema.parse({
    protocolVersion: guideProtocolVersion,
    baselineVersion:
      catalog.semanticCapabilities === undefined ? '1.0.0' : planningQualityBaselineVersion,
    targetAdapterId: request.targetAdapterId,
    catalogVersion: catalog.catalogVersion,
    goal: request.goal ?? null,
    plan: { id: request.plan.id, revision: request.plan.revision },
    requiredPhaseIds: request.requiredPhaseIds,
    valid: errorCount === 0,
    summary: {
      errorCount,
      warningCount: orderedFindings.length - errorCount,
      executableStepCount: executableSteps.length,
      groupStepCount: request.plan.steps.length - executableSteps.length,
      usedPhaseCount: phases.filter((phase) => phase.used).length,
      requiredPhaseCount: request.requiredPhaseIds.length,
    },
    phases,
    ...(catalog.semanticCapabilities === undefined || request.capabilityCoverage === undefined
      ? {}
      : { capabilityCoverage: request.capabilityCoverage }),
    findings: orderedFindings,
  });
}
