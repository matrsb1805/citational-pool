-- ============================================================================
-- CitationalAI — Starter Query Seed
-- ============================================================================
-- Carries forward the original 60-query starter set, restructured under
-- category -> subcategory per the new schema. Subcategory split (2 per
-- flagship category) matches the Summary doc Section 6 league-table starting
-- depth, so the same subcategories can be reused for both the pool and the
-- league tables rather than maintained twice.
--
-- search_volume is left NULL throughout — real search-volume-ranked ordering
-- (Summary doc Section 2, "ranked by real search volume not marketer
-- phrases") depends on the query-cost/data-source sizing that's still an
-- open dependency with Charles/Steve. Do not present these as volume-ranked
-- until that's populated.
--
-- brand_direct / brand_vs_competitor queries use well-known example brands
-- as placeholders so the pool is runnable immediately — swap for real
-- installed-merchant + competitor brands before the first real run.
-- ============================================================================

insert into categories (slug, name) values
  ('skincare-beauty', 'Skincare & Beauty'),
  ('supplements', 'Supplements'),
  ('activewear', 'Activewear')
on conflict (slug) do nothing;

insert into subcategories (category_id, slug, name)
select id, sub.slug, sub.name from categories, (values
  ('skincare-beauty', 'moisturisers-cleansers', 'Moisturisers & Cleansers'),
  ('skincare-beauty', 'serums-treatments', 'Serums & Treatments'),
  ('supplements', 'vitamins-minerals', 'Vitamins & Minerals'),
  ('supplements', 'protein-performance', 'Protein & Performance'),
  ('activewear', 'leggings-bottoms', 'Leggings & Bottoms'),
  ('activewear', 'tops-outerwear', 'Tops & Outerwear')
) as sub(cat_slug, slug, name)
where categories.slug = sub.cat_slug
on conflict (category_id, slug) do nothing;

-- ----------------------------------------------------------------------------
-- Skincare & Beauty — Moisturisers & Cleansers (10)
-- ----------------------------------------------------------------------------
with sc as (select id from subcategories where slug = 'moisturisers-cleansers')
insert into queries (subcategory_id, query_text, query_type, target_brands)
select sc.id, q.query_text, q.query_type, q.target_brands
from sc, (values
  ('best moisturiser for sensitive skin', 'category_use_case', null::text[]),
  ('best cleanser for combination skin', 'category_use_case', null),
  ('best fragrance-free body lotion', 'category_use_case', null),
  ('is CeraVe good for eczema', 'brand_direct', array['CeraVe']),
  ('is La Roche-Posay sunscreen reef safe', 'brand_direct', array['La Roche-Posay']),
  ('CeraVe vs The Ordinary for beginners', 'brand_vs_competitor', array['CeraVe','The Ordinary']),
  ('La Roche-Posay vs EltaMD sunscreen', 'brand_vs_competitor', array['La Roche-Posay','EltaMD']),
  ('best skincare gift set under $50', 'purchase_intent', null),
  ('where to buy clean beauty skincare online', 'purchase_intent', null),
  ('best affordable dupe for La Mer moisturiser', 'purchase_intent', null)
) as q(query_text, query_type, target_brands)
on conflict (subcategory_id, query_text) do nothing;

-- ----------------------------------------------------------------------------
-- Skincare & Beauty — Serums & Treatments (15)
-- ----------------------------------------------------------------------------
with sc as (select id from subcategories where slug = 'serums-treatments')
insert into queries (subcategory_id, query_text, query_type, target_brands)
select sc.id, q.query_text, q.query_type, q.target_brands
from sc, (values
  ('best serum for hyperpigmentation', 'category_use_case', null::text[]),
  ('best sunscreen that doesn''t leave a white cast', 'category_use_case', null),
  ('best retinol for beginners', 'category_use_case', null),
  ('best skincare routine for acne-prone skin', 'category_use_case', null),
  ('best eye cream for dark circles', 'category_use_case', null),
  ('best exfoliator for sensitive skin', 'category_use_case', null),
  ('best niacinamide serum', 'category_use_case', null),
  ('is The Ordinary niacinamide worth it', 'brand_direct', array['The Ordinary']),
  ('does Aesop moisturiser work for dry skin', 'brand_direct', array['Aesop']),
  ('is Paula''s Choice BHA good for blackheads', 'brand_direct', array['Paula''s Choice']),
  ('Drunk Elephant vs The Ordinary retinol', 'brand_vs_competitor', array['Drunk Elephant','The Ordinary']),
  ('Aesop vs Kiehl''s moisturiser', 'brand_vs_competitor', array['Aesop','Kiehl''s']),
  ('Tatcha vs Sunday Riley serum', 'brand_vs_competitor', array['Tatcha','Sunday Riley']),
  ('cruelty-free skincare brands worth buying', 'purchase_intent', null),
  ('best skincare brand for teenagers with acne', 'purchase_intent', null)
) as q(query_text, query_type, target_brands)
on conflict (subcategory_id, query_text) do nothing;

-- ----------------------------------------------------------------------------
-- Supplements — Vitamins & Minerals (11)
-- ----------------------------------------------------------------------------
with sc as (select id from subcategories where slug = 'vitamins-minerals')
insert into queries (subcategory_id, query_text, query_type, target_brands)
select sc.id, q.query_text, q.query_type, q.target_brands
from sc, (values
  ('best magnesium supplement for sleep', 'category_use_case', null::text[]),
  ('best probiotic for bloating', 'category_use_case', null),
  ('best collagen supplement for skin', 'category_use_case', null),
  ('best multivitamin for women over 40', 'category_use_case', null),
  ('best omega-3 supplement without fishy aftertaste', 'category_use_case', null),
  ('is Thorne magnesium high quality', 'brand_direct', array['Thorne']),
  ('does Ritual multivitamin actually work', 'brand_direct', array['Ritual']),
  ('Thorne vs Pure Encapsulations quality', 'brand_vs_competitor', array['Thorne','Pure Encapsulations']),
  ('Ritual vs Care/of multivitamin', 'brand_vs_competitor', array['Ritual','Care/of']),
  ('best supplement brand that''s NSF certified', 'purchase_intent', null),
  ('best supplements for a first-time buyer starter stack', 'purchase_intent', null)
) as q(query_text, query_type, target_brands)
on conflict (subcategory_id, query_text) do nothing;

-- ----------------------------------------------------------------------------
-- Supplements — Protein & Performance (9)
-- ----------------------------------------------------------------------------
with sc as (select id from subcategories where slug = 'protein-performance')
insert into queries (subcategory_id, query_text, query_type, target_brands)
select sc.id, q.query_text, q.query_type, q.target_brands
from sc, (values
  ('best protein powder for muscle recovery', 'category_use_case', null::text[]),
  ('best creatine for beginners', 'category_use_case', null),
  ('best supplement for energy without caffeine', 'category_use_case', null),
  ('is Athletic Greens (AG1) worth the price', 'brand_direct', array['AG1']),
  ('is Momentous creatine third-party tested', 'brand_direct', array['Momentous']),
  ('AG1 vs Bloom greens powder', 'brand_vs_competitor', array['AG1','Bloom Nutrition']),
  ('Momentous vs Optimum Nutrition creatine', 'brand_vs_competitor', array['Momentous','Optimum Nutrition']),
  ('cheapest place to buy creatine monohydrate', 'purchase_intent', null),
  ('best subscription supplement service', 'purchase_intent', null)
) as q(query_text, query_type, target_brands)
on conflict (subcategory_id, query_text) do nothing;

-- ----------------------------------------------------------------------------
-- Activewear — Leggings & Bottoms (6)
-- ----------------------------------------------------------------------------
with sc as (select id from subcategories where slug = 'leggings-bottoms')
insert into queries (subcategory_id, query_text, query_type, target_brands)
select sc.id, q.query_text, q.query_type, q.target_brands
from sc, (values
  ('best leggings that don''t pill', 'category_use_case', null::text[]),
  ('best leggings with pockets for phone', 'category_use_case', null),
  ('is Lululemon Align legging worth the price', 'brand_direct', array['Lululemon']),
  ('Lululemon vs Alo Yoga leggings', 'brand_vs_competitor', array['Lululemon','Alo Yoga']),
  ('best affordable dupe for Lululemon leggings', 'purchase_intent', null),
  ('where to buy plus size activewear online', 'purchase_intent', null)
) as q(query_text, query_type, target_brands)
on conflict (subcategory_id, query_text) do nothing;

-- ----------------------------------------------------------------------------
-- Activewear — Tops & Outerwear (9)
-- ----------------------------------------------------------------------------
with sc as (select id from subcategories where slug = 'tops-outerwear')
insert into queries (subcategory_id, query_text, query_type, target_brands)
select sc.id, q.query_text, q.query_type, q.target_brands
from sc, (values
  ('best sports bra for high impact running', 'category_use_case', null::text[]),
  ('best running shoes for wide feet', 'category_use_case', null),
  ('best moisture-wicking gym t-shirt', 'category_use_case', null),
  ('does Vuori hold up after washing', 'brand_direct', array['Vuori']),
  ('is Gymshark good quality for the price', 'brand_direct', array['Gymshark']),
  ('Vuori vs Rhone for men''s joggers', 'brand_vs_competitor', array['Vuori','Rhone']),
  ('Gymshark vs Nike training shorts', 'brand_vs_competitor', array['Gymshark','Nike']),
  ('best activewear brand for hot yoga', 'purchase_intent', null),
  ('best sustainable activewear brands', 'purchase_intent', null)
) as q(query_text, query_type, target_brands)
on conflict (subcategory_id, query_text) do nothing;
