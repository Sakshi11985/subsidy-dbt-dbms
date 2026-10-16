// Domain operations. Every rule that matters (eligibility, state machine,
// separation of duties, exactly-once payment, fraud screening) is enforced
// INSIDE PostgreSQL; this layer only calls it, reports what the database
// decided, and keeps MongoDB's document metadata in step.
import { pool, withTx, classifyPgError, ApiError, mongoStatus } from './db.js';
import { aadhaarHmac, maskAadhaar, fileSha256 } from './crypto.js';
import * as docs from './documents.js';
import { config } from './config.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const IST = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});
export function fmt(d, withSeconds = false) {
  if (!d) return undefined;
  const p = Object.fromEntries(IST.formatToParts(new Date(d)).map((x) => [x.type, x.value]));
  const hh = p.hour === '24' ? '00' : p.hour;
  return `${p.year}-${p.month}-${p.day} ${hh}:${p.minute}${withSeconds ? `:${p.second}` : ''}`;
}

/** Record an attempt the database refused. Runs in its own transaction
 *  because the failed transaction (and its audit row) was rolled back. */
export async function logBlocked(entityName, entityId, action, actor, info, extra = {}) {
  await pool.query(
    `INSERT INTO AuditLog (entity_name, entity_id, action, performed_by, new_state, status)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [entityName, entityId, action, actor || 'system',
      JSON.stringify({ blocked_by: info.mechanism, error: info.message, ...extra }), info.status],
  );
}

async function blocked(entityName, entityId, action, actor, err, extra) {
  if (!err.code) throw err; // not a database refusal
  const info = classifyPgError(err);
  await logBlocked(entityName, entityId, action, actor, info, extra);
  return new ApiError(409, err.message, { blocked: info });
}

// --------------------------------------------------------------- citizens
export async function registerCitizen(input, actor = 'REGISTRATION_DESK') {
  const hmac = aadhaarHmac(input.aadhaar);
  const params = [input.full_name?.trim(), maskAadhaar(input.aadhaar), hmac, input.phone, Number(input.annual_income),
    String(input.bank_ifsc).toUpperCase(), String(input.bank_account_no), input.state, input.district];
  try {
    const res = await withTx(actor, (c) => c.query(
      `INSERT INTO Citizens (full_name, aadhaar_masked, aadhaar_hmac, phone, annual_income, bank_ifsc, bank_account_no, state, district)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, params));
    if (res.rowCount === 1) {
      const flag = await pool.query(
        `SELECT * FROM FraudFlags WHERE evidence->>'new_citizen' = $1 ORDER BY detected_at DESC LIMIT 1`, [res.rows[0].citizen_id]);
      return { citizen: res.rows[0], flag: flag.rows[0] || null, quarantined: false };
    }
    // BEFORE trigger returned NULL: the row was quarantined and a flag raised
    const flag = await pool.query(
      `SELECT * FROM FraudFlags
        WHERE evidence->'attempted'->>'aadhaar_hmac' = $1
           OR (evidence->'attempted'->>'bank_ifsc' = $2 AND evidence->'attempted'->>'bank_account_no' = $3)
        ORDER BY detected_at DESC LIMIT 1`, [hmac, params[5], params[6]]);
    await logBlocked('Citizens', params[1], 'INSERT', actor,
      { status: 'BLOCKED_BY_TRIGGER', mechanism: 'trg_screen_new_citizen', message: flag.rows[0]?.details || 'quarantined' });
    return { citizen: null, flag: flag.rows[0] || null, quarantined: true };
  } catch (err) {
    throw await blocked('Citizens', params[1], 'INSERT', actor, err);
  }
}

// ------------------------------------------------------------------ land
export async function upsertParcel(p) {
  const res = await pool.query(
    `INSERT INTO LandParcels (state, district, taluk, village, survey_no, subdivision, area_acres)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT ON CONSTRAINT uq_parcel_location DO NOTHING RETURNING *`,
    [p.state, p.district, p.taluk, p.village, String(p.survey_no), p.subdivision || '', Number(p.area_acres)]);
  if (res.rowCount) return res.rows[0];
  const ex = await pool.query(
    `SELECT * FROM LandParcels WHERE state=$1 AND district=$2 AND taluk=$3 AND village=$4 AND survey_no=$5 AND subdivision=$6`,
    [p.state, p.district, p.taluk, p.village, String(p.survey_no), p.subdivision || '']);
  return ex.rows[0];
}

export async function addOwnership(parcelId, citizenId, share, actor = 'LAND_RECORDS_DESK') {
  try {
    const res = await withTx(actor, (c) => c.query(
      `INSERT INTO LandOwnership (parcel_id, citizen_id, share_fraction) VALUES ($1,$2,$3) RETURNING *`,
      [parcelId, citizenId, Number(share)]));
    if (res.rowCount === 1) return { ownership: res.rows[0], quarantined: false };
    const flag = await pool.query(
      `SELECT * FROM FraudFlags WHERE evidence->'attempted'->>'parcel_id' = $1 AND evidence->'attempted'->>'citizen_id' = $2
        ORDER BY detected_at DESC LIMIT 1`, [parcelId, citizenId]);
    await logBlocked('LandOwnership', `${parcelId}/${citizenId}`, 'INSERT', actor,
      { status: 'BLOCKED_BY_TRIGGER', mechanism: 'trg_check_parcel_share', message: flag.rows[0]?.details || 'quarantined' });
    return { ownership: null, quarantined: true, flag: flag.rows[0] || null };
  } catch (err) {
    throw await blocked('LandOwnership', `${parcelId}/${citizenId}`, 'INSERT', actor, err);
  }
}

