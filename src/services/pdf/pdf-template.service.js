const jspdfAutotable = require("jspdf-autotable");
const autoTable = jspdfAutotable.autoTable || jspdfAutotable.default || jspdfAutotable;

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString("fr-CA") : "-";
}

function formatMoney(value, currency = "CAD") {
  return `${Number(value || 0).toFixed(2)} ${currency}`;
}

function buildInvoiceTableData(invoice, branding) {
  return invoice.items.map((item) => [
    item.description || "-",
    item.projet_nom || "-",
    item.quantity ? Number(item.quantity).toFixed(2) : "0.00",
    formatMoney(item.unit_rate, branding.currency),
    formatMoney(item.amount, branding.currency),
  ]);
}

function addInvoiceHeader(doc, invoice, branding) {
  // Bandeau supérieur avec couleur de marque
  doc.setFillColor(...branding.color);
  doc.rect(0, 0, 210, 40, "F");

  // Titre
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(28);
  doc.setFont(undefined, "bold");
  doc.text("FACTURE", 14, 25);

  // Nom de l'entreprise (en haut à droite)
  doc.setFontSize(16);
  doc.text(branding.name, 196, 20, { align: "right" });
  
  // Info contact entreprise
  doc.setFontSize(10);
  doc.setFont(undefined, "normal");
  let brandY = 26;
  [branding.address, branding.email, branding.phone].filter(Boolean).forEach((line) => {
    doc.text(String(line), 196, brandY, { align: "right" });
    brandY += 5;
  });

  // Retour au texte normal
  doc.setTextColor(40, 40, 40);

  // Détails de la facture
  doc.setFontSize(11);
  doc.setFont(undefined, "bold");
  doc.text("DÉTAILS DE LA FACTURE", 14, 55);
  doc.setFont(undefined, "normal");
  doc.setFontSize(10);
  doc.text(`Facture #: ${invoice.invoice_number}`, 14, 62);
  doc.text(`Date d'émission: ${formatDate(invoice.issue_date)}`, 14, 68);
  if (invoice.due_date) {
    doc.text(`Date d'échéance: ${formatDate(invoice.due_date)}`, 14, 74);
  }
  
  // Détails du client
  doc.setFontSize(11);
  doc.setFont(undefined, "bold");
  doc.text("FACTURÉ À", 120, 55);
  doc.setFont(undefined, "normal");
  doc.setFontSize(10);
  doc.text(invoice.client_nom || "-", 120, 62);
  if (invoice.client_email) doc.text(invoice.client_email, 120, 68);
  if (invoice.client_phone) doc.text(invoice.client_phone, 120, 74);
  
  // Ligne de séparation
  doc.setDrawColor(220, 220, 220);
  doc.line(14, 82, 196, 82);
}

function addInvoiceItemsTable(doc, invoice, branding) {
  autoTable(doc, {
    startY: 88,
    tableWidth: 180,
    head: [["Description", "Projet", "Qté", "Taux", "Montant"]],
    body: buildInvoiceTableData(invoice, branding),
    foot: [["TOTAL", "", "", "", formatMoney(invoice.total, branding.currency)]],
    styles: { fontSize: 8 },
    headStyles: { fillColor: branding.color },
    footStyles: { fillColor: [230, 230, 230], fontStyle: "bold", textColor: [40,40,40] },
    columnStyles: {
      0: { cellWidth: 55 },
      1: { cellWidth: 40 },
      2: { cellWidth: 25, halign: "right" },
      3: { cellWidth: 30, halign: "right" },
      4: { cellWidth: 30, halign: "right" },
    },
  });
}

