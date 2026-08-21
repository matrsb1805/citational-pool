import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../lib/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.join(__dirname, '..', '..', 'db');

// The "before" diagnostic query assumes the mentions column already
// exists — true on a re-run, but NOT true the first time this runs against
// a genuinely fresh v2 database (mentions doesn't exist until the
// migration SQL below adds it). Real bug caught in production: this
// crashed instead of running on a database that had never been migrated.
// Wrapped so a missing column is reported as "doesn't exist yet" instead
// of crashing the whole script before it gets to the part that fixes it.
let before;
try {
  const { rows } = await pool.query(`select count(*) from query_results where mentions <> '[]'::jsonb`);
  before = rows[0].count;
} catch (err) {
  if (err.code === '42703') {
    before = 'column did not exist yet — this is the first run';
  } else {
    throw err;
  }
}
console.log(`[migrate:v3] rows with non-empty mentions before: ${before}`);

const sql = await readFile(path.join(dbDir, 'migrate_v3_mentions.sql'), 'utf8');
console.log('[migrate:v3] applying migrate_v3_mentions.sql...');
await pool.query(sql);

const { rows: after } = await pool.query(
  `select count(*) from query_results where mentions <> '[]'::jsonb`
);
console.log(`[migrate:v3] rows with non-empty mentions after: ${after[0].count}`);
console.log('[migrate:v3] done — query_results.mentions is now the source of truth; recommended_brands/cited_brands columns dropped.');

await pool.end();
