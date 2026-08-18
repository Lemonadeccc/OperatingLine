import { spawn } from 'node:child_process';

const youtubeOAuthCredentialService = 'dev.operatingline.youtube.oauth.refresh-token';
const maximumRefreshTokenBytes = 16_384;
const commandOutputLimitBytes = maximumRefreshTokenBytes + 1_024;
const credentialCommandTimeoutMs = 60_000;
const windowsNotFoundExitCode = 4;

export interface YouTubeOAuthCredentialStore {
  loadRefreshToken(accountId: string): Promise<string | null>;
  saveRefreshToken(accountId: string, refreshToken: string): Promise<void>;
  deleteRefreshToken(accountId: string): Promise<void>;
}

export interface YouTubeOAuthCredentialCommand {
  readonly executable: string;
  readonly args: readonly string[];
  readonly stdin?: string;
}

export interface YouTubeOAuthCredentialCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
}

export interface YouTubeOAuthCredentialCommandRunner {
  run(command: YouTubeOAuthCredentialCommand): Promise<YouTubeOAuthCredentialCommandResult>;
}

export type YouTubeOAuthCredentialStoreErrorCode =
  'secure_backend_unavailable' | 'secure_backend_failed' | 'invalid_credential_input';

export class YouTubeOAuthCredentialStoreError extends Error {
  constructor(readonly code: YouTubeOAuthCredentialStoreErrorCode) {
    super(
      code === 'secure_backend_unavailable'
        ? 'A supported secure credential backend is unavailable'
        : code === 'invalid_credential_input'
          ? 'The OAuth credential input is invalid'
          : 'The secure credential operation failed',
    );
    this.name = 'YouTubeOAuthCredentialStoreError';
  }
}

function defaultCommandRunner(): YouTubeOAuthCredentialCommandRunner {
  return {
    run(command) {
      return new Promise((resolve, reject) => {
        const child = spawn(command.executable, [...command.args], {
          stdio: ['pipe', 'pipe', 'ignore'],
          windowsHide: true,
        });
        const chunks: Buffer[] = [];
        let byteLength = 0;
        let settled = false;
        const timeout = setTimeout(() => {
          child.kill();
          fail();
        }, credentialCommandTimeoutMs);

        const fail = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          reject(new Error('credential command failed'));
        };

        child.once('error', fail);
        child.stdout.on('data', (chunk: Buffer) => {
          if (settled) return;
          byteLength += chunk.byteLength;
          if (byteLength > commandOutputLimitBytes) {
            child.kill();
            fail();
            return;
          }
          chunks.push(chunk);
        });
        child.once('close', (exitCode) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          resolve({
            exitCode: exitCode ?? 1,
            stdout: Buffer.concat(chunks).toString('utf8'),
          });
        });

        child.stdin.once('error', fail);
        child.stdin.end(command.stdin);
      });
    },
  };
}

function validateAccountId(accountId: string): void {
  if (accountId.length === 0 || accountId.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(accountId)) {
    throw new YouTubeOAuthCredentialStoreError('invalid_credential_input');
  }
}

function validateRefreshToken(refreshToken: string): void {
  const hasUnsafeCharacter = [...refreshToken].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return /\s/.test(character) || codePoint < 0x20 || codePoint === 0x7f;
  });
  if (
    refreshToken.length === 0 ||
    Buffer.byteLength(refreshToken, 'utf8') > maximumRefreshTokenBytes ||
    hasUnsafeCharacter
  ) {
    throw new YouTubeOAuthCredentialStoreError('invalid_credential_input');
  }
}

function normalizeLoadedToken(stdout: string): string {
  const token = stdout.replace(/(?:\r\n|\n|\r)$/, '');
  validateRefreshToken(token);
  return token;
}

const windowsLoadScript = String.raw`
$ErrorActionPreference = 'Stop'
$notFound = -2147023728
$payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
$vault = [Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]::new()
try {
  $credential = $vault.Retrieve([string]$payload.resource, [string]$payload.account)
  $credential.RetrievePassword()
  [Console]::Out.Write($credential.Password)
} catch {
  if ($_.Exception.HResult -eq $notFound) { exit 4 }
  exit 5
}`;

const windowsSaveScript = String.raw`
$ErrorActionPreference = 'Stop'
$notFound = -2147023728
$payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
$resource = [string]$payload.resource
$account = [string]$payload.account
$vault = [Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]::new()
try {
  $existing = $vault.Retrieve($resource, $account)
  $vault.Remove($existing)
} catch {
  if ($_.Exception.HResult -ne $notFound) { exit 5 }
}
$secret = [string]$payload.secret
$credential = [Windows.Security.Credentials.PasswordCredential,Windows.Security.Credentials,ContentType=WindowsRuntime]::new($resource, $account, $secret)
$vault.Add($credential)
`;

