const db = require("./database");
const express = require("express");
const http = require("http");
const crypto = require("crypto");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

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
) {
  let roomCountsChanged = false;

  for (const otherSocket of io.sockets.sockets.values()) {
    if (
      otherSocket.id === keepSocketId ||
      String(otherSocket.authenticatedUserId) !== String(userId)
    ) {
      continue;
    }

    // During a refresh, only replace the previous socket
    // that is using the SAME session token.
    //
    // Never allow an older session to kick out a different
    // active session just because its page was refreshed.
    if (
      restoringSessionToken &&
      otherSocket.sessionToken !== restoringSessionToken
    ) {
      continue;
    }

    const roomUser = users[otherSocket.id];

    if (roomUser) {
      otherSocket.to(roomUser.roomId).emit("user-left", {
        id: otherSocket.id,
        username: roomUser.username,
      });

      // Remove this user from camera-watcher lists.
      for (const [otherId, otherUser] of Object.entries(users)) {
        if (
          otherId !== otherSocket.id &&
          otherUser.roomId === roomUser.roomId
        ) {
          io.to(otherId).emit("camera-watcher", {
            id: otherSocket.id,
            username: roomUser.username,
            watching: false,
          });
        }
      }

      otherSocket.leave(roomUser.roomId);
      delete users[otherSocket.id];

      roomCountsChanged = true;
    }

    // Invalidate the old socket's authentication.
    otherSocket.sessionToken = null;
    otherSocket.authenticatedUserId = null;
    otherSocket.authenticatedUsername = null;

    // A new login replaces the previous browser.
    // A page refresh replaces only the old socket using
    // the same session token and does not show a logout warning.
    if (!restoringSessionToken) {
      otherSocket.emit("session-replaced", {
        message:
          "This account was signed in on another browser. Please log in again.",
      });
    }

    console.log("Previous connection replaced for user ID:", userId);
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
  const parts = storedPassword.split(":");

  if (parts.length !== 2) {
    return false;
  }

  const salt = parts[0];
  const storedHash = parts[1];

  const hash = crypto.scryptSync(password, salt, 64).toString("hex");

  const expected = Buffer.from(storedHash, "hex");
  const actual = Buffer.from(hash, "hex");

  if (expected.length !== actual.length) {
    return false;
  }

  return crypto.timingSafeEqual(actual, expected);
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
  if (!token) {
    return null;
  }

  return (
    db
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
        `,
      )
      .get(hashSessionToken(token)) || null
  );
}

function deleteSession(token) {
  if (!token) {
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
// SOCKET.IO
// =========================================

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.emit("room-counts", getRoomCounts());

  // =========================================
  // ROOM COUNTS REQUEST
  // =========================================

  socket.on("get-room-counts", () => {
    socket.emit("room-counts", getRoomCounts());
  });

  // =========================================
  // REGISTER
  // =========================================

  socket.on("register-user", (payload = {}) => {
    let { username, password } = payload;

    if (typeof username !== "string" || typeof password !== "string") {
      socket.emit("registration-result", {
        success: false,
        message: "Username and password are required.",
      });

      return;
    }

    username = username.trim();

    if (!username || password.length < 6 || password.length > 128) {
      socket.emit("registration-result", {
        success: false,
        message: "Enter a username and a password of 6–128 characters.",
      });

      return;
    }

    try {
      const passwordHash = hashPassword(password);

      const result = db
        .prepare(
          `
            INSERT INTO users
            (username, password)
            VALUES (?, ?)
          `,
        )
        .run(username, passwordHash);

      const userId = result.lastInsertRowid;
      const sessionToken = createSession(userId);

      socket.sessionToken = sessionToken;
      socket.authenticatedUserId = userId;
      socket.authenticatedUsername = username;

      console.log(`User registered: ${username}`);

      socket.emit("registration-result", {
        success: true,
        userId,
        username,
        sessionToken,
      });
    } catch (error) {
      if (error.message.includes("UNIQUE constraint failed")) {
        socket.emit("registration-result", {
          success: false,
          message: "Username already exists.",
        });
      } else {
        console.error("Registration error:", error);

        socket.emit("registration-result", {
          success: false,
          message: "Registration failed.",
        });
      }
    }
  });

  // =========================================
  // LOGIN
  // =========================================

  socket.on("login-user", (payload = {}) => {
    let { username, password } = payload;

    if (typeof username !== "string" || typeof password !== "string") {
      socket.emit("login-result", {
        success: false,
        message: "Invalid username or password.",
      });

      return;
    }

    username = username.trim();

    if (!username || !password || password.length > 128) {
      socket.emit("login-result", {
        success: false,
        message: "Invalid username or password.",
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
      socket.emit("login-result", {
        success: false,
        message: "Invalid username or password.",
      });

      return;
    }

    // IMPORTANT:
    // A successful new login invalidates every previous saved
    // session for this account before creating the new one.
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);

    // Immediately remove other active browser connections.
    replaceOtherActiveSockets(user.id, socket.id);

    // Create the single new active session.
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
    const { token } = payload;

    const user = getSessionUser(token);

    if (!user) {
      socket.emit("session-result", {
        success: false,
      });

      return;
    }

    // IMPORTANT:
    // Do NOT delete other session records here.
    //
    // Only a successful new login should replace the account's
    // session. A page refresh must not invalidate another browser.
    //
    // Replace an old socket only if it is using this exact token.
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
      socket.leave(user.roomId);

      broadcastRoomCounts();
    }

    socket.sessionToken = null;
    socket.authenticatedUserId = null;
    socket.authenticatedUsername = null;
  });

  // =========================================
  // JOIN ROOM
  // =========================================

  socket.on("join-room", (payload = {}) => {
    const { roomId } = payload;

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

  socket.on("get-chat-history", (payload = {}) => {
    const { roomId } = payload;

    if (!socket.authenticatedUserId) {
      return;
    }

    const user = users[socket.id];

    if (
      !user ||
      typeof roomId !== "string" ||
      roomId !== user.roomId ||
      !socket.rooms.has(roomId) ||
      !ALLOWED_ROOMS.has(roomId)
    ) {
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

  socket.on("media-state", (payload = {}) => {
    const { camera, microphone } = payload;
    const user = users[socket.id];

    if (!user || user.userId !== socket.authenticatedUserId) {
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

  socket.on("camera-watching", (payload = {}) => {
    const { target, watching } = payload;
    const watcher = users[socket.id];
    const targetUser = users[target];

    if (!watcher || !targetUser) {
      return;
    }

    if (
      watcher.userId !== socket.authenticatedUserId ||
      watcher.roomId !== targetUser.roomId
    ) {
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
    const user = users[socket.id];

    if (
      !socket.authenticatedUserId ||
      !socket.authenticatedUsername ||
      !user ||
      user.userId !== socket.authenticatedUserId ||
      typeof roomId !== "string" ||
      !ALLOWED_ROOMS.has(roomId) ||
      roomId !== user.roomId ||
      !socket.rooms.has(roomId) ||
      typeof message !== "string"
    ) {
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

    if (
      !pair ||
      !offer ||
      typeof offer !== "object" ||
      offer.type !== "offer" ||
      typeof offer.sdp !== "string"
    ) {
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

    if (
      !pair ||
      !answer ||
      typeof answer !== "object" ||
      answer.type !== "answer" ||
      typeof answer.sdp !== "string"
    ) {
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

    if (
      !pair ||
      !candidate ||
      typeof candidate !== "object" ||
      typeof candidate.candidate !== "string"
    ) {
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
// SERVER
// =========================================

const PORT = 3000;

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
