require("dotenv").config();

const db = require("./database");
const express = require("express");
const http = require("http");
const crypto = require("crypto");
const { Server } = require("socket.io");
const { sendEmail } = require("./email");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: "20kb" }));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));
app.use(express.static("public"));

// Password-reset tokens are stored hashed and can only be used once.
db.exec(`
  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// =========================================
// APPROVED ROOMS
// =========================================

const ALLOWED_ROOMS = new Set([
  "general",
  "gaming",
  "music",
  "movies",
  "sports",
  "technology",
  "random",
]);

app.get("/room/:roomId", (req, res) => {
  const requestedRoom = req.params.roomId;

  if (!ALLOWED_ROOMS.has(requestedRoom)) {
    return res.redirect("/room/general");
  }

  res.sendFile(__dirname + "/public/index.html");
});

const users = {};

// =========================================
// ACCOUNT RULES
// =========================================

const MIN_USERNAME_LENGTH = 3;
const MAX_USERNAME_LENGTH = 20;
const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 128;
const USERNAME_PATTERN = /^[A-Za-z0-9_]+$/;

function validateNewAccount(username, password) {
  if (
    username.length < MIN_USERNAME_LENGTH ||
    username.length > MAX_USERNAME_LENGTH
  ) {
    return `Username must be between ${MIN_USERNAME_LENGTH} and ${MAX_USERNAME_LENGTH} characters.`;
  }

  if (!USERNAME_PATTERN.test(username)) {
    return "Username can contain only letters, numbers, and underscores.";
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`;
  }

  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Password cannot be longer than ${MAX_PASSWORD_LENGTH} characters.`;
  }

  return null;
}

function validateEmailAddress(email) {
  if (typeof email !== "string" || email.length > 254) {
    return "Enter a valid email address.";
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return "Enter a valid email address.";
  }

  return null;
}

// =========================================
// TOKEN FUNCTIONS
// =========================================

function hashOneTimeToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };

    return entities[character];
  });
}

// Use localhost while developing on your Windows computer.
// APP_BASE_URL can be changed when the website is hosted online.

const APP_BASE_URL = (
  process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`
).replace(/\/+$/, "");

// =========================================
// LOGIN ATTEMPT PROTECTION
// Five failures within 15 minutes.
// =========================================

const loginFailures = new Map();

const MAX_LOGIN_FAILURES = 5;
const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;

function getLoginAttemptKey(socket, username) {
  const ipAddress = socket.handshake.address || "unknown";

  return `${ipAddress}:${username.toLowerCase()}`;
}

function getRecentLoginFailures(key) {
  const cutoff = Date.now() - LOGIN_FAILURE_WINDOW_MS;

  const recentAttempts = (loginFailures.get(key) || []).filter(
    (timestamp) => timestamp > cutoff,
  );

  if (recentAttempts.length > 0) {
    loginFailures.set(key, recentAttempts);
  } else {
    loginFailures.delete(key);
  }

  return recentAttempts;
}

function isLoginBlocked(key) {
  return getRecentLoginFailures(key).length >= MAX_LOGIN_FAILURES;
}

function recordFailedLogin(key) {
  const attempts = getRecentLoginFailures(key);

  attempts.push(Date.now());

  loginFailures.set(key, attempts);
}

function clearFailedLogins(key) {
  loginFailures.delete(key);
}

// =========================================
// ROOM COUNTS
// =========================================

function getRoomCounts() {
  const counts = {};

  Object.values(users).forEach((user) => {
    if (!user.roomId) {
      return;
    }

    if (!counts[user.roomId]) {
      counts[user.roomId] = 0;
    }

    counts[user.roomId]++;
  });

  return counts;
}

function broadcastRoomCounts() {
  io.emit("room-counts", getRoomCounts());
}

// =========================================
// ONE ACTIVE LOGIN PER ACCOUNT
// =========================================

function replaceOtherActiveSockets(
  userId,
  keepSocketId,
  restoringSessionToken = null,
  replacementMessage = "This account was signed in on another browser. Please log in again.",
) {
  let roomCountsChanged = false;

  for (const otherSocket of io.sockets.sockets.values()) {
    if (
      otherSocket.id === keepSocketId ||
      String(otherSocket.authenticatedUserId) !== String(userId)
    ) {
      continue;
    }

    const roomUser = users[otherSocket.id];

    if (
      otherSocket.sessionToken &&
      otherSocket.sessionToken !== restoringSessionToken
    ) {
      deleteSession(otherSocket.sessionToken);
    }

    if (roomUser) {
      otherSocket.to(roomUser.roomId).emit("user-left", {
        id: otherSocket.id,
        username: roomUser.username,
      });

      otherSocket.leave(roomUser.roomId);

      delete users[otherSocket.id];

      roomCountsChanged = true;
    }

    otherSocket.sessionToken = null;
    otherSocket.authenticatedUserId = null;
    otherSocket.authenticatedUsername = null;

    otherSocket.emit("session-replaced", {
      message: replacementMessage,
    });

    console.log("Previous login replaced for user ID:", userId);
  }

  if (roomCountsChanged) {
    broadcastRoomCounts();
  }
}

