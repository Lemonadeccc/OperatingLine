import { createHash, randomUUID } from 'node:crypto';

import type { ExecutionEventInput, StoredExecutionEvent } from '@operatingline/persistence';
import {
  canonicalizeProtocolJsonValue,
  procedureSemanticRetrievalCompletedEventSchema,
  procedureSemanticRetrievalFailedEventSchema,
  procedureSemanticRetrievalProviderDisclosureListSchema,
  procedureSemanticRetrievalRequestSchema,
  procedureSemanticRetrievalRequestedEventSchema,
  procedureSemanticRetrievalResultSchema,
  procedureTreeSummarySchema,
  storedProcedureTreeSchema,
  type PlannerProviderDescriptor,
  type ProcedureLeafNode,
  type ProcedureSemanticRetrievalRequest,
  type ProcedureSemanticRetrievalErrorCode,
  type ProcedureSemanticRetrievalProviderDisclosureList,
  type ProcedureSemanticRetrievalResult,
  type ProcedureTree,
  type ProcedureTreeSummary,
  type StoredProcedureTree,
} from '@operatingline/protocol';

import {
  computePlannerProviderAttestationSha256,
  createPlannerProviderRuntimeOutputAttestation,
  snapshotPlannerProviderRuntimeTreatment,
} from './planner-provider-attestation.js';
import {
  createPlannerProviderInvocationManager,
  plannerProviderRequestFingerprint,
  type PlannerProviderInvocationManager,
  type RestoredPlannerProviderInvocation,
} from './planner-provider-invocation.js';
import {
  PlannerGenerationRuntimeError,
  safePlannerRuntimeError,
} from './planner-provider-errors.js';
import type { PlannerProviderRegistry } from './planner-provider-registry.js';

const maximumCorpusLeaves = 256;
const maximumDocumentBytes = 32 * 1024;
const corpusId = 'stored-procedure-latest-leaves';
const corpusVersion = '1.0.0';

export const procedureSemanticRetrievalEvidenceEventTypes = [
  'procedure.semantic.retrieval.requested',
  'procedure.semantic.retrieval.completed',
  'procedure.semantic.retrieval.failed',
] as const;

export interface ProcedureSemanticRetrievalCoordinatorOptions {
  readonly registry: PlannerProviderRegistry;
  readonly timeoutMs?: number;
  readonly invocationManager?: PlannerProviderInvocationManager;
  readonly existingEvents: readonly StoredExecutionEvent[];
  readonly listProcedureTrees: () => readonly ProcedureTreeSummary[];
  readonly getProcedureTree: (treeId: string, revision: number) => StoredProcedureTree | null;
  readonly appendEvent: (event: ExecutionEventInput) => void;
  readonly now?: () => Date;
}

export interface ProcedureSemanticRetrievalCoordinator {
  listProviders(): ProcedureSemanticRetrievalProviderDisclosureList;
  search(request: ProcedureSemanticRetrievalRequest): Promise<ProcedureSemanticRetrievalResult>;
  completedResult(requestId: string): ProcedureSemanticRetrievalResult | null;
  close(): Promise<void>;
}

interface CorpusDocument {
  readonly summary: ProcedureTreeSummary;
  readonly path: ProcedureSemanticRetrievalResult['hits'][number]['nodePath'];
  readonly leaf: ProcedureLeafNode;
  readonly text: string;
  readonly contentSha256: string;
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalSha256(value: unknown): string {
  return sha256(canonicalizeProtocolJsonValue(value));
}

function descriptorsMatch(
  left: PlannerProviderDescriptor,
  right: PlannerProviderDescriptor,
): boolean {
  return canonicalSha256(left) === canonicalSha256(right);
}

function boundedUtf8(text: string): string {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.byteLength <= maximumDocumentBytes) return text;
  throw new PlannerGenerationRuntimeError(
    'planner_catalog_invalid',
    `Procedure leaf embedding document exceeds ${maximumDocumentBytes} bytes; narrow the retrieval filters`,
    'same_request_id',
  );
}

function availableTrackProjection(leaf: ProcedureLeafNode): object {
  return {
    menu: leaf.menuTracks
      .filter((track) => track.availability === 'available')
      .map((track) => ({ title: track.title, operations: track.operations })),
    shortcut: leaf.shortcutTracks
      .filter((track) => track.availability === 'available')
      .map((track) => ({ title: track.title, operations: track.operations })),
    mcp: leaf.mcpTracks
      .filter((track) => track.availability === 'available')
      .map((track) => ({ title: track.title, operations: track.operations })),
  };
}

