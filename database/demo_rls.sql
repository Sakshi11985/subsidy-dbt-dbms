-- Row-Level Security + column privileges, demonstrated in plain psql.
--   psql -U postgres -d subsidy_dbt -f database/demo_rls.sql
-- Everything runs inside a transaction that is rolled back at the end.
BEGIN;

\echo '--- as the table owner (RLS bypassed): all citizens'
SELECT citizen_id, full_name FROM Citizens ORDER BY citizen_id;

\echo '--- as citizen_role, logged in as CIT-1002: only her own rows'
SET LOCAL ROLE citizen_role;
SELECT set_config('app.current_citizen_id', 'CIT-1002', true);
SELECT citizen_id, full_name FROM Citizens;
SELECT application_id, status FROM Applications;
SELECT disbursal_id, amount FROM Disbursals;
RESET ROLE;

\echo '--- as agent_role: may move a submitted application to under_review ...'
SET LOCAL ROLE agent_role;
UPDATE Applications SET status = 'under_review' WHERE application_id = 'APP-2026-0005';
\echo '--- ... but may NOT set approved_by (column-level GRANT). Expect: permission denied'
SAVEPOINT s;
UPDATE Applications SET approved_by = 'OFFICER_APPROVER_02' WHERE application_id = 'APP-2026-0005';
ROLLBACK TO SAVEPOINT s;
RESET ROLE;

ROLLBACK;
