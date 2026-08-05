import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  canonicalizeProtocolJsonValue,
  protocolJsonValueCanonicalization,
} from '@operatingline/protocol';

const sha256 = (value: unknown): string =>
  createHash('sha256').update(canonicalizeProtocolJsonValue(value)).digest('hex');

describe('portable canonical JSON-value encoding', () => {
  it('has a stable profile identifier', () => {
    expect(protocolJsonValueCanonicalization).toBe('operatingline-json-value-v1');
  });

  it.each([
    [1e-7, '69b47e10cce2f956c2d24354284f67ee84f3a0d9d072563498718fd1bb1a3cc3'],
    [1e20, '1df21ce650e785b5d5abb0115da72f0198295bd3befc35ee7bb0bad6b4048c76'],
    [-0, '5b87553ae592ab403ab5f5ebfb177424b7c26ca3de95a76b160ac1aef027f1de'],
    [
      {
        '10': 'ten',
        '2': 'two',
        é: 'accent',
        '😀': 'emoji',
        text: 'hello 😀',
        small: 1e-7,
        large: 1e20,
        zero: -0,
      },
      '53034233732c02e4a0058220b140da17c9fe8242f55c9455bdb7724529980149',
    ],
    [['😀', -0, 1e-7, 1e20], '6cf88735d4a75d91930a01aaaeaaece30f54a260d2e10362321a70e42c598b66'],
  ])('matches shared vector %#', (value, expected) => {
    expect(sha256(value)).toBe(expected);
  });

  it('sorts object keys by UTF-8 bytes rather than JavaScript key enumeration', () => {
    expect(canonicalizeProtocolJsonValue({ '2': 'two', '10': 'ten', '😀': 1, é: 2 })).toEqual(
      canonicalizeProtocolJsonValue({ é: 2, '😀': 1, '10': 'ten', '2': 'two' }),
    );
  });

  it('rejects non-JSON numbers, values, cycles, and invalid Unicode', () => {
    const cycle: unknown[] = [];
    cycle.push(cycle);
    for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, undefined, cycle, '\ud800']) {
      expect(() => canonicalizeProtocolJsonValue(invalid)).toThrow();
    }
  });
});
