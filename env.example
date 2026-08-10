import { query } from './db.js';

// Phase 1 (pool validation, no merchants yet): one "pool scan" per category
// per scheduler tick, with shop_id = null. See db/schema.sql "scans" comment
// for how this differs once real merchants exist in Phase 2.
export async function createPoolScan(categoryId) {
  const { rows } = await query(
    `insert into scans (shop_id, category_id, scan_number, status)
     values (null, $1, 1, 'running')
     returning id`,
    [categoryId]
  );
  return rows[0].id;
}

export async function completeScan(scanId, status = 'complete') {
  await query(
    `update scans set status = $2, completed_at = now() where id = $1`,
    [scanId, status]
  );
}
