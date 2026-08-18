import { createHash } from 'node:crypto';

import type { OperatingLineDatabase, StoredExecutionEvent } from '@operatingline/persistence';
import {
  actionCatalogSchema,
  canonicalizeProtocolJsonValue,
  evalExecutionEventSchema,
  currentEvalExportBundleSchema,
  evalExportFormatVersion,
  guideProtocolVersion,
  type ActionCatalog,
  type EvalExecutionEvent,
  type CurrentEvalExportBundle,
  type EvalExportRequest,
} from '@operatingline/protocol';

const dataHandling = {
  redaction: 'none',
  containsPotentiallySensitiveContent: true,
  warning:
    'This export may contain user-authored goals, provider-generated drafts, revision messages, action arguments, host observations, and error details. Review it before sharing or training.',
} as const;

type JsonRecord = Record<string, unknown>;

interface EvalExportOptions {
  request: EvalExportRequest;
  availableCatalogs: readonly ActionCatalog[];
  events: readonly StoredExecutionEvent[];
  exportId: string;
  exportedAt: string;
}

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function recordAt(value: unknown, ...path: string[]): JsonRecord | null {
  let candidate = value;
  for (const segment of path) {
    candidate = asRecord(candidate)?.[segment];
  }
  return asRecord(candidate);
}

function stringAt(value: unknown, ...path: string[]): string | null {
  let candidate = value;
  for (const segment of path) {
    candidate = asRecord(candidate)?.[segment];
  }
  return typeof candidate === 'string' ? candidate : null;
}

function planAdapterId(plan: JsonRecord | null): string | null {
  const steps = plan?.['steps'];
  if (!Array.isArray(steps)) {
    return null;
  }
  for (const step of steps) {
    const adapterId = stringAt(step, 'action', 'adapterId');
    if (adapterId !== null) {
      return adapterId;
    }
  }
  return null;
}

function proposalMatches(payload: unknown, request: EvalExportRequest): boolean {
  if (
    stringAt(payload, 'targetAdapterId') !== request.targetAdapterId ||
    stringAt(payload, 'plan', 'id') !== request.planId
  ) {
    return false;
  }
  const targetInstanceId = stringAt(payload, 'targetInstanceId');
  return (
    request.instanceId === undefined ||
    targetInstanceId === null ||
    targetInstanceId === request.instanceId
  );
}

function revisionRequestMatches(payload: unknown, request: EvalExportRequest): boolean {
  return (
    stringAt(payload, 'adapterId') === request.targetAdapterId &&
    stringAt(payload, 'basePlan', 'id') === request.planId &&
    (request.instanceId === undefined || stringAt(payload, 'instanceId') === request.instanceId)
  );
}

function goalPlanMatches(payload: unknown, request: EvalExportRequest): boolean {
  return (
    stringAt(payload, 'adapterId') === request.targetAdapterId &&
    stringAt(payload, 'planId') === request.planId
  );
}

function goalRequestMatches(payload: unknown, request: EvalExportRequest): boolean {
  return (
    goalPlanMatches(payload, request) &&
    (request.instanceId === undefined || stringAt(payload, 'instanceId') === request.instanceId)
  );
}

function planningProvenanceMatches(
  payload: unknown,
  request: EvalExportRequest,
  goalScopedPlan: boolean,
): boolean {
  if (request.instanceId === undefined) {
    return true;
  }
  const targetInstanceId = stringAt(payload, 'targetInstanceId');
  return targetInstanceId === null ? !goalScopedPlan : targetInstanceId === request.instanceId;
}

function planningContextMatches(
  payload: unknown,
  request: EvalExportRequest,
  goalScopedPlan: boolean,
): boolean {
  return (
    stringAt(payload, 'context', 'targetAdapterId') === request.targetAdapterId &&
    stringAt(payload, 'context', 'requestedPlanId') === request.planId &&
    planningProvenanceMatches(payload, request, goalScopedPlan)
  );
}

