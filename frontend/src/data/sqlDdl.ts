// The DDL viewer shows the REAL schema file that the backend executes,
// imported at build time, so the UI can never drift from the database.
import schemaSql from '../../../database/schema.sql?raw';

export const POSTGRES_DDL: string = schemaSql;

// Mirrors backend/src/documents.js (collection validators + aggregation).
export const MONGO_SCHEMA = `// =========================================================================
// MONGODB: proof-document metadata (shape differs per scheme and per state)
// Source of truth for application STATUS is PostgreSQL; MongoDB holds only
// document metadata and verification logs. See backend/src/documents.js.
// =========================================================================

db.createCollection("document_uploads", {
  validator: { $jsonSchema: {
    bsonType: "object",
    required: ["application_id", "citizen_id", "scheme_code", "documents", "verification_status"],
    properties: {
      application_id:      { bsonType: "string" },     // = Applications.application_id in PostgreSQL
      citizen_id:          { bsonType: "string" },
      scheme_code:         { bsonType: "string" },
      verification_status: { enum: ["pending", "verified", "rejected"] },
      documents: { bsonType: "array", minItems: 1, items: {
        bsonType: "object",
        required: ["doc_type", "file_name", "file_sha256", "extracted", "uploaded_at"],
        properties: {
          doc_type:    { enum: ["AADHAAR","LAND_KHASRA","RTC_PAHANI","JAMABANDI","INCOME_CERT",
                                "BANK_PASSBOOK","QUOTATION","SITE_PHOTO"] },
          file_sha256: { bsonType: "string", minLength: 64, maxLength: 64 },  // hash of the file BYTES
          extracted: { bsonType: "object", properties: {                      // identifiers READ OFF the document
            aadhaar_hmac:  { bsonType: "string" },   // AADHAAR
            parcel_key:    { bsonType: "string" },   // RTC (Karnataka) / Jamabandi (Punjab) / Khasra (UP)
            annual_income: { bsonType: ["int","long","double","decimal"] },  // INCOME_CERT
            ifsc:          { bsonType: "string" },   // BANK_PASSBOOK
            account_no:    { bsonType: "string" }
          }},
          uploaded_at: { bsonType: "date" },
          verified:    { bsonType: "bool" }
        }
      }}
    }
  }},
  validationLevel: "strict", validationAction: "error"
});
db.document_uploads.createIndex({ application_id: 1 }, { unique: true });
db.document_uploads.createIndex({ "documents.extracted.aadhaar_hmac": 1 });

db.createCollection("verification_logs", { validator: { $jsonSchema: {
  bsonType: "object", required: ["application_id", "agent_id", "action", "timestamp"],
  properties: { action: { enum: ["reviewed","verified","approved","rejected","document_added"] } }
}}});

// -------------------------------------------------------------------------
// Fraud pattern 3: the same identity document used by DIFFERENT citizens.
// Groups on the EXTRACTED Aadhaar HMAC (Fix 6), not the file hash, so a
// rescan (new bytes, same card) is still caught.
// -------------------------------------------------------------------------
db.document_uploads.aggregate([
  { $unwind: "$documents" },
  { $match: { "documents.doc_type": "AADHAAR",
              "documents.extracted.aadhaar_hmac": { $exists: true } } },
  { $group: {
      _id: "$documents.extracted.aadhaar_hmac",
      citizens:     { $addToSet: "$citizen_id" },
      applications: { $addToSet: "$application_id" },
      files:        { $addToSet: "$documents.file_sha256" },
      uses:         { $sum: 1 } } },
  { $match: { "citizens.1": { $exists: true } } },   // 2+ distinct citizens
  { $sort: { uses: -1 } }
]);
// Each hit is written to PostgreSQL FraudFlags via raise_fraud_flag().
`;
