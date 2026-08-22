import { query } from './db.js';

export async function createPoolScan(categoryId, totalJobs) {
  const { rows } = await query(
    `insert into scans (shop_id, category_id, scan_number, status, total_jobs)
     values (null, $1, 1, 'running', $2)
     returning id`,
    [categoryId, totalJobs]
  );
  return rows[0].id;
}

export async function completeScan(scanId, status = 'complete') {
  await query(
    `update scans set status = $2, completed_at = now() where id = $1`,
    [scanId, status]
  );
}

// Called once per job that settles (success OR final failure — a job
// that's exhausted its retries still counts as "settled", otherwise a
// single bad query would leave the whole scan stuck at 'running' forever).
// The update+return is one atomic Postgres statement, so this stays
// correct even with 5 workers finishing jobs for the same scan at once.
export async function incrementScanProgress(scanId) {
  const { rows } = await query(
    `update scans
     set completed_jobs = completed_jobs + 1
     where id = $1
     returning completed_jobs, total_jobs`,
    [scanId]
  );
  const { completed_jobs, total_jobs } = rows[0];
  if (total_jobs !== null && completed_jobs >= total_jobs) {
    await completeScan(scanId);
  }
}
