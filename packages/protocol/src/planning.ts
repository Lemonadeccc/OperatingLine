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

const uniqueCoverageStepIdsSchema = z
  .array(guideStepIdSchema)
  .min(1)
  .superRefine((stepIds, context) => {
    if (new Set(stepIds).size !== stepIds.length) {
      context.addIssue({ code: 'custom', message: 'Capability coverage step ids must be unique' });
    }
  });

export const catalogCapabilityCoveragePolicyVersion = 'catalog_capability_coverage_v1' as const;

export const catalogCapabilityCoverageSchema = z.strictObject({
  policyVersion: z.literal(catalogCapabilityCoveragePolicyVersion),
  requirements: z
    .array(
      z.strictObject({
        requirementId: guideStepIdSchema,
        statement: z.string().trim().min(1).max(10_000),
        coverage: z
          .array(
            z.strictObject({
              capabilityId: guideStepIdSchema,
              stepIds: uniqueCoverageStepIdsSchema,
            }),
          )
          .min(1)
          .superRefine((coverage, context) => {
            const capabilityIds = coverage.map((entry) => entry.capabilityId);
            if (new Set(capabilityIds).size !== capabilityIds.length) {
              context.addIssue({
                code: 'custom',
                message: 'Capability ids must be unique within each requirement',
              });
            }
          }),
      }),
    )
    .min(1)
    .superRefine((requirements, context) => {
      const requirementIds = requirements.map((requirement) => requirement.requirementId);
      if (new Set(requirementIds).size !== requirementIds.length) {
        context.addIssue({ code: 'custom', message: 'Coverage requirement ids must be unique' });
      }
    }),
});
export type CatalogCapabilityCoverage = z.infer<typeof catalogCapabilityCoverageSchema>;

export const planningIntentSchema = z.strictObject({
  goal: z.string().trim().min(1).max(10_000),
  requiredPhaseIds: uniquePhaseIdsSchema.min(1),
  capabilityCoverage: catalogCapabilityCoverageSchema.optional(),
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
  capabilityCoverage: catalogCapabilityCoverageSchema.optional(),
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

const coverageMissingFindingJsonSchema = {
  type: 'object',
  properties: {
    code: { const: 'coverage.missing' },
    severity: { const: 'error' },
  },
  required: ['code', 'severity'],
} as const;

const planningQualityReportJsonSchemaMetadata = {
  allOf: [
    {
      if: {
        type: 'object',
        properties: { baselineVersion: { const: '1.0.0' } },
        required: ['baselineVersion'],
      },
      then: { not: { type: 'object', required: ['capabilityCoverage'] } },
    },
    {
      if: {
        type: 'object',
        properties: { baselineVersion: { const: '1.1.0' } },
        required: ['baselineVersion'],
      },
      then: {
        type: 'object',
        if: { type: 'object', required: ['capabilityCoverage'] },
        then: {
          type: 'object',
          properties: {
            findings: {
              type: 'array',
              not: { contains: coverageMissingFindingJsonSchema },
            },
          },
        },
        else: {
          type: 'object',
          properties: {
            valid: { const: false },
            findings: { type: 'array', contains: coverageMissingFindingJsonSchema },
          },
        },
      },
    },
  ],
} as const;

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
    capabilityCoverage: catalogCapabilityCoverageSchema.optional(),
    findings: z.array(planningQualityFindingSchema),
  })
  .superRefine((report, context) => {
    if (report.baselineVersion === '1.0.0' && report.capabilityCoverage !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['capabilityCoverage'],
        message: 'Planning quality baseline 1.0.0 cannot include capability coverage',
      });
    }
    const coverageMissingFinding = report.findings.some(
      (finding) => finding.code === 'coverage.missing' && finding.severity === 'error',
    );
    if (
      report.baselineVersion === '1.1.0' &&
      report.capabilityCoverage === undefined &&
      !coverageMissingFinding
    ) {
      context.addIssue({
        code: 'custom',
        path: ['findings'],
        message:
          'Planning quality baseline 1.1.0 without capability coverage must include coverage.missing as an error',
      });
    }
    if (
      report.baselineVersion === '1.1.0' &&
      report.capabilityCoverage !== undefined &&
      coverageMissingFinding
    ) {
      context.addIssue({
        code: 'custom',
        path: ['findings'],
        message:
          'Planning quality baseline 1.1.0 cannot report coverage.missing when capability coverage is present',
      });
    }
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
  })
  .meta(planningQualityReportJsonSchemaMetadata);
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
