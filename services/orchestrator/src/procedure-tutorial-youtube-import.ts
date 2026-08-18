import type { ExecutionEventInput, StoredExecutionEvent } from '@operatingline/persistence';
import {
  procedureAuthoringPromptPacketSchema,
  procedureTutorialYoutubeImportCompletedEventSchema,
  procedureTutorialYoutubeImportFailedEventSchema,
  procedureTutorialYoutubeImportRequestSchema,
  procedureTutorialYoutubeImportRequestedEventSchema,
  type ActionCatalog,
  type InteractionCatalog,
  type ProcedureAuthoringPromptPacket,
  type ProcedureTutorialYoutubeImportErrorCode,
  type ProcedureTutorialYoutubeImportRequest,
} from '@operatingline/protocol';

import { plannerProviderRequestFingerprint } from './planner-provider-invocation.js';
import { buildProcedureAuthoringPromptPacket } from './procedure-authoring-prompt.js';
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

export type ProcedureTutorialYoutubeImportRetryMode =
  'same_request_id' | 'new_request_id' | 'never';

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

interface ImportIdentity {
  readonly fingerprint: string;
}

interface CompletedImport extends ImportIdentity {
  readonly packet: ProcedureAuthoringPromptPacket;
}

export interface ProcedureTutorialYoutubeImportCoordinatorOptions {
  readonly source?: ProcedureTutorialYoutubeCaptionSource;
  readonly existingEvents: readonly StoredExecutionEvent[];
  readonly buildPacket: (
    request: ProcedureTutorialYoutubeImportRequest,
    acquisition: ProcedureTutorialYoutubeCaptionAcquisitionResult,
  ) => ProcedureAuthoringPromptPacket;
  readonly appendEvent: (event: ExecutionEventInput) => void;
}

export interface ProcedureTutorialYoutubeImportCoordinator {
  importCaption(
    request: ProcedureTutorialYoutubeImportRequest,
  ): Promise<ProcedureAuthoringPromptPacket>;
  completedPacket(requestId: string): ProcedureAuthoringPromptPacket | null;
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

export function buildProcedureTutorialYoutubePromptPacket(
  requestInput: ProcedureTutorialYoutubeImportRequest,
  acquisition: ProcedureTutorialYoutubeCaptionAcquisitionResult,
  actionCatalog: ActionCatalog,
  interactionCatalog: InteractionCatalog,
): ProcedureAuthoringPromptPacket {
  const request = procedureTutorialYoutubeImportRequestSchema.parse(requestInput);
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
      acquisition: acquisition.captionDocument.acquisition,
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
      record(payload.request.requestId, identity);
      completed.set(payload.request.requestId, { ...identity, packet: payload.packet });
    }
  }
  return { attempted, completed };
}

export function createProcedureTutorialYoutubeImportCoordinator(
  options: ProcedureTutorialYoutubeImportCoordinatorOptions,
): ProcedureTutorialYoutubeImportCoordinator {
  const restored = restoreProcedureTutorialYoutubeImports(options.existingEvents);
  const attempted = new Map(restored.attempted);
  const completed = new Map(restored.completed);
  const inFlight = new Map<
    string,
    ImportIdentity & { readonly promise: Promise<ProcedureAuthoringPromptPacket> }
  >();
  let closing = false;
  let closePromise: Promise<void> | undefined;

  const beginClose = () => {
    closing = true;
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

  return {
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

      const requestedPayload = procedureTutorialYoutubeImportRequestedEventSchema.parse({
        requestId: request.requestId,
        requestFingerprint: identity.fingerprint,
        videoId: request.youtube.videoId,
        captionTrackId: request.youtube.captionTrackId,
        requestedFormat: request.youtube.requestedFormat,
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
              options.buildPacket(request, acquisition),
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
    beginClose,
    close: () => {
      beginClose();
      closePromise ??= (async () => {
        await Promise.allSettled([...inFlight.values()].map(({ promise }) => promise));
        await options.source?.close?.();
      })();
      return closePromise;
    },
  };
}

export function procedureTutorialYoutubeImportHttpStatus(
  error: unknown,
): 400 | 404 | 409 | 413 | 422 | 500 | 502 | 503 {
  const code = safeImportError(error).code;
  switch (code) {
    case 'youtube_source_unauthorized':
      return 502;
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
