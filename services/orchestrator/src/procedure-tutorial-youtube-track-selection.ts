import type { ExecutionEventInput, StoredExecutionEvent } from '@operatingline/persistence';
import {
  procedureTutorialYoutubeTrackListResultSchema,
  procedureTutorialYoutubeTrackSelectionCompletedEventSchema,
  procedureTutorialYoutubeTrackSelectionRequestSchema,
  procedureTutorialYoutubeTrackSelectionResultSchema,
  type ProcedureTutorialYoutubeTrackListResult,
  type ProcedureTutorialYoutubeTrackSelectionErrorCode,
  type ProcedureTutorialYoutubeTrackSelectionRequest,
  type ProcedureTutorialYoutubeTrackSelectionResult,
} from '@operatingline/protocol';

import { plannerProviderRequestFingerprint } from './planner-provider-invocation.js';
import { recommendProcedureTutorialYoutubeCaptionTracks } from './procedure-tutorial-youtube-track-recommendation.js';

export const procedureTutorialYoutubeTrackSelectionEvidenceEventTypes = [
  'procedure.tutorial.youtube.caption-track-selection.completed',
] as const;

export type ProcedureTutorialYoutubeTrackSelectionRetryMode = 'same_request_id' | 'never';

export class ProcedureTutorialYoutubeTrackSelectionError extends Error {
  constructor(
    readonly code: ProcedureTutorialYoutubeTrackSelectionErrorCode,
    message: string,
    readonly retryMode: ProcedureTutorialYoutubeTrackSelectionRetryMode,
  ) {
    super(message);
    this.name = 'ProcedureTutorialYoutubeTrackSelectionError';
  }
}

interface SelectionIdentity {
  readonly fingerprint: string;
}

interface CompletedSelection extends SelectionIdentity {
  readonly result: ProcedureTutorialYoutubeTrackSelectionResult;
}

export interface ProcedureTutorialYoutubeTrackSelectionCoordinatorOptions {
  readonly existingEvents: readonly StoredExecutionEvent[];
  readonly completedTrackList: (
    requestId: string,
  ) => ProcedureTutorialYoutubeTrackListResult | null;
  readonly appendEvent: (event: ExecutionEventInput) => void;
  readonly now?: () => string;
}

export interface ProcedureTutorialYoutubeTrackSelectionCoordinator {
  select(
    request: ProcedureTutorialYoutubeTrackSelectionRequest,
  ): ProcedureTutorialYoutubeTrackSelectionResult;
  completedSelection(requestId: string): ProcedureTutorialYoutubeTrackSelectionResult | null;
}

function safeSelectionError(error: unknown): ProcedureTutorialYoutubeTrackSelectionError {
  if (error instanceof ProcedureTutorialYoutubeTrackSelectionError) return error;
  return new ProcedureTutorialYoutubeTrackSelectionError(
    'youtube_track_selection_invalid',
    'YouTube caption track selection could not satisfy the strict result contract',
    'never',
  );
}

function assertMatchingSelectionIdentity(
  requestId: string,
  expected: SelectionIdentity,
  actual: SelectionIdentity,
): void {
  if (expected.fingerprint !== actual.fingerprint) {
    throw new ProcedureTutorialYoutubeTrackSelectionError(
      'youtube_track_selection_conflict',
      `YouTube caption track selection requestId ${requestId} was reused with different input`,
      'never',
    );
  }
}

export function buildProcedureTutorialYoutubeTrackSelection(
  requestInput: ProcedureTutorialYoutubeTrackSelectionRequest,
  sourceInput: ProcedureTutorialYoutubeTrackListResult | null,
  recordedAt: string,
): ProcedureTutorialYoutubeTrackSelectionResult {
  try {
    const request = procedureTutorialYoutubeTrackSelectionRequestSchema.parse(requestInput);
    if (sourceInput === null) {
      throw new ProcedureTutorialYoutubeTrackSelectionError(
        'youtube_track_selection_source_not_found',
        `Completed YouTube caption track list ${request.trackListRequestId} was not found`,
        'same_request_id',
      );
    }
    const source = procedureTutorialYoutubeTrackListResultSchema.parse(sourceInput);
    if (source.requestId !== request.trackListRequestId || source.videoId !== request.videoId) {
      throw new ProcedureTutorialYoutubeTrackSelectionError(
        'youtube_track_selection_source_mismatch',
        'YouTube caption track selection source identity does not match its request',
        'never',
      );
    }
    const selectedTrack = source.tracks.find(
      (track) => track.captionTrackId === request.captionTrackId,
    );
    if (selectedTrack === undefined) {
      throw new ProcedureTutorialYoutubeTrackSelectionError(
        'youtube_track_selection_track_not_found',
        'Selected YouTube caption track was not present in the completed authorized list',
        'never',
      );
    }
    if (selectedTrack.status !== 'serving') {
      throw new ProcedureTutorialYoutubeTrackSelectionError(
        'youtube_track_selection_track_not_importable',
        'Selected YouTube caption track is not in serving state',
        'never',
      );
    }

    const recommendation =
      request.recommendationPreferences === undefined
        ? null
        : recommendProcedureTutorialYoutubeCaptionTracks(
            {
              formatVersion: '1.0.0',
              requestId: request.requestId,
              trackListRequestId: request.trackListRequestId,
              videoId: request.videoId,
              preferences: request.recommendationPreferences,
            },
            source,
          );
    const recommendedCaptionTrackId = recommendation?.recommendedCaptionTrackId ?? null;
    if (
      request.confirmation.reason.reasonCode === 'recommended_candidate' &&
      (recommendation === null || recommendedCaptionTrackId !== request.captionTrackId)
    ) {
      throw new ProcedureTutorialYoutubeTrackSelectionError(
        'youtube_track_selection_recommendation_mismatch',
        'A recommended-candidate selection must match the recomputed first ranked track',
        'never',
      );
    }
    const selectedCandidate = recommendation?.rankedCandidates.find(
      (candidate) => candidate.track.captionTrackId === request.captionTrackId,
    );

    return procedureTutorialYoutubeTrackSelectionResultSchema.parse({
      formatVersion: '1.0.0',
      requestId: request.requestId,
      sourceTrackList: {
        requestId: source.requestId,
        videoId: source.videoId,
        listedAt: source.listedAt,
      },
      selectedTrack,
      confirmation: request.confirmation,
      recommendation:
        recommendation === null
          ? null
          : {
              preferences: request.recommendationPreferences,
              recommendedCaptionTrackId,
              selectedCandidateRank: selectedCandidate?.rank ?? null,
              selectedTrackWasRecommended: recommendedCaptionTrackId === request.captionTrackId,
            },
      sideEffects: {
        captionTrackSelectionRecorded: true,
        networkFetched: false,
        additionalQuotaUnits: 0,
        captionContentDownloaded: false,
        videoMediaDownloaded: false,
        modelCalled: false,
        procedureStored: false,
        proposalCreated: false,
        hostExecutionStarted: false,
      },
      recordedAt,
    });
  } catch (error) {
    throw safeSelectionError(error);
  }
}

