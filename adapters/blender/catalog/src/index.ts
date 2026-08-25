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
import catalog1150Json from '../v1/action-catalog-1.15.0.json' with { type: 'json' };
import catalog1160Json from '../v1/action-catalog-1.16.0.json' with { type: 'json' };
import catalog1170Json from '../v1/action-catalog-1.17.0.json' with { type: 'json' };
import catalog1180Json from '../v1/action-catalog-1.18.0.json' with { type: 'json' };
import catalog1190Json from '../v1/action-catalog-1.19.0.json' with { type: 'json' };
import catalog1200Json from '../v1/action-catalog-1.20.0.json' with { type: 'json' };
import catalog1210Json from '../v1/action-catalog-1.21.0.json' with { type: 'json' };
import catalog1220Json from '../v1/action-catalog-1.22.0.json' with { type: 'json' };
import catalog1230Json from '../v1/action-catalog-1.23.0.json' with { type: 'json' };
import catalog1240Json from '../v1/action-catalog-1.24.0.json' with { type: 'json' };
import catalog1250Json from '../v1/action-catalog-1.25.0.json' with { type: 'json' };
import catalog1260Json from '../v1/action-catalog-1.26.0.json' with { type: 'json' };
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
import interactionCatalog1250Json from '../v1/interaction-catalog-1.25.0.json' with { type: 'json' };
import interactionCatalog1260Json from '../v1/interaction-catalog-1.26.0.json' with { type: 'json' };
import interactionCatalog1270Json from '../v1/interaction-catalog-1.27.0.json' with { type: 'json' };
import interactionCatalog1280Json from '../v1/interaction-catalog-1.28.0.json' with { type: 'json' };
import interactionCatalog1290Json from '../v1/interaction-catalog-1.29.0.json' with { type: 'json' };
import interactionCatalog1300Json from '../v1/interaction-catalog-1.30.0.json' with { type: 'json' };
import interactionCatalog1310Json from '../v1/interaction-catalog-1.31.0.json' with { type: 'json' };
import interactionCatalog1320Json from '../v1/interaction-catalog-1.32.0.json' with { type: 'json' };
import interactionCatalog1330Json from '../v1/interaction-catalog-1.33.0.json' with { type: 'json' };
import interactionCatalog1340Json from '../v1/interaction-catalog-1.34.0.json' with { type: 'json' };
import interactionCatalog1350Json from '../v1/interaction-catalog-1.35.0.json' with { type: 'json' };
import interactionCatalog1360Json from '../v1/interaction-catalog-1.36.0.json' with { type: 'json' };
import interactionCatalog1370Json from '../v1/interaction-catalog-1.37.0.json' with { type: 'json' };
import interactionCatalog1380Json from '../v1/interaction-catalog-1.38.0.json' with { type: 'json' };
import interactionCatalog1390Json from '../v1/interaction-catalog-1.39.0.json' with { type: 'json' };
import interactionCatalog1400Json from '../v1/interaction-catalog-1.40.0.json' with { type: 'json' };
import interactionCatalog1410Json from '../v1/interaction-catalog-1.41.0.json' with { type: 'json' };
import interactionCatalog1420Json from '../v1/interaction-catalog-1.42.0.json' with { type: 'json' };
import interactionCatalog1430Json from '../v1/interaction-catalog-1.43.0.json' with { type: 'json' };
import interactionCatalog1440Json from '../v1/interaction-catalog-1.44.0.json' with { type: 'json' };
import interactionCatalog1450Json from '../v1/interaction-catalog-1.45.0.json' with { type: 'json' };
import interactionCatalog1460Json from '../v1/interaction-catalog-1.46.0.json' with { type: 'json' };
import interactionCatalog1470Json from '../v1/interaction-catalog-1.47.0.json' with { type: 'json' };
import interactionCatalog1480Json from '../v1/interaction-catalog-1.48.0.json' with { type: 'json' };
import interactionCatalog1490Json from '../v1/interaction-catalog-1.49.0.json' with { type: 'json' };
import interactionCatalog1500Json from '../v1/interaction-catalog-1.50.0.json' with { type: 'json' };
import interactionCatalog1510Json from '../v1/interaction-catalog-1.51.0.json' with { type: 'json' };
import interactionCatalog1520Json from '../v1/interaction-catalog-1.52.0.json' with { type: 'json' };
import interactionCatalog1530Json from '../v1/interaction-catalog-1.53.0.json' with { type: 'json' };
import interactionCatalog1540Json from '../v1/interaction-catalog-1.54.0.json' with { type: 'json' };
import interactionCatalog1550Json from '../v1/interaction-catalog-1.55.0.json' with { type: 'json' };
import interactionCatalog1560Json from '../v1/interaction-catalog-1.56.0.json' with { type: 'json' };
import interactionCatalog1570Json from '../v1/interaction-catalog-1.57.0.json' with { type: 'json' };
import interactionCatalog1580Json from '../v1/interaction-catalog-1.58.0.json' with { type: 'json' };
import interactionCatalog1590Json from '../v1/interaction-catalog-1.59.0.json' with { type: 'json' };
import interactionCatalog1600Json from '../v1/interaction-catalog-1.60.0.json' with { type: 'json' };
import interactionCatalog1610Json from '../v1/interaction-catalog-1.61.0.json' with { type: 'json' };
import interactionCatalog1620Json from '../v1/interaction-catalog-1.62.0.json' with { type: 'json' };
import interactionCatalog1630Json from '../v1/interaction-catalog-1.63.0.json' with { type: 'json' };
import interactionCatalog1640Json from '../v1/interaction-catalog-1.64.0.json' with { type: 'json' };
import interactionCatalog1650Json from '../v1/interaction-catalog-1.65.0.json' with { type: 'json' };
import interactionCatalog1660Json from '../v1/interaction-catalog-1.66.0.json' with { type: 'json' };
import interactionCatalog1670Json from '../v1/interaction-catalog-1.67.0.json' with { type: 'json' };
import interactionCatalog1680Json from '../v1/interaction-catalog-1.68.0.json' with { type: 'json' };
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
  actionCatalogSchema.parse(catalog1150Json),
  actionCatalogSchema.parse(catalog1160Json),
  actionCatalogSchema.parse(catalog1170Json),
  actionCatalogSchema.parse(catalog1180Json),
  actionCatalogSchema.parse(catalog1190Json),
  actionCatalogSchema.parse(catalog1200Json),
  actionCatalogSchema.parse(catalog1210Json),
  actionCatalogSchema.parse(catalog1220Json),
  actionCatalogSchema.parse(catalog1230Json),
  actionCatalogSchema.parse(catalog1240Json),
  actionCatalogSchema.parse(catalog1250Json),
  actionCatalogSchema.parse(catalog1260Json),
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
const blenderInteractionCatalog1250: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1250Json,
);
const blenderInteractionCatalog1260: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1260Json,
);
const blenderInteractionCatalog1270: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1270Json,
);
const blenderInteractionCatalog1280: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1280Json,
);
const blenderInteractionCatalog1290: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1290Json,
);
const blenderInteractionCatalog1300: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1300Json,
);
const blenderInteractionCatalog1310: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1310Json,
);
const blenderInteractionCatalog1320: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1320Json,
);
const blenderInteractionCatalog1330: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1330Json,
);
const blenderInteractionCatalog1340: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1340Json,
);
const blenderInteractionCatalog1350: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1350Json,
);
const blenderInteractionCatalog1360: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1360Json,
);
const blenderInteractionCatalog1370: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1370Json,
);
const blenderInteractionCatalog1380: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1380Json,
);
const blenderInteractionCatalog1390: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1390Json,
);
const blenderInteractionCatalog1400: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1400Json,
);
const blenderInteractionCatalog1410: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1410Json,
);
const blenderInteractionCatalog1420: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1420Json,
);
const blenderInteractionCatalog1430: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1430Json,
);
const blenderInteractionCatalog1440: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1440Json,
);
const blenderInteractionCatalog1450: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1450Json,
);
const blenderInteractionCatalog1460: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1460Json,
);
const blenderInteractionCatalog1470: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1470Json,
);
const blenderInteractionCatalog1480: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1480Json,
);
const blenderInteractionCatalog1490: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1490Json,
);
const blenderInteractionCatalog1500: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1500Json,
);
const blenderInteractionCatalog1510: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1510Json,
);
const blenderInteractionCatalog1520: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1520Json,
);
const blenderInteractionCatalog1530: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1530Json,
);
const blenderInteractionCatalog1540: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1540Json,
);
const blenderInteractionCatalog1550: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1550Json,
);
const blenderInteractionCatalog1560: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1560Json,
);
const blenderInteractionCatalog1570: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1570Json,
);
const blenderInteractionCatalog1580: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1580Json,
);
const blenderInteractionCatalog1590: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1590Json,
);
const blenderInteractionCatalog1600: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1600Json,
);
const blenderInteractionCatalog1610: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1610Json,
);
const blenderInteractionCatalog1620: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1620Json,
);
const blenderInteractionCatalog1630: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1630Json,
);
const blenderInteractionCatalog1640: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1640Json,
);
const blenderInteractionCatalog1650: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1650Json,
);
const blenderInteractionCatalog1660: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1660Json,
);
const blenderInteractionCatalog1670: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1670Json,
);
const blenderInteractionCatalog1680: InteractionCatalog = interactionCatalogSchema.parse(
  interactionCatalog1680Json,
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
  blenderInteractionCatalog1250,
  blenderInteractionCatalog1260,
  blenderInteractionCatalog1270,
  blenderInteractionCatalog1280,
  blenderInteractionCatalog1290,
  blenderInteractionCatalog1300,
  blenderInteractionCatalog1310,
  blenderInteractionCatalog1320,
  blenderInteractionCatalog1330,
  blenderInteractionCatalog1340,
  blenderInteractionCatalog1350,
  blenderInteractionCatalog1360,
  blenderInteractionCatalog1370,
  blenderInteractionCatalog1380,
  blenderInteractionCatalog1390,
  blenderInteractionCatalog1400,
  blenderInteractionCatalog1410,
  blenderInteractionCatalog1420,
  blenderInteractionCatalog1430,
  blenderInteractionCatalog1440,
  blenderInteractionCatalog1450,
  blenderInteractionCatalog1460,
  blenderInteractionCatalog1470,
  blenderInteractionCatalog1480,
  blenderInteractionCatalog1490,
  blenderInteractionCatalog1500,
  blenderInteractionCatalog1510,
  blenderInteractionCatalog1520,
  blenderInteractionCatalog1530,
  blenderInteractionCatalog1540,
  blenderInteractionCatalog1550,
  blenderInteractionCatalog1560,
  blenderInteractionCatalog1570,
  blenderInteractionCatalog1580,
  blenderInteractionCatalog1590,
  blenderInteractionCatalog1600,
  blenderInteractionCatalog1610,
  blenderInteractionCatalog1620,
  blenderInteractionCatalog1630,
  blenderInteractionCatalog1640,
  blenderInteractionCatalog1650,
  blenderInteractionCatalog1660,
  blenderInteractionCatalog1670,
  blenderInteractionCatalog1680,
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
validateInteractionCatalog(blenderInteractionCatalog1250, blenderActionCatalogs[15]!);
validateInteractionCatalog(blenderInteractionCatalog1260, blenderActionCatalogs[16]!);
validateInteractionCatalog(blenderInteractionCatalog1270, blenderActionCatalogs[17]!);
validateInteractionCatalog(blenderInteractionCatalog1280, blenderActionCatalogs[18]!);
validateInteractionCatalog(blenderInteractionCatalog1290, blenderActionCatalogs[19]!);
validateInteractionCatalog(blenderInteractionCatalog1300, blenderActionCatalogs[20]!);
validateInteractionCatalog(blenderInteractionCatalog1310, blenderActionCatalogs[21]!);
validateInteractionCatalog(blenderInteractionCatalog1320, blenderActionCatalogs[22]!);
validateInteractionCatalog(blenderInteractionCatalog1330, blenderActionCatalogs[22]!);
validateInteractionCatalog(blenderInteractionCatalog1340, blenderActionCatalogs[22]!);
validateInteractionCatalog(blenderInteractionCatalog1350, blenderActionCatalogs[22]!);
validateInteractionCatalog(blenderInteractionCatalog1360, blenderActionCatalogs[22]!);
validateInteractionCatalog(blenderInteractionCatalog1370, blenderActionCatalogs[22]!);
validateInteractionCatalog(blenderInteractionCatalog1380, blenderActionCatalogs[22]!);
validateInteractionCatalog(blenderInteractionCatalog1390, blenderActionCatalogs[22]!);
validateInteractionCatalog(blenderInteractionCatalog1400, blenderActionCatalogs[22]!);
validateInteractionCatalog(blenderInteractionCatalog1410, blenderActionCatalogs[22]!);
validateInteractionCatalog(blenderInteractionCatalog1420, blenderActionCatalogs[22]!);
validateInteractionCatalog(blenderInteractionCatalog1430, blenderActionCatalogs[22]!);
validateInteractionCatalog(blenderInteractionCatalog1440, blenderActionCatalogs[22]!);
validateInteractionCatalog(blenderInteractionCatalog1450, blenderActionCatalogs[23]!);
validateInteractionCatalog(blenderInteractionCatalog1460, blenderActionCatalogs[24]!);
validateInteractionCatalog(blenderInteractionCatalog1470, blenderActionCatalogs[24]!);
validateInteractionCatalog(blenderInteractionCatalog1480, blenderActionCatalogs[24]!);
validateInteractionCatalog(blenderInteractionCatalog1490, blenderActionCatalogs[24]!);
validateInteractionCatalog(blenderInteractionCatalog1500, blenderActionCatalogs[24]!);
validateInteractionCatalog(blenderInteractionCatalog1510, blenderActionCatalogs[24]!);
validateInteractionCatalog(blenderInteractionCatalog1520, blenderActionCatalogs[25]!);
validateInteractionCatalog(blenderInteractionCatalog1530, blenderActionCatalogs[25]!);
validateInteractionCatalog(blenderInteractionCatalog1540, blenderActionCatalogs[26]!);
validateInteractionCatalog(blenderInteractionCatalog1550, blenderActionCatalogs[26]!);
validateInteractionCatalog(blenderInteractionCatalog1560, blenderActionCatalogs[26]!);
validateInteractionCatalog(blenderInteractionCatalog1570, blenderActionCatalogs[26]!);
validateInteractionCatalog(blenderInteractionCatalog1580, blenderActionCatalog);
validateInteractionCatalog(blenderInteractionCatalog1590, blenderActionCatalog);
validateInteractionCatalog(blenderInteractionCatalog1600, blenderActionCatalog);
validateInteractionCatalog(blenderInteractionCatalog1610, blenderActionCatalog);
validateInteractionCatalog(blenderInteractionCatalog1620, blenderActionCatalog);
validateInteractionCatalog(blenderInteractionCatalog1630, blenderActionCatalog);
validateInteractionCatalog(blenderInteractionCatalog1640, blenderActionCatalog);
validateInteractionCatalog(blenderInteractionCatalog1650, blenderActionCatalog);
validateInteractionCatalog(blenderInteractionCatalog1660, blenderActionCatalog);
validateInteractionCatalog(blenderInteractionCatalog1670, blenderActionCatalog);
validateInteractionCatalog(blenderInteractionCatalog1680, blenderActionCatalog);
validateInteractionCatalog(blenderInteractionCatalog, blenderActionCatalog);
