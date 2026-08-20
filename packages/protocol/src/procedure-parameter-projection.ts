import { z } from 'zod';

import { guideStepIdSchema } from './guide.js';
import { catalogVersionSchema } from './version.js';

export const procedureParameterProjectionFormatVersion = '1.0.0' as const;

const forbiddenPathFields = new Set(['__proto__', 'constructor', 'prototype']);
const safeParameterNameSchema = z
  .string()
  .min(1)
  .max(180)
  .refine((name) => !forbiddenPathFields.has(name), {
    message: 'Unsafe parameter name',
  });

export const procedureParameterPathSegmentSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('field'),
    name: z
      .string()
      .min(1)
      .max(180)
      .refine((name) => !forbiddenPathFields.has(name), {
        message: 'Unsafe parameter path field',
      }),
  }),
  z.strictObject({
    kind: z.literal('index'),
    index: z.number().int().nonnegative().max(1_000_000),
  }),
]);
export type ProcedureParameterPathSegment = z.infer<typeof procedureParameterPathSegmentSchema>;

export const procedureParameterTransformSchema = z.enum([
  'identity',
  'uniform_vector3',
  'divide_by_two',
  'vector3_x',
  'vector3_y',
  'vector3_z',
]);
export type ProcedureParameterTransform = z.infer<typeof procedureParameterTransformSchema>;

const parameterPathSchema = z.array(procedureParameterPathSegmentSchema).min(1).max(32);

export const procedureParameterProjectionTargetSchema = z.discriminatedUnion('modality', [
  z.strictObject({
    modality: z.literal('semantic'),
    operationId: guideStepIdSchema,
    path: parameterPathSchema,
  }),
  z.strictObject({
    modality: z.literal('menu'),
    trackId: guideStepIdSchema,
    operationId: guideStepIdSchema,
    path: parameterPathSchema,
  }),
  z.strictObject({
    modality: z.literal('shortcut'),
    trackId: guideStepIdSchema,
    operationId: guideStepIdSchema,
    path: parameterPathSchema,
  }),
  z.strictObject({
    modality: z.literal('mcp'),
    trackId: guideStepIdSchema,
    operationId: guideStepIdSchema,
    path: parameterPathSchema,
  }),
]);
export type ProcedureParameterProjectionTarget = z.infer<
  typeof procedureParameterProjectionTargetSchema
>;

export const procedureParameterBindingSchema = z.strictObject({
  id: guideStepIdSchema,
  actionArgument: safeParameterNameSchema,
  transform: procedureParameterTransformSchema,
  target: procedureParameterProjectionTargetSchema,
});
export type ProcedureParameterBinding = z.infer<typeof procedureParameterBindingSchema>;

const projectedArgumentCoverageSchema = z.strictObject({
  actionArgument: safeParameterNameSchema,
  disposition: z.literal('projected'),
  bindingIds: z.array(guideStepIdSchema).min(1).max(1_000),
});

const omittedArgumentCoverageSchema = z.strictObject({
  actionArgument: safeParameterNameSchema,
  disposition: z.literal('omitted'),
  bindingIds: z.array(guideStepIdSchema).length(0),
  reason: z.string().trim().min(1).max(2_000),
});

export const procedureParameterProjectionSchema = z.strictObject({
  formatVersion: z.literal(procedureParameterProjectionFormatVersion),
  provenance: z.strictObject({
    kind: z.literal('interaction_catalog_materialization'),
    interactionCatalogVersion: catalogVersionSchema,
    recipeId: guideStepIdSchema,
  }),
  arguments: z
    .array(
      z.discriminatedUnion('disposition', [
        projectedArgumentCoverageSchema,
        omittedArgumentCoverageSchema,
      ]),
    )
    .max(1_000),
  bindings: z.array(procedureParameterBindingSchema).max(10_000),
});
export type ProcedureParameterProjection = z.infer<typeof procedureParameterProjectionSchema>;

