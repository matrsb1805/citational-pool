// One-time migration — see db/migrate_v3_mentions.sql for the full
// explanation. Run once via:
//   railway ssh -s citational-pool -- npm run migrate:v3

import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../lib/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.join(__dirname, '..', '..', 'db');

const { rows: before } = await pool.query(
  `select count(*) from query_results where mentions <> '[]'::jsonb`
);
console.log(`[migrate:v3] rows with non-empty mentions before: ${before[0].count}`);

const sql = await readFile(path.join(dbDir, 'migrate_v3_mentions.sql'), 'utf8');
console.log('[migrate:v3] applying migrate_v3_mentions.sql...');
await pool.query(sql);

const { rows: after } = await pool.query(
  `select count(*) from query_results where mentions <> '[]'::jsonb`
);
console.log(`[migrate:v3] rows with non-empty mentions after: ${after[0].count}`);
console.log('[migrate:v3] done — query_results.mentions is now the source of truth; recommended_brands/cited_brands columns dropped.');

await pool.end();
