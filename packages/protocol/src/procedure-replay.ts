import { z } from 'zod';

import {
  canonicalizeProtocolJsonValue,
  protocolJsonValueCanonicalization,
} from './canonical-json-value.js';
import { companionObservationSchema, companionStateReportSchema } from './companion.js';
import { guideStepIdSchema } from './guide.js';
import {
  procedureAuthoringMaterializationRequestSchema,
  procedureAuthoringMaterializationResultSchema,
} from './procedure-materialization.js';
import { guideProposalDecisionSchema, guideProposalSchema } from './proposal.js';

export const procedureLeafReplayFormatVersion = '1.0.0' as const;
export const procedureLeafReplayFormatVersionSchema = z.literal(procedureLeafReplayFormatVersion);

const contentSha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const procedureLeafReplayActionNameSchema = z.enum([
  'blender.mesh.create_uv_sphere',
  'blender.mesh.create_icosphere',
  'blender.mesh.create_cube',
  'blender.mesh.create_plane',
  'blender.mesh.create_torus',
  'blender.mesh.create_cone',
  'blender.mesh.create_cylinder',
]);
export type ProcedureLeafReplayActionName = z.infer<typeof procedureLeafReplayActionNameSchema>;

const procedureLeafReplayObservationKindByAction = {
  'blender.mesh.create_uv_sphere': 'uv_sphere_ready',
  'blender.mesh.create_icosphere': 'icosphere_ready',
  'blender.mesh.create_cube': 'cube_ready',
  'blender.mesh.create_plane': 'plane_ready',
  'blender.mesh.create_torus': 'torus_ready',
  'blender.mesh.create_cone': 'cone_ready',
  'blender.mesh.create_cylinder': 'cylinder_ready',
} as const satisfies Record<ProcedureLeafReplayActionName, string>;

const replayIntegritySchema = z.strictObject({
  algorithm: z.literal('sha256'),
  canonicalization: z.literal(protocolJsonValueCanonicalization),
  contentSha256: contentSha256Schema,
});

const sha256RoundConstants = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotateRight(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount));
}

/** Portable synchronous SHA-256 for canonical protocol bytes. */
function sha256Hex(bytes: Uint8Array): string {
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const bitLength = bytes.length * 8;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const words = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const left = words[index - 15]!;
      const right = words[index - 2]!;
      const sigma0 = rotateRight(left, 7) ^ rotateRight(left, 18) ^ (left >>> 3);
      const sigma1 = rotateRight(right, 17) ^ rotateRight(right, 19) ^ (right >>> 10);
      words[index] = (words[index - 16]! + sigma0 + words[index - 7]! + sigma1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e!, 6) ^ rotateRight(e!, 11) ^ rotateRight(e!, 25);
      const choice = (e! & f!) ^ (~e! & g!);
      const temporary1 = (h! + sum1 + choice + sha256RoundConstants[index]! + words[index]!) >>> 0;
      const sum0 = rotateRight(a!, 2) ^ rotateRight(a!, 13) ^ rotateRight(a!, 22);
      const majority = (a! & b!) ^ (a! & c!) ^ (b! & c!);
      const temporary2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d! + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }
    hash[0] = (hash[0]! + a!) >>> 0;
    hash[1] = (hash[1]! + b!) >>> 0;
    hash[2] = (hash[2]! + c!) >>> 0;
    hash[3] = (hash[3]! + d!) >>> 0;
    hash[4] = (hash[4]! + e!) >>> 0;
    hash[5] = (hash[5]! + f!) >>> 0;
    hash[6] = (hash[6]! + g!) >>> 0;
    hash[7] = (hash[7]! + h!) >>> 0;
  }
  return Array.from(hash, (word) => word.toString(16).padStart(8, '0')).join('');
}

function computeContentSha256(value: unknown): string {
  return sha256Hex(canonicalizeProtocolJsonValue(value));
}

function withoutIntegrity(value: { integrity?: unknown } & Record<string, unknown>): unknown {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'integrity'));
}

