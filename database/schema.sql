-- =========================================================================
-- KISAN DBT: Government Subsidy Eligibility + Disbursal Tracking System
-- PostgreSQL 14+ schema: 3NF tables, triggers, stored procedures, RLS
--
-- Run:  psql -U postgres -d subsidy_dbt -f database/schema.sql
-- The script is re-runnable: it drops and recreates everything in the
-- "public" schema. The backend's "Reset demo database" button runs it too.
-- =========================================================================

DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- HMAC-SHA256 (used by tests to cross-check the API's hashing)
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- trigram similarity() for fuzzy name matching

-- -------------------------------------------------------------------------
-- 0. Database roles (for Row-Level Security). NOLOGIN group roles; created
--    only if missing because roles are cluster-wide, not per-database.
-- -------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'citizen_role') THEN CREATE ROLE citizen_role NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agent_role')   THEN CREATE ROLE agent_role   NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'admin_role')   THEN CREATE ROLE admin_role   NOLOGIN; END IF;
END $$;

-- -------------------------------------------------------------------------
-- 1. Types
-- -------------------------------------------------------------------------
CREATE TYPE application_status_enum AS ENUM (
    'submitted', 'under_review', 'verified', 'approved',
    'payment_initiated', 'partially_paid', 'paid', 'rejected'
);
CREATE TYPE fraud_severity_enum AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM');
CREATE TYPE payment_attempt_status_enum AS ENUM ('INITIATED', 'SUCCESS', 'FAILED');

-- Human-readable IDs (CIT-1001, APP-2026-0001 ...) generated from sequences
CREATE SEQUENCE citizen_seq   START 1001;
CREATE SEQUENCE parcel_seq    START 101;
CREATE SEQUENCE ownership_seq START 1;
CREATE SEQUENCE app_seq       START 1;
CREATE SEQUENCE attempt_seq   START 1;
CREATE SEQUENCE disbursal_seq START 1;
CREATE SEQUENCE flag_seq      START 101;

-- zero-pad without truncating: plain lpad('12345', 4) would return '1234'
-- and silently create duplicate IDs once a sequence passes 9999
CREATE FUNCTION pad_id(n BIGINT, width INT) RETURNS TEXT
    LANGUAGE sql IMMUTABLE AS $$ SELECT lpad(n::TEXT, greatest(width, length(n::TEXT)), '0') $$;

-- -------------------------------------------------------------------------
-- 2. FraudFlags: created first, because triggers below write into it.
--    Flags are never "applied" to the suspect rows themselves; the vigilance
--    dashboard is just a query on this table, and resolutions are kept.
-- -------------------------------------------------------------------------
CREATE TABLE FraudFlags (
    flag_id          VARCHAR(20) PRIMARY KEY DEFAULT 'FLG-' || nextval('flag_seq'),
    flag_type        VARCHAR(60) NOT NULL CHECK (flag_type IN (
                         'GHOST_BENEFICIARY_OVERALLOCATION', 'DUPLICATE_BANK_ACCOUNT',
                         'DOCUMENT_REUSE_FUZZY_NAME', 'RACE_CONDITION_DOUBLE_PAYOUT')),
    severity         fraud_severity_enum NOT NULL,
    entity_type      VARCHAR(20) NOT NULL CHECK (entity_type IN ('PARCEL','BANK_ACCOUNT','DOCUMENT','CITIZEN','DISBURSAL')),
    entity_id        VARCHAR(200) NOT NULL,
    details          TEXT NOT NULL,
    evidence         JSONB,                       -- the quarantined row / matching records
    detected_by      VARCHAR(60) NOT NULL,        -- trigger or job that raised it
    detected_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved         BOOLEAN NOT NULL DEFAULT FALSE,
    resolved_by      VARCHAR(40),
    resolved_at      TIMESTAMPTZ,
    resolution_notes TEXT,
    CHECK (resolved = (resolved_by IS NOT NULL))
);

-- Helper used by all detection triggers/jobs
CREATE OR REPLACE FUNCTION raise_fraud_flag(
    p_type TEXT, p_severity fraud_severity_enum, p_entity_type TEXT, p_entity_id TEXT,
    p_details TEXT, p_evidence JSONB, p_detected_by TEXT
) RETURNS VARCHAR AS $$
DECLARE v_id VARCHAR;
BEGIN
    -- de-duplicate: one open flag per (type, entity)
    SELECT flag_id INTO v_id FROM FraudFlags
     WHERE flag_type = p_type AND entity_id = p_entity_id AND NOT resolved;
    IF FOUND THEN
        RETURN v_id;   -- already open: keep the original evidence, don't duplicate
    END IF;
    INSERT INTO FraudFlags (flag_type, severity, entity_type, entity_id, details, evidence, detected_by)
    VALUES (p_type, p_severity, p_entity_type, p_entity_id, p_details, p_evidence, p_detected_by)
    RETURNING flag_id INTO v_id;
    RETURN v_id;
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER SET search_path = public;  -- owner's rights: restricted roles still get audited/flagged

