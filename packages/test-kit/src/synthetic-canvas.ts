import {
  actionCatalogSchema,
  guidePlanSchema,
  guideProtocolVersion,
  planningProposalDraftSchema,
  validateActionCatalog,
  type ActionCatalog,
  type GuidePlan,
  type PlanningPromptPacket,
  type PlanningProposalDraft,
} from '@operatingline/protocol';

const syntheticCanvasActions: ActionCatalog['actions'] = [
  {
    name: 'canvas.document.create',
    title: 'Create canvas document',
    description: 'Creates one synthetic canvas document for deterministic planning tests.',
    argumentsSchema: {
      type: 'object',
      required: ['documentId', 'title'],
      properties: {
        documentId: { type: 'string', minLength: 1 },
        title: { type: 'string', minLength: 1 },
      },
      additionalProperties: false,
    },
    resourceEffects: [
      {
        access: 'create',
        resourceType: 'CANVAS_DOCUMENT',
        argumentPath: 'documentId',
        derivedResourceTypes: [],
        description: 'Creates the logical canvas document.',
      },
    ],
    supportedAnchorKinds: ['owned_control'],
    supportedObservationKinds: ['document_exists'],
    rollbackModes: ['compensating_action'],
    safety: {
      sideEffect: 'scene_write',
      requiresPlanApproval: true,
      networkAccess: false,
      fileAccess: 'none',
    },
  },
  {
    name: 'canvas.document.export_svg',
    title: 'Export canvas document',
    description: 'Exports a synthetic canvas document to a managed SVG artifact.',
    argumentsSchema: {
      type: 'object',
      required: ['documentId', 'artifactId'],
      properties: {
        documentId: { type: 'string', minLength: 1 },
        artifactId: { type: 'string', minLength: 1 },
      },
      additionalProperties: false,
    },
    resourceEffects: [
      {
        access: 'read',
        resourceType: 'CANVAS_DOCUMENT',
        argumentPath: 'documentId',
        derivedResourceTypes: [],
        description: 'Reads the canvas document created by an earlier action.',
      },
      {
        access: 'artifact',
        resourceType: 'SVG',
        argumentPath: 'artifactId',
        derivedResourceTypes: [],
        description: 'Creates a managed SVG artifact.',
      },
    ],
    supportedAnchorKinds: ['owned_control'],
    supportedObservationKinds: ['artifact_exists'],
    rollbackModes: ['compensating_action'],
    safety: {
      sideEffect: 'managed_file_write',
      requiresPlanApproval: true,
      networkAccess: false,
      fileAccess: 'managed_temp',
    },
  },
];

const syntheticCanvasCatalogBase = {
  adapterId: 'canvas',
  adapterVersionRange: '>=1.0.0 <2.0.0',
  hostVersionRange: '>=1.0.0 <2.0.0',
  title: 'Synthetic Canvas',
  description: 'Small synthetic action catalog for host-neutral planning tests.',
  planningNotes: [
    'Create the document before exporting it.',
    'Use only logical canvas resource identifiers.',
  ],
  planningPhases: [
    {
      id: 'compose',
      order: 1,
      title: 'Compose',
      description: 'Create the requested canvas document.',
      selectionGuidance: 'Select when the goal requires a new canvas document.',
      actionNames: ['canvas.document.create'],
    },
    {
      id: 'deliver',
      order: 2,
      title: 'Deliver',
      description: 'Export the canvas document as an artifact.',
      selectionGuidance: 'Select when the goal requests a deliverable artifact.',
      actionNames: ['canvas.document.export_svg'],
    },
  ],
  actions: syntheticCanvasActions,
} as const;

export const syntheticCanvasHistoricalActionCatalog: ActionCatalog = actionCatalogSchema.parse({
  ...syntheticCanvasCatalogBase,
  protocolVersion: '1.0.0',
  catalogVersion: '1.0.0',
});

export const syntheticCanvasActionCatalog: ActionCatalog = actionCatalogSchema.parse({
  ...syntheticCanvasCatalogBase,
  protocolVersion: guideProtocolVersion,
  catalogVersion: '1.1.0',
  semanticCapabilities: [
    {
      id: 'document.compose',
      title: 'Canvas document composition',
      description: 'Create a logical canvas document.',
      selectionGuidance: 'Select when the goal requests a new canvas document.',
      actionNames: ['canvas.document.create'],
    },
    {
      id: 'artifact.svg',
      title: 'SVG delivery',
      description: 'Export a canvas document as a managed SVG artifact.',
      selectionGuidance: 'Select when the goal requests an SVG deliverable.',
      actionNames: ['canvas.document.export_svg'],
    },
  ],
});

export const syntheticCanvasActionCatalogs: readonly ActionCatalog[] = Object.freeze([
  syntheticCanvasHistoricalActionCatalog,
  syntheticCanvasActionCatalog,
]);

