import type { OperatingLineDatabase } from '@operatingline/persistence';
import {
  companionDialogueRunSchema,
  type CompanionDialogueRun,
  type CompanionDialogueRunCreateRequest,
} from '@operatingline/protocol';

type StoredLegacyDialogueRun = CompanionDialogueRun & Record<string, unknown>;

export class CompanionDialogueRunRequestError extends Error {
  readonly statusCode = 503;
  readonly code = 'provider_authority_unavailable';

  constructor() {
    super('Companion dialogue Provider calls require signed packet-bound authority');
    this.name = 'CompanionDialogueRunRequestError';
  }
}

export interface CompanionDialogueRunCoordinator {
  create(request: CompanionDialogueRunCreateRequest): CompanionDialogueRun;
  get(dialogueRequestId: string): CompanionDialogueRun | null;
  beginClose(): void;
  close(): Promise<void>;
}

export interface CompanionDialogueRunCoordinatorOptions {
  readonly database: OperatingLineDatabase;
  readonly [legacyDependency: string]: unknown;
}

function parseStoredRun(input: unknown): StoredLegacyDialogueRun {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Stored companion dialogue run is invalid');
  }
  const candidate = input as Record<string, unknown>;
  const run = companionDialogueRunSchema.parse({
    contractVersion: candidate['contractVersion'],
    dialogueRequestId: candidate['dialogueRequestId'],
    revisionRequestId: candidate['revisionRequestId'],
    replanGenerationRequestId: candidate['replanGenerationRequestId'],
    targetAdapterId: candidate['targetAdapterId'],
    targetInstanceId: candidate['targetInstanceId'],
    provider: candidate['provider'],
    status: candidate['status'],
    terminal: candidate['terminal'],
    sceneChanged: candidate['sceneChanged'],
    assistantMessage: candidate['assistantMessage'],
    assistantMessageRevision: candidate['assistantMessageRevision'],
    semanticDecision: candidate['semanticDecision'],
    revisionRequestRecorded: candidate['revisionRequestRecorded'],
    proposalId: candidate['proposalId'],
    error: candidate['error'],
    needsRevision: candidate['needsRevision'],
    updatedAt: candidate['updatedAt'],
  });
  return { ...candidate, ...run } as StoredLegacyDialogueRun;
}

function publicRun(run: StoredLegacyDialogueRun): CompanionDialogueRun {
  return companionDialogueRunSchema.parse({
    contractVersion: run.contractVersion,
    dialogueRequestId: run.dialogueRequestId,
    revisionRequestId: run.revisionRequestId,
    replanGenerationRequestId: run.replanGenerationRequestId,
    targetAdapterId: run.targetAdapterId,
    targetInstanceId: run.targetInstanceId,
    provider: run.provider,
    status: run.status,
    terminal: run.terminal,
    sceneChanged: run.sceneChanged,
    assistantMessage: run.assistantMessage,
    assistantMessageRevision: run.assistantMessageRevision,
    semanticDecision: run.semanticDecision,
    revisionRequestRecorded: run.revisionRequestRecorded,
    proposalId: run.proposalId,
    error: run.error,
    needsRevision: run.needsRevision,
    updatedAt: run.updatedAt,
  });
}

export function retireLegacyCompanionDialogueRuns(database: OperatingLineDatabase): number {
  let retired = 0;
  for (const input of database.listNonterminalCompanionDialogueRuns()) {
    const run = parseStoredRun(input);
    const interrupted: StoredLegacyDialogueRun = {
      ...run,
      status: 'interrupted',
      terminal: true,
      proposalId: null,
      error: {
        code: 'planner_provider_unavailable',
        retryMode: 'never',
        message:
          'provider_authority_unavailable: legacy companion dialogue requires signed packet-bound authority',
      },
      needsRevision: null,
      updatedAt: new Date().toISOString(),
    };
    if (database.transitionCompanionDialogueRun(interrupted, [run.status])) retired += 1;
  }
  return retired;
}

export function createCompanionDialogueRunCoordinator(
  options: CompanionDialogueRunCoordinatorOptions,
): CompanionDialogueRunCoordinator {
  return {
    create: () => {
      throw new CompanionDialogueRunRequestError();
    },
    get: (dialogueRequestId) => {
      const stored = options.database.getCompanionDialogueRun(dialogueRequestId);
      return stored === null ? null : publicRun(parseStoredRun(stored));
    },
    beginClose: () => undefined,
    close: async () => undefined,
  };
}
