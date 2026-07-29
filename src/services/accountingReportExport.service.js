'use strict';

function escapeCsv(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function reportToCsv(columns = [], rows = []) {
  const header = columns.map((column) => escapeCsv(column.label)).join(',');
  const body = rows.map((row) => columns.map((column) => escapeCsv(row[column.key])).join(',')).join('\n');
  return `${header}\n${body}`;
}

function buildExportMetadata({ reportName, period, currency = 'CAD', generatedBy }) {
  return {
    reportName,
    period,
    currency,
    generatedBy,
    generatedAt: new Date().toISOString(),
    immutableSnapshot: true,
  };
}

module.exports = { buildExportMetadata, escapeCsv, reportToCsv };
