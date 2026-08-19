import { randomUUID } from 'node:crypto';

import type { ExecutionEventInput, StoredExecutionEvent } from '@operatingline/persistence';
import {
  procedureTutorialMediaAnalysisRequestSchema,
  procedureTutorialMediaAnalysisResultSchema,
  procedureTutorialMediaJobStatusSchema,
  procedureTutorialMediaResumeRequestSchema,
  type ProcedureTutorialMediaAnalysisRequest,
  type ProcedureTutorialMediaJobStatus,
  type ProcedureTutorialMediaResumeRequest,
  type ProcedureTutorialMediaStage,
} from '@operatingline/protocol';
import { z } from 'zod';

import { plannerProviderRequestFingerprint } from './planner-provider-invocation.js';
import {
  ProcedureTutorialMediaPipelineError,
  type ProcedureTutorialMediaPipeline,
} from './procedure-tutorial-media-pipeline.js';

const canonicalStages = [
  'download',
  'probe',
  'audio',
  'asr',
  'frames',
  'ocr',
  'segmentation',
] as const satisfies readonly ProcedureTutorialMediaStage[];

export const procedureTutorialMediaEvidenceEventTypes = [
  'procedure.tutorial.media.requested',
  'procedure.tutorial.media.stage',
  'procedure.tutorial.media.completed',
  'procedure.tutorial.media.recovery-required',
  'procedure.tutorial.media.failed',
  'procedure.tutorial.media.resumed',
] as const;

const fingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const requestedPayloadSchema = z.strictObject({
  acceptedAt: z.iso.datetime({ offset: true }),
  attemptId: z.uuid(),
  fingerprint: fingerprintSchema,
  jobId: z.uuid(),
  request: procedureTutorialMediaAnalysisRequestSchema,
});
const stagePayloadSchema = z.strictObject({
  attemptId: z.uuid(),
  completedStages: z.array(z.enum(canonicalStages)).max(canonicalStages.length),
  fingerprint: fingerprintSchema,
  jobId: z.uuid(),
  occurredAt: z.iso.datetime({ offset: true }),
  requestId: z.uuid(),
  stage: z.enum(canonicalStages),
  state: z.enum(['started', 'completed']),
});
const terminalPayloadSchema = z.strictObject({
  attemptId: z.uuid(),
  fingerprint: fingerprintSchema,
  status: procedureTutorialMediaJobStatusSchema,
});
const resumedPayloadSchema = z.strictObject({
  attemptId: z.uuid(),
  fingerprint: fingerprintSchema,
  occurredAt: z.iso.datetime({ offset: true }),
  request: procedureTutorialMediaResumeRequestSchema,
});

interface JobState {
  readonly request: ProcedureTutorialMediaAnalysisRequest;
  readonly fingerprint: string;
  readonly jobId: string;
  readonly acceptedAt: string;
  attemptId: string;
  status: ProcedureTutorialMediaJobStatus;
  completedStages: ProcedureTutorialMediaStage[];
  currentStage: ProcedureTutorialMediaStage;
  controller: AbortController | undefined;
  promise: Promise<void> | undefined;
  recoveryNeedsEvidence: boolean;
  lastStageEvent:
    | {
        readonly stage: ProcedureTutorialMediaStage;
        readonly state: 'started' | 'completed';
      }
    | undefined;
}

type JobErrorCode = Extract<
  ProcedureTutorialMediaJobStatus,
  { readonly status: 'failed' }
>['error']['code'];

export type ProcedureTutorialMediaCoordinatorErrorCode =
  | 'conflict'
  | 'not_found'
  | 'recovery_mismatch'
  | 'restoring'
  | 'closing'
  | 'capacity_exceeded'
  | 'unsupported_locale'
  | 'analysis_window_exceeded'
  | 'integrity_failed'
  | 'persistence_failed';

