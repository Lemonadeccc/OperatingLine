import { describe, expect, it } from 'vitest';

import { validateActionArguments, validateActionArgumentsSchema } from '@operatingline/protocol';

const nestedSchema = {
  type: 'object',
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      minItems: 1,
      maxItems: 2,
      items: {
        type: 'object',
        required: ['name', 'weight'],
        properties: {
          name: { type: 'string', minLength: 2, maxLength: 8, pattern: '^[a-z]+$' },
          weight: { type: 'number', exclusiveMinimum: 0, maximum: 10 },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
} as const;

describe('action argument schemas', () => {
  it('enforces fixed numeric vector length bounds', () => {
    const schema = {
      type: 'array',
      items: { type: 'number' },
      minItems: 3,
      maxItems: 3,
      vectorLengthMinimum: 0.5,
      vectorLengthMaximum: 2,
    };

    validateActionArgumentsSchema(schema);
    expect(validateActionArguments([0.3, 0.4, 0], schema)).toEqual([]);
    expect(validateActionArguments([0, 0, 0], schema)).toEqual([
      'arguments vector length must be at least 0.5',
    ]);
    expect(validateActionArguments([2, 2, 0], schema)).toEqual([
      'arguments vector length must be at most 2',
    ]);
    expect(validateActionArguments(Array<number>(200_000).fill(0), schema)).toEqual([
      'arguments must contain at most 3 items',
    ]);

    const hugeSchema = {
      type: 'array',
      items: { type: 'number' },
      minItems: 2,
      maxItems: 2,
      vectorLengthMaximum: 1.1e308,
    };
    validateActionArgumentsSchema(hugeSchema);
    expect(validateActionArguments([1e308, 1e308], hugeSchema)).toEqual([
      'arguments vector length must be at most 1.1e+308',
    ]);

    const tinySchema = {
      type: 'array',
      items: { type: 'number' },
      minItems: 2,
      maxItems: 2,
      vectorLengthMinimum: 1e-200,
    };
    validateActionArgumentsSchema(tinySchema);
    expect(validateActionArguments([5e-201, 0], tinySchema)).toEqual([
      'arguments vector length must be at least 1e-200',
    ]);
  });

  it('recursively validates nested objects, arrays, strings, numbers, and stable paths', () => {
    validateActionArgumentsSchema(nestedSchema);
    expect(
      validateActionArguments({ items: [{ name: 'valid', weight: 2 }] }, nestedSchema),
    ).toEqual([]);

    expect(
      validateActionArguments({ items: [{ name: 'A', weight: 0, surprise: true }] }, nestedSchema),
    ).toEqual([
      'items[0].name must have length at least 2',
      'items[0].name must match pattern ^[a-z]+$',
      'items[0].weight must be greater than 0',
      'unknown items[0].surprise',
    ]);
    expect(validateActionArguments({ items: [{}] }, nestedSchema)).toEqual([
      'missing items[0].name',
      'missing items[0].weight',
    ]);
  });

  it('enforces boolean, integer, enum, const, oneOf, anyOf, and uniqueItems', () => {
    const schema = {
      type: 'object',
      required: ['enabled', 'mode', 'nullable', 'choice', 'tags'],
      properties: {
        enabled: { type: 'boolean' },
        mode: { enum: ['fast', 'safe'] },
        nullable: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        choice: {
          oneOf: [{ type: 'integer', minimum: 1 }, { const: 'auto' }],
        },
        tags: {
          type: 'array',
          uniqueItems: true,
          items: { type: 'string' },
        },
      },
      additionalProperties: false,
    } as const;

    expect(
      validateActionArguments(
        { enabled: true, mode: 'fast', nullable: null, choice: 2, tags: ['a', 'b'] },
        schema,
      ),
    ).toEqual([]);
    expect(
      validateActionArguments(
        { enabled: 'yes', mode: 'other', nullable: 2, choice: 1.5, tags: ['a', 'a'] },
        schema,
      ),
    ).toEqual([
      'enabled must be boolean',
      'mode must be one of the allowed values',
      'nullable must match at least one anyOf schema',
      'choice must match exactly one oneOf schema',
      'tags items must be unique',
    ]);
  });

  it.each([
    ['uniqueResourceIds', 'resourceId'],
    ['uniqueObjectNames', 'objectName'],
    ['uniqueBoneNames', 'boneName'],
    ['uniqueTargetIds', 'targetId'],
  ] as const)('enforces %s', (keyword, field) => {
    const schema = {
      type: 'array',
      [keyword]: true,
      items: {
        type: 'object',
        required: [field],
        properties: { [field]: { type: 'string' } },
        additionalProperties: false,
      },
    };
    expect(validateActionArguments([{ [field]: 'same' }, { [field]: 'same' }], schema)).toEqual([
      `[1].${field} must be unique`,
    ]);
  });

  it('enforces unique vertex indices and normalized weights', () => {
    const verticesSchema = {
      type: 'array',
      uniqueVertexIndices: true,
      items: {
        type: 'object',
        required: ['vertexIndex'],
        properties: { vertexIndex: { type: 'integer' } },
        additionalProperties: false,
      },
    } as const;
    expect(
      validateActionArguments([{ vertexIndex: 0 }, { vertexIndex: 0 }], verticesSchema),
    ).toEqual(['[1].vertexIndex must be unique']);

    const influencesSchema = {
      type: 'array',
      weightsSumToOne: true,
      items: {
        type: 'object',
        required: ['weight'],
        properties: { weight: { type: 'number' } },
        additionalProperties: false,
      },
    } as const;
    expect(validateActionArguments([{ weight: 0.25 }, { weight: 0.75 }], influencesSchema)).toEqual(
      [],
    );
    expect(validateActionArguments([{ weight: 0.25 }, { weight: 0.5 }], influencesSchema)).toEqual([
      'arguments weights must sum to 1',
    ]);
  });

  it('rejects cyclic bone parents and non-increasing frames', () => {
    const bonesSchema = {
      type: 'array',
      uniqueBoneNames: true,
      acyclicParents: true,
      items: {
        type: 'object',
        required: ['boneName', 'parentName'],
        properties: {
          boneName: { type: 'string' },
          parentName: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        },
        additionalProperties: false,
      },
    } as const;
    expect(
      validateActionArguments(
        [
          { boneName: 'a', parentName: 'b' },
          { boneName: 'b', parentName: 'a' },
        ],
        bonesSchema,
      ),
    ).toContain('arguments parents must be acyclic');

    const framesSchema = {
      type: 'array',
      strictlyIncreasingFrames: true,
      items: {
        type: 'object',
        required: ['frame'],
        properties: { frame: { type: 'integer' } },
        additionalProperties: false,
      },
    } as const;
    expect(validateActionArguments([{ frame: 2 }, { frame: 2 }], framesSchema)).toEqual([
      '[1].frame must be strictly increasing',
    ]);
  });

  it('enforces reusable cross-property geometry invariants', () => {
    const schema = {
      type: 'object',
      distinctPropertyValues: ['start', 'end'],
      atLeastOnePositiveProperty: ['radiusStart', 'radiusEnd'],
      required: ['start', 'end', 'radiusStart', 'radiusEnd'],
      properties: {
        start: { type: 'array', items: { type: 'number' } },
        end: { type: 'array', items: { type: 'number' } },
        radiusStart: { type: 'number', minimum: 0 },
        radiusEnd: { type: 'number', minimum: 0 },
      },
      additionalProperties: false,
    } as const;

    expect(
      validateActionArguments(
        { start: [0, 0, 0], end: [0, 0, 1], radiusStart: 0.2, radiusEnd: 0 },
        schema,
      ),
    ).toEqual([]);
    expect(
      validateActionArguments(
        { start: [0, 0, 0], end: [0, 0, 0], radiusStart: 0, radiusEnd: 0 },
        schema,
      ),
    ).toEqual([
      'arguments properties start and end must differ',
      'arguments requires at least one positive value among radiusStart, radiusEnd',
    ]);
  });

  it('fails closed on unknown and malformed schema keywords', () => {
    expect(() => validateActionArgumentsSchema({ type: 'string', format: 'uuid' })).toThrow(
      'unknown keyword format',
    );
    expect(() =>
      validateActionArgumentsSchema({ type: 'array', minItems: -1, items: { type: 'string' } }),
    ).toThrow('minItems must be a nonnegative integer');
    expect(() => validateActionArgumentsSchema({ type: 'string', pattern: '[' })).toThrow(
      'pattern must be a valid regular expression',
    );
    expect(() =>
      validateActionArgumentsSchema({
        type: 'array',
        uniqueResourceIds: true,
        items: { type: 'string' },
      }),
    ).toThrow('uniqueResourceIds requires object items or a oneOf of object items');
    expect(() =>
      validateActionArgumentsSchema({
        type: 'array',
        strictlyIncreasingFrames: true,
        items: { type: 'object', properties: {}, additionalProperties: false },
      }),
    ).toThrow('strictlyIncreasingFrames requires a required frame field with numeric schema');
    expect(() =>
      validateActionArgumentsSchema({
        type: 'array',
        uniqueVertexIndices: true,
        items: {
          type: 'object',
          required: ['vertexIndex'],
          properties: { vertexIndex: { type: 'number' } },
          additionalProperties: false,
        },
      }),
    ).toThrow('uniqueVertexIndices requires a required vertexIndex field with type integer schema');
    expect(() =>
      validateActionArgumentsSchema({
        type: 'array',
        weightsSumToOne: true,
        items: {
          type: 'object',
          required: [],
          properties: { weight: { type: 'number' } },
          additionalProperties: false,
        },
      }),
    ).toThrow('weightsSumToOne requires a required weight field with type number schema');
    expect(() =>
      validateActionArgumentsSchema({
        type: 'array',
        acyclicParents: true,
        items: {
          type: 'object',
          required: ['boneName', 'parentName'],
          properties: {
            boneName: { type: 'string' },
            parentName: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          },
          additionalProperties: false,
        },
      }),
    ).toThrow('acyclicParents requires uniqueBoneNames true');
    expect(() =>
      validateActionArgumentsSchema({
        type: 'object',
        distinctPropertyValues: ['start', 'missing'],
        required: ['start'],
        properties: { start: { type: 'number' } },
        additionalProperties: false,
      }),
    ).toThrow('distinctPropertyValues references non-required property missing');
    expect(() =>
      validateActionArgumentsSchema({
        type: 'object',
        atLeastOnePositiveProperty: ['name'],
        required: ['name'],
        properties: { name: { type: 'string' } },
        additionalProperties: false,
      }),
    ).toThrow('atLeastOnePositiveProperty requires numeric property name');
    expect(() =>
      validateActionArgumentsSchema({
        type: 'array',
        minItems: 3,
        maxItems: 3,
        vectorLengthMinimum: 0.1,
        items: { type: 'string' },
      }),
    ).toThrow('vector length keywords require numeric items');
    expect(() =>
      validateActionArgumentsSchema({
        type: 'array',
        minItems: 2,
        maxItems: 3,
        vectorLengthMaximum: 1,
        items: { type: 'number' },
      }),
    ).toThrow('vector length keywords require one fixed positive array length');
    expect(() =>
      validateActionArgumentsSchema({
        type: 'array',
        minItems: 3,
        maxItems: 3,
        vectorLengthMinimum: 2,
        vectorLengthMaximum: 1,
        items: { type: 'number' },
      }),
    ).toThrow('vectorLengthMinimum cannot exceed vectorLengthMaximum');
    expect(() =>
      validateActionArgumentsSchema({
        type: 'array',
        minItems: 3,
        maxItems: 3,
        vectorLengthMinimum: -1,
        items: { type: 'number' },
      }),
    ).toThrow('vectorLengthMinimum must be nonnegative');
  });

  it.each(['constructor', 'toString', '__proto__'])(
    'rejects inherited-object property name %s unless the schema declares it',
    (propertyName) => {
      const value = JSON.parse(`{"${propertyName}":"unexpected"}`) as Record<string, unknown>;
      const schema = {
        type: 'object',
        properties: { radius: { type: 'number' } },
        additionalProperties: false,
      } as const;

      expect(validateActionArguments(value, schema)).toEqual([`unknown ${propertyName}`]);
    },
  );
});
