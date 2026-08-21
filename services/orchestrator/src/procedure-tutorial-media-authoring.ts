import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import {
  canonicalizeProtocolJsonValue,
  procedureTutorialMediaAuthoringFormatVersion,
  procedureTutorialMediaAuthoringCurrentPreparationSchema,
  procedureTutorialMediaAuthoringPrepareStartRequestSchema,
  procedureTutorialMediaCurrentAnalysisResultSchema,
  type ActionCatalog,
  type InteractionCatalog,
  type ProcedureTutorialMediaAuthoringBlocker,
  type ProcedureTutorialMediaAuthoringCurrentPreparation,
  type ProcedureTutorialMediaAuthoringPrepareStartRequest,
  type ProcedureTutorialMediaAuthoringQualityReport,
  type ProcedureTutorialMediaCurrentAnalysisResult,
} from '@operatingline/protocol';

import { buildProcedureAuthoringPromptPacket } from './procedure-authoring-prompt.js';

export interface PrepareProcedureTutorialMediaAuthoringInput {
  readonly analysis: ProcedureTutorialMediaCurrentAnalysisResult;
  readonly source: ProcedureTutorialMediaAuthoringPrepareStartRequest['source'];
  readonly request: ProcedureTutorialMediaAuthoringPrepareStartRequest['request'];
  readonly video: ProcedureTutorialMediaAuthoringPrepareStartRequest['video'];
  readonly actionCatalog: ActionCatalog;
  readonly interactionCatalog: InteractionCatalog;
  readonly verifyAnalysis: (
    analysis: ProcedureTutorialMediaCurrentAnalysisResult,
  ) => Promise<ProcedureTutorialMediaCurrentAnalysisResult>;
}

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalizeProtocolJsonValue(value)).digest('hex');
}

function ratio(matching: number, total: number): number {
  return total === 0 ? 0 : matching / total;
}

function qualityReport(
  analysis: ProcedureTutorialMediaCurrentAnalysisResult,
): ProcedureTutorialMediaAuthoringQualityReport {
  const segments = analysis.semanticSegments;
  const asrById = new Map(analysis.asrSegments.map((segment) => [segment.segmentId, segment]));
  const frameTimestampById = new Map(
    analysis.frames.map((frame) => [frame.frameId, frame.timestampMs]),
  );
  const visualTimestampById = new Map([
    ...analysis.ocrCandidates.map(
      (candidate) => [candidate.candidateId, frameTimestampById.get(candidate.frameId)] as const,
    ),
    ...analysis.uiCandidates.map(
      (candidate) => [candidate.candidateId, frameTimestampById.get(candidate.frameId)] as const,
    ),
    ...analysis.shortcutCandidates.map(
      (candidate) => [candidate.candidateId, candidate.timestampMs] as const,
    ),
  ]);
  const validAsrIdsBySegment = new Map(
    segments.map((segment) => [
      segment.segmentId,
      segment.asrSegmentIds.filter((id) => {
        const asr = asrById.get(id);
        return asr !== undefined && asr.startMs < segment.endMs && asr.endMs > segment.startMs;
      }),
    ]),
  );
  const validVisualIds = (
    segment: (typeof segments)[number],
    ids: readonly string[],
  ): readonly string[] =>
    ids.filter((id) => {
      const timestampMs = visualTimestampById.get(id);
      return (
        timestampMs !== undefined && timestampMs >= segment.startMs && timestampMs <= segment.endMs
      );
    });
  const temporalGrounding = new Map(
    segments.map((segment) => [
      segment.segmentId,
      {
        asr: validAsrIdsBySegment.get(segment.segmentId) ?? [],
        ocr: validVisualIds(segment, segment.ocrCandidateIds),
        ui: validVisualIds(segment, segment.uiCandidateIds),
        shortcut: validVisualIds(segment, segment.shortcutCandidateIds),
      },
    ]),
  );
  const ordered = segments.every((segment, index) => segment.order === index + 1);
  const overlappingIds = segments
    .filter((segment, index) => index > 0 && segment.startMs < segments[index - 1]!.endMs)
    .map((segment) => segment.segmentId);
  const ungroundedIds = segments
    .filter((segment) => {
      const grounding = temporalGrounding.get(segment.segmentId)!;
      return (
        grounding.asr.length === 0 &&
        grounding.ocr.length === 0 &&
        grounding.ui.length === 0 &&
        grounding.shortcut.length === 0
      );
    })
    .map((segment) => segment.segmentId);
  const outsideTimeRangeIds = segments
    .filter((segment) => {
      const grounding = temporalGrounding.get(segment.segmentId)!;
      return (
        grounding.asr.length !== segment.asrSegmentIds.length ||
        grounding.ocr.length !== segment.ocrCandidateIds.length ||
        grounding.ui.length !== segment.uiCandidateIds.length ||
        grounding.shortcut.length !== segment.shortcutCandidateIds.length
      );
    })
    .map((segment) => segment.segmentId);
  const blockers: ProcedureTutorialMediaAuthoringBlocker[] = [];
  if (segments.length === 0) {
    blockers.push({
      code: 'no_semantic_segments',
      message: 'The verified analysis contains no semantic segment to author from.',
      semanticSegmentIds: [],
    });
  }
  if (!ordered) {
    blockers.push({
      code: 'semantic_segment_order_invalid',
      message: 'Semantic segment order is not contiguous and one-based.',
      semanticSegmentIds: segments.map((segment) => segment.segmentId),
    });
  }
  if (overlappingIds.length > 0) {
    blockers.push({
      code: 'semantic_segments_overlap',
      message: 'Semantic segments overlap on the media timeline.',
      semanticSegmentIds: overlappingIds,
    });
  }
  if (outsideTimeRangeIds.length > 0) {
    blockers.push({
      code: 'semantic_segment_grounding_outside_time_range',
      message:
        'A semantic segment references ASR without a non-empty time intersection or visual evidence outside its closed time range.',
      semanticSegmentIds: outsideTimeRangeIds,
    });
  }
  if (ungroundedIds.length > 0) {
    blockers.push({
      code: 'semantic_segment_has_no_grounding_signal',
      message: 'A semantic segment has neither ASR nor visual grounding candidates.',
      semanticSegmentIds: ungroundedIds,
    });
  }

  return {
    semanticSegmentCount: segments.length,
    ordered,
    nonOverlapping: overlappingIds.length === 0,
    coverage: {
      asr: ratio(
        segments.filter((segment) => temporalGrounding.get(segment.segmentId)!.asr.length > 0)
          .length,
        segments.length,
      ),
      frameEvidence: ratio(
        segments.filter((segment) =>
          segment.evidence.some((evidence) => evidence.frameId !== undefined),
        ).length,
        segments.length,
      ),
      visual: ratio(
        segments.filter((segment) => {
          const grounding = temporalGrounding.get(segment.segmentId)!;
          return (
            grounding.ocr.length > 0 || grounding.ui.length > 0 || grounding.shortcut.length > 0
          );
        }).length,
        segments.length,
      ),
      ocr: ratio(
        segments.filter((segment) => temporalGrounding.get(segment.segmentId)!.ocr.length > 0)
          .length,
        segments.length,
      ),
      ui: ratio(
        segments.filter((segment) => temporalGrounding.get(segment.segmentId)!.ui.length > 0)
          .length,
        segments.length,
      ),
      shortcut: ratio(
        segments.filter((segment) => temporalGrounding.get(segment.segmentId)!.shortcut.length > 0)
          .length,
        segments.length,
      ),
    },
    blockers,
  };
}

