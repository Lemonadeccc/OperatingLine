import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  companionActionExecutionCreateRequestSchema,
  companionActionExecutionDeliverySchema,
  companionActionExecutionResultSchema,
  companionActionExecutionStatusRequestSchema,
  companionActionExecutionStatusSchema,
  companionActionPollDeliverySchema,
  companionActionPollRequestSchema,
  companionActionResultAckSchema,
} from '@operatingline/protocol';
import { describe, expect, it } from 'vitest';

import { validatePublicJsonSchemaCases } from '../../../services/orchestrator/test-support/public-json-schema-validator.js';

const ids = {
  requestId: '11111111-1111-4111-8111-111111111111',
  replayId: '22222222-2222-4222-8222-222222222222',
  reportId: '33333333-3333-4333-8333-333333333333',
  instanceId: '44444444-4444-4444-8444-444444444444',
  proposalId: '55555555-5555-4555-8555-555555555555',
  executionId: '66666666-6666-4666-8666-666666666666',
  deliveryId: '77777777-7777-4777-8777-777777777777',
  resultReportId: '88888888-8888-4888-8888-888888888888',
} as const;

const expectedState = { reportId: ids.reportId, sequence: 7 } as const;
const requestedAt = '2026-08-20T10:00:00.000+08:00';
const dispatchedAt = '2026-08-20T10:00:01.000+08:00';
const occurredAt = '2026-08-20T10:00:02.000+08:00';

function step() {
  return {
    id: 'head.eye.create-sphere',
    parentId: 'head.eye',
    order: 0,
    dependsOn: [],
    title: 'Create eye sphere',
    intent: 'Create the eye mesh',
    explanation: 'Create one UV sphere using the approved managed action.',
    state: 'ready',
    action: {
      adapterId: 'blender',
      name: 'blender.mesh.create_uv_sphere',
      arguments: {
        objectName: 'Eye.L',
        location: [-0.4, -0.8, 1.7],
        scale: [0.25, 0.25, 0.25],
      },
    },
    anchors: [{ kind: 'operator', operatorId: 'mesh.primitive_uv_sphere_add' }],
    expectedObservations: [{ kind: 'uv_sphere_ready', parameters: { objectName: 'Eye.L' } }],
    observationPolicy: { mode: 'success_gate', failureStrategy: 'rollback_step' },
    rollback: { mode: 'native_undo', checkpointRequired: true },
  } as const;
}

function delivery() {
  return {
    formatVersion: '1.0.0',
    requestId: ids.requestId,
    replayId: ids.replayId,
    deliveryId: ids.deliveryId,
    target: { adapterId: 'blender', instanceId: ids.instanceId },
    proposalId: ids.proposalId,
    plan: { id: 'youtube.eye-tutorial', revision: 3 },
    planContentSha256: 'a'.repeat(64),
    executionId: ids.executionId,
    expectedState,
    step: step(),
    requestedAt,
    dispatchedAt,
  } as const;
}

function result(status: 'succeeded' | 'failed' | 'rejected' = 'succeeded') {
  const request = delivery();
  return {
    formatVersion: request.formatVersion,
    requestId: request.requestId,
    replayId: request.replayId,
    deliveryId: request.deliveryId,
    target: request.target,
    proposalId: request.proposalId,
    plan: request.plan,
    planContentSha256: request.planContentSha256,
    executionId: request.executionId,
    expectedState: request.expectedState,
    stepId: request.step.id,
    status,
    report:
      status === 'rejected'
        ? null
        : { reportId: ids.resultReportId, sequence: expectedState.sequence + 1 },
    error: status === 'succeeded' ? null : `${status} action execution`,
    occurredAt,
  } as const;
}

function publicStatus(status: 'queued' | 'dispatched' | 'recovery_required' = 'queued') {
  const request = delivery();
  const resolved = {
    formatVersion: request.formatVersion,
    requestId: request.requestId,
    replayId: request.replayId,
    target: request.target,
    proposalId: request.proposalId,
    plan: request.plan,
    planContentSha256: request.planContentSha256,
    executionId: request.executionId,
    expectedState: request.expectedState,
    step: request.step,
    requestedAt: request.requestedAt,
  };
  return {
    ...resolved,
    ...(status === 'queued' ? {} : { deliveryId: request.deliveryId, dispatchedAt }),
    status,
    updatedAt: dispatchedAt,
  };
}

