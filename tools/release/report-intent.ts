import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

interface ChangesetStatus {
  readonly releases: readonly unknown[];
}

function readStatus(value: unknown): ChangesetStatus {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('releases' in value) ||
    !Array.isArray(value.releases)
  ) {
    throw new Error('Changesets status must contain a releases array');
  }
  return { releases: value.releases };
}

const statusPath = process.argv[2];
if (statusPath === undefined) {
  throw new Error('Usage: report-intent <changeset-status.json>');
}

const outputPath = process.env.GITHUB_OUTPUT;
if (outputPath === undefined || outputPath.length === 0) {
  throw new Error('GITHUB_OUTPUT is required');
}

const status = readStatus(JSON.parse(await readFile(resolve(statusPath), 'utf8')) as unknown);
const hasReleaseEntries = status.releases.length > 0;
await appendFile(outputPath, `has-release-entries=${String(hasReleaseEntries)}\n`, 'utf8');
process.stdout.write(
  hasReleaseEntries
    ? `Detected ${String(status.releases.length)} release entries.\n`
    : 'No non-empty release entries detected; the version action will be skipped.\n',
);
