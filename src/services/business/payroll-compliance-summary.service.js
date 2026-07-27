function buildComplianceSummary({ remittances = [], vacationBanks = [], terminations = [], deposits = [], slips = [] }) {
  const overdueRemittances = remittances.filter((item) => item.status !== 'paid' && new Date(item.dueDate) < new Date()).length;
  const negativeVacationBanks = vacationBanks.filter((item) => Number(item.availableAmount || 0) < 0).length;
  const pendingTerminations = terminations.filter((item) => !['issued', 'cancelled'].includes(item.status)).length;
  const unconfirmedDeposits = deposits.filter((item) => item.status === 'submitted' && !item.confirmedAt).length;
  const draftSlips = slips.filter((item) => item.status === 'draft').length;

  const blockers = overdueRemittances + negativeVacationBanks + pendingTerminations + unconfirmedDeposits + draftSlips;
  return {
    status: blockers === 0 ? 'ready' : 'attention_required',
    blockers,
    overdueRemittances,
    negativeVacationBanks,
    pendingTerminations,
    unconfirmedDeposits,
    draftSlips,
  };
}

module.exports = { buildComplianceSummary };
