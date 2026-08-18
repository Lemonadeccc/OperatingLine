import {
  createDefaultYouTubeOAuthCredentialStore,
  YouTubeOAuthCredentialStoreError,
} from './youtube-oauth-credential-store.js';
import { authorizeYouTubeOAuthInstalledApp } from './youtube-oauth-flow.js';
import {
  getYouTubeOAuthAuthorizationStatus,
  logoutYouTubeOAuth,
  YouTubeOAuthOperationError,
} from './youtube-oauth.js';

type YouTubeOAuthCommand = 'login' | 'logout' | 'status';

class YouTubeOAuthCliInputError extends Error {}

try {
  const command = parseCommand(process.argv.slice(2));
  const clientId = requiredClientId(process.env);
  const credentialStore = createDefaultYouTubeOAuthCredentialStore();
  if (command === 'login') {
    const result = await authorizeYouTubeOAuthInstalledApp({
      clientId,
      credentialStore,
      onAuthorizationUrl(authorizationUrl) {
        process.stdout.write(
          `Open this authorization URL if the browser does not open:\n${authorizationUrl}\n`,
        );
      },
    });
    writeJson(result);
  } else if (command === 'status') {
    writeJson(await getYouTubeOAuthAuthorizationStatus({ clientId, credentialStore }));
  } else {
    writeJson(await logoutYouTubeOAuth({ clientId, credentialStore }));
  }
} catch (error) {
  const message =
    error instanceof YouTubeOAuthCliInputError
      ? error.message
      : error instanceof YouTubeOAuthCredentialStoreError
        ? error.message
        : error instanceof YouTubeOAuthOperationError
          ? error.message
          : 'YouTube OAuth operation failed';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function parseCommand(args: readonly string[]): YouTubeOAuthCommand {
  if (args.length !== 1 || !['login', 'logout', 'status'].includes(args[0]!)) {
    throw new YouTubeOAuthCliInputError('Usage: pnpm youtube:auth login|status|logout');
  }
  return args[0] as YouTubeOAuthCommand;
}

function requiredClientId(environment: Readonly<Record<string, string | undefined>>): string {
  const clientId = environment['OPERATINGLINE_YOUTUBE_OAUTH_CLIENT_ID'];
  if (clientId === undefined || clientId === '') {
    throw new YouTubeOAuthCliInputError(
      'OPERATINGLINE_YOUTUBE_OAUTH_CLIENT_ID is required; configure a Google Desktop OAuth client',
    );
  }
  if (environment['OPERATINGLINE_YOUTUBE_OAUTH_ACCESS_TOKEN']) {
    throw new YouTubeOAuthCliInputError(
      'Unset OPERATINGLINE_YOUTUBE_OAUTH_ACCESS_TOKEN before using managed YouTube OAuth',
    );
  }
  return clientId;
}

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
