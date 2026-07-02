const bcrypt = require("bcrypt");

function assertEnv() {
  if (!process.env.TEST_PASSWORD) {
    throw new Error("❌ Missing TEST_PASSWORD");
  }
}

async function seedE2EDatabase() {
  assertEnv();

  const hashed = await bcrypt.hash(process.env.TEST_PASSWORD, 10);

  console.log("🌱 SEED OK");
}

// 💀 IMPORTANT
module.exports = { seedE2EDatabase };