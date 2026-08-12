import { z } from 'zod';

import { guidePlanDiffSchema } from './diff.js';
import { guidePlanSchema, guideProtocolVersionSchema } from './guide.js';
import { planningIntentSchema } from './planning.js';
import { guideRevisionOperationSchema, guideRevisionThreadSchema } from './revision.js';
import { catalogVersionSchema } from './version.js';

export const guideProposalSubmissionSchema = z
  .strictObject({
    goalRequestId: z.uuid().optional(),
    targetAdapterId: z.string().min(1),
    catalogVersion: catalogVersionSchema.optional(),
    planning: planningIntentSchema.optional(),
    plan: guidePlanSchema,
  })
  .superRefine((submission, context) => {
    if (submission.goalRequestId !== undefined && submission.catalogVersion === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Goal-linked proposals require catalogVersion',
      });
    }
    if (submission.goalRequestId !== undefined && submission.planning === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Goal-linked proposals require planning evidence',
      });
    }
  })
  .meta({
    if: { required: ['goalRequestId'] },
    then: { required: ['catalogVersion', 'planning'] },
  });
export type GuideProposalSubmission = z.infer<typeof guideProposalSubmissionSchema>;

export const guideProposalSchema = z
  .strictObject({
    protocolVersion: guideProtocolVersionSchema,
    proposalId: z.uuid(),
    targetAdapterId: z.string().min(1),
    targetInstanceId: z.uuid().optional(),
    plan: guidePlanSchema,
    goalRequestId: z.uuid().optional(),
    revisionRequestId: z.uuid().optional(),
    revisionThread: guideRevisionThreadSchema.optional(),
    revisionOperation: guideRevisionOperationSchema.optional(),
    mergeBaseRequestId: z.uuid().optional(),
    planDiff: guidePlanDiffSchema.nullable().optional(),
    catalogVersion: catalogVersionSchema.optional(),
    proposedAt: z.iso.datetime({ offset: true }),
  })
  .superRefine((proposal, context) => {
    if (proposal.goalRequestId !== undefined && proposal.revisionRequestId !== undefined) {
      context.addIssue({
        code: 'custom',
        message: 'A proposal cannot link both a goal request and a revision request',
      });
    }
    if (proposal.protocolVersion !== '1.0.0' && proposal.planDiff === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Protocol 1.1+ proposals require planDiff',
      });
    }
    if (proposal.revisionRequestId === undefined) {
      if (
        proposal.revisionThread !== undefined ||
        proposal.revisionOperation !== undefined ||
        proposal.mergeBaseRequestId !== undefined
      ) {
        context.addIssue({
          code: 'custom',
          message: 'A standalone proposal cannot declare revision lineage',
        });
      }
      if (proposal.planDiff !== undefined && proposal.planDiff !== null) {
        context.addIssue({
          code: 'custom',
          message: 'A standalone proposal cannot declare a diff',
        });
      }
      return;
    }
    if (proposal.protocolVersion !== '1.0.0' && proposal.revisionThread === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'A request-linked proposal requires revisionThread',
      });
    }
    if (proposal.protocolVersion !== '1.0.0' && proposal.planDiff == null) {
      context.addIssue({ code: 'custom', message: 'A request-linked proposal requires planDiff' });
    }
    if (proposal.protocolVersion === '1.4.0' && proposal.revisionOperation === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Protocol 1.4 request-linked proposals require revisionOperation',
      });
    }
    if (proposal.protocolVersion !== '1.4.0' && proposal.revisionOperation !== undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Proposal revisionOperation requires protocol 1.4',
      });
    }
    if (proposal.revisionOperation?.kind === 'merge') {
      if (proposal.mergeBaseRequestId === undefined) {
        context.addIssue({
          code: 'custom',
          message: 'A merge proposal requires its computed common ancestor request',
        });
      }
    } else if (proposal.mergeBaseRequestId !== undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Only a merge proposal can declare mergeBaseRequestId',
      });
    }
    if (
      proposal.planDiff !== undefined &&
      proposal.planDiff !== null &&
      (proposal.planDiff.targetPlan.id !== proposal.plan.id ||
        proposal.planDiff.targetPlan.revision !== proposal.plan.revision)
    ) {
      context.addIssue({ code: 'custom', message: 'Proposal planDiff target must match plan' });
    }
  })
  .meta({
    allOf: [
      {
        if: {
          properties: { protocolVersion: { enum: ['1.1.0', '1.2.0', '1.3.0', '1.4.0'] } },
          required: ['protocolVersion'],
        },
        then: { required: ['planDiff'] },
      },
      {
        if: { required: ['goalRequestId'] },
        then: { required: ['targetInstanceId', 'catalogVersion'] },
      },
      {
        if: { required: ['revisionRequestId'] },
        then: {
          required: ['targetInstanceId', 'catalogVersion', 'revisionThread', 'planDiff'],
          properties: { planDiff: { type: 'object' } },
        },
        else: {
          not: {
            anyOf: [
              { required: ['revisionThread'] },
              { required: ['revisionOperation'] },
              { required: ['mergeBaseRequestId'] },
            ],
          },
          properties: { planDiff: { type: 'null' } },
        },
      },
      {
        if: {
          properties: { protocolVersion: { const: '1.4.0' } },
          required: ['protocolVersion', 'revisionRequestId'],
        },
        then: { required: ['revisionOperation'] },
      },
      {
        if: {
          properties: {
            revisionOperation: {
              properties: { kind: { const: 'merge' } },
              required: ['kind'],
            },
          },
          required: ['revisionOperation'],
        },
        then: { required: ['mergeBaseRequestId'] },
        else: { not: { required: ['mergeBaseRequestId'] } },
      },
      {
        not: { required: ['goalRequestId', 'revisionRequestId'] },
      },
    ],
  });
export type GuideProposal = z.infer<typeof guideProposalSchema>;

export const guideProposalDecisionValueSchema = z.enum(['accepted', 'rejected']);
export type GuideProposalDecisionValue = z.infer<typeof guideProposalDecisionValueSchema>;

export const guideProposalDecisionSchema = z.strictObject({
  protocolVersion: guideProtocolVersionSchema,
  decisionId: z.uuid(),
  proposalId: z.uuid(),
  adapterId: z.string().min(1),
  instanceId: z.uuid(),
  decision: guideProposalDecisionValueSchema,
  occurredAt: z.iso.datetime({ offset: true }),
});
export type GuideProposalDecision = z.infer<typeof guideProposalDecisionSchema>;
