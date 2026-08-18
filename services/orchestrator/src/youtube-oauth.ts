import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  YouTubeOAuthCredentialStoreError,
  type YouTubeOAuthCredentialStore,
} from './youtube-oauth-credential-store.js';
import {
  createYouTubeOAuthOperationLock,
  type YouTubeOAuthOperationLock,
} from './youtube-oauth-operation-lock.js';
import {
  ProcedureTutorialYoutubeSourceError,
  type YouTubeOAuthAccessTokenProvider,
} from './youtube-caption-source.js';

export const youtubeOAuthScope = 'https://www.googleapis.com/auth/youtube.force-ssl' as const;
export const youtubeOAuthAuthorizationEndpoint =
  'https://accounts.google.com/o/oauth2/v2/auth' as const;
export const youtubeOAuthTokenEndpoint = 'https://oauth2.googleapis.com/token' as const;
export const youtubeOAuthRevocationEndpoint = 'https://oauth2.googleapis.com/revoke' as const;

const defaultOAuthTimeoutMs = 30_000;
const maximumOAuthTimeoutMs = 120_000;
const defaultRefreshSkewMs = 60_000;
const maximumTokenResponseBytes = 65_536;
const maximumOAuthCredentialLength = 16_384;

const tokenResponseSchema = z.object({
  access_token: z.string().min(1).max(8_192).regex(/^\S+$/u),
  expires_in: z.number().int().positive().max(31_536_000),
  refresh_token: z.string().min(1).max(maximumOAuthCredentialLength).regex(/^\S+$/u).optional(),
  scope: z.string().min(1).max(4_096).optional(),
  token_type: z.string().min(1).max(64),
});

const tokenErrorResponseSchema = z.object({
  error: z.string().min(1).max(128),
});

export type YouTubeOAuthOperationErrorCode =
  'authorization_denied' | 'authorization_failed' | 'refresh_failed' | 'revocation_failed';

export class YouTubeOAuthOperationError extends Error {
  constructor(readonly code: YouTubeOAuthOperationErrorCode) {
    super(
      code === 'authorization_denied'
        ? 'YouTube OAuth authorization was denied'
        : code === 'authorization_failed'
          ? 'YouTube OAuth authorization failed'
          : code === 'refresh_failed'
            ? 'YouTube OAuth access token refresh failed'
            : 'YouTube OAuth grant revocation could not be confirmed',
    );
    this.name = 'YouTubeOAuthOperationError';
  }
}

export interface YouTubeOAuthTokenProviderOptions {
  readonly clientId: string;
  readonly credentialStore: YouTubeOAuthCredentialStore;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => number;
  readonly refreshSkewMs?: number;
  readonly timeoutMs?: number;
}

export interface YouTubeOAuthAuthorizationCodeExchangeOptions {
  readonly clientId: string;
  readonly code: string;
  readonly codeVerifier: string;
  readonly credentialStore: YouTubeOAuthCredentialStore;
  readonly redirectUri: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly operationLock?: YouTubeOAuthOperationLock;
  readonly timeoutMs?: number;
}

export interface YouTubeOAuthAuthorizationCodeExchangeResult {
  readonly authorization: 'ready';
  readonly scope: typeof youtubeOAuthScope;
  readonly storage: 'operating_system_credential_vault';
}

export interface YouTubeOAuthLogoutOptions {
  readonly clientId: string;
  readonly credentialStore: YouTubeOAuthCredentialStore;
  readonly fetch?: typeof globalThis.fetch;
  readonly operationLock?: YouTubeOAuthOperationLock;
  readonly timeoutMs?: number;
}

export interface YouTubeOAuthLogoutResult {
  readonly localCredentialDeleted: true;
  readonly remoteRevocation: 'confirmed' | 'not_configured' | 'uncertain';
}

export type YouTubeOAuthAuthorizationStatus =
  | { readonly state: 'signed_out' }
  | { readonly state: 'ready'; readonly scope: typeof youtubeOAuthScope }
  | { readonly state: 'reauth_required' }
  | { readonly state: 'temporarily_unavailable' };

