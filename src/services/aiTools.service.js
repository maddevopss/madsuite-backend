const db = require("../../db");
const logger = require("../config/logger");
const emailService = require("./email.service");
const clientsService = require("./clients.service");
const projetsService = require("./projets.service");
const invoiceService = require("./invoice/invoice.service");
const { recordBusinessAudit } = require("./auditLog.service");

const AI_WRITE_TOOLS_ENABLED = process.env.AI_WRITE_TOOLS_ENABLED === "1";
const WRITE_TOOLS = ["create_client", "create_project", "create_invoice", "send_invoice_reminders"];

const READ_ONLY_TOOLS_SCHEMA = [
  {
    type: "function",
    function: {
      name: "get_unpaid_invoices",
      description: "Obtient le nombre total et la liste détaillée des factures impayées ou en retard.",
      parameters: { type: "object", properties: {}, required: [] }
    }
  },
  {
    type: "function",
    function: {
      name: "get_top_clients",
      description: "Obtient la liste des meilleurs clients basés sur les revenus générés.",
      parameters: { type: "object", properties: {}, required: [] }
    }
  },
  {
    type: "function",
    function: {
      name: "get_monthly_revenue",
      description: "Obtient le total facturé pour le mois en cours.",
      parameters: { type: "object", properties: {}, required: [] }
    }
  },
  {
    type: "function",
    function: {
      name: "get_projects_summary",
      description: "Obtient un résumé des projets actifs.",
      parameters: { type: "object", properties: {}, required: [] }
    }
  },
  {
    type: "function",
    function: {
      name: "search_clients",
      description: "Recherche un client par nom pour obtenir son identifiant (ID).",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" }
        },
        required: ["name"]
      }
    }
  }
];

