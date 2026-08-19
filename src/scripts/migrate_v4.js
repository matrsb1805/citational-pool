// One-time migration — see db/migrate_v4_products_array.sql. Run once via:
//   railway ssh -s citational-pool -- npm run migrate:v4

import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../lib/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.join(__dirname, '..', '..', 'db');

const { rows: before } = await pool.query(
  `select count(*) from query_results where mentions <> '[]'::jsonb and (mentions -> 0) ? 'product_name'`
);
console.log(`[migrate:v4] rows still in v3 shape before: ${before[0].count}`);

const sql = await readFile(path.join(dbDir, 'migrate_v4_products_array.sql'), 'utf8');
console.log('[migrate:v4] applying migrate_v4_products_array.sql...');
await pool.query(sql);

const { rows: after } = await pool.query(
  `select count(*) from query_results where mentions <> '[]'::jsonb and (mentions -> 0) ? 'product_name'`
);
console.log(`[migrate:v4] rows still in v3 shape after: ${after[0].count}`);
console.log('[migrate:v4] done — mentions[].products is now an array everywhere.');

await pool.end();