-- -------------------------------------------------------------------------
-- 3. Officers (who verifies / approves / pays)
-- -------------------------------------------------------------------------
CREATE TABLE Officers (
    officer_id   VARCHAR(40) PRIMARY KEY,
    full_name    VARCHAR(120) NOT NULL,
    designation  VARCHAR(80)  NOT NULL,
    can_verify   BOOLEAN NOT NULL DEFAULT FALSE,
    can_approve  BOOLEAN NOT NULL DEFAULT FALSE,
    can_disburse BOOLEAN NOT NULL DEFAULT FALSE
);

-- -------------------------------------------------------------------------
-- 4. Citizens
--    Fix 5: Aadhaar is stored only as a KEYED HMAC-SHA256 (key lives in the
--           API's environment, never in the DB) plus a masked display string.
--    Fix 4: bank accounts are unique per (IFSC, account_no), not account_no.
-- -------------------------------------------------------------------------
CREATE TABLE Citizens (
    citizen_id      VARCHAR(20) PRIMARY KEY DEFAULT 'CIT-' || nextval('citizen_seq'),
    full_name       VARCHAR(150) NOT NULL,
    aadhaar_masked  CHAR(14)     NOT NULL CHECK (aadhaar_masked ~ '^XXXX-XXXX-[0-9]{4}$'),
    aadhaar_hmac    CHAR(64)     NOT NULL,
    phone           VARCHAR(20)  NOT NULL,
    annual_income   NUMERIC(12,2) NOT NULL CHECK (annual_income >= 0),
    bank_ifsc       CHAR(11)     NOT NULL CHECK (bank_ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
    bank_account_no VARCHAR(20)  NOT NULL CHECK (bank_account_no ~ '^[0-9]{9,18}$'),
    state           VARCHAR(50)  NOT NULL,
    district        VARCHAR(50)  NOT NULL,
    is_frozen       BOOLEAN      NOT NULL DEFAULT FALSE,   -- admin can freeze an ID
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_citizen_aadhaar UNIQUE (aadhaar_hmac),
    CONSTRAINT uq_bank_account    UNIQUE (bank_ifsc, bank_account_no)
);
CREATE INDEX idx_citizens_name_trgm ON Citizens USING gin (full_name gin_trgm_ops);
CREATE INDEX idx_citizens_district  ON Citizens (state, district);

-- Screening trigger on registration.
-- WHY "RETURN NULL" AND NOT "RAISE EXCEPTION": an exception rolls back the
-- whole transaction, INCLUDING the FraudFlags row we just wrote (PostgreSQL
-- has no autonomous transactions). Returning NULL from a BEFORE trigger
-- silently skips the row instead, so the suspect registration is quarantined
-- (kept as JSON evidence in FraudFlags) and the flag survives the commit.
-- The UNIQUE constraints stay as the hard backstop if this trigger is ever
-- disabled.
CREATE OR REPLACE FUNCTION screen_new_citizen() RETURNS TRIGGER AS $$
DECLARE
    v_other Citizens%ROWTYPE;
    v_sim   REAL;
BEGIN
    -- (a) same Aadhaar already registered -> identity reuse
    SELECT * INTO v_other FROM Citizens WHERE aadhaar_hmac = NEW.aadhaar_hmac;
    IF FOUND THEN
        v_sim := similarity(NEW.full_name, v_other.full_name);
        PERFORM raise_fraud_flag('DOCUMENT_REUSE_FUZZY_NAME', 'HIGH', 'CITIZEN', 'AADHAAR ' || NEW.aadhaar_masked,
            format('Registration for "%s" reuses the Aadhaar HMAC already held by %s ("%s"). Name trigram similarity = %s. Row quarantined.',
                   NEW.full_name, v_other.citizen_id, v_other.full_name, round(v_sim::numeric, 2)),
            jsonb_build_object('attempted', to_jsonb(NEW), 'existing_citizen', v_other.citizen_id, 'similarity', v_sim),
            'trg_screen_new_citizen');
        RETURN NULL;
    END IF;

    -- (b) same (IFSC, account) already registered -> money-mule account
    SELECT * INTO v_other FROM Citizens
     WHERE bank_ifsc = NEW.bank_ifsc AND bank_account_no = NEW.bank_account_no;
    IF FOUND THEN
        PERFORM raise_fraud_flag('DUPLICATE_BANK_ACCOUNT', 'HIGH', 'BANK_ACCOUNT', NEW.bank_ifsc || ' / ' || NEW.bank_account_no,
            format('Registration for "%s" uses bank account %s/%s already linked to %s ("%s"). Row quarantined.',
                   NEW.full_name, NEW.bank_ifsc, NEW.bank_account_no, v_other.citizen_id, v_other.full_name),
            jsonb_build_object('attempted', to_jsonb(NEW), 'existing_citizen', v_other.citizen_id),
            'trg_screen_new_citizen');
        RETURN NULL;
    END IF;

    -- (c) very similar name in the same district -> allowed, but flagged for review
    SELECT c.* INTO v_other
      FROM Citizens c
     WHERE c.state = NEW.state AND c.district = NEW.district
       AND c.full_name % NEW.full_name                 -- uses the GIN trigram index
     ORDER BY similarity(c.full_name, NEW.full_name) DESC LIMIT 1;
    IF FOUND THEN
        v_sim := similarity(NEW.full_name, v_other.full_name);
        IF v_sim >= 0.6 THEN
            PERFORM raise_fraud_flag('DOCUMENT_REUSE_FUZZY_NAME', 'MEDIUM', 'CITIZEN', NEW.citizen_id,
                format('New citizen "%s" (%s) closely matches existing %s ("%s") in %s, similarity = %s. Registered, but needs field review.',
                       NEW.full_name, NEW.citizen_id, v_other.citizen_id, v_other.full_name, NEW.district, round(v_sim::numeric, 2)),
                jsonb_build_object('new_citizen', NEW.citizen_id, 'existing_citizen', v_other.citizen_id, 'similarity', v_sim),
                'trg_screen_new_citizen');
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER SET search_path = public;  -- owner's rights: restricted roles still get audited/flagged

CREATE TRIGGER trg_screen_new_citizen
BEFORE INSERT ON Citizens
FOR EACH ROW EXECUTE FUNCTION screen_new_citizen();

-- -------------------------------------------------------------------------
-- 5. Land parcels and ownership
--    Fix 1: survey numbers are unique only inside a village -> composite key.
--    Fix 2: joint ownership is legal -> separate LandOwnership table with
--           fractional shares; only total share > 1.0 is fraud.
-- -------------------------------------------------------------------------
CREATE TABLE LandParcels (
    parcel_id   VARCHAR(20) PRIMARY KEY DEFAULT 'PARCEL-' || nextval('parcel_seq'),
    state       VARCHAR(50)  NOT NULL,
    district    VARCHAR(50)  NOT NULL,
    taluk       VARCHAR(50)  NOT NULL,
    village     VARCHAR(100) NOT NULL,
    survey_no   VARCHAR(20)  NOT NULL,
    subdivision VARCHAR(20)  NOT NULL DEFAULT '',
    area_acres  NUMERIC(8,2) NOT NULL CHECK (area_acres > 0),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_parcel_location UNIQUE (state, district, taluk, village, survey_no, subdivision)
);

CREATE TABLE LandOwnership (
    ownership_id   VARCHAR(20) PRIMARY KEY DEFAULT 'OWN-' || nextval('ownership_seq'),
    parcel_id      VARCHAR(20) NOT NULL REFERENCES LandParcels(parcel_id) ON DELETE RESTRICT,
    citizen_id     VARCHAR(20) NOT NULL REFERENCES Citizens(citizen_id)  ON DELETE RESTRICT,
    share_fraction NUMERIC(4,3) NOT NULL CHECK (share_fraction > 0 AND share_fraction <= 1),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_parcel_citizen UNIQUE (parcel_id, citizen_id)
);
CREATE INDEX idx_ownership_citizen ON LandOwnership (citizen_id);

-- claimed area is DERIVED (share x parcel area), so it is a view, not a stored
-- column: storing it would be a transitive dependency (violates 3NF) and could
-- drift out of sync with area_acres.
CREATE VIEW v_ownership AS
SELECT o.ownership_id, o.parcel_id, o.citizen_id, o.share_fraction,
       round(o.share_fraction * p.area_acres, 2) AS claimed_area_acres,
       concat_ws('/', p.state, p.district, p.taluk, p.village, p.survey_no, NULLIF(p.subdivision, '')) AS parcel_key
  FROM LandOwnership o JOIN LandParcels p USING (parcel_id);

-- Ghost-beneficiary trigger: sum(share_fraction) on a parcel must stay <= 1.
-- Same quarantine pattern as screen_new_citizen (see comment there).
CREATE OR REPLACE FUNCTION check_parcel_share_allocation() RETURNS TRIGGER AS $$
DECLARE
    v_existing NUMERIC(6,3);
    v_owners   JSONB;
    v_key      TEXT;
BEGIN
    -- lock the parcel row so two concurrent claims cannot both pass the check
    PERFORM 1 FROM LandParcels WHERE parcel_id = NEW.parcel_id FOR UPDATE;

    SELECT COALESCE(SUM(share_fraction), 0),
           COALESCE(jsonb_agg(jsonb_build_object('citizen_id', citizen_id, 'share', share_fraction)), '[]')
      INTO v_existing, v_owners
      FROM LandOwnership
     WHERE parcel_id = NEW.parcel_id
       AND ownership_id IS DISTINCT FROM NEW.ownership_id;

    IF v_existing + NEW.share_fraction > 1.0 THEN
        SELECT parcel_key INTO v_key FROM (
            SELECT concat_ws('/', state, district, taluk, village, survey_no, NULLIF(subdivision, '')) AS parcel_key
              FROM LandParcels WHERE parcel_id = NEW.parcel_id) k;
        PERFORM raise_fraud_flag('GHOST_BENEFICIARY_OVERALLOCATION', 'CRITICAL', 'PARCEL', v_key,
            format('Claim by %s for a %s share of parcel %s would make the total %s (more than 100%% of the land). Existing owners: %s. Claim quarantined.',
                   NEW.citizen_id, NEW.share_fraction, NEW.parcel_id, v_existing + NEW.share_fraction, v_owners),
            jsonb_build_object('attempted', to_jsonb(NEW), 'existing_owners', v_owners, 'total', v_existing + NEW.share_fraction),
            'trg_check_parcel_share');
        RETURN NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER SET search_path = public;  -- owner's rights: restricted roles still get audited/flagged

CREATE TRIGGER trg_check_parcel_share
BEFORE INSERT OR UPDATE ON LandOwnership
FOR EACH ROW EXECUTE FUNCTION check_parcel_share_allocation();

-- -------------------------------------------------------------------------
-- 6. Schemes and generic eligibility rules
--    Fix 7: ONE source of truth for rules, one rule per row. New rule types
--           need a new row, not an ALTER TABLE.
-- -------------------------------------------------------------------------
CREATE TABLE Schemes (
    scheme_id          VARCHAR(20) PRIMARY KEY,
    scheme_code        VARCHAR(40) NOT NULL UNIQUE,
    title_en           VARCHAR(200) NOT NULL,
    title_hi           VARCHAR(200) NOT NULL,
    category           VARCHAR(100) NOT NULL,
    summary_en         TEXT NOT NULL,
    summary_hi         TEXT NOT NULL,
    benefit_amount     NUMERIC(10,2) NOT NULL CHECK (benefit_amount > 0),  -- per instalment
    instalments_count  INT NOT NULL DEFAULT 1 CHECK (instalments_count BETWEEN 1 AND 12),
    required_documents TEXT[] NOT NULL DEFAULT ARRAY['AADHAAR'],          -- enforced by API against MongoDB
    image_url          VARCHAR(200),
    tag_text           VARCHAR(100),
    is_active          BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE EligibilityRules (
    rule_id          VARCHAR(20) PRIMARY KEY,
    scheme_id        VARCHAR(20) NOT NULL REFERENCES Schemes(scheme_id) ON DELETE CASCADE,
    attribute        VARCHAR(30) NOT NULL CHECK (attribute IN ('land_area','total_land_holding','annual_income','state')),
    operator         VARCHAR(2)  NOT NULL CHECK (operator IN ('<=','>=','<','>','==','!=')),
    target_value     VARCHAR(50) NOT NULL,
    rule_description TEXT NOT NULL
);

-- Stored procedure: generic rule evaluator. Returns every rule with pass/fail
-- so the UI can show WHICH rule failed and why.
CREATE OR REPLACE FUNCTION check_citizen_eligibility(
    p_citizen_id VARCHAR, p_scheme_id VARCHAR, p_parcel_id VARCHAR
) RETURNS TABLE (rule_id VARCHAR, attribute VARCHAR, passed BOOLEAN, message TEXT) AS $$
#variable_conflict use_column
DECLARE
    c        Citizens%ROWTYPE;
    r        RECORD;
    v_actual TEXT;
    v_ok     BOOLEAN;
    v_area   NUMERIC;
    v_total  NUMERIC;
BEGIN
    SELECT * INTO c FROM Citizens WHERE citizen_id = p_citizen_id;
    IF NOT FOUND THEN
        RETURN QUERY SELECT 'SYS'::VARCHAR, 'citizen'::VARCHAR, FALSE, format('Citizen %s does not exist', p_citizen_id); RETURN;
    END IF;
    IF c.is_frozen THEN
        RETURN QUERY SELECT 'SYS'::VARCHAR, 'citizen'::VARCHAR, FALSE, 'Citizen ID is frozen by vigilance'; RETURN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM Schemes WHERE scheme_id = p_scheme_id AND is_active) THEN
        RETURN QUERY SELECT 'SYS'::VARCHAR, 'scheme'::VARCHAR, FALSE, format('Scheme %s is not active', p_scheme_id); RETURN;
    END IF;

    SELECT claimed_area_acres INTO v_area FROM v_ownership
     WHERE citizen_id = p_citizen_id AND parcel_id = p_parcel_id;
    IF v_area IS NULL THEN
        -- without this check, a NULL area would make every comparison NULL
        -- and the citizen would silently pass all land rules
        RETURN QUERY SELECT 'SYS'::VARCHAR, 'land_area'::VARCHAR, FALSE,
            format('Citizen %s has no recorded ownership share in parcel %s', p_citizen_id, p_parcel_id);
        RETURN;
    END IF;
    SELECT COALESCE(SUM(claimed_area_acres), 0) INTO v_total FROM v_ownership WHERE citizen_id = p_citizen_id;

    FOR r IN SELECT * FROM EligibilityRules er WHERE er.scheme_id = p_scheme_id ORDER BY er.rule_id LOOP
        v_actual := CASE r.attribute
            WHEN 'land_area'          THEN v_area::TEXT
            WHEN 'total_land_holding' THEN v_total::TEXT
            WHEN 'annual_income'      THEN c.annual_income::TEXT
            WHEN 'state'              THEN c.state
        END;
        IF r.attribute = 'state' THEN
            v_ok := CASE r.operator WHEN '==' THEN v_actual = r.target_value
                                    WHEN '!=' THEN v_actual <> r.target_value END;
        ELSE
            v_ok := CASE r.operator
                WHEN '<=' THEN v_actual::NUMERIC <= r.target_value::NUMERIC
                WHEN '>=' THEN v_actual::NUMERIC >= r.target_value::NUMERIC
                WHEN '<'  THEN v_actual::NUMERIC <  r.target_value::NUMERIC
                WHEN '>'  THEN v_actual::NUMERIC >  r.target_value::NUMERIC
                WHEN '==' THEN v_actual::NUMERIC =  r.target_value::NUMERIC
                WHEN '!=' THEN v_actual::NUMERIC <> r.target_value::NUMERIC
            END;
        END IF;
        RETURN QUERY SELECT r.rule_id, r.attribute, COALESCE(v_ok, FALSE),
            format('%s: actual %s, required %s %s', r.rule_description, v_actual, r.operator, r.target_value);
    END LOOP;
END;
$$ LANGUAGE plpgsql STABLE;

-- -------------------------------------------------------------------------
-- 7. Applications: PostgreSQL is the single source of truth for status (Fix 8)
--    Fix 3: one application per (citizen, scheme, cycle).
-- -------------------------------------------------------------------------
CREATE TABLE Applications (
    application_id   VARCHAR(20) PRIMARY KEY DEFAULT 'APP-' || to_char(now(), 'YYYY') || '-' || pad_id(nextval('app_seq'), 4),
    citizen_id       VARCHAR(20) NOT NULL REFERENCES Citizens(citizen_id),
    scheme_id        VARCHAR(20) NOT NULL REFERENCES Schemes(scheme_id),
    parcel_id        VARCHAR(20) NOT NULL REFERENCES LandParcels(parcel_id),
    cycle_year       INT NOT NULL CHECK (cycle_year BETWEEN 2020 AND 2100),
    status           application_status_enum NOT NULL DEFAULT 'submitted',
    applied_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    verified_by      VARCHAR(40) REFERENCES Officers(officer_id),
    verified_at      TIMESTAMPTZ,
    approved_by      VARCHAR(40) REFERENCES Officers(officer_id),
    approved_at      TIMESTAMPTZ,
    rejection_reason TEXT,
    CONSTRAINT uq_citizen_scheme_cycle UNIQUE (citizen_id, scheme_id, cycle_year),
    -- the citizen must actually own a share of the parcel they apply with
    CONSTRAINT fk_app_ownership FOREIGN KEY (parcel_id, citizen_id) REFERENCES LandOwnership(parcel_id, citizen_id),
    -- states past verification must carry a verifier; past approval an approver
    CONSTRAINT chk_verified_has_officer CHECK (status IN ('submitted','under_review','rejected') OR verified_by IS NOT NULL),
    CONSTRAINT chk_approved_has_officer CHECK (status NOT IN ('approved','payment_initiated','partially_paid','paid') OR approved_by IS NOT NULL),
    CONSTRAINT chk_rejected_has_reason  CHECK (status <> 'rejected' OR rejection_reason IS NOT NULL),
    -- separation of duties, declaratively (the trigger below gives a clearer message)
    CONSTRAINT chk_verifier_not_approver CHECK (verified_by IS NULL OR approved_by IS NULL OR verified_by <> approved_by)
);
CREATE INDEX idx_app_status  ON Applications (status);
CREATE INDEX idx_app_citizen ON Applications (citizen_id);

-- State machine:
--   submitted -> under_review -> verified -> approved -> payment_initiated
--   payment_initiated -> paid            (last instalment succeeded)
--   payment_initiated -> partially_paid  (more instalments remain)
--   payment_initiated -> approved        (bank transfer failed: retry allowed)
--   partially_paid    -> approved        (officer releases next instalment)
--   rejected from submitted / under_review / verified / approved
--   paid and rejected are terminal
CREATE OR REPLACE FUNCTION enforce_status_transition() RETURNS TRIGGER AS $$
DECLARE ok BOOLEAN;
BEGIN
    IF OLD.status = NEW.status THEN RETURN NEW; END IF;
    ok := (OLD.status, NEW.status) IN (
        ('submitted','under_review'), ('under_review','verified'), ('verified','approved'),
        ('approved','payment_initiated'), ('payment_initiated','paid'),
        ('payment_initiated','partially_paid'), ('payment_initiated','approved'),
        ('partially_paid','approved'),
        ('submitted','rejected'), ('under_review','rejected'), ('verified','rejected'), ('approved','rejected'));
    IF NOT ok THEN
        RAISE EXCEPTION 'Illegal state transition % -> % for application %', OLD.status, NEW.status, OLD.application_id
            USING ERRCODE = 'check_violation', HINT = 'trg_status_flow';
    END IF;
    IF NEW.status = 'verified' THEN NEW.verified_at := now(); END IF;
    IF NEW.status = 'approved' AND OLD.status = 'verified' THEN NEW.approved_at := now(); END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_status_flow
BEFORE UPDATE OF status ON Applications
FOR EACH ROW EXECUTE FUNCTION enforce_status_transition();

-- Separation of duties + officer permissions
CREATE OR REPLACE FUNCTION enforce_officer_duties() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.verified_by IS DISTINCT FROM OLD.verified_by AND NEW.verified_by IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM Officers WHERE officer_id = NEW.verified_by AND can_verify) THEN
            RAISE EXCEPTION 'Officer % is not authorised to verify applications', NEW.verified_by
                USING ERRCODE = 'insufficient_privilege', HINT = 'trg_separation_of_duties';
        END IF;
    END IF;
    IF NEW.approved_by IS DISTINCT FROM OLD.approved_by AND NEW.approved_by IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM Officers WHERE officer_id = NEW.approved_by AND can_approve) THEN
            RAISE EXCEPTION 'Officer % is not authorised to approve applications', NEW.approved_by
                USING ERRCODE = 'insufficient_privilege', HINT = 'trg_separation_of_duties';
        END IF;
        IF NEW.approved_by = NEW.verified_by THEN
            RAISE EXCEPTION 'Accountability violation: verifier % cannot also approve application %', NEW.verified_by, NEW.application_id
                USING ERRCODE = 'insufficient_privilege', HINT = 'trg_separation_of_duties';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER SET search_path = public;  -- owner's rights: restricted roles still get audited/flagged

