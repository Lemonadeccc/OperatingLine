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
import catalog170Json from '../v1/action-catalog-1.7.0.json' with { type: 'json' };
import catalog180Json from '../v1/action-catalog-1.8.0.json' with { type: 'json' };
import catalog190Json from '../v1/action-catalog-1.9.0.json' with { type: 'json' };
import catalog1100Json from '../v1/action-catalog-1.10.0.json' with { type: 'json' };
import catalog1110Json from '../v1/action-catalog-1.11.0.json' with { type: 'json' };
import catalogJson from '../v1/action-catalog.json' with { type: 'json' };
import interactionCatalog100Json from '../v1/interaction-catalog-1.0.0.json' with { type: 'json' };
import interactionCatalog110Json from '../v1/interaction-catalog-1.1.0.json' with { type: 'json' };
import interactionCatalog120Json from '../v1/interaction-catalog-1.2.0.json' with { type: 'json' };
import interactionCatalog130Json from '../v1/interaction-catalog-1.3.0.json' with { type: 'json' };
import interactionCatalog140Json from '../v1/interaction-catalog-1.4.0.json' with { type: 'json' };
import interactionCatalog150Json from '../v1/interaction-catalog-1.5.0.json' with { type: 'json' };
import interactionCatalog160Json from '../v1/interaction-catalog-1.6.0.json' with { type: 'json' };
import interactionCatalog170Json from '../v1/interaction-catalog-1.7.0.json' with { type: 'json' };
import interactionCatalog180Json from '../v1/interaction-catalog-1.8.0.json' with { type: 'json' };
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
  actionCatalogSchema.parse(catalog170Json),
  actionCatalogSchema.parse(catalog180Json),
  actionCatalogSchema.parse(catalog190Json),
  actionCatalogSchema.parse(catalog1100Json),
  actionCatalogSchema.parse(catalog1110Json),
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
const blenderInteractionCatalog140: InteractionCatalog =
  interactionCatalogSchema.parse(interactionCatalog140Json);
const blenderInteractionCatalog150: InteractionCatalog =
  interactionCatalogSchema.parse(interactionCatalog150Json);
const blenderInteractionCatalog160: InteractionCatalog =
  interactionCatalogSchema.parse(interactionCatalog160Json);
const blenderInteractionCatalog170: InteractionCatalog =
  interactionCatalogSchema.parse(interactionCatalog170Json);
const blenderInteractionCatalog180: InteractionCatalog =
  interactionCatalogSchema.parse(interactionCatalog180Json);
export const blenderInteractionCatalog: InteractionCatalog =
  interactionCatalogSchema.parse(interactionCatalogJson);
export const blenderInteractionCatalogs: readonly InteractionCatalog[] = Object.freeze([
  blenderInteractionCatalog100,
  blenderInteractionCatalog110,
  blenderInteractionCatalog120,
  blenderInteractionCatalog130,
  blenderInteractionCatalog140,
  blenderInteractionCatalog150,
  blenderInteractionCatalog160,
  blenderInteractionCatalog170,
  blenderInteractionCatalog180,
  blenderInteractionCatalog,
]);

validateInteractionCatalog(blenderInteractionCatalog100, blenderActionCatalogs[3]!);
validateInteractionCatalog(blenderInteractionCatalog110, blenderActionCatalogs[4]!);
validateInteractionCatalog(blenderInteractionCatalog120, blenderActionCatalogs[5]!);
validateInteractionCatalog(blenderInteractionCatalog130, blenderActionCatalogs[6]!);
validateInteractionCatalog(blenderInteractionCatalog140, blenderActionCatalogs[7]!);
validateInteractionCatalog(blenderInteractionCatalog150, blenderActionCatalogs[8]!);
validateInteractionCatalog(blenderInteractionCatalog160, blenderActionCatalogs[9]!);
validateInteractionCatalog(blenderInteractionCatalog170, blenderActionCatalogs[10]!);
validateInteractionCatalog(blenderInteractionCatalog180, blenderActionCatalogs[11]!);
validateInteractionCatalog(blenderInteractionCatalog, blenderActionCatalog);
