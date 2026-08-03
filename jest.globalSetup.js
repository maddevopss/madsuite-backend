module.exports = async () => {
  try {
    const { startBackendTestCluster } = require("./src/test/postgresTestCluster");
    await startBackendTestCluster();
    const setupInvoicesTestDB = require("./src/test/setupInvoicesTestDB");
    await setupInvoicesTestDB();
  } catch (err) {
    console.warn("Database setup skipped (unit tests can still run):", err.message);
  }
};