export const procedureLeafReplayProposalRequestSchema = z.strictObject({
  formatVersion: procedureLeafReplayFormatVersionSchema,
  replayId: z.uuid(),
  targetInstanceId: z.uuid(),
  leafId: guideStepIdSchema,
  replayMode: z.literal('managed_action'),
  packet: procedureAuthoringMaterializationRequestSchema.shape.packet,
  tree: procedureAuthoringMaterializationRequestSchema.shape.tree,
});
export type ProcedureLeafReplayProposalRequest = z.infer<
  typeof procedureLeafReplayProposalRequestSchema
>;

const procedureLeafReplayClaimsSchema = z.strictObject({
  materialization: z.literal('catalog_grounded'),
  approval: z.literal('pending'),
  hostExecutionStarted: z.literal(false),
  managedActionResult: z.literal('pending'),
  menuTrack: z.literal('catalog_grounded_not_executed'),
  shortcutTrack: z.enum(['candidate_not_executed', 'unavailable']),
  mcpTrack: z.literal('unavailable'),
});

const procedureLeafReplayBindingContentSchema = z.strictObject({
  formatVersion: procedureLeafReplayFormatVersionSchema,
  replayId: z.uuid(),
  targetInstanceId: z.uuid(),
  leafId: guideStepIdSchema,
  replayMode: z.literal('managed_action'),
  request: procedureLeafReplayProposalRequestSchema,
  materialization: procedureAuthoringMaterializationResultSchema,
  proposal: guideProposalSchema,
  planContentSha256: contentSha256Schema,
  recipeId: guideStepIdSchema,
  actionName: procedureLeafReplayActionNameSchema,
  claims: procedureLeafReplayClaimsSchema,
  createdAt: z.iso.datetime({ offset: true }),
});

export const procedureLeafReplayBindingSchema = procedureLeafReplayBindingContentSchema
  .safeExtend({ integrity: replayIntegritySchema })
  .superRefine((binding, context) => {
    const leaf = binding.materialization.tree.nodes.find((node) => node.id === binding.leafId);
    const coverage = binding.materialization.coverage.find(
      (entry) => entry.leafId === binding.leafId,
    );
    const proposalStep = binding.proposal.plan.steps.find((step) => step.id === binding.leafId);

    if (
      binding.request.replayId !== binding.replayId ||
      binding.request.targetInstanceId !== binding.targetInstanceId ||
      binding.request.leafId !== binding.leafId ||
      binding.request.replayMode !== binding.replayMode
    ) {
      context.addIssue({
        code: 'custom',
        path: ['request'],
        message: 'Embedded replay request identity must match the binding',
      });
    }
    if (
      binding.request.packet.integrity.contentSha256 !==
        binding.materialization.packetContentSha256 ||
      computeContentSha256(binding.request.tree) !== binding.materialization.inputTreeContentSha256
    ) {
      context.addIssue({
        code: 'custom',
        path: ['materialization'],
        message: 'Materialization must bind the embedded replay request packet and candidate tree',
      });
    }

    if (leaf?.kind !== 'leaf' || leaf.action === null) {
      context.addIssue({
        code: 'custom',
        path: ['leafId'],
        message: 'Replay leafId must identify a managed-action leaf in the materialized tree',
      });
    } else if (
      leaf.action.name !== binding.actionName ||
      leaf.action.adapterId !== binding.materialization.tree.adapterId
    ) {
      context.addIssue({
        code: 'custom',
        path: ['actionName'],
        message: 'Replay action must match the materialized leaf and adapter',
      });
    }
    if (coverage === undefined || coverage.recipeId !== binding.recipeId) {
      context.addIssue({
        code: 'custom',
        path: ['recipeId'],
        message: 'Replay recipeId must match the materialization coverage for leafId',
      });
    }
    const expectedShortcutClaim =
      coverage?.shortcut === 'materialized'
        ? 'candidate_not_executed'
        : coverage?.shortcut === 'unavailable'
          ? 'unavailable'
          : null;
    if (expectedShortcutClaim === null || binding.claims.shortcutTrack !== expectedShortcutClaim) {
      context.addIssue({
        code: 'custom',
        path: ['claims', 'shortcutTrack'],
        message: 'Replay shortcut claim must match materialization coverage',
      });
    }
    if (
      proposalStep?.action === null ||
      proposalStep?.action === undefined ||
      proposalStep.action.name !== binding.actionName ||
      proposalStep.action.adapterId !== binding.materialization.tree.adapterId
    ) {
      context.addIssue({
        code: 'custom',
        path: ['proposal', 'plan', 'steps'],
        message: 'Replay proposal must contain the same managed action at leafId',
      });
    }
    if (
      binding.proposal.targetInstanceId !== binding.targetInstanceId ||
      binding.proposal.targetAdapterId !== binding.materialization.tree.adapterId
    ) {
      context.addIssue({
        code: 'custom',
        path: ['proposal'],
        message: 'Replay proposal target must match the replay target and materialized adapter',
      });
    }
    if (
      computeContentSha256(binding.proposal.plan) !== binding.planContentSha256 ||
      computeContentSha256(binding.materialization.compilation.plan) !== binding.planContentSha256
    ) {
      context.addIssue({
        code: 'custom',
        path: ['planContentSha256'],
        message: 'Replay planContentSha256 must bind the proposal and compiled plans',
      });
    }
    if (computeContentSha256(withoutIntegrity(binding)) !== binding.integrity.contentSha256) {
      context.addIssue({
        code: 'custom',
        path: ['integrity', 'contentSha256'],
        message: 'Replay binding integrity must match its canonical content',
      });
    }
  });
