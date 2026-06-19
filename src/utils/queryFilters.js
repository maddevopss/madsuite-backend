function normalizePagination({ page = 1, limit = 50, maxLimit = 200 } = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(maxLimit, Math.max(1, Number(limit) || 50));

  return {
    page: safePage,
    limit: safeLimit,
    offset: (safePage - 1) * safeLimit,
  };
}

function addDateRangeFilter({ conditions, params, column, dateDebut, dateFin, timezone, timezoneParam }) {
  if (!dateDebut && !dateFin) {
    return;
  }

  const tzParam = timezoneParam || (() => {
    params.push(timezone);
    return `$${params.length}`;
  })();

  if (dateDebut) {
    params.push(dateDebut);
    conditions.push(`(${column} AT TIME ZONE ${tzParam})::date >= $${params.length}::date`);
  }

  if (dateFin) {
    params.push(dateFin);
    conditions.push(`(${column} AT TIME ZONE ${tzParam})::date <= $${params.length}::date`);
  }
}

module.exports = {
  addDateRangeFilter,
  normalizePagination,
};
