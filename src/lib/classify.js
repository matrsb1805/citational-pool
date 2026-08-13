// Classification pass: takes a channel transcript + reference list and
// extracts which brands the AI's answer actually recommended vs. merely
// mentioned/cited — with NO target brand involved. Earlier versions of this
// file compared against a single "target brand," which only makes sense
// once a specific merchant exists (Phase 2). In Phase 1's shared pool,
// there is no merchant yet, so forcing a target brand meant silently
// defaulting to whichever brand happened to be listed first in
// brands.json — which produced a real, confusing bug (see commit history /
// README). Extracting the raw fact — which brands were recommended, which
// were cited — instead of a single-brand comparison is also a *stronger*
// version of the shared-pool cost story: "was CeraVe recommended" becomes a
// free lookup against already-stored data for any brand, anytime, rather
// than something that has to be decided again per merchant.
//
// This is still an LLM classification pass over free text, not the NLP
// claim-extraction pipeline described in the SDX:VibeEvidence work — spot
// check output against raw_response before trusting it at scale.
//
// STATUS: prompt has been checked against exactly one real transcript so
// far (see project history) — worth spot-checking a handful more before
// trusting this at any volume.

import 'dotenv/config';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const SYSTEM_PROMPT = `You extract which specific product brands are recommended or cited in an AI assistant's answer to a shopper question.

Rules:
- recommended_brands: real company/brand names the assistant is actively suggesting or endorsing as an answer to the question. Brand names only, never product names (e.g. "CeraVe", not "CeraVe Moisturizing Cream").
- cited_brands: brand names that appear in the answer (e.g. in a comparison, a source link, a passing mention) but are NOT being actively recommended. A brand should never appear in both lists — if it's recommended, it only belongs in recommended_brands.
- Only include brands you're confident are real companies. Do not invent one.
- Use the brand's standard public name and capitalization (e.g. "CeraVe", "The Ordinary", "La Roche-Posay").
- Respond with ONLY a JSON object: {"recommended_brands": [...], "cited_brands": [...]}. No other text. Empty arrays are correct when no brands appear.`;

export async function classifyResult({ transcript, references }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  if (!transcript) {
    return { recommended_brands: [], cited_brands: [] };
  }

  const referencesBlock = (references || [])
    .map((r) => `- ${r.domain || r.url || ''}${r.title ? ` (${r.title})` : ''}`)
    .join('\n');

  const userMessage = [
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
      max_tokens: 300,
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

  return {
    recommended_brands: Array.isArray(parsed.recommended_brands) ? parsed.recommended_brands : [],
    cited_brands: Array.isArray(parsed.cited_brands) ? parsed.cited_brands : [],
  };
}
