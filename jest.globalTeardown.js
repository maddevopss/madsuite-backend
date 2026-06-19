module.exports = async () => {
  try {
    const pool = require("../db");
    if (pool?.end) {
      await pool.end();
    }
  } catch {
    // ignore teardown errors
  }

  const { stopBackendTestCluster } = require("./src/test/postgresTestCluster");
  await stopBackendTestCluster();
};
