import { query } from './db.js';
import { scanQueue, scanJobId } from './queue.js';
import { createPoolScan } from './scans.js';

const CHANNELS = ['chatgpt', 'google_ai_mode', 'perplexity'];

export async function enqueuePoolRun({ dryRun = false, maxQueries = 0 } = {}) {
  const { rows: categories } = await query(
    `select id, slug, name from categories where active = true order by slug`
  );

  const summary = [];
  let totalJobs = 0;

  for (const category of categories) {
    const { rows: queries } = await query(
      `select q.id, q.query_text
       from queries q
       join subcategories sc on sc.id = q.subcategory_id
       where sc.category_id = $1 and q.active = true
       order by q.created_at`,
      [category.id]
    );

    const capped = maxQueries > 0 ? queries.slice(0, maxQueries) : queries;

    if (dryRun) {
      summary.push({
        category: category.slug,
        queries: capped.length,
        jobs: capped.length * CHANNELS.length,
      });
      totalJobs += capped.length * CHANNELS.length;
      continue;
    }

    if (capped.length === 0) continue;

    const scanId = await createPoolScan(category.id);

    for (const q of capped) {
      for (const channel of CHANNELS) {
        await scanQueue.add(
          'scan',
          { scanId, queryId: q.id, channel, queryText: q.query_text },
          {
            jobId: scanJobId({ scanId, queryId: q.id, channel }),
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: 500,
            removeOnFail: 1000,
          }
        );
        totalJobs += 1;
      }
    }

    summary.push({ category: category.slug, scanId, queries: capped.length, jobs: capped.length * CHANNELS.length });
  }

  return { dryRun, totalJobs, categories: summary };
}
