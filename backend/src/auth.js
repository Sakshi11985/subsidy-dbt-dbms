// Login + role-based access control for the API.
//
// 1. POST /api/login checks the password INSIDE PostgreSQL (check_login(),
//    bcrypt via pgcrypto) and returns a signed token.
// 2. Every other request sends "Authorization: Bearer <token>".
//    authenticate() verifies the signature and puts the user on req.user.
// 3. allow('verifier', ...) lets only those roles (and admin) call a route.
//
// Token = base64url(JSON payload) + "." + HMAC-SHA256(payload, SESSION_SECRET).
// Changing the payload (e.g. role "citizen" -> "admin") breaks the signature.
import crypto from 'node:crypto';
import { pool, ApiError } from './db.js';
import { config } from './config.js';

const TOKEN_HOURS = 8;
const sign = (data) => crypto.createHmac('sha256', config.sessionSecret).update(data).digest('base64url');

export async function login(username, password) {
  if (!username || !password) throw new ApiError(400, 'Username and password are required');
  const { rows: [user] } = await pool.query('SELECT * FROM check_login($1, $2)', [String(username), String(password)]);
  if (!user) throw new ApiError(401, 'Wrong username or password');
  const payload = Buffer.from(JSON.stringify({ ...user, exp: Date.now() + TOKEN_HOURS * 3600_000 })).toString('base64url');
  return { token: `${payload}.${sign(payload)}`, user };
}

export function verifyToken(token) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const user = JSON.parse(Buffer.from(payload, 'base64url').toString());
  return user.exp > Date.now() ? user : null;
}

/** Express middleware: every /api route after this one needs a valid token. */
export function authenticate(req, res, next) {
  const user = verifyToken((req.headers.authorization || '').replace(/^Bearer /, ''));
  if (!user) return res.status(401).json({ error: 'Please log in again (missing or expired session)' });
  req.user = user;
  next();
}

/** Express middleware: only these roles may call the route. Admin may call everything. */
export const allow = (...roles) => (req, res, next) => {
  if (req.user.app_role === 'admin' || roles.includes(req.user.app_role)) return next();
  res.status(403).json({ error: `Your role (${req.user.app_role}) is not allowed to do this. Allowed: ${[...roles, 'admin'].join(', ')}` });
};

/** Officers act only as themselves: a verifier/approver cannot send another officer's ID. */
export function actAsSelf(req, res, next) {
  const own = req.user.officer_id;
  if (!own) return next(); // admin / vigilance: may pick any officer (used by the trigger demos)
  if (req.body.officer_id && req.body.officer_id !== own) {
    return res.status(403).json({ error: `You are logged in as ${own}, so you cannot act as ${req.body.officer_id}. Pick ${own} in the officer list.` });
  }
  req.body.officer_id = own;
  next();
}

/** A citizen sees only their own rows (same idea as the RLS policies in schema.sql). */
export function filterStateFor(user, state) {
  if (user.app_role !== 'citizen') return state;
  const me = user.citizen_id;
  const apps = state.applications.filter((a) => a.citizen_id === me);
  const appIds = new Set(apps.map((a) => a.application_id));
  return {
    ...state,
    citizens: state.citizens.filter((c) => c.citizen_id === me),
    ownerships: state.ownerships.filter((o) => o.citizen_id === me),
    applications: apps,
    disbursals: state.disbursals.filter((d) => appIds.has(d.application_id)),
    paymentAttempts: (state.paymentAttempts || []).filter((p) => appIds.has(p.application_id)),
    fraudFlags: [],
    auditLogs: [],
  };
}
