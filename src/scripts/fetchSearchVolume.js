// Fetches real search volume for every active query and stores it in
// queries.search_volume. This is deliberately NOT part of the worker's
// per-scan loop — search volume doesn't meaningfully change scan-to-scan
// (unlike AI answers, which are worth re-checking often), so this is meant
// to be re-run occasionally (e.g. monthly), not continuously. Running it
// unnecessarily costs real money for no new information.
//
//   railway ssh -s citational-pool -- npm run search-volume

import 'dotenv/config';
import { query, pool } from '../lib/db.js';
import { fetchSearchVolume } from '../lib/searchVolume.js';

const { rows: queries } = await query(`select id, query_text from queries where active = true`);

console.log(`[search-volume] fetching real search volume for ${queries.length} queries...`);

const keywords = queries.map((q) => q.query_text);
const volumes = await fetchSearchVolume(keywords);

let updated = 0;
let missing = 0;

for (const q of queries) {
  const match = volumes[q.query_text];
  if (!match || match.search_volume == null) {
    missing += 1;
    console.log(`[search-volume] no data for: "${q.query_text}"`);
    continue;
  }
  await query(`update queries set search_volume = $2 where id = $1`, [q.id, match.search_volume]);
  updated += 1;
}

console.log(`[search-volume] updated ${updated} queries, ${missing} had no data returned.`);

await pool.end();
