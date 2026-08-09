import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  fetchEvalSnapshot,
  runEvalSnapshotCli,
  storeEvalSnapshot,
  type EvalSnapshotRequest,
} from '../../../tools/eval/snapshot.js';
import { computeHumanEvalContentSha256 } from '@operatingline/eval-kit';
import type { CurrentEvalExportBundle, EvalExecutionEvent } from '@operatingline/protocol';
import { syntheticCanvasActionCatalog } from '@operatingline/test-kit';

const firstEvent: EvalExecutionEvent = {
  sequence: 4,
  id: 'snapshot.event.1',
  eventType: 'snapshot.test',
  payload: { page: 1 },
  createdAt: '2026-08-09T00:00:00.000Z',
};
const secondEvent: EvalExecutionEvent = {
  sequence: 8,
  id: 'snapshot.event.2',
  eventType: 'snapshot.test',
  payload: { page: 2 },
  createdAt: '2026-08-09T00:00:01.000Z',
};

function bundle(
  page: CurrentEvalExportBundle['page'],
  exportId: string,
  events: readonly EvalExecutionEvent[],
): CurrentEvalExportBundle {
  const content = {
    protocolVersion: '1.1.0' as const,
    formatVersion: '1.1.0' as const,
    scope: { targetAdapterId: 'canvas', planId: 'eval-canvas-launch', instanceId: null },
    catalogs: [syntheticCanvasActionCatalog],
    events: [...events],
    page,
    summary: {
      matchedEventCount: 2,
      eventTypeCounts: { 'snapshot.test': 2 },
      transitionCounts: {},
      decisionCounts: {},
    },
    dataHandling: {
      redaction: 'none' as const,
      containsPotentiallySensitiveContent: true as const,
      warning: 'Test snapshot may contain sensitive content.',
    },
  };
  return {
    ...content,
    exportId,
    exportedAt: '2026-08-09T00:00:00.000Z',
    integrity: {
      algorithm: 'sha256',
      canonicalization: 'operatingline-json-sort-v1',
      contentSha256: computeHumanEvalContentSha256(content),
    },
  };
}

function resealBundle(input: CurrentEvalExportBundle): CurrentEvalExportBundle {
  const content = {
    protocolVersion: input.protocolVersion,
    formatVersion: input.formatVersion,
    scope: input.scope,
    catalogs: input.catalogs,
    events: input.events,
    page: input.page,
    summary: input.summary,
    dataHandling: input.dataHandling,
  };
  return {
    ...input,
    integrity: {
      algorithm: 'sha256',
      canonicalization: 'operatingline-json-sort-v1',
      contentSha256: computeHumanEvalContentSha256(content),
    },
  };
}

const snapshotId = '50000000-0000-5000-8000-000000000001';
const first = bundle(
  {
    snapshotId,
    snapshotUpperSequence: 8,
    afterSequence: 0,
    nextAfterSequence: 4,
    hasMore: true,
  },
  '50000000-0000-4000-8000-000000000002',
  [firstEvent],
);
const second = bundle(
  {
    snapshotId,
    snapshotUpperSequence: 8,
    afterSequence: 4,
    nextAfterSequence: 8,
    hasMore: false,
  },
  '50000000-0000-4000-8000-000000000003',
  [secondEvent],
);

function request(fetcher: typeof fetch): EvalSnapshotRequest {
  return {
    runtimeBaseUrl: 'http://127.0.0.1:43123',
    accessToken: 'local-runtime-token-not-a-provider-key',
    targetAdapterId: 'canvas',
    planId: 'eval-canvas-launch',
    limit: 4,
    fetcher,
  };
}

