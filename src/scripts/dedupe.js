// One-time fix — see db/dedupe.sql for the full explanation. Run once via:
//   railway ssh -s citational-pool -- npm run dedupe

import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../lib/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.join(__dirname, '..', '..', 'db');

const sql = await readFile(path.join(dbDir, 'dedupe.sql'), 'utf8');

console.log('[dedupe] checking for duplicate queries...');
const { rows: before } = await pool.query('select count(*) from queries');
console.log(`[dedupe] queries before: ${before[0].count}`);

try {
  await pool.query(sql);
} catch (err) {
  // The ALTER TABLE line at the end will error on a re-run once the
  // constraint already exists — that's expected and harmless. Anything else
  // should still be surfaced.
  if (!err.message.includes('already exists')) {
    throw err;
  }
  console.log('[dedupe] constraint already existed — duplicates were still cleaned up above.');
}

const { rows: after } = await pool.query('select count(*) from queries');
console.log(`[dedupe] queries after: ${after[0].count}`);

await pool.end();
console.log('[dedupe] done.');
