// Scheduler process (Railway service #2). Deliberately thin: all it does is
// enqueue jobs on a cron tick. The actual channel calls + classification
// happen in worker.js. Keeping these as separate processes/services means
// the scheduler stays simple and the worker can scale independently.
// Deploy with `npm run scheduler` as the start command.

import cron from 'node-cron';
import 'dotenv/config';
import { enqueuePoolRun } from './lib/enqueuePoolRun.js';

const cronExpr = process.env.POOL_CRON || '0 6 * * 1'; // default: Mondays 06:00 UTC

console.log(`[scheduler] pool run scheduled: "${cronExpr}" (UTC)`);

cron.schedule(
  cronExpr,
  async () => {
    console.log('[scheduler] triggering pool run...');
    try {
      const summary = await enqueuePoolRun({
        dryRun: process.env.DRY_RUN === 'true',
        maxQueries: Number(process.env.MAX_QUERIES_PER_RUN || 0),
      });
      console.log('[scheduler] enqueued:', JSON.stringify(summary, null, 2));
    } catch (err) {
      console.error('[scheduler] pool run failed to enqueue:', err);
    }
  },
  { timezone: 'UTC' }
);

// NOTE — Phase 2: once real merchants/subscriptions exist, Free (weekly)
// vs Essential (daily) cadence per Summary doc Section 3 will need per-shop
// scheduling, not one pool-wide cron. POOL_CRON as a single env var is a
// Phase 1 simplification — expect to replace this file's single schedule
// with a per-plan schedule (or a DB-driven schedule table) at that point.
