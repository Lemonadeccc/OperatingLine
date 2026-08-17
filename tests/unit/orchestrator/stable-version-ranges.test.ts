import { describe, expect, it } from 'vitest';

import {
  isStableVersionRangeSubset,
  satisfiesStableVersionRange,
} from '@operatingline/orchestrator';

describe('stable version ranges', () => {
  it('preserves companion version matching semantics', () => {
    expect(satisfiesStableVersionRange('4.5.3', '>=4.5.0 <4.6.0', 'Host')).toBe(true);
    expect(satisfiesStableVersionRange('4.5.3 LTS', '>=4.5.0 <4.6.0', 'Host')).toBe(true);
    expect(satisfiesStableVersionRange('4.6.0', '>=4.5.0 <4.6.0', 'Host')).toBe(false);
    expect(satisfiesStableVersionRange('5.1.1', '>=4.5.0 <4.6.0 || =5.1.1', 'Host')).toBe(true);
  });

  it('accepts only ranges fully contained by the catalog range', () => {
    expect(isStableVersionRangeSubset('>=4.5.0 <4.6.0 || >=5.1.0 <5.2.0', '>=4.5.0 <5.2.0')).toBe(
      true,
    );
    expect(isStableVersionRangeSubset('>=4.5.1 <4.5.9', '>=4.5.0 <4.6.0')).toBe(true);
    expect(isStableVersionRangeSubset('>=4.5.0 <=4.6.0', '>=4.5.0 <4.6.0')).toBe(false);
    expect(isStableVersionRangeSubset('>=4.5.0 <5.2.0', '>=4.5.0 <4.6.0 || >=5.1.0 <5.2.0')).toBe(
      false,
    );
    expect(isStableVersionRangeSubset('>=6.0.0 <6.1.0', '>=4.5.0 <5.2.0')).toBe(false);
  });
});
