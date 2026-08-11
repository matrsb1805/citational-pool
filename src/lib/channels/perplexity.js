// Channel: Perplexity, via the Perplexity API (sonar models).
// Unlike the ChatGPT channel, this one is a reasonably direct analog to the
// consumer product — Perplexity's API models genuinely browse and return a
// citations list, which is the same mechanism the chat product uses.
//
// STATUS: UNVERIFIED — not run against a live Perplexity key in this build
// session; response shape below follows current public API docs
// (docs.perplexity.ai) but hasn't been confirmed live.

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
    cost_usd: null,
  };
}

function safeDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}
