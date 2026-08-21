import { describe, expect, it, vi } from 'vitest';

import {
  createProcedureTutorialMediaAuthoringPreparationCoordinator,
  procedureTutorialMediaAuthoringPreparationCoordinatorHttpStatus,
  ProcedureTutorialMediaAuthoringPreparationCoordinatorError,
} from '../../../services/orchestrator/src/procedure-tutorial-media-authoring-preparation-coordinator.js';

const firstRequest = {
  formatVersion: '1.0.0',
  analysisRequestId: '11111111-1111-4111-8111-111111111111',
  analysisJobId: '22222222-2222-4222-8222-222222222222',
  request: {
    targetAdapterId: 'blender',
    actionCatalogVersion: '1.0.0',
    interactionCatalogVersion: '1.0.0',
    goal: 'Create an eye.',
    treeId: 'tutorial.eye',
    revision: 1,
    locale: 'en',
  },
  video: {
    title: 'Eye tutorial',
  },
} as const;

const preparation = {
  status: 'ready',
} as never;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('procedure tutorial media authoring preparation coordinator', () => {
  it('coalesces exact concurrent requests and permits a fresh verification after completion', async () => {
    const first = deferred<typeof preparation>();
    const prepare = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(preparation);
    const coordinator = createProcedureTutorialMediaAuthoringPreparationCoordinator({ prepare });

    const pendingA = coordinator.prepare(firstRequest);
    const pendingB = coordinator.prepare(structuredClone(firstRequest));
    expect(pendingB).toBe(pendingA);
    expect(prepare).not.toHaveBeenCalled();

    await Promise.resolve();
    expect(prepare).toHaveBeenCalledTimes(1);
    first.resolve(preparation);
    await expect(Promise.all([pendingA, pendingB])).resolves.toEqual([preparation, preparation]);

    await expect(coordinator.prepare(firstRequest)).resolves.toBe(preparation);
    expect(prepare).toHaveBeenCalledTimes(2);
  });

  it('fails closed when one analysis identity is concurrently reused with different input', async () => {
    const first = deferred<typeof preparation>();
    const coordinator = createProcedureTutorialMediaAuthoringPreparationCoordinator({
      prepare: () => first.promise,
    });
    const pending = coordinator.prepare(firstRequest);

    expect(() =>
      coordinator.prepare({
        ...firstRequest,
        request: { ...firstRequest.request, goal: 'Create a different eye.' },
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ProcedureTutorialMediaAuthoringPreparationCoordinatorError>>({
        code: 'conflict',
      }),
    );

    first.resolve(preparation);
    await pending;
  });

  it('rejects an independent preparation at capacity without invoking it', async () => {
    const first = deferred<typeof preparation>();
    const prepare = vi.fn(() => first.promise);
    const coordinator = createProcedureTutorialMediaAuthoringPreparationCoordinator({
      maximumConcurrentPreparations: 1,
      prepare,
    });
    const pending = coordinator.prepare(firstRequest);

    expect(() =>
      coordinator.prepare({
        ...firstRequest,
        analysisRequestId: '33333333-3333-4333-8333-333333333333',
        analysisJobId: '44444444-4444-4444-8444-444444444444',
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ProcedureTutorialMediaAuthoringPreparationCoordinatorError>>({
        code: 'capacity_exceeded',
      }),
    );
    expect(prepare).not.toHaveBeenCalled();

    first.resolve(preparation);
    await pending;
  });

  it('coalesces existing work while closing, rejects new work, and drains before close resolves', async () => {
    const first = deferred<typeof preparation>();
    const prepare = vi.fn(() => first.promise);
    const coordinator = createProcedureTutorialMediaAuthoringPreparationCoordinator({ prepare });
    const pending = coordinator.prepare(firstRequest);
    await Promise.resolve();
    expect(prepare).toHaveBeenCalledTimes(1);

    coordinator.beginClose();
    expect(coordinator.prepare(structuredClone(firstRequest))).toBe(pending);
    expect(() =>
      coordinator.prepare({
        ...firstRequest,
        analysisRequestId: '33333333-3333-4333-8333-333333333333',
        analysisJobId: '44444444-4444-4444-8444-444444444444',
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ProcedureTutorialMediaAuthoringPreparationCoordinatorError>>({
        code: 'shutting_down',
      }),
    );

    let closed = false;
    const closing = coordinator.close().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    first.resolve(preparation);
    await expect(pending).resolves.toBe(preparation);
    await closing;
    expect(closed).toBe(true);
    expect(() => coordinator.prepare(firstRequest)).toThrowError(
      expect.objectContaining<Partial<ProcedureTutorialMediaAuthoringPreparationCoordinatorError>>({
        code: 'shutting_down',
      }),
    );
    expect(
      procedureTutorialMediaAuthoringPreparationCoordinatorHttpStatus(
        new ProcedureTutorialMediaAuthoringPreparationCoordinatorError('shutting_down'),
      ),
    ).toBe(503);
  });
});
