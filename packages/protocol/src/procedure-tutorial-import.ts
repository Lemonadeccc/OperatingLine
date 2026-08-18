import { z } from 'zod';

import {
  procedureAuthoringPromptRequestSchema,
  procedureAuthoringTutorialTranscriptDocumentMaxBytes,
  procedureAuthoringTutorialTranscriptDocumentSchema,
  procedureAuthoringTutorialVideoInputSchema,
} from './procedure-authoring.js';
import { plannerProviderIdSchema } from './provider.js';

export const procedureTutorialTranscriptImportFormatVersion = '1.0.0' as const;
export const procedureTutorialTranscriptImportFormatVersionSchema = z.literal(
  procedureTutorialTranscriptImportFormatVersion,
);
export const procedureTutorialTranscriptDocumentMaxBytes =
  procedureAuthoringTutorialTranscriptDocumentMaxBytes;

export const procedureTutorialTranscriptImportRequestSchema = z.strictObject({
  formatVersion: procedureTutorialTranscriptImportFormatVersionSchema,
  targetAdapterId: procedureAuthoringPromptRequestSchema.shape.targetAdapterId,
  actionCatalogVersion: procedureAuthoringPromptRequestSchema.shape.actionCatalogVersion,
  interactionCatalogVersion: procedureAuthoringPromptRequestSchema.shape.interactionCatalogVersion,
  goal: procedureAuthoringPromptRequestSchema.shape.goal,
  treeId: procedureAuthoringPromptRequestSchema.shape.treeId,
  revision: procedureAuthoringPromptRequestSchema.shape.revision,
  locale: procedureAuthoringPromptRequestSchema.shape.locale,
  tutorial: z.strictObject({
    video: procedureAuthoringTutorialVideoInputSchema,
    captionDocument: z.strictObject({
      origin: z.literal('user_supplied'),
      format: procedureAuthoringTutorialTranscriptDocumentSchema.shape.format,
      content: z.string().min(1).max(procedureTutorialTranscriptDocumentMaxBytes).regex(/\S/),
      locale: procedureAuthoringPromptRequestSchema.shape.locale,
      defaultConfidence:
        procedureAuthoringTutorialTranscriptDocumentSchema.shape.confidence.shape.value,
    }),
  }),
});
export type ProcedureTutorialTranscriptImportRequest = z.infer<
  typeof procedureTutorialTranscriptImportRequestSchema
>;

export const procedureTutorialTranscriptGenerateRequestSchema =
  procedureTutorialTranscriptImportRequestSchema.extend({
    requestId: z.uuid(),
    providerId: plannerProviderIdSchema,
  });
export type ProcedureTutorialTranscriptGenerateRequest = z.infer<
  typeof procedureTutorialTranscriptGenerateRequestSchema
>;
