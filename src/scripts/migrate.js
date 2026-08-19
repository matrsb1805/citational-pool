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
