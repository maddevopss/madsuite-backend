-- Migration: Activer RLS (isolation par organisation) sur les tables sans protection
-- Issue #174 PR B: Isolation par organisation
--
-- 142 tables possedent une colonne organisation_id mais n'avaient aucune
-- policy RLS: seul un filtre applicatif manuel (WHERE organisation_id = $1)
-- protegeait ces donnees, sans filet de securite au niveau base si une
-- requete/job/jointure future omettait ce filtre.
--
-- Toutes les routes consommant ces tables passent deja par le middleware
-- requireOrganisation (SET LOCAL app.current_organisation_id + scope
-- AsyncLocalStorage), verifie sur un echantillon de 8 domaines metier.
-- Les policies ci-dessous suivent le meme contrat que les 172 tables
-- deja protegees: organisation_id = current_setting('app.current_organisation_id').

ALTER TABLE accounting_block_closures ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_block_closures FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS accounting_block_closures_org_isolation ON accounting_block_closures;
CREATE POLICY accounting_block_closures_org_isolation ON accounting_block_closures
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE accounting_closure_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_closure_controls FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS accounting_closure_controls_org_isolation ON accounting_closure_controls;
CREATE POLICY accounting_closure_controls_org_isolation ON accounting_closure_controls
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE activity_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_feedback FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS activity_feedback_org_isolation ON activity_feedback;
CREATE POLICY activity_feedback_org_isolation ON activity_feedback
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::integer)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::integer);

ALTER TABLE ai_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_audit_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_audit_logs_org_isolation ON ai_audit_logs;
CREATE POLICY ai_audit_logs_org_isolation ON ai_audit_logs
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::integer)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::integer);

ALTER TABLE assistance_audit_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistance_audit_evidence FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assistance_audit_evidence_org_isolation ON assistance_audit_evidence;
CREATE POLICY assistance_audit_evidence_org_isolation ON assistance_audit_evidence
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::integer)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::integer);

ALTER TABLE assistance_drift_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistance_drift_snapshots FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assistance_drift_snapshots_org_isolation ON assistance_drift_snapshots;
CREATE POLICY assistance_drift_snapshots_org_isolation ON assistance_drift_snapshots
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::integer)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::integer);

ALTER TABLE assistance_human_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistance_human_confirmations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assistance_human_confirmations_org_isolation ON assistance_human_confirmations;
CREATE POLICY assistance_human_confirmations_org_isolation ON assistance_human_confirmations
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::integer)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::integer);

ALTER TABLE assistance_recommendation_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistance_recommendation_evaluations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assistance_recommendation_evaluations_org_isolation ON assistance_recommendation_evaluations;
CREATE POLICY assistance_recommendation_evaluations_org_isolation ON assistance_recommendation_evaluations
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::integer)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::integer);

ALTER TABLE assistance_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistance_recommendations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assistance_recommendations_org_isolation ON assistance_recommendations;
CREATE POLICY assistance_recommendations_org_isolation ON assistance_recommendations
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::integer)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::integer);

ALTER TABLE audit_corrective_action_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_corrective_action_links FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_corrective_action_links_org_isolation ON audit_corrective_action_links;
CREATE POLICY audit_corrective_action_links_org_isolation ON audit_corrective_action_links
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE backend_global_closures ENABLE ROW LEVEL SECURITY;
ALTER TABLE backend_global_closures FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS backend_global_closures_org_isolation ON backend_global_closures;
CREATE POLICY backend_global_closures_org_isolation ON backend_global_closures
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE billing_ai_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_ai_suggestions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS billing_ai_suggestions_org_isolation ON billing_ai_suggestions;
CREATE POLICY billing_ai_suggestions_org_isolation ON billing_ai_suggestions
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::integer)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::integer);

ALTER TABLE business_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_audit_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS business_audit_logs_org_isolation ON business_audit_logs;
CREATE POLICY business_audit_logs_org_isolation ON business_audit_logs
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::integer)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::integer);

ALTER TABLE cognitive_load_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE cognitive_load_assessments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cognitive_load_assessments_org_isolation ON cognitive_load_assessments;
CREATE POLICY cognitive_load_assessments_org_isolation ON cognitive_load_assessments
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::integer)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::integer);

