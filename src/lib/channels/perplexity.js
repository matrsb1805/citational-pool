// Channel: Perplexity, via the Perplexity API (sonar models). The API
// models genuinely browse and return a citations list, the same mechanism
// the consumer product uses.
//
// cost_usd: FIXED — this was hardcoded to null in earlier versions, but
// Perplexity's response actually includes a real dollar cost at
// usage.cost.total_cost. Caught because a cost-sizing query showed data
// only for google_ai_mode (whose cost is real DataForSEO-reported data) and
// nothing for perplexity or chatgpt — turned out perplexity's real number
// was sitting right there in the response the whole time, just never read.

import 'dotenv/config';

const PERPLEXITY_URL = 'https://api.perplexity.ai/chat/completions';

export async function queryPerplexity(queryText) {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) throw new Error('PERPLEXITY_API_KEY not set');

  const res = await fetch(PERPLEXITY_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.PERPLEXITY_MODEL || 'sonar',
      messages: [{ role: 'user', content: queryText }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Perplexity ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  const transcript = data?.choices?.[0]?.message?.content || null;
  const citations = data?.citations || [];

  return {
    channel: 'perplexity',
    raw_response: data,
    transcript,
    references: citations.map((url) => ({ url, domain: safeDomain(url), title: null })),
    cost_usd: data?.usage?.cost?.total_cost ?? null,
  };
}

function safeDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}