for (const catalog of syntheticCanvasActionCatalogs) {
  validateActionCatalog(catalog);
}

export interface SyntheticCanvasPlanOptions {
  readonly id: string;
  readonly revision?: number;
  readonly title?: string;
}

export function buildSyntheticCanvasPlan(options: SyntheticCanvasPlanOptions): GuidePlan {
  const documentId = `${options.id}.document`;
  return guidePlanSchema.parse({
    protocolVersion: guideProtocolVersion,
    id: options.id,
    revision: options.revision ?? 1,
    title: options.title ?? 'Create and export a canvas document',
    rootStepId: `${options.id}.root`,
    steps: [
      {
        id: `${options.id}.root`,
        parentId: null,
        order: 0,
        dependsOn: [],
        title: 'Canvas workflow',
        intent: 'Create and deliver the requested canvas document.',
        explanation: 'Groups the complete synthetic canvas workflow.',
        state: 'draft',
        action: null,
        anchors: [],
        expectedObservations: [],
        rollback: { mode: 'unsupported', checkpointRequired: false },
      },
      {
        id: `${options.id}.compose`,
        parentId: `${options.id}.root`,
        order: 1,
        dependsOn: [],
        title: 'Compose',
        intent: 'Create the canvas document.',
        explanation: 'Groups document composition work.',
        state: 'draft',
        action: null,
        anchors: [],
        expectedObservations: [],
        rollback: { mode: 'unsupported', checkpointRequired: false },
      },
      {
        id: `${options.id}.create`,
        parentId: `${options.id}.compose`,
        order: 1,
        dependsOn: [],
        title: 'Create document',
        intent: 'Create the requested canvas document.',
        explanation: 'Creates the logical document consumed by the export step.',
        state: 'draft',
        action: {
          adapterId: 'canvas',
          name: 'canvas.document.create',
          arguments: { documentId, title: options.title ?? 'Canvas document' },
        },
        anchors: [{ kind: 'owned_control', surfaceId: 'canvas', controlId: 'new-document' }],
        expectedObservations: [{ kind: 'document_exists', parameters: { documentId } }],
        rollback: { mode: 'compensating_action', checkpointRequired: false },
      },
      {
        id: `${options.id}.deliver`,
        parentId: `${options.id}.root`,
        order: 2,
        dependsOn: [],
        title: 'Deliver',
        intent: 'Export the finished canvas document.',
        explanation: 'Groups artifact delivery work.',
        state: 'draft',
        action: null,
        anchors: [],
        expectedObservations: [],
        rollback: { mode: 'unsupported', checkpointRequired: false },
      },
      {
        id: `${options.id}.export`,
        parentId: `${options.id}.deliver`,
        order: 1,
        dependsOn: [`${options.id}.create`],
        title: 'Export SVG',
        intent: 'Create the requested SVG artifact.',
        explanation: 'Exports the previously created canvas document.',
        state: 'draft',
        action: {
          adapterId: 'canvas',
          name: 'canvas.document.export_svg',
          arguments: { documentId, artifactId: `${options.id}.svg` },
        },
        anchors: [{ kind: 'owned_control', surfaceId: 'canvas', controlId: 'export-svg' }],
        expectedObservations: [
          { kind: 'artifact_exists', parameters: { artifactId: `${options.id}.svg` } },
        ],
        rollback: { mode: 'compensating_action', checkpointRequired: false },
      },
    ],
  });
}

export function buildSyntheticCanvasDraft(packet: PlanningPromptPacket): PlanningProposalDraft {
  const planId = packet.context.requestedPlanId;
  const revision = packet.context.recommendedRevision;
  const goal = packet.context.goal;
  const capabilityAware = packet.context.catalog.semanticCapabilities !== undefined;
  return planningProposalDraftSchema.parse({
    targetAdapterId: packet.context.targetAdapterId,
    catalogVersion: packet.context.catalog.catalogVersion,
    planning: {
      goal,
      requiredPhaseIds: ['compose', 'deliver'],
      ...(capabilityAware
        ? {
            capabilityCoverage: {
              policyVersion: 'catalog_capability_coverage_v1',
              requirements: [
                {
                  requirementId: 'document',
                  statement: 'Create the requested canvas document.',
                  coverage: [{ capabilityId: 'document.compose', stepIds: [`${planId}.create`] }],
                },
                {
                  requirementId: 'delivery',
                  statement: 'Deliver the canvas document as an SVG artifact.',
                  coverage: [{ capabilityId: 'artifact.svg', stepIds: [`${planId}.export`] }],
                },
              ],
            },
          }
        : {}),
    },
    plan: buildSyntheticCanvasPlan({ id: planId, revision, title: goal }),
  });
}
