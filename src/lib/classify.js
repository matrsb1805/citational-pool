// Classification pass: takes a channel transcript + reference list and
// extracts a structured list of brand mentions — brand, whether it was
// recommended or merely cited, the specific product named (if any), and the
// exact supporting quote. No target brand involved.
//
// v4: products is now an ARRAY per mention, not a single product_name/quote
// pair. Real feedback caught the gap: one AI answer commonly names several
// products from the same brand ("X is best overall, but their Y works
// better for Z") — the v3 single-product shape couldn't represent that.
// This is common, not an edge case — worth building for properly.
//
// v3 (superseded): extended from a flat recommended_brands/cited_brands
// pair to one `mentions` array per result, adding product_name and quote
// per mention — per Charles's Data Dependencies doc, needed for
// Essential's "product-level detail & exact phrasing" and the "generic
// win" lens. Captured for EVERY brand mentioned, including competitors —
// no extra cost to this since one classification pass already sees every
// brand. Whether a future API exposes competitor product-level detail is a
// serving-layer decision.
//
// This is still an LLM classification pass over free text, not the NLP
// claim-extraction pipeline described in the SDX:VibeEvidence work — spot
// check output against raw_response before trusting it at scale.

import 'dotenv/config';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const SYSTEM_PROMPT = `You extract which specific product/company brands are recommended or cited in an AI assistant's answer to a shopper question, including product-level detail when the answer names one.

Only consider brands that are discussed IN THE ANSWER TEXT ITSELF as a product or company the shopper could actually buy from — e.g. "CeraVe" or "Vanicream" being suggested as an option.

Do NOT extract a name just because it appears as the source/publisher of a cited link (e.g. "Healthline", "Nebraska Medicine", "Greenwood Pharmacy" showing up as where information was found, not as a product being recommended). A publication, hospital system, blog, or review site cited as an information source is never itself a brand for this purpose — even if it also happens to sell something — unless the answer text is actually recommending buying from them specifically.

Many correct answers will have NO brands at all — general educational answers (e.g. explaining a chemical, a category, a how-to) legitimately have empty lists. Don't force a brand into the output just because the transcript cites sources.

For each brand mention, extract:
- brand: the brand/company name, standard public capitalization (e.g. "CeraVe", "The Ordinary", "La Roche-Posay").
- mention_type: "recommended" (actively suggested as an answer to the shopper's question) or "cited" (discussed or compared, but not the actual recommendation). A brand should appear at most ONCE per mention_type — if the answer names several products from the same brand (e.g. "CeraVe Moisturizing Cream is best overall, but their SA Lotion works well for very dry skin"), that's still ONE mentions entry for CeraVe, with BOTH products listed in its products array — do not create two separate entries for the same brand.
- products: an array of {"name": "...", "quote": "..."} — one entry per SPECIFIC named product from this brand. Empty array [] if the answer only names the brand generically with no specific product. Most answers naming 2+ products from the same brand should produce 2+ entries in this array, not be collapsed to one.

Rules:
- Only include brands you're confident are real, purchasable product/company brands — never publishers, review sites, hospitals, or news outlets cited only as information sources.
- Respond with ONLY a JSON object: {"mentions": [{"brand": "...", "mention_type": "...", "products": [{"name": "...", "quote": "..."}]}, ...]}. No other text. An empty mentions array is correct and expected for many answers; an empty products array within a mention is correct when the brand is named without a specific product.`;

export async function classifyResult({ transcript, references }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  if (!transcript) {
    return { mentions: [] };
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
      max_tokens: 600,
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

  const mentions = Array.isArray(parsed.mentions) ? parsed.mentions : [];

  return {
    mentions: mentions
      .filter((m) => m && typeof m.brand === 'string' && ['recommended', 'cited'].includes(m.mention_type))
      .map((m) => ({
        brand: m.brand,
        mention_type: m.mention_type,
        products: Array.isArray(m.products)
          ? m.products
              .filter((p) => p && typeof p.name === 'string')
              .map((p) => ({ name: p.name, quote: typeof p.quote === 'string' ? p.quote : null }))
          : [],
      })),
  };
}

// The prompt asks for ONLY a JSON object with no other text, but models
// sometimes wrap valid JSON in markdown code fences anyway. Strip that
// wrapping rather than relying purely on instruction-following — a real
// failure was caught in production from exactly this.
function stripCodeFences(text) {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenceMatch ? fenceMatch[1].trim() : trimmed;
}
