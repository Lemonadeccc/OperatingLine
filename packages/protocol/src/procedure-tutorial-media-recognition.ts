import { z } from 'zod';

export const procedureTutorialMediaRecognitionArtifactFormatVersion = '1.0.0' as const;
export const procedureTutorialMediaRecognitionMaximumFrames = 64 as const;
export const procedureTutorialMediaRecognitionMaximumCandidates = 4_096 as const;
export const procedureTutorialMediaRecognitionMaximumLabelBytes = 256 as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const utf8Encoder = new TextEncoder();
const boundedTextSchema = z
  .string()
  .min(1)
  .max(procedureTutorialMediaRecognitionMaximumLabelBytes)
  .refine(
    (value) =>
      utf8Encoder.encode(value).byteLength <= procedureTutorialMediaRecognitionMaximumLabelBytes,
  );
const timestampSchema = z.number().finite().int().nonnegative();
const confidenceSchema = z.number().finite().min(0).max(1);
const unitSchema = z.number().finite().min(0).max(1);

export const procedureTutorialMediaRecognitionFrameSchema = z.strictObject({
  frameId: boundedTextSchema,
  frameSha256: sha256Schema,
  ocrArtifactSha256: sha256Schema,
  ocrCandidatesSha256: sha256Schema,
  timestampMs: timestampSchema,
});

export const procedureTutorialMediaRecognitionBoundsSchema = z
  .strictObject({ x: unitSchema, y: unitSchema, width: unitSchema, height: unitSchema })
  .refine((bounds) => bounds.x + bounds.width <= 1 && bounds.y + bounds.height <= 1, {
    message: 'Recognition bounds must remain inside the normalized frame.',
  });

export const procedureTutorialMediaRecognitionUiCandidateSchema = z
  .strictObject({
    candidateId: boundedTextSchema,
    kind: z.enum(['ui_element', 'menu', 'control']),
    frameId: boundedTextSchema,
    timestampMs: timestampSchema,
    label: boundedTextSchema,
    normalizedLabel: boundedTextSchema,
    menuId: boundedTextSchema.nullable(),
    controlId: boundedTextSchema.nullable(),
    bounds: procedureTutorialMediaRecognitionBoundsSchema,
    confidence: confidenceSchema,
  })
  .refine(
    (candidate) =>
      candidate.normalizedLabel ===
      candidate.label.normalize('NFKC').trim().replaceAll(/\s+/gu, ' ').toLocaleLowerCase('en-US'),
    { message: 'The normalized UI label must be canonical.' },
  );

export const procedureTutorialMediaRecognitionKeyCandidateSchema = z
  .strictObject({
    candidateId: boundedTextSchema,
    kind: z.literal('key_chord'),
    frameId: boundedTextSchema,
    timestampMs: timestampSchema,
    label: boundedTextSchema,
    normalizedKeys: z.array(boundedTextSchema).min(1).max(8),
    confidence: confidenceSchema,
  })
  .refine(
    (candidate) => {
      const modifierOrder = ['Ctrl', 'Alt', 'Shift', 'Meta'];
      const modifiers = candidate.normalizedKeys.slice(0, -1);
      const key = candidate.normalizedKeys.at(-1);
      const indexes = modifiers.map((modifier) => modifierOrder.indexOf(modifier));
      return (
        key !== undefined &&
        indexes.every(
          (index, position) => index >= 0 && (position === 0 || index > indexes[position - 1]!),
        ) &&
        /^(?:[A-Z0-9]|F(?:[1-9]|1\d|2[0-4])|Backspace|Delete|Down|End|Enter|Escape|Home|Insert|Left|PageDown|PageUp|Right|Space|Tab|Up)$/u.test(
          key,
        )
      );
    },
    { message: 'The normalized key chord must use canonical modifier order.' },
  );

export const procedureTutorialMediaRecognitionProvenanceSchema = z.strictObject({
  adapterId: boundedTextSchema,
  adapterVersion: boundedTextSchema,
  modelId: boundedTextSchema,
  modelVersion: boundedTextSchema,
  executableSha256: sha256Schema,
  modelSha256: sha256Schema,
  licenseId: boundedTextSchema,
  licenseSha256: sha256Schema,
  configSha256: sha256Schema,
  versionOutputSha256: sha256Schema,
  locale: boundedTextSchema,
  platform: boundedTextSchema,
  isolationBackendId: boundedTextSchema,
  isolationBackendVersion: boundedTextSchema,
  isolationBackendVersionSha256: sha256Schema,
  supervisorSha256: sha256Schema,
  isolationPolicySha256: sha256Schema,
  isolationAttestationSha256: sha256Schema,
});

