import { z } from 'zod';

export const catalogVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export const catalogVersionSchema = z
  .string()
  .regex(catalogVersionPattern, 'Catalog versions must use stable semantic version form x.y.z');

export const stableVersionRangePattern =
  /^(?:(?:>=|<=|>|<|=)?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?: (?:>=|<=|>|<|=)?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))*)(?: \|\| (?:(?:>=|<=|>|<|=)?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?: (?:>=|<=|>|<|=)?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))*))*$/;
export const stableVersionRangeSchema = z
  .string()
  .regex(
    stableVersionRangePattern,
    'Version ranges must contain stable x.y.z comparators joined by spaces and ||',
  );

export const supportedPlanningQualityBaselineVersions = ['1.0.0', '1.1.0'] as const;
export const planningQualityBaselineVersion = '1.1.0' as const;
export const planningQualityBaselineVersionSchema = z.enum(
  supportedPlanningQualityBaselineVersions,
);
