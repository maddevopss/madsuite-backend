const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const appPath = path.join(repoRoot, "src", "app.js");
const routePath = path.join(repoRoot, "src", "routes", "master-admin.routes.js");
const servicePath = path.join(repoRoot, "src", "services", "masteradmin.service.js");
const superAdminPath = path.join(repoRoot, "src", "middleware", "requireSuperAdmin.js");

const violations = [];

function read(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

const app = read(appPath);
const route = read(routePath);
const service = read(servicePath);
const superAdmin = read(superAdminPath);

if (!app) violations.push("src/app.js is missing.");
if (!route) violations.push("src/routes/master-admin.routes.js is missing.");
if (!service) violations.push("src/services/masteradmin.service.js is missing.");
if (!superAdmin) violations.push("src/middleware/requireSuperAdmin.js is missing.");

if (app && !app.includes('app.use("/api/master-admin", auth, masterAdminRoutes)')) {
  violations.push("/api/master-admin must be mounted behind auth in app.js.");
}

if (route && !route.includes('require("../middleware/requireSuperAdmin")')) {
  violations.push("master-admin routes must use shared requireSuperAdmin middleware.");
}

if (route && route.includes("const requireMasterAdmin")) {
  violations.push("master-admin routes must not define a local duplicated requireMasterAdmin.");
}

if (route && route.includes("user.id === 1")) {
  violations.push("master-admin routes must not use magic user.id === 1.");
}

if (route && !route.includes("router.use(auth)")) {
  violations.push("master-admin routes must apply auth middleware internally.");
}

if (route && !route.includes("router.use(requireSuperAdmin)")) {
  violations.push("master-admin routes must apply requireSuperAdmin internally.");
}

if (route && !route.includes("createOrgSchema.safeParse")) {
  violations.push("master-admin create organisation route must validate payload with zod.");
}

if (route && !route.includes("password: z.string().min(12")) {
  violations.push("master-admin initial password must require at least 12 characters.");
}

if (route && !route.includes("recordBusinessAudit")) {
  violations.push("master-admin actions must write a business audit log.");
}

if (route && !route.includes("master_admin.create_organisation")) {
  violations.push("master-admin create organisation audit action must be stable.");
}

if (route && route.includes("console.error")) {
  violations.push("master-admin routes must not use console.error.");
}

if (route && !route.includes("logger.warn")) {
  violations.push("master-admin non-blocking audit failures must be logged with logger.warn.");
}

if (service && !service.includes("await client.query(\"BEGIN\")")) {
  violations.push("masteradmin service must create organisation transactionally.");
}

if (service && !service.includes("await client.query(\"COMMIT\")")) {
  violations.push("masteradmin service must commit transaction.");
}

if (service && !service.includes("await client.query(\"ROLLBACK\")")) {
  violations.push("masteradmin service must rollback transaction on failure.");
}

if (service && !service.includes("BCRYPT_SALT_ROUNDS")) {
  violations.push("masteradmin service must hash password with configured BCRYPT_SALT_ROUNDS.");
}

if (service && !service.includes("WHERE email = $1 AND deleted_at IS NULL")) {
  violations.push("masteradmin service must check duplicate active emails.");
}

if (superAdmin && !superAdmin.includes("MASTER_ADMIN_USER_IDS")) {
  violations.push("requireSuperAdmin must use MASTER_ADMIN_USER_IDS.");
}

if (superAdmin && superAdmin.includes("user.id === 1")) {
  violations.push("requireSuperAdmin must not use magic user.id === 1.");
}

if (superAdmin && !superAdmin.includes("return res.status(403)")) {
  violations.push("requireSuperAdmin must fail closed with 403.");
}

if (violations.length > 0) {
  console.error("\nMADSuite master-admin contract guard failed.\n");
  violations.forEach((violation) => console.error(`- ${violation}`));
  process.exit(1);
}

console.log("Master-admin contract guard passed.");