export type ProcedureProjectedParameterValue = boolean | number | string | readonly number[];

function finiteVector3(value: unknown): readonly [number, number, number] {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    value.some((component) => typeof component !== 'number' || !Number.isFinite(component))
  ) {
    throw new Error('Procedure parameter projection requires a finite numeric vector3');
  }
  return value as [number, number, number];
}

function finiteNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('Procedure parameter projection requires a finite number');
  }
  return Object.is(value, -0) ? 0 : value;
}

/** Apply one catalog-declared action-argument transform without guessing from values. */
export function projectProcedureParameter(
  value: unknown,
  transform: ProcedureParameterTransform,
): ProcedureProjectedParameterValue {
  if (transform === 'uniform_vector3') {
    const component = finiteNumber(value);
    return [component, component, component];
  }
  if (transform === 'divide_by_two') return finiteNumber(value) / 2;
  if (transform === 'vector3_x') return finiteVector3(value)[0];
  if (transform === 'vector3_y') return finiteVector3(value)[1];
  if (transform === 'vector3_z') return finiteVector3(value)[2];
  if (
    typeof value === 'boolean' ||
    typeof value === 'string' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value;
  }
  if (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= 4 &&
    value.every((component) => typeof component === 'number' && Number.isFinite(component))
  ) {
    return structuredClone(value) as number[];
  }
  throw new Error('Identity parameter projection supports only scalar or numeric vector values');
}

/** Resolve a protected parameter path without traversing prototypes or missing containers. */
export function readProcedureParameterPath(
  root: Readonly<Record<string, unknown>>,
  path: readonly ProcedureParameterPathSegment[],
): unknown {
  if (path.length === 0) throw new Error('Procedure parameter projection path cannot be empty');
  let current: unknown = root;
  for (const segment of path) {
    if (segment.kind === 'field') {
      if (forbiddenPathFields.has(segment.name)) {
        throw new Error(
          `Procedure parameter projection path contains unsafe field ${segment.name}`,
        );
      }
      if (
        current === null ||
        typeof current !== 'object' ||
        Array.isArray(current) ||
        !Object.prototype.hasOwnProperty.call(current, segment.name)
      ) {
        throw new Error(`Procedure parameter projection path is missing field ${segment.name}`);
      }
      current = (current as Record<string, unknown>)[segment.name];
      continue;
    }
    if (!Array.isArray(current) || segment.index >= current.length) {
      throw new Error(`Procedure parameter projection path is missing index ${segment.index}`);
    }
    current = current[segment.index];
  }
  return current;
}

/** Write an existing protected parameter path; bindings cannot create ad-hoc structure. */
export function writeProcedureParameterPath(
  root: Record<string, unknown>,
  path: readonly ProcedureParameterPathSegment[],
  value: ProcedureProjectedParameterValue,
): void {
  if (path.length === 0) throw new Error('Procedure parameter projection path cannot be empty');
  let current: unknown = root;
  for (const [index, segment] of path.entries()) {
    const terminal = index === path.length - 1;
    if (segment.kind === 'field') {
      if (forbiddenPathFields.has(segment.name)) {
        throw new Error(
          `Procedure parameter projection path contains unsafe field ${segment.name}`,
        );
      }
      if (
        current === null ||
        typeof current !== 'object' ||
        Array.isArray(current) ||
        !Object.prototype.hasOwnProperty.call(current, segment.name)
      ) {
        throw new Error(`Procedure parameter projection path is missing field ${segment.name}`);
      }
      if (terminal) {
        (current as Record<string, unknown>)[segment.name] = structuredClone(value);
      } else {
        current = (current as Record<string, unknown>)[segment.name];
      }
      continue;
    }
    if (!Array.isArray(current) || segment.index >= current.length) {
      throw new Error(`Procedure parameter projection path is missing index ${segment.index}`);
    }
    if (terminal) current[segment.index] = structuredClone(value);
    else current = current[segment.index];
  }
}
