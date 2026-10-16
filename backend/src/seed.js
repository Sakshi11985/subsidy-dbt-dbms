// Rebuilds both databases and replays a realistic story through the SAME
// code paths the UI uses, so every fraud flag in the demo data was really
// produced by a trigger, constraint or aggregation, not typed in by hand.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, mongoStatus } from './db.js';
import * as docs from './documents.js';
import * as svc from './services.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SCHEMA_PATH = path.resolve(here, '../../database/schema.sql');

const OFFICERS = [
  ['OFFICER_VERIFIER_10', 'R. Shankar', 'Revenue Inspector', true, false, false],
  ['OFFICER_VERIFIER_11', 'Meena Kulkarni', 'Village Accountant', true, false, false],
  ['OFFICER_APPROVER_02', 'Anil Mehta', 'Deputy Director (Agriculture)', false, true, true],
  ['OFFICER_APPROVER_05', 'Farida Begum', 'District Agriculture Officer', false, true, true],
  ['FIN_DISBURSER_01', 'K. Raghavan', 'Treasury / PFMS Officer', false, false, true],
  // a Block Development Officer holds every permission, so only the
  // per-application separation-of-duties rule stops them approving their own verification
  ['BDO_07', 'Vikram Rathore', 'Block Development Officer', true, true, true],
];

const SCHEMES = [
  ['SCH-01', 'PM-KISAN', 'PM-Kisan Samman Nidhi Yojana', 'पीएम किसान सम्मान निधि योजना', 'Direct Income Support',
    '₹6,000 per year in 3 equal instalments of ₹2,000 directly credited into farmer accounts.',
    '₹6,000 प्रति वर्ष 3 समान किश्तों में सीधे किसान के बैंक खाते में DBT द्वारा।', 2000, 3,
    ['AADHAAR', 'LAND_RECORD', 'BANK_PASSBOOK'], '/coins-plant.jpg', 'Central Scheme • 100% DBT'],
  ['SCH-02', 'PM-KUSUM', 'PM-KUSUM Solar Agricultural Pump Scheme', 'पीएम-कुसुम सौर कृषि पंप योजना', 'Renewable Irrigation',
    'Up to 90% capital subsidy on standalone solar pumps. Eliminate diesel pumping costs.',
    'सोलर पंप पर 90% तक की छूट। डीज़ल के खर्चे से पूरी तरह मुक्ति।', 85000, 1,
    ['AADHAAR', 'LAND_RECORD', 'QUOTATION'], '/solar.jpg', 'Up to 90% Subsidy • Solar Pump'],
  ['SCH-03', 'PMKSY-DRIP', 'PM Krishi Sinchayee Yojana (Drip Irrigation)', 'प्रधानमंत्री कृषि सिंचाई योजना (ड्रिप सिंचाई)', 'Micro-Irrigation',
    'Save 30-50% water and boost crop yield with 55% to 80% micro-irrigation subsidy.',
    '30 से 50% पानी की बचत और 55% से 80% तक ड्रिप सिंचाई सब्सिडी।', 45000, 1,
    ['AADHAAR', 'LAND_RECORD', 'QUOTATION'], '/drip.jpg', '45% to 80% Subsidy • Water Saver'],
  ['SCH-04', 'SMAM-TRACTOR', 'Sub-Mission on Agricultural Mechanization (SMAM)', 'कृषि यंत्रीकरण पर उप-मिशन (ट्रैक्टर सब्सिडी)', 'Farm Machinery',
    '40% to 50% subsidy on purchase of new tractors and farm machinery equipment.',
    'नए ट्रैक्टर और आधुनिक कृषि उपकरणों की खरीद पर 40% से 50% तक सरकारी अनुदान।', 125000, 1,
    ['AADHAAR', 'LAND_RECORD', 'INCOME_CERT', 'QUOTATION'], '/tractor.jpg', '50% Subsidy • Tractor & Tools'],
  ['SCH-05', 'KISAN-CREDIT', 'Kisan Credit Card (KCC) Concessional Loan', 'किसान क्रेडिट कार्ड (केसीसी) रियायती ऋण', 'Institutional Credit',
    'Working capital up to ₹3,00,000 at effective 4% interest rate on timely repayment.',
    'समय पर भुगतान पर मात्र 4% प्रभावी ब्याज दर पर ₹3 लाख तक का कृषि ऋण।', 300000, 1,
    ['AADHAAR', 'LAND_RECORD'], '/cash-hand.jpg', '₹3 Lakh @ 4% Interest • Working Capital'],
  ['SCH-06', 'NHM-POLYHOUSE', 'Protected Cultivation & Polyhouse Subsidy (MIDH)', 'संरक्षित खेती एवं पॉलीहाउस सब्सिडी (एमआईडीएच)', 'High Value Horticulture',
    'Up to 65% government assistance for high-tech polyhouse and shade net structures, paid in 2 instalments.',
    'पॉलीहाउस और शेडनेट निर्माण हेतु 65% (अधिकतम ₹10 लाख) तक वित्तीय सहायता।', 250000, 2,
    ['AADHAAR', 'LAND_RECORD', 'SITE_PHOTO'], '/polyhouse.jpg', 'Up to 65% Subsidy • Polyhouse'],
];

