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
//
// v5: switched from "ask the model to write JSON as text" to Claude's
// structured tool-calling. Real failure caught in production: a transcript
// containing a nested quoted word (the AI's own answer said Choosing a
// "micronized" version...) produced text with unescaped inner quotes when
// the model tried to reproduce it verbatim inside a JSON string — broke
// JSON.parse. That's a genuinely different failure mode from the earlier
// markdown-fence issue, and neither is fully fixable by patching text
// parsing after the fact — there's no reliable way to regex-repair
// arbitrary broken quoting. Tool-calling avoids the whole category: the
// API returns the extracted data as an already-parsed object (input on
// the tool_use block), never as text we have to JSON.parse ourselves, so
// there's nothing for the model to malform in transit.
//
// STATUS: not yet run against a live transcript since this rewrite — spot
// check the next real batch the same way every revision of this file has
// been checked.

import 'dotenv/config';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const SYSTEM_PROMPT = `You extract which specific product/company brands are recommended or cited in an AI assistant's answer to a shopper question, including product-level detail when the answer names one.

Only consider brands that are discussed IN THE ANSWER TEXT ITSELF as a product or company the shopper could actually buy from — e.g. "CeraVe" or "Vanicream" being suggested as an option.

Do NOT extract a name just because it appears as the source/publisher of a cited link (e.g. "Healthline", "Nebraska Medicine", "Greenwood Pharmacy" showing up as where information was found, not as a product being recommended). A publication, hospital system, blog, or review site cited as an information source is never itself a brand for this purpose — even if it also happens to sell something — unless the answer text is actually recommending buying from them specifically.

Many correct answers will have NO brands at all — general educational answers (e.g. explaining a chemical, a category, a how-to) legitimately have empty lists. Don't force a brand into the output just because the transcript cites sources.

For each brand mention:
- brand: the brand/company name, standard public capitalization (e.g. "CeraVe", "The Ordinary", "La Roche-Posay").
- mention_type: "recommended" (actively suggested as an answer to the shopper's question) or "cited" (discussed or compared, but not the actual recommendation). A brand should appear at most ONCE per mention_type — if the answer names several products from the same brand, that's still ONE mentions entry for that brand, with ALL of its products listed together — do not create two separate entries for the same brand.
- products: one entry per SPECIFIC named product from this brand. Empty array if the answer only names the brand generically with no specific product. Most answers naming 2+ products from the same brand should produce 2+ entries, not be collapsed to one.

Only include brands you're confident are real, purchasable product/company brands — never publishers, review sites, hospitals, or news outlets cited only as information sources. An empty mentions list is correct and expected for many answers; an empty products array within a mention is correct when the brand is named without a specific product.

Call the extract_mentions tool with your findings.`;

const EXTRACT_MENTIONS_TOOL = {
  name: 'extract_mentions',
  description: 'Record which brands were recommended or cited in the transcript, with any specific products named.',
  input_schema: {
    type: 'object',
    properties: {
      mentions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            brand: { type: 'string', description: 'Brand/company name, standard public capitalization.' },
            mention_type: { type: 'string', enum: ['recommended', 'cited'] },
            products: {
              type: 'array',
              description: 'Specific named products from this brand. Empty if only the brand was named generically.',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  quote: { type: 'string', description: 'Short exact supporting phrase from the transcript.' },
                },
                required: ['name'],
              },
            },
          },
          required: ['brand', 'mention_type', 'products'],
        },
      },
    },
    required: ['mentions'],
  },
};

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
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      tools: [EXTRACT_MENTIONS_TOOL],
      tool_choice: { type: 'tool', name: 'extract_mentions' },
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  const toolUse = data?.content?.find((b) => b.type === 'tool_use' && b.name === 'extract_mentions');

  if (!toolUse) {
    // Forcing tool_choice should make this unreachable in practice, but
    // fail loudly rather than silently returning empty if the API's
    // response shape ever doesn't match what's expected.
    throw new Error(`classify.js: no extract_mentions tool_use block in response: ${JSON.stringify(data)}`);
  }

  // toolUse.input is already a parsed object — no JSON.parse, no text to
  // malform, which is the entire point of this rewrite.
  const mentions = Array.isArray(toolUse.input?.mentions) ? toolUse.input.mentions : [];

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
