import { describe, expect, it } from 'vitest';

import {
  procedureParameterBindingSchema,
  procedureParameterPathSegmentSchema,
  procedureParameterProjectionSchema,
  projectProcedureParameter,
  readProcedureParameterPath,
  writeProcedureParameterPath,
  type ProcedureParameterPathSegment,
} from '@operatingline/protocol';

describe('procedure parameter projection protocol', () => {
  it('rejects prototype-bearing fields in schemas and runtime path traversal', () => {
    for (const name of ['__proto__', 'constructor', 'prototype']) {
      expect(procedureParameterPathSegmentSchema.safeParse({ kind: 'field', name }).success).toBe(
        false,
      );
      expect(
        procedureParameterBindingSchema.safeParse({
          id: 'binding.safe',
          actionArgument: name,
          transform: 'identity',
          target: {
            modality: 'semantic',
            operationId: 'semantic.safe',
            path: [{ kind: 'field', name: 'value' }],
          },
        }).success,
      ).toBe(false);
      expect(
        procedureParameterProjectionSchema.safeParse({
          formatVersion: '1.0.0',
          provenance: {
            kind: 'interaction_catalog_materialization',
            interactionCatalogVersion: '1.0.0',
            recipeId: 'recipe.safe',
          },
          arguments: [
            {
              actionArgument: name,
              disposition: 'omitted',
              bindingIds: [],
              reason: 'Unsafe names are never valid coverage.',
            },
          ],
          bindings: [],
        }).success,
      ).toBe(false);

      const root = Object.create(null) as Record<string, unknown>;
      Object.defineProperty(root, name, {
        value: { polluted: false },
        enumerable: true,
        configurable: true,
        writable: true,
      });
      const unsafePath = [{ kind: 'field', name }] as ProcedureParameterPathSegment[];
      expect(() => readProcedureParameterPath(root, unsafePath)).toThrow('unsafe field');
      expect(() => writeProcedureParameterPath(root, unsafePath, 'blocked')).toThrow(
        'unsafe field',
      );
      expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    }
  });

  it('reads and writes only existing own paths without creating structure', () => {
    const root = { transform: { location: [1, 2, 3] }, inherited: Object.create({ value: 4 }) };
    const path = [
      { kind: 'field', name: 'transform' },
      { kind: 'field', name: 'location' },
      { kind: 'index', index: 1 },
    ] as const;

    expect(readProcedureParameterPath(root, path)).toBe(2);
    writeProcedureParameterPath(root, path, 9);
    expect(root.transform.location).toEqual([1, 9, 3]);
    expect(() =>
      readProcedureParameterPath(root, [
        { kind: 'field', name: 'inherited' },
        { kind: 'field', name: 'value' },
      ]),
    ).toThrow('missing field value');
    expect(() => readProcedureParameterPath(root, [])).toThrow('cannot be empty');
    expect(() => writeProcedureParameterPath(root, [], 1)).toThrow('cannot be empty');
    expect(() =>
      writeProcedureParameterPath(root, [{ kind: 'field', name: 'missing' }], 1),
    ).toThrow('missing field missing');
    expect(() =>
      writeProcedureParameterPath(
        root,
        [
          { kind: 'field', name: 'transform' },
          { kind: 'field', name: 'location' },
          { kind: 'index', index: 3 },
        ],
        1,
      ),
    ).toThrow('missing index 3');
  });

  it('applies every declared transform exactly and rejects unsupported values', () => {
    expect(projectProcedureParameter(2, 'identity')).toBe(2);
    expect(projectProcedureParameter(true, 'identity')).toBe(true);
    expect(projectProcedureParameter('Eye', 'identity')).toBe('Eye');
    const vector = [1, 2, 3];
    const identity = projectProcedureParameter(vector, 'identity');
    expect(identity).toEqual(vector);
    expect(identity).not.toBe(vector);
    expect(projectProcedureParameter(0.25, 'uniform_vector3')).toEqual([0.25, 0.25, 0.25]);
    expect(projectProcedureParameter(2, 'divide_by_two')).toBe(1);
    expect(projectProcedureParameter([4, 5, 6], 'vector3_x')).toBe(4);
    expect(projectProcedureParameter([4, 5, 6], 'vector3_y')).toBe(5);
    expect(projectProcedureParameter([4, 5, 6], 'vector3_z')).toBe(6);

    expect(() => projectProcedureParameter(Number.NaN, 'identity')).toThrow('only scalar');
    expect(() => projectProcedureParameter({}, 'identity')).toThrow('only scalar');
    expect(() => projectProcedureParameter('2', 'divide_by_two')).toThrow('finite number');
    expect(() => projectProcedureParameter([1, 2], 'vector3_x')).toThrow('finite numeric vector3');
    expect(() => projectProcedureParameter([1, 2, Number.POSITIVE_INFINITY], 'vector3_z')).toThrow(
      'finite numeric vector3',
    );
  });
});
