import type { ExecutionEventInput, StoredExecutionEvent } from '@operatingline/persistence';
import {
  procedureAuthoringPromptPacketSchema,
  procedureTutorialYoutubeImportFormatVersion,
  procedureTutorialYoutubeImportCompletedEventSchema,
  procedureTutorialYoutubeImportFailedEventSchema,
  procedureTutorialYoutubeImportRequestSchema,
  procedureTutorialYoutubeImportRequestedEventSchema,
  procedureTutorialYoutubeTrackListCompletedEventSchema,
  procedureTutorialYoutubeTrackListFailedEventSchema,
  procedureTutorialYoutubeTrackListRequestSchema,
  procedureTutorialYoutubeTrackListRequestedEventSchema,
  procedureTutorialYoutubeTrackListResultSchema,
  procedureTutorialYoutubeTrackSelectionCurrentResultSchema,
  type ActionCatalog,
  type InteractionCatalog,
  type ProcedureAuthoringPromptPacket,
  type ProcedureTutorialYoutubeImportErrorCode,
  type ProcedureTutorialYoutubeImportRequest,
  type ProcedureTutorialYoutubeTrackListErrorCode,
  type ProcedureTutorialYoutubeTrackListRequest,
  type ProcedureTutorialYoutubeTrackListResult,
  type ProcedureTutorialYoutubeTrackSelectionCurrentResult,
} from '@operatingline/protocol';

import { plannerProviderRequestFingerprint } from './planner-provider-invocation.js';
import { buildProcedureAuthoringPromptPacket } from './procedure-authoring-prompt.js';
import { procedureTutorialYoutubeTrackSelectionEvidenceEventTypes } from './procedure-tutorial-youtube-track-selection.js';
import { parseProcedureTutorialTranscriptImport } from './procedure-tutorial-transcript-import.js';
import {
  ProcedureTutorialYoutubeSourceError,
  type ProcedureTutorialYoutubeCaptionAcquisitionResult,
  type ProcedureTutorialYoutubeCaptionSource,
} from './youtube-caption-source.js';

export const procedureTutorialYoutubeImportEvidenceEventTypes = [
  'procedure.tutorial.youtube.caption.requested',
  'procedure.tutorial.youtube.caption.completed',
  'procedure.tutorial.youtube.caption.failed',
] as const;
export const procedureTutorialYoutubeTrackListEvidenceEventTypes = [
  'procedure.tutorial.youtube.caption-tracks.requested',
  'procedure.tutorial.youtube.caption-tracks.completed',
  'procedure.tutorial.youtube.caption-tracks.failed',
] as const;
export const procedureTutorialYoutubeEvidenceEventTypes = [
  ...procedureTutorialYoutubeImportEvidenceEventTypes,
  ...procedureTutorialYoutubeTrackListEvidenceEventTypes,
  ...procedureTutorialYoutubeTrackSelectionEvidenceEventTypes,
] as const;

export type ProcedureTutorialYoutubeRetryMode = 'same_request_id' | 'new_request_id' | 'never';
export type ProcedureTutorialYoutubeImportRetryMode = ProcedureTutorialYoutubeRetryMode;
export type ProcedureTutorialYoutubeTrackListRetryMode = ProcedureTutorialYoutubeRetryMode;

export class ProcedureTutorialYoutubeImportError extends Error {
  constructor(
    readonly code: ProcedureTutorialYoutubeImportErrorCode,
    message: string,
    readonly retryMode: ProcedureTutorialYoutubeImportRetryMode,
  ) {
    super(message);
    this.name = 'ProcedureTutorialYoutubeImportError';
  }
}

export class ProcedureTutorialYoutubeTrackListError extends Error {
  constructor(
    readonly code: ProcedureTutorialYoutubeTrackListErrorCode,
    message: string,
    readonly retryMode: ProcedureTutorialYoutubeTrackListRetryMode,
  ) {
    super(message);
    this.name = 'ProcedureTutorialYoutubeTrackListError';
  }
}

interface ImportIdentity {
  readonly fingerprint: string;
}

interface CompletedImport extends ImportIdentity {
  readonly packet: ProcedureAuthoringPromptPacket;
}

interface CompletedTrackList extends ImportIdentity {
  readonly result: ProcedureTutorialYoutubeTrackListResult;
}

