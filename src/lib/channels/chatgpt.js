// Channel: "ChatGPT"
//
// IMPORTANT CAVEAT — read before trusting this channel's numbers.
// There is no public API that queries the ChatGPT consumer product itself.
// This calls the OpenAI Chat Completions API as a proxy signal — same
// underlying model family, but not the same retrieval/browsing/citation
// behaviour a person sees in the ChatGPT app. Treat this channel's mention
// output as directional, not a confirmed measure of ChatGPT-the-product's
// behaviour, until validated against real usage.
//
// COST: cost_usd is deliberately left null here, unlike the other two
// channels. OpenAI's Chat Completions API does not return a dollar cost —
// only token counts (preserved in full in raw_response.usage). Computing a
// dollar figure requires hardcoding a specific per-model rate, and as of
// this writing (Aug 2026) published OpenAI pricing is genuinely
// inconsistent across sources for the model in use here — some report
// materially different rates for the same model name. Storing a guessed
// number would silently mislead the cost-sizing work this feeds into.
// Compute this downstream once a specific, confirmed rate is chosen and
// verified against an actual OpenAI billing statement — don't trust a
// constant hardcoded here without that verification.

import 'dotenv/config';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

export async function queryChatGPT(queryText) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: queryText,
        },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  const transcript = data?.choices?.[0]?.message?.content || null;

  return {
    channel: 'chatgpt',
    raw_response: data,
    transcript,
    references: [],
    cost_usd: null, // see comment above — token counts are in raw_response.usage
  };
}