export function restoreProcedureTutorialYoutubeTrackSelections(
  events: readonly StoredExecutionEvent[],
): ReadonlyMap<string, CompletedSelection> {
  const completed = new Map<string, CompletedSelection>();
  for (const event of events) {
    if (event.eventType !== 'procedure.tutorial.youtube.caption-track-selection.completed') {
      continue;
    }
    const payload = procedureTutorialYoutubeTrackSelectionCompletedEventSchema.parse(event.payload);
    const identity = { fingerprint: payload.requestFingerprint };
    const existing = completed.get(payload.request.requestId);
    if (existing !== undefined) {
      assertMatchingSelectionIdentity(payload.request.requestId, existing, identity);
    }
    completed.set(payload.request.requestId, { ...identity, result: payload.result });
  }
  return completed;
}

export function createProcedureTutorialYoutubeTrackSelectionCoordinator(
  options: ProcedureTutorialYoutubeTrackSelectionCoordinatorOptions,
): ProcedureTutorialYoutubeTrackSelectionCoordinator {
  const completed = new Map(restoreProcedureTutorialYoutubeTrackSelections(options.existingEvents));
  const now = options.now ?? (() => new Date().toISOString());

  return {
    select: (requestInput) => {
      const request = procedureTutorialYoutubeTrackSelectionRequestSchema.parse(requestInput);
      const identity = { fingerprint: plannerProviderRequestFingerprint(request) };
      const prior = completed.get(request.requestId);
      if (prior !== undefined) {
        assertMatchingSelectionIdentity(request.requestId, prior, identity);
        return structuredClone(prior.result);
      }
      const result = buildProcedureTutorialYoutubeTrackSelection(
        request,
        options.completedTrackList(request.trackListRequestId),
        now(),
      );
      const completedPayload = procedureTutorialYoutubeTrackSelectionCompletedEventSchema.parse({
        request,
        requestFingerprint: identity.fingerprint,
        result,
        occurredAt: result.recordedAt,
      });
      try {
        options.appendEvent({
          id: `procedure-tutorial-youtube-caption-track-selection-completed:${request.requestId}`,
          eventType: 'procedure.tutorial.youtube.caption-track-selection.completed',
          payload: completedPayload,
        });
      } catch {
        throw new ProcedureTutorialYoutubeTrackSelectionError(
          'youtube_track_selection_persistence_failed',
          'YouTube caption track selection evidence could not be persisted',
          'same_request_id',
        );
      }
      completed.set(request.requestId, { ...identity, result });
      return structuredClone(result);
    },
    completedSelection: (requestId) => {
      const prior = completed.get(requestId);
      return prior === undefined ? null : structuredClone(prior.result);
    },
  };
}

export function procedureTutorialYoutubeTrackSelectionHttpStatus(
  error: unknown,
): 404 | 409 | 422 | 500 {
  switch (safeSelectionError(error).code) {
    case 'youtube_track_selection_source_not_found':
    case 'youtube_track_selection_track_not_found':
      return 404;
    case 'youtube_track_selection_source_mismatch':
    case 'youtube_track_selection_recommendation_mismatch':
    case 'youtube_track_selection_conflict':
      return 409;
    case 'youtube_track_selection_track_not_importable':
    case 'youtube_track_selection_invalid':
      return 422;
    case 'youtube_track_selection_persistence_failed':
      return 500;
  }
}

export function procedureTutorialYoutubeTrackSelectionErrorResponse(
  error: unknown,
  requestId: string | null,
): {
  readonly error: ProcedureTutorialYoutubeTrackSelectionErrorCode;
  readonly requestId: string | null;
  readonly message: string;
  readonly retryMode: ProcedureTutorialYoutubeTrackSelectionRetryMode;
} {
  const safeError = safeSelectionError(error);
  return {
    error: safeError.code,
    requestId,
    message: safeError.message,
    retryMode: safeError.retryMode,
  };
}