// ----------------------------------------------------------- eligibility
export async function checkEligibility(citizenId, schemeId, parcelId, cycleYear = new Date().getFullYear()) {
  const { rows } = await pool.query('SELECT * FROM check_citizen_eligibility($1,$2,$3)', [citizenId, schemeId, parcelId]);
  const dup = await pool.query(
    'SELECT application_id, status FROM Applications WHERE citizen_id=$1 AND scheme_id=$2 AND cycle_year=$3',
    [citizenId, schemeId, cycleYear]);
  const failed = rows.filter((r) => !r.passed);
  const result = {
    eligible: failed.length === 0 && dup.rowCount === 0,
    rules: rows,
    duplicate: dup.rows[0] || null,
  };
  if (dup.rowCount) {
    result.message = `UNIQUE(citizen_id, scheme_id, cycle_year) would block this: ${citizenId} already has ${dup.rows[0].application_id} (${dup.rows[0].status}) for cycle ${cycleYear}.`;
  } else if (failed.length) {
    result.message = `check_citizen_eligibility() failed on ${failed[0].attribute}: ${failed[0].message}`;
  } else {
    result.message = rows.length
      ? `check_citizen_eligibility() passed all ${rows.length} rule(s): ${rows.map((r) => r.message).join(' | ')}`
      : 'Scheme has no eligibility rules; eligible by default.';
  }
  return result;
}

// ------------------------------------------------------------ documents
const DOC_LABEL = {
  AADHAAR: 'Aadhaar', LAND_KHASRA: 'Khasra_Khatauni', RTC_PAHANI: 'RTC_Pahani', JAMABANDI: 'Jamabandi_Fard',
  INCOME_CERT: 'Income_Certificate', BANK_PASSBOOK: 'Bank_Passbook', QUOTATION: 'Dealer_Quotation', SITE_PHOTO: 'Site_Photo',
};

/** Land-record documents differ by state: one reason this data lives in MongoDB. */
export function landRecordType(state) {
  return { Karnataka: 'RTC_PAHANI', Punjab: 'JAMABANDI', Haryana: 'JAMABANDI' }[state] || 'LAND_KHASRA';
}

/** Simulated upload + OCR: builds the metadata a real upload pipeline would extract. */
export function buildDocument(type, citizen, parcelKey, { aadhaarHmacOverride, scanNo = 1 } = {}) {
  const extracted = {};
  if (type === 'AADHAAR') extracted.aadhaar_hmac = aadhaarHmacOverride || citizen.aadhaar_hmac;
  if (['LAND_KHASRA', 'RTC_PAHANI', 'JAMABANDI'].includes(type)) extracted.parcel_key = parcelKey;
  if (type === 'INCOME_CERT') extracted.annual_income = Number(citizen.annual_income);
  if (type === 'BANK_PASSBOOK') { extracted.ifsc = citizen.bank_ifsc; extracted.account_no = citizen.bank_account_no; }
  return {
    doc_type: type,
    file_name: `${DOC_LABEL[type] || type}_${citizen.citizen_id}${scanNo > 1 ? `_scan${scanNo}` : ''}.pdf`,
    file_sha256: fileSha256(`${type}|${citizen.citizen_id}|${parcelKey}|scan${scanNo}|${Math.random()}`),
    extracted,
    uploaded_at: new Date(),
    verified: false,
  };
}

