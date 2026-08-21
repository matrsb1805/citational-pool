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
// in the API Design Doc v1.1 revision): only surface COMPETITOR mentions
// from queries where the requested brand was NOT itself the recommended
// answer — a query the merchant already won doesn't need a "who else
// showed up" list. There's no stored `state` column to filter on (removed
// in v2 for good reason); this is computed per request via a NOT EXISTS
// check.
//
// One row per brand, not per (brand, mention_type) — merged server-side,
// per the project's own stated principle that derived aggregates aren't a
// client-side job. The two-tone competitor bar (teal = recommended, navy =
// cited) needs exactly this shape.
//
// The merchant's OWN row is included in the same ranked list, tagged
// `is_brand: true` — real feedback caught that a competitor-only rollup
// can't render "the merchant's own leaderboard" (which needs their own row
// ranked alongside competitors, not gated the way competitor rows are:
// every one of the brand's own appearances counts, not just the ones where
// a competitor also showed up). Computed as a genuinely separate, ungated
// query — the gating logic above exists specifically to answer "who's
// beating me," which doesn't apply to the brand's own tally.
//
// Own row is always present regardless of page (so the merchant can find
// themselves ranked correctly even off the current page), which means the
// full competitor set has to be fetched, merged with the own row, sorted,
// and THEN paginated in application code — not paginated in SQL first.
// Honest scaling note, same as /opportunities: fine at Phase 1 volume,
// worth revisiting (e.g. SQL-side pagination with a window function) if
// the competitor set per category grows large.
//
// total_competitors deliberately does NOT include the brand's own row —
// "rank of N" means N competitors, not N-1 after counting yourself.
// ----------------------------------------------------------------------------
brandsRouter.get('/:brand/competitors', asyncHandler(async (req, res) => {
  const { brand } = req.params;
  const { category, limit = 10, offset = 0 } = req.query;

  if (!category) return res.status(400).json({ error: 'category is required' });

  // count(distinct query_result_id), not count(*) — since v4, one
  // recommendation naming 2 products produces 2 rows in brand_mentions
  // (one per product). Counting raw rows here would inflate a competitor's
  // apparent win count based on how many products they named, not how many
  // times they were actually recommended. group by brand only (not brand +
  // mention_type) is what merges recommended/cited into one row per brand.
  const competitorsSql = `
    select
      m.brand,
      count(distinct m.query_result_id) filter (where m.mention_type = 'recommended') as recommended,
      count(distinct m.query_result_id) filter (where m.mention_type = 'cited') as cited
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
    group by m.brand
  `;

  const [{ rows: competitorRows }, { rows: ownRows }] = await Promise.all([
    query(
      `select brand, recommended, cited, (recommended + cited) as total
       from (${competitorsSql}) merged
       order by total desc`,
      [category, brand]
    ),
    // Ungated, category-wide tally for the brand's own row — deliberately
    // NOT reusing competitorsSql, since that query's whole purpose is
    // excluding queries the brand already won. Every appearance of the
    // brand's own mention counts here, recommended or cited.
    query(
      `select
         count(distinct qr.id) filter (
           where exists (select 1 from jsonb_array_elements(qr.mentions) m where m->>'brand' = $2 and m->>'mention_type' = 'recommended')
         ) as recommended,
         count(distinct qr.id) filter (
           where exists (select 1 from jsonb_array_elements(qr.mentions) m where m->>'brand' = $2 and m->>'mention_type' = 'cited')
         ) as cited
       from query_results qr
       join queries q on q.id = qr.query_id
       join subcategories sc on sc.id = q.subcategory_id
       join categories c on c.id = sc.category_id
       where c.slug = $1`,
      [category, brand]
    ),
  ]);

  const totalCompetitors = competitorRows.length;

  const ownRecommended = Number(ownRows[0]?.recommended || 0);
  const ownCited = Number(ownRows[0]?.cited || 0);

  const merged = [
    ...competitorRows.map((r) => ({
      brand: r.brand,
      recommended: Number(r.recommended),
      cited: Number(r.cited),
      total: Number(r.total),
      is_brand: false,
    })),
    {
      brand,
      recommended: ownRecommended,
      cited: ownCited,
      total: ownRecommended + ownCited,
      is_brand: true,
    },
  ].sort((a, b) => b.total - a.total);

  const paged = merged.slice(Number(offset), Number(offset) + Number(limit));

  res.json({
    category_slug: category,
    total_competitors: totalCompetitors,
    competitors: paged,
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
      mentions: r.mentions,
    })),
  });
}));

// ----------------------------------------------------------------------------
// GET /brands/:brand/opportunities?limit=&offset=
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
//
// total_gaps/total_generic_wins: real feedback caught that results.length
// alone can't power tab labels like "Full gaps (6)" once volume grows past
// one page — a client counting the current page would silently show the
// wrong number. These totals run the SAME underlying query with no
// limit/offset, so they always reflect the true count regardless of what
// page is being viewed. Sharing opportunitiesSql between both queries (the
// list and the counts) keeps them from silently drifting apart if the
// logic changes later.
//
// Flagged honestly rather than fixed further: at real scale, computing an
// exact COUNT(*) over the full unioned query on every request could get
// expensive. Not a real cost at Phase 1's ~60 seeded questions — worth
// revisiting (e.g. an approximate/cached count) if this data volume grows
// by orders of magnitude before then.
// ----------------------------------------------------------------------------
brandsRouter.get('/:brand/opportunities', asyncHandler(async (req, res) => {
  const { brand } = req.params;
  const { limit = 20, offset = 0 } = req.query;

  const opportunitiesSql = `
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
  `;

  const [{ rows }, { rows: countRows }] = await Promise.all([
    query(
      `select query_text, category_slug, channel, search_volume, opportunity_type
       from (${opportunitiesSql}) opportunities
       order by search_volume desc nulls last
       limit $2 offset $3`,
      [brand, Number(limit), Number(offset)]
    ),
    query(
      `select opportunity_type, count(*) as total
       from (${opportunitiesSql}) opportunities
       group by opportunity_type`,
      [brand]
    ),
  ]);

  const totals = { gap: 0, generic_win: 0 };
  for (const r of countRows) totals[r.opportunity_type] = Number(r.total);

  res.json({
    total_gaps: totals.gap,
    total_generic_wins: totals.generic_win,
    results: rows.map((r) => ({
      query_text: r.query_text,
      category_slug: r.category_slug,
      channel: r.channel,
      search_volume: r.search_volume,
      opportunity_type: r.opportunity_type,
    })),
  });
}));
