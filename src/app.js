const express = require("express");
const cookieParser = require("cookie-parser");
const corsOptions = require("./config/cors");
const helmet = require("helmet");
const path = require("path");
const pool = require("../db");
const { buildContentSecurityPolicy } = require("./config/security");
const swaggerUi = require("swagger-ui-express");
const yaml = require("yamljs");
const ApiResponse = require("./utils/apiResponse");

const auth = require("./middleware/auth");
const errorHandler = require("./middleware/errorHandler");
const apiResponseMiddleware = require("./middleware/apiResponse");
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
const hrRoutes = require("./routes/business/hr.routes");
const sstRoutes = require("./routes/business/sst.routes");
const decisionRoutes = require("./routes/business/decision.routes");
const continuityRoutes = require("./routes/business/continuity.routes");
const notificationsRoutes = require("./routes/notifications.routes");
const analyticsRoutes = require("./routes/analytics.routes");
const exportRoutes = require("./integrations/export/export.routes");
const systemRoutes = require("./routes/system.routes");
const organisationsRoutes = require("./routes/organisations.routes");
const masterAdminRoutes = require("./routes/master-admin.routes");
const customerGrowthLeadsRoutes = require("./routes/customerGrowth/leads.routes");
const customerGrowthOpportunitiesRoutes = require("./routes/customerGrowth/opportunities.routes");
const customerGrowthActivitiesRoutes = require("./routes/customerGrowth/activities.routes");
const { requireModule } = require("./middleware/requireModule");

const compression = (() => {
  try { return require("compression"); } catch { return () => (req, res, next) => next(); }
})();

const app = express();
const metricsMiddleware = promBundle({ includeMethod: true, includePath: true, customLabels: { project_name: "MADSuite" }, promClient: { collectDefaultMetrics: {} } });
app.use(metricsMiddleware);
app.use(requestIdMiddleware);
app.use(requestLogger);
app.use(helmet({ contentSecurityPolicy: buildContentSecurityPolicy() }));
app.use(compression());
app.use(cookieParser());
app.use(corsOptions);

app.use("/api/stripe", stripeRoutes);
app.use("/api/expenses", auth, requireModule("expenses"), expenseReceiptsRoutes);
const swaggerDocument = yaml.load(path.join(__dirname, "../swagger.yaml"));
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));
app.use(express.json());
app.use(apiResponseMiddleware);
app.use(express.static(path.join(__dirname, "../../frontend/build")));

app.get("/api/health", async (req, res) => {
  try { await pool.query("SELECT 1"); res.json(ApiResponse.success("HEALTH_OK", { status: "ok", database: "ok", environment: process.env.NODE_ENV || "development" })); }
  catch { res.status(503).json(ApiResponse.error("HEALTH_UNAVAILABLE", { message: "Base de donnees indisponible.", status: "error", database: "unavailable", environment: process.env.NODE_ENV || "development" })); }
});

app.use("/api/login", loginLimiter);
app.use("/api/portal", defaultLimiter, portalRoutes);
app.use("/api/punch", defaultLimiter, punchRoutes);
app.use("/api", loginRoutes);

app.use("/api/activity", auth, (req, res, next) => {
  const readOnlyActivityRoutes = ["/summary", "/latest", "/recent"];
  if (req.method === "GET" && readOnlyActivityRoutes.includes(req.path)) return defaultLimiter(req, res, next);
  return activityLimiter(req, res, next);
}, activityRoutes);

app.use("/api", (req, res, next) => req.path.startsWith("/activity") ? next() : defaultLimiter(req, res, next));

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
app.use("/api/hr", auth, requireModule("human_resources"), hrRoutes);
app.use("/api/sst", auth, requireModule("occupational_health_safety"), sstRoutes);
app.use("/api/decision", auth, requireModule("decision_dashboard"), decisionRoutes);
app.use("/api/continuity", auth, requireModule("cognitive_continuity"), continuityRoutes);
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

app.use("/api", (req, res) => res.status(404).json(ApiResponse.error("ROUTE_NOT_FOUND", { message: "Route API introuvable." })));
app.use((req, res) => res.sendFile(path.join(__dirname, "../../frontend/build/index.html")));
Sentry.setupExpressErrorHandler(app);
app.use(errorHandler);
module.exports = app;