ALTER TABLE cognitive_work_resumptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE cognitive_work_resumptions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cognitive_work_resumptions_org_isolation ON cognitive_work_resumptions;
CREATE POLICY cognitive_work_resumptions_org_isolation ON cognitive_work_resumptions
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::integer)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::integer);

ALTER TABLE cybersecurity_access_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE cybersecurity_access_reviews FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cybersecurity_access_reviews_org_isolation ON cybersecurity_access_reviews;
CREATE POLICY cybersecurity_access_reviews_org_isolation ON cybersecurity_access_reviews
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE cybersecurity_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE cybersecurity_assets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cybersecurity_assets_org_isolation ON cybersecurity_assets;
CREATE POLICY cybersecurity_assets_org_isolation ON cybersecurity_assets
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE cybersecurity_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE cybersecurity_controls FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cybersecurity_controls_org_isolation ON cybersecurity_controls;
CREATE POLICY cybersecurity_controls_org_isolation ON cybersecurity_controls
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE cybersecurity_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE cybersecurity_exercises FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cybersecurity_exercises_org_isolation ON cybersecurity_exercises;
CREATE POLICY cybersecurity_exercises_org_isolation ON cybersecurity_exercises
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE cybersecurity_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE cybersecurity_incidents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cybersecurity_incidents_org_isolation ON cybersecurity_incidents;
CREATE POLICY cybersecurity_incidents_org_isolation ON cybersecurity_incidents
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE cybersecurity_vulnerabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE cybersecurity_vulnerabilities FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cybersecurity_vulnerabilities_org_isolation ON cybersecurity_vulnerabilities;
CREATE POLICY cybersecurity_vulnerabilities_org_isolation ON cybersecurity_vulnerabilities
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE decision_cashflow_forecasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_cashflow_forecasts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS decision_cashflow_forecasts_org_isolation ON decision_cashflow_forecasts;
CREATE POLICY decision_cashflow_forecasts_org_isolation ON decision_cashflow_forecasts
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::integer)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::integer);

ALTER TABLE decision_dashboard_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_dashboard_snapshots FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS decision_dashboard_snapshots_org_isolation ON decision_dashboard_snapshots;
CREATE POLICY decision_dashboard_snapshots_org_isolation ON decision_dashboard_snapshots
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::integer)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::integer);

ALTER TABLE decision_financial_health_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_financial_health_snapshots FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS decision_financial_health_snapshots_org_isolation ON decision_financial_health_snapshots;
CREATE POLICY decision_financial_health_snapshots_org_isolation ON decision_financial_health_snapshots
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::integer)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::integer);

ALTER TABLE decision_operational_scorecards ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_operational_scorecards FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS decision_operational_scorecards_org_isolation ON decision_operational_scorecards;
CREATE POLICY decision_operational_scorecards_org_isolation ON decision_operational_scorecards
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::integer)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::integer);

ALTER TABLE decision_risk_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_risk_alerts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS decision_risk_alerts_org_isolation ON decision_risk_alerts;
CREATE POLICY decision_risk_alerts_org_isolation ON decision_risk_alerts
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::integer)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::integer);

