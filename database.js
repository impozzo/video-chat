const Database = require("better-sqlite3");

const db = new Database("video-chat.db");

// =========================================
// DATABASE CONFIGURATION
// =========================================

db.pragma("foreign_keys = ON");

// =========================================
// EXISTING TABLES
// Preserve existing accounts, messages, and sessions.
// =========================================

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id TEXT NOT NULL,
        user_id INTEGER NOT NULL,
        message TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`);

// =========================================
// MIGRATE EXISTING USERS TABLE
// Add new columns without deleting existing data.
// =========================================

const userColumns = db.prepare("PRAGMA table_info(users)").all();

const hasEmailColumn = userColumns.some((column) => column.name === "email");

const hasEmailVerifiedColumn = userColumns.some(
  (column) => column.name === "email_verified_at",
);

if (!hasEmailColumn) {
  db.exec(`
        ALTER TABLE users
        ADD COLUMN email TEXT;
    `);

  console.log("Added email column to users table.");
}

if (!hasEmailVerifiedColumn) {
  db.exec(`
        ALTER TABLE users
        ADD COLUMN email_verified_at DATETIME;
    `);

  console.log("Added email verification status to users table.");
}

// =========================================
// EMAIL ADDRESS INDEX
// Prevent duplicate email addresses, ignoring case.
// Unassigned email addresses are allowed.
// =========================================

db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique
    ON users (LOWER(email))
    WHERE email IS NOT NULL AND TRIM(email) <> '';
`);

// =========================================
// EMAIL VERIFICATION TOKENS
//
// Store a HASH of each verification token,
// never the original token.
//
// Tokens will be time-limited and deleted
// after successful verification.
// =========================================

db.exec(`
    CREATE TABLE IF NOT EXISTS email_verification_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,

        user_id INTEGER NOT NULL,

        token_hash TEXT NOT NULL UNIQUE,

        expires_at DATETIME NOT NULL,

        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (user_id)
            REFERENCES users(id)
            ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_email_verification_user
    ON email_verification_tokens(user_id);

    CREATE INDEX IF NOT EXISTS idx_email_verification_expiry
    ON email_verification_tokens(expires_at);
`);

// =========================================
// PASSWORD RESET TOKENS
//
// Store a HASH of each password-reset token.
//
// Tokens will be time-limited and usable only once.
// =========================================

db.exec(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,

        user_id INTEGER NOT NULL,

        token_hash TEXT NOT NULL UNIQUE,

        expires_at DATETIME NOT NULL,

        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (user_id)
            REFERENCES users(id)
            ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_password_reset_user
    ON password_reset_tokens(user_id);

    CREATE INDEX IF NOT EXISTS idx_password_reset_expiry
    ON password_reset_tokens(expires_at);
`);

// =========================================
// DATABASE READY
// =========================================

console.log("Database ready.");

module.exports = db;