// ---------------------------------------------------------- applications
export async function submitApplication({ citizen_id, scheme_id, parcel_id, cycle_year }, actor) {
  const cycle = Number(cycle_year) || new Date().getFullYear();
  actor = actor || citizen_id;
  const elig = await checkEligibility(citizen_id, scheme_id, parcel_id, cycle);
  if (!elig.eligible) {
    await logBlocked('Applications', `${citizen_id}/${scheme_id}/${cycle}`, 'INSERT', actor,
      { status: elig.duplicate ? 'BLOCKED_BY_CONSTRAINT' : 'BLOCKED_BY_TRIGGER',
        mechanism: elig.duplicate ? 'UNIQUE uq_citizen_scheme_cycle' : 'check_citizen_eligibility()', message: elig.message });
    throw new ApiError(422, elig.message, { eligibility: elig });
  }
  let app;
  try {
    app = await withTx(actor, async (c) => {
      // re-check inside the transaction (the citizen's data could have changed)
      const again = await c.query('SELECT bool_and(passed) AS ok FROM check_citizen_eligibility($1,$2,$3)', [citizen_id, scheme_id, parcel_id]);
      if (again.rows[0].ok === false) throw new ApiError(422, 'Eligibility changed during submission');
      const r = await c.query(
        `INSERT INTO Applications (citizen_id, scheme_id, parcel_id, cycle_year) VALUES ($1,$2,$3,$4) RETURNING *`,
        [citizen_id, scheme_id, parcel_id, cycle]);
      return r.rows[0];
    });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw await blocked('Applications', `${citizen_id}/${scheme_id}/${cycle}`, 'INSERT', actor, err);
  }

  // PostgreSQL has committed; now the document metadata goes to MongoDB.
  let warning = null;
  try {
    const { rows: [ctx] } = await pool.query(
      `SELECT c.*, s.scheme_code, s.required_documents, o.parcel_key
         FROM Citizens c, Schemes s, v_ownership o
        WHERE c.citizen_id=$1 AND s.scheme_id=$2 AND o.citizen_id=$1 AND o.parcel_id=$3`, [citizen_id, scheme_id, parcel_id]);
    await docs.insertUpload({
      application_id: app.application_id, citizen_id, scheme_id, scheme_code: ctx.scheme_code,
      documents: ctx.required_documents.map((t) => buildDocument(t === 'LAND_RECORD' ? landRecordType(ctx.state) : t, ctx, ctx.parcel_key)),
      verification_status: 'pending', verified_by: null, created_at: new Date(),
    });
  } catch (err) {
    // No cross-database transaction exists. The application (source of truth)
    // stays; the missing document set is visible to the verifier.
    warning = `Application saved, but document metadata could not be written to MongoDB: ${err.message}`;
  }
  return { application: app, eligibility: elig, warning };
}

export async function updateStatus(appId, newStatus, officerId, notes) {
  const allowed = ['under_review', 'verified', 'rejected'];
  if (!allowed.includes(newStatus)) throw new ApiError(400, `Verifier desk can only set ${allowed.join(', ')}`);
  let row;
  try {
    row = await withTx(officerId, async (c) => {
      let r;
      if (newStatus === 'verified') {
        r = await c.query(`UPDATE Applications SET status='verified', verified_by=$2 WHERE application_id=$1 RETURNING *`, [appId, officerId]);
      } else if (newStatus === 'rejected') {
        r = await c.query(`UPDATE Applications SET status='rejected', rejection_reason=$2 WHERE application_id=$1 RETURNING *`,
          [appId, notes || `Rejected by ${officerId}`]);
      } else {
        // starting a review also requires a verifier-capable officer
        const ok = await c.query('SELECT 1 FROM Officers WHERE officer_id=$1 AND can_verify', [officerId]);
        if (!ok.rowCount) {
          throw Object.assign(new Error(`Officer ${officerId} is not authorised to verify applications`),
            { code: '42501', hint: 'Officers.can_verify' });
        }
        r = await c.query(`UPDATE Applications SET status='under_review' WHERE application_id=$1 RETURNING *`, [appId]);
      }
      if (!r.rowCount) throw new ApiError(404, `Application ${appId} not found`);
      return r.rows[0];
    });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw await blocked('Applications', appId, 'UPDATE', officerId, err, { attempted_status: newStatus });
  }
  let warning = null;
  try {
    if (newStatus !== 'under_review') await docs.markVerification(appId, newStatus, officerId);
    await docs.logVerification(appId, officerId, newStatus === 'under_review' ? 'reviewed' : newStatus, notes || null);
  } catch (err) {
    warning = `Status saved in PostgreSQL; MongoDB verification log failed: ${err.message}`;
  }
  return { application: row, warning };
}

export async function approveApplication(appId, officerId) {
  try {
    const row = await withTx(officerId, async (c) => {
      const r = await c.query(
        `UPDATE Applications SET status='approved', approved_by=$2 WHERE application_id=$1 RETURNING *`, [appId, officerId]);
      if (!r.rowCount) throw new ApiError(404, `Application ${appId} not found`);
      return r.rows[0];
    });
    await docs.logVerification(appId, officerId, 'approved').catch(() => {});
    return { application: row };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw await blocked('Applications', appId, 'UPDATE', officerId, err, { attempted_status: 'approved' });
  }
}

export async function releaseNextInstalment(appId, officerId) {
  try {
    const row = await withTx(officerId, async (c) => {
      const ok = await c.query('SELECT 1 FROM Officers WHERE officer_id=$1 AND can_approve', [officerId]);
      if (!ok.rowCount) {
        throw Object.assign(new Error(`Officer ${officerId} is not authorised to release instalments`),
          { code: '42501', hint: 'Officers.can_approve' });
      }
      const r = await c.query(`UPDATE Applications SET status='approved' WHERE application_id=$1 RETURNING *`, [appId]);
      if (!r.rowCount) throw new ApiError(404, `Application ${appId} not found`);
      return r.rows[0];
    });
    return { application: row };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw await blocked('Applications', appId, 'UPDATE', officerId, err, { attempted_status: 'approved (next instalment)' });
  }
}

// --------------------------------------------------------------- payment
/** Stand-in for the external PFMS bank API. Idempotent on txnRef. */
const bankSeen = new Map();
async function callBank(txnRef, { fail = false } = {}) {
  await sleep(config.bankLatencyMs);
  if (bankSeen.has(txnRef)) return bankSeen.get(txnRef);
  const res = fail ? { ok: false, reason: 'Beneficiary bank rejected credit (simulated)' } : { ok: true };
  bankSeen.set(txnRef, res);
  return res;
}

