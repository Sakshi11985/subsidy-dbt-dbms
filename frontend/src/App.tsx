import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { DbState, FraudFlag, Language, RaceMode, RaceResult, Scheme, SchemeApplication } from './types';
import { api, ApiError } from './api';
import { toast } from './utils/toast';

import { TopTicker } from './components/TopTicker';
import { Header } from './components/Header';
import { Hero } from './components/Hero';
import { SchemesGrid } from './components/SchemesGrid';
import { CitizenPortal } from './components/CitizenPortal';
import { VerificationDesk } from './components/VerificationDesk';
import { DisbursalDesk } from './components/DisbursalDesk';
import { FraudConsole } from './components/FraudConsole';
import { DbmsDefenseSuite } from './components/DbmsDefenseSuite';
import { ApplyModal } from './components/ApplyModal';
import { RegisterModal } from './components/RegisterModal';
import { Footer } from './components/Footer';
import { Toaster } from './components/Toaster';

export type ActionResult = { success: boolean; error?: string };

/** Turn an API refusal into a toast naming the database mechanism that refused it. */
function reportError(err: unknown, fallbackTitle = 'Request failed'): ActionResult {
  if (err instanceof ApiError) {
    const title = err.blocked ? `Blocked by ${err.blocked.mechanism}` : fallbackTitle;
    toast.error(title, err.message);
    return { success: false, error: err.message };
  }
  toast.error(fallbackTitle, String(err));
  return { success: false, error: String(err) };
}

