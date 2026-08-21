import { describe, expect, it } from 'vitest';

import { procedureLeafReplayObservationSchema } from '@operatingline/protocol';

const mirrorObservation = () => ({
  kind: 'modifier_ready' as const,
  satisfied: true as const,
  details: {
    parameters: {
      targetId: 'tutorial.cube',
      modifierId: 'tutorial.cube.mirror',
      modifierType: 'MIRROR' as const,
      axis: 'Y' as const,
    },
    supported: true as const,
    targetId: 'tutorial.cube',
    modifierId: 'tutorial.cube.mirror',
    modifierType: 'MIRROR' as const,
    propertiesMatch: true as const,
    axis: 'Y' as const,
    expectedAxis: 'Y' as const,
    mirrorFixedStateMatches: true as const,
    mirrorObjectAbsent: true as const,
    sourceContentIntact: true as const,
    evaluatedVertexCount: 16,
    evaluatedEdgeCount: 24,
    evaluatedFaceCount: 10,
    evaluatedFinite: true as const,
    evaluatedWithinLimits: true as const,
  },
});

describe('managed Mirror replay observation', () => {
  it('accepts the exact strong modifier-ready contract', () => {
    expect(procedureLeafReplayObservationSchema.parse(mirrorObservation())).toEqual(
      mirrorObservation(),
    );
  });

  it.each(['missing fixed-state proof', 'axis mismatch', 'unbounded topology'] as const)(
    'rejects %s',
    (failure) => {
      const observation: Record<string, unknown> = structuredClone(mirrorObservation());
      const details = observation['details'] as Record<string, unknown>;
      if (failure === 'missing fixed-state proof') delete details['mirrorFixedStateMatches'];
      if (failure === 'axis mismatch') details['axis'] = 'X';
      if (failure === 'unbounded topology') details['evaluatedVertexCount'] = 8193;

      expect(procedureLeafReplayObservationSchema.safeParse(observation).success).toBe(false);
    },
  );
});
