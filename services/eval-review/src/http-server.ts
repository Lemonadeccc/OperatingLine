import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ReviewWorkspaceError,
  type AdjudicationSubmission,
  type HumanEvalReviewWorkspace,
  type ReviewSessionConfiguration,
  type ReviewerCorrection,
  type ReviewerSubmission,
} from './review-workspace.js';

const maximumRequestBodyBytes = 512 * 1024;
const publicDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../public');

const securityHeaders = {
  'cache-control': 'no-store',
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
} as const;

export interface EvalReviewServerOptions {
  readonly workspace: HumanEvalReviewWorkspace;
  readonly session: ReviewSessionConfiguration;
  readonly port?: number;
}

export interface RunningEvalReviewServer {
  readonly baseUrl: string;
  readonly reviewUrl: string;
  readonly role: ReviewSessionConfiguration['role'];
  stop(): Promise<void>;
}

class HttpInputError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpInputError';
  }
}

function writeHeaders(response: ServerResponse, statusCode: number, contentType: string): void {
  response.writeHead(statusCode, { ...securityHeaders, 'content-type': contentType });
}

function sendJson(response: ServerResponse, statusCode: number, value: unknown): void {
  writeHeaders(response, statusCode, 'application/json; charset=utf-8');
  response.end(`${JSON.stringify(value)}\n`);
}

function sendBytes(
  response: ServerResponse,
  statusCode: number,
  contentType: string,
  value: Uint8Array,
): void {
  writeHeaders(response, statusCode, contentType);
  response.end(value);
}

function sameSecret(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function bearerToken(request: IncomingMessage, expected: string): string {
  const authorization = request.headers.authorization;
  const supplied = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (supplied === '' || !sameSecret(supplied, expected)) {
    throw new HttpInputError(401, 'A valid review session bearer token is required');
  }
  return supplied;
}

function requestUrl(request: IncomingMessage): URL {
  return new URL(request.url ?? '/', 'http://127.0.0.1');
}

function assertBrowserBoundary(
  request: IncomingMessage,
  expectedHost: string,
  requireOrigin: boolean,
): void {
  if (request.headers.host !== expectedHost) {
    throw new HttpInputError(400, 'Unexpected Host header');
  }
  if (requireOrigin && request.headers.origin !== `http://${expectedHost}`) {
    throw new HttpInputError(403, 'State-changing requests require the exact local Origin');
  }
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
    throw new HttpInputError(415, 'Request body must use application/json');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > maximumRequestBodyBytes) {
      throw new HttpInputError(413, `Request body exceeds ${maximumRequestBodyBytes} bytes`);
    }
    chunks.push(bytes);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new HttpInputError(400, 'Request body is not valid JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpInputError(400, 'Request body must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

function itemId(pathname: string): string | null {
  const match = /^\/api\/v1\/items\/([^/]+)$/.exec(pathname);
  return match === null ? null : decodePathComponent(match[1]!);
}

function itemAction(pathname: string, action: 'annotation' | 'adjudication'): string | null {
  const match = new RegExp(`^/api/v1/items/([^/]+)/${action}$`).exec(pathname);
  return match === null ? null : decodePathComponent(match[1]!);
}

function artifactToken(pathname: string): string | null {
  const match = /^\/api\/v1\/artifacts\/([^/]+)$/.exec(pathname);
  return match === null ? null : decodePathComponent(match[1]!);
}

function decodePathComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new HttpInputError(400, 'Request path contains invalid encoding');
  }
}

function assertExactKeys(
  record: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  const unexpected = Object.keys(record).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw new HttpInputError(400, `${label} contains unsupported fields: ${unexpected.join(', ')}`);
  }
}

function requiredString(value: unknown, label: string, maximumLength: number): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (normalized.length === 0 || normalized.length > maximumLength) {
    throw new HttpInputError(400, `${label} must contain 1 to ${maximumLength} characters`);
  }
  return normalized;
}