export interface ProcedureTutorialYoutubeImportCoordinatorOptions {
  readonly source?: ProcedureTutorialYoutubeCaptionSource;
  readonly existingEvents: readonly StoredExecutionEvent[];
  readonly buildPacket: (
    request: ProcedureTutorialYoutubeImportRequest,
    acquisition: ProcedureTutorialYoutubeCaptionAcquisitionResult,
    selection: ProcedureTutorialYoutubeTrackSelectionCurrentResult | undefined,
  ) => ProcedureAuthoringPromptPacket;
  readonly completedTrackSelection?: (
    requestId: string,
  ) => ProcedureTutorialYoutubeTrackSelectionCurrentResult | null;
  readonly appendEvent: (event: ExecutionEventInput) => void;
}

export interface ProcedureTutorialYoutubeImportCoordinator {
  listTracks(
    request: ProcedureTutorialYoutubeTrackListRequest,
  ): Promise<ProcedureTutorialYoutubeTrackListResult>;
  importCaption(
    request: ProcedureTutorialYoutubeImportRequest,
  ): Promise<ProcedureAuthoringPromptPacket>;
  completedPacket(requestId: string): ProcedureAuthoringPromptPacket | null;
  completedTrackList(requestId: string): ProcedureTutorialYoutubeTrackListResult | null;
  beginClose(): void;
  close(): Promise<void>;
}

function assertMatchingIdentity(
  requestId: string,
  expected: ImportIdentity,
  actual: ImportIdentity,
): void {
  if (expected.fingerprint !== actual.fingerprint) {
    throw new ProcedureTutorialYoutubeImportError(
      'youtube_import_conflict',
      `YouTube caption import requestId ${requestId} was reused with different input`,
      'new_request_id',
    );
  }
}

function safeImportError(error: unknown): ProcedureTutorialYoutubeImportError {
  if (error instanceof ProcedureTutorialYoutubeImportError) return error;
  if (error instanceof ProcedureTutorialYoutubeSourceError) {
    return new ProcedureTutorialYoutubeImportError(error.code, error.message, 'new_request_id');
  }
  return new ProcedureTutorialYoutubeImportError(
    'youtube_packet_invalid',
    'Authorized YouTube caption data could not produce a valid Procedure authoring packet',
    'new_request_id',
  );
}

function resolveImportTrackSelection(
  request: ProcedureTutorialYoutubeImportRequest,
  lookup: ProcedureTutorialYoutubeImportCoordinatorOptions['completedTrackSelection'],
): ProcedureTutorialYoutubeTrackSelectionCurrentResult | undefined {
  if (request.formatVersion !== procedureTutorialYoutubeImportFormatVersion) {
    throw new ProcedureTutorialYoutubeImportError(
      'youtube_import_legacy_request_unsupported',
      'YouTube caption import request 1.0.0 is accepted only when restoring historical completed evidence; submit request 1.1.0 with a recorded selectionRequestId',
      'never',
    );
  }
  const resultInput = lookup?.(request.selectionRequestId) ?? null;
  if (resultInput === null) {
    throw new ProcedureTutorialYoutubeImportError(
      'youtube_import_selection_not_found',
      `Recorded YouTube caption track selection ${request.selectionRequestId} was not found`,
      'same_request_id',
    );
  }
  const parsed = procedureTutorialYoutubeTrackSelectionCurrentResultSchema.safeParse(resultInput);
  if (
    !parsed.success ||
    parsed.data.requestId !== request.selectionRequestId ||
    parsed.data.sourceTrackList.videoId !== request.youtube.videoId ||
    parsed.data.selectedTrack.captionTrackId !== request.youtube.captionTrackId ||
    parsed.data.selectedTrack.status !== 'serving' ||
    (request.youtube.expectedTrackLanguage !== undefined &&
      parsed.data.selectedTrack.language !== request.youtube.expectedTrackLanguage)
  ) {
    throw new ProcedureTutorialYoutubeImportError(
      'youtube_import_selection_mismatch',
      'Recorded YouTube caption track selection identity does not match the import request',
      'never',
    );
  }
  return parsed.data;
}

function assertMatchingTrackListIdentity(
  requestId: string,
  expected: ImportIdentity,
  actual: ImportIdentity,
): void {
  if (expected.fingerprint !== actual.fingerprint) {
    throw new ProcedureTutorialYoutubeTrackListError(
      'youtube_track_list_conflict',
      `YouTube caption track list requestId ${requestId} was reused with different input`,
      'new_request_id',
    );
  }
}

