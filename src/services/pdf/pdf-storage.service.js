/**
 * Manages the storage and caching of generated PDFs.
 * This is a placeholder for future implementation (e.g. S3 upload).
 */

async function storePdf(invoiceId, pdfBuffer, organisationId) {
  // TODO: Implémenter le stockage cloud si nécessaire (AWS S3, etc.)
  // Pour l'instant, nous générons à la volée.
  return {
    success: true,
    message: "PDF stored in memory (volatile)",
    size: pdfBuffer.length,
  };
}

module.exports = {
  storePdf,
};
