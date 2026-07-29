function summarizeTime(entries = []) {
  return entries.reduce((result, entry) => {
    const minutes = Math.max(0, Number(entry.minutes || 0));
    result.totalMinutes += minutes;
    if (entry.billable) result.billableMinutes += minutes;
    return result;
  }, { totalMinutes: 0, billableMinutes: 0 });
}

module.exports = { summarizeTime };
