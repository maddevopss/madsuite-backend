const pool = require("../db");

module.exports = async () => {
  await pool.end();
};
