import React, { useState } from 'react';
import { UserPlus, ArrowLeft, Loader2, ShieldAlert } from 'lucide-react';
import { api, ApiError, setToken } from '../api';
import type { AppUser } from './LoginPage';

// New farmer self-registration. One request to POST /api/signup creates the
// Citizens row and the login account in ONE transaction (all or nothing), then
// claims the land parcel. The same fraud-screening triggers as the
// registration desk run on every sign-up.

const randDigits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');

const EMPTY = {
  full_name: '', aadhaar: '', phone: '', annual_income: '',
  bank_ifsc: '', bank_account_no: '', state: '', district: '',
  taluk: '', village: '', survey_no: '', subdivision: '', area_acres: '', share_fraction: '1',
  username: '', password: '', confirm: '',
};
type Form = typeof EMPTY;

const sample = (): Form => ({
  full_name: 'Lakshmi Narayana Reddy', aadhaar: `4${randDigits(11)}`, phone: '+91 99001 23456', annual_income: '150000',
  bank_ifsc: 'SBIN0001234', bank_account_no: randDigits(12), state: 'Karnataka', district: 'Mandya',
  taluk: 'Maddur', village: 'Shivapura', survey_no: String(300 + Math.floor(Math.random() * 600)), subdivision: '1',
  area_acres: '2.5', share_fraction: '1', username: `lakshmi${randDigits(3)}`, password: 'lakshmi@123', confirm: 'lakshmi@123',
});

// Re-uses Savitri Devi's bank account from the seed data: trg_screen_new_citizen must refuse it.
const fraudSample = (): Form => ({
  ...sample(), full_name: 'Savitri Devii', bank_ifsc: 'BARB0VARDES', bank_account_no: '982341234509',
  state: 'Uttar Pradesh', district: 'Varanasi', username: `savitri${randDigits(3)}`,
});

type SignupResult = {
  token: string;
  user: AppUser;
  land: { parcel_id: string; quarantined: boolean; flag?: { details?: string } | null } | null;
};

