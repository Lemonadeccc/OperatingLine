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