export type ProcedureLeafReplayBinding = z.infer<typeof procedureLeafReplayBindingSchema>;

export function computeProcedureLeafReplayBindingContentSha256(
  binding: Omit<ProcedureLeafReplayBinding, 'integrity'> | ProcedureLeafReplayBinding,
): string {
  return computeContentSha256(withoutIntegrity(binding));
}

export const procedureLeafReplayProposalResultSchema = z.strictObject({
  status: z.enum(['accepted', 'duplicate']),
  binding: procedureLeafReplayBindingSchema,
});
export type ProcedureLeafReplayProposalResult = z.infer<
  typeof procedureLeafReplayProposalResultSchema
>;

export const procedureLeafReplayFinalizeRequestSchema = z.strictObject({
  replayId: z.uuid(),
  attestationId: z.uuid(),
  reportId: z.uuid(),
});
export type ProcedureLeafReplayFinalizeRequest = z.infer<
  typeof procedureLeafReplayFinalizeRequestSchema
>;

const procedureLeafReplayExecutionSchema = z.strictObject({
  host: z.strictObject({
    adapterId: z.literal('blender'),
    instanceId: z.uuid(),
    version: z.string().min(1),
  }),
  companion: z.strictObject({ version: z.string().min(1) }),
  plan: z.strictObject({
    id: z.string().min(1),
    revision: z.number().int().positive(),
    contentSha256: contentSha256Schema,
  }),
  execution: z.strictObject({ id: z.uuid() }),
  step: z.strictObject({ id: guideStepIdSchema }),
  action: z.strictObject({
    adapterId: z.literal('blender'),
    name: procedureLeafReplayActionNameSchema,
  }),
  occurredAt: z.iso.datetime({ offset: true }),
});

const procedureLeafReplayReceiptSchema = z.strictObject({
  sequence: z.number().int().positive(),
  receivedAt: z.iso.datetime({ offset: true }),
});

const procedureLeafReplayProvenanceSchema = z
  .strictObject({
    authentication: z.literal('negotiated_companion_lease'),
    sessionFingerprintSha256: contentSha256Schema,
    proposalReceipt: procedureLeafReplayReceiptSchema,
    decisionReceipt: procedureLeafReplayReceiptSchema,
    reportReceipt: procedureLeafReplayReceiptSchema,
  })
  .superRefine((provenance, context) => {
    if (
      provenance.proposalReceipt.sequence >= provenance.decisionReceipt.sequence ||
      provenance.decisionReceipt.sequence >= provenance.reportReceipt.sequence
    ) {
      context.addIssue({
        code: 'custom',
        path: ['reportReceipt', 'sequence'],
        message: 'Replay provenance receipt sequences must increase from proposal to report',
      });
    }
    const proposalReceivedAt = Date.parse(provenance.proposalReceipt.receivedAt);
    const decisionReceivedAt = Date.parse(provenance.decisionReceipt.receivedAt);
    const reportReceivedAt = Date.parse(provenance.reportReceipt.receivedAt);
    if (proposalReceivedAt > decisionReceivedAt || decisionReceivedAt > reportReceivedAt) {
      context.addIssue({
        code: 'custom',
        path: ['reportReceipt', 'receivedAt'],
        message: 'Replay provenance receipt times must not move backward',
      });
    }
  });