function safeTrackListError(error: unknown): ProcedureTutorialYoutubeTrackListError {
  if (error instanceof ProcedureTutorialYoutubeTrackListError) return error;
  if (error instanceof ProcedureTutorialYoutubeSourceError) {
    if (error.code === 'youtube_source_unavailable') {
      return new ProcedureTutorialYoutubeTrackListError(
        'youtube_track_list_unavailable',
        error.message,
        'new_request_id',
      );
    }
    if (
      error.code === 'youtube_authentication_required' ||
      error.code === 'youtube_source_unauthorized' ||
      error.code === 'youtube_source_quota_exceeded' ||
      error.code === 'youtube_video_not_found' ||
      error.code === 'youtube_source_failed'
    ) {
      return new ProcedureTutorialYoutubeTrackListError(
        error.code,
        error.message,
        'new_request_id',
      );
    }
    return new ProcedureTutorialYoutubeTrackListError(
      'youtube_source_failed',
      'YouTube Data API caption track listing failed without a safe public error',
      'new_request_id',
    );
  }
  return new ProcedureTutorialYoutubeTrackListError(
    'youtube_track_list_invalid',
    'Authorized YouTube caption track metadata violates the strict result contract',
    'new_request_id',
  );
}

async function prepareImportAuthorization(
  source: ProcedureTutorialYoutubeCaptionSource,
): Promise<void> {
  try {
    await source.prepareAuthorization?.();
  } catch (error) {
    if (
      error instanceof ProcedureTutorialYoutubeSourceError &&
      error.code === 'youtube_authentication_required'
    ) {
      throw new ProcedureTutorialYoutubeImportError(error.code, error.message, 'same_request_id');
    }
    throw new ProcedureTutorialYoutubeImportError(
      'youtube_source_unavailable',
      'YouTube authorization could not be prepared before caption acquisition',
      'same_request_id',
    );
  }
}

async function prepareTrackListAuthorization(
  source: ProcedureTutorialYoutubeCaptionSource,
): Promise<void> {
  try {
    await source.prepareAuthorization?.();
  } catch (error) {
    if (
      error instanceof ProcedureTutorialYoutubeSourceError &&
      error.code === 'youtube_authentication_required'
    ) {
      throw new ProcedureTutorialYoutubeTrackListError(
        error.code,
        error.message,
        'same_request_id',
      );
    }
    throw new ProcedureTutorialYoutubeTrackListError(
      'youtube_track_list_unavailable',
      'YouTube authorization could not be prepared before caption track listing',
      'same_request_id',
    );
  }
}