function nodePath(tree: ProcedureTree, leaf: ProcedureLeafNode): CorpusDocument['path'] {
  const nodes = new Map(tree.nodes.map((node) => [node.id, node]));
  const reversed: CorpusDocument['path'][number][] = [];
  let current = nodes.get(leaf.id);
  const visited = new Set<string>();
  while (current !== undefined) {
    if (visited.has(current.id)) {
      throw new Error(`Procedure tree ${tree.id} contains a cyclic node path`);
    }
    visited.add(current.id);
    reversed.push({
      id: current.id,
      kind: current.kind,
      order: current.order,
      title: current.title,
    });
    current = current.parentId === null ? undefined : nodes.get(current.parentId);
  }
  if (reversed.at(-1)?.id !== tree.rootNodeId) {
    throw new Error(`Procedure leaf ${leaf.id} is not connected to root ${tree.rootNodeId}`);
  }
  return reversed.reverse();
}

function documentText(
  summary: ProcedureTreeSummary,
  path: CorpusDocument['path'],
  leaf: ProcedureLeafNode,
): string {
  // Deliberately excludes source and evidence text. Full provenance remains on the public hit.
  return boundedUtf8(
    Buffer.from(
      canonicalizeProtocolJsonValue({
        tree: {
          id: summary.treeId,
          revision: summary.revision,
          title: summary.title,
          adapterId: summary.adapterId,
          actionCatalogVersion: summary.actionCatalogVersion,
          interactionCatalogVersion: summary.interactionCatalogVersion,
        },
        path,
        leaf: {
          id: leaf.id,
          title: leaf.title,
          intent: leaf.intent,
          action: leaf.action,
          semanticOperations: leaf.semanticOperations,
          interactions: availableTrackProjection(leaf),
          validationStatus: leaf.validation.status,
        },
      }),
    ).toString('utf8'),
  );
}

function compareProtocolText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function comparePath(left: CorpusDocument['path'], right: CorpusDocument['path']): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const leftNode = left[index];
    const rightNode = right[index];
    if (leftNode === undefined) return -1;
    if (rightNode === undefined) return 1;
    if (leftNode.order !== rightNode.order) return leftNode.order - rightNode.order;
    const idOrder = compareProtocolText(leftNode.id, rightNode.id);
    if (idOrder !== 0) return idOrder;
  }
  return 0;
}

function compareDocumentIdentity(left: CorpusDocument, right: CorpusDocument): number {
  return (
    compareProtocolText(left.summary.treeId, right.summary.treeId) ||
    left.summary.revision - right.summary.revision ||
    comparePath(left.path, right.path) ||
    compareProtocolText(left.leaf.id, right.leaf.id)
  );
}