const procedureLeafReplayUvSphereParametersSchema = z.strictObject({
  resourceId: guideStepIdSchema,
  objectName: z.string().min(1),
  radius: z.number().positive().finite(),
  location: z.array(z.number().finite()).length(3),
});

const procedureLeafReplayIcosphereParametersSchema = z.strictObject({
  resourceId: guideStepIdSchema,
  objectName: z.string().min(1),
  subdivisions: z.number().int().min(1).max(5),
  radius: z.number().positive().finite(),
  location: z.array(z.number().finite()).length(3),
});

const procedureLeafReplaySizedPrimitiveParametersSchema = z.strictObject({
  resourceId: guideStepIdSchema,
  objectName: z.string().min(1),
  size: z.number().positive().finite(),
  location: z.array(z.number().finite()).length(3),
});

const procedureLeafReplayTorusParametersSchema = z.strictObject({
  resourceId: guideStepIdSchema,
  objectName: z.string().min(1),
  majorSegments: z.number().int().min(3).max(128),
  minorSegments: z.number().int().min(3).max(64),
  majorRadius: z.number().positive().finite(),
  minorRadius: z.number().positive().finite(),
  location: z.array(z.number().finite()).length(3),
});

const procedureLeafReplaySegmentPointSchema = z
  .array(z.number().min(-1000).max(1000).finite())
  .length(3);

const procedureLeafReplayConeParametersSchema = z
  .strictObject({
    resourceId: guideStepIdSchema,
    objectName: z.string().min(1),
    radiusStart: z.number().min(0).max(1000).finite(),
    radiusEnd: z.number().min(0).max(1000).finite(),
    start: procedureLeafReplaySegmentPointSchema,
    end: procedureLeafReplaySegmentPointSchema,
  })
  .superRefine((parameters, context) => {
    if (parameters.radiusStart === 0 && parameters.radiusEnd === 0) {
      context.addIssue({
        code: 'custom',
        path: ['radiusStart'],
        message: 'Cone replay radii cannot both be zero',
      });
    }
    if (parameters.start.every((value, index) => value === parameters.end[index])) {
      context.addIssue({
        code: 'custom',
        path: ['end'],
        message: 'Cone replay start and end must differ',
      });
    }
  });

const procedureLeafReplayCylinderParametersSchema = z
  .strictObject({
    resourceId: guideStepIdSchema,
    objectName: z.string().min(1),
    radius: z.number().min(0.0001).max(1000).finite(),
    start: procedureLeafReplaySegmentPointSchema,
    end: procedureLeafReplaySegmentPointSchema,
  })
  .superRefine((parameters, context) => {
    if (parameters.start.every((value, index) => value === parameters.end[index])) {
      context.addIssue({
        code: 'custom',
        path: ['end'],
        message: 'Cylinder replay start and end must differ',
      });
    }
  });

const procedureLeafReplayPrimitiveDetailsShape = {
  supported: z.literal(true),
  resourceId: guideStepIdSchema,
  objectName: z.string().min(1),
  meshId: guideStepIdSchema,
  collectionId: z.literal('snowman.collection'),
  parametersValid: z.literal(true),
  objectOwned: z.literal(true),
  meshOwned: z.literal(true),
  collectionOwned: z.literal(true),
  receiptMatches: z.literal(true),
  objectDataMatches: z.literal(true),
  collectionLinkMatches: z.literal(true),
  nameMatches: z.literal(true),
  locationMatches: z.literal(true),
  rotationMatches: z.literal(true),
  scaleMatches: z.literal(true),
  transformIsolated: z.literal(true),
  modifiersAbsent: z.literal(true),
  shapeKeysAbsent: z.literal(true),
  materialsAbsent: z.literal(true),
  contentIntact: z.literal(true),
  topologyMatches: z.literal(true),
  finiteCoordinates: z.literal(true),
  meshContentSha256: contentSha256Schema,
} as const;