interface ParsedTokenResponse {
  readonly accessToken: string;
  readonly expiresInSeconds: number;
  readonly refreshToken?: string;
}

interface CachedAccessToken {
  readonly accessToken: string;
  readonly expiresAtMs: number;
  readonly refreshTokenDigest: string;
}

interface RefreshInFlight {
  readonly refreshTokenDigest: string;
  readonly promise: Promise<string>;
}

class YouTubeOAuthCredentialChangedError extends Error {}

export function parseYouTubeOAuthClientId(value: string): string {
  if (
    value.length < 10 ||
    value.length > 1_024 ||
    value.trim() !== value ||
    /\s/u.test(value) ||
    [...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 0x20 || codePoint === 0x7f;
    })
  ) {
    throw new Error(
      'YouTube OAuth client id must be 10-1024 characters without whitespace or controls',
    );
  }
  return value;
}

export function youtubeOAuthCredentialAccountId(clientIdInput: string): string {
  const clientId = parseYouTubeOAuthClientId(clientIdInput);
  const digest = createHash('sha256').update(clientId).digest('hex');
  return `youtube:${digest}`;
}

function boundedTimeout(value: number | undefined): number {
  const timeoutMs = value ?? defaultOAuthTimeoutMs;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > maximumOAuthTimeoutMs) {
    throw new Error(`YouTube OAuth timeout must be between 100 and ${maximumOAuthTimeoutMs}ms`);
  }
  return timeoutMs;
}

function validateOpaqueCredential(value: string): string {
  if (
    value.length === 0 ||
    value.length > maximumOAuthCredentialLength ||
    value.trim() !== value ||
    /^\S+$/u.test(value) === false
  ) {
    throw new YouTubeOAuthOperationError('authorization_failed');
  }
  return value;
}

function hasRequiredScope(scope: string | undefined): boolean {
  return scope === undefined || scope.split(/\s+/u).includes(youtubeOAuthScope);
}

async function readLimitedResponse(response: Response, timeoutMs: number): Promise<string> {
  const contentLength = response.headers.get('content-length');
  if (
    contentLength !== null &&
    /^\d+$/u.test(contentLength) &&
    Number(contentLength) > maximumTokenResponseBytes
  ) {
    throw new YouTubeOAuthOperationError('authorization_failed');
  }
  if (response.body === null) {
    throw new YouTubeOAuthOperationError('authorization_failed');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(
      () => reject(new YouTubeOAuthOperationError('authorization_failed')),
      timeoutMs,
    );
  });
  try {
    while (true) {
      const item = await Promise.race([reader.read(), timeoutPromise]);
      if (item.done) break;
      byteLength += item.value.byteLength;
      if (byteLength > maximumTokenResponseBytes) {
        throw new YouTubeOAuthOperationError('authorization_failed');
      }
      chunks.push(item.value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    throw new YouTubeOAuthOperationError('authorization_failed');
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new YouTubeOAuthOperationError('authorization_failed');
  }
}

async function postOAuthForm(
  endpoint: string,
  body: URLSearchParams,
  fetchImpl: typeof globalThis.fetch,
  timeoutMs: number,
  failureCode: YouTubeOAuthOperationErrorCode,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body,
      redirect: 'error',
      signal: controller.signal,
    });
  } catch {
    throw new YouTubeOAuthOperationError(failureCode);
  } finally {
    clearTimeout(timeout);
  }
}

