import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { blenderActionCatalog } from '@operatingline/blender-action-catalog';
import type { StoredExecutionEvent } from '@operatingline/persistence';

import { createEvalExport } from '../../../services/orchestrator/src/eval-export.js';

const instanceId = '11111111-1111-4111-8111-111111111111';
const otherInstanceId = '22222222-2222-4222-8222-222222222222';
const createdAt = '2026-08-17T08:00:00.000Z';

function event(
  sequence: number,
  eventType: 'procedure.leaf-replay.proposed' | 'procedure.leaf-replay.attested',
  payload: unknown,
): StoredExecutionEvent {
  return {
    sequence,
    id: `event-${sequence}`,
    eventType,
    payload,
    createdAt,
  };
}

function replayProposalPayload(planId: string, targetInstanceId = instanceId): unknown {
  return {
    formatVersion: '1.0.0',
    replayId: randomUUID(),
    targetInstanceId,
    proposal: {
      targetAdapterId: 'blender',
      plan: { id: planId, revision: 1 },
    },
  };
}

function replayAttestationPayload(planId: string, targetInstanceId = instanceId): unknown {
  return {
    formatVersion: '1.0.0',
    replayId: randomUUID(),
    execution: {
      host: { adapterId: 'blender', instanceId: targetInstanceId, version: '4.5.3' },
      plan: { id: planId, revision: 1, contentSha256: 'a'.repeat(64) },
    },
  };
}

describe('eval export procedure leaf replay scope', () => {
  it('includes matching replay events and excludes unrelated or malformed replay events', () => {
    const events = [
      event(1, 'procedure.leaf-replay.proposed', replayProposalPayload('snowman')),
      event(2, 'procedure.leaf-replay.attested', replayAttestationPayload('snowman')),
      event(3, 'procedure.leaf-replay.proposed', replayProposalPayload('snowman', otherInstanceId)),
      event(
        4,
        'procedure.leaf-replay.attested',
        replayAttestationPayload('snowman', otherInstanceId),
      ),
      event(5, 'procedure.leaf-replay.proposed', replayProposalPayload('other-plan')),
      event(6, 'procedure.leaf-replay.attested', replayAttestationPayload('other-plan')),
      event(7, 'procedure.leaf-replay.proposed', { targetInstanceId: instanceId }),
      event(8, 'procedure.leaf-replay.attested', { execution: { plan: { id: 'snowman' } } }),
      event(9, 'procedure.leaf-replay.proposed', {
        proposal: { targetAdapterId: 'blender', plan: { id: 'snowman' } },
      }),
      event(10, 'procedure.leaf-replay.attested', {
        execution: { host: { adapterId: 'blender' }, plan: { id: 'snowman' } },
      }),
    ];

    const bundle = createEvalExport({
      request: {
        targetAdapterId: 'blender',
        planId: 'snowman',
        instanceId,
        afterSequence: 0,
        limit: 100,
      },
      availableCatalogs: [blenderActionCatalog],
      events,
      exportId: '33333333-3333-4333-8333-333333333333',
      exportedAt: createdAt,
    });

    expect(bundle.events.map(({ sequence, eventType }) => ({ sequence, eventType }))).toEqual([
      { sequence: 1, eventType: 'procedure.leaf-replay.proposed' },
      { sequence: 2, eventType: 'procedure.leaf-replay.attested' },
    ]);
    expect(bundle.summary).toMatchObject({
      matchedEventCount: 2,
      eventTypeCounts: {
        'procedure.leaf-replay.proposed': 1,
        'procedure.leaf-replay.attested': 1,
      },
    });
  });
});
