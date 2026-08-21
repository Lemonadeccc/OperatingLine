import type { OperatingLineDatabase } from '@operatingline/persistence';
import {
  companionInitialPlanRunSchema,
  type CompanionInitialPlanRun,
  type CompanionInitialPlanRunCreateRequest,
} from '@operatingline/protocol';

type StoredLegacyInitialPlanRun = CompanionInitialPlanRun & Record<string, unknown>;

export class CompanionInitialPlanRunRequestError extends Error {
  readonly statusCode = 503;
  readonly code = 'provider_authority_unavailable';

  constructor() {
    super('Companion initial-plan Provider calls require signed packet-bound authority');
    this.name = 'CompanionInitialPlanRunRequestError';
  }
}

export interface CompanionInitialPlanRunCoordinator {
  create(request: CompanionInitialPlanRunCreateRequest): CompanionInitialPlanRun;
  get(generationRequestId: string): CompanionInitialPlanRun | null;
  beginClose(): void;
  close(): Promise<void>;
}

export interface CompanionInitialPlanRunCoordinatorOptions {
  readonly database: OperatingLineDatabase;
  readonly [legacyDependency: string]: unknown;
}

function parseStoredRun(input: unknown): StoredLegacyInitialPlanRun {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Stored companion initial plan run is invalid');
  }
  const candidate = input as Record<string, unknown>;
  const run = companionInitialPlanRunSchema.parse({
    contractVersion: candidate['contractVersion'],
    generationRequestId: candidate['generationRequestId'],
    goalRequestId: candidate['goalRequestId'],
    targetAdapterId: candidate['targetAdapterId'],
    targetInstanceId: candidate['targetInstanceId'],
    provider: candidate['provider'],
    status: candidate['status'],
    terminal: candidate['terminal'],
    sceneChanged: candidate['sceneChanged'],
    proposalId: candidate['proposalId'],
    error: candidate['error'],
    needsRevision: candidate['needsRevision'],
    updatedAt: candidate['updatedAt'],
  });
  return { ...candidate, ...run } as StoredLegacyInitialPlanRun;
}

function publicRun(run: StoredLegacyInitialPlanRun): CompanionInitialPlanRun {
  return companionInitialPlanRunSchema.parse({
    contractVersion: run.contractVersion,
    generationRequestId: run.generationRequestId,
    goalRequestId: run.goalRequestId,
    targetAdapterId: run.targetAdapterId,
    targetInstanceId: run.targetInstanceId,
    provider: run.provider,
    status: run.status,
    terminal: run.terminal,
    sceneChanged: run.sceneChanged,
    proposalId: run.proposalId,
    error: run.error,
    needsRevision: run.needsRevision,
    updatedAt: run.updatedAt,
  });
}

export function retireLegacyCompanionInitialPlanRuns(database: OperatingLineDatabase): number {
  let retired = 0;
  for (const input of database.listNonterminalCompanionInitialPlanRuns()) {
    const run = parseStoredRun(input);
    const interrupted: StoredLegacyInitialPlanRun = {
      ...run,
      status: 'interrupted',
      terminal: true,
      proposalId: null,
      error: {
        code: 'planner_provider_unavailable',
        retryMode: 'never',
        message:
          'provider_authority_unavailable: legacy companion initial planning requires signed packet-bound authority',
      },
      needsRevision: null,
      updatedAt: new Date().toISOString(),
    };
    if (database.transitionCompanionInitialPlanRun(interrupted, [run.status])) retired += 1;
  }
  return retired;
}

export function createCompanionInitialPlanRunCoordinator(
  options: CompanionInitialPlanRunCoordinatorOptions,
): CompanionInitialPlanRunCoordinator {
  return {
    create: () => {
      throw new CompanionInitialPlanRunRequestError();
    },
    get: (generationRequestId) => {
      const stored = options.database.getCompanionInitialPlanRun(generationRequestId);
      return stored === null ? null : publicRun(parseStoredRun(stored));
    },
    beginClose: () => undefined,
    close: async () => undefined,
  };
}