export class ProcedureTutorialMediaCoordinatorError extends Error {
  constructor(readonly code: ProcedureTutorialMediaCoordinatorErrorCode) {
    super(
      code === 'conflict'
        ? 'The tutorial media request id was reused with different input.'
        : code === 'not_found'
          ? 'The tutorial media job was not found.'
          : code === 'recovery_mismatch'
            ? 'The tutorial media recovery receipt does not match the current job state.'
            : code === 'restoring'
              ? 'Restored tutorial media completion evidence is still being verified.'
              : code === 'closing'
                ? 'The tutorial media service is stopping.'
                : code === 'capacity_exceeded'
                  ? 'The tutorial media service has reached its concurrent job limit.'
                  : code === 'unsupported_locale'
                    ? 'The tutorial media analysis locale is unsupported.'
                    : code === 'analysis_window_exceeded'
                      ? 'The tutorial media analysis window exceeds the configured limit.'
                      : code === 'integrity_failed'
                        ? 'Restored tutorial media completion evidence failed integrity verification.'
                        : 'Tutorial media job evidence could not be persisted.',
    );
    this.name = 'ProcedureTutorialMediaCoordinatorError';
  }
}

function safeCoordinatorError(error: unknown): ProcedureTutorialMediaCoordinatorError {
  return error instanceof ProcedureTutorialMediaCoordinatorError
    ? error
    : new ProcedureTutorialMediaCoordinatorError('persistence_failed');
}

export function procedureTutorialMediaCoordinatorHttpStatus(
  error: unknown,
): 404 | 409 | 422 | 429 | 500 | 503 {
  switch (safeCoordinatorError(error).code) {
    case 'not_found':
      return 404;
    case 'conflict':
    case 'recovery_mismatch':
      return 409;
    case 'unsupported_locale':
    case 'analysis_window_exceeded':
      return 422;
    case 'capacity_exceeded':
      return 429;
    case 'restoring':
    case 'closing':
      return 503;
    case 'integrity_failed':
    case 'persistence_failed':
      return 500;
  }
}

export function procedureTutorialMediaCoordinatorErrorResponse(
  error: unknown,
  requestId: string | null,
): {
  readonly error: `procedure_tutorial_media_${ProcedureTutorialMediaCoordinatorErrorCode}`;
  readonly requestId: string | null;
  readonly message: string;
} {
  const safeError = safeCoordinatorError(error);
  return {
    error: `procedure_tutorial_media_${safeError.code}`,
    requestId,
    message: safeError.message,
  };
}

export interface ProcedureTutorialMediaCoordinatorOptions {
  readonly pipeline: ProcedureTutorialMediaPipeline;
  readonly existingEvents: readonly StoredExecutionEvent[];
  readonly appendEvent: (event: ExecutionEventInput) => void;
  readonly maximumConcurrentJobs?: number | undefined;
  readonly maximumAnalysisWindowMs?: number | undefined;
  readonly supportedLocales?: readonly string[] | undefined;
  readonly now?: (() => Date) | undefined;
}

export interface ProcedureTutorialMediaCoordinator {
  ready(): Promise<void>;
  create(request: ProcedureTutorialMediaAnalysisRequest): ProcedureTutorialMediaJobStatus;
  status(requestId: string, jobId: string): ProcedureTutorialMediaJobStatus;
  resume(request: ProcedureTutorialMediaResumeRequest): ProcedureTutorialMediaJobStatus;
  beginClose(): void;
  close(): Promise<void>;
}

function sameStages(
  left: readonly ProcedureTutorialMediaStage[],
  right: readonly ProcedureTutorialMediaStage[],
): boolean {
  return left.length === right.length && left.every((stage, index) => stage === right[index]);
}

function terminalStatus(status: ProcedureTutorialMediaJobStatus): boolean {
  return (
    status.status === 'completed' ||
    status.status === 'failed' ||
    status.status === 'recovery_required'
  );
}

