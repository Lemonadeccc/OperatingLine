import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { openOperatingLineDatabase } from '@operatingline/persistence';

describe('OperatingLine persistence', () => {
  it('stores append-only execution events', () => {
    const database = openOperatingLineDatabase(':memory:');

    database.appendEvent({
      id: randomUUID(),
      eventType: 'runtime.started',
      payload: { adapter: 'fake-blender' },
    });

    expect(database.countEvents()).toBe(1);
    database.close();
  });
});
