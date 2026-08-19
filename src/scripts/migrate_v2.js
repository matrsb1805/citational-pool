import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../lib/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.join(__dirname, '..', '..', 'db');

const sql = await readFile(path.join(dbDir, 'migrate_v2_brand_lists.sql'), 'utf8');

console.log('[migrate:v2] applying migrate_v2_brand_lists.sql...');
await pool.query(sql);
console.log('[migrate:v2] done — query_results now uses recommended_brands/cited_brands.');

await pool.end();
