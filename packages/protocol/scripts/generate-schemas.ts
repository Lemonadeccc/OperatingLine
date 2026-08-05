import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { z } from 'zod';

import {
  actionCatalogSchema,
  adapterStatusSchema,
  companionGuideDeliverySchema,
  companionGuideRequestSchema,
  companionReplanRunCreateRequestSchema,
  companionReplanRunSchema,
  companionReplanRunStatusRequestSchema,
  companionStateReportSchema,
  evalExportBundleSchema,
  evalExportRequestSchema,
  guidePlanSchema,
  guidePlanDiffSchema,
  guideProposalDecisionSchema,
  guideProposalSchema,
  guideProposalSubmissionSchema,
  guideReplanSubmissionSchema,
  guideRevisionRequestSchema,
  guideRevisionThreadHistoryRequestSchema,
  guideRevisionThreadHistorySchema,
  planningContextSchema,
  planningBenchmarkCaseSchema,
  planningPromptContextSchema,
  planningPromptPacketSchema,
  planningPromptRequestSchema,
  planningProposalDraftSchema,
  planningQualityEvaluationRequestSchema,
  planningQualityReportSchema,
  plannerGenerateRequestSchema,
  plannerGenerationErrorSchema,
  plannerGenerationResultSchema,
  plannerProviderDescriptorSchema,
  plannerProviderListSchema,
  plannerReplanDraftSchema,
  plannerReplanGenerateRequestSchema,
  plannerReplanGenerationResultSchema,
  replanningPromptContextSchema,
  replanningPromptPacketSchema,
  replanningPromptRequestSchema,
} from '../src/index.js';

const outputDirectory = resolve(process.cwd(), '../../protocol/schemas/v1');
mkdirSync(outputDirectory, { recursive: true });
const checkOnly = process.argv.includes('--check');

