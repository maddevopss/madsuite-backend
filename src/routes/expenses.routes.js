const express = require("express");
const router = express.Router();
const ApiResponse = require("../utils/apiResponse");

const { requireOrganisation } = require("../middleware/organization.middleware");
const { getOrganisationId } = require("../utils/organisationScope");
const expensesService = require("../services/expenses.service");

router.use(requireOrganisation);

router.get("/", async (req, res, next) => {
  try {
    const rows = await expensesService.listExpenses({
      organisationId: getOrganisationId(req),
      projetId: req.query.projetId,
    });
    return res.status(200).json(ApiResponse.success("EXPENSES_LISTED", rows));
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    // Basic validation
    if (!req.body.projet_id) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", { message: "projet_id requis" }));
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

router.put("/:id", async (req, res, next) => {
  try {
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
