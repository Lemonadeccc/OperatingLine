import { spawn } from 'node:child_process';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { YouTubeOAuthCredentialStore } from './youtube-oauth-credential-store.js';
import type { YouTubeOAuthOperationLock } from './youtube-oauth-operation-lock.js';
import {
  exchangeYouTubeOAuthAuthorizationCode,
  parseYouTubeOAuthClientId,
  parseYouTubeOAuthLoopbackRedirectUri,
  YouTubeOAuthOperationError,
  youtubeOAuthAuthorizationEndpoint,
  youtubeOAuthScope,
  type YouTubeOAuthAuthorizationCodeExchangeResult,
} from './youtube-oauth.js';

const callbackPath = '/';
const defaultCallbackTimeoutMs = 300_000;
const maximumCallbackTimeoutMs = 900_000;

export interface YouTubeOAuthInstalledAppAuthorizationOptions {
  readonly clientId: string;
  readonly credentialStore: YouTubeOAuthCredentialStore;
  readonly callbackTimeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
  readonly onAuthorizationUrl?: (authorizationUrl: string) => void;
  readonly openAuthorizationUrl?: (authorizationUrl: string) => Promise<void>;
  readonly operationLock?: YouTubeOAuthOperationLock;
  readonly tokenTimeoutMs?: number;
}

export interface YouTubeOAuthAuthorizationUrlOptions {
  readonly clientId: string;
  readonly codeChallenge: string;
  readonly redirectUri: string;
  readonly state: string;
}

export function createYouTubeOAuthAuthorizationUrl(
  options: YouTubeOAuthAuthorizationUrlOptions,
): string {
  if (
    !/^[A-Za-z0-9_-]{32,128}$/u.test(options.state) ||
    !/^[A-Za-z0-9_-]{43,128}$/u.test(options.codeChallenge)
  ) {
    throw new YouTubeOAuthOperationError('authorization_failed');
  }
  const url = new URL(youtubeOAuthAuthorizationEndpoint);
  url.searchParams.set('client_id', parseYouTubeOAuthClientId(options.clientId));
  url.searchParams.set('redirect_uri', parseYouTubeOAuthLoopbackRedirectUri(options.redirectUri));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', youtubeOAuthScope);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', options.state);
  url.searchParams.set('code_challenge', options.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.href;
}

