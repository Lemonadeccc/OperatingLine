import {
  actionCatalogSchema,
  validateActionCatalog,
  type ActionCatalog,
  type ActionCatalogRequest,
} from '@operatingline/protocol';

export interface ActionCatalogRegistry {
  get(request: ActionCatalogRequest): ActionCatalog;
  list(): ActionCatalog[];
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

export function createActionCatalogRegistry(
  catalogs: readonly ActionCatalog[],
): ActionCatalogRegistry {
  const byAdapter = new Map<string, Map<string, ActionCatalog>>();

  for (const input of catalogs) {
    const catalog = actionCatalogSchema.parse(input);
    validateActionCatalog(catalog);
    const versions = byAdapter.get(catalog.adapterId) ?? new Map<string, ActionCatalog>();
    if (versions.has(catalog.catalogVersion)) {
      throw new Error(`Duplicate action catalog ${catalog.adapterId}@${catalog.catalogVersion}`);
    }
    versions.set(catalog.catalogVersion, catalog);
    byAdapter.set(catalog.adapterId, versions);
  }

  const get = (request: ActionCatalogRequest): ActionCatalog => {
    const versions = byAdapter.get(request.targetAdapterId);
    if (versions === undefined) {
      const availableAdapters = [...byAdapter.keys()].sort().join(', ') || 'none';
      throw new Error(
        `No action catalog is installed for adapter ${request.targetAdapterId}; available adapters: ${availableAdapters}`,
      );
    }

    const selectedVersion =
      request.catalogVersion ??
      [...versions.keys()].sort((left, right) => compareCatalogVersions(right, left))[0];
    const catalog = selectedVersion === undefined ? undefined : versions.get(selectedVersion);
    if (catalog === undefined) {
      throw new Error(
        `Action catalog ${request.targetAdapterId}@${selectedVersion} is not installed; available versions: ${[...versions.keys()].sort(compareCatalogVersions).join(', ')}`,
      );
    }
    return actionCatalogSchema.parse(catalog);
  };

  return {
    get,
    list: () =>
      [...byAdapter.values()]
        .flatMap((versions) => [...versions.values()])
        .sort(
          (left, right) =>
            left.adapterId.localeCompare(right.adapterId) ||
            compareCatalogVersions(left.catalogVersion, right.catalogVersion),
        )
        .map((catalog) => actionCatalogSchema.parse(catalog)),
  };
}
