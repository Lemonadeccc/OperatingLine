import { startRuntime } from '@operatingline/orchestrator';
import { FakePlannerProvider, syntheticCanvasActionCatalog } from '@operatingline/test-kit';
import { describe, expect, it } from 'vitest';

const accessToken = 'companion-initial-plan-run-test-token';
const headers = {
  authorization: `Bearer ${accessToken}`,
  'content-type': 'application/json',
};

describe('companion initial plan Provider authority boundary', () => {
  it('returns deterministic 503 for create and status without invoking the Provider', async () => {
    const fakeProvider = new FakePlannerProvider(() => {
      throw new Error('Initial generation must not run without signed packet-bound authority');
    });
    const runtime = await startRuntime({
      databasePath: ':memory:',
      accessToken,
      actionCatalogs: [syntheticCanvasActionCatalog],
      plannerProviders: [fakeProvider],
    });
    try {
      const create = await fetch(`${runtime.baseUrl}/api/v1/companion/initial-plan-run`, {
        method: 'POST',
        headers,
        body: JSON.stringify({}),
      });
      expect(create.status).toBe(503);
      await expect(create.json()).resolves.toEqual({
        error: 'provider_authority_unavailable',
        message: 'Companion initial-plan Provider calls require signed packet-bound authority',
      });

      const status = await fetch(`${runtime.baseUrl}/api/v1/companion/initial-plan-run`, {
        headers,
      });
      expect(status.status).toBe(503);
      await expect(status.json()).resolves.toEqual({
        error: 'provider_authority_unavailable',
        message: 'Companion initial-plan Provider calls require signed packet-bound authority',
      });
      expect(fakeProvider.inputs).toHaveLength(0);
    } finally {
      await runtime.stop();
    }
  });
});
