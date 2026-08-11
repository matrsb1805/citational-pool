// Manual trigger — run locally or via `railway run` for smoke-testing
// without waiting for the cron schedule. Mirrors the old runPool.js
// DRY_RUN / MAX_QUERIES_PER_RUN semantics so the workflow is familiar:
//
//   npm run enqueue:dry                        # see what would be enqueued, touch nothing
//   MAX_QUERIES_PER_RUN=5 npm run enqueue       # enqueue a small capped batch for real
//   npm run enqueue                             # enqueue the full pool

import 'dotenv/config';
import { enqueuePoolRun } from '../lib/enqueuePoolRun.js';

const dryRun = process.env.DRY_RUN === 'true';
const maxQueries = Number(process.env.MAX_QUERIES_PER_RUN || 0);

const summary = await enqueuePoolRun({ dryRun, maxQueries });

console.log(JSON.stringify(summary, null, 2));

if (dryRun) {
  console.log(
    `\n[dry run] Would enqueue ${summary.totalJobs} jobs across ${summary.categories.length} categories. Nothing written.`
  );
} else {
  console.log(
    `\nEnqueued ${summary.totalJobs} jobs. Start the worker (\`npm run worker\`) to process them if it isn't already running.`
  );
}

process.exit(0);
