import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  currentEvalExportBundleSchema,
  type CurrentEvalExportBundle,
} from '@operatingline/protocol';
import { computeHumanEvalContentSha256 } from '@operatingline/eval-kit';

const maximumResponseBytes = 32 * 1024 * 1024;
const maximumSnapshotPages = 10_000;

export interface EvalSnapshotRequest {
  readonly runtimeBaseUrl: string;
  readonly accessToken: string;
  readonly targetAdapterId: string;
  readonly planId: string;
  readonly instanceId?: string;
  readonly limit?: number;
  readonly fetcher?: typeof fetch;
}

export interface EvalSnapshot {
  readonly pages: readonly CurrentEvalExportBundle[];
  readonly snapshotId: string;
  readonly snapshotUpperSequence: number;
}

export interface StoredEvalSnapshot {
  readonly formatVersion: '1.0.0';
  readonly scope: CurrentEvalExportBundle['scope'];
  readonly snapshotId: string;
  readonly snapshotUpperSequence: number;
  readonly pages: readonly {
    readonly filename: string;
    readonly exportId: string;
    readonly contentSha256: string;
  }[];
  readonly dataHandling: {
    readonly containsPotentiallySensitiveContent: true;
    readonly credentialsStored: false;
    readonly warning: string;
  };
}

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${label} must not be empty`);
  }
  return normalized;
}

function loopbackRuntimeUrl(input: string): URL {
  const url = new URL(input);
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== 'http:') {
    throw new Error('Eval snapshot runtime must use loopback HTTP');
  }
  if (hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== '[::1]') {
    throw new Error('Eval snapshot runtime must use a loopback hostname');
  }
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    throw new Error('Eval snapshot runtime URL must not contain credentials, query, or fragment');
  }
  return url;
}

function appendScopeParameters(
  url: URL,
  request: EvalSnapshotRequest,
  cursor:
    | { readonly afterSequence: 0 }
    | {
        readonly afterSequence: number;
        readonly snapshotId: string;
        readonly snapshotUpperSequence: number;
      },
): void {
  url.searchParams.set('targetAdapterId', request.targetAdapterId);
  url.searchParams.set('planId', request.planId);
  if (request.instanceId !== undefined) {
    url.searchParams.set('instanceId', request.instanceId);
  }
  url.searchParams.set('limit', String(request.limit ?? 250));
  url.searchParams.set('afterSequence', String(cursor.afterSequence));
  if ('snapshotId' in cursor) {
    url.searchParams.set('snapshotId', cursor.snapshotId);
    url.searchParams.set('snapshotUpperSequence', String(cursor.snapshotUpperSequence));
  }
}

function exportIntegrityContent(bundle: CurrentEvalExportBundle): unknown {
  return {
    protocolVersion: bundle.protocolVersion,
    formatVersion: bundle.formatVersion,
    scope: bundle.scope,
    catalogs: bundle.catalogs,
    events: bundle.events,
    page: bundle.page,
    summary: bundle.summary,
    dataHandling: bundle.dataHandling,
  };
}

function stringAt(value: unknown, key: string): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === 'string' ? candidate : null;
}

function count(values: readonly string[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Object.fromEntries([...counts].sort(([left], [right]) => left.localeCompare(right)));
}

function completeSummary(pages: readonly CurrentEvalExportBundle[]) {
  const events = pages.flatMap((page) => page.events);
  return {
    matchedEventCount: events.length,
    eventTypeCounts: count(events.map((event) => event.eventType)),
    transitionCounts: count(
      events.flatMap((event) => {
        const transition =
          event.eventType === 'companion.state.reported'
            ? stringAt(event.payload, 'transition')
            : null;
        return transition === null ? [] : [transition];
      }),
    ),
    decisionCounts: count(
      events.flatMap((event) => {
        const decision =
          event.eventType === 'guide.proposal.decided' ? stringAt(event.payload, 'decision') : null;
        return decision === null ? [] : [decision];
      }),
    ),
  };
}

function assertPageIntegrity(page: CurrentEvalExportBundle): void {
  if (
    computeHumanEvalContentSha256(exportIntegrityContent(page)) !== page.integrity.contentSha256
  ) {
    throw new Error('Eval export page integrity does not verify');
  }
}

async function parseResponse(response: Response): Promise<CurrentEvalExportBundle> {
  if (!response.ok) {
    throw new Error(`Eval export request failed with HTTP ${response.status}`);
  }
  const declaredLength = response.headers.get('content-length');
  if (
    declaredLength !== null &&
    /^\d+$/.test(declaredLength) &&
    Number(declaredLength) > maximumResponseBytes
  ) {
    throw new Error(`Eval export response exceeds ${maximumResponseBytes} bytes`);
  }
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  if (response.body !== null) {
    const reader = response.body.getReader();
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        byteLength += result.value.byteLength;
        if (byteLength > maximumResponseBytes) {
          await reader.cancel();
          throw new Error(`Eval export response exceeds ${maximumResponseBytes} bytes`);
        }
        chunks.push(result.value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  const body = Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
    byteLength,
  ).toString('utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    throw new Error('Eval export response is not valid JSON');
  }
  return currentEvalExportBundleSchema.parse(parsed);
}

function assertSameSnapshot(
  first: CurrentEvalExportBundle,
  current: CurrentEvalExportBundle,
  expectedAfterSequence: number,
): void {
  if (
    current.page.snapshotId !== first.page.snapshotId ||
    current.page.snapshotUpperSequence !== first.page.snapshotUpperSequence ||
    current.scope.targetAdapterId !== first.scope.targetAdapterId ||
    current.scope.planId !== first.scope.planId ||
    current.scope.instanceId !== first.scope.instanceId ||
    current.protocolVersion !== first.protocolVersion ||
    current.formatVersion !== first.formatVersion ||
    computeHumanEvalContentSha256(current.catalogs) !==
      computeHumanEvalContentSha256(first.catalogs) ||
    computeHumanEvalContentSha256(current.summary) !==
      computeHumanEvalContentSha256(first.summary) ||
    computeHumanEvalContentSha256(current.dataHandling) !==
      computeHumanEvalContentSha256(first.dataHandling) ||
    current.page.afterSequence !== expectedAfterSequence
  ) {
    throw new Error('Eval export continuation changed its frozen snapshot identity or cursor');
  }
}

export async function fetchEvalSnapshot(requestInput: EvalSnapshotRequest): Promise<EvalSnapshot> {
  const runtime = loopbackRuntimeUrl(requestInput.runtimeBaseUrl);
  const request = {
    ...requestInput,
    accessToken: requireText(requestInput.accessToken, 'accessToken'),
    targetAdapterId: requireText(requestInput.targetAdapterId, 'targetAdapterId'),
    planId: requireText(requestInput.planId, 'planId'),
  };
  const limit = request.limit ?? 250;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
    throw new Error('Eval snapshot page limit must be an integer between 1 and 1000');
  }
  const fetcher = request.fetcher ?? fetch;
  const pages: CurrentEvalExportBundle[] = [];
  let cursor:
    | { readonly afterSequence: 0 }
    | {
        readonly afterSequence: number;
        readonly snapshotId: string;
        readonly snapshotUpperSequence: number;
      } = { afterSequence: 0 };
  let first: CurrentEvalExportBundle | undefined;
  const eventIds = new Set<string>();
  const eventSequences = new Set<number>();

  while (pages.length < maximumSnapshotPages) {
    const url = new URL('/api/v1/eval/export', runtime);
    appendScopeParameters(url, request, cursor);
    const response = await fetcher(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${request.accessToken}`,
      },
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    const page = await parseResponse(response);
    assertPageIntegrity(page);
    first ??= page;
    if (
      first.scope.targetAdapterId !== request.targetAdapterId ||
      first.scope.planId !== request.planId ||
      first.scope.instanceId !== (request.instanceId ?? null)
    ) {
      throw new Error('Eval export first page does not match the requested scope');
    }
    assertSameSnapshot(first, page, cursor.afterSequence);
    const lastSequence = page.events.at(-1)?.sequence ?? page.page.afterSequence;
    if (
      page.page.nextAfterSequence !== lastSequence ||
      page.events.some(
        (event, index) =>
          event.sequence <= page.page.afterSequence ||
          event.sequence > page.page.snapshotUpperSequence ||
          (index > 0 && event.sequence <= page.events[index - 1]!.sequence),
      )
    ) {
      throw new Error('Eval export page cursor or event sequence is invalid');
    }
    for (const event of page.events) {
      if (eventIds.has(event.id) || eventSequences.has(event.sequence)) {
        throw new Error('Eval export snapshot contains duplicate event identity or sequence');
      }
      eventIds.add(event.id);
      eventSequences.add(event.sequence);
    }
    pages.push(page);
    if (!page.page.hasMore) {
      if (
        computeHumanEvalContentSha256(completeSummary(pages)) !==
        computeHumanEvalContentSha256(first.summary)
      ) {
        throw new Error('Eval export snapshot summary does not match its complete page chain');
      }
      return {
        pages,
        snapshotId: first.page.snapshotId,
        snapshotUpperSequence: first.page.snapshotUpperSequence,
      };
    }
    if (page.page.nextAfterSequence <= cursor.afterSequence) {
      throw new Error('Eval export continuation did not advance within the frozen snapshot');
    }
    cursor = {
      afterSequence: page.page.nextAfterSequence,
      snapshotId: first.page.snapshotId,
      snapshotUpperSequence: first.page.snapshotUpperSequence,
    };
  }
  throw new Error(`Eval export exceeded ${maximumSnapshotPages} pages`);
}

