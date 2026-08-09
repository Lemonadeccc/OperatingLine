import { createHash } from 'node:crypto';

import {
  companionStateReportSchema,
  currentEvalExportBundleSchema,
  guidePlanSchema,
  guideProposalDecisionSchema,
  guideProposalSchema,
  humanEvalSuiteSchema,
  plannerGenerationCompletedEventSchema,
  plannerGenerationRequestedEventSchema,
  plannerReplanCompletedEventSchema,
  plannerReplanRequestedEventSchema,
  planningPromptPacketSchema,
  replanningPromptPacketSchema,
  type CurrentEvalExportBundle,
  type EvalArtifactReference,
  type EvalExecutionEvent,
  type HumanEvalDataHandling,
  type HumanEvalSuite,
  type ProviderEvalEnvironment,
  type ProviderEvalGenerationSettings,
  type ProviderEvalProfile,
  type ProviderEvalRun,
} from '@operatingline/protocol';

import {
  computeHumanEvalCaseSha256,
  computeHumanEvalContentSha256,
  computePlanContentSha256,
  contentWithoutIntegrity,
} from './integrity.js';
import { createProviderEvalRun } from './records.js';

export const providerEvalCaptureManifestVersion = '1.0.0' as const;

export interface ProviderEvalCapturePageInput {
  readonly artifactId: string;
  readonly uri: string;
  /** Exact artifact bytes. Strings are interpreted as UTF-8 JSON. */
  readonly bytes?: Uint8Array | string;
  /** A previously parsed page, useful to filesystem CLIs that already decoded the artifact. */
  readonly bundle?: unknown;
}

export interface ProviderEvalCaptureManifestV1 {
  readonly formatVersion: typeof providerEvalCaptureManifestVersion;
  readonly suiteId: string;
  readonly suiteVersion: string;
  readonly caseId: string;
  readonly generationRequestId: string;
  /** Optional fail-closed selector when the frozen chain contains multiple host executions. */
  readonly hostExecutionId?: string;
  readonly runId: string;
  readonly replicateIndex: number;
  readonly parentRunId: string | null;
  readonly profile: ProviderEvalProfile;
  readonly environment: ProviderEvalEnvironment;
  readonly generationSettings: Omit<ProviderEvalGenerationSettings, 'parametersSha256'>;
  readonly reproducibility: ProviderEvalRun['comparability']['reproducibility'];
  readonly provenance: ProviderEvalRun['provenance'];
  readonly dataHandling: HumanEvalDataHandling;
  readonly exportPages: readonly ProviderEvalCapturePageInput[];
  /** Supplemental artifacts must already be content-addressed by their producer. */
  readonly supplementalArtifacts?: readonly EvalArtifactReference[];
}

export interface ProviderEvalCaptureInput {
  readonly suite: HumanEvalSuite;
  readonly manifest: ProviderEvalCaptureManifestV1;
}

interface LoadedPage {
  readonly input: ProviderEvalCapturePageInput;
  readonly bundle: CurrentEvalExportBundle;
  readonly bytes: Uint8Array;
}

function captureError(message: string): Error {
  return new Error(`Provider Eval capture rejected: ${message}`);
}

function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function exportIntegrityContent(bundle: CurrentEvalExportBundle): unknown {
  return {
    protocolVersion: bundle.protocolVersion,
    formatVersion: bundle.formatVersion,
    scope: bundle.scope,
    catalogs: bundle.catalogs,
    events: bundle.events,
    page: bundle.page,
    summary: bundle.summary,
    dataHandling: bundle.dataHandling,
  };
}