function addInvoiceTotals(doc, invoice, branding, organisation) {
  const finalY = doc.lastAutoTable.finalY + 10;
  const subtotal = Number(invoice.subtotal || 0);
  const taxRate = subtotal > 0 ? (Number(invoice.tax_total || 0) / subtotal) * 100 : 0;
  const isQuebecStandard = taxRate >= 14.9 && taxRate <= 15.0; // Approximation pour 14.975%

  const totalXOffset = 130;
  
  // Fond gris léger pour la zone des totaux
  doc.setFillColor(249, 250, 251);
  doc.rect(125, finalY - 5, 75, 45, "F");

  doc.setFontSize(10);
  doc.setTextColor(60, 60, 60);
  doc.text("Sous-total:", totalXOffset, finalY);
  doc.text(formatMoney(invoice.subtotal, branding.currency), 190, finalY, { align: "right" });

  let currentTotalY = finalY + 8;

  if (isQuebecStandard) {
    const tps = subtotal * 0.05;
    const tvq = subtotal * 0.09975;
    doc.text("TPS (5%):", totalXOffset, currentTotalY);
    doc.text(formatMoney(tps, branding.currency), 190, currentTotalY, { align: "right" });
    currentTotalY += 8;
    doc.text("TVQ (9.975%):", totalXOffset, currentTotalY);
    doc.text(formatMoney(tvq, branding.currency), 190, currentTotalY, { align: "right" });
    currentTotalY += 8;
  } else if (Number(invoice.tax_total) > 0) {
    doc.text(`Taxes (${taxRate.toFixed(2)}%):`, totalXOffset, currentTotalY);
    doc.text(formatMoney(invoice.tax_total, branding.currency), 190, currentTotalY, { align: "right" });
    currentTotalY += 8;
  }

  // Ligne de séparation pour le total
  doc.setDrawColor(200, 200, 200);
  doc.line(125, currentTotalY - 4, 200, currentTotalY - 4);

  // Total
  doc.setFontSize(14);
  doc.setFont(undefined, "bold");
  doc.setTextColor(...branding.color);
  doc.text("TOTAL:", totalXOffset, currentTotalY + 4);
  doc.text(formatMoney(invoice.total, branding.currency), 190, currentTotalY + 4, { align: "right" });
  
  doc.setTextColor(40, 40, 40);
  doc.setFont(undefined, "normal");

  let currentLeftY = finalY;

  // Numéros de taxes
  if (branding.taxNumbers) {
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    const taxLines = doc.splitTextToSize(`Nos taxes: ${branding.taxNumbers}`, 100);
    doc.text(taxLines, 14, currentLeftY);
    currentLeftY += (taxLines.length * 4) + 6;
  }

  // Notes additionnelles
  if (invoice.notes) {
    doc.setFontSize(9);
    doc.setTextColor(40, 40, 40);
    doc.setFont(undefined, "bold");
    doc.text("Notes:", 14, currentLeftY);
    doc.setFont(undefined, "normal");
    const notesLines = doc.splitTextToSize(invoice.notes, 100);
    doc.text(notesLines, 14, currentLeftY + 5);
    currentLeftY += (notesLines.length * 5) + 6;
  }

  // Informations de paiement
  currentLeftY = Math.max(currentLeftY, doc.lastAutoTable.finalY + 45); // S'assurer qu'on est sous le bloc total
  
  doc.setFillColor(...branding.color);
  doc.rect(14, currentLeftY, 182, 1, "F");
  currentLeftY += 6;

  doc.setFontSize(10);
  doc.setFont(undefined, "bold");
  doc.text("MODALITÉS DE PAIEMENT", 14, currentLeftY);
  currentLeftY += 6;

  doc.setFontSize(9);
  doc.setFont(undefined, "normal");
  
  const paymentTerms = branding.paymentTerms || (invoice.due_date ? `Payable au plus tard le ${formatDate(invoice.due_date)}` : "Payable sur réception");
  doc.text(paymentTerms, 14, currentLeftY);
  currentLeftY += 6;

  if (organisation && organisation.interac_email) {
    doc.setFont(undefined, "bold");
    doc.text("Virement Interac :", 14, currentLeftY);
    doc.setFont(undefined, "normal");
    doc.text(`${organisation.interac_email}`, 48, currentLeftY);
    currentLeftY += 5;
    
    if (organisation.interac_question) {
      doc.text(`Question: ${organisation.interac_question}`, 14, currentLeftY);
    }
  } else if (organisation && organisation.stripe_account_id) {
    doc.text("Paiement par carte de crédit disponible via le portail client ou lien sécurisé.", 14, currentLeftY);
  }
}

function renderTemplate(doc, invoice, branding, organisation) {
  addInvoiceHeader(doc, invoice, branding);
  addInvoiceItemsTable(doc, invoice, branding);
  addInvoiceTotals(doc, invoice, branding, organisation);

  doc.setFontSize(8);
  doc.text(branding.footer, 14, 285);
}

module.exports = {
  renderTemplate,
};
