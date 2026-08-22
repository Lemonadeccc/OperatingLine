import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { z } from 'zod';

import {
  authorityRevocationSchema,
  authorityValidationReceiptSchema,
  actionCatalogSchema,
  adapterStatusSchema,
  companionActionExecutionCreateRequestSchema,
  companionActionExecutionDeliverySchema,
  companionActionExecutionResultSchema,
  companionActionExecutionStatusRequestSchema,
  companionActionExecutionStatusSchema,
  companionActionPollDeliverySchema,
  companionActionPollRequestSchema,
  companionActionResultAckSchema,
  companionExecutionTrackPreflightBindingSchema,
  companionExecutionTrackPreflightCreateRequestSchema,
  companionExecutionTrackPreflightDeliverySchema,
  companionExecutionTrackPreflightLeaseSchema,
  companionExecutionTrackPreflightPollDeliverySchema,
  companionExecutionTrackPreflightPollRequestSchema,
  companionExecutionTrackPreflightResultAckSchema,
  companionExecutionTrackPreflightResultSchema,
  companionExecutionTrackPreflightStatusRequestSchema,
  companionExecutionTrackPreflightStatusSchema,
  companionExecutionTrackExecutionBaselineIdentitySchema,
  companionExecutionTrackExecutionBindingSchema,
  companionExecutionTrackExecutionCreateRequestSchema,
  companionExecutionTrackExecutionDeliverySchema,
  companionExecutionTrackExecutionManagedStartAckSchema,
  companionExecutionTrackExecutionManagedStartSubmissionSchema,
  companionExecutionTrackExecutionPollDeliverySchema,
  companionExecutionTrackExecutionPollRequestSchema,
  companionExecutionTrackExecutionProgressAckSchema,
  companionExecutionTrackExecutionProgressChainSchema,
  companionExecutionTrackExecutionProgressSchema,
  companionExecutionTrackExecutionProgressTransitionSchema,
  companionExecutionTrackExecutionRecoveryAckSchema,
  companionExecutionTrackExecutionRecoveryPollDeliverySchema,
  companionExecutionTrackExecutionRecoveryRequestSchema,
  companionExecutionTrackExecutionResultAckSchema,
  companionExecutionTrackExecutionResultSchema,
  companionExecutionTrackExecutionStatusRequestSchema,
  companionExecutionTrackExecutionStatusSchema,
  companionDialogueRunCreateRequestSchema,
  companionDialogueRunSchema,
  companionDialogueRunStatusRequestSchema,
  companionGuideDeliverySchema,
  companionGuideRequestSchema,
  companionInitialPlanRunCreateRequestSchema,
  companionInitialPlanRunSchema,
  companionInitialPlanRunStatusRequestSchema,
  companionReplanRunCreateRequestSchema,
  companionReplanRunSchema,
  companionReplanRunStatusRequestSchema,
  companionHeartbeatRequestSchema,
  companionHeartbeatResponseSchema,
  companionSessionHelloRequestSchema,
  companionSessionHelloResponseSchema,
  companionShortcutProofCreateRequestSchema,
  companionShortcutProofDeliverySchema,
  companionShortcutProofHistoryTransitionReconciliationAckSchema,
  companionShortcutProofPollDeliverySchema,
  companionShortcutProofPollRequestSchema,
  companionShortcutProofProgressSchema,
  companionShortcutProofProgressAckSchema,
  companionShortcutProofRecoveryAckResponseSchema,
  companionShortcutProofRecoveryAckSchema,
  companionShortcutProofRecoveryDeliverySchema,
  companionShortcutProofRecoveryRequestSchema,
  companionShortcutProofResultSchema,
  companionShortcutProofResultAckSchema,
  companionShortcutProofStatusRequestSchema,
  companionShortcutProofStatusSchema,
  companionShortcutProofTerminalReconciliationAckSchema,
  companionShortcutProofTerminalReconciliationDeliverySchema,
  companionMenuControlProofCreateRequestSchema,
  companionMenuControlProofDeliverySchema,
  companionMenuControlProofHistoryTransitionReconciliationAckSchema,
  companionMenuControlProofHistoryTransitionReconciliationDeliverySchema,
  companionMenuControlProofHistoryTransitionReportSchema,
  companionMenuControlProofPollDeliverySchema,
  companionMenuControlProofPollRequestSchema,
  companionMenuControlProofProgressAckSchema,
  companionMenuControlProofProgressSchema,
  companionMenuControlProofRecoveryAckResponseSchema,
  companionMenuControlProofRecoveryRequestSchema,
  companionMenuControlProofResultAckSchema,
  companionMenuControlProofResultSchema,
  companionMenuControlProofStatusRequestSchema,
  companionMenuControlProofStatusSchema,
  companionMenuControlProofTerminalReconciliationAckSchema,
  companionMenuControlProofTerminalReconciliationDeliverySchema,
  companionStateReportSchema,
  blenderExecutionDecisionReceiptSchema,
  blenderHistoryTransitionDecisionReceiptSchema,
  decisionLifecycleEventSchema,
  datasetReleaseAuthorizationSchema,
  evalExportBundleSchema,
  externalAuthorityRecordSchema,
  evalExportRequestSchema,
  guidePlanSchema,
  guidePlanDiffSchema,
  guideGoalPromptRequestSchema,
  guideGoalRequestAcknowledgementSchema,
  guideGoalRequestListSchema,
  guideGoalRequestSchema,
  guideProposalDecisionSchema,
  guideProposalSchema,
  guideProposalSubmissionSchema,
  guideReplanSubmissionSchema,
  guideRevisionBranchListRequestSchema,
  guideRevisionBranchListSchema,
  guideRevisionRequestSchema,
  guideRevisionThreadHistoryRequestSchema,
  guideRevisionThreadHistorySchema,
  humanEvalAdjudicationSchema,
  humanEvalAnnotationSchema,
  humanEvalComparisonReportSchema,
  humanEvalReleasedManifestSchema,
  humanEvalReleaseRequestSchema,
  humanEvalReleaseResponseSchema,
  humanEvalReleaseCandidateManifestSchema,
  humanEvalSuiteSchema,
  interactionCatalogSchema,
  interactionOperationSchema,
  localMediaImportAuthorizationSchema,
  mediaRightsEvidenceSchema,
  planningContextSchema,
  planningBenchmarkCaseSchema,
  planningPromptContextSchema,
  planningPromptPacketSchema,
  planningPromptRequestSchema,
  planningProposalDraftSchema,
  planningQualityEvaluationRequestSchema,
  planningQualityReportSchema,
  procedureAuthoringPromptContextSchema,
  procedureAuthoringPromptPacketSchema,
  procedureAuthoringPromptRequestSchema,
  procedureAuthoringCandidateTreeSchema,
  procedureAuthoringGenerateRequestSchema,
  procedureAuthoringGenerationResultSchema,
  procedureAuthoringValidationRequestSchema,
  procedureAuthoringValidationResultSchema,
  procedureTutorialTranscriptImportRequestSchema,
  procedureTutorialTranscriptGenerateRequestSchema,
  procedureTutorialYoutubeImportRequestSchema,
  procedureTutorialAuthoringBindingSchema,
  procedureTutorialAuthoringResultSchema,
  procedureTutorialAuthoringReviewRequestSchema,
  procedureTutorialAuthoringResumeRequestSchema,
  procedureTutorialAuthoringRunCreateRequestSchema,
  procedureTutorialAuthoringRunStatusRequestSchema,
  procedureTutorialAuthoringRunStatusSchema,
  procedureTutorialMediaAnalysisStartRequestSchema,
  procedureTutorialMediaCurrentAnalysisResultSchema,
  procedureTutorialMediaCapabilitiesSchema,
  procedureTutorialMediaCurrentJobStatusSchema,
  procedureTutorialMediaJobStatusRequestSchema,
  procedureTutorialMediaRecognitionArtifactSchema,
  procedureTutorialMediaResumeRequestSchema,
  procedureTutorialMediaAuthoringCurrentPreparationSchema,
  procedureTutorialMediaAuthoringPrepareStartRequestSchema,
  procedureTutorialMediaAuthoringBindingSchema,
  procedureTutorialMediaAuthoringResumeRequestSchema,
  procedureTutorialMediaAuthoringReviewRequestSchema,
  procedureTutorialMediaAuthoringRunCreateRequestSchema,
  procedureTutorialMediaAuthoringRunStatusRequestSchema,
  procedureTutorialMediaAuthoringCurrentRunStatusSchema,
  procedureTutorialYoutubeTrackListRequestSchema,
  procedureTutorialYoutubeTrackListResultSchema,
  procedureTutorialYoutubeTrackRecommendationRequestSchema,
  procedureTutorialYoutubeTrackRecommendationResultSchema,
  procedureTutorialYoutubeTrackSelectionRequestSchema,
  procedureTutorialYoutubeTrackSelectionResultSchema,
  procedureZeroBaselineCompletedEventSchema,
  procedureZeroBaselineGenerateRequestSchema,
  procedureZeroBaselineRequestedEventSchema,
  procedureZeroBaselineResultSchema,
  procedureZeroBaselineRefinementCreateRequestSchema,
  procedureZeroBaselineRefinementRequestSchema,
  procedureZeroBaselineReviewBindingSchema,
  procedureZeroBaselineStorageBindingSchema,
  procedureZeroBaselineReviewRequestSchema,
  procedureZeroBaselineSemanticStartRequestSchema,
  procedureZeroBaselineRefinementStartRequestSchema,
  procedureZeroBaselineRefinementStatusRequestSchema,
  procedureZeroBaselineRefinementStatusSchema,
  procedureAuthoringMaterializationRequestSchema,
  procedureAuthoringMaterializationResultSchema,
  procedureLeafReplayAttestationSchema,
  procedureLeafReplayBindingSchema,
  procedureLeafReplayCurrentStateRequestSchema,
  procedureLeafReplayCurrentStateRequestResultSchema,
  procedureLeafReplayCurrentStateStatusRequestSchema,
  procedureLeafReplayCurrentStateStatusResultSchema,
  procedureLeafReplayCurrentStateVerificationSchema,
  procedureLeafReplayFailureRecoveryAttestationSchema,
  procedureLeafReplayFailureRecoveryFinalizeRequestSchema,
  procedureLeafReplayFailureRecoveryFinalizeResultSchema,
  procedureLeafReplayFinalizeRequestSchema,
  procedureLeafReplayFinalizeResultSchema,
  procedureLeafReplayProposalRequestSchema,
  procedureLeafReplayProposalResultSchema,
  procedureShortcutProofAttestationSchema,
  procedureShortcutProofBindingSchema,
  procedureShortcutProofFailureCheckpointSchema,
  procedureShortcutProofProposalRequestSchema,
  procedureShortcutProofProposalRecordSchema,
  procedureShortcutProofProposalResultSchema,
  procedureMenuControlProofBindingSchema,
  procedureMenuControlProofProposalRequestSchema,
  procedureMenuControlProofProposalRecordSchema,
  procedureMenuControlProofProposalResultSchema,
  procedureTreeSchema,
  procedureCompilationRequestSchema,
  procedureCompilationResultSchema,
  procedureTreeGetRequestSchema,
  procedureTreeListRequestSchema,
  procedureTreeListResultSchema,
  procedureOperationSearchRequestSchema,
  procedureOperationSearchResultSchema,
  procedureSemanticRetrievalCompletedEventSchema,
  procedureSemanticRetrievalFailedEventSchema,
  procedureSemanticRetrievalProviderDisclosureListSchema,
  procedureSemanticRetrievalProviderRuntimeOutputAttestationSchema,
  procedureSemanticRetrievalProviderRuntimeTreatmentAttestationSchema,
  procedureSemanticRetrievalRequestSchema,
  procedureSemanticRetrievalRequestedEventSchema,
  procedureSemanticRetrievalResultSchema,
  procedureRefinementCreateRequestSchema,
  procedureRefinementDialogueCompletedEventSchema,
  procedureRefinementDialogueFailedEventSchema,
  procedureRefinementDialoguePromptPacketSchema,
  procedureRefinementDialogueProviderResultSchema,
  procedureRefinementDialogueRequestedEventSchema,
  procedureRefinementGenerationCompletedEventSchema,
  procedureRefinementGenerationFailedEventSchema,
  procedureRefinementGenerationOutcomeSchema,
  procedureRefinementGenerationRequestedEventSchema,
  procedureRefinementLocalityReportSchema,
  procedureRefinementPromptPacketSchema,
  procedureRefinementProviderDisclosureListSchema,
  procedureRefinementProviderInputPolicySchema,
  procedureRefinementProviderResultSchema,
  procedureRefinementProviderRuntimeTreatmentAttestationSchema,
  procedureRefinementReviewRequestSchema,
  procedureRefinementReviewedEventSchema,
  procedureRefinementRunStatusRequestSchema,
  procedureRefinementRunStatusSchema,
  procedureRefinementSemanticContextBindingSchema,
  procedureRefinementSemanticContextReceiptRequestSchema,
  procedureRefinementScopeSchema,
  procedureTreeStoreRequestSchema,
  procedureTreeStoreResultSchema,
  procedureTreeEditorBranchCreateRequestSchema,
  procedureTreeEditorBranchCreateResultSchema,
  procedureTreeEditorBranchGetRequestSchema,
  procedureTreeEditorBranchGetResultSchema,
  procedureTreeEditorBranchListRequestSchema,
  procedureTreeEditorBranchListResultSchema,
  procedureTreeEditorWorkspaceRequestSchema,
  procedureTreeEditorWorkspaceResultSchema,
  procedureTreeEditorDiffResultSchema,
  procedureTreeEditorEditPreviewRequestSchema,
  procedureTreeEditorEditPreviewResultSchema,
  procedureTreeEditorMergePreviewRequestSchema,
  procedureTreeEditorMergePreviewResultSchema,
  procedureTreeEditorCommitRequestSchema,
  procedureTreeEditorCommitResultSchema,
  procedureTreeEditorRevisionCommitSchema,
  procedureTreeEditorBranchHistoryRequestSchema,
  procedureTreeEditorBranchHistoryResultSchema,
  procedureTreeEditorCommentCreateRequestSchema,
  procedureTreeEditorCommentCreateResultSchema,
  procedureTreeEditorCommentListRequestSchema,
  procedureTreeEditorCommentListResultSchema,
  procedureTreeEditorParameterFormRequestSchema,
  procedureTreeEditorParameterFormResultSchema,
  storedProcedureTreeSchema,
  plannerGenerateRequestSchema,
  plannerGenerationErrorSchema,
  plannerGenerationResultSchema,
  plannerProviderDescriptorSchema,
  plannerProviderListSchema,
  plannerReplanDraftSchema,
  plannerReplanGenerateRequestSchema,
  plannerReplanGenerationResultSchema,
  providerEvalRunSchema,
  providerCallAuthorizationSchema,
  procedureCompoundReplaySchema,
  replanningPromptContextSchema,
  replanningPromptPacketSchema,
  replanningPromptRequestSchema,
  trainingRunDecisionReceiptSchema,
  trainingUseAuthorizationSchema,
  youtubePlatformDownloadAuthorizationSchema,
} from '../src/index.js';

