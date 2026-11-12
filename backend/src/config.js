import 'dotenv/config';
import crypto from 'node:crypto';

export const config = {
  port: Number(process.env.PORT || 4000),
  pgUrl: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/subsidy_dbt',
  mongoUrl: process.env.MONGO_URL || 'mongodb://localhost:27017',
  mongoDb: process.env.MONGO_DB || 'subsidy_dbt',
  // Secret key for the keyed Aadhaar hash. It lives here (in the API's
  // environment), never in the database, so a stolen DB dump cannot be
  // brute-forced over the ~10^12 possible Aadhaar numbers.
  hmacKey: process.env.AADHAAR_HMAC_KEY || 'dev-only-change-me',
  // Secret that signs login tokens. If SESSION_SECRET is not set, a random one
  // is made at startup (everyone simply logs in again after an API restart).
  sessionSecret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  // simulated bank (PFMS) latency, ms
  bankLatencyMs: Number(process.env.BANK_LATENCY_MS || 40),
};

if (config.hmacKey === 'dev-only-change-me' && process.env.NODE_ENV === 'production') {
  throw new Error('Set AADHAAR_HMAC_KEY in production');
}
