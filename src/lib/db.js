import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.warn(
    '[db] DATABASE_URL not set — fine for `npm run enqueue:dry`, ' +
      'required for anything that touches Postgres.'
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Railway Postgres requires SSL; local dev usually doesn't. Toggle via env
  // if you hit a self-signed cert error locally.
  ssl: process.env.PGSSL === 'false' ? false : { rejectUnauthorized: false },
});

export async function query(text, params) {
  return pool.query(text, params);
}