CREATE TRIGGER trg_separation_of_duties
BEFORE UPDATE OF verified_by, approved_by ON Applications
FOR EACH ROW EXECUTE FUNCTION enforce_officer_duties();

-- -------------------------------------------------------------------------
-- 8. Payments
--    Fix 9: the real bank transfer (PFMS) is an EXTERNAL call and cannot sit
--    inside a DB transaction (COMMIT cannot recall money). So payment is two
--    short transactions around the external call:
--        initiate_payment()  approved -> payment_initiated, writes an attempt
--        <call bank with idempotent txn_ref>
--        complete_payment()  writes the ledger row, moves status on
-- -------------------------------------------------------------------------
CREATE TABLE PaymentAttempts (
    attempt_id    VARCHAR(20) PRIMARY KEY DEFAULT 'PAY-' || pad_id(nextval('attempt_seq'), 5),
    application_id VARCHAR(20) NOT NULL REFERENCES Applications(application_id),
    instalment_no INT NOT NULL CHECK (instalment_no >= 1),
    amount        NUMERIC(10,2) NOT NULL CHECK (amount > 0),
    txn_ref       VARCHAR(60) NOT NULL UNIQUE,      -- idempotency key sent to the bank
    status        payment_attempt_status_enum NOT NULL DEFAULT 'INITIATED',
    initiated_by  VARCHAR(40) NOT NULL REFERENCES Officers(officer_id),
    initiated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at  TIMESTAMPTZ,
    failure_reason TEXT
);
-- at most one in-flight attempt per application
CREATE UNIQUE INDEX uq_one_inflight_attempt ON PaymentAttempts (application_id) WHERE status = 'INITIATED';