export const App: React.FC = () => {
  const [currentTab, setCurrentTab] = useState<string>('citizen');
  const [language, setLanguage] = useState<Language>('en');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const [db, setDb] = useState<DbState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [selectedSchemeForModal, setSelectedSchemeForModal] = useState<Scheme | null>(null);
  const [isApplyModalOpen, setIsApplyModalOpen] = useState<boolean>(false);
  const [isRegisterOpen, setIsRegisterOpen] = useState<boolean>(false);
  const [activeCitizenId, setActiveCitizenId] = useState<string>('CIT-1001');

  const refresh = useCallback(async () => {
    try {
      const state = await api<DbState>('/state');
      setDb(state);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  /** Run a mutating API call, then reload state from the database. */
  const run = useCallback(async <T,>(fn: () => Promise<T>, okTitle?: (r: T) => string | null, errTitle?: string) => {
    setBusy(true);
    try {
      const r = await fn();
      const msg = okTitle?.(r);
      if (msg) toast.success(msg);
      const warning = (r as { warning?: string } | null)?.warning;
      if (warning) toast.info('Partial success', warning);
      return { success: true, result: r } as ActionResult & { result: T };
    } catch (err) {
      return reportError(err, errTitle) as ActionResult & { result?: T };
    } finally {
      await refresh();
      setBusy(false);
    }
  }, [refresh]);

  // ---------------------------------------------------------- handlers
  const handleUpdateStatus = (appId: string, newStatus: SchemeApplication['status'], officerId: string, notes?: string) =>
    run(() => api(`/applications/${appId}/status`, { status: newStatus, officer_id: officerId, notes }),
      () => `${appId} → ${newStatus}`);

  const handleApproveApplication = (appId: string, approverId: string) =>
    run(() => api(`/applications/${appId}/approve`, { officer_id: approverId }), () => `${appId} approved by ${approverId}`);

  const handleReleaseNext = (appId: string, approverId: string) =>
    run(() => api(`/applications/${appId}/release-next`, { officer_id: approverId }), () => `Next instalment of ${appId} released for payment`);

  const handleDisbursePayment = (appId: string, disburserId: string, simulateBankFailure = false) =>
    run(
      () => api<{ disbursal_id: string | null; attempt: { instalment_no: number; amount: number; txn_ref: string } }>(
        `/applications/${appId}/disburse`, { officer_id: disburserId, simulate_bank_failure: simulateBankFailure }),
      (r) => (r.disbursal_id
        ? `Paid instalment #${r.attempt.instalment_no} (₹${r.attempt.amount.toLocaleString('en-IN')}) · ${r.disbursal_id}`
        : null),
    ).then((res) => {
      const r = (res as { result?: { disbursal_id: string | null; attempt: { txn_ref: string } } }).result;
      if (res.success && r && !r.disbursal_id) toast.info('Bank rejected the transfer', `${r.attempt.txn_ref} marked FAILED; application returned to 'approved' so it can be retried.`);
      return res;
    });

  const handleSimulateRaceCondition = async (appId: string, workers: number, mode: RaceMode, officerId: string) => {
    const res = await run(() => api<RaceResult>('/race', { application_id: appId, workers, mode, officer_id: officerId }));
    return (res as { result?: RaceResult }).result ?? null;
  };

  const handleResolveFlag = (flagId: string, notes: string) =>
    run(() => api(`/fraud/${flagId}/resolve`, { notes }), () => `${flagId} resolved`);

  const handleInjectFraudCase = (type: FraudFlag['flag_type']) =>
    run(() => api<{ attempted: string; flag?: FraudFlag | null }>('/fraud/inject', { type }), (r) => null).then((res) => {
      const r = (res as { result?: { attempted: string; flag?: FraudFlag | null } }).result;
      if (r) {
        toast.success(r.flag ? `Caught: ${r.flag.flag_id} (${r.flag.severity})` : 'Attempt made', `${r.attempted}${r.flag ? ` → ${r.flag.details}` : ''}`);
      }
      return res;
    });

  const handleRunFullDatabaseScan = () =>
    run(() => api<Record<string, number | string>>('/fraud/scan', {}), (r) =>
      `Scan complete: ${Object.entries(r).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join(' · ')}`);

  const handleFreezeCitizen = (citizenId: string, frozen: boolean) =>
    run(() => api(`/citizens/${citizenId}/freeze`, { frozen, officer_id: 'CHIEF_VIGILANCE_OFFICER_01' }),
      () => `${citizenId} ${frozen ? 'frozen' : 'unfrozen'}`);

  const handleReset = () =>
    run(() => api('/reset', {}), () => 'Demo database rebuilt from database/schema.sql + seed');

  const handleOpenApplyModalWithScheme = (scheme: Scheme) => {
    setSelectedSchemeForModal(scheme);
    setIsApplyModalOpen(true);
  };

  const activeCitizen = useMemo(
    () => db?.citizens.find((c) => c.citizen_id === activeCitizenId) ?? db?.citizens[0],
    [db, activeCitizenId],
  );

  // ------------------------------------------------------------ render
  if (!db) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="max-w-lg bg-white rounded-3xl border border-slate-200 p-8 text-center shadow-sm">
          <h1 className="text-xl font-extrabold text-slate-900">{loadError ? 'Backend not reachable' : 'Loading from PostgreSQL…'}</h1>
          {loadError && (
            <>
              <p className="text-sm text-slate-600 mt-3">{loadError}</p>
              <pre className="mt-4 text-left text-xs bg-slate-900 text-emerald-300 rounded-xl p-4 overflow-x-auto">{`cd backend\nnpm install\nnpm start        # API on http://localhost:4000`}</pre>
              <button onClick={refresh} className="mt-4 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl cursor-pointer">Retry</button>
            </>
          )}
        </div>
      </div>
    );
  }

  const { citizens, parcels, ownerships, schemes, applications, disbursals, fraudFlags, auditLogs, officers } = db;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-800 font-sans">
      <TopTicker />

      <Header
        currentTab={currentTab}
        setCurrentTab={setCurrentTab}
        language={language}
        setLanguage={setLanguage}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        fraudCount={fraudFlags.filter(f => !f.resolved).length}
      />

      {/* role switcher: the header's marketing labels (Services, Knowledge, Community) hide which desk is which */}
      <nav aria-label="Role desks" className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 flex items-center gap-2 overflow-x-auto">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 shrink-0">Role desk:</span>
          {[
            ['citizen', 'Citizen / Farmer'],
            ['verifier', 'Verifying Agent'],
            ['disbursal', 'Approval & Payment'],
            ['fraud', `Vigilance (${fraudFlags.filter(f => !f.resolved).length})`],
            ['dbms', 'DBMS Internals'],
          ].map(([id, label]) => (
            <button key={id} onClick={() => setCurrentTab(id)} aria-current={currentTab === id ? 'page' : undefined}
              className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                currentTab === id ? 'bg-emerald-700 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
              {label}
            </button>
          ))}
        </div>
      </nav>

      {/* live database status strip */}
      <div className="bg-slate-900 text-[11px] text-slate-300 font-mono">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-400" />PostgreSQL: live</span>
          <span className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${db.meta.mongo.connected ? 'bg-emerald-400' : 'bg-rose-500'}`} />
            MongoDB: {db.meta.mongo.connected ? 'live' : `offline (${db.meta.mongo.error ?? 'not connected'})`}
          </span>
          <span className="text-slate-500">synced {db.meta.generated_at}{busy ? ' · working…' : ''}</span>
          <button onClick={handleReset} disabled={busy}
            className="ml-auto px-2 py-0.5 rounded border border-slate-600 hover:bg-slate-800 cursor-pointer disabled:opacity-50">
            Reset demo database
          </button>
        </div>
      </div>

      {currentTab === 'citizen' && (
        <Hero
          language={language}
          onSelectAction={(tab) => setCurrentTab(tab)}
          onOpenApplyModal={() => handleOpenApplyModalWithScheme(schemes[0])}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          onToggleLanguage={() => {
            const sequence: Language[] = ['en', 'kn', 'hi', 'te', 'ta', 'mr', 'pa'];
            const nextIdx = (sequence.indexOf(language) + 1) % sequence.length;
            setLanguage(sequence[nextIdx]);
          }}
        />
      )}

      <main className="flex-1">
        {currentTab === 'citizen' && activeCitizen && (
          <>
            <SchemesGrid schemes={schemes} language={language} onApplyForScheme={handleOpenApplyModalWithScheme} searchFilter={searchQuery} />
            <CitizenPortal
              applications={applications.filter(a => a.citizen_id === activeCitizen.citizen_id)}
              currentCitizen={activeCitizen}
              citizens={citizens}
              ownerships={ownerships.filter(o => o.citizen_id === activeCitizen.citizen_id)}
              onSelectCitizen={setActiveCitizenId}
              onOpenRegister={() => setIsRegisterOpen(true)}
              onOpenApplyModal={() => handleOpenApplyModalWithScheme(schemes[0])}
              language={language}
            />
          </>
        )}

        {currentTab === 'schemes' && (
          <SchemesGrid schemes={schemes} language={language} onApplyForScheme={handleOpenApplyModalWithScheme} searchFilter={searchQuery} />
        )}

        {currentTab === 'verifier' && (
          <VerificationDesk applications={applications} officers={officers} onUpdateStatus={handleUpdateStatus} language={language} />
        )}

        {currentTab === 'disbursal' && (
          <DisbursalDesk
            applications={applications}
            disbursals={disbursals}
            auditLogs={auditLogs}
            officers={officers}
            onApproveApplication={handleApproveApplication}
            onReleaseNext={handleReleaseNext}
            onDisbursePayment={handleDisbursePayment}
            onSimulateRaceCondition={handleSimulateRaceCondition}
            language={language}
          />
        )}

        {currentTab === 'fraud' && (
          <FraudConsole
            fraudFlags={fraudFlags}
            auditLogs={auditLogs}
            citizens={citizens}
            parcels={parcels}
            ownerships={ownerships}
            onResolveFlag={handleResolveFlag}
            onInjectFraudCase={handleInjectFraudCase}
            onRunFullDatabaseScan={handleRunFullDatabaseScan}
            onFreezeCitizen={handleFreezeCitizen}
            language={language}
          />
        )}

        {currentTab === 'dbms' && <DbmsDefenseSuite language={language} />}
      </main>

      <ApplyModal
        key={`${selectedSchemeForModal?.scheme_id}-${isApplyModalOpen}`}
        scheme={selectedSchemeForModal}
        isOpen={isApplyModalOpen}
        onClose={() => setIsApplyModalOpen(false)}
        citizens={citizens}
        parcels={parcels}
        ownerships={ownerships}
        defaultCitizenId={activeCitizen?.citizen_id}
        onSubmitted={async (appId, citizenId) => {
          setIsApplyModalOpen(false);
          setActiveCitizenId(citizenId);
          setCurrentTab('citizen');
          toast.success(`Application ${appId} submitted`, 'Stored in PostgreSQL; proof-document metadata stored in MongoDB.');
          await refresh();
        }}
        language={language}
      />

      <RegisterModal
        isOpen={isRegisterOpen}
        onClose={() => setIsRegisterOpen(false)}
        onDone={async (citizenId) => {
          if (citizenId) setActiveCitizenId(citizenId);
          await refresh();
        }}
      />

      <Footer language={language} />
      <Toaster />
    </div>
  );
};

export default App;
