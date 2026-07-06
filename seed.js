const bcrypt = require("bcrypt");
const pool = require("./db");

async function seed() {
  try {
    const users = [
      { nom: "SuperAdmin", email: "bleeband@gmail.com", role: "admin" },
      { nom: "Admin", email: "admin@test.com", role: "admin" },
      { nom: "Kim", email: "kim@kim.com", role: "admin" },
      { nom: "User", email: "user@test.com", role: "employe" },
      { nom: "User2", email: "user2@test.com", role: "employe" },
    ];

    for (const u of users) {
      const hash = await bcrypt.hash("1234", 10); // 🔑 mot de passe test pour tous

      await pool.query(
        `INSERT INTO utilisateurs (nom, email, mot_de_passe, role)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO NOTHING`,
        [u.nom, u.email, hash, u.role]
      );

      console.log(`✔ créé: ${u.email}`);
    }

    console.log("🔥 SEED TERMINÉ");
  } catch (err) {
    console.error("❌ Seed error:", err);
  } finally {
    process.exit();
  }
}

seed();