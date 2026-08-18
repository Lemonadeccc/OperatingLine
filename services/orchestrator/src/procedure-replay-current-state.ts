import {
  companionProcedureReplayCurrentStateRequestSchema,
  procedureLeafReplayAttestationSchema,
  procedureLeafReplayFailureRecoveryAttestationSchema,
  procedureLeafReplayCurrentStateRequestResultSchema,
  procedureLeafReplayCurrentStateStatusResultSchema,
  procedureLeafReplayCurrentStateVerificationSchema,
  type CompanionProcedureReplayCurrentStateRequest,
  type CompanionStateReport,
  type ProcedureLeafReplayCurrentStateRequest,
  type ProcedureLeafReplayCurrentStateRequestResult,
  type ProcedureLeafReplayCurrentStateStatusResult,
  type ProcedureLeafReplayCurrentStateVerification,
  type ProcedureLeafReplayAttestation,
  type ProcedureLeafReplayFailureRecoveryAttestation,
} from '@operatingline/protocol';
import type { OperatingLineDatabase, StoredManagedReplayReceipt } from '@operatingline/persistence';

import {
  buildProcedureLeafReplayCurrentStateRequest,
  buildProcedureLeafReplayCurrentStateVerification,
  ProcedureLeafReplayError,
  sameProcedureLeafReplayValue,
} from './procedure-replay.js';

const requestEventType = 'procedure.leaf-replay.current-state.requested';
const verificationEventType = 'procedure.leaf-replay.current-state.completed';
const maxPendingRequests = 64;

export const procedureLeafReplayCurrentStateEvidenceEventTypes = [
  requestEventType,
  verificationEventType,
] as const;

function requestEventId(verificationId: string): string {
  return `procedure-leaf-replay-current-state:${verificationId}:requested`;
}

function verificationEventId(verificationId: string): string {
  return `procedure-leaf-replay-current-state:${verificationId}:completed`;
}

type CurrentStateReplayAttestation =
  ProcedureLeafReplayAttestation | ProcedureLeafReplayFailureRecoveryAttestation;

function parseCurrentStateReplayAttestation(payload: unknown): CurrentStateReplayAttestation {
  const directSuccess = procedureLeafReplayAttestationSchema.safeParse(payload);
  if (directSuccess.success) return directSuccess.data;
  const failureRecovery = procedureLeafReplayFailureRecoveryAttestationSchema.safeParse(payload);
  if (!failureRecovery.success) {
    throw new ProcedureLeafReplayError('Stored replay attestation is invalid', 409);
  }
  if (
    failureRecovery.data.outcome !== 'recovered_after_repair' ||
    failureRecovery.data.recoveryReport === null
  ) {
    throw new ProcedureLeafReplayError(
      'Current-state verification requires a retained successful or recovered replay state',
      409,
    );
  }
  return failureRecovery.data;
}

export interface ProcedureLeafReplayCurrentStateCoordinator {
  request(
    input: ProcedureLeafReplayCurrentStateRequest,
  ): ProcedureLeafReplayCurrentStateRequestResult;
  get(verificationId: string): ProcedureLeafReplayCurrentStateStatusResult | null;
  pendingFor(
    adapterId: string,
    instanceId: string,
  ): CompanionProcedureReplayCurrentStateRequest | null;
  authorizeReport(report: CompanionStateReport): void;
  complete(
    report: CompanionStateReport,
    receipt: StoredManagedReplayReceipt,
  ): ProcedureLeafReplayCurrentStateVerification;
}

