// Fetches real search volume for every active query and stores it in
// queries.search_volume. Deliberately NOT part of the worker's per-scan
// loop — re-run occasionally (e.g. monthly), not continuously.
//
//   railway ssh -s citational-pool -- npm run search-volume

import 'dotenv/config';
import { query, pool } from '../lib/db.js';
import { fetchSearchVolume } from '../lib/searchVolume.js';

// Google Ads API rejects certain punctuation outright, and a single bad
// keyword fails the entire batched request, not just that one keyword — a
// real failure was caught in production from exactly this.
const INVALID_CHARS = /[,!@%^(){}=;~`<>?\\|―·]/g;

function sanitizeForGoogleAds(text) {
  return text.replace(INVALID_CHARS, ' ').replace(/\s+/g, ' ').trim();
}

const { rows: queries } = await query(`select id, query_text from queries where active = true`);

console.log(`[search-volume] fetching real search volume for ${queries.length} queries...`);

const sanitizedByQueryId = new Map();
const keywordsToSend = [];
for (const q of queries) {
  const sanitized = sanitizeForGoogleAds(q.query_text);
  if (sanitized !== q.query_text) {
    console.log(`[search-volume] sanitized "${q.query_text}" -> "${sanitized}"`);
  }
  sanitizedByQueryId.set(q.id, sanitized);
  keywordsToSend.push(sanitized);
}

const volumes = await fetchSearchVolume(keywordsToSend);

let updated = 0;
let missing = 0;

for (const q of queries) {
  const sanitized = sanitizedByQueryId.get(q.id);
  const match = volumes[sanitized.toLowerCase()];
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
