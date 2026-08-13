import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  HumanEvalCollectionStatusWorkspace,
  HumanEvalReviewWorkspace,
  startEvalCollectionStatusServer,
  startEvalReviewServer,
  type ReviewerCaseDto,
} from '../../../services/eval-review/src/index.js';
import { createProviderEvalRun, withHumanEvalDatasetWriteLock } from '@operatingline/eval-kit';

import {
  buildHumanEvalSuiteFixture,
  buildProviderBlindSignoffFixture,
  buildProviderEvalRunFixture,
} from '../../support/human-eval-fixtures.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

async function datasetDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'operatingline-review-http-'));
  temporaryDirectories.push(directory);
  const suite = buildHumanEvalSuiteFixture();
  const run = buildProviderEvalRunFixture(suite);
  const signoff = buildProviderBlindSignoffFixture(suite, run, {
    preparedBy: 'blind.http.preparer',
    supplementalAliases: ['Secret Product Alias'],
  });
  await Promise.all([mkdir(join(directory, 'runs')), mkdir(join(directory, 'blind-signoffs'))]);
  await writeFile(join(directory, 'suite.json'), JSON.stringify(suite));
  await writeFile(join(directory, 'runs', `${run.runId}.run.json`), JSON.stringify(run));
  await writeFile(
    join(directory, 'blind-signoffs', `${run.runId}.provider-blind.json`),
    JSON.stringify(signoff),
  );
  return directory;
}

function sessionToken(sessionUrl: string): string {
  const token = new URL(sessionUrl).hash.slice('#token='.length);
  if (token === '') throw new Error('Expected a session URL fragment token');
  return decodeURIComponent(token);
}

function withoutKey<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key)) as Omit<T, K>;
}

function withRunIdentity(run: ReturnType<typeof buildProviderEvalRunFixture>, nextRunId: string) {
  if (run.invocation.operation !== 'initial_plan' || run.outcome.status !== 'completed') {
    throw new Error('Expected a completed initial-plan fixture run');
  }
  return createProviderEvalRun({
    ...withoutKey(withoutKey(run, 'integrity'), 'comparability'),
    runId: nextRunId,
    replicateIndex: 2,
    invocation: {
      ...withoutKey(run.invocation, 'packetSha256'),
      request: {
        ...run.invocation.request,
        requestId: '10000000-0000-4000-8000-000000000097',
      },
    },
    generationSettings: withoutKey(run.generationSettings, 'parametersSha256'),
    outcome: {
      ...withoutKey(run.outcome, 'resultSha256'),
      result: {
        ...run.outcome.result,
        generationId: '10000000-0000-4000-8000-000000000098',
        requestId: '10000000-0000-4000-8000-000000000097',
      },
    },
    reproducibility: run.comparability.reproducibility,
  });
}

async function rawHttpStatus(
  urlInput: string,
  headers: Readonly<Record<string, string>>,
): Promise<number> {
  const url = new URL(urlInput);
  return new Promise<number>((resolvePromise, rejectPromise) => {
    const request = httpRequest(
      {
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers,
      },
      (response) => {
        response.resume();
        response.once('end', () => resolvePromise(response.statusCode ?? 0));
      },
    );
    request.once('error', rejectPromise);
    request.end();
  });
}

