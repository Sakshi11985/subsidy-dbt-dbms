// MongoDB side: proof-document metadata + verification logs.
// PostgreSQL stays the single source of truth for application STATUS; this
// store only holds document metadata, whose shape differs per scheme.
import { mongo, mongoStatus } from './db.js';

export const DOC_TYPES = ['AADHAAR', 'LAND_KHASRA', 'RTC_PAHANI', 'JAMABANDI', 'INCOME_CERT', 'BANK_PASSBOOK', 'QUOTATION', 'SITE_PHOTO'];

const documentUploadsSchema = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['application_id', 'citizen_id', 'scheme_code', 'documents', 'verification_status'],
    properties: {
      application_id: { bsonType: 'string' },
      citizen_id: { bsonType: 'string' },
      scheme_code: { bsonType: 'string' },
      verification_status: { enum: ['pending', 'verified', 'rejected'] },
      verified_by: { bsonType: ['string', 'null'] },
      documents: {
        bsonType: 'array',
        minItems: 1,
        items: {
          bsonType: 'object',
          required: ['doc_type', 'file_name', 'file_sha256', 'extracted', 'uploaded_at'],
          properties: {
            doc_type: { enum: DOC_TYPES },
            file_name: { bsonType: 'string' },
            file_sha256: { bsonType: 'string', minLength: 64, maxLength: 64 },
            // identifiers read off the document (OCR / manual entry). Fraud
            // matching groups on THESE, not on file bytes (Fix 6).
            extracted: {
              bsonType: 'object',
              properties: {
                aadhaar_hmac: { bsonType: 'string' },
                parcel_key: { bsonType: 'string' },
                annual_income: { bsonType: ['int', 'long', 'double', 'decimal'] },
                ifsc: { bsonType: 'string' },
                account_no: { bsonType: 'string' },
              },
            },
            uploaded_at: { bsonType: 'date' },
            verified: { bsonType: 'bool' },
          },
        },
      },
    },
  },
};

const verificationLogsSchema = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['application_id', 'agent_id', 'action', 'timestamp'],
    properties: {
      application_id: { bsonType: 'string' },
      agent_id: { bsonType: 'string' },
      action: { enum: ['reviewed', 'verified', 'approved', 'rejected', 'document_added'] },
      timestamp: { bsonType: 'date' },
      notes: { bsonType: ['string', 'null'] },
    },
  },
};

export async function resetMongo() {
  const db = mongo();
  for (const name of ['document_uploads', 'verification_logs']) {
    await db.collection(name).drop().catch(() => {});
  }
  // $jsonSchema validators. Real MongoDB enforces them; some compatible
  // servers (e.g. FerretDB) do not support validators, so failure is non-fatal.
  let validators = true;
  for (const [name, validator] of [['document_uploads', documentUploadsSchema], ['verification_logs', verificationLogsSchema]]) {
    try {
      await db.createCollection(name, { validator, validationLevel: 'strict', validationAction: 'error' });
    } catch {
      validators = false;
      await db.createCollection(name).catch(() => {});
    }
  }
  mongoStatus.validators = validators;
  await db.collection('document_uploads').createIndex({ application_id: 1 }, { unique: true });
  await db.collection('document_uploads').createIndex({ 'documents.extracted.aadhaar_hmac': 1 });
  await db.collection('document_uploads').createIndex({ 'documents.extracted.parcel_key': 1 });
  await db.collection('verification_logs').createIndex({ application_id: 1, timestamp: 1 });
}

export async function insertUpload(doc) {
  await mongo().collection('document_uploads').insertOne(doc);
}

export async function addDocument(applicationId, document) {
  const res = await mongo().collection('document_uploads').updateOne(
    { application_id: applicationId },
    { $push: { documents: document } },
  );
  if (res.matchedCount === 0) throw Object.assign(new Error(`No document set for ${applicationId}`), { status: 404 });
}

