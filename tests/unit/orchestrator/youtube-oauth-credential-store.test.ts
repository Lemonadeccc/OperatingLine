import { describe, expect, it, vi } from 'vitest';

import {
  createDefaultYouTubeOAuthCredentialStore,
  YouTubeOAuthCredentialStoreError,
  type YouTubeOAuthCredentialCommand,
  type YouTubeOAuthCredentialCommandResult,
  type YouTubeOAuthCredentialCommandRunner,
} from '../../../services/orchestrator/src/youtube-oauth-credential-store.js';

const accountId = 'sha256:0123456789abcdef';
const refreshToken = 'refresh-token-value-that-must-stay-secret';

function runnerWith(
  result: YouTubeOAuthCredentialCommandResult | Error,
): YouTubeOAuthCredentialCommandRunner & {
  run: ReturnType<
    typeof vi.fn<
      (command: YouTubeOAuthCredentialCommand) => Promise<YouTubeOAuthCredentialCommandResult>
    >
  >;
} {
  return {
    run: vi.fn(async () => {
      if (result instanceof Error) throw result;
      return result;
    }),
  };
}

describe('YouTube OAuth secure credential store', () => {
  it.each([
    ['darwin', '/usr/bin/security', 'find-generic-password'],
    ['linux', '/usr/bin/secret-tool', 'lookup'],
    ['win32', 'powershell.exe', '-EncodedCommand'],
  ] as const)(
    'loads a refresh token through the %s secure backend',
    async (platform, executable, marker) => {
      const runner = runnerWith({ exitCode: 0, stdout: `${refreshToken}\n` });
      const store = createDefaultYouTubeOAuthCredentialStore({ platform, runner });

      await expect(store.loadRefreshToken(accountId)).resolves.toBe(refreshToken);
      const command = runner.run.mock.calls[0]?.[0];
      expect(command?.executable).toBe(executable);
      expect(command?.args).toContain(marker);
      expect(command?.args).not.toContain(refreshToken);
      if (platform === 'win32') {
        expect(JSON.parse(command?.stdin ?? '{}')).toMatchObject({ account: accountId });
      } else {
        expect(command?.stdin).toBeUndefined();
      }
    },
  );

  it.each([
    ['darwin', '/usr/bin/security'],
    ['linux', '/usr/bin/secret-tool'],
    ['win32', 'powershell.exe'],
  ] as const)('writes the secret only over stdin on %s', async (platform, executable) => {
    const runner = runnerWith({ exitCode: 0, stdout: '' });
    const store = createDefaultYouTubeOAuthCredentialStore({ platform, runner });

    await store.saveRefreshToken(accountId, refreshToken);

    const command = runner.run.mock.calls[0]?.[0];
    expect(command?.executable).toBe(executable);
    if (platform === 'win32') {
      expect(JSON.parse(command?.stdin ?? '{}')).toMatchObject({
        account: accountId,
        secret: refreshToken,
      });
    } else {
      expect(command?.stdin).toBe(`${refreshToken}\n`);
    }
    expect(command?.args.join(' ')).not.toContain(refreshToken);
  });

  it.each([
    ['darwin', 44],
    ['linux', 1],
    ['win32', 4],
  ] as const)(
    'treats %s not-found as an empty, idempotent credential',
    async (platform, exitCode) => {
      const runner = runnerWith({ exitCode, stdout: '' });
      const store = createDefaultYouTubeOAuthCredentialStore({ platform, runner });

      await expect(store.loadRefreshToken(accountId)).resolves.toBeNull();
      await expect(store.deleteRefreshToken(accountId)).resolves.toBeUndefined();
    },
  );

  it('fails closed when the operating system has no supported secure backend', async () => {
    const runner = runnerWith({ exitCode: 0, stdout: '' });
    const store = createDefaultYouTubeOAuthCredentialStore({ platform: 'freebsd', runner });

    await expect(store.saveRefreshToken(accountId, refreshToken)).rejects.toMatchObject({
      code: 'secure_backend_unavailable',
    });
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('fails closed when the secure backend executable is unavailable', async () => {
    const runner = runnerWith(new Error(`spawn failed near ${refreshToken}`));
    const store = createDefaultYouTubeOAuthCredentialStore({ platform: 'linux', runner });

    const failure = await store
      .saveRefreshToken(accountId, refreshToken)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(YouTubeOAuthCredentialStoreError);
    expect(failure).toMatchObject({ code: 'secure_backend_unavailable' });
    expect(String(failure)).not.toContain(refreshToken);
  });

  it('does not copy command output, errors, or secrets into public backend failures', async () => {
    const runner = runnerWith({ exitCode: 9, stdout: refreshToken });
    const store = createDefaultYouTubeOAuthCredentialStore({ platform: 'darwin', runner });

    const failure = await store.loadRefreshToken(accountId).catch((error: unknown) => error);

    expect(failure).toMatchObject({ code: 'secure_backend_failed' });
    expect(String(failure)).not.toContain(refreshToken);
    expect(JSON.stringify(failure)).not.toContain(refreshToken);
  });

  it('rejects unsafe account ids and refresh tokens before invoking a backend', async () => {
    const runner = runnerWith({ exitCode: 0, stdout: '' });
    const store = createDefaultYouTubeOAuthCredentialStore({ platform: 'linux', runner });

    await expect(store.loadRefreshToken('unsafe account')).rejects.toMatchObject({
      code: 'invalid_credential_input',
    });
    await expect(store.saveRefreshToken(accountId, `${refreshToken}\nleak`)).rejects.toMatchObject({
      code: 'invalid_credential_input',
    });
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('rejects malformed stored secrets without exposing them', async () => {
    const malformedSecret = 'stored secret with spaces';
    const runner = runnerWith({ exitCode: 0, stdout: malformedSecret });
    const store = createDefaultYouTubeOAuthCredentialStore({ platform: 'linux', runner });

    const failure = await store.loadRefreshToken(accountId).catch((error: unknown) => error);

    expect(failure).toMatchObject({ code: 'invalid_credential_input' });
    expect(String(failure)).not.toContain(malformedSecret);
  });
});
