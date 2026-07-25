const router = require("express").Router();
const { requireOrganisation } = require("../../middleware/organization.middleware");

router.use(requireOrganisation);

router.post("/events", async (req, res, next) => {
  try {
    const { eventType, context = {} } = req.body;
    const { rows } = await req.db.query(
      `INSERT INTO cognitive_continuity_events
       (organisation_id, user_id, event_type, context)
       VALUES ($1,$2,$3,$4)
       RETURNING *`,
      [req.organisationId, req.user.id, eventType, context],
    );
    res.status(201).json({ event: rows[0] });
  } catch (error) {
    next(error);
  }
});

router.get("/recommendations", async (req, res, next) => {
  try {
    const { rows } = await req.db.query(
      `SELECT *
       FROM cognitive_assistance_recommendations
       WHERE organisation_id = $1
         AND user_id = $2
         AND status = 'active'
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY created_at DESC`,
      [req.organisationId, req.user.id],
    );
    res.json({ recommendations: rows });
  } catch (error) {
    next(error);
  }
});

router.patch("/recommendations/:id", async (req, res, next) => {
  try {
    const status = req.body.status;
    if (!["accepted", "dismissed"].includes(status)) {
      return res.status(400).json({ message: "Statut invalide." });
    }

    const { rows } = await req.db.query(
      `UPDATE cognitive_assistance_recommendations
       SET status = $1
       WHERE organisation_id = $2 AND user_id = $3 AND id = $4
       RETURNING *`,
      [status, req.organisationId, req.user.id, req.params.id],
    );
    return res.json({ recommendation: rows[0] || null });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