async function parseTokenResponse(
  response: Response,
  failureCode: 'authorization_failed' | 'refresh_failed',
  timeoutMs: number,
): Promise<ParsedTokenResponse> {
  let text: string;
  try {
    text = await readLimitedResponse(response, timeoutMs);
  } catch {
    throw new YouTubeOAuthOperationError(failureCode);
  }
  let input: unknown;
  try {
    input = JSON.parse(text) as unknown;
  } catch {
    throw new YouTubeOAuthOperationError(failureCode);
  }
  if (!response.ok) {
    const parsedError = tokenErrorResponseSchema.safeParse(input);
    if (
      failureCode === 'refresh_failed' &&
      parsedError.success &&
      parsedError.data.error === 'invalid_grant'
    ) {
      throw new ProcedureTutorialYoutubeSourceError(
        'youtube_authentication_required',
        'Stored YouTube authorization is no longer valid; run the local login command again',
      );
    }
    throw new YouTubeOAuthOperationError(failureCode);
  }
  const parsed = tokenResponseSchema.safeParse(input);
  if (
    !parsed.success ||
    parsed.data.token_type.toLowerCase() !== 'bearer' ||
    !hasRequiredScope(parsed.data.scope)
  ) {
    throw new YouTubeOAuthOperationError(failureCode);
  }
  return {
    accessToken: parsed.data.access_token,
    expiresInSeconds: parsed.data.expires_in,
    ...(parsed.data.refresh_token === undefined ? {} : { refreshToken: parsed.data.refresh_token }),
  };
}

export async function exchangeYouTubeOAuthAuthorizationCode(
  options: YouTubeOAuthAuthorizationCodeExchangeOptions,
): Promise<YouTubeOAuthAuthorizationCodeExchangeResult> {
  const clientId = parseYouTubeOAuthClientId(options.clientId);
  const code = validateOpaqueCredential(options.code);
  const codeVerifier = validateOpaqueCredential(options.codeVerifier);
  if (!/^[A-Za-z0-9._~-]{43,128}$/u.test(codeVerifier)) {
    throw new YouTubeOAuthOperationError('authorization_failed');
  }
  const redirectUri = parseYouTubeOAuthLoopbackRedirectUri(options.redirectUri);
  const accountId = youtubeOAuthCredentialAccountId(clientId);
  return (options.operationLock ?? createYouTubeOAuthOperationLock()).runExclusive(
    accountId,
    async () => {
      const response = await postOAuthForm(
        youtubeOAuthTokenEndpoint,
        new URLSearchParams({
          client_id: clientId,
          code,
          code_verifier: codeVerifier,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
        }),
        options.fetch ?? globalThis.fetch,
        boundedTimeout(options.timeoutMs),
        'authorization_failed',
      );
      const token = await parseTokenResponse(
        response,
        'authorization_failed',
        boundedTimeout(options.timeoutMs),
      );
      if (token.refreshToken === undefined) {
        throw new YouTubeOAuthOperationError('authorization_failed');
      }
      await options.credentialStore.saveRefreshToken(accountId, token.refreshToken);
      return {
        authorization: 'ready' as const,
        scope: youtubeOAuthScope,
        storage: 'operating_system_credential_vault' as const,
      };
    },
  );
}

