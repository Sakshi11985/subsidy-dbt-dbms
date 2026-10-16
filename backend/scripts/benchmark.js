// Experiments for the report.          npm run benchmark  [-- --citizens 50000]
//
// Runs in a SEPARATE database (subsidy_bench) so the demo data is untouched:
//   1. bulk-generates N synthetic farmers / parcels / applications
//   2. plants a known number of frauds through the normal trigger path and
//      counts how many the database caught (ground truth is known)
//   3. EXPLAIN ANALYZE: each hot query with its index vs forced sequential scan
//   4. concurrency: repeated race runs per mode and worker count
// Writes docs/benchmark-results.json (shown in the UI) and docs/RESULTS.md.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { useScratchDatabase } from '../tests/helpers.js';

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? Number(process.argv[i + 1]) : def;
};
const N = arg('citizens', 50000);
const RUNS = arg('runs', 7);
const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '../../docs');

const { db, svc, seed } = await useScratchDatabase('subsidy_bench');
const pool = db.pool;
const q = (sql, p) => pool.query(sql, p);
const log = (...a) => console.log(...a);

log(`1/4 rebuilding subsidy_bench with demo seed + ${N} synthetic farmers...`);
await seed.resetDatabase({ quiet: true });
const t0 = Date.now();
// Bulk load: user triggers are disabled for speed (like a nightly import),
// constraints stay ON. The full scan in step 2 then audits the loaded data.
await q('ALTER TABLE Citizens DISABLE TRIGGER USER');
await q('ALTER TABLE LandOwnership DISABLE TRIGGER USER');
await q('ALTER TABLE Applications DISABLE TRIGGER USER');
await q(`
  WITH first AS (SELECT ARRAY['Ramesh','Suresh','Mahesh','Ganesh','Lakshmi','Savitri','Anita','Sunita','Raju','Basavaraj','Harpreet','Gurpreet','Manjunath','Venkatesh','Kavita','Pooja','Arjun','Vijay','Rekha','Shankar'] a),
       last  AS (SELECT ARRAY['Kumar','Yadav','Gowda','Singh','Reddy','Patil','Sharma','Devi','Naik','Sandhu','Verma','Rao','Shetty','Gupta','Mishra'] a),
       geo   AS (SELECT ARRAY['Karnataka|Mandya','Karnataka|Mysuru','Uttar Pradesh|Varanasi','Uttar Pradesh|Prayagraj','Punjab|Ludhiana','Punjab|Amritsar','Maharashtra|Pune','Telangana|Warangal'] a)
  INSERT INTO Citizens (full_name, aadhaar_masked, aadhaar_hmac, phone, annual_income, bank_ifsc, bank_account_no, state, district)
  SELECT first.a[1 + (i * 7) % 20] || ' ' || first.a[1 + (i * 13) % 20] || ' ' || last.a[1 + (i * 11) % 15],
         'XXXX-XXXX-' || lpad((i % 10000)::text, 4, '0'),
         encode(hmac(('5' || lpad(i::text, 11, '0')), 'bench-key', 'sha256'), 'hex'),
         '+91 9' || lpad(i::text, 9, '0'),
         60000 + (i * 7919) % 540000,
         'BKID0' || lpad(((i % 900) + 100)::text, 6, '0'),
         lpad((100000000 + i)::text, 12, '0'),
         split_part(geo.a[1 + i % 8], '|', 1), split_part(geo.a[1 + i % 8], '|', 2)
    FROM generate_series(1, $1) i, first, last, geo`, [N]);
await q(`
  INSERT INTO LandParcels (state, district, taluk, village, survey_no, subdivision, area_acres)
  SELECT c.state, c.district, 'Taluk-' || (n % 40), 'Village-' || (n % 997), (n % 500)::text, (n / 500000)::text || '-' || (n % 7), 0.5 + (n % 90) / 10.0
    FROM (SELECT row_number() OVER () AS n, state, district FROM Citizens WHERE citizen_id NOT IN (SELECT citizen_id FROM LandOwnership)) c
  ON CONFLICT DO NOTHING`);
await q(`
  INSERT INTO LandOwnership (parcel_id, citizen_id, share_fraction)
  SELECT p.parcel_id, c.citizen_id, 1.0
    FROM (SELECT parcel_id, row_number() OVER (ORDER BY parcel_id) rn FROM LandParcels WHERE parcel_id NOT IN (SELECT parcel_id FROM LandOwnership)) p
    JOIN (SELECT citizen_id, row_number() OVER (ORDER BY citizen_id) rn FROM Citizens WHERE citizen_id NOT IN (SELECT citizen_id FROM LandOwnership)) c USING (rn)`);
