// Scheduler process (Railway service #2). Runs two independent cron jobs:
// the pool-run trigger, and a health check that watches for things
// Railway's own alerting can't see (silent runtime crashes, error-rate
// spikes) — see src/lib/healthCheck.js for why this exists.

import cron from 'node-cron';
import 'dotenv/config';
import { enqueuePoolRun } from './lib/enqueuePoolRun.js';
import { runHealthCheck } from './lib/healthCheck.js';
import { sendAlertEmail } from './lib/email.js';

const cronExpr = process.env.POOL_CRON || '0 6 * * 1'; // default: Mondays 06:00 UTC
const healthCheckCronExpr = process.env.HEALTH_CHECK_CRON || '0 */6 * * *'; // every 6 hours

console.log(`[scheduler] pool run scheduled: "${cronExpr}" (UTC)`);
console.log(`[scheduler] health check scheduled: "${healthCheckCronExpr}" (UTC)`);

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

cron.schedule(
  healthCheckCronExpr,
  async () => {
    console.log('[scheduler] running health check...');
    try {
      const issues = await runHealthCheck();
      if (issues.length > 0) {
        console.warn('[scheduler] health check found issues:', issues);
        await sendAlertEmail('CitationalAI pool: health check found an issue', issues.join('\n\n'));
      } else {
        console.log('[scheduler] health check: no issues found.');
      }
    } catch (err) {
      // If the health check itself blows up, still try to say so — best
      // effort, wrapped so a failed alert-send can't crash the scheduler.
      console.error('[scheduler] health check itself failed:', err);
      await sendAlertEmail(
        'CitationalAI pool: health check script failed',
        `The health check itself threw an error:\n\n${err.message}\n\n${err.stack || ''}`
      ).catch(() => {});
    }
  },
  { timezone: 'UTC' }
);