ALTER TABLE document_access_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_access_reviews FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS document_access_reviews_org_isolation ON document_access_reviews;
CREATE POLICY document_access_reviews_org_isolation ON document_access_reviews
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE document_attestations ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_attestations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS document_attestations_org_isolation ON document_attestations;
CREATE POLICY document_attestations_org_isolation ON document_attestations
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE document_classifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_classifications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS document_classifications_org_isolation ON document_classifications;
CREATE POLICY document_classifications_org_isolation ON document_classifications
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE document_custody_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_custody_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS document_custody_events_org_isolation ON document_custody_events;
CREATE POLICY document_custody_events_org_isolation ON document_custody_events
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE document_evidence_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_evidence_references FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS document_evidence_references_org_isolation ON document_evidence_references;
CREATE POLICY document_evidence_references_org_isolation ON document_evidence_references
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE document_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_links FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS document_links_org_isolation ON document_links;
CREATE POLICY document_links_org_isolation ON document_links
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE document_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_records FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS document_records_org_isolation ON document_records;
CREATE POLICY document_records_org_isolation ON document_records
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE document_retention_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_retention_actions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS document_retention_actions_org_isolation ON document_retention_actions;
CREATE POLICY document_retention_actions_org_isolation ON document_retention_actions
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_versions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS document_versions_org_isolation ON document_versions;
CREATE POLICY document_versions_org_isolation ON document_versions
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE enterprise_business_processes ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_business_processes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS enterprise_business_processes_org_isolation ON enterprise_business_processes;
CREATE POLICY enterprise_business_processes_org_isolation ON enterprise_business_processes
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE enterprise_continuity_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_continuity_exercises FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS enterprise_continuity_exercises_org_isolation ON enterprise_continuity_exercises;
CREATE POLICY enterprise_continuity_exercises_org_isolation ON enterprise_continuity_exercises
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE enterprise_continuity_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_continuity_plans FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS enterprise_continuity_plans_org_isolation ON enterprise_continuity_plans;
CREATE POLICY enterprise_continuity_plans_org_isolation ON enterprise_continuity_plans
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE enterprise_continuity_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_continuity_reviews FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS enterprise_continuity_reviews_org_isolation ON enterprise_continuity_reviews;
CREATE POLICY enterprise_continuity_reviews_org_isolation ON enterprise_continuity_reviews
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE enterprise_major_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_major_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS enterprise_major_events_org_isolation ON enterprise_major_events;
CREATE POLICY enterprise_major_events_org_isolation ON enterprise_major_events
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE enterprise_process_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_process_dependencies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS enterprise_process_dependencies_org_isolation ON enterprise_process_dependencies;
CREATE POLICY enterprise_process_dependencies_org_isolation ON enterprise_process_dependencies
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE enterprise_recovery_procedures ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_recovery_procedures FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS enterprise_recovery_procedures_org_isolation ON enterprise_recovery_procedures;
CREATE POLICY enterprise_recovery_procedures_org_isolation ON enterprise_recovery_procedures
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE enterprise_risk_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_risk_assessments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS enterprise_risk_assessments_org_isolation ON enterprise_risk_assessments;
CREATE POLICY enterprise_risk_assessments_org_isolation ON enterprise_risk_assessments
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE enterprise_risk_continuity_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_risk_continuity_links FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS enterprise_risk_continuity_links_org_isolation ON enterprise_risk_continuity_links;
CREATE POLICY enterprise_risk_continuity_links_org_isolation ON enterprise_risk_continuity_links
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE enterprise_risk_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_risk_controls FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS enterprise_risk_controls_org_isolation ON enterprise_risk_controls;
CREATE POLICY enterprise_risk_controls_org_isolation ON enterprise_risk_controls
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE enterprise_risk_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_risk_incidents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS enterprise_risk_incidents_org_isolation ON enterprise_risk_incidents;
CREATE POLICY enterprise_risk_incidents_org_isolation ON enterprise_risk_incidents
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE enterprise_risk_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_risk_reviews FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS enterprise_risk_reviews_org_isolation ON enterprise_risk_reviews;
CREATE POLICY enterprise_risk_reviews_org_isolation ON enterprise_risk_reviews
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE enterprise_risk_treatments ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_risk_treatments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS enterprise_risk_treatments_org_isolation ON enterprise_risk_treatments;
CREATE POLICY enterprise_risk_treatments_org_isolation ON enterprise_risk_treatments
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE enterprise_risks ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_risks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS enterprise_risks_org_isolation ON enterprise_risks;
CREATE POLICY enterprise_risks_org_isolation ON enterprise_risks
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE environmental_corrective_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE environmental_corrective_actions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS environmental_corrective_actions_org_isolation ON environmental_corrective_actions;
CREATE POLICY environmental_corrective_actions_org_isolation ON environmental_corrective_actions
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE environmental_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE environmental_incidents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS environmental_incidents_org_isolation ON environmental_incidents;
CREATE POLICY environmental_incidents_org_isolation ON environmental_incidents
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE environmental_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE environmental_inspections FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS environmental_inspections_org_isolation ON environmental_inspections;
CREATE POLICY environmental_inspections_org_isolation ON environmental_inspections
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE environmental_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE environmental_metrics FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS environmental_metrics_org_isolation ON environmental_metrics;
CREATE POLICY environmental_metrics_org_isolation ON environmental_metrics
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE environmental_permits ENABLE ROW LEVEL SECURITY;
ALTER TABLE environmental_permits FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS environmental_permits_org_isolation ON environmental_permits;
CREATE POLICY environmental_permits_org_isolation ON environmental_permits
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE environmental_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE environmental_reports FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS environmental_reports_org_isolation ON environmental_reports;
CREATE POLICY environmental_reports_org_isolation ON environmental_reports
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE expense_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_receipts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS expense_receipts_org_isolation ON expense_receipts;
CREATE POLICY expense_receipts_org_isolation ON expense_receipts
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::integer)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::integer);

