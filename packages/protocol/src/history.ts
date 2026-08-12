import { z } from 'zod';

import { guideProtocolVersion } from './guide.js';
import { guideProposalDecisionSchema, guideProposalSchema } from './proposal.js';
import { guideRevisionRequestSchema } from './revision.js';

export const guideRevisionTurnStateSchema = z.enum([
  'awaiting_proposal',
  'awaiting_decision',
  'accepted',
  'rejected',
]);
export type GuideRevisionTurnState = z.infer<typeof guideRevisionTurnStateSchema>;

const guideRevisionHistoryProtocolVersions = ['1.1.0', guideProtocolVersion] as const;
const guideRevisionHistoryProtocolVersionSet = new Set<string>(
  guideRevisionHistoryProtocolVersions,
);
export const guideRevisionHistoryProtocolVersionSchema = z.enum(
  guideRevisionHistoryProtocolVersions,
);

export const guideRevisionThreadHistoryRequestSchema = z.strictObject({
  threadId: z.uuid(),
  targetAdapterId: z.string().trim().min(1).max(180),
  instanceId: z.uuid(),
  beforeTurn: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
export type GuideRevisionThreadHistoryRequest = z.infer<
  typeof guideRevisionThreadHistoryRequestSchema
>;

export const guideRevisionThreadTurnSchema = z
  .strictObject({
    turn: z.number().int().positive(),
    state: guideRevisionTurnStateSchema,
    request: guideRevisionRequestSchema,
    proposal: guideProposalSchema.nullable(),
    decision: guideProposalDecisionSchema.nullable(),
  })
  .superRefine((record, context) => {
    for (const [path, protocolVersion] of [
      ['request', record.request.protocolVersion],
      ['proposal', record.proposal?.protocolVersion],
      ['decision', record.decision?.protocolVersion],
    ] as const) {
      if (
        protocolVersion !== undefined &&
        !guideRevisionHistoryProtocolVersionSet.has(protocolVersion)
      ) {
        context.addIssue({
          code: 'custom',
          path: [path, 'protocolVersion'],
          message: 'Revision history entries require protocol 1.1+',
        });
      }
    }
    const thread = record.request.revisionThread;
    if (thread === undefined || thread.turn !== record.turn) {
      context.addIssue({
        code: 'custom',
        message: 'Revision history turn must match its request thread',
      });
    }

    if (record.proposal === null) {
      if (record.decision !== null || record.state !== 'awaiting_proposal') {
        context.addIssue({
          code: 'custom',
          message: 'A revision turn without a proposal must await a proposal',
        });
      }
      return;
    }

    if (
      record.proposal.revisionRequestId !== record.request.requestId ||
      record.proposal.revisionThread?.threadId !== thread?.threadId ||
      record.proposal.revisionThread?.turn !== record.turn ||
      record.proposal.revisionThread?.parentRequestId !== thread?.parentRequestId
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Revision history proposal must match its request and thread turn',
      });
    }
    if (record.decision === null) {
      if (record.state !== 'awaiting_decision') {
        context.addIssue({
          code: 'custom',
          message: 'A proposed revision turn without a decision must await a decision',
        });
      }
      return;
    }
    if (
      record.decision.proposalId !== record.proposal.proposalId ||
      record.decision.adapterId !== record.request.adapterId ||
      record.decision.instanceId !== record.request.instanceId ||
      record.state !== record.decision.decision
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Revision history decision must match its proposal, host, and state',
      });
    }
  })
  .meta({
    allOf: [
      {
        properties: {
          request: {
            properties: {
              protocolVersion: { enum: [...guideRevisionHistoryProtocolVersions] },
            },
          },
          proposal: {
            properties: {
              protocolVersion: { enum: [...guideRevisionHistoryProtocolVersions] },
            },
          },
          decision: {
            properties: {
              protocolVersion: { enum: [...guideRevisionHistoryProtocolVersions] },
            },
          },
        },
      },
    ],
  });
export type GuideRevisionThreadTurn = z.infer<typeof guideRevisionThreadTurnSchema>;

export const guideRevisionThreadHistorySchema = z
  .strictObject({
    protocolVersion: guideRevisionHistoryProtocolVersionSchema,
    threadId: z.uuid(),
    targetAdapterId: z.string().min(1),
    instanceId: z.uuid(),
    planId: z.string().min(1),
    latestTurn: z.number().int().positive(),
    status: guideRevisionTurnStateSchema,
    turns: z.array(guideRevisionThreadTurnSchema).max(100),
    page: z.strictObject({
      beforeTurn: z.number().int().positive().nullable(),
      nextBeforeTurn: z.number().int().positive().nullable(),
      hasMore: z.boolean(),
    }),
  })
  .superRefine((history, context) => {
    let previousTurn: number | null = null;
    let previousRequestId: string | null = null;
    for (const record of history.turns) {
      const requestThread = record.request.revisionThread;
      if (
        requestThread?.threadId !== history.threadId ||
        record.request.adapterId !== history.targetAdapterId ||
        record.request.instanceId !== history.instanceId ||
        record.request.basePlan.id !== history.planId
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Revision history entries must stay inside one thread and host scope',
        });
      }
      if (
        record.proposal !== null &&
        (record.proposal.plan.id !== history.planId ||
          record.proposal.targetAdapterId !== history.targetAdapterId ||
          record.proposal.targetInstanceId !== history.instanceId)
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Revision history proposals must stay inside one plan and host scope',
        });
      }
      if (previousTurn !== null && record.turn !== previousTurn + 1) {
        context.addIssue({
          code: 'custom',
          message: 'Revision history page turns must be contiguous and ascending',
        });
      }
      if (previousRequestId !== null && requestThread?.parentRequestId !== previousRequestId) {
        context.addIssue({
          code: 'custom',
          message: 'Revision history page turns must preserve their parent request chain',
        });
      }
      if (record.turn > history.latestTurn) {
        context.addIssue({
          code: 'custom',
          message: 'Revision history page cannot exceed the latest turn',
        });
      }
      previousTurn = record.turn;
      previousRequestId = record.request.requestId;
    }

    const firstTurn = history.turns[0]?.turn;
    const lastTurn = history.turns.at(-1);
    if (
      history.page.beforeTurn !== null &&
      history.turns.some((record) => record.turn >= history.page.beforeTurn!)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Revision history page turns must precede the requested cursor',
      });
    }
    if (
      history.page.beforeTurn === null &&
      lastTurn !== undefined &&
      lastTurn.turn !== history.latestTurn
    ) {
      context.addIssue({
        code: 'custom',
        message: 'The newest revision history page must include the latest turn',
      });
    }
    if (lastTurn?.turn === history.latestTurn && lastTurn.state !== history.status) {
      context.addIssue({
        code: 'custom',
        message: 'Revision history status must match the latest turn',
      });
    }
    if (history.page.hasMore) {
      if (firstTurn === undefined || history.page.nextBeforeTurn !== firstTurn) {
        context.addIssue({
          code: 'custom',
          message: 'Revision history continuation must point before the first returned turn',
        });
      }
    } else if (history.page.nextBeforeTurn !== null) {
      context.addIssue({
        code: 'custom',
        message: 'A complete revision history page cannot expose a continuation cursor',
      });
    }
  });
export type GuideRevisionThreadHistory = z.infer<typeof guideRevisionThreadHistorySchema>;