const procedureLeafReplayUvSphereDetailsSchema = z
  .strictObject({
    parameters: procedureLeafReplayUvSphereParametersSchema,
    ...procedureLeafReplayPrimitiveDetailsShape,
    radiusMatches: z.literal(true),
    vertexCount: z.literal(482),
    edgeCount: z.literal(992),
    faceCount: z.literal(512),
  })
  .superRefine((details, context) => {
    if (
      details.resourceId !== details.parameters.resourceId ||
      details.objectName !== details.parameters.objectName
    ) {
      context.addIssue({
        code: 'custom',
        path: ['parameters'],
        message: 'UV Sphere replay details must match their evaluated parameters',
      });
    }
    if (details.meshId !== `${details.resourceId}.mesh`) {
      context.addIssue({
        code: 'custom',
        path: ['meshId'],
        message: 'UV Sphere replay meshId must derive from resourceId',
      });
    }
  });

const procedureLeafReplayIcosphereDetailsSchema = z
  .strictObject({
    parameters: procedureLeafReplayIcosphereParametersSchema,
    ...procedureLeafReplayPrimitiveDetailsShape,
    radiusMatches: z.literal(true),
    vertexCount: z.number().int().positive(),
    edgeCount: z.number().int().positive(),
    faceCount: z.number().int().positive(),
  })
  .superRefine((details, context) => {
    if (
      details.resourceId !== details.parameters.resourceId ||
      details.objectName !== details.parameters.objectName
    ) {
      context.addIssue({
        code: 'custom',
        path: ['parameters'],
        message: 'Icosphere replay details must match their evaluated parameters',
      });
    }
    if (details.meshId !== `${details.resourceId}.mesh`) {
      context.addIssue({
        code: 'custom',
        path: ['meshId'],
        message: 'Icosphere replay meshId must derive from resourceId',
      });
    }
    const scale = 4 ** (details.parameters.subdivisions - 1);
    if (
      details.vertexCount !== 10 * scale + 2 ||
      details.edgeCount !== 30 * scale ||
      details.faceCount !== 20 * scale
    ) {
      context.addIssue({
        code: 'custom',
        path: ['vertexCount'],
        message: 'Icosphere replay topology must match its accepted subdivision level',
      });
    }
  });

const procedureLeafReplayCubeDetailsSchema = z
  .strictObject({
    parameters: procedureLeafReplaySizedPrimitiveParametersSchema,
    ...procedureLeafReplayPrimitiveDetailsShape,
    sizeMatches: z.literal(true),
    vertexCount: z.literal(8),
    edgeCount: z.literal(12),
    faceCount: z.literal(6),
  })
  .superRefine((details, context) => {
    if (
      details.resourceId !== details.parameters.resourceId ||
      details.objectName !== details.parameters.objectName
    ) {
      context.addIssue({
        code: 'custom',
        path: ['parameters'],
        message: 'Cube replay details must match their evaluated parameters',
      });
    }
    if (details.meshId !== `${details.resourceId}.mesh`) {
      context.addIssue({
        code: 'custom',
        path: ['meshId'],
        message: 'Cube replay meshId must derive from resourceId',
      });
    }
  });

const procedureLeafReplayPlaneDetailsSchema = z
  .strictObject({
    parameters: procedureLeafReplaySizedPrimitiveParametersSchema,
    ...procedureLeafReplayPrimitiveDetailsShape,
    sizeMatches: z.literal(true),
    vertexCount: z.literal(4),
    edgeCount: z.literal(4),
    faceCount: z.literal(1),
  })
  .superRefine((details, context) => {
    if (
      details.resourceId !== details.parameters.resourceId ||
      details.objectName !== details.parameters.objectName
    ) {
      context.addIssue({
        code: 'custom',
        path: ['parameters'],
        message: 'Plane replay details must match their evaluated parameters',
      });
    }
    if (details.meshId !== `${details.resourceId}.mesh`) {
      context.addIssue({
        code: 'custom',
        path: ['meshId'],
        message: 'Plane replay meshId must derive from resourceId',
      });
    }
  });

