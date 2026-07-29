'use strict';

const TRANSITIONS = {
  draft: ['submitted', 'void'],
  submitted: ['approved', 'rejected'],
  rejected: ['draft'],
  approved: ['partially_paid', 'paid', 'void'],
  partially_paid: ['paid'],
  paid: [],
  void: [],
};

function transitionBill(bill, nextStatus, actorId, reason = null) {
  if (!TRANSITIONS[bill.status]?.includes(nextStatus)) throw new Error(`Transition ${bill.status} vers ${nextStatus} interdite.`);
  if (['rejected', 'void'].includes(nextStatus) && !String(reason || '').trim()) throw new Error('Un motif est obligatoire.');
  return { ...bill, status: nextStatus, approvedBy: nextStatus === 'approved' ? actorId : bill.approvedBy, statusReason: reason, statusChangedAt: new Date().toISOString() };
}

module.exports = { TRANSITIONS, transitionBill };