function calculateProductivity({ completedTasks = 0, plannedTasks = 0, focusedMinutes = 0, workedMinutes = 0 }) {
  return {
    completionRate: Number(plannedTasks) === 0 ? null : Number(completedTasks) / Number(plannedTasks),
    focusRate: Number(workedMinutes) === 0 ? null : Number(focusedMinutes) / Number(workedMinutes),
  };
}

module.exports = { calculateProductivity };