function planningPromptMatches(
  payload: unknown,
  request: EvalExportRequest,
  goalScopedPlan: boolean,
): boolean {
  return (
    stringAt(payload, 'packet', 'context', 'targetAdapterId') === request.targetAdapterId &&
    stringAt(payload, 'packet', 'context', 'requestedPlanId') === request.planId &&
    planningProvenanceMatches(payload, request, goalScopedPlan)
  );
}

function plannerGenerationMatches(
  payload: unknown,
  request: EvalExportRequest,
  goalScopedPlan: boolean,
): boolean {
  return (
    stringAt(payload, 'targetAdapterId') === request.targetAdapterId &&
    stringAt(payload, 'planId') === request.planId &&
    planningProvenanceMatches(payload, request, goalScopedPlan)
  );
}

function replanningContextMatches(payload: unknown, request: EvalExportRequest): boolean {
  return (
    stringAt(payload, 'context', 'revisionRequest', 'adapterId') === request.targetAdapterId &&
    stringAt(payload, 'context', 'revisionRequest', 'basePlan', 'id') === request.planId &&
    (request.instanceId === undefined ||
      stringAt(payload, 'context', 'revisionRequest', 'instanceId') === request.instanceId)
  );
}

function replanningPromptMatches(payload: unknown, request: EvalExportRequest): boolean {
  return (
    stringAt(payload, 'packet', 'context', 'revisionRequest', 'adapterId') ===
      request.targetAdapterId &&
    stringAt(payload, 'packet', 'context', 'revisionRequest', 'basePlan', 'id') ===
      request.planId &&
    (request.instanceId === undefined ||
      stringAt(payload, 'packet', 'context', 'revisionRequest', 'instanceId') ===
        request.instanceId)
  );
}

function plannerReplanGenerationMatches(payload: unknown, request: EvalExportRequest): boolean {
  const adapterId =
    stringAt(payload, 'targetAdapterId') ?? stringAt(payload, 'result', 'targetAdapterId');
  const planId = stringAt(payload, 'planId') ?? stringAt(payload, 'result', 'draft', 'plan', 'id');
  const instanceId =
    stringAt(payload, 'targetInstanceId') ?? stringAt(payload, 'result', 'targetInstanceId');
  return (
    adapterId === request.targetAdapterId &&
    planId === request.planId &&
    (request.instanceId === undefined || instanceId === request.instanceId)
  );
}

function planningQualityMatches(
  payload: unknown,
  request: EvalExportRequest,
  goalScopedPlan: boolean,
): boolean {
  if (
    stringAt(payload, 'targetAdapterId') !== request.targetAdapterId ||
    stringAt(payload, 'plan', 'id') !== request.planId
  ) {
    return false;
  }
  if (request.instanceId === undefined) {
    return true;
  }
  const targetInstanceId = stringAt(payload, 'targetInstanceId');
  const isReplanEvaluation =
    stringAt(payload, 'revisionRequestId') !== null ||
    stringAt(payload, 'generationRequestId') !== null;
  return targetInstanceId === null
    ? !goalScopedPlan && !isReplanEvaluation
    : targetInstanceId === request.instanceId;
}

function publishedPlanMatches(payload: unknown, request: EvalExportRequest): boolean {
  const plan = recordAt(payload, 'plan');
  const planId = stringAt(plan, 'id') ?? stringAt(payload, 'planId');
  if (planId !== request.planId) {
    return false;
  }
  const adapterId = stringAt(payload, 'targetAdapterId') ?? planAdapterId(plan);
  return adapterId === null || adapterId === request.targetAdapterId;
}

function procedureLeafReplayProposalMatches(payload: unknown, request: EvalExportRequest): boolean {
  const targetInstanceId = stringAt(payload, 'targetInstanceId');
  return (
    targetInstanceId !== null &&
    stringAt(payload, 'proposal', 'targetAdapterId') === request.targetAdapterId &&
    stringAt(payload, 'proposal', 'plan', 'id') === request.planId &&
    (request.instanceId === undefined || targetInstanceId === request.instanceId)
  );
}

