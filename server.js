const db = require("./database");
const express = require("express");
const http = require("http");
const crypto = require("crypto");
const { Server } = require("socket.io");

const app = express();

const server = http.createServer(app);

const io = new Server(server);

app.use(express.static("public"));

app.get("/room/:roomId", (req, res) => {
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

  return crypto.timingSafeEqual(
    Buffer.from(hash, "hex"),
    Buffer.from(storedHash, "hex"),
  );
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
    `,
    )
    .get(hashSessionToken(token));
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

  // =========================================
  // SEND CURRENT ROOM COUNTS
  // =========================================

  socket.emit("room-counts", getRoomCounts());

  // =========================================
  // REGISTER
  // =========================================

  socket.on("register-user", ({ username, password }) => {
    username = username.trim();

    if (!username || !password) {
      socket.emit("registration-result", {
        success: false,
        message: "Username and password are required.",
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

      console.log(`User registered: ${username}`);

      socket.emit("registration-result", {
        success: true,
        userId: result.lastInsertRowid,
        username: username,
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

  socket.on("login-user", ({ username, password }) => {
    username = username.trim();

    const user = db
      .prepare(
        `
          SELECT *
          FROM users
          WHERE username = ?
        `,
      )
      .get(username);

    if (!user) {
      socket.emit("login-result", {
        success: false,
        message: "Invalid username or password.",
      });

      return;
    }

    if (!verifyPassword(password, user.password)) {
      socket.emit("login-result", {
        success: false,
        message: "Invalid username or password.",
      });

      return;
    }

    const sessionToken = createSession(user.id);

    socket.sessionToken = sessionToken;

    socket.authenticatedUserId = user.id;

    socket.authenticatedUsername = user.username;

    console.log(`User logged in: ${user.username}`);

    socket.emit("login-result", {
      success: true,
      userId: user.id,
      username: user.username,
      sessionToken: sessionToken,
    });
  });

  // =========================================
  // RESTORE SESSION
  // =========================================

  socket.on("restore-session", ({ token }) => {
    const user = getSessionUser(token);

    if (!user) {
      socket.emit("session-result", {
        success: false,
      });

      return;
    }

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

  socket.on("join-room", ({ roomId, username }) => {
    if (!socket.authenticatedUserId) {
      socket.emit("join-error", {
        message: "You must be logged in.",
      });

      return;
    }

    // =========================================
    // REMOVE THIS SOCKET FROM ANY OLD ROOM
    // =========================================

    const oldUser = users[socket.id];

    if (oldUser && oldUser.roomId && oldUser.roomId !== roomId) {
      console.log(
        `${oldUser.username} left room ${oldUser.roomId} to join ${roomId}`,
      );

      socket.to(oldUser.roomId).emit("user-left", {
        id: socket.id,
        username: oldUser.username,
      });

      // Remove from the old Socket.IO room.
      socket.leave(oldUser.roomId);

      // Remove this user from camera-watcher lists.
      for (const [otherId, otherUser] of Object.entries(users)) {
        if (otherId !== socket.id && otherUser.roomId === oldUser.roomId) {
          io.to(otherId).emit("camera-watcher", {
            id: socket.id,
            username: oldUser.username,
            watching: false,
          });
        }
      }

      // Remove the old room membership.
      delete users[socket.id];

      // Update the old room count immediately.
      broadcastRoomCounts();
    }

    // =========================================
    // GET EXISTING USERS IN NEW ROOM
    // =========================================

    const existingUsers = Object.entries(users)
      .filter(([id, user]) => user.roomId === roomId)
      .map(([id, user]) => ({
        id: id,
        username: user.username,
        camera: Boolean(user.camera),
        microphone: Boolean(user.microphone),
      }));

    // =========================================
    // ADD USER TO NEW ROOM
    // =========================================

    users[socket.id] = {
      roomId: roomId,
      username: username,
      userId: socket.authenticatedUserId,
      camera: false,
      microphone: false,
    };

    socket.join(roomId);

    console.log(`${username} joined room ${roomId}`);

    // Tell the NEW user who is already in the room.
    // The new user will initiate the WebRTC connections.
    socket.emit("room-users", existingUsers);

    // Tell everyone else that this user joined.
    // This updates their People in Room list.
    socket.to(roomId).emit("user-joined", {
      id: socket.id,
      username: username,
      camera: false,
      microphone: false,
    });

    // Update room counts for everybody.
    broadcastRoomCounts();

    // IMPORTANT:
    // Do NOT send start-connection to the existing users.
    //
    // The new user already received existingUsers above
    // and will call startConnection() for each existing user.
    //
    // Sending start-connection here too would make BOTH
    // sides create offers at the same time.
  });

  // =========================================
  // CHAT HISTORY
  // =========================================

  socket.on("get-chat-history", ({ roomId }) => {
    if (!socket.authenticatedUserId) {
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

  socket.on("media-state", ({ camera, microphone }) => {
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
  });

  // =========================================
  // CAMERA WATCHING
  // =========================================

  socket.on("camera-watching", ({ target, watching }) => {
    const watcher = users[socket.id];

    const targetUser = users[target];

    if (!watcher || !targetUser) {
      return;
    }

    socket.to(target).emit("camera-watcher", {
      id: socket.id,
      username: watcher.username,
      watching: Boolean(watching),
    });

    console.log(
      `${watcher.username} ${
        watching ? "is watching" : "stopped watching"
      } ${targetUser.username}'s camera`,
    );
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

    // Remove this user from camera-watcher lists.
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

    // Update room counts for everybody.
    broadcastRoomCounts();
  });

  // =========================================
  // CHAT MESSAGE
  // =========================================

  socket.on("chat-message", ({ roomId, message }) => {
    if (!socket.authenticatedUserId) {
      return;
    }

    const user = users[socket.id];

    if (!user) {
      return;
    }

    message = message.trim();

    if (!message) {
      return;
    }

    db.prepare(
      `
        INSERT INTO messages
        (room_id, user_id, message)
        VALUES (?, ?, ?)
      `,
    ).run(roomId, socket.authenticatedUserId, message);

    io.to(roomId).emit("chat-message", {
      username: socket.authenticatedUsername,
      message: message,
    });
  });

  // =========================================
  // OFFER
  // =========================================

  socket.on("offer", ({ target, offer }) => {
    socket.to(target).emit("offer", {
      sender: socket.id,
      offer: offer,
    });
  });

  // =========================================
  // ANSWER
  // =========================================

  socket.on("answer", ({ target, answer }) => {
    socket.to(target).emit("answer", {
      sender: socket.id,
      answer: answer,
    });
  });

  // =========================================
  // ICE CANDIDATE
  // =========================================

  socket.on("ice-candidate", ({ target, candidate }) => {
    socket.to(target).emit("ice-candidate", {
      sender: socket.id,
      candidate: candidate,
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

      // Remove this user from camera-watcher lists.
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

      // Update room counts for everybody.
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