const procedureLeafReplayTorusDetailsSchema = z
  .strictObject({
    parameters: procedureLeafReplayTorusParametersSchema,
    ...procedureLeafReplayPrimitiveDetailsShape,
    geometryMatches: z.literal(true),
    vertexCount: z.number().int().positive(),
    edgeCount: z.number().int().positive(),
    faceCount: z.number().int().positive(),
  })
  .superRefine((details, context) => {
    if (
      details.resourceId !== details.parameters.resourceId ||
      details.objectName !== details.parameters.objectName
    ) {
      context.addIssue({
        code: 'custom',
        path: ['parameters'],
        message: 'Torus replay details must match their evaluated parameters',
      });
    }
    if (details.meshId !== `${details.resourceId}.mesh`) {
      context.addIssue({
        code: 'custom',
        path: ['meshId'],
        message: 'Torus replay meshId must derive from resourceId',
      });
    }
    const vertexCount = details.parameters.majorSegments * details.parameters.minorSegments;
    if (
      details.vertexCount !== vertexCount ||
      details.edgeCount !== vertexCount * 2 ||
      details.faceCount !== vertexCount
    ) {
      context.addIssue({
        code: 'custom',
        path: ['vertexCount'],
        message: 'Torus replay topology must match its accepted segment counts',
      });
    }
  });

const procedureLeafReplaySegmentDetailsShape = {
  ...procedureLeafReplayPrimitiveDetailsShape,
  segmentGeometryMatches: z.literal(true),
  endpointsMatch: z.literal(true),
  vertexCount: z.number().int().positive(),
  edgeCount: z.number().int().positive(),
  faceCount: z.number().int().positive(),
} as const;

const procedureLeafReplayConeDetailsSchema = z
  .strictObject({
    parameters: procedureLeafReplayConeParametersSchema,
    ...procedureLeafReplaySegmentDetailsShape,
  })
  .superRefine((details, context) => {
    if (
      details.resourceId !== details.parameters.resourceId ||
      details.objectName !== details.parameters.objectName
    ) {
      context.addIssue({
        code: 'custom',
        path: ['parameters'],
        message: 'Cone replay details must match their evaluated parameters',
      });
    }
    if (details.meshId !== `${details.resourceId}.mesh`) {
      context.addIssue({
        code: 'custom',
        path: ['meshId'],
        message: 'Cone replay meshId must derive from resourceId',
      });
    }
    const expectedTopology =
      details.parameters.radiusStart === 0 || details.parameters.radiusEnd === 0
        ? { vertexCount: 33, edgeCount: 64, faceCount: 33 }
        : { vertexCount: 64, edgeCount: 96, faceCount: 34 };
    if (
      details.vertexCount !== expectedTopology.vertexCount ||
      details.edgeCount !== expectedTopology.edgeCount ||
      details.faceCount !== expectedTopology.faceCount
    ) {
      context.addIssue({
        code: 'custom',
        path: ['vertexCount'],
        message: 'Cone replay topology must match its accepted endpoint radii',
      });
    }
  });

const procedureLeafReplayCylinderDetailsSchema = z
  .strictObject({
    parameters: procedureLeafReplayCylinderParametersSchema,
    ...procedureLeafReplaySegmentDetailsShape,
  })
  .superRefine((details, context) => {
    if (
      details.resourceId !== details.parameters.resourceId ||
      details.objectName !== details.parameters.objectName
    ) {
      context.addIssue({
        code: 'custom',
        path: ['parameters'],
        message: 'Cylinder replay details must match their evaluated parameters',
      });
    }
    if (details.meshId !== `${details.resourceId}.mesh`) {
      context.addIssue({
        code: 'custom',
        path: ['meshId'],
        message: 'Cylinder replay meshId must derive from resourceId',
      });
    }
    if (details.vertexCount !== 64 || details.edgeCount !== 96 || details.faceCount !== 34) {
      context.addIssue({
        code: 'custom',
        path: ['vertexCount'],
        message: 'Cylinder replay topology must match the fixed 32-segment executor',
      });
    }
  });