function buildCorpus(
  request: ProcedureSemanticRetrievalRequest,
  options: Pick<
    ProcedureSemanticRetrievalCoordinatorOptions,
    'listProcedureTrees' | 'getProcedureTree'
  >,
): CorpusDocument[] {
  const summaries = options.listProcedureTrees().map((summary) => {
    const parsed = procedureTreeSummarySchema.safeParse(structuredClone(summary));
    if (!parsed.success) {
      throw new PlannerGenerationRuntimeError(
        'planner_catalog_invalid',
        'Stored ProcedureTree summary violates the public storage contract',
        'same_request_id',
      );
    }
    return parsed.data;
  });
  const identities = new Map<string, ProcedureTreeSummary>();
  for (const summary of summaries) {
    const identity = `${summary.treeId}\u0000${summary.revision}`;
    if (identities.has(identity)) {
      throw new PlannerGenerationRuntimeError(
        'planner_catalog_invalid',
        `Stored ProcedureTree summary identity ${summary.treeId}@${summary.revision} is duplicated`,
        'same_request_id',
      );
    }
    identities.set(identity, summary);
  }

  const latest = new Map<string, ProcedureTreeSummary>();
  for (const summary of summaries) {
    const current = latest.get(summary.treeId);
    if (current === undefined || summary.revision > current.revision) {
      latest.set(summary.treeId, summary);
    }
  }

  const validationStatus = request.filters?.validationStatus ?? 'verified';
  const documents: CorpusDocument[] = [];
  for (const summary of latest.values()) {
    if (
      (request.filters?.adapterId !== undefined &&
        summary.adapterId !== request.filters.adapterId) ||
      (request.filters?.actionCatalogVersion !== undefined &&
        summary.actionCatalogVersion !== request.filters.actionCatalogVersion) ||
      (request.filters?.interactionCatalogVersion !== undefined &&
        summary.interactionCatalogVersion !== request.filters.interactionCatalogVersion)
    ) {
      continue;
    }
    const recordInput = options.getProcedureTree(summary.treeId, summary.revision);
    const parsedRecord =
      recordInput === null ? null : storedProcedureTreeSchema.safeParse(recordInput);
    if (parsedRecord !== null && !parsedRecord.success) {
      throw new PlannerGenerationRuntimeError(
        'planner_catalog_invalid',
        `Stored ProcedureTree ${summary.treeId}@${summary.revision} violates the public storage contract`,
        'same_request_id',
      );
    }
    const record = parsedRecord?.data ?? null;
    if (
      record === null ||
      record.tree.id !== summary.treeId ||
      record.tree.revision !== summary.revision ||
      record.integrity.contentSha256 !== summary.integrity.contentSha256 ||
      canonicalSha256(record.tree) !== summary.integrity.contentSha256
    ) {
      throw new PlannerGenerationRuntimeError(
        'planner_catalog_invalid',
        `Stored ProcedureTree ${summary.treeId}@${summary.revision} does not match its summary`,
        'same_request_id',
      );
    }
    for (const leaf of record.tree.nodes) {
      if (leaf.kind !== 'leaf' || leaf.validation.status !== validationStatus) continue;
      if (documents.length === maximumCorpusLeaves) {
        throw new PlannerGenerationRuntimeError(
          'planner_catalog_invalid',
          `Semantic retrieval corpus exceeds ${maximumCorpusLeaves} leaves; narrow the filters`,
          'same_request_id',
        );
      }
      const path = nodePath(record.tree, leaf);
      const text = documentText(summary, path, leaf);
      documents.push({
        summary,
        path,
        leaf,
        text,
        contentSha256: sha256(text),
      });
    }
  }
  documents.sort(compareDocumentIdentity);
  if (documents.length === 0) {
    throw new PlannerGenerationRuntimeError(
      'planner_catalog_invalid',
      'No stored Procedure leaf matches the semantic retrieval filters',
      'same_request_id',
    );
  }
  return documents;
}

function evidenceErrorCode(
  error: PlannerGenerationRuntimeError,
): ProcedureSemanticRetrievalErrorCode {
  switch (error.code) {
    case 'planner_provider_not_found':
      return 'semantic_retrieval_provider_not_found';
    case 'planner_provider_unavailable':
      return 'semantic_retrieval_provider_unavailable';
    case 'planner_procedure_embedding_not_supported':
      return 'semantic_retrieval_not_supported';
    case 'planner_catalog_invalid':
      return 'semantic_retrieval_corpus_unavailable';
    case 'planner_output_invalid':
      return 'semantic_retrieval_output_invalid';
    case 'planner_generation_conflict':
    case 'planner_identity_mismatch':
      return 'semantic_retrieval_conflict';
    case 'planner_generation_already_attempted':
      return 'semantic_retrieval_already_attempted';
    case 'planner_persistence_failed':
      return 'semantic_retrieval_persistence_failed';
    case 'planner_provider_failed':
    case 'planner_generation_timeout':
      return 'semantic_retrieval_embedding_failed';
    default:
      return 'semantic_retrieval_internal_failed';
  }
}

function validateVectors(value: unknown, expectedCount: number): number[][] {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).length !== 1 ||
    Object.keys(value)[0] !== 'vectors' ||
    !Array.isArray((value as { vectors?: unknown }).vectors)
  ) {
    throw new PlannerGenerationRuntimeError(
      'planner_output_invalid',
      'Procedure embedding provider returned no vector array',
      'new_request_id',
    );
  }
  const vectors = (value as { vectors: unknown[] }).vectors;
  const dimension = Array.isArray(vectors[0]) ? vectors[0].length : 0;
  if (
    vectors.length !== expectedCount ||
    dimension < 1 ||
    dimension > 4096 ||
    vectors.some(
      (vector) =>
        !Array.isArray(vector) ||
        vector.length !== dimension ||
        vector.some((component) => typeof component !== 'number' || !Number.isFinite(component)) ||
        vector.every((component) => component === 0),
    )
  ) {
    throw new PlannerGenerationRuntimeError(
      'planner_output_invalid',
      'Procedure embedding provider returned invalid vector dimensions or values',
      'new_request_id',
    );
  }
  return vectors as number[][];
}

