export type Language = 'en' | 'kn' | 'hi' | 'te' | 'ta' | 'mr' | 'pa';

export type ApplicationStatus = 
  | 'submitted'
  | 'under_review'
  | 'verified'
  | 'approved'
  | 'payment_initiated'
  | 'partially_paid'
  | 'paid'
  | 'rejected';

export interface Citizen {
  citizen_id: string;
  full_name: string;
  aadhaar_masked: string; // e.g. "XXXX-XXXX-4921"
  aadhaar_hmac: string; // HMAC-SHA256 hash
  phone: string;
  annual_income: number;
  bank_ifsc: string;
  bank_account_no: string;
  state: string;
  district: string;
  is_frozen?: boolean;
}

export interface LandParcel {
  parcel_id: string;
  state: string;
  district: string;
  taluk: string;
  village: string;
  survey_no: string;
  subdivision: string;
  area_acres: number;
}

export interface LandOwnership {
  ownership_id: string;
  parcel_id: string;
  citizen_id: string;
  share_fraction: number; // e.g., 0.5 for 50%
  claimed_area_acres: number;
}

export interface EligibilityRule {
  rule_id: string;
  scheme_id: string;
  attribute: 'land_area' | 'total_land_holding' | 'annual_income' | 'state';
  operator: '<=' | '>=' | '<' | '>' | '==' | '!=';
  target_value: string;
  description: string;
}

export interface Scheme {
  scheme_id: string;
  scheme_code: string;
  title_en: string;
  title_hi: string;
  category: string;
  subsidy_summary_en: string;
  subsidy_summary_hi: string;
  benefit_amount: number;
  instalments_count: number;
  image_url: string;
  tag_text: string;
  required_documents?: string[];
  rules: EligibilityRule[];
}

export interface SchemeApplication {
  application_id: string;
  citizen_id: string;
  citizen_name: string;
  scheme_id: string;
  scheme_title: string;
  cycle_year: number;
  parcel_id: string;
  parcel_key: string;
  status: ApplicationStatus;
  applied_at: string;
  verified_by?: string;
  verified_at?: string;
  approved_by?: string;
  approved_at?: string;
  rejection_reason?: string;
  instalments_paid?: number;
  instalments_count?: number;
  benefit_amount?: number;
  documents_missing?: boolean;
  documents: {
    doc_type: string;
    doc_name: string;
    hmac_signature: string;
    file_sha256?: string;
    verified: boolean;
    mismatch?: boolean; // Aadhaar on the document differs from the applicant's own
  }[];
}

export interface Disbursal {
  disbursal_id: string;
  application_id: string;
  citizen_id: string;
  citizen_name: string;
  scheme_id: string;
  scheme_title: string;
  instalment_no: number;
  amount: number;
  bank_ifsc: string;
  bank_account_no: string;
  txn_ref: string;
  pfms_status: 'SUCCESS' | 'PROCESSING' | 'FAILED';
  disbursed_at: string;
  disbursed_by: string;
}

export interface FraudFlag {
  flag_id: string;
  flag_type: 
    | 'GHOST_BENEFICIARY_OVERALLOCATION'
    | 'DUPLICATE_BANK_ACCOUNT'
    | 'DOCUMENT_REUSE_FUZZY_NAME'
    | 'RACE_CONDITION_DOUBLE_PAYOUT';
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  entity_type: 'PARCEL' | 'BANK_ACCOUNT' | 'DOCUMENT' | 'DISBURSAL' | 'CITIZEN';
  detected_by?: string;
  evidence?: unknown;
  entity_id: string;
  details: string;
  detected_at: string;
  resolved: boolean;
  resolved_by?: string;
  resolution_notes?: string;
}

export interface AuditLogEntry {
  log_id: string;
  entity_name: string;
  entity_id: string;
  action: 'INSERT' | 'UPDATE' | 'DELETE' | 'DISBURSAL_ATTEMPT' | string;
  performed_by: string;
  timestamp: string;
  old_state?: string;
  new_state: string;
  status: 'SUCCESS' | 'BLOCKED_BY_CONSTRAINT' | 'BLOCKED_BY_TRIGGER' | 'BLOCKED_BY_LOCK';
}

export interface Officer {
  officer_id: string;
  full_name: string;
  designation: string;
  can_verify: boolean;
  can_approve: boolean;
  can_disburse: boolean;
}

export type RaceMode = 'safe' | 'no_lock' | 'no_defence';

export interface RaceResult {
  run_id: string;
  mode: RaceMode;
  workers: number;
  application_id: string;
  successCount: number;
  blockedCount: number;
  ledgerRows: number;
  duplicatePayouts: number;
  leakage: number;
  blockedBy: Record<string, number>;
  elapsed_ms: number;
  logs: string[];
}

export interface EligibilityResult {
  eligible: boolean;
  message: string;
  rules: { rule_id: string; attribute: string; passed: boolean; message: string }[];
  duplicate: { application_id: string; status: string } | null;
}

export interface DbState {
  citizens: Citizen[];
  parcels: LandParcel[];
  ownerships: (LandOwnership & { parcel_key: string })[];
  officers: Officer[];
  schemes: Scheme[];
  applications: SchemeApplication[];
  disbursals: Disbursal[];
  fraudFlags: FraudFlag[];
  auditLogs: AuditLogEntry[];
  meta: { mongo: { connected: boolean; error: string | null; validators: boolean | null }; generated_at: string };
}
