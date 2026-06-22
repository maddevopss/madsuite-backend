const express = require("express");
const db = require("../../db");
const { requireOrganisation } = require("../middleware/organization.middleware");
const { getOrganisationId } = require("../utils/organisationScope");
const ApiResponse = require("../utils/apiResponse");

const router = express.Router();
router.use(requireOrganisation);

router.get("/", async (req, res, next) => {
  try {
    const organisationId = getOrganisationId(req);
    const userId = req.user.id;
    
    const { rows } = await db.query(`
      SELECT * FROM notifications
      WHERE organisation_id = $1 AND utilisateur_id = $2
      ORDER BY created_at DESC
      LIMIT 50
    `, [organisationId, userId]);

    return res.status(200).json(ApiResponse.success("NOTIFICATIONS_RETRIEVED", rows));
  } catch (err) {
    next(err);
  }
});

router.post("/:id/read", async (req, res, next) => {
  try {
    const organisationId = getOrganisationId(req);
    const userId = req.user.id;
    const notificationId = parseInt(req.params.id, 10);

    const { rows } = await db.query(`
      UPDATE notifications SET is_read = TRUE
      WHERE id = $1 AND organisation_id = $2 AND utilisateur_id = $3
      RETURNING *
    `, [notificationId, organisationId, userId]);

    return res.status(200).json(ApiResponse.success("NOTIFICATION_READ", rows[0] || null));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
