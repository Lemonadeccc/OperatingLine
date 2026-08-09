import { resolve } from 'node:path';

import { HumanEvalReviewWorkspace } from './review-workspace.js';
import { startEvalReviewServer } from './http-server.js';

interface CliOptions {
  readonly datasetDirectory: string;
  readonly pseudonym: string;
  readonly role: 'reviewer' | 'adjudicator';
  readonly qualificationId: string;
  readonly calibrationVersion: string;
  readonly locale: string;
  readonly port: number;
  readonly repositoryRoot: string;
}

function parseOptions(arguments_: readonly string[]): CliOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (name === undefined || value === undefined || !name.startsWith('--')) {
      throw new Error('Eval review arguments must use --name value pairs');
    }
    if (values.has(name)) throw new Error(`Duplicate Eval review argument ${name}`);
    values.set(name, value);
  }
  const allowed = new Set([
    '--dataset',
    '--reviewer',
    '--adjudicator',
    '--qualification',
    '--calibration',
    '--locale',
    '--port',
    '--repo-root',
  ]);
  for (const name of values.keys()) {
    if (!allowed.has(name)) throw new Error(`Unknown Eval review argument ${name}`);
  }
  const required = (name: string): string => {
    const value = values.get(name)?.trim();
    if (!value) throw new Error(`Missing required Eval review argument ${name}`);
    return value;
  };
  const reviewer = values.get('--reviewer')?.trim();
  const adjudicator = values.get('--adjudicator')?.trim();
  if (
    (reviewer === undefined || reviewer === '') ===
    (adjudicator === undefined || adjudicator === '')
  ) {
    throw new Error('Specify exactly one of --reviewer or --adjudicator');
  }
  const portInput = values.get('--port') ?? '0';
  if (!/^\d+$/.test(portInput)) throw new Error('--port must be an integer from 0 to 65535');
  const port = Number(portInput);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error('--port must be an integer from 0 to 65535');
  }
  return {
    datasetDirectory: resolve(required('--dataset')),
    pseudonym: reviewer || adjudicator!,
    role: reviewer ? 'reviewer' : 'adjudicator',
    qualificationId: required('--qualification'),
    calibrationVersion: required('--calibration'),
    locale: required('--locale'),
    port,
    repositoryRoot: resolve(values.get('--repo-root')?.trim() || '.'),
  };
}

const options = parseOptions(process.argv.slice(2));
const workspace = await HumanEvalReviewWorkspace.open({
  datasetDirectory: options.datasetDirectory,
  artifactOptions: { artifactRoots: { repo: options.repositoryRoot } },
});
const server = await startEvalReviewServer({
  workspace,
  session: {
    pseudonym: options.pseudonym,
    role: options.role,
    qualificationId: options.qualificationId,
    calibrationVersion: options.calibrationVersion,
    locale: options.locale,
  },
  port: options.port,
});

console.log(
  JSON.stringify(
    {
      ready: true,
      role: server.role,
      reviewUrl: server.reviewUrl,
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
