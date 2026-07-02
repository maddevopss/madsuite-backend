const path = require("path");
const dotenv = require("dotenv");

// 💀 ABSOLU + SAFE (NE DÉPEND PAS DE cwd)
const envPath = path.resolve(__dirname, "../../../.env.test");

dotenv.config({ path: envPath });

console.log("🌍 ENV LOADED:", envPath);
console.log("🔐 TEST_PASSWORD:", process.env.TEST_PASSWORD);