const WRITE_TOOLS_SCHEMA = [
  {
    type: "function",
    function: {
      name: "create_client",
      description: "Crée un nouveau client dans le système.",
      parameters: {
        type: "object",
        properties: {
          nom: { type: "string" },
          email: { type: "string" },
          phone: { type: "string" }
        },
        required: ["nom"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "create_project",
      description: "Crée un nouveau projet pour un client.",
      parameters: {
        type: "object",
        properties: {
          client_id: { type: "number" },
          nom: { type: "string" },
          budget: { type: "number" },
          taux_horaire: { type: "number" }
        },
        required: ["client_id", "nom"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "create_invoice",
      description: "Génère une facture pour un client (statut 'draft').",
      parameters: {
        type: "object",
        properties: {
          client_id: { type: "number" },
          amount: { type: "number" },
          notes: { type: "string" }
        },
        required: ["client_id", "amount"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "send_invoice_reminders",
      description: "Envoie un courriel de relance pour une liste de factures données.",
      parameters: {
        type: "object",
        properties: {
          invoice_ids: { type: "array", items: { type: "number" } }
        },
        required: ["invoice_ids"]
      }
    }
  }
];

/**
 * Définit la configuration des outils (Function Calling) pour OpenAI.
 * Par défaut, le Copilot est en lecture seule. Les outils d'écriture doivent être activés explicitement.
 */
const getToolsSchema = () => {
  if (!AI_WRITE_TOOLS_ENABLED) {
    return READ_ONLY_TOOLS_SCHEMA;
  }

  return [...READ_ONLY_TOOLS_SCHEMA, ...WRITE_TOOLS_SCHEMA];
};

async function executeToolCall(toolCall, organisationId) {
  const functionName = toolCall.function.name;
  let args = {};

  if (toolCall.function.arguments) {
    try {
      args = JSON.parse(toolCall.function.arguments);
    } catch (e) {
      logger.error("Erreur de parsing des arguments de l'outil IA", e);
    }
  }

  const isWriteTool = WRITE_TOOLS.includes(functionName);

  if (isWriteTool && !AI_WRITE_TOOLS_ENABLED) {
    return {
      success: false,
      error: "Les actions d'écriture du Copilot sont désactivées. Présentez plutôt un brouillon ou des étapes à valider."
    };
  }

  try {
    let result;
    switch (functionName) {
      case "get_unpaid_invoices": result = await getUnpaidInvoices(organisationId); break;
      case "get_top_clients": result = await getTopClients(organisationId); break;
      case "get_monthly_revenue": result = await getMonthlyRevenue(organisationId); break;
      case "get_projects_summary": result = await getProjectsSummary(organisationId); break;
      case "search_clients": result = await searchClients(organisationId, args.name); break;
      case "create_client": result = await createClientTool(organisationId, args); break;
      case "create_project": result = await createProjectTool(organisationId, args); break;
      case "create_invoice": result = await createInvoiceTool(organisationId, args); break;
      case "send_invoice_reminders": result = await sendInvoiceRemindersTool(organisationId, args.invoice_ids); break;
      default: return { error: `L'outil ${functionName} n'est pas reconnu.` };
    }

    // Audit trail pour toutes les actions en écriture de l'IA (non-bloquant).
    if (isWriteTool) {
      recordBusinessAudit({
        organisationId,
        actorUserId: null, // Action IA — pas d'utilisateur direct
        action: `ai_copilot.${functionName}`,
        entityType: "ai_tool",
        entityId: null,
        details: { args, result: result?.success ? "success" : "unknown" },
        req: null,
      }).catch((e) => logger.warn("Audit trail IA échoué (non-bloquant)", { error: e.message, functionName }));
    }

    return result;
  } catch (error) {
    logger.error(`Erreur lors de l'exécution de l'outil IA ${functionName}`, error);
    return { error: `Erreur: ${error.message}` };
  }
}

// ------------------------------------------------------------------
// Read-only functions
// ------------------------------------------------------------------

async function getUnpaidInvoices(organisationId) {
  const result = await db.query(
    `SELECT i.id, i.invoice_number, i.total, i.due_date, c.nom as client_nom,
            CASE WHEN i.due_date < CURRENT_DATE THEN true ELSE false END as is_overdue
     FROM invoices i 
     JOIN clients c ON i.client_id = c.id 
     WHERE i.organisation_id = $1 
       AND i.status = 'sent' 
       AND i.deleted_at IS NULL
     ORDER BY i.due_date ASC`,
    [organisationId]
  );
  const totalAmount = result.rows.reduce((sum, inv) => sum + parseFloat(inv.total), 0);
  return { count: result.rows.length, total_amount: totalAmount, invoices: result.rows };
}

async function getTopClients(organisationId) {
  const result = await db.query(
    `SELECT c.nom, COUNT(i.id) as invoice_count, COALESCE(SUM(i.total), 0) as total_revenue
     FROM clients c
     LEFT JOIN invoices i ON c.id = i.client_id AND i.status IN ('sent', 'paid') AND i.deleted_at IS NULL
     WHERE c.organisation_id = $1 AND c.deleted_at IS NULL
     GROUP BY c.id, c.nom
     ORDER BY total_revenue DESC
     LIMIT 5`,
    [organisationId]
  );
  return result.rows;
}

async function getMonthlyRevenue(organisationId) {
  const result = await db.query(
    `SELECT COALESCE(SUM(total), 0) as total_revenue
     FROM invoices 
     WHERE organisation_id = $1 AND status IN ('sent', 'paid') AND deleted_at IS NULL
       AND date_trunc('month', issue_date) = date_trunc('month', CURRENT_DATE)`,
    [organisationId]
  );
  return { month: new Date().toLocaleString('default', { month: 'long' }), revenue: parseFloat(result.rows[0].total_revenue) };
}

async function getProjectsSummary(organisationId) {
  const result = await db.query(
    `SELECT p.nom, p.budget, p.taux_horaire, COALESCE(SUM(te.duration_seconds), 0) / 3600.0 as hours_worked
     FROM projets p
     LEFT JOIN time_entries te ON p.id = te.projet_id AND te.deleted_at IS NULL AND te.end_time IS NOT NULL
     WHERE p.organisation_id = $1 AND p.deleted_at IS NULL
     GROUP BY p.id, p.nom, p.budget, p.taux_horaire
     ORDER BY hours_worked DESC LIMIT 10`,
    [organisationId]
  );
  return result.rows;
}

async function searchClients(organisationId, name) {
  if (!name) return { error: "Le nom est requis." };
  const result = await db.query(
    `SELECT id, nom, email FROM clients WHERE organisation_id = $1 AND deleted_at IS NULL AND nom ILIKE $2 LIMIT 5`,
    [organisationId, `%${name}%`]
  );
  return result.rows.length === 0 ? { message: `Aucun client trouvé.` } : result.rows;
}

// ------------------------------------------------------------------
// Executable functions
// ------------------------------------------------------------------

async function createClientTool(organisationId, args) {
  const client = await clientsService.createClient({ data: args, organisationId });
  return { success: true, message: `Client '${client.nom}' créé avec l'ID ${client.id}.`, client };
}

async function createProjectTool(organisationId, args) {
  const project = await projetsService.createProject({ data: args, organisationId });
  return { success: true, message: `Projet '${project.nom}' créé avec l'ID ${project.id}.`, project };
}

async function createInvoiceTool(organisationId, args) {
  const { client_id, amount, notes } = args;
  const clientTx = await db.pool.connect();
  try {
    await clientTx.query("BEGIN");
    const invoiceNumber = await invoiceService.getNextInvoiceNumber(organisationId, clientTx);
    const subtotal = parseFloat(amount);
    
    const invoiceResult = await clientTx.query(
      `INSERT INTO invoices
        (client_id, invoice_number, status, issue_date, due_date, subtotal, tax_total, total, notes, organisation_id, billed_at)
       VALUES ($1, $2, 'draft', CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days', $3, 0, $3, $4, $5, NOW())
       RETURNING *`,
      [client_id, invoiceNumber, subtotal, notes || "Généré par l'Assistant MADSuite", organisationId]
    );
    
    const invoice = invoiceResult.rows[0];
    await clientTx.query(
      `INSERT INTO invoice_items
        (organisation_id, invoice_id, description, quantity, unit_rate, amount, created_at)
       VALUES ($1, $2, 'Services (Assistant IA)', 1, $3, $3, NOW())`,
      [organisationId, invoice.id, subtotal]
    );
    
    await clientTx.query("COMMIT");
    return { success: true, message: `Facture ${invoiceNumber} générée avec succès.`, invoice };
  } catch (err) {
    await clientTx.query("ROLLBACK");
    throw err;
  } finally {
    clientTx.release();
  }
}

async function sendInvoiceRemindersTool(organisationId, invoiceIds) {
  if (!invoiceIds || invoiceIds.length === 0) return { success: false, message: "Aucune facture." };
  const result = await db.query(
    `SELECT i.*, c.email as client_email, c.nom as client_nom FROM invoices i JOIN clients c ON i.client_id = c.id
     WHERE i.organisation_id = $1 AND i.id = ANY($2) AND i.deleted_at IS NULL`,
    [organisationId, invoiceIds]
  );
  const sentTo = [];
  for (const invoice of result.rows) {
    if (invoice.client_email) {
      await emailService.sendInvoiceReminder(invoice.client_email, invoice);
      sentTo.push({ invoice: invoice.invoice_number, email: invoice.client_email });
    }
  }
  return { success: true, sent_to: sentTo };
}

module.exports = {
  getToolsSchema,
  executeToolCall
};
