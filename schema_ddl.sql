-- =========================================================================
-- FARMER.IN DIRECT BENEFIT TRANSFER (DBT) & FRAUD PREVENTION PLATFORM
-- Normalized 3NF PostgreSQL DDL Schema with Triggers, Procedures & RLS
-- =========================================================================

-- 1. Enable Required Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";    -- For HMAC-SHA256 Aadhaar hashing
CREATE EXTENSION IF NOT EXISTS "pg_trgm";      -- For Trigram fuzzy name similarity

-- 2. Enumerated State Machine Type
CREATE TYPE application_status_enum AS ENUM (
    'submitted',
    'under_review',
    'verified',
    'approved',
    'payment_initiated',
    'paid',
    'rejected'
);

CREATE TYPE fraud_severity_enum AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM');

-- 3. Citizens Table
-- Fix ⑤: Aadhaar stored as HMAC-SHA256 keyed hash (never plaintext or plain reversible hash)
-- Fix ④: Bank account identified by (bank_ifsc, bank_account_no) composite
CREATE TABLE Citizens (
    citizen_id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name VARCHAR(150) NOT NULL,
    aadhaar_masked VARCHAR(20) NOT NULL, -- e.g. "XXXX-XXXX-4921"
    aadhaar_hmac VARCHAR(64) NOT NULL UNIQUE, -- Keyed HMAC-SHA256
    phone VARCHAR(15) NOT NULL,
    annual_income NUMERIC(12, 2) NOT NULL CHECK (annual_income >= 0),
    bank_ifsc VARCHAR(11) NOT NULL,
    bank_account_no VARCHAR(30) NOT NULL,
    state VARCHAR(50) NOT NULL,
    district VARCHAR(50) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_bank_account UNIQUE (bank_ifsc, bank_account_no)
);

-- Index for fuzzy name search using trigrams (Item 3.C)
CREATE INDEX idx_citizens_name_trgm ON Citizens USING gin (full_name gin_trgm_ops);

