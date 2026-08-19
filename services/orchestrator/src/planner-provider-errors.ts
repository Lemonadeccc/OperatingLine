import {
  type PlannerGenerationError,
  type PlannerGenerationErrorCode,
  type PlannerGenerationRetryMode,
} from '@operatingline/protocol';

export class PlannerGenerationRuntimeError extends Error {
  readonly code: PlannerGenerationErrorCode;
  readonly retryMode: PlannerGenerationRetryMode;

  constructor(
    code: PlannerGenerationErrorCode,
    message: string,
    retryMode: PlannerGenerationRetryMode = 'never',
  ) {
    super(message);
    this.name = 'PlannerGenerationRuntimeError';
    this.code = code;
    this.retryMode = retryMode;
  }
}

export function safePlannerRuntimeError(error: unknown): PlannerGenerationRuntimeError {
  return error instanceof PlannerGenerationRuntimeError
    ? error
    : new PlannerGenerationRuntimeError(
        'planner_internal_failed',
        'Planner generation failed inside the core runtime',
        'new_request_id',
      );
}

export function plannerGenerationErrorResponse(
  error: unknown,
  requestId: string | null,
): PlannerGenerationError {
  const safeError = safePlannerRuntimeError(error);
  return {
    error: safeError.code,
    requestId,
    message: safeError.message,
    retryMode: safeError.retryMode,
  };
}

export function plannerGenerationHttpStatus(error: unknown): number {
  const code = safePlannerRuntimeError(error).code;
  switch (code) {
    case 'planner_invalid_request':
      return 400;
    case 'planner_provider_not_found':
    case 'planner_revision_request_not_found':
      return 404;
    case 'planner_generation_conflict':
    case 'planner_generation_already_attempted':
    case 'planner_revision_request_not_pending':
    case 'planner_revision_thread_stale':
    case 'planner_replan_generation_stale':
      return 409;
    case 'planner_generation_busy':
      return 429;
    case 'planner_provider_unavailable':
    case 'planner_runtime_stopping':
      return 503;
    case 'planner_generation_timeout':
      return 504;
    case 'planner_provider_failed':
      return 502;
    case 'planner_output_invalid':
    case 'planner_identity_mismatch':
    case 'planner_catalog_invalid':
    case 'planner_dialogue_not_supported':
    case 'planner_procedure_embedding_not_supported':
    case 'planner_procedure_authoring_not_supported':
    case 'planner_replan_not_supported':
    case 'planner_replan_submission_invalid':
      return 422;
    case 'planner_persistence_failed':
    case 'planner_internal_failed':
      return 500;
  }
}
