const express = require("express");
const router = express.Router();

const { requireOrganisation } = require("../middleware/organization.middleware");
const revenueController = require("../controllers/revenueController");

router.use(requireOrganisation);

router.get("/", revenueController.getDashboard);

module.exports = router;
