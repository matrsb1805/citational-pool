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
// STATUS: revised after a real test caught the classifier confusing cited
// source publishers (e.g. a hospital's blog) with actual product brands,
// and again after a real failure caught the model wrapping valid JSON in
// markdown code fences despite being told not to. Spot-checked against a
// handful of real transcripts as of this revision — worth checking more,
// especially educational/non-commercial answers, before trusting this at
// volume.

import 'dotenv/config';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const SYSTEM_PROMPT = `You extract which specific product/company brands are recommended or cited in an AI assistant's answer to a shopper question.

Only consider brands that are discussed IN THE ANSWER TEXT ITSELF as a product or company the shopper could actually buy from — e.g. "CeraVe" or "Vanicream" being suggested as an option.

Do NOT extract a name just because it appears as the source/publisher of a cited link (e.g. "Healthline", "Nebraska Medicine", "Greenwood Pharmacy" showing up as where information was found, not as a product being recommended). A publication, hospital system, blog, or review site cited as an information source is never itself a brand for this purpose — even if it also happens to sell something — unless the answer text is actually recommending buying from them specifically.

Many correct answers will have NO brands at all — general educational answers (e.g. explaining a chemical, a category, a how-to) legitimately have empty lists. Don't force a brand into the output just because the transcript cites sources.

Rules:
- recommended_brands: brand names the assistant is actively suggesting/endorsing as an answer to the shopper's question.
- cited_brands: brand names discussed or compared in the answer, but not actively recommended.
- A brand should never appear in both lists.
- Only include brands you're confident are real, purchasable product/company brands — never publishers, review sites, hospitals, or news outlets cited only as information sources.
- Brand names only, never specific product names (e.g. "CeraVe", not "CeraVe Moisturizing Cream").
- Use the brand's standard public name and capitalization (e.g. "CeraVe", "The Ordinary", "La Roche-Posay").
- Respond with ONLY a JSON object: {"recommended_brands": [...], "cited_brands": [...]}. No other text. Empty arrays are correct and expected for many answers.`;

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
    'Assistant transcript (this is the primary text to analyze):',
    transcript,
    referencesBlock
      ? `\nCited source links (these are where the assistant found its information — do NOT treat these domains/publishers as brands unless that same name is also substantively discussed as a product/company in the transcript above):\n${referencesBlock}`
      : '',
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
    parsed = JSON.parse(stripCodeFences(text));
  } catch {
    throw new Error(`classify.js: could not parse model output as JSON: ${text}`);
  }

  return {
    recommended_brands: Array.isArray(parsed.recommended_brands) ? parsed.recommended_brands : [],
    cited_brands: Array.isArray(parsed.cited_brands) ? parsed.cited_brands : [],
  };
}

// The prompt asks for ONLY a JSON object with no other text, but models
// sometimes wrap valid JSON in markdown code fences anyway
// (```json {...} ``` instead of just {...}). Strip that wrapping rather
// than relying purely on instruction-following — a real failure was caught
// in production from exactly this.
function stripCodeFences(text) {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenceMatch ? fenceMatch[1].trim() : trimmed;
}
