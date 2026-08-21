// One-time migration — see db/migrate_v4_products_array.sql. Run once via:
//   railway ssh -s citational-pool -- npm run migrate:v4

import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../lib/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.join(__dirname, '..', '..', 'db');

// The "before" diagnostic assumes the mentions column already exists —
// true once migrate:v3 has run, but not guaranteed if this is ever run
// out of order or v3 was interrupted. Same defensive pattern as migrate_v3.js
// after a real failure there.
let before;
try {
  const { rows } = await pool.query(
    `select count(*) from query_results where mentions <> '[]'::jsonb and (mentions -> 0) ? 'product_name'`
  );
  before = rows[0].count;
} catch (err) {
  if (err.code === '42703') {
    before = 'mentions column did not exist yet — run migrate:v3 first';
  } else {
    throw err;
  }
}
console.log(`[migrate:v4] rows still in v3 shape before: ${before}`);

const sql = await readFile(path.join(dbDir, 'migrate_v4_products_array.sql'), 'utf8');
console.log('[migrate:v4] applying migrate_v4_products_array.sql...');
await pool.query(sql);

const { rows: after } = await pool.query(
  `select count(*) from query_results where mentions <> '[]'::jsonb and (mentions -> 0) ? 'product_name'`
);
console.log(`[migrate:v4] rows still in v3 shape after: ${after[0].count}`);
console.log('[migrate:v4] done — mentions[].products is now an array everywhere.');

await pool.end();
