// Thin client for the Express API (backend/). In dev, Next.js forwards /api to
// http://localhost:4000 (see next.config.mjs); override with NEXT_PUBLIC_API_URL.
const BASE: string = process.env.NEXT_PUBLIC_API_URL ?? '/api';

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

// ------------------------------------------------------------ login session
// The token from /api/login is kept in sessionStorage (cleared when the tab
// closes) and sent as "Authorization: Bearer <token>" on every request.
const TOKEN_KEY = 'subsidy_dbt_token';
let token: string | null = null;
try { token = sessionStorage.getItem(TOKEN_KEY); } catch { /* storage blocked: keep it in memory */ }

export function setToken(t: string | null) {
  token = t;
  try { if (t) sessionStorage.setItem(TOKEN_KEY, t); else sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}
export const hasToken = () => !!token;

let onUnauthorized: (() => void) | null = null;
/** App registers this so an expired session sends the user back to the login page. */
export function setUnauthorizedHandler(fn: () => void) { onUnauthorized = fn; }

/** GET when body is undefined, otherwise POST (or the given method, e.g. DELETE). */
export async function api<T = unknown>(path: string, body?: unknown, method?: 'POST' | 'DELETE'): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, { error: 'Cannot reach the API server. Is the backend running on port 4000?' });
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/login') onUnauthorized?.();
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}
