// One-time migration — see db/migrate_v4_products_array.sql. Run once via:
//   railway ssh -s citational-pool -- npm run migrate:v4

import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../lib/db.js';

async function migrate() {
  console.log('[migrate:v5] adding total_jobs / completed_jobs to scans...');

  await query(`
    alter table scans
    add column if not exists total_jobs integer
  `);

  await query(`
    alter table scans
    add column if not exists completed_jobs integer not null default 0
  `);

  console.log('[migrate:v5] done.');
  process.exit(0);
}

migrate().catch((err) => {
  console.error('[migrate:v5] failed:', err);
  process.exit(1);
});
