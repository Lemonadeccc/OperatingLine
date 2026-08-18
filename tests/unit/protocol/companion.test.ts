import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  companionGuideDeliverySchema,
  companionGuideRequestSchema,
  companionStateReportSchema,
} from '@operatingline/protocol';

function stateReport() {
  return {
    protocolVersion: '1.0.0',
    reportId: randomUUID(),
    sequence: 1,
    adapterId: 'blender',
    instanceId: randomUUID(),
    companionVersion: '0.1.0',
    hostVersion: '4.5.0',
    plan: null,
    planContentSha256: null,
    executionId: null,
    phase: 'idle',
    activeStepId: null,
    completedStepIds: [],
    transition: 'connected',
    stepId: null,
    observations: [],
    error: null,
    occurredAt: '2026-08-04T10:00:00Z',
  };
}

function currentStateReport() {
  return {
    ...stateReport(),
    protocolVersion: '1.5.0',
    observationGate: null,
    artifactAttestation: null,
  };
}

function completedStateReport() {
  const executionId = randomUUID();
  const reportId = randomUUID();
  const projectSha256 = 'b'.repeat(64);
  return {
    ...currentStateReport(),
    reportId,
    plan: { id: 'snowman', revision: 6 },
    planContentSha256: 'a'.repeat(64),
    executionId,
    phase: 'completed',
    activeStepId: 'snowman.render.preview',
    completedStepIds: ['snowman.render.preview'],
    transition: 'step_succeeded',
    stepId: 'snowman.render.preview',
    artifactAttestation: {
      formatVersion: '1.0.0',
      evidenceClass: 'runtime_attested_host_artifacts',
      planContentSha256: 'a'.repeat(64),
      executionId,
      hostProject: {
        artifactId: `host.project.${executionId}.${reportId}`,
        kind: 'host_project',
        mediaType: 'application/x-blender',
        contentSha256: projectSha256,
      },
      renderedImage: {
        artifactId: `render.preview.${executionId}.${reportId}`,
        kind: 'rendered_image',
        mediaType: 'image/png',
        contentSha256: 'c'.repeat(64),
        width: 512,
        height: 512,
        frame: 1,
        renderEngine: 'BLENDER_EEVEE_NEXT',
        colorManagement: 'display=sRGB;view=AgX;look=Medium High Contrast',
        hostProjectSha256: projectSha256,
      },
    },
  };
}

