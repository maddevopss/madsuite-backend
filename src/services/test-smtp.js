const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
const nodemailer = require("nodemailer");

async function diagnosticSMTP() {
  console.log("🚀 Diagnostic de la configuration SMTP...");
  console.log(`📡 Host: ${process.env.EMAIL_HOST}`);
  console.log(`🔌 Port: ${process.env.EMAIL_PORT}`);
  console.log(`👤 User: ${process.env.EMAIL_USER}`);

  // 1. Initialisation du transporteur
  const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT || "587"),
    secure: process.env.EMAIL_PORT === "465",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
    connectionTimeout: 5000,
  });

  try {
    // 2. Vérification de la connexion
    console.log("⏳ Vérification de la connexion...");
    await transporter.verify();
    console.log("✅ Connexion réussie ! Le serveur accepte tes identifiants.");

    // 3. Envoi d'un mail de test réel
    console.log("📧 Tentative d'envoi d'un mail de test...");
    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: process.env.EMAIL_USER,
      subject: "Test de connexion SMTP MADSuite",
      text: "Si vous recevez ce message, la configuration SMTP fonctionne.",
      html: "<b>Succès !</b> La configuration SMTP de <b>MADSuite</b> est opérationnelle.",
    });

    console.log("✅ Mail envoyé avec succès !");
    console.log("🆔 Message ID:", info.messageId);
  } catch (error) {
    console.error("❌ Échec du diagnostic SMTP :");
    console.error(`   Code: ${error.code}`);
    console.error(`   Message: ${error.message}`);

    if (error.message.includes("EAUTH")) {
      console.log("\n💡 Astuce: Vérifie ton mot de passe d'application ou assure-toi que le 2FA est activé.");
    }
  }
}

diagnosticSMTP().then(() => console.log("🏁 Fin du diagnostic."));
