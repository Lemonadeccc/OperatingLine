const schemaKeywords = new Set([
  'type',
  'description',
  'required',
  'properties',
  'additionalProperties',
  'items',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minLength',
  'maxLength',
  'pattern',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'enum',
  'const',
  'oneOf',
  'anyOf',
  'uniqueResourceIds',
  'uniqueObjectNames',
  'uniqueBoneNames',
  'uniqueTargetIds',
  'uniqueVertexIndices',
  'weightsSumToOne',
  'acyclicParents',
  'strictlyIncreasingFrames',
  'distinctPropertyValues',
  'atLeastOnePositiveProperty',
]);

const supportedTypes = new Set([
  'object',
  'array',
  'string',
  'number',
  'integer',
  'boolean',
  'null',
]);
const customArrayKeywords = [
  'uniqueResourceIds',
  'uniqueObjectNames',
  'uniqueBoneNames',
  'uniqueTargetIds',
  'uniqueVertexIndices',
  'weightsSumToOne',
  'acyclicParents',
  'strictlyIncreasingFrames',
] as const;
const customObjectKeywords = ['distinctPropertyValues', 'atLeastOnePositiveProperty'] as const;

type SchemaRecord = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function schemaError(path: string, message: string): never {
  throw new Error(`Invalid action arguments schema at ${path}: ${message}`);
}

function requireNonnegativeInteger(schema: SchemaRecord, keyword: string, path: string): void {
  const value = schema[keyword];
  if (value !== undefined && (!Number.isInteger(value) || (value as number) < 0)) {
    schemaError(path, `${keyword} must be a nonnegative integer`);
  }
}

