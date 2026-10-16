import React, { useState } from 'react';
import { X, UserPlus, Loader2, AlertTriangle, CheckCircle } from 'lucide-react';
import { api, ApiError } from '../api';
import { FraudFlag } from '../types';
import { toast } from '../utils/toast';

interface RegisterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDone: (citizenId: string | null) => void;
}

const EMPTY = {
  full_name: 'Lakshmi Narayana Reddy', aadhaar: '', phone: '+91 99001 23456', annual_income: '150000',
  bank_ifsc: 'SBIN0001234', bank_account_no: '', state: 'Karnataka', district: 'Mandya',
  taluk: 'Maddur', village: 'Shivapura', survey_no: '', subdivision: '1', area_acres: '2.5', share_fraction: '1.0',
};

const randDigits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');

type Outcome = { kind: 'ok' | 'quarantined' | 'error'; text: string; flag?: FraudFlag | null };

export const RegisterModal: React.FC<RegisterModalProps> = ({ isOpen, onClose, onDone }) => {
  const [f, setF] = useState(() => ({ ...EMPTY, aadhaar: `4${randDigits(11)}`, bank_account_no: randDigits(12), survey_no: String(300 + Math.floor(Math.random() * 600)) }));
  const [loading, setLoading] = useState(false);
  const [outcome, setOutcome] = useState<Outcome[]>([]);
  if (!isOpen) return null;

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const fillFraud = (kind: 'bank' | 'land') => {
    if (kind === 'bank') {
      // Savitri Devi's account from the seed data
      setF({ ...f, full_name: 'Savitri Devii', bank_ifsc: 'BARB0VARDES', bank_account_no: '982341234509', state: 'Uttar Pradesh', district: 'Varanasi' });
    } else {
      // Rajendra (0.6) + Savitri (0.4) already own 100% of this parcel
      setF({ ...f, state: 'Uttar Pradesh', district: 'Varanasi', taluk: 'Pindra', village: 'Babepur', survey_no: '48', subdivision: '1A', area_acres: '3.2', share_fraction: '0.5' });
    }
    setOutcome([]);
  };

  const submit = async () => {
    setLoading(true);
    const out: Outcome[] = [];
    let citizenId: string | null = null;
    try {
      const r = await api<{ citizen: { citizen_id: string } | null; quarantined: boolean; flag: FraudFlag | null }>('/citizens', {
        full_name: f.full_name, aadhaar: f.aadhaar, phone: f.phone, annual_income: Number(f.annual_income),
        bank_ifsc: f.bank_ifsc, bank_account_no: f.bank_account_no, state: f.state, district: f.district,
      });
      if (r.quarantined) {
        out.push({ kind: 'quarantined', text: 'Citizens INSERT quarantined by trg_screen_new_citizen', flag: r.flag });
      } else if (r.citizen) {
        citizenId = r.citizen.citizen_id;
        out.push({ kind: 'ok', text: `Citizen ${citizenId} registered (Aadhaar stored only as keyed HMAC-SHA256)`, flag: r.flag });
        const parcel = await api<{ parcel_id: string }>('/parcels', {
          state: f.state, district: f.district, taluk: f.taluk, village: f.village, survey_no: f.survey_no,
          subdivision: f.subdivision, area_acres: Number(f.area_acres),
        });
        const own = await api<{ quarantined: boolean; flag?: FraudFlag | null }>('/ownership', {
          parcel_id: parcel.parcel_id, citizen_id: citizenId, share_fraction: Number(f.share_fraction),
        });
        out.push(own.quarantined
          ? { kind: 'quarantined', text: `LandOwnership claim on ${parcel.parcel_id} quarantined by trg_check_parcel_share`, flag: own.flag }
          : { kind: 'ok', text: `Owns ${Number(f.share_fraction) * 100}% of ${parcel.parcel_id}` });
      }
    } catch (err) {
      out.push({ kind: 'error', text: err instanceof ApiError && err.blocked ? `Blocked by ${err.blocked.mechanism}: ${err.message}` : (err as Error).message });
    } finally {
      setOutcome(out);
      setLoading(false);
      if (out.some((o) => o.kind !== 'ok')) toast.error('Database refused part of the registration', out.filter((o) => o.kind !== 'ok').map((o) => o.text).join(' | '));
      else toast.success('Farmer registered', out.map((o) => o.text).join(' | '));
      onDone(citizenId);
    }
  };

  const field = (k: keyof typeof EMPTY, label: string, mono = false) => (
    <label className="block">
      <span className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">{label}</span>
      <input value={f[k]} onChange={set(k)}
        className={`w-full text-sm p-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-600 focus:outline-none ${mono ? 'font-mono' : ''}`} />
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/60 p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden my-8">
        <div className="bg-gradient-to-r from-emerald-800 to-emerald-950 text-white p-6 relative">
          <button onClick={onClose} className="absolute top-5 right-5 p-1.5 rounded-full bg-emerald-900/60 hover:bg-emerald-900 cursor-pointer" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-300">
            <UserPlus className="w-4 h-4" /><span>Farmer registration · Citizens + LandParcels + LandOwnership</span>
          </div>
          <h2 className="text-xl font-bold mt-1">Register a farmer and their land</h2>
          <p className="text-xs text-emerald-100/80 mt-1">Every row goes through the database's screening triggers. Try the fraud presets to watch them fire.</p>
        </div>

        <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
          <div className="flex flex-wrap gap-2">
            <button onClick={() => fillFraud('bank')} className="px-3 py-1.5 text-[11px] font-bold rounded-lg bg-amber-100 text-amber-900 border border-amber-300 hover:bg-amber-200 cursor-pointer">Preset: reuse someone's bank account</button>
            <button onClick={() => fillFraud('land')} className="px-3 py-1.5 text-[11px] font-bold rounded-lg bg-rose-100 text-rose-900 border border-rose-300 hover:bg-rose-200 cursor-pointer">Preset: claim an already-full parcel</button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {field('full_name', 'Full name')}
            {field('aadhaar', 'Aadhaar (12 digits, demo)', true)}
            {field('phone', 'Phone')}
            {field('annual_income', 'Annual income (₹)', true)}
            {field('bank_ifsc', 'Bank IFSC', true)}
            {field('bank_account_no', 'Account number', true)}
            {field('state', 'State')}
            {field('district', 'District')}
          </div>
          <div className="border-t border-slate-100 pt-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
            {field('taluk', 'Taluk')}
            {field('village', 'Village')}
            {field('survey_no', 'Survey no.', true)}
            {field('subdivision', 'Subdivision', true)}
            {field('area_acres', 'Parcel area (acres)', true)}
            {field('share_fraction', 'Your share (0–1)', true)}
          </div>

          {outcome.length > 0 && (
            <div className="space-y-2">
              {outcome.map((o, i) => (
                <div key={i} className={`p-3 rounded-xl border text-xs ${o.kind === 'ok' ? 'bg-emerald-50 border-emerald-300 text-emerald-950' : 'bg-rose-50 border-rose-300 text-rose-950'}`}>
                  <div className="flex items-start gap-2">
                    {o.kind === 'ok' ? <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" /> : <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />}
                    <div>
                      <p className="font-bold">{o.text}</p>
                      {o.flag && <p className="mt-1 font-mono text-[11px]">{o.flag.flag_id} · {o.flag.severity} · {o.flag.details}</p>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer">Close</button>
          <button onClick={submit} disabled={loading}
            className="px-5 py-2.5 rounded-xl font-bold text-xs text-white shadow-md bg-emerald-600 hover:bg-emerald-700 flex items-center gap-2 cursor-pointer disabled:opacity-60">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
            <span>Register</span>
          </button>
        </div>
      </div>
    </div>
  );
};