function safeError(
  error: unknown,
  stage: ProcedureTutorialMediaStage,
): {
  readonly code: JobErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly stage: ProcedureTutorialMediaStage;
} {
  const pipelineError =
    error instanceof ProcedureTutorialMediaPipelineError
      ? error
      : new ProcedureTutorialMediaPipelineError('pipeline_failed', stage);
  if (pipelineError.code === 'unsupported_media') {
    return {
      code: 'unsupported_media',
      message: 'The tutorial media source is unsupported.',
      retryable: false,
      stage,
    };
  }
  if (pipelineError.code === 'unsupported_locale') {
    return {
      code: 'unsupported_locale',
      message: 'The tutorial media analysis locale is unsupported.',
      retryable: false,
      stage,
    };
  }
  if (pipelineError.code === 'deadline_exceeded') {
    return {
      code: 'deadline_exceeded',
      message: 'Tutorial media analysis exceeded its execution deadline.',
      retryable: false,
      stage,
    };
  }
  if (
    pipelineError.code === 'authorization_required' ||
    pipelineError.code === 'authorization_expired'
  ) {
    return {
      code: pipelineError.code,
      message:
        pipelineError.code === 'authorization_expired'
          ? 'Tutorial media download authorization has expired.'
          : 'Tutorial media download authorization is required.',
      retryable: false,
      stage,
    };
  }
  if (pipelineError.code === 'integrity_failed') {
    return {
      code: 'integrity_failed',
      message: 'Tutorial media artifact integrity verification failed.',
      retryable: false,
      stage,
    };
  }
  if (pipelineError.code === 'quota_exceeded') {
    return {
      code: 'quota_exceeded',
      message: 'Tutorial media analysis exceeded a configured resource limit.',
      retryable: false,
      stage,
    };
  }
  if (pipelineError.code === 'invalid_input') {
    return {
      code: 'internal_error',
      message: 'Tutorial media analysis rejected an invalid internal input.',
      retryable: false,
      stage,
    };
  }
  const code =
    pipelineError.code === 'cancelled'
      ? 'cancelled'
      : stage === 'download'
        ? 'source_unavailable'
        : stage === 'probe'
          ? 'probe_failed'
          : stage === 'audio'
            ? 'audio_failed'
            : stage === 'asr'
              ? 'asr_failed'
              : stage === 'frames'
                ? 'frame_extraction_failed'
                : stage === 'ocr'
                  ? 'ocr_failed'
                  : 'segmentation_failed';
  return {
    code,
    message:
      pipelineError.code === 'cancelled'
        ? 'Tutorial media analysis was interrupted and requires an explicit recovery receipt.'
        : 'Tutorial media analysis failed and requires an explicit recovery receipt.',
    retryable: true,
    stage,
  };
}

