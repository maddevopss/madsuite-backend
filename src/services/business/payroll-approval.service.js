function evaluateApproval({ createdBy, decisions = [], minimumApprovers = 2, prohibitSelfApproval = true }) {
  const approved = decisions.filter((item) => item.status === 'approved');
  const uniqueApprovers = new Set(approved.map((item) => Number(item.decidedBy)));
  const selfApproved = prohibitSelfApproval && uniqueApprovers.has(Number(createdBy));
  return {
    approvedCount: uniqueApprovers.size,
    minimumApprovers,
    selfApproved,
    ready: !selfApproved && uniqueApprovers.size >= minimumApprovers,
  };
}

module.exports = { evaluateApproval };