export async function markVerification(applicationId, status, agentId) {
  const col = mongo().collection('document_uploads');
  const set = { verification_status: status, verified_by: agentId };
  if (status === 'verified') {
    // equivalent to { $set: { 'documents.$[].verified': true } }, written as a
    // read-modify-write so it also works on MongoDB-compatible servers that
    // lack the all-positional operator
    const current = await col.findOne({ application_id: applicationId });
    if (current) set.documents = current.documents.map((d) => ({ ...d, verified: true }));
  }
  await col.updateOne({ application_id: applicationId }, { $set: set });
}

export async function logVerification(applicationId, agentId, action, notes = null) {
  await mongo().collection('verification_logs').insertOne({
    application_id: applicationId, agent_id: agentId, action, timestamp: new Date(), notes,
  });
}

export async function uploadsByApplication() {
  if (!mongoStatus.connected) return new Map();
  const rows = await mongo().collection('document_uploads').find({}).toArray();
  return new Map(rows.map((r) => [r.application_id, r]));
}

export async function verificationLogs(limit = 100) {
  if (!mongoStatus.connected) return [];
  return mongo().collection('verification_logs').find({}).sort({ timestamp: -1 }).limit(limit).toArray();
}

/**
 * Aggregation pipeline: the same identity document (by the Aadhaar HMAC
 * EXTRACTED from it) used across applications of DIFFERENT citizens.
 */
export const REUSED_IDENTITY_PIPELINE = [
  { $unwind: '$documents' },
  { $match: { 'documents.doc_type': 'AADHAAR', 'documents.extracted.aadhaar_hmac': { $exists: true } } },
  {
    $group: {
      _id: '$documents.extracted.aadhaar_hmac',          // the identity read OFF the document
      citizens: { $addToSet: '$citizen_id' },
      applications: { $addToSet: '$application_id' },
      files: { $addToSet: '$documents.file_sha256' },
      uses: { $sum: 1 },
    },
  },
  { $match: { 'citizens.1': { $exists: true } } },       // used by 2+ different citizens
  { $sort: { uses: -1 } },
];

/** Baseline for the report: grouping by raw file bytes only catches exact re-uploads. */
export const REUSED_FILE_BYTES_PIPELINE = [
  { $unwind: '$documents' },
  { $match: { 'documents.doc_type': 'AADHAAR' } },
  { $group: { _id: '$documents.file_sha256', citizens: { $addToSet: '$citizen_id' } } },
  { $match: { 'citizens.1': { $exists: true } } },
];

// Some MongoDB-compatible servers (e.g. FerretDB 1.x) do not implement
// $addToSet in $group. Real MongoDB does; this fallback only keeps the demo
// working on those servers by doing the same grouping in JavaScript.
async function aggregateOrFallback(pipeline, fallback) {
  try {
    return await mongo().collection('document_uploads').aggregate(pipeline).toArray();
  } catch (err) {
    if (err.code !== 238) throw err; // 238 = NotImplemented
    const rows = await mongo().collection('document_uploads').find({}).toArray();
    return fallback(rows);
  }
}

function groupInJs(rows, keyOf, onlyAadhaar = true) {
  const groups = new Map();
  for (const r of rows) {
    for (const d of r.documents || []) {
      if (onlyAadhaar && d.doc_type !== 'AADHAAR') continue;
      const key = keyOf(d);
      if (!key) continue;
      const g = groups.get(key) || { _id: key, citizens: new Set(), applications: new Set(), files: new Set(), uses: 0 };
      g.citizens.add(r.citizen_id); g.applications.add(r.application_id); g.files.add(d.file_sha256); g.uses += 1;
      groups.set(key, g);
    }
  }
  return [...groups.values()]
    .map((g) => ({ ...g, citizens: [...g.citizens], applications: [...g.applications], files: [...g.files] }))
    .filter((g) => g.citizens.length > 1)
    .sort((a, b) => b.uses - a.uses);
}

export function findReusedIdentityDocuments() {
  return aggregateOrFallback(REUSED_IDENTITY_PIPELINE, (rows) => groupInJs(rows, (d) => d.extracted?.aadhaar_hmac));
}

export function findReusedFilesByBytes() {
  return aggregateOrFallback(REUSED_FILE_BYTES_PIPELINE, (rows) => groupInJs(rows, (d) => d.file_sha256));
}
