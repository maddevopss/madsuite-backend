const { PrismaClient } = require("../generated/prisma/client");
const dotenv = require("dotenv");

dotenv.config();

const prisma = new PrismaClient({
  log: ["query", "info", "error", "warn"],
});

module.exports = prisma;