export async function authorizeYouTubeOAuthInstalledApp(
  options: YouTubeOAuthInstalledAppAuthorizationOptions,
): Promise<YouTubeOAuthAuthorizationCodeExchangeResult> {
  const clientId = parseYouTubeOAuthClientId(options.clientId);
  const callbackTimeoutMs = options.callbackTimeoutMs ?? defaultCallbackTimeoutMs;
  if (
    !Number.isInteger(callbackTimeoutMs) ||
    callbackTimeoutMs < 1_000 ||
    callbackTimeoutMs > maximumCallbackTimeoutMs
  ) {
    throw new Error(
      `YouTube OAuth callback timeout must be between 1000 and ${maximumCallbackTimeoutMs}ms`,
    );
  }

  const state = randomBytes(32).toString('base64url');
  const codeVerifier = randomBytes(48).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  let acceptCode: ((code: string) => void) | undefined;
  let rejectCode: ((error: Error) => void) | undefined;
  let callbackSettled = false;

  const codePromise = new Promise<string>((resolve, reject) => {
    acceptCode = resolve;
    rejectCode = reject;
  });
  const server = createServer({ maxHeaderSize: 8_192 }, (request, response) => {
    const remoteAddress = request.socket.remoteAddress;
    if (remoteAddress !== '127.0.0.1' && remoteAddress !== '::ffff:127.0.0.1') {
      sendCallbackResponse(response, 403, 'Authorization callback rejected.');
      return;
    }
    if (request.method !== 'GET' || request.url === undefined || request.url.length > 8_192) {
      sendCallbackResponse(response, 404, 'Authorization callback not found.');
      return;
    }
    let callbackUrl: URL;
    try {
      callbackUrl = new URL(request.url, 'http://127.0.0.1');
    } catch {
      sendCallbackResponse(response, 400, 'Authorization callback rejected.');
      return;
    }
    if (callbackUrl.pathname !== callbackPath) {
      sendCallbackResponse(response, 404, 'Authorization callback not found.');
      return;
    }
    const returnedStates = callbackUrl.searchParams.getAll('state');
    if (returnedStates.length !== 1 || !sameState(state, returnedStates[0]!)) {
      sendCallbackResponse(response, 400, 'Authorization callback state mismatch.');
      return;
    }
    if (callbackSettled) {
      sendCallbackResponse(response, 409, 'Authorization callback was already completed.');
      return;
    }
    const errors = callbackUrl.searchParams.getAll('error');
    if (errors.length > 0) {
      callbackSettled = true;
      sendCallbackResponse(response, 400, 'YouTube authorization was not granted.');
      rejectCode?.(new YouTubeOAuthOperationError('authorization_denied'));
      return;
    }
    const codes = callbackUrl.searchParams.getAll('code');
    const code = codes.length === 1 ? codes[0] : undefined;
    if (code === undefined || code.length === 0 || code.length > 16_384 || /\s/u.test(code)) {
      sendCallbackResponse(response, 400, 'Authorization callback is missing a valid code.');
      return;
    }
    callbackSettled = true;
    sendCallbackResponse(
      response,
      200,
      'YouTube authorization is complete. You may close this browser tab.',
    );
    acceptCode?.(code);
  });
  server.requestTimeout = callbackTimeoutMs;
  server.headersTimeout = Math.min(callbackTimeoutMs, 60_000);

  try {
    await new Promise<void>((resolve, reject) => {
      const onError = () => reject(new YouTubeOAuthOperationError('authorization_failed'));
      server.once('error', onError);
      server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
        server.off('error', onError);
        resolve();
      });
    });
    const address = server.address() as AddressInfo | null;
    if (address === null || address.address !== '127.0.0.1') {
      throw new YouTubeOAuthOperationError('authorization_failed');
    }
    const redirectUri = `http://127.0.0.1:${address.port}${callbackPath}`;
    const authorizationUrl = createYouTubeOAuthAuthorizationUrl({
      clientId,
      codeChallenge,
      redirectUri,
      state,
    });
    options.onAuthorizationUrl?.(authorizationUrl);
    server.on('error', () => {
      if (callbackSettled) return;
      callbackSettled = true;
      rejectCode?.(new YouTubeOAuthOperationError('authorization_failed'));
    });
    const callbackTimer = setTimeout(() => {
      if (callbackSettled) return;
      callbackSettled = true;
      rejectCode?.(new YouTubeOAuthOperationError('authorization_failed'));
    }, callbackTimeoutMs);
    void (options.openAuthorizationUrl ?? openSystemBrowser)(authorizationUrl).catch(() => {
      // The URL was already surfaced to the operator; keep the loopback callback alive for manual use.
    });
    let code: string;
    try {
      code = await codePromise;
    } finally {
      clearTimeout(callbackTimer);
    }
    return await exchangeYouTubeOAuthAuthorizationCode({
      clientId,
      code,
      codeVerifier,
      redirectUri,
      credentialStore: options.credentialStore,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      ...(options.operationLock === undefined ? {} : { operationLock: options.operationLock }),
      ...(options.tokenTimeoutMs === undefined ? {} : { timeoutMs: options.tokenTimeoutMs }),
    });
  } catch (error) {
    throw error instanceof YouTubeOAuthOperationError
      ? error
      : new YouTubeOAuthOperationError('authorization_failed');
  } finally {
    await new Promise<void>((resolve) => {
      if (!server.listening) {
        resolve();
        return;
      }
      server.close(() => resolve());
    });
  }
}

function sameState(expected: string, actual: string): boolean {
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

function sendCallbackResponse(response: ServerResponse, statusCode: number, message: string): void {
  const content = `<!doctype html><html lang="en"><meta charset="utf-8"><title>OperatingLine YouTube authorization</title><body><p>${message}</p></body></html>`;
  response.writeHead(statusCode, {
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
    'content-type': 'text/html; charset=utf-8',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  });
  response.end(content);
}

async function openSystemBrowser(authorizationUrl: string): Promise<void> {
  const command =
    process.platform === 'darwin'
      ? { executable: '/usr/bin/open', args: [authorizationUrl] }
      : process.platform === 'linux'
        ? { executable: 'xdg-open', args: [authorizationUrl] }
        : process.platform === 'win32'
          ? {
              executable: 'rundll32.exe',
              args: ['url.dll,FileProtocolHandler', authorizationUrl],
            }
          : undefined;
  if (command === undefined) {
    throw new YouTubeOAuthOperationError('authorization_failed');
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command.executable, command.args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.once('error', () => reject(new YouTubeOAuthOperationError('authorization_failed')));
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}