function parseJudgments(value: unknown): ReviewerSubmission['judgments'] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 64) {
    throw new HttpInputError(400, 'judgments must contain between 1 and 64 entries');
  }
  const allowedJudgments = new Set([
    'met',
    'partially_met',
    'not_met',
    'unable_to_judge',
    'not_applicable',
  ]);
  return value.map((entry, index) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new HttpInputError(400, `judgments[${index}] must be an object`);
    }
    const record = entry as Record<string, unknown>;
    assertExactKeys(
      record,
      new Set(['criterionId', 'judgment', 'rationale', 'evidence']),
      `judgments[${index}]`,
    );
    const judgment = requiredString(record['judgment'], `judgments[${index}].judgment`, 32);
    if (!allowedJudgments.has(judgment)) {
      throw new HttpInputError(400, `judgments[${index}].judgment is not supported`);
    }
    const submittedEvidence = record['evidence'];
    if (
      !Array.isArray(submittedEvidence) ||
      submittedEvidence.length < 1 ||
      submittedEvidence.length > 32
    ) {
      throw new HttpInputError(
        400,
        `judgments[${index}].evidence must contain between 1 and 32 entries`,
      );
    }
    const evidence = submittedEvidence.map((candidate, evidenceIndex) => {
      if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
        throw new HttpInputError(
          400,
          `judgments[${index}].evidence[${evidenceIndex}] must be an object`,
        );
      }
      const evidenceRecord = candidate as Record<string, unknown>;
      assertExactKeys(
        evidenceRecord,
        new Set(['token', 'note']),
        `judgments[${index}].evidence[${evidenceIndex}]`,
      );
      return {
        token: requiredString(
          evidenceRecord['token'],
          `judgments[${index}].evidence[${evidenceIndex}].token`,
          180,
        ),
        note: requiredString(
          evidenceRecord['note'],
          `judgments[${index}].evidence[${evidenceIndex}].note`,
          2_000,
        ),
      };
    });
    return {
      criterionId: requiredString(record['criterionId'], `judgments[${index}].criterionId`, 180),
      judgment: judgment as ReviewerSubmission['judgments'][number]['judgment'],
      rationale: requiredString(record['rationale'], `judgments[${index}].rationale`, 4_000),
      evidence,
    };
  });
}

function parseReviewerSubmission(
  body: Record<string, unknown>,
  opaqueRunId: string,
): ReviewerSubmission | ReviewerCorrection {
  assertExactKeys(
    body,
    new Set(['versionToken', 'recommendation', 'judgments', 'supersedesAnnotationToken']),
    'annotation submission',
  );
  const recommendation = requiredString(body['recommendation'], 'recommendation', 32);
  if (!['accept', 'revise', 'unable_to_judge'].includes(recommendation)) {
    throw new HttpInputError(400, 'recommendation is not supported');
  }
  const common: ReviewerSubmission = {
    opaqueRunId,
    versionToken: requiredString(body['versionToken'], 'versionToken', 180),
    recommendation: recommendation as ReviewerSubmission['recommendation'],
    judgments: parseJudgments(body['judgments']),
  };
  return body['supersedesAnnotationToken'] === undefined
    ? common
    : {
        ...common,
        supersedesAnnotationToken: requiredString(
          body['supersedesAnnotationToken'],
          'supersedesAnnotationToken',
          180,
        ),
      };
}

function parseAdjudicationSubmission(
  body: Record<string, unknown>,
  opaqueRunId: string,
): AdjudicationSubmission {
  assertExactKeys(body, new Set(['versionToken', 'judgments']), 'adjudication submission');
  return {
    opaqueRunId,
    versionToken: requiredString(body['versionToken'], 'versionToken', 180),
    judgments: parseJudgments(body['judgments']),
  };
}

async function serveAsset(pathname: string, response: ServerResponse): Promise<boolean> {
  const asset =
    pathname === '/'
      ? { filename: 'index.html', mediaType: 'text/html; charset=utf-8' }
      : pathname === '/app.js'
        ? { filename: 'app.js', mediaType: 'text/javascript; charset=utf-8' }
        : pathname === '/styles.css'
          ? { filename: 'styles.css', mediaType: 'text/css; charset=utf-8' }
          : null;
  if (asset === null) return false;
  const bytes = await readFile(resolve(publicDirectory, asset.filename));
  sendBytes(response, 200, asset.mediaType, bytes);
  return true;
}

function statusForWorkspaceError(error: ReviewWorkspaceError): number {
  switch (error.code) {
    case 'invalid_session':
      return 401;
    case 'wrong_role':
    case 'adjudicator_not_independent':
      return 403;
    case 'unknown_run':
      return 404;
    case 'stale_token':
    case 'duplicate_submission':
    case 'dataset_busy':
    case 'adjudication_unavailable':
      return 409;
    case 'invalid_submission':
      return 400;
  }
}