-- Fix 3 + 9: append-only ledger, one row per (application, instalment)
CREATE TABLE Disbursals (
    disbursal_id    VARCHAR(20) PRIMARY KEY DEFAULT 'TXN-DBT-' || pad_id(nextval('disbursal_seq'), 5),
    application_id  VARCHAR(20) NOT NULL REFERENCES Applications(application_id),
    instalment_no   INT NOT NULL CHECK (instalment_no >= 1),
    amount          NUMERIC(10,2) NOT NULL CHECK (amount > 0),
    bank_ifsc       CHAR(11) NOT NULL,     -- snapshot of where the money actually went
    bank_account_no VARCHAR(20) NOT NULL,
    txn_ref         VARCHAR(60) NOT NULL UNIQUE REFERENCES PaymentAttempts(txn_ref),
    disbursed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    disbursed_by    VARCHAR(40) NOT NULL REFERENCES Officers(officer_id),
    CONSTRAINT uq_application_instalment UNIQUE (application_id, instalment_no)
);

CREATE OR REPLACE FUNCTION protect_disbursals_append_only() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Financial ledger violation: Disbursals is append-only (% blocked)', TG_OP
        USING ERRCODE = 'insufficient_privilege', HINT = 'trg_disbursal_immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_disbursal_immutable