function restoreJobs(
  events: readonly StoredExecutionEvent[],
  now: () => string,
): Map<string, JobState> {
  const jobs = new Map<string, JobState>();
  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    if (!procedureTutorialMediaEvidenceEventTypes.includes(event.eventType as never)) continue;
    if (event.eventType === 'procedure.tutorial.media.requested') {
      const payload = requestedPayloadSchema.parse(event.payload);
      if (
        jobs.has(payload.request.requestId) ||
        payload.fingerprint !== plannerProviderRequestFingerprint(payload.request)
      ) {
        throw new ProcedureTutorialMediaCoordinatorError('persistence_failed');
      }
      const accepted = procedureTutorialMediaJobStatusSchema.parse({
        acceptedAt: payload.acceptedAt,
        formatVersion: payload.request.formatVersion,
        jobId: payload.jobId,
        requestId: payload.request.requestId,
        status: 'accepted',
        updatedAt: payload.acceptedAt,
      });
      jobs.set(payload.request.requestId, {
        acceptedAt: payload.acceptedAt,
        attemptId: payload.attemptId,
        completedStages: [],
        currentStage: 'download',
        fingerprint: payload.fingerprint,
        jobId: payload.jobId,
        request: payload.request,
        status: accepted,
        controller: undefined,
        promise: undefined,
        recoveryNeedsEvidence: false,
        lastStageEvent: undefined,
      });
      continue;
    }
    if (event.eventType === 'procedure.tutorial.media.stage') {
      const payload = stagePayloadSchema.parse(event.payload);
      const job = jobs.get(payload.requestId);
      if (
        job === undefined ||
        job.jobId !== payload.jobId ||
        job.fingerprint !== payload.fingerprint ||
        job.attemptId !== payload.attemptId ||
        terminalStatus(job.status)
      )
        throw new ProcedureTutorialMediaCoordinatorError('persistence_failed');
      const expectedStage = canonicalStages[job.completedStages.length];
      if (payload.state === 'started') {
        if (
          expectedStage !== payload.stage ||
          !sameStages(payload.completedStages, job.completedStages) ||
          job.lastStageEvent?.state === 'started'
        ) {
          throw new ProcedureTutorialMediaCoordinatorError('persistence_failed');
        }
        job.currentStage = payload.stage;
        job.status = procedureTutorialMediaJobStatusSchema.parse({
          completedStages: job.completedStages,
          currentStage: payload.stage,
          formatVersion: job.request.formatVersion,
          jobId: job.jobId,
          progress: job.completedStages.length / canonicalStages.length,
          requestId: job.request.requestId,
          startedAt: job.acceptedAt,
          status: 'running',
          updatedAt: payload.occurredAt,
        });
      } else {
        const expectedCompletedStages = [...job.completedStages, payload.stage];
        if (
          expectedStage !== payload.stage ||
          job.lastStageEvent?.state !== 'started' ||
          job.lastStageEvent.stage !== payload.stage ||
          !sameStages(payload.completedStages, expectedCompletedStages)
        ) {
          throw new ProcedureTutorialMediaCoordinatorError('persistence_failed');
        }
        job.completedStages = expectedCompletedStages;
      }
      job.lastStageEvent = { stage: payload.stage, state: payload.state };
      continue;
    }
    if (
      event.eventType === 'procedure.tutorial.media.completed' ||
      event.eventType === 'procedure.tutorial.media.recovery-required' ||
      event.eventType === 'procedure.tutorial.media.failed'
    ) {
      const payload = terminalPayloadSchema.parse(event.payload);
      const job = jobs.get(payload.status.requestId);
      const expectedStatus =
        event.eventType === 'procedure.tutorial.media.completed'
          ? 'completed'
          : event.eventType === 'procedure.tutorial.media.recovery-required'
            ? 'recovery_required'
            : 'failed';
      if (
        job === undefined ||
        job.jobId !== payload.status.jobId ||
        job.fingerprint !== payload.fingerprint ||
        job.attemptId !== payload.attemptId ||
        terminalStatus(job.status) ||
        payload.status.status !== expectedStatus ||
        (payload.status.status === 'completed' &&
          (!sameStages(job.completedStages, canonicalStages) ||
            job.lastStageEvent?.stage !== 'segmentation' ||
            job.lastStageEvent.state !== 'completed')) ||
        (payload.status.status === 'failed' &&
          !sameStages(payload.status.completedStages, job.completedStages))
      )
        throw new ProcedureTutorialMediaCoordinatorError('persistence_failed');
      job.status = payload.status;
      job.recoveryNeedsEvidence = false;
      if ('completedStages' in payload.status)
        job.completedStages = [...payload.status.completedStages];
      continue;
    }
    const resumed = resumedPayloadSchema.parse(event.payload);
    const job = jobs.get(resumed.request.requestId);
    if (
      job === undefined ||
      job.jobId !== resumed.request.jobId ||
      job.fingerprint !== resumed.fingerprint ||
      job.status.status !== 'recovery_required' ||
      job.status.recoveryId !== resumed.request.recoveryId ||
      job.status.retryFromStage !== resumed.request.retryFromStage ||
      job.attemptId === resumed.attemptId ||
      Date.parse(resumed.occurredAt) < Date.parse(job.status.updatedAt)
    )
      throw new ProcedureTutorialMediaCoordinatorError('persistence_failed');
    job.attemptId = resumed.attemptId;
    job.completedStages = [];
    job.currentStage = 'download';
    job.status = procedureTutorialMediaJobStatusSchema.parse({
      acceptedAt: job.acceptedAt,
      formatVersion: job.request.formatVersion,
      jobId: job.jobId,
      requestId: job.request.requestId,
      status: 'accepted',
      updatedAt: resumed.occurredAt,
    });
    job.recoveryNeedsEvidence = false;
    job.lastStageEvent = undefined;
  }
  for (const job of jobs.values()) {
    if (job.status.status === 'accepted' || job.status.status === 'running') {
      const occurredAt = now();
      const stage = 'download';
      job.completedStages = [];
      job.status = procedureTutorialMediaJobStatusSchema.parse({
        completedStages: job.completedStages,
        error: {
          code: 'cancelled',
          message:
            'Tutorial media analysis was interrupted and requires an explicit recovery receipt.',
          retryable: true,
          stage,
        },
        formatVersion: job.request.formatVersion,
        jobId: job.jobId,
        recoveryId: randomUUID(),
        requestId: job.request.requestId,
        retryFromStage: stage,
        status: 'recovery_required',
        updatedAt: occurredAt,
      });
      job.recoveryNeedsEvidence = true;
      job.lastStageEvent = undefined;
    }
  }
  return jobs;
}