const procedureLeafReplayUvSphereObservationSchema = companionObservationSchema.safeExtend({
  kind: z.literal('uv_sphere_ready'),
  satisfied: z.literal(true),
  details: procedureLeafReplayUvSphereDetailsSchema,
});

const procedureLeafReplayIcosphereObservationSchema = companionObservationSchema.safeExtend({
  kind: z.literal('icosphere_ready'),
  satisfied: z.literal(true),
  details: procedureLeafReplayIcosphereDetailsSchema,
});

const procedureLeafReplayCubeObservationSchema = companionObservationSchema.safeExtend({
  kind: z.literal('cube_ready'),
  satisfied: z.literal(true),
  details: procedureLeafReplayCubeDetailsSchema,
});

const procedureLeafReplayPlaneObservationSchema = companionObservationSchema.safeExtend({
  kind: z.literal('plane_ready'),
  satisfied: z.literal(true),
  details: procedureLeafReplayPlaneDetailsSchema,
});

const procedureLeafReplayTorusObservationSchema = companionObservationSchema.safeExtend({
  kind: z.literal('torus_ready'),
  satisfied: z.literal(true),
  details: procedureLeafReplayTorusDetailsSchema,
});

const procedureLeafReplayConeObservationSchema = companionObservationSchema.safeExtend({
  kind: z.literal('cone_ready'),
  satisfied: z.literal(true),
  details: procedureLeafReplayConeDetailsSchema,
});

const procedureLeafReplayCylinderObservationSchema = companionObservationSchema.safeExtend({
  kind: z.literal('cylinder_ready'),
  satisfied: z.literal(true),
  details: procedureLeafReplayCylinderDetailsSchema,
});

export const procedureLeafReplayObservationSchema = z.discriminatedUnion('kind', [
  procedureLeafReplayUvSphereObservationSchema,
  procedureLeafReplayIcosphereObservationSchema,
  procedureLeafReplayCubeObservationSchema,
  procedureLeafReplayPlaneObservationSchema,
  procedureLeafReplayTorusObservationSchema,
  procedureLeafReplayConeObservationSchema,
  procedureLeafReplayCylinderObservationSchema,
]);
export type ProcedureLeafReplayObservation = z.infer<typeof procedureLeafReplayObservationSchema>;

const procedureLeafReplayReportSchema = companionStateReportSchema.safeExtend({
  adapterId: z.literal('blender'),
  plan: z.strictObject({
    id: z.string().min(1),
    revision: z.number().int().positive(),
  }),
  planContentSha256: contentSha256Schema,
  executionId: z.uuid(),
  phase: z.literal('completed'),
  activeStepId: guideStepIdSchema,
  completedStepIds: z.array(guideStepIdSchema).length(1),
  transition: z.literal('step_succeeded'),
  stepId: guideStepIdSchema,
  observations: z.array(procedureLeafReplayObservationSchema).length(1),
  observationGate: z.null(),
  artifactAttestation: z.null(),
  error: z.null(),
});

const procedureLeafReplaySuccessGateSchema = z
  .strictObject({
    observations: z.array(procedureLeafReplayObservationSchema).length(1),
    allSatisfied: z.literal(true),
  })
  .superRefine((gate, context) => {
    if (gate.observations.some((observation) => !observation.satisfied)) {
      context.addIssue({
        code: 'custom',
        path: ['observations'],
        message: 'A replay success gate requires every observation to be satisfied',
      });
    }
  });

const procedureLeafReplayVerificationScopeSchema = z.strictObject({
  managedActionResult: z.literal('verified'),
  menuTrack: z.literal('catalog_grounded_not_executed'),
  shortcutTrack: z.enum(['candidate_not_executed', 'unavailable']),
  mcpTrack: z.literal('unavailable'),
});