function procedureLeafReplayAttestationMatches(
  payload: unknown,
  request: EvalExportRequest,
): boolean {
  const instanceId = stringAt(payload, 'execution', 'host', 'instanceId');
  return (
    instanceId !== null &&
    stringAt(payload, 'execution', 'host', 'adapterId') === request.targetAdapterId &&
    stringAt(payload, 'execution', 'plan', 'id') === request.planId &&
    (request.instanceId === undefined || instanceId === request.instanceId)
  );
}

function procedureLeafReplayCurrentStateMatches(
  payload: unknown,
  request: EvalExportRequest,
): boolean {
  const embeddedRequest = recordAt(payload, 'request') ?? payload;
  const instanceId = stringAt(embeddedRequest, 'target', 'instanceId');
  return (
    instanceId !== null &&
    stringAt(embeddedRequest, 'target', 'adapterId') === request.targetAdapterId &&
    stringAt(embeddedRequest, 'plan', 'id') === request.planId &&
    (request.instanceId === undefined || instanceId === request.instanceId)
  );
}

function collectRelations(events: readonly StoredExecutionEvent[], request: EvalExportRequest) {
  const proposalPayloads = new Map<string, unknown>();
  const revisionRequestPayloads = new Map<string, unknown>();
  const goalRequestPayloads = new Map<string, unknown>();
  const links: Array<{ requestId: string; proposalId: string }> = [];

  for (const event of events) {
    if (event.eventType === 'guide.proposal.created') {
      const proposalId = stringAt(event.payload, 'proposalId');
      if (proposalId !== null) {
        proposalPayloads.set(proposalId, event.payload);
      }
    } else if (event.eventType === 'guide.revision.requested') {
      const requestId = stringAt(event.payload, 'requestId');
      if (requestId !== null) {
        revisionRequestPayloads.set(requestId, event.payload);
      }
    } else if (event.eventType === 'guide.goal.requested') {
      const requestId = stringAt(event.payload, 'requestId');
      if (requestId !== null) {
        goalRequestPayloads.set(requestId, event.payload);
      }
    } else if (event.eventType === 'guide.revision.proposed') {
      const requestId = stringAt(event.payload, 'requestId');
      const proposalId = stringAt(event.payload, 'proposalId');
      if (requestId !== null && proposalId !== null) {
        links.push({ requestId, proposalId });
      }
    } else if (event.eventType === 'guide.goal.proposed') {
      const requestId = stringAt(event.payload, 'requestId');
      const proposalId = stringAt(event.payload, 'proposalId');
      if (requestId !== null && proposalId !== null) {
        links.push({ requestId, proposalId });
      }
    }
  }

  const proposalIds = new Set(
    [...proposalPayloads.entries()]
      .filter(([, payload]) => proposalMatches(payload, request))
      .map(([proposalId]) => proposalId),
  );
  const requestIds = new Set(
    [...revisionRequestPayloads.entries()]
      .filter(([, payload]) => revisionRequestMatches(payload, request))
      .map(([requestId]) => requestId),
  );
  const goalScopedPlan = [...goalRequestPayloads.values()].some((payload) =>
    goalPlanMatches(payload, request),
  );
  for (const [requestId, payload] of goalRequestPayloads) {
    if (goalRequestMatches(payload, request)) {
      requestIds.add(requestId);
    }
  }

  for (const proposalId of proposalIds) {
    const revisionRequestId = stringAt(proposalPayloads.get(proposalId), 'revisionRequestId');
    if (revisionRequestId !== null) {
      requestIds.add(revisionRequestId);
    }
    const goalRequestId = stringAt(proposalPayloads.get(proposalId), 'goalRequestId');
    if (goalRequestId !== null) {
      requestIds.add(goalRequestId);
    }
  }
  for (const link of links) {
    if (requestIds.has(link.requestId) || proposalIds.has(link.proposalId)) {
      requestIds.add(link.requestId);
      proposalIds.add(link.proposalId);
    }
  }

  return { proposalIds, requestIds, goalScopedPlan };
}