const outputDirectory = resolve(process.cwd(), '../../protocol/schemas/v1');
mkdirSync(outputDirectory, { recursive: true });
const checkOnly = process.argv.includes('--check');
const onlyFilename = process.argv
  .find((argument) => argument.startsWith('--only='))
  ?.slice('--only='.length);

const schemas = [
  [
    'external-authority-record.schema.json',
    'https://operatingline.dev/schema/v1/external-authority-record.json',
    externalAuthorityRecordSchema,
  ],
  [
    'provider-call-authorization.schema.json',
    'https://operatingline.dev/schema/v1/provider-call-authorization.json',
    providerCallAuthorizationSchema,
  ],
  [
    'local-media-import-authorization.schema.json',
    'https://operatingline.dev/schema/v1/local-media-import-authorization.json',
    localMediaImportAuthorizationSchema,
  ],
  [
    'media-rights-evidence.schema.json',
    'https://operatingline.dev/schema/v1/media-rights-evidence.json',
    mediaRightsEvidenceSchema,
  ],
  [
    'youtube-platform-download-authorization.schema.json',
    'https://operatingline.dev/schema/v1/youtube-platform-download-authorization.json',
    youtubePlatformDownloadAuthorizationSchema,
  ],
  [
    'dataset-release-authorization.schema.json',
    'https://operatingline.dev/schema/v1/dataset-release-authorization.json',
    datasetReleaseAuthorizationSchema,
  ],
  [
    'training-use-authorization.schema.json',
    'https://operatingline.dev/schema/v1/training-use-authorization.json',
    trainingUseAuthorizationSchema,
  ],
  [
    'authority-revocation.schema.json',
    'https://operatingline.dev/schema/v1/authority-revocation.json',
    authorityRevocationSchema,
  ],
  [
    'authority-validation-receipt.schema.json',
    'https://operatingline.dev/schema/v1/authority-validation-receipt.json',
    authorityValidationReceiptSchema,
  ],
  [
    'blender-execution-decision-receipt.schema.json',
    'https://operatingline.dev/schema/v1/blender-execution-decision-receipt.json',
    blenderExecutionDecisionReceiptSchema,
  ],
  [
    'blender-history-transition-decision-receipt.schema.json',
    'https://operatingline.dev/schema/v1/blender-history-transition-decision-receipt.json',
    blenderHistoryTransitionDecisionReceiptSchema,
  ],
  [
    'training-run-decision-receipt.schema.json',
    'https://operatingline.dev/schema/v1/training-run-decision-receipt.json',
    trainingRunDecisionReceiptSchema,
  ],
  [
    'decision-lifecycle-event.schema.json',
    'https://operatingline.dev/schema/v1/decision-lifecycle-event.json',
    decisionLifecycleEventSchema,
  ],
  [
    'interaction-operation.schema.json',
    'https://operatingline.dev/schema/v1/interaction-operation.json',
    interactionOperationSchema,
  ],
  [
    'procedure-compound-replay.schema.json',
    'https://operatingline.dev/schema/v1/procedure-compound-replay.json',
    procedureCompoundReplaySchema,
  ],
  [
    'companion-menu-control-proof-create-request.schema.json',
    'https://operatingline.dev/schema/v1/companion-menu-control-proof-create-request.json',
    companionMenuControlProofCreateRequestSchema,
  ],
  [
    'companion-menu-control-proof-delivery.schema.json',
    'https://operatingline.dev/schema/v1/companion-menu-control-proof-delivery.json',
    companionMenuControlProofDeliverySchema,
  ],
  [
    'companion-menu-control-proof-progress.schema.json',
    'https://operatingline.dev/schema/v1/companion-menu-control-proof-progress.json',
    companionMenuControlProofProgressSchema,
  ],
  [
    'companion-menu-control-proof-result.schema.json',
    'https://operatingline.dev/schema/v1/companion-menu-control-proof-result.json',
    companionMenuControlProofResultSchema,
  ],
  [
    'companion-menu-control-proof-status-request.schema.json',
    'https://operatingline.dev/schema/v1/companion-menu-control-proof-status-request.json',
    companionMenuControlProofStatusRequestSchema,
  ],
  [
    'companion-menu-control-proof-status.schema.json',
    'https://operatingline.dev/schema/v1/companion-menu-control-proof-status.json',
    companionMenuControlProofStatusSchema,
  ],
  [
    'companion-menu-control-proof-poll-request.schema.json',
    'https://operatingline.dev/schema/v1/companion-menu-control-proof-poll-request.json',
    companionMenuControlProofPollRequestSchema,
  ],
  [
    'companion-menu-control-proof-poll-delivery.schema.json',
    'https://operatingline.dev/schema/v1/companion-menu-control-proof-poll-delivery.json',
    companionMenuControlProofPollDeliverySchema,
  ],
  [
    'companion-menu-control-proof-progress-ack.schema.json',
    'https://operatingline.dev/schema/v1/companion-menu-control-proof-progress-ack.json',
    companionMenuControlProofProgressAckSchema,
  ],
  [
    'companion-menu-control-proof-result-ack.schema.json',
    'https://operatingline.dev/schema/v1/companion-menu-control-proof-result-ack.json',
    companionMenuControlProofResultAckSchema,
  ],
  [
    'companion-menu-control-proof-terminal-reconciliation-delivery.schema.json',
    'https://operatingline.dev/schema/v1/companion-menu-control-proof-terminal-reconciliation-delivery.json',
    companionMenuControlProofTerminalReconciliationDeliverySchema,
  ],
  [
    'companion-menu-control-proof-terminal-reconciliation-ack.schema.json',
    'https://operatingline.dev/schema/v1/companion-menu-control-proof-terminal-reconciliation-ack.json',
    companionMenuControlProofTerminalReconciliationAckSchema,
  ],
  [
    'companion-menu-control-proof-history-transition-report.schema.json',
    'https://operatingline.dev/schema/v1/companion-menu-control-proof-history-transition-report.json',
    companionMenuControlProofHistoryTransitionReportSchema,
  ],
  [
    'companion-menu-control-proof-history-transition-reconciliation-delivery.schema.json',
    'https://operatingline.dev/schema/v1/companion-menu-control-proof-history-transition-reconciliation-delivery.json',
    companionMenuControlProofHistoryTransitionReconciliationDeliverySchema,
  ],
  [
    'companion-menu-control-proof-history-transition-reconciliation-ack.schema.json',
    'https://operatingline.dev/schema/v1/companion-menu-control-proof-history-transition-reconciliation-ack.json',
    companionMenuControlProofHistoryTransitionReconciliationAckSchema,
  ],
  [
    'companion-menu-control-proof-recovery-request.schema.json',
    'https://operatingline.dev/schema/v1/companion-menu-control-proof-recovery-request.json',
    companionMenuControlProofRecoveryRequestSchema,
  ],
  [
    'companion-menu-control-proof-recovery-ack-response.schema.json',
    'https://operatingline.dev/schema/v1/companion-menu-control-proof-recovery-ack-response.json',
    companionMenuControlProofRecoveryAckResponseSchema,
  ],
  [
    'companion-shortcut-proof-create-request.schema.json',
    'https://operatingline.dev/schema/v1/companion-shortcut-proof-create-request.json',
    companionShortcutProofCreateRequestSchema,
  ],
  [
    'companion-shortcut-proof-delivery.schema.json',
    'https://operatingline.dev/schema/v1/companion-shortcut-proof-delivery.json',
    companionShortcutProofDeliverySchema,
  ],
  [
    'companion-shortcut-proof-progress.schema.json',
    'https://operatingline.dev/schema/v1/companion-shortcut-proof-progress.json',
    companionShortcutProofProgressSchema,
  ],
  [
    'companion-shortcut-proof-result.schema.json',
    'https://operatingline.dev/schema/v1/companion-shortcut-proof-result.json',
    companionShortcutProofResultSchema,
  ],
  [
    'companion-shortcut-proof-status-request.schema.json',
    'https://operatingline.dev/schema/v1/companion-shortcut-proof-status-request.json',
    companionShortcutProofStatusRequestSchema,
  ],
  [
    'companion-shortcut-proof-status.schema.json',
    'https://operatingline.dev/schema/v1/companion-shortcut-proof-status.json',
    companionShortcutProofStatusSchema,
  ],
  [
    'companion-shortcut-proof-poll-request.schema.json',
    'https://operatingline.dev/schema/v1/companion-shortcut-proof-poll-request.json',
    companionShortcutProofPollRequestSchema,
  ],
  [
    'companion-shortcut-proof-poll-delivery.schema.json',
    'https://operatingline.dev/schema/v1/companion-shortcut-proof-poll-delivery.json',
    companionShortcutProofPollDeliverySchema,
  ],
  [
    'companion-shortcut-proof-progress-ack.schema.json',
    'https://operatingline.dev/schema/v1/companion-shortcut-proof-progress-ack.json',
    companionShortcutProofProgressAckSchema,
  ],
  [
    'companion-shortcut-proof-result-ack.schema.json',
    'https://operatingline.dev/schema/v1/companion-shortcut-proof-result-ack.json',
    companionShortcutProofResultAckSchema,
  ],
  [
    'companion-shortcut-proof-recovery-delivery.schema.json',
    'https://operatingline.dev/schema/v1/companion-shortcut-proof-recovery-delivery.json',
    companionShortcutProofRecoveryDeliverySchema,
  ],
  [
    'companion-shortcut-proof-recovery-ack.schema.json',
    'https://operatingline.dev/schema/v1/companion-shortcut-proof-recovery-ack.json',
    companionShortcutProofRecoveryAckSchema,
  ],
  [
    'companion-shortcut-proof-recovery-ack-response.schema.json',
    'https://operatingline.dev/schema/v1/companion-shortcut-proof-recovery-ack-response.json',
    companionShortcutProofRecoveryAckResponseSchema,
  ],
  [
    'companion-shortcut-proof-terminal-reconciliation-delivery.schema.json',
    'https://operatingline.dev/schema/v1/companion-shortcut-proof-terminal-reconciliation-delivery.json',
    companionShortcutProofTerminalReconciliationDeliverySchema,
  ],
  [
    'companion-shortcut-proof-terminal-reconciliation-ack.schema.json',
    'https://operatingline.dev/schema/v1/companion-shortcut-proof-terminal-reconciliation-ack.json',
    companionShortcutProofTerminalReconciliationAckSchema,
  ],
  [
    'companion-shortcut-proof-history-transition-reconciliation-ack.schema.json',
    'https://operatingline.dev/schema/v1/companion-shortcut-proof-history-transition-reconciliation-ack.json',
    companionShortcutProofHistoryTransitionReconciliationAckSchema,
  ],
  [
    'companion-shortcut-proof-recovery-request.schema.json',
    'https://operatingline.dev/schema/v1/companion-shortcut-proof-recovery-request.json',
    companionShortcutProofRecoveryRequestSchema,
  ],
  [
    'companion-action-execution-create-request.schema.json',
    'https://operatingline.dev/schema/v1/companion-action-execution-create-request.json',
    companionActionExecutionCreateRequestSchema,
  ],
  [
    'companion-action-execution-delivery.schema.json',
    'https://operatingline.dev/schema/v1/companion-action-execution-delivery.json',
    companionActionExecutionDeliverySchema,
  ],
  [
    'companion-action-execution-result.schema.json',
    'https://operatingline.dev/schema/v1/companion-action-execution-result.json',
    companionActionExecutionResultSchema,
  ],
  [
    'companion-action-execution-status-request.schema.json',
    'https://operatingline.dev/schema/v1/companion-action-execution-status-request.json',
    companionActionExecutionStatusRequestSchema,
  ],
  [
    'companion-action-execution-status.schema.json',
    'https://operatingline.dev/schema/v1/companion-action-execution-status.json',
    companionActionExecutionStatusSchema,
  ],
  [
    'companion-action-poll-request.schema.json',
    'https://operatingline.dev/schema/v1/companion-action-poll-request.json',
    companionActionPollRequestSchema,
  ],
  [
    'companion-action-poll-delivery.schema.json',
    'https://operatingline.dev/schema/v1/companion-action-poll-delivery.json',
    companionActionPollDeliverySchema,
  ],
  [
    'companion-action-result-ack.schema.json',
    'https://operatingline.dev/schema/v1/companion-action-result-ack.json',
    companionActionResultAckSchema,
  ],
  [
    'companion-execution-track-preflight-create-request.schema.json',
    'https://operatingline.dev/schema/v1/companion-execution-track-preflight-create-request.json',
    companionExecutionTrackPreflightCreateRequestSchema,
  ],
  [
    'companion-execution-track-preflight-binding.schema.json',
    'https://operatingline.dev/schema/v1/companion-execution-track-preflight-binding.json',
    companionExecutionTrackPreflightBindingSchema,
  ],
  [
    'companion-execution-track-preflight-lease.schema.json',
    'https://operatingline.dev/schema/v1/companion-execution-track-preflight-lease.json',
    companionExecutionTrackPreflightLeaseSchema,
  ],
  [
    'companion-execution-track-preflight-delivery.schema.json',
    'https://operatingline.dev/schema/v1/companion-execution-track-preflight-delivery.json',
    companionExecutionTrackPreflightDeliverySchema,
  ],
  [
    'companion-execution-track-preflight-result.schema.json',
    'https://operatingline.dev/schema/v1/companion-execution-track-preflight-result.json',
    companionExecutionTrackPreflightResultSchema,
  ],
  [
    'companion-execution-track-preflight-status-request.schema.json',
    'https://operatingline.dev/schema/v1/companion-execution-track-preflight-status-request.json',
    companionExecutionTrackPreflightStatusRequestSchema,
  ],
  [
    'companion-execution-track-preflight-status.schema.json',
    'https://operatingline.dev/schema/v1/companion-execution-track-preflight-status.json',
    companionExecutionTrackPreflightStatusSchema,
  ],
  [
    'companion-execution-track-preflight-poll-request.schema.json',
    'https://operatingline.dev/schema/v1/companion-execution-track-preflight-poll-request.json',
    companionExecutionTrackPreflightPollRequestSchema,
  ],
  [
    'companion-execution-track-preflight-poll-delivery.schema.json',
    'https://operatingline.dev/schema/v1/companion-execution-track-preflight-poll-delivery.json',
    companionExecutionTrackPreflightPollDeliverySchema,
  ],
  [
    'companion-execution-track-preflight-result-ack.schema.json',
    'https://operatingline.dev/schema/v1/companion-execution-track-preflight-result-ack.json',
    companionExecutionTrackPreflightResultAckSchema,
  ],
  ...(
    [
      ['create-request', companionExecutionTrackExecutionCreateRequestSchema],
      ['binding', companionExecutionTrackExecutionBindingSchema],
      ['baseline-identity', companionExecutionTrackExecutionBaselineIdentitySchema],
      ['delivery', companionExecutionTrackExecutionDeliverySchema],
      ['managed-start-submission', companionExecutionTrackExecutionManagedStartSubmissionSchema],
      ['managed-start-ack', companionExecutionTrackExecutionManagedStartAckSchema],
      ['progress', companionExecutionTrackExecutionProgressSchema],
      ['progress-transition', companionExecutionTrackExecutionProgressTransitionSchema],
      ['progress-chain', companionExecutionTrackExecutionProgressChainSchema],
      ['progress-ack', companionExecutionTrackExecutionProgressAckSchema],
      ['result', companionExecutionTrackExecutionResultSchema],
      ['result-ack', companionExecutionTrackExecutionResultAckSchema],
      ['status-request', companionExecutionTrackExecutionStatusRequestSchema],
      ['status', companionExecutionTrackExecutionStatusSchema],
      ['poll-request', companionExecutionTrackExecutionPollRequestSchema],
      ['poll-delivery', companionExecutionTrackExecutionPollDeliverySchema],
      ['recovery-request', companionExecutionTrackExecutionRecoveryRequestSchema],
      ['recovery-poll-delivery', companionExecutionTrackExecutionRecoveryPollDeliverySchema],
      ['recovery-ack', companionExecutionTrackExecutionRecoveryAckSchema],
    ] as const
  ).map(
    ([kind, schema]) =>
      [
        `companion-execution-track-execution-${kind}.schema.json`,
        `https://operatingline.dev/schema/v1/companion-execution-track-execution-${kind}.json`,
        schema,
      ] as const,
  ),
  [
    'procedure-tree-editor-branch-create-request.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tree-editor-branch-create-request.json',
    procedureTreeEditorBranchCreateRequestSchema,
  ],
  [
    'procedure-tree-editor-branch-create-result.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tree-editor-branch-create-result.json',
    procedureTreeEditorBranchCreateResultSchema,
  ],
  [
    'procedure-tree-editor-branch-get-request.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tree-editor-branch-get-request.json',
    procedureTreeEditorBranchGetRequestSchema,
  ],
  [
    'procedure-tree-editor-branch-get-result.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tree-editor-branch-get-result.json',
    procedureTreeEditorBranchGetResultSchema,
  ],
  [
    'procedure-tree-editor-branch-list-request.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tree-editor-branch-list-request.json',
    procedureTreeEditorBranchListRequestSchema,
  ],
  [
    'procedure-tree-editor-branch-list-result.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tree-editor-branch-list-result.json',
    procedureTreeEditorBranchListResultSchema,
  ],
  [
    'procedure-tree-editor-workspace-request.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tree-editor-workspace-request.json',
    procedureTreeEditorWorkspaceRequestSchema,
  ],
  [
    'procedure-tree-editor-workspace-result.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tree-editor-workspace-result.json',
    procedureTreeEditorWorkspaceResultSchema,
  ],
  [
    'procedure-tree-editor-diff-result.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tree-editor-diff-result.json',
    procedureTreeEditorDiffResultSchema,
  ],
  [
    'procedure-tree-editor-edit-preview-request.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tree-editor-edit-preview-request.json',
    procedureTreeEditorEditPreviewRequestSchema,
  ],
  [
    'procedure-tree-editor-edit-preview-result.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tree-editor-edit-preview-result.json',
    procedureTreeEditorEditPreviewResultSchema,
  ],
  [
    'procedure-tree-editor-merge-preview-request.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tree-editor-merge-preview-request.json',
    procedureTreeEditorMergePreviewRequestSchema,
  ],
  [
    'procedure-tree-editor-merge-preview-result.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tree-editor-merge-preview-result.json',
    procedureTreeEditorMergePreviewResultSchema,
  ],
  [
    'procedure-tree-editor-commit-request.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tree-editor-commit-request.json',
    procedureTreeEditorCommitRequestSchema,
  ],
  [
    'procedure-tree-editor-commit-result.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tree-editor-commit-result.json',
    procedureTreeEditorCommitResultSchema,
  ],
  [
    'procedure-tree-editor-revision-commit.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tree-editor-revision-commit.json',
    procedureTreeEditorRevisionCommitSchema,
  ],
  [
    'procedure-tree-editor-branch-history-request.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tree-editor-branch-history-request.json',
    procedureTreeEditorBranchHistoryRequestSchema,
  ],
  [
    'procedure-tree-editor-branch-history-result.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tree-editor-branch-history-result.json',
    procedureTreeEditorBranchHistoryResultSchema,
  ],
  [
    'procedure-tree-editor-comment-create-request.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tree-editor-comment-create-request.json',
    procedureTreeEditorCommentCreateRequestSchema,
  ],
  [
    'procedure-tree-editor-comment-create-result.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tree-editor-comment-create-result.json',
    procedureTreeEditorCommentCreateResultSchema,
  ],
  [
    'procedure-tree-editor-comment-list-request.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tree-editor-comment-list-request.json',
    procedureTreeEditorCommentListRequestSchema,
  ],
  [
    'procedure-tree-editor-comment-list-result.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tree-editor-comment-list-result.json',
    procedureTreeEditorCommentListResultSchema,
  ],
  [
    'procedure-tree-editor-parameter-form-request.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tree-editor-parameter-form-request.json',
    procedureTreeEditorParameterFormRequestSchema,
  ],
  [
    'procedure-tree-editor-parameter-form-result.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tree-editor-parameter-form-result.json',
    procedureTreeEditorParameterFormResultSchema,
  ],
  [
    'companion-session-hello-request.schema.json',
    'https://operatingline.dev/schema/v1/companion-session-hello-request.json',
    companionSessionHelloRequestSchema,
  ],
  [
    'companion-session-hello-response.schema.json',
    'https://operatingline.dev/schema/v1/companion-session-hello-response.json',
    companionSessionHelloResponseSchema,
  ],
  [
    'companion-session-heartbeat-request.schema.json',
    'https://operatingline.dev/schema/v1/companion-session-heartbeat-request.json',
    companionHeartbeatRequestSchema,
  ],
  [
    'companion-session-heartbeat-response.schema.json',
    'https://operatingline.dev/schema/v1/companion-session-heartbeat-response.json',
    companionHeartbeatResponseSchema,
  ],
  [
    'companion-dialogue-run-create-request.schema.json',
    'https://operatingline.dev/schema/v1/companion-dialogue-run-create-request.json',
    companionDialogueRunCreateRequestSchema,
  ],
  [
    'companion-dialogue-run-status-request.schema.json',
    'https://operatingline.dev/schema/v1/companion-dialogue-run-status-request.json',
    companionDialogueRunStatusRequestSchema,
  ],
  [
    'companion-dialogue-run.schema.json',
    'https://operatingline.dev/schema/v1/companion-dialogue-run.json',
    companionDialogueRunSchema,
  ],
  [
    'guide-goal-request.schema.json',
    'https://operatingline.dev/schema/v1/guide-goal-request.json',
    guideGoalRequestSchema,
  ],
  [
    'guide-goal-request-acknowledgement.schema.json',
    'https://operatingline.dev/schema/v1/guide-goal-request-acknowledgement.json',
    guideGoalRequestAcknowledgementSchema,
  ],
  [
    'guide-goal-request-list.schema.json',
    'https://operatingline.dev/schema/v1/guide-goal-request-list.json',
    guideGoalRequestListSchema,
  ],
  [
    'guide-goal-prompt-request.schema.json',
    'https://operatingline.dev/schema/v1/guide-goal-prompt-request.json',
    guideGoalPromptRequestSchema,
  ],
  [
    'human-eval-suite.schema.json',
    'https://operatingline.dev/schema/v1/human-eval-suite.json',
    humanEvalSuiteSchema,
  ],
  [
    'provider-eval-run.schema.json',
    'https://operatingline.dev/schema/v1/provider-eval-run.json',
    providerEvalRunSchema,
  ],
  [
    'human-eval-annotation.schema.json',
    'https://operatingline.dev/schema/v1/human-eval-annotation.json',
    humanEvalAnnotationSchema,
  ],
  [
    'human-eval-adjudication.schema.json',
    'https://operatingline.dev/schema/v1/human-eval-adjudication.json',
    humanEvalAdjudicationSchema,
  ],
  [
    'human-eval-comparison-report.schema.json',
    'https://operatingline.dev/schema/v1/human-eval-comparison-report.json',
    humanEvalComparisonReportSchema,
  ],
  [
    'human-eval-release-candidate-manifest.schema.json',
    'https://operatingline.dev/schema/v1/human-eval-release-candidate-manifest.json',
    humanEvalReleaseCandidateManifestSchema,
  ],
  [
    'human-eval-released-manifest.schema.json',
    'https://operatingline.dev/schema/v1/human-eval-released-manifest.json',
    humanEvalReleasedManifestSchema,
  ],
  [
    'human-eval-release-request.schema.json',
    'https://operatingline.dev/schema/v1/human-eval-release-request.json',
    humanEvalReleaseRequestSchema,
  ],
  [
    'human-eval-release-response.schema.json',
    'https://operatingline.dev/schema/v1/human-eval-release-response.json',
    humanEvalReleaseResponseSchema,
  ],
  [
    'companion-initial-plan-run-create-request.schema.json',
    'https://operatingline.dev/schema/v1/companion-initial-plan-run-create-request.json',
    companionInitialPlanRunCreateRequestSchema,
  ],
  [
    'companion-initial-plan-run-status-request.schema.json',
    'https://operatingline.dev/schema/v1/companion-initial-plan-run-status-request.json',
    companionInitialPlanRunStatusRequestSchema,
  ],
  [
    'companion-initial-plan-run.schema.json',
    'https://operatingline.dev/schema/v1/companion-initial-plan-run.json',
    companionInitialPlanRunSchema,
  ],
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
    'guide-revision-branch-list-request.schema.json',
    'https://operatingline.dev/schema/v1/guide-revision-branch-list-request.json',
    guideRevisionBranchListRequestSchema,
  ],
  [
    'guide-revision-branch-list.schema.json',
    'https://operatingline.dev/schema/v1/guide-revision-branch-list.json',
    guideRevisionBranchListSchema,
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
    'interaction-catalog.schema.json',
    'https://operatingline.dev/schema/v1/interaction-catalog.json',
    interactionCatalogSchema,
  ],
  [
    'procedure-tree.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tree.json',
    procedureTreeSchema,
  ],
  [
    'procedure-authoring-candidate-tree.schema.json',
    'https://operatingline.dev/schema/v1/procedure-authoring-candidate-tree.json',
    procedureAuthoringCandidateTreeSchema,
  ],
  [
    'procedure-authoring-prompt-request.schema.json',
    'https://operatingline.dev/schema/v1/procedure-authoring-prompt-request.json',
    procedureAuthoringPromptRequestSchema,
  ],
  [
    'procedure-authoring-prompt-context.schema.json',
    'https://operatingline.dev/schema/v1/procedure-authoring-prompt-context.json',
    procedureAuthoringPromptContextSchema,
  ],
  [
    'procedure-authoring-prompt-packet.schema.json',
    'https://operatingline.dev/schema/v1/procedure-authoring-prompt-packet.json',
    procedureAuthoringPromptPacketSchema,
  ],
  [
    'procedure-authoring-validation-request.schema.json',
    'https://operatingline.dev/schema/v1/procedure-authoring-validation-request.json',
    procedureAuthoringValidationRequestSchema,
  ],
  [
    'procedure-authoring-validation-result.schema.json',
    'https://operatingline.dev/schema/v1/procedure-authoring-validation-result.json',
    procedureAuthoringValidationResultSchema,
  ],
  [
    'procedure-authoring-generate-request.schema.json',
    'https://operatingline.dev/schema/v1/procedure-authoring-generate-request.json',
    procedureAuthoringGenerateRequestSchema,
  ],
  [
    'procedure-authoring-generation-result.schema.json',
    'https://operatingline.dev/schema/v1/procedure-authoring-generation-result.json',
    procedureAuthoringGenerationResultSchema,
  ],
  [
    'procedure-zero-baseline-generate-request.schema.json',
    'https://operatingline.dev/schema/v1/procedure-zero-baseline-generate-request.json',
    procedureZeroBaselineGenerateRequestSchema,
  ],
  [
    'procedure-zero-baseline-result.schema.json',
    'https://operatingline.dev/schema/v1/procedure-zero-baseline-result.json',
    procedureZeroBaselineResultSchema,
  ],
  [
    'procedure-zero-baseline-requested-event.schema.json',
    'https://operatingline.dev/schema/v1/procedure-zero-baseline-requested-event.json',
    procedureZeroBaselineRequestedEventSchema,
  ],
  [
    'procedure-zero-baseline-completed-event.schema.json',
    'https://operatingline.dev/schema/v1/procedure-zero-baseline-completed-event.json',
    procedureZeroBaselineCompletedEventSchema,
  ],
  [
    'procedure-zero-baseline-refinement-request.schema.json',
    'https://operatingline.dev/schema/v1/procedure-zero-baseline-refinement-request.json',
    procedureZeroBaselineRefinementRequestSchema,
  ],
  [
    'procedure-zero-baseline-refinement-create-request.schema.json',
    'https://operatingline.dev/schema/v1/procedure-zero-baseline-refinement-create-request.json',
    procedureZeroBaselineRefinementCreateRequestSchema,
  ],
  [
    'procedure-zero-baseline-review-binding.schema.json',
    'https://operatingline.dev/schema/v1/procedure-zero-baseline-review-binding.json',
    procedureZeroBaselineReviewBindingSchema,
  ],
  [
    'procedure-zero-baseline-storage-binding.schema.json',
    'https://operatingline.dev/schema/v1/procedure-zero-baseline-storage-binding.json',
    procedureZeroBaselineStorageBindingSchema,
  ],
  [
    'procedure-zero-baseline-review-request.schema.json',
    'https://operatingline.dev/schema/v1/procedure-zero-baseline-review-request.json',
    procedureZeroBaselineReviewRequestSchema,
  ],
  [
    'procedure-zero-baseline-semantic-start-request.schema.json',
    'https://operatingline.dev/schema/v1/procedure-zero-baseline-semantic-start-request.json',
    procedureZeroBaselineSemanticStartRequestSchema,
  ],
  [
    'procedure-zero-baseline-refinement-start-request.schema.json',
    'https://operatingline.dev/schema/v1/procedure-zero-baseline-refinement-start-request.json',
    procedureZeroBaselineRefinementStartRequestSchema,
  ],
  [
    'procedure-zero-baseline-refinement-status-request.schema.json',
    'https://operatingline.dev/schema/v1/procedure-zero-baseline-refinement-status-request.json',
    procedureZeroBaselineRefinementStatusRequestSchema,
  ],
  [
    'procedure-zero-baseline-refinement-status.schema.json',
    'https://operatingline.dev/schema/v1/procedure-zero-baseline-refinement-status.json',
    procedureZeroBaselineRefinementStatusSchema,
  ],
  [
    'procedure-tutorial-transcript-import-request.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tutorial-transcript-import-request.json',
    procedureTutorialTranscriptImportRequestSchema,
  ],
  [
    'procedure-tutorial-media-authoring-prepare-request.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tutorial-media-authoring-prepare-request.json',
    procedureTutorialMediaAuthoringPrepareStartRequestSchema,
  ],
  [
    'procedure-tutorial-media-authoring-preparation.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tutorial-media-authoring-preparation.json',
    procedureTutorialMediaAuthoringCurrentPreparationSchema,
  ],
  [
    'procedure-tutorial-media-authoring-run-create-request.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tutorial-media-authoring-run-create-request.json',
    procedureTutorialMediaAuthoringRunCreateRequestSchema,
  ],
  [
    'procedure-tutorial-media-authoring-run-status-request.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tutorial-media-authoring-run-status-request.json',
    procedureTutorialMediaAuthoringRunStatusRequestSchema,
  ],
  [
    'procedure-tutorial-media-authoring-run-status.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tutorial-media-authoring-run-status.json',
    procedureTutorialMediaAuthoringCurrentRunStatusSchema,
  ],
  [
    'procedure-tutorial-media-authoring-review-request.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tutorial-media-authoring-review-request.json',
    procedureTutorialMediaAuthoringReviewRequestSchema,
  ],
  [
    'procedure-tutorial-media-authoring-resume-request.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tutorial-media-authoring-resume-request.json',
    procedureTutorialMediaAuthoringResumeRequestSchema,
  ],
  [
    'procedure-tutorial-media-authoring-binding.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tutorial-media-authoring-binding.json',
    procedureTutorialMediaAuthoringBindingSchema,
  ],
  [
    'procedure-tutorial-transcript-generate-request.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tutorial-transcript-generate-request.json',
    procedureTutorialTranscriptGenerateRequestSchema,
  ],
  [
    'procedure-tutorial-youtube-import-request.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tutorial-youtube-import-request.json',
    procedureTutorialYoutubeImportRequestSchema,
  ],
  [
    'procedure-tutorial-authoring-run-create-request.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tutorial-authoring-run-create-request.json',
    procedureTutorialAuthoringRunCreateRequestSchema,
  ],
  [
    'procedure-tutorial-authoring-run-status-request.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tutorial-authoring-run-status-request.json',
    procedureTutorialAuthoringRunStatusRequestSchema,
  ],
  [
    'procedure-tutorial-authoring-run-status.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tutorial-authoring-run-status.json',
    procedureTutorialAuthoringRunStatusSchema,
  ],
  [
    'procedure-tutorial-authoring-review-request.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tutorial-authoring-review-request.json',
    procedureTutorialAuthoringReviewRequestSchema,
  ],
  [
    'procedure-tutorial-authoring-resume-request.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tutorial-authoring-resume-request.json',
    procedureTutorialAuthoringResumeRequestSchema,
  ],
  [
    'procedure-tutorial-authoring-result.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tutorial-authoring-result.json',
    procedureTutorialAuthoringResultSchema,
  ],
  [
    'procedure-tutorial-authoring-binding.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tutorial-authoring-binding.json',
    procedureTutorialAuthoringBindingSchema,
  ],
  [
    'procedure-tutorial-media-analysis-request.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tutorial-media-analysis-request.json',
    procedureTutorialMediaAnalysisStartRequestSchema,
  ],
  [
    'procedure-tutorial-media-analysis-result.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tutorial-media-analysis-result.json',
    procedureTutorialMediaCurrentAnalysisResultSchema,
  ],
  [
    'procedure-tutorial-media-job-status.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tutorial-media-job-status.json',
    procedureTutorialMediaCurrentJobStatusSchema,
  ],
  [
    'procedure-tutorial-media-job-status-request.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tutorial-media-job-status-request.json',
    procedureTutorialMediaJobStatusRequestSchema,
  ],
  [
    'procedure-tutorial-media-resume-request.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tutorial-media-resume-request.json',
    procedureTutorialMediaResumeRequestSchema,
  ],
  [
    'procedure-tutorial-media-capabilities.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tutorial-media-capabilities.json',
    procedureTutorialMediaCapabilitiesSchema,
  ],
  [
    'procedure-tutorial-media-ui-recognition-artifact.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tutorial-media-ui-recognition-artifact.json',
    procedureTutorialMediaRecognitionArtifactSchema,
  ],
  [
    'procedure-tutorial-youtube-track-list-request.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tutorial-youtube-track-list-request.json',
    procedureTutorialYoutubeTrackListRequestSchema,
  ],
  [
    'procedure-tutorial-youtube-track-list-result.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tutorial-youtube-track-list-result.json',
    procedureTutorialYoutubeTrackListResultSchema,
  ],
  [
    'procedure-tutorial-youtube-track-recommendation-request.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tutorial-youtube-track-recommendation-request.json',
    procedureTutorialYoutubeTrackRecommendationRequestSchema,
  ],
  [
    'procedure-tutorial-youtube-track-recommendation-result.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tutorial-youtube-track-recommendation-result.json',
    procedureTutorialYoutubeTrackRecommendationResultSchema,
  ],
  [
    'procedure-tutorial-youtube-track-selection-request.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tutorial-youtube-track-selection-request.json',
    procedureTutorialYoutubeTrackSelectionRequestSchema,
  ],
  [
    'procedure-tutorial-youtube-track-selection-result.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tutorial-youtube-track-selection-result.json',
    procedureTutorialYoutubeTrackSelectionResultSchema,
  ],
  [
    'procedure-authoring-materialization-request.schema.json',
    'https://operatingline.dev/schema/v1/procedure-authoring-materialization-request.json',
    procedureAuthoringMaterializationRequestSchema,
  ],
  [
    'procedure-authoring-materialization-result.schema.json',
    'https://operatingline.dev/schema/v1/procedure-authoring-materialization-result.json',
    procedureAuthoringMaterializationResultSchema,
  ],
  [
    'procedure-leaf-replay-proposal-request.schema.json',
    'https://operatingline.dev/schema/v1/procedure-leaf-replay-proposal-request.json',
    procedureLeafReplayProposalRequestSchema,
  ],
  [
    'procedure-leaf-replay-binding.schema.json',
    'https://operatingline.dev/schema/v1/procedure-leaf-replay-binding.json',
    procedureLeafReplayBindingSchema,
  ],
  [
    'procedure-menu-control-proof-binding.schema.json',
    'https://operatingline.dev/schema/v1/procedure-menu-control-proof-binding.json',
    procedureMenuControlProofBindingSchema,
  ],
  [
    'procedure-menu-control-proof-proposal-request.schema.json',
    'https://operatingline.dev/schema/v1/procedure-menu-control-proof-proposal-request.json',
    procedureMenuControlProofProposalRequestSchema,
  ],
  [
    'procedure-menu-control-proof-proposal-record.schema.json',
    'https://operatingline.dev/schema/v1/procedure-menu-control-proof-proposal-record.json',
    procedureMenuControlProofProposalRecordSchema,
  ],
  [
    'procedure-menu-control-proof-proposal-result.schema.json',
    'https://operatingline.dev/schema/v1/procedure-menu-control-proof-proposal-result.json',
    procedureMenuControlProofProposalResultSchema,
  ],
  [
    'procedure-shortcut-proof-binding.schema.json',
    'https://operatingline.dev/schema/v1/procedure-shortcut-proof-binding.json',
    procedureShortcutProofBindingSchema,
  ],
  [
    'procedure-shortcut-proof-proposal-request.schema.json',
    'https://operatingline.dev/schema/v1/procedure-shortcut-proof-proposal-request.json',
    procedureShortcutProofProposalRequestSchema,
  ],
  [
    'procedure-shortcut-proof-proposal-record.schema.json',
    'https://operatingline.dev/schema/v1/procedure-shortcut-proof-proposal-record.json',
    procedureShortcutProofProposalRecordSchema,
  ],
  [
    'procedure-shortcut-proof-proposal-result.schema.json',
    'https://operatingline.dev/schema/v1/procedure-shortcut-proof-proposal-result.json',
    procedureShortcutProofProposalResultSchema,
  ],
  [
    'procedure-shortcut-proof-attestation.schema.json',
    'https://operatingline.dev/schema/v1/procedure-shortcut-proof-attestation.json',
    procedureShortcutProofAttestationSchema,
  ],
  [
    'procedure-shortcut-proof-failure-checkpoint.schema.json',
    'https://operatingline.dev/schema/v1/procedure-shortcut-proof-failure-checkpoint.json',
    procedureShortcutProofFailureCheckpointSchema,
  ],
  [
    'procedure-leaf-replay-proposal-result.schema.json',
    'https://operatingline.dev/schema/v1/procedure-leaf-replay-proposal-result.json',
    procedureLeafReplayProposalResultSchema,
  ],
  [
    'procedure-leaf-replay-finalize-request.schema.json',
    'https://operatingline.dev/schema/v1/procedure-leaf-replay-finalize-request.json',
    procedureLeafReplayFinalizeRequestSchema,
  ],
  [
    'procedure-leaf-replay-attestation.schema.json',
    'https://operatingline.dev/schema/v1/procedure-leaf-replay-attestation.json',
    procedureLeafReplayAttestationSchema,
  ],
  [
    'procedure-leaf-replay-finalize-result.schema.json',
    'https://operatingline.dev/schema/v1/procedure-leaf-replay-finalize-result.json',
    procedureLeafReplayFinalizeResultSchema,
  ],
  [
    'procedure-leaf-replay-failure-recovery-finalize-request.schema.json',
    'https://operatingline.dev/schema/v1/procedure-leaf-replay-failure-recovery-finalize-request.json',
    procedureLeafReplayFailureRecoveryFinalizeRequestSchema,
  ],
  [
    'procedure-leaf-replay-failure-recovery-attestation.schema.json',
    'https://operatingline.dev/schema/v1/procedure-leaf-replay-failure-recovery-attestation.json',
    procedureLeafReplayFailureRecoveryAttestationSchema,
  ],
  [
    'procedure-leaf-replay-failure-recovery-finalize-result.schema.json',
    'https://operatingline.dev/schema/v1/procedure-leaf-replay-failure-recovery-finalize-result.json',
    procedureLeafReplayFailureRecoveryFinalizeResultSchema,
  ],
  [
    'procedure-leaf-replay-current-state-request.schema.json',
    'https://operatingline.dev/schema/v1/procedure-leaf-replay-current-state-request.json',
    procedureLeafReplayCurrentStateRequestSchema,
  ],
  [
    'procedure-leaf-replay-current-state-request-result.schema.json',
    'https://operatingline.dev/schema/v1/procedure-leaf-replay-current-state-request-result.json',
    procedureLeafReplayCurrentStateRequestResultSchema,
  ],
  [
    'procedure-leaf-replay-current-state-status-request.schema.json',
    'https://operatingline.dev/schema/v1/procedure-leaf-replay-current-state-status-request.json',
    procedureLeafReplayCurrentStateStatusRequestSchema,
  ],
  [
    'procedure-leaf-replay-current-state-verification.schema.json',
    'https://operatingline.dev/schema/v1/procedure-leaf-replay-current-state-verification.json',
    procedureLeafReplayCurrentStateVerificationSchema,
  ],
  [
    'procedure-leaf-replay-current-state-status-result.schema.json',
    'https://operatingline.dev/schema/v1/procedure-leaf-replay-current-state-status-result.json',
    procedureLeafReplayCurrentStateStatusResultSchema,
  ],
  [
    'procedure-compilation-request.schema.json',
    'https://operatingline.dev/schema/v1/procedure-compilation-request.json',
    procedureCompilationRequestSchema,
  ],
  [
    'procedure-compilation-result.schema.json',
    'https://operatingline.dev/schema/v1/procedure-compilation-result.json',
    procedureCompilationResultSchema,
  ],
  [
    'procedure-tree-store-request.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tree-store-request.json',
    procedureTreeStoreRequestSchema,
  ],
  [
    'procedure-tree-store-result.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tree-store-result.json',
    procedureTreeStoreResultSchema,
  ],
  [
    'procedure-tree-get-request.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tree-get-request.json',
    procedureTreeGetRequestSchema,
  ],
  [
    'stored-procedure-tree.schema.json',
    'https://operatingline.dev/schema/v1/stored-procedure-tree.json',
    storedProcedureTreeSchema,
  ],
  [
    'procedure-tree-list-request.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tree-list-request.json',
    procedureTreeListRequestSchema,
  ],
  [
    'procedure-tree-list-result.schema.json',
    'https://operatingline.dev/schema/v1/procedure-tree-list-result.json',
    procedureTreeListResultSchema,
  ],
  [
    'procedure-operation-search-request.schema.json',
    'https://operatingline.dev/schema/v1/procedure-operation-search-request.json',
    procedureOperationSearchRequestSchema,
  ],
  [
    'procedure-operation-search-result.schema.json',
    'https://operatingline.dev/schema/v1/procedure-operation-search-result.json',
    procedureOperationSearchResultSchema,
  ],
  [
    'procedure-semantic-retrieval-provider-disclosure-list.schema.json',
    'https://operatingline.dev/schema/v1/procedure-semantic-retrieval-provider-disclosure-list.json',
    procedureSemanticRetrievalProviderDisclosureListSchema,
  ],
  [
    'procedure-semantic-retrieval-request.schema.json',
    'https://operatingline.dev/schema/v1/procedure-semantic-retrieval-request.json',
    procedureSemanticRetrievalRequestSchema,
  ],
  [
    'procedure-semantic-retrieval-result.schema.json',
    'https://operatingline.dev/schema/v1/procedure-semantic-retrieval-result.json',
    procedureSemanticRetrievalResultSchema,
  ],
  [
    'procedure-semantic-retrieval-requested-event.schema.json',
    'https://operatingline.dev/schema/v1/procedure-semantic-retrieval-requested-event.json',
    procedureSemanticRetrievalRequestedEventSchema,
  ],
  [
    'procedure-semantic-retrieval-completed-event.schema.json',
    'https://operatingline.dev/schema/v1/procedure-semantic-retrieval-completed-event.json',
    procedureSemanticRetrievalCompletedEventSchema,
  ],
  [
    'procedure-semantic-retrieval-failed-event.schema.json',
    'https://operatingline.dev/schema/v1/procedure-semantic-retrieval-failed-event.json',
    procedureSemanticRetrievalFailedEventSchema,
  ],
  [
    'procedure-semantic-retrieval-provider-runtime-treatment-attestation.schema.json',
    'https://operatingline.dev/schema/v1/procedure-semantic-retrieval-provider-runtime-treatment-attestation.json',
    procedureSemanticRetrievalProviderRuntimeTreatmentAttestationSchema,
  ],
  [
    'procedure-semantic-retrieval-provider-runtime-output-attestation.schema.json',
    'https://operatingline.dev/schema/v1/procedure-semantic-retrieval-provider-runtime-output-attestation.json',
    procedureSemanticRetrievalProviderRuntimeOutputAttestationSchema,
  ],
  [
    'procedure-refinement-provider-disclosure-list.schema.json',
    'https://operatingline.dev/schema/v1/procedure-refinement-provider-disclosure-list.json',
    procedureRefinementProviderDisclosureListSchema,
  ],
  [
    'procedure-refinement-provider-input-policy.schema.json',
    'https://operatingline.dev/schema/v1/procedure-refinement-provider-input-policy.json',
    procedureRefinementProviderInputPolicySchema,
  ],
  [
    'procedure-refinement-provider-runtime-treatment-attestation.schema.json',
    'https://operatingline.dev/schema/v1/procedure-refinement-provider-runtime-treatment-attestation.json',
    procedureRefinementProviderRuntimeTreatmentAttestationSchema,
  ],
  [
    'procedure-refinement-create-request.schema.json',
    'https://operatingline.dev/schema/v1/procedure-refinement-create-request.json',
    procedureRefinementCreateRequestSchema,
  ],
  [
    'procedure-refinement-semantic-context-receipt-request.schema.json',
    'https://operatingline.dev/schema/v1/procedure-refinement-semantic-context-receipt-request.json',
    procedureRefinementSemanticContextReceiptRequestSchema,
  ],
  [
    'procedure-refinement-semantic-context-receipt.schema.json',
    'https://operatingline.dev/schema/v1/procedure-refinement-semantic-context-receipt.json',
    procedureRefinementSemanticContextBindingSchema,
  ],
  [
    'procedure-refinement-scope.schema.json',
    'https://operatingline.dev/schema/v1/procedure-refinement-scope.json',
    procedureRefinementScopeSchema,
  ],
  [
    'procedure-refinement-locality-report.schema.json',
    'https://operatingline.dev/schema/v1/procedure-refinement-locality-report.json',
    procedureRefinementLocalityReportSchema,
  ],
  [
    'procedure-refinement-dialogue-prompt-packet.schema.json',
    'https://operatingline.dev/schema/v1/procedure-refinement-dialogue-prompt-packet.json',
    procedureRefinementDialoguePromptPacketSchema,
  ],
  [
    'procedure-refinement-dialogue-provider-result.schema.json',
    'https://operatingline.dev/schema/v1/procedure-refinement-dialogue-provider-result.json',
    procedureRefinementDialogueProviderResultSchema,
  ],
  [
    'procedure-refinement-dialogue-requested-event.schema.json',
    'https://operatingline.dev/schema/v1/procedure-refinement-dialogue-requested-event.json',
    procedureRefinementDialogueRequestedEventSchema,
  ],
  [
    'procedure-refinement-dialogue-completed-event.schema.json',
    'https://operatingline.dev/schema/v1/procedure-refinement-dialogue-completed-event.json',
    procedureRefinementDialogueCompletedEventSchema,
  ],
  [
    'procedure-refinement-dialogue-failed-event.schema.json',
    'https://operatingline.dev/schema/v1/procedure-refinement-dialogue-failed-event.json',
    procedureRefinementDialogueFailedEventSchema,
  ],
  [
    'procedure-refinement-prompt-packet.schema.json',
    'https://operatingline.dev/schema/v1/procedure-refinement-prompt-packet.json',
    procedureRefinementPromptPacketSchema,
  ],
  [
    'procedure-refinement-provider-result.schema.json',
    'https://operatingline.dev/schema/v1/procedure-refinement-provider-result.json',
    procedureRefinementProviderResultSchema,
  ],
  [
    'procedure-refinement-generation-outcome.schema.json',
    'https://operatingline.dev/schema/v1/procedure-refinement-generation-outcome.json',
    procedureRefinementGenerationOutcomeSchema,
  ],
  [
    'procedure-refinement-generation-requested-event.schema.json',
    'https://operatingline.dev/schema/v1/procedure-refinement-generation-requested-event.json',
    procedureRefinementGenerationRequestedEventSchema,
  ],
  [
    'procedure-refinement-generation-completed-event.schema.json',
    'https://operatingline.dev/schema/v1/procedure-refinement-generation-completed-event.json',
    procedureRefinementGenerationCompletedEventSchema,
  ],
  [
    'procedure-refinement-generation-failed-event.schema.json',
    'https://operatingline.dev/schema/v1/procedure-refinement-generation-failed-event.json',
    procedureRefinementGenerationFailedEventSchema,
  ],
  [
    'procedure-refinement-review-request.schema.json',
    'https://operatingline.dev/schema/v1/procedure-refinement-review-request.json',
    procedureRefinementReviewRequestSchema,
  ],
  [
    'procedure-refinement-reviewed-event.schema.json',
    'https://operatingline.dev/schema/v1/procedure-refinement-reviewed-event.json',
    procedureRefinementReviewedEventSchema,
  ],
  [
    'procedure-refinement-run-status-request.schema.json',
    'https://operatingline.dev/schema/v1/procedure-refinement-run-status-request.json',
    procedureRefinementRunStatusRequestSchema,
  ],
  [
    'procedure-refinement-run-status.schema.json',
    'https://operatingline.dev/schema/v1/procedure-refinement-run-status.json',
    procedureRefinementRunStatusSchema,
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

function hardenDraft7Tuples(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) hardenDraft7Tuples(item);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record['items'])) {
    const length = record['items'].length;
    if (length === 0) {
      record['items'] = {};
      delete record['additionalItems'];
    } else {
      record['additionalItems'] = false;
    }
    record['minItems'] = length;
    record['maxItems'] = length;
  }
  for (const nested of Object.values(record)) hardenDraft7Tuples(nested);
}

