// Channel: "ChatGPT"
//
// IMPORTANT CAVEAT — read before trusting this channel's numbers.
// There is no public API that queries the ChatGPT consumer product itself.
// This calls the OpenAI Chat Completions API as a proxy signal — same
// underlying model family, but not the same retrieval/browsing/citation
// behaviour a person sees in the ChatGPT app, which can pull in live web
// results and shopping data ChatGPT doesn't expose a plain chat-completion
// call to. Prior project research also flagged that ChatGPT's shopping
// results lean heavily on Google Shopping data — meaning GMC feed work may
// matter more for real ChatGPT visibility than anything this channel can
// directly observe. Treat this channel's state/competitor_brand output as
// directional, not a confirmed measure of ChatGPT-the-product's behaviour,
// until validated against real usage.
//
// STATUS: UNVERIFIED — not run against a live OpenAI key in this build
// session.

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
    references: [], // chat completions responses don't carry a citation list
    cost_usd: null, // compute from data.usage + your OpenAI pricing if needed
  };
}
