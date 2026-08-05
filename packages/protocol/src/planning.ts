import { z } from 'zod';

import { guidePlanSchema, guideProtocolVersionSchema, guideStepIdSchema } from './guide.js';
import { catalogVersionSchema, planningQualityBaselineVersionSchema } from './version.js';

const uniquePhaseIdsSchema = z
  .array(guideStepIdSchema)
  .max(64)
  .superRefine((phaseIds, context) => {
    if (new Set(phaseIds).size !== phaseIds.length) {
      context.addIssue({ code: 'custom', message: 'Planning phase ids must be unique' });
    }
  });

export const planningIntentSchema = z.strictObject({
  goal: z.string().trim().min(1).max(10_000),
  requiredPhaseIds: uniquePhaseIdsSchema.min(1),
});
export type PlanningIntent = z.infer<typeof planningIntentSchema>;

export const planningProposalDraftSchema = z.strictObject({
  targetAdapterId: z.string().trim().min(1).max(180),
  catalogVersion: catalogVersionSchema,
  planning: planningIntentSchema,
  plan: guidePlanSchema,
});
export type PlanningProposalDraft = z.infer<typeof planningProposalDraftSchema>;

export const planningQualityEvaluationRequestSchema = z.strictObject({
  targetAdapterId: z.string().trim().min(1).max(180),
  catalogVersion: catalogVersionSchema.optional(),
  goal: z.string().trim().min(1).max(10_000).optional(),
  requiredPhaseIds: uniquePhaseIdsSchema.default([]),
  plan: guidePlanSchema,
});
export type PlanningQualityEvaluationRequest = z.infer<
  typeof planningQualityEvaluationRequestSchema
>;

export const planningQualityFindingSchema = z.strictObject({
  code: z.string().min(1),
  severity: z.enum(['error', 'warning']),
  message: z.string().min(1),
  stepIds: z.array(guideStepIdSchema),
  phaseIds: z.array(guideStepIdSchema),
});
export type PlanningQualityFinding = z.infer<typeof planningQualityFindingSchema>;

export const planningQualityPhaseCoverageSchema = z.strictObject({
  phaseId: guideStepIdSchema,
  order: z.number().int().positive(),
  title: z.string().min(1),
  required: z.boolean(),
  used: z.boolean(),
  groupStepIds: z.array(guideStepIdSchema),
  actionStepIds: z.array(guideStepIdSchema),
});
export type PlanningQualityPhaseCoverage = z.infer<typeof planningQualityPhaseCoverageSchema>;

export const planningQualityReportSchema = z
  .strictObject({
    protocolVersion: guideProtocolVersionSchema,
    baselineVersion: planningQualityBaselineVersionSchema,
    targetAdapterId: z.string().min(1),
    catalogVersion: catalogVersionSchema,
    goal: z.string().min(1).nullable(),
    plan: z.strictObject({
      id: z.string().min(1),
      revision: z.number().int().positive(),
    }),
    requiredPhaseIds: uniquePhaseIdsSchema,
    valid: z.boolean(),
    summary: z.strictObject({
      errorCount: z.number().int().nonnegative(),
      warningCount: z.number().int().nonnegative(),
      executableStepCount: z.number().int().nonnegative(),
      groupStepCount: z.number().int().nonnegative(),
      usedPhaseCount: z.number().int().nonnegative(),
      requiredPhaseCount: z.number().int().nonnegative(),
    }),
    phases: z.array(planningQualityPhaseCoverageSchema),
    findings: z.array(planningQualityFindingSchema),
  })
  .superRefine((report, context) => {
    const errorCount = report.findings.filter((finding) => finding.severity === 'error').length;
    const warningCount = report.findings.length - errorCount;
    if (
      report.summary.errorCount !== errorCount ||
      report.summary.warningCount !== warningCount ||
      report.valid !== (errorCount === 0)
    ) {
      context.addIssue({ code: 'custom', message: 'Planning quality summary is inconsistent' });
    }
    if (
      report.summary.usedPhaseCount !== report.phases.filter((phase) => phase.used).length ||
      report.summary.requiredPhaseCount !== report.requiredPhaseIds.length
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Planning quality phase counts are inconsistent',
      });
    }
  });
export type PlanningQualityReport = z.infer<typeof planningQualityReportSchema>;

export const planningBenchmarkFormatVersion = '1.0.0' as const;
export const planningBenchmarkCaseSchema = z.strictObject({
  formatVersion: z.literal(planningBenchmarkFormatVersion),
  id: guideStepIdSchema,
  title: z.string().min(1),
  targetAdapterId: z.string().min(1),
  catalogVersion: catalogVersionSchema,
  goal: z.string().trim().min(1).max(10_000),
  requiredPhaseIds: uniquePhaseIdsSchema.min(1),
  referencePlan: guidePlanSchema,
});
export type PlanningBenchmarkCase = z.infer<typeof planningBenchmarkCaseSchema>;
