const express = require("express");
const fs = require("fs");
const cookieParser = require("cookie-parser");
const corsOptions = require("./config/cors");
const helmet = require("helmet");
const path = require("path");
const pool = require("../db");
const { buildContentSecurityPolicy } = require("./config/security");
const swaggerUi = require("swagger-ui-express");
const yaml = require("yaml");
const ApiResponse = require("./utils/apiResponse");

const auth = require("./middleware/auth");
const errorHandler = require("./middleware/errorHandler");
const apiResponseMiddleware = require("./middleware/apiResponse");
const contractDeprecationMiddleware = require("./middleware/contractDeprecation.middleware");
const requestId = require("./middleware/requestId");
const requestLogger = require("./middleware/requestLogger");
const promBundle = require("express-prom-bundle");
const Sentry = require("@sentry/node");

const requestIdMiddleware = require("./middleware/requestId.middleware");
const { activityLimiter, loginLimiter, defaultLimiter } = require("./config/rateLimiters");

const loginRoutes = require("./routes/login");
const timesheetRoutes = require("./routes/timesheet");
const clientsRoutes = require("./routes/clients");
const dashboardRoutes = require("./routes/dashboard");
const projetsRoutes = require("./routes/projets");
const usersRoutes = require("./routes/users");
const reportsRoutes = require("./routes/reports");
const activityRoutes = require("./routes/activity");
const timerRoutes = require("./routes/timer");
const activityIntelligenceRoutes = require("./routes/activityIntelligence.routes");
const projectDetectionRoutes = require("./routes/projectDetection.routes");
const daySummaryRoutes = require("./routes/daySummary.routes");
const billingAssistantRoutes = require("./routes/billingAssistant.routes");
const invoicesRoutes = require("./routes/invoices.routes");
const billingDashboardRoutes = require("./routes/billingDashboard.routes");
const paymentRemindersRoutes = require("./routes/paymentReminders.routes");
const invoicePaymentsRoutes = require("./routes/invoicePayments.routes");
const estimatesRoutes = require("./routes/estimates.routes");
const quotesRoutes = require("./routes/quotes.routes");
const organisationRoutes = require("./routes/organisation");
const expensesRoutes = require("./routes/expenses.routes");
const expenseReceiptsRoutes = require("./routes/expenseReceipts.routes");
const stripeRoutes = require("./routes/stripe.routes");
const portalRoutes = require("./routes/portal.routes");
const punchRoutes = require("./routes/punch.routes");
const onboardingRoutes = require("./routes/onboarding.routes");
const revenueRoutes = require("./routes/revenue.routes");
const aiAssistantRoutes = require("./routes/aiAssistant.routes");
const modulesRoutes = require("./routes/modules.routes");
const hubRoutes = require("./routes/hub.routes");
const cognitiveRoutes = require("./routes/cognitive.routes");
const accountingRoutes = require("./routes/business/accounting.routes");
const suppliersRoutes = require("./routes/business/suppliers.routes");
const inventoryRoutes = require("./routes/business/inventory.routes");
const payrollRoutes = require("./routes/business/payroll.routes");
const payrollComplianceRoutes = require("./routes/business/payroll-compliance.routes");
const hrRoutes = require("./routes/business/hr.routes");
const sstRoutes = require("./routes/business/sst.routes");
const legalComplianceRoutes = require("./routes/business/legal-compliance.routes");
const documentProofRoutes = require("./routes/business/document-proof.routes");
const advancedDocumentGovernanceRoutes = require("./routes/business/advanced-document-governance.routes");
const externalPartnerManagementRoutes = require("./routes/business/external-partner-management.routes");
const institutionalResilienceRoutes = require("./routes/business/institutional-resilience.routes");
const assetMaintenanceRoutes = require("./routes/business/asset-maintenance.routes");
const procurementRoutes = require("./routes/business/procurement.routes");
const qualityRoutes = require("./routes/business/quality.routes");
const enterpriseRiskRoutes = require("./routes/business/enterprise-risk.routes");
const enterpriseBusinessContinuityRoutes = require("./routes/business/enterprise-business-continuity.routes");
const cybersecurityGovernanceRoutes = require("./routes/business/cybersecurity-governance.routes");
const dataPrivacyGovernanceRoutes = require("./routes/business/data-privacy-governance.routes");
const internalAuditRoutes = require("./routes/business/internal-audit.routes");
const organizationalPerformanceRoutes = require("./routes/business/organizational-performance.routes");
const organizationalGovernanceRoutes = require("./routes/business/organizational-governance.routes");
const advancedFinancialManagementRoutes = require("./routes/business/advanced-financial-management.routes");
const facilitiesManagementRoutes = require("./routes/business/facilities-management.routes");
const environmentalManagementRoutes = require("./routes/business/environmental-management.routes");
const decisionRoutes = require("./routes/business/decision.routes");
const continuityRoutes = require("./routes/business/continuity.routes");
const operationalIncidentsRoutes = require("./routes/business/operational-incidents.routes");
const notificationsRoutes = require("./routes/notifications.routes");
const analyticsRoutes = require("./routes/analytics.routes");
const exportRoutes = require("./integrations/export/export.routes");
const systemRoutes = require("./routes/system.routes");
const { requireOrganisation } = require("./middleware/organization.middleware");
const { createHealthRoutes } = require("./observability/healthRoutes");
const { createMetricsRoutes } = require("./observability/metricsRoutes");
const { createAlertingRoutes } = require("./observability/alertingRoutes");
const { createRunbooksRoutes } = require("./observability/runbooksRoutes");
const organisationsRoutes = require("./routes/organisations.routes");
const masterAdminRoutes = require("./routes/master-admin.routes");
const customerGrowthLeadsRoutes = require("./routes/customerGrowth/leads.routes");
const customerGrowthOpportunitiesRoutes = require("./routes/customerGrowth/opportunities.routes");
const customerGrowthActivitiesRoutes = require("./routes/customerGrowth/activities.routes");
const { requireModule } = require("./middleware/requireModule");

