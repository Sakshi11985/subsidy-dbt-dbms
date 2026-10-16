# Farmer.in — Direct Benefit Transfer (DBT) & Fraud Defense Platform
### DBMS Academic Project with 3NF Normalization, ACID Transactions & Polyglot Persistence

[![React 19](https://img.shields.io/badge/React-19.2-emerald)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-8.3-green)](https://vite.dev)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-3NF%20ACID-blue)](https://postgresql.org)
[![MongoDB](https://img.shields.io/badge/MongoDB-Polyglot-forestgreen)](https://mongodb.com)

---

## 🌾 Project Overview
**Farmer.in** is an agricultural platform designed after [Farmer.in](https://farmer.in/) with a complete frontend for India's Direct Benefit Transfer (DBT) pipeline:
$$\text{Apply} \longrightarrow \text{Verify} \longrightarrow \text{Decide} \longrightarrow \text{Pay}$$

The system demonstrates **database-enforced guarantees** against the 4 core fraud patterns:
1. **Ghost Beneficiaries / Land Over-allocation:** Composite parcel key `(state, district, taluk, village, survey_no, subdivision)` + `check_parcel_share_allocation` trigger ensuring $\sum \text{share\_fraction} \le 1.0$.
2. **Duplicate Accounts / Money Mules:** Composite constraint `UNIQUE(bank_ifsc, bank_account_no)`.
3. **Document & Identity Reuse:** Keyed HMAC-SHA256 Aadhaar hashes + fuzzy string similarity matching via PostgreSQL `pg_trgm`.
4. **Double Payouts under Race Conditions:** PostgreSQL row-level locks (`SELECT ... FOR UPDATE`) + `UNIQUE(application_id, instalment_no)` append-only ledger.

---

## 🚀 Running the Frontend

```bash
# Navigate to frontend folder
cd frontend

# Start the Vite development server (already running on http://localhost:5173/)
npm run dev
```

Open your browser to: **`http://localhost:5173/`**

---

## 🏛️ System Architecture & 10 Hardened Gaps

| # | Gap Identified | Database Enforcement |
|---|---|---|
| **①** | Survey numbers are not globally unique | Composite `UNIQUE(state, district, taluk, village, survey_no, subdivision)` on `LandParcels` |
| **②** | Joint legal ownership of ancestral land | Split into `LandParcels` and `LandOwnership(parcel_id, citizen_id, share_fraction)` with trigger check |
| **③** | Multi-instalment schemes (PM-Kisan ₹6,000 in 3 parts) | `UNIQUE(application_id, instalment_no)` on `Disbursals` + `UNIQUE(citizen_id, scheme_id, cycle_year)` on `Applications` |
| **④** | Bank accounts unique only within branch | `UNIQUE(bank_ifsc, bank_account_no)` composite key |
| **⑤** | 12-digit Aadhaar reversible by brute-force | Keyed **HMAC-SHA256** hash via `pgcrypto` + masked string display |
| **⑥** | Rescans miss file-level hash matching | Aggregation on **extracted metadata identifiers** (HMAC, parcel key), not file bytes |
| **⑦** | Hardcoded or duplicate eligibility criteria | Generic `EligibilityRules(scheme_id, attribute, operator, target_value)` + `check_citizen_eligibility()` procedure |
| **⑧** | State divergence across polyglot DBs | **PostgreSQL declared single source of truth for application status**; MongoDB holds documents only |
| **⑨** | Banking transfers outside DB transactions | State machine (`approved` → `payment_initiated` → `paid`) with idempotent `txn_ref` and immutable ledger |
| **⑩** | Defending MongoDB vs Postgres JSONB | Per-scheme `$jsonSchema` document validation, OCR metadata aggregation pipeline, separation of concerns |

---

## 🎓 The Examiner's Concurrency Question & Answer

> **Question:** *"Two officers click 'approve' on the same application at the same instant, and you have `SELECT ... FOR UPDATE` but **no** UNIQUE constraint on Disbursals. Under PostgreSQL's default READ COMMITTED isolation, does the second officer's transaction still see the status as approved, or as paid, after the first one commits? And why does that mean the lock alone is enough here, while the UNIQUE constraint is still worth keeping?"*

### The Answer:
1. **What Officer 2 sees:**
   - Under PostgreSQL `READ COMMITTED`, Officer 2 blocks while Officer 1 holds the row-level exclusive lock.
   - When Officer 1 updates `status = 'paid'` and commits, Officer 2 unblocks.
   - PostgreSQL re-evaluates the query's `WHERE status = 'approved'` filter against the **newly committed version** of the tuple.
   - Because the tuple status is now `'paid'`, the predicate evaluates to **FALSE**.
   - Officer 2 receives **0 rows**, exits the block, and creates **0 duplicate disbursals**.
2. **Why keep `UNIQUE(application_id, instalment_no)`?**
   - **Defense in depth:** Application developers might introduce batch scripts or retry workers that forget `SELECT ... FOR UPDATE`.
   - **Declarative Schema Invariant:** Application code is mutable; SQL DDL constraints provide a mathematical, tamper-proof backstop.

---

## 📂 Key Files Created
- `frontend/src/App.tsx`: Main unified application integrating all views.
- `frontend/src/components/TopTicker.tsx`: Live mandi price scrolling marquee.
- `frontend/src/components/Header.tsx`: Farmer.in navigation, language toggle, and role bar.
- `frontend/src/components/Hero.tsx`: Farmer.in dark green hero section with search and quick actions.
- `frontend/src/components/SchemesGrid.tsx`: Agricultural subsidy cards (Tractor, Solar Pump, Drip, KCC).
- `frontend/src/components/CitizenPortal.tsx`: Farmer profile, land records, and ACID application lifecycle tracker.
- `frontend/src/components/VerificationDesk.tsx`: Field officer document & parcel verification desk with separation of duties.
- `frontend/src/components/DisbursalDesk.tsx`: Disbursals queue, immutable ledger, and **Race Condition Attack Simulator**.
- `frontend/src/components/FraudConsole.tsx`: Incident console for all 4 fraud patterns + deliberate fraud injector.
- `frontend/src/components/DbmsDefenseSuite.tsx`: Dedicated examiner tab with DDL viewer, gap proofs, and viva explanations.
- `schema_ddl.sql`: Complete production-grade PostgreSQL 3NF DDL script.
