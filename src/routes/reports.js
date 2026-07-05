const express = require("express");
const router = express.Router();

const requireRole = require("../middleware/requireRole");
const { requireOrganisation } = require("../middleware/organization.middleware");
const { getOrganisationId } = require("../utils/organisationScope");
const reportsService = require("../services/reports.service");
const timeEntriesService = require("../services/timesheet/timesheet.service");
const ApiResponse = require("../utils/apiResponse");
const CacheService = require("../services/cache.service");
const logger = require("../config/logger");

router.use(requireOrganisation);

const VALID_GROUP_BY = new Set(["week", "month"]);
const VALID_BILLED_FILTERS = new Set(["true", "false"]);

function isValidDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function parseReportDateRange({ dateDebut, dateFin }) {
  if (!isValidDate(dateDebut) || !isValidDate(dateFin)) {
    const err = new Error("Dates invalides. Format attendu: YYYY-MM-DD.");
    err.statusCode = 400;
    throw err;
  }

  if (String(dateDebut) > String(dateFin)) {
    const err = new Error("date_debut doit être avant ou égale à date_fin.");
    err.statusCode = 400;
    throw err;
  }

  return {
    dateDebut: String(dateDebut),
    dateFin: String(dateFin),
  };
}

function parseYear(rawYear) {
  const year = Number(rawYear || new Date().getFullYear());
  const currentYear = new Date().getFullYear();

  if (!Number.isInteger(year) || year < 2000 || year > currentYear + 1) {
    const err = new Error("Année invalide.");
    err.statusCode = 400;
    throw err;
  }

  return year;
}

function handleValidationError(err, res) {
  if (err.statusCode !== 400) return false;

  res.status(400).json(ApiResponse.error("VALIDATION_ERROR", {
    message: err.message,
  }));
  return true;
}

/**
 * GET /api/reports
 * Generate a custom report with date range and filters
 */
router.get("/", async (req, res, next) => {
  const requestId = req.id;

  logger.info(`[${requestId}] Generate report start`, {
    userId: req.user.id,
    organisationId: getOrganisationId(req),
  });

  try {
    const { date_debut: rawDateDebut, date_fin: rawDateFin, is_billed: isBilled, group_by: groupBy } = req.query;

    if (!rawDateDebut || !rawDateFin) {
      logger.warn(`[${requestId}] Missing date parameters`, {
        dateDebut: rawDateDebut,
        dateFin: rawDateFin,
      });

      return res.status(400).json(
        ApiResponse.error("VALIDATION_ERROR", {
          message: "Une date de debut et une date de fin sont obligatoires pour generer un rapport.",
        }),
      );
    }

    const { dateDebut, dateFin } = parseReportDateRange({ dateDebut: rawDateDebut, dateFin: rawDateFin });

    if (isBilled && !VALID_BILLED_FILTERS.has(String(isBilled))) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", { message: "is_billed invalide." }));
    }

    if (groupBy && !VALID_GROUP_BY.has(String(groupBy))) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", { message: "group_by invalide." }));
    }

    const report = await reportsService.generateReport({
      userId: req.user.id,
      role: req.user.role,
      organisationId: getOrganisationId(req),
      dateDebut,
      dateFin,
      isBilled,
      groupBy,
      requestId,
    });

    logger.info(`[${requestId}] Report generated successfully`, {
      rowCount: report.rows?.length || 0,
      totalHours: report.total?.heures,
    });

    return res.status(200).json(ApiResponse.success("REPORT_GENERATED", report));
  } catch (err) {
    if (handleValidationError(err, res)) return;

    logger.error(`[${requestId}] Generate report failed`, {
      error: err.message,
      stack: err.stack,
    });
    next(err);
  }
});

// Debug endpoints (dev only)
if (process.env.NODE_ENV !== "production") {
  /**
   * GET /api/reports/debug/time_entries
   * List all time entries for debugging (admin only)
   */
  router.get("/debug/time_entries", requireRole("admin"), async (req, res, next) => {
    const requestId = req.id;

    logger.info(`[${requestId}] Debug: List time entries`, {
      organisationId: getOrganisationId(req),
    });

    try {
      const rows = await reportsService.listDebugTimeEntries({
        organisationId: getOrganisationId(req),
        requestId,
      });

      logger.info(`[${requestId}] Debug: Time entries listed`, {
        count: rows.length,
      });

      return res.status(200).json(ApiResponse.success("DEBUG_TIME_ENTRIES_LISTED", rows));
    } catch (err) {
      logger.error(`[${requestId}] Debug: List time entries failed`, {
        error: err.message,
      });
      next(err);
    }
  });

  /**
   * GET /api/reports/debug/activity_logs
   * List active activity logs for debugging (admin only)
   */
  router.get("/debug/activity_logs", requireRole("admin"), async (req, res, next) => {
    const requestId = req.id;

    logger.info(`[${requestId}] Debug: List activity logs`, {
      organisationId: getOrganisationId(req),
      userId: req.user.id,
    });

    try {
      const rows = await reportsService.listDebugActivityLogs({
        organisationId: getOrganisationId(req),
        userId: req.user.id,
        type: "active",
        requestId,
      });

      logger.info(`[${requestId}] Debug: Activity logs listed`, {
        count: rows.length,
      });

      return res.status(200).json(ApiResponse.success("DEBUG_ACTIVITY_LOGS_LISTED", rows));
    } catch (err) {
      logger.error(`[${requestId}] Debug: List activity logs failed`, {
        error: err.message,
      });
      next(err);
    }
  });

  /**
   * GET /api/reports/debug/window_logs
   * List background window logs for debugging (admin only)
   */
  router.get("/debug/window_logs", requireRole("admin"), async (req, res, next) => {
    const requestId = req.id;

    logger.info(`[${requestId}] Debug: List window logs`, {
      organisationId: getOrganisationId(req),
      userId: req.user.id,
    });

    try {
      const rows = await reportsService.listDebugActivityLogs({
        organisationId: getOrganisationId(req),
        userId: req.user.id,
        type: "background",
        requestId,
      });

      logger.info(`[${requestId}] Debug: Window logs listed`, {
        count: rows.length,
      });

      return res.status(200).json(ApiResponse.success("DEBUG_WINDOW_LOGS_LISTED", rows));
    } catch (err) {
      logger.error(`[${requestId}] Debug: List window logs failed`, {
        error: err.message,
      });
      next(err);
    }
  });
}

