import {
  interactionCatalogSchema,
  validateInteractionCatalog,
  type InteractionCatalog,
} from '@operatingline/protocol';

import type { ActionCatalogRegistry } from './action-catalogs.js';
import { isStableVersionRangeSubset } from './stable-version-ranges.js';

export interface InteractionCatalogRequest {
  targetAdapterId: string;
  actionCatalogVersion: string;
  interactionCatalogVersion?: string;
}

export interface InteractionCatalogRegistry {
  get(request: InteractionCatalogRequest): InteractionCatalog;
  list(): InteractionCatalog[];
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

export function createInteractionCatalogRegistry(
  catalogs: readonly InteractionCatalog[],
  actionCatalogRegistry: Pick<ActionCatalogRegistry, 'get'>,
): InteractionCatalogRegistry {
  const byBinding = new Map<string, Map<string, Map<string, InteractionCatalog>>>();

  for (const input of catalogs) {
    const catalog = interactionCatalogSchema.parse(input);
    const actionCatalog = actionCatalogRegistry.get({
      targetAdapterId: catalog.adapterId,
      catalogVersion: catalog.actionCatalogVersion,
    });
    validateInteractionCatalog(catalog, actionCatalog);
    if (!isStableVersionRangeSubset(catalog.hostVersionRange, actionCatalog.hostVersionRange)) {
      throw new Error(
        `Interaction catalog host range ${catalog.hostVersionRange} exceeds ActionCatalog range ${actionCatalog.hostVersionRange}`,
      );
    }
    if (
      !isStableVersionRangeSubset(catalog.adapterVersionRange, actionCatalog.adapterVersionRange)
    ) {
      throw new Error(
        `Interaction catalog adapter range ${catalog.adapterVersionRange} exceeds ActionCatalog range ${actionCatalog.adapterVersionRange}`,
      );
    }

    const byActionCatalog =
      byBinding.get(catalog.adapterId) ?? new Map<string, Map<string, InteractionCatalog>>();
    const versions =
      byActionCatalog.get(catalog.actionCatalogVersion) ?? new Map<string, InteractionCatalog>();
    if (versions.has(catalog.catalogVersion)) {
      throw new Error(
        `Duplicate interaction catalog ${catalog.adapterId}@${catalog.actionCatalogVersion}/${catalog.catalogVersion}`,
      );
    }
    versions.set(catalog.catalogVersion, catalog);
    byActionCatalog.set(catalog.actionCatalogVersion, versions);
    byBinding.set(catalog.adapterId, byActionCatalog);
  }

  const get = (request: InteractionCatalogRequest): InteractionCatalog => {
    const byActionCatalog = byBinding.get(request.targetAdapterId);
    const versions = byActionCatalog?.get(request.actionCatalogVersion);
    if (versions === undefined) {
      const availableBindings = [...(byActionCatalog?.keys() ?? [])]
        .sort(compareCatalogVersions)
        .join(', ');
      throw new Error(
        `No interaction catalog is installed for action catalog ${request.targetAdapterId}@${request.actionCatalogVersion}; available action catalog versions: ${availableBindings || 'none'}`,
      );
    }

    const selectedVersion =
      request.interactionCatalogVersion ??
      [...versions.keys()].sort((left, right) => compareCatalogVersions(right, left))[0];
    const catalog = selectedVersion === undefined ? undefined : versions.get(selectedVersion);
    if (catalog === undefined) {
      throw new Error(
        `Interaction catalog ${request.targetAdapterId}@${request.actionCatalogVersion}/${selectedVersion} is not installed; available interaction catalog versions: ${[...versions.keys()].sort(compareCatalogVersions).join(', ')}`,
      );
    }
    return interactionCatalogSchema.parse(catalog);
  };

  return {
    get,
    list: () =>
      [...byBinding.values()]
        .flatMap((byActionCatalog) => [...byActionCatalog.values()])
        .flatMap((versions) => [...versions.values()])
        .sort(
          (left, right) =>
            left.adapterId.localeCompare(right.adapterId) ||
            compareCatalogVersions(left.actionCatalogVersion, right.actionCatalogVersion) ||
            compareCatalogVersions(left.catalogVersion, right.catalogVersion),
        )
        .map((catalog) => interactionCatalogSchema.parse(catalog)),
  };
}
