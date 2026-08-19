// Persistent worker process (Railway service #1). Sits and drains the
// scan-jobs queue — this is the piece a cron-only model doesn't have: a
// process that's actually running between triggers, so retries and
// backpressure have somewhere to happen. Deploy as its own Railway service
// with `npm run worker` as the start command.

import { Worker } from 'bullmq';
import { connection, SCAN_QUEUE_NAME } from './lib/queue.js';
import { query } from './lib/db.js';
import { queryGoogleAiMode } from './lib/channels/googleAiMode.js';
import { queryChatGPT } from './lib/channels/chatgpt.js';
import { queryPerplexity } from './lib/channels/perplexity.js';
import { classifyResult } from './lib/classify.js';

const CHANNEL_FNS = {
  google_ai_mode: queryGoogleAiMode,
  chatgpt: queryChatGPT,
  perplexity: queryPerplexity,
};

async function processJob(job) {
  const { scanId, queryId, channel, queryText } = job.data;

  const channelFn = CHANNEL_FNS[channel];
  if (!channelFn) throw new Error(`Unknown channel: ${channel}`);

  let result;
  try {
    result = await channelFn(queryText);
  } catch (err) {
    // Let BullMQ's retry policy (see queue attach below) handle transient
    // channel failures — write nothing here, just rethrow so the job is
    // marked failed and retried per the job's attempts config.
    throw new Error(`[${channel}] channel call failed: ${err.message}`);
  }

  let classification = { mentions: [] };
  try {
    classification = await classifyResult({
      transcript: result.transcript,
      references: result.references,
    });
  } catch (err) {
    // Classification failure shouldn't lose the raw response — store it
    // with an empty mentions array and the error, so it can be
    // re-classified later without re-calling the (paid) channel API.
    await query(
      `insert into query_results
         (scan_id, query_id, channel, mentions, raw_response, cost_usd, error)
       values ($1, $2, $3, '[]', $4, $5, $6)`,
      [scanId, queryId, channel, result.raw_response, result.cost_usd, `classify: ${err.message}`]
    );
    return;
  }

  await query(
    `insert into query_results
       (scan_id, query_id, channel, mentions, raw_response, cost_usd)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      scanId,
      queryId,
      channel,
      JSON.stringify(classification.mentions),
      result.raw_response,
      result.cost_usd,
    ]
  );
}

const worker = new Worker(SCAN_QUEUE_NAME, processJob, {
  connection,
  concurrency: Number(process.env.WORKER_CONCURRENCY || 5),
});

worker.on('completed', (job) => {
  console.log(`[worker] completed ${job.id}`);
});

worker.on('failed', (job, err) => {
  console.error(`[worker] failed ${job?.id}: ${err.message}`);
});

console.log('[worker] listening for scan jobs...');