/**
 * GET /api/reports/monthly-data
 * Get monthly data for dashboard with caching
 * Query params: year (optional, defaults to current year)
 */
router.get("/monthly-data", async (req, res, next) => {
  const requestId = req.id;

  try {
    const year = parseYear(req.query.year);
    const organisationId = getOrganisationId(req);

    // Generate cache key
    const cacheKey = CacheService.getCacheKey("reports:monthly", {
      year,
      organisationId,
    });

    // Check cache first
    let data = CacheService.get(cacheKey);
    if (data) {
      logger.info(`[${requestId}] Monthly data cache HIT`, {
        year,
        cacheKey,
      });

      return res.json({
        ...data,
        _cached: true,
        _cacheAge: "< 5 min",
      });
    }

    logger.info(`[${requestId}] Monthly data cache MISS, fetching from DB`, {
      year,
    });

    // Fetch from DB
    data = await reportsService.getMonthlyData({
      year,
      organisationId,
      requestId,
    });

    // Cache for 5 minutes
    CacheService.set(cacheKey, data, 300);

    logger.info(`[${requestId}] Monthly data cached`, {
      year,
      dataPoints: data.months?.length || 0,
    });

    return res.json({
      ...data,
      _cached: false,
      _cacheAge: null,
    });
  } catch (err) {
    if (handleValidationError(err, res)) return;

    logger.error(`[${requestId}] Monthly data fetch failed`, {
      error: err.message,
      stack: err.stack,
    });
    next(err);
  }
});

/**
 * GET /api/reports/daily-data
 * Get daily data for dashboard with caching
 * Query params: date (YYYY-MM-DD, optional, defaults to today)
 */
router.get("/daily-data", async (req, res, next) => {
  const requestId = req.id;

  try {
    const date = req.query.date || new Date().toISOString().split("T")[0];
    if (!isValidDate(date)) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", { message: "Date invalide." }));
    }

    const organisationId = getOrganisationId(req);

    // Generate cache key
    const cacheKey = CacheService.getCacheKey("reports:daily", {
      date,
      organisationId,
    });

    // Check cache first
    let data = CacheService.get(cacheKey);
    if (data) {
      logger.info(`[${requestId}] Daily data cache HIT`, {
        date,
        cacheKey,
      });

      return res.json({
        ...data,
        _cached: true,
        _cacheAge: "< 5 min",
      });
    }

    logger.info(`[${requestId}] Daily data cache MISS, fetching from DB`, {
      date,
    });

    // Fetch from DB
    data = await reportsService.getDailyData({
      date,
      organisationId,
      requestId,
    });

    // Cache for 5 minutes
    CacheService.set(cacheKey, data, 300);

    logger.info(`[${requestId}] Daily data cached`, {
      date,
      dataPoints: data.entries?.length || 0,
    });

    return res.json({
      ...data,
      _cached: false,
      _cacheAge: null,
    });
  } catch (err) {
    logger.error(`[${requestId}] Daily data fetch failed`, {
      error: err.message,
      stack: err.stack,
    });
    next(err);
  }
});

/**
 * PATCH /api/reports/time-entries/:id
 * Update time entry and invalidate related caches
 * NOTE: This should probably be in timeEntries.routes.js instead
 */
router.patch("/time-entries/:id", async (req, res, next) => {
  const requestId = req.id;

  logger.info(`[${requestId}] Update time entry start`, {
    entryId: req.params.id,
  });

  try {
    // Use timeEntriesService instead of undefined timeService
    const result = await timeEntriesService.updateTimeEntry({
      id: req.params.id,
      userId: req.user.id,
      organisationId: getOrganisationId(req),
      data: req.body,
      requestId,
    });

    if (!result) {
      logger.warn(`[${requestId}] Time entry not found`, {
        entryId: req.params.id,
      });

      return res.status(404).json(
        ApiResponse.error("NOT_FOUND", {
          message: "Time entry not found",
        }),
      );
    }

    // Invalidate related caches
    logger.info(`[${requestId}] Invalidating caches after entry update`, {
      patterns: ["reports:monthly", "reports:daily", "dashboard"],
    });

    CacheService.invalidate("reports:monthly");
    CacheService.invalidate("reports:daily");
    CacheService.invalidate("dashboard");

    logger.info(`[${requestId}] Time entry updated and caches cleared`, {
      entryId: result.id,
    });

    return res.json(ApiResponse.success("TIME_ENTRY_UPDATED", result));
  } catch (err) {
    logger.error(`[${requestId}] Update time entry failed`, {
      error: err.message,
      stack: err.stack,
    });
    next(err);
  }
});

module.exports = router;
