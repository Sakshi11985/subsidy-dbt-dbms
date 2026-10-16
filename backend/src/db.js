import pg from 'pg';
import { MongoClient } from 'mongodb';
import { config } from './config.js';

// NUMERIC -> JS number (amounts here are far below 2^53, so this is safe)
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v))); // BIGINT

export const pool = new pg.Pool({ connectionString: config.pgUrl, max: 60 });

/**
 * Run fn(client) inside one transaction. `actor` is written to the
 * transaction-local setting app.actor, which the audit trigger reads.
 */
export async function withTx(actor, fn, { isolation } = {}) {
  const client = await pool.connect();
  try {
    await client.query(isolation ? `BEGIN ISOLATION LEVEL ${isolation}` : 'BEGIN');
    await client.query("SELECT set_config('app.actor', $1, true)", [actor || 'system']);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------- MongoDB
let mongoClient = null;
let mongoDb = null;
export let mongoStatus = { connected: false, error: null, validators: false };

export async function connectMongo() {
  try {
    mongoClient = new MongoClient(config.mongoUrl, { serverSelectionTimeoutMS: 3000 });
    await mongoClient.connect();
    mongoDb = mongoClient.db(config.mongoDb);
    await mongoDb.command({ ping: 1 });
    mongoStatus = { connected: true, error: null, validators: false };
  } catch (err) {
    mongoStatus = { connected: false, error: err.message, validators: false };
    mongoDb = null;
  }
  return mongoStatus;
}

export function mongo() {
  if (!mongoDb) {
    const e = new Error(`MongoDB is not connected (${mongoStatus.error || 'not started'}). Start MongoDB and restart the API.`);
    e.status = 503;
    throw e;
  }
  return mongoDb;
}

export async function closeAll() {
  await pool.end().catch(() => {});
  if (mongoClient) await mongoClient.close().catch(() => {});
}

// ------------------------------------------------- error classification
/** Map a PostgreSQL error to the audit status + a readable explanation. */
export function classifyPgError(err) {
  const code = err.code;
  let status = 'BLOCKED_BY_TRIGGER';
  let mechanism = err.hint || 'database';
  if (code === '23505') { status = 'BLOCKED_BY_CONSTRAINT'; mechanism = `UNIQUE ${err.constraint || ''}`.trim(); }
  else if (code === '23503') { status = 'BLOCKED_BY_CONSTRAINT'; mechanism = `FOREIGN KEY ${err.constraint || ''}`.trim(); }
  else if (code === '23514' && err.constraint) { status = 'BLOCKED_BY_CONSTRAINT'; mechanism = `CHECK ${err.constraint}`; }
  else if (code === '55P03') { status = 'BLOCKED_BY_LOCK'; }
  return { status, mechanism, code, message: err.message, detail: err.detail || null };
}

export class ApiError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    Object.assign(this, extra);
  }
}