/** Two short transactions around the external call (Fix 9). */
export async function disburse(appId, officerId, { bankFails = false, trace } = {}) {
  let attempt;
  try {
    attempt = await withTx(officerId, async (c) => {
      trace?.('BEGIN; SELECT ... FROM Applications WHERE application_id = $1 AND status = \'approved\' FOR UPDATE');
      const r = await c.query('SELECT * FROM initiate_payment($1, $2)', [appId, officerId]);
      return r.rows[0];
    });
  } catch (err) {
    throw await blocked('Disbursals', appId, 'DISBURSAL_ATTEMPT', officerId, err);
  }
  trace?.(`COMMIT (status -> payment_initiated, instalment #${attempt.instalment_no}, ${attempt.txn_ref}); calling bank...`);
  const bank = await callBank(attempt.txn_ref, { fail: bankFails });
  const result = await withTx(officerId, (c) =>
    c.query('SELECT complete_payment($1, $2, $3) AS result', [attempt.txn_ref, bank.ok, bank.reason || null]));
  const out = result.rows[0].result;
  trace?.(bank.ok ? `bank OK; complete_payment() wrote ledger row ${out}` : `bank FAILED; status back to approved for retry`);
  return { attempt, bank, disbursal_id: bank.ok ? out : null };
}

// --------------------------------------------------- race-condition lab
/**
 * Fire `workers` concurrent payment attempts at one application, each on its
 * own database connection, released at the same instant.
 *  mode 'safe'        : the real path (FOR UPDATE lock + UNIQUE ledger)
 *  mode 'no_lock'     : careless code with no FOR UPDATE; only the UNIQUE
 *                       (application_id, instalment_no) constraint protects
 *  mode 'no_defence'  : no lock AND no unique constraint (writes to the
 *                       RaceDemoLedger teaching table, never to real money)
 */
