const Database = require("better-sqlite3");

const db = new Database("video-chat.db");

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        password TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id TEXT NOT NULL,
        user_id INTEGER NOT NULL,
        message TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`);

// Add the password column if this database
// was created before the password column existed.
const userColumns = db.prepare("PRAGMA table_info(users)").all();

const hasPasswordColumn = userColumns.some(
  (column) => column.name === "password",
);

if (!hasPasswordColumn) {
  db.exec(`
        ALTER TABLE users
        ADD COLUMN password TEXT
    `);

  console.log("Added password column to users table.");
}

console.log("Database ready.");

module.exports = db;
