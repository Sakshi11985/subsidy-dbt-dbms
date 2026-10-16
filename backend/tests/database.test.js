// Integration tests: every guarantee the report claims, checked against a
// real PostgreSQL (and MongoDB when available).   npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { useScratchDatabase } from './helpers.js';

let db, svc, seed, docs, crypto, pool;
const q = (sql, p) => pool.query(sql, p);
const rejects = async (fn, re) => {
  try { await fn(); } catch (err) { if (re) assert.match(err.message, re); return err; }
  assert.fail('expected the database to refuse this');
};

before(async () => {
  ({ db, svc, seed, docs, crypto } = await useScratchDatabase('subsidy_test'));
  pool = db.pool;
  await seed.resetDatabase({ quiet: true });
});
after(async () => { await db.closeAll(); });

test('seed story produced the expected fraud flags through triggers', async () => {
  const { rows } = await q('SELECT flag_type, detected_by FROM FraudFlags ORDER BY flag_id');
  const by = rows.map((r) => `${r.flag_type}:${r.detected_by}`);
  assert.ok(by.includes('GHOST_BENEFICIARY_OVERALLOCATION:trg_check_parcel_share'));
  assert.ok(by.includes('DUPLICATE_BANK_ACCOUNT:trg_screen_new_citizen'));
  assert.ok(by.includes('DOCUMENT_REUSE_FUZZY_NAME:trg_screen_new_citizen'));
  if (db.mongoStatus.connected) assert.ok(by.includes('DOCUMENT_REUSE_FUZZY_NAME:mongo_aggregation'));
});

test('Aadhaar keyed hash in the API equals pgcrypto hmac()', async () => {
  const { rows: [r] } = await q("SELECT encode(hmac('234567894921', $1, 'sha256'), 'hex') AS h", [process.env.AADHAAR_HMAC_KEY || 'dev-only-change-me']);
  assert.equal(crypto.aadhaarHmac('2345 6789 4921'), r.h);
  const { rows: [c] } = await q("SELECT aadhaar_hmac FROM Citizens WHERE citizen_id='CIT-1001'");
  assert.equal(c.aadhaar_hmac, r.h);
});

test('quarantine: duplicate bank account is skipped but its flag is committed', async () => {
  const before = (await q('SELECT COUNT(*)::int n FROM Citizens')).rows[0].n;
  const r = await svc.registerCitizen({ full_name: 'Test Mule', aadhaar: '111122223333', phone: '1', annual_income: 1,
    bank_ifsc: 'SBIN0004123', bank_account_no: '30498172635', state: 'Uttar Pradesh', district: 'Varanasi' });
  assert.equal(r.quarantined, true);
  assert.equal(r.flag.flag_type, 'DUPLICATE_BANK_ACCOUNT');
  assert.equal((await q('SELECT COUNT(*)::int n FROM Citizens')).rows[0].n, before);
});

test('UNIQUE(bank_ifsc, bank_account_no) still blocks when the trigger is disabled', async () => {
  await q('ALTER TABLE Citizens DISABLE TRIGGER trg_screen_new_citizen');
  try {
    const err = await rejects(() => q(`INSERT INTO Citizens (full_name, aadhaar_masked, aadhaar_hmac, phone, annual_income, bank_ifsc, bank_account_no, state, district)
      VALUES ('X','XXXX-XXXX-0000', repeat('a',64), '1', 1, 'SBIN0004123', '30498172635', 'UP', 'V')`));
    assert.equal(err.code, '23505');
    assert.equal(err.constraint, 'uq_bank_account');
  } finally {
    await q('ALTER TABLE Citizens ENABLE TRIGGER trg_screen_new_citizen');
  }
});

test('same account number at a DIFFERENT bank is allowed (Fix 4)', async () => {
  const r = await svc.registerCitizen({ full_name: 'Different Bank Person', aadhaar: '222233334444', phone: '1', annual_income: 1,
    bank_ifsc: 'HDFC0000001', bank_account_no: '30498172635', state: 'Punjab', district: 'Ludhiana' });
  assert.equal(r.quarantined, false);
});