function hardenProcedureTreeMergeResolutions(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  const properties = record['properties'];
  if (properties !== null && typeof properties === 'object') {
    const propertyRecord = properties as Record<string, unknown>;
    const choice = propertyRecord['choice'];
    if (
      propertyRecord['conflict'] !== undefined &&
      propertyRecord['custom'] !== undefined &&
      choice !== null &&
      typeof choice === 'object' &&
      Array.isArray((choice as Record<string, unknown>)['enum']) &&
      ((choice as Record<string, unknown>)['enum'] as unknown[]).includes('custom')
    ) {
      record['allOf'] = [
        {
          if: { properties: { choice: { const: 'custom' } }, required: ['choice'] },
          then: { required: ['custom'] },
          else: { not: { required: ['custom'] } },
        },
      ];
    }
  }
  for (const nested of Object.values(record)) hardenProcedureTreeMergeResolutions(nested);
}

function hardenProcedureTreeEditorSchema(filename: string, schema: Record<string, unknown>): void {
  hardenProcedureTreeMergeResolutions(schema);
  if (filename === 'procedure-tree-editor-parameter-form-result.schema.json') {
    schema['$comment'] =
      'Field minimum, maximum, pattern, and length members are sibling metadata for the editor UI. Generic JSON Schema validators cannot enforce every metadata-to-value dependency; the runtime Zod contract is authoritative for those relationships.';
  }
  if (filename === 'procedure-tree-editor-commit-request.schema.json') {
    schema['allOf'] = [
      {
        if: { properties: { operation: { const: 'edit' } }, required: ['operation'] },
        then: {
          properties: {
            previewBinding: {
              properties: { operation: { const: 'edit' } },
              required: ['operation'],
            },
          },
        },
      },
      {
        if: { properties: { operation: { const: 'merge' } }, required: ['operation'] },
        then: {
          properties: {
            previewBinding: {
              properties: { operation: { const: 'merge' } },
              required: ['operation'],
            },
          },
        },
      },
    ];
  }
  if (filename === 'procedure-tree-editor-revision-commit.schema.json') {
    schema['allOf'] = [
      {
        if: { properties: { operation: { const: 'edit' } }, required: ['operation'] },
        then: {
          properties: { source: { type: 'null' }, mergeBase: { type: 'null' } },
        },
      },
      {
        if: { properties: { operation: { const: 'merge' } }, required: ['operation'] },
        then: {
          properties: {
            source: { type: 'object' },
            mergeBase: { type: 'object' },
          },
        },
      },
    ];
  }
}

