import type {
  OperatingLineDatabase,
  RecordGuideRevisionRequestResult,
} from '@operatingline/persistence';
import {
  guideProposalDecisionSchema,
  guideProposalSchema,
  guideRevisionRequestSchema,
  type GuideRevisionRequest,
} from '@operatingline/protocol';

import type { ActionCatalogRegistry } from './action-catalogs.js';
import { validateGuideRevisionOperation } from './guide-revision-branches.js';
import { validateGuideRevisionRequest, validateGuideRevisionThread } from './guide-validation.js';

export interface GuideRevisionRequestService {
  validate(request: GuideRevisionRequest): GuideRevisionRequest;
  record(request: GuideRevisionRequest): RecordGuideRevisionRequestResult;
}

export interface GuideRevisionRequestServiceOptions {
  readonly database: OperatingLineDatabase;
  readonly actionCatalogRegistry: Pick<ActionCatalogRegistry, 'get'>;
}

export function createGuideRevisionRequestService(
  options: GuideRevisionRequestServiceOptions,
): GuideRevisionRequestService {
  const validate = (requestInput: GuideRevisionRequest): GuideRevisionRequest => {
    const request = guideRevisionRequestSchema.parse(requestInput);
    const catalog = options.actionCatalogRegistry.get({
      targetAdapterId: request.adapterId,
      catalogVersion: request.catalogVersion,
    });
    validateGuideRevisionRequest(request, catalog);
    if (options.database.getGuideRevisionRequest(request.requestId) !== null) {
      return request;
    }

    const thread = request.revisionThread;
    const rawHead =
      thread === undefined ? null : options.database.getGuideRevisionThreadHead(thread.threadId);
    const head = rawHead === null ? null : guideRevisionRequestSchema.parse(rawHead);
    const parentRequestId = thread?.parentRequestId;
    const rawParentProposal =
      parentRequestId == null
        ? null
        : options.database.getGuideReplanProposalForRequest(parentRequestId);
    const parentProposal =
      rawParentProposal === null ? null : guideProposalSchema.parse(rawParentProposal);
    const rawParentDecision =
      parentProposal === null
        ? null
        : options.database.getGuideProposalDecision(
            parentProposal.proposalId,
            request.adapterId,
            request.instanceId,
          );
    const parentDecision =
      rawParentDecision === null ? null : guideProposalDecisionSchema.parse(rawParentDecision);
    validateGuideRevisionThread(request, head, parentProposal, parentDecision);
    validateGuideRevisionOperation(options.database, request, catalog);
    return request;
  };

  return {
    validate,
    record: (requestInput) => {
      const request = validate(requestInput);
      return options.database.recordGuideRevisionRequest(request);
    },
  };
}