export async function raceSimulation({ application_id, workers = 15, mode = 'safe', officer_id = 'OFFICER_APPROVER_02' }) {
  workers = Math.max(2, Math.min(40, Number(workers) || 15));
  const { rows: [app] } = await pool.query(
    `SELECT a.*, s.benefit_amount, s.instalments_count,
            (SELECT COUNT(*) FROM Disbursals d WHERE d.application_id = a.application_id) AS paid_count
       FROM Applications a JOIN Schemes s USING (scheme_id) WHERE a.application_id = $1`, [application_id]);
  if (!app) throw new ApiError(404, `Application ${application_id} not found`);
  if (app.status !== 'approved') {
    throw new ApiError(409, `Application ${application_id} is '${app.status}'. The race needs an 'approved' application (approve one, or release its next instalment).`);
  }

  const runId = `RACE-${Date.now()}`;
  const t0 = performance.now();
  const logs = [];
  const log = (w, msg) => logs.push({ t: Math.round(performance.now() - t0), worker: w, msg });
  const ledgerBefore = mode === 'no_defence'
    ? 0
    : Number((await pool.query('SELECT COUNT(*) FROM Disbursals WHERE application_id=$1', [application_id])).rows[0].count);

  // connect every worker first, then release them together
  const clients = await Promise.all(Array.from({ length: workers }, () => pool.connect()));
  let go;
  const barrier = new Promise((r) => { go = r; });

  const runWorker = async (i) => {
    const w = i + 1;
    const c = clients[i];
    await barrier;
    try {
      if (mode === 'safe') {
        c.release(); clients[i] = null; // disburse() takes its own connections
        const r = await disburse(application_id, officer_id, { trace: (m) => log(w, m) });
        return { worker: w, ok: true, detail: `paid instalment #${r.attempt.instalment_no} (${r.disbursal_id})` };
      }
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.actor', $1, true)", [`RACE_WORKER_${w}`]);
      log(w, "BEGIN; SELECT status FROM Applications WHERE application_id = $1  -- no FOR UPDATE");
      const s = await c.query(
        `SELECT a.status, (SELECT COUNT(*) FROM Disbursals d WHERE d.application_id=a.application_id) AS paid
           FROM Applications a WHERE application_id=$1`, [application_id]);
      if (s.rows[0].status !== 'approved') {
        await c.query('ROLLBACK');
        log(w, `saw status '${s.rows[0].status}', gave up`);
        return { worker: w, ok: false, detail: `saw status ${s.rows[0].status}` };
      }
      const inst = Number(s.rows[0].paid) + 1;
      log(w, `saw 'approved' -> will pay instalment #${inst}`);
      await c.query('SELECT pg_sleep(0.05)'); // the "check then act" gap a real network call would create
      if (mode === 'no_defence') {
        await c.query(
          'INSERT INTO RaceDemoLedger (run_id, application_id, instalment_no, amount, worker_no) VALUES ($1,$2,$3,$4,$5)',
          [runId, application_id, inst, app.benefit_amount, w]);
        await c.query('COMMIT');
        log(w, `INSERT INTO RaceDemoLedger ... COMMIT  -> money sent`);
        return { worker: w, ok: true, detail: `paid instalment #${inst} (unprotected ledger)` };
      }
      // mode no_lock: real tables, so only the constraints stand in the way
      const ref = `PFMS/${app.cycle_year}/${application_id}/I${inst}/W${w}-${runId}`;
      await c.query(
        `INSERT INTO PaymentAttempts (application_id, instalment_no, amount, txn_ref, status, initiated_by, completed_at)
         VALUES ($1,$2,$3,$4,'SUCCESS',$5, now())`, [application_id, inst, app.benefit_amount, ref, officer_id]);
      const { rows: [cit] } = await c.query(
        'SELECT bank_ifsc, bank_account_no FROM Citizens WHERE citizen_id=$1', [app.citizen_id]);
      log(w, `INSERT INTO Disbursals (application_id, instalment_no=${inst}, ...)`);
      await c.query(
        `INSERT INTO Disbursals (application_id, instalment_no, amount, bank_ifsc, bank_account_no, txn_ref, disbursed_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [application_id, inst, app.benefit_amount, cit.bank_ifsc, cit.bank_account_no, ref, officer_id]);
      const next = inst >= app.instalments_count ? 'paid' : 'partially_paid';
      await c.query("UPDATE Applications SET status='payment_initiated' WHERE application_id=$1", [application_id]);
      await c.query(`UPDATE Applications SET status=$2 WHERE application_id=$1`, [application_id, next]);
      await c.query('COMMIT');
      log(w, `COMMIT -> instalment #${inst} paid`);
      return { worker: w, ok: true, detail: `paid instalment #${inst}` };
    } catch (err) {
      if (mode !== 'safe') await c.query('ROLLBACK').catch(() => {});
      const info = err.blocked || classifyPgError(err);
      log(w, `BLOCKED by ${info.mechanism}: ${err.message}`);
      return { worker: w, ok: false, detail: err.message, blocked_by: info.mechanism, status: info.status };
    } finally {
      if (clients[i]) { clients[i].release(); clients[i] = null; }
    }
  };

  const promises = clients.map((_, i) => runWorker(i));
  log(0, `${workers} workers connected; releasing all at once (mode=${mode})`);
  go();
  const outcomes = await Promise.all(promises);

  let ledgerRows;
  if (mode === 'no_defence') {
    ledgerRows = Number((await pool.query('SELECT COUNT(*) FROM RaceDemoLedger WHERE run_id=$1', [runId])).rows[0].count);
  } else {
    ledgerRows = Number((await pool.query('SELECT COUNT(*) FROM Disbursals WHERE application_id=$1', [application_id])).rows[0].count) - ledgerBefore;
  }
  const successCount = outcomes.filter((o) => o.ok).length;
  const blockedOutcomes = outcomes.filter((o) => !o.ok);
  const blockedBy = {};
  for (const o of blockedOutcomes) blockedBy[o.blocked_by || 'saw non-approved status'] = (blockedBy[o.blocked_by || 'saw non-approved status'] || 0) + 1;
  const duplicatePayouts = Math.max(0, ledgerRows - 1);

  await pool.query(
    `INSERT INTO AuditLog (entity_name, entity_id, action, performed_by, new_state, status)
     VALUES ('Disbursals', $1, 'DISBURSAL_ATTEMPT', $2, $3, $4)`,
    [application_id, officer_id,
      JSON.stringify({ race_run: runId, mode, workers, successCount, ledgerRows, blockedBy }),
      duplicatePayouts ? 'SUCCESS' : 'BLOCKED_BY_LOCK']);

  if (mode === 'no_defence' && duplicatePayouts > 0) {
    await pool.query('SELECT raise_fraud_flag($1,$2,$3,$4,$5,$6,$7)', [
      'RACE_CONDITION_DOUBLE_PAYOUT', 'CRITICAL', 'DISBURSAL', `${application_id} (${runId})`,
      `Teaching demo: without FOR UPDATE and without UNIQUE(application_id, instalment_no), ${workers} concurrent workers wrote ${ledgerRows} payments for the same instalment (RaceDemoLedger, not real money).`,
      JSON.stringify({ runId, workers, ledgerRows }), 'race_simulator']);
  }

  return {
    run_id: runId, mode, workers, application_id,
    successCount, blockedCount: blockedOutcomes.length, ledgerRows, duplicatePayouts,
    leakage: duplicatePayouts * app.benefit_amount,
    blockedBy, outcomes,
    elapsed_ms: Math.round(performance.now() - t0),
    logs: logs.sort((a, b) => a.t - b.t).map((l) => `[T=${String(l.t).padStart(4)}ms] ${l.worker ? `W${String(l.worker).padStart(2, '0')}` : '---'} ${l.msg}`),
  };
}

// ------------------------------------------------------------ fraud ops
export async function resolveFlag(flagId, officerId, notes) {
  const r = await withTx(officerId, (c) => c.query(
    `UPDATE FraudFlags SET resolved=TRUE, resolved_by=$2, resolved_at=now(), resolution_notes=$3
      WHERE flag_id=$1 AND NOT resolved RETURNING *`, [flagId, officerId, notes || 'Reviewed']));
  if (!r.rowCount) throw new ApiError(404, `Open flag ${flagId} not found`);
  return r.rows[0];
}

export async function setFrozen(citizenId, frozen, officerId) {
  const r = await withTx(officerId, (c) => c.query(
    'UPDATE Citizens SET is_frozen=$2 WHERE citizen_id=$1 RETURNING citizen_id, is_frozen', [citizenId, !!frozen]));
  if (!r.rowCount) throw new ApiError(404, `Citizen ${citizenId} not found`);
  return r.rows[0];
}

/**
 * Full scan: SQL detection queries (catch anything that got in while a
 * trigger was disabled, e.g. a bulk load) + MongoDB aggregation for reused
 * identity documents. Every hit is recorded through raise_fraud_flag().
 */
export async function runFullScan(actor = 'VIGILANCE_SCAN') {
  const summary = {};
  await withTx(actor, async (c) => {
    const over = await c.query(`
      SELECT o.parcel_id, MIN(o.parcel_key) AS parcel_key, SUM(o.share_fraction) AS total,
             jsonb_agg(jsonb_build_object('citizen_id', o.citizen_id, 'share', o.share_fraction)) AS owners
        FROM v_ownership o GROUP BY o.parcel_id HAVING SUM(o.share_fraction) > 1`);
    for (const r of over.rows) {
      await c.query('SELECT raise_fraud_flag($1,$2,$3,$4,$5,$6,$7)', ['GHOST_BENEFICIARY_OVERALLOCATION', 'CRITICAL', 'PARCEL', r.parcel_key,
        `Scan: shares on ${r.parcel_id} total ${r.total} (> 1.0).`, JSON.stringify(r), 'full_scan']);
    }
    summary.overallocated_parcels = over.rowCount;

    const dupAcc = await c.query(`
      SELECT bank_ifsc, bank_account_no, array_agg(citizen_id) AS citizens
        FROM Citizens GROUP BY bank_ifsc, bank_account_no HAVING COUNT(*) > 1`);
    for (const r of dupAcc.rows) {
      await c.query('SELECT raise_fraud_flag($1,$2,$3,$4,$5,$6,$7)', ['DUPLICATE_BANK_ACCOUNT', 'HIGH', 'BANK_ACCOUNT',
        `${r.bank_ifsc} / ${r.bank_account_no}`, `Scan: account shared by ${r.citizens.join(', ')}.`, JSON.stringify(r), 'full_scan']);
    }
    summary.shared_bank_accounts = dupAcc.rowCount;

    const fuzzy = await c.query(`
      SELECT a.citizen_id AS a_id, a.full_name AS a_name, b.citizen_id AS b_id, b.full_name AS b_name,
             round(similarity(a.full_name, b.full_name)::numeric, 2) AS sim
        FROM Citizens a JOIN Citizens b
          ON a.citizen_id < b.citizen_id AND a.district = b.district AND a.full_name % b.full_name
       WHERE similarity(a.full_name, b.full_name) >= 0.6`);
    for (const r of fuzzy.rows) {
      await c.query('SELECT raise_fraud_flag($1,$2,$3,$4,$5,$6,$7)', ['DOCUMENT_REUSE_FUZZY_NAME', 'MEDIUM', 'CITIZEN', r.b_id,
        `Scan: "${r.b_name}" (${r.b_id}) ~ "${r.a_name}" (${r.a_id}), trigram similarity ${r.sim}.`, JSON.stringify(r), 'full_scan']);
    }
    summary.fuzzy_name_pairs = fuzzy.rowCount;
  });

  if (mongoStatus.connected) {
    const reused = await docs.findReusedIdentityDocuments();
    const byBytes = await docs.findReusedFilesByBytes();
    for (const g of reused) {
      const owner = await pool.query('SELECT citizen_id, full_name, aadhaar_masked FROM Citizens WHERE aadhaar_hmac=$1', [g._id]);
      const o = owner.rows[0];
      await withTx(actor, (c) => c.query('SELECT raise_fraud_flag($1,$2,$3,$4,$5,$6,$7)', [
        'DOCUMENT_REUSE_FUZZY_NAME', 'HIGH', 'DOCUMENT', `AADHAAR-HMAC ${g._id.slice(0, 16)}...`,
        `MongoDB aggregation: one Aadhaar (${o ? `${o.aadhaar_masked}, registered to ${o.citizen_id} "${o.full_name}"` : 'unregistered'}) appears in documents of ${g.citizens.length} different citizens (${g.citizens.join(', ')}) across applications ${g.applications.join(', ')}. ${g.files.length} distinct file hashes, so a byte-level hash check would ${g.files.length > 1 ? 'have MISSED this (rescans)' : 'also catch it'}.`,
        JSON.stringify(g), 'mongo_aggregation']));
    }
    summary.reused_identity_documents = reused.length;
    summary.reused_by_file_hash_only = byBytes.length;
  } else {
    summary.mongo = 'skipped: MongoDB not connected';
  }
  return summary;
}

/** Live demo buttons: each one makes a REAL fraudulent attempt against the database. */
export async function injectFraud(type) {
  const rnd = Math.floor(Math.random() * 9000) + 1000;
  if (type === 'GHOST_BENEFICIARY_OVERALLOCATION') {
    const parcel = await upsertParcel({ state: 'Karnataka', district: 'Mandya', taluk: 'Maddur', village: 'Shivapura',
      survey_no: String(200 + (rnd % 700)), subdivision: 'X', area_acres: 4 });
    const first = await addOwnership(parcel.parcel_id, 'CIT-1004', 0.7, 'LAND_RECORDS_DESK');
    const second = await addOwnership(parcel.parcel_id, 'CIT-1005', 0.6, 'LAND_RECORDS_DESK');
    return { attempted: `CIT-1004 claims 70% of ${parcel.parcel_id}, then CIT-1005 claims 60% of the same parcel`,
      first_claim: first.quarantined ? 'quarantined' : 'accepted', second_claim: second.quarantined ? 'quarantined' : 'accepted', flag: second.flag };
  }
  if (type === 'DUPLICATE_BANK_ACCOUNT') {
    const { rows: [victim] } = await pool.query('SELECT * FROM Citizens ORDER BY random() LIMIT 1');
    const r = await registerCitizen({ full_name: `Mule Applicant ${rnd}`, aadhaar: `9${String(rnd).padStart(4, '0')}${String(Date.now()).slice(-7)}`,
      phone: `+91 90000 ${rnd}0`, annual_income: 90000, bank_ifsc: victim.bank_ifsc, bank_account_no: victim.bank_account_no,
      state: victim.state, district: victim.district });
    return { attempted: `register a new citizen paying into ${victim.full_name}'s account ${victim.bank_ifsc}/${victim.bank_account_no}`,
      result: r.quarantined ? 'quarantined' : 'accepted', flag: r.flag };
  }
  if (type === 'DOCUMENT_REUSE_FUZZY_NAME') {
    // a different citizen uploads a RESCAN of CIT-1004's Aadhaar card
    const { rows: [target] } = await pool.query(
      `SELECT a.application_id, c.* FROM Applications a JOIN Citizens c USING (citizen_id) ORDER BY random() LIMIT 1`);
    if (!target) throw new ApiError(409, 'Need at least one application to attach the document to');
    const { rows: [owner] } = await pool.query(
      'SELECT * FROM Citizens WHERE citizen_id <> $1 ORDER BY random() LIMIT 1', [target.citizen_id]);
    await docs.addDocument(target.application_id, buildDocument('AADHAAR', target, null, { aadhaarHmacOverride: owner.aadhaar_hmac, scanNo: rnd }));
    await docs.logVerification(target.application_id, 'DEMO_INJECTOR', 'document_added', `Rescan of ${owner.citizen_id}'s Aadhaar`);
    const scan = await runFullScan();
    const flag = await pool.query(`SELECT * FROM FraudFlags WHERE detected_by='mongo_aggregation' AND evidence->>'_id' = $1`, [owner.aadhaar_hmac]);
    return { flag: flag.rows[0] || null, attempted: `${target.citizen_id} (${target.full_name}) uploads a rescanned copy of ${owner.full_name}'s Aadhaar to ${target.application_id}`, scan };
  }
  throw new ApiError(400, `Unknown fraud type ${type}`);
}

// ------------------------------------------------------------ read model
function summarize(entity, action, oldS, newS, status) {
  if (status !== 'SUCCESS' || entity === 'AuditLog') {
    const n = newS || {};
    return n.error ? `${n.blocked_by ? `[${n.blocked_by}] ` : ''}${n.error}` : JSON.stringify(n);
  }
  if (action === 'DISBURSAL_ATTEMPT') return JSON.stringify(newS);
  if (action === 'UPDATE' && oldS && newS) {
    const skip = new Set(['verified_at', 'approved_at', 'completed_at', 'detected_at', 'resolved_at', 'evidence']);
    const show = (v) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v ?? 'null');
    const diff = Object.keys(newS).filter((k) => !skip.has(k) && JSON.stringify(oldS[k]) !== JSON.stringify(newS[k]))
      .map((k) => `${k}: ${show(oldS[k])} → ${show(newS[k])}`);
    return diff.join(', ') || 'no field change';
  }
  if (!newS) return '';
  const pick = {
    Citizens: ['full_name', 'district'], LandOwnership: ['parcel_id', 'citizen_id', 'share_fraction'],
    Applications: ['citizen_id', 'scheme_id', 'status'], PaymentAttempts: ['instalment_no', 'amount', 'txn_ref', 'status'],
    Disbursals: ['application_id', 'instalment_no', 'amount', 'txn_ref'], FraudFlags: ['flag_type', 'entity_id'],
  }[entity.charAt(0).toUpperCase() + entity.slice(1)] || Object.keys(newS).slice(0, 4);
  return pick.map((k) => `${k}: ${newS[k]}`).join(', ');
}

