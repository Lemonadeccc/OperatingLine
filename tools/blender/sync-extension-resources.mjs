import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const resourceMappings = [
  [
    resolve('protocol/fixtures/v1/snowman-teaching.plan.json'),
    resolve('adapters/blender/extension/operating_line/resources/snowman.plan.json'),
  ],
  [
    resolve('adapters/blender/catalog/v1/action-catalog.json'),
    resolve('adapters/blender/extension/operating_line/resources/action-catalog.json'),
  ],
  [
    resolve('adapters/blender/catalog/v1/interaction-catalog.json'),
    resolve('adapters/blender/extension/operating_line/resources/interaction-catalog.json'),
  ],
  [resolve('LICENSE'), resolve('adapters/blender/extension/LICENSE')],
];

export function syncBlenderExtensionResources() {
  for (const [source, target] of resourceMappings) {
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
  }
}