const RULES = [
  ['R1-1', 'SCH-01', 'total_land_holding', '<=', '5.0', 'Total cultivable holding must not exceed 5.0 acres (small/marginal farmers)'],
  ['R1-2', 'SCH-01', 'annual_income', '<=', '300000', 'Annual household income at most ₹3,00,000'],
  ['R2-1', 'SCH-02', 'land_area', '>=', '1.0', 'At least 1.0 acre on the applying parcel for the solar array'],
  ['R2-2', 'SCH-02', 'annual_income', '<=', '500000', 'Annual income at most ₹5,00,000'],
  ['R3-1', 'SCH-03', 'land_area', '<=', '10.0', 'At most 10 acres under the drip component'],
  ['R4-1', 'SCH-04', 'land_area', '>=', '2.5', 'Own at least 2.5 acres to qualify for tractor subsidy'],
  ['R4-2', 'SCH-04', 'annual_income', '<=', '600000', 'Annual income at most ₹6,00,000'],
  ['R5-1', 'SCH-05', 'land_area', '>=', '0.5', 'Cultivator with at least 0.5 acre'],
  ['R6-1', 'SCH-06', 'land_area', '>=', '1.0', 'At least 1.0 acre land holding'],
];

// Aadhaar numbers below are made-up demo values (never use real ones).
const CITIZENS = [
  { full_name: 'Rajendra Prasad Yadav', aadhaar: '234567894921', phone: '+91 98451 23456', annual_income: 180000, bank_ifsc: 'SBIN0004123', bank_account_no: '30498172635', state: 'Uttar Pradesh', district: 'Varanasi' },
  { full_name: 'Savitri Devi', aadhaar: '345678918192', phone: '+91 97412 88921', annual_income: 140000, bank_ifsc: 'BARB0VARDES', bank_account_no: '982341234509', state: 'Uttar Pradesh', district: 'Varanasi' },
  { full_name: 'Suresh Kumar', aadhaar: '456789013341', phone: '+91 94481 90812', annual_income: 320000, bank_ifsc: 'PUNB0244200', bank_account_no: '244200100078123', state: 'Uttar Pradesh', district: 'Varanasi' },
  { full_name: 'Basavaraj Gowda', aadhaar: '567890127104', phone: '+91 98860 11234', annual_income: 210000, bank_ifsc: 'CNRB0001890', bank_account_no: '1890201004561', state: 'Karnataka', district: 'Mandya' },
  { full_name: 'Basavaraaj Gowda', aadhaar: '678901238876', phone: '+91 98860 99882', annual_income: 205000, bank_ifsc: 'CNRB0001890', bank_account_no: '1890201009988', state: 'Karnataka', district: 'Mandya' },
  { full_name: 'Harpreet Singh Sandhu', aadhaar: '789012345529', phone: '+91 98140 77651', annual_income: 380000, bank_ifsc: 'PUNB0192800', bank_account_no: '192800150003291', state: 'Punjab', district: 'Ludhiana' },
];

