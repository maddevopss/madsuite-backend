const db = require("../../db");

const schemaCache = new Map();

async function hasColumn(tableName, columnName, client = db) {
  const cacheKey = `${tableName}:${columnName}`;

  if (schemaCache.has(cacheKey)) {
    return schemaCache.get(cacheKey);
  }

  try {
    const result = await client.query(
      `
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = $1
        AND column_name = $2
      LIMIT 1
      `,
      [tableName, columnName],
    );

    const exists = result.rowCount > 0;
    schemaCache.set(cacheKey, exists);

    return exists;
  } catch {
    return false;
  }
}

function clearSchemaCache() {
  schemaCache.clear();
}

module.exports = {
  clearSchemaCache,
  hasColumn,
};
