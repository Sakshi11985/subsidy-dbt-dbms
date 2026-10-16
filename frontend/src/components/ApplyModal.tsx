import React, { useState } from 'react';
import { Scheme, Citizen, LandParcel, LandOwnership, Language, EligibilityResult } from '../types';
import { X, CheckCircle, AlertCircle, ShieldCheck, MapPin, Loader2 } from 'lucide-react';
import { api, ApiError } from '../api';

interface ApplyModalProps {
  scheme: Scheme | null;
  isOpen: boolean;
  onClose: () => void;
  citizens: Citizen[];
  parcels: LandParcel[];
  ownerships: LandOwnership[];
  defaultCitizenId?: string;
  onSubmitted: (applicationId: string, citizenId: string) => void;
  language: Language;
}

export const ApplyModal: React.FC<ApplyModalProps> = ({
  scheme,
  isOpen,
  onClose,
  citizens,
  parcels,
  ownerships,
  defaultCitizenId,
  onSubmitted,
  language,
}) => {
  // hooks must run on every render (before any early return)
  const [selectedCitizenId, setSelectedCitizenId] = useState<string>(defaultCitizenId || citizens[0]?.citizen_id || '');
  const ownedParcelIds = (cid: string) => ownerships.filter(o => o.citizen_id === cid).map(o => o.parcel_id);
  const [selectedParcelId, setSelectedParcelId] = useState<string>(ownedParcelIds(defaultCitizenId || citizens[0]?.citizen_id || '')[0] || '');
  const [evaluationResult, setEvaluationResult] = useState<(EligibilityResult & { tested: boolean }) | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  if (!isOpen || !scheme) return null;

  const isHi = language === 'hi';
  const cycleYear = new Date().getFullYear();
  const selectedCitizen = citizens.find(c => c.citizen_id === selectedCitizenId);
  const citizenParcels = parcels.filter(p => ownedParcelIds(selectedCitizenId).includes(p.parcel_id));
  const selectedParcel = citizenParcels.find(p => p.parcel_id === selectedParcelId);
  const ownership = ownerships.find(o => o.citizen_id === selectedCitizenId && o.parcel_id === selectedParcelId);

  // Calls the real stored procedure check_citizen_eligibility(citizen_id, scheme_id, parcel_id)
  const runEligibilityEvaluation = async () => {
    if (!selectedCitizen || !selectedParcel) return;
    setLoading(true);
    setSubmitError(null);
    try {
      const q = new URLSearchParams({ citizen_id: selectedCitizenId, scheme_id: scheme.scheme_id, parcel_id: selectedParcelId, cycle_year: String(cycleYear) });
      const r = await api<EligibilityResult>(`/eligibility?${q}`);
      setEvaluationResult({ ...r, tested: true });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleFinalSubmit = async () => {
    if (!selectedCitizen || !selectedParcel || !evaluationResult?.eligible) return;
    setLoading(true);
    setSubmitError(null);
    try {
      const r = await api<{ application: { application_id: string }; warning?: string }>('/applications', {
        citizen_id: selectedCitizenId, scheme_id: scheme.scheme_id, parcel_id: selectedParcelId, cycle_year: cycleYear,
      });
      onSubmitted(r.application.application_id, selectedCitizenId);
    } catch (err) {
      setSubmitError(err instanceof ApiError && err.blocked ? `Blocked by ${err.blocked.mechanism}: ${err.message}` : String((err as Error).message));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden my-8">
        
        {/* Modal Header */}
        <div className="bg-gradient-to-r from-emerald-800 to-emerald-950 text-white p-6 relative">
          <button
            onClick={onClose}
            className="absolute top-5 right-5 p-1.5 rounded-full bg-emerald-900/60 hover:bg-emerald-900 text-white/80 hover:text-white transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
          
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-300">
            <ShieldCheck className="w-4 h-4" />
            <span>DBT Subsidy Application & Stored Procedure Evaluation</span>
          </div>

          <h2 className="text-xl font-bold mt-1 text-white">
            {isHi ? scheme.title_hi : scheme.title_en}
          </h2>
          <p className="text-xs text-emerald-100/80 mt-1">
            Benefit: ₹{scheme.benefit_amount.toLocaleString('en-IN')} via Direct Benefit Transfer
          </p>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">

          {/* Citizen Selector */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              1. Select Applying Citizen (Citizens Table)
            </label>
            <select
              value={selectedCitizenId}
              onChange={(e) => {
                setSelectedCitizenId(e.target.value);
                setSelectedParcelId(ownedParcelIds(e.target.value)[0] || '');
                setEvaluationResult(null);
              }}
              className="w-full text-sm p-3 bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-600 focus:outline-none"
            >
              {citizens.map((c) => (
                <option key={c.citizen_id} value={c.citizen_id}>
                  {c.full_name} ({c.citizen_id}) — Income: ₹{c.annual_income.toLocaleString('en-IN')} | {c.state}{c.is_frozen ? ' [FROZEN]' : ''}
                </option>
              ))}
            </select>

            {selectedCitizen && (
              <div className="mt-2 p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs grid grid-cols-2 gap-2 text-slate-600">
                <div>
                  <span className="font-semibold text-slate-800">Aadhaar (Keyed HMAC):</span>
                  <p className="font-mono text-[10px] truncate text-slate-700">{selectedCitizen.aadhaar_hmac}</p>
                </div>
                <div>
                  <span className="font-semibold text-slate-800">Bank Composite Key:</span>
                  <p className="font-mono text-[11px] text-slate-700">{selectedCitizen.bank_ifsc} / {selectedCitizen.bank_account_no}</p>
                </div>
              </div>
            )}
          </div>

          {/* Land Parcel Selector */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              2. Select a Land Parcel this citizen owns a share of (LandOwnership)
            </label>
            <select
              value={selectedParcelId}
              onChange={(e) => {
                setSelectedParcelId(e.target.value);
                setEvaluationResult(null);
              }}
              className="w-full text-sm p-3 bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-600 focus:outline-none"
            >
              {citizenParcels.length === 0 && <option value="">No recorded land ownership for this citizen</option>}
              {citizenParcels.map((p) => (
                <option key={p.parcel_id} value={p.parcel_id}>
                  {p.state} - {p.district} ({p.village}), Survey #{p.survey_no}/{p.subdivision} ({p.area_acres} Acres)
                </option>
              ))}
            </select>

            {selectedParcel && (
              <div className="mt-2 p-3 bg-emerald-50/60 rounded-xl border border-emerald-100 text-xs text-slate-700">
                <div className="flex items-center gap-1.5 font-semibold text-emerald-900 mb-1">
                  <MapPin className="w-3.5 h-3.5 text-emerald-700" />
                  <span>Composite Unique Key:</span>
                </div>
                <p className="font-mono text-xs text-slate-800">
                  ({selectedParcel.state}, {selectedParcel.district}, {selectedParcel.taluk}, {selectedParcel.village}, Survey {selectedParcel.survey_no}, Subdiv {selectedParcel.subdivision})
                </p>
                <div className="mt-1.5 flex items-center gap-4 text-xs">
                  <span>Total Area: <strong>{selectedParcel.area_acres} ac</strong></span>
                  <span>
                    Claimed Share: <strong>{ownership ? `${(ownership.share_fraction * 100).toFixed(0)}% (${ownership.claimed_area_acres} ac)` : 'none'}</strong>
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Procedure Run Button */}
          <div className="pt-2">
            <button
              type="button"
              onClick={runEligibilityEvaluation}
              disabled={loading || !selectedParcel}
              className="w-full py-3 bg-slate-900 hover:bg-black text-amber-300 font-bold text-xs rounded-xl shadow-md transition flex items-center justify-center gap-2 cursor-pointer font-mono disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>EXECUTE check_citizen_eligibility('{selectedCitizenId}', '{scheme.scheme_id}', '{selectedParcelId || '…'}')</span>
            </button>
          </div>

          {/* Procedure Result Box */}
          {evaluationResult && (
            <div
              className={`p-4 rounded-2xl border text-xs leading-relaxed transition-all ${
                evaluationResult.eligible
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
                  : 'bg-rose-50 border-rose-300 text-rose-950'
              }`}
            >
              <div className="flex items-start gap-2.5">
                {evaluationResult.eligible ? (
                  <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                )}
                <div>
                  <h4 className="font-bold text-sm">
                    {evaluationResult.eligible ? 'Eligibility Validation Passed' : 'Database Integrity Rule Blocked'}
                  </h4>
                  <p className="mt-1 font-mono text-[11px]">{evaluationResult.message}</p>
                  {evaluationResult.rules.length > 0 && (
                    <table className="mt-3 w-full text-[11px] font-mono">
                      <tbody>
                        {evaluationResult.rules.map((r) => (
                          <tr key={r.rule_id} className="align-top">
                            <td className="pr-2 py-0.5">{r.passed ? '✓' : '✗'}</td>
                            <td className="pr-2 py-0.5 font-bold whitespace-nowrap">{r.rule_id}</td>
                            <td className="py-0.5">{r.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          )}

          {submitError && (
            <div className="p-3 rounded-xl border border-rose-300 bg-rose-50 text-rose-900 text-xs font-mono">{submitError}</div>
          )}

        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
          >
            Cancel
          </button>
          <button
            disabled={!evaluationResult?.eligible || loading}
            onClick={handleFinalSubmit}
            className={`px-5 py-2.5 rounded-xl font-bold text-xs text-white shadow-md transition flex items-center gap-2 ${
              evaluationResult?.eligible
                ? 'bg-emerald-600 hover:bg-emerald-700 cursor-pointer'
                : 'bg-slate-300 cursor-not-allowed opacity-60'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            <span>Submit Application to Pipeline</span>
          </button>
        </div>

      </div>
    </div>
  );
};
