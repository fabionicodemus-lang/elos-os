import { runHomologation } from './runner.mjs';

const phase = process.argv[2] || 'smoke';
const report = await runHomologation({ phase });
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.failed > 0 ? 1 : 0;
