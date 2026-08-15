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
import catalog1120Json from '../v1/action-catalog-1.12.0.json' with { type: 'json' };
import catalog1130Json from '../v1/action-catalog-1.13.0.json' with { type: 'json' };
import catalog1140Json from '../v1/action-catalog-1.14.0.json' with { type: 'json' };
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
import interactionCatalog190Json from '../v1/interaction-catalog-1.9.0.json' with { type: 'json' };
import interactionCatalog1100Json from '../v1/interaction-catalog-1.10.0.json' with { type: 'json' };
import interactionCatalog1110Json from '../v1/interaction-catalog-1.11.0.json' with { type: 'json' };
import interactionCatalog1120Json from '../v1/interaction-catalog-1.12.0.json' with { type: 'json' };
import interactionCatalog1130Json from '../v1/interaction-catalog-1.13.0.json' with { type: 'json' };
import interactionCatalog1140Json from '../v1/interaction-catalog-1.14.0.json' with { type: 'json' };
import interactionCatalog1150Json from '../v1/interaction-catalog-1.15.0.json' with { type: 'json' };
import interactionCatalog1160Json from '../v1/interaction-catalog-1.16.0.json' with { type: 'json' };
import interactionCatalog1170Json from '../v1/interaction-catalog-1.17.0.json' with { type: 'json' };
import interactionCatalog1180Json from '../v1/interaction-catalog-1.18.0.json' with { type: 'json' };
import interactionCatalog1190Json from '../v1/interaction-catalog-1.19.0.json' with { type: 'json' };
import interactionCatalog1200Json from '../v1/interaction-catalog-1.20.0.json' with { type: 'json' };
import interactionCatalog1210Json from '../v1/interaction-catalog-1.21.0.json' with { type: 'json' };
import interactionCatalog1220Json from '../v1/interaction-catalog-1.22.0.json' with { type: 'json' };
import interactionCatalog1230Json from '../v1/interaction-catalog-1.23.0.json' with { type: 'json' };
import interactionCatalog1240Json from '../v1/interaction-catalog-1.24.0.json' with { type: 'json' };
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
  actionCatalogSchema.parse(catalog1120Json),
  actionCatalogSchema.parse(catalog1130Json),
  actionCatalogSchema.parse(catalog1140Json),
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
const blenderInteractionCatalog190: InteractionCatalog =
  interactionCatalogSchema.parse(interactionCatalog190Json);
const blenderInteractionCatalog1100: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1100Json,
);
const blenderInteractionCatalog1110: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1110Json,
);
const blenderInteractionCatalog1120: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1120Json,
);
const blenderInteractionCatalog1130: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1130Json,
);
const blenderInteractionCatalog1140: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1140Json,
);
const blenderInteractionCatalog1150: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1150Json,
);
const blenderInteractionCatalog1160: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1160Json,
);
const blenderInteractionCatalog1170: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1170Json,
);
const blenderInteractionCatalog1180: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1180Json,
);
const blenderInteractionCatalog1190: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1190Json,
);
const blenderInteractionCatalog1200: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1200Json,
);
const blenderInteractionCatalog1210: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1210Json,
);
const blenderInteractionCatalog1220: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1220Json,
);
const blenderInteractionCatalog1230: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1230Json,
);
const blenderInteractionCatalog1240: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1240Json,
);
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
  blenderInteractionCatalog190,
  blenderInteractionCatalog1100,
  blenderInteractionCatalog1110,
  blenderInteractionCatalog1120,
  blenderInteractionCatalog1130,
  blenderInteractionCatalog1140,
  blenderInteractionCatalog1150,
  blenderInteractionCatalog1160,
  blenderInteractionCatalog1170,
  blenderInteractionCatalog1180,
  blenderInteractionCatalog1190,
  blenderInteractionCatalog1200,
  blenderInteractionCatalog1210,
  blenderInteractionCatalog1220,
  blenderInteractionCatalog1230,
  blenderInteractionCatalog1240,
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
validateInteractionCatalog(blenderInteractionCatalog190, blenderActionCatalogs[12]!);
validateInteractionCatalog(blenderInteractionCatalog1100, blenderActionCatalogs[12]!);
validateInteractionCatalog(blenderInteractionCatalog1110, blenderActionCatalogs[12]!);
validateInteractionCatalog(blenderInteractionCatalog1120, blenderActionCatalogs[12]!);
validateInteractionCatalog(blenderInteractionCatalog1130, blenderActionCatalogs[12]!);
validateInteractionCatalog(blenderInteractionCatalog1140, blenderActionCatalogs[12]!);
validateInteractionCatalog(blenderInteractionCatalog1150, blenderActionCatalogs[12]!);
validateInteractionCatalog(blenderInteractionCatalog1160, blenderActionCatalogs[12]!);
validateInteractionCatalog(blenderInteractionCatalog1170, blenderActionCatalogs[12]!);
validateInteractionCatalog(blenderInteractionCatalog1180, blenderActionCatalogs[12]!);
validateInteractionCatalog(blenderInteractionCatalog1190, blenderActionCatalogs[12]!);
validateInteractionCatalog(blenderInteractionCatalog1200, blenderActionCatalogs[12]!);
validateInteractionCatalog(blenderInteractionCatalog1210, blenderActionCatalogs[12]!);
validateInteractionCatalog(blenderInteractionCatalog1220, blenderActionCatalogs[12]!);
validateInteractionCatalog(blenderInteractionCatalog1230, blenderActionCatalogs[13]!);
validateInteractionCatalog(blenderInteractionCatalog1240, blenderActionCatalogs[14]!);
validateInteractionCatalog(blenderInteractionCatalog, blenderActionCatalog);