function eventMatches(
  event: StoredExecutionEvent,
  request: EvalExportRequest,
  proposalIds: ReadonlySet<string>,
  requestIds: ReadonlySet<string>,
  goalScopedPlan: boolean,
): boolean {
  switch (event.eventType) {
    case 'planning.context.generated':
      return planningContextMatches(event.payload, request, goalScopedPlan);
    case 'planning.prompt.generated':
      return planningPromptMatches(event.payload, request, goalScopedPlan);
    case 'planning.replan.context.generated':
      return replanningContextMatches(event.payload, request);
    case 'planning.replan.prompt.generated':
      return replanningPromptMatches(event.payload, request);
    case 'planning.provider.generation.requested':
    case 'planning.provider.generation.completed':
    case 'planning.provider.generation.failed':
      return plannerGenerationMatches(event.payload, request, goalScopedPlan);
    case 'planning.provider.generation.proposed': {
      const goalRequestId = stringAt(event.payload, 'goalRequestId');
      const proposalId = stringAt(event.payload, 'proposalId');
      return (
        (goalRequestId !== null && requestIds.has(goalRequestId)) ||
        (proposalId !== null && proposalIds.has(proposalId))
      );
    }
    case 'planning.provider.replan.requested':
    case 'planning.provider.replan.completed':
    case 'planning.provider.replan.failed':
      return plannerReplanGenerationMatches(event.payload, request);
    case 'planning.provider.replan.proposed': {
      const revisionRequestId = stringAt(event.payload, 'revisionRequestId');
      const proposalId = stringAt(event.payload, 'proposalId');
      return (
        (revisionRequestId !== null && requestIds.has(revisionRequestId)) ||
        (proposalId !== null && proposalIds.has(proposalId))
      );
    }
    case 'planning.quality.evaluated':
      return planningQualityMatches(event.payload, request, goalScopedPlan);
    case 'guide.plan.published':
      return publishedPlanMatches(event.payload, request);
    case 'guide.proposal.created': {
      const proposalId = stringAt(event.payload, 'proposalId');
      return proposalId !== null && proposalIds.has(proposalId);
    }
    case 'guide.proposal.decided': {
      const proposalId = stringAt(event.payload, 'proposalId');
      return (
        proposalId !== null &&
        proposalIds.has(proposalId) &&
        stringAt(event.payload, 'adapterId') === request.targetAdapterId &&
        (request.instanceId === undefined ||
          stringAt(event.payload, 'instanceId') === request.instanceId)
      );
    }
    case 'guide.revision.requested': {
      const requestId = stringAt(event.payload, 'requestId');
      return requestId !== null && requestIds.has(requestId);
    }
    case 'guide.revision.proposed': {
      const requestId = stringAt(event.payload, 'requestId');
      const proposalId = stringAt(event.payload, 'proposalId');
      return (
        (requestId !== null && requestIds.has(requestId)) ||
        (proposalId !== null && proposalIds.has(proposalId))
      );
    }
    case 'guide.goal.requested': {
      const requestId = stringAt(event.payload, 'requestId');
      return requestId !== null && requestIds.has(requestId);
    }
    case 'guide.goal.proposed': {
      const requestId = stringAt(event.payload, 'requestId');
      const proposalId = stringAt(event.payload, 'proposalId');
      return (
        (requestId !== null && requestIds.has(requestId)) ||
        (proposalId !== null && proposalIds.has(proposalId))
      );
    }
    case 'companion.initial-plan-run.authorized':
    case 'companion.initial-plan-run.transitioned': {
      const goalRequestId = stringAt(event.payload, 'goalRequestId');
      return goalRequestId !== null && requestIds.has(goalRequestId);
    }
    case 'companion.state.reported':
      return (
        stringAt(event.payload, 'adapterId') === request.targetAdapterId &&
        stringAt(event.payload, 'plan', 'id') === request.planId &&
        (request.instanceId === undefined ||
          stringAt(event.payload, 'instanceId') === request.instanceId)
      );
    case 'procedure.leaf-replay.proposed':
      return procedureLeafReplayProposalMatches(event.payload, request);
    case 'procedure.leaf-replay.attested':
      return procedureLeafReplayAttestationMatches(event.payload, request);
    case 'procedure.leaf-replay.current-state.requested':
    case 'procedure.leaf-replay.current-state.completed':
      return procedureLeafReplayCurrentStateMatches(event.payload, request);
    default:
      return false;
  }
}

