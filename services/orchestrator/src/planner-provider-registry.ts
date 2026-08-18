import type { PlannerProvider } from '@operatingline/planner-provider-sdk';
import {
  plannerProviderDescriptorSchema,
  plannerProviderListSchema,
  plannerProviderContractVersion,
  type PlannerProviderDescriptor,
  type PlannerProviderList,
} from '@operatingline/protocol';

export interface RegisteredPlannerProvider {
  readonly descriptor: PlannerProviderDescriptor;
  readonly provider: PlannerProvider;
}

export interface RegisteredReplanningProvider extends RegisteredPlannerProvider {
  readonly provider: PlannerProvider & Required<Pick<PlannerProvider, 'replan'>>;
}

export interface RegisteredProcedureAuthoringProvider extends RegisteredPlannerProvider {
  readonly provider: PlannerProvider & Required<Pick<PlannerProvider, 'authorProcedure'>>;
}

export interface RegisteredDialogueReplanningProvider extends RegisteredPlannerProvider {
  readonly provider: PlannerProvider & Required<Pick<PlannerProvider, 'dialogue' | 'replan'>>;
}

export interface PlannerProviderRegistry {
  find(providerId: string): RegisteredPlannerProvider | null;
  findProcedureAuthor(providerId: string): RegisteredProcedureAuthoringProvider | null;
  findReplanner(providerId: string): RegisteredReplanningProvider | null;
  findDialogueReplanner(providerId: string): RegisteredDialogueReplanningProvider | null;
  list(): PlannerProviderList;
  listProcedureAuthors(): PlannerProviderList;
  listReplanners(): PlannerProviderList;
  listDialogueReplanners(): PlannerProviderList;
  close(): Promise<void>;
}

export interface PlannerProviderRegistryOptions {
  readonly closeTimeoutMs?: number;
}

const defaultCloseTimeoutMs = 5_000;
const maximumCloseTimeoutMs = 30_000;

export function createPlannerProviderRegistry(
  providers: readonly PlannerProvider[],
  options: PlannerProviderRegistryOptions = {},
): PlannerProviderRegistry {
  const closeTimeoutMs = options.closeTimeoutMs ?? defaultCloseTimeoutMs;
  if (
    !Number.isInteger(closeTimeoutMs) ||
    closeTimeoutMs < 100 ||
    closeTimeoutMs > maximumCloseTimeoutMs
  ) {
    throw new Error(
      `Planner provider close timeout must be an integer between 100 and ${maximumCloseTimeoutMs}ms`,
    );
  }
  const registered = new Map<string, RegisteredPlannerProvider>();
  for (const provider of providers) {
    const descriptor = plannerProviderDescriptorSchema.parse(provider.descriptor);
    if (typeof provider.generate !== 'function') {
      throw new Error(`Planner provider ${descriptor.id} does not implement generate()`);
    }
    if (registered.has(descriptor.id)) {
      throw new Error(`Duplicate planner provider ${descriptor.id}`);
    }
    registered.set(descriptor.id, { descriptor, provider });
  }

  let closePromise: Promise<void> | undefined;
  const listProviders = (candidates: readonly RegisteredPlannerProvider[]): PlannerProviderList => {
    const descriptors = candidates
      .map(({ descriptor }) => plannerProviderDescriptorSchema.parse(descriptor))
      .sort((left, right) => left.id.localeCompare(right.id));
    return plannerProviderListSchema.parse({
      contractVersion: plannerProviderContractVersion,
      generationAvailable: descriptors.some((descriptor) => descriptor.availability.available),
      providers: descriptors,
    });
  };
  return {
    find: (providerId) => registered.get(providerId) ?? null,
    findProcedureAuthor: (providerId) => {
      const candidate = registered.get(providerId);
      return candidate !== undefined && typeof candidate.provider.authorProcedure === 'function'
        ? (candidate as RegisteredProcedureAuthoringProvider)
        : null;
    },
    findReplanner: (providerId) => {
      const candidate = registered.get(providerId);
      return candidate !== undefined && typeof candidate.provider.replan === 'function'
        ? (candidate as RegisteredReplanningProvider)
        : null;
    },
    findDialogueReplanner: (providerId) => {
      const candidate = registered.get(providerId);
      return candidate !== undefined &&
        typeof candidate.provider.dialogue === 'function' &&
        typeof candidate.provider.replan === 'function'
        ? (candidate as RegisteredDialogueReplanningProvider)
        : null;
    },
    list: () => listProviders([...registered.values()]),
    listProcedureAuthors: () =>
      listProviders(
        [...registered.values()].filter(
          (candidate): candidate is RegisteredProcedureAuthoringProvider =>
            typeof candidate.provider.authorProcedure === 'function',
        ),
      ),
    listReplanners: () =>
      listProviders(
        [...registered.values()].filter(
          (candidate): candidate is RegisteredReplanningProvider =>
            typeof candidate.provider.replan === 'function',
        ),
      ),
    listDialogueReplanners: () =>
      listProviders(
        [...registered.values()].filter(
          (candidate): candidate is RegisteredDialogueReplanningProvider =>
            typeof candidate.provider.dialogue === 'function' &&
            typeof candidate.provider.replan === 'function',
        ),
      ),
    close: () => {
      closePromise ??= (async () => {
        const closeProvider = async ({
          descriptor,
          provider,
        }: RegisteredPlannerProvider): Promise<Error | null> => {
          let timedOut = false;
          let timer: ReturnType<typeof setTimeout> | undefined;
          const timeout = new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
              timedOut = true;
              reject(new Error('planner provider close timeout'));
            }, closeTimeoutMs);
          });
          try {
            await Promise.race([Promise.resolve().then(() => provider.close?.()), timeout]);
            return null;
          } catch {
            return new Error(
              timedOut
                ? `Planner provider ${descriptor.id} timed out while closing after ${closeTimeoutMs}ms`
                : `Planner provider ${descriptor.id} failed to close`,
            );
          } finally {
            if (timer !== undefined) {
              clearTimeout(timer);
            }
          }
        };
        const errors = (await Promise.all([...registered.values()].map(closeProvider))).filter(
          (error): error is Error => error !== null,
        );
        if (errors.length === 1) {
          throw errors[0];
        }
        if (errors.length > 1) {
          throw new AggregateError(errors, 'Multiple planner providers failed to close', {
            cause: errors[0],
          });
        }
      })();
      return closePromise;
    },
  };
}
