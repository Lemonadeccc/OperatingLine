import { blenderActionCatalog } from '@operatingline/blender-action-catalog';
import { startRuntime } from '@operatingline/orchestrator';
import { FakePlannerProvider } from '@operatingline/test-kit';
import { describe, expect, it } from 'vitest';

const accessToken = 'companion-dialogue-run-test-token';
const headers = {
  authorization: `Bearer ${accessToken}`,
  'content-type': 'application/json',
};

describe('companion dialogue Provider authority boundary', () => {
  it('returns deterministic 503 for create and status without invoking the Provider', async () => {
    const fakeProvider = new FakePlannerProvider(
      () => {
        throw new Error('Initial generation must not run in dialogue boundary tests');
      },
      undefined,
      undefined,
      async () => {
        throw new Error('Dialogue must not run without signed packet-bound authority');
      },
    );
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: [blenderActionCatalog],
      plannerProviders: [fakeProvider],
    });
    try {
      const create = await fetch(`${runtime.baseUrl}/api/v1/companion/dialogue-run`, {
        method: 'POST',
        headers,
        body: JSON.stringify({}),
      });
      expect(create.status).toBe(503);
      await expect(create.json()).resolves.toEqual({
        error: 'provider_authority_unavailable',
        message: 'Companion dialogue Provider calls require signed packet-bound authority',
      });

      const status = await fetch(`${runtime.baseUrl}/api/v1/companion/dialogue-run`, { headers });
      expect(status.status).toBe(503);
      await expect(status.json()).resolves.toEqual({
        error: 'provider_authority_unavailable',
        message: 'Companion dialogue Provider calls require signed packet-bound authority',
      });
      expect(fakeProvider.dialogueInputs).toHaveLength(0);
      expect(fakeProvider.replanInputs).toHaveLength(0);
    } finally {
      await runtime.stop();
    }
  });
});