describe('companion action execution protocol', () => {
  it('accepts only a strict, expected-state-bound create request', () => {
    const request = {
      formatVersion: '1.0.0',
      requestId: ids.requestId,
      replayId: ids.replayId,
      expectedState,
    } as const;
    expect(companionActionExecutionCreateRequestSchema.parse(request)).toEqual(request);

    for (const invalid of [
      { ...request, formatVersion: '1.1.0' },
      { ...request, requestId: 'request-1' },
      { ...request, expectedState: { ...expectedState, sequence: 0 } },
      { ...request, action: 'blender.mesh.create_cube' },
      { ...request, python: 'bpy.ops.mesh.primitive_uv_sphere_add()' },
    ]) {
      expect(companionActionExecutionCreateRequestSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it('delivers only the exact approved Blender UV Sphere guide action', () => {
    const request = delivery();
    expect(companionActionExecutionDeliverySchema.parse(request)).toEqual(request);

    for (const invalid of [
      {
        ...request,
        step: { ...request.step, action: { ...request.step.action, adapterId: 'maya' } },
      },
      {
        ...request,
        step: {
          ...request.step,
          action: { ...request.step.action, name: 'blender.mesh.create_cube' },
        },
      },
      { ...request, step: { ...request.step, action: null } },
      { ...request, target: { ...request.target, adapterId: 'maya' } },
      { ...request, planContentSha256: 'A'.repeat(64) },
      { ...request, dispatchedAt: '2026-08-20T10:00:01' },
      { ...request, python: 'exec(request.step)' },
    ]) {
      expect(companionActionExecutionDeliverySchema.safeParse(invalid).success).toBe(false);
    }
  });

  it('binds report and error evidence to each terminal result', async () => {
    for (const status of ['succeeded', 'failed', 'rejected'] as const) {
      expect(companionActionExecutionResultSchema.safeParse(result(status)).success).toBe(true);
    }

    const succeeded = result('succeeded');
    const failed = result('failed');
    const rejected = result('rejected');
    const invalid = [
      { ...succeeded, report: null },
      { ...succeeded, error: 'unexpected' },
      { ...failed, report: null },
      { ...failed, error: null },
      { ...rejected, error: null },
      { ...rejected, report: { reportId: ids.resultReportId, sequence: 8 } },
      { ...rejected, status: 'recovery_required' },
      { ...succeeded, extra: true },
    ];
    for (const candidate of invalid) {
      expect(companionActionExecutionResultSchema.safeParse(candidate).success).toBe(false);
    }
    const publicSchema = JSON.parse(
      readFileSync(
        resolve('protocol/schemas/v1/companion-action-execution-result.schema.json'),
        'utf8',
      ),
    ) as object;
    await validatePublicJsonSchemaCases(publicSchema, [
      { value: rejected, accepted: true },
      ...invalid.map((value) => ({ value, accepted: false as const })),
    ]);
  });

  it('enforces queued, delivered, terminal, and recovery-required state evidence', () => {
    expect(companionActionExecutionStatusSchema.safeParse(publicStatus('queued')).success).toBe(
      true,
    );
    expect(companionActionExecutionStatusSchema.safeParse(publicStatus('dispatched')).success).toBe(
      true,
    );
    expect(
      companionActionExecutionStatusSchema.safeParse(publicStatus('recovery_required')).success,
    ).toBe(true);

    const terminal = {
      ...publicStatus('dispatched'),
      status: 'succeeded',
      result: result('succeeded'),
    } as const;
    expect(companionActionExecutionStatusSchema.safeParse(terminal).success).toBe(true);

    for (const invalid of [
      { ...publicStatus('queued'), deliveryId: ids.deliveryId },
      { ...publicStatus('queued'), dispatchedAt },
      { ...publicStatus('dispatched'), deliveryId: undefined },
      { ...publicStatus('dispatched'), result: result('succeeded') },
      { ...publicStatus('recovery_required'), result: result('failed') },
      { ...terminal, result: undefined },
      { ...terminal, result: { ...terminal.result, status: 'failed', error: 'failed' } },
      { ...terminal, result: { ...terminal.result, executionId: ids.replayId } },
      { ...terminal, result: { ...terminal.result, stepId: 'another.step' } },
    ]) {
      expect(companionActionExecutionStatusSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it('keeps polling and result acknowledgement minimal and strict', () => {
    const poll = { adapterId: 'blender', instanceId: ids.instanceId } as const;
    expect(companionActionPollRequestSchema.parse(poll)).toEqual(poll);
    expect(companionActionPollDeliverySchema.parse({ request: delivery() })).toEqual({
      request: delivery(),
    });
    expect(companionActionPollDeliverySchema.parse({ request: null })).toEqual({ request: null });
    expect(companionActionResultAckSchema.parse({ result: 'accepted' })).toEqual({
      result: 'accepted',
    });
    expect(companionActionResultAckSchema.parse({ result: 'duplicate' })).toEqual({
      result: 'duplicate',
    });

    for (const invalid of [
      { ...poll, adapterId: 'maya' },
      { ...poll, leaseId: ids.deliveryId },
    ]) {
      expect(companionActionPollRequestSchema.safeParse(invalid).success).toBe(false);
    }
    expect(companionActionPollDeliverySchema.safeParse({}).success).toBe(false);
    expect(companionActionPollDeliverySchema.safeParse({ request: null, more: true }).success).toBe(
      false,
    );
    expect(companionActionResultAckSchema.safeParse({ result: 'ignored' }).success).toBe(false);
  });

  it('looks up public status by only the immutable request id', () => {
    const request = { requestId: ids.requestId } as const;
    expect(companionActionExecutionStatusRequestSchema.parse(request)).toEqual(request);
    expect(
      companionActionExecutionStatusRequestSchema.safeParse({ ...request, replayId: ids.replayId })
        .success,
    ).toBe(false);
    expect(
      companionActionExecutionStatusRequestSchema.safeParse({ requestId: 'request-1' }).success,
    ).toBe(false);
  });

  it('generates eight standalone strict JSON schemas', () => {
    const filenames = [
      'companion-action-execution-create-request.schema.json',
      'companion-action-execution-delivery.schema.json',
      'companion-action-execution-result.schema.json',
      'companion-action-execution-status-request.schema.json',
      'companion-action-execution-status.schema.json',
      'companion-action-poll-request.schema.json',
      'companion-action-poll-delivery.schema.json',
      'companion-action-result-ack.schema.json',
    ];
    for (const filename of filenames) {
      const schema = JSON.parse(
        readFileSync(resolve(process.cwd(), 'protocol/schemas/v1', filename), 'utf8'),
      ) as Record<string, unknown>;
      expect(schema['$id']).toBe(
        `https://operatingline.dev/schema/v1/${filename.replace('.schema.json', '.json')}`,
      );
      expect(schema['additionalProperties']).toBe(false);
    }
  });
});
