'use strict';

function buildPayablesSchedule(payables = [], asOf = new Date()) {
  return payables.filter((item) => item.balanceCents > 0).map((item) => {
    const daysUntilDue = Math.ceil((new Date(item.dueDate) - new Date(asOf)) / 86400000);
    const urgency = daysUntilDue < 0 ? 'overdue' : daysUntilDue <= 7 ? 'due_soon' : 'scheduled';
    return { ...item, daysUntilDue, urgency };
  }).sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
}

function summarizeByWeek(schedule = []) {
  return schedule.reduce((weeks, item) => {
    const date = new Date(item.dueDate);
    const monday = new Date(date);
    monday.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    const key = monday.toISOString().slice(0, 10);
    weeks[key] = (weeks[key] || 0) + item.balanceCents;
    return weeks;
  }, {});
}

module.exports = { buildPayablesSchedule, summarizeByWeek };
