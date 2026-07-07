module.exports = async () => {
  try {
    const db = require("./db");
    if (db?.end) {
      await db.end();
    }
  } catch {
    // ignore teardown errors
  }

  const { stopBackendTestCluster } = require("./src/test/postgresTestCluster");
  await stopBackendTestCluster();
};