const procedureLeafReplayAttestationContentSchema = z.strictObject({
  formatVersion: procedureLeafReplayFormatVersionSchema,
  replayId: z.uuid(),
  attestationId: z.uuid(),
  decision: guideProposalDecisionSchema.safeExtend({
    adapterId: z.literal('blender'),
    decision: z.literal('accepted'),
  }),
  report: procedureLeafReplayReportSchema,
  evidenceClass: z.literal('companion_reported_managed_action_leaf_replay'),
  provenance: procedureLeafReplayProvenanceSchema,
  bindingContentSha256: contentSha256Schema,
  execution: procedureLeafReplayExecutionSchema,
  successGate: procedureLeafReplaySuccessGateSchema,
  verificationScope: procedureLeafReplayVerificationScopeSchema,
  attestedAt: z.iso.datetime({ offset: true }),
});

export const procedureLeafReplayAttestationSchema = procedureLeafReplayAttestationContentSchema
  .safeExtend({ integrity: replayIntegritySchema })
  .superRefine((attestation, context) => {
    const { decision, report, execution } = attestation;
    const observation = report.observations[0];
    const expectedObservationKind =
      procedureLeafReplayObservationKindByAction[execution.action.name];
    if (observation?.kind !== expectedObservationKind) {
      context.addIssue({
        code: 'custom',
        path: ['report', 'observations'],
        message: 'Replay observation kind must match the attested managed action',
      });
    }
    if (decision.decision !== 'accepted') {
      context.addIssue({
        code: 'custom',
        path: ['decision', 'decision'],
        message: 'Replay attestation requires an accepted proposal decision',
      });
    }
    if (report.phase !== 'completed' || report.transition !== 'step_succeeded') {
      context.addIssue({
        code: 'custom',
        path: ['report'],
        message: 'Replay attestation requires a terminal successful companion report',
      });
    }
    if (
      report.activeStepId !== execution.step.id ||
      report.stepId !== execution.step.id ||
      report.completedStepIds.length !== 1 ||
      report.completedStepIds[0] !== execution.step.id
    ) {
      context.addIssue({
        code: 'custom',
        path: ['report', 'completedStepIds'],
        message: 'Replay report must identify only the exact completed attested step',
      });
    }
    if (
      report.instanceId !== execution.host.instanceId ||
      report.adapterId !== execution.host.adapterId ||
      report.hostVersion !== execution.host.version ||
      report.companionVersion !== execution.companion.version ||
      report.plan?.id !== execution.plan.id ||
      report.plan?.revision !== execution.plan.revision ||
      report.planContentSha256 !== execution.plan.contentSha256 ||
      report.executionId !== execution.execution.id ||
      report.stepId !== execution.step.id ||
      report.occurredAt !== execution.occurredAt ||
      decision.instanceId !== execution.host.instanceId ||
      decision.adapterId !== execution.host.adapterId
    ) {
      context.addIssue({
        code: 'custom',
        path: ['execution'],
        message: 'Replay execution must exactly match its proposal decision and companion report',
      });
    }
    if (
      computeContentSha256(report.observations) !==
      computeContentSha256(attestation.successGate.observations)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['successGate', 'observations'],
        message: 'Replay success-gate observations must exactly match the companion report',
      });
    }
    if (
      computeContentSha256(withoutIntegrity(attestation)) !== attestation.integrity.contentSha256
    ) {
      context.addIssue({
        code: 'custom',
        path: ['integrity', 'contentSha256'],
        message: 'Replay attestation integrity must match its canonical content',
      });
    }
  });
export type ProcedureLeafReplayAttestation = z.infer<typeof procedureLeafReplayAttestationSchema>;

export function computeProcedureLeafReplayAttestationContentSha256(
  attestation: Omit<ProcedureLeafReplayAttestation, 'integrity'> | ProcedureLeafReplayAttestation,
): string {
  return computeContentSha256(withoutIntegrity(attestation));
}

export const procedureLeafReplayFinalizeResultSchema = z.strictObject({
  status: z.enum(['accepted', 'duplicate']),
  attestation: procedureLeafReplayAttestationSchema,
});
export type ProcedureLeafReplayFinalizeResult = z.infer<
  typeof procedureLeafReplayFinalizeResultSchema
>;
