-- ============================================================================
-- CitationalAI — Query Pool Schema
-- Phase 1: Pool Validation (pre-merchant) on Railway Postgres
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- categories / subcategories
-- ----------------------------------------------------------------------------
create table if not exists categories (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  name        text not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists subcategories (
  id            uuid primary key default gen_random_uuid(),
  category_id   uuid not null references categories(id) on delete cascade,
  slug          text not null,
  name          text not null,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (category_id, slug)
);

create index if not exists idx_subcategories_category on subcategories(category_id);

-- ----------------------------------------------------------------------------
-- queries: the shared pool, hung off subcategory.
-- search_volume: real Google Ads search volume, populated by
-- src/scripts/fetchSearchVolume.js (run manually/periodically — see
-- README). NULL until that script has been run at least once; NULL after
-- that means DataForSEO returned no measurable volume for that exact
-- phrase, not that the fetch failed.
-- source distinguishes pool-seeded queries from a future merchant-submitted
-- custom-query type (Pro-tier gate).
-- unique (subcategory_id, query_text): added after seed.sql was run
-- multiple times during Railway troubleshooting and produced 4x duplicate
-- rows — see db/dedupe.sql for the one-time cleanup this required.
-- ----------------------------------------------------------------------------
create table if not exists queries (
  id              uuid primary key default gen_random_uuid(),
  subcategory_id  uuid not null references subcategories(id) on delete cascade,
  query_text      text not null,
  query_type      text not null check (
    query_type in ('category_use_case', 'brand_direct', 'brand_vs_competitor', 'purchase_intent')
  ),
  target_brands   text[],
  search_volume   integer,
  source          text not null default 'seed' check (source in ('seed', 'merchant_custom')),
  active          boolean not null default true,
  notes           text,
  created_at      timestamptz not null default now(),
  unique (subcategory_id, query_text)
);

create index if not exists idx_queries_subcategory on queries(subcategory_id);
create index if not exists idx_queries_active on queries(active) where active = true;

-- ----------------------------------------------------------------------------
-- shops: Shopify merchants. Empty in Phase 1 (pool validation, no merchants
-- yet) — populated from Phase 2 (Scout/Free-Essential MVP) onward.
-- target_brand: the merchant's own brand name — column exists already;
-- what's missing is the OAuth install flow to populate real rows, not a
-- schema gap.
-- ----------------------------------------------------------------------------
create table if not exists shops (
  id               uuid primary key default gen_random_uuid(),
  shopify_domain   text unique,
  target_brand     text,
  created_at       timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- scans: a snapshot run over a category, for a shop or for the pool itself.
-- PHASE 1: no merchants yet. The scheduler creates one "pool scan" per
-- category per cadence tick with shop_id = null.
-- ----------------------------------------------------------------------------
create table if not exists scans (
  id            uuid primary key default gen_random_uuid(),
  shop_id       uuid references shops(id) on delete set null,
  category_id   uuid not null references categories(id),
  scan_number   integer not null default 1,
  started_at    timestamptz not null default now(),
  completed_at  timestamptz,
  status        text not null default 'running' check (status in ('running', 'complete', 'failed'))
);

create index if not exists idx_scans_shop on scans(shop_id);
create index if not exists idx_scans_category on scans(category_id);

-- ----------------------------------------------------------------------------
-- query_results: atomic unit. One row per query per channel per scan.
--
-- mentions (v3 — replaced recommended_brands/cited_brands text[] pair):
-- one jsonb array, each element shaped:
--   { "brand": "CeraVe", "mention_type": "recommended"|"cited",
--     "product_name": "Moisturizing Cream" | null, "quote": "..." | null }
-- product_name/quote are captured for EVERY mentioned brand, not just the
-- merchant's own — there's no extra cost to this, since one classification
-- pass already sees every brand in the transcript. Whether a future API
-- exposes competitor product-level detail (vs. brand-only) is a serving-
-- layer/tier-gating decision, enforced server-side same as everything else
-- — the collection layer doesn't need to pre-decide that boundary.
-- raw_response is kept in full regardless of parsing, so re-classification
-- is always possible without re-querying the channel.
--
-- cost_usd: real cost per call where the channel actually reports one.
-- Perplexity and DataForSEO (google_ai_mode) both return real dollar cost
-- in their responses — extracted directly. OpenAI's Chat Completions API
-- does NOT return a dollar cost, only token counts — computing one requires
-- hardcoding a per-model price, and current OpenAI pricing is genuinely
-- inconsistent across sources as of Aug 2026 (their lineup has moved past
-- gpt-4o and published rates conflict). Rather than store a number that
-- might be wrong, chatgpt.js leaves cost_usd null and preserves full token
-- counts in raw_response — compute it downstream once a specific,
-- confirmed rate is chosen, don't trust a guessed constant here.
-- ----------------------------------------------------------------------------
create table if not exists query_results (
  id                  uuid primary key default gen_random_uuid(),
  scan_id             uuid not null references scans(id) on delete cascade,
  query_id            uuid not null references queries(id) on delete cascade,
  channel             text not null check (channel in ('chatgpt', 'google_ai_mode', 'perplexity')),
  mentions            jsonb not null default '[]',
  raw_response        jsonb,
  cost_usd            numeric(10, 5),
  fetched_at          timestamptz not null default now(),
  error               text
);

create index if not exists idx_results_scan on query_results(scan_id);
create index if not exists idx_results_query on query_results(query_id);
create index if not exists idx_results_channel on query_results(channel);
create index if not exists idx_results_mentions on query_results using gin(mentions jsonb_path_ops);

-- ----------------------------------------------------------------------------
-- subscriptions: billing state per shop. Empty in Phase 1. reconciled_at
-- tracks the last time charge_status was verified directly against Shopify
-- rather than trusted from webhook alone.
-- ----------------------------------------------------------------------------
create table if not exists subscriptions (
  shop_id           uuid primary key references shops(id) on delete cascade,
  plan              text not null default 'free' check (plan in ('free', 'essential')),
  shopify_charge_id text,
  charge_status     text not null default 'none' check (
    charge_status in ('none', 'pending', 'active', 'declined', 'cancelled')
  ),
  reconciled_at     timestamptz
);

-- ----------------------------------------------------------------------------
-- brand_mentions: unnests query_results.mentions into one row per
-- (result, brand, mention_type), carrying product_name/quote too. Every
-- downstream question — "was CeraVe recommended," "who's beating CeraVe,"
-- a category-wide leaderboard, or Essential's "exact phrasing" detail — is a
-- filter/group-by against this view, for any brand, computed at query time.
-- No target brand is baked in anywhere upstream of this.
--
-- Example — is a given brand recommended, and how often, in a category:
--   select count(*) filter (where mention_type = 'recommended')
--   from brand_mentions
--   where brand = 'CeraVe' and category_slug = 'skincare-beauty';
--
-- Example — "who's beating me" for a given brand:
--   select brand, mention_type, count(*)
--   from brand_mentions
--   where category_slug = 'skincare-beauty' and brand <> 'CeraVe'
--   group by brand, mention_type
--   order by count(*) desc;
--
-- Example — "generic win" lens (recommended, no product named):
--   select * from brand_mentions
--   where brand = 'CeraVe' and mention_type = 'recommended' and product_name is null;
-- ----------------------------------------------------------------------------
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

comment on table categories is 'Flagship categories (e.g. skincare/beauty)';
comment on table subcategories is 'Subcategories within a category — supports partial rollout without schema change';
comment on table queries is 'Shared query pool, hung off subcategory, ranked by search_volume';
comment on table shops is 'Shopify merchants — empty in Phase 1';
comment on table scans is 'Snapshot run over a category; shop_id null = pool-level run (Phase 1)';
comment on table query_results is 'Atomic result: one row per query per channel per scan; brand mentions as structured list, no target brand baked in';
comment on table subscriptions is 'Billing state per shop — empty in Phase 1';