const compression = (() => {
  try {
    return require("compression");
  } catch {
    return () => (req, res, next) => next();
  }
})();

const app = express();

const metricsMiddleware = promBundle({
  includeMethod: true,
  includePath: true,
  customLabels: { project_name: "MADSuite" },
  promClient: {
    collectDefaultMetrics: {},
  },
});

app.use(metricsMiddleware);
app.use(requestIdMiddleware);
app.use(requestLogger);
app.use(
  helmet({
    contentSecurityPolicy: buildContentSecurityPolicy(),
  }),
);
app.use(compression());
app.use(cookieParser());
app.use(corsOptions);

// Routes Stripe et preuves d'achat binaires avant express.json().
// Webhook doit être monté AVANT express.json() avec express.raw()
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  stripeRoutes.webhookHandler
);

const swaggerDocument = yaml.parse(fs.readFileSync(path.join(__dirname, "../swagger.yaml"), "utf8"));
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));

app.use(express.json());
app.use(apiResponseMiddleware);

// Stage 4 Contract Versioning & Deprecation — adds headers for deprecated contracts
app.use(contractDeprecationMiddleware());

// Routes Stripe ordinaires après express.json()
app.use("/api/stripe", stripeRoutes.router);
app.use("/api/expenses", auth, requireModule("expenses"), expenseReceiptsRoutes);
app.use(express.static(path.join(__dirname, "../../frontend/build")));

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json(
      ApiResponse.success("HEALTH_OK", {
        status: "ok",
        database: "ok",
        environment: process.env.NODE_ENV || "development",
      }),
    );
  } catch {
    res.status(503).json(
      ApiResponse.error("HEALTH_UNAVAILABLE", {
        message: "Base de donnees indisponible.",
        status: "error",
        database: "unavailable",
        environment: process.env.NODE_ENV || "development",
      }),
    );
  }
});