// =========================================
// PASSWORD FUNCTIONS
// =========================================

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");

  const hash = crypto.scryptSync(password, salt, 64).toString("hex");

  return `${salt}:${hash}`;
}

function verifyPassword(password, storedPassword) {
  if (typeof storedPassword !== "string") {
    return false;
  }

  const parts = storedPassword.split(":");

  if (parts.length !== 2) {
    return false;
  }

  const salt = parts[0];
  const storedHash = parts[1];

  const hash = crypto.scryptSync(password, salt, 64).toString("hex");

  const calculatedBuffer = Buffer.from(hash, "hex");
  const storedBuffer = Buffer.from(storedHash, "hex");

  if (calculatedBuffer.length !== storedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(calculatedBuffer, storedBuffer);
}

// =========================================
// SESSION MANAGEMENT
// =========================================

function hashSessionToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");

  const tokenHash = hashSessionToken(token);

  db.prepare(
    `
      INSERT INTO sessions
      (user_id, token_hash, expires_at)
      VALUES (?, ?, datetime('now', '+30 days'))
    `,
  ).run(userId, tokenHash);

  return token;
}

function getSessionUser(token) {
  if (typeof token !== "string" || !token) {
    return null;
  }

  return db
    .prepare(
      `
        SELECT
          users.id,
          users.username
        FROM sessions
        JOIN users
          ON sessions.user_id = users.id
        WHERE sessions.token_hash = ?
          AND sessions.expires_at > datetime('now')
          AND (
            users.email IS NULL
            OR users.email_verified_at IS NOT NULL
          )
      `,
    )
    .get(hashSessionToken(token));
}

function deleteSession(token) {
  if (typeof token !== "string" || !token) {
    return;
  }

  db.prepare(
    `
      DELETE FROM sessions
      WHERE token_hash = ?
    `,
  ).run(hashSessionToken(token));
}

// =========================================
// EMAIL VERIFICATION LINK
// Only token hashes are stored in the database.
// =========================================