const procedureTutorialMediaRecognitionArtifactShape = {
  formatVersion: z.literal(procedureTutorialMediaRecognitionArtifactFormatVersion),
  artifactKind: z.literal('ui_recognition_observations'),
  stage: z.literal('recognition'),
  input: z.strictObject({
    frames: z
      .array(procedureTutorialMediaRecognitionFrameSchema)
      .min(1)
      .max(procedureTutorialMediaRecognitionMaximumFrames),
  }),
  observations: z.strictObject({
    uiCandidates: z.array(procedureTutorialMediaRecognitionUiCandidateSchema),
    keyCandidates: z.array(procedureTutorialMediaRecognitionKeyCandidateSchema),
  }),
  provenance: procedureTutorialMediaRecognitionProvenanceSchema,
} as const;

export const procedureTutorialMediaRecognitionArtifactContentSchema = z.strictObject(
  procedureTutorialMediaRecognitionArtifactShape,
);

export const procedureTutorialMediaRecognitionArtifactSchema = z
  .strictObject({
    ...procedureTutorialMediaRecognitionArtifactShape,
    contentSha256: sha256Schema,
  })
  .superRefine((artifact, context) => {
    const frames = new Map<string, number>();
    for (const [index, frame] of artifact.input.frames.entries()) {
      if (frames.has(frame.frameId))
        context.addIssue({
          code: 'custom',
          path: ['input', 'frames', index, 'frameId'],
          message: 'Frame IDs must be unique.',
        });
      frames.set(frame.frameId, frame.timestampMs);
    }

    const candidates = [
      ...artifact.observations.uiCandidates,
      ...artifact.observations.keyCandidates,
    ];
    if (candidates.length > procedureTutorialMediaRecognitionMaximumCandidates)
      context.addIssue({
        code: 'custom',
        path: ['observations'],
        message: 'Too many recognition candidates.',
      });
    const candidateIds = new Set<string>();
    for (const candidate of candidates) {
      if (candidateIds.has(candidate.candidateId))
        context.addIssue({
          code: 'custom',
          path: ['observations'],
          message: 'Candidate IDs must be unique.',
        });
      candidateIds.add(candidate.candidateId);
      const timestamp = frames.get(candidate.frameId);
      if (timestamp === undefined || timestamp !== candidate.timestampMs)
        context.addIssue({
          code: 'custom',
          path: ['observations'],
          message: 'Candidates must reference an input frame at its exact timestamp.',
        });
    }
  });

function canonicalRecognitionJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalRecognitionJson).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalRecognitionJson(entry)}`)
    .join(',')}}`;
}

export async function validateProcedureTutorialMediaRecognitionArtifactIntegrity(
  value: unknown,
): Promise<ProcedureTutorialMediaRecognitionArtifact> {
  const parsed = procedureTutorialMediaRecognitionArtifactSchema.safeParse(value);
  if (!parsed.success) throw new Error('The UI recognition artifact is invalid.');
  const { contentSha256, ...content } = parsed.data;
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonicalRecognitionJson(content)),
  );
  const computed = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  if (computed !== contentSha256) throw new Error('The UI recognition artifact is invalid.');
  return parsed.data;
}

export type ProcedureTutorialMediaRecognitionFrame = z.infer<
  typeof procedureTutorialMediaRecognitionFrameSchema
>;
export type ProcedureTutorialMediaRecognitionUiCandidate = z.infer<
  typeof procedureTutorialMediaRecognitionUiCandidateSchema
>;
export type ProcedureTutorialMediaRecognitionKeyCandidate = z.infer<
  typeof procedureTutorialMediaRecognitionKeyCandidateSchema
>;
export type ProcedureTutorialMediaRecognitionProvenance = z.infer<
  typeof procedureTutorialMediaRecognitionProvenanceSchema
>;
export type ProcedureTutorialMediaRecognitionArtifactContent = z.infer<
  typeof procedureTutorialMediaRecognitionArtifactContentSchema
>;
export type ProcedureTutorialMediaRecognitionArtifact = z.infer<
  typeof procedureTutorialMediaRecognitionArtifactSchema
>;