BEFORE UPDATE OR DELETE ON Disbursals
FOR EACH ROW EXECUTE FUNCTION protect_disbursals_append_only();
-- TRUNCATE does not fire row-level triggers, so it needs its own guard
CREATE TRIGGER trg_disbursal_no_truncate
BEFORE TRUNCATE ON Disbursals
FOR EACH STATEMENT EXECUTE FUNCTION protect_disbursals_append_only();

-- Step 1 of payment. Concurrency guarantee: SELECT ... FOR UPDATE with
-- "status = 'approved'" in the WHERE clause. A second officer blocks on the
-- row lock; when the first commits, READ COMMITTED re-checks the WHERE
-- against the new row version ('payment_initiated'), finds no row, and the
-- second call fails cleanly with NOT_PAYABLE.
CREATE OR REPLACE FUNCTION initiate_payment(p_application_id VARCHAR, p_officer VARCHAR)
RETURNS TABLE (attempt_id VARCHAR, txn_ref VARCHAR, instalment_no INT, amount NUMERIC) AS $$
#variable_conflict use_column
DECLARE
    a       Applications%ROWTYPE;
    s       Schemes%ROWTYPE;
    v_next  INT;
    v_ref   VARCHAR;
    v_att   VARCHAR;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM Officers WHERE officer_id = p_officer AND can_disburse) THEN
        RAISE EXCEPTION 'Officer % is not authorised to disburse funds', p_officer
            USING ERRCODE = 'insufficient_privilege', HINT = 'initiate_payment';
    END IF;

    SELECT * INTO a FROM Applications
     WHERE application_id = p_application_id AND status = 'approved'
       FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_PAYABLE: application % is not in approved state (already being paid, paid, or not approved)', p_application_id
            USING ERRCODE = 'lock_not_available', HINT = 'initiate_payment';
    END IF;
    IF p_officer = a.verified_by THEN
        RAISE EXCEPTION 'Accountability violation: verifier % cannot release payment for %', p_officer, p_application_id
            USING ERRCODE = 'insufficient_privilege', HINT = 'initiate_payment';
    END IF;

    SELECT * INTO s FROM Schemes WHERE scheme_id = a.scheme_id;
    SELECT COUNT(*) + 1 INTO v_next FROM Disbursals d WHERE d.application_id = p_application_id;
    IF v_next > s.instalments_count THEN
        RAISE EXCEPTION 'All % instalments of % are already paid', s.instalments_count, p_application_id
            USING ERRCODE = 'check_violation', HINT = 'initiate_payment';
    END IF;

    v_ref := format('PFMS/%s/%s/I%s', a.cycle_year, a.application_id, v_next);
    -- a previous FAILED attempt for this instalment gets a fresh suffix
    IF EXISTS (SELECT 1 FROM PaymentAttempts pa WHERE pa.txn_ref = v_ref) THEN
        v_ref := v_ref || '/R' || (SELECT COUNT(*) FROM PaymentAttempts pa
                                    WHERE pa.application_id = p_application_id AND pa.instalment_no = v_next);
    END IF;

    UPDATE Applications SET status = 'payment_initiated' WHERE application_id = p_application_id;
    INSERT INTO PaymentAttempts (application_id, instalment_no, amount, txn_ref, initiated_by)
    VALUES (p_application_id, v_next, s.benefit_amount, v_ref, p_officer)
    RETURNING PaymentAttempts.attempt_id INTO v_att;

    RETURN QUERY SELECT v_att, v_ref, v_next, s.benefit_amount;
