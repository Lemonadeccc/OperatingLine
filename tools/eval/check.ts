import { runEvalCheckCli } from './check-cli.js';

console.log(JSON.stringify(await runEvalCheckCli(process.argv.slice(2)), null, 2));
