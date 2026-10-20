require("dotenv").config();

const nodemailer = require("nodemailer");

// =========================================
// EMAIL CONFIGURATION
// Loaded from the private .env file.
// =========================================

function createTransporter() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  const missingSettings = [];

  if (!host) missingSettings.push("SMTP_HOST");
  if (!process.env.SMTP_PORT) missingSettings.push("SMTP_PORT");
  if (!user) missingSettings.push("SMTP_USER");
  if (!pass) missingSettings.push("SMTP_PASS");

  if (missingSettings.length > 0) {
    throw new Error(
      "Missing email settings in .env: " + missingSettings.join(", "),
    );
  }

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SMTP_PORT must be a valid port number.");
  }

  return nodemailer.createTransport({
    host,
    port,

    // Port 465 uses implicit TLS.
    // Port 587 uses STARTTLS.
    secure: port === 465,

    // Require encryption when using the standard STARTTLS port.
    requireTLS: port === 587,

    auth: {
      user,
      pass,
    },
  });
}

// =========================================
// CREATE TRANSPORTER
// =========================================

let transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = createTransporter();
  }

  return transporter;
}

// =========================================
// VERIFY EMAIL CONNECTION
// This checks the connection and authentication.
// It does NOT send an email.
// =========================================

async function verifyEmailConnection() {
  try {
    console.log("Connecting to Winhost email server...");

    const emailTransporter = getTransporter();

    await emailTransporter.verify();

    console.log("=========================================");
    console.log("EMAIL CONNECTION SUCCESSFUL");
    console.log("SMTP server:", process.env.SMTP_HOST);
    console.log("Email account:", process.env.SMTP_USER);
    console.log("=========================================");

    return true;
  } catch (error) {
    console.error("=========================================");
    console.error("EMAIL CONNECTION FAILED");
    console.error("Error:", error.message);

    if (error.code) {
      console.error("Error code:", error.code);
    }

    console.error("Check your .env settings and Winhost email credentials.");
    console.error("=========================================");

    return false;
  }
}

// =========================================
// SEND EMAIL
// We will use this function for verification
// and password-reset messages later.
// =========================================

async function sendEmail({ to, subject, text, html }) {
  if (!to || !subject || (!text && !html)) {
    throw new Error("An email recipient, subject, and message are required.");
  }

  const from = process.env.SMTP_FROM;

  if (!from) {
    throw new Error("SMTP_FROM is missing from your .env file.");
  }

  const emailTransporter = getTransporter();

  return emailTransporter.sendMail({
    from,
    to,
    subject,
    text,
    html,
  });
}

// =========================================
// EXPORT FUNCTIONS
// =========================================

module.exports = {
  verifyEmailConnection,
  sendEmail,
};

// =========================================
// RUN A CONNECTION TEST DIRECTLY
// Command: node email.js
// =========================================

if (require.main === module) {
  verifyEmailConnection().then((success) => {
    if (!success) {
      process.exitCode = 1;
    }
  });
}