-- 4. Land Parcels Table
-- Fix ①: Survey numbers are not globally unique; composite UNIQUE constraint ensures parcel integrity
CREATE TABLE LandParcels (
    parcel_id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
    state VARCHAR(50) NOT NULL,
    district VARCHAR(50) NOT NULL,
    taluk VARCHAR(50) NOT NULL,
    village VARCHAR(100) NOT NULL,
    survey_no VARCHAR(50) NOT NULL,
    subdivision VARCHAR(50) NOT NULL,
    area_acres NUMERIC(8, 2) NOT NULL CHECK (area_acres > 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_parcel_location UNIQUE (state, district, taluk, village, survey_no, subdivision)
);

-- 5. Land Ownership Table (Fix ②: Legal Joint Ownership Normalized)
-- Handles brothers co-owning inherited land with fractional shares
CREATE TABLE LandOwnership (
    ownership_id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
    parcel_id VARCHAR(36) NOT NULL REFERENCES LandParcels(parcel_id) ON DELETE RESTRICT,
    citizen_id VARCHAR(36) NOT NULL REFERENCES Citizens(citizen_id) ON DELETE CASCADE,
    share_fraction NUMERIC(4, 3) NOT NULL CHECK (share_fraction > 0 AND share_fraction <= 1.0),
    claimed_area_acres NUMERIC(8, 2) NOT NULL CHECK (claimed_area_acres > 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_parcel_citizen UNIQUE (parcel_id, citizen_id)
);

-- Trigger: Prevent Ghost Beneficiaries (Sum of shares on parcel must not exceed 1.0)
CREATE OR REPLACE FUNCTION check_parcel_share_allocation()
RETURNS TRIGGER AS $$
DECLARE
    v_total_share NUMERIC(6, 3);
BEGIN
    SELECT COALESCE(SUM(share_fraction), 0) INTO v_total_share
    FROM LandOwnership
    WHERE parcel_id = NEW.parcel_id AND ownership_id != COALESCE(NEW.ownership_id, '00000000-0000-0000-0000-000000000000');

    v_total_share := v_total_share + NEW.share_fraction;

    IF v_total_share > 1.0001 THEN
        -- Insert into FraudFlags table automatically
        INSERT INTO FraudFlags (flag_type, severity, entity_type, entity_id, details)
        VALUES (
            'GHOST_BENEFICIARY_OVERALLOCATION',
            'CRITICAL',
            'PARCEL',
            NEW.parcel_id,
            FORMAT('Attempted total share fraction %s exceeds 100%% of parcel boundary.', v_total_share)
        );
        RAISE EXCEPTION 'Ghost Beneficiary Blocked: Total share fraction % exceeds 1.0 on parcel %', v_total_share, NEW.parcel_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_parcel_share
BEFORE INSERT OR UPDATE ON LandOwnership
FOR EACH ROW EXECUTE FUNCTION check_parcel_share_allocation();

-- 6. Schemes Table
CREATE TABLE Schemes (
    scheme_id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
    scheme_code VARCHAR(50) NOT NULL UNIQUE,
    title VARCHAR(200) NOT NULL,
    category VARCHAR(100) NOT NULL,
    benefit_amount NUMERIC(10, 2) NOT NULL CHECK (benefit_amount > 0),
    instalments_count INT NOT NULL DEFAULT 1 CHECK (instalments_count >= 1),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 7. Eligibility Rules Table (Fix ⑦: Dynamic Generic Rules)
CREATE TABLE EligibilityRules (
    rule_id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
    scheme_id VARCHAR(36) NOT NULL REFERENCES Schemes(scheme_id) ON DELETE CASCADE,
    attribute VARCHAR(50) NOT NULL, -- e.g., 'land_area', 'annual_income'
    operator VARCHAR(10) NOT NULL,  -- '<=', '>=', '==', '!='
    target_value VARCHAR(50) NOT NULL,
    rule_description TEXT NOT NULL
);

-- 8. Applications Table
-- Fix ③: UNIQUE (citizen_id, scheme_id, cycle_year) blocks multiple open claims in same cycle
-- Fix ⑧: PostgreSQL is the single source of truth for status
CREATE TABLE Applications (
    application_id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
    citizen_id VARCHAR(36) NOT NULL REFERENCES Citizens(citizen_id),
    scheme_id VARCHAR(36) NOT NULL REFERENCES Schemes(scheme_id),
    cycle_year INT NOT NULL CHECK (cycle_year >= 2020),
    parcel_id VARCHAR(36) NOT NULL REFERENCES LandParcels(parcel_id),
    status application_status_enum NOT NULL DEFAULT 'submitted',
    applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    verified_by VARCHAR(100),
    verified_at TIMESTAMP WITH TIME ZONE,
    approved_by VARCHAR(100),
    approved_at TIMESTAMP WITH TIME ZONE,
    rejection_reason TEXT,
    CONSTRAINT uq_citizen_scheme_cycle UNIQUE (citizen_id, scheme_id, cycle_year)
);

-- 9. Trigger: Valid State Machine Flow
-- submitted -> under_review -> verified -> approved -> payment_initiated -> paid (or rejected)
CREATE OR REPLACE FUNCTION enforce_status_transition()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status = NEW.status THEN
        RETURN NEW;
    END IF;

    -- Rejections are allowed from any pending stage
    IF NEW.status = 'rejected' THEN
        IF OLD.status IN ('paid') THEN
            RAISE EXCEPTION 'Illegal State Transition: Cannot reject an already PAID application.';
        END IF;
        RETURN NEW;
    END IF;

    -- Strict State Progression
    IF OLD.status = 'submitted' AND NEW.status != 'under_review' THEN
        RAISE EXCEPTION 'Illegal State: submitted must transition to under_review first.';
    ELSIF OLD.status = 'under_review' AND NEW.status != 'verified' THEN
        RAISE EXCEPTION 'Illegal State: under_review must transition to verified next.';
    ELSIF OLD.status = 'verified' AND NEW.status != 'approved' THEN
        RAISE EXCEPTION 'Illegal State: verified must transition to approved next.';
    ELSIF OLD.status = 'approved' AND NEW.status != 'payment_initiated' THEN
        RAISE EXCEPTION 'Illegal State: approved must transition to payment_initiated next.';
    ELSIF OLD.status = 'payment_initiated' AND NEW.status != 'paid' THEN
        RAISE EXCEPTION 'Illegal State: payment_initiated must transition to paid.';
    ELSIF OLD.status = 'paid' THEN
        RAISE EXCEPTION 'Immutable Terminal State: Application is already PAID.';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_status_flow
BEFORE UPDATE OF status ON Applications
FOR EACH ROW EXECUTE FUNCTION enforce_status_transition();

-- 10. Trigger: Separation of Duties (Verifier != Approver)
CREATE OR REPLACE FUNCTION prevent_self_approval()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.approved_by IS NOT NULL AND NEW.verified_by IS NOT NULL THEN
        IF NEW.approved_by = NEW.verified_by THEN
            RAISE EXCEPTION 'Accountability Violation: Verifier (%) cannot be the Approver for application %',
                NEW.verified_by, NEW.application_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_separation_of_duties
BEFORE UPDATE OF approved_by ON Applications
FOR EACH ROW EXECUTE FUNCTION prevent_self_approval();

-- 11. Disbursals Table (Fix ③ & ⑨: Append-Only Ledger with Idempotent Reference)
CREATE TABLE Disbursals (
    disbursal_id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id VARCHAR(36) NOT NULL REFERENCES Applications(application_id),
    instalment_no INT NOT NULL DEFAULT 1 CHECK (instalment_no >= 1),
    amount NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
    bank_ifsc VARCHAR(11) NOT NULL,
    bank_account_no VARCHAR(30) NOT NULL,
    txn_ref VARCHAR(100) NOT NULL UNIQUE, -- Idempotent PFMS Banking reference
    pfms_status VARCHAR(20) NOT NULL DEFAULT 'SUCCESS',
    disbursed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    disbursed_by VARCHAR(100) NOT NULL,
    CONSTRAINT uq_application_instalment UNIQUE (application_id, instalment_no)
);

-- 12. Trigger: Append-Only Disbursal Ledger (No UPDATE or DELETE allowed)
CREATE OR REPLACE FUNCTION protect_disbursals_append_only()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Financial Ledger Violation: Disbursal records are immutable and cannot be updated or deleted.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_disbursal_immutable
BEFORE UPDATE OR DELETE ON Disbursals
FOR EACH ROW EXECUTE FUNCTION protect_disbursals_append_only();

-- 13. Stored Procedure: Dynamic Eligibility Checker (Fix ⑦)
CREATE OR REPLACE FUNCTION check_citizen_eligibility(
    p_citizen_id VARCHAR(36),
    p_scheme_id VARCHAR(36),
    p_parcel_id VARCHAR(36)
)
RETURNS TABLE (
    is_eligible BOOLEAN,
    failed_rule TEXT
) AS $$
DECLARE
    r RECORD;
    v_income NUMERIC(12, 2);
    v_claimed_area NUMERIC(8, 2);
    v_val NUMERIC;
BEGIN
    SELECT annual_income INTO v_income FROM Citizens WHERE citizen_id = p_citizen_id;
    SELECT claimed_area_acres INTO v_claimed_area 
    FROM LandOwnership 
    WHERE citizen_id = p_citizen_id AND parcel_id = p_parcel_id;

    FOR r IN SELECT * FROM EligibilityRules WHERE scheme_id = p_scheme_id LOOP
        IF r.attribute = 'annual_income' THEN
            v_val := r.target_value::NUMERIC;
            IF r.operator = '<=' AND v_income > v_val THEN
                RETURN QUERY SELECT FALSE, FORMAT('Income ₹%s exceeds maximum allowed ₹%s', v_income, v_val);
                RETURN;
            END IF;
        ELSIF r.attribute = 'land_area' THEN
            v_val := r.target_value::NUMERIC;
            IF r.operator = '<=' AND v_claimed_area > v_val THEN
                RETURN QUERY SELECT FALSE, FORMAT('Land area %s ac exceeds ceiling of %s ac', v_claimed_area, v_val);
                RETURN;
            ELSIF r.operator = '>=' AND v_claimed_area < v_val THEN
                RETURN QUERY SELECT FALSE, FORMAT('Land area %s ac is below minimum requirement of %s ac', v_claimed_area, v_val);
                RETURN;
            END IF;
        END IF;
    END LOOP;

    RETURN QUERY SELECT TRUE, 'All eligibility criteria satisfied.';
END;
$$ LANGUAGE plpgsql;

-- 14. Fraud Flags Table (Fix 3.B)
CREATE TABLE FraudFlags (
    flag_id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
    flag_type VARCHAR(100) NOT NULL,
    severity fraud_severity_enum NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id VARCHAR(200) NOT NULL,
    details TEXT NOT NULL,
    detected_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    resolved BOOLEAN NOT NULL DEFAULT FALSE,
    resolved_by VARCHAR(100),
    resolution_notes TEXT
);

-- 15. Audit Log Table (Fix 3.A)
CREATE TABLE AuditLog (
    log_id BIGSERIAL PRIMARY KEY,
    entity_name VARCHAR(50) NOT NULL,
    entity_id VARCHAR(100) NOT NULL,
    action VARCHAR(50) NOT NULL,
    performed_by VARCHAR(100) NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    old_state JSONB,
    new_state JSONB,
    status VARCHAR(50) NOT NULL
);

-- 16. Row-Level Security (RLS) Setup
ALTER TABLE Citizens ENABLE ROW LEVEL SECURITY;
ALTER TABLE Applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY citizen_view_own_record ON Citizens
    FOR SELECT TO citizen_role
    USING (citizen_id = current_setting('app.current_citizen_id', true));

CREATE POLICY agent_view_all_applications ON Applications
    FOR ALL TO agent_role
    USING (true);