const schemas = [
  [
    'companion-replan-run-create-request.schema.json',
    'https://operatingline.dev/schema/v1/companion-replan-run-create-request.json',
    companionReplanRunCreateRequestSchema,
  ],
  [
    'companion-replan-run-status-request.schema.json',
    'https://operatingline.dev/schema/v1/companion-replan-run-status-request.json',
    companionReplanRunStatusRequestSchema,
  ],
  [
    'companion-replan-run.schema.json',
    'https://operatingline.dev/schema/v1/companion-replan-run.json',
    companionReplanRunSchema,
  ],
  [
    'planner-provider-descriptor.schema.json',
    'https://operatingline.dev/schema/v1/planner-provider-descriptor.json',
    plannerProviderDescriptorSchema,
  ],
  [
    'planner-provider-list.schema.json',
    'https://operatingline.dev/schema/v1/planner-provider-list.json',
    plannerProviderListSchema,
  ],
  [
    'planner-generate-request.schema.json',
    'https://operatingline.dev/schema/v1/planner-generate-request.json',
    plannerGenerateRequestSchema,
  ],
  [
    'planner-generation-result.schema.json',
    'https://operatingline.dev/schema/v1/planner-generation-result.json',
    plannerGenerationResultSchema,
  ],
  [
    'planner-generation-error.schema.json',
    'https://operatingline.dev/schema/v1/planner-generation-error.json',
    plannerGenerationErrorSchema,
  ],
  [
    'planning-prompt-context.schema.json',
    'https://operatingline.dev/schema/v1/planning-prompt-context.json',
    planningPromptContextSchema,
  ],
  [
    'planning-prompt-request.schema.json',
    'https://operatingline.dev/schema/v1/planning-prompt-request.json',
    planningPromptRequestSchema,
  ],
  [
    'planning-prompt-packet.schema.json',
    'https://operatingline.dev/schema/v1/planning-prompt-packet.json',
    planningPromptPacketSchema,
  ],
  [
    'planning-proposal-draft.schema.json',
    'https://operatingline.dev/schema/v1/planning-proposal-draft.json',
    planningProposalDraftSchema,
  ],
  [
    'replanning-prompt-context.schema.json',
    'https://operatingline.dev/schema/v1/replanning-prompt-context.json',
    replanningPromptContextSchema,
  ],
  [
    'replanning-prompt-request.schema.json',
    'https://operatingline.dev/schema/v1/replanning-prompt-request.json',
    replanningPromptRequestSchema,
  ],
  [
    'replanning-prompt-packet.schema.json',
    'https://operatingline.dev/schema/v1/replanning-prompt-packet.json',
    replanningPromptPacketSchema,
  ],
  [
    'planner-replan-draft.schema.json',
    'https://operatingline.dev/schema/v1/planner-replan-draft.json',
    plannerReplanDraftSchema,
  ],
  [
    'planner-replan-generate-request.schema.json',
    'https://operatingline.dev/schema/v1/planner-replan-generate-request.json',
    plannerReplanGenerateRequestSchema,
  ],
  [
    'planner-replan-generation-result.schema.json',
    'https://operatingline.dev/schema/v1/planner-replan-generation-result.json',
    plannerReplanGenerationResultSchema,
  ],
  [
    'planning-benchmark-case.schema.json',
    'https://operatingline.dev/schema/v1/planning-benchmark-case.json',
    planningBenchmarkCaseSchema,
  ],
  [
    'planning-quality-evaluation-request.schema.json',
    'https://operatingline.dev/schema/v1/planning-quality-evaluation-request.json',
    planningQualityEvaluationRequestSchema,
  ],
  [
    'planning-quality-report.schema.json',
    'https://operatingline.dev/schema/v1/planning-quality-report.json',
    planningQualityReportSchema,
  ],
  [
    'guide-revision-thread-history-request.schema.json',
    'https://operatingline.dev/schema/v1/guide-revision-thread-history-request.json',
    guideRevisionThreadHistoryRequestSchema,
  ],
  [
    'guide-revision-thread-history.schema.json',
    'https://operatingline.dev/schema/v1/guide-revision-thread-history.json',
    guideRevisionThreadHistorySchema,
  ],
  [
    'guide-plan-diff.schema.json',
    'https://operatingline.dev/schema/v1/guide-plan-diff.json',
    guidePlanDiffSchema,
  ],
  [
    'eval-export-request.schema.json',
    'https://operatingline.dev/schema/v1/eval-export-request.json',
    evalExportRequestSchema,
  ],
  [
    'eval-export-bundle.schema.json',
    'https://operatingline.dev/schema/v1/eval-export-bundle.json',
    evalExportBundleSchema,
  ],
  [
    'action-catalog.schema.json',
    'https://operatingline.dev/schema/v1/action-catalog.json',
    actionCatalogSchema,
  ],
  [
    'planning-context.schema.json',
    'https://operatingline.dev/schema/v1/planning-context.json',
    planningContextSchema,
  ],
  [
    'guide-revision-request.schema.json',
    'https://operatingline.dev/schema/v1/guide-revision-request.json',
    guideRevisionRequestSchema,
  ],
  [
    'guide-replan-submission.schema.json',
    'https://operatingline.dev/schema/v1/guide-replan-submission.json',
    guideReplanSubmissionSchema,
  ],
  [
    'guide-plan.schema.json',
    'https://operatingline.dev/schema/v1/guide-plan.json',
    guidePlanSchema,
  ],
  [
    'adapter-status.schema.json',
    'https://operatingline.dev/schema/v1/adapter-status.json',
    adapterStatusSchema,
  ],
  [
    'guide-proposal-submission.schema.json',
    'https://operatingline.dev/schema/v1/guide-proposal-submission.json',
    guideProposalSubmissionSchema,
  ],
  [
    'guide-proposal.schema.json',
    'https://operatingline.dev/schema/v1/guide-proposal.json',
    guideProposalSchema,
  ],
  [
    'guide-proposal-decision.schema.json',
    'https://operatingline.dev/schema/v1/guide-proposal-decision.json',
    guideProposalDecisionSchema,
  ],
  [
    'companion-guide-request.schema.json',
    'https://operatingline.dev/schema/v1/companion-guide-request.json',
    companionGuideRequestSchema,
  ],
  [
    'companion-guide-delivery.schema.json',
    'https://operatingline.dev/schema/v1/companion-guide-delivery.json',
    companionGuideDeliverySchema,
  ],
  [
    'companion-state-report.schema.json',
    'https://operatingline.dev/schema/v1/companion-state-report.json',
    companionStateReportSchema,
  ],
] as const;

for (const [filename, id, schema] of schemas) {
  const jsonSchema = z.toJSONSchema(schema, { target: 'draft-2020-12' });
  const outputPath = resolve(outputDirectory, filename);
  const expected = `${JSON.stringify({ ...jsonSchema, $id: id }, null, 2)}\n`;
  if (checkOnly) {
    const actual = readFileSync(outputPath, 'utf8');
    if (actual !== expected) {
      throw new Error(`${filename} is stale; run pnpm schema:generate`);
    }
  } else {
    writeFileSync(outputPath, expected);
  }
}
