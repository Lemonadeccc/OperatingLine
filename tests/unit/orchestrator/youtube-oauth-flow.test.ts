import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { YouTubeOAuthCredentialStore } from '../../../services/orchestrator/src/youtube-oauth-credential-store.js';
import {
  authorizeYouTubeOAuthInstalledApp,
  createYouTubeOAuthAuthorizationUrl,
} from '../../../services/orchestrator/src/youtube-oauth-flow.js';
import { youtubeOAuthScope } from '../../../services/orchestrator/src/youtube-oauth.js';

const clientId = 'operatingline-desktop-client.apps.exampleusercontent.com';
const refreshToken = 'refresh_flow_opaque_value';
const accessToken = 'access_flow_opaque_value';
const callbackCode = 'callback_code_opaque_value';

class FlowCredentialStore implements YouTubeOAuthCredentialStore {
  saved = false;

  async loadRefreshToken(): Promise<string | null> {
    return null;
  }

  async saveRefreshToken(_accountId: string, value: string): Promise<void> {
    this.saved = value === refreshToken;
  }

  async deleteRefreshToken(): Promise<void> {}
}

function callbackUrl(authorizationUrl: string, parameters: Record<string, string>): string {
  const authorization = new URL(authorizationUrl);
  const callback = new URL(authorization.searchParams.get('redirect_uri')!);
  for (const [key, value] of Object.entries(parameters)) callback.searchParams.set(key, value);
  return callback.href;
}

