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

const sha256RoundConstants = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const rotateRight = (value: number, amount: number) =>
  (value >>> amount) | (value << (32 - amount));

/** Portable synchronous SHA-256 over canonical protocol JSON bytes. */
export function computeProtocolCanonicalJsonSha256(value: unknown): string {
  const bytes = canonicalizeProtocolJsonValue(value);
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bitLength = bytes.length * 8;
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);
  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const words = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1)
      words[index] = view.getUint32(offset + index * 4, false);
    for (let index = 16; index < 64; index += 1) {
      const left = words[index - 15]!;
      const right = words[index - 2]!;
      words[index] =
        (words[index - 16]! +
          (rotateRight(left, 7) ^ rotateRight(left, 18) ^ (left >>> 3)) +
          words[index - 7]! +
          (rotateRight(right, 17) ^ rotateRight(right, 19) ^ (right >>> 10))) >>>
        0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const t1 =
        (h! +
          (rotateRight(e!, 6) ^ rotateRight(e!, 11) ^ rotateRight(e!, 25)) +
          ((e! & f!) ^ (~e! & g!)) +
          sha256RoundConstants[index]! +
          words[index]!) >>>
        0;
      const t2 =
        ((rotateRight(a!, 2) ^ rotateRight(a!, 13) ^ rotateRight(a!, 22)) +
          ((a! & b!) ^ (a! & c!) ^ (b! & c!))) >>>
        0;
      h = g;
      g = f;
      f = e;
      e = (d! + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    hash[0] = (hash[0]! + a!) >>> 0;
    hash[1] = (hash[1]! + b!) >>> 0;
    hash[2] = (hash[2]! + c!) >>> 0;
    hash[3] = (hash[3]! + d!) >>> 0;
    hash[4] = (hash[4]! + e!) >>> 0;
    hash[5] = (hash[5]! + f!) >>> 0;
    hash[6] = (hash[6]! + g!) >>> 0;
    hash[7] = (hash[7]! + h!) >>> 0;
  }
  return Array.from(hash, (word) => word.toString(16).padStart(8, '0')).join('');
}