ALTER TABLE external_partner_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_partner_agreements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS external_partner_agreements_org_isolation ON external_partner_agreements;
CREATE POLICY external_partner_agreements_org_isolation ON external_partner_agreements
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE external_partner_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_partner_assessments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS external_partner_assessments_org_isolation ON external_partner_assessments;
CREATE POLICY external_partner_assessments_org_isolation ON external_partner_assessments
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE external_partner_certifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_partner_certifications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS external_partner_certifications_org_isolation ON external_partner_certifications;
CREATE POLICY external_partner_certifications_org_isolation ON external_partner_certifications
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE external_partner_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_partner_incidents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS external_partner_incidents_org_isolation ON external_partner_incidents;
CREATE POLICY external_partner_incidents_org_isolation ON external_partner_incidents
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE external_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_partners FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS external_partners_org_isolation ON external_partners;
CREATE POLICY external_partners_org_isolation ON external_partners
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE facilities_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE facilities_assets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS facilities_assets_org_isolation ON facilities_assets;
CREATE POLICY facilities_assets_org_isolation ON facilities_assets
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE facilities_disposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE facilities_disposals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS facilities_disposals_org_isolation ON facilities_disposals;
CREATE POLICY facilities_disposals_org_isolation ON facilities_disposals
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE facilities_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE facilities_inspections FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS facilities_inspections_org_isolation ON facilities_inspections;
CREATE POLICY facilities_inspections_org_isolation ON facilities_inspections
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE facilities_maintenance_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE facilities_maintenance_links FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS facilities_maintenance_links_org_isolation ON facilities_maintenance_links;
CREATE POLICY facilities_maintenance_links_org_isolation ON facilities_maintenance_links
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE facilities_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE facilities_sites FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS facilities_sites_org_isolation ON facilities_sites;
CREATE POLICY facilities_sites_org_isolation ON facilities_sites
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE facilities_spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE facilities_spaces FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS facilities_spaces_org_isolation ON facilities_spaces;
CREATE POLICY facilities_spaces_org_isolation ON facilities_spaces
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE facilities_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE facilities_transfers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS facilities_transfers_org_isolation ON facilities_transfers;
CREATE POLICY facilities_transfers_org_isolation ON facilities_transfers
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE financial_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_budgets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS financial_budgets_org_isolation ON financial_budgets;
CREATE POLICY financial_budgets_org_isolation ON financial_budgets
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE financial_cash_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_cash_positions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS financial_cash_positions_org_isolation ON financial_cash_positions;
CREATE POLICY financial_cash_positions_org_isolation ON financial_cash_positions
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE financial_forecasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_forecasts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS financial_forecasts_org_isolation ON financial_forecasts;
CREATE POLICY financial_forecasts_org_isolation ON financial_forecasts
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE financial_funding_facilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_funding_facilities FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS financial_funding_facilities_org_isolation ON financial_funding_facilities;
CREATE POLICY financial_funding_facilities_org_isolation ON financial_funding_facilities
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE financial_scenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_scenarios FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS financial_scenarios_org_isolation ON financial_scenarios;
CREATE POLICY financial_scenarios_org_isolation ON financial_scenarios
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE governance_authority_validations ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance_authority_validations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS governance_authority_validations_org_isolation ON governance_authority_validations;
CREATE POLICY governance_authority_validations_org_isolation ON governance_authority_validations
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE governance_committees ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance_committees FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS governance_committees_org_isolation ON governance_committees;
CREATE POLICY governance_committees_org_isolation ON governance_committees
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE governance_conflicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance_conflicts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS governance_conflicts_org_isolation ON governance_conflicts;
CREATE POLICY governance_conflicts_org_isolation ON governance_conflicts
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE governance_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance_decisions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS governance_decisions_org_isolation ON governance_decisions;
CREATE POLICY governance_decisions_org_isolation ON governance_decisions
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE governance_delegations ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance_delegations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS governance_delegations_org_isolation ON governance_delegations;
CREATE POLICY governance_delegations_org_isolation ON governance_delegations
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE governance_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance_meetings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS governance_meetings_org_isolation ON governance_meetings;
CREATE POLICY governance_meetings_org_isolation ON governance_meetings
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE governance_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance_policies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS governance_policies_org_isolation ON governance_policies;
CREATE POLICY governance_policies_org_isolation ON governance_policies
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE governance_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance_units FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS governance_units_org_isolation ON governance_units;
CREATE POLICY governance_units_org_isolation ON governance_units
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE governed_document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE governed_document_versions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS governed_document_versions_org_isolation ON governed_document_versions;
CREATE POLICY governed_document_versions_org_isolation ON governed_document_versions
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE governed_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE governed_documents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS governed_documents_org_isolation ON governed_documents;
CREATE POLICY governed_documents_org_isolation ON governed_documents
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE institutional_risk_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE institutional_risk_links FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS institutional_risk_links_org_isolation ON institutional_risk_links;
CREATE POLICY institutional_risk_links_org_isolation ON institutional_risk_links
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE internal_audit_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal_audit_actions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS internal_audit_actions_org_isolation ON internal_audit_actions;
CREATE POLICY internal_audit_actions_org_isolation ON internal_audit_actions
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE internal_audit_engagements ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal_audit_engagements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS internal_audit_engagements_org_isolation ON internal_audit_engagements;
CREATE POLICY internal_audit_engagements_org_isolation ON internal_audit_engagements
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE internal_audit_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal_audit_findings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS internal_audit_findings_org_isolation ON internal_audit_findings;
CREATE POLICY internal_audit_findings_org_isolation ON internal_audit_findings
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE internal_audit_followups ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal_audit_followups FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS internal_audit_followups_org_isolation ON internal_audit_followups;
CREATE POLICY internal_audit_followups_org_isolation ON internal_audit_followups
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE internal_audit_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal_audit_programs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS internal_audit_programs_org_isolation ON internal_audit_programs;
CREATE POLICY internal_audit_programs_org_isolation ON internal_audit_programs
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE invoice_public_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_public_links FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invoice_public_links_org_isolation ON invoice_public_links;
CREATE POLICY invoice_public_links_org_isolation ON invoice_public_links
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::integer)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::integer);

