import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import 'dotenv/config';

// Redis backs the BullMQ job queue for the scan pipeline — not used as a
// cache. This is the piece a pure cron model (the earlier Supabase/GitHub
// Actions build) had no natural home for: retries on failed channel calls,
// backpressure as merchant volume grows, and visibility into what's
// mid-flight. See README "Why Railway" for the full rationale — confirmed
// architecture, not provisional.

if (!process.env.REDIS_URL) {
  console.warn(
    '[queue] REDIS_URL not set — fine for `npm run enqueue:dry`, ' +
      'required for the worker/scheduler to actually run jobs.'
  );
}

export const connection = new IORedis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null, // required by BullMQ
});

export const SCAN_QUEUE_NAME = 'scan-jobs';

export const scanQueue = new Queue(SCAN_QUEUE_NAME, { connection });

export function scanJobId({ scanId, queryId, channel }) {
  return `${scanId}:${queryId}:${channel}`;
}
