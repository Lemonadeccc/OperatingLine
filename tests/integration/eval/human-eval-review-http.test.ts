import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  HumanEvalReviewWorkspace,
  startEvalReviewServer,
  type ReviewerCaseDto,
} from '../../../services/eval-review/src/index.js';

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

function sessionToken(reviewUrl: string): string {
  const token = new URL(reviewUrl).hash.slice('#token='.length);
  if (token === '') throw new Error('Expected a review URL fragment token');
  return decodeURIComponent(token);
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
});
