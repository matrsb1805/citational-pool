-- ============================================================================
-- CitationalAI — Query Pool Schema
-- Phase 1: Pool Validation (pre-merchant) on Railway Postgres
-- ============================================================================
-- Data model follows the "Project Summary for Steve" doc (Charles), Section 4,
-- which supersedes the earlier Supabase/GitHub-Actions schema. Key changes
-- from that earlier version:
--   - categories/queries split into categories -> subcategories -> queries,
--     to support partial rollout (2 of N subcategories live) and the league
--     tables, without a future schema change.
--   - query_results is now 3-state (recommended / cited / not_listed) per
--     channel, replacing the old boolean brand_mentions extraction table.
--   - competitor_brand lives directly on query_results (brand-level only,
--     normalised server-side — never trust tier-gating to the frontend).
--   - shops / scans / subscriptions are new: Scan is the merchant-facing
--     snapshot over pooled results. See "Phase 1 vs Phase 2" note below.
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
-- queries: the shared pool, now hung off subcategory rather than category.
-- search_volume backs the "ranked by real search volume, not marketer
-- phrases" positioning (Summary doc, Section 2).
-- source distinguishes pool-seeded queries from a future merchant-submitted
-- custom-query type (Pro-tier gate) — the enum leaves room for it without a
-- redesign, per Summary doc Section 3 "Custom queries" note.
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
-- ----------------------------------------------------------------------------
create table if not exists shops (
  id               uuid primary key default gen_random_uuid(),
  shopify_domain   text unique,
  target_brand     text,
  created_at       timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- scans: a snapshot run over a category, for a shop or for the pool itself.
--
-- PHASE 1 vs PHASE 2:
-- In Phase 1 (this build), there are no merchants yet. The scheduler creates
-- one "pool scan" per category per cadence tick with shop_id = null. Its
-- query_results are the shared pool data every future merchant reads from.
-- From Phase 2 onward, a merchant-triggered scan gets its own row with
-- shop_id set; whether that snapshots the existing pool results for their
-- category or triggers fresh channel calls is a Phase 2 product decision,
-- not resolved in this scaffold.
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
-- state replaces the old boolean brand_mentions extraction — three-state per
-- Summary doc Section 4.
-- competitor_brand: brand name only, never a product name, and must already
-- be normalised to brand-level by the classification pass (src/lib/classify.js)
-- before it lands here — the tier boundary (Free sees category-level; who's
---beating-you rollup gated on state, not tier, per Summary doc Section 5) is
-- enforced server-side against this column, not trusted to the frontend.
-- raw_response is kept in full regardless of state/competitor_brand parsing,
-- so re-classification is always possible without re-querying the channel.
-- ----------------------------------------------------------------------------
create table if not exists query_results (
  id                uuid primary key default gen_random_uuid(),
  scan_id           uuid not null references scans(id) on delete cascade,
  query_id          uuid not null references queries(id) on delete cascade,
  channel           text not null check (channel in ('chatgpt', 'google_ai_mode', 'perplexity')),
  state             text check (state in ('recommended', 'cited', 'not_listed')),
  competitor_brand  text,
  raw_response      jsonb,
  cost_usd          numeric(10, 5),
  fetched_at        timestamptz not null default now(),
  error             text
);

create index if not exists idx_results_scan on query_results(scan_id);
create index if not exists idx_results_query on query_results(query_id);
create index if not exists idx_results_channel on query_results(channel);
create index if not exists idx_results_competitor on query_results(lower(competitor_brand));

-- ----------------------------------------------------------------------------
-- subscriptions: billing state per shop. Empty in Phase 1. reconciled_at
-- tracks the last time charge_status was verified directly against Shopify
-- rather than trusted from webhook alone — per Summary doc Section 4, this
-- pattern should be the standard for any other Shopify-sourced state, not a
-- one-off, so treat it as the template if more Shopify-derived fields land
-- on this table later.
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
-- brand_inclusion_frequency: core "AI inclusion %" metric, rebuilt for the
-- 3-state model. A query counts as "included" if state is recommended or
-- cited for the target brand's own results (this view reports per-category
-- state distribution across channels; per-brand attribution for the shop's
-- OWN brand happens at the application layer via shops.target_brand, since
-- state here describes the result of a query, not a specific brand row).
-- ----------------------------------------------------------------------------
create or replace view category_state_distribution as
select
  c.slug                              as category_slug,
  qr.channel,
  qr.state,
  count(*)                            as result_count,
  round(100.0 * count(*) filter (where qr.state in ('recommended', 'cited'))
    over (partition by c.slug, qr.channel) / nullif(count(*) over (partition by c.slug, qr.channel), 0), 1)
                                       as inclusion_pct_in_channel
from scans s
join categories c on c.id = s.category_id
join query_results qr on qr.scan_id = s.id
where s.status = 'complete'
group by c.slug, qr.channel, qr.state;

-- ----------------------------------------------------------------------------
-- competitor_rollup: "who's beating you" — Summary doc Section 5. Gated on
-- state (only shown when state is cited or not_listed) at the query layer
-- that reads this, not baked into the view itself.
-- ----------------------------------------------------------------------------
create or replace view competitor_rollup as
select
  c.slug             as category_slug,
  sc.slug            as subcategory_slug,
  qr.competitor_brand,
  qr.state,
  count(*)           as mention_count
from scans s
join categories c on c.id = s.category_id
join query_results qr on qr.scan_id = s.id
join queries q on q.id = qr.query_id
join subcategories sc on sc.id = q.subcategory_id
where s.status = 'complete'
  and qr.competitor_brand is not null
group by c.slug, sc.slug, qr.competitor_brand, qr.state;

comment on table categories is 'Flagship categories (e.g. skincare/beauty)';
comment on table subcategories is 'Subcategories within a category — supports partial rollout without schema change';
comment on table queries is 'Shared query pool, hung off subcategory, ranked by search_volume';
comment on table shops is 'Shopify merchants — empty in Phase 1';
comment on table scans is 'Snapshot run over a category; shop_id null = pool-level run (Phase 1)';
comment on table query_results is 'Atomic result: one row per query per channel per scan, 3-state';
comment on table subscriptions is 'Billing state per shop — empty in Phase 1';
