-- ============================================================================
-- One-time fix: db/schema.sql's `queries` table now has a unique constraint
-- on (subcategory_id, query_text), added after this project's queries table
-- had already picked up 4x duplicate rows from seed.sql being run repeatedly
-- during Railway troubleshooting (seed.sql originally had no ON CONFLICT
-- guard). This file:
--   1. Deletes the duplicate rows, keeping the oldest copy of each query.
--   2. Adds the same unique constraint to the ALREADY-EXISTING table.
-- Safe to run more than once.
-- ============================================================================

delete from query_results
where query_id in (
  select a.id
  from queries a
  join queries b
    on a.subcategory_id = b.subcategory_id
   and a.query_text = b.query_text
   and (a.created_at, a.id) > (b.created_at, b.id)
);

delete from queries a
using queries b
where a.subcategory_id = b.subcategory_id
  and a.query_text = b.query_text
  and (a.created_at, a.id) > (b.created_at, b.id);

alter table queries
  add constraint queries_subcategory_id_query_text_key
  unique (subcategory_id, query_text);
