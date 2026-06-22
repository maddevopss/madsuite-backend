/**
 * tenant-query-builder.js
 * 
 * Un constructeur de requêtes SQL (Fluent Builder) extrêmement simple qui
 * garantit l'injection automatique et sécurisée de la clause `organisation_id`
 * dans toutes les requêtes (SELECT, UPDATE, DELETE).
 */

const { enforceTenant } = require("./tenant-guard.service");

class TenantQueryBuilder {
  constructor(db, organisationId, tableName) {
    this.db = db;
    this.orgId = enforceTenant(organisationId);
    this.tableName = tableName.replace(/[^a-z0-9_]/gi, ""); // Safe table name
    
    this.conditions = [];
    this.params = [];
    this.operation = null;
    this.setClauses = [];
    
    // Auto-inject tenant guard
    this.where("organisation_id = ?", [this.orgId]);
  }

  static on(db, organisationId, tableName) {
    return new TenantQueryBuilder(db, organisationId, tableName);
  }

  select(fields = "*") {
    this.operation = "SELECT";
    this.fields = fields;
    return this;
  }

  update(setValues = {}) {
    this.operation = "UPDATE";
    for (const [key, value] of Object.entries(setValues)) {
      this.params.push(value);
      this.setClauses.push(`${key} = $${this.params.length}`);
    }
    return this;
  }

  delete() {
    this.operation = "DELETE";
    return this;
  }

  where(clause, values = []) {
    let finalClause = clause;
    for (const val of values) {
      this.params.push(val);
      finalClause = finalClause.replace("?", `$${this.params.length}`);
    }
    this.conditions.push(finalClause);
    return this;
  }

  async execute() {
    if (!this.operation) {
      throw new Error("L'opération (select, update, delete) n'est pas définie.");
    }

    let sql = "";
    
    if (this.operation === "SELECT") {
      sql = `SELECT ${this.fields} FROM ${this.tableName}`;
    } else if (this.operation === "UPDATE") {
      if (this.setClauses.length === 0) throw new Error("Aucune valeur à mettre à jour.");
      sql = `UPDATE ${this.tableName} SET ${this.setClauses.join(", ")}`;
    } else if (this.operation === "DELETE") {
      sql = `DELETE FROM ${this.tableName}`;
    }

    if (this.conditions.length > 0) {
      sql += ` WHERE ${this.conditions.join(" AND ")}`;
    }

    if (this.operation === "UPDATE" || this.operation === "DELETE") {
      sql += " RETURNING *";
    }

    return this.db.query(sql, this.params);
  }
}

module.exports = TenantQueryBuilder;
