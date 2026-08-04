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

describe('companion protocol', () => {
  it('accepts strict language-neutral guide requests and state reports', () => {
    expect(
      companionGuideRequestSchema.safeParse({
        adapterId: 'blender',
        instanceId: randomUUID(),
        knownPlanId: 'snowman',
        knownRevision: '2',
      }).success,
    ).toBe(true);
    expect(companionStateReportSchema.safeParse(stateReport()).success).toBe(true);
    expect(
      companionGuideDeliverySchema.safeParse({
        protocolVersion: '1.0.0',
        plan: null,
        proposal: null,
      }).success,
    ).toBe(true);
    expect(
      companionGuideDeliverySchema.safeParse({
        protocolVersion: '1.0.0',
        plan: null,
        proposal: null,
        extra: true,
      }).success,
    ).toBe(false);
    expect(companionStateReportSchema.safeParse({ ...stateReport(), extra: true }).success).toBe(
      false,
    );
  });

  it('requires known plan fields to be provided together', () => {
    expect(
      companionGuideRequestSchema.safeParse({
        adapterId: 'blender',
        instanceId: randomUUID(),
        knownPlanId: 'snowman',
      }).success,
    ).toBe(false);
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

  it('emits language-neutral schemas for pairing, uniqueness, and cross-field rules', () => {
    const requestSchema = JSON.parse(
      readFileSync(resolve('protocol/schemas/v1/companion-guide-request.schema.json'), 'utf8'),
    ) as { dependentRequired?: Record<string, string[]> };
    const stateSchema = JSON.parse(
      readFileSync(resolve('protocol/schemas/v1/companion-state-report.schema.json'), 'utf8'),
    ) as {
      additionalProperties?: boolean;
      allOf?: unknown[];
      properties?: { completedStepIds?: { uniqueItems?: boolean } };
    };

    expect(requestSchema.dependentRequired).toEqual({
      knownPlanId: ['knownRevision'],
      knownRevision: ['knownPlanId'],
    });
    expect(stateSchema.additionalProperties).toBe(false);
    expect(stateSchema.properties?.completedStepIds?.uniqueItems).toBe(true);
    expect(stateSchema.allOf?.length).toBeGreaterThanOrEqual(7);
  });
});
