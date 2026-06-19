const { jsPDF } = require("jspdf");
const jspdfAutotable = require("jspdf-autotable");

const autoTable = jspdfAutotable.autoTable || jspdfAutotable.default || jspdfAutotable;

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString("fr-FR") : "-";
}

function formatMoney(value, currency = "CAD") {
  return `${Number(value || 0).toFixed(2)} ${currency}`;
}

function parseBrandColor(value) {
  const match = String(value || "").match(/^#?([0-9a-f]{6})$/i);

  if (!match) return [41, 82, 155];

  const hex = match[1];
  return [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
}

function getInvoiceBranding() {
  return {
    name: process.env.INVOICE_BRAND_NAME || process.env.APP_NAME || "MADSuite",
    email: process.env.INVOICE_BRAND_EMAIL || "",
    phone: process.env.INVOICE_BRAND_PHONE || "",
    website: process.env.INVOICE_BRAND_WEBSITE || "",
    address: process.env.INVOICE_BRAND_ADDRESS || "",
    taxNumbers: process.env.INVOICE_TAX_NUMBERS || "",
    currency: process.env.INVOICE_CURRENCY || "CAD",
    footer: process.env.INVOICE_BRAND_FOOTER || "Généré par MADSuite",
    color: parseBrandColor(process.env.INVOICE_BRAND_COLOR),
  };
}

function buildEstimateTableData(estimate, branding) {
  return estimate.items.map((item) => [
    item.description || "-",
    item.quantity ? Number(item.quantity).toFixed(2) : "0.00",
    formatMoney(item.unit_rate, branding.currency),
    formatMoney(item.amount, branding.currency),
  ]);
}

function addEstimateHeader(doc, estimate, branding) {
  // Bandeau supérieur avec couleur de marque
  doc.setFillColor(...branding.color);
  doc.rect(0, 0, 210, 40, "F");

  // Titre
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(28);
  doc.setFont(undefined, "bold");
  doc.text("SOUMISSION", 14, 25);

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

  // Détails de la soumission
  doc.setFontSize(11);
  doc.setFont(undefined, "bold");
  doc.text("DÉTAILS DE LA SOUMISSION", 14, 55);
  doc.setFont(undefined, "normal");
  doc.setFontSize(10);
  doc.text(`Soumission #: ${estimate.estimate_number}`, 14, 62);
  doc.text(`Date d'émission: ${formatDate(estimate.issue_date)}`, 14, 68);
  if (estimate.valid_until) {
    doc.text(`Valide jusqu'au: ${formatDate(estimate.valid_until)}`, 14, 74);
  }
  
  // Détails du client
  doc.setFontSize(11);
  doc.setFont(undefined, "bold");
  doc.text("PRÉPARÉ POUR", 120, 55);
  doc.setFont(undefined, "normal");
  doc.setFontSize(10);
  doc.text(estimate.client_nom || "-", 120, 62);
  if (estimate.client_email) doc.text(estimate.client_email, 120, 68);
  if (estimate.client_phone) doc.text(estimate.client_phone, 120, 74);
  
  // Ligne de séparation
  doc.setDrawColor(220, 220, 220);
  doc.line(14, 82, 196, 82);
}

function addEstimateItemsTable(doc, estimate, branding) {
  autoTable(doc, {
    startY: 88,
    tableWidth: 180,
    head: [["Description", "Qté", "Taux", "Montant"]],
    body: buildEstimateTableData(estimate, branding),
    foot: [["TOTAL", "", "", formatMoney(estimate.total, branding.currency)]],
    styles: { fontSize: 8 },
    headStyles: { fillColor: branding.color },
    footStyles: { fillColor: [230, 230, 230], fontStyle: "bold" },
    columnStyles: {
      0: { cellWidth: 95 },
      1: { cellWidth: 25, halign: "right" },
      2: { cellWidth: 30, halign: "right" },
      3: { cellWidth: 30, halign: "right" },
    },
  });
}

function addEstimateTotals(doc, estimate, branding) {
  const finalY = doc.lastAutoTable.finalY + 10;
  const subtotal = Number(estimate.subtotal || 0);
  const taxRate = subtotal > 0 ? (Number(estimate.tax_total || 0) / subtotal) * 100 : 0;
  const isQuebecStandard = taxRate >= 14.9 && taxRate <= 15.0; // Approximation pour 14.975%

  const totalXOffset = 130;
  
  // Fond gris léger pour la zone des totaux
  doc.setFillColor(249, 250, 251);
  doc.rect(125, finalY - 5, 75, 45, "F");

  doc.setFontSize(10);
  doc.setTextColor(60, 60, 60);
  doc.text("Sous-total:", totalXOffset, finalY);
  doc.text(formatMoney(estimate.subtotal, branding.currency), 190, finalY, { align: "right" });

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
  } else if (Number(estimate.tax_total) > 0) {
    doc.text(`Taxes (${taxRate.toFixed(2)}%):`, totalXOffset, currentTotalY);
    doc.text(formatMoney(estimate.tax_total, branding.currency), 190, currentTotalY, { align: "right" });
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
  doc.text(formatMoney(estimate.total, branding.currency), 190, currentTotalY + 4, { align: "right" });
  
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
  if (estimate.notes) {
    doc.setFontSize(9);
    doc.setTextColor(40, 40, 40);
    doc.setFont(undefined, "bold");
    doc.text("Notes:", 14, currentLeftY);
    doc.setFont(undefined, "normal");
    const notesLines = doc.splitTextToSize(estimate.notes, 100);
    doc.text(notesLines, 14, currentLeftY + 5);
    currentLeftY += (notesLines.length * 5) + 6;
  }

  // Bloc signature si accepté (ou bloc d'attente de signature)
  currentLeftY = Math.max(currentLeftY, doc.lastAutoTable.finalY + 45); // S'assurer qu'on est sous le bloc total
  
  doc.setFillColor(...branding.color);
  doc.rect(14, currentLeftY, 182, 1, "F");
  currentLeftY += 6;

  doc.setFontSize(10);
  doc.setFont(undefined, "bold");
  doc.text("APPROBATION DU CLIENT", 14, currentLeftY);
  currentLeftY += 8;

  if (estimate.status === "accepted") {
    doc.setFontSize(9);
    doc.setFont(undefined, "normal");
    doc.text("Soumission acceptée par le client.", 14, currentLeftY);
    // Si nous avons une image de signature, on pourrait l'ajouter ici
  } else if (estimate.status === "rejected") {
    doc.setFontSize(9);
    doc.setFont(undefined, "normal");
    doc.setTextColor(200, 0, 0);
    doc.text("Soumission refusée par le client.", 14, currentLeftY);
  } else {
    doc.setFontSize(9);
    doc.setFont(undefined, "normal");
    doc.text("Signature autorisée:", 14, currentLeftY);
    doc.setDrawColor(150, 150, 150);
    doc.line(45, currentLeftY + 2, 120, currentLeftY + 2);
    
    doc.text("Date:", 130, currentLeftY);
    doc.line(140, currentLeftY + 2, 180, currentLeftY + 2);
  }
}

function renderEstimatePdf(estimate) {
  const doc = new jsPDF();
  const branding = getInvoiceBranding(); // On réutilise le même branding pour l'entreprise

  addEstimateHeader(doc, estimate, branding);
  addEstimateItemsTable(doc, estimate, branding);
  addEstimateTotals(doc, estimate, branding);

  doc.setFontSize(8);
  doc.text(branding.footer, 14, 285);

  return Buffer.from(doc.output("arraybuffer"));
}

module.exports = {
  renderEstimatePdf,
};