export const SignupForm: React.FC<{ onBack: () => void; onSignedUp: (user: AppUser, landNote: string | null) => void }> = ({ onBack, onSignedUp }) => {
  const [f, setF] = useState<Form>(EMPTY);
  const [error, setError] = useState<{ text: string; mechanism?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const validate = (): string | null => {
    if (!/^\d{12}$/.test(f.aadhaar)) return 'Aadhaar must be exactly 12 digits.';
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(f.bank_ifsc.toUpperCase())) return 'IFSC must look like SBIN0001234 (4 letters, 0, 6 letters/digits).';
    if (!/^\d{9,18}$/.test(f.bank_account_no)) return 'Bank account number must be 9 to 18 digits.';
    if (!/^[a-z0-9_.]{3,40}$/.test(f.username.trim().toLowerCase())) return 'Username: 3-40 lowercase letters, digits, _ or .';
    if (f.password.length < 6) return 'Password must be at least 6 characters.';
    if (f.password !== f.confirm) return 'The two passwords do not match.';
    if (f.survey_no && (!f.taluk || !f.village || !f.area_acres)) return 'For land, fill taluk, village, survey number and area.';
    return null;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = validate();
    if (problem) { setError({ text: problem }); return; }
    setLoading(true);
    setError(null);
    try {
      const r = await api<SignupResult>('/signup', {
        full_name: f.full_name, aadhaar: f.aadhaar, phone: f.phone, annual_income: Number(f.annual_income || 0),
        bank_ifsc: f.bank_ifsc.toUpperCase(), bank_account_no: f.bank_account_no, state: f.state, district: f.district,
        taluk: f.taluk, village: f.village, survey_no: f.survey_no, subdivision: f.subdivision,
        area_acres: Number(f.area_acres || 0), share_fraction: Number(f.share_fraction || 1),
        username: f.username, password: f.password,
      });
      setToken(r.token);
      const landNote = !r.land ? null
        : r.land.quarantined ? `Land claim on ${r.land.parcel_id} was refused by trg_check_parcel_share: ${r.land.flag?.details ?? 'parcel already fully owned'}`
        : `Land parcel ${r.land.parcel_id} linked to your account.`;
      onSignedUp(r.user, landNote);
    } catch (err) {
      if (err instanceof ApiError) setError({ text: err.message, mechanism: err.blocked?.mechanism });
      else setError({ text: String(err) });
    } finally {
      setLoading(false);
    }
  };

  const field = (k: keyof Form, label: string, opts: { type?: string; required?: boolean; mono?: boolean; placeholder?: string } = {}) => (
    <label className="block">
      <span className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">
        {label}{opts.required !== false && <span className="text-rose-600"> *</span>}
      </span>
      <input value={f[k]} onChange={set(k)} type={opts.type ?? 'text'} required={opts.required !== false} placeholder={opts.placeholder}
        className={`w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600 ${opts.mono ? 'font-mono' : ''}`} />
    </label>
  );

  return (
    <div className="p-6 sm:p-8">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button type="button" onClick={onBack} className="text-xs font-bold text-emerald-700 hover:underline flex items-center gap-1 cursor-pointer">
          <ArrowLeft className="w-4 h-4" />Back to sign in
        </button>
        <div className="flex gap-2">
          <button type="button" onClick={() => { setF(sample()); setError(null); }}
            className="px-2.5 py-1 text-[11px] font-bold rounded-lg border border-emerald-300 text-emerald-800 hover:bg-emerald-50 cursor-pointer">
            Fill sample farmer
          </button>
          <button type="button" onClick={() => { setF(fraudSample()); setError(null); }}
            className="px-2.5 py-1 text-[11px] font-bold rounded-lg border border-rose-300 text-rose-700 hover:bg-rose-50 cursor-pointer">
            Try fraud: reuse a bank account
          </button>
        </div>
      </div>
      <h2 className="mt-4 text-xl font-extrabold text-slate-900">New farmer registration</h2>
      <p className="text-xs text-slate-500 mt-1">
        Officer accounts are created by the administrator; only farmers can register here.
      </p>

      <form onSubmit={submit} className="mt-5 space-y-5">
        <fieldset className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <legend className="text-xs font-extrabold text-emerald-800 mb-2">1. About you</legend>
          {field('full_name', 'Full name')}
          {field('aadhaar', 'Aadhaar (12 digits)', { mono: true })}
          {field('phone', 'Phone')}
          {field('annual_income', 'Annual income (₹)', { type: 'number' })}
          {field('state', 'State')}
          {field('district', 'District')}
        </fieldset>
        <fieldset className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <legend className="text-xs font-extrabold text-emerald-800 mb-2">2. Bank account (subsidy is paid here)</legend>
          {field('bank_ifsc', 'IFSC', { mono: true, placeholder: 'SBIN0001234' })}
          {field('bank_account_no', 'Account number', { mono: true })}
        </fieldset>
        <fieldset className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <legend className="text-xs font-extrabold text-emerald-800 mb-2">3. Land (optional, needed for land-based schemes)</legend>
          {field('taluk', 'Taluk', { required: false })}
          {field('village', 'Village', { required: false })}
          {field('survey_no', 'Survey no.', { required: false, mono: true })}
          {field('subdivision', 'Subdivision', { required: false, mono: true })}
          {field('area_acres', 'Area (acres)', { required: false, type: 'number' })}
          {field('share_fraction', 'Your share (0-1)', { required: false, type: 'number' })}
        </fieldset>
        <fieldset className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <legend className="text-xs font-extrabold text-emerald-800 mb-2">4. Login</legend>
          {field('username', 'Username', { mono: true })}
          {field('password', 'Password', { type: 'password' })}
          {field('confirm', 'Confirm password', { type: 'password' })}
        </fieldset>

        {error && (
          <div role="alert" className="text-sm text-rose-800 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2 flex gap-2">
            <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              {error.mechanism && <strong className="block font-mono text-xs">Blocked by {error.mechanism}</strong>}
              {error.text}
            </span>
          </div>
        )}

        <button type="submit" disabled={loading}
          className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-bold text-sm rounded-xl flex items-center justify-center gap-2 cursor-pointer">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
          {loading ? 'Registering…' : 'Register and sign in'}
        </button>
      </form>
    </div>
  );
};