test('ghost beneficiary: shares above 100% are quarantined, joint ownership below is fine', async () => {
  const p = await svc.upsertParcel({ state: 'T', district: 'T', taluk: 'T', village: 'T', survey_no: '1', subdivision: '', area_acres: 2 });
  assert.equal((await svc.addOwnership(p.parcel_id, 'CIT-1001', 0.5)).quarantined, false);
  assert.equal((await svc.addOwnership(p.parcel_id, 'CIT-1002', 0.5)).quarantined, false);   // exactly 1.0: legal
  const bad = await svc.addOwnership(p.parcel_id, 'CIT-1003', 0.1);
  assert.equal(bad.quarantined, true);
  assert.equal(bad.flag.flag_type, 'GHOST_BENEFICIARY_OVERALLOCATION');
});

test('survey number 104 can exist in two villages (Fix 1)', async () => {
  const a = await svc.upsertParcel({ state: 'K', district: 'M', taluk: 'X', village: 'A', survey_no: '104', subdivision: '', area_acres: 1 });
  const b = await svc.upsertParcel({ state: 'K', district: 'M', taluk: 'X', village: 'B', survey_no: '104', subdivision: '', area_acres: 1 });
  assert.notEqual(a.parcel_id, b.parcel_id);
});

test('eligibility: no ownership on the parcel means NOT eligible (NULL bypass fixed)', async () => {
  const r = await svc.checkEligibility('CIT-1006', 'SCH-05', 'PARCEL-101');
  assert.equal(r.eligible, false);
  assert.match(r.message, /no recorded ownership/);
});

test('eligibility: income rule fails with the rule named', async () => {
  const r = await svc.checkEligibility('CIT-1003', 'SCH-01', 'PARCEL-105');
  assert.equal(r.eligible, false);
  assert.ok(r.rules.find((x) => x.rule_id === 'R1-2' && !x.passed));
});

test('one application per (citizen, scheme, cycle)', async () => {
  const err = await rejects(() => q(`INSERT INTO Applications (citizen_id, scheme_id, parcel_id, cycle_year)
    VALUES ('CIT-1001','SCH-01','PARCEL-102', extract(year from now())::int)`));
  assert.equal(err.constraint, 'uq_citizen_scheme_cycle');
});

test('applying with a parcel you do not own violates the ownership foreign key', async () => {
  const err = await rejects(() => q(`INSERT INTO Applications (citizen_id, scheme_id, parcel_id, cycle_year) VALUES ('CIT-1006','SCH-03','PARCEL-101', 2030)`));
  assert.equal(err.constraint, 'fk_app_ownership');
});

test('state machine: illegal jumps and leaving terminal states are refused', async () => {
  await rejects(() => q("UPDATE Applications SET status='paid' WHERE application_id='APP-2026-0005'"), /Illegal state transition submitted -> paid/);
  await rejects(() => svc.updateStatus('APP-2026-0001', 'rejected', 'OFFICER_VERIFIER_10', 'x'), /partially_paid -> rejected/);
});

test('separation of duties: the verifier cannot approve, even with approve rights', async () => {
  await rejects(() => svc.approveApplication('APP-2026-0003', 'BDO_07'), /cannot also approve/);
  await rejects(() => svc.approveApplication('APP-2026-0003', 'OFFICER_VERIFIER_10'), /not authorised to approve/);
});

test('ledger is append-only: UPDATE, DELETE and TRUNCATE are refused', async () => {
  await rejects(() => q('UPDATE Disbursals SET amount = 1'), /append-only/);
  await rejects(() => q('DELETE FROM Disbursals'), /append-only/);
  await rejects(() => q('TRUNCATE Disbursals CASCADE'), /append-only/);
});

test('bank failure returns the application to approved; retry pays exactly once; complete_payment is idempotent', async () => {
  const fail = await svc.disburse('APP-2026-0007', 'OFFICER_APPROVER_02', { bankFails: true });
  assert.equal(fail.disbursal_id, null);
  assert.equal((await q("SELECT status FROM Applications WHERE application_id='APP-2026-0007'")).rows[0].status, 'approved');
  const ok = await svc.disburse('APP-2026-0007', 'OFFICER_APPROVER_02');
  assert.ok(ok.disbursal_id);
  assert.notEqual(ok.attempt.txn_ref, fail.attempt.txn_ref);
  const replay = await q('SELECT complete_payment($1, true) AS r', [ok.attempt.txn_ref]);
  assert.equal(replay.rows[0].r, 'ALREADY_SUCCESS');
  assert.equal((await q("SELECT COUNT(*)::int n FROM Disbursals WHERE application_id='APP-2026-0007'")).rows[0].n, 1);
  assert.equal((await q("SELECT status FROM Applications WHERE application_id='APP-2026-0007'")).rows[0].status, 'partially_paid');
});