export function buildProcedureTutorialYoutubePromptPacket(
  requestInput: ProcedureTutorialYoutubeImportRequest,
  acquisition: ProcedureTutorialYoutubeCaptionAcquisitionResult,
  actionCatalog: ActionCatalog,
  interactionCatalog: InteractionCatalog,
  selectionInput?: ProcedureTutorialYoutubeTrackSelectionCurrentResult,
): ProcedureAuthoringPromptPacket {
  const request = procedureTutorialYoutubeImportRequestSchema.parse(requestInput);
  const selection =
    selectionInput === undefined
      ? undefined
      : procedureTutorialYoutubeTrackSelectionCurrentResultSchema.parse(selectionInput);
  if (request.formatVersion === procedureTutorialYoutubeImportFormatVersion) {
    if (
      selection === undefined ||
      selection.requestId !== request.selectionRequestId ||
      selection.sourceTrackList.videoId !== request.youtube.videoId ||
      selection.selectedTrack.captionTrackId !== request.youtube.captionTrackId ||
      selection.selectedTrack.status !== 'serving' ||
      (request.youtube.expectedTrackLanguage !== undefined &&
        selection.selectedTrack.language !== request.youtube.expectedTrackLanguage)
    ) {
      throw new Error('YouTube caption track selection identity does not match the import request');
    }
  } else if (selection !== undefined) {
    throw new Error('Legacy YouTube caption imports cannot carry track selection provenance');
  }
  if (
    acquisition.captionDocument.acquisition.videoId !== request.youtube.videoId ||
    acquisition.captionDocument.acquisition.captionTrackId !== request.youtube.captionTrackId ||
    acquisition.captionDocument.acquisition.requestedFormat !== request.youtube.requestedFormat ||
    acquisition.captionDocument.format !== request.youtube.requestedFormat ||
    (request.youtube.expectedTrackLanguage !== undefined &&
      acquisition.captionDocument.locale !== request.youtube.expectedTrackLanguage)
  ) {
    throw new Error('YouTube caption acquisition identity does not match the import request');
  }
  const video =
    request.youtube.rightsStatus === 'license_verified'
      ? {
          ...acquisition.video,
          rightsStatus: request.youtube.rightsStatus,
          license: request.youtube.license,
        }
      : {
          ...acquisition.video,
          rightsStatus: request.youtube.rightsStatus,
          ...(request.youtube.license === undefined ? {} : { license: request.youtube.license }),
        };
  const parsed = parseProcedureTutorialTranscriptImport({
    formatVersion: '1.0.0',
    targetAdapterId: request.targetAdapterId,
    ...(request.actionCatalogVersion === undefined
      ? {}
      : { actionCatalogVersion: request.actionCatalogVersion }),
    ...(request.interactionCatalogVersion === undefined
      ? {}
      : { interactionCatalogVersion: request.interactionCatalogVersion }),
    goal: request.goal,
    treeId: request.treeId,
    revision: request.revision,
    ...(request.locale === undefined ? {} : { locale: request.locale }),
    tutorial: {
      video,
      captionDocument: {
        origin: 'user_supplied',
        format: acquisition.captionDocument.format,
        content: acquisition.captionDocument.content,
        locale: acquisition.captionDocument.locale,
        defaultConfidence: request.youtube.defaultConfidence,
      },
    },
  });
  return buildProcedureAuthoringPromptPacket(parsed.request, actionCatalog, interactionCatalog, {
    tutorialTranscriptDocument: {
      ...parsed.document,
      acquisition: {
        ...acquisition.captionDocument.acquisition,
        ...(selection === undefined
          ? {}
          : {
              selection: {
                requestId: selection.requestId,
                requestFingerprint: selection.requestFingerprint,
                trackListRequestId: selection.sourceTrackList.requestId,
                confirmedAt: selection.recordedAt,
                reasonCode: selection.confirmation.reason.reasonCode,
                selectedTrackWasRecommended:
                  selection.recommendation?.selectedTrackWasRecommended ?? null,
                selectedCandidateRank: selection.recommendation?.selectedCandidateRank ?? null,
              },
            }),
      },
    },
  });
}

export function restoreProcedureTutorialYoutubeImports(events: readonly StoredExecutionEvent[]): {
  readonly attempted: ReadonlyMap<string, ImportIdentity>;
  readonly completed: ReadonlyMap<string, CompletedImport>;
} {
  const attempted = new Map<string, ImportIdentity>();
  const completed = new Map<string, CompletedImport>();
  const record = (requestId: string, identity: ImportIdentity) => {
    const existing = completed.get(requestId) ?? attempted.get(requestId);
    if (existing !== undefined) assertMatchingIdentity(requestId, existing, identity);
    attempted.set(requestId, identity);
  };
  for (const event of events) {
    if (event.eventType === 'procedure.tutorial.youtube.caption.requested') {
      const payload = procedureTutorialYoutubeImportRequestedEventSchema.parse(event.payload);
      record(payload.requestId, { fingerprint: payload.requestFingerprint });
    } else if (event.eventType === 'procedure.tutorial.youtube.caption.failed') {
      const payload = procedureTutorialYoutubeImportFailedEventSchema.parse(event.payload);
      record(payload.requestId, { fingerprint: payload.requestFingerprint });
    } else if (event.eventType === 'procedure.tutorial.youtube.caption.completed') {
      const payload = procedureTutorialYoutubeImportCompletedEventSchema.parse(event.payload);
      const identity = { fingerprint: payload.requestFingerprint };
      assertMatchingIdentity(payload.request.requestId, identity, {
        fingerprint: plannerProviderRequestFingerprint(payload.request),
      });
      record(payload.request.requestId, identity);
      completed.set(payload.request.requestId, { ...identity, packet: payload.packet });
    }
  }
  return { attempted, completed };
}