END;
$$ LANGUAGE plpgsql;

-- Step 2 of payment: record the bank's answer. Idempotent on txn_ref: calling
-- it twice with the same reference does nothing the second time.
CREATE OR REPLACE FUNCTION complete_payment(p_txn_ref VARCHAR, p_success BOOLEAN, p_failure_reason TEXT DEFAULT NULL)
RETURNS VARCHAR AS $$
DECLARE
    pa   PaymentAttempts%ROWTYPE;
    c    Citizens%ROWTYPE;
    s    Schemes%ROWTYPE;
    v_id VARCHAR;
BEGIN
    SELECT * INTO pa FROM PaymentAttempts WHERE txn_ref = p_txn_ref FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Unknown txn_ref %', p_txn_ref; END IF;
    IF pa.status <> 'INITIATED' THEN
        RETURN 'ALREADY_' || pa.status;   -- idempotent replay
    END IF;

    IF NOT p_success THEN
        UPDATE PaymentAttempts SET status = 'FAILED', completed_at = now(), failure_reason = p_failure_reason
         WHERE attempt_id = pa.attempt_id;
        UPDATE Applications SET status = 'approved' WHERE application_id = pa.application_id;
        RETURN 'FAILED';
    END IF;

    SELECT ci.* INTO c FROM Citizens ci JOIN Applications ap USING (citizen_id) WHERE ap.application_id = pa.application_id;
    SELECT sc.* INTO s FROM Schemes sc JOIN Applications ap USING (scheme_id) WHERE ap.application_id = pa.application_id;

    UPDATE PaymentAttempts SET status = 'SUCCESS', completed_at = now() WHERE attempt_id = pa.attempt_id;
    INSERT INTO Disbursals (application_id, instalment_no, amount, bank_ifsc, bank_account_no, txn_ref, disbursed_by)
    VALUES (pa.application_id, pa.instalment_no, pa.amount, c.bank_ifsc, c.bank_account_no, pa.txn_ref, pa.initiated_by)
    RETURNING disbursal_id INTO v_id;

    UPDATE Applications
       SET status = CASE WHEN pa.instalment_no >= s.instalments_count THEN 'paid'::application_status_enum
                         ELSE 'partially_paid'::application_status_enum END
     WHERE application_id = pa.application_id;
    RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- -------------------------------------------------------------------------