function hardenCompoundReplaySchema(filename: string, schema: Record<string, unknown>): void {
  if (filename !== 'procedure-compound-replay.schema.json') return;
  schema['$comment'] =
    'Cross-field compound/replay/content/lock equality and canonical hash commitments require procedureCompoundReplaySchema plus verifyProcedureCompoundReplayIntegrity; standard JSON Schema enforces the status-discriminated structural invariants only.';
  const terminalReceipt = {
    if: {
      properties: {
        currentState: {
          properties: {
            status: {
              enum: [
                'forward_applied_locked',
                'restored_locked',
                'reapplied_locked',
                'unlocked_final',
                'abandoned_baseline',
              ],
            },
          },
          required: ['status'],
        },
      },
      required: ['currentState'],
    },
    then: {
      properties: {
        leafProgress: {
          items: { properties: { receiptSha256: { type: 'string' } } },
        },
      },
    },
  };
  const lostState = {
    if: {
      properties: {
        currentState: {
          properties: { status: { const: 'history_lost' } },
          required: ['status'],
        },
      },
      required: ['currentState'],
    },
    then: {
      properties: {
        currentState: {
          properties: {
            lifecycleState: { const: 'unknown' },
            mode: { const: 'UNKNOWN' },
            historyLock: { const: 'quarantined' },
            historyContinuity: { const: 'lost_permanently' },
            nativeHistoryLossRecorded: { const: true },
            inProgressLeafId: { type: 'null' },
            permittedHistoryTransitions: {
              type: 'array',
              minItems: 1,
              maxItems: 1,
              items: [{ const: 'abandon_baseline' }],
            },
          },
        },
      },
    },
  };
  schema['allOf'] = [...((schema['allOf'] as unknown[]) ?? []), terminalReceipt, lostState];
}