export function restoreProcedureTutorialYoutubeTrackLists(
  events: readonly StoredExecutionEvent[],
): {
  readonly attempted: ReadonlyMap<string, ImportIdentity>;
  readonly completed: ReadonlyMap<string, CompletedTrackList>;
} {
  const attempted = new Map<string, ImportIdentity>();
  const completed = new Map<string, CompletedTrackList>();
  const record = (requestId: string, identity: ImportIdentity) => {
    const existing = completed.get(requestId) ?? attempted.get(requestId);
    if (existing !== undefined) assertMatchingTrackListIdentity(requestId, existing, identity);
    attempted.set(requestId, identity);
  };
  for (const event of events) {
    if (event.eventType === 'procedure.tutorial.youtube.caption-tracks.requested') {
      const payload = procedureTutorialYoutubeTrackListRequestedEventSchema.parse(event.payload);
      record(payload.requestId, { fingerprint: payload.requestFingerprint });
    } else if (event.eventType === 'procedure.tutorial.youtube.caption-tracks.failed') {
      const payload = procedureTutorialYoutubeTrackListFailedEventSchema.parse(event.payload);
      record(payload.requestId, { fingerprint: payload.requestFingerprint });
    } else if (event.eventType === 'procedure.tutorial.youtube.caption-tracks.completed') {
      const payload = procedureTutorialYoutubeTrackListCompletedEventSchema.parse(event.payload);
      const identity = { fingerprint: payload.requestFingerprint };
      record(payload.request.requestId, identity);
      completed.set(payload.request.requestId, { ...identity, result: payload.result });
    }
  }
  return { attempted, completed };
}

