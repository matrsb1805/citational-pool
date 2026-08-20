import { Router } from 'express';
import { query } from '../../lib/db.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export const brandsRouter = Router();

// ----------------------------------------------------------------------------
// GET /brands/:brand/inclusion?category=...&channel=...
//
// Deliberately does NOT query the brand_mentions view for the denominator.
// That view unnests query_results.mentions, which means a query_result with
// an EMPTY mentions array (a real, valid "nobody was recommended here"
// outcome) produces zero rows in brand_mentions — silently excluding it
// from any count(distinct query_id) computed from that view. For this
// endpoint, "total_questions_checked" must include those zero-mention
// results too, so it's computed directly against query_results instead,
// with EXISTS checks against the mentions jsonb for the numerator counts.
// ----------------------------------------------------------------------------
brandsRouter.get('/:brand/inclusion', asyncHandler(async (req, res) => {
  const { brand } = req.params;
  const { category, channel } = req.query;

  if (!category) return res.status(400).json({ error: 'category is required' });

  // TODO (Phase 2): once real shops/sessions exist, verify
  // req.authContext.shopId's target_brand matches :brand before returning
  // data — right now anyone can query any brand (see authStub.js).

  const params = [category, brand];
  let channelFilter = '';
  if (channel) {
    params.push(channel);
    channelFilter = `and qr.channel = $${params.length}`;
  }

  const { rows } = await query(
    `select
       qr.channel,
       count(*) filter (
         where exists (
           select 1 from jsonb_array_elements(qr.mentions) m
           where m->>'brand' = $2 and m->>'mention_type' = 'recommended'
         )
       ) as recommended_count,
       count(*) filter (
         where exists (
           select 1 from jsonb_array_elements(qr.mentions) m
           where m->>'brand' = $2 and m->>'mention_type' = 'cited'
         )
       ) as cited_count,
       count(*) as total_questions_checked
     from query_results qr
     join queries q on q.id = qr.query_id
     join subcategories sc on sc.id = q.subcategory_id
     join categories c on c.id = sc.category_id
     where c.slug = $1 ${channelFilter}
     group by qr.channel`,
    params
  );

  res.json({
    category_slug: category,
    channels: rows.map((r) => ({
      channel: r.channel,
      recommended_count: Number(r.recommended_count),
      cited_count: Number(r.cited_count),
      total_questions_checked: Number(r.total_questions_checked),
    })),
  });
}));

// ----------------------------------------------------------------------------
// GET /brands/:brand/competitors?category=...&limit=&offset=
//
// Gating rule (per Charles's original design, corrected for the v3 schema
// in the API Design Doc v1.1 revision): only surface competitors for
// queries where :brand was NOT itself the recommended answer — a query the
// merchant already won doesn't need a "who else showed up" list. There's
// no stored `state` column to filter on (removed in v2 for good reason);
// this is computed per request via a NOT EXISTS check.
//
// limit/offset added after real feedback: this was hardcoded to top-10
// with no pagination, which only serves Free's summary card, not
// Essential's uncapped "By Competition" tab with drill-down. Default of 10
// preserves the old behavior for callers that don't pass limit; Essential
// callers can request more / paginate.
// ----------------------------------------------------------------------------
brandsRouter.get('/:brand/competitors', asyncHandler(async (req, res) => {
  const { brand } = req.params;
  const { category, limit = 10, offset = 0 } = req.query;

  if (!category) return res.status(400).json({ error: 'category is required' });

  // count(distinct m.query_result_id), not count(*) — since v4, one
  // recommendation naming 2 products produces 2 rows in brand_mentions
  // (one per product). Counting raw rows here would inflate a competitor's
  // apparent win count based on how many products they named, not how many
  // times they were actually recommended.
  const { rows } = await query(
    `select m.brand, m.mention_type, count(distinct m.query_result_id) as mentions
     from brand_mentions m
     where m.category_slug = $1
       and m.brand <> $2
       and m.query_result_id in (
         select qr.id from query_results qr
         where not exists (
           select 1 from jsonb_array_elements(qr.mentions) mm
           where mm->>'brand' = $2 and mm->>'mention_type' = 'recommended'
         )
       )
     group by m.brand, m.mention_type
     order by mentions desc
     limit $3 offset $4`,
    [category, brand, Number(limit), Number(offset)]
  );

  res.json({
    category_slug: category,
    competitors: rows.map((r) => ({
      brand: r.brand,
      mention_type: r.mention_type,
      mentions: Number(r.mentions),
    })),
  });
}));

