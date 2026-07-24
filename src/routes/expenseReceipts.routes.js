const express = require("express");
const ApiResponse = require("../utils/apiResponse");
const { requireOrganisation } = require("../middleware/organization.middleware");
const { getOrganisationId } = require("../utils/organisationScope");
const receiptService = require("../services/expenseReceipts.service");

const router = express.Router();
const rawReceipt = express.raw({
  type: ["application/pdf", "image/jpeg", "image/png"],
  limit: "5mb",
});

router.use(requireOrganisation);

router.put("/:id/receipt", rawReceipt, async (req, res, next) => {
  try {
    const mimeType = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    const filename = req.headers["x-file-name"];
    const receipt = await receiptService.saveReceipt({
      expenseId: req.params.id,
      organisationId: getOrganisationId(req),
      content: req.body,
      mimeType,
      filename,
    });
    return res.status(200).json(ApiResponse.success("EXPENSE_RECEIPT_SAVED", receipt));
  } catch (error) {
    next(error);
  }
});

router.get("/:id/receipt", async (req, res, next) => {
  try {
    const receipt = await receiptService.getReceipt({
      expenseId: req.params.id,
      organisationId: getOrganisationId(req),
    });
    if (!receipt) {
      return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Preuve d'achat introuvable" }));
    }
    res.setHeader("Content-Type", receipt.mime_type);
    res.setHeader("Content-Length", receipt.size_bytes);
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(receipt.filename)}`);
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(200).send(receipt.content);
  } catch (error) {
    next(error);
  }
});

router.delete("/:id/receipt", async (req, res, next) => {
  try {
    const deleted = await receiptService.deleteReceipt({
      expenseId: req.params.id,
      organisationId: getOrganisationId(req),
    });
    if (!deleted) {
      return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Preuve d'achat introuvable" }));
    }
    return res.status(200).json(ApiResponse.success("EXPENSE_RECEIPT_DELETED", { id: Number(req.params.id) }));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