export function createProcedureTutorialYoutubeImportCoordinator(
  options: ProcedureTutorialYoutubeImportCoordinatorOptions,
): ProcedureTutorialYoutubeImportCoordinator {
  const restored = restoreProcedureTutorialYoutubeImports(options.existingEvents);
  const restoredTrackLists = restoreProcedureTutorialYoutubeTrackLists(options.existingEvents);
  const attempted = new Map(restored.attempted);
  const completed = new Map(restored.completed);
  const trackListsAttempted = new Map(restoredTrackLists.attempted);
  const completedTrackLists = new Map(restoredTrackLists.completed);
  const inFlight = new Map<
    string,
    ImportIdentity & { readonly promise: Promise<ProcedureAuthoringPromptPacket> }
  >();
  const trackListsInFlight = new Map<
    string,
    ImportIdentity & { readonly promise: Promise<ProcedureTutorialYoutubeTrackListResult> }
  >();
  const authorizationPreflights = new Set<Promise<void>>();
  let closing = false;
  let closePromise: Promise<void> | undefined;

  const beginClose = () => {
    closing = true;
  };

  const trackAuthorizationPreflight = async (preflight: Promise<void>): Promise<void> => {
    authorizationPreflights.add(preflight);
    try {
      await preflight;
    } finally {
      authorizationPreflights.delete(preflight);
    }
  };

  const appendEvidence = (
    event: ExecutionEventInput,
    retryMode: ProcedureTutorialYoutubeImportRetryMode,
  ) => {
    try {
      options.appendEvent(event);
    } catch {
      throw new ProcedureTutorialYoutubeImportError(
        'youtube_import_persistence_failed',
        'YouTube caption import evidence could not be persisted',
        retryMode,
      );
    }
  };

  const appendTrackListEvidence = (
    event: ExecutionEventInput,
    retryMode: ProcedureTutorialYoutubeTrackListRetryMode,
  ) => {
    try {
      options.appendEvent(event);
    } catch {
      throw new ProcedureTutorialYoutubeTrackListError(
        'youtube_track_list_persistence_failed',
        'YouTube caption track list evidence could not be persisted',
        retryMode,
      );
    }
  };

  return {
    listTracks: async (requestInput) => {
      const request = procedureTutorialYoutubeTrackListRequestSchema.parse(requestInput);
      const identity = { fingerprint: plannerProviderRequestFingerprint(request) };
      const running = trackListsInFlight.get(request.requestId);
      if (running !== undefined) {
        assertMatchingTrackListIdentity(request.requestId, running, identity);
        return structuredClone(await running.promise);
      }
      const prior = completedTrackLists.get(request.requestId);
      if (prior !== undefined) {
        assertMatchingTrackListIdentity(request.requestId, prior, identity);
        return structuredClone(prior.result);
      }
      const priorAttempt = trackListsAttempted.get(request.requestId);
      if (priorAttempt !== undefined) {
        assertMatchingTrackListIdentity(request.requestId, priorAttempt, identity);
        throw new ProcedureTutorialYoutubeTrackListError(
          'youtube_track_list_already_attempted',
          `YouTube caption track list ${request.requestId} already reached a terminal or uncertain state`,
          'new_request_id',
        );
      }
      if (closing) {
        throw new ProcedureTutorialYoutubeTrackListError(
          'youtube_track_list_unavailable',
          'YouTube caption track listing is stopping',
          'same_request_id',
        );
      }
      if (options.source === undefined) {
        throw new ProcedureTutorialYoutubeTrackListError(
          'youtube_track_list_unavailable',
          'No authorized YouTube Data API caption source is configured',
          'same_request_id',
        );
      }
      await trackAuthorizationPreflight(prepareTrackListAuthorization(options.source));
      if (closing) {
        throw new ProcedureTutorialYoutubeTrackListError(
          'youtube_track_list_unavailable',
          'YouTube caption track listing is stopping',
          'same_request_id',
        );
      }
      const runningAfterAuthorization = trackListsInFlight.get(request.requestId);
      if (runningAfterAuthorization !== undefined) {
        assertMatchingTrackListIdentity(request.requestId, runningAfterAuthorization, identity);
        return structuredClone(await runningAfterAuthorization.promise);
      }
      const completedAfterAuthorization = completedTrackLists.get(request.requestId);
      if (completedAfterAuthorization !== undefined) {
        assertMatchingTrackListIdentity(request.requestId, completedAfterAuthorization, identity);
        return structuredClone(completedAfterAuthorization.result);
      }
      const attemptedAfterAuthorization = trackListsAttempted.get(request.requestId);
      if (attemptedAfterAuthorization !== undefined) {
        assertMatchingTrackListIdentity(request.requestId, attemptedAfterAuthorization, identity);
        throw new ProcedureTutorialYoutubeTrackListError(
          'youtube_track_list_already_attempted',
          `YouTube caption track list ${request.requestId} already reached a terminal or uncertain state`,
          'new_request_id',
        );
      }

      const requestedPayload = procedureTutorialYoutubeTrackListRequestedEventSchema.parse({
        requestId: request.requestId,
        requestFingerprint: identity.fingerprint,
        videoId: request.youtube.videoId,
        occurredAt: new Date().toISOString(),
      });
      appendTrackListEvidence(
        {
          id: `procedure-tutorial-youtube-caption-tracks-requested:${request.requestId}`,
          eventType: 'procedure.tutorial.youtube.caption-tracks.requested',
          payload: requestedPayload,
        },
        'same_request_id',
      );
      trackListsAttempted.set(request.requestId, identity);

      const promise = Promise.resolve()
        .then(async () => {
          try {
            const sourceResult = await options.source!.listTracks(request.youtube);
            if (sourceResult.videoId !== request.youtube.videoId) {
              throw new Error('YouTube caption track list source identity does not match request');
            }
            const listedAt = new Date().toISOString();
            const result = procedureTutorialYoutubeTrackListResultSchema.parse({
              formatVersion: '1.0.0',
              requestId: request.requestId,
              source: 'youtube_data_api_v3',
              authorization: 'oauth_video_edit_permission',
              videoId: request.youtube.videoId,
              tracks: sourceResult.tracks,
              sideEffects: {
                networkFetched: true,
                quotaOperation: 'youtube.captions.list',
                documentedQuotaUnits: 50,
                captionContentDownloaded: false,
                videoMediaDownloaded: false,
                modelCalled: false,
                procedureStored: false,
                proposalCreated: false,
                hostExecutionStarted: false,
              },
              listedAt,
            });
            const completedPayload = procedureTutorialYoutubeTrackListCompletedEventSchema.parse({
              request,
              requestFingerprint: identity.fingerprint,
              result,
              occurredAt: listedAt,
            });
            appendTrackListEvidence(
              {
                id: `procedure-tutorial-youtube-caption-tracks-completed:${request.requestId}`,
                eventType: 'procedure.tutorial.youtube.caption-tracks.completed',
                payload: completedPayload,
              },
              'new_request_id',
            );
            completedTrackLists.set(request.requestId, { ...identity, result });
            return result;
          } catch (error) {
            const safeError = safeTrackListError(error);
            const failedPayload = procedureTutorialYoutubeTrackListFailedEventSchema.parse({
              requestId: request.requestId,
              requestFingerprint: identity.fingerprint,
              videoId: request.youtube.videoId,
              error: safeError.code,
              occurredAt: new Date().toISOString(),
            });
            appendTrackListEvidence(
              {
                id: `procedure-tutorial-youtube-caption-tracks-failed:${request.requestId}`,
                eventType: 'procedure.tutorial.youtube.caption-tracks.failed',
                payload: failedPayload,
              },
              'new_request_id',
            );
            throw safeError;
          }
        })
        .finally(() => trackListsInFlight.delete(request.requestId));
      trackListsInFlight.set(request.requestId, { ...identity, promise });
      return structuredClone(await promise);
    },
    importCaption: async (requestInput) => {
      const request = procedureTutorialYoutubeImportRequestSchema.parse(requestInput);
      const identity = { fingerprint: plannerProviderRequestFingerprint(request) };
      const running = inFlight.get(request.requestId);
      if (running !== undefined) {
        assertMatchingIdentity(request.requestId, running, identity);
        return structuredClone(await running.promise);
      }
      const prior = completed.get(request.requestId);
      if (prior !== undefined) {
        assertMatchingIdentity(request.requestId, prior, identity);
        return structuredClone(prior.packet);
      }
      const priorAttempt = attempted.get(request.requestId);
      if (priorAttempt !== undefined) {
        assertMatchingIdentity(request.requestId, priorAttempt, identity);
        throw new ProcedureTutorialYoutubeImportError(
          'youtube_import_already_attempted',
          `YouTube caption import ${request.requestId} already reached a terminal or uncertain state`,
          'new_request_id',
        );
      }
      const selection = resolveImportTrackSelection(request, options.completedTrackSelection);
      if (closing) {
        throw new ProcedureTutorialYoutubeImportError(
          'youtube_source_unavailable',
          'YouTube caption import is stopping',
          'same_request_id',
        );
      }
      if (options.source === undefined) {
        throw new ProcedureTutorialYoutubeImportError(
          'youtube_source_unavailable',
          'No authorized YouTube Data API caption source is configured',
          'same_request_id',
        );
      }
      await trackAuthorizationPreflight(prepareImportAuthorization(options.source));
      if (closing) {
        throw new ProcedureTutorialYoutubeImportError(
          'youtube_source_unavailable',
          'YouTube caption import is stopping',
          'same_request_id',
        );
      }
      const runningAfterAuthorization = inFlight.get(request.requestId);
      if (runningAfterAuthorization !== undefined) {
        assertMatchingIdentity(request.requestId, runningAfterAuthorization, identity);
        return structuredClone(await runningAfterAuthorization.promise);
      }
      const completedAfterAuthorization = completed.get(request.requestId);
      if (completedAfterAuthorization !== undefined) {
        assertMatchingIdentity(request.requestId, completedAfterAuthorization, identity);
        return structuredClone(completedAfterAuthorization.packet);
      }
      const attemptedAfterAuthorization = attempted.get(request.requestId);
      if (attemptedAfterAuthorization !== undefined) {
        assertMatchingIdentity(request.requestId, attemptedAfterAuthorization, identity);
        throw new ProcedureTutorialYoutubeImportError(
          'youtube_import_already_attempted',
          `YouTube caption import ${request.requestId} already reached a terminal or uncertain state`,
          'new_request_id',
        );
      }

      const requestedPayload = procedureTutorialYoutubeImportRequestedEventSchema.parse({
        requestId: request.requestId,
        requestFingerprint: identity.fingerprint,
        videoId: request.youtube.videoId,
        captionTrackId: request.youtube.captionTrackId,
        requestedFormat: request.youtube.requestedFormat,
        selectionRequestId:
          request.formatVersion === procedureTutorialYoutubeImportFormatVersion
            ? request.selectionRequestId
            : null,
        occurredAt: new Date().toISOString(),
      });
      appendEvidence(
        {
          id: `procedure-tutorial-youtube-caption-requested:${request.requestId}`,
          eventType: 'procedure.tutorial.youtube.caption.requested',
          payload: requestedPayload,
        },
        'same_request_id',
      );
      attempted.set(request.requestId, identity);

      const promise = Promise.resolve()
        .then(async () => {
          try {
            const acquisition = await options.source!.acquire(request.youtube);
            const packet = procedureAuthoringPromptPacketSchema.parse(
              options.buildPacket(request, acquisition, selection),
            );
            const occurredAt = new Date().toISOString();
            const completedPayload = procedureTutorialYoutubeImportCompletedEventSchema.parse({
              request,
              requestFingerprint: identity.fingerprint,
              packet,
              occurredAt,
            });
            appendEvidence(
              {
                id: `procedure-tutorial-youtube-caption-completed:${request.requestId}`,
                eventType: 'procedure.tutorial.youtube.caption.completed',
                payload: completedPayload,
              },
              'new_request_id',
            );
            completed.set(request.requestId, { ...identity, packet });
            return packet;
          } catch (error) {
            const safeError = safeImportError(error);
            const failedPayload = procedureTutorialYoutubeImportFailedEventSchema.parse({
              requestId: request.requestId,
              requestFingerprint: identity.fingerprint,
              videoId: request.youtube.videoId,
              captionTrackId: request.youtube.captionTrackId,
              requestedFormat: request.youtube.requestedFormat,
              selectionRequestId:
                request.formatVersion === procedureTutorialYoutubeImportFormatVersion
                  ? request.selectionRequestId
                  : null,
              error: safeError.code,
              occurredAt: new Date().toISOString(),
            });
            appendEvidence(
              {
                id: `procedure-tutorial-youtube-caption-failed:${request.requestId}`,
                eventType: 'procedure.tutorial.youtube.caption.failed',
                payload: failedPayload,
              },
              'new_request_id',
            );
            throw safeError;
          }
        })
        .finally(() => inFlight.delete(request.requestId));
      inFlight.set(request.requestId, { ...identity, promise });
      return structuredClone(await promise);
    },
    completedPacket: (requestId) => {
      const result = completed.get(requestId);
      return result === undefined ? null : structuredClone(result.packet);
    },
    completedTrackList: (requestId) => {
      const result = completedTrackLists.get(requestId);
      return result === undefined ? null : structuredClone(result.result);
    },
    beginClose,
    close: () => {
      beginClose();
      closePromise ??= (async () => {
        await Promise.allSettled([
          ...authorizationPreflights,
          ...[...inFlight.values()].map(({ promise }) => promise),
          ...[...trackListsInFlight.values()].map(({ promise }) => promise),
        ]);
        await options.source?.close?.();
      })();
      return closePromise;
    },
  };
}