function readPage(input: ProviderEvalCapturePageInput): LoadedPage {
  if (input.bytes === undefined && input.bundle === undefined) {
    throw captureError(`Eval export ${input.artifactId} must provide bytes or a parsed bundle`);
  }
  let decodedBytes: Uint8Array | undefined;
  let decodedBundle: unknown;
  if (input.bytes !== undefined) {
    decodedBytes = typeof input.bytes === 'string' ? Buffer.from(input.bytes, 'utf8') : input.bytes;
    try {
      decodedBundle = JSON.parse(Buffer.from(decodedBytes).toString('utf8')) as unknown;
    } catch (error) {
      throw captureError(
        `Eval export ${input.artifactId} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  const bundleFromBytes =
    decodedBundle === undefined ? undefined : currentEvalExportBundleSchema.parse(decodedBundle);
  const suppliedBundle =
    input.bundle === undefined ? undefined : currentEvalExportBundleSchema.parse(input.bundle);
  if (
    bundleFromBytes !== undefined &&
    suppliedBundle !== undefined &&
    computeHumanEvalContentSha256(bundleFromBytes) !== computeHumanEvalContentSha256(suppliedBundle)
  ) {
    throw captureError(
      `Eval export ${input.artifactId} parsed bundle does not match its supplied bytes`,
    );
  }
  const bundle = bundleFromBytes ?? suppliedBundle;
  if (bundle === undefined) {
    throw captureError(`Eval export ${input.artifactId} could not be decoded`);
  }
  if (
    computeHumanEvalContentSha256(exportIntegrityContent(bundle)) !== bundle.integrity.contentSha256
  ) {
    throw captureError(`Eval export ${input.artifactId} bundle integrity does not verify`);
  }
  return {
    input,
    bundle,
    bytes: decodedBytes ?? Buffer.from(JSON.stringify(bundle), 'utf8'),
  };
}

function countBy(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function stringField(value: unknown, key: string): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === 'string' ? field : null;
}

function verifyPageChain(pages: readonly LoadedPage[]): readonly EvalExecutionEvent[] {
  const first = pages[0];
  if (first === undefined) throw captureError('at least one Eval export page is required');
  const frozenIdentity = computeHumanEvalContentSha256({
    protocolVersion: first.bundle.protocolVersion,
    formatVersion: first.bundle.formatVersion,
    scope: first.bundle.scope,
    catalogs: first.bundle.catalogs,
    summary: first.bundle.summary,
    dataHandling: first.bundle.dataHandling,
    snapshotId: first.bundle.page.snapshotId,
    snapshotUpperSequence: first.bundle.page.snapshotUpperSequence,
  });
  const events: EvalExecutionEvent[] = [];
  const ids = new Set<string>();
  const sequences = new Set<number>();
  let afterSequence = 0;
  for (const [index, loaded] of pages.entries()) {
    const { bundle } = loaded;
    const identity = computeHumanEvalContentSha256({
      protocolVersion: bundle.protocolVersion,
      formatVersion: bundle.formatVersion,
      scope: bundle.scope,
      catalogs: bundle.catalogs,
      summary: bundle.summary,
      dataHandling: bundle.dataHandling,
      snapshotId: bundle.page.snapshotId,
      snapshotUpperSequence: bundle.page.snapshotUpperSequence,
    });
    const lastSequence = bundle.events.at(-1)?.sequence ?? bundle.page.afterSequence;
    const isLast = index === pages.length - 1;
    if (
      identity !== frozenIdentity ||
      bundle.page.afterSequence !== afterSequence ||
      bundle.page.nextAfterSequence !== lastSequence ||
      bundle.page.hasMore === isLast ||
      bundle.events.some(
        (event, eventIndex) =>
          event.sequence <= bundle.page.afterSequence ||
          event.sequence > bundle.page.snapshotUpperSequence ||
          (eventIndex > 0 && event.sequence <= bundle.events[eventIndex - 1]!.sequence),
      )
    ) {
      throw captureError('Eval export pages do not form one complete frozen page chain');
    }
    for (const event of bundle.events) {
      if (ids.has(event.id) || sequences.has(event.sequence)) {
        throw captureError('Eval export page chain contains duplicate event identity or sequence');
      }
      ids.add(event.id);
      sequences.add(event.sequence);
      events.push(event);
    }
    afterSequence = bundle.page.nextAfterSequence;
  }
  if (events.length !== first.bundle.summary.matchedEventCount) {
    throw captureError('Eval export page chain is incomplete for its declared matched event set');
  }
  const eventTypeCounts = countBy(events.map((event) => event.eventType));
  const transitionCounts = countBy(
    events.flatMap((event) => {
      const transition =
        event.eventType === 'companion.state.reported'
          ? stringField(event.payload, 'transition')
          : null;
      return transition === null ? [] : [transition];
    }),
  );
  const decisionCounts = countBy(
    events.flatMap((event) => {
      const decision =
        event.eventType === 'guide.proposal.decided'
          ? stringField(event.payload, 'decision')
          : null;
      return decision === null ? [] : [decision];
    }),
  );
  if (
    computeHumanEvalContentSha256({ eventTypeCounts, transitionCounts, decisionCounts }) !==
    computeHumanEvalContentSha256({
      eventTypeCounts: first.bundle.summary.eventTypeCounts,
      transitionCounts: first.bundle.summary.transitionCounts,
      decisionCounts: first.bundle.summary.decisionCounts,
    })
  ) {
    throw captureError('Eval export summary counts do not match the complete page chain');
  }
  return events;
}

function eventRequestId(event: EvalExecutionEvent): string | null {
  if (event.payload === null || typeof event.payload !== 'object' || Array.isArray(event.payload)) {
    return null;
  }
  const payload = event.payload as Record<string, unknown>;
  if (typeof payload['requestId'] === 'string') return payload['requestId'];
  for (const key of ['request', 'result', 'error']) {
    const nested = payload[key];
    if (
      nested !== null &&
      typeof nested === 'object' &&
      !Array.isArray(nested) &&
      typeof (nested as Record<string, unknown>)['requestId'] === 'string'
    ) {
      return (nested as Record<string, string>)['requestId'] ?? null;
    }
  }
  return null;
}

function promptPayload(
  event: EvalExecutionEvent,
): { readonly request: unknown; readonly packet: unknown } | null {
  if (event.payload === null || typeof event.payload !== 'object' || Array.isArray(event.payload)) {
    return null;
  }
  const payload = event.payload as Record<string, unknown>;
  return 'request' in payload && 'packet' in payload
    ? { request: payload['request'], packet: payload['packet'] }
    : null;
}

function sourceSummary(event: EvalExecutionEvent, requestId: string) {
  return {
    sequence: event.sequence,
    eventId: event.id,
    eventType: event.eventType,
    payloadSha256: computeHumanEvalContentSha256(event.payload),
    correlationKind: 'provider_request' as const,
    requestId,
  };
}

/**
 * Builds a sealed live ProviderEvalRun entirely from caller-supplied frozen evidence.
 * This function performs no I/O and never loads providers, credentials, or environment variables.
 */
export function createProviderEvalRunFromCapture(input: ProviderEvalCaptureInput): ProviderEvalRun {
  const suite = humanEvalSuiteSchema.parse(input.suite);
  const { manifest } = input;
  if (
    computeHumanEvalContentSha256(contentWithoutIntegrity(suite)) !== suite.integrity.contentSha256
  ) {
    throw captureError('supplied suite integrity does not verify');
  }
  if (manifest.formatVersion !== providerEvalCaptureManifestVersion) {
    throw captureError(`unsupported manifest version ${String(manifest.formatVersion)}`);
  }
  if (manifest.suiteId !== suite.suiteId || manifest.suiteVersion !== suite.suiteVersion) {
    throw captureError('manifest suite identity does not match the supplied suite');
  }
  const evalCase = suite.cases.find((candidate) => candidate.id === manifest.caseId);
  if (evalCase === undefined) throw captureError(`case ${manifest.caseId} is not in the suite`);

  const loadedPages = manifest.exportPages.map(readPage);
  const events = verifyPageChain(loadedPages);
  const firstBundle = loadedPages[0]!.bundle;
  if (firstBundle.protocolVersion !== manifest.environment.protocolVersion) {
    throw captureError('Eval export protocol does not match the capture environment');
  }
  const exactCatalog = firstBundle.catalogs.find(
    (catalog) =>
      catalog.adapterId === manifest.environment.targetAdapterId &&
      catalog.catalogVersion === manifest.environment.catalogVersion,
  );
  if (
    exactCatalog === undefined ||
    computeHumanEvalContentSha256(exactCatalog) !== evalCase.catalogContentSha256
  ) {
    throw captureError('Eval export catalog does not exactly match the selected case');
  }

  const operation = evalCase.operation;
  const prefix =
    operation === 'initial_plan' ? 'planning.provider.generation' : 'planning.provider.replan';
  const correlated = events.filter(
    (event) =>
      event.eventType.startsWith(`${prefix}.`) &&
      eventRequestId(event) === manifest.generationRequestId,
  );
  const allOperationEvents = events.filter(
    (event) =>
      (event.eventType.startsWith('planning.provider.generation.') ||
        event.eventType.startsWith('planning.provider.replan.')) &&
      eventRequestId(event) === manifest.generationRequestId,
  );
  if (allOperationEvents.length !== correlated.length) {
    throw captureError('generationRequestId is mixed across provider operation chains');
  }
  const requestedEvents = correlated.filter((event) => event.eventType === `${prefix}.requested`);
  const terminalEvents = correlated.filter(
    (event) => event.eventType === `${prefix}.completed` || event.eventType === `${prefix}.failed`,
  );
  if (requestedEvents.length !== 1 || terminalEvents.length !== 1 || correlated.length !== 2) {
    throw captureError(
      'expected exactly one requested event and one terminal event for generationRequestId',
    );
  }
  const requestedEvent = requestedEvents[0]!;
  const terminalEvent = terminalEvents[0]!;
  if (requestedEvent.sequence >= terminalEvent.sequence) {
    throw captureError('provider requested event must precede its terminal event');
  }
  if (terminalEvent.eventType.endsWith('.failed')) {
    throw captureError('failed provider terminals are not supported by capture manifest v1');
  }

  const requested =
    operation === 'initial_plan'
      ? plannerGenerationRequestedEventSchema.parse(requestedEvent.payload)
      : plannerReplanRequestedEventSchema.parse(requestedEvent.payload);
  const terminal =
    operation === 'initial_plan'
      ? plannerGenerationCompletedEventSchema.parse(terminalEvent.payload)
      : plannerReplanCompletedEventSchema.parse(terminalEvent.payload);
  if (
    terminal.request.requestId !== manifest.generationRequestId ||
    requested.requestFingerprint !== computeHumanEvalContentSha256(terminal.request) ||
    terminal.requestFingerprint !== requested.requestFingerprint
  ) {
    throw captureError(
      'provider request fingerprint or generation request identity does not match',
    );
  }

  const promptEventType =
    operation === 'initial_plan' ? 'planning.prompt.generated' : 'planning.replan.prompt.generated';
  const expectedPromptRequest = Object.fromEntries(
    Object.entries(terminal.request).filter(([key]) => key !== 'requestId' && key !== 'providerId'),
  );
  const promptCandidates = events.filter((event) => {
    if (event.sequence >= requestedEvent.sequence || event.eventType !== promptEventType)
      return false;
    const payload = promptPayload(event);
    return (
      payload !== null &&
      computeHumanEvalContentSha256(payload.request) ===
        computeHumanEvalContentSha256(expectedPromptRequest)
    );
  });
  const promptEvent = promptCandidates.at(-1);
  const prompt = promptEvent === undefined ? null : promptPayload(promptEvent);
  if (prompt === null) {
    throw captureError('no exact preceding planning prompt packet matches the provider request');
  }

  const packet =
    operation === 'initial_plan'
      ? planningPromptPacketSchema.parse(prompt.packet)
      : replanningPromptPacketSchema.parse(prompt.packet);
  if (
    computeHumanEvalContentSha256(packet.context.catalog) !== evalCase.catalogContentSha256 ||
    packet.context.catalog.adapterId !== manifest.environment.targetAdapterId ||
    packet.context.catalog.catalogVersion !== manifest.environment.catalogVersion
  ) {
    throw captureError(
      'planning prompt packet catalog does not exactly match the case and environment',
    );
  }

  if (operation === 'initial_plan') {
    const initialPacket = planningPromptPacketSchema.parse(prompt.packet);
    if (
      computeHumanEvalContentSha256(expectedPromptRequest) !==
        computeHumanEvalContentSha256(evalCase.request) ||
      firstBundle.scope.targetAdapterId !== evalCase.request.targetAdapterId ||
      firstBundle.scope.planId !== evalCase.request.planId ||
      initialPacket.context.targetAdapterId !== evalCase.request.targetAdapterId ||
      initialPacket.context.requestedPlanId !== evalCase.request.planId
    ) {
      throw captureError(
        'provider request and Eval export scope do not exactly match the selected initial-plan case',
      );
    }
  } else {
    const replanPacket = replanningPromptPacketSchema.parse(prompt.packet);
    const revision = replanPacket.context.revisionRequest;
    if (
      computeHumanEvalContentSha256(firstBundle.scope) !==
        computeHumanEvalContentSha256({
          targetAdapterId: revision.adapterId,
          planId: revision.basePlan.id,
          instanceId: revision.instanceId,
        }) ||
      revision.message !== evalCase.revisionMessage ||
      revision.adapterId !== evalCase.targetAdapterId ||
      revision.catalogVersion !== evalCase.catalogVersion ||
      revision.basePlan.id !== evalCase.basePlan.planId ||
      revision.basePlan.revision !== evalCase.basePlan.revision ||
      computePlanContentSha256(revision.basePlan) !== evalCase.basePlan.planContentSha256 ||
      computeHumanEvalContentSha256(revision.references.map((reference) => reference.nodeId)) !==
        computeHumanEvalContentSha256(evalCase.referencedNodeIds)
    ) {
      throw captureError('replanning prompt does not exactly match the selected local-replan case');
    }
  }

  const result = terminal.result;
  const sourceEvents: ProviderEvalRun['sourceEvents'][number][] = [
    sourceSummary(requestedEvent, manifest.generationRequestId),
    sourceSummary(terminalEvent, manifest.generationRequestId),
  ];
  if (
    requested.providerId !== manifest.profile.descriptor.id ||
    requested.providerVersion !== manifest.profile.descriptor.version ||
    requested.targetAdapterId !== manifest.environment.targetAdapterId ||
    requested.catalogVersion !== manifest.environment.catalogVersion ||
    requested.packetFormatVersion !== packet.formatVersion
  ) {
    throw captureError(
      'manifest provider or environment identity does not match requested evidence',
    );
  }
  if (operation === 'initial_plan') {
    const initialRequested = plannerGenerationRequestedEventSchema.parse(requested);
    const initialTerminal = plannerGenerationCompletedEventSchema.parse(terminal);
    const initialPacket = planningPromptPacketSchema.parse(packet);
    if (
      initialRequested.planId !== initialTerminal.request.planId ||
      initialRequested.targetAdapterId !== initialTerminal.request.targetAdapterId ||
      initialRequested.catalogVersion !==
        (initialTerminal.request.catalogVersion ?? initialPacket.context.catalog.catalogVersion)
    ) {
      throw captureError('requested initial-plan scope does not match its terminal request');
    }
  }
  if (operation === 'local_replan') {
    const replanRequested = plannerReplanRequestedEventSchema.parse(requested);
    const replanTerminal = plannerReplanCompletedEventSchema.parse(terminal);
    const revision = replanningPromptPacketSchema.parse(packet).context.revisionRequest;
    if (
      replanRequested.revisionRequestId !== replanTerminal.request.revisionRequestId ||
      replanRequested.targetAdapterId !== revision.adapterId ||
      replanRequested.targetInstanceId !== revision.instanceId ||
      replanRequested.catalogVersion !== revision.catalogVersion ||
      replanRequested.planId !== revision.basePlan.id ||
      replanRequested.baseRevision !== revision.basePlan.revision
    ) {
      throw captureError('requested local-replan scope does not match its terminal request');
    }
  }
  if (result.status === 'ready') {
    const planHash = computePlanContentSha256(result.draft.plan);
    const authorizationSequences: number[] = [];
    const proposals = events.flatMap((event) => {
      if (
        event.sequence <= terminalEvent.sequence ||
        event.eventType !== 'guide.proposal.created'
      ) {
        return [];
      }
      const proposal = guideProposalSchema.safeParse(event.payload);
      return proposal.success &&
        proposal.data.targetAdapterId === manifest.environment.targetAdapterId &&
        computePlanContentSha256(proposal.data.plan) === planHash
        ? [{ event, proposal: proposal.data }]
        : [];
    });
    for (const event of events) {
      if (event.sequence <= terminalEvent.sequence) continue;
      if (event.eventType === 'guide.plan.published') {
        const payload = event.payload as { readonly plan?: unknown };
        const published = guidePlanSchema.safeParse(payload?.plan);
        if (published.success && computePlanContentSha256(published.data) === planHash) {
          authorizationSequences.push(event.sequence);
        }
      } else if (event.eventType === 'guide.proposal.decided') {
        const decision = guideProposalDecisionSchema.safeParse(event.payload);
        if (!decision.success || decision.data.decision !== 'accepted') continue;
        const proposal = proposals.find(
          (candidate) =>
            candidate.event.sequence < event.sequence &&
            candidate.proposal.proposalId === decision.data.proposalId &&
            candidate.proposal.targetAdapterId === decision.data.adapterId &&
            (candidate.proposal.targetInstanceId === undefined ||
              candidate.proposal.targetInstanceId === decision.data.instanceId),
        );
        if (proposal !== undefined) authorizationSequences.push(event.sequence);
      }
    }
    const executableStepIds = result.draft.plan.steps
      .filter((step) => step.action !== null)
      .map((step) => step.id);
    const reports: Array<{
      readonly event: EvalExecutionEvent;
      readonly report: ReturnType<typeof companionStateReportSchema.parse>;
    }> = [];
    for (const event of events) {
      if (
        event.sequence <= terminalEvent.sequence ||
        event.eventType !== 'companion.state.reported'
      ) {
        continue;
      }
      const report = companionStateReportSchema.safeParse(event.payload);
      if (
        report.success &&
        report.data.protocolVersion === manifest.environment.protocolVersion &&
        report.data.adapterId === manifest.environment.targetAdapterId &&
        report.data.instanceId === firstBundle.scope.instanceId &&
        report.data.hostVersion === manifest.environment.hostVersion &&
        report.data.companionVersion === manifest.environment.adapterVersion &&
        report.data.plan?.id === result.draft.plan.id &&
        report.data.plan.revision === result.draft.plan.revision &&
        report.data.planContentSha256 === planHash &&
        report.data.executionId !== null &&
        (manifest.hostExecutionId === undefined ||
          report.data.executionId === manifest.hostExecutionId) &&
        report.data.phase === 'completed' &&
        report.data.transition === 'step_succeeded' &&
        report.data.stepId !== null &&
        executableStepIds.length === report.data.completedStepIds.length &&
        executableStepIds.every((stepId) => report.data.completedStepIds.includes(stepId)) &&
        authorizationSequences.some(
          (sequence) => sequence > terminalEvent.sequence && sequence < event.sequence,
        )
      ) {
        reports.push({ event, report: report.data });
      }
    }
    if (reports.length > 1) {
      throw captureError(
        'ready evidence contains multiple exact terminal host reports; provide hostExecutionId to select one',
      );
    }
    if (
      manifest.hostExecutionId !== undefined &&
      (reports.length !== 1 || authorizationSequences.length !== 1)
    ) {
      throw captureError(
        'hostExecutionId requires exactly one matching authorization and terminal successful host report',
      );
    }
    const terminalHost = reports[0];
    if (terminalHost !== undefined) {
      sourceEvents.push({
        sequence: terminalHost.event.sequence,
        eventId: terminalHost.event.id,
        eventType: terminalHost.event.eventType,
        payloadSha256: computeHumanEvalContentSha256(terminalHost.event.payload),
        correlationKind: 'host_execution',
        planId: result.draft.plan.id,
        planContentSha256: planHash,
        instanceId: terminalHost.report.instanceId,
        executionId: terminalHost.report.executionId,
        reportId: terminalHost.report.reportId,
      });
    }
  }

  const exportArtifacts: EvalArtifactReference[] = loadedPages.map((loaded) => ({
    artifactId: loaded.input.artifactId,
    kind: 'eval_export',
    mediaType: 'application/json',
    uri: loaded.input.uri,
    contentSha256: sha256Bytes(loaded.bytes),
    metadata: {
      exportId: loaded.bundle.exportId,
      pageAfterSequence: loaded.bundle.page.afterSequence,
      pageNextAfterSequence: loaded.bundle.page.nextAfterSequence,
    },
  }));
  const artifacts = [...exportArtifacts, ...(manifest.supplementalArtifacts ?? [])];
  if (new Set(artifacts.map((artifact) => artifact.artifactId)).size !== artifacts.length) {
    throw captureError('capture artifact ids must be unique');
  }

  return createProviderEvalRun({
    formatVersion: '1.0.0',
    runId: manifest.runId,
    caseRef: {
      suiteId: suite.suiteId,
      suiteVersion: suite.suiteVersion,
      caseId: evalCase.id,
      caseContentSha256: computeHumanEvalCaseSha256(evalCase),
    },
    sourceKind: 'live_provider_invocation',
    sourceEvidence: {
      kind: 'eval_export_snapshot',
      snapshotId: firstBundle.page.snapshotId,
      snapshotUpperSequence: firstBundle.page.snapshotUpperSequence,
      evalExportArtifactIds: exportArtifacts.map((artifact) => artifact.artifactId),
    },
    replicateIndex: manifest.replicateIndex,
    parentRunId: manifest.parentRunId,
    profile: manifest.profile,
    environment: manifest.environment,
    invocation: { operation, request: terminal.request, packet } as Parameters<
      typeof createProviderEvalRun
    >[0]['invocation'],
    generationSettings: manifest.generationSettings,
    timing: { startedAt: requested.occurredAt, completedAt: result.generatedAt },
    outcome: { status: 'completed', operation, result } as Parameters<
      typeof createProviderEvalRun
    >[0]['outcome'],
    sourceEvents,
    artifacts,
    reproducibility: manifest.reproducibility,
    provenance: manifest.provenance,
    dataHandling: manifest.dataHandling,
  });
}