function documentExecutionDecisionSemanticGate(
  filename: string,
  schema: Record<string, unknown>,
): void {
  if (
    filename === 'blender-execution-decision-receipt.schema.json' ||
    filename === 'blender-history-transition-decision-receipt.schema.json' ||
    filename === 'training-run-decision-receipt.schema.json'
  ) {
    schema['$comment'] =
      'issuedAt < expiresAt and the fifteen-minute maximum validity window require the exported Zod semantic validation gate; standard JSON Schema cannot compare dynamic sibling timestamps.';
  }
}

function documentTutorialMediaRecognitionSemanticGate(
  filename: string,
  schema: Record<string, unknown>,
): void {
  if (filename === 'procedure-tutorial-media-ui-recognition-artifact.schema.json') {
    schema['$comment'] =
      'Candidate and frame id uniqueness, candidate frame/timestamp references, normalized labels and key chords, normalized bounds containment, UTF-8 byte limits, and contentSha256 integrity require the exported Zod/service semantic validation gates; standard JSON Schema covers the strict structural contract.';
  }
}

function documentMenuControlProofSemanticGate(
  filename: string,
  schema: Record<string, unknown>,
): void {
  if (
    filename === 'procedure-menu-control-proof-proposal-record.schema.json' ||
    filename === 'procedure-menu-control-proof-proposal-result.schema.json' ||
    filename === 'procedure-menu-control-proof-binding.schema.json'
  ) {
    schema['$comment'] =
      'Canonical content integrity, exact materialization/proposal hash relationships, accepted-decision identity, and temporal ordering require the exported Zod/service semantic validation gate; standard JSON Schema covers the strict structural contract.';
  } else if (
    filename.startsWith('companion-menu-control-proof-') &&
    ['delivery', 'progress', 'result', 'status'].some((kind) =>
      filename.includes(`-${kind}.schema.json`),
    )
  ) {
    schema['$comment'] =
      'Immutable binding and lease identity, canonical receipt chains and prefixes, independent native-history cursor and mutation-stage prefixes, chronology, evidence hashes, and status/evidence agreement require the exported Zod semantic validation gate; standard JSON Schema covers the strict structural contract.';
  }
}

