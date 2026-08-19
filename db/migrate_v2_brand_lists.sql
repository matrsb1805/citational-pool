-- ============================================================================
-- One-time migration (v2, historical): replaced query_results.state/
-- competitor_brand with recommended_brands/cited_brands. Superseded by
-- migrate_v3_mentions.sql — kept for project history.
-- ============================================================================

drop table if exists query_results cascade;

create table query_results (
  id                  uuid primary key default gen_random_uuid(),
  scan_id             uuid not null references scans(id) on delete cascade,
  query_id            uuid not null references queries(id) on delete cascade,
  channel             text not null check (channel in ('chatgpt', 'google_ai_mode', 'perplexity')),
  recommended_brands  text[] not null default '{}',
  cited_brands        text[] not null default '{}',
  raw_response        jsonb,
  cost_usd            numeric(10, 5),
  fetched_at          timestamptz not null default now(),
  error               text
);

create index idx_results_scan on query_results(scan_id);
create index idx_results_query on query_results(query_id);
create index idx_results_channel on query_results(channel);
create index idx_results_recommended_brands on query_results using gin(recommended_brands);
create index idx_results_cited_brands on query_results using gin(cited_brands);

drop view if exists category_state_distribution;
drop view if exists competitor_rollup;

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
  m.mention_type
from query_results qr
join queries q on q.id = qr.query_id
join subcategories sc on sc.id = q.subcategory_id
join categories c on c.id = sc.category_id
join scans s on s.id = qr.scan_id
cross join lateral (
  select unnest(qr.recommended_brands) as brand, 'recommended' as mention_type
  union all
  select unnest(qr.cited_brands) as brand, 'cited' as mention_type
) m;
