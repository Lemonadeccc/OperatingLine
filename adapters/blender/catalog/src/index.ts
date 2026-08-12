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
import catalog140Json from '../v1/action-catalog-1.4.0.json' with { type: 'json' };
import catalog150Json from '../v1/action-catalog-1.5.0.json' with { type: 'json' };
import catalog160Json from '../v1/action-catalog-1.6.0.json' with { type: 'json' };
import catalogJson from '../v1/action-catalog.json' with { type: 'json' };
import interactionCatalog100Json from '../v1/interaction-catalog-1.0.0.json' with { type: 'json' };
import interactionCatalog110Json from '../v1/interaction-catalog-1.1.0.json' with { type: 'json' };
import interactionCatalog120Json from '../v1/interaction-catalog-1.2.0.json' with { type: 'json' };
import interactionCatalog130Json from '../v1/interaction-catalog-1.3.0.json' with { type: 'json' };
import interactionCatalogJson from '../v1/interaction-catalog.json' with { type: 'json' };

export const blenderActionCatalog: ActionCatalog = actionCatalogSchema.parse(catalogJson);
export const blenderActionCatalogs: readonly ActionCatalog[] = Object.freeze([
  actionCatalogSchema.parse(catalog100Json),
  actionCatalogSchema.parse(catalog110Json),
  actionCatalogSchema.parse(catalog120Json),
  actionCatalogSchema.parse(catalog130Json),
  actionCatalogSchema.parse(catalog140Json),
  actionCatalogSchema.parse(catalog150Json),
  actionCatalogSchema.parse(catalog160Json),
  blenderActionCatalog,
]);

for (const catalog of blenderActionCatalogs) {
  validateActionCatalog(catalog);
}

const blenderInteractionCatalog100: InteractionCatalog =
  interactionCatalogSchema.parse(interactionCatalog100Json);
const blenderInteractionCatalog110: InteractionCatalog =
  interactionCatalogSchema.parse(interactionCatalog110Json);
const blenderInteractionCatalog120: InteractionCatalog =
  interactionCatalogSchema.parse(interactionCatalog120Json);
const blenderInteractionCatalog130: InteractionCatalog =
  interactionCatalogSchema.parse(interactionCatalog130Json);
export const blenderInteractionCatalog: InteractionCatalog =
  interactionCatalogSchema.parse(interactionCatalogJson);
export const blenderInteractionCatalogs: readonly InteractionCatalog[] = Object.freeze([
  blenderInteractionCatalog100,
  blenderInteractionCatalog110,
  blenderInteractionCatalog120,
  blenderInteractionCatalog130,
  blenderInteractionCatalog,
]);

validateInteractionCatalog(blenderInteractionCatalog100, blenderActionCatalogs[3]!);
validateInteractionCatalog(blenderInteractionCatalog110, blenderActionCatalogs[4]!);
validateInteractionCatalog(blenderInteractionCatalog120, blenderActionCatalogs[5]!);
validateInteractionCatalog(blenderInteractionCatalog130, blenderActionCatalogs[6]!);
validateInteractionCatalog(blenderInteractionCatalog, blenderActionCatalog);
