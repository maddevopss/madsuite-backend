module.exports = async () => {
  const { startBackendTestCluster } = require("./src/test/postgresTestCluster");
  await startBackendTestCluster();
  const setupInvoicesTestDB = require("./src/test/setupInvoicesTestDB");
  await setupInvoicesTestDB();
};
