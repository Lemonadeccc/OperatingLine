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
import catalog130Json from '../v1/action-catalog-1.3.0.json' with { type: 'json' };
import catalogJson from '../v1/action-catalog.json' with { type: 'json' };
import interactionCatalog100Json from '../v1/interaction-catalog-1.0.0.json' with { type: 'json' };
import interactionCatalogJson from '../v1/interaction-catalog.json' with { type: 'json' };

export const blenderActionCatalog: ActionCatalog = actionCatalogSchema.parse(catalogJson);
export const blenderActionCatalogs: readonly ActionCatalog[] = Object.freeze([
  actionCatalogSchema.parse(catalog100Json),
  actionCatalogSchema.parse(catalog110Json),
  actionCatalogSchema.parse(catalog120Json),
  actionCatalogSchema.parse(catalog130Json),
  blenderActionCatalog,
]);

for (const catalog of blenderActionCatalogs) {
  validateActionCatalog(catalog);
}

const blenderInteractionCatalog100: InteractionCatalog =
  interactionCatalogSchema.parse(interactionCatalog100Json);
export const blenderInteractionCatalog: InteractionCatalog =
  interactionCatalogSchema.parse(interactionCatalogJson);
export const blenderInteractionCatalogs: readonly InteractionCatalog[] = Object.freeze([
  blenderInteractionCatalog100,
  blenderInteractionCatalog,
]);

validateInteractionCatalog(blenderInteractionCatalog100, blenderActionCatalogs[3]!);
validateInteractionCatalog(blenderInteractionCatalog, blenderActionCatalog);
