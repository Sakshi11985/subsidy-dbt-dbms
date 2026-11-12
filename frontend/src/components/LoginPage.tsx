import React, { useRef, useState } from 'react';
import { LogIn, ShieldCheck, Lock } from 'lucide-react';
import { api, ApiError, setToken } from '../api';

export interface AppUser {
  username: string;
  app_role: 'citizen' | 'verifier' | 'approver' | 'vigilance' | 'admin';
  display_name: string;
  officer_id: string | null;
  citizen_id: string | null;
}

// Demo accounts created by the seed (passwords are listed in the README).
const ACCOUNTS: { username: string; role: string; desk: string }[] = [
  { username: 'farmer', role: 'Citizen / Farmer', desk: 'Apply, track and withdraw own applications' },
  { username: 'verifier', role: 'Verifying Agent', desk: 'Review and verify applications' },
  { username: 'approver', role: 'Approval & Payment', desk: 'Approve and release DBT payments' },
  { username: 'vigilance', role: 'Vigilance Officer', desk: 'Fraud flags, scans, freeze accounts' },
  { username: 'admin', role: 'Administrator', desk: 'All desks, registration, reset demo' },
];

export const LoginPage: React.FC<{ onLoggedIn: (user: AppUser) => void }> = ({ onLoggedIn }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const r = await api<{ token: string; user: AppUser }>('/login', { username: username.trim(), password });
      setToken(r.token);
      onLoggedIn(r.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0d341e] via-[#14472b] to-emerald-800 flex items-center justify-center p-4">
      <div className="w-full max-w-4xl grid md:grid-cols-2 bg-white rounded-3xl shadow-2xl overflow-hidden">
        {/* left: brand */}
        <div className="bg-[#14472b] text-white p-8 flex flex-col justify-between gap-8">
          <div>
            <div className="flex items-center gap-3">
              <img src="/logo-icon.png" alt="" className="w-11 h-11 rounded-xl bg-white/10 p-1" />
              <span className="text-2xl font-extrabold tracking-tight">
                Namma <span className="text-[#facc15]">Raitha</span>
              </span>
            </div>
            <h1 className="mt-8 text-3xl font-extrabold leading-tight">DBT Subsidy Eligibility &amp; Disbursal System</h1>
            <p className="mt-3 text-sm text-emerald-100/90">
              Sign in to your desk. What you can see and do depends on your role; the database enforces the rest.
            </p>
          </div>
          <ul className="space-y-2 text-xs text-emerald-100/90">
            <li className="flex items-start gap-2"><Lock className="w-4 h-4 shrink-0 text-[#facc15]" />Passwords are stored only as bcrypt hashes (pgcrypto), never as text.</li>
            <li className="flex items-start gap-2"><ShieldCheck className="w-4 h-4 shrink-0 text-[#facc15]" />Every API call is checked against your role before it reaches PostgreSQL.</li>
          </ul>
        </div>

        {/* right: form */}
        <div className="p-8">
          <h2 className="text-xl font-extrabold text-slate-900">Sign in</h2>
          <form onSubmit={submit} className="mt-5 space-y-4">
            <label className="block">
              <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">Username</span>
              <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required
                className="mt-1 w-full px-4 py-2.5 text-sm border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600" />
            </label>
            <label className="block">
              <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">Password</span>
              <input ref={passwordRef} type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password" required
                className="mt-1 w-full px-4 py-2.5 text-sm border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600" />
            </label>
            {error && <p role="alert" className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">{error}</p>}
            <button type="submit" disabled={loading}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-bold text-sm rounded-xl flex items-center justify-center gap-2 cursor-pointer">
              <LogIn className="w-4 h-4" />{loading ? 'Checking…' : 'Sign in'}
            </button>
          </form>

          <div className="mt-6">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Demo accounts (click to fill the username)</p>
            <div className="mt-2 divide-y divide-slate-100 border border-slate-200 rounded-xl">
              {ACCOUNTS.map((a) => (
                <button key={a.username} type="button"
                  onClick={() => { setUsername(a.username); setPassword(''); passwordRef.current?.focus(); }}
                  className={`w-full text-left px-3 py-2 flex items-center justify-between gap-3 hover:bg-emerald-50 cursor-pointer ${username === a.username ? 'bg-emerald-50' : ''}`}>
                  <span>
                    <span className="block text-xs font-bold text-slate-900">{a.role}</span>
                    <span className="block text-[11px] text-slate-500">{a.desk}</span>
                  </span>
                  <code className="text-[11px] font-mono text-emerald-800 bg-emerald-50 px-1.5 py-0.5 rounded">{a.username}</code>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
