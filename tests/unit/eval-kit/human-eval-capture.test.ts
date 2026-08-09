import { describe, expect, it } from 'vitest';

import {
  computeHumanEvalContentSha256,
  createProviderEvalRunFromCapture,
  type ProviderEvalCaptureManifestV1,
} from '@operatingline/eval-kit';
import type {
  CurrentEvalExportBundle,
  EvalExecutionEvent,
  ProviderEvalRun,
} from '@operatingline/protocol';

import {
  buildHumanEvalSuiteFixture,
  buildProviderEvalRunFixture,
} from '../../support/human-eval-fixtures.js';

const snapshotId = '40000000-0000-4000-8000-000000000001';

function providerEvents(source: ProviderEvalRun): EvalExecutionEvent[] {
  if (source.invocation.operation !== 'initial_plan' || source.outcome.status !== 'completed') {
    throw new Error('Expected completed initial fixture');
  }
  const request = source.invocation.request;
  const fingerprint = computeHumanEvalContentSha256(request);
  return [
    {
      sequence: 1,
      id: 'capture.prompt',
      eventType: 'planning.prompt.generated',
      payload: {
        request: {
          targetAdapterId: request.targetAdapterId,
          catalogVersion: request.catalogVersion,
          goal: request.goal,
          planId: request.planId,
        },
        packet: source.invocation.packet,
      },
      createdAt: '2026-08-05T00:00:00.000Z',
    },
    {
      sequence: 2,
      id: 'capture.requested',
      eventType: 'planning.provider.generation.requested',
      payload: {
        requestId: request.requestId,
        requestFingerprint: fingerprint,
        providerId: source.profile.descriptor.id,
        providerVersion: source.profile.descriptor.version,
        targetAdapterId: source.environment.targetAdapterId,
        catalogVersion: source.environment.catalogVersion,
        planId: request.planId,
        packetFormatVersion: source.invocation.packet.formatVersion,
        occurredAt: source.timing.startedAt,
      },
      createdAt: source.timing.startedAt,
    },
    {
      sequence: 3,
      id: 'capture.completed',
      eventType: 'planning.provider.generation.completed',
      payload: {
        request,
        requestFingerprint: fingerprint,
        targetAdapterId: source.environment.targetAdapterId,
        catalogVersion: source.environment.catalogVersion,
        planId: request.planId,
        result: source.outcome.result,
      },
      createdAt: source.timing.completedAt,
    },
  ];
}

function bundle(
  source: ProviderEvalRun,
  events: readonly EvalExecutionEvent[],
  page: CurrentEvalExportBundle['page'] = {
    snapshotId,
    snapshotUpperSequence: events.at(-1)?.sequence ?? 0,
    afterSequence: 0,
    nextAfterSequence: events.at(-1)?.sequence ?? 0,
    hasMore: false,
  },
  summaryEvents: readonly EvalExecutionEvent[] = events,
): CurrentEvalExportBundle {
  if (source.invocation.operation !== 'initial_plan') throw new Error('Expected initial fixture');
  const eventTypeCounts: Record<string, number> = {};
  for (const event of summaryEvents) {
    eventTypeCounts[event.eventType] = (eventTypeCounts[event.eventType] ?? 0) + 1;
  }
  const content = {
    protocolVersion: source.environment.protocolVersion,
    formatVersion: '1.1.0' as const,
    scope: {
      targetAdapterId: source.environment.targetAdapterId,
      planId: source.invocation.packet.context.requestedPlanId,
      instanceId: null,
    },
    catalogs: [source.invocation.packet.context.catalog],
    events: [...events],
    page,
    summary: {
      matchedEventCount: summaryEvents.length,
      eventTypeCounts,
      transitionCounts: {},
      decisionCounts: {},
    },
    dataHandling: {
      redaction: 'none' as const,
      containsPotentiallySensitiveContent: true as const,
      warning: 'Frozen capture fixture may contain sensitive prompt content.',
    },
  };
  return {
    ...content,
    exportId: `40000000-0000-4000-8000-${String(page.afterSequence + 2).padStart(12, '0')}`,
    exportedAt: '2026-08-05T00:00:02.000Z',
    integrity: {
      algorithm: 'sha256',
      canonicalization: 'operatingline-json-sort-v1',
      contentSha256: computeHumanEvalContentSha256(content),
    },
  };
}

