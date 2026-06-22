// Estimate Orchestrator

const { listEstimates, getEstimateById } = require("./estimate-query.service");
const { createEstimate, updateEstimate, deleteEstimate } = require("./estimate-mutation.service");
const { convertToInvoice, convertToProject } = require("./estimate-workflow.service");

// We reuse the existing PDF service until it's moved or rewritten
// Wait, actually I can just import it from the parent directory since I didn't move it yet.
const { generateEstimatePdfBuffer } = require("../pdf/estimate-pdf.service");

async function generateEstimatePdf({ estimateId, organisationId }) {
  const estimate = await getEstimateById(estimateId, organisationId);

  if (!estimate) {
    return null;
  }

  const buffer = await generateEstimatePdfBuffer(estimate, organisationId);
  return { estimate, buffer };
}

module.exports = {
  // Queries
  listEstimates,
  getEstimateById,

  // Mutations
  createEstimate,
  updateEstimate,
  deleteEstimate,

  // Workflow
  convertToInvoice,
  convertToProject,

  // Document Generation
  generateEstimatePdf
};
