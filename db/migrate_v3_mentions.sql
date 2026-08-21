-- ============================================================================
-- v3 migration: replace query_results.recommended_brands/cited_brands
-- (text[] pair) with a single mentions jsonb array, adding product_name and
-- quote per mention. See db/schema.sql's comment on query_results.
--
-- Unlike the v2 migration, this one PRESERVES existing data — real, paid-for
-- pool data exists by this point. Backfilled rows get product_name/quote =
-- null (that detail genuinely wasn't captured before this revision) but
-- keep their real brand/mention_type data.
--
-- Safe to re-run: the backfill only touches rows where mentions is still
-- the default empty array.
-- ============================================================================

alter table query_results add column if not exists mentions jsonb not null default '[]';

update query_results qr
set mentions =
  coalesce(
    (select jsonb_agg(jsonb_build_object(
       'brand', b, 'mention_type', 'recommended', 'product_name', null, 'quote', null
     )) from unnest(qr.recommended_brands) as b),
    '[]'::jsonb
  )
  ||
  coalesce(
    (select jsonb_agg(jsonb_build_object(
       'brand', b, 'mention_type', 'cited', 'product_name', null, 'quote', null
     )) from unnest(qr.cited_brands) as b),
    '[]'::jsonb
  )
where mentions = '[]'::jsonb
  and (
    coalesce(array_length(qr.recommended_brands, 1), 0) > 0
    or coalesce(array_length(qr.cited_brands, 1), 0) > 0
  );

-- Redefine the view BEFORE dropping the old columns. Real failure caught
-- in production: doing this in the other order (drop first, redefine
-- after) fails, because Postgres won't drop a column the view's OLD
-- definition still references — "column recommended_brands ... other
-- objects depend on it". Redefining the view first means it no longer
-- references those columns by the time the drop runs below.
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
  m.product_name,
  m.quote
from query_results qr
join queries q on q.id = qr.query_id
join subcategories sc on sc.id = q.subcategory_id
join categories c on c.id = sc.category_id
join scans s on s.id = qr.scan_id
cross join lateral jsonb_to_recordset(qr.mentions) as m(brand text, mention_type text, product_name text, quote text);

alter table query_results drop column if exists recommended_brands;
alter table query_results drop column if exists cited_brands;

drop index if exists idx_results_recommended_brands;
drop index if exists idx_results_cited_brands;
create index if not exists idx_results_mentions on query_results using gin(mentions jsonb_path_ops);