export function createYouTubeOAuthAccessTokenProvider(
  options: YouTubeOAuthTokenProviderOptions,
): YouTubeOAuthAccessTokenProvider {
  const clientId = parseYouTubeOAuthClientId(options.clientId);
  const accountId = youtubeOAuthCredentialAccountId(clientId);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const timeoutMs = boundedTimeout(options.timeoutMs);
  const refreshSkewMs = options.refreshSkewMs ?? defaultRefreshSkewMs;
  if (!Number.isInteger(refreshSkewMs) || refreshSkewMs < 0 || refreshSkewMs > 600_000) {
    throw new Error('YouTube OAuth refresh skew must be between 0 and 600000ms');
  }

  let cached: CachedAccessToken | undefined;
  let refreshInFlight: RefreshInFlight | undefined;
  let invalidRefreshTokenDigest: string | undefined;
  let closed = false;

  const refresh = async (refreshToken: string, refreshTokenDigest: string): Promise<string> => {
    const response = await postOAuthForm(
      youtubeOAuthTokenEndpoint,
      new URLSearchParams({
        client_id: clientId,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
      fetchImpl,
      timeoutMs,
      'refresh_failed',
    );
    let token: ParsedTokenResponse;
    try {
      token = await parseTokenResponse(response, 'refresh_failed', timeoutMs);
    } catch (error) {
      if (
        error instanceof ProcedureTutorialYoutubeSourceError &&
        error.code === 'youtube_authentication_required'
      ) {
        invalidRefreshTokenDigest = refreshTokenDigest;
        cached = undefined;
      }
      throw error;
    }
    if (token.refreshToken !== undefined) {
      throw new YouTubeOAuthOperationError('refresh_failed');
    }
    let currentRefreshToken: string | null;
    try {
      currentRefreshToken = await options.credentialStore.loadRefreshToken(accountId);
    } catch {
      throw new ProcedureTutorialYoutubeSourceError(
        'youtube_source_unavailable',
        'The operating-system credential vault is unavailable',
      );
    }
    if (currentRefreshToken === null) {
      throw new ProcedureTutorialYoutubeSourceError(
        'youtube_authentication_required',
        'YouTube authorization is required; run the local login command',
      );
    }
    if (secretDigest(currentRefreshToken) !== refreshTokenDigest) {
      throw new YouTubeOAuthCredentialChangedError();
    }
    if (closed) {
      throw new ProcedureTutorialYoutubeSourceError(
        'youtube_source_unavailable',
        'YouTube OAuth access token provider is closed',
      );
    }
    invalidRefreshTokenDigest = undefined;
    cached = {
      accessToken: token.accessToken,
      expiresAtMs: now() + token.expiresInSeconds * 1_000,
      refreshTokenDigest,
    };
    return token.accessToken;
  };

  const getAccessToken = async (): Promise<string> => {
    if (closed) {
      throw new ProcedureTutorialYoutubeSourceError(
        'youtube_source_unavailable',
        'YouTube OAuth access token provider is closed',
      );
    }
    let refreshToken: string | null;
    try {
      refreshToken = await options.credentialStore.loadRefreshToken(accountId);
    } catch (error) {
      if (
        error instanceof YouTubeOAuthCredentialStoreError &&
        error.code === 'invalid_credential_input'
      ) {
        cached = undefined;
        throw new ProcedureTutorialYoutubeSourceError(
          'youtube_authentication_required',
          'Stored YouTube authorization is invalid; run the local login command again',
        );
      }
      throw new ProcedureTutorialYoutubeSourceError(
        'youtube_source_unavailable',
        'The operating-system credential vault is unavailable',
      );
    }
    if (refreshToken === null) {
      cached = undefined;
      throw new ProcedureTutorialYoutubeSourceError(
        'youtube_authentication_required',
        'YouTube authorization is required; run the local login command',
      );
    }
    try {
      validateOpaqueCredential(refreshToken);
    } catch {
      cached = undefined;
      throw new ProcedureTutorialYoutubeSourceError(
        'youtube_authentication_required',
        'Stored YouTube authorization is invalid; run the local login command again',
      );
    }
    const refreshTokenDigest = secretDigest(refreshToken);
    if (invalidRefreshTokenDigest === refreshTokenDigest) {
      throw new ProcedureTutorialYoutubeSourceError(
        'youtube_authentication_required',
        'Stored YouTube authorization is no longer valid; run the local login command again',
      );
    }
    if (
      cached !== undefined &&
      cached.refreshTokenDigest === refreshTokenDigest &&
      cached.expiresAtMs - refreshSkewMs > now()
    ) {
      return cached.accessToken;
    }
    if (refreshInFlight?.refreshTokenDigest === refreshTokenDigest) {
      return refreshInFlight.promise;
    }
    if (refreshInFlight !== undefined) {
      await refreshInFlight.promise.catch(() => undefined);
      return getAccessToken();
    }
    const promise = refresh(refreshToken, refreshTokenDigest).catch((error: unknown) => {
      if (
        error instanceof ProcedureTutorialYoutubeSourceError ||
        error instanceof YouTubeOAuthCredentialChangedError
      ) {
        throw error;
      }
      throw new ProcedureTutorialYoutubeSourceError(
        'youtube_source_unavailable',
        'YouTube OAuth access token could not be refreshed',
      );
    });
    refreshInFlight = { refreshTokenDigest, promise };
    try {
      return await promise;
    } catch (error) {
      if (!(error instanceof YouTubeOAuthCredentialChangedError)) throw error;
    } finally {
      if (refreshInFlight?.promise === promise) refreshInFlight = undefined;
    }
    return getAccessToken();
  };

  return {
    getAccessToken,
    invalidateAccessToken(accessToken) {
      if (cached?.accessToken === accessToken) cached = undefined;
    },
    close() {
      closed = true;
      cached = undefined;
    },
  };
}

export async function getYouTubeOAuthAuthorizationStatus(
  options: YouTubeOAuthTokenProviderOptions,
): Promise<YouTubeOAuthAuthorizationStatus> {
  const clientId = parseYouTubeOAuthClientId(options.clientId);
  try {
    const stored = await options.credentialStore.loadRefreshToken(
      youtubeOAuthCredentialAccountId(clientId),
    );
    if (stored === null) return { state: 'signed_out' };
  } catch (error) {
    if (
      error instanceof YouTubeOAuthCredentialStoreError &&
      error.code === 'invalid_credential_input'
    ) {
      return { state: 'reauth_required' };
    }
    return { state: 'temporarily_unavailable' };
  }
  const provider = createYouTubeOAuthAccessTokenProvider(options);
  try {
    await provider.getAccessToken();
    return { state: 'ready', scope: youtubeOAuthScope };
  } catch (error) {
    return error instanceof ProcedureTutorialYoutubeSourceError &&
      error.code === 'youtube_authentication_required'
      ? { state: 'reauth_required' }
      : { state: 'temporarily_unavailable' };
  } finally {
    await provider.close?.();
  }
}

export async function logoutYouTubeOAuth(
  options: YouTubeOAuthLogoutOptions,
): Promise<YouTubeOAuthLogoutResult> {
  const clientId = parseYouTubeOAuthClientId(options.clientId);
  const accountId = youtubeOAuthCredentialAccountId(clientId);
  return (options.operationLock ?? createYouTubeOAuthOperationLock()).runExclusive(
    accountId,
    async () => {
      let refreshToken: string | null;
      try {
        refreshToken = await options.credentialStore.loadRefreshToken(accountId);
      } catch (error) {
        if (
          error instanceof YouTubeOAuthCredentialStoreError &&
          error.code === 'invalid_credential_input'
        ) {
          await options.credentialStore.deleteRefreshToken(accountId);
          return { localCredentialDeleted: true, remoteRevocation: 'uncertain' as const };
        }
        throw error;
      }
      if (refreshToken === null) {
        return { localCredentialDeleted: true, remoteRevocation: 'not_configured' as const };
      }
      let remoteRevocation: YouTubeOAuthLogoutResult['remoteRevocation'];
      try {
        const response = await postOAuthForm(
          youtubeOAuthRevocationEndpoint,
          new URLSearchParams({ token: refreshToken }),
          options.fetch ?? globalThis.fetch,
          boundedTimeout(options.timeoutMs),
          'revocation_failed',
        );
        remoteRevocation = response.ok ? 'confirmed' : 'uncertain';
        if (response.body !== null) await response.body.cancel().catch(() => undefined);
      } catch {
        remoteRevocation = 'uncertain';
      } finally {
        await options.credentialStore.deleteRefreshToken(accountId);
      }
      return { localCredentialDeleted: true, remoteRevocation };
    },
  );
}

function secretDigest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function parseYouTubeOAuthLoopbackRedirectUri(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new YouTubeOAuthOperationError('authorization_failed');
  }
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.port === '' ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== '' ||
    url.pathname !== '/'
  ) {
    throw new YouTubeOAuthOperationError('authorization_failed');
  }
  return url.href;
}