function cosine(left: readonly number[], right: readonly number[]): number {
  let dot = 0;
  let leftSquared = 0;
  let rightSquared = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index]! * right[index]!;
    leftSquared += left[index]! ** 2;
    rightSquared += right[index]! ** 2;
  }
  const score = dot / (Math.sqrt(leftSquared) * Math.sqrt(rightSquared));
  if (!Number.isFinite(score)) {
    throw new PlannerGenerationRuntimeError(
      'planner_output_invalid',
      'Procedure embedding cosine similarity is not finite',
      'new_request_id',
    );
  }
  return Math.max(-1, Math.min(1, score));
}

function evidenceScope(value: object): object {
  const scope = { ...value } as Record<string, unknown>;
  delete scope['occurredAt'];
  delete scope['result'];
  delete scope['resultContentSha256'];
  delete scope['error'];
  return scope;
}

export function restoreProcedureSemanticRetrievalInvocations(
  events: readonly StoredExecutionEvent[],
): RestoredPlannerProviderInvocation[] {
  type Requested = ReturnType<typeof procedureSemanticRetrievalRequestedEventSchema.parse>;
  type Terminal =
    | {
        readonly kind: 'completed';
        readonly value: ReturnType<typeof procedureSemanticRetrievalCompletedEventSchema.parse>;
      }
    | {
        readonly kind: 'failed';
        readonly value: ReturnType<typeof procedureSemanticRetrievalFailedEventSchema.parse>;
      };
  const validateEvidenceScope = (event: Requested | Terminal['value']): void => {
    const runtimeTreatment = event.runtimeTreatment;
    const generationSettings = runtimeTreatment.treatment.generationSettings;
    const descriptor = event.providerDescriptor;
    const treatmentDescriptor = runtimeTreatment.treatment.profile.descriptor;
    const { treatmentContentSha256, ...treatmentContent } = runtimeTreatment;
    if (
      generationSettings.parametersSha256 !==
      computePlannerProviderAttestationSha256(generationSettings.normalizedParameters)
    ) {
      throw new Error('Semantic retrieval runtime parameter digest is invalid');
    }
    if (treatmentContentSha256 !== computePlannerProviderAttestationSha256(treatmentContent)) {
      throw new Error('Semantic retrieval runtime treatment digest is invalid');
    }
    if (
      event.providerId !== descriptor.id ||
      event.providerVersion !== descriptor.version ||
      event.providerDescriptorContentSha256 !== canonicalSha256(descriptor) ||
      !descriptorsMatch(descriptor, treatmentDescriptor)
    ) {
      throw new Error('Semantic retrieval provider evidence identity is invalid');
    }
  };
  const byRequest = new Map<
    string,
    {
      requested?: { readonly sequence: number; readonly value: Requested };
      terminal?: Terminal & { readonly sequence: number };
    }
  >();
  for (const stored of events) {
    if (stored.eventType === 'procedure.semantic.retrieval.requested') {
      const event = procedureSemanticRetrievalRequestedEventSchema.parse(stored.payload);
      validateEvidenceScope(event);
      if (stored.id !== `procedure-semantic-retrieval-requested:${event.requestId}`) {
        throw new Error('Semantic retrieval requested evidence identity is invalid');
      }
      const state = byRequest.get(event.requestId) ?? {};
      if (state.requested !== undefined) {
        throw new Error(`Duplicate semantic retrieval requested evidence for ${event.requestId}`);
      }
      state.requested = { sequence: stored.sequence, value: event };
      byRequest.set(event.requestId, state);
    } else if (stored.eventType === 'procedure.semantic.retrieval.failed') {
      const event = procedureSemanticRetrievalFailedEventSchema.parse(stored.payload);
      validateEvidenceScope(event);
      if (stored.id !== `procedure-semantic-retrieval-failed:${event.requestId}`) {
        throw new Error('Semantic retrieval failed evidence identity is invalid');
      }
      const state = byRequest.get(event.requestId) ?? {};
      if (state.terminal !== undefined) {
        throw new Error(`Duplicate semantic retrieval terminal evidence for ${event.requestId}`);
      }
      state.terminal = { kind: 'failed', sequence: stored.sequence, value: event };
      byRequest.set(event.requestId, state);
    } else if (stored.eventType === 'procedure.semantic.retrieval.completed') {
      const event = procedureSemanticRetrievalCompletedEventSchema.parse(stored.payload);
      validateEvidenceScope(event);
      if (
        stored.id !== `procedure-semantic-retrieval-completed:${event.requestId}` ||
        event.resultContentSha256 !== canonicalSha256(event.result)
      ) {
        throw new Error('Semantic retrieval completed evidence integrity is invalid');
      }
      const state = byRequest.get(event.requestId) ?? {};
      if (state.terminal !== undefined) {
        throw new Error(`Duplicate semantic retrieval terminal evidence for ${event.requestId}`);
      }
      state.terminal = { kind: 'completed', sequence: stored.sequence, value: event };
      byRequest.set(event.requestId, state);
    }
  }

  const restored: RestoredPlannerProviderInvocation[] = [];
  for (const [requestId, state] of byRequest) {
    if (state.requested === undefined) {
      throw new Error(
        `Semantic retrieval terminal evidence has no requested marker for ${requestId}`,
      );
    }
    if (state.terminal !== undefined && state.requested.sequence >= state.terminal.sequence) {
      throw new Error(
        `Semantic retrieval requested evidence must precede terminal evidence for ${requestId}`,
      );
    }
    if (
      state.terminal !== undefined &&
      canonicalSha256(evidenceScope(state.terminal.value)) !==
        canonicalSha256(evidenceScope(state.requested.value))
    ) {
      throw new Error(`Semantic retrieval terminal evidence scope conflicts for ${requestId}`);
    }
    restored.push({
      requestId,
      operation: 'procedure_embedding',
      fingerprint: state.requested.value.requestFingerprint,
      ...(state.terminal?.kind === 'completed' ? { result: state.terminal.value.result } : {}),
    });
  }
  return restored;
}