const PARCELS = [
  { state: 'Karnataka', district: 'Mandya', taluk: 'Maddur', village: 'Shivapura', survey_no: '104', subdivision: '2B', area_acres: 4.5 },
  { state: 'Uttar Pradesh', district: 'Varanasi', taluk: 'Pindra', village: 'Babepur', survey_no: '48', subdivision: '1A', area_acres: 3.2 },
  { state: 'Punjab', district: 'Ludhiana', taluk: 'Samrala', village: 'Dayalpur', survey_no: '72', subdivision: '3', area_acres: 6.0 },
  { state: 'Karnataka', district: 'Mandya', taluk: 'Maddur', village: 'Shivapura', survey_no: '109', subdivision: '4A', area_acres: 5.0 },
  { state: 'Uttar Pradesh', district: 'Varanasi', taluk: 'Pindra', village: 'Babepur', survey_no: '51', subdivision: '', area_acres: 2.0 },
];

export async function rebuildSchema() {
  const sql = await fs.readFile(SCHEMA_PATH, 'utf8');
  await pool.query(sql);
}

export async function resetDatabase({ quiet = false } = {}) {
  const say = (...a) => { if (!quiet) console.log(...a); };
  await rebuildSchema();
  if (mongoStatus.connected) await docs.resetMongo();
  say('schema rebuilt', mongoStatus.connected ? '(+ MongoDB collections)' : '(MongoDB not connected: documents skipped)');

  for (const o of OFFICERS) await pool.query('INSERT INTO Officers VALUES ($1,$2,$3,$4,$5,$6)', o);
  for (const s of SCHEMES) {
    await pool.query(`INSERT INTO Schemes (scheme_id, scheme_code, title_en, title_hi, category, summary_en, summary_hi,
      benefit_amount, instalments_count, required_documents, image_url, tag_text) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, s);
  }
  for (const r of RULES) await pool.query('INSERT INTO EligibilityRules VALUES ($1,$2,$3,$4,$5,$6)', r);

  const cit = [];
  for (const c of CITIZENS) cit.push((await svc.registerCitizen(c, 'SEED')).citizen);
  const [rajendra, savitri, suresh, basavaraj, basavaraaj, harpreet] = cit;
  const par = [];
  for (const p of PARCELS) par.push(await svc.upsertParcel(p));
  const [kaMain, upShared, pbFarm, kaGhost, upSmall] = par;

  await svc.addOwnership(kaMain.parcel_id, basavaraj.citizen_id, 1.0, 'SEED');
  await svc.addOwnership(upShared.parcel_id, rajendra.citizen_id, 0.6, 'SEED');   // joint ownership (legal)
  await svc.addOwnership(upShared.parcel_id, savitri.citizen_id, 0.4, 'SEED');
  await svc.addOwnership(pbFarm.parcel_id, harpreet.citizen_id, 1.0, 'SEED');
  await svc.addOwnership(upSmall.parcel_id, suresh.citizen_id, 1.0, 'SEED');
  await svc.addOwnership(kaGhost.parcel_id, basavaraj.citizen_id, 0.7, 'SEED');
  // ghost beneficiary: 0.7 + 0.6 = 1.3 > 1 -> quarantined by trg_check_parcel_share
  await svc.addOwnership(kaGhost.parcel_id, basavaraaj.citizen_id, 0.6, 'SEED');
  // the corrected, legal claim for the remaining 30%
  await svc.addOwnership(kaGhost.parcel_id, basavaraaj.citizen_id, 0.3, 'SEED');
  say('citizens, parcels, ownership loaded');

  // fraudulent registrations -> quarantined by trg_screen_new_citizen
  await svc.registerCitizen({ ...CITIZENS[2], full_name: 'Suresh Kumarr', aadhaar: '456789019999', bank_ifsc: savitri.bank_ifsc, bank_account_no: savitri.bank_account_no }, 'SEED');
  await svc.registerCitizen({ ...CITIZENS[3], full_name: 'Basavaraju Gowda', phone: '+91 90080 55511', bank_account_no: '1890201007777' }, 'SEED');

  const cycle = new Date().getFullYear();
  const apply = async (c, schemeId, parcel) =>
    (await svc.submitApplication({ citizen_id: c.citizen_id, scheme_id: schemeId, parcel_id: parcel.parcel_id, cycle_year: cycle })).application;
  const tryIt = async (fn) => { try { await fn(); } catch { /* expected refusal, already audited */ } };

  // 1. Rajendra: PM-Kisan, fully processed, first instalment paid
  const a1 = await apply(rajendra, 'SCH-01', upShared);
  await svc.updateStatus(a1.application_id, 'under_review', 'OFFICER_VERIFIER_10');
  await svc.updateStatus(a1.application_id, 'verified', 'OFFICER_VERIFIER_10');
  await svc.approveApplication(a1.application_id, 'OFFICER_APPROVER_02');
  await svc.disburse(a1.application_id, 'FIN_DISBURSER_01');
  await tryIt(() => apply(rajendra, 'SCH-01', upShared));                         // duplicate in same cycle

  // 2. Savitri: approved and waiting for payment (race-lab target)
  const a2 = await apply(savitri, 'SCH-01', upShared);
  await svc.updateStatus(a2.application_id, 'under_review', 'OFFICER_VERIFIER_11');
  await svc.updateStatus(a2.application_id, 'verified', 'OFFICER_VERIFIER_11');
  await svc.approveApplication(a2.application_id, 'OFFICER_APPROVER_05');

  // 3. Basavaraj: verified by the BDO, who then tries to approve it himself
  const a3 = await apply(basavaraj, 'SCH-02', kaMain);
  await svc.updateStatus(a3.application_id, 'under_review', 'BDO_07');
  await svc.updateStatus(a3.application_id, 'verified', 'BDO_07');
  await tryIt(() => svc.approveApplication(a3.application_id, 'BDO_07'));          // separation of duties

  // 4. Harpreet: tractor subsidy, under field review
  const a4 = await apply(harpreet, 'SCH-04', pbFarm);
  await svc.updateStatus(a4.application_id, 'under_review', 'OFFICER_VERIFIER_10');

  // 5. Suresh: income too high for PM-Kisan (refused), applies for drip instead
  await tryIt(() => apply(suresh, 'SCH-01', upSmall));
  await apply(suresh, 'SCH-03', upSmall);

  // 6. Basavaraaj: KCC application, then uploads a RESCAN of Basavaraj's Aadhaar
  const a6 = await apply(basavaraaj, 'SCH-05', kaGhost);
  if (mongoStatus.connected) {
    await docs.addDocument(a6.application_id,
      svc.buildDocument('AADHAAR', basavaraaj, null, { aadhaarHmacOverride: basavaraj.aadhaar_hmac, scanNo: 2 }));
    await docs.logVerification(a6.application_id, basavaraaj.citizen_id, 'document_added', 'Additional identity proof');
  }

  // Polyhouse (2 instalments) for Basavaraj, approved: second race target
  const a7 = await apply(basavaraj, 'SCH-06', kaMain);
  await svc.updateStatus(a7.application_id, 'under_review', 'OFFICER_VERIFIER_11');
  await svc.updateStatus(a7.application_id, 'verified', 'OFFICER_VERIFIER_11');
  await svc.approveApplication(a7.application_id, 'OFFICER_APPROVER_02');

  const scan = await svc.runFullScan('SEED');
  say('applications loaded; scan:', scan);
  const { rows: [counts] } = await pool.query(`SELECT
    (SELECT COUNT(*) FROM Citizens) citizens, (SELECT COUNT(*) FROM Applications) applications,
    (SELECT COUNT(*) FROM Disbursals) disbursals, (SELECT COUNT(*) FROM FraudFlags) flags, (SELECT COUNT(*) FROM AuditLog) audit`);
  say('done:', counts);
  return counts;
}
