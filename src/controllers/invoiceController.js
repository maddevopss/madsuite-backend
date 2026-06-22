const ApiResponse = require("../utils/apiResponse");

exports.createInvoice = async (req, res, next) => {
  const { client_id, entries_ids, number, total_ht } = req.body;

  try {
    await req.db.query("BEGIN");

    // 1. Créer la facture
    const invoiceRes = await req.db.query(
      `INSERT INTO invoices (organisation_id, client_id, number, total_ht, status)
       VALUES ($1, $2, $3, $4, 'draft')
       RETURNING id`,
      [req.organisationId, client_id, number, total_ht],
    );

    const invoiceId = invoiceRes.rows[0].id;

    // 2. Marquer les entrées de temps comme facturées
    // RLS garantit qu'on ne peut pas modifier les entrées d'un autre client/org
    await req.db.query(
      `UPDATE time_entries 
       SET is_billed = true, invoice_id = $1 
       WHERE id = ANY($2) AND organisation_id = $3`,
      [invoiceId, entries_ids, req.organisationId],
    );

    await req.db.query("COMMIT");
    return res.status(201).json(ApiResponse.success("INVOICE_CREATED", { id: invoiceId }));
  } catch (err) {
    await req.db.query("ROLLBACK");
    next(err);
  }
};

exports.getInvoices = async (req, res, next) => {
  try {
    const result = await req.db.query(
      `SELECT i.*, c.name as client_name 
       FROM invoices i
       JOIN clients c ON i.client_id = c.id
       WHERE i.organisation_id = $1
       ORDER BY i.created_at DESC`,
      [req.organisationId],
    );
    return res.status(200).json(ApiResponse.success("INVOICE_LISTED", result.rows));
  } catch (err) {
    next(err);
  }
};
