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
const estimatesRoutes = require("./routes/estimates.routes");
const organisationRoutes = require("./routes/organisation");
const expensesRoutes = require("./routes/expenses.routes");
const stripeRoutes = require("./routes/stripe.routes");
const portalRoutes = require("./routes/portal.routes");
const punchRoutes = require("./routes/punch.routes");
const aiAssistantRoutes = require("./routes/aiAssistant.routes");
const modulesRoutes = require("./routes/modules.routes");
const hubRoutes = require("./routes/hub.routes");
const { requireModule } = require("./middleware/requireModule");
let compression = null;

try {
  compression = require("compression");
} catch {
  compression = () => (req, res, next) => next();
}

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

// Routes Stripe doivent être avant express.json() pour le webhook
app.use("/api/stripe", stripeRoutes);
const swaggerDocument = yaml.load(path.join(__dirname, "../swagger.yaml"));
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));

app.use(express.json());
app.use(apiResponseMiddleware);
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
app.use("/api/estimates", auth, requireModule("estimates"), estimatesRoutes);
app.use("/api/expenses", auth, expensesRoutes);
app.use("/api/calendar", auth, require("./routes/calendar.routes"));
app.use("/api/ai-assistant", auth, aiAssistantRoutes);
app.use("/api/organisation", organisationRoutes);
app.use("/api/organisation/modules", modulesRoutes);
app.use("/api/hub", hubRoutes);
app.use("/api/master-admin", require("./routes/master-admin.routes"));

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
