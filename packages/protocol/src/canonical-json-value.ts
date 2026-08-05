const textEncoder = new TextEncoder();

type JsonPrimitive = null | boolean | number | string;
export type JsonValue =
  JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export const protocolJsonValueCanonicalization = 'operatingline-json-value-v1' as const;

function ascii(value: string): Uint8Array {
  return textEncoder.encode(value);
}

function concatenate(parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.byteLength, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function lengthDelimited(value: Uint8Array): Uint8Array {
  return concatenate([ascii(`${value.byteLength}:`), value]);
}

function validUnicodeBytes(value: string): Uint8Array {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const trailing = value.charCodeAt(index + 1);
      if (!(trailing >= 0xdc00 && trailing <= 0xdfff)) {
        throw new TypeError('Canonical JSON strings must contain valid Unicode');
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new TypeError('Canonical JSON strings must contain valid Unicode');
    }
  }
  return textEncoder.encode(value);
}

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  const sharedLength = Math.min(left.byteLength, right.byteLength);
  for (let index = 0; index < sharedLength; index += 1) {
    const difference = left[index]! - right[index]!;
    if (difference !== 0) return difference;
  }
  return left.byteLength - right.byteLength;
}

function encodeNumber(value: number): Uint8Array {
  if (!Number.isFinite(value)) {
    throw new TypeError('Canonical JSON numbers must be finite');
  }
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, Object.is(value, -0) ? 0 : value, false);
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return ascii(`d${hex}`);
}

function encode(value: unknown, ancestors: Set<object>): Uint8Array {
  if (value === null) return ascii('n');
  if (value === false) return ascii('f');
  if (value === true) return ascii('t');
  if (typeof value === 'number') return encodeNumber(value);
  if (typeof value === 'string') {
    const bytes = validUnicodeBytes(value);
    return concatenate([ascii(`s${bytes.byteLength}:`), bytes]);
  }
  if (typeof value !== 'object') {
    throw new TypeError('Value is not a JSON value');
  }
  if (ancestors.has(value)) {
    throw new TypeError('Canonical JSON values must not contain cycles');
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const items = Array.from({ length: value.length }, (_, index) =>
        lengthDelimited(encode(value[index], ancestors)),
      );
      return concatenate([ascii(`a${value.length}:`), ...items]);
    }
    const entries = Object.keys(value as object).map((key) => ({
      key,
      keyBytes: validUnicodeBytes(key),
      value: (value as Record<string, unknown>)[key],
    }));
    entries.sort((left, right) => compareBytes(left.keyBytes, right.keyBytes));
    const parts: Uint8Array[] = [ascii(`o${entries.length}:`)];
    for (const entry of entries) {
      const encodedKey = concatenate([ascii(`s${entry.keyBytes.byteLength}:`), entry.keyBytes]);
      parts.push(lengthDelimited(encodedKey));
      parts.push(lengthDelimited(encode(entry.value, ancestors)));
    }
    return concatenate(parts);
  } finally {
    ancestors.delete(value);
  }
}

/** Encode a semantic JSON value into a portable, length-delimited byte sequence. */
export function canonicalizeProtocolJsonValue(value: unknown): Uint8Array {
  return encode(value, new Set());
}