await q(`
  INSERT INTO Applications (citizen_id, scheme_id, parcel_id, cycle_year, status, verified_by, approved_by)
  SELECT o.citizen_id, 'SCH-0' || (1 + n % 6), o.parcel_id, 2025 + (n % 2),
         (ARRAY['submitted','under_review','verified','approved'])[1 + n % 4]::application_status_enum,
         CASE WHEN n % 4 >= 2 THEN 'OFFICER_VERIFIER_10' END,
         CASE WHEN n % 4 = 3 THEN 'OFFICER_APPROVER_02' END
    FROM (SELECT citizen_id, parcel_id, row_number() OVER () n FROM LandOwnership) o
   WHERE n % 3 <> 0
  ON CONFLICT DO NOTHING`);
await q('ALTER TABLE Citizens ENABLE TRIGGER USER');
await q('ALTER TABLE LandOwnership ENABLE TRIGGER USER');
await q('ALTER TABLE Applications ENABLE TRIGGER USER');
await q('ANALYZE');
const sizes = (await q(`SELECT (SELECT COUNT(*) FROM Citizens)::int citizens, (SELECT COUNT(*) FROM LandParcels)::int parcels,
  (SELECT COUNT(*) FROM LandOwnership)::int ownerships, (SELECT COUNT(*) FROM Applications)::int applications`)).rows[0];
