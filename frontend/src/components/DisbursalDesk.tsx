import React, { useState } from 'react';
import { SchemeApplication, Disbursal, AuditLogEntry, Language, Officer, RaceMode, RaceResult } from '../types';
import { DollarSign, ShieldCheck, Zap, CheckCircle2, Layers, Loader2, RotateCcw } from 'lucide-react';
import confetti from 'canvas-confetti';

type ActionResult = { success: boolean; error?: string };

interface DisbursalDeskProps {
  applications: SchemeApplication[];
  disbursals: Disbursal[];
  auditLogs: AuditLogEntry[];
  officers: Officer[];
  onApproveApplication: (appId: string, approverId: string) => Promise<ActionResult>;
  onReleaseNext: (appId: string, approverId: string) => Promise<ActionResult>;
  onDisbursePayment: (appId: string, disburserId: string, simulateBankFailure?: boolean) => Promise<ActionResult>;
  onSimulateRaceCondition: (appId: string, workers: number, mode: RaceMode, officerId: string) => Promise<RaceResult | null>;
  language: Language;
}

const MODES: { id: RaceMode; label: string; blurb: string }[] = [
  { id: 'safe', label: 'Real code path', blurb: "initiate_payment(): SELECT … WHERE status = 'approved' FOR UPDATE, plus UNIQUE(application_id, instalment_no)" },
  { id: 'no_lock', label: 'No row lock', blurb: 'Careless code: plain SELECT, then INSERT. Only the UNIQUE constraint is left to stop duplicates.' },
  { id: 'no_defence', label: 'No lock, no UNIQUE', blurb: 'Same careless code writing to RaceDemoLedger, a teaching table with no constraint. Shows the money that would leak.' },
];