const ENTITY_NAMES = { citizens: 'Citizens', landownership: 'LandOwnership', applications: 'Applications',
  paymentattempts: 'PaymentAttempts', disbursals: 'Disbursals', fraudflags: 'FraudFlags' };

export async function getState() {
  const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
  const [citizens, parcels, ownerships, schemes, rules, apps, disb, flags, audit, officers, attempts] = await Promise.all([
    q('SELECT * FROM Citizens ORDER BY citizen_id'),
    q('SELECT * FROM LandParcels ORDER BY parcel_id'),
    q('SELECT * FROM v_ownership ORDER BY ownership_id'),
    q('SELECT * FROM Schemes ORDER BY scheme_id'),
    q('SELECT * FROM EligibilityRules ORDER BY rule_id'),
    q(`SELECT a.*, c.full_name AS citizen_name, s.title_en AS scheme_title, s.instalments_count, s.benefit_amount,
              o.parcel_key, (SELECT COUNT(*) FROM Disbursals d WHERE d.application_id=a.application_id) AS instalments_paid
         FROM Applications a JOIN Citizens c USING (citizen_id) JOIN Schemes s USING (scheme_id)
         JOIN v_ownership o ON o.parcel_id=a.parcel_id AND o.citizen_id=a.citizen_id
        ORDER BY a.applied_at DESC, a.application_id DESC`),
    q(`SELECT d.*, a.citizen_id, c.full_name AS citizen_name, a.scheme_id, s.title_en AS scheme_title
         FROM Disbursals d JOIN Applications a USING (application_id) JOIN Citizens c USING (citizen_id) JOIN Schemes s USING (scheme_id)
        ORDER BY d.disbursed_at DESC`),
    q('SELECT * FROM FraudFlags ORDER BY detected_at DESC'),
    q('SELECT * FROM AuditLog ORDER BY log_id DESC LIMIT 200'),
    q('SELECT * FROM Officers ORDER BY officer_id'),
    q('SELECT * FROM PaymentAttempts ORDER BY initiated_at DESC LIMIT 100'),
  ]);
  const uploads = await docs.uploadsByApplication().catch(() => new Map());

  return {
    citizens: citizens.map((c) => ({ ...c, created_at: fmt(c.created_at) })),
    parcels,
    ownerships,
    officers,
    schemes: schemes.map((s) => ({
      scheme_id: s.scheme_id, scheme_code: s.scheme_code, title_en: s.title_en, title_hi: s.title_hi, category: s.category,
      subsidy_summary_en: s.summary_en, subsidy_summary_hi: s.summary_hi, benefit_amount: s.benefit_amount,
      instalments_count: s.instalments_count, image_url: s.image_url, tag_text: s.tag_text, required_documents: s.required_documents,
      rules: rules.filter((r) => r.scheme_id === s.scheme_id).map((r) => ({
        rule_id: r.rule_id, scheme_id: r.scheme_id, attribute: r.attribute, operator: r.operator,
        target_value: r.target_value, description: r.rule_description,
      })),
    })),
    applications: apps.map((a) => {
      const up = uploads.get(a.application_id);
      return {
        application_id: a.application_id, citizen_id: a.citizen_id, citizen_name: a.citizen_name,
        scheme_id: a.scheme_id, scheme_title: a.scheme_title, cycle_year: a.cycle_year, parcel_id: a.parcel_id,
        parcel_key: a.parcel_key, status: a.status, applied_at: fmt(a.applied_at),
        verified_by: a.verified_by || undefined, verified_at: fmt(a.verified_at),
        approved_by: a.approved_by || undefined, approved_at: fmt(a.approved_at),
        rejection_reason: a.rejection_reason || undefined,
        instalments_paid: a.instalments_paid, instalments_count: a.instalments_count, benefit_amount: a.benefit_amount,
        documents: (up?.documents || []).map((d) => ({
          doc_type: d.doc_type, doc_name: d.file_name,
          hmac_signature: d.extracted?.aadhaar_hmac || d.extracted?.parcel_key || d.file_sha256,
          file_sha256: d.file_sha256, verified: !!d.verified,
          mismatch: d.doc_type === 'AADHAAR' && d.extracted?.aadhaar_hmac
            && d.extracted.aadhaar_hmac !== citizens.find((c) => c.citizen_id === a.citizen_id)?.aadhaar_hmac,
        })),
        documents_missing: !up,
      };
    }),
    disbursals: disb.map((d) => ({ ...d, pfms_status: 'SUCCESS', disbursed_at: fmt(d.disbursed_at, true) })),
    paymentAttempts: attempts.map((p) => ({ ...p, initiated_at: fmt(p.initiated_at, true), completed_at: fmt(p.completed_at, true) })),
    fraudFlags: flags.map((f) => ({ ...f, detected_at: fmt(f.detected_at), resolved_at: fmt(f.resolved_at),
      resolved_by: f.resolved_by || undefined, resolution_notes: f.resolution_notes || undefined })),
    auditLogs: audit.map((l) => {
      const entity = ENTITY_NAMES[l.entity_name] || l.entity_name;
      return {
        log_id: `AUD-${l.log_id}`, entity_name: entity, entity_id: l.entity_id, action: l.action,
        performed_by: l.performed_by, timestamp: fmt(l.logged_at, true),
        old_state: l.action === 'UPDATE' ? undefined : undefined,
        new_state: summarize(entity, l.action, l.old_state, l.new_state, l.status),
        status: l.status,
      };
    }),
    meta: { mongo: { ...mongoStatus }, generated_at: fmt(new Date(), true) },
  };
}