function setup() {
  const suite = buildHumanEvalSuiteFixture();
  const source = buildProviderEvalRunFixture(suite);
  const events = providerEvents(source);
  const exportBundle = bundle(source, events);
  const bytes = JSON.stringify(exportBundle);
  const manifest: ProviderEvalCaptureManifestV1 = {
    formatVersion: '1.0.0',
    suiteId: suite.suiteId,
    suiteVersion: suite.suiteVersion,
    caseId: suite.cases[0]!.id,
    generationRequestId: source.invocation.request.requestId,
    runId: '40000000-0000-4000-8000-000000000010',
    replicateIndex: 2,
    parentRunId: null,
    profile: source.profile,
    environment: { ...source.environment, sourceCommit: null },
    generationSettings: {
      normalizedParameters: source.generationSettings.normalizedParameters,
      seed: source.generationSettings.seed,
      determinism: source.generationSettings.determinism,
    },
    reproducibility: 'best_effort',
    provenance: {
      ...source.provenance,
      recorderName: 'offline-capture-test',
      vendorRequestId: 'vendor-visible-id',
    },
    dataHandling: {
      redaction: 'human_reviewed',
      containsPotentiallySensitiveContent: false,
      permittedUses: ['local_eval'],
      trainingUse: 'not_authorized',
      publicRelease: 'reviewed',
      warning: 'Reviewed capture; credentials and private reasoning are excluded.',
    },
    exportPages: [
      {
        artifactId: 'eval.page.1',
        uri: 'repo://captures/page-1.json',
        bytes,
        bundle: exportBundle,
      },
    ],
  };
  return { suite, source, events, exportBundle, manifest };
}