-- 9. Audit log: generic trigger on every important table.
--    The acting user comes from a transaction-local setting the API sets:
--        SET LOCAL app.actor = 'OFFICER_VERIFIER_10';
--    Blocked attempts are rolled back together with their audit row, so the
--    API records those separately (status BLOCKED_BY_*) after the rollback.
-- -------------------------------------------------------------------------
CREATE TABLE AuditLog (
    log_id       BIGSERIAL PRIMARY KEY,
    entity_name  VARCHAR(50)  NOT NULL,
    entity_id    VARCHAR(100) NOT NULL,
    action       VARCHAR(30)  NOT NULL,
    performed_by VARCHAR(60)  NOT NULL,
    logged_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    old_state    JSONB,
    new_state    JSONB,
    status       VARCHAR(30)  NOT NULL DEFAULT 'SUCCESS'
                 CHECK (status IN ('SUCCESS','BLOCKED_BY_CONSTRAINT','BLOCKED_BY_TRIGGER','BLOCKED_BY_LOCK'))
);
CREATE INDEX idx_audit_entity ON AuditLog (entity_name, entity_id);

CREATE OR REPLACE FUNCTION audit_row_change() RETURNS TRIGGER AS $$
DECLARE
    v_pk  TEXT := TG_ARGV[0];
    v_row JSONB := to_jsonb(COALESCE(NEW, OLD));
