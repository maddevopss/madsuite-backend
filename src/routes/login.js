const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const pool = require("./db");

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email et mot de passe requis",
      });
    }

    const result = await pool.query("SELECT * FROM utilisateurs WHERE email = $1", [email]);

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Identifiants invalides",
      });
    }

    const user = result.rows[0];

    if (!user.mot_de_passe) {
      return res.status(500).json({
        success: false,
        message: "Erreur serveur utilisateur",
      });
    }
    console.log("HASH IN DB:", user.mot_de_passe);
    const isValid = await bcrypt.compare(password, user.mot_de_passe);

    if (!isValid) {
      return res.status(401).json({
        success: false,
        message: "Identifiants invalides",
      });
    }

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
      },
      process.env.JWT_SECRET,
      { expiresIn: "8h" },
    );

    return res.json({
      success: true,
      token,
      user: {
        id: user.id,
        nom: user.nom,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("LOGIN ERROR:", err);

    return res.status(500).json({
      success: false,
      message: "Erreur serveur",
    });
  }

  console.log("EMAIL:", email);
  console.log("PASSWORD INPUT:", password);
  console.log("USER FOUND:", result.rows[0]);
});