test('the verifier cannot release payment either', async () => {
  await q("UPDATE Applications SET status='approved' WHERE application_id='APP-2026-0007'"); // release instalment 2
  await rejects(() => svc.disburse('APP-2026-0007', 'OFFICER_VERIFIER_11'), /not authorised to disburse/);
});

test('race, real path: 25 concurrent payers -> exactly one ledger row', async () => {
  const r = await svc.raceSimulation({ application_id: 'APP-2026-0002', workers: 25, mode: 'safe' });
  assert.equal(r.successCount, 1);
  assert.equal(r.ledgerRows, 1);
  assert.equal(r.blockedCount, 24);
  assert.deepEqual(Object.keys(r.blockedBy), ['initiate_payment']);
});

test('race, no lock: the UNIQUE constraint alone still stops duplicates', async () => {
  await svc.releaseNextInstalment('APP-2026-0002', 'OFFICER_APPROVER_05');
  const r = await svc.raceSimulation({ application_id: 'APP-2026-0002', workers: 25, mode: 'no_lock' });
  assert.equal(r.ledgerRows, 1);
  assert.ok((r.blockedBy['UNIQUE uq_application_instalment'] || 0) >= 1);
});

test('race, no lock and no UNIQUE: duplicates really happen (teaching table)', async () => {
  await svc.releaseNextInstalment('APP-2026-0002', 'OFFICER_APPROVER_05');
  const r = await svc.raceSimulation({ application_id: 'APP-2026-0002', workers: 25, mode: 'no_defence' });
  assert.ok(r.ledgerRows > 1, `expected duplicates, got ${r.ledgerRows}`);
  assert.equal(r.leakage, (r.ledgerRows - 1) * 2000);
});

test('RLS: a citizen session sees only its own rows', async () => {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE citizen_role');
    await c.query("SELECT set_config('app.current_citizen_id', 'CIT-1002', true)");
    const cit = await c.query('SELECT citizen_id FROM Citizens');
    const apps = await c.query('SELECT DISTINCT citizen_id FROM Applications');
    assert.deepEqual(cit.rows.map((r) => r.citizen_id), ['CIT-1002']);
    assert.deepEqual(apps.rows.map((r) => r.citizen_id), ['CIT-1002']);
    await c.query('ROLLBACK');
  } finally { c.release(); }
});

test('column privilege: agent_role cannot set approved_by', async () => {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE agent_role');
    const err = await rejects(() => c.query("UPDATE Applications SET approved_by='OFFICER_APPROVER_02' WHERE application_id='APP-2026-0005'"));
    assert.equal(err.code, '42501');
    await c.query('ROLLBACK');
  } finally { c.release(); }
});

test('audit trigger records the acting officer from app.actor', async () => {
  const { rows } = await q(`SELECT performed_by FROM AuditLog
    WHERE entity_name='applications' AND entity_id='APP-2026-0003' AND new_state->>'status'='verified'`);
  assert.equal(rows[0].performed_by, 'BDO_07');
});

test('MongoDB: aggregation catches a rescanned Aadhaar used by another citizen; file hash alone does not', { skip: false }, async (t) => {
  if (!db.mongoStatus.connected) return t.skip('MongoDB not running');
  const groups = await docs.findReusedIdentityDocuments();
  const owner = (await q("SELECT aadhaar_hmac FROM Citizens WHERE citizen_id='CIT-1004'")).rows[0].aadhaar_hmac;
  const g = groups.find((x) => x._id === owner);
  assert.ok(g, 'reuse group missing');
  assert.deepEqual([...g.citizens].sort(), ['CIT-1004', 'CIT-1005']);
  assert.ok(g.files.length > 1, 'should be different file bytes (a rescan)');
  assert.equal((await docs.findReusedFilesByBytes()).length, 0);
});

test('agent_role can start a review, and the change is still audited (SECURITY DEFINER trigger)', async () => {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE agent_role');
    await c.query("SELECT set_config('app.actor', 'AGENT_SESSION', true)");
    const r = await c.query("UPDATE Applications SET status='under_review' WHERE application_id='APP-2026-0005'");
    assert.equal(r.rowCount, 1);
    await c.query('RESET ROLE');
    const a = await c.query("SELECT performed_by FROM AuditLog WHERE entity_id='APP-2026-0005' ORDER BY log_id DESC LIMIT 1");
    assert.equal(a.rows[0].performed_by, 'AGENT_SESSION');
    await c.query('ROLLBACK');
  } finally { c.release(); }
});