ALTER TABLE ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_entries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ledger_entries_org_isolation ON ledger_entries;
CREATE POLICY ledger_entries_org_isolation ON ledger_entries
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::integer)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::integer);

ALTER TABLE ledger_maintenance_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_maintenance_audit FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ledger_maintenance_audit_org_isolation ON ledger_maintenance_audit;
CREATE POLICY ledger_maintenance_audit_org_isolation ON ledger_maintenance_audit
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE legal_compliance_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_compliance_assessments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS legal_compliance_assessments_org_isolation ON legal_compliance_assessments;
CREATE POLICY legal_compliance_assessments_org_isolation ON legal_compliance_assessments
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE legal_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_contracts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS legal_contracts_org_isolation ON legal_contracts;
CREATE POLICY legal_contracts_org_isolation ON legal_contracts
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE legal_matters ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_matters FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS legal_matters_org_isolation ON legal_matters;
CREATE POLICY legal_matters_org_isolation ON legal_matters
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE legal_obligations ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_obligations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS legal_obligations_org_isolation ON legal_obligations;
CREATE POLICY legal_obligations_org_isolation ON legal_obligations
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE legal_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_policies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS legal_policies_org_isolation ON legal_policies;
CREATE POLICY legal_policies_org_isolation ON legal_policies
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE legal_policy_acknowledgements ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_policy_acknowledgements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS legal_policy_acknowledgements_org_isolation ON legal_policy_acknowledgements;
CREATE POLICY legal_policy_acknowledgements_org_isolation ON legal_policy_acknowledgements
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE metrics_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE metrics_snapshot FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS metrics_snapshot_org_isolation ON metrics_snapshot;
CREATE POLICY metrics_snapshot_org_isolation ON metrics_snapshot
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::integer)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::integer);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notifications_org_isolation ON notifications;
CREATE POLICY notifications_org_isolation ON notifications
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::integer)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::integer);