// Routes publiques d'authentification.
// IMPORTANT : on limite seulement /api/login, pas tout /api.
app.use("/api/login", loginLimiter);

// Routes publiques du portail
app.use("/api/portal", defaultLimiter, portalRoutes);

// Routes Kiosque Punch Mobile (publiques, securisees par le kiosk_token)
app.use("/api/punch", defaultLimiter, punchRoutes);

// loginRoutes contient /login, /logout et /refresh.
// Donc on monte ensuite sur /api sans loginLimiter global.
app.use("/api", loginRoutes);

// Routes protégées avec limiter spécialisé.
// IMPORTANT : les écritures du desktop-agent sont fréquentes,
// mais les lectures du dashboard ne devraient pas être pénalisées.
app.use(
  "/api/activity",
  auth,
  (req, res, next) => {
    const readOnlyActivityRoutes = ["/summary", "/latest", "/recent"];

    const isReadOnlyActivityRoute = req.method === "GET" && readOnlyActivityRoutes.includes(req.path);

    if (isReadOnlyActivityRoute) {
      return defaultLimiter(req, res, next);
    }

    return activityLimiter(req, res, next);
  },
  activityRoutes,
);

// Rate limit par défaut pour les autres routes API protégées.
// En NODE_ENV=test, les limiters sont neutralisés dans rateLimiters.js.
// IMPORTANT: on exclut explicitement /api/activity pour éviter un doublon de limiters
// (un limiter est déjà monté spécifiquement sur /api/activity plus haut).
app.use("/api", (req, res, next) => {
  if (req.path.startsWith("/activity")) {
    return next();
  }
  return defaultLimiter(req, res, next);
});

// Routes protégées.

app.use("/api/timesheet", auth, timesheetRoutes);
app.use("/api/clients", auth, clientsRoutes);
app.use("/api/customer-growth/leads", auth, customerGrowthLeadsRoutes);
app.use("/api/customer-growth/opportunities", auth, customerGrowthOpportunitiesRoutes);
app.use("/api/customer-growth/activities", auth, customerGrowthActivitiesRoutes);
app.use("/api/dashboard", auth, dashboardRoutes);
app.use("/api/projets", auth, projetsRoutes);
app.use("/api/users", auth, usersRoutes);
app.use("/api/reports", auth, requireModule("reports"), reportsRoutes);
app.use("/api/timer", auth, timerRoutes);

app.use("/api/activity-intelligence", auth, requireModule("activity_intelligence"), activityIntelligenceRoutes);
app.use("/api/project-detection", auth, projectDetectionRoutes);
app.use("/api/day-summary", auth, daySummaryRoutes);
app.use("/api/billing-assistant", auth, requireModule("billing_assistant"), billingAssistantRoutes);
app.use("/api/invoices", auth, requireModule("invoices"), invoicesRoutes);
app.use("/api/billing", auth, requireModule("invoices"), billingDashboardRoutes);
app.use("/api/payment-reminders", auth, requireModule("invoices"), paymentRemindersRoutes);
app.use("/api/invoice-payments", auth, requireModule("invoices"), invoicePaymentsRoutes);
app.use("/api/revenue", auth, requireModule("invoices"), revenueRoutes);
app.use("/api/estimates", auth, requireModule("estimates"), estimatesRoutes);
app.use("/api/quotes", auth, requireModule("quotes"), quotesRoutes);
app.use("/api/expenses", auth, requireModule("expenses"), expensesRoutes);
app.use("/api/calendar", auth, require("./routes/calendar.routes"));
app.use("/api/ai-assistant", auth, aiAssistantRoutes);