export const DisbursalDesk: React.FC<DisbursalDeskProps> = ({
  applications,
  disbursals,
  officers,
  onApproveApplication,
  onReleaseNext,
  onDisbursePayment,
  onSimulateRaceCondition,
  language,
}) => {
  const isHi = language === 'hi';
  const [approverId, setApproverId] = useState<string>('OFFICER_APPROVER_02');
  const [activeTab, setActiveTab] = useState<'QUEUE' | 'DISBURSED_LEDGER' | 'CONCURRENCY_LAB'>('QUEUE');
  const [pending, setPending] = useState<string | null>(null);
  const [raceTarget, setRaceTarget] = useState<string>('');
  const [raceMode, setRaceMode] = useState<RaceMode>('safe');
  const [raceWorkers, setRaceWorkers] = useState<number>(15);
  const [raceResults, setRaceResults] = useState<RaceResult | null>(null);

  const actionQueue = applications.filter(a => ['verified', 'approved', 'partially_paid', 'payment_initiated'].includes(a.status));
  const raceCandidates = applications.filter(a => a.status === 'approved');
  const target = raceCandidates.find(a => a.application_id === raceTarget) ?? raceCandidates[0];

  const act = async (key: string, fn: () => Promise<ActionResult>, celebrate = false) => {
    setPending(key);
    const res = await fn();
    setPending(null);
    if (res.success && celebrate) {
      confetti({ particleCount: 80, spread: 60, origin: { y: 0.7 }, colors: ['#10b981', '#f59e0b', '#047857'] });
    }
  };

  const runRaceSimulation = async () => {
    if (!target) return;
    setPending('race');
    const res = await onSimulateRaceCondition(target.application_id, raceWorkers, raceMode, approverId);
    setPending(null);
    if (res) setRaceResults(res);
  };

  return (
    <div className="py-8 bg-slate-50 min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        
        {/* Header Banner */}
        <div className="bg-gradient-to-r from-emerald-950 via-green-950 to-slate-950 text-white rounded-3xl p-6 sm:p-8 shadow-xl border border-emerald-800/40 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold text-amber-300 uppercase tracking-widest">
              <ShieldCheck className="w-4 h-4 text-amber-400" />
              <span>ROLE: FINANCE SANCTIONING AUTHORITY & PFMS DBT DESK</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold mt-1">
              {isHi ? 'डीबीटी भुगतान एवं बैंक हस्तांतरण डेस्क' : 'Direct Benefit Transfer (DBT) Disbursals'}
            </h2>
            <p className="text-xs text-emerald-100/80 mt-2 max-w-2xl leading-relaxed">
              Disburse direct bank credits into validated farmer accounts. Protected by PostgreSQL
              <code className="bg-black/30 px-1 py-0.5 rounded font-mono text-amber-300"> SELECT ... FOR UPDATE </code>
              row-level locking and composite
              <code className="bg-black/30 px-1 py-0.5 rounded font-mono text-amber-300"> UNIQUE(application_id, instalment_no) </code>
              guaranteeing zero double-payouts.
            </p>
          </div>

          <div className="bg-white/10 backdrop-blur-md p-4 rounded-2xl border border-white/20 text-xs shrink-0 space-y-2 min-w-0 max-w-full">
            <span className="text-emerald-200 block font-semibold">Active Approver / Disburser:</span>
            <div className="flex items-center gap-2">
              <select
                value={approverId}
                onChange={(e) => setApproverId(e.target.value)}
                className="min-w-0 max-w-[220px] sm:max-w-none bg-black/40 border border-emerald-400/50 rounded-lg px-2.5 py-1 text-white font-mono text-xs focus:outline-none"
              >
                {officers.map((o) => (
                  <option key={o.officer_id} value={o.officer_id} className="text-slate-900">
                    {o.officer_id} · {[o.can_verify && 'verify', o.can_approve && 'approve', o.can_disburse && 'pay'].filter(Boolean).join('/')}
                  </option>
                ))}
              </select>
              <span className="text-[10px] text-amber-300 uppercase font-bold">Authorized</span>
            </div>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center gap-3 border-b border-slate-200 pb-2">
          <button
            onClick={() => setActiveTab('QUEUE')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-2 ${
              activeTab === 'QUEUE'
                ? 'bg-emerald-700 text-white shadow-xs'
                : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
            }`}
          >
            <span>Action Queue ({actionQueue.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('DISBURSED_LEDGER')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-2 ${
              activeTab === 'DISBURSED_LEDGER'
                ? 'bg-emerald-700 text-white shadow-xs'
                : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
            }`}
          >
            <span>Immutable Disbursals Ledger ({disbursals.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('CONCURRENCY_LAB')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-2 bg-gradient-to-r from-amber-600 to-amber-700 text-white shadow-xs hover:from-amber-700 hover:to-amber-800`}
          >
            <Zap className="w-3.5 h-3.5 text-amber-200 animate-pulse" />
            <span>Race Condition Lab (real concurrent transactions)</span>
          </button>
        </div>

        {/* Tab 1: Queue */}
        {activeTab === 'QUEUE' && (
          <div className="space-y-4">
            {actionQueue.length === 0 ? (
              <div className="bg-white rounded-3xl p-12 text-center border border-slate-200 text-slate-500">
                <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto mb-3 opacity-60" />
                <h3 className="font-bold text-base text-slate-800">All queues are clear!</h3>
                <p className="text-xs mt-1">No verified, approved or part-paid applications.</p>
              </div>
            ) : (
              actionQueue.map((app) => (
                <div
                  key={app.application_id}
                  className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xs hover:border-emerald-300 transition space-y-4"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold bg-slate-100 px-2 py-0.5 rounded text-slate-800 border">
                          {app.application_id}
                        </span>
                        <span className="text-xs font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded">
                          Cycle {app.cycle_year}
                        </span>
                      </div>
                      <h3 className="text-lg font-bold text-slate-900 mt-1">{app.citizen_name}</h3>
                      <p className="text-xs text-slate-600 font-medium">Scheme: {app.scheme_title}</p>
                    </div>

                    <div className="text-right">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-bold uppercase tracking-wider ${
                        app.status === 'approved'
                          ? 'bg-blue-100 text-blue-900 border border-blue-300'
                          : 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                      }`}>
                        Status: {app.status.replace(/_/g, ' ')}
                      </span>
                      <p className="text-[11px] text-slate-400 mt-1">Verified by: {app.verified_by || 'N/A'}</p>
                      <p className="text-[11px] text-emerald-700 font-bold">
                        Instalments: {app.instalments_paid ?? 0} / {app.instalments_count ?? 1} · ₹{(app.benefit_amount ?? 0).toLocaleString('en-IN')} each
                      </p>
                    </div>
                  </div>

                  {/* Land Parcel & Bank Details */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                    <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200">
                      <span className="font-bold text-slate-700 block mb-1">Target Land Parcel:</span>
                      <p className="font-mono text-slate-800 text-[11px] truncate">{app.parcel_key}</p>
                    </div>

                    <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200">
                      <span className="font-bold text-slate-700 block mb-1">Audit Verification Sign-Off:</span>
                      <p className="text-[11px] text-slate-600">
                        Field Officer: <strong>{app.verified_by}</strong> on {app.verified_at}
                      </p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="pt-3 flex items-center justify-between flex-wrap gap-3 border-t border-slate-100">
                    <div className="text-xs text-slate-500 font-mono">
                      Separation of duties:{' '}
                      {approverId === app.verified_by
                        ? <span className="font-bold text-rose-700">{approverId} verified this; the database will refuse</span>
                        : <span className="font-bold text-emerald-700">Approver ({approverId}) ≠ Verifier ({app.verified_by})</span>}
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      {pending?.startsWith(app.application_id) && <Loader2 className="w-4 h-4 animate-spin text-emerald-700" />}
                      {app.status === 'verified' && (
                        <button
                          disabled={!!pending}
                          onClick={() => act(`${app.application_id}-approve`, () => onApproveApplication(app.application_id, approverId))}
                          className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          <span>Sanction & Approve Application</span>
                        </button>
                      )}

                      {app.status === 'approved' && (
                        <>
                          <button
                            disabled={!!pending}
                            onClick={() => act(`${app.application_id}-fail`, () => onDisbursePayment(app.application_id, approverId, true))}
                            className="px-3 py-2.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 font-bold text-[11px] rounded-xl transition cursor-pointer disabled:opacity-50"
                            title="Bank rejects the credit: attempt marked FAILED, status goes back to approved"
                          >
                            Simulate bank failure
                          </button>
                          <button
                            disabled={!!pending}
                            onClick={() => act(`${app.application_id}-pay`, () => onDisbursePayment(app.application_id, approverId), true)}
                            className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-md transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                          >
                            <DollarSign className="w-4 h-4 text-amber-300" />
                            <span>Release DBT Disbursal (Instalment #{(app.instalments_paid ?? 0) + 1})</span>
                          </button>
                        </>
                      )}

                      {app.status === 'partially_paid' && (
                        <button
                          disabled={!!pending}
                          onClick={() => act(`${app.application_id}-next`, () => onReleaseNext(app.application_id, approverId))}
                          className="px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl shadow-xs transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                        >
                          <RotateCcw className="w-4 h-4" />
                          <span>Release Instalment #{(app.instalments_paid ?? 0) + 1} for payment</span>
                        </button>
                      )}

                      {app.status === 'payment_initiated' && (
                        <span className="text-[11px] text-amber-700 font-bold">Bank transfer in flight; waiting for complete_payment()</span>
                      )}
                    </div>
                  </div>

                </div>
              ))
            )}
          </div>
        )}

        {/* Tab 2: Disbursed Ledger */}
        {activeTab === 'DISBURSED_LEDGER' && (
          <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Layers className="w-5 h-5 text-emerald-700" />
                  <span>Immutable Financial Disbursals Ledger (Fix ③ & ⑨)</span>
                </h3>
                <p className="text-xs text-slate-500">
                  Protected by PostgreSQL trigger <code className="text-emerald-800 font-bold">trg_disbursal_immutable</code> (Raises exception on any UPDATE or DELETE).
                </p>
              </div>
              <span className="text-xs font-mono bg-emerald-50 text-emerald-800 px-3 py-1 rounded-full font-bold border border-emerald-200">
                Total Disbursed: ₹{disbursals.reduce((sum, d) => sum + d.amount, 0).toLocaleString('en-IN')}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-y border-slate-200 text-slate-600 uppercase font-bold tracking-wider text-[11px]">
                    <th className="p-3">Disbursal ID</th>
                    <th className="p-3">Application / Beneficiary</th>
                    <th className="p-3">Instalment</th>
                    <th className="p-3">Amount</th>
                    <th className="p-3">PFMS Banking Txn Ref</th>
                    <th className="p-3">Disbursed At</th>
                    <th className="p-3">Disbursed By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {disbursals.map((d) => (
                    <tr key={d.disbursal_id} className="hover:bg-slate-50/70 font-mono">
                      <td className="p-3 font-bold text-emerald-900">{d.disbursal_id}</td>
                      <td className="p-3">
                        <span className="font-sans font-bold text-slate-900 block">{d.citizen_name}</span>
                        <span className="text-[10px] text-slate-500">{d.application_id}</span>
                      </td>
                      <td className="p-3">
                        <span className="bg-amber-100 text-amber-900 px-2 py-0.5 rounded text-[10px] font-bold">
                          Instalment #{d.instalment_no}
                        </span>
                      </td>
                      <td className="p-3 font-bold text-emerald-700 font-sans text-sm">
                        ₹{d.amount.toLocaleString('en-IN')}
                      </td>
                      <td className="p-3 text-[11px] text-slate-600">{d.txn_ref}</td>
                      <td className="p-3 text-[10px] text-slate-500">{d.disbursed_at}</td>
                      <td className="p-3 text-[10px] text-slate-700">{d.disbursed_by}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 3: Concurrency lab: real parallel transactions against PostgreSQL */}
        {activeTab === 'CONCURRENCY_LAB' && (
          <div className="bg-white rounded-3xl p-6 sm:p-8 border border-amber-300 shadow-md space-y-6">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-2xl bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-md">
                <Zap className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-xl font-extrabold text-slate-900">Race Condition Lab</h3>
                <p className="text-xs text-slate-600 mt-1 max-w-3xl leading-relaxed">
                  The API opens one database connection per worker, waits until all are connected, then releases them at the same instant.
                  Every number below is counted from the database after the run, not scripted. Compare the three modes to see
                  why the project keeps <strong>both</strong> the row lock and the UNIQUE constraint.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {MODES.map((m) => (
                <button key={m.id} onClick={() => setRaceMode(m.id)}
                  className={`text-left p-4 rounded-2xl border transition cursor-pointer ${raceMode === m.id ? 'border-amber-500 bg-amber-50 ring-2 ring-amber-400' : 'border-slate-200 bg-slate-50 hover:bg-slate-100'}`}>
                  <span className="text-xs font-extrabold text-slate-900 block">{m.label}</span>
                  <span className="text-[11px] text-slate-600 mt-1 block leading-relaxed">{m.blurb}</span>
                </button>
              ))}
            </div>

            <div className="p-5 rounded-2xl bg-amber-50 border border-amber-200 flex flex-col lg:flex-row lg:items-end justify-between gap-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 flex-1">
                <label className="block text-xs">
                  <span className="font-bold text-amber-950 uppercase tracking-wider block mb-1">Target (must be 'approved')</span>
                  <select value={target?.application_id ?? ''} onChange={(e) => setRaceTarget(e.target.value)}
                    className="w-full p-2.5 rounded-xl border border-amber-300 bg-white text-sm">
                    {raceCandidates.length === 0 && <option value="">No approved application: approve one or release an instalment</option>}
                    {raceCandidates.map((a) => (
                      <option key={a.application_id} value={a.application_id}>
                        {a.application_id} · {a.citizen_name} · instalment #{(a.instalments_paid ?? 0) + 1} of {a.instalments_count}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs">
                  <span className="font-bold text-amber-950 uppercase tracking-wider block mb-1">Concurrent workers: {raceWorkers}</span>
                  <input type="range" min={2} max={40} value={raceWorkers} onChange={(e) => setRaceWorkers(Number(e.target.value))} className="w-full accent-amber-600" />
                </label>
              </div>
              <button
                onClick={runRaceSimulation}
                disabled={!target || pending === 'race'}
                className="w-full lg:w-auto px-6 py-3 bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-700 hover:to-amber-800 text-white font-extrabold text-xs rounded-xl shadow-lg transition flex items-center justify-center gap-2 cursor-pointer shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {pending === 'race' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4 text-amber-200" />}
                <span>FIRE {raceWorkers} PARALLEL PAYMENT ATTEMPTS</span>
              </button>
            </div>
            {raceMode !== 'no_defence' && (
              <p className="text-[11px] text-slate-500 -mt-3">
                Modes that touch the real ledger pay the instalment once, so the target leaves the 'approved' state. Use "Release instalment" in the
                Action Queue (multi-instalment schemes) or "Reset demo database" to run again. The no-defence mode never changes real data.
              </p>
            )}

            {raceResults && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-center">
                    <span className="text-xs text-emerald-800 font-medium block">Workers that paid</span>
                    <span className="text-3xl font-extrabold text-emerald-700 font-mono mt-1 block">{raceResults.successCount}</span>
                  </div>
                  <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-center">
                    <span className="text-xs text-rose-800 font-medium block">Workers refused</span>
                    <span className="text-3xl font-extrabold text-rose-700 font-mono mt-1 block">{raceResults.blockedCount}</span>
                    <span className="text-[10px] text-rose-600 font-medium block">
                      {Object.entries(raceResults.blockedBy).map(([k, v]) => `${v}× ${k}`).join(', ') || '—'}
                    </span>
                  </div>
                  <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-center">
                    <span className="text-xs text-slate-700 font-medium block">Ledger rows written</span>
                    <span className="text-3xl font-extrabold text-slate-800 font-mono mt-1 block">{raceResults.ledgerRows}</span>
                    <span className="text-[10px] text-slate-500 font-medium block">{raceResults.mode === 'no_defence' ? 'RaceDemoLedger' : 'Disbursals'} · {raceResults.elapsed_ms} ms</span>
                  </div>
                  <div className={`p-4 rounded-2xl border text-center ${raceResults.leakage > 0 ? 'bg-rose-100 border-rose-400' : 'bg-blue-50 border-blue-200'}`}>
                    <span className="text-xs font-medium block text-slate-800">Double-payout leakage</span>
                    <span className={`text-3xl font-extrabold font-mono mt-1 block ${raceResults.leakage > 0 ? 'text-rose-700' : 'text-blue-700'}`}>
                      ₹{raceResults.leakage.toLocaleString('en-IN')}
                    </span>
                    <span className="text-[10px] font-medium block text-slate-600">{raceResults.duplicatePayouts} duplicate payment(s)</span>
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-slate-900 text-emerald-400 font-mono text-[11px] space-y-1 max-h-72 overflow-y-auto border border-slate-800 shadow-inner">
                  <div className="text-slate-400 font-bold border-b border-slate-800 pb-1 mb-2 flex items-center justify-between gap-2 flex-wrap">
                    <span>WORKER TRACE ({raceResults.run_id}, mode={raceResults.mode}, READ COMMITTED)</span>
                    <span className="text-[10px] text-amber-400">{raceResults.workers} REAL CONNECTIONS</span>
                  </div>
                  {raceResults.logs.map((log, lIdx) => (
                    <div key={lIdx} className={log.includes('BLOCKED') ? 'text-rose-300' : log.includes('ledger row') || log.includes('COMMIT ->') || log.includes('money sent') ? 'text-amber-300 font-bold' : 'text-slate-300'}>
                      {log}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
};