export function createProcedureTutorialMediaCoordinator(
  options: ProcedureTutorialMediaCoordinatorOptions,
): ProcedureTutorialMediaCoordinator {
  const now = () => (options.now ?? (() => new Date()))().toISOString();
  const maximumConcurrentJobs = options.maximumConcurrentJobs ?? 1;
  const maximumAnalysisWindowMs = options.maximumAnalysisWindowMs ?? 4 * 60 * 60 * 1_000;
  const supportedLocales = (options.supportedLocales ?? ['en']).map((locale) =>
    locale.toLowerCase(),
  );
  if (
    !Number.isSafeInteger(maximumConcurrentJobs) ||
    maximumConcurrentJobs <= 0 ||
    !Number.isSafeInteger(maximumAnalysisWindowMs) ||
    maximumAnalysisWindowMs <= 0 ||
    supportedLocales.length === 0 ||
    new Set(supportedLocales).size !== supportedLocales.length
  ) {
    throw new ProcedureTutorialMediaCoordinatorError('capacity_exceeded');
  }
  const jobs = restoreJobs(options.existingEvents, now);
  let closing = false;
  const restoredCompletedResults = [...jobs.values()].flatMap((job) =>
    job.status.status === 'completed' ? [job.status.result] : [],
  );
  let readiness: 'pending' | 'ready' | 'failed' =
    restoredCompletedResults.length === 0 ? 'ready' : 'pending';
  let readinessPromise: Promise<void> | undefined;

  function requireReady(): void {
    if (readiness === 'failed') {
      throw new ProcedureTutorialMediaCoordinatorError('integrity_failed');
    }
    if (readiness !== 'ready') throw new ProcedureTutorialMediaCoordinatorError('restoring');
  }

  function append(event: ExecutionEventInput): void {
    try {
      options.appendEvent(event);
    } catch {
      throw new ProcedureTutorialMediaCoordinatorError('persistence_failed');
    }
  }

  function publishTerminal(job: JobState, status: ProcedureTutorialMediaJobStatus): void {
    const suffix =
      status.status === 'completed'
        ? 'completed'
        : status.status === 'recovery_required'
          ? 'recovery-required'
          : 'failed';
    job.status = status;
    try {
      append({
        eventType: `procedure.tutorial.media.${suffix}`,
        id: `procedure-tutorial-media-${suffix}:${job.jobId}:${job.attemptId}`,
        payload: { attemptId: job.attemptId, fingerprint: job.fingerprint, status },
      });
      job.recoveryNeedsEvidence = false;
    } catch {
      const failedAt = now();
      job.completedStages = [];
      job.status = procedureTutorialMediaJobStatusSchema.parse({
        completedStages: job.completedStages,
        error: {
          code: 'internal_error',
          message: 'Tutorial media terminal evidence could not be persisted.',
          retryable: false,
          stage: null,
        },
        failedAt,
        formatVersion: job.request.formatVersion,
        jobId: job.jobId,
        requestId: job.request.requestId,
        status: 'failed',
        updatedAt: failedAt,
      });
      job.recoveryNeedsEvidence = false;
    }
  }

  function run(job: JobState): void {
    const controller = new AbortController();
    job.controller = controller;
    job.promise = Promise.resolve()
      .then(async () => {
        const result = await options.pipeline.analyze(job.request, job.jobId, {
          signal: controller.signal,
          onStage(update) {
            const occurredAt = now();
            if (update.state === 'started') {
              job.currentStage = update.stage;
              job.status = procedureTutorialMediaJobStatusSchema.parse({
                completedStages: job.completedStages,
                currentStage: update.stage,
                formatVersion: job.request.formatVersion,
                jobId: job.jobId,
                progress: job.completedStages.length / canonicalStages.length,
                requestId: job.request.requestId,
                startedAt: job.acceptedAt,
                status: 'running',
                updatedAt: occurredAt,
              });
            } else if (!job.completedStages.includes(update.stage)) {
              job.completedStages.push(update.stage);
            }
            append({
              eventType: 'procedure.tutorial.media.stage',
              id: `procedure-tutorial-media-stage:${job.jobId}:${job.attemptId}:${update.stage}:${update.state}`,
              payload: {
                attemptId: job.attemptId,
                completedStages: [...job.completedStages],
                fingerprint: job.fingerprint,
                jobId: job.jobId,
                occurredAt,
                requestId: job.request.requestId,
                stage: update.stage,
                state: update.state,
              },
            });
          },
        });
        const occurredAt = now();
        publishTerminal(
          job,
          procedureTutorialMediaJobStatusSchema.parse({
            formatVersion: job.request.formatVersion,
            jobId: job.jobId,
            requestId: job.request.requestId,
            result: procedureTutorialMediaAnalysisResultSchema.parse(result),
            status: 'completed',
            updatedAt: occurredAt,
          }),
        );
      })
      .catch((error: unknown) => {
        const occurredAt = now();
        const failure = safeError(error, job.currentStage);
        if (failure.retryable) {
          job.completedStages = [];
          publishTerminal(
            job,
            procedureTutorialMediaJobStatusSchema.parse({
              completedStages: job.completedStages,
              error: failure,
              formatVersion: job.request.formatVersion,
              jobId: job.jobId,
              recoveryId: randomUUID(),
              requestId: job.request.requestId,
              retryFromStage: 'download',
              status: 'recovery_required',
              updatedAt: occurredAt,
            }),
          );
        } else {
          publishTerminal(
            job,
            procedureTutorialMediaJobStatusSchema.parse({
              completedStages: job.completedStages,
              error: failure,
              failedAt: occurredAt,
              formatVersion: job.request.formatVersion,
              jobId: job.jobId,
              requestId: job.request.requestId,
              status: 'failed',
              updatedAt: occurredAt,
            }),
          );
        }
      })
      .finally(() => {
        job.controller = undefined;
        job.promise = undefined;
      });
  }

  for (const job of jobs.values()) {
    if (job.recoveryNeedsEvidence) publishTerminal(job, job.status);
  }

  return {
    async ready() {
      if (readiness === 'ready') return;
      if (readiness === 'failed') {
        throw new ProcedureTutorialMediaCoordinatorError('integrity_failed');
      }
      readinessPromise ??= (async () => {
        for (const result of restoredCompletedResults) await options.pipeline.verify(result);
      })()
        .then(() => {
          readiness = 'ready';
        })
        .catch(() => {
          readiness = 'failed';
          throw new ProcedureTutorialMediaCoordinatorError('integrity_failed');
        });
      await readinessPromise;
    },
    create(requestInput) {
      requireReady();
      const request = procedureTutorialMediaAnalysisRequestSchema.parse(requestInput);
      if (request.analysisWindow.endMs - request.analysisWindow.startMs > maximumAnalysisWindowMs) {
        throw new ProcedureTutorialMediaCoordinatorError('analysis_window_exceeded');
      }
      const locale = request.locale.toLowerCase();
      if (!supportedLocales.includes(locale) && !supportedLocales.includes(locale.split('-')[0]!)) {
        throw new ProcedureTutorialMediaCoordinatorError('unsupported_locale');
      }
      const fingerprint = plannerProviderRequestFingerprint(request);
      const prior = jobs.get(request.requestId);
      if (prior !== undefined) {
        if (prior.fingerprint !== fingerprint)
          throw new ProcedureTutorialMediaCoordinatorError('conflict');
        return structuredClone(prior.status);
      }
      if (closing) throw new ProcedureTutorialMediaCoordinatorError('closing');
      const activeJobs = [...jobs.values()].filter((job) => job.promise !== undefined).length;
      if (activeJobs >= maximumConcurrentJobs)
        throw new ProcedureTutorialMediaCoordinatorError('capacity_exceeded');
      let jobId = randomUUID();
      while (jobId === request.requestId) jobId = randomUUID();
      const acceptedAt = now();
      const status = procedureTutorialMediaJobStatusSchema.parse({
        acceptedAt,
        formatVersion: request.formatVersion,
        jobId,
        requestId: request.requestId,
        status: 'accepted',
        updatedAt: acceptedAt,
      });
      const job: JobState = {
        acceptedAt,
        attemptId: randomUUID(),
        completedStages: [],
        currentStage: 'download',
        fingerprint,
        jobId,
        request,
        status,
        controller: undefined,
        promise: undefined,
        recoveryNeedsEvidence: false,
        lastStageEvent: undefined,
      };
      append({
        eventType: 'procedure.tutorial.media.requested',
        id: `procedure-tutorial-media-requested:${jobId}`,
        payload: { acceptedAt, attemptId: job.attemptId, fingerprint, jobId, request },
      });
      jobs.set(request.requestId, job);
      run(job);
      return structuredClone(status);
    },
    status(requestId, jobId) {
      requireReady();
      const job = jobs.get(requestId);
      if (job === undefined || job.jobId !== jobId)
        throw new ProcedureTutorialMediaCoordinatorError('not_found');
      return structuredClone(job.status);
    },
    resume(requestInput) {
      requireReady();
      const request = procedureTutorialMediaResumeRequestSchema.parse(requestInput);
      const job = jobs.get(request.requestId);
      if (job === undefined || job.jobId !== request.jobId)
        throw new ProcedureTutorialMediaCoordinatorError('not_found');
      if (
        job.status.status !== 'recovery_required' ||
        job.status.recoveryId !== request.recoveryId ||
        job.status.retryFromStage !== request.retryFromStage
      ) {
        throw new ProcedureTutorialMediaCoordinatorError('recovery_mismatch');
      }
      if (closing) throw new ProcedureTutorialMediaCoordinatorError('closing');
      const activeJobs = [...jobs.values()].filter((candidate) => candidate.promise !== undefined);
      if (activeJobs.length >= maximumConcurrentJobs)
        throw new ProcedureTutorialMediaCoordinatorError('capacity_exceeded');
      const attemptId = randomUUID();
      append({
        eventType: 'procedure.tutorial.media.resumed',
        id: `procedure-tutorial-media-resumed:${job.jobId}:${attemptId}`,
        payload: { attemptId, fingerprint: job.fingerprint, occurredAt: now(), request },
      });
      job.attemptId = attemptId;
      job.completedStages = [];
      job.currentStage = 'download';
      job.status = procedureTutorialMediaJobStatusSchema.parse({
        acceptedAt: job.acceptedAt,
        formatVersion: job.request.formatVersion,
        jobId: job.jobId,
        requestId: job.request.requestId,
        status: 'accepted',
        updatedAt: now(),
      });
      job.lastStageEvent = undefined;
      run(job);
      return structuredClone(job.status);
    },
    beginClose() {
      closing = true;
      for (const job of jobs.values()) job.controller?.abort();
    },
    async close() {
      closing = true;
      for (const job of jobs.values()) job.controller?.abort();
      await Promise.all([...jobs.values()].flatMap((job) => job.promise ?? []));
      await options.pipeline.close();
    },
  };
}
