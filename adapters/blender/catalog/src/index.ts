import {
  actionCatalogSchema,
  interactionCatalogSchema,
  validateActionCatalog,
  validateInteractionCatalog,
  type ActionCatalog,
  type InteractionCatalog,
} from '@operatingline/protocol';

import catalog100Json from '../v1/action-catalog-1.0.0.json' with { type: 'json' };
import catalog110Json from '../v1/action-catalog-1.1.0.json' with { type: 'json' };
import catalog120Json from '../v1/action-catalog-1.2.0.json' with { type: 'json' };
import catalogJson from '../v1/action-catalog.json' with { type: 'json' };
import interactionCatalogJson from '../v1/interaction-catalog.json' with { type: 'json' };

export const blenderActionCatalog: ActionCatalog = actionCatalogSchema.parse(catalogJson);
export const blenderActionCatalogs: readonly ActionCatalog[] = Object.freeze([
  actionCatalogSchema.parse(catalog100Json),
  actionCatalogSchema.parse(catalog110Json),
  actionCatalogSchema.parse(catalog120Json),
  blenderActionCatalog,
]);

for (const catalog of blenderActionCatalogs) {
  validateActionCatalog(catalog);
}

export const blenderInteractionCatalog: InteractionCatalog =
  interactionCatalogSchema.parse(interactionCatalogJson);
validateInteractionCatalog(blenderInteractionCatalog, blenderActionCatalog);
