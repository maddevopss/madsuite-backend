module.exports = {
  testEnvironment: "node",
  globalSetup: "<rootDir>/jest.globalSetup.js",
  globalTeardown: "<rootDir>/jest.globalTeardown.js",
  setupFiles: ["<rootDir>/src/test/jest.env.js"],
  setupFilesAfterEnv: ["<rootDir>/src/test/setupOrganisationDefaults.js", "<rootDir>/src/test/setup.js"],
  coverageThreshold: {
    global: {
      branches: 75,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
  // Keep default jest behavior; this repo uses integration tests with real DB.
  verbose: false,
};