function documentExecutionTrackPreflightSemanticGate(
  filename: string,
  schema: Record<string, unknown>,
): void {
  if (
    filename.startsWith('companion-execution-track-preflight-') &&
    ['binding', 'delivery', 'result', 'status'].some((kind) =>
      filename.includes(`-${kind}.schema.json`),
    )
  ) {
    schema['$comment'] =
      'Canonical binding integrity, exact replay/Guide/source-leaf/selected-track authority, lease identity, and temporal ordering require the exported Zod semantic validation gate; standard JSON Schema covers the strict structural contract.';
  }
}

function documentExecutionTrackExecutionSemanticGate(
  filename: string,
  schema: Record<string, unknown>,
): void {
  if (filename.startsWith('companion-execution-track-execution-')) {
    schema['$comment'] =
      'Canonical binding/progress/baseline integrity, exact proof and native-Undo prefixes, immutable delivery identity, managed-only success, chronology, and lifecycle ordering require the exported Zod/coordinator semantic gates; standard JSON Schema covers the strict structural contract.';
  }
}

function hardenExecutionTrackExecutionLifecycle(
  filename: string,
  schema: Record<string, unknown>,
): void {
  if (filename === 'companion-execution-track-execution-managed-start-submission.schema.json') {
    const allOf = (schema['allOf'] ?? []) as unknown[];
    allOf.push({
      properties: {
        commitProgress: {
          properties: { phase: { const: 'commit_intent_recorded' } },
          required: ['phase'],
        },
      },
      required: ['commitProgress'],
    });
    schema['allOf'] = allOf;
  } else if (filename === 'companion-execution-track-execution-status.schema.json') {
    const activePhases = [
      'baseline_attested',
      'proof_in_progress',
      'proof_observed_locked',
      'restore_in_progress',
      'baseline_restored',
      'commit_intent_recorded',
    ];
    const forbid = (fields: string[]) => ({
      not: { anyOf: fields.map((field) => ({ required: [field] })) },
    });
    const progressPhase = (phase: string) => ({
      properties: {
        progress: { properties: { phase: { const: phase } }, required: ['phase'] },
      },
    });
    const resultStatus = (status: string) => ({
      properties: {
        result: { properties: { status: { const: status } }, required: ['status'] },
      },
    });
    const allOf = (schema['allOf'] ?? []) as unknown[];
    allOf.push(
      {
        if: { properties: { status: { const: 'queued' } }, required: ['status'] },
        then: forbid([
          'deliveryId',
          'lease',
          'dispatchedAt',
          'progress',
          'managedStart',
          'result',
          'serverRecoveryEvidence',
          'preDispatchAuthorityExpirationEvidence',
        ]),
        else: {
          if: {
            properties: { status: { const: 'pre_dispatch_authority_expired' } },
            required: ['status'],
          },
          else: { required: ['deliveryId', 'lease', 'dispatchedAt'] },
        },
      },
      {
        if: { properties: { status: { const: 'dispatched' } }, required: ['status'] },
        then: forbid([
          'progress',
          'managedStart',
          'result',
          'serverRecoveryEvidence',
          'preDispatchAuthorityExpirationEvidence',
        ]),
      },
      {
        if: {
          properties: { status: { const: 'pre_dispatch_authority_expired' } },
          required: ['status'],
        },
        then: {
          required: ['preDispatchAuthorityExpirationEvidence'],
          ...forbid([
            'deliveryId',
            'lease',
            'dispatchedAt',
            'progress',
            'managedStart',
            'result',
            'serverRecoveryEvidence',
          ]),
        },
      },
      ...activePhases.map((phase) => ({
        if: { properties: { status: { const: phase } }, required: ['status'] },
        then: {
          required: ['progress'],
          ...progressPhase(phase),
          ...forbid([
            'managedStart',
            'result',
            'serverRecoveryEvidence',
            'preDispatchAuthorityExpirationEvidence',
          ]),
        },
      })),
      {
        if: {
          properties: { status: { const: 'managed_action_in_progress' } },
          required: ['status'],
        },
        then: {
          required: ['progress', 'managedStart'],
          ...progressPhase('commit_intent_recorded'),
          ...forbid(['result', 'serverRecoveryEvidence', 'preDispatchAuthorityExpirationEvidence']),
        },
      },
      ...(['succeeded', 'failed_managed'] as const).map((status) => ({
        if: { properties: { status: { const: status } }, required: ['status'] },
        then: {
          required: ['progress', 'result'],
          allOf: [
            progressPhase('commit_intent_recorded'),
            resultStatus(status),
            forbid([
              'managedStart',
              'serverRecoveryEvidence',
              'preDispatchAuthorityExpirationEvidence',
            ]),
          ],
        },
      })),
      {
        if: {
          properties: { status: { const: 'failed_managed_repaired' } },
          required: ['status'],
        },
        then: {
          required: ['progress', 'result'],
          allOf: [
            progressPhase('commit_intent_recorded'),
            resultStatus('failed_managed'),
            forbid([
              'managedStart',
              'serverRecoveryEvidence',
              'preDispatchAuthorityExpirationEvidence',
            ]),
          ],
        },
      },
      ...(['failed_no_mutation', 'failed_restored', 'recovery_required'] as const).map(
        (status) => ({
          if: { properties: { status: { const: status } }, required: ['status'] },
          then: {
            ...forbid(['managedStart', 'preDispatchAuthorityExpirationEvidence']),
            oneOf: [
              {
                required: ['result'],
                allOf: [resultStatus(status), forbid(['serverRecoveryEvidence'])],
              },
              {
                required: ['serverRecoveryEvidence'],
                allOf: [forbid(['result'])],
              },
            ],
          },
        }),
      ),
      {
        if: {
          properties: {
            status: { const: 'failed_no_mutation' },
            result: { type: 'object' },
          },
          required: ['status', 'result'],
        },
        then: { required: ['progress'], ...progressPhase('baseline_attested') },
      },
      {
        if: { properties: { status: { const: 'failed_restored' } }, required: ['status'] },
        then: { required: ['progress'], ...progressPhase('baseline_restored') },
      },
      {
        if: {
          properties: { status: { const: 'recovery_required' }, result: { type: 'object' } },
          required: ['status', 'result'],
        },
        then: { required: ['progress'] },
      },
      {
        if: {
          properties: {
            serverRecoveryEvidence: {
              properties: { source: { const: 'document_authority_drift' } },
              required: ['source'],
            },
          },
          required: ['serverRecoveryEvidence'],
        },
        then: {
          properties: {
            status: { const: 'recovery_required' },
            serverRecoveryEvidence: {
              properties: {
                resolution: { const: 'recovery_required' },
                retainsTargetLock: { const: true },
              },
            },
          },
        },
      },
      {
        if: {
          properties: {
            serverRecoveryEvidence: {
              properties: {
                durableReferences: {
                  properties: { terminalMarkerContentSha256: { type: 'string' } },
                  required: ['terminalMarkerContentSha256'],
                },
              },
              required: ['durableReferences'],
            },
          },
          required: ['serverRecoveryEvidence'],
        },
        then: {
          required: ['progress'],
          allOf: [progressPhase('commit_intent_recorded')],
          properties: {
            status: { const: 'recovery_required' },
            serverRecoveryEvidence: {
              properties: {
                source: { const: 'coordinator_restart' },
                priorStatus: { const: 'managed_action_in_progress' },
                resolution: { const: 'recovery_required' },
              },
              required: ['source', 'priorStatus', 'resolution'],
            },
          },
        },
      },
      {
        if: {
          properties: {
            serverRecoveryEvidence: {
              properties: { priorStatus: { const: 'managed_action_in_progress' } },
              required: ['priorStatus'],
            },
          },
          required: ['serverRecoveryEvidence'],
        },
        then: {
          properties: {
            serverRecoveryEvidence: {
              properties: {
                durableReferences: {
                  properties: { managedStartContentSha256: { type: 'string' } },
                  required: ['managedStartContentSha256'],
                },
              },
              required: ['durableReferences'],
            },
          },
        },
        else: {
          properties: {
            serverRecoveryEvidence: {
              properties: {
                durableReferences: {
                  properties: { managedStartContentSha256: { type: 'null' } },
                  required: ['managedStartContentSha256'],
                },
              },
            },
          },
        },
      },
      ...(['dispatched', 'baseline_restored'] as const).map((priorStatus) => {
        const resolution = priorStatus === 'dispatched' ? 'failed_no_mutation' : 'failed_restored';
        return {
          if: {
            properties: {
              serverRecoveryEvidence: {
                properties: {
                  source: { const: 'coordinator_restart' },
                  priorStatus: { const: priorStatus },
                },
                required: ['source', 'priorStatus'],
              },
            },
            required: ['serverRecoveryEvidence'],
          },
          then: {
            properties: {
              status: { const: resolution },
              serverRecoveryEvidence: {
                properties: {
                  resolution: { const: resolution },
                  retainsTargetLock: { const: false },
                },
              },
            },
          },
        };
      }),
      {
        if: {
          properties: {
            serverRecoveryEvidence: {
              properties: {
                source: { const: 'coordinator_restart' },
                priorStatus: {
                  enum: [
                    'baseline_attested',
                    'proof_in_progress',
                    'proof_observed_locked',
                    'restore_in_progress',
                    'commit_intent_recorded',
                    'managed_action_in_progress',
                  ],
                },
              },
              required: ['source', 'priorStatus'],
            },
          },
          required: ['serverRecoveryEvidence'],
        },
        then: {
          properties: {
            status: { const: 'recovery_required' },
            serverRecoveryEvidence: {
              properties: {
                resolution: { const: 'recovery_required' },
                retainsTargetLock: { const: true },
              },
            },
          },
        },
      },
    );
    schema['allOf'] = allOf;
  } else if (filename === 'companion-execution-track-execution-result.schema.json') {
    const allOf = (schema['allOf'] ?? []) as unknown[];
    allOf.push(
      {
        if: {
          properties: {
            status: { const: 'failed_managed' },
            observationGate: {
              properties: { status: { const: 'repair_required' } },
              required: ['status'],
            },
          },
          required: ['status', 'observationGate'],
        },
        then: {
          properties: {
            observationGate: {
              properties: { failureStrategy: { const: 'retain_for_repair' } },
              required: ['failureStrategy'],
            },
          },
        },
      },
      {
        if: {
          properties: {
            status: { const: 'failed_managed' },
            observationGate: {
              properties: { status: { const: 'rollback_failed' } },
              required: ['status'],
            },
          },
          required: ['status', 'observationGate'],
        },
        then: {
          properties: {
            observationGate: {
              properties: { failureStrategy: { const: 'rollback_step' } },
              required: ['failureStrategy'],
            },
          },
        },
      },
    );
    schema['allOf'] = allOf;
  } else if (filename === 'companion-execution-track-execution-recovery-ack.schema.json') {
    const allOf = (schema['allOf'] ?? []) as unknown[];
    allOf.push(
      {
        if: { properties: { outcome: { const: 'reconciled' } }, required: ['outcome'] },
        then: {
          properties: {
            evidence: {
              properties: {
                kind: {
                  enum: [
                    'persisted_managed_terminal',
                    'baseline_terminal',
                    'managed_repair_terminal',
                  ],
                },
              },
              required: ['kind'],
            },
          },
        },
        else: {
          properties: {
            evidence: {
              properties: { kind: { const: 'unresolved_current_state' } },
              required: ['kind'],
            },
            retainsTargetLock: { const: true },
          },
        },
      },
      {
        if: {
          properties: {
            evidence: {
              properties: {
                kind: { const: 'persisted_managed_terminal' },
                terminalResult: {
                  properties: { status: { const: 'failed_managed' } },
                  required: ['status'],
                },
              },
              required: ['kind', 'terminalResult'],
            },
          },
          required: ['evidence'],
        },
        then: {
          properties: {
            outcome: { const: 'reconciled' },
            retainsTargetLock: { const: true },
          },
        },
      },
      {
        if: {
          properties: {
            evidence: {
              properties: {
                kind: { enum: ['baseline_terminal', 'managed_repair_terminal'] },
              },
              required: ['kind'],
            },
          },
          required: ['evidence'],
        },
        then: {
          properties: {
            outcome: { const: 'reconciled' },
            retainsTargetLock: { const: false },
          },
        },
      },
      {
        if: {
          properties: {
            evidence: {
              properties: {
                kind: { const: 'persisted_managed_terminal' },
                terminalResult: {
                  properties: { status: { const: 'succeeded' } },
                  required: ['status'],
                },
              },
              required: ['kind', 'terminalResult'],
            },
          },
          required: ['evidence'],
        },
        then: {
          properties: {
            outcome: { const: 'reconciled' },
            retainsTargetLock: { const: false },
          },
        },
      },
      ...(['failed_no_mutation', 'failed_restored'] as const).map((status) => ({
        if: {
          properties: {
            evidence: {
              properties: {
                kind: { const: 'baseline_terminal' },
                terminalResult: {
                  properties: { status: { const: status } },
                  required: ['status'],
                },
              },
              required: ['kind', 'terminalResult'],
            },
          },
          required: ['evidence'],
        },
        then: {
          properties: {
            evidence: {
              properties: {
                progress: {
                  properties: {
                    phase: {
                      const:
                        status === 'failed_no_mutation' ? 'baseline_attested' : 'baseline_restored',
                    },
                  },
                  required: ['phase'],
                },
              },
              required: ['progress'],
            },
          },
        },
      })),
    );
    schema['allOf'] = allOf;
  }
}