BEGIN
    INSERT INTO AuditLog (entity_name, entity_id, action, performed_by, old_state, new_state)
    VALUES (TG_TABLE_NAME, v_row ->> v_pk, TG_OP,
            COALESCE(NULLIF(current_setting('app.actor', true), ''), session_user),
            CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
            CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER SET search_path = public;  -- owner's rights: restricted roles still get audited/flagged

CREATE TRIGGER trg_audit_citizens     AFTER INSERT OR UPDATE OR DELETE ON Citizens        FOR EACH ROW EXECUTE FUNCTION audit_row_change('citizen_id');
CREATE TRIGGER trg_audit_ownership    AFTER INSERT OR UPDATE OR DELETE ON LandOwnership   FOR EACH ROW EXECUTE FUNCTION audit_row_change('ownership_id');
CREATE TRIGGER trg_audit_applications AFTER INSERT OR UPDATE OR DELETE ON Applications    FOR EACH ROW EXECUTE FUNCTION audit_row_change('application_id');
CREATE TRIGGER trg_audit_attempts     AFTER INSERT OR UPDATE           ON PaymentAttempts FOR EACH ROW EXECUTE FUNCTION audit_row_change('attempt_id');
CREATE TRIGGER trg_audit_disbursals   AFTER INSERT                     ON Disbursals      FOR EACH ROW EXECUTE FUNCTION audit_row_change('disbursal_id');
CREATE TRIGGER trg_audit_flags        AFTER INSERT OR UPDATE           ON FraudFlags      FOR EACH ROW EXECUTE FUNCTION audit_row_change('flag_id');

-- -------------------------------------------------------------------------
-- 10. Race-condition teaching table: a ledger with NO unique constraint.
--     Used only by the "no lock, no constraint" mode of the race simulator to
--     show what would happen without either defence. Never used for real money.
-- -------------------------------------------------------------------------
CREATE TABLE RaceDemoLedger (
    row_id         BIGSERIAL PRIMARY KEY,
    run_id         VARCHAR(40) NOT NULL,
    application_id VARCHAR(20) NOT NULL,
    instalment_no  INT NOT NULL,
    amount         NUMERIC(10,2) NOT NULL,
    worker_no      INT NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -------------------------------------------------------------------------
-- 11. Roles, privileges and Row-Level Security
--     The API connects as the table owner (owners bypass RLS). These policies
--     apply to clients that connect with the restricted roles; see
--     database/demo_rls.sql for a runnable demonstration.
-- -------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO citizen_role, agent_role, admin_role;

GRANT SELECT ON Schemes, EligibilityRules TO citizen_role, agent_role, admin_role;
GRANT SELECT ON Citizens, Applications, Disbursals, LandOwnership, LandParcels TO citizen_role;

GRANT SELECT ON Citizens, LandParcels, LandOwnership, Applications TO agent_role;
GRANT UPDATE (status, verified_by, rejection_reason) ON Applications TO agent_role;   -- column-level: cannot set approved_by

GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO admin_role;
REVOKE UPDATE ON Disbursals FROM admin_role;  -- even admins cannot edit the ledger
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO admin_role;

ALTER TABLE Citizens      ENABLE ROW LEVEL SECURITY;
ALTER TABLE Applications  ENABLE ROW LEVEL SECURITY;
ALTER TABLE Disbursals    ENABLE ROW LEVEL SECURITY;
ALTER TABLE LandOwnership ENABLE ROW LEVEL SECURITY;

-- citizens see only their own rows
CREATE POLICY citizen_own_record  ON Citizens      FOR SELECT TO citizen_role USING (citizen_id = current_setting('app.current_citizen_id', true));
CREATE POLICY citizen_own_apps    ON Applications  FOR SELECT TO citizen_role USING (citizen_id = current_setting('app.current_citizen_id', true));
CREATE POLICY citizen_own_land    ON LandOwnership FOR SELECT TO citizen_role USING (citizen_id = current_setting('app.current_citizen_id', true));
CREATE POLICY citizen_own_money   ON Disbursals    FOR SELECT TO citizen_role
    USING (application_id IN (SELECT application_id FROM Applications WHERE citizen_id = current_setting('app.current_citizen_id', true)));

-- verifying agents: read everything needed for review, update only pre-approval applications
CREATE POLICY agent_read_citizens ON Citizens      FOR SELECT TO agent_role USING (true);
CREATE POLICY agent_read_land     ON LandOwnership FOR SELECT TO agent_role USING (true);
CREATE POLICY agent_read_apps     ON Applications  FOR SELECT TO agent_role USING (true);
CREATE POLICY agent_update_apps   ON Applications  FOR UPDATE TO agent_role
    USING (status IN ('submitted','under_review'))
    WITH CHECK (status IN ('under_review','verified','rejected'));

-- admins see and manage everything (ledger still append-only via trigger)
CREATE POLICY admin_all_citizens  ON Citizens      FOR ALL TO admin_role USING (true) WITH CHECK (true);
CREATE POLICY admin_all_apps      ON Applications  FOR ALL TO admin_role USING (true) WITH CHECK (true);
CREATE POLICY admin_all_land      ON LandOwnership FOR ALL TO admin_role USING (true) WITH CHECK (true);
CREATE POLICY admin_read_money    ON Disbursals    FOR SELECT TO admin_role USING (true);
CREATE POLICY admin_insert_money  ON Disbursals    FOR INSERT TO admin_role WITH CHECK (true);