export function procedureTutorialYoutubeImportHttpStatus(
  error: unknown,
): 400 | 404 | 409 | 413 | 422 | 429 | 500 | 502 | 503 {
  const code = safeImportError(error).code;
  switch (code) {
    case 'youtube_import_legacy_request_unsupported':
      return 422;
    case 'youtube_import_selection_not_found':
      return 404;
    case 'youtube_import_selection_mismatch':
      return 409;
    case 'youtube_authentication_required':
      return 503;
    case 'youtube_source_unauthorized':
      return 502;
    case 'youtube_source_quota_exceeded':
      return 429;
    case 'youtube_video_not_found':
    case 'youtube_caption_not_found':
      return 404;
    case 'youtube_import_conflict':
    case 'youtube_import_already_attempted':
      return 409;
    case 'youtube_caption_too_large':
      return 413;
    case 'youtube_caption_not_ready':
    case 'youtube_packet_invalid':
      return 422;
    case 'youtube_source_unavailable':
      return 503;
    case 'youtube_source_failed':
    case 'youtube_import_persistence_failed':
      return 500;
  }
}

export function procedureTutorialYoutubeImportErrorResponse(
  error: unknown,
  requestId: string | null,
): {
  readonly error: ProcedureTutorialYoutubeImportErrorCode;
  readonly requestId: string | null;
  readonly message: string;
  readonly retryMode: ProcedureTutorialYoutubeImportRetryMode;
} {
  const safeError = safeImportError(error);
  return {
    error: safeError.code,
    requestId,
    message: safeError.message,
    retryMode: safeError.retryMode,
  };
}

