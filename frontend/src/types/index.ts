export type Language = 'en' | 'kn' | 'hi' | 'te' | 'ta' | 'mr' | 'pa';

export type ApplicationStatus = 
  | 'submitted'
  | 'under_review'
  | 'verified'
  | 'approved'
  | 'payment_initiated'
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
  attribute: 'land_area' | 'annual_income' | 'crop_type' | 'state';
  operator: '<=' | '>=' | '==' | '!=';
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
  documents: {
    doc_type: string;
    doc_name: string;
    hmac_signature: string;
    verified: boolean;
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
  entity_type: 'PARCEL' | 'BANK_ACCOUNT' | 'DOCUMENT' | 'DISBURSAL';
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
  action: 'INSERT' | 'UPDATE' | 'DELETE' | 'DISBURSAL_ATTEMPT';
  performed_by: string;
  timestamp: string;
  old_state?: string;
  new_state: string;
  status: 'SUCCESS' | 'BLOCKED_BY_CONSTRAINT' | 'BLOCKED_BY_TRIGGER';
}
