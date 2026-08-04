import {
  actionCatalogSchema,
  validateActionCatalog,
  type ActionCatalog,
} from '@operatingline/protocol';

import catalogJson from '../v1/action-catalog.json' with { type: 'json' };

export const blenderActionCatalog: ActionCatalog = actionCatalogSchema.parse(catalogJson);
validateActionCatalog(blenderActionCatalog);
