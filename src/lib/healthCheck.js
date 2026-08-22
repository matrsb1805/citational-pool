// What Railway's own alerting can't see: (1) the worker/scheduler process
// silently dying or hanging AFTER a successful deploy — Railway only
// alerts on deploy-time failures, confirmed via its own community/docs, so
// a crash hours into an unattended run produces zero notification; (2) an
// elevated rate of application-level errors (classification failures,
// channel errors) — these are caught and stored per-row in
// query_results.error already, but nobody's watching the aggregate rate.
//
// Deliberately returns a list of ISSUES rather than alerting itself — the
// caller (scheduler.js) decides what to do with them, keeping this
// testable in isolation without needing real email credentials.

import { query } from './db.js';

const HEARTBEAT_WINDOW_HOURS = 30; // > the 24h scheduler cadence, so one
// missed run doesn't false-positive, but two in a row would.
const ERROR_RATE_WINDOW_HOURS = 24;
const ERROR_RATE_THRESHOLD = 0.2; // 20% — well above normal transient
// rate-limit retries, which usually succeed on retry and don't end up as
// a stored error at all.

export async function runHealthCheck() {
  const issues = [];

  const { rows: heartbeatRows } = await query(
    `select count(*) as count from query_results where fetched_at > now() - interval '${HEARTBEAT_WINDOW_HOURS} hours'`
  );
  const recentCount = Number(heartbeatRows[0].count);
  if (recentCount === 0) {
    issues.push(
      `No query_results written in the last ${HEARTBEAT_WINDOW_HOURS} hours — the worker or scheduler may not be running. ` +
        `(Sanity check before treating this as urgent: is this expected right now — e.g. right after a fresh deploy with no data yet, or a deliberate pause?)`
    );
  }

  const { rows: errorRows } = await query(
    `select
       count(*) filter (where error is not null) as errored,
       count(*) as total
     from query_results
     where fetched_at > now() - interval '${ERROR_RATE_WINDOW_HOURS} hours'`
  );
  const errored = Number(errorRows[0].errored);
  const total = Number(errorRows[0].total);
  if (total > 0) {
    const errorRate = errored / total;
    if (errorRate > ERROR_RATE_THRESHOLD) {
      issues.push(
        `${errored} of ${total} results in the last ${ERROR_RATE_WINDOW_HOURS} hours had errors ` +
          `(${Math.round(errorRate * 100)}%, threshold is ${Math.round(ERROR_RATE_THRESHOLD * 100)}%) — worth checking the logs.`
      );
    }
  }

  return issues;
}