app.get("/verify-email", (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";

  if (!/^[a-f0-9]{64}$/i.test(token)) {
    return res.status(400).send(`
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Email Verification</title>
        </head>
        <body style="font-family:Arial,sans-serif;max-width:600px;margin:60px auto;padding:20px;background:#222;color:#fff">
          <h1>Invalid verification link</h1>
          <p>This verification link is invalid.</p>
        </body>
      </html>
    `);
  }

  const record = db
    .prepare(
      `
        SELECT users.id
        FROM email_verification_tokens
        JOIN users
          ON users.id = email_verification_tokens.user_id
        WHERE email_verification_tokens.token_hash = ?
          AND email_verification_tokens.expires_at > datetime('now')
          AND users.email IS NOT NULL
      `,
    )
    .get(hashOneTimeToken(token));

  if (!record) {
    return res.status(400).send(`
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Email Verification</title>
        </head>
        <body style="font-family:Arial,sans-serif;max-width:600px;margin:60px auto;padding:20px;background:#222;color:#fff">
          <h1>Link expired or already used</h1>
          <p>This verification link is expired, invalid, or has already been used.</p>
          <p>Return to the website for assistance.</p>
        </body>
      </html>
    `);
  }

  const verifyEmailTransaction = db.transaction(() => {
    db.prepare(
      `
        UPDATE users
        SET email_verified_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
    ).run(record.id);

    db.prepare(
      `
        DELETE FROM email_verification_tokens
        WHERE user_id = ?
      `,
    ).run(record.id);
  });

  verifyEmailTransaction();

  console.log("Email verified for user ID:", record.id);

  return res.status(200).send(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <title>Email Verified</title>
      </head>
      <body style="font-family:Arial,sans-serif;max-width:600px;margin:60px auto;padding:20px;background:#222;color:#fff">
        <h1>Email verified successfully!</h1>
        <p>Your email address is now verified.</p>
        <p>Return to the Video Chat Room website and log in.</p>
      </body>
    </html>
  `);
});

// =========================================
// FORGOT PASSWORD / RESET PASSWORD PAGES
// =========================================

app.get("/forgot-password", (req, res) => {
  res.status(200).send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Forgot Password</title><style>
body{font-family:Arial,sans-serif;background:#171717;color:#f4f4f4;margin:0;padding:24px}
main{max-width:460px;margin:60px auto;background:#242424;padding:28px;border-radius:12px}
input,button{box-sizing:border-box;width:100%;padding:12px;margin:8px 0;border-radius:6px;font-size:16px}
input{border:1px solid #666;background:#111;color:#fff}button{border:0;background:#2864d7;color:white;cursor:pointer}
a{color:#9bbcff}#message{min-height:24px;line-height:1.4}
</style></head><body><main><h1>Forgot Password</h1>
<p>Enter the email address connected to your account. If an account matches, we'll email you a reset link.</p>
<form id="form"><label for="email">Email address</label><input id="email" type="email" maxlength="254" autocomplete="email" required>
<button id="submit" type="submit">Send Reset Link</button></form><p id="message" role="status" aria-live="polite"></p><p><a href="/">Return to login</a></p></main>
<script>document.getElementById('form').addEventListener('submit',async e=>{e.preventDefault();const b=document.getElementById('submit'),m=document.getElementById('message');b.disabled=true;m.textContent='Sending...';try{const r=await fetch('/api/forgot-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:document.getElementById('email').value.trim()})});const d=await r.json();m.textContent=d.message||'If the account exists, a reset email will be sent.';}catch(e){m.textContent='Unable to send the request right now. Please try again.';}finally{b.disabled=false;}});</script>
</body></html>`);
});

app.get("/reset-password", (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const safeToken = /^[a-f0-9]{64}$/i.test(token) ? token : "";
  res.status(200).send(
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reset Password</title><style>
body{font-family:Arial,sans-serif;background:#171717;color:#f4f4f4;margin:0;padding:24px}
main{max-width:460px;margin:60px auto;background:#242424;padding:28px;border-radius:12px}
input,button{box-sizing:border-box;width:100%;padding:12px;margin:8px 0;border-radius:6px;font-size:16px}
input{border:1px solid #666;background:#111;color:#fff}button{border:0;background:#2864d7;color:white;cursor:pointer}
.password-field{display:flex;align-items:stretch;gap:6px;width:100%;margin:8px 0}
.password-field input{flex:1 1 auto;width:0;min-width:0;margin:0}
.password-toggle{flex:0 0 auto;width:auto;padding:8px 12px;background:#444;border:1px solid #666;color:#fff;border-radius:6px;cursor:pointer}
.password-toggle:hover{background:#555}
a{color:#9bbcff}#message{min-height:24px;line-height:1.4}
</style></head><body><main><h1>Choose a New Password</h1>
<p>Your password must be between 12 and 128 characters.</p><form id="form"><label for="password">New password</label>
<div class="password-field"><input id="password" type="password" minlength="12" maxlength="128" autocomplete="new-password" required><button class="password-toggle" type="button" data-password-target="password" aria-pressed="false">Show</button></div>
<label for="confirm">Confirm new password</label><div class="password-field"><input id="confirm" type="password" minlength="12" maxlength="128" autocomplete="new-password" required><button class="password-toggle" type="button" data-password-target="confirm" aria-pressed="false">Show</button></div>
<button id="submit" type="submit">Reset Password</button></form><p id="message" role="status" aria-live="polite"></p><p><a href="/">Return to login</a></p></main>
<script>document.querySelectorAll('.password-toggle[data-password-target]').forEach(button=>{button.addEventListener('click',()=>{const input=document.getElementById(button.dataset.passwordTarget);if(!input)return;const show=input.type==='password';input.type=show?'text':'password';button.textContent=show?'Hide':'Show';button.setAttribute('aria-pressed',String(show));button.setAttribute('aria-label',(show?'Hide':'Show')+' password');});});const token=__TOKEN__;document.getElementById('form').addEventListener('submit',async e=>{e.preventDefault();const p=document.getElementById('password').value,c=document.getElementById('confirm').value,b=document.getElementById('submit'),m=document.getElementById('message');if(p!==c){m.textContent='The passwords do not match.';return;}if(p.length<12||p.length>128){m.textContent='Password must be between 12 and 128 characters.';return;}b.disabled=true;m.textContent='Resetting password...';try{const r=await fetch('/api/reset-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,password:p})});const d=await r.json();m.textContent=d.message||'Unable to reset password.';if(d.success){document.getElementById('form').reset();}}catch(e){m.textContent='Unable to reset password right now. Please try again.';}finally{b.disabled=false;}});</script>
</body></html>`.replace(
      "const token=__TOKEN__;",
      "const token=" + JSON.stringify(safeToken) + ";",
    ),
  );
});

// Always return the same public response so this endpoint doesn't reveal
// whether an email address has an account.
app.post("/api/forgot-password", async (req, res) => {
  const genericMessage =
    "If an account uses that email address, a password-reset link will be sent shortly.";
  const email =
    typeof req.body?.email === "string"
      ? req.body.email.trim().toLowerCase()
      : "";

  if (
    !email ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)
  ) {
    return res.status(200).json({ success: true, message: genericMessage });
  }

  try {
    const user = db
      .prepare(
        `SELECT id, username, email FROM users WHERE lower(email) = ? AND email_verified_at IS NOT NULL`,
      )
      .get(email);
    if (!user)
      return res.status(200).json({ success: true, message: genericMessage });

    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashOneTimeToken(token);
    db.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").run(
      user.id,
    );
    db.prepare(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, datetime('now', '+1 hour'))`,
    ).run(user.id, tokenHash);
    const resetUrl = `${APP_BASE_URL}/reset-password?token=${encodeURIComponent(token)}`;

    try {
      await sendEmail({
        to: user.email,
        subject: "Reset your Video Chat Room password",
        text: `Hello ${user.username},\n\nUse this link to reset your Video Chat Room password:\n\n${resetUrl}\n\nThis link expires in one hour and can only be used once. If you did not request a password reset, you can ignore this email.`,
        html: `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#222;line-height:1.5"><div style="max-width:600px;margin:0 auto;padding:24px"><h1>Reset your password</h1><p>Hello, ${escapeHtml(user.username)}.</p><p>Use the button below to choose a new password for your Video Chat Room account.</p><p style="margin:28px 0"><a href="${resetUrl}" style="display:inline-block;padding:12px 18px;background:#2864d7;color:#fff;text-decoration:none;border-radius:6px">Reset Password</a></p><p>This link expires in one hour and can only be used once.</p><p>If you did not request this, you can ignore this email.</p></div></body></html>`,
      });
    } catch (emailError) {
      console.error(
        "Password-reset email could not be sent:",
        emailError.message,
      );
      db.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").run(
        user.id,
      );
    }
  } catch (error) {
    console.error("Forgot-password request failed:", error.message);
  }

  return res.status(200).json({ success: true, message: genericMessage });
});

app.post("/api/reset-password", (req, res) => {
  const token = typeof req.body?.token === "string" ? req.body.token : "";
  const password =
    typeof req.body?.password === "string" ? req.body.password : "";

  if (!/^[a-f0-9]{64}$/i.test(token)) {
    return res.status(400).json({
      success: false,
      message: "This reset link is invalid or has expired. Request a new one.",
    });
  }
  if (
    password.length < MIN_PASSWORD_LENGTH ||
    password.length > MAX_PASSWORD_LENGTH
  ) {
    return res.status(400).json({
      success: false,
      message: `Password must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters long.`,
    });
  }

  const record = db
    .prepare(
      `SELECT users.id FROM password_reset_tokens JOIN users ON users.id = password_reset_tokens.user_id WHERE password_reset_tokens.token_hash = ? AND password_reset_tokens.expires_at > datetime('now') AND users.email_verified_at IS NOT NULL`,
    )
    .get(hashOneTimeToken(token));
  if (!record) {
    return res.status(400).json({
      success: false,
      message:
        "This reset link is invalid, expired, or already used. Request a new one.",
    });
  }

  try {
    const resetTransaction = db.transaction(() => {
      db.prepare("UPDATE users SET password = ? WHERE id = ?").run(
        hashPassword(password),
        record.id,
      );
      db.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").run(
        record.id,
      );
      db.prepare("DELETE FROM sessions WHERE user_id = ?").run(record.id);
    });
    resetTransaction();
    replaceOtherActiveSockets(
      record.id,
      null,
      null,
      "Your password was reset. Please log in again.",
    );
    return res.status(200).json({
      success: true,
      message:
        "Your password has been reset. Please return to the website and log in with your new password.",
    });
  } catch (error) {
    console.error("Password reset failed:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to reset the password right now. Please try again.",
    });
  }
});

// =========================================
// SOCKET.IO
// =========================================
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.emit("room-counts", getRoomCounts());

  socket.on("get-room-counts", () => {
    socket.emit("room-counts", getRoomCounts());
  });

  // =========================================
  // REGISTER
  // =========================================

  socket.on("register-user", async (payload = {}) => {
    const safePayload = payload && typeof payload === "object" ? payload : {};

    let { username, email, password } = safePayload;

    if (
      typeof username !== "string" ||
      typeof email !== "string" ||
      typeof password !== "string"
    ) {
      socket.emit("registration-result", {
        success: false,
        message: "Username, email address, and password are required.",
      });

      return;
    }

    username = username.trim();
    email = email.trim().toLowerCase();

    if (!username || !email || !password) {
      socket.emit("registration-result", {
        success: false,
        message: "Username, email address, and password are required.",
      });

      return;
    }

    const validationMessage = validateNewAccount(username, password);

    if (validationMessage) {
      socket.emit("registration-result", {
        success: false,
        message: validationMessage,
      });

      return;
    }

    const emailValidationMessage = validateEmailAddress(email);

    if (emailValidationMessage) {
      socket.emit("registration-result", {
        success: false,
        message: emailValidationMessage,
      });

      return;
    }

    let userId;

    const verificationToken = crypto.randomBytes(32).toString("hex");
    const verificationTokenHash = hashOneTimeToken(verificationToken);

    try {
      const createAccountTransaction = db.transaction(() => {
        const result = db
          .prepare(
            `
              INSERT INTO users
                (username, password, email)
              VALUES (?, ?, ?)
            `,
          )
          .run(username, hashPassword(password), email);

        const insertedUserId = Number(result.lastInsertRowid);

        db.prepare(
          `
            INSERT INTO email_verification_tokens
              (user_id, token_hash, expires_at)
            VALUES (?, ?, datetime('now', '+24 hours'))
          `,
        ).run(insertedUserId, verificationTokenHash);

        return insertedUserId;
      });

      userId = createAccountTransaction();
    } catch (error) {
      if (error.message && error.message.includes("UNIQUE constraint failed")) {
        socket.emit("registration-result", {
          success: false,
          message: "That username or email address is already in use.",
        });
      } else {
        console.error("Registration database error:", error);

        socket.emit("registration-result", {
          success: false,
          message: "Registration failed. Please try again.",
        });
      }

      return;
    }

    const verificationUrl = `${APP_BASE_URL}/verify-email?token=${encodeURIComponent(verificationToken)}`;

    try {
      await sendEmail({
        to: email,
        subject: "Verify your Video Chat Room email address",

        text:
          `Hello ${username},\n\n` +
          "Please verify your email address for your Video Chat Room account by opening this link:\n\n" +
          `${verificationUrl}\n\n` +
          "This link expires in 24 hours and can only be used once.\n\n" +
          "If you did not create this account, you can ignore this email.",

        html: `
          <!doctype html>
          <html>
            <body style="font-family:Arial,sans-serif;color:#222;line-height:1.5">
              <div style="max-width:600px;margin:0 auto;padding:24px">
                <h1 style="font-size:24px">Verify your email address</h1>
                <p>Hello, ${escapeHtml(username)}.</p>
                <p>Please verify the email address for your Video Chat Room account.</p>
                <p style="margin:28px 0">
                  <a
                    href="${verificationUrl}"
                    style="display:inline-block;padding:12px 18px;background:#2864d7;color:#fff;text-decoration:none;border-radius:6px"
                  >Verify email address</a>
                </p>
                <p>This link expires in 24 hours and can only be used once.</p>
                <p>If you did not create this account, you can ignore this email.</p>
              </div>
            </body>
          </html>
        `,
      });
    } catch (error) {
      console.error("Verification email could not be sent:", error.message);

      // Remove this newly created account if sending the verification
      // email fails, so the user can try again later.
      try {
        const removeUnverifiedAccount = db.transaction(() => {
          db.prepare(
            "DELETE FROM email_verification_tokens WHERE user_id = ?",
          ).run(userId);

          db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);

          db.prepare("DELETE FROM users WHERE id = ?").run(userId);
        });

        removeUnverifiedAccount();
      } catch (cleanupError) {
        console.error("Could not clean up failed registration:", cleanupError);
      }

      socket.emit("registration-result", {
        success: false,
        message:
          "We couldn't send the verification email, so the account was not created. Please try again later.",
      });

      return;
    }

    console.log(
      `Unverified account created; verification email sent to ${email}`,
    );

    // Do not create a login session until the email has been verified.
    socket.emit("registration-result", {
      success: true,
      requiresVerification: true,
      username,
      email,
      message:
        "Your account was created. Check your email and click the verification link before logging in.",
    });
  });

  // =========================================
  // LOGIN
  // =========================================

  socket.on("login-user", (payload = {}) => {
    const safePayload = payload && typeof payload === "object" ? payload : {};

    let { username, password } = safePayload;

    if (typeof username !== "string" || typeof password !== "string") {
      socket.emit("login-result", {
        success: false,
        message: "Username and password are required.",
      });

      return;
    }

    username = username.trim();

    if (!username || !password) {
      socket.emit("login-result", {
        success: false,
        message: "Username and password are required.",
      });

      return;
    }

    const attemptKey = getLoginAttemptKey(socket, username);

    if (isLoginBlocked(attemptKey)) {
      socket.emit("login-result", {
        success: false,
        message:
          "Too many failed login attempts. Please wait 15 minutes before trying again.",
      });

      return;
    }

    const user = db
      .prepare(
        `
          SELECT *
          FROM users
          WHERE username = ?
        `,
      )
      .get(username);

    if (!user || !verifyPassword(password, user.password)) {
      recordFailedLogin(attemptKey);

      socket.emit("login-result", {
        success: false,
        message: "Invalid username or password.",
      });

      return;
    }

    clearFailedLogins(attemptKey);

    if (user.email && !user.email_verified_at) {
      socket.emit("login-result", {
        success: false,
        requiresVerification: true,
        message:
          "Please verify your email address using the link we sent before logging in.",
      });

      return;
    }

    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);

    replaceOtherActiveSockets(user.id, socket.id);

    const sessionToken = createSession(user.id);

    socket.sessionToken = sessionToken;
    socket.authenticatedUserId = user.id;
    socket.authenticatedUsername = user.username;

    console.log(`User logged in: ${user.username}`);

    socket.emit("login-result", {
      success: true,
      userId: user.id,
      username: user.username,
      sessionToken,
    });
  });

  // =========================================
  // RESTORE SESSION
  // =========================================

  socket.on("restore-session", (payload = {}) => {
    const token =
      payload && typeof payload.token === "string" ? payload.token : "";

    const user = getSessionUser(token);

    if (!user) {
      socket.emit("session-result", {
        success: false,
      });

      return;
    }

    db.prepare(
      "DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?",
    ).run(user.id, hashSessionToken(token));

    replaceOtherActiveSockets(user.id, socket.id, token);

    socket.sessionToken = token;
    socket.authenticatedUserId = user.id;
    socket.authenticatedUsername = user.username;

    console.log(`Session restored: ${user.username}`);

    socket.emit("session-result", {
      success: true,
      userId: user.id,
      username: user.username,
    });
  });

  // =========================================
  // CHANGE PASSWORD
  // =========================================

  socket.on("change-password", (payload = {}) => {
    if (!socket.authenticatedUserId || !socket.authenticatedUsername) {
      socket.emit("password-change-result", {
        success: false,
        message: "You must be logged in to change your password.",
      });

      return;
    }

    const safePayload = payload && typeof payload === "object" ? payload : {};

    const { currentPassword, newPassword } = safePayload;

    if (
      typeof currentPassword !== "string" ||
      typeof newPassword !== "string" ||
      !currentPassword ||
      !newPassword
    ) {
      socket.emit("password-change-result", {
        success: false,
        message: "Enter your current password and a new password.",
      });

      return;
    }

    if (
      newPassword.length < MIN_PASSWORD_LENGTH ||
      newPassword.length > MAX_PASSWORD_LENGTH
    ) {
      socket.emit("password-change-result", {
        success: false,
        message: `New password must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters long.`,
      });

      return;
    }

    const user = db
      .prepare("SELECT id, username, password FROM users WHERE id = ?")
      .get(socket.authenticatedUserId);

    if (!user || !verifyPassword(currentPassword, user.password)) {
      socket.emit("password-change-result", {
        success: false,
        message: "Your current password is incorrect.",
      });

      return;
    }

    if (verifyPassword(newPassword, user.password)) {
      socket.emit("password-change-result", {
        success: false,
        message:
          "Your new password must be different from your current password.",
      });

      return;
    }

    try {
      const newPasswordHash = hashPassword(newPassword);

      db.prepare("UPDATE users SET password = ? WHERE id = ?").run(
        newPasswordHash,
        user.id,
      );

      db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);

      replaceOtherActiveSockets(
        user.id,
        socket.id,
        null,
        "Your account password was changed. Please log in again.",
      );

      const roomUser = users[socket.id];

      if (roomUser) {
        socket.to(roomUser.roomId).emit("user-left", {
          id: socket.id,
          username: roomUser.username,
        });

        for (const [otherId, otherUser] of Object.entries(users)) {
          if (otherId !== socket.id && otherUser.roomId === roomUser.roomId) {
            io.to(otherId).emit("camera-watcher", {
              id: socket.id,
              username: roomUser.username,
              watching: false,
            });
          }
        }

        socket.leave(roomUser.roomId);
        delete users[socket.id];

        broadcastRoomCounts();
      }

      socket.sessionToken = null;
      socket.authenticatedUserId = null;
      socket.authenticatedUsername = null;

      console.log(`Password changed for user: ${user.username}`);

      socket.emit("password-change-result", {
        success: true,
        message: "Password changed. Please log in with your new password.",
      });
    } catch (error) {
      console.error("Password change error:", error);

      socket.emit("password-change-result", {
        success: false,
        message: "Unable to change your password right now. Please try again.",
      });
    }
  });

  // =========================================
  // LOGOUT
  // =========================================

  socket.on("logout-user", () => {
    if (socket.sessionToken) {
      deleteSession(socket.sessionToken);
    }

    const user = users[socket.id];

    if (user) {
      console.log(`${user.username} logged out from room ${user.roomId}`);

      socket.to(user.roomId).emit("user-left", {
        id: socket.id,
        username: user.username,
      });

      delete users[socket.id];

      socket.leave(user.roomId);

      broadcastRoomCounts();
    } else {
      console.log(`${socket.authenticatedUsername || "User"} logged out`);
    }

    socket.sessionToken = null;
    socket.authenticatedUserId = null;
    socket.authenticatedUsername = null;
  });

  // =========================================
  // JOIN ROOM
  // =========================================

  socket.on("join-room", ({ roomId } = {}) => {
    if (!socket.authenticatedUserId || !socket.authenticatedUsername) {
      socket.emit("join-error", {
        message: "You must be logged in.",
      });

      return;
    }

    if (typeof roomId !== "string" || !ALLOWED_ROOMS.has(roomId)) {
      socket.emit("join-error", {
        message:
          "That room does not exist. Please choose a room from the room list.",
      });

      return;
    }

    const username = socket.authenticatedUsername;
    const oldUser = users[socket.id];

    if (oldUser && oldUser.roomId && oldUser.roomId !== roomId) {
      console.log(
        `${oldUser.username} left room ${oldUser.roomId} to join ${roomId}`,
      );

      socket.to(oldUser.roomId).emit("user-left", {
        id: socket.id,
        username: oldUser.username,
      });

      socket.leave(oldUser.roomId);

      for (const [otherId, otherUser] of Object.entries(users)) {
        if (otherId !== socket.id && otherUser.roomId === oldUser.roomId) {
          io.to(otherId).emit("camera-watcher", {
            id: socket.id,
            username: oldUser.username,
            watching: false,
          });
        }
      }

      delete users[socket.id];

      broadcastRoomCounts();
    }

    const existingUsers = Object.entries(users)
      .filter(([id, user]) => user.roomId === roomId)
      .map(([id, user]) => ({
        id,
        username: user.username,
        camera: Boolean(user.camera),
        microphone: Boolean(user.microphone),
      }));

    users[socket.id] = {
      roomId,
      username,
      userId: socket.authenticatedUserId,
      camera: false,
      microphone: false,
    };

    socket.join(roomId);

    console.log(`${username} joined room ${roomId}`);

    socket.emit("room-users", existingUsers);

    socket.to(roomId).emit("user-joined", {
      id: socket.id,
      username,
      camera: false,
      microphone: false,
    });

    broadcastRoomCounts();
  });

  // =========================================
  // CHAT HISTORY
  // =========================================

  socket.on("get-chat-history", ({ roomId } = {}) => {
    if (!socket.authenticatedUserId) {
      return;
    }

    const user = users[socket.id];

    if (!user) {
      return;
    }

    if (typeof roomId !== "string" || roomId !== user.roomId) {
      console.log("Chat history request rejected: wrong room.");
      return;
    }

    if (!socket.rooms.has(roomId) || !ALLOWED_ROOMS.has(roomId)) {
      console.log("Chat history request rejected: invalid membership.");
      return;
    }

    const history = db
      .prepare(
        `
          SELECT
            messages.id,
            messages.message,
            messages.created_at,
            users.username
          FROM messages
          JOIN users
            ON messages.user_id = users.id
          WHERE messages.room_id = ?
          ORDER BY messages.id ASC
        `,
      )
      .all(roomId);

    socket.emit("chat-history", history);
  });

  // =========================================
  // MEDIA STATE
  // =========================================

  socket.on("media-state", ({ camera, microphone } = {}) => {
    const user = users[socket.id];

    if (!user) {
      return;
    }

    user.camera = Boolean(camera);
    user.microphone = Boolean(microphone);

    socket.to(user.roomId).emit("media-state", {
      id: socket.id,
      username: user.username,
      camera: user.camera,
      microphone: user.microphone,
    });

    if (!user.camera) {
      socket.to(user.roomId).emit("remote-camera-off", {
        id: socket.id,
        username: user.username,
      });
    }
  });

  // =========================================
  // CAMERA WATCHING
  // =========================================

  socket.on("camera-watching", ({ target, watching } = {}) => {
    const watcher = users[socket.id];
    const targetUser = users[target];

    if (!watcher || !targetUser) {
      console.log("Camera watching rejected:", {
        watcher: socket.id,
        target,
      });

      return;
    }

    if (watcher.roomId !== targetUser.roomId) {
      console.log("Camera watching rejected: different rooms.");
      return;
    }

    console.log(
      `${watcher.username} ${
        watching ? "STARTED watching" : "STOPPED watching"
      } ${targetUser.username}'s camera`,
    );

    io.to(target).emit("camera-watch-status", {
      watcherId: socket.id,
      watcherUsername: watcher.username,
      watching: Boolean(watching),
    });
  });

  // =========================================
  // LEAVE ROOM
  // =========================================

  socket.on("leave-room", () => {
    const user = users[socket.id];

    if (!user) {
      return;
    }

    console.log(`${user.username} left room ${user.roomId}`);

    socket.to(user.roomId).emit("user-left", {
      id: socket.id,
      username: user.username,
    });

    for (const [otherId, otherUser] of Object.entries(users)) {
      if (otherId !== socket.id && otherUser.roomId === user.roomId) {
        io.to(otherId).emit("camera-watcher", {
          id: socket.id,
          username: user.username,
          watching: false,
        });
      }
    }

    socket.leave(user.roomId);

    delete users[socket.id];

    broadcastRoomCounts();
  });

  // =========================================
  // CHAT MESSAGE
  // =========================================

  socket.on("chat-message", (payload) => {
    if (!payload || typeof payload !== "object") {
      return;
    }

    const { roomId, message } = payload;

    if (!socket.authenticatedUserId || !socket.authenticatedUsername) {
      console.log("Chat message rejected: user not logged in.");
      return;
    }

    const user = users[socket.id];

    if (!user || user.userId !== socket.authenticatedUserId) {
      console.log("Chat message rejected: invalid account or room membership.");
      return;
    }

    if (typeof roomId !== "string" || !ALLOWED_ROOMS.has(roomId)) {
      console.log("Chat message rejected: invalid room.");
      return;
    }

    if (roomId !== user.roomId || !socket.rooms.has(roomId)) {
      console.log("Chat message rejected: wrong room.");
      return;
    }

    if (typeof message !== "string") {
      return;
    }

    const cleanMessage = message.trim();

    if (!cleanMessage || cleanMessage.length > 2000) {
      return;
    }

    db.prepare(
      `
        INSERT INTO messages
          (room_id, user_id, message)
        VALUES (?, ?, ?)
      `,
    ).run(user.roomId, socket.authenticatedUserId, cleanMessage);

    io.to(user.roomId).emit("chat-message", {
      username: user.username,
      message: cleanMessage,
    });
  });

  // =========================================
  // WEBRTC SIGNALING SECURITY
  // Both users must be authenticated and
  // present in the same approved room.
  // =========================================

  function getAuthorizedSignalingPair(target) {
    if (!socket.authenticatedUserId || !socket.authenticatedUsername) {
      return null;
    }

    const sender = users[socket.id];

    if (
      !sender ||
      sender.userId !== socket.authenticatedUserId ||
      !ALLOWED_ROOMS.has(sender.roomId) ||
      !socket.rooms.has(sender.roomId)
    ) {
      return null;
    }

    if (typeof target !== "string" || !target || target === socket.id) {
      return null;
    }

    const targetUser = users[target];
    const targetSocket = io.sockets.sockets.get(target);

    if (!targetUser || !targetSocket) {
      return null;
    }

    if (
      !targetSocket.authenticatedUserId ||
      !targetSocket.authenticatedUsername ||
      targetUser.userId !== targetSocket.authenticatedUserId ||
      targetUser.roomId !== sender.roomId ||
      !targetSocket.rooms.has(sender.roomId)
    ) {
      return null;
    }

    return {
      sender,
      targetUser,
      targetSocket,
    };
  }

  // =========================================
  // OFFER
  // =========================================

  socket.on("offer", (payload = {}) => {
    const { target, offer } = payload;
    const pair = getAuthorizedSignalingPair(target);

    if (!pair) {
      console.log("WebRTC offer rejected: invalid room membership.");
      return;
    }

    if (
      !offer ||
      typeof offer !== "object" ||
      offer.type !== "offer" ||
      typeof offer.sdp !== "string"
    ) {
      console.log("WebRTC offer rejected: invalid offer.");
      return;
    }

    pair.targetSocket.emit("offer", {
      sender: socket.id,
      offer,
    });
  });

  // =========================================
  // ANSWER
  // =========================================

  socket.on("answer", (payload = {}) => {
    const { target, answer } = payload;
    const pair = getAuthorizedSignalingPair(target);

    if (!pair) {
      console.log("WebRTC answer rejected: invalid room membership.");
      return;
    }

    if (
      !answer ||
      typeof answer !== "object" ||
      answer.type !== "answer" ||
      typeof answer.sdp !== "string"
    ) {
      console.log("WebRTC answer rejected: invalid answer.");
      return;
    }

    pair.targetSocket.emit("answer", {
      sender: socket.id,
      answer,
    });
  });

  // =========================================
  // ICE CANDIDATE
  // =========================================

  socket.on("ice-candidate", (payload = {}) => {
    const { target, candidate } = payload;
    const pair = getAuthorizedSignalingPair(target);

    if (!pair) {
      console.log("ICE candidate rejected: invalid room membership.");
      return;
    }

    if (
      !candidate ||
      typeof candidate !== "object" ||
      typeof candidate.candidate !== "string"
    ) {
      console.log("ICE candidate rejected: invalid candidate.");
      return;
    }

    pair.targetSocket.emit("ice-candidate", {
      sender: socket.id,
      candidate,
    });
  });

  // =========================================
  // DISCONNECT
  // =========================================

  socket.on("disconnect", () => {
    const user = users[socket.id];

    if (user) {
      console.log(`${user.username} disconnected from room ${user.roomId}`);

      socket.to(user.roomId).emit("user-left", {
        id: socket.id,
        username: user.username,
      });

      for (const [otherId, otherUser] of Object.entries(users)) {
        if (otherId !== socket.id && otherUser.roomId === user.roomId) {
          io.to(otherId).emit("camera-watcher", {
            id: socket.id,
            username: user.username,
            watching: false,
          });
        }
      }

      delete users[socket.id];

      broadcastRoomCounts();
    }

    console.log("User disconnected:", socket.id);
  });
});

// =========================================
// START SERVER
// =========================================

const PORT = Number(process.env.PORT || 3000);

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