app.use("/api/accounting", auth, requireModule("accounting"), accountingRoutes);
app.use("/api/suppliers", auth, requireModule("suppliers"), suppliersRoutes);
app.use("/api/inventory", auth, requireModule("inventory"), inventoryRoutes);
app.use("/api/payroll", auth, requireModule("payroll"), payrollRoutes);
app.use("/api/payroll-compliance", auth, requireModule("payroll"), payrollComplianceRoutes);
app.use("/api/hr", auth, requireModule("human_resources"), hrRoutes);
app.use("/api/sst", auth, requireModule("occupational_health_safety"), sstRoutes);
app.use("/api/legal", auth, requireModule("legal_compliance"), legalComplianceRoutes);
app.use("/api/documents", auth, requireModule("document_proof"), documentProofRoutes);
app.use("/api/document-governance", auth, requireModule("advanced_document_governance"), advancedDocumentGovernanceRoutes);
app.use("/api/partners", auth, requireModule("external_partner_management"), externalPartnerManagementRoutes);
app.use("/api/resilience", auth, requireModule("institutional_resilience"), institutionalResilienceRoutes);
app.use("/api/assets", auth, requireModule("asset_maintenance"), assetMaintenanceRoutes);
app.use("/api/procurement", auth, requireModule("procurement"), procurementRoutes);
app.use("/api/quality", auth, requireModule("quality_management"), qualityRoutes);
app.use("/api/risks", auth, requireModule("enterprise_risk"), enterpriseRiskRoutes);
app.use("/api/business-continuity", auth, requireModule("business_continuity"), enterpriseBusinessContinuityRoutes);
app.use("/api/cybersecurity", auth, requireModule("cybersecurity_governance"), cybersecurityGovernanceRoutes);
app.use("/api/privacy", auth, requireModule("data_privacy_governance"), dataPrivacyGovernanceRoutes);
app.use("/api/internal-audit", auth, requireModule("internal_audit"), internalAuditRoutes);
app.use("/api/performance", auth, requireModule("organizational_performance"), organizationalPerformanceRoutes);
app.use("/api/governance", auth, requireModule("organizational_governance"), organizationalGovernanceRoutes);
app.use("/api/finance", auth, requireModule("advanced_financial_management"), advancedFinancialManagementRoutes);
app.use("/api/facilities", auth, requireModule("facilities_management"), facilitiesManagementRoutes);
app.use("/api/environment", auth, requireModule("environmental_management"), environmentalManagementRoutes);
app.use("/api/decision", auth, requireModule("decision_dashboard"), decisionRoutes);
app.use("/api/continuity", auth, requireModule("cognitive_continuity"), continuityRoutes);
app.use("/api/operations/incidents", auth, requireModule("operational_incidents"), operationalIncidentsRoutes);

// Sensitive organisation/platform surfaces keep their internal guards too.
// Auth is repeated here intentionally so the route mount itself is never ambiguous in audits.
app.use("/api/organisation", auth, organisationRoutes);
app.use("/api/organisations", auth, organisationsRoutes);
app.use("/api/onboarding", auth, onboardingRoutes);
app.use("/api/organisation/modules", auth, modulesRoutes);
app.use("/api/hub", auth, hubRoutes);
app.use("/api/cognitive", auth, cognitiveRoutes);
app.use("/api/notifications", auth, notificationsRoutes);
app.use("/api/integrations/export", auth, exportRoutes);
app.use("/api/analytics", auth, analyticsRoutes);
app.use("/api/master-admin", auth, masterAdminRoutes);
app.use("/api/system", auth, systemRoutes);

// Stage 14 - Observability: health checks publics (probes infra), dashboards
// metrics/alerting/runbooks authentifies et scopes par organisation.
app.use("/api/observability", createHealthRoutes());
app.use("/api/observability", auth, requireOrganisation, createMetricsRoutes());
app.use("/api/observability", auth, requireOrganisation, createAlertingRoutes());
app.use("/api/observability", auth, requireOrganisation, createRunbooksRoutes());

// Routes API inconnues.
app.use("/api", (req, res) => {
  res.status(404).json(
    ApiResponse.error("ROUTE_NOT_FOUND", {
      message: "Route API introuvable.",
    }),
  );
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, "../../frontend/build/index.html"));
});

Sentry.setupExpressErrorHandler(app);

app.use(errorHandler);

module.exports = app;
