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
// Only room IDs in this list can be joined.
// Keep these IDs synchronized with the room list in the client.
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
  // ROOM COUNTS REQUEST
  // =========================================

  socket.on("get-room-counts", () => {
    socket.emit("room-counts", getRoomCounts());
  });

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

      const sessionToken = createSession(result.lastInsertRowid);

      socket.sessionToken = sessionToken;
      socket.authenticatedUserId = result.lastInsertRowid;
      socket.authenticatedUsername = username;

      socket.emit("registration-result", {
        success: true,
        userId: result.lastInsertRowid,
        username: username,
        sessionToken: sessionToken,
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

  socket.on("join-room", ({ roomId }) => {
    if (!socket.authenticatedUserId || !socket.authenticatedUsername) {
      socket.emit("join-error", {
        message: "You must be logged in.",
      });

      return;
    }

    // =========================================
    // VALIDATE ROOM
    // Reject unknown rooms BEFORE leaving the
    // user's current room.
    // =========================================

    if (typeof roomId !== "string" || !ALLOWED_ROOMS.has(roomId)) {
      socket.emit("join-error", {
        message:
          "That room does not exist. Please choose a room from the room list.",
      });

      return;
    }

    // Always use the username attached to the
    // authenticated account.
    // Never trust a username supplied by the browser.

    const username = socket.authenticatedUsername;

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
    socket.emit("room-users", existingUsers);

    // Tell everyone else that this user joined.
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
  // CHAT HISTORY - SECURITY CHECKS
  // =========================================

  socket.on("get-chat-history", ({ roomId } = {}) => {
    // The user must be authenticated.
    if (!socket.authenticatedUserId) {
      return;
    }

    // The user must actually be in a room.
    const user = users[socket.id];

    if (!user) {
      return;
    }

    // Only allow history for the user's current room.
    if (typeof roomId !== "string" || roomId !== user.roomId) {
      console.log("Chat history request rejected: wrong room.");
      return;
    }

    // Confirm that the socket is still a member of that room.
    if (!socket.rooms.has(roomId)) {
      console.log("Chat history request rejected: not a room member.");
      return;
    }

    // Only approved rooms are valid.
    if (!ALLOWED_ROOMS.has(roomId)) {
      return;
    }

    // Retrieve history only after all security checks pass.
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

    // Tell everyone else about the media change.
    socket.to(user.roomId).emit("media-state", {
      id: socket.id,
      username: user.username,
      camera: user.camera,
      microphone: user.microphone,
    });

    // Explicitly tell everyone else when the camera goes OFF.
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

  socket.on("camera-watching", ({ target, watching }) => {
    const watcher = users[socket.id];

    const targetUser = users[target];

    if (!watcher || !targetUser) {
      console.log("Camera watching rejected:", {
        watcher: socket.id,
        target: target,
      });

      return;
    }

    if (watcher.roomId !== targetUser.roomId) {
      console.log("Camera watching rejected: different rooms");

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
  // CHAT MESSAGE - SECURITY CHECKS
  // =========================================

  socket.on("chat-message", (payload) => {
    // Validate the incoming data.
    if (!payload || typeof payload !== "object") {
      return;
    }

    const { roomId, message } = payload;

    // The sender must be logged in.
    if (!socket.authenticatedUserId || !socket.authenticatedUsername) {
      console.log("Chat message rejected: user not logged in.");
      return;
    }

    // The sender must currently be in a room.
    const user = users[socket.id];

    if (!user) {
      console.log("Chat message rejected: user is not in a room.");
      return;
    }

    // The sender must belong to the authenticated account.
    if (user.userId !== socket.authenticatedUserId) {
      console.log("Chat message rejected: account mismatch.");
      return;
    }

    // Only approved rooms are allowed.
    if (typeof roomId !== "string" || !ALLOWED_ROOMS.has(roomId)) {
      console.log("Chat message rejected: invalid room.");
      return;
    }

    // The message must target the room the sender actually joined.
    if (roomId !== user.roomId) {
      console.log("Chat message rejected: wrong room.");
      return;
    }

    // Verify Socket.IO still recognizes the room membership.
    if (!socket.rooms.has(roomId)) {
      console.log("Chat message rejected: not a room member.");
      return;
    }

    // Validate and trim the message.
    if (typeof message !== "string") {
      return;
    }

    const cleanMessage = message.trim();

    if (!cleanMessage || cleanMessage.length > 2000) {
      return;
    }

    // Save the message using the authenticated user's database ID.
    db.prepare(
      `
        INSERT INTO messages
        (room_id, user_id, message)
        VALUES (?, ?, ?)
      `,
    ).run(user.roomId, socket.authenticatedUserId, cleanMessage);

    // Broadcast only to members of the sender's actual room.
    io.to(user.roomId).emit("chat-message", {
      username: user.username,
      message: cleanMessage,
    });
  });

  // =========================================
  // WEBRTC SIGNALING SECURITY
  // Verify both users belong to the same room.
  // =========================================

  function getAuthorizedSignalingPair(target) {
    // The sender must be authenticated.
    if (!socket.authenticatedUserId || !socket.authenticatedUsername) {
      return null;
    }

    // The sender must be a registered member of a room.
    const sender = users[socket.id];

    if (!sender) {
      return null;
    }

    // The sender's room membership must match their account.
    if (sender.userId !== socket.authenticatedUserId) {
      return null;
    }

    // The sender must belong to an approved room.
    if (!ALLOWED_ROOMS.has(sender.roomId) || !socket.rooms.has(sender.roomId)) {
      return null;
    }

    // The target must be a different socket.
    if (typeof target !== "string" || !target || target === socket.id) {
      return null;
    }

    // The target must currently be in a room.
    const targetUser = users[target];

    const targetSocket = io.sockets.sockets.get(target);

    if (!targetUser || !targetSocket) {
      return null;
    }

    // The target must also be authenticated.
    if (
      !targetSocket.authenticatedUserId ||
      !targetSocket.authenticatedUsername
    ) {
      return null;
    }

    // Verify the target's room membership matches their account.
    if (targetUser.userId !== targetSocket.authenticatedUserId) {
      return null;
    }

    // Both users must be in the SAME room.
    if (targetUser.roomId !== sender.roomId) {
      return null;
    }

    // Verify Socket.IO confirms the target is in that room.
    if (!targetSocket.rooms.has(sender.roomId)) {
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

    // Validate the offer structure.
    if (
      !offer ||
      typeof offer !== "object" ||
      offer.type !== "offer" ||
      typeof offer.sdp !== "string"
    ) {
      console.log("WebRTC offer rejected: invalid offer.");
      return;
    }

    // Send the offer directly to the authorized target.
    pair.targetSocket.emit("offer", {
      sender: socket.id,
      offer: offer,
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

    // Validate the answer structure.
    if (
      !answer ||
      typeof answer !== "object" ||
      answer.type !== "answer" ||
      typeof answer.sdp !== "string"
    ) {
      console.log("WebRTC answer rejected: invalid answer.");
      return;
    }

    // Send the answer directly to the authorized target.
    pair.targetSocket.emit("answer", {
      sender: socket.id,
      answer: answer,
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

    // Validate the ICE candidate.
    if (
      !candidate ||
      typeof candidate !== "object" ||
      typeof candidate.candidate !== "string"
    ) {
      console.log("ICE candidate rejected: invalid candidate.");
      return;
    }

    // Send the candidate directly to the authorized target.
    pair.targetSocket.emit("ice-candidate", {
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
