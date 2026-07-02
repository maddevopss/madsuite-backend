const path = require("path");
const dotenv = require("dotenv");

// 💀 FORCE CHEMIN EXACT backend/.env.test
const envPath = path.resolve(__dirname, "../../../.env.test");

dotenv.config({ path: envPath });

console.log("🌍 ENV LOADED FROM:", envPath);
console.log("🔐 TEST_PASSWORD:", process.env.TEST_PASSWORD);

const { seedE2EDatabase } = require("./seed");

module.exports = async () => {
  console.log("🌱 Seeding E2E DB...");
  await seedE2EDatabase();
};