describe('YouTube OAuth installed-app authorization flow', () => {
  it('builds an offline S256 PKCE authorization request with state', () => {
    const authorizationUrl = createYouTubeOAuthAuthorizationUrl({
      clientId,
      redirectUri: 'http://127.0.0.1:43123/',
      state: 'state_opaque_value_0123456789abcdef',
      codeChallenge: 'challenge_opaque_value_0123456789ABCDEFGHIJKLMN',
    });
    const url = new URL(authorizationUrl);

    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe(clientId);
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:43123/');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe(youtubeOAuthScope);
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('completes login through the exact loopback callback with matching state and PKCE proof', async () => {
    const store = new FlowCredentialStore();
    let callbackWasExact = false;
    let stateWasPresent = false;
    let pkceProofMatched = false;
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      const body = init?.body as URLSearchParams;
      const verifier = body.get('code_verifier') ?? '';
      pkceProofMatched =
        createHash('sha256').update(verifier).digest('base64url') === expectedCodeChallenge;
      callbackWasExact =
        body.get('redirect_uri') === expectedRedirectUri &&
        new URL(expectedRedirectUri).hostname === '127.0.0.1' &&
        new URL(expectedRedirectUri).pathname === '/';
      return Response.json({
        access_token: accessToken,
        expires_in: 3600,
        refresh_token: refreshToken,
        scope: youtubeOAuthScope,
        token_type: 'Bearer',
      });
    });
    let expectedCodeChallenge = '';
    let expectedRedirectUri = '';

    const result = await authorizeYouTubeOAuthInstalledApp({
      clientId,
      credentialStore: store,
      fetch: fetchImpl,
      callbackTimeoutMs: 2_000,
      openAuthorizationUrl: async (authorizationUrl) => {
        const url = new URL(authorizationUrl);
        expectedCodeChallenge = url.searchParams.get('code_challenge') ?? '';
        expectedRedirectUri = url.searchParams.get('redirect_uri') ?? '';
        const state = url.searchParams.get('state') ?? '';
        stateWasPresent = state.length >= 32;
        const response = await fetch(callbackUrl(authorizationUrl, { state, code: callbackCode }));
        if (response.status !== 200) throw new Error('callback failed');
      },
    });

    expect(stateWasPresent).toBe(true);
    expect(callbackWasExact).toBe(true);
    expect(pkceProofMatched).toBe(true);
    expect(store.saved).toBe(true);
    expect(result.authorization).toBe('ready');
    expect(JSON.stringify(result).includes(refreshToken)).toBe(false);
    expect(JSON.stringify(result).includes(accessToken)).toBe(false);
  });

  it('rejects an authorization error callback without exchanging a code', async () => {
    const store = new FlowCredentialStore();
    const fetchImpl = vi.fn<typeof fetch>();

    const failure = await authorizeYouTubeOAuthInstalledApp({
      clientId,
      credentialStore: store,
      fetch: fetchImpl,
      callbackTimeoutMs: 2_000,
      openAuthorizationUrl: async (authorizationUrl) => {
        const url = new URL(authorizationUrl);
        const state = url.searchParams.get('state') ?? '';
        void fetch(callbackUrl(authorizationUrl, { state, error: 'access_denied' }));
      },
    }).catch((error: unknown) => error as { readonly code?: unknown });

    expect(failure.code).toBe('authorization_denied');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(store.saved).toBe(false);
  });

  it('keeps the manual callback alive when the system browser cannot be opened', async () => {
    const store = new FlowCredentialStore();
    let publishAuthorizationUrl: ((authorizationUrl: string) => void) | undefined;
    const authorizationUrl = new Promise<string>((resolve) => {
      publishAuthorizationUrl = resolve;
    });
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({
        access_token: accessToken,
        expires_in: 3600,
        refresh_token: refreshToken,
        scope: youtubeOAuthScope,
        token_type: 'Bearer',
      }),
    );

    const login = authorizeYouTubeOAuthInstalledApp({
      clientId,
      credentialStore: store,
      fetch: fetchImpl,
      callbackTimeoutMs: 2_000,
      onAuthorizationUrl(url) {
        publishAuthorizationUrl?.(url);
      },
      openAuthorizationUrl: async () => {
        throw new Error('no system browser');
      },
    });
    const surfacedUrl = await authorizationUrl;
    const parsed = new URL(surfacedUrl);
    const state = parsed.searchParams.get('state') ?? '';
    await expect(
      fetch(callbackUrl(surfacedUrl, { state, code: callbackCode })),
    ).resolves.toMatchObject({ status: 200 });

    await expect(login).resolves.toMatchObject({ authorization: 'ready' });
    expect(store.saved).toBe(true);
  });

  it('does not settle on a wrong path or mismatched state before a valid callback', async () => {
    const store = new FlowCredentialStore();
    const statuses: number[] = [];
    let finishCallbackSequence: (() => void) | undefined;
    const callbackSequence = new Promise<void>((resolve) => {
      finishCallbackSequence = resolve;
    });
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      await callbackSequence;
      return Response.json({
        access_token: accessToken,
        expires_in: 3600,
        refresh_token: refreshToken,
        scope: youtubeOAuthScope,
        token_type: 'Bearer',
      });
    });

    await authorizeYouTubeOAuthInstalledApp({
      clientId,
      credentialStore: store,
      fetch: fetchImpl,
      callbackTimeoutMs: 2_000,
      openAuthorizationUrl: async (authorizationUrl) => {
        const url = new URL(authorizationUrl);
        const state = url.searchParams.get('state') ?? '';
        const redirect = new URL(url.searchParams.get('redirect_uri')!);
        statuses.push((await fetch(new URL('/oauth/youtube/other', redirect).href)).status);
        statuses.push(
          (await fetch(callbackUrl(authorizationUrl, { state: 'wrong_state', code: callbackCode })))
            .status,
        );
        statuses.push(
          (await fetch(callbackUrl(authorizationUrl, { state, code: callbackCode }))).status,
        );
        finishCallbackSequence?.();
      },
    });

    expect(statuses).toEqual([404, 400, 200]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(store.saved).toBe(true);
  });

  it('returns conflict for a duplicate callback after accepting the first code', async () => {
    const store = new FlowCredentialStore();
    let releaseExchange: (() => void) | undefined;
    const exchangeGate = new Promise<void>((resolve) => {
      releaseExchange = resolve;
    });
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      await exchangeGate;
      return Response.json({
        access_token: accessToken,
        expires_in: 3600,
        refresh_token: refreshToken,
        scope: youtubeOAuthScope,
        token_type: 'Bearer',
      });
    });
    let duplicateStatus = 0;
    let duplicateRequest: Promise<void> | undefined;

    await authorizeYouTubeOAuthInstalledApp({
      clientId,
      credentialStore: store,
      fetch: fetchImpl,
      callbackTimeoutMs: 2_000,
      openAuthorizationUrl: async (authorizationUrl) => {
        const url = new URL(authorizationUrl);
        const state = url.searchParams.get('state') ?? '';
        const callback = callbackUrl(authorizationUrl, { state, code: callbackCode });
        const firstResponse = await fetch(callback);
        if (firstResponse.status !== 200) throw new Error('first callback failed');
        duplicateRequest = (async () => {
          await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
          duplicateStatus = (await fetch(callback)).status;
          releaseExchange?.();
        })();
      },
    });
    await duplicateRequest;

    expect(duplicateStatus).toBe(409);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(store.saved).toBe(true);
  });
});
