import type { OperatingLineDatabase } from '@operatingline/persistence';
import {
  guideProposalDecisionSchema,
  guideProposalSchema,
  guideProtocolVersion,
  guideRevisionRequestSchema,
  guideRevisionThreadHistorySchema,
  type GuideRevisionThreadHistory,
  type GuideRevisionThreadHistoryRequest,
  type GuideRevisionTurnState,
} from '@operatingline/protocol';

function turnState(
  proposal: ReturnType<typeof guideProposalSchema.parse> | null,
  decision: ReturnType<typeof guideProposalDecisionSchema.parse> | null,
): GuideRevisionTurnState {
  if (proposal === null) {
    return 'awaiting_proposal';
  }
  return decision?.decision ?? 'awaiting_decision';
}

export function createGuideRevisionThreadHistory(
  database: OperatingLineDatabase,
  request: GuideRevisionThreadHistoryRequest,
): GuideRevisionThreadHistory {
  const rawHead = database.getGuideRevisionThreadHead(request.threadId);
  if (rawHead === null) {
    throw new Error(`Unknown guide revision thread: ${request.threadId}`);
  }
  const head = guideRevisionRequestSchema.parse(rawHead);
  const headThread = head.revisionThread;
  if (headThread === undefined) {
    throw new Error(`Guide revision thread uses a legacy request: ${request.threadId}`);
  }
  if (head.adapterId !== request.targetAdapterId || head.instanceId !== request.instanceId) {
    throw new Error(
      `Guide revision thread is outside the requested host scope: ${request.threadId}`,
    );
  }

  const rawLatestProposal = database.getGuideReplanProposalForRequest(head.requestId);
  const latestProposal =
    rawLatestProposal === null ? null : guideProposalSchema.parse(rawLatestProposal);
  const rawLatestDecision =
    latestProposal === null
      ? null
      : database.getGuideProposalDecision(
          latestProposal.proposalId,
          request.targetAdapterId,
          request.instanceId,
        );
  const latestDecision =
    rawLatestDecision === null ? null : guideProposalDecisionSchema.parse(rawLatestDecision);

  const rows = database.listGuideRevisionThreadTurns(
    request.threadId,
    request.targetAdapterId,
    request.instanceId,
    request.beforeTurn ?? null,
    request.limit + 1,
  );
  const hasMore = rows.length > request.limit;
  const selectedRows = rows.slice(0, request.limit);
  const turns = selectedRows
    .map((row) => {
      const revisionRequest = guideRevisionRequestSchema.parse(row.request);
      const revisionThread = revisionRequest.revisionThread;
      if (revisionThread === undefined) {
        throw new Error('Revision history cannot contain a legacy request');
      }
      const proposal = row.proposal === null ? null : guideProposalSchema.parse(row.proposal);
      const decision =
        row.decision === null ? null : guideProposalDecisionSchema.parse(row.decision);
      return {
        turn: revisionThread.turn,
        state: turnState(proposal, decision),
        request: revisionRequest,
        proposal,
        decision,
      };
    })
    .reverse();

  return guideRevisionThreadHistorySchema.parse({
    protocolVersion: guideProtocolVersion,
    threadId: request.threadId,
    targetAdapterId: request.targetAdapterId,
    instanceId: request.instanceId,
    planId: head.basePlan.id,
    latestTurn: headThread.turn,
    status: turnState(latestProposal, latestDecision),
    turns,
    page: {
      beforeTurn: request.beforeTurn ?? null,
      nextBeforeTurn: hasMore ? (turns[0]?.turn ?? null) : null,
      hasMore,
    },
  });
}
