import { z } from 'zod';

import { guidePlanSchema, guideProtocolVersionSchema } from './guide.js';
import { catalogVersionSchema } from './version.js';

export const guideProposalSubmissionSchema = z.strictObject({
  targetAdapterId: z.string().min(1),
  catalogVersion: catalogVersionSchema.optional(),
  plan: guidePlanSchema,
});
export type GuideProposalSubmission = z.infer<typeof guideProposalSubmissionSchema>;

export const guideProposalSchema = z.strictObject({
  protocolVersion: guideProtocolVersionSchema,
  proposalId: z.uuid(),
  targetAdapterId: z.string().min(1),
  targetInstanceId: z.uuid().optional(),
  plan: guidePlanSchema,
  revisionRequestId: z.uuid().optional(),
  catalogVersion: catalogVersionSchema.optional(),
  proposedAt: z.iso.datetime({ offset: true }),
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