ALTER TABLE organisation_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE organisation_modules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organisation_modules_org_isolation ON organisation_modules;
CREATE POLICY organisation_modules_org_isolation ON organisation_modules
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::integer)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::integer);

ALTER TABLE payment_reconciliation_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_reconciliation_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payment_reconciliation_logs_org_isolation ON payment_reconciliation_logs;
CREATE POLICY payment_reconciliation_logs_org_isolation ON payment_reconciliation_logs
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::integer)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::integer);

ALTER TABLE privacy_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_consents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS privacy_consents_org_isolation ON privacy_consents;
CREATE POLICY privacy_consents_org_isolation ON privacy_consents
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE privacy_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_incidents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS privacy_incidents_org_isolation ON privacy_incidents;
CREATE POLICY privacy_incidents_org_isolation ON privacy_incidents
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE privacy_processing_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_processing_activities FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS privacy_processing_activities_org_isolation ON privacy_processing_activities;
CREATE POLICY privacy_processing_activities_org_isolation ON privacy_processing_activities
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE privacy_retention_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_retention_actions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS privacy_retention_actions_org_isolation ON privacy_retention_actions;
CREATE POLICY privacy_retention_actions_org_isolation ON privacy_retention_actions
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE privacy_subject_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_subject_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS privacy_subject_requests_org_isolation ON privacy_subject_requests;
CREATE POLICY privacy_subject_requests_org_isolation ON privacy_subject_requests
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE procurement_finance_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_finance_links FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS procurement_finance_links_org_isolation ON procurement_finance_links;
CREATE POLICY procurement_finance_links_org_isolation ON procurement_finance_links
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE procurement_invoice_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_invoice_matches FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS procurement_invoice_matches_org_isolation ON procurement_invoice_matches;
CREATE POLICY procurement_invoice_matches_org_isolation ON procurement_invoice_matches
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE procurement_purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_purchase_orders FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS procurement_purchase_orders_org_isolation ON procurement_purchase_orders;
CREATE POLICY procurement_purchase_orders_org_isolation ON procurement_purchase_orders
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE procurement_quote_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_quote_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS procurement_quote_requests_org_isolation ON procurement_quote_requests;
CREATE POLICY procurement_quote_requests_org_isolation ON procurement_quote_requests
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE procurement_receipt_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_receipt_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS procurement_receipt_items_org_isolation ON procurement_receipt_items;
CREATE POLICY procurement_receipt_items_org_isolation ON procurement_receipt_items
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE procurement_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_receipts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS procurement_receipts_org_isolation ON procurement_receipts;
CREATE POLICY procurement_receipts_org_isolation ON procurement_receipts
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE procurement_requisition_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_requisition_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS procurement_requisition_items_org_isolation ON procurement_requisition_items;
CREATE POLICY procurement_requisition_items_org_isolation ON procurement_requisition_items
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE procurement_requisitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_requisitions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS procurement_requisitions_org_isolation ON procurement_requisitions;
CREATE POLICY procurement_requisitions_org_isolation ON procurement_requisitions
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE procurement_supplier_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_supplier_invoices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS procurement_supplier_invoices_org_isolation ON procurement_supplier_invoices;
CREATE POLICY procurement_supplier_invoices_org_isolation ON procurement_supplier_invoices
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE procurement_supplier_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_supplier_payments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS procurement_supplier_payments_org_isolation ON procurement_supplier_payments;
CREATE POLICY procurement_supplier_payments_org_isolation ON procurement_supplier_payments
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE procurement_supplier_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_supplier_performance FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS procurement_supplier_performance_org_isolation ON procurement_supplier_performance;
CREATE POLICY procurement_supplier_performance_org_isolation ON procurement_supplier_performance
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE procurement_supplier_qualifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_supplier_qualifications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS procurement_supplier_qualifications_org_isolation ON procurement_supplier_qualifications;
CREATE POLICY procurement_supplier_qualifications_org_isolation ON procurement_supplier_qualifications
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE procurement_supplier_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_supplier_quotes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS procurement_supplier_quotes_org_isolation ON procurement_supplier_quotes;
CREATE POLICY procurement_supplier_quotes_org_isolation ON procurement_supplier_quotes
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE quality_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_audits FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS quality_audits_org_isolation ON quality_audits;
CREATE POLICY quality_audits_org_isolation ON quality_audits
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE quality_control_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_control_plans FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS quality_control_plans_org_isolation ON quality_control_plans;
CREATE POLICY quality_control_plans_org_isolation ON quality_control_plans
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE quality_corrective_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_corrective_actions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS quality_corrective_actions_org_isolation ON quality_corrective_actions;
CREATE POLICY quality_corrective_actions_org_isolation ON quality_corrective_actions
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE quality_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_inspections FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS quality_inspections_org_isolation ON quality_inspections;
CREATE POLICY quality_inspections_org_isolation ON quality_inspections
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE quality_nonconformities ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_nonconformities FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS quality_nonconformities_org_isolation ON quality_nonconformities;
CREATE POLICY quality_nonconformities_org_isolation ON quality_nonconformities
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE recurring_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_invoices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS recurring_invoices_org_isolation ON recurring_invoices;
CREATE POLICY recurring_invoices_org_isolation ON recurring_invoices
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::integer)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::integer);