export async function startEvalReviewServer(
  options: EvalReviewServerOptions,
): Promise<RunningEvalReviewServer> {
  const port = options.port ?? 0;
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error('Eval review port must be an integer between 0 and 65535');
  }
  const session = options.workspace.createSession(options.session);
  let expectedHost = '';
  const server = createServer(async (request, response) => {
    try {
      const url = requestUrl(request);
      const method = request.method ?? 'GET';
      assertBrowserBoundary(request, expectedHost, method !== 'GET' && method !== 'HEAD');

      if (method === 'GET' && (await serveAsset(url.pathname, response))) {
        return;
      }

      const token = bearerToken(request, session.sessionToken);
      if (method === 'GET' && url.pathname === '/api/v1/session') {
        sendJson(response, 200, {
          role: options.session.role,
          providerIdentityVisible: false,
          numericScoring: false,
          providerRanking: false,
        });
        return;
      }
      if (method === 'GET' && url.pathname === '/api/v1/items') {
        await options.workspace.refresh();
        const items =
          options.session.role === 'reviewer'
            ? options.workspace.listReviewerCases(token)
            : options.workspace.listAdjudicationCases(token);
        sendJson(response, 200, items);
        return;
      }
      const selectedItemId = itemId(url.pathname);
      if (method === 'GET' && selectedItemId !== null) {
        await options.workspace.refresh();
        const item =
          options.session.role === 'reviewer'
            ? options.workspace.getReviewerCase(token, selectedItemId)
            : options.workspace.getAdjudicationCase(token, selectedItemId);
        sendJson(response, 200, item);
        return;
      }
      const selectedArtifactToken = artifactToken(url.pathname);
      if (method === 'GET' && selectedArtifactToken !== null) {
        const artifact = await options.workspace.resolveRenderedArtifact(
          token,
          selectedArtifactToken,
        );
        sendBytes(response, 200, artifact.mediaType, artifact.bytes);
        return;
      }
      const annotationRunId = itemAction(url.pathname, 'annotation');
      if (method === 'POST' && annotationRunId !== null) {
        if (options.session.role !== 'reviewer') {
          throw new HttpInputError(403, 'This session cannot submit annotations');
        }
        const body = await readJsonBody(request);
        const submission = parseReviewerSubmission(body, annotationRunId);
        const receipt =
          'supersedesAnnotationToken' in submission
            ? await options.workspace.correctReview(token, submission)
            : await options.workspace.submitReview(token, submission);
        sendJson(response, 201, receipt);
        return;
      }
      const adjudicationRunId = itemAction(url.pathname, 'adjudication');
      if (method === 'POST' && adjudicationRunId !== null) {
        if (options.session.role !== 'adjudicator') {
          throw new HttpInputError(403, 'This session cannot submit adjudications');
        }
        const body = await readJsonBody(request);
        const receipt = await options.workspace.submitAdjudication(
          token,
          parseAdjudicationSubmission(body, adjudicationRunId),
        );
        sendJson(response, 201, receipt);
        return;
      }
      sendJson(response, 404, { error: 'not_found' });
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      if (error instanceof HttpInputError) {
        sendJson(response, error.statusCode, { error: 'invalid_request', message: error.message });
      } else if (error instanceof ReviewWorkspaceError) {
        sendJson(response, statusForWorkspaceError(error), {
          error: error.code,
          message: error.message,
        });
      } else {
        sendJson(response, 500, {
          error: 'internal_error',
          message: 'The local review operation failed',
        });
      }
    }
  });

  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolvePromise();
    });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
    throw new Error('Eval review server did not bind a TCP address');
  }
  expectedHost = `127.0.0.1:${address.port}`;
  const baseUrl = `http://${expectedHost}`;
  return {
    baseUrl,
    reviewUrl: `${baseUrl}/#token=${encodeURIComponent(session.sessionToken)}`,
    role: options.session.role,
    stop: () =>
      new Promise<void>((resolvePromise, reject) => {
        server.close((error) => (error === undefined ? resolvePromise() : reject(error)));
      }),
  };
}
