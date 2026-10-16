import crypto from 'node:crypto';
import { config } from './config.js';

/** Keyed HMAC-SHA256 of a 12-digit Aadhaar number (hex, 64 chars). */
export function aadhaarHmac(aadhaar) {
  const digits = String(aadhaar).replace(/\D/g, '');
  if (!/^\d{12}$/.test(digits)) throw Object.assign(new Error('Aadhaar must be 12 digits'), { status: 400 });
  return crypto.createHmac('sha256', config.hmacKey).update(digits).digest('hex');
}

export function maskAadhaar(aadhaar) {
  const digits = String(aadhaar).replace(/\D/g, '');
  return `XXXX-XXXX-${digits.slice(-4)}`;
}

/** Stand-in for hashing uploaded file bytes. A rescan of the same paper gives different bytes. */
export function fileSha256(seed) {
  return crypto.createHash('sha256').update(String(seed)).digest('hex');
}
