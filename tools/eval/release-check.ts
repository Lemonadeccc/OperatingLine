import { runEvalReleaseCheckCli } from './release-check-cli.js';

try {
  const result = await runEvalReleaseCheckCli(process.argv.slice(2));
  console.log(JSON.stringify(result, null, 2));
  if (!result.releaseEligible) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