export function createProcedureLeafReplayCurrentStateCoordinator(
  database: OperatingLineDatabase,
  now: () => string = () => new Date().toISOString(),
): ProcedureLeafReplayCurrentStateCoordinator {
  const pending = new Map<string, CompanionProcedureReplayCurrentStateRequest>();
  const completed = new Map<string, ProcedureLeafReplayCurrentStateVerification>();
  for (const event of database.listExecutionEventsByTypes(
    procedureLeafReplayCurrentStateEvidenceEventTypes,
  )) {
    if (event.eventType === requestEventType) {
      const request = companionProcedureReplayCurrentStateRequestSchema.parse(event.payload);
      pending.set(request.verificationId, request);
    } else {
      const verification = procedureLeafReplayCurrentStateVerificationSchema.parse(event.payload);
      pending.delete(verification.verificationId);
      completed.set(verification.verificationId, verification);
    }
  }

  const get = (verificationId: string): ProcedureLeafReplayCurrentStateStatusResult | null => {
    const verification = completed.get(verificationId);
    if (verification !== undefined) {
      return procedureLeafReplayCurrentStateStatusResultSchema.parse({
        status: 'completed',
        verification,
      });
    }
    const request = pending.get(verificationId);
    return request === undefined
      ? null
      : procedureLeafReplayCurrentStateStatusResultSchema.parse({
          status: 'pending',
          request,
        });
  };

  return {
    request(input) {
      const existing = get(input.verificationId);
      if (existing !== null) {
        const existingRequest =
          existing.status === 'pending' ? existing.request : existing.verification.request;
        if (existingRequest.replayId !== input.replayId) {
          throw new ProcedureLeafReplayError(
            `Verification ${input.verificationId} already belongs to a different replay`,
            409,
          );
        }
        return procedureLeafReplayCurrentStateRequestResultSchema.parse({
          status: 'duplicate',
          request: existingRequest,
        });
      }
      if (pending.size >= maxPendingRequests) {
        throw new ProcedureLeafReplayError('Too many current-state checks are pending', 409);
      }
      if ([...pending.values()].some((request) => request.replayId === input.replayId)) {
        throw new ProcedureLeafReplayError(
          `Replay ${input.replayId} already has a pending current-state check`,
          409,
        );
      }
      const attestationPayload = database.getProcedureLeafReplayAttestation(input.replayId);
      if (attestationPayload === null) {
        throw new ProcedureLeafReplayError(
          `Replay ${input.replayId} has no finalized attestation`,
          404,
        );
      }
      const attestation = parseCurrentStateReplayAttestation(attestationPayload);
      const request = companionProcedureReplayCurrentStateRequestSchema.parse(
        buildProcedureLeafReplayCurrentStateRequest({
          attestation,
          verificationId: input.verificationId,
          requestedAt: now(),
        }),
      );
      database.appendEvent({
        id: requestEventId(request.verificationId),
        eventType: requestEventType,
        payload: request,
        createdAt: request.requestedAt,
      });
      pending.set(request.verificationId, request);
      return procedureLeafReplayCurrentStateRequestResultSchema.parse({
        status: 'accepted',
        request,
      });
    },
    get,
    pendingFor(adapterId, instanceId) {
      return (
        [...pending.values()]
          .filter(
            (request) =>
              request.target.adapterId === adapterId && request.target.instanceId === instanceId,
          )
          .sort(
            (left, right) =>
              left.requestedAt.localeCompare(right.requestedAt) ||
              left.verificationId.localeCompare(right.verificationId),
          )[0] ?? null
      );
    },
    authorizeReport(report) {
      const echoed = report.procedureReplayCurrentStateRequest;
      if (report.transition !== 'current_state_rechecked' || echoed === undefined) {
        throw new ProcedureLeafReplayError(
          'Current-state response must echo its verification request',
          409,
        );
      }
      const request = pending.get(echoed.verificationId);
      if (
        request === undefined ||
        !sameProcedureLeafReplayValue(request, echoed) ||
        report.adapterId !== request.target.adapterId ||
        report.instanceId !== request.target.instanceId
      ) {
        const prior = completed.get(echoed.verificationId);
        if (
          prior === undefined ||
          prior.report.reportId !== report.reportId ||
          !sameProcedureLeafReplayValue(prior.report, report)
        ) {
          throw new ProcedureLeafReplayError(
            'Current-state response does not match a pending verification request',
            409,
          );
        }
      }
    },
    complete(report, receipt) {
      const echoed = report.procedureReplayCurrentStateRequest;
      if (echoed === undefined) {
        throw new ProcedureLeafReplayError(
          'Current-state response is missing its verification request',
          409,
        );
      }
      const prior = completed.get(echoed.verificationId);
      if (prior !== undefined) {
        if (prior.report.reportId !== report.reportId) {
          throw new ProcedureLeafReplayError(
            `Verification ${echoed.verificationId} already has a different report`,
            409,
          );
        }
        return prior;
      }
      const request = pending.get(echoed.verificationId);
      if (request === undefined || !sameProcedureLeafReplayValue(request, echoed)) {
        throw new ProcedureLeafReplayError(
          'Current-state response does not match a pending verification request',
          409,
        );
      }
      const attestationPayload = database.getProcedureLeafReplayAttestation(request.replayId);
      if (attestationPayload === null) {
        throw new ProcedureLeafReplayError(
          `Replay ${request.replayId} has no finalized attestation`,
          404,
        );
      }
      const attestation = parseCurrentStateReplayAttestation(attestationPayload);
      const verification = buildProcedureLeafReplayCurrentStateVerification({
        attestation,
        request,
        report,
        reportReceipt: receipt,
        recordedAt: now(),
      });
      database.appendEvent({
        id: verificationEventId(verification.verificationId),
        eventType: verificationEventType,
        payload: verification,
        createdAt: verification.recordedAt,
      });
      pending.delete(verification.verificationId);
      completed.set(verification.verificationId, verification);
      return verification;
    },
  };
}