for (const [filename, id, schema] of schemas) {
  if (onlyFilename !== undefined && filename !== onlyFilename) continue;
  const draft7TupleSchema =
    filename.startsWith('procedure-tutorial-media-') ||
    filename.startsWith('procedure-tutorial-authoring-') ||
    filename.startsWith('companion-execution-track-execution-') ||
    filename === 'procedure-compound-replay.schema.json' ||
    filename.includes('shortcut-proof') ||
    filename.includes('menu-control-proof');
  const jsonSchema = z.toJSONSchema(schema, {
    target: draft7TupleSchema ? 'draft-7' : 'draft-2020-12',
  });
  if (draft7TupleSchema) hardenDraft7Tuples(jsonSchema);
  hardenProcedureTreeEditorSchema(filename, jsonSchema);
  hardenCompoundReplaySchema(filename, jsonSchema);
  documentExecutionDecisionSemanticGate(filename, jsonSchema);
  documentTutorialMediaRecognitionSemanticGate(filename, jsonSchema);
  documentMenuControlProofSemanticGate(filename, jsonSchema);
  documentExecutionTrackPreflightSemanticGate(filename, jsonSchema);
  documentExecutionTrackExecutionSemanticGate(filename, jsonSchema);
  hardenExecutionTrackExecutionLifecycle(filename, jsonSchema);
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
