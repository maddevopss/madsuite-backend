const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: "commonjs",
      globals: {
        ...globals.node,
        ...globals.es2021,
        ...globals.jest
      }
    },
    rules: {
      "no-unused-vars": "off",
      "no-console": "off",
      "no-useless-catch": "off",
      "no-empty": "off"
    }
  },
  {
    files: ["src/jobs/dataRetention.js", "src/jobs/securityBufferJob.js"],
    rules: {
      "no-useless-assignment": "off"
    }
  },
  {
    files: ["src/test/multiTenantJobs.security.test.js"],
    rules: {
      "no-unassigned-vars": "off"
    }
  }
];
