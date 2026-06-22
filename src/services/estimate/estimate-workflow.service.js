const db = require("../../../db");
const { organisationValue } = require("../../utils/organisationScope");
const { getEstimateById } = require("./estimate-query.service");

// Note: Requires invoice.service to be passed or required dynamically to avoid circular dependencies
// if invoice.service also requires estimate.service
const invoiceService = require("../invoice/invoice.service");
const { createProject } = require("../projets.service");

/**
 * Convertit une soumission en facture.
 */
async function convertToInvoice({ estimateId, organisationId, billedBy, req }) {
  const estimate = await getEstimateById(estimateId, organisationId);
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

  const txClient = await db.pool.connect();
  try {
    await txClient.query("BEGIN");

    // 1. Mettre à jour la soumission en "invoiced"
    await txClient.query(
      `UPDATE estimates SET status = 'invoiced', updated_at = CURRENT_TIMESTAMP 
       WHERE id = $1 AND organisation_id = $2`,
      [estimateId, organisationValue(organisationId)]
    );

    // 2. Appeler le service de facturation pour créer la facture
    const invoice = await invoiceService.createInvoiceFromEstimate({
      estimate,
      organisationId,
      billedBy,
      req
    });

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
 * Convertit une soumission en Projet.
 */
async function convertToProject({ estimateId, organisationId }) {
  const estimate = await getEstimateById(estimateId, organisationId);
  if (!estimate) {
    const err = new Error("Soumission introuvable.");
    err.statusCode = 404;
    throw err;
  }

  if (estimate.status === "rejected" || estimate.status === "draft") {
    const err = new Error("La soumission doit d'abord être envoyée ou acceptée.");
    err.statusCode = 400;
    throw err;
  }

  let budgetHeures = 0;
  if (estimate.items) {
    budgetHeures = estimate.items.reduce((acc, item) => acc + Number(item.quantity || 0), 0);
  }

  const txClient = await db.pool.connect();
  try {
    await txClient.query("BEGIN");

    // 1. Marquer accepté
    await txClient.query(
      `UPDATE estimates SET status = 'accepted', updated_at = CURRENT_TIMESTAMP 
       WHERE id = $1 AND organisation_id = $2`,
      [estimateId, organisationValue(organisationId)]
    );

    await txClient.query("COMMIT");
    
    // 2. Créer le projet
    const project = await createProject({
      data: {
        client_id: estimate.client_id,
        nom: `Projet Soumission ${estimate.estimate_number}`,
        description: estimate.notes || `Généré depuis la soumission ${estimate.estimate_number}`,
        budget_hours: budgetHeures, // Mappe vers budget_hours (ou estimated_hours dépendant du front)
        taux_horaire: estimate.items && estimate.items.length > 0 ? estimate.items[0].unit_rate : 0,
        couleur: "#28a745"
      },
      organisationId
    });

    return project;
  } catch (err) {
    try { await txClient.query("ROLLBACK"); } catch (_) {}
    throw err;
  } finally {
    txClient.release();
  }
}

module.exports = {
  convertToInvoice,
  convertToProject
};
