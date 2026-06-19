const db = require("../../db");
const { getOrganisationId } = require("../utils/organisationScope");
const { renderEstimatePdf } = require("./estimatePdf.service");

class EstimateService {
  /**
   * Crée une soumission (estimate) et ses items.
   */
  async createEstimate(data) {
    const { organisationId, clientId, issueDate, validUntil, notes, taxRate = 0, items } = data;

    let totalAmount = 0;
    const mappedItems = items.map(item => {
      const amount = item.quantity * item.unit_rate;
      totalAmount += amount;
      return { ...item, amount };
    });

    const taxAmount = (totalAmount * taxRate) / 100;
    const finalTotal = totalAmount + taxAmount;

    // Generate estimate number
    const resultCount = await db.query(
      "SELECT COUNT(*) FROM estimates WHERE organisation_id = $1",
      [organisationId]
    );
    const count = parseInt(resultCount.rows[0].count, 10) + 1;
    const estimateNumber = `EST-${new Date().getFullYear()}-${count.toString().padStart(4, "0")}`;

    const client = await db.connect();
    try {
      await client.query("BEGIN");

      // Insert estimate
      const estimateRes = await client.query(
        `INSERT INTO estimates (
          organisation_id, client_id, estimate_number, status, 
          issue_date, valid_until, subtotal, tax_total, total, notes
        ) VALUES ($1, $2, $3, 'draft', $4, $5, $6, $7, $8, $9) RETURNING *`,
        [
          organisationId,
          clientId,
          estimateNumber,
          issueDate || null,
          validUntil || null,
          totalAmount,
          taxAmount,
          finalTotal,
          notes || null
        ]
      );
      const estimate = estimateRes.rows[0];

      // Insert items
      const savedItems = [];
      for (const item of mappedItems) {
        const itemRes = await client.query(
          `INSERT INTO estimate_items (
            organisation_id, estimate_id, description, quantity, unit_rate, amount
          ) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
          [
            organisationId,
            estimate.id,
            item.description,
            item.quantity,
            item.unit_rate,
            item.amount
          ]
        );
        savedItems.push(itemRes.rows[0]);
      }

      await client.query("COMMIT");
      return { ...estimate, items: savedItems };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Met à jour une soumission existante.
   */
  async updateEstimate(estimateId, organisationId, data) {
    const { status, issue_date, valid_until, notes } = data;

    const updates = [];
    const values = [estimateId, organisationId];
    let counter = 3;

    if (status !== undefined) {
      updates.push(`status = $${counter++}`);
      values.push(status);
    }
    if (issue_date !== undefined) {
      updates.push(`issue_date = $${counter++}`);
      values.push(issue_date);
    }
    if (valid_until !== undefined) {
      updates.push(`valid_until = $${counter++}`);
      values.push(valid_until);
    }
    if (notes !== undefined) {
      updates.push(`notes = $${counter++}`);
      values.push(notes);
    }

    if (updates.length === 0) return this.getEstimateById(estimateId, organisationId);

    const query = `
      UPDATE estimates 
      SET ${updates.join(", ")}
      WHERE id = $1 AND organisation_id = $2 AND deleted_at IS NULL
      RETURNING *
    `;

    const res = await db.query(query, values);
    return res.rows[0] || null;
  }

  /**
   * Liste les soumissions pour l'organisation courante.
   */
  async listEstimates({ organisationId, status, clientId }) {
    let query = `
      SELECT e.*, c.nom as client_nom 
      FROM estimates e
      JOIN clients c ON e.client_id = c.id
      WHERE e.organisation_id = $1 AND e.deleted_at IS NULL
    `;
    const values = [organisationId];
    let counter = 2;

    if (status) {
      query += ` AND e.status = $${counter++}`;
      values.push(status);
    }
    if (clientId) {
      query += ` AND e.client_id = $${counter++}`;
      values.push(clientId);
    }

    query += " ORDER BY e.created_at DESC";

    const res = await db.query(query, values);
    return res.rows;
  }

  /**
   * Récupère une soumission avec ses items.
   */
  async getEstimateById(estimateId, organisationId) {
    const estimateRes = await db.query(
      `SELECT e.*, c.nom as client_nom, c.email as client_email 
       FROM estimates e
       JOIN clients c ON e.client_id = c.id
       WHERE e.id = $1 AND e.organisation_id = $2 AND e.deleted_at IS NULL`,
      [estimateId, organisationId]
    );

    if (estimateRes.rows.length === 0) return null;
    const estimate = estimateRes.rows[0];

    const itemsRes = await db.query(
      `SELECT * FROM estimate_items WHERE estimate_id = $1 AND organisation_id = $2 ORDER BY id ASC`,
      [estimateId, organisationId]
    );

    estimate.items = itemsRes.rows;
    return estimate;
  }

  /**
   * Supprime une soumission de manière logique.
   */
  async deleteEstimate({ estimateId, organisationId }) {
    const res = await db.query(
      `UPDATE estimates 
       SET deleted_at = CURRENT_TIMESTAMP 
       WHERE id = $1 AND organisation_id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [estimateId, organisationId]
    );
    return res.rows[0] || null;
  }

  /**
   * Convertit une soumission en facture.
   */
  async convertToInvoice({ estimateId, organisationId, billedBy }) {
    const estimate = await this.getEstimateById(estimateId, organisationId);
    if (!estimate) {
      const err = new Error("Soumission introuvable.");
      err.statusCode = 404;
      throw err;
    }

    if (estimate.status !== "accepted") {
      const err = new Error("Seule une soumission acceptée peut être convertie en facture.");
      err.statusCode = 400;
      throw err;
    }

    const { getNextInvoiceNumber } = require("./invoice.service");

    const txClient = await db.pool.connect();
    try {
      await txClient.query("BEGIN");

      // 1. Mettre à jour la soumission en "invoiced"
      await txClient.query(
        `UPDATE estimates SET status = 'invoiced', updated_at = CURRENT_TIMESTAMP 
         WHERE id = $1 AND organisation_id = $2`,
        [estimateId, organisationId]
      );

      // 2. Générer le numéro de facture
      const invoiceNumber = await getNextInvoiceNumber(organisationId, txClient);
      const billedAt = new Date();

      // 3. Créer la facture avec le lien estimate_id
      const invoiceRes = await txClient.query(
        `
        INSERT INTO invoices (
          client_id, estimate_id, invoice_number, status, issue_date, due_date,
          subtotal, tax_total, total, notes, organisation_id, billed_at, billed_by
        ) VALUES ($1, $2, $3, 'draft', $4::date, NULL, $5, $6, $7, $8, $9, $10::timestamptz, $11)
        RETURNING *
        `,
        [
          estimate.client_id,
          estimate.id,
          invoiceNumber,
          new Date().toISOString().slice(0, 10),
          estimate.subtotal,
          estimate.tax_total,
          estimate.total,
          estimate.notes || null,
          organisationId,
          billedAt.toISOString(),
          billedBy,
        ]
      );

      const invoice = invoiceRes.rows[0];

      // 4. Copier les items de la soumission vers la facture
      if (estimate.items && estimate.items.length > 0) {
        const itemValues = [];
        const itemParams = [];
        let paramIdx = 1;

        for (const item of estimate.items) {
          itemValues.push(
            `($${paramIdx}, $${paramIdx + 1}, NULL, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5}, $${paramIdx + 6})`
          );

          itemParams.push(
            organisationId,
            invoice.id,
            item.description,
            item.quantity,
            item.unit_rate,
            item.amount,
            new Date().toISOString()
          );

          paramIdx += 7;
        }

        await txClient.query(
          `
          INSERT INTO invoice_items (
            organisation_id, invoice_id, time_entry_id, description,
            quantity, unit_rate, amount, created_at
          ) VALUES ${itemValues.join(", ")}
          `,
          itemParams
        );
      }

      await txClient.query("COMMIT");
      return invoice;
    } catch (err) {
      try {
        await txClient.query("ROLLBACK");
      } catch (_) {}
      throw err;
    } finally {
      txClient.release();
    }
  }
  /**
   * Génère le PDF d'une soumission.
   */
  async generateEstimatePdf({ estimateId, organisationId }) {
    const estimate = await this.getEstimateById(estimateId, organisationId);

    if (!estimate) {
      return null;
    }

    return {
      estimate,
      buffer: renderEstimatePdf(estimate),
    };
  }
}

module.exports = new EstimateService();