function requireFiniteNumber(schema: SchemaRecord, keyword: string, path: string): void {
  const value = schema[keyword];
  if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value))) {
    schemaError(path, `${keyword} must be a finite number`);
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function customObjectItemSchemas(
  items: SchemaRecord,
  keyword: (typeof customArrayKeywords)[number],
  path: string,
): SchemaRecord[] {
  if (items.type === 'object') {
    return [items];
  }
  const oneOf = items.oneOf;
  const usesOnlyOneOf = Object.keys(items).every((key) => key === 'oneOf' || key === 'description');
  if (!usesOnlyOneOf || !Array.isArray(oneOf)) {
    schemaError(path, `${keyword} requires object items or a oneOf of object items`);
  }
  return oneOf.map((alternative, index) => {
    if (!isRecord(alternative) || alternative.type !== 'object') {
      schemaError(
        `${path}.items.oneOf[${index}]`,
        `${keyword} requires every item alternative to be type object`,
      );
    }
    return alternative;
  });
}

function requireCustomItemField(
  itemSchemas: readonly SchemaRecord[],
  keyword: (typeof customArrayKeywords)[number],
  field: string,
  path: string,
  acceptsSchema: (schema: SchemaRecord) => boolean,
  expectedType: string,
): void {
  itemSchemas.forEach((itemSchema, index) => {
    const properties = itemSchema.properties;
    const required = itemSchema.required;
    const branchPath = itemSchemas.length === 1 ? `${path}.items` : `${path}.items.oneOf[${index}]`;
    if (
      !isRecord(properties) ||
      !Array.isArray(required) ||
      !required.includes(field) ||
      !Object.prototype.hasOwnProperty.call(properties, field) ||
      !isRecord(properties[field]) ||
      !acceptsSchema(properties[field])
    ) {
      schemaError(
        branchPath,
        `${keyword} requires a required ${field} field with ${expectedType} schema`,
      );
    }
  });
}

function isNullableStringSchema(schema: SchemaRecord): boolean {
  const alternatives = schema.anyOf ?? schema.oneOf;
  if (!Array.isArray(alternatives) || alternatives.length !== 2) {
    return false;
  }
  const types = alternatives.map((alternative) =>
    isRecord(alternative) && typeof alternative.type === 'string' ? alternative.type : null,
  );
  return new Set(types).size === 2 && types.includes('string') && types.includes('null');
}

function validateCustomArraySchema(schema: SchemaRecord, path: string): void {
  const items = schema.items;
  if (!isRecord(items)) {
    return;
  }
  const uniquenessFields = [
    ['uniqueResourceIds', 'resourceId'],
    ['uniqueObjectNames', 'objectName'],
    ['uniqueBoneNames', 'boneName'],
    ['uniqueTargetIds', 'targetId'],
    ['uniqueVertexIndices', 'vertexIndex'],
  ] as const;
  for (const [keyword, field] of uniquenessFields) {
    if (schema[keyword] === true) {
      const itemSchemas = customObjectItemSchemas(items, keyword, path);
      requireCustomItemField(
        itemSchemas,
        keyword,
        field,
        path,
        (fieldSchema) =>
          keyword === 'uniqueVertexIndices'
            ? fieldSchema.type === 'integer'
            : fieldSchema.type === 'string',
        keyword === 'uniqueVertexIndices' ? 'type integer' : 'type string',
      );
    }
  }
  if (schema.weightsSumToOne === true) {
    const itemSchemas = customObjectItemSchemas(items, 'weightsSumToOne', path);
    requireCustomItemField(
      itemSchemas,
      'weightsSumToOne',
      'weight',
      path,
      (fieldSchema) => fieldSchema.type === 'number',
      'type number',
    );
  }
  if (schema.acyclicParents === true) {
    if (schema.uniqueBoneNames !== true) {
      schemaError(path, 'acyclicParents requires uniqueBoneNames true');
    }
    const itemSchemas = customObjectItemSchemas(items, 'acyclicParents', path);
    requireCustomItemField(
      itemSchemas,
      'acyclicParents',
      'parentName',
      path,
      isNullableStringSchema,
      'string-or-null',
    );
  }
  if (schema.strictlyIncreasingFrames === true) {
    const itemSchemas = customObjectItemSchemas(items, 'strictlyIncreasingFrames', path);
    requireCustomItemField(
      itemSchemas,
      'strictlyIncreasingFrames',
      'frame',
      path,
      (fieldSchema) => fieldSchema.type === 'integer' || fieldSchema.type === 'number',
      'numeric',
    );
  }
}

function customRequiredPropertyNames(
  schema: SchemaRecord,
  keyword: (typeof customObjectKeywords)[number],
  path: string,
  minimumLength: number,
): string[] {
  const value = schema[keyword];
  if (
    !Array.isArray(value) ||
    value.length < minimumLength ||
    value.some((name) => typeof name !== 'string' || name.length === 0)
  ) {
    schemaError(path, `${keyword} must contain at least ${minimumLength} nonempty property names`);
  }
  if (new Set(value).size !== value.length) {
    schemaError(path, `${keyword} must not repeat property names`);
  }

  const properties = schema.properties;
  const required = schema.required;
  if (!isRecord(properties) || !Array.isArray(required)) {
    schemaError(path, `${keyword} requires declared required properties`);
  }
  for (const name of value) {
    if (!Object.prototype.hasOwnProperty.call(properties, name) || !required.includes(name)) {
      schemaError(path, `${keyword} references non-required property ${name}`);
    }
  }
  return value;
}

function validateCustomObjectSchema(schema: SchemaRecord, path: string): void {
  if (schema.distinctPropertyValues !== undefined) {
    customRequiredPropertyNames(schema, 'distinctPropertyValues', path, 2);
  }
  if (schema.atLeastOnePositiveProperty !== undefined) {
    const propertyNames = customRequiredPropertyNames(
      schema,
      'atLeastOnePositiveProperty',
      path,
      1,
    );
    const properties = schema.properties as SchemaRecord;
    for (const name of propertyNames) {
      const propertySchema = properties[name];
      if (
        !isRecord(propertySchema) ||
        (propertySchema.type !== 'number' && propertySchema.type !== 'integer')
      ) {
        schemaError(path, `atLeastOnePositiveProperty requires numeric property ${name}`);
      }
    }
  }
}

function validateSchemaNode(value: unknown, path: string): void {
  if (!isRecord(value)) {
    schemaError(path, 'schema must be an object');
  }
  for (const keyword of Object.keys(value)) {
    if (!schemaKeywords.has(keyword)) {
      schemaError(path, `unknown keyword ${keyword}`);
    }
    if (value[keyword] === undefined) {
      schemaError(path, `${keyword} cannot be undefined`);
    }
  }

  const type = value.type;
  if (type !== undefined && (typeof type !== 'string' || !supportedTypes.has(type))) {
    schemaError(path, 'type is unsupported');
  }
  if (value.description !== undefined && typeof value.description !== 'string') {
    schemaError(path, 'description must be a string');
  }

  const properties = value.properties;
  const required = value.required;
  if (
    properties !== undefined ||
    required !== undefined ||
    value.additionalProperties !== undefined
  ) {
    if (type !== 'object') {
      schemaError(path, 'object keywords require type object');
    }
    if (!isRecord(properties)) {
      schemaError(path, 'properties must be an object');
    }
    if (value.additionalProperties !== false) {
      schemaError(path, 'additionalProperties must be false');
    }
    for (const [name, propertySchema] of Object.entries(properties)) {
      validateSchemaNode(propertySchema, `${path}.properties.${name}`);
    }
    if (required !== undefined) {
      if (
        !Array.isArray(required) ||
        required.some((name) => typeof name !== 'string' || name.length === 0)
      ) {
        schemaError(path, 'required must contain nonempty property names');
      }
      if (new Set(required).size !== required.length) {
        schemaError(path, 'required repeats a property name');
      }
      for (const name of required) {
        if (!Object.prototype.hasOwnProperty.call(properties, name)) {
          schemaError(path, `requires unknown argument property ${name}`);
        }
      }
    }
  } else if (type === 'object') {
    schemaError(path, 'object schemas require properties and additionalProperties false');
  }

  if (customObjectKeywords.some((keyword) => value[keyword] !== undefined)) {
    if (type !== 'object') {
      schemaError(path, 'object property keywords require type object');
    }
    validateCustomObjectSchema(value, path);
  }

  const usesArrayKeyword =
    value.items !== undefined ||
    value.minItems !== undefined ||
    value.maxItems !== undefined ||
    value.uniqueItems !== undefined ||
    customArrayKeywords.some((keyword) => value[keyword] !== undefined);
  if (usesArrayKeyword) {
    if (type !== 'array') {
      schemaError(path, 'array keywords require type array');
    }
    if (value.items === undefined) {
      schemaError(path, 'array schemas require items');
    }
    validateSchemaNode(value.items, `${path}.items`);
    requireNonnegativeInteger(value, 'minItems', path);
    requireNonnegativeInteger(value, 'maxItems', path);
    if (value.uniqueItems !== undefined && typeof value.uniqueItems !== 'boolean') {
      schemaError(path, 'uniqueItems must be a boolean');
    }
    for (const keyword of customArrayKeywords) {
      if (value[keyword] !== undefined && value[keyword] !== true) {
        schemaError(path, `${keyword} must be true`);
      }
    }
    if (
      typeof value.minItems === 'number' &&
      typeof value.maxItems === 'number' &&
      value.minItems > value.maxItems
    ) {
      schemaError(path, 'minItems cannot exceed maxItems');
    }
    validateCustomArraySchema(value, path);
  } else if (type === 'array') {
    schemaError(path, 'array schemas require items');
  }

  if (
    value.minLength !== undefined ||
    value.maxLength !== undefined ||
    value.pattern !== undefined
  ) {
    if (type !== 'string') {
      schemaError(path, 'string keywords require type string');
    }
    requireNonnegativeInteger(value, 'minLength', path);
    requireNonnegativeInteger(value, 'maxLength', path);
    if (typeof value.pattern === 'string') {
      try {
        new RegExp(value.pattern);
      } catch {
        schemaError(path, 'pattern must be a valid regular expression');
      }
    } else if (value.pattern !== undefined) {
      schemaError(path, 'pattern must be a string');
    }
    if (
      typeof value.minLength === 'number' &&
      typeof value.maxLength === 'number' &&
      value.minLength > value.maxLength
    ) {
      schemaError(path, 'minLength cannot exceed maxLength');
    }
  }

  const usesNumericKeyword =
    value.minimum !== undefined ||
    value.maximum !== undefined ||
    value.exclusiveMinimum !== undefined;
  if (usesNumericKeyword) {
    if (type !== 'number' && type !== 'integer') {
      schemaError(path, 'numeric keywords require type number or integer');
    }
    requireFiniteNumber(value, 'minimum', path);
    requireFiniteNumber(value, 'maximum', path);
    requireFiniteNumber(value, 'exclusiveMinimum', path);
    if (
      typeof value.minimum === 'number' &&
      typeof value.maximum === 'number' &&
      value.minimum > value.maximum
    ) {
      schemaError(path, 'minimum cannot exceed maximum');
    }
    if (
      typeof value.exclusiveMinimum === 'number' &&
      typeof value.maximum === 'number' &&
      value.exclusiveMinimum >= value.maximum
    ) {
      schemaError(path, 'exclusiveMinimum must be less than maximum');
    }
  }

  if (value.enum !== undefined) {
    if (!Array.isArray(value.enum) || value.enum.length === 0 || !value.enum.every(isJsonValue)) {
      schemaError(path, 'enum must be a nonempty array of JSON values');
    }
    if (new Set(value.enum.map(canonicalJson)).size !== value.enum.length) {
      schemaError(path, 'enum values must be unique');
    }
  }
  if (value.const !== undefined && !isJsonValue(value.const)) {
    schemaError(path, 'const must be a JSON value');
  }
  for (const keyword of ['oneOf', 'anyOf'] as const) {
    const alternatives = value[keyword];
    if (alternatives !== undefined) {
      if (!Array.isArray(alternatives) || alternatives.length === 0) {
        schemaError(path, `${keyword} must be a nonempty schema array`);
      }
      alternatives.forEach((alternative, index) =>
        validateSchemaNode(alternative, `${path}.${keyword}[${index}]`),
      );
    }
  }
  if (
    type === undefined &&
    value.enum === undefined &&
    value.const === undefined &&
    value.oneOf === undefined &&
    value.anyOf === undefined
  ) {
    schemaError(path, 'schema must declare type, enum, const, oneOf, or anyOf');
  }
}

export function validateActionArgumentsSchema(schema: unknown, path = 'argumentsSchema'): void {
  validateSchemaNode(schema, path);
}

function valueTypeMatches(value: unknown, type: string): boolean {
  switch (type) {
    case 'object':
      return isRecord(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    default:
      return false;
  }
}

function childPath(path: string, property: string): string {
  return path.length === 0 ? property : `${path}.${property}`;
}

function itemPath(path: string, index: number): string {
  return `${path}[${index}]`;
}

function validateCustomArrayRules(value: unknown[], schema: SchemaRecord, path: string): string[] {
  const errors: string[] = [];
  const uniquenessFields = [
    ['uniqueResourceIds', 'resourceId'],
    ['uniqueObjectNames', 'objectName'],
    ['uniqueBoneNames', 'boneName'],
    ['uniqueTargetIds', 'targetId'],
    ['uniqueVertexIndices', 'vertexIndex'],
  ] as const;
  for (const [keyword, field] of uniquenessFields) {
    if (schema[keyword] === true) {
      const seen = new Set<unknown>();
      value.forEach((item, index) => {
        const fieldValue = isRecord(item) ? item[field] : undefined;
        if (fieldValue === undefined) {
          return;
        }
        if (seen.has(fieldValue)) {
          errors.push(`${itemPath(path, index)}.${field} must be unique`);
        }
        seen.add(fieldValue);
      });
    }
  }
  if (schema.weightsSumToOne === true) {
    const total = value.reduce<number>(
      (sum, item) => sum + (isRecord(item) && typeof item.weight === 'number' ? item.weight : 0),
      0,
    );
    if (!Number.isFinite(total) || Math.abs(total - 1) > 1e-6) {
      errors.push(`${path || 'arguments'} weights must sum to 1`);
    }
  }
  if (schema.strictlyIncreasingFrames === true) {
    for (let index = 1; index < value.length; index += 1) {
      const previous = value[index - 1];
      const current = value[index];
      if (
        isRecord(previous) &&
        isRecord(current) &&
        typeof previous.frame === 'number' &&
        typeof current.frame === 'number' &&
        current.frame <= previous.frame
      ) {
        errors.push(`${itemPath(path, index)}.frame must be strictly increasing`);
      }
    }
  }
  if (schema.acyclicParents === true) {
    const parents = new Map<string, string | null>();
    for (const item of value) {
      if (isRecord(item) && typeof item.boneName === 'string') {
        parents.set(item.boneName, typeof item.parentName === 'string' ? item.parentName : null);
      }
    }
    for (const [name, parent] of parents) {
      if (parent !== null && !parents.has(parent)) {
        errors.push(`${path || 'arguments'} parentName ${parent} references unknown bone`);
        continue;
      }
      const visited = new Set<string>([name]);
      let cursor = parent;
      while (cursor !== null) {
        if (visited.has(cursor)) {
          errors.push(`${path || 'arguments'} parents must be acyclic`);
          break;
        }
        visited.add(cursor);
        cursor = parents.get(cursor) ?? null;
      }
      if (errors.some((error) => error.endsWith('parents must be acyclic'))) {
        break;
      }
    }
  }
  return errors;
}

function validateCustomObjectRules(
  value: Record<string, unknown>,
  schema: SchemaRecord,
  path: string,
): string[] {
  const errors: string[] = [];
  const displayPath = path || 'arguments';
  const distinctPropertyValues = schema.distinctPropertyValues as string[] | undefined;
  if (
    distinctPropertyValues !== undefined &&
    distinctPropertyValues.every((name) => Object.prototype.hasOwnProperty.call(value, name))
  ) {
    const seen = new Map<string, string>();
    for (const name of distinctPropertyValues) {
      const key = canonicalJson(value[name]);
      const previousName = seen.get(key);
      if (previousName !== undefined) {
        errors.push(`${displayPath} properties ${previousName} and ${name} must differ`);
        break;
      }
      seen.set(key, name);
    }
  }

  const positiveProperties = schema.atLeastOnePositiveProperty as string[] | undefined;
  if (
    positiveProperties !== undefined &&
    positiveProperties.every(
      (name) =>
        Object.prototype.hasOwnProperty.call(value, name) && typeof value[name] === 'number',
    ) &&
    !positiveProperties.some((name) => (value[name] as number) > 0)
  ) {
    errors.push(
      `${displayPath} requires at least one positive value among ${positiveProperties.join(', ')}`,
    );
  }
  return errors;
}

function collectArgumentErrors(value: unknown, schema: SchemaRecord, path: string): string[] {
  const oneOf = schema.oneOf as unknown[] | undefined;
  if (oneOf !== undefined) {
    const matches = oneOf.filter(
      (alternative) => collectArgumentErrors(value, alternative as SchemaRecord, path).length === 0,
    ).length;
    if (matches !== 1) {
      return [`${path || 'arguments'} must match exactly one oneOf schema`];
    }
  }
  const anyOf = schema.anyOf as unknown[] | undefined;
  if (
    anyOf !== undefined &&
    !anyOf.some(
      (alternative) => collectArgumentErrors(value, alternative as SchemaRecord, path).length === 0,
    )
  ) {
    return [`${path || 'arguments'} must match at least one anyOf schema`];
  }

  const errors: string[] = [];
  const displayPath = path || 'arguments';
  if (typeof schema.type === 'string' && !valueTypeMatches(value, schema.type)) {
    return [`${displayPath} must be ${schema.type}`];
  }
  if (
    schema.enum !== undefined &&
    !(schema.enum as unknown[]).some((item) => canonicalJson(item) === canonicalJson(value))
  ) {
    errors.push(`${displayPath} must be one of the allowed values`);
  }
  if (schema.const !== undefined && canonicalJson(schema.const) !== canonicalJson(value)) {
    errors.push(`${displayPath} must equal the required constant`);
  }

  if (schema.type === 'object' && isRecord(value)) {
    const properties = schema.properties as Record<string, SchemaRecord>;
    const valueNames = Object.keys(value);
    for (const name of (schema.required as string[] | undefined) ?? []) {
      if (!Object.prototype.hasOwnProperty.call(value, name)) {
        errors.push(`missing ${childPath(path, name)}`);
      }
    }
    for (const name of valueNames) {
      if (!Object.prototype.hasOwnProperty.call(properties, name)) {
        errors.push(`unknown ${childPath(path, name)}`);
      } else {
        const propertySchema = properties[name]!;
        errors.push(...collectArgumentErrors(value[name], propertySchema, childPath(path, name)));
      }
    }
    errors.push(...validateCustomObjectRules(value, schema, path));
  }
  if (schema.type === 'array' && Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      errors.push(`${displayPath} must contain at least ${schema.minItems} items`);
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      errors.push(`${displayPath} must contain at most ${schema.maxItems} items`);
    }
    if (schema.uniqueItems === true && new Set(value.map(canonicalJson)).size !== value.length) {
      errors.push(`${displayPath} items must be unique`);
    }
    const itemSchema = schema.items as SchemaRecord;
    value.forEach((item, index) => {
      errors.push(...collectArgumentErrors(item, itemSchema, `${path}[${index}]`));
    });
    errors.push(...validateCustomArrayRules(value, schema, path));
  }
  if (schema.type === 'string' && typeof value === 'string') {
    const characterLength = Array.from(value).length;
    if (typeof schema.minLength === 'number' && characterLength < schema.minLength) {
      errors.push(`${displayPath} must have length at least ${schema.minLength}`);
    }
    if (typeof schema.maxLength === 'number' && characterLength > schema.maxLength) {
      errors.push(`${displayPath} must have length at most ${schema.maxLength}`);
    }
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${displayPath} must match pattern ${schema.pattern}`);
    }
  }
  if ((schema.type === 'number' || schema.type === 'integer') && typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errors.push(`${displayPath} must be at least ${schema.minimum}`);
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      errors.push(`${displayPath} must be at most ${schema.maximum}`);
    }
    if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) {
      errors.push(`${displayPath} must be greater than ${schema.exclusiveMinimum}`);
    }
  }
  return errors;
}

export function validateActionArguments(argumentsValue: unknown, schema: unknown): string[] {
  validateActionArgumentsSchema(schema);
  return collectArgumentErrors(argumentsValue, schema as SchemaRecord, '');
}
