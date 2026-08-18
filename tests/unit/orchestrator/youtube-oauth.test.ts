import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { YouTubeOAuthCredentialStore } from '../../../services/orchestrator/src/youtube-oauth-credential-store.js';
import {
  createYouTubeOAuthAccessTokenProvider,
  exchangeYouTubeOAuthAuthorizationCode,
  logoutYouTubeOAuth,
  youtubeOAuthCredentialAccountId,
  youtubeOAuthScope,
} from '../../../services/orchestrator/src/youtube-oauth.js';

const clientId = 'operatingline-desktop-client.apps.exampleusercontent.com';
const otherClientId = 'operatingline-secondary-client.apps.exampleusercontent.com';
const originalRefreshToken = 'refresh_original_opaque_value';
const replacementRefreshToken = 'refresh_replacement_opaque_value';
const authorizationCode = 'authorization_code_opaque_value';
const codeVerifier = 'pkce_verifier_opaque_value_0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const accessToken = 'access_original_opaque_value';

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

class FakeCredentialStore implements YouTubeOAuthCredentialStore {
  private value: string | null;
  readonly loadedAccountIds: string[] = [];
  readonly savedAccountIds: string[] = [];
  readonly deletedAccountIds: string[] = [];
  savedExpectedRefreshToken = false;

  constructor(initial: string | null = null) {
    this.value = initial;
  }

  replaceExternally(value: string | null): void {
    this.value = value;
  }

  hasCredential(): boolean {
    return this.value !== null;
  }

  credentialDigest(): string | null {
    return this.value === null ? null : digest(this.value);
  }

  async loadRefreshToken(accountId: string): Promise<string | null> {
    this.loadedAccountIds.push(accountId);
    return this.value;
  }

  async saveRefreshToken(accountId: string, refreshToken: string): Promise<void> {
    this.savedAccountIds.push(accountId);
    this.savedExpectedRefreshToken = refreshToken === originalRefreshToken;
    this.value = refreshToken;
  }

  async deleteRefreshToken(accountId: string): Promise<void> {
    this.deletedAccountIds.push(accountId);
    this.value = null;
  }
}

function tokenResponse(
  token: string,
  options: { readonly expiresIn?: number; readonly refreshToken?: string } = {},
): Response {
  return Response.json({
    access_token: token,
    expires_in: options.expiresIn ?? 3600,
    token_type: 'Bearer',
    scope: youtubeOAuthScope,
    ...(options.refreshToken === undefined ? {} : { refresh_token: options.refreshToken }),
  });
}

function publicFailure(error: unknown): { readonly code?: unknown; readonly serialized: string } {
  const candidate = error as { readonly code?: unknown };
  return { code: candidate?.code, serialized: JSON.stringify(error) + String(error) };
}

