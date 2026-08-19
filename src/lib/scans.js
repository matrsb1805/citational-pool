import { query } from './db.js';

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
