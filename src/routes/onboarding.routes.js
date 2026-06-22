const express = require("express");
const router = express.Router();
const db = require("../../db");
const { getOrganisationId } = require("../utils/organisationScope");
const { handleServiceError } = require("../utils/routeError");
const ApiResponse = require("../utils/apiResponse");

// Mark onboarding as complete and update organisation info
router.post("/setup", async (req, res, next) => {
  try {
    const organisationId = getOrganisationId(req);
    const { nom, address, taxNumbers } = req.body;

    // We assume the schema doesn't have "onboarding_completed" yet, 
    // so we'll check if the columns exist, or just update the existing JSON/fields
    // Since we need to alter the table, I will just update the nom and some settings
    
    // In our system, process.env is sometimes used for defaults, but we can store them in DB if columns exist
    // For now, update the name, address, tax_numbers if those columns exist. Let's use a safe query
    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");

      // Check if columns exist
      const addressColCheck = await client.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name='organisations' and column_name='adresse';
      `);

      if (addressColCheck.rowCount === 0) {
        await client.query(`ALTER TABLE organisations ADD COLUMN IF NOT EXISTS adresse TEXT;`);
        await client.query(`ALTER TABLE organisations ADD COLUMN IF NOT EXISTS tax_numbers TEXT;`);
        await client.query(`ALTER TABLE organisations ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT false;`);
      }

      await client.query(
        `UPDATE organisations 
         SET nom = COALESCE($1, nom), 
             adresse = COALESCE($2, adresse), 
             tax_numbers = COALESCE($3, tax_numbers),
             onboarding_completed = true
         WHERE id = $4`,
        [nom, address, taxNumbers, organisationId]
      );

      await client.query("COMMIT");
      return res.status(200).json(ApiResponse.success("ONBOARDING_COMPLETED"));
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    return handleServiceError(err, res, next);
  }
});

// Generate sample data
router.post("/sample-data", async (req, res, next) => {
  try {
    const organisationId = getOrganisationId(req);
    const userId = req.user.id;

    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");

      // 1. Create a demo client
      const clientRes = await client.query(
        `INSERT INTO clients (organisation_id, nom, email, hourly_rate_defaut) 
         VALUES ($1, 'Client Démo Inc.', 'demo@client.com', 120.00) RETURNING id`,
        [organisationId]
      );
      const clientId = clientRes.rows[0].id;

      // 2. Create a demo project
      const projRes = await client.query(
        `INSERT INTO projets (organisation_id, client_id, nom, taux_horaire, status) 
         VALUES ($1, $2, 'Refonte site web', 120.00, 'actif') RETURNING id`,
        [organisationId, clientId]
      );
      const projetId = projRes.rows[0].id;

      // 3. Create a demo estimate
      // Check if estimates table exists
      const estimatesCheck = await client.query(`
        SELECT table_name FROM information_schema.tables WHERE table_name='estimates'
      `);
      
      let estimateId = null;
      if (estimatesCheck.rowCount > 0) {
        const estRes = await client.query(
          `INSERT INTO estimates (organisation_id, client_id, estimate_number, status, subtotal, total) 
           VALUES ($1, $2, 'DEV-0001', 'draft', 1000.00, 1150.00) RETURNING id`,
          [organisationId, clientId]
        );
        estimateId = estRes.rows[0].id;

        // Insert items
        const estItemsCheck = await client.query(`
          SELECT table_name FROM information_schema.tables WHERE table_name='estimate_items'
        `);
        if (estItemsCheck.rowCount > 0) {
          await client.query(
            `INSERT INTO estimate_items (organisation_id, estimate_id, description, quantity, unit_rate, amount)
             VALUES ($1, $2, 'Design UX/UI', 10, 100.00, 1000.00)`,
            [organisationId, estimateId]
          );
        }
      }

      // 4. Create a demo invoice
      const invRes = await client.query(
        `INSERT INTO invoices (organisation_id, client_id, invoice_number, status, subtotal, total, issue_date, due_date) 
         VALUES ($1, $2, 'INV-0001', 'draft', 1000.00, 1150.00, CURRENT_DATE, CURRENT_DATE + INTERVAL '15 days') RETURNING id`,
        [organisationId, clientId]
      );
      const invoiceId = invRes.rows[0].id;

      await client.query(
        `INSERT INTO invoice_items (organisation_id, invoice_id, description, quantity, unit_rate, amount)
         VALUES ($1, $2, 'Design UX/UI', 10, 100.00, 1000.00)`,
        [organisationId, invoiceId]
      );

      await client.query("COMMIT");
      return res.status(200).json(ApiResponse.success("SAMPLE_DATA_CREATED"));
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    return handleServiceError(err, res, next);
  }
});

// Get onboarding status
router.get("/status", async (req, res, next) => {
  try {
    const organisationId = getOrganisationId(req);
    const orgRes = await db.query(
      `SELECT nom, 
              (SELECT column_name FROM information_schema.columns WHERE table_name='organisations' and column_name='onboarding_completed') as has_col
       FROM organisations WHERE id = $1`,
      [organisationId]
    );

    if (orgRes.rowCount === 0) {
      return res.json(ApiResponse.success("STATUS_FETCHED", { completed: true })); // default to true if not found to avoid lock
    }

    if (orgRes.rows[0].has_col) {
      const statusRes = await db.query(`SELECT onboarding_completed FROM organisations WHERE id = $1`, [organisationId]);
      return res.json(ApiResponse.success("STATUS_FETCHED", { completed: statusRes.rows[0].onboarding_completed }));
    }

    return res.json(ApiResponse.success("STATUS_FETCHED", { completed: true }));
  } catch (err) {
    return handleServiceError(err, res, next);
  }
});

// Get funnel status (for Phase 2 strictly guided onboarding)
router.get("/funnel-status", async (req, res, next) => {
  try {
    const organisationId = getOrganisationId(req);
    
    const clientsCount = await db.query("SELECT COUNT(*) FROM clients WHERE organisation_id = $1", [organisationId]);
    
    let estimatesCount = 0;
    const estCheck = await db.query(`SELECT table_name FROM information_schema.tables WHERE table_name='estimates'`);
    if (estCheck.rowCount > 0) {
      const estRes = await db.query("SELECT COUNT(*) FROM estimates WHERE organisation_id = $1", [organisationId]);
      estimatesCount = parseInt(estRes.rows[0].count, 10);
    }

    let invoicesCount = 0;
    const invCheck = await db.query(`SELECT table_name FROM information_schema.tables WHERE table_name='invoices'`);
    if (invCheck.rowCount > 0) {
      const invRes = await db.query("SELECT COUNT(*) FROM invoices WHERE organisation_id = $1", [organisationId]);
      invoicesCount = parseInt(invRes.rows[0].count, 10);
    }

    return res.json(ApiResponse.success("FUNNEL_STATUS", {
      hasClients: parseInt(clientsCount.rows[0].count, 10) > 0,
      hasEstimates: estimatesCount > 0,
      hasInvoices: invoicesCount > 0,
    }));
  } catch (err) {
    return handleServiceError(err, res, next);
  }
});

module.exports = router;
