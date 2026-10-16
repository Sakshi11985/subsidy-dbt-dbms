// Thin client for the Express API (backend/). In dev, Vite proxies /api to
// http://localhost:4000 (see vite.config.ts); override with VITE_API_URL.
const BASE: string = import.meta.env.VITE_API_URL ?? '/api';

export interface BlockedInfo {
  status: string;     // BLOCKED_BY_TRIGGER | BLOCKED_BY_CONSTRAINT | BLOCKED_BY_LOCK
  mechanism: string;  // e.g. trg_separation_of_duties, UNIQUE uq_bank_account
  code: string;       // PostgreSQL SQLSTATE
  message: string;
}

export class ApiError extends Error {
  status: number;
  blocked?: BlockedInfo;
  body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) {
    super(String(body.error ?? `HTTP ${status}`));
    this.status = status;
    this.blocked = body.blocked as BlockedInfo | undefined;
    this.body = body;
  }
}

export async function api<T = unknown>(path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, body === undefined
      ? undefined
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new ApiError(0, { error: 'Cannot reach the API server. Is the backend running on port 4000?' });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}
