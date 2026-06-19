const ApiResponse = require("../utils/apiResponse");

/**
 * Récupère les entrées de temps avec jointure sur projet et client
 */
exports.getTimeEntries = async (req, res, next) => {
  try {
    const query = `
      SELECT te.*, p.name as projet_name, c.name as client_name
      FROM time_entries te
      LEFT JOIN projets p ON te.projet_id = p.id
      LEFT JOIN clients c ON p.client_id = c.id
      ORDER BY te.start_time DESC
      LIMIT 100
    `;

    const result = await req.db.query(query);
    return res.status(200).json(ApiResponse.success("TIME_ENTRY_LISTED", result.rows));
  } catch (err) {
    next(err);
  }
};

/**
 * Enregistre une nouvelle durée
 */
exports.createTimeEntry = async (req, res, next) => {
  const { projet_id, start_time, end_time, duration_seconds, note } = req.body;

  try {
    const result = await req.db.query(
      `INSERT INTO time_entries 
        (organisation_id, utilisateur_id, projet_id, start_time, end_time, duration_seconds, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [req.organisationId, req.user.id, projet_id, start_time, end_time, duration_seconds, note],
    );
    return res.status(201).json(ApiResponse.success("TIME_ENTRY_CREATED", result.rows[0]));
  } catch (err) {
    next(err);
  }
};
