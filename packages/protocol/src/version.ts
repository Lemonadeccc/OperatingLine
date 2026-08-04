import { z } from 'zod';

export const catalogVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export const catalogVersionSchema = z
  .string()
  .regex(catalogVersionPattern, 'Catalog versions must use stable semantic version form x.y.z');

export const planningQualityBaselineVersion = '1.0.0' as const;
export const planningQualityBaselineVersionSchema = z.literal(planningQualityBaselineVersion);
