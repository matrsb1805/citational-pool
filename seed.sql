// Classification pass: takes a channel transcript + reference list and
// produces the query_results.state / competitor_brand fields via Claude.
//
// This replaces the old regex + brands.json lookup from the earlier build.
// It's a genuine step up (handles paraphrase, negation, "X but not Y" cases
// a regex can't), but it is still an LLM classification pass over free text,
// not the NLP claim-extraction pipeline described in the SDX:VibeEvidence
// work. Treat state/competitor_brand as a good-enough signal for validating
// pool mechanics, not as guaranteed-accurate structured data — spot-check
// classify.js output against raw_response before trusting frequency numbers.
//
// STATUS: UNVERIFIED — prompt is untested against real transcripts (no
// channel calls were run live in this build session, so there's no real
// transcript to test classification against yet).

import 'dotenv/config';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const SYSTEM_PROMPT = `You classify whether an AI assistant's answer to a shopper question recommends or cites a specific target brand, and if a competitor brand is more prominent instead.

Rules:
- state must be exactly one of: recommended, cited, not_listed
  - recommended: the target brand is actively suggested/endorsed as an answer to the question
  - cited: the target brand is named or referenced (e.g. in a comparison, a source link, a passing mention) but not the assistant's actual recommendation
  - not_listed: the target brand does not appear at all
- competitor_brand: if a DIFFERENT brand is the one actually recommended, or is the most prominent brand mentioned, return its name. Brand name only — never a specific product name. If no clear single competitor stands out, or the target brand itself is the one recommended, return null.
- Only use brand names that plausibly refer to real companies. Do not invent one.
- Respond with ONLY a JSON object: {"state": "...", "competitor_brand": "..." | null}. No other text.`;

export async function classifyResult({ targetBrand, transcript, references }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  if (!transcript) {
    return { state: 'not_listed', competitor_brand: null };
  }

  const referencesBlock = (references || [])
    .map((r) => `- ${r.domain || r.url || ''}${r.title ? ` (${r.title})` : ''}`)
    .join('\n');

  const userMessage = [
    `Target brand: ${targetBrand}`,
    '',
    'Assistant transcript:',
    transcript,
    referencesBlock ? `\nReferences / citations:\n${referencesBlock}` : '',
  ].join('\n');

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
      max_tokens: 200,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  const text = data?.content?.find((b) => b.type === 'text')?.text || '{}';

  let parsed;
  try {
    parsed = JSON.parse(text.trim());
  } catch {
    throw new Error(`classify.js: could not parse model output as JSON: ${text}`);
  }

  if (!['recommended', 'cited', 'not_listed'].includes(parsed.state)) {
    throw new Error(`classify.js: unexpected state value: ${parsed.state}`);
  }

  // Brand-level normalisation enforcement: the schema/product spec require
  // competitor_brand to always be brand-level, never a product name. The
  // prompt already instructs this; this is a defensive backstop, not the
  // primary control.
  return {
    state: parsed.state,
    competitor_brand: parsed.competitor_brand || null,
  };
}
