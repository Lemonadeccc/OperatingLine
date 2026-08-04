import { describe, expect, it } from 'vitest';

import { adapterStatusSchema, guideProtocolVersion } from '@operatingline/protocol';
import { FakeBlenderAdapter } from '@operatingline/test-kit';

describe('host adapter contract', () => {
  it('publishes a versioned capability profile', async () => {
    const status = adapterStatusSchema.parse(await new FakeBlenderAdapter().getStatus());

    expect(status.protocolVersions).toContain(guideProtocolVersion);
    expect(status.capabilities.presentation.viewportOverlay).toBe('native');
    expect(status.capabilities.runtime.dispatch).toBe('main_thread_serial');
  });

  it('rejects unknown adapter fields at every protocol boundary', async () => {
    const status = await new FakeBlenderAdapter().getStatus();

    expect(adapterStatusSchema.safeParse({ ...status, unexpected: true }).success).toBe(false);
    expect(
      adapterStatusSchema.safeParse({
        ...status,
        capabilities: { ...status.capabilities, unexpected: true },
      }).success,
    ).toBe(false);
  });
});
