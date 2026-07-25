const express = require("express");
const router = express.Router();
const ApiResponse = require("../utils/apiResponse");

const { requireOrganisation } = require("../middleware/organization.middleware");
const { getOrganisationId } = require("../utils/organisationScope");
const expensesService = require("../services/expenses.service");
const accountingPostingService = require("../services/business/accounting-posting.service");

const CATEGORY_PATTERN = /^[a-z0-9_-]{2,50}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

router.use(requireOrganisation);

function validationError(res, message, fields = {}) {
  return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", { message, fields }));
}

function requireAdmin(req, res) {
  if (req.user?.role !== "admin") {
    res.status(403).json(ApiResponse.error("FORBIDDEN", { message: "Permissions insuffisantes" }));
    return false;
  }
  return true;
}

function validateExpensePayload(body, { partial = false } = {}) {
  const errors = {};
  const has = (field) => Object.prototype.hasOwnProperty.call(body, field);

  if (!partial || has("amount")) {
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount < 0) errors.amount = "Montant invalide";
  }
  if (!partial || has("tax_amount")) {
    const tax = Number(body.tax_amount ?? 0);
    if (!Number.isFinite(tax) || tax < 0) errors.tax_amount = "Taxes invalides";
  }
  if (has("total_amount")) {
    const total = Number(body.total_amount);
    if (!Number.isFinite(total) || total < 0) errors.total_amount = "Total invalide";
  }
  if (!partial || has("category")) {
    const category = String(body.category || "general").trim().toLowerCase();
    if (!CATEGORY_PATTERN.test(category)) errors.category = "Catégorie invalide";
  }
  if (!partial || has("expense_date")) {
    const date = body.expense_date || new Date().toISOString().slice(0, 10);
    if (!DATE_PATTERN.test(String(date))) errors.expense_date = "Date invalide";
  }
  if (!partial || has("currency")) {
    const currency = String(body.currency || "CAD").trim().toUpperCase();
    if (!CURRENCY_PATTERN.test(currency)) errors.currency = "Devise invalide";
  }
  if (has("supplier") && body.supplier != null && String(body.supplier).trim().length > 160) {
    errors.supplier = "Fournisseur trop long";
  }

  return errors;
}

router.get("/", async (req, res, next) => {
  try {
    const result = await expensesService.listExpenses({
      organisationId: getOrganisationId(req),
      projetId: req.query.projetId,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      category: req.query.category,
      supplier: req.query.supplier,
      limit: req.query.limit,
      offset: req.query.offset,
      sort: req.query.sort,
    });
    return res.status(200).json(ApiResponse.success("EXPENSES_LISTED", result));
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const expense = await expensesService.getExpenseById({
      expenseId: req.params.id,
      organisationId: getOrganisationId(req),
    });
    if (!expense) {
      return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Dépense introuvable" }));
    }
    return res.status(200).json(ApiResponse.success("EXPENSE_FOUND", expense));
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const errors = validateExpensePayload(req.body);
    if (Object.keys(errors).length) {
      return validationError(res, "La dépense contient des données invalides.", errors);
    }

    const expense = await expensesService.createExpense({
      data: req.body,
      organisationId: getOrganisationId(req),
    });
    return res.status(201).json(ApiResponse.success("EXPENSE_CREATED", expense));
  } catch (err) {
    next(err);
  }
});

router.post("/:id/post", async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return;
    const result = await accountingPostingService.postExpense({
      expenseId: req.params.id,
      organisationId: getOrganisationId(req),
      createdBy: req.user?.id,
    });
    if (!result) {
      return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Dépense introuvable" }));
    }
    return res.status(result.duplicate ? 200 : 201).json(ApiResponse.success(
      result.duplicate ? "EXPENSE_ACCOUNTING_DUPLICATE" : "EXPENSE_ACCOUNTING_POSTED",
      result,
    ));
  } catch (err) {
    next(err);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const errors = validateExpensePayload(req.body, { partial: true });
    if (Object.keys(errors).length) {
      return validationError(res, "La dépense contient des données invalides.", errors);
    }

    const expense = await expensesService.updateExpense({
      expenseId: req.params.id,
      data: req.body,
      organisationId: getOrganisationId(req),
    });

    if (!expense) {
      return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Dépense introuvable" }));
    }

    return res.status(200).json(ApiResponse.success("EXPENSE_UPDATED", expense));
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const deleted = await expensesService.deleteExpense({
      expenseId: req.params.id,
      organisationId: getOrganisationId(req),
    });

    if (!deleted) {
      return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Dépense introuvable" }));
    }

    return res.status(200).json(ApiResponse.success("EXPENSE_DELETED", { id: deleted.id }));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
