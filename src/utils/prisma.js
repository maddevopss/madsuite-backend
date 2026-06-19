const { PrismaNeon } = require("@prisma/adapter-neon");
const { PrismaClient } = require("../generated/prisma/client");
const dotenv = require("dotenv");

dotenv.config();

// If you have @neondatabase/serverless, use Pool. For now, PrismaNeon allows direct adapter if it supports it, 
// but typically you pass a Pool. If this fails, make sure @neondatabase/serverless is installed.
const adapter = new PrismaNeon({
  connectionString: process.env.DATABASE_URL || "",
});

const prisma = new PrismaClient({
  adapter,
  log: ["query", "info", "error", "warn"],
});

module.exports = prisma;
