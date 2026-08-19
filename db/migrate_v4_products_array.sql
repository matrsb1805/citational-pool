-- ============================================================================
-- v4 migration: converts each mentions[] element's flat product_name/quote
-- into a nested products: [{name, quote}] array (or products: [] when there
-- was no product_name). See db/schema.sql's comment on query_results —
-- real feedback caught that the v3 shape couldn't represent an AI answer
-- naming multiple products from the same brand.
--
-- Safe to re-run: only touches rows whose first mentions[] element still
-- has the old `product_name` key (v3 shape) rather than `products` (v4).
-- Rows with an empty mentions array are untouched either way (valid in
-- both shapes).
-- ============================================================================

update query_results
set mentions = (
  select jsonb_agg(
    jsonb_build_object(
      'brand', m->>'brand',
      'mention_type', m->>'mention_type',
      'products',
        case when m->>'product_name' is not null
          then jsonb_build_array(jsonb_build_object('name', m->>'product_name', 'quote', m->'quote'))
          else '[]'::jsonb
        end
    )
  )
  from jsonb_array_elements(mentions) as m
)
where mentions <> '[]'::jsonb
  and (mentions -> 0) ? 'product_name';

create or replace view brand_mentions as
select
  qr.id           as query_result_id,
  qr.scan_id,
  qr.query_id,
  qr.channel,
  s.status        as scan_status,
  q.subcategory_id,
  sc.slug         as subcategory_slug,
  c.id            as category_id,
  c.slug          as category_slug,
  m.brand,
  m.mention_type,
  p.name          as product_name,
  p.quote
from query_results qr
join queries q on q.id = qr.query_id
join subcategories sc on sc.id = q.subcategory_id
join categories c on c.id = sc.category_id
join scans s on s.id = qr.scan_id
cross join lateral jsonb_to_recordset(qr.mentions) as m(brand text, mention_type text, products jsonb)
left join lateral jsonb_to_recordset(coalesce(m.products, '[]'::jsonb)) as p(name text, quote text) on true;