// ----------------------------------------------------------------------------
// GET /brands/:brand/gaps?category=...&limit=&offset=
// Questions where :brand appears nowhere at all (neither recommended nor
// cited), ordered by real search volume — matches Free-tier's "ranked by
// real search volume, not marketer phrases" positioning.
// ----------------------------------------------------------------------------
brandsRouter.get('/:brand/gaps', asyncHandler(async (req, res) => {
  const { brand } = req.params;
  const { category, limit = 20, offset = 0 } = req.query;

  if (!category) return res.status(400).json({ error: 'category is required' });

  const { rows } = await query(
    `select q.query_text, q.search_volume, qr.channel, qr.mentions
     from query_results qr
     join queries q on q.id = qr.query_id
     join subcategories sc on sc.id = q.subcategory_id
     join categories c on c.id = sc.category_id
     where c.slug = $1
       and not exists (
         select 1 from jsonb_array_elements(qr.mentions) m where m->>'brand' = $2
       )
     order by q.search_volume desc nulls last
     limit $3 offset $4`,
    [category, brand, Number(limit), Number(offset)]
  );

  res.json({
    results: rows.map((r) => ({
      query_text: r.query_text,
      search_volume: r.search_volume,
      channel: r.channel,
      recommended_brands: r.mentions.filter((m) => m.mention_type === 'recommended').map((m) => m.brand),
      cited_brands: r.mentions.filter((m) => m.mention_type === 'cited').map((m) => m.brand),
    })),
  });
}));

// ----------------------------------------------------------------------------
// GET /brands/:brand/opportunities?limit=&offset=
//
// New endpoint — real feedback flagged that no cross-category endpoint
// existed at all, needed for the Opportunities page (both lenses, per
// earlier design direction: rank opportunities cross category and product,
// not per-category). Without this, the frontend would have to call
// /brands/:brand/gaps once per category and merge client-side — logic that
// belongs server-side.
//
// Combines both opportunity lenses in one ranked list, across ALL
// categories:
//   - "gap": the brand doesn't appear at all for this question
//   - "generic_win": the brand IS recommended, but with no specific
//     product named (products: []) — the "generic win" lens from Charles's
//     Data Dependencies doc, now servable since v4 makes products an
//     explicit array to check the length of.
// Both unioned and ranked together by real search volume, since the point
// of this page is "biggest opportunity first," not "gaps first, then wins."
// ----------------------------------------------------------------------------
brandsRouter.get('/:brand/opportunities', asyncHandler(async (req, res) => {
  const { brand } = req.params;
  const { limit = 20, offset = 0 } = req.query;

  const { rows } = await query(
    `select query_text, category_slug, channel, search_volume, opportunity_type
     from (
       select q.query_text, c.slug as category_slug, qr.channel, q.search_volume, 'gap' as opportunity_type
       from query_results qr
       join queries q on q.id = qr.query_id
       join subcategories sc on sc.id = q.subcategory_id
       join categories c on c.id = sc.category_id
       where not exists (
         select 1 from jsonb_array_elements(qr.mentions) m where m->>'brand' = $1
       )
       union all
       select q.query_text, c.slug as category_slug, qr.channel, q.search_volume, 'generic_win' as opportunity_type
       from query_results qr
       join queries q on q.id = qr.query_id
       join subcategories sc on sc.id = q.subcategory_id
       join categories c on c.id = sc.category_id
       where exists (
         select 1 from jsonb_array_elements(qr.mentions) m
         where m->>'brand' = $1
           and m->>'mention_type' = 'recommended'
           and coalesce(jsonb_array_length(m->'products'), 0) = 0
       )
     ) opportunities
     order by search_volume desc nulls last
     limit $2 offset $3`,
    [brand, Number(limit), Number(offset)]
  );

  res.json({
    results: rows.map((r) => ({
      query_text: r.query_text,
      category_slug: r.category_slug,
      channel: r.channel,
      search_volume: r.search_volume,
      opportunity_type: r.opportunity_type,
    })),
  });
}));