describe('Human Eval review HTTP surface', () => {
  it('serves a secured loopback-only blind reviewer workflow', async () => {
    const workspace = await HumanEvalReviewWorkspace.open({
      datasetDirectory: await datasetDirectory(),
    });
    const server = await startEvalReviewServer({
      workspace,
      session: {
        pseudonym: 'reviewer.http',
        role: 'reviewer',
        qualificationId: 'canvas.review_qualification',
        calibrationVersion: '1.0.0',
        locale: 'en',
      },
    });
    const token = sessionToken(server.reviewUrl);
    const headers = { authorization: `Bearer ${token}` };
    try {
      expect(server.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      const page = await fetch(server.baseUrl);
      const html = await page.text();
      expect(page.status).toBe(200);
      expect(page.headers.get('content-security-policy')).toContain("default-src 'self'");
      expect(page.headers.get('access-control-allow-origin')).toBeNull();
      expect(html).toContain('盲审工作台');
      expect(html).not.toContain(token);
      expect(html).not.toContain('blind.http.preparer');
      expect(html).not.toContain('Secret Product Alias');

      const privateSidecar = await fetch(
        `${server.baseUrl}/blind-signoffs/10000000-0000-4000-8000-000000000003.provider-blind.json`,
        { headers },
      );
      expect(privateSidecar.status).toBe(404);
      expect(await privateSidecar.text()).not.toContain('Secret Product Alias');

      expect((await fetch(`${server.baseUrl}/api/v1/items`)).status).toBe(401);
      expect((await fetch(`${server.baseUrl}/api/v1/worklist`)).status).toBe(401);
      expect(
        (
          await fetch(`${server.baseUrl}/api/v1/items`, {
            headers: { authorization: 'Bearer wrong-token' },
          })
        ).status,
      ).toBe(401);
      expect(
        await rawHttpStatus(`${server.baseUrl}/api/v1/items`, {
          ...headers,
          host: 'evil.test',
        }),
      ).toBe(400);
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/session`, { headers });
      const sessionJson = (await sessionResponse.json()) as Record<string, unknown>;
      expect(sessionResponse.status).toBe(200);
      expect(sessionJson).toEqual({
        role: 'reviewer',
        providerIdentityVisible: false,
        numericScoring: false,
        providerRanking: false,
      });
      expect(JSON.stringify(sessionJson)).not.toContain('reviewer.http');
      expect(JSON.stringify(sessionJson)).not.toContain('canvas.review_qualification');
      expect((await fetch(`${server.baseUrl}/api/v1/worklist`, { headers })).status).toBe(403);
      const itemsResponse = await fetch(`${server.baseUrl}/api/v1/items`, { headers });
      const items = (await itemsResponse.json()) as ReviewerCaseDto[];
      expect(itemsResponse.status).toBe(200);
      expect(items).toHaveLength(1);
      const item = items[0]!;
      const blindJson = JSON.stringify(item);
      expect(blindJson).not.toContain('fixture.canvas_planner');
      expect(blindJson).not.toContain('deterministic-fixture-v1');
      expect(blindJson).not.toContain('OperatingLine tests');
      expect(blindJson).not.toContain('blind.http.preparer');
      expect(blindJson).not.toContain('Secret Product Alias');

      const runOutput = item.evidenceOptions.find((option) => option.kind === 'run_output');
      if (runOutput === undefined) throw new Error('Expected a run-output evidence option');
      const body = {
        versionToken: item.versionToken,
        recommendation: 'accept',
        judgments: item.rubric.map((criterion) => ({
          criterionId: criterion.id,
          judgment: 'met',
          rationale: `HTTP reviewer rationale for ${criterion.id}.`,
          evidence: [{ token: runOutput.token, note: 'Reviewed the blinded run output.' }],
        })),
      };
      const endpoint = `${server.baseUrl}/api/v1/items/${encodeURIComponent(item.opaqueRunId)}/annotation`;
      expect(
        (
          await fetch(endpoint, {
            method: 'POST',
            headers: { ...headers, 'content-type': 'application/json', origin: 'http://evil.test' },
            body: JSON.stringify(body),
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await fetch(endpoint, {
            method: 'POST',
            headers: {
              ...headers,
              'content-type': 'application/json',
              origin: server.baseUrl,
            },
            body: JSON.stringify({ versionToken: item.versionToken }),
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await fetch(endpoint, {
            method: 'POST',
            headers: {
              ...headers,
              'content-type': 'application/json',
              origin: server.baseUrl,
            },
            body: JSON.stringify({ ...body, providerId: 'must-never-be-accepted' }),
          })
        ).status,
      ).toBe(400);
      const created = await fetch(endpoint, {
        method: 'POST',
        headers: {
          ...headers,
          'content-type': 'application/json',
          origin: server.baseUrl,
        },
        body: JSON.stringify(body),
      });
      expect(created.status).toBe(201);
      expect(await created.json()).toEqual({ annotationToken: expect.any(String) });
    } finally {
      await server.stop();
    }
  });

  it('serves aggregate collection status only to an isolated operator session', async () => {
    const directory = await datasetDirectory();
    const adjudicationWorkspace = await HumanEvalReviewWorkspace.open({
      datasetDirectory: directory,
    });
    const adjudicationServer = await startEvalReviewServer({
      workspace: adjudicationWorkspace,
      session: {
        pseudonym: 'adjudicator.http',
        role: 'adjudicator',
        qualificationId: 'canvas.adjudication_qualification',
        calibrationVersion: '1.0.0',
        locale: 'en',
      },
    });
    try {
      const adjudicatorHeaders = {
        authorization: `Bearer ${sessionToken(adjudicationServer.reviewUrl)}`,
      };
      expect(
        (
          await fetch(`${adjudicationServer.baseUrl}/api/v1/worklist`, {
            headers: adjudicatorHeaders,
          })
        ).status,
      ).toBe(403);
    } finally {
      await adjudicationServer.stop();
    }

    const workspace = await HumanEvalCollectionStatusWorkspace.open({
      datasetDirectory: directory,
    });
    const server = await startEvalCollectionStatusServer({ workspace });
    const token = sessionToken(server.statusUrl);
    const headers = { authorization: `Bearer ${token}` };
    const writeHeaders = {
      ...headers,
      'content-type': 'application/json',
      origin: server.baseUrl,
    };
    try {
      expect(server.role).toBe('operator');
      expect((await fetch(`${server.baseUrl}/api/v1/worklist`)).status).toBe(401);

      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/session`, { headers });
      expect(sessionResponse.status).toBe(200);
      expect(await sessionResponse.json()).toEqual({ role: 'operator' });

      const initialResponse = await fetch(`${server.baseUrl}/api/v1/worklist`, { headers });
      expect(initialResponse.status).toBe(200);
      expect(await initialResponse.json()).toEqual({
        remainingDistinctTreatments: 2,
        pendingSignoffs: 0,
        remainingIndependentReviews: 0,
        pendingAdjudications: 0,
        releaseReadiness: 'not_assessed',
      });

      let releaseWriter!: () => void;
      let writerEntered!: () => void;
      const release = new Promise<void>((resolve) => {
        releaseWriter = resolve;
      });
      const entered = new Promise<void>((resolve) => {
        writerEntered = resolve;
      });
      const writer = withHumanEvalDatasetWriteLock(directory, async () => {
        writerEntered();
        await release;
      });
      await entered;
      try {
        const busyResponse = await fetch(`${server.baseUrl}/api/v1/worklist`, { headers });
        expect(busyResponse.status).toBe(503);
        expect(await busyResponse.json()).toEqual({
          error: 'collection_status_busy',
          message: 'Human Eval collection status is temporarily unavailable during a write',
        });
      } finally {
        releaseWriter();
        await writer;
      }

      const suite = buildHumanEvalSuiteFixture();
      const unsignedRun = withRunIdentity(
        buildProviderEvalRunFixture(suite),
        '10000000-0000-4000-8000-000000000099',
      );
      await writeFile(
        join(directory, 'runs', `${unsignedRun.runId}.run.json`),
        JSON.stringify(unsignedRun),
      );

      const refreshedResponse = await fetch(`${server.baseUrl}/api/v1/worklist`, { headers });
      const refreshedStatus = (await refreshedResponse.json()) as Record<string, unknown>;
      expect(refreshedResponse.status).toBe(200);
      expect(refreshedStatus).toEqual({
        remainingDistinctTreatments: 2,
        pendingSignoffs: 1,
        remainingIndependentReviews: 0,
        pendingAdjudications: 0,
        releaseReadiness: 'not_assessed',
      });
      expect(Object.keys(refreshedStatus).sort()).toEqual(
        [
          'remainingDistinctTreatments',
          'pendingSignoffs',
          'remainingIndependentReviews',
          'pendingAdjudications',
          'releaseReadiness',
        ].sort(),
      );
      const publicJson = JSON.stringify(refreshedStatus);
      for (const forbidden of [
        'canvas.launch_diagram',
        '10000000-0000-4000-8000-000000000003',
        '10000000-0000-4000-8000-000000000099',
        'fixture.canvas_planner',
        'Fixture Canvas Planner',
        'OperatingLine tests',
        'deterministic-fixture-v1',
        'blind.http.preparer',
        'Secret Product Alias',
      ]) {
        expect(publicJson).not.toContain(forbidden);
      }

      expect((await fetch(`${server.baseUrl}/api/v1/items`, { headers })).status).toBe(403);
      expect((await fetch(`${server.baseUrl}/api/v1/items/opaque-run`, { headers })).status).toBe(
        403,
      );
      expect(
        (await fetch(`${server.baseUrl}/api/v1/artifacts/evidence-token`, { headers })).status,
      ).toBe(403);
      expect(
        (
          await fetch(`${server.baseUrl}/api/v1/items/opaque-run/annotation`, {
            method: 'POST',
            headers: writeHeaders,
            body: '{}',
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await fetch(`${server.baseUrl}/api/v1/items/opaque-run/adjudication`, {
            method: 'POST',
            headers: writeHeaders,
            body: '{}',
          })
        ).status,
      ).toBe(403);
    } finally {
      await server.stop();
    }
  });
});
