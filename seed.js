const bcrypt = require("bcrypt");
const db = require("./db");
const { BCRYPT_SALT_ROUNDS } = require("./src/config/security");

async function ensureOrganisation() {
  const inserted = await db.query(
    `
    INSERT INTO organisations (nom)
    VALUES ($1)
    ON CONFLICT DO NOTHING
    RETURNING id
    `,
    [process.env.SEED_ORGANISATION_NAME || "MADSuite"],
  );

  if (inserted.rows[0]?.id) return inserted.rows[0].id;

  const existing = await db.query(
    `
    SELECT id
    FROM organisations
    WHERE nom = $1
    ORDER BY id
    LIMIT 1
    `,
    [process.env.SEED_ORGANISATION_NAME || "MADSuite"],
  );

  if (existing.rows[0]?.id) return existing.rows[0].id;

  const fallback = await db.query("SELECT id FROM organisations ORDER BY id LIMIT 1");
  if (!fallback.rows[0]?.id) throw new Error("Aucune organisation disponible pour le seed.");

  return fallback.rows[0].id;
}

async function seed() {
  try {
    const organisationId = await ensureOrganisation();
    const password = process.env.SEED_ADMIN_PASSWORD || process.env.E2E_PASSWORD || "1234";
    const hash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

    const users = [
      { nom: "SuperAdmin", email: process.env.SEED_ADMIN_EMAIL || "superadmin@test.com", role: "admin" },
      { nom: "Admin", email: "admin@test.com", role: "admin" },
      { nom: "Kim", email: "kim@kim.com", role: "admin" },
      { nom: "User", email: "user@test.com", role: "employe" },
      { nom: "User2", email: "user2@test.com", role: "employe" },
    ];

    for (const u of users) {
      await db.query(
        `
        INSERT INTO utilisateurs (nom, email, mot_de_passe, role, organisation_id, role_org)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (email) DO UPDATE
        SET nom = EXCLUDED.nom,
            mot_de_passe = EXCLUDED.mot_de_passe,
            role = EXCLUDED.role,
            organisation_id = EXCLUDED.organisation_id,
            role_org = EXCLUDED.role_org,
            deleted_at = NULL
        `,
        [u.nom, u.email, hash, u.role, organisationId, u.role === "admin" ? "admin" : "user"],
      );

      console.log(`✔ seed utilisateur: ${u.email}`);
    }

    console.log("🔥 SEED TERMINÉ");
  } catch (err) {
    console.error("❌ Seed error:", err);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
}

seed();
