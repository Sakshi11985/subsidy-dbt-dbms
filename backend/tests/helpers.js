// Point the app modules at a throwaway database BEFORE they are imported.
import pg from 'pg';

export async function useScratchDatabase(name) {
  const base = new URL(process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/subsidy_dbt');
  const admin = new URL(base); admin.pathname = '/postgres';
  const c = new pg.Client({ connectionString: admin.toString() });
  await c.connect();
  const exists = await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
  if (!exists.rowCount) await c.query(`CREATE DATABASE ${name}`);
  await c.end();
  base.pathname = `/${name}`;
  process.env.DATABASE_URL = base.toString();
  process.env.MONGO_DB = name;
  process.env.BANK_LATENCY_MS = process.env.BANK_LATENCY_MS || '20';
  const db = await import('../src/db.js');
  const svc = await import('../src/services.js');
  const seed = await import('../src/seed.js');
  const docs = await import('../src/documents.js');
  const crypto = await import('../src/crypto.js');
  await db.connectMongo();
  return { db, svc, seed, docs, crypto };
}