export function procedureTutorialYoutubeTrackListHttpStatus(
  error: unknown,
): 404 | 409 | 422 | 429 | 500 | 502 | 503 {
  const code = safeTrackListError(error).code;
  switch (code) {
    case 'youtube_authentication_required':
      return 503;
    case 'youtube_source_unauthorized':
      return 502;
    case 'youtube_source_quota_exceeded':
      return 429;
    case 'youtube_video_not_found':
      return 404;
    case 'youtube_track_list_conflict':
    case 'youtube_track_list_already_attempted':
      return 409;
    case 'youtube_track_list_invalid':
      return 422;
    case 'youtube_track_list_unavailable':
      return 503;
    case 'youtube_source_failed':
    case 'youtube_track_list_persistence_failed':
      return 500;
  }
}

export function procedureTutorialYoutubeTrackListErrorResponse(
  error: unknown,
  requestId: string | null,
): {
  readonly error: ProcedureTutorialYoutubeTrackListErrorCode;
  readonly requestId: string | null;
  readonly message: string;
  readonly retryMode: ProcedureTutorialYoutubeTrackListRetryMode;
} {
  const safeError = safeTrackListError(error);
  return {
    error: safeError.code,
    requestId,
    message: safeError.message,
    retryMode: safeError.retryMode,
  };
}
