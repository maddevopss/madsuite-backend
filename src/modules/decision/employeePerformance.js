function summarizeEmployeePerformance({ workedMinutes = 0, billableMinutes = 0, completedTasks = 0 }) {
  return {
    workedMinutes: Number(workedMinutes),
    billableRate: Number(workedMinutes) === 0 ? null : Number(billableMinutes) / Number(workedMinutes),
    completedTasks: Number(completedTasks),
  };
}

module.exports = { summarizeEmployeePerformance };
