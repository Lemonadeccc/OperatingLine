import { z } from 'zod';

import { guideStepIdSchema } from './guide.js';
import { catalogVersionSchema } from './version.js';

export const humanEvalFormatVersion = '1.0.0' as const;
export const humanEvalFormatVersionSchema = z.literal(humanEvalFormatVersion);

export const evalContentSha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const humanEvalSuiteReferenceSchema = z.strictObject({
  suiteId: guideStepIdSchema,
  suiteVersion: catalogVersionSchema,
});
export type HumanEvalSuiteReference = z.infer<typeof humanEvalSuiteReferenceSchema>;

export const humanEvalCaseReferenceSchema = humanEvalSuiteReferenceSchema.extend({
  caseId: guideStepIdSchema,
  caseContentSha256: evalContentSha256Schema,
});
export type HumanEvalCaseReference = z.infer<typeof humanEvalCaseReferenceSchema>;

const evalArtifactReferenceJsonSchemaMetadata = {
  allOf: [
    {
      if: {
        type: 'object',
        properties: { kind: { const: 'rendered_image' } },
        required: ['kind'],
      },
      then: { type: 'object', required: ['visualEnvironment'] },
    },
    {
      if: {
        type: 'object',
        properties: { kind: { const: 'manual_review_image' } },
        required: ['kind'],
      },
      then: {
        type: 'object',
        not: { required: ['visualEnvironment'] },
      },
    },
  ],
} as const;

export const evalArtifactReferenceSchema = z
  .strictObject({
    artifactId: guideStepIdSchema,
    kind: z.enum([
      'planning_benchmark',
      'guide_plan',
      'eval_export',
      'rendered_image',
      'manual_review_image',
      'host_project',
      'provider_output',
      'other',
    ]),
    mediaType: z.string().trim().min(1).max(180),
    uri: z.string().trim().min(1).max(2_048),
    contentSha256: evalContentSha256Schema,
    metadata: z.record(z.string().min(1), z.json()).default({}),
    visualEnvironment: z
      .strictObject({
        width: z.number().int().positive().max(65_536),
        height: z.number().int().positive().max(65_536),
        frame: z.number().int().safe().nullable(),
        renderEngine: z.string().trim().min(1).max(180),
        colorManagement: z.string().trim().min(1).max(500),
        hostVersion: z.string().trim().min(1).max(180),
        adapterVersion: catalogVersionSchema,
        planContentSha256: evalContentSha256Schema,
        executionId: z.uuid(),
        terminalHostReportId: z.uuid(),
        terminalHostEventSequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
        hostProjectSha256: evalContentSha256Schema,
      })
      .optional(),
  })
  .superRefine((artifact, context) => {
    if (artifact.kind === 'rendered_image' && artifact.visualEnvironment === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['visualEnvironment'],
        message: 'Rendered image evidence requires the exact visual environment',
      });
    }
    if (artifact.kind === 'manual_review_image' && artifact.visualEnvironment !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['visualEnvironment'],
        message: 'Manual review images cannot claim an exact visual environment',
      });
    }
  })
  .meta(evalArtifactReferenceJsonSchemaMetadata);
export type EvalArtifactReference = z.infer<typeof evalArtifactReferenceSchema>;

export const humanEvalDataHandlingSchema = z.strictObject({
  redaction: z.enum(['none', 'human_reviewed']),
  containsPotentiallySensitiveContent: z.boolean(),
  permittedUses: z
    .array(z.enum(['local_eval', 'research']))
    .min(1)
    .superRefine((uses, context) => {
      if (new Set(uses).size !== uses.length) {
        context.addIssue({ code: 'custom', message: 'Permitted uses must be unique' });
      }
    }),
  trainingUse: z.literal('not_authorized'),
  publicRelease: z.enum(['not_reviewed', 'reviewed']),
  warning: z.string().trim().min(1).max(1_000),
});
export type HumanEvalDataHandling = z.infer<typeof humanEvalDataHandlingSchema>;

export const humanEvalIntegritySchema = z.strictObject({
  algorithm: z.literal('sha256'),
  canonicalization: z.literal('operatingline-json-sort-v1'),
  contentSha256: evalContentSha256Schema,
});
export type HumanEvalIntegrity = z.infer<typeof humanEvalIntegritySchema>;
