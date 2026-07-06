const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT),
});

pool.on('error', (err) => {
  console.error('❌ Erreur inattendue PG Pool:', err);
});

const testConnection = async () => {
  try {
    const res = await pool.query('SELECT NOW()');
    console.log('✅ PostgreSQL connecté:', res.rows[0]);
  } catch (err) {
    console.error('❌ Erreur connexion DB :', err.message);
  }
};

testConnection();

module.exports = pool;