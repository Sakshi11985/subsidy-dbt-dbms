import React, { useState } from 'react';
import { SchemeApplication, Language, Officer } from '../types';
import { CheckCircle2, XCircle, Search, ShieldAlert, FileCheck, ArrowRight, Lock, Eye } from 'lucide-react';

interface VerificationDeskProps {
  applications: SchemeApplication[];
  officers: Officer[];
  onUpdateStatus: (appId: string, newStatus: SchemeApplication['status'], verifierId: string, notes?: string) => Promise<unknown>;
  language: Language;
}

export const VerificationDesk: React.FC<VerificationDeskProps> = ({
  applications,
  officers,
  onUpdateStatus,
  language,
}) => {
  const isHi = language === 'hi';
  const [officerId, setOfficerId] = useState<string>('OFFICER_VERIFIER_10');
  const [filterState, setFilterState] = useState<string>('PENDING');

  const pendingApps = applications.filter(a => {
    if (filterState === 'PENDING') return a.status === 'submitted' || a.status === 'under_review';
    if (filterState === 'VERIFIED') return a.status === 'verified';
    if (filterState === 'ALL') return true;
    return true;
  });

  return (
    <div className="py-8 bg-slate-50 min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        
        {/* Desk Header Banner */}
        <div className="bg-gradient-to-r from-emerald-900 via-teal-900 to-slate-900 text-white rounded-3xl p-6 sm:p-8 shadow-lg border border-emerald-800/40 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold text-amber-300 uppercase tracking-widest">
              <ShieldAlert className="w-4 h-4" />
              <span>ROLE: REVENUE INSPECTOR / FIELD VERIFICATION DESK</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold mt-1">
              {isHi ? 'दस्तावेज़ एवं स्थल सत्यापन डेस्क' : 'Document & Land Field Verification Desk'}
            </h2>
            <p className="text-xs text-emerald-100/80 mt-2 max-w-2xl leading-relaxed">
              Verify agricultural title deeds against composite survey keys and match Aadhaar HMACs.
              <strong className="text-amber-300"> Database Rule: </strong>
              PostgreSQL trigger <code className="bg-black/30 px-1 py-0.5 rounded font-mono">trg_separation_of_duties</code> guarantees the Verifier cannot later approve or disburse their own verified applications.
            </p>
          </div>

          <div className="bg-white/10 backdrop-blur-md p-4 rounded-2xl border border-white/20 text-xs shrink-0 space-y-2 min-w-0 max-w-full">
            <span className="text-emerald-200 block font-semibold">Active Verifier Identity:</span>
            <div className="flex items-center gap-2">
              <select
                value={officerId}
                onChange={(e) => setOfficerId(e.target.value)}
                className="min-w-0 max-w-[220px] sm:max-w-none bg-black/40 border border-emerald-400/50 rounded-lg px-2.5 py-1 text-white font-mono text-xs focus:outline-none"
              >
                {officers.map((o) => (
                  <option key={o.officer_id} value={o.officer_id} className="text-slate-900">
                    {o.officer_id} · {o.designation}{o.can_verify ? '' : ' (cannot verify)'}
                  </option>
                ))}
              </select>
              <span className="text-[10px] text-emerald-300 uppercase font-bold">Logged In</span>
            </div>
            <p className="text-[10px] text-emerald-200/80 max-w-[260px]">Officers without <code>can_verify</code> are refused by the database, not hidden by the UI.</p>
          </div>
        </div>

        {/* Filter controls */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setFilterState('PENDING')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                filterState === 'PENDING'
                  ? 'bg-emerald-700 text-white shadow-xs'
                  : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
              }`}
            >
              Needs Field Review ({applications.filter(a => a.status === 'submitted' || a.status === 'under_review').length})
            </button>
            <button
              onClick={() => setFilterState('VERIFIED')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                filterState === 'VERIFIED'
                  ? 'bg-emerald-700 text-white shadow-xs'
                  : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
              }`}
            >
              Certified Verified ({applications.filter(a => a.status === 'verified').length})
            </button>
            <button
              onClick={() => setFilterState('ALL')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                filterState === 'ALL'
                  ? 'bg-emerald-700 text-white shadow-xs'
                  : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
              }`}
            >
              All Records ({applications.length})
            </button>
          </div>

          <div className="text-xs text-slate-500 font-mono">
            State Machine Constraint: <span className="font-bold text-slate-800">submitted → under_review → verified</span>
          </div>
        </div>

        {/* Applications List for Verifier */}
        <div className="space-y-4">
          {pendingApps.length === 0 ? (
            <div className="bg-white rounded-3xl p-12 text-center border border-slate-200 text-slate-500">
              <FileCheck className="w-12 h-12 text-emerald-600 mx-auto mb-3 opacity-60" />
              <h3 className="font-bold text-base text-slate-800">No applications in this queue.</h3>
              <p className="text-xs mt-1">All incoming farmer applications have been verified or progressed.</p>
            </div>
          ) : (
            pendingApps.map((app) => (
              <div
                key={app.application_id}
                className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xs hover:border-emerald-300 transition space-y-4"
              >
                {/* Header row */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold bg-slate-100 px-2.5 py-0.5 rounded text-slate-800 border">
                        {app.application_id}
                      </span>
                      <span className="text-xs font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded">
                        Cycle {app.cycle_year}
                      </span>
                    </div>
                    <h3 className="text-lg font-bold text-slate-900 mt-1">
                      {app.citizen_name} ({app.citizen_id})
                    </h3>
                    <p className="text-xs text-slate-600 font-medium">Scheme: {app.scheme_title}</p>
                  </div>

                  <div className="text-right">
                    <span className="text-xs px-2.5 py-1 rounded-full font-bold uppercase tracking-wider bg-amber-100 text-amber-900 border border-amber-300">
                      Status: {app.status}
                    </span>
                    <p className="text-[11px] text-slate-400 mt-1">Applied: {app.applied_at}</p>
                  </div>
                </div>

                {/* Land Parcel Composite Key & Document HMACs */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200">
                    <span className="font-bold text-slate-700 block mb-1">
                      Land Parcel Composite Key (Fix ① & ②):
                    </span>
                    <p className="font-mono text-emerald-950 font-semibold bg-white p-2 rounded border border-slate-200">
                      {app.parcel_key}
                    </p>
                    <span className="text-[11px] text-slate-500 mt-1.5 block">
                      Guaranteed unique per (state, district, taluk, village, survey_no, subdivision).
                    </span>
                  </div>

                  <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200">
                    <span className="font-bold text-slate-700 block mb-1">
                      Proof Documents from MongoDB (Fix ⑤ & ⑥):
                    </span>
                    <div className="space-y-1.5">
                      {app.documents_missing && <p className="text-rose-600">No document set in MongoDB for this application.</p>}
                      {app.documents.map((doc, idx) => (
                        <div key={idx} className={`bg-white p-2 rounded border flex items-center justify-between ${doc.mismatch ? 'border-rose-400 bg-rose-50' : 'border-slate-200'}`}>
                          <div className="min-w-0">
                            <span className="font-bold text-slate-800">{doc.doc_type}: </span>
                            <span className="text-slate-600">{doc.doc_name}</span>
                            <p className="font-mono text-[10px] text-slate-400 truncate max-w-[260px]" title={doc.hmac_signature}>
                              {doc.doc_type === 'AADHAAR' ? 'Extracted Aadhaar HMAC' : 'Extracted ID'}: {doc.hmac_signature}
                            </p>
                            {doc.mismatch && (
                              <p className="text-[10px] font-bold text-rose-700">⚠ This Aadhaar belongs to a different registered citizen</p>
                            )}
                          </div>
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            doc.verified ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                          }`}>
                            {doc.verified ? 'VERIFIED' : 'PENDING'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Verification Actions */}
                <div className="pt-2 flex items-center justify-between flex-wrap gap-3 border-t border-slate-100">
                  <div className="text-xs text-slate-500">
                    {app.verified_by ? (
                      <span className="text-emerald-700 font-semibold">
                        ✓ Verified by {app.verified_by} on {app.verified_at}
                      </span>
                    ) : (
                      <span>Awaiting inspection and biometric sign-off</span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {app.status === 'submitted' && (
                      <button
                        onClick={() => onUpdateStatus(app.application_id, 'under_review', officerId)}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs transition cursor-pointer"
                      >
                        Start Field Review
                      </button>
                    )}

                    {app.status === 'under_review' && (
                      <button
                        onClick={() => onUpdateStatus(app.application_id, 'verified', officerId)}
                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition flex items-center gap-1.5 cursor-pointer"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Certify & Sign as Verified</span>
                      </button>
                    )}

                    {(app.status === 'submitted' || app.status === 'under_review') && (
                      <button
                        onClick={() => {
                          const reason = prompt("Enter Rejection Reason for Application:", "Land survey discrepancy / forged deed");
                          if (reason) onUpdateStatus(app.application_id, 'rejected', officerId, reason);
                        }}
                        className="px-3.5 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-xs rounded-xl border border-rose-200 transition cursor-pointer"
                      >
                        Reject Application
                      </button>
                    )}
                  </div>
                </div>

              </div>
            ))
          )}
        </div>

      </div>
    </div>
  );
};