export async function storeEvalSnapshot(
  snapshot: EvalSnapshot,
  outputDirectoryInput: string,
): Promise<StoredEvalSnapshot> {
  const outputDirectory = resolve(outputDirectoryInput);
  const parent = dirname(outputDirectory);
  await mkdir(parent, { recursive: true });
  // The directory itself is the exclusive reservation. snapshot.json is written last and is the
  // commit marker, so readers never accept a partially written snapshot.
  await mkdir(outputDirectory, { recursive: false, mode: 0o700 });
  try {
    const pageRecords = await Promise.all(
      snapshot.pages.map(async (page, index) => {
        const filename = `page-${String(index + 1).padStart(4, '0')}.eval-export.json`;
        await writeFile(resolve(outputDirectory, filename), `${JSON.stringify(page, null, 2)}\n`, {
          encoding: 'utf8',
          flag: 'wx',
          mode: 0o600,
        });
        return {
          filename,
          exportId: page.exportId,
          contentSha256: page.integrity.contentSha256,
        };
      }),
    );
    const first = snapshot.pages[0];
    if (first === undefined) {
      throw new Error('Cannot store an empty Eval snapshot');
    }
    const manifest: StoredEvalSnapshot = {
      formatVersion: '1.0.0',
      scope: first.scope,
      snapshotId: snapshot.snapshotId,
      snapshotUpperSequence: snapshot.snapshotUpperSequence,
      pages: pageRecords,
      dataHandling: {
        containsPotentiallySensitiveContent: true,
        credentialsStored: false,
        warning:
          'This snapshot contains unredacted goals, provider output, host events, and action arguments. Review it before sharing; training use is not authorized.',
      },
    };
    await writeFile(
      resolve(outputDirectory, 'snapshot.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      },
    );
    return manifest;
  } catch (error) {
    await rm(outputDirectory, { recursive: true, force: true });
    throw error;
  }
}

interface SnapshotCliOptions {
  readonly runtime: string;
  readonly tokenEnvironmentVariable: string;
  readonly targetAdapterId: string;
  readonly planId: string;
  readonly instanceId?: string;
  readonly outputDirectory: string;
  readonly limit?: number;
}

function parseCliOptions(arguments_: readonly string[]): SnapshotCliOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (name === undefined || value === undefined || !name.startsWith('--')) {
      throw new Error('Eval snapshot arguments must use --name value pairs');
    }
    if (values.has(name)) {
      throw new Error(`Duplicate Eval snapshot argument ${name}`);
    }
    values.set(name, value);
  }
  const required = (name: string): string => {
    const value = values.get(name);
    if (value === undefined) {
      throw new Error(`Missing required Eval snapshot argument ${name}`);
    }
    return value;
  };
  const allowed = new Set([
    '--runtime',
    '--token-env',
    '--adapter',
    '--plan',
    '--instance',
    '--out',
    '--limit',
  ]);
  for (const name of values.keys()) {
    if (!allowed.has(name)) {
      throw new Error(`Unknown Eval snapshot argument ${name}`);
    }
  }
  const tokenEnvironmentVariable = required('--token-env');
  if (!/^[A-Z][A-Z0-9_]*$/.test(tokenEnvironmentVariable)) {
    throw new Error('--token-env must name an uppercase environment variable');
  }
  const limitInput = values.get('--limit');
  return {
    runtime: required('--runtime'),
    tokenEnvironmentVariable,
    targetAdapterId: required('--adapter'),
    planId: required('--plan'),
    ...(values.get('--instance') === undefined ? {} : { instanceId: values.get('--instance')! }),
    outputDirectory: required('--out'),
    ...(limitInput === undefined ? {} : { limit: Number(limitInput) }),
  };
}

export async function runEvalSnapshotCli(
  arguments_: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
): Promise<StoredEvalSnapshot> {
  const options = parseCliOptions(arguments_);
  const accessToken = environment[options.tokenEnvironmentVariable];
  if (accessToken === undefined || accessToken.trim() === '') {
    throw new Error(`${options.tokenEnvironmentVariable} is required to read the local runtime`);
  }
  const snapshot = await fetchEvalSnapshot({
    runtimeBaseUrl: options.runtime,
    accessToken,
    targetAdapterId: options.targetAdapterId,
    planId: options.planId,
    ...(options.instanceId === undefined ? {} : { instanceId: options.instanceId }),
    ...(options.limit === undefined ? {} : { limit: options.limit }),
  });
  return storeEvalSnapshot(snapshot, options.outputDirectory);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const manifest = await runEvalSnapshotCli(process.argv.slice(2), process.env);
    console.log(
      JSON.stringify(
        {
          captured: true,
          snapshotId: manifest.snapshotId,
          snapshotUpperSequence: manifest.snapshotUpperSequence,
          pageCount: manifest.pages.length,
          localRuntimeAccessTokenRequired: true,
          credentialsStored: false,
          providerCredentialsRequired: false,
          providerCallsEnabled: false,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