describe('Eval snapshot collection', () => {
  it('fetches every page from one frozen loopback snapshot without persisting the token', async () => {
    const calls: Array<{ url: URL; authorization: string | null; redirect: RequestRedirect }> = [];
    const pages = [first, second];
    const fetcher = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = input instanceof URL ? input : new URL(String(input));
      const headers = new Headers(init?.headers);
      calls.push({
        url,
        authorization: headers.get('authorization'),
        redirect: init?.redirect ?? 'follow',
      });
      return new Response(JSON.stringify(pages.shift()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const snapshot = await fetchEvalSnapshot(request(fetcher));

    expect(snapshot.pages).toHaveLength(2);
    expect(calls[0]?.url.searchParams.get('afterSequence')).toBe('0');
    expect(calls[1]?.url.searchParams.get('afterSequence')).toBe('4');
    expect(calls[1]?.url.searchParams.get('snapshotId')).toBe(snapshotId);
    expect(calls[1]?.url.searchParams.get('snapshotUpperSequence')).toBe('8');
    expect(
      calls.every((call) => call.authorization === 'Bearer local-runtime-token-not-a-provider-key'),
    ).toBe(true);
    expect(calls.every((call) => !call.url.toString().includes('local-runtime-token'))).toBe(true);
    expect(calls.every((call) => call.redirect === 'error')).toBe(true);

    const directory = await mkdtemp(join(tmpdir(), 'operatingline-eval-snapshot-'));
    const output = join(directory, 'snapshot');
    try {
      const manifest = await storeEvalSnapshot(snapshot, output);
      const serialized = await readFile(join(output, 'snapshot.json'), 'utf8');
      expect(manifest.pages).toHaveLength(2);
      expect(serialized).not.toContain('local-runtime-token-not-a-provider-key');
      expect(serialized).toContain('credentialsStored');
      if (process.platform !== 'win32') {
        expect((await stat(output)).mode & 0o777).toBe(0o700);
        expect((await stat(join(output, manifest.pages[0]!.filename))).mode & 0o777).toBe(0o600);
      }
      await expect(storeEvalSnapshot(snapshot, output)).rejects.toMatchObject({ code: 'EEXIST' });
      expect(await readFile(join(output, 'snapshot.json'), 'utf8')).toBe(serialized);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    'https://127.0.0.1:43123',
    'http://example.com:43123',
    'http://127.0.0.1:43123?token=secret',
  ])('rejects unsafe runtime URL %s before fetch', async (runtimeBaseUrl) => {
    let calls = 0;
    const fetcher = (async () => {
      calls += 1;
      return new Response('{}');
    }) as typeof fetch;
    await expect(fetchEvalSnapshot({ ...request(fetcher), runtimeBaseUrl })).rejects.toThrow(
      /loopback|credentials, query, or fragment/,
    );
    expect(calls).toBe(0);
  });

  it('rejects a continuation that changes snapshot identity', async () => {
    const changed = bundle(
      {
        ...second.page,
        snapshotId: '50000000-0000-5000-8000-000000000099',
      },
      second.exportId,
      [secondEvent],
    );
    const pages = [first, changed];
    const fetcher = (async () =>
      new Response(JSON.stringify(pages.shift()), { status: 200 })) as typeof fetch;

    await expect(fetchEvalSnapshot(request(fetcher))).rejects.toThrow(/snapshot identity/);
  });

  it('binds the first page to the requested scope and verifies every page hash', async () => {
    const wrongScope = structuredClone(first);
    wrongScope.scope.planId = 'different-plan';
    const scopeFetcher = (async () =>
      new Response(JSON.stringify(resealBundle(wrongScope)), { status: 200 })) as typeof fetch;
    await expect(fetchEvalSnapshot(request(scopeFetcher))).rejects.toThrow(/requested scope/);

    const tampered = structuredClone(first);
    tampered.events[0]!.payload = { tampered: true };
    const tamperedFetcher = (async () =>
      new Response(JSON.stringify(tampered), { status: 200 })) as typeof fetch;
    await expect(fetchEvalSnapshot(request(tamperedFetcher))).rejects.toThrow(/integrity/);
  });

  it('rejects a fully signed page chain whose repeated summary is incomplete', async () => {
    const wrongFirst = structuredClone(first);
    const wrongSecond = structuredClone(second);
    wrongFirst.summary.matchedEventCount = 3;
    wrongSecond.summary.matchedEventCount = 3;
    const pages = [resealBundle(wrongFirst), resealBundle(wrongSecond)];
    const fetcher = (async () =>
      new Response(JSON.stringify(pages.shift()), { status: 200 })) as typeof fetch;

    await expect(fetchEvalSnapshot(request(fetcher))).rejects.toThrow(/summary/);
  });

  it('rejects invalid cursors and duplicate event identities in a re-sealed chain', async () => {
    const invalidCursor = structuredClone(first);
    invalidCursor.page.nextAfterSequence = 3;
    const cursorFetcher = (async () =>
      new Response(JSON.stringify(resealBundle(invalidCursor)), { status: 200 })) as typeof fetch;
    await expect(fetchEvalSnapshot(request(cursorFetcher))).rejects.toThrow(/cursor|sequence/);

    const duplicate = structuredClone(second);
    duplicate.events[0]!.id = firstEvent.id;
    const pages = [first, resealBundle(duplicate)];
    const duplicateFetcher = (async () =>
      new Response(JSON.stringify(pages.shift()), { status: 200 })) as typeof fetch;
    await expect(fetchEvalSnapshot(request(duplicateFetcher))).rejects.toThrow(/duplicate event/);
  });

  it('requires the named local runtime token environment variable before network access', async () => {
    await expect(
      runEvalSnapshotCli(
        [
          '--runtime',
          'http://127.0.0.1:43123',
          '--token-env',
          'OPERATINGLINE_TEST_TOKEN',
          '--adapter',
          'canvas',
          '--plan',
          'eval-canvas-launch',
          '--out',
          'unused-output',
        ],
        {},
      ),
    ).rejects.toThrow(/OPERATINGLINE_TEST_TOKEN is required/);
  });
});