describe('YouTube OAuth token lifecycle', () => {
  it('derives a stable opaque credential account identity for each client', () => {
    const first = youtubeOAuthCredentialAccountId(clientId);
    const repeated = youtubeOAuthCredentialAccountId(clientId);
    const other = youtubeOAuthCredentialAccountId(otherClientId);

    expect(first).toBe(repeated);
    expect(first).not.toBe(other);
    expect(first).toMatch(/^youtube:[a-f0-9]{64}$/u);
    expect(first.includes(clientId)).toBe(false);
  });

  it('exchanges an authorization code and persists only the refresh credential', async () => {
    const store = new FakeCredentialStore();
    let requestWasAuthorizationCodeExchange = false;
    let requestContainedOnlyExpectedCredentialKinds = false;
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      const body = init?.body as URLSearchParams;
      requestWasAuthorizationCodeExchange =
        body.get('grant_type') === 'authorization_code' &&
        body.get('client_id') === clientId &&
        body.has('code') &&
        body.has('code_verifier') &&
        body.get('redirect_uri') === 'http://127.0.0.1:43123/';
      requestContainedOnlyExpectedCredentialKinds =
        body.has('code') && !body.has('access_token') && !body.has('refresh_token');
      return tokenResponse(accessToken, { refreshToken: originalRefreshToken });
    });

    const result = await exchangeYouTubeOAuthAuthorizationCode({
      clientId,
      code: authorizationCode,
      codeVerifier,
      redirectUri: 'http://127.0.0.1:43123/',
      credentialStore: store,
      fetch: fetchImpl,
    });

    expect(requestWasAuthorizationCodeExchange).toBe(true);
    expect(requestContainedOnlyExpectedCredentialKinds).toBe(true);
    expect(store.savedExpectedRefreshToken).toBe(true);
    expect(store.savedAccountIds).toEqual([youtubeOAuthCredentialAccountId(clientId)]);
    expect(result).toEqual({
      authorization: 'ready',
      scope: youtubeOAuthScope,
      storage: 'operating_system_credential_vault',
    });
    expect(JSON.stringify(result).includes(accessToken)).toBe(false);
    expect(JSON.stringify(result).includes(originalRefreshToken)).toBe(false);
  });

  it('reuses a cached access token while it remains outside the refresh window', async () => {
    const store = new FakeCredentialStore(originalRefreshToken);
    let now = 1_000_000;
    const fetchImpl = vi.fn<typeof fetch>(async () => tokenResponse(accessToken));
    const provider = createYouTubeOAuthAccessTokenProvider({
      clientId,
      credentialStore: store,
      fetch: fetchImpl,
      now: () => now,
      refreshSkewMs: 60_000,
    });

    await provider.getAccessToken();
    now += 3_000_000;
    await provider.getAccessToken();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('refreshes early when the cached access token enters the configured skew window', async () => {
    const store = new FakeCredentialStore(originalRefreshToken);
    let now = 1_000_000;
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      tokenResponse(accessToken, { expiresIn: 120 }),
    );
    const provider = createYouTubeOAuthAccessTokenProvider({
      clientId,
      credentialStore: store,
      fetch: fetchImpl,
      now: () => now,
      refreshSkewMs: 60_000,
    });

    await provider.getAccessToken();
    now += 60_001;
    await provider.getAccessToken();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent refreshes into one token request', async () => {
    const store = new FakeCredentialStore(originalRefreshToken);
    let releaseResponse: (() => void) | undefined;
    const responseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      await responseGate;
      return tokenResponse(accessToken);
    });
    const provider = createYouTubeOAuthAccessTokenProvider({
      clientId,
      credentialStore: store,
      fetch: fetchImpl,
    });

    const first = provider.getAccessToken();
    const second = provider.getAccessToken();
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    releaseResponse?.();
    await Promise.all([first, second]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('hot-switches to a refresh credential replaced outside the provider', async () => {
    const store = new FakeCredentialStore(originalRefreshToken);
    const refreshDigests: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      const body = init?.body as URLSearchParams;
      refreshDigests.push(digest(body.get('refresh_token') ?? ''));
      return tokenResponse(`access_${refreshDigests.length}_opaque`);
    });
    const provider = createYouTubeOAuthAccessTokenProvider({
      clientId,
      credentialStore: store,
      fetch: fetchImpl,
    });

    await provider.getAccessToken();
    store.replaceExternally(replacementRefreshToken);
    await provider.getAccessToken();

    expect(refreshDigests).toEqual([digest(originalRefreshToken), digest(replacementRefreshToken)]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('discards a successful in-flight refresh when login replaces its credential', async () => {
    const store = new FakeCredentialStore(originalRefreshToken);
    const usedRefreshDigests: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      const body = init?.body as URLSearchParams;
      usedRefreshDigests.push(digest(body.get('refresh_token') ?? ''));
      if (fetchImpl.mock.calls.length === 1) {
        store.replaceExternally(replacementRefreshToken);
        return tokenResponse('access_from_old_authorization');
      }
      return tokenResponse('access_from_new_authorization');
    });
    const provider = createYouTubeOAuthAccessTokenProvider({
      clientId,
      credentialStore: store,
      fetch: fetchImpl,
    });

    await expect(provider.getAccessToken()).resolves.toBe('access_from_new_authorization');

    expect(usedRefreshDigests).toEqual([
      digest(originalRefreshToken),
      digest(replacementRefreshToken),
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('blocks an invalid grant in memory and requires a new login without racing a vault update', async () => {
    const store = new FakeCredentialStore(originalRefreshToken);
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({ error: 'invalid_grant' }, { status: 400 }),
    );
    const provider = createYouTubeOAuthAccessTokenProvider({
      clientId,
      credentialStore: store,
      fetch: fetchImpl,
    });

    const firstFailure = publicFailure(
      await provider.getAccessToken().catch((error: unknown) => error),
    );
    const secondFailure = publicFailure(
      await provider.getAccessToken().catch((error: unknown) => error),
    );

    expect(firstFailure.code).toBe('youtube_authentication_required');
    expect(secondFailure.code).toBe('youtube_authentication_required');
    expect(store.hasCredential()).toBe(true);
    expect(store.deletedAccountIds).toHaveLength(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(firstFailure.serialized.includes(originalRefreshToken)).toBe(false);
    expect(secondFailure.serialized.includes(originalRefreshToken)).toBe(false);
  });

  it('preserves a newly replaced credential when an older in-flight grant becomes invalid', async () => {
    const store = new FakeCredentialStore(originalRefreshToken);
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      if (fetchImpl.mock.calls.length === 1) {
        store.replaceExternally(replacementRefreshToken);
        return Response.json({ error: 'invalid_grant' }, { status: 400 });
      }
      return tokenResponse(accessToken);
    });
    const provider = createYouTubeOAuthAccessTokenProvider({
      clientId,
      credentialStore: store,
      fetch: fetchImpl,
    });

    await provider.getAccessToken().catch(() => undefined);
    await provider.getAccessToken();

    expect(store.credentialDigest()).toBe(digest(replacementRefreshToken));
    expect(store.deletedAccountIds).toHaveLength(0);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not overwrite a newer vault credential with an unexpected refresh response rotation', async () => {
    const store = new FakeCredentialStore(originalRefreshToken);
    const staleRotatedToken = 'refresh_stale_rotation_opaque_value';
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      store.replaceExternally(replacementRefreshToken);
      return tokenResponse(accessToken, { refreshToken: staleRotatedToken });
    });
    const provider = createYouTubeOAuthAccessTokenProvider({
      clientId,
      credentialStore: store,
      fetch: fetchImpl,
    });

    await expect(provider.getAccessToken()).rejects.toMatchObject({
      code: 'youtube_source_unavailable',
    });

    expect(store.credentialDigest()).toBe(digest(replacementRefreshToken));
    expect(store.savedAccountIds).toHaveLength(0);
  });

  it('keeps the refresh credential after a temporary token endpoint failure', async () => {
    const store = new FakeCredentialStore(originalRefreshToken);
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      if (fetchImpl.mock.calls.length === 1) throw new Error('temporary network failure');
      return tokenResponse(accessToken);
    });
    const provider = createYouTubeOAuthAccessTokenProvider({
      clientId,
      credentialStore: store,
      fetch: fetchImpl,
    });

    const failure = publicFailure(await provider.getAccessToken().catch((error: unknown) => error));
    await provider.getAccessToken();

    expect(failure.code).toBe('youtube_source_unavailable');
    expect(store.hasCredential()).toBe(true);
    expect(store.deletedAccountIds).toHaveLength(0);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(failure.serialized.includes(originalRefreshToken)).toBe(false);
  });

  it('deletes the local credential after confirmed remote logout', async () => {
    const store = new FakeCredentialStore(originalRefreshToken);
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));

    const result = await logoutYouTubeOAuth({ clientId, credentialStore: store, fetch: fetchImpl });

    expect(result).toEqual({ localCredentialDeleted: true, remoteRevocation: 'confirmed' });
    expect(store.hasCredential()).toBe(false);
  });

  it('deletes the local credential when remote logout cannot be confirmed', async () => {
    const store = new FakeCredentialStore(originalRefreshToken);
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error('revocation endpoint unavailable');
    });

    const result = await logoutYouTubeOAuth({ clientId, credentialStore: store, fetch: fetchImpl });

    expect(result).toEqual({ localCredentialDeleted: true, remoteRevocation: 'uncertain' });
    expect(store.hasCredential()).toBe(false);
    expect(JSON.stringify(result).includes(originalRefreshToken)).toBe(false);
  });
});
