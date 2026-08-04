import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { z } from 'zod';

import {
  adapterStatusSchema,
  companionGuideDeliverySchema,
  companionGuideRequestSchema,
  companionStateReportSchema,
  guidePlanSchema,
} from '../src/index.js';

const outputDirectory = resolve(process.cwd(), '../../protocol/schemas/v1');
mkdirSync(outputDirectory, { recursive: true });
const checkOnly = process.argv.includes('--check');

const schemas = [
  [
    'guide-plan.schema.json',
    'https://operatingline.dev/schema/v1/guide-plan.json',
    guidePlanSchema,
  ],
  [
    'adapter-status.schema.json',
    'https://operatingline.dev/schema/v1/adapter-status.json',
    adapterStatusSchema,
  ],
  [
    'companion-guide-request.schema.json',
    'https://operatingline.dev/schema/v1/companion-guide-request.json',
    companionGuideRequestSchema,
  ],
  [
    'companion-guide-delivery.schema.json',
    'https://operatingline.dev/schema/v1/companion-guide-delivery.json',
    companionGuideDeliverySchema,
  ],
  [
    'companion-state-report.schema.json',
    'https://operatingline.dev/schema/v1/companion-state-report.json',
    companionStateReportSchema,
  ],
] as const;

for (const [filename, id, schema] of schemas) {
  const jsonSchema = z.toJSONSchema(schema, { target: 'draft-2020-12' });
  const outputPath = resolve(outputDirectory, filename);
  const expected = `${JSON.stringify({ ...jsonSchema, $id: id }, null, 2)}\n`;
  if (checkOnly) {
    const actual = readFileSync(outputPath, 'utf8');
    if (actual !== expected) {
      throw new Error(`${filename} is stale; run pnpm schema:generate`);
    }
  } else {
    writeFileSync(outputPath, expected);
  }
}