ALTER TABLE resilience_communications ENABLE ROW LEVEL SECURITY;
ALTER TABLE resilience_communications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS resilience_communications_org_isolation ON resilience_communications;
CREATE POLICY resilience_communications_org_isolation ON resilience_communications
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE resilience_crisis_cells ENABLE ROW LEVEL SECURITY;
ALTER TABLE resilience_crisis_cells FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS resilience_crisis_cells_org_isolation ON resilience_crisis_cells;
CREATE POLICY resilience_crisis_cells_org_isolation ON resilience_crisis_cells
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE resilience_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE resilience_decisions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS resilience_decisions_org_isolation ON resilience_decisions;
CREATE POLICY resilience_decisions_org_isolation ON resilience_decisions
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE resilience_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE resilience_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS resilience_events_org_isolation ON resilience_events;
CREATE POLICY resilience_events_org_isolation ON resilience_events
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE resilience_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE resilience_exercises FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS resilience_exercises_org_isolation ON resilience_exercises;
CREATE POLICY resilience_exercises_org_isolation ON resilience_exercises
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE resilience_improvements ENABLE ROW LEVEL SECURITY;
ALTER TABLE resilience_improvements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS resilience_improvements_org_isolation ON resilience_improvements;
CREATE POLICY resilience_improvements_org_isolation ON resilience_improvements
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE resilience_lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE resilience_lessons FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS resilience_lessons_org_isolation ON resilience_lessons;
CREATE POLICY resilience_lessons_org_isolation ON resilience_lessons
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE resilience_timeline ENABLE ROW LEVEL SECURITY;
ALTER TABLE resilience_timeline FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS resilience_timeline_org_isolation ON resilience_timeline;
CREATE POLICY resilience_timeline_org_isolation ON resilience_timeline
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE security_incidents_buffer_y2026m06 ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_incidents_buffer_y2026m06 FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS security_incidents_buffer_y2026m06_org_isolation ON security_incidents_buffer_y2026m06;
CREATE POLICY security_incidents_buffer_y2026m06_org_isolation ON security_incidents_buffer_y2026m06
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::integer)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::integer);

