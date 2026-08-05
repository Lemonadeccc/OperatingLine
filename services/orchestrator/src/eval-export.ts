import { createHash } from 'node:crypto';

import type { OperatingLineDatabase, StoredExecutionEvent } from '@operatingline/persistence';
import {
  actionCatalogSchema,
  evalExecutionEventSchema,
  evalExportBundleSchema,
  evalExportFormatVersion,
  guideProtocolVersion,
  type ActionCatalog,
  type EvalExecutionEvent,
  type EvalExportBundle,
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

function planningContextMatches(payload: unknown, request: EvalExportRequest): boolean {
  return (
    stringAt(payload, 'context', 'targetAdapterId') === request.targetAdapterId &&
    stringAt(payload, 'context', 'requestedPlanId') === request.planId
  );
}

function planningPromptMatches(payload: unknown, request: EvalExportRequest): boolean {
  return (
    stringAt(payload, 'packet', 'context', 'targetAdapterId') === request.targetAdapterId &&
    stringAt(payload, 'packet', 'context', 'requestedPlanId') === request.planId
  );
}

function plannerGenerationMatches(payload: unknown, request: EvalExportRequest): boolean {
  return (
    stringAt(payload, 'targetAdapterId') === request.targetAdapterId &&
    stringAt(payload, 'planId') === request.planId
  );
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

function collectRelations(events: readonly StoredExecutionEvent[], request: EvalExportRequest) {
  const proposalPayloads = new Map<string, unknown>();
  const revisionRequestPayloads = new Map<string, unknown>();
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
    } else if (event.eventType === 'guide.revision.proposed') {
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

  for (const proposalId of proposalIds) {
    const revisionRequestId = stringAt(proposalPayloads.get(proposalId), 'revisionRequestId');
    if (revisionRequestId !== null) {
      requestIds.add(revisionRequestId);
    }
  }
  for (const link of links) {
    if (requestIds.has(link.requestId) || proposalIds.has(link.proposalId)) {
      requestIds.add(link.requestId);
      proposalIds.add(link.proposalId);
    }
  }

  return { proposalIds, requestIds };
}

function eventMatches(
  event: StoredExecutionEvent,
  request: EvalExportRequest,
  proposalIds: ReadonlySet<string>,
  requestIds: ReadonlySet<string>,
): boolean {
  switch (event.eventType) {
    case 'planning.context.generated':
      return planningContextMatches(event.payload, request);
    case 'planning.prompt.generated':
      return planningPromptMatches(event.payload, request);
    case 'planning.provider.generation.requested':
    case 'planning.provider.generation.completed':
    case 'planning.provider.generation.failed':
      return plannerGenerationMatches(event.payload, request);
    case 'planning.quality.evaluated':
      return (
        stringAt(event.payload, 'targetAdapterId') === request.targetAdapterId &&
        stringAt(event.payload, 'plan', 'id') === request.planId
      );
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
    case 'companion.state.reported':
      return (
        stringAt(event.payload, 'adapterId') === request.targetAdapterId &&
        stringAt(event.payload, 'plan', 'id') === request.planId &&
        (request.instanceId === undefined ||
          stringAt(event.payload, 'instanceId') === request.instanceId)
      );
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

export function createEvalExport(options: EvalExportOptions): EvalExportBundle {
  const relations = collectRelations(options.events, options.request);
  const matchingEvents = options.events.filter((event) =>
    eventMatches(event, options.request, relations.proposalIds, relations.requestIds),
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
      afterSequence: options.request.afterSequence,
      nextAfterSequence,
      hasMore,
    },
    summary: summarize(matchingEvents),
    dataHandling,
  };

  return evalExportBundleSchema.parse({
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
