import { describe, expect, it } from 'vitest';

import { closeAll, throwAfterCleanup } from '../../../services/orchestrator/src/lifecycle.js';

describe('runtime resource lifecycle', () => {
  it('attempts every cleanup step and reports all failures in order', async () => {
    const calls: string[] = [];
    const first = new Error('first cleanup failure');
    const second = new Error('second cleanup failure');

    const result = closeAll([
      () => {
        calls.push('app');
        throw first;
      },
      async () => {
        calls.push('mcp');
        throw second;
      },
      () => {
        calls.push('database');
      },
    ]).catch((error: unknown) => error);

    const error = await result;
    expect(calls).toEqual(['app', 'mcp', 'database']);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([first, second]);
    expect((error as Error).cause).toBe(first);
  });

  it('keeps the primary operation error first when cleanup also fails', async () => {
    const primary = new Error('primary failure');
    const cleanup = new Error('cleanup failure');
    const error = await throwAfterCleanup(primary, [() => Promise.reject(cleanup)]).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([primary, cleanup]);
    expect((error as Error).cause).toBe(cleanup);
  });
});
