import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { pool, connectMongo, mongoStatus } from './db.js';
import * as svc from './services.js';
import { resetDatabase } from './seed.js';
import { login, authenticate, allow, actAsSelf, filterStateFor } from './auth.js';

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

// ---------------------------------------------------------------- public
app.get('/api/health', h(async () => {
  const { rows: [r] } = await pool.query("SELECT version(), (SELECT COUNT(*) FROM pg_tables WHERE schemaname='public') AS tables");
  return { postgres: { ok: true, version: r.version.split(' ').slice(0, 2).join(' '), tables: r.tables }, mongo: mongoStatus };
}));
app.post('/api/login', h((req) => login(req.body.username, req.body.password)));

// ------------------------------------------- everything below needs a login
app.use('/api', authenticate);
app.get('/api/me', h((req) => req.user));

// A citizen may only act on their own records.
const ownCitizen = (req, res, next) => {
  if (req.user.app_role !== 'citizen') return next();
  const asked = req.body.citizen_id || req.query.citizen_id;
  if (asked && asked !== req.user.citizen_id) {
    return res.status(403).json({ error: `You are logged in as ${req.user.citizen_id}; you cannot act for ${asked}` });
  }
  next();
};
const actor = (req) => req.user.officer_id || req.user.citizen_id || req.user.username.toUpperCase();

app.get('/api/state', h(async (req) => filterStateFor(req.user, await svc.getState())));

// registration desk (admin)
app.post('/api/citizens', allow(), h((req) => svc.registerCitizen(req.body, req.body.actor || actor(req))));
app.post('/api/parcels', allow(), h((req) => svc.upsertParcel(req.body)));
app.post('/api/ownership', allow(), h((req) => svc.addOwnership(req.body.parcel_id, req.body.citizen_id, req.body.share_fraction, req.body.actor || actor(req))));

// citizen / farmer
app.get('/api/eligibility', allow('citizen'), ownCitizen, h((req) =>
  svc.checkEligibility(req.query.citizen_id, req.query.scheme_id, req.query.parcel_id, Number(req.query.cycle_year) || undefined)));
app.post('/api/applications', allow('citizen'), ownCitizen, h((req) => svc.submitApplication(req.body, actor(req))));
app.delete('/api/applications/:id', allow('citizen'), h((req) =>
  svc.withdrawApplication(req.params.id, actor(req), { citizenId: req.user.app_role === 'citizen' ? req.user.citizen_id : undefined })));

// verifying agent
app.post('/api/applications/:id/status', allow('verifier'), actAsSelf, h((req) => svc.updateStatus(req.params.id, req.body.status, req.body.officer_id, req.body.notes)));

// approval & payment
app.post('/api/applications/:id/approve', allow('approver'), actAsSelf, h((req) => svc.approveApplication(req.params.id, req.body.officer_id)));
app.post('/api/applications/:id/release-next', allow('approver'), actAsSelf, h((req) => svc.releaseNextInstalment(req.params.id, req.body.officer_id)));
app.post('/api/applications/:id/disburse', allow('approver'), actAsSelf, h((req) => svc.disburse(req.params.id, req.body.officer_id, { bankFails: !!req.body.simulate_bank_failure })));
app.post('/api/race', allow('approver'), actAsSelf, h((req) => svc.raceSimulation(req.body)));

// vigilance
app.post('/api/citizens/:id/freeze', allow('vigilance'), h((req) => svc.setFrozen(req.params.id, req.body.frozen ?? true, req.body.officer_id || actor(req))));
app.post('/api/fraud/scan', allow('vigilance'), h(() => svc.runFullScan()));
app.post('/api/fraud/inject', allow('vigilance'), h((req) => svc.injectFraud(req.body.type)));
app.post('/api/fraud/:id/resolve', allow('vigilance'), h((req) => svc.resolveFlag(req.params.id, req.body.officer_id || 'CHIEF_VIGILANCE_OFFICER_01', req.body.notes)));

// admin
app.post('/api/reset', allow(), h(() => resetDatabase({ quiet: true })));

await connectMongo();
console.log(mongoStatus.connected ? `MongoDB connected (${config.mongoUrl})` : `MongoDB NOT connected: ${mongoStatus.error}`);

// first run: build the schema + demo data if the database is empty
let t;
try {
  ({ rows: [t] } = await pool.query("SELECT to_regclass('public.applications') AS t, to_regclass('public.appusers') AS u"));
} catch (err) {
  console.error(`\nCannot connect to PostgreSQL at ${config.pgUrl.replace(/:[^:@/]+@/, ':****@')}\n  ${err.message}`);
  if (err.code === '3D000') console.error('  The database does not exist yet. Create it:  psql -U postgres -c "CREATE DATABASE subsidy_dbt;"');
  else console.error('  Is PostgreSQL running? (docker compose up -d)  Check DATABASE_URL in backend/.env');
  process.exit(1);
}
if (!t.t || !t.u || process.env.RESET_ON_START === '1') {
  console.log(!t.t ? 'Database empty: building schema and demo data...'
    : !t.u ? 'Database was built by an older version (no login table): rebuilding schema and demo data...'
    : 'RESET_ON_START=1: rebuilding schema and demo data...');
  await resetDatabase();
} else if (mongoStatus.connected) {
  mongoStatus.validators = null; // unknown until the next reset creates the collections
}

app.listen(config.port, () => console.log(`API listening on http://localhost:${config.port}`));
