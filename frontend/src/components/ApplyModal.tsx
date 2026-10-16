import React, { useState } from 'react';
import { Scheme, Citizen, LandParcel, LandOwnership, SchemeApplication, Language } from '../types';
import { X, CheckCircle, AlertCircle, ShieldCheck, MapPin, Building, CreditCard } from 'lucide-react';

interface ApplyModalProps {
  scheme: Scheme | null;
  isOpen: boolean;
  onClose: () => void;
  citizens: Citizen[];
  parcels: LandParcel[];
  ownerships: LandOwnership[];
  applications: SchemeApplication[];
  onSubmitApplication: (app: SchemeApplication) => void;
  language: Language;
}

export const ApplyModal: React.FC<ApplyModalProps> = ({
  scheme,
  isOpen,
  onClose,
  citizens,
  parcels,
  ownerships,
  applications,
  onSubmitApplication,
  language,
}) => {
  if (!isOpen || !scheme) return null;

  const isHi = language === 'hi';
  const [selectedCitizenId, setSelectedCitizenId] = useState<string>(citizens[0]?.citizen_id || '');
  const [selectedParcelId, setSelectedParcelId] = useState<string>(parcels[0]?.parcel_id || '');
  const [evaluationResult, setEvaluationResult] = useState<{
    tested: boolean;
    eligible: boolean;
    message: string;
  } | null>(null);

  const selectedCitizen = citizens.find(c => c.citizen_id === selectedCitizenId);
  const selectedParcel = parcels.find(p => p.parcel_id === selectedParcelId);
  const ownership = ownerships.find(o => o.citizen_id === selectedCitizenId && o.parcel_id === selectedParcelId);

  // Simulate Stored Procedure `check_citizen_eligibility(citizen_id, scheme_id, parcel_id)`
  const runEligibilityEvaluation = () => {
    if (!selectedCitizen || !selectedParcel) return;

    // Check duplicate application in current cycle year (Fix ③)
    const existingApp = applications.find(
      a => a.citizen_id === selectedCitizenId && a.scheme_id === scheme.scheme_id && a.cycle_year === 2026
    );

    if (existingApp) {
      setEvaluationResult({
        tested: true,
        eligible: false,
        message: `Blocked by UNIQUE(citizen_id, scheme_id, cycle_year): Citizen ${selectedCitizen.full_name} already has an active application (${existingApp.application_id}) for cycle 2026.`,
      });
      return;
    }

    const claimedArea = ownership ? ownership.claimed_area_acres : selectedParcel.area_acres;

    for (const rule of scheme.rules) {
      if (rule.attribute === 'annual_income') {
        const ceiling = parseFloat(rule.target_value);
        if (rule.operator === '<=' && selectedCitizen.annual_income > ceiling) {
          setEvaluationResult({
            tested: true,
            eligible: false,
            message: `Rule Failure on [annual_income]: Citizen income ₹${selectedCitizen.annual_income.toLocaleString()} exceeds scheme limit ₹${ceiling.toLocaleString()}. (Generic rule evaluated from EligibilityRules table).`,
          });
          return;
        }
      }
      if (rule.attribute === 'land_area') {
        const limit = parseFloat(rule.target_value);
        if (rule.operator === '<=' && claimedArea > limit) {
          setEvaluationResult({
            tested: true,
            eligible: false,
            message: `Rule Failure on [land_area]: Claimed land holding ${claimedArea} acres exceeds ceiling of ${limit} acres.`,
          });
          return;
        }
        if (rule.operator === '>=' && claimedArea < limit) {
          setEvaluationResult({
            tested: true,
            eligible: false,
            message: `Rule Failure on [land_area]: Claimed land holding ${claimedArea} acres is below required minimum of ${limit} acres.`,
          });
          return;
        }
      }
    }

    setEvaluationResult({
      tested: true,
      eligible: true,
      message: `Eligibility PASSED! Procedure check_citizen_eligibility() verified income ₹${selectedCitizen.annual_income.toLocaleString()} and land parcel area (${claimedArea} ac) satisfy all scheme rules.`,
    });
  };

  const handleFinalSubmit = () => {
    if (!selectedCitizen || !selectedParcel || !evaluationResult?.eligible) return;

    const newApp: SchemeApplication = {
      application_id: `APP-2026-${Math.floor(100 + Math.random() * 900)}`,
      citizen_id: selectedCitizen.citizen_id,
      citizen_name: selectedCitizen.full_name,
      scheme_id: scheme.scheme_id,
      scheme_title: scheme.title_en,
      cycle_year: 2026,
      parcel_id: selectedParcel.parcel_id,
      parcel_key: `${selectedParcel.state}/${selectedParcel.district}/${selectedParcel.taluk}/${selectedParcel.village}/${selectedParcel.survey_no}/${selectedParcel.subdivision}`,
      status: 'submitted',
      applied_at: new Date().toISOString().replace('T', ' ').slice(0, 16),
      documents: [
        {
          doc_type: 'AADHAAR',
          doc_name: 'Aadhaar_HMAC_Verified.pdf',
          hmac_signature: selectedCitizen.aadhaar_hmac,
          verified: false,
        },
        {
          doc_type: 'LAND_KHASRA',
          doc_name: `Parcel_${selectedParcel.survey_no}_${selectedParcel.subdivision}.pdf`,
          hmac_signature: `hmac_${Math.random().toString(36).substring(2, 14)}`,
          verified: false,
        },
      ],
    };

    onSubmitApplication(newApp);
    onClose();
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
                setEvaluationResult(null);
              }}
              className="w-full text-sm p-3 bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-600 focus:outline-none"
            >
              {citizens.map((c) => (
                <option key={c.citizen_id} value={c.citizen_id}>
                  {c.full_name} ({c.citizen_id}) — Income: ₹{c.annual_income.toLocaleString()} | {c.state}
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
              2. Select Agricultural Land Parcel (3NF Normalized LandParcels Table)
            </label>
            <select
              value={selectedParcelId}
              onChange={(e) => {
                setSelectedParcelId(e.target.value);
                setEvaluationResult(null);
              }}
              className="w-full text-sm p-3 bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-600 focus:outline-none"
            >
              {parcels.map((p) => (
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
                    Claimed Share: <strong>{ownership ? `${(ownership.share_fraction * 100).toFixed(0)}% (${ownership.claimed_area_acres} ac)` : '100%'}</strong>
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
              className="w-full py-3 bg-slate-900 hover:bg-black text-amber-300 font-bold text-xs rounded-xl shadow-md transition flex items-center justify-center gap-2 cursor-pointer font-mono"
            >
              <span>EXECUTE check_citizen_eligibility()</span>
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
                </div>
              </div>
            </div>
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
            disabled={!evaluationResult?.eligible}
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