const windowsDeleteScript = String.raw`
$ErrorActionPreference = 'Stop'
$notFound = -2147023728
$payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
$vault = [Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]::new()
try {
  $credential = $vault.Retrieve([string]$payload.resource, [string]$payload.account)
  $vault.Remove($credential)
} catch {
  if ($_.Exception.HResult -eq $notFound) { exit 4 }
  exit 5
}`;

function commandFor(
  platform: NodeJS.Platform,
  operation: 'load' | 'save' | 'delete',
  accountId: string,
  refreshToken?: string,
): YouTubeOAuthCredentialCommand {
  if (platform === 'darwin') {
    if (operation === 'load') {
      return {
        executable: '/usr/bin/security',
        args: ['find-generic-password', '-a', accountId, '-s', youtubeOAuthCredentialService, '-w'],
      };
    }
    if (operation === 'save') {
      return {
        executable: '/usr/bin/security',
        args: [
          'add-generic-password',
          '-a',
          accountId,
          '-s',
          youtubeOAuthCredentialService,
          '-U',
          '-w',
        ],
        stdin: `${refreshToken}\n`,
      };
    }
    return {
      executable: '/usr/bin/security',
      args: ['delete-generic-password', '-a', accountId, '-s', youtubeOAuthCredentialService],
    };
  }

  if (platform === 'linux') {
    if (operation === 'load') {
      return {
        executable: '/usr/bin/secret-tool',
        args: ['lookup', 'service', youtubeOAuthCredentialService, 'account', accountId],
      };
    }
    if (operation === 'save') {
      return {
        executable: '/usr/bin/secret-tool',
        args: [
          'store',
          `--label=OperatingLine YouTube OAuth (${accountId})`,
          'service',
          youtubeOAuthCredentialService,
          'account',
          accountId,
        ],
        stdin: `${refreshToken}\n`,
      };
    }
    return {
      executable: '/usr/bin/secret-tool',
      args: ['clear', 'service', youtubeOAuthCredentialService, 'account', accountId],
    };
  }

  if (platform === 'win32') {
    const script =
      operation === 'load'
        ? windowsLoadScript
        : operation === 'save'
          ? windowsSaveScript
          : windowsDeleteScript;
    return {
      executable: 'powershell.exe',
      args: [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64'),
      ],
      stdin: JSON.stringify({
        resource: youtubeOAuthCredentialService,
        account: accountId,
        ...(operation === 'save' ? { secret: refreshToken } : {}),
      }),
    };
  }

  throw new YouTubeOAuthCredentialStoreError('secure_backend_unavailable');
}

export function createDefaultYouTubeOAuthCredentialStore(
  options: {
    readonly platform?: NodeJS.Platform;
    readonly runner?: YouTubeOAuthCredentialCommandRunner;
  } = {},
): YouTubeOAuthCredentialStore {
  const platform = options.platform ?? process.platform;
  const runner = options.runner ?? defaultCommandRunner();

  async function run(
    operation: 'load' | 'save' | 'delete',
    accountId: string,
    refreshToken?: string,
  ): Promise<YouTubeOAuthCredentialCommandResult> {
    try {
      return await runner.run(commandFor(platform, operation, accountId, refreshToken));
    } catch (error) {
      if (error instanceof YouTubeOAuthCredentialStoreError) throw error;
      throw new YouTubeOAuthCredentialStoreError('secure_backend_unavailable');
    }
  }

  return {
    async loadRefreshToken(accountId) {
      validateAccountId(accountId);
      const result = await run('load', accountId);
      const notFoundExitCode =
        platform === 'darwin' ? 44 : platform === 'linux' ? 1 : windowsNotFoundExitCode;
      if (result.exitCode === notFoundExitCode) return null;
      if (result.exitCode !== 0) {
        throw new YouTubeOAuthCredentialStoreError('secure_backend_failed');
      }
      return normalizeLoadedToken(result.stdout);
    },

    async saveRefreshToken(accountId, refreshToken) {
      validateAccountId(accountId);
      validateRefreshToken(refreshToken);
      const result = await run('save', accountId, refreshToken);
      if (result.exitCode !== 0) {
        throw new YouTubeOAuthCredentialStoreError('secure_backend_failed');
      }
    },

    async deleteRefreshToken(accountId) {
      validateAccountId(accountId);
      const result = await run('delete', accountId);
      const notFoundExitCode =
        platform === 'darwin' ? 44 : platform === 'linux' ? 1 : windowsNotFoundExitCode;
      if (result.exitCode !== 0 && result.exitCode !== notFoundExitCode) {
        throw new YouTubeOAuthCredentialStoreError('secure_backend_failed');
      }
    },
  };
}
