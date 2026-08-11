// Railway's Postgres doesn't come with a SQL editor the way Supabase's
// dashboard did — this applies db/schema.sql then db/seed.sql directly
// against DATABASE_URL. Idempotent: schema.sql uses `if not exists` /
// `on conflict do nothing` throughout, so this is safe to re-run.
//
//   npm run migrate

import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../lib/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.join(__dirname, '..', '..', 'db');

async function run(file) {
  const sql = await readFile(path.join(dbDir, file), 'utf8');
  console.log(`[migrate] applying ${file}...`);
  await pool.query(sql);
  console.log(`[migrate] ${file} applied.`);
}

await run('schema.sql');
await run('seed.sql');

await pool.end();
console.log('[migrate] done.');