describe('offline Provider Eval capture', () => {
  it('builds a sealed initial-plan run and preserves reviewed no-secret fields', () => {
    const { suite, source, manifest } = setup();
    const run = createProviderEvalRunFromCapture({ suite, manifest });

    expect(run).toMatchObject({
      runId: manifest.runId,
      caseRef: { caseId: manifest.caseId },
      sourceKind: 'live_provider_invocation',
      replicateIndex: 2,
      provenance: {
        vendorRequestId: 'vendor-visible-id',
        rawProviderResponseStored: false,
        privateReasoningStored: false,
        credentialsStored: false,
      },
      dataHandling: {
        redaction: 'human_reviewed',
        publicRelease: 'reviewed',
        trainingUse: 'not_authorized',
      },
      outcome: {
        status: 'completed',
        operation: 'initial_plan',
        result: source.outcome.status === 'completed' ? source.outcome.result : undefined,
      },
    });
    expect(run.sourceEvents.map((event) => event.eventType)).toEqual([
      'planning.provider.generation.requested',
      'planning.provider.generation.completed',
    ]);
    expect(run.sourceEvidence).toMatchObject({ evalExportArtifactIds: ['eval.page.1'] });
    expect(run.artifacts[0]).toMatchObject({
      kind: 'eval_export',
      uri: 'repo://captures/page-1.json',
    });
    expect(run.integrity.contentSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('captures needs_revision without inventing host source evidence', () => {
    const state = setup();
    if (state.source.outcome.status !== 'completed') throw new Error('Expected completed fixture');
    const changed = structuredClone(state.source.outcome.result);
    changed.status = 'needs_revision';
    changed.planningQuality.valid = false;
    changed.planningQuality.summary.errorCount = 1;
    changed.planningQuality.findings = [
      {
        code: 'capture.fixture',
        severity: 'error',
        message: 'Fixture requires revision.',
        stepIds: [],
        phaseIds: [],
      },
    ];
    (state.events[2]!.payload as { result: typeof changed }).result = changed;
    const capturedBundle = bundle(state.source, state.events);
    const manifest = {
      ...state.manifest,
      exportPages: [
        { artifactId: 'eval.page.1', uri: 'capture.json', bytes: JSON.stringify(capturedBundle) },
      ],
    };

    const run = createProviderEvalRunFromCapture({ suite: state.suite, manifest });
    expect(run.outcome).toMatchObject({
      status: 'completed',
      result: { status: 'needs_revision' },
    });
    expect(run.sourceEvents).toHaveLength(2);
    expect(run.sourceEvents.every((event) => event.correlationKind === 'provider_request')).toBe(
      true,
    );
  });

  it('rejects incomplete and mixed frozen page chains', () => {
    const state = setup();
    const incomplete = bundle(state.source, state.events, {
      ...state.exportBundle.page,
      hasMore: true,
    });
    expect(() =>
      createProviderEvalRunFromCapture({
        suite: state.suite,
        manifest: {
          ...state.manifest,
          exportPages: [{ artifactId: 'page.1', uri: 'page.json', bundle: incomplete }],
        },
      }),
    ).toThrow(/complete frozen page chain/);

    const first = bundle(
      state.source,
      state.events.slice(0, 2),
      {
        snapshotId,
        snapshotUpperSequence: 3,
        afterSequence: 0,
        nextAfterSequence: 2,
        hasMore: true,
      },
      state.events,
    );
    const second = bundle(
      state.source,
      state.events.slice(2),
      {
        snapshotId: '40000000-0000-4000-8000-000000000099',
        snapshotUpperSequence: 3,
        afterSequence: 2,
        nextAfterSequence: 3,
        hasMore: false,
      },
      state.events,
    );
    expect(() =>
      createProviderEvalRunFromCapture({
        suite: state.suite,
        manifest: {
          ...state.manifest,
          exportPages: [
            { artifactId: 'page.1', uri: 'page-1.json', bundle: first },
            { artifactId: 'page.2', uri: 'page-2.json', bundle: second },
          ],
        },
      }),
    ).toThrow(/complete frozen page chain/);
  });

  it('rejects a re-sealed snapshot whose full summary does not match its events', () => {
    const state = setup();
    const changed = structuredClone(state.exportBundle);
    changed.summary.transitionCounts = { fabricated_transition: 1 };
    const integrityContent = {
      protocolVersion: changed.protocolVersion,
      formatVersion: changed.formatVersion,
      scope: changed.scope,
      catalogs: changed.catalogs,
      events: changed.events,
      page: changed.page,
      summary: changed.summary,
      dataHandling: changed.dataHandling,
    };
    changed.integrity.contentSha256 = computeHumanEvalContentSha256(integrityContent);

    expect(() =>
      createProviderEvalRunFromCapture({
        suite: state.suite,
        manifest: {
          ...state.manifest,
          exportPages: [{ artifactId: 'summary.page', uri: 'summary.json', bundle: changed }],
        },
      }),
    ).toThrow(/summary counts/);
  });

  it.each([
    ['case', (state: ReturnType<typeof setup>) => ({ ...state.manifest, caseId: 'wrong.case' })],
    [
      'request',
      (state: ReturnType<typeof setup>) => ({
        ...state.manifest,
        generationRequestId: '40000000-0000-4000-8000-000000000090',
      }),
    ],
    [
      'catalog',
      (state: ReturnType<typeof setup>) => ({
        ...state.manifest,
        environment: { ...state.manifest.environment, catalogVersion: '9.9.9' },
      }),
    ],
  ])('rejects exact %s mismatches', (_label, mutate) => {
    const state = setup();
    expect(() =>
      createProviderEvalRunFromCapture({ suite: state.suite, manifest: mutate(state) }),
    ).toThrow(/rejected/);
  });

  it('rejects failed terminals with the explicit v1 limitation', () => {
    const state = setup();
    const request = state.source.invocation.request;
    const requested = state.events[1]!;
    state.events[2] = {
      sequence: 3,
      id: 'capture.failed',
      eventType: 'planning.provider.generation.failed',
      payload: {
        requestId: request.requestId,
        requestFingerprint: computeHumanEvalContentSha256(request),
        providerId: state.source.profile.descriptor.id,
        providerVersion: state.source.profile.descriptor.version,
        targetAdapterId: state.source.environment.targetAdapterId,
        catalogVersion: state.source.environment.catalogVersion,
        planId: request.planId,
        error: 'planner_provider_failed',
        durationMs: 1_000,
        occurredAt: '2026-08-05T00:00:01.000Z',
      },
      createdAt: '2026-08-05T00:00:01.000Z',
    };
    expect(requested.eventType).toBe('planning.provider.generation.requested');
    const failedBundle = bundle(state.source, state.events);
    expect(() =>
      createProviderEvalRunFromCapture({
        suite: state.suite,
        manifest: {
          ...state.manifest,
          exportPages: [{ artifactId: 'failed.page', uri: 'failed.json', bundle: failedBundle }],
        },
      }),
    ).toThrow(/failed provider terminals are not supported by capture manifest v1/);
  });

  it('rejects a requested event whose redundant scope disagrees with the terminal request', () => {
    const state = setup();
    const requested = state.events[1]!;
    if (requested.payload === null || typeof requested.payload !== 'object') {
      throw new Error('Expected requested event payload');
    }
    state.events[1] = {
      ...requested,
      payload: { ...requested.payload, planId: 'different-plan' },
    };
    const changed = bundle(state.source, state.events);

    expect(() =>
      createProviderEvalRunFromCapture({
        suite: state.suite,
        manifest: {
          ...state.manifest,
          exportPages: [{ artifactId: 'scope.page', uri: 'scope.json', bundle: changed }],
        },
      }),
    ).toThrow(/requested initial-plan scope/);
  });
});
