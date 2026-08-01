const { toCsv } = require("./accounting-export.service");

function registerCsv(register) {
  return toCsv(
    ["Employé", "Numéro", "Brut", "Net"],
    register.rows.map((row) => [row.legalName, row.employeeNumber, row.grossPay, row.netPay]),
  );
}

function payStubsCsv(payStubs) {
  return toCsv(
    ["Employé", "Numéro", "Début période", "Fin période", "Date de paie", "Brut", "Net", "Version des règles", "Empreinte"],
    payStubs.map((stub) => [
      stub.legalName,
      stub.employeeNumber,
      stub.periodStart,
      stub.periodEnd,
      stub.payDate,
      stub.grossPay,
      stub.netPay,
      stub.rulesetVersion,
      stub.documentChecksum,
    ]),
  );
}

module.exports = { registerCsv, payStubsCsv };