export function createProcedureSemanticRetrievalCoordinator(
  options: ProcedureSemanticRetrievalCoordinatorOptions,
): ProcedureSemanticRetrievalCoordinator {
  const now = options.now ?? (() => new Date());
  const invocationManager =
    options.invocationManager ??
    createPlannerProviderInvocationManager({
      registry: options.registry,
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      restoredInvocations: restoreProcedureSemanticRetrievalInvocations(options.existingEvents),
    });

  const appendEvidence = (
    event: ExecutionEventInput,
    retryMode: 'same_request_id' | 'new_request_id',
  ) => {
    try {
      options.appendEvent(event);
    } catch {
      throw new PlannerGenerationRuntimeError(
        'planner_persistence_failed',
        'Procedure semantic retrieval evidence could not be persisted',
        retryMode,
      );
    }
  };

  return {
    listProviders: () => {
      const providers = options.registry
        .listProcedureEmbedders()
        .providers.map((providerDescriptor) => {
          const registered = options.registry.findProcedureEmbedder(providerDescriptor.id);
          if (registered === null) {
            throw new PlannerGenerationRuntimeError(
              'planner_provider_not_found',
              `Procedure embedding provider ${providerDescriptor.id} is no longer registered`,
              'same_request_id',
            );
          }
          const runtimeTreatment = snapshotPlannerProviderRuntimeTreatment(
            registered.provider,
            providerDescriptor,
            'procedure_embedding',
          );
          if (runtimeTreatment === undefined) {
            throw new PlannerGenerationRuntimeError(
              'planner_identity_mismatch',
              `Procedure embedding provider ${providerDescriptor.id} did not disclose runtime treatment`,
              'same_request_id',
            );
          }
          return { providerDescriptor, runtimeTreatment };
        })
        .sort((left, right) =>
          compareProtocolText(left.providerDescriptor.id, right.providerDescriptor.id),
        );
      return procedureSemanticRetrievalProviderDisclosureListSchema.parse({
        formatVersion: '1.0.0',
        semanticRetrievalAvailable: providers.some(
          ({ providerDescriptor }) => providerDescriptor.availability.available,
        ),
        providers,
      });
    },
    search: async (requestInput) => {
      const request = procedureSemanticRetrievalRequestSchema.parse(requestInput);
      const authorizedDescriptor = request.providerDisclosure.providerDescriptor;
      const authorizedRuntimeTreatment = request.providerDisclosure.runtimeTreatment;
      const receivedAt = now();
      if (new Date(request.authorization.confirmedAt).getTime() > receivedAt.getTime()) {
        throw new PlannerGenerationRuntimeError(
          'planner_invalid_request',
          'Procedure semantic retrieval authorization cannot be confirmed in the future',
          'same_request_id',
        );
      }
      const queryContentSha256 = sha256(request.query);
      const effectiveFilters = {
        ...(request.filters?.adapterId === undefined
          ? {}
          : { adapterId: request.filters.adapterId }),
        ...(request.filters?.actionCatalogVersion === undefined
          ? {}
          : { actionCatalogVersion: request.filters.actionCatalogVersion }),
        ...(request.filters?.interactionCatalogVersion === undefined
          ? {}
          : { interactionCatalogVersion: request.filters.interactionCatalogVersion }),
        validationStatus: request.filters?.validationStatus ?? 'verified',
      } as const;
      const providerDescriptorContentSha256 = canonicalSha256(authorizedDescriptor);
      const authorizationContentSha256 = canonicalSha256(request.authorization);
      const fingerprint = plannerProviderRequestFingerprint({
        ...request,
        query: undefined,
        queryContentSha256,
      });
      const result = await invocationManager.execute({
        requestId: request.requestId,
        operation: 'procedure_embedding',
        fingerprint,
        providerId: authorizedDescriptor.id,
        planKey: [request.filters?.adapterId ?? '*', `semantic-retrieval:${request.requestId}`],
        requiresReplan: false,
        requiresProcedureEmbedding: true,
        attempt: async (attemptContext) => {
          const startedAt = Date.now();
          let requestRecorded = false;
          let requestedEvidence: ReturnType<
            typeof procedureSemanticRetrievalRequestedEventSchema.parse
          > | null = null;
          try {
            if (!descriptorsMatch(authorizedDescriptor, attemptContext.registered.descriptor)) {
              throw new PlannerGenerationRuntimeError(
                'planner_identity_mismatch',
                'Authorized embedding provider descriptor does not match the live descriptor',
                'same_request_id',
              );
            }
            const provider = attemptContext.registered.provider;
            if (provider.embedProcedure === undefined) {
              throw new PlannerGenerationRuntimeError(
                'planner_procedure_embedding_not_supported',
                'Selected provider does not implement Procedure embeddings',
                'same_request_id',
              );
            }
            const runtimeTreatment = snapshotPlannerProviderRuntimeTreatment(
              provider,
              attemptContext.registered.descriptor,
              'procedure_embedding',
            );
            if (runtimeTreatment === undefined) {
              throw new PlannerGenerationRuntimeError(
                'planner_identity_mismatch',
                'Procedure embedding provider did not disclose runtime treatment',
                'same_request_id',
              );
            }
            if (canonicalSha256(runtimeTreatment) !== canonicalSha256(authorizedRuntimeTreatment)) {
              throw new PlannerGenerationRuntimeError(
                'planner_identity_mismatch',
                'Authorized embedding model, runtime treatment, or cost policy does not match the live disclosure',
                'same_request_id',
              );
            }
            const corpus = buildCorpus(request, options);
            const corpusContentSha256 = canonicalSha256(
              corpus.map((document) => ({
                treeId: document.summary.treeId,
                revision: document.summary.revision,
                leafId: document.leaf.id,
                documentContentSha256: document.contentSha256,
              })),
            );
            const inputBatch = [request.query, ...corpus.map((document) => document.text)];
            const inputBatchContentSha256 = computePlannerProviderAttestationSha256(inputBatch);
            const occurredAt = now().toISOString();
            const requested = procedureSemanticRetrievalRequestedEventSchema.parse({
              formatVersion: '1.0.0',
              requestId: request.requestId,
              requestFingerprint: fingerprint,
              queryContentSha256,
              providerId: authorizedDescriptor.id,
              providerVersion: authorizedDescriptor.version,
              providerDescriptor: authorizedDescriptor,
              providerDescriptorContentSha256,
              corpusContentSha256,
              inputBatchContentSha256,
              effectiveFilters,
              retrieval: request.retrieval,
              authorizationContentSha256,
              runtimeTreatment,
              occurredAt,
            });
            requestedEvidence = requested;
            appendEvidence(
              {
                id: `procedure-semantic-retrieval-requested:${request.requestId}`,
                eventType: 'procedure.semantic.retrieval.requested',
                payload: requested,
              },
              'same_request_id',
            );
            attemptContext.markAttempted();
            requestRecorded = true;
            const raw = await attemptContext.invoke((liveProvider, signal) =>
              liveProvider.embedProcedure!({
                requestId: request.requestId,
                documents: inputBatch,
                signal,
              }),
            );
            const vectors = validateVectors(raw, corpus.length + 1);
            const queryVector = vectors[0]!;
            const vectorDimension = queryVector.length;
            const scored = corpus
              .map((document, index) => ({
                document,
                cosineSimilarity: cosine(queryVector, vectors[index + 1]!),
              }))
              .filter(({ cosineSimilarity }) => cosineSimilarity >= request.retrieval.minScore)
              .sort(
                (left, right) =>
                  right.cosineSimilarity - left.cosineSimilarity ||
                  compareDocumentIdentity(left.document, right.document),
              )
              .slice(0, request.retrieval.topK);
            const completedAt = now().toISOString();
            const runtimeEvidence = createPlannerProviderRuntimeOutputAttestation({
              operation: 'procedure_embedding',
              requestId: request.requestId,
              requestFingerprint: fingerprint,
              queryContentSha256,
              corpusContentSha256,
              inputBatch,
              output: raw,
              treatment: runtimeTreatment,
              occurredAt: completedAt,
            });
            if (runtimeEvidence === undefined) {
              throw new PlannerGenerationRuntimeError(
                'planner_identity_mismatch',
                'Procedure embedding output could not be runtime-attested',
                'new_request_id',
              );
            }
            const result = procedureSemanticRetrievalResultSchema.parse({
              formatVersion: '1.0.0',
              retrievalId: randomUUID(),
              requestId: request.requestId,
              requestFingerprint: fingerprint,
              queryContentSha256,
              effectiveFilters,
              retrieval: request.retrieval,
              corpus: {
                id: corpusId,
                version: corpusVersion,
                contentSha256: corpusContentSha256,
                documentCount: corpus.length,
                vectorDimension,
              },
              embedding: {
                providerDescriptor: authorizedDescriptor,
                providerDescriptorContentSha256,
                model: runtimeTreatment.treatment.profile.model,
                runtimeEvidence,
              },
              hits: scored.map(({ document, cosineSimilarity }, index) => ({
                rank: index + 1,
                tree: document.summary,
                nodePath: document.path,
                leaf: document.leaf,
                documentContentSha256: document.contentSha256,
                cosineSimilarity,
              })),
              matching: 'embedding_cosine_similarity',
              embeddingProviderCalled: true,
              semanticRecallPerformed: true,
              similarityScoreProduced: true,
              ragContextProduced: scored.length > 0,
              procedureStored: false,
              proposalCreated: false,
              hostExecutionStarted: false,
              completedAt,
              durationMs: Math.max(0, Date.now() - startedAt),
            });
            const completedScope = evidenceScope(requested);
            const completed = procedureSemanticRetrievalCompletedEventSchema.parse({
              ...completedScope,
              resultContentSha256: canonicalSha256(result),
              result,
              occurredAt: completedAt,
            });
            appendEvidence(
              {
                id: `procedure-semantic-retrieval-completed:${request.requestId}`,
                eventType: 'procedure.semantic.retrieval.completed',
                payload: completed,
              },
              'new_request_id',
            );
            return result;
          } catch (error) {
            const safe = safePlannerRuntimeError(error);
            if (requestRecorded && requestedEvidence !== null) {
              const failedScope = evidenceScope(requestedEvidence);
              const failed = procedureSemanticRetrievalFailedEventSchema.parse({
                ...failedScope,
                error: {
                  code: evidenceErrorCode(safe),
                  message: safe.message,
                  retryable: false,
                },
                occurredAt: now().toISOString(),
              });
              appendEvidence(
                {
                  id: `procedure-semantic-retrieval-failed:${request.requestId}`,
                  eventType: 'procedure.semantic.retrieval.failed',
                  payload: failed,
                },
                'new_request_id',
              );
            }
            throw safe;
          }
        },
      });
      return procedureSemanticRetrievalResultSchema.parse(result);
    },
    completedResult: (requestId) => {
      const result = invocationManager.completedResult(requestId, 'procedure_embedding');
      return result === null ? null : procedureSemanticRetrievalResultSchema.parse(result);
    },
    // The registry/invocation manager is shared by the orchestrator and owns its lifecycle.
    close: async () => undefined,
  };
}
