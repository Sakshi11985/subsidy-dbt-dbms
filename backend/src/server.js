import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { pool, connectMongo, mongoStatus } from './db.js';
import * as svc from './services.js';
import { resetDatabase } from './seed.js';

const app = express();
app.use(cors());
app.use(express.json());

const h = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    const status = err.status || (err.code ? 409 : 500);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: err.message, blocked: err.blocked, eligibility: err.eligibility });
  }
};

app.get('/api/health', h(async () => {
  const { rows: [r] } = await pool.query("SELECT version(), (SELECT COUNT(*) FROM pg_tables WHERE schemaname='public') AS tables");
  return { postgres: { ok: true, version: r.version.split(' ').slice(0, 2).join(' '), tables: r.tables }, mongo: mongoStatus };
}));

app.get('/api/state', h(() => svc.getState()));

app.post('/api/citizens', h((req) => svc.registerCitizen(req.body, req.body.actor)));
app.post('/api/citizens/:id/freeze', h((req) => svc.setFrozen(req.params.id, req.body.frozen ?? true, req.body.officer_id)));
app.post('/api/parcels', h((req) => svc.upsertParcel(req.body)));
app.post('/api/ownership', h((req) => svc.addOwnership(req.body.parcel_id, req.body.citizen_id, req.body.share_fraction, req.body.actor)));

app.get('/api/eligibility', h((req) =>
  svc.checkEligibility(req.query.citizen_id, req.query.scheme_id, req.query.parcel_id, Number(req.query.cycle_year) || undefined)));

app.post('/api/applications', h((req) => svc.submitApplication(req.body, req.body.actor)));
app.post('/api/applications/:id/status', h((req) => svc.updateStatus(req.params.id, req.body.status, req.body.officer_id, req.body.notes)));
app.post('/api/applications/:id/approve', h((req) => svc.approveApplication(req.params.id, req.body.officer_id)));
app.post('/api/applications/:id/release-next', h((req) => svc.releaseNextInstalment(req.params.id, req.body.officer_id)));
app.post('/api/applications/:id/disburse', h((req) => svc.disburse(req.params.id, req.body.officer_id, { bankFails: !!req.body.simulate_bank_failure })));

app.post('/api/race', h((req) => svc.raceSimulation(req.body)));

app.post('/api/fraud/scan', h(() => svc.runFullScan()));
app.post('/api/fraud/inject', h((req) => svc.injectFraud(req.body.type)));
app.post('/api/fraud/:id/resolve', h((req) => svc.resolveFlag(req.params.id, req.body.officer_id || 'CHIEF_VIGILANCE_OFFICER_01', req.body.notes)));

app.post('/api/reset', h(() => resetDatabase({ quiet: true })));

await connectMongo();
console.log(mongoStatus.connected ? `MongoDB connected (${config.mongoUrl})` : `MongoDB NOT connected: ${mongoStatus.error}`);

// first run: build the schema + demo data if the database is empty
let t;
try {
  ({ rows: [t] } = await pool.query("SELECT to_regclass('public.applications') AS t"));
} catch (err) {
  console.error(`\nCannot connect to PostgreSQL at ${config.pgUrl.replace(/:[^:@/]+@/, ':****@')}\n  ${err.message}`);
  if (err.code === '3D000') console.error('  The database does not exist yet. Create it:  psql -U postgres -c "CREATE DATABASE subsidy_dbt;"');
  else console.error('  Is PostgreSQL running? (docker compose up -d)  Check DATABASE_URL in backend/.env');
  process.exit(1);
}
if (!t.t || process.env.RESET_ON_START === '1') {
  console.log(t.t ? 'RESET_ON_START=1: rebuilding schema and demo data...' : 'Database empty: building schema and demo data...');
  await resetDatabase();
} else if (mongoStatus.connected) {
  mongoStatus.validators = null; // unknown until the next reset creates the collections
}

app.listen(config.port, () => console.log(`API listening on http://localhost:${config.port}`));
