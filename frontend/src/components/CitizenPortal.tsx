import React from 'react';
import { SchemeApplication, Citizen, Language } from '../types';
import { Clock, CheckCircle, AlertCircle, FileText, ArrowRight, ShieldCheck, MapPin, Building2, UserCheck } from 'lucide-react';
import { TRANSLATIONS } from '../utils/translations';

interface CitizenPortalProps {
  applications: SchemeApplication[];
  currentCitizen: Citizen;
  onOpenApplyModal: () => void;
  language: Language;
}

export const CitizenPortal: React.FC<CitizenPortalProps> = ({
  applications,
  currentCitizen,
  onOpenApplyModal,
  language,
}) => {
  const t = TRANSLATIONS[language] || TRANSLATIONS.en;

  const steps = [
    { key: 'submitted', label: t.steps.submitted },
    { key: 'under_review', label: t.steps.under_review },
    { key: 'verified', label: t.steps.verified },
    { key: 'approved', label: t.steps.approved },
    { key: 'payment_initiated', label: t.steps.payment_initiated },
    { key: 'paid', label: t.steps.paid },
  ];

  const getStepIndex = (status: string) => {
    switch (status) {
      case 'submitted': return 0;
      case 'under_review': return 1;
      case 'verified': return 2;
      case 'approved': return 3;
      case 'payment_initiated': return 4;
      case 'paid': return 5;
      case 'rejected': return -1;
      default: return 0;
    }
  };

  return (
    <div className="py-8 bg-slate-50 min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        
        {/* Farmer Profile Badge Card */}
        <div className="bg-white rounded-3xl p-6 sm:p-7 border border-slate-200 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-emerald-600 to-emerald-800 text-white flex items-center justify-center font-bold text-2xl shadow-md">
              {currentCitizen.full_name[0]}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-extrabold text-slate-900">{currentCitizen.full_name}</h2>
                <span className="bg-emerald-100 text-emerald-800 text-xs px-2.5 py-0.5 rounded-full font-bold">
                  {t.verifiedFarmer}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Citizen ID: <strong className="font-mono text-slate-700">{currentCitizen.citizen_id}</strong> • Location: {currentCitizen.district}, {currentCitizen.state}
              </p>
              
              <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-600">
                <span className="flex items-center gap-1 font-mono">
                  <UserCheck className="w-3.5 h-3.5 text-emerald-600" />
                  Aadhaar HMAC: <span className="text-[11px] bg-slate-100 px-1 rounded truncate max-w-[120px]">{currentCitizen.aadhaar_hmac.substring(0, 16)}...</span>
                </span>
                <span className="flex items-center gap-1 font-mono">
                  <Building2 className="w-3.5 h-3.5 text-blue-600" />
                  IFSC: <strong>{currentCitizen.bank_ifsc}</strong> (Acc: {currentCitizen.bank_account_no.slice(-4).padStart(currentCitizen.bank_account_no.length, '*')})
                </span>
              </div>
            </div>
          </div>

          <button
            onClick={onOpenApplyModal}
            className="w-full md:w-auto px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-2xl shadow-md transition flex items-center justify-center gap-2 cursor-pointer shrink-0"
          >
            <span>{t.applyNewScheme}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        {/* Database State Pipeline Tracker */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-600" />
                <span>{t.myAppsTitle}</span>
              </h3>
              <p className="text-xs text-slate-500">
                Guaranteed by PostgreSQL trigger <code className="text-emerald-700 font-bold">trg_status_flow</code>: Prevents illegal skips or retroactive status mutations.
              </p>
            </div>
            <span className="text-xs font-semibold text-slate-500 font-mono">
              Total Applications: {applications.length}
            </span>
          </div>

          <div className="space-y-6">
            {applications.map((app) => {
              const currentStepIdx = getStepIndex(app.status);
              const isRejected = app.status === 'rejected';

              return (
                <div
                  key={app.application_id}
                  className="bg-white rounded-3xl p-6 border border-slate-200/90 shadow-sm hover:shadow-md transition"
                >
                  {/* Top info */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-4">
                    <div>
                      <span className="text-[11px] font-mono font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                        {app.application_id}
                      </span>
                      <h4 className="text-base font-bold text-slate-900 mt-1">{app.scheme_title}</h4>
                      <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                        <MapPin className="w-3.5 h-3.5 text-slate-400" />
                        <span>Land Parcel: <strong className="font-mono text-slate-700">{app.parcel_key}</strong></span>
                      </p>
                    </div>

                    <div className="text-right">
                      <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                        app.status === 'paid'
                          ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                          : app.status === 'rejected'
                          ? 'bg-rose-100 text-rose-800 border border-rose-300'
                          : 'bg-amber-100 text-amber-900 border border-amber-300'
                      }`}>
                        {app.status === 'paid' && <CheckCircle className="w-3.5 h-3.5" />}
                        {app.status === 'rejected' && <AlertCircle className="w-3.5 h-3.5" />}
                        {app.status !== 'paid' && app.status !== 'rejected' && <Clock className="w-3.5 h-3.5" />}
                        <span>{app.status.replace('_', ' ')}</span>
                      </span>
                      <p className="text-[11px] text-slate-400 mt-1">Applied: {app.applied_at}</p>
                    </div>
                  </div>

                  {/* Visual Stepper */}
                  {!isRejected ? (
                    <div className="mt-6 pt-2">
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                        {steps.map((st, idx) => {
                          const isDone = idx <= currentStepIdx;
                          const isCurrent = idx === currentStepIdx;

                          return (
                            <div
                              key={st.key}
                              className={`p-3 rounded-2xl border text-center transition-all ${
                                isDone
                                  ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                                  : 'bg-slate-50 border-slate-200 text-slate-400'
                              } ${isCurrent ? 'ring-2 ring-emerald-500 shadow-sm' : ''}`}
                            >
                              <div className="flex items-center justify-center mb-1.5">
                                {isDone ? (
                                  <CheckCircle className="w-4 h-4 text-emerald-600" />
                                ) : (
                                  <div className="w-4 h-4 rounded-full border border-slate-300"></div>
                                )}
                              </div>
                              <span className="text-xs font-bold block">{st.label}</span>
                              <span className="text-[10px] text-slate-500 block mt-0.5">
                                {isCurrent ? 'Current DB Status' : isDone ? 'Verified' : 'Pending'}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 p-4 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-800">
                      <strong>Application Rejected by Database:</strong> {app.rejection_reason || 'Criteria non-compliance.'}
                    </div>
                  )}

                  {/* Documents & Verifications footer */}
                  <div className="mt-5 pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between text-xs text-slate-600 gap-3">
                    <div className="flex items-center gap-3">
                      <span className="font-semibold text-slate-700">Uploaded Proofs:</span>
                      {app.documents.map((doc, dIdx) => (
                        <span key={dIdx} className="inline-flex items-center gap-1 bg-slate-100 px-2 py-1 rounded text-[11px] text-slate-700 font-mono">
                          <FileText className="w-3 h-3 text-slate-500" />
                          <span>{doc.doc_name}</span>
                          {doc.verified ? (
                            <span className="text-emerald-600 font-bold text-[10px]">✓</span>
                          ) : (
                            <span className="text-amber-600 text-[10px]">(unverified)</span>
                          )}
                        </span>
                      ))}
                    </div>

                    <div className="font-mono text-[11px] text-slate-500">
                      {app.verified_by && <span>Verifier: {app.verified_by} • </span>}
                      {app.approved_by && <span>Approver: {app.approved_by}</span>}
                    </div>
                  </div>

                </div>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
};
