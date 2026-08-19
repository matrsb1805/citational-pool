// Channel: Google AI Mode, via DataForSEO's serp/google/ai_mode/live/advanced
// endpoint. AI Mode returns a generated summary plus a references array of
// cited domains — this is what "was this brand recommended/cited" needs.
// Google Shopping API returns product listings, not endorsement language.
//
// task.cost is DataForSEO's own reported dollar cost for this specific
// call — a real figure, not estimated.

import 'dotenv/config';
import { dataforseoAuthHeader } from '../dataforseoAuth.js';

const DATAFORSEO_BASE = 'https://api.dataforseo.com/v3';

export async function queryGoogleAiMode(queryText) {
  const payload = [
    {
      keyword: queryText,
      location_name: process.env.DATAFORSEO_LOCATION_NAME || 'United States',
      language_name: process.env.DATAFORSEO_LANGUAGE_NAME || 'English',
      device: process.env.DATAFORSEO_DEVICE || 'desktop',
      os: process.env.DATAFORSEO_OS || 'windows',
    },
  ];

  const res = await fetch(`${DATAFORSEO_BASE}/serp/google/ai_mode/live/advanced`, {
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

  const items = task?.result?.[0]?.items || [];
  const aiItem = items.find((i) => i.type === 'ai_mode_result' || i.type === 'ai_overview');

  return {
    channel: 'google_ai_mode',
    raw_response: data,
    transcript: aiItem?.markdown || aiItem?.text || null,
    references: (aiItem?.references || []).map((r) => ({
      domain: r.domain || r.source_domain || null,
      title: r.title || null,
      url: r.url || null,
    })),
    cost_usd: task?.cost ?? null,
  };
}