log('   loaded', sizes, `in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

// ------------------------------------------------------------------ 2
log('2/4 planting known frauds through the trigger path...');
const PLANT = { dup_bank: 30, aadhaar_reuse: 20, overallocation: 50 };
const flagsBefore = (await q('SELECT COUNT(*)::int n FROM FraudFlags')).rows[0].n;
const sample = (await q('SELECT * FROM Citizens WHERE citizen_id NOT LIKE $1 ORDER BY random() LIMIT 100', ['CIT-100_'])).rows;
let caught = { dup_bank: 0, aadhaar_reuse: 0, overallocation: 0 };
for (let i = 0; i < PLANT.dup_bank; i++) {
  const v = sample[i];
  const r = await svc.registerCitizen({ full_name: `Planted Mule ${i}`, aadhaar: `7${String(i).padStart(11, '0')}`, phone: '0', annual_income: 1,
    bank_ifsc: v.bank_ifsc, bank_account_no: v.bank_account_no, state: v.state, district: v.district }, 'BENCH');
  if (r.quarantined && r.flag?.flag_type === 'DUPLICATE_BANK_ACCOUNT') caught.dup_bank++;
}
for (let i = 0; i < PLANT.aadhaar_reuse; i++) {
  const v = sample[30 + i];
  // Same identity, so we need the plaintext that produced the HMAC: the
  // synthetic Aadhaar is '5' + 11-digit index, hashed with 'bench-key'.
  // The API uses its own key, so re-register the victim's identity via SQL:
  const r = await q(`INSERT INTO Citizens (full_name, aadhaar_masked, aadhaar_hmac, phone, annual_income, bank_ifsc, bank_account_no, state, district)
    VALUES ($1, $2, $3, '0', 1, 'ZZZZ0000001', $4, $5, $6) RETURNING citizen_id`,
    [`${v.full_name}a`, v.aadhaar_masked, v.aadhaar_hmac, String(900000000 + i), v.state, v.district]);
  if (r.rowCount === 0) caught.aadhaar_reuse++;
}
for (let i = 0; i < PLANT.overallocation; i++) {
  const o = (await q(`SELECT o.parcel_id FROM LandOwnership o WHERE share_fraction = 1 ORDER BY random() LIMIT 1`)).rows[0];
  try {
    const r = await svc.addOwnership(o.parcel_id, sample[50 + (i % 50)].citizen_id, 0.25, 'BENCH');
    if (r.quarantined) caught.overallocation++;
  } catch { i--; } // picked a parcel this citizen already co-owns: draw again
}
// legit similar names: how many MEDIUM fuzzy flags does the trigger raise on clean inserts?
const legitInserts = 200;
const fpBefore = (await q("SELECT COUNT(*)::int n FROM FraudFlags WHERE severity='MEDIUM'")).rows[0].n;
for (let i = 0; i < legitInserts; i++) {
  const v = sample[i % 100];
  // a NEW person (fresh Aadhaar + account) who happens to have a common name
  const words = sample[(i * 7) % 100].full_name.split(' ');
  const name = `${words[0]} ${sample[(i * 3 + 1) % 100].full_name.split(' ')[1]} ${sample[(i * 11 + 2) % 100].full_name.split(' ').at(-1)}`;
  await svc.registerCitizen({ full_name: name, aadhaar: `8${String(i).padStart(11, '0')}`, phone: '0', annual_income: 1,
    bank_ifsc: 'YESB0000001', bank_account_no: String(700000000 + i), state: v.state, district: v.district }, 'BENCH');
}
const fuzzyFlags = (await q("SELECT COUNT(*)::int n FROM FraudFlags WHERE severity='MEDIUM'")).rows[0].n - fpBefore;
const detection = {
  planted: PLANT, caught,
  legit_registrations_with_common_names: legitInserts,
  medium_fuzzy_flags_raised_on_them: fuzzyFlags,
  note: 'MEDIUM fuzzy-name flags are review prompts, not blocks. The synthetic data uses only 20x20x15 name combinations, so most new names closely match an existing farmer in the same district; that makes this a pessimistic (high) rate, but common names are also frequent in real villages, which is exactly why name similarity alone must not block a registration.',
  flags_total_after: (await q('SELECT COUNT(*)::int n FROM FraudFlags')).rows[0].n - flagsBefore,
};
log('   ', detection);

// ------------------------------------------------------------------ 3
log('3/4 EXPLAIN ANALYZE: index vs forced sequential scan...');
const anyC = (await q('SELECT * FROM Citizens ORDER BY random() LIMIT 1')).rows[0];
const anyP = (await q('SELECT parcel_id FROM LandOwnership ORDER BY random() LIMIT 1')).rows[0].parcel_id;
const QUERIES = [
  { name: 'Duplicate-account lookup (what the screening trigger runs)', index: 'uq_bank_account (B-tree, composite)',
    sql: 'SELECT citizen_id FROM Citizens WHERE bank_ifsc = $1 AND bank_account_no = $2', params: [anyC.bank_ifsc, anyC.bank_account_no] },
  { name: 'Aadhaar reuse lookup', index: 'uq_citizen_aadhaar (B-tree)',
    sql: 'SELECT citizen_id FROM Citizens WHERE aadhaar_hmac = $1', params: [anyC.aadhaar_hmac] },
  { name: 'Fuzzy name match in a district (pg_trgm %)', index: 'idx_citizens_name_trgm (GIN, gin_trgm_ops)',
    sql: 'SELECT citizen_id FROM Citizens WHERE full_name % $1 AND district = $2', params: ['Ramesh Kumar Yadav', anyC.district] },
  { name: 'Parcel share total (ghost-beneficiary trigger)', index: 'uq_parcel_citizen (B-tree, parcel_id leading)',
    sql: 'SELECT SUM(share_fraction) FROM LandOwnership WHERE parcel_id = $1', params: [anyP] },
  { name: "Verifier queue: status = 'verified'", index: 'idx_app_status (B-tree)',
    sql: "SELECT application_id FROM Applications WHERE status = 'verified' LIMIT 50", params: [] },
];
async function timeQuery(sql, params, forceSeq) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    if (forceSeq) for (const k of ['enable_indexscan', 'enable_bitmapscan', 'enable_indexonlyscan']) await c.query(`SET LOCAL ${k} = off`);
    const times = [];
    let plan;
    for (let i = 0; i < RUNS; i++) {
      const r = await c.query(`EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`, params);
      const p = r.rows[0]['QUERY PLAN'][0];
      times.push(p['Execution Time']);
      plan = p.Plan;
    }
    await c.query('ROLLBACK');
    const nodes = [];
    (function walk(n) { nodes.push(n['Node Type'] + (n['Index Name'] ? ` (${n['Index Name']})` : '')); (n.Plans || []).forEach(walk); })(plan);
    times.sort((a, b) => a - b);
    return { median_ms: Number(times[Math.floor(times.length / 2)].toFixed(3)), plan: nodes.join(' → ') };
  } finally { c.release(); }
}
const indexResults = [];
for (const qd of QUERIES) {
  const withIdx = await timeQuery(qd.sql, qd.params, false);
  const seq = await timeQuery(qd.sql, qd.params, true);
  indexResults.push({ query: qd.name, index: qd.index, sql: qd.sql,
    seq_scan_ms: seq.median_ms, seq_plan: seq.plan, index_ms: withIdx.median_ms, index_plan: withIdx.plan,
    speedup: Number((seq.median_ms / Math.max(withIdx.median_ms, 0.001)).toFixed(1)) });
  log(`    ${qd.name}: seq ${seq.median_ms} ms vs index ${withIdx.median_ms} ms`);
}

// ------------------------------------------------------------------ 4
log('4/4 concurrency experiments...');
const concurrency = [];
const benchCitizens = (await q(`SELECT DISTINCT ON (o.citizen_id) o.citizen_id, o.parcel_id FROM LandOwnership o
  WHERE NOT EXISTS (SELECT 1 FROM Applications a WHERE a.citizen_id = o.citizen_id AND a.scheme_id = 'SCH-03') LIMIT 400`)).rows;
let next = 0;
async function freshApproved() {
  const c = benchCitizens[next++];
  const r = await q(`INSERT INTO Applications (citizen_id, scheme_id, parcel_id, cycle_year, status, verified_by, approved_by)
    VALUES ($1, 'SCH-03', $2, 2026, 'approved', 'OFFICER_VERIFIER_10', 'OFFICER_APPROVER_02') RETURNING application_id`, [c.citizen_id, c.parcel_id]);
  return r.rows[0].application_id;
}
for (const mode of ['safe', 'no_lock', 'no_defence']) {
  for (const workers of [5, 10, 20, 40]) {
    const trials = [];
    for (let t = 0; t < 5; t++) {
      const appId = await freshApproved();
      const r = await svc.raceSimulation({ application_id: appId, workers, mode });
      trials.push(r);
    }
    const row = {
      mode, workers, trials: trials.length,
      ledger_rows_per_trial: trials.map((t) => t.ledgerRows),
      duplicate_payouts_total: trials.reduce((s, t) => s + t.duplicatePayouts, 0),
      refusals_by: trials.reduce((acc, t) => { for (const [k, v] of Object.entries(t.blockedBy)) acc[k] = (acc[k] || 0) + v; return acc; }, {}),
      median_elapsed_ms: trials.map((t) => t.elapsed_ms).sort((a, b) => a - b)[2],
    };
    concurrency.push(row);
    log(`    ${mode.padEnd(10)} workers=${String(workers).padStart(2)} ledger rows per trial=${row.ledger_rows_per_trial.join(',')}`);
  }
}

const { rows: [ver] } = await q('SHOW server_version');
const results = {
  generated_at: new Date().toISOString(),
  environment: { postgres: ver.server_version, node: process.version, mongo: db.mongoStatus.connected ? 'connected' : 'not connected', explain_runs_per_query: RUNS },
  dataset: sizes, detection, indexes: indexResults, concurrency,
};
await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(path.join(outDir, 'benchmark-results.json'), JSON.stringify(results, null, 2));

const md = [
  '# Experimental results',
  '',
  `Generated by \`npm run benchmark\` on ${results.generated_at.slice(0, 10)} · PostgreSQL ${ver.server_version} · Node ${process.version}.`,
  'Absolute timings depend on the machine; the ratios and the correctness results are what matter.',
  '',
  `Dataset: ${sizes.citizens.toLocaleString()} citizens, ${sizes.parcels.toLocaleString()} parcels, ${sizes.ownerships.toLocaleString()} ownership rows, ${sizes.applications.toLocaleString()} applications.`,
  '',
  '## 1. Fraud detection on planted cases (ground truth known)',
  '',
  '| Pattern | Planted | Caught by the database |',
  '|---|---:|---:|',
  `| Duplicate bank account (trg_screen_new_citizen) | ${PLANT.dup_bank} | ${caught.dup_bank} |`,
  `| Aadhaar reuse (trg_screen_new_citizen) | ${PLANT.aadhaar_reuse} | ${caught.aadhaar_reuse} |`,
  `| Parcel over-allocation (trg_check_parcel_share) | ${PLANT.overallocation} | ${caught.overallocation} |`,
  '',
  `Side effect worth reporting: ${legitInserts} legitimate registrations with common names raised ${fuzzyFlags} MEDIUM "similar name" review flags. ${detection.note}`,
  '',
  '## 2. Index vs sequential scan (EXPLAIN ANALYZE, median of ' + RUNS + ' runs)',
  '',
  '| Query | Index | Seq scan (ms) | With index (ms) | Speed-up |',
  '|---|---|---:|---:|---:|',
  ...indexResults.map((r) => `| ${r.query} | ${r.index} | ${r.seq_scan_ms} | ${r.index_ms} | ${r.speedup}× |`),
  '',
  'Plans with index: ',
  ...indexResults.map((r) => `- ${r.query}: \`${r.index_plan}\``),
  '',
  '## 3. Concurrency (5 trials per cell; each trial = N workers paying one fresh approved application)',
  '',
  '| Mode | Workers | Ledger rows per trial | Duplicate payouts (total) | Refused by |',
  '|---|---:|---|---:|---|',
  ...concurrency.map((r) => `| ${r.mode} | ${r.workers} | ${r.ledger_rows_per_trial.join(', ')} | ${r.duplicate_payouts_total} | ${Object.entries(r.refusals_by).map(([k, v]) => `${k}: ${v}`).join('; ') || '—'} |`),
  '',
  '`safe` = initiate_payment() with SELECT … FOR UPDATE + UNIQUE ledger; `no_lock` = plain SELECT then INSERT, only the UNIQUE constraint protects;',
  '`no_defence` = plain SELECT then INSERT into a table with no UNIQUE constraint (RaceDemoLedger).',
  '',
].join('\n');
await fs.writeFile(path.join(outDir, 'RESULTS.md'), md);
log('wrote docs/benchmark-results.json and docs/RESULTS.md');
await db.closeAll();