function compareCatalogVersions(left: string, right: string): number {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = leftParts[index]! - rightParts[index]!;
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

function resolveCatalogs(
  request: EvalExportRequest,
  events: readonly StoredExecutionEvent[],
  availableCatalogs: readonly ActionCatalog[],
): ActionCatalog[] {
  const catalogsByVersion = new Map<string, ActionCatalog>();
  const rememberCatalog = (catalog: ActionCatalog) => {
    const existing = catalogsByVersion.get(catalog.catalogVersion);
    if (
      existing !== undefined &&
      canonicalizeEvalContent(existing) !== canonicalizeEvalContent(catalog)
    ) {
      throw new Error(
        `Conflicting action catalog payloads reuse ${catalog.adapterId}@${catalog.catalogVersion}`,
      );
    }
    catalogsByVersion.set(catalog.catalogVersion, catalog);
  };
  for (const catalogInput of availableCatalogs) {
    const catalog = actionCatalogSchema.parse(catalogInput);
    if (catalog.adapterId === request.targetAdapterId) {
      rememberCatalog(catalog);
    }
  }

  const referencedVersions = new Set<string>();
  for (const event of events) {
    const embeddedCatalog = recordAt(event.payload, 'context', 'catalog');
    const parsedEmbeddedCatalog = actionCatalogSchema.safeParse(embeddedCatalog);
    if (
      parsedEmbeddedCatalog.success &&
      parsedEmbeddedCatalog.data.adapterId === request.targetAdapterId
    ) {
      rememberCatalog(parsedEmbeddedCatalog.data);
      referencedVersions.add(parsedEmbeddedCatalog.data.catalogVersion);
    }
    const catalogVersion = stringAt(event.payload, 'catalogVersion');
    if (catalogVersion !== null) {
      referencedVersions.add(catalogVersion);
    }
  }

  if (referencedVersions.size === 0) {
    const latestVersion = [...catalogsByVersion.keys()].sort(compareCatalogVersions).at(-1);
    if (latestVersion !== undefined) {
      referencedVersions.add(latestVersion);
    }
  }
  if (referencedVersions.size === 0) {
    throw new Error(`No action catalog is available for eval target ${request.targetAdapterId}`);
  }

  return [...referencedVersions].sort(compareCatalogVersions).map((version) => {
    const catalog = catalogsByVersion.get(version);
    if (catalog === undefined) {
      throw new Error(
        `Eval export cannot resolve action catalog ${request.targetAdapterId}@${version}`,
      );
    }
    return catalog;
  });
}

function incrementCount(counts: Map<string, number>, value: string | null): void {
  if (value !== null) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
}

function sortedCounts(counts: ReadonlyMap<string, number>): Record<string, number> {
  return Object.fromEntries([...counts].sort(([left], [right]) => left.localeCompare(right)));
}

function summarize(events: readonly StoredExecutionEvent[]) {
  const eventTypeCounts = new Map<string, number>();
  const transitionCounts = new Map<string, number>();
  const decisionCounts = new Map<string, number>();
  for (const event of events) {
    incrementCount(eventTypeCounts, event.eventType);
    if (event.eventType === 'companion.state.reported') {
      incrementCount(transitionCounts, stringAt(event.payload, 'transition'));
    } else if (event.eventType === 'guide.proposal.decided') {
      incrementCount(decisionCounts, stringAt(event.payload, 'decision'));
    }
  }
  return {
    matchedEventCount: events.length,
    eventTypeCounts: sortedCounts(eventTypeCounts),
    transitionCounts: sortedCounts(transitionCounts),
    decisionCounts: sortedCounts(decisionCounts),
  };
}

function normalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeJson);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => [key, normalizeJson(entry)]),
    );
  }
  return value;
}

export function canonicalizeEvalContent(value: unknown): string {
  const serialized = JSON.stringify(normalizeJson(value));
  if (serialized === undefined) {
    throw new Error('Eval content must be JSON serializable');
  }
  return serialized;
}

