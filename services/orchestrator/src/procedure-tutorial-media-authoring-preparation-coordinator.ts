import type {
  ProcedureTutorialMediaAuthoringPreparation,
  ProcedureTutorialMediaAuthoringPrepareRequest,
} from '@operatingline/protocol';

import { plannerProviderRequestFingerprint } from './planner-provider-invocation.js';

export type ProcedureTutorialMediaAuthoringPreparationCoordinatorErrorCode =
  'capacity_exceeded' | 'conflict' | 'shutting_down';

export class ProcedureTutorialMediaAuthoringPreparationCoordinatorError extends Error {
  constructor(readonly code: ProcedureTutorialMediaAuthoringPreparationCoordinatorErrorCode) {
    super(
      code === 'conflict'
        ? 'The tutorial media analysis request is already being prepared with different input.'
        : code === 'shutting_down'
          ? 'The tutorial media authoring preparation service is shutting down.'
          : 'The tutorial media authoring preparation service has reached its concurrent request limit.',
    );
    this.name = 'ProcedureTutorialMediaAuthoringPreparationCoordinatorError';
  }
}

export function procedureTutorialMediaAuthoringPreparationCoordinatorHttpStatus(
  error: ProcedureTutorialMediaAuthoringPreparationCoordinatorError,
): 409 | 429 | 503 {
  return error.code === 'conflict' ? 409 : error.code === 'shutting_down' ? 503 : 429;
}

export function procedureTutorialMediaAuthoringPreparationCoordinatorErrorResponse(
  error: ProcedureTutorialMediaAuthoringPreparationCoordinatorError,
  requestId: string | null,
): {
  readonly error: `procedure_tutorial_media_authoring_${ProcedureTutorialMediaAuthoringPreparationCoordinatorErrorCode}`;
  readonly requestId: string | null;
  readonly message: string;
} {
  return {
    error: `procedure_tutorial_media_authoring_${error.code}`,
    requestId,
    message: error.message,
  };
}

export interface ProcedureTutorialMediaAuthoringPreparationCoordinatorOptions {
  readonly maximumConcurrentPreparations?: number | undefined;
  readonly prepare: (
    request: ProcedureTutorialMediaAuthoringPrepareRequest,
  ) => Promise<ProcedureTutorialMediaAuthoringPreparation>;
}

export interface ProcedureTutorialMediaAuthoringPreparationCoordinator {
  beginClose(): void;
  close(): Promise<void>;
  prepare(
    request: ProcedureTutorialMediaAuthoringPrepareRequest,
  ): Promise<ProcedureTutorialMediaAuthoringPreparation>;
}

interface InFlightPreparation {
  readonly fingerprint: string;
  readonly promise: Promise<ProcedureTutorialMediaAuthoringPreparation>;
}

export function createProcedureTutorialMediaAuthoringPreparationCoordinator(
  options: ProcedureTutorialMediaAuthoringPreparationCoordinatorOptions,
): ProcedureTutorialMediaAuthoringPreparationCoordinator {
  const maximumConcurrentPreparations = options.maximumConcurrentPreparations ?? 1;
  if (!Number.isSafeInteger(maximumConcurrentPreparations) || maximumConcurrentPreparations <= 0) {
    throw new ProcedureTutorialMediaAuthoringPreparationCoordinatorError('capacity_exceeded');
  }
  const inFlight = new Map<string, InFlightPreparation>();
  let closing = false;
  let closePromise: Promise<void> | undefined;

  return {
    beginClose() {
      closing = true;
    },
    async close() {
      closing = true;
      closePromise ??= (async () => {
        while (inFlight.size > 0) {
          await Promise.allSettled([
            ...new Set([...inFlight.values()].map(({ promise }) => promise)),
          ]);
        }
      })();
      await closePromise;
    },
    prepare(request) {
      const fingerprint = plannerProviderRequestFingerprint(request);
      const running = inFlight.get(request.analysisRequestId);
      if (running !== undefined) {
        if (running.fingerprint !== fingerprint) {
          throw new ProcedureTutorialMediaAuthoringPreparationCoordinatorError('conflict');
        }
        return running.promise;
      }
      if (closing) {
        throw new ProcedureTutorialMediaAuthoringPreparationCoordinatorError('shutting_down');
      }
      if (inFlight.size >= maximumConcurrentPreparations) {
        throw new ProcedureTutorialMediaAuthoringPreparationCoordinatorError('capacity_exceeded');
      }

      const promise = Promise.resolve()
        .then(() => options.prepare(request))
        .finally(() => {
          if (inFlight.get(request.analysisRequestId)?.promise === promise) {
            inFlight.delete(request.analysisRequestId);
          }
        });
      inFlight.set(request.analysisRequestId, { fingerprint, promise });
      return promise;
    },
  };
}