ALTER TABLE security_incidents_buffer_y2026m07 ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_incidents_buffer_y2026m07 FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS security_incidents_buffer_y2026m07_org_isolation ON security_incidents_buffer_y2026m07;
CREATE POLICY security_incidents_buffer_y2026m07_org_isolation ON security_incidents_buffer_y2026m07
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::integer)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::integer);

ALTER TABLE sst_corrective_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sst_corrective_actions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sst_corrective_actions_org_isolation ON sst_corrective_actions;
CREATE POLICY sst_corrective_actions_org_isolation ON sst_corrective_actions
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE sst_hazards ENABLE ROW LEVEL SECURITY;
ALTER TABLE sst_hazards FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sst_hazards_org_isolation ON sst_hazards;
CREATE POLICY sst_hazards_org_isolation ON sst_hazards
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE sst_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE sst_incidents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sst_incidents_org_isolation ON sst_incidents;
CREATE POLICY sst_incidents_org_isolation ON sst_incidents
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE sst_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE sst_inspections FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sst_inspections_org_isolation ON sst_inspections;
CREATE POLICY sst_inspections_org_isolation ON sst_inspections
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE sst_ppe_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE sst_ppe_assets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sst_ppe_assets_org_isolation ON sst_ppe_assets;
CREATE POLICY sst_ppe_assets_org_isolation ON sst_ppe_assets
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE sst_ppe_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE sst_ppe_inspections FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sst_ppe_inspections_org_isolation ON sst_ppe_inspections;
CREATE POLICY sst_ppe_inspections_org_isolation ON sst_ppe_inspections
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

-- Complément: 10 tables avaient déjà RLS activé mais sans FORCE — le
-- propriétaire de la table (rôle de connexion par défaut de nombreux
-- environnements) contournait silencieusement l'isolation. Détecté par
-- le test de garde organisationIsolationSchema.p0.test.js.
ALTER TABLE governance_approvals FORCE ROW LEVEL SECURITY;
ALTER TABLE governance_cases FORCE ROW LEVEL SECURITY;
ALTER TABLE governance_commands FORCE ROW LEVEL SECURITY;
ALTER TABLE governance_events FORCE ROW LEVEL SECURITY;
ALTER TABLE hr_departments FORCE ROW LEVEL SECURITY;
ALTER TABLE hr_performance_review_transitions FORCE ROW LEVEL SECURITY;
ALTER TABLE sst_emergency_drills FORCE ROW LEVEL SECURITY;
ALTER TABLE sst_emergency_plans FORCE ROW LEVEL SECURITY;
ALTER TABLE sst_incident_investigation_transitions FORCE ROW LEVEL SECURITY;
ALTER TABLE sst_training_assignment_transitions FORCE ROW LEVEL SECURITY;
-- Le trigger d'auto-provisionnement des modules par défaut (039_enabled_modules.sql)
-- insère dans organisation_modules pour une organisation qui vient tout juste
-- d'être créée: app.current_organisation_id n'est jamais celui de cette
-- nouvelle organisation à cet instant (la session appelante n'a en général
-- aucun contexte, ou celui d'une autre organisation). Puisque organisation_modules
-- est désormais sous FORCE ROW LEVEL SECURITY, le trigger doit explicitement
-- positionner son propre contexte sur l'organisation qu'il vient de créer
-- (NEW.id est connu et sûr) avant d'insérer, sinon toute création
-- d'organisation échoue avec "new row violates row-level security policy".
CREATE OR REPLACE FUNCTION enable_default_modules_for_new_org()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM set_config('app.current_organisation_id', NEW.id::text, true);

  INSERT INTO organisation_modules (organisation_id, module_key, is_active)
  VALUES
    (NEW.id, 'dashboard', true),
    (NEW.id, 'timesheet', true),
    (NEW.id, 'clients', true),
    (NEW.id, 'projects', true),
    (NEW.id, 'invoices', true),
    (NEW.id, 'reports', true),
    (NEW.id, 'kiosk_punch', true),
    (NEW.id, 'calcul_km', true),
    (NEW.id, 'kiosk_km', true),
    (NEW.id, 'estimates', true),
    (NEW.id, 'activity_intelligence', true),
    (NEW.id, 'billing_assistant', true)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