describe('companion protocol', () => {
  it('accepts strict language-neutral guide requests and state reports', () => {
    expect(
      companionGuideRequestSchema.safeParse({
        adapterId: 'blender',
        instanceId: randomUUID(),
        knownPlanId: 'snowman',
        knownRevision: '2',
        knownPlanContentSha256: 'a'.repeat(64),
      }).success,
    ).toBe(true);
    expect(companionStateReportSchema.safeParse(stateReport()).success).toBe(true);
    expect(
      companionGuideDeliverySchema.safeParse({
        protocolVersion: '1.0.0',
        plan: null,
        planContentSha256: null,
        proposal: null,
        proposalPlanContentSha256: null,
      }).success,
    ).toBe(true);
    expect(
      companionGuideDeliverySchema.safeParse({
        protocolVersion: '1.0.0',
        plan: null,
        planContentSha256: null,
        proposal: null,
        proposalPlanContentSha256: null,
        extra: true,
      }).success,
    ).toBe(false);
    expect(companionStateReportSchema.safeParse({ ...stateReport(), extra: true }).success).toBe(
      false,
    );
  });

  it('requires known plan fields to be provided together', () => {
    for (const incompleteIdentity of [
      { knownPlanId: 'snowman' },
      { knownPlanId: 'snowman', knownRevision: 2 },
      { knownRevision: 2, knownPlanContentSha256: 'a'.repeat(64) },
    ]) {
      expect(
        companionGuideRequestSchema.safeParse({
          adapterId: 'blender',
          instanceId: randomUUID(),
          ...incompleteIdentity,
        }).success,
      ).toBe(false);
    }
  });

  it('binds host project and rendered image hashes to the completed execution', () => {
    const report = completedStateReport();
    expect(companionStateReportSchema.safeParse(report).success).toBe(true);
    expect(
      companionStateReportSchema.safeParse({
        ...report,
        phase: 'running',
      }).success,
    ).toBe(false);
    expect(
      companionStateReportSchema.safeParse({
        ...report,
        phase: 'error',
        transition: 'error',
        error: 'The host failed after producing the attested render.',
      }).success,
    ).toBe(true);
    expect(
      companionStateReportSchema.safeParse({
        ...report,
        artifactAttestation: {
          ...report.artifactAttestation,
          executionId: randomUUID(),
        },
      }).success,
    ).toBe(false);
    expect(
      companionStateReportSchema.safeParse({
        ...report,
        artifactAttestation: {
          ...report.artifactAttestation,
          renderedImage: {
            ...report.artifactAttestation.renderedImage,
            hostProjectSha256: 'd'.repeat(64),
          },
        },
      }).success,
    ).toBe(false);
  });

  it('binds native Undo checkpoint evidence to the exact reported session', () => {
    const report = completedStateReport();
    const nativeUndoCheckpoint = {
      formatVersion: '1.0.0',
      evidenceClass: 'companion_reported_native_undo_checkpoint',
      checkpointId: randomUUID(),
      previousCheckpointId: randomUUID(),
      operation: 'next',
      committedAt: '2026-08-04T09:59:59Z',
      marker: {
        key: '_operating_line_native_history_v1',
        matched: true,
      },
      journal: {
        entryPresent: true,
        snapshotMatchesSession: true,
        artifactsBackedUp: true,
      },
      session: {
        plan: report.plan,
        planContentSha256: report.planContentSha256,
        executionId: report.executionId,
        activeStepId: report.activeStepId,
        completedStepIds: report.completedStepIds,
        receiptStepIds: report.completedStepIds,
      },
    } as const;
    expect(companionStateReportSchema.safeParse({ ...report, nativeUndoCheckpoint }).success).toBe(
      true,
    );
    expect(
      companionStateReportSchema.safeParse({
        ...report,
        nativeUndoCheckpoint: { ...nativeUndoCheckpoint, operation: 'back' },
      }).success,
    ).toBe(false);
    expect(
      companionStateReportSchema.safeParse({
        ...report,
        nativeUndoCheckpoint: {
          ...nativeUndoCheckpoint,
          session: {
            ...nativeUndoCheckpoint.session,
            executionId: randomUUID(),
          },
        },
      }).success,
    ).toBe(false);
    expect(
      companionStateReportSchema.safeParse({
        ...report,
        nativeUndoCheckpoint: {
          ...nativeUndoCheckpoint,
          committedAt: '2026-08-04T10:00:01Z',
        },
      }).success,
    ).toBe(false);
  });

  it('binds retained Observation failures to the next checkpoint but forbids one after rollback', () => {
    const terminal = completedStateReport();
    const stepId = terminal.stepId;
    const blocked = {
      ...terminal,
      phase: 'blocked',
      completedStepIds: [],
      transition: 'step_observation_failed',
      observations: [{ kind: 'render_ready', satisfied: false, details: {} }],
      observationGate: {
        stepId,
        status: 'repair_required',
        failureStrategy: 'retain_for_repair',
        message: 'Repair the retained step.',
      },
      artifactAttestation: null,
      nativeUndoCheckpoint: {
        formatVersion: '1.0.0',
        evidenceClass: 'companion_reported_native_undo_checkpoint',
        checkpointId: randomUUID(),
        previousCheckpointId: randomUUID(),
        operation: 'next',
        committedAt: '2026-08-04T09:59:59Z',
        marker: { key: '_operating_line_native_history_v1', matched: true },
        journal: {
          entryPresent: true,
          snapshotMatchesSession: true,
          artifactsBackedUp: true,
        },
        session: {
          plan: terminal.plan,
          planContentSha256: terminal.planContentSha256,
          executionId: terminal.executionId,
          activeStepId: stepId,
          completedStepIds: [],
          receiptStepIds: [stepId],
        },
      },
    } as const;
    const parsedBlocked = companionStateReportSchema.safeParse(blocked);
    expect(parsedBlocked.success, parsedBlocked.error?.message).toBe(true);
    expect(
      companionStateReportSchema.safeParse({
        ...blocked,
        nativeUndoCheckpoint: { ...blocked.nativeUndoCheckpoint, operation: 'recheck' },
      }).success,
    ).toBe(false);
    expect(
      companionStateReportSchema.safeParse({
        ...blocked,
        nativeUndoCheckpoint: {
          ...blocked.nativeUndoCheckpoint,
          session: {
            ...blocked.nativeUndoCheckpoint.session,
            receiptStepIds: ['different.step'],
          },
        },
      }).success,
    ).toBe(false);

    const rolledBack = {
      ...blocked,
      phase: 'running',
      activeStepId: null,
      observationGate: {
        ...blocked.observationGate,
        status: 'failed_rolled_back',
        failureStrategy: 'rollback_step',
      },
    } as const;
    const withoutCheckpoint = { ...rolledBack } as Record<string, unknown>;
    delete withoutCheckpoint['nativeUndoCheckpoint'];
    expect(companionStateReportSchema.safeParse(withoutCheckpoint).success).toBe(true);
    expect(companionStateReportSchema.safeParse(rolledBack).success).toBe(false);
  });

  it('binds nonce-based replay current-state requests to protocol 1.5 recheck reports', () => {
    const report = completedStateReport();
    const request = {
      formatVersion: '1.0.0',
      verificationId: randomUUID(),
      replayId: randomUUID(),
      attestationId: randomUUID(),
      attestationContentSha256: 'd'.repeat(64),
      target: { adapterId: 'blender', instanceId: report.instanceId },
      plan: report.plan,
      planContentSha256: report.planContentSha256,
      executionId: report.executionId,
      stepId: report.stepId,
      expectedObservation: {
        kind: 'render_ready',
        contentSha256: 'e'.repeat(64),
      },
      requestedAt: '2026-08-04T09:59:59Z',
    } as const;
    const rechecked = {
      ...report,
      transition: 'current_state_rechecked',
      artifactAttestation: null,
      procedureReplayCurrentStateRequest: request,
    } as const;
    expect(companionStateReportSchema.safeParse(rechecked).success).toBe(true);
    expect(
      companionStateReportSchema.safeParse({
        ...rechecked,
        protocolVersion: '1.4.0',
        artifactAttestation: undefined,
      }).success,
    ).toBe(false);
    const withoutRequest = { ...rechecked } as Record<string, unknown>;
    delete withoutRequest['procedureReplayCurrentStateRequest'];
    expect(companionStateReportSchema.safeParse(withoutRequest).success).toBe(false);
    expect(
      companionStateReportSchema.safeParse({
        ...report,
        procedureReplayCurrentStateRequest: request,
      }).success,
    ).toBe(false);
    expect(
      companionGuideDeliverySchema.safeParse({
        protocolVersion: '1.5.0',
        plan: null,
        planContentSha256: null,
        proposal: null,
        proposalPlanContentSha256: null,
        procedureReplayCurrentStateRequest: request,
      }).success,
    ).toBe(true);
    expect(
      companionGuideDeliverySchema.safeParse({
        protocolVersion: '1.4.0',
        plan: null,
        planContentSha256: null,
        proposal: null,
        proposalPlanContentSha256: null,
        procedureReplayCurrentStateRequest: request,
      }).success,
    ).toBe(false);
  });

  it('requires an explicit artifact attestation field only from protocol 1.5', () => {
    const legacy = { ...currentStateReport(), protocolVersion: '1.4.0' };
    delete (legacy as { artifactAttestation?: unknown }).artifactAttestation;
    expect(companionStateReportSchema.safeParse(legacy).success).toBe(true);
    expect(
      companionStateReportSchema.safeParse({ ...legacy, artifactAttestation: null }).success,
    ).toBe(false);
    const current = currentStateReport();
    delete (current as { artifactAttestation?: unknown }).artifactAttestation;
    expect(companionStateReportSchema.safeParse(current).success).toBe(false);
  });

  it('accepts a standalone known proposal watermark', () => {
    expect(
      companionGuideRequestSchema.safeParse({
        adapterId: 'blender',
        instanceId: randomUUID(),
        knownProposalId: randomUUID(),
      }).success,
    ).toBe(true);
  });

  it('enforces report transition and workflow invariants', () => {
    expect(
      companionStateReportSchema.safeParse({
        ...stateReport(),
        transition: 'step_succeeded',
      }).success,
    ).toBe(false);
    expect(
      companionStateReportSchema.safeParse({
        ...stateReport(),
        phase: 'ready',
        transition: 'plan_loaded',
      }).success,
    ).toBe(false);
    expect(
      companionStateReportSchema.safeParse({
        ...stateReport(),
        phase: 'error',
        transition: 'error',
      }).success,
    ).toBe(false);
    expect(
      companionStateReportSchema.safeParse({
        ...stateReport(),
        phase: 'error',
        transition: 'error',
        error: 'host connection failed',
      }).success,
    ).toBe(true);

    const plan = { id: 'snowman', revision: 2 };
    expect(
      companionStateReportSchema.safeParse({
        ...stateReport(),
        plan,
        planContentSha256: 'a'.repeat(64),
        executionId: randomUUID(),
        phase: 'running',
        transition: 'walkthrough_started',
      }).success,
    ).toBe(true);
    expect(
      companionStateReportSchema.safeParse({
        ...stateReport(),
        plan,
        planContentSha256: null,
      }).success,
    ).toBe(false);
    expect(
      companionStateReportSchema.safeParse({
        ...stateReport(),
        executionId: randomUUID(),
      }).success,
    ).toBe(false);
  });

  it('binds guide delivery hashes to their corresponding plan payloads', () => {
    expect(
      companionGuideDeliverySchema.safeParse({
        protocolVersion: '1.0.0',
        plan: null,
        planContentSha256: 'a'.repeat(64),
        proposal: null,
        proposalPlanContentSha256: null,
      }).success,
    ).toBe(false);
    expect(
      companionGuideDeliverySchema.safeParse({
        protocolVersion: '1.0.0',
        plan: null,
        planContentSha256: null,
        proposal: null,
        proposalPlanContentSha256: 'b'.repeat(64),
      }).success,
    ).toBe(false);
  });

  it('rejects duplicate completed step ids and non-strict observations', () => {
    const duplicateSteps = {
      ...stateReport(),
      completedStepIds: ['snowman.body', 'snowman.body'],
    };
    const extraObservationField = {
      ...stateReport(),
      observations: [{ kind: 'object_exists', satisfied: true, details: {}, extra: true }],
    };
    expect(companionStateReportSchema.safeParse(duplicateSteps).success).toBe(false);
    expect(companionStateReportSchema.safeParse(extraObservationField).success).toBe(false);
  });

  it('reports fail-closed observation gates and explicit recovery transitions', () => {
    const stepId = 'snowman.body';
    const base = {
      ...currentStateReport(),
      plan: { id: 'snowman', revision: 6 },
      planContentSha256: 'a'.repeat(64),
      executionId: randomUUID(),
      phase: 'blocked',
      activeStepId: stepId,
      transition: 'step_observation_failed',
      stepId,
      observations: [{ kind: 'object_exists', satisfied: false, details: {} }],
      observationGate: {
        stepId,
        status: 'repair_required',
        failureStrategy: 'retain_for_repair',
        message: 'Expected observation did not pass',
      },
    };
    expect(companionStateReportSchema.safeParse(base).success).toBe(true);
    expect(
      companionStateReportSchema.safeParse({
        ...base,
        phase: 'running',
      }).success,
    ).toBe(false);
    expect(
      companionStateReportSchema.safeParse({
        ...base,
        phase: 'running',
        transition: 'observation_recovered',
        observations: [{ kind: 'object_exists', satisfied: true, details: {} }],
        observationGate: { ...base.observationGate, status: 'recovered' },
      }).success,
    ).toBe(true);
    expect(
      companionStateReportSchema.safeParse({
        ...base,
        observations: [{ kind: 'object_exists', satisfied: true, details: {} }],
      }).success,
    ).toBe(false);
    expect(
      companionStateReportSchema.safeParse({
        ...base,
        completedStepIds: [stepId],
      }).success,
    ).toBe(false);
    expect(
      companionStateReportSchema.safeParse({
        ...base,
        activeStepId: 'snowman.head',
      }).success,
    ).toBe(false);
    expect(
      companionStateReportSchema.safeParse({
        ...base,
        phase: 'running',
        transition: 'observation_recovered',
        observationGate: { ...base.observationGate, status: 'recovered' },
      }).success,
    ).toBe(false);
    expect(
      companionStateReportSchema.safeParse({
        ...base,
        observationGate: { ...base.observationGate, stepId: 'snowman.head' },
      }).success,
    ).toBe(false);
    expect(
      companionStateReportSchema.safeParse({
        ...base,
        observationGate: {
          ...base.observationGate,
          status: 'rollback_failed',
        },
      }).success,
    ).toBe(false);
    expect(
      companionStateReportSchema.safeParse({
        ...currentStateReport(),
        observationGate: undefined,
      }).success,
    ).toBe(false);
    expect(
      companionStateReportSchema.safeParse({
        ...stateReport(),
        observationGate: null,
      }).success,
    ).toBe(false);
  });

  it('emits language-neutral schemas for pairing, uniqueness, and cross-field rules', () => {
    const requestSchema = JSON.parse(
      readFileSync(resolve('protocol/schemas/v1/companion-guide-request.schema.json'), 'utf8'),
    ) as { dependentRequired?: Record<string, string[]> };
    const stateSchema = JSON.parse(
      readFileSync(resolve('protocol/schemas/v1/companion-state-report.schema.json'), 'utf8'),
    ) as {
      additionalProperties?: boolean;
      allOf?: unknown[];
      properties?: {
        completedStepIds?: { uniqueItems?: boolean };
        observationGate?: unknown;
      };
    };

    expect(requestSchema.dependentRequired).toEqual({
      knownPlanId: ['knownRevision', 'knownPlanContentSha256'],
      knownRevision: ['knownPlanId', 'knownPlanContentSha256'],
      knownPlanContentSha256: ['knownPlanId', 'knownRevision'],
    });
    expect(stateSchema.additionalProperties).toBe(false);
    expect(stateSchema.properties?.completedStepIds?.uniqueItems).toBe(true);
    expect(stateSchema.properties?.observationGate).toBeDefined();
    expect(stateSchema.allOf?.length).toBeGreaterThanOrEqual(7);
    expect(stateSchema.allOf).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          if: { properties: { phase: { const: 'blocked' } }, required: ['phase'] },
          then: expect.objectContaining({ required: ['observationGate'] }),
        }),
        expect.objectContaining({
          if: {
            properties: { transition: { const: 'step_observation_failed' } },
            required: ['transition'],
          },
          then: expect.objectContaining({ required: ['observationGate'] }),
        }),
      ]),
    );
  });
});
