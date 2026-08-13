import { resolve } from 'node:path';

import { HumanEvalCollectionStatusWorkspace } from './collection-status-workspace.js';
import { startEvalCollectionStatusServer } from './http-server.js';

interface CliOptions {
  readonly datasetDirectory: string;
  readonly port: number;
  readonly repositoryRoot: string;
}

function parseOptions(arguments_: readonly string[]): CliOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (name === undefined || value === undefined || !name.startsWith('--')) {
      throw new Error('Eval status arguments must use --name value pairs');
    }
    if (values.has(name)) throw new Error(`Duplicate Eval status argument ${name}`);
    values.set(name, value);
  }
  const allowed = new Set(['--dataset', '--port', '--repo-root']);
  for (const name of values.keys()) {
    if (!allowed.has(name)) throw new Error(`Unknown Eval status argument ${name}`);
  }
  const datasetDirectory = values.get('--dataset')?.trim();
  if (!datasetDirectory) throw new Error('Missing required Eval status argument --dataset');
  const portInput = values.get('--port') ?? '0';
  if (!/^\d+$/.test(portInput)) throw new Error('--port must be an integer from 0 to 65535');
  const port = Number(portInput);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error('--port must be an integer from 0 to 65535');
  }
  return {
    datasetDirectory: resolve(datasetDirectory),
    port,
    repositoryRoot: resolve(values.get('--repo-root')?.trim() || '.'),
  };
}

const options = parseOptions(process.argv.slice(2));
const workspace = await HumanEvalCollectionStatusWorkspace.open({
  datasetDirectory: options.datasetDirectory,
  artifactOptions: { artifactRoots: { repo: options.repositoryRoot } },
});
const server = await startEvalCollectionStatusServer({ workspace, port: options.port });

console.log(
  JSON.stringify(
    {
      ready: true,
      role: server.role,
      statusUrl: server.statusUrl,
      providerCredentialsRequired: false,
      providerCallsEnabled: false,
    },
    null,
    2,
  ),
);

let stopping: Promise<void> | undefined;
const stop = (): Promise<void> => {
  stopping ??= server.stop();
  return stopping;
};
process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