function sideEffects() {
  return {
    providerCalled: false,
    procedureStored: false,
    proposalCreated: false,
    hostExecutionStarted: false,
  } as const;
}

export async function prepareProcedureTutorialMediaAuthoring(
  input: PrepareProcedureTutorialMediaAuthoringInput,
): Promise<ProcedureTutorialMediaAuthoringCurrentPreparation> {
  const supplied = procedureTutorialMediaCurrentAnalysisResultSchema.parse(input.analysis);
  const authoringRequest = procedureTutorialMediaAuthoringPrepareStartRequestSchema.parse({
    formatVersion: procedureTutorialMediaAuthoringFormatVersion,
    analysisRequestId: supplied.requestId,
    analysisJobId: supplied.jobId,
    source: input.source,
    request: input.request,
    video: input.video,
  });
  const { request, video } = authoringRequest;
  const suppliedFingerprint = sha256(supplied);
  const verified = procedureTutorialMediaCurrentAnalysisResultSchema.parse(
    await input.verifyAnalysis(supplied),
  );
  if (
    sha256(verified) !== suppliedFingerprint ||
    !isDeepStrictEqual(authoringRequest.source, supplied.source) ||
    !isDeepStrictEqual(verified.source, supplied.source)
  ) {
    throw new Error('Tutorial media verifier returned analysis content different from the input');
  }
  const rightsStatus =
    supplied.source.rightsBasis === 'rights_holder_permission'
      ? ('permission_granted' as const)
      : supplied.source.rightsBasis === 'license_verified'
        ? ('license_verified' as const)
        : ('public_domain' as const);
  const tutorialVideo = {
    title: video.title,
    uri: video.uri,
    durationMs: verified.probe.durationMs,
    rightsStatus,
  } as
    | {
        title: string;
        uri: string;
        durationMs: number;
        rightsStatus: 'permission_granted';
      }
    | { title: string; uri: string; durationMs: number; rightsStatus: 'license_verified' }
    | { title: string; uri: string; durationMs: number; rightsStatus: 'public_domain' };

  const asrById = new Map(verified.asrSegments.map((segment) => [segment.segmentId, segment]));
  const baseEvidenceBindings = verified.semanticSegments.map((segment, index) => ({
    promptSegmentOrder: index + 1,
    promptEvidenceId: null,
    semanticSegmentId: segment.segmentId,
    startMs: segment.startMs,
    endMs: segment.endMs,
    canonicalDescription: segment.canonicalDescription,
    asrSegmentIds: [...segment.asrSegmentIds],
    ocrCandidateIds: [...segment.ocrCandidateIds],
    uiCandidateIds: [...segment.uiCandidateIds],
    shortcutCandidateIds: [...segment.shortcutCandidateIds],
    evidence: segment.evidence.map((evidence) => ({ ...evidence })),
  }));
  const quality = qualityReport(verified);
  const common = {
    formatVersion: procedureTutorialMediaAuthoringFormatVersion,
    source: supplied.source,
    analysisRequestId: supplied.requestId,
    analysisJobId: supplied.jobId,
    analysisFingerprint: suppliedFingerprint,
    quality,
    sideEffects: sideEffects(),
  };

  if (quality.blockers.length > 0) {
    const content = {
      ...common,
      evidenceBindings: baseEvidenceBindings,
      packet: null,
      status: 'blocked' as const,
    };
    return procedureTutorialMediaAuthoringCurrentPreparationSchema.parse({
      ...content,
      fingerprint: sha256(content),
    });
  }

  const packet = buildProcedureAuthoringPromptPacket(
    {
      ...request,
      locale: request.locale ?? verified.locale,
      tutorial: {
        video: {
          ...tutorialVideo,
        },
        transcript: {
          origin: 'local_media_analysis',
          locale: verified.locale,
          localMediaAnalysis: {
            analysisRequestId: verified.requestId,
            analysisJobId: verified.jobId,
            analysisFingerprint: suppliedFingerprint,
            source: supplied.source,
            analysisProfile: verified.analysisProfile,
            completedAt: verified.completedAt,
            manifest: {
              artifactUri: verified.manifestIntegrity.manifestArtifactUri,
              sha256: verified.manifestIntegrity.manifestSha256,
              rootSha256: verified.manifestIntegrity.rootSha256,
              source: supplied.source,
            },
            tools: verified.tools.map((tool) => ({
              toolId: tool.toolId,
              toolVersion: tool.toolVersion,
              invocationContractVersion: tool.invocationContractVersion,
              executableSha256: tool.executableSha256,
              versionOutputSha256: tool.versionOutputSha256,
              normalizedInvocationSha256: tool.normalizedInvocationSha256,
              configurationSha256: tool.configurationSha256,
              ...(tool.modelSha256 === undefined ? {} : { modelSha256: tool.modelSha256 }),
            })),
            segmentation: { ...verified.segmentation },
            semanticBindings: verified.semanticSegments.map((segment) => ({
              semanticSegmentId: segment.segmentId,
              order: segment.order,
              promptEvidenceId: `evidence.${request.treeId}.revision.${request.revision}.tutorial.segment.${String(segment.order).padStart(4, '0')}`,
              startMs: segment.startMs,
              endMs: segment.endMs,
              canonicalDescription: segment.canonicalDescription,
              asrSegmentIds: [...segment.asrSegmentIds],
              ocrCandidateIds: [...segment.ocrCandidateIds],
              uiCandidateIds: [...segment.uiCandidateIds],
              shortcutCandidateIds: [...segment.shortcutCandidateIds],
              evidence: segment.evidence.map((evidence) => ({ ...evidence })),
            })),
          },
          segments: verified.semanticSegments.map((segment) => {
            const citedAsr = segment.asrSegmentIds
              .map((id) => asrById.get(id))
              .filter((candidate) => candidate !== undefined);
            return {
              startMs: segment.startMs,
              endMs: segment.endMs,
              text:
                citedAsr.length === 0
                  ? segment.canonicalDescription
                  : citedAsr.map((candidate) => candidate.text).join(' '),
              confidence: Math.min(
                segment.confidence,
                ...citedAsr.flatMap((candidate) =>
                  candidate.confidence === null ? [] : [candidate.confidence],
                ),
              ),
            };
          }),
        },
      },
    },
    input.actionCatalog,
    input.interactionCatalog,
  );
  const promptSegments = packet.context.tutorialProvenance?.transcript.segments ?? [];
  const evidenceBindings = baseEvidenceBindings.map((binding) => {
    const matches = promptSegments.filter(
      (segment) =>
        segment.order === binding.promptSegmentOrder &&
        segment.locator.startMs === binding.startMs &&
        segment.locator.endMs === binding.endMs,
    );
    if (matches.length !== 1) {
      throw new Error('Tutorial media evidence could not be bound to one prompt evidence id');
    }
    return { ...binding, promptEvidenceId: matches[0]!.id };
  });
  const content = { ...common, evidenceBindings, packet, status: 'ready' as const };
  return procedureTutorialMediaAuthoringCurrentPreparationSchema.parse({
    ...content,
    fingerprint: sha256(content),
  });
}
