import { Router } from 'express';
import { query } from '../../lib/db.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export const categoriesRouter = Router();

// ----------------------------------------------------------------------------
// GET /categories/:category/leaderboard
// Public — no auth required (see server.js mount). Top 5 only, per the
// league-table spec, to avoid cannibalising the paid per-question breakdown
// reserved for Essential.
// ----------------------------------------------------------------------------
categoriesRouter.get('/:category/leaderboard', asyncHandler(async (req, res) => {
  const { category } = req.params;

  // count(distinct query_result_id), not count(*) — same reasoning as
  // brands.js's competitors endpoint: since v4, one recommendation naming
  // multiple products produces multiple rows in brand_mentions.
  const { rows } = await query(
    `select brand, count(distinct query_result_id) filter (where mention_type = 'recommended') as recommendations
     from brand_mentions
     where category_slug = $1
     group by brand
     order by recommendations desc
     limit 5`,
    [category]
  );

  res.json({
    category_slug: category,
    leaderboard: rows.map((r) => ({ brand: r.brand, recommendations: Number(r.recommendations) })),
  });
}));

// ----------------------------------------------------------------------------
// GET /categories/:category/questions?limit=&offset=
// Powers Free-tier's "top 5 questions" view and, unpaginated, Essential's
// full question list. Note from the API Design Doc: close to a shared
// implementation with /brands/:brand/gaps — kept separate here since one is
// brand-filtered and one isn't, but worth revisiting if they drift.
// ----------------------------------------------------------------------------
categoriesRouter.get('/:category/questions', asyncHandler(async (req, res) => {
  const { category } = req.params;
  const { limit = 20, offset = 0 } = req.query;

  const { rows } = await query(
    `select q.query_text, q.search_volume, qr.channel, qr.mentions
     from query_results qr
     join queries q on q.id = qr.query_id
     join subcategories sc on sc.id = q.subcategory_id
     join categories c on c.id = sc.category_id
     where c.slug = $1
     order by q.search_volume desc nulls last
     limit $2 offset $3`,
    [category, Number(limit), Number(offset)]
  );

  res.json({
    category_slug: category,
    results: rows.map((r) => ({
      query_text: r.query_text,
      search_volume: r.search_volume,
      channel: r.channel,
      recommended_brands: r.mentions.filter((m) => m.mention_type === 'recommended').map((m) => m.brand),
      cited_brands: r.mentions.filter((m) => m.mention_type === 'cited').map((m) => m.brand),
    })),
  });
}));
