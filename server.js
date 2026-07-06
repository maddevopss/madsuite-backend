const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
require('dotenv').config();

const pool = require('./db');

const app = express();
const PORT = process.env.PORT || 5000;

const SECRET_KEY = process.env.JWT_SECRET;

app.use(cors());
app.use(express.json());

/**
 * 🔐 LOGIN ROUTE
 */
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    console.log("LOGIN ATTEMPT:", email);

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email et mot de passe requis.",
      });
    }

    const result = await pool.query(
      "SELECT * FROM utilisateurs WHERE email = $1",
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Email ou mot de passe invalide.",
      });
    }

    const user = result.rows[0];

    const isValidPassword = await bcrypt.compare(
      password,
      user.mot_de_passe
    );

    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: "Email ou mot de passe invalide.",
      });
    }

    if (!process.env.JWT_SECRET) {
      throw new Error("JWT_SECRET manquant dans .env");
    }

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
      },
      process.env.JWT_SECRET,
      { expiresIn: "8h" }
    );

    return res.json({
      success: true,
      token,
      utilisateur: {
        id: user.id,
        nom: user.nom,
        email: user.email,
        role: user.role,
      },
    });
    console.log("USER TROUVÉ:", user);
    console.log("PASSWORD INPUT:", password);
    console.log("PASSWORD DB:", user.mot_de_passe);
  } catch (err) {
    console.error("LOGIN ERROR:", err);

    return res.status(500).json({
      success: false,
      message: "Erreur serveur",
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Backend running on http://localhost:${PORT}`);
  console.log("JWT_SECRET:", !!process.env.JWT_SECRET);
  
});