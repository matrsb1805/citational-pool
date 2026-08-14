// Fetches real search volume for a batch of keywords via DataForSEO's
// Keyword Data API — a different DataForSEO product from the AI Mode
// endpoint used elsewhere in this project. AI Mode answers a question; this
// endpoint reports how often people actually type it into Google (via the
// Google Ads keyword planner data source).
//
// Up to 1000 keywords per request — the whole Phase 1 query pool (~60
// queries) fits in a single call, so this doesn't need batching yet. If the
// pool grows past 1000 active queries, this function will need to chunk
// requests — it deliberately throws rather than silently truncating if that
// limit is hit, so that failure is loud rather than quietly wrong.
//
// STATUS: UNVERIFIED — not run against a live account in this build
// session. Response field names follow current DataForSEO documentation;
// confirm against a real response the first time this runs (see
// src/scripts/fetchSearchVolume.js).

import 'dotenv/config';
import { dataforseoAuthHeader } from './dataforseoAuth.js';

const DATAFORSEO_BASE = 'https://api.dataforseo.com/v3';

export async function fetchSearchVolume(keywords) {
  if (keywords.length === 0) return {};
  if (keywords.length > 1000) {
    throw new Error(
      `fetchSearchVolume: ${keywords.length} keywords exceeds DataForSEO's 1000-per-request limit — this function needs batching before the pool grows this large.`
    );
  }

  const payload = [
    {
      keywords,
      location_name: process.env.DATAFORSEO_LOCATION_NAME || 'United States',
      language_name: process.env.DATAFORSEO_LANGUAGE_NAME || 'English',
    },
  ];

  const res = await fetch(`${DATAFORSEO_BASE}/keywords_data/google_ads/search_volume/live`, {
    method: 'POST',
    headers: {
      Authorization: dataforseoAuthHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`DataForSEO ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  const task = data?.tasks?.[0];
  if (task?.status_code && task.status_code !== 20000) {
    throw new Error(`DataForSEO task error ${task.status_code}: ${task.status_message}`);
  }

  const results = task?.result || [];
  const byKeyword = {};
  for (const r of results) {
    // DataForSEO may return null for keywords with no measurable volume —
    // that's a real "less than the platform can detect" answer, not a
    // failure, so it's kept as null rather than defaulted to 0.
    byKeyword[r.keyword] = {
      search_volume: r.search_volume ?? null,
      competition: r.competition ?? null,
      cpc: r.cpc ?? null,
    };
  }
  return byKeyword;
}