export function computeEvalContentSha256(value: unknown): string {
  return createHash('sha256').update(canonicalizeEvalContent(value)).digest('hex');
}

export function computePlanContentSha256(value: unknown): string {
  return createHash('sha256').update(canonicalizeProtocolJsonValue(value)).digest('hex');
}

function evalSnapshotId(value: unknown): string {
  const digest = createHash('sha256').update(canonicalizeEvalContent(value)).digest('hex');
  const variant = ((Number.parseInt(digest[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-${variant}${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

export function readExecutionEventLedger(database: OperatingLineDatabase): StoredExecutionEvent[] {
  const events: StoredExecutionEvent[] = [];
  let afterSequence = 0;
  while (true) {
    const page = database.listExecutionEvents(afterSequence, 10_000);
    events.push(...page);
    if (page.length < 10_000) {
      return events;
    }
    const nextSequence = page.at(-1)?.sequence;
    if (nextSequence === undefined || nextSequence <= afterSequence) {
      throw new Error('Execution event ledger did not advance its sequence cursor');
    }
    afterSequence = nextSequence;
  }
}

export function createEvalExport(options: EvalExportOptions): CurrentEvalExportBundle {
  const ledgerUpperSequence = options.events.reduce(
    (maximum, event) => Math.max(maximum, event.sequence),
    0,
  );
  const snapshotUpperSequence = options.request.snapshotUpperSequence ?? ledgerUpperSequence;
  if (snapshotUpperSequence > ledgerUpperSequence) {
    throw new Error(
      `Eval snapshot upper sequence ${snapshotUpperSequence} exceeds ledger sequence ${ledgerUpperSequence}`,
    );
  }
  const snapshotEvents = options.events.filter((event) => event.sequence <= snapshotUpperSequence);
  const relations = collectRelations(snapshotEvents, options.request);
  const matchingEvents = snapshotEvents.filter((event) =>
    eventMatches(
      event,
      options.request,
      relations.proposalIds,
      relations.requestIds,
      relations.goalScopedPlan,
    ),
  );
  const pageCandidates = matchingEvents.filter(
    (event) => event.sequence > options.request.afterSequence,
  );
  const hasMore = pageCandidates.length > options.request.limit;
  const pageEvents = pageCandidates
    .slice(0, options.request.limit)
    .map((event): EvalExecutionEvent => evalExecutionEventSchema.parse(event));
  const nextAfterSequence = pageEvents.at(-1)?.sequence ?? options.request.afterSequence;
  const catalogs = resolveCatalogs(options.request, matchingEvents, options.availableCatalogs);
  const snapshotId = evalSnapshotId({
    formatVersion: evalExportFormatVersion,
    scope: {
      targetAdapterId: options.request.targetAdapterId,
      planId: options.request.planId,
      instanceId: options.request.instanceId ?? null,
    },
    snapshotUpperSequence,
    catalogs,
  });
  if (options.request.snapshotId !== undefined && options.request.snapshotId !== snapshotId) {
    throw new Error(
      'Eval snapshotId does not match the requested scope, upper sequence, or catalogs',
    );
  }
  const content = {
    protocolVersion: guideProtocolVersion,
    formatVersion: evalExportFormatVersion,
    scope: {
      targetAdapterId: options.request.targetAdapterId,
      planId: options.request.planId,
      instanceId: options.request.instanceId ?? null,
    },
    catalogs,
    events: pageEvents,
    page: {
      snapshotId,
      snapshotUpperSequence,
      afterSequence: options.request.afterSequence,
      nextAfterSequence,
      hasMore,
    },
    summary: summarize(matchingEvents),
    dataHandling,
  };

  return currentEvalExportBundleSchema.parse({
    ...content,
    exportId: options.exportId,
    exportedAt: options.exportedAt,
    integrity: {
      algorithm: 'sha256',
      canonicalization: 'operatingline-json-sort-v1',
      contentSha256: computeEvalContentSha256(content),
    },
  });
}
