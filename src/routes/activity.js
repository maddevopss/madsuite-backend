const express = require("express");

const { requireOrganisation } = require("../middleware/organization.middleware");
const activityReadRoutes = require("./activity.read.routes");
const activityWriteRoutes = require("./activity.write.routes");

const router = express.Router();

router.use(requireOrganisation);
router.use(activityReadRoutes);
router.use(activityWriteRoutes);

module.exports = router;
