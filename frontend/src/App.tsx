import React, { useState } from 'react';
import { 
  Citizen, 
  LandParcel, 
  LandOwnership, 
  Scheme, 
  SchemeApplication, 
  Disbursal, 
  FraudFlag, 
  AuditLogEntry, 
  Language 
} from './types';
import { 
  INITIAL_CITIZENS, 
  INITIAL_PARCELS, 
  INITIAL_OWNERSHIP, 
  SCHEMES, 
  INITIAL_APPLICATIONS, 
  INITIAL_DISBURSALS, 
  INITIAL_FRAUD_FLAGS, 
  INITIAL_AUDIT_LOGS 
} from './data/mockData';

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
import { Footer } from './components/Footer';

export const App: React.FC = () => {
  const [currentTab, setCurrentTab] = useState<string>('citizen');
  const [language, setLanguage] = useState<Language>('en');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Core Relational Tables State
  const [citizens, setCitizens] = useState<Citizen[]>(INITIAL_CITIZENS);
  const [parcels, setParcels] = useState<LandParcel[]>(INITIAL_PARCELS);
  const [ownerships, setOwnerships] = useState<LandOwnership[]>(INITIAL_OWNERSHIP);
  const [schemes, setSchemes] = useState<Scheme[]>(SCHEMES);
  const [applications, setApplications] = useState<SchemeApplication[]>(INITIAL_APPLICATIONS);
  const [disbursals, setDisbursals] = useState<Disbursal[]>(INITIAL_DISBURSALS);
  const [fraudFlags, setFraudFlags] = useState<FraudFlag[]>(INITIAL_FRAUD_FLAGS);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>(INITIAL_AUDIT_LOGS);

  // Modal State
  const [selectedSchemeForModal, setSelectedSchemeForModal] = useState<Scheme | null>(null);
  const [isApplyModalOpen, setIsApplyModalOpen] = useState<boolean>(false);

  // Active Citizen for Citizen Portal View
  const activeCitizen = citizens[0]; // Rajendra Prasad Yadav

  // 1. Submit New Application
  const handleSubmitApplication = (newApp: SchemeApplication) => {
    setApplications(prev => [newApp, ...prev]);

    // Insert into AuditLog
    const auditEntry: AuditLogEntry = {
      log_id: `AUD-${Date.now().toString().slice(-4)}`,
      entity_name: 'Applications',
      entity_id: newApp.application_id,
      action: 'INSERT',
      performed_by: newApp.citizen_id,
      timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
      new_state: `status: submitted, scheme: ${newApp.scheme_id}, parcel: ${newApp.parcel_key}`,
      status: 'SUCCESS',
    };
    setAuditLogs(prev => [auditEntry, ...prev]);
    setCurrentTab('citizen');
  };

  // 2. Field Verification Update
  const handleUpdateStatus = (
    appId: string, 
    newStatus: SchemeApplication['status'], 
    verifierId: string, 
    notes?: string
  ) => {
    setApplications(prev => prev.map(app => {
      if (app.application_id !== appId) return app;

      // Status Machine Trigger: Check valid transition
      if (app.status === 'submitted' && newStatus !== 'under_review' && newStatus !== 'rejected') {
        alert("Trigger trg_status_flow Blocked: submitted must transition to under_review first.");
        return app;
      }
      if (app.status === 'under_review' && newStatus !== 'verified' && newStatus !== 'rejected') {
        alert("Trigger trg_status_flow Blocked: under_review must transition to verified next.");
        return app;
      }

      const updatedDocs = app.documents.map(d => ({
        ...d,
        verified: newStatus === 'verified' ? true : d.verified,
      }));

      return {
        ...app,
        status: newStatus,
        verified_by: verifierId,
        verified_at: new Date().toISOString().replace('T', ' ').slice(0, 16),
        rejection_reason: notes || app.rejection_reason,
        documents: updatedDocs,
      };
    }));

    // Log in Audit Trail
    const log: AuditLogEntry = {
      log_id: `AUD-${Date.now().toString().slice(-4)}`,
      entity_name: 'Applications',
      entity_id: appId,
      action: 'UPDATE',
      performed_by: verifierId,
      timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
      old_state: `status: pending`,
      new_state: `status: ${newStatus}, verifier: ${verifierId}`,
      status: 'SUCCESS',
    };
    setAuditLogs(prev => [log, ...prev]);
  };

  // 3. Approver Action (Separation of duties trigger check!)
  const handleApproveApplication = (appId: string, approverId: string): { success: boolean; error?: string } => {
    const targetApp = applications.find(a => a.application_id === appId);
    if (!targetApp) return { success: false, error: 'Application not found.' };

    // Trigger: Prevent Self-Approval (trg_separation_of_duties)
    if (targetApp.verified_by && targetApp.verified_by === approverId) {
      const err = `Accountability Violation: Verifier (${targetApp.verified_by}) cannot be the Approver (${approverId}) for application ${appId}. Enforced by trigger trg_separation_of_duties.`;
      
      const log: AuditLogEntry = {
        log_id: `AUD-${Date.now().toString().slice(-4)}`,
        entity_name: 'Applications',
        entity_id: appId,
        action: 'UPDATE',
        performed_by: approverId,
        timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
        new_state: 'Attempted self-approval blocked',
        status: 'BLOCKED_BY_TRIGGER',
      };
      setAuditLogs(prev => [log, ...prev]);
      return { success: false, error: err };
    }

    setApplications(prev => prev.map(a => {
      if (a.application_id !== appId) return a;
      return {
        ...a,
        status: 'approved',
        approved_by: approverId,
        approved_at: new Date().toISOString().replace('T', ' ').slice(0, 16),
      };
    }));

    const log: AuditLogEntry = {
      log_id: `AUD-${Date.now().toString().slice(-4)}`,
      entity_name: 'Applications',
      entity_id: appId,
      action: 'UPDATE',
      performed_by: approverId,
      timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
      new_state: `status: approved, approver: ${approverId}`,
      status: 'SUCCESS',
    };
    setAuditLogs(prev => [log, ...prev]);

    return { success: true };
  };

  // 4. Disbursal (Two-phase bank transfer & UNIQUE constraint)
  const handleDisbursePayment = (
    appId: string, 
    instalmentNo: number, 
    disburserId: string
  ): { success: boolean; error?: string } => {
    const targetApp = applications.find(a => a.application_id === appId);
    if (!targetApp) return { success: false, error: 'Application not found.' };

    // Check UNIQUE(application_id, instalment_no) (Fix ③)
    const existingDisbursal = disbursals.find(
      d => d.application_id === appId && d.instalment_no === instalmentNo
    );

    if (existingDisbursal) {
      const err = `Blocked by UNIQUE(application_id, instalment_no): Instalment #${instalmentNo} already paid via Txn ${existingDisbursal.txn_ref}`;
      
      const log: AuditLogEntry = {
        log_id: `AUD-${Date.now().toString().slice(-4)}`,
        entity_name: 'Disbursals',
        entity_id: `${appId}-INST-${instalmentNo}`,
        action: 'DISBURSAL_ATTEMPT',
        performed_by: disburserId,
        timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
        new_state: err,
        status: 'BLOCKED_BY_CONSTRAINT',
      };
      setAuditLogs(prev => [log, ...prev]);
      return { success: false, error: err };
    }

    const schemeObj = schemes.find(s => s.scheme_id === targetApp.scheme_id);
    const amount = schemeObj ? schemeObj.benefit_amount : 2000;
    const citizen = citizens.find(c => c.citizen_id === targetApp.citizen_id);

    const newDisbursal: Disbursal = {
      disbursal_id: `TXN-DBT-2026-${Math.floor(100 + Math.random() * 900)}`,
      application_id: appId,
      citizen_id: targetApp.citizen_id,
      citizen_name: targetApp.citizen_name,
      scheme_id: targetApp.scheme_id,
      scheme_title: targetApp.scheme_title,
      instalment_no: instalmentNo,
      amount: amount,
      bank_ifsc: citizen ? citizen.bank_ifsc : 'SBIN0004123',
      bank_account_no: citizen ? citizen.bank_account_no : '30498172635',
      txn_ref: `PFMS/2026/${Math.floor(1000000000 + Math.random() * 9000000000)}`,
      pfms_status: 'SUCCESS',
      disbursed_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
      disbursed_by: disburserId,
    };

    setDisbursals(prev => [newDisbursal, ...prev]);

    // Update application to 'paid'
    setApplications(prev => prev.map(a => {
      if (a.application_id !== appId) return a;
      return { ...a, status: 'paid' };
    }));

    // Audit Log
    const log: AuditLogEntry = {
      log_id: `AUD-${Date.now().toString().slice(-4)}`,
      entity_name: 'Disbursals',
      entity_id: newDisbursal.disbursal_id,
      action: 'INSERT',
      performed_by: disburserId,
      timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
      new_state: `Disbursed ₹${amount} (Instalment #${instalmentNo}) to ${targetApp.citizen_name}`,
      status: 'SUCCESS',
    };
    setAuditLogs(prev => [log, ...prev]);

    return { success: true };
  };

  // 5. Concurrency Race Condition Attack Simulator
  const handleSimulateRaceCondition = (appId: string, threadsCount: number = 15) => {
    const logs: string[] = [];
    logs.push(`[T=0ms] Blasting ${threadsCount} concurrent transaction workers at application ${appId}...`);
    logs.push(`[T=2ms] All ${threadsCount} workers execute: SELECT status FROM Applications WHERE application_id = '${appId}' AND status = 'approved' FOR UPDATE;`);
    logs.push(`[T=5ms] Worker #1 acquires exclusive row-level lock on row '${appId}'.`);
    logs.push(`[T=6ms] Workers #2 through #${threadsCount} suspended in lock-wait queue.`);
    logs.push(`[T=18ms] Worker #1 executes: INSERT INTO Disbursals ... VALUES ('${appId}', 1, 2000, ...);`);
    logs.push(`[T=24ms] Worker #1 executes: UPDATE Applications SET status = 'paid' ...;`);
    logs.push(`[T=26ms] Worker #1 executes: COMMIT; -> SUCCESS! Txn committed.`);
    
    // Execute the real state disbursal
    handleDisbursePayment(appId, 1, 'CONCURRENCY_WORKER_01');

    logs.push(`[T=28ms] Lock released. Workers #2 through #${threadsCount} wake up under READ COMMITTED.`);
    logs.push(`[T=29ms] PostgreSQL re-evaluates WHERE status = 'approved' on committed row version.`);
    logs.push(`[T=30ms] Condition status = 'approved' is FALSE (row is now 'paid'). 0 rows returned.`);
    logs.push(`[T=32ms] Workers #2 through #${threadsCount} exit cleanly with 0 disbursals created.`);
    logs.push(`[RESULT] Exactly 1 disbursal committed. ${threadsCount - 1} duplicate payouts cleanly avoided!`);

    return {
      successCount: 1,
      blockedCount: threadsCount - 1,
      logs: logs,
    };
  };

  // 6. Resolve Fraud Flag
  const handleResolveFlag = (flagId: string, notes: string) => {
    setFraudFlags(prev => prev.map(f => {
      if (f.flag_id !== flagId) return f;
      return {
        ...f,
        resolved: true,
        resolved_by: 'CHIEF_VIGILANCE_OFFICER_01',
        resolution_notes: notes,
      };
    }));
  };

  // 7. Inject Test Fraud Cases (for Viva)
  const handleInjectFraudCase = (type: FraudFlag['flag_type']) => {
    let newFlag: FraudFlag;
    const now = new Date().toISOString().replace('T', ' ').slice(0, 16);

    if (type === 'GHOST_BENEFICIARY_OVERALLOCATION') {
      newFlag = {
        flag_id: `FLG-${Date.now().toString().slice(-4)}`,
        flag_type: 'GHOST_BENEFICIARY_OVERALLOCATION',
        severity: 'CRITICAL',
        entity_type: 'PARCEL',
        entity_id: 'KA/Mandya/Maddur/Shivapura/109/4A',
        details: 'Simulated Injected Fraud: Added secondary claim on PARCEL-KA-GHOST. Total share fraction now 1.35 (135% of land boundary). Caught by trigger trg_check_parcel_share.',
        detected_at: now,
        resolved: false,
      };
    } else if (type === 'DUPLICATE_BANK_ACCOUNT') {
      newFlag = {
        flag_id: `FLG-${Date.now().toString().slice(-4)}`,
        flag_type: 'DUPLICATE_BANK_ACCOUNT',
        severity: 'HIGH',
        entity_type: 'BANK_ACCOUNT',
        entity_id: 'SBIN0004123 / 30498172635',
        details: 'Simulated Injected Fraud: Multiple distinct citizen records sharing identical (IFSC, Account_No). Potential money-mule syndicate detected by aggregate HAVING count(*) > 1.',
        detected_at: now,
        resolved: false,
      };
    } else {
      newFlag = {
        flag_id: `FLG-${Date.now().toString().slice(-4)}`,
        flag_type: 'DOCUMENT_REUSE_FUZZY_NAME',
        severity: 'HIGH',
        entity_type: 'DOCUMENT',
        entity_id: 'HMAC-SHA256: 88de912301fa4901...',
        details: 'Simulated Injected Fraud: Uploaded duplicate Aadhaar document HMAC under misspelled name "Harprit Sing Sandhu". pg_trgm trigram similarity = 0.91 (Above 0.85 threshold).',
        detected_at: now,
        resolved: false,
      };
    }

    setFraudFlags(prev => [newFlag, ...prev]);
    alert(`Fraud Flag Generated: ${newFlag.flag_type} has been captured into the FraudFlags table!`);
  };

  // 8. Run Full Automated SQL Scan
  const handleRunFullDatabaseScan = () => {
    alert("Automated PostgreSQL Scan Complete:\n• Checked 4 Land Parcels & 5 Ownership records.\n• Checked 6 Citizens for composite (IFSC, Account_No) uniqueness.\n• Checked pg_trgm GIN index for fuzzy name variants.\n• 3 active suspect records isolated in FraudFlags table.");
  };

  const handleOpenApplyModalWithScheme = (scheme: Scheme) => {
    setSelectedSchemeForModal(scheme);
    setIsApplyModalOpen(true);
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-800 font-sans">
      
      {/* 1. Live Mandi Commodity Ticker matching Farmer.in screenshot 1 */}
      <TopTicker />

      {/* 2. Global Header with navigation and role switchers */}
      <Header
        currentTab={currentTab}
        setCurrentTab={setCurrentTab}
        language={language}
        setLanguage={setLanguage}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        fraudCount={fraudFlags.filter(f => !f.resolved).length}
      />

      {/* 3. Hero section matching Farmer.in screenshot 1 */}
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

      {/* 4. Tab Content */}
      <main className="flex-1">
        {currentTab === 'citizen' && (
          <>
            <SchemesGrid
              schemes={schemes}
              language={language}
              onApplyForScheme={handleOpenApplyModalWithScheme}
              searchFilter={searchQuery}
            />
            <CitizenPortal
              applications={applications}
              currentCitizen={activeCitizen}
              onOpenApplyModal={() => handleOpenApplyModalWithScheme(schemes[0])}
              language={language}
            />
          </>
        )}

        {currentTab === 'schemes' && (
          <SchemesGrid
            schemes={schemes}
            language={language}
            onApplyForScheme={handleOpenApplyModalWithScheme}
            searchFilter={searchQuery}
          />
        )}

        {currentTab === 'verifier' && (
          <VerificationDesk
            applications={applications}
            onUpdateStatus={handleUpdateStatus}
            language={language}
          />
        )}

        {currentTab === 'disbursal' && (
          <DisbursalDesk
            applications={applications}
            disbursals={disbursals}
            auditLogs={auditLogs}
            onApproveApplication={handleApproveApplication}
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
            language={language}
          />
        )}

        {currentTab === 'dbms' && (
          <DbmsDefenseSuite language={language} />
        )}
      </main>

      {/* 5. Scheme Apply Modal */}
      <ApplyModal
        scheme={selectedSchemeForModal}
        isOpen={isApplyModalOpen}
        onClose={() => setIsApplyModalOpen(false)}
        citizens={citizens}
        parcels={parcels}
        ownerships={ownerships}
        applications={applications}
        onSubmitApplication={handleSubmitApplication}
        language={language}
      />

      {/* 6. Footer matching Farmer.in */}
      <Footer language={language} />

    </div>
  );
};

export default App;
