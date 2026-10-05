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

// PASSWORD HASHING

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");

  const hash = crypto.scryptSync(password, salt, 64).toString("hex");

  return `${salt}:${hash}`;
}

// REGISTER USER

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("register-user", ({ username, password }) => {
    if (!username || !password) {
      socket.emit("registration-result", {
        success: false,
        message: "Username and password are required.",
      });

      return;
    }

    const existingUser = db
      .prepare(
        `
            SELECT id
            FROM users
            WHERE username = ?
          `,
      )
      .get(username);

    if (existingUser) {
      socket.emit("registration-result", {
        success: false,
        message: "That username is already taken.",
      });

      return;
    }

    const passwordHash = hashPassword(password);

    const result = db
      .prepare(
        `
            INSERT INTO users (
              username,
              password
            )
            VALUES (?, ?)
          `,
      )
      .run(username, passwordHash);

    const userId = Number(result.lastInsertRowid);

    console.log(`New user registered: ${username} (ID ${userId})`);

    socket.emit("registration-result", {
      success: true,
      message: "Account created successfully.",
      userId: userId,
      username: username,
    });
  });

  // JOIN ROOM

  socket.on("join-room", ({ roomId, username }) => {
    socket.join(roomId);

    const databaseUser = db
      .prepare(
        `
            INSERT INTO users (username)
            VALUES (?)
          `,
      )
      .run(username);

    const userId = Number(databaseUser.lastInsertRowid);

    users[socket.id] = {
      roomId: roomId,

      username: username,

      userId: userId,

      camera: false,

      microphone: false,
    };

    console.log(
      `${username} joined room ${roomId} with database user ID ${userId}`,
    );

    const roomUsers = Object.keys(users)
      .filter((id) => {
        return users[id].roomId === roomId && id !== socket.id;
      })
      .map((id) => ({
        id: id,

        username: users[id].username,

        camera: users[id].camera,

        microphone: users[id].microphone,
      }));

    socket.emit("room-users", roomUsers);

    socket.to(roomId).emit("user-joined", {
      id: socket.id,

      username: username,

      camera: false,

      microphone: false,
    });

    roomUsers.forEach((user) => {
      socket.emit("start-connection", user);
    });
  });

  // GET CHAT HISTORY

  socket.on("get-chat-history", (roomId) => {
    const messages = db
      .prepare(
        `
            SELECT
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

    socket.emit("chat-history", messages);
  });

  // MEDIA STATE

  socket.on("media-state", ({ camera, microphone }) => {
    const user = users[socket.id];

    if (!user) {
      return;
    }

    user.camera = Boolean(camera);

    user.microphone = Boolean(microphone);

    console.log(`${user.username} media:`, {
      camera: user.camera,
      microphone: user.microphone,
    });

    socket.to(user.roomId).emit("media-state", {
      id: socket.id,

      username: user.username,

      camera: user.camera,

      microphone: user.microphone,
    });
  });

  // LEAVE ROOM

  socket.on("leave-room", () => {
    const user = users[socket.id];

    if (!user) {
      console.log("leave-room received, but user was not found.");

      return;
    }

    console.log(`${user.username} clicked Leave in room ${user.roomId}`);

    socket.to(user.roomId).emit("user-left", {
      id: socket.id,

      username: user.username,
    });

    delete users[socket.id];

    socket.leave(user.roomId);

    console.log(`${user.username} was removed from room ${user.roomId}`);
  });

  // CHAT MESSAGE

  socket.on("chat-message", ({ roomId, message }) => {
    const user = users[socket.id];

    if (!user) {
      return;
    }

    db.prepare(
      `
          INSERT INTO messages (
            room_id,
            user_id,
            message
          )
          VALUES (?, ?, ?)
        `,
    ).run(roomId, user.userId, message);

    io.to(roomId).emit("chat-message", {
      username: user.username,

      message: message,
    });
  });

  // OFFER

  socket.on("offer", ({ target, offer }) => {
    io.to(target).emit("offer", {
      sender: socket.id,

      offer: offer,
    });
  });

  // ANSWER

  socket.on("answer", ({ target, answer }) => {
    io.to(target).emit("answer", {
      sender: socket.id,

      answer: answer,
    });
  });

  // ICE CANDIDATE

  socket.on("ice-candidate", ({ target, candidate }) => {
    io.to(target).emit("ice-candidate", {
      sender: socket.id,

      candidate: candidate,
    });
  });

  // DISCONNECT

  socket.on("disconnect", () => {
    const user = users[socket.id];

    if (user) {
      socket.to(user.roomId).emit("user-left", {
        id: socket.id,

        username: user.username,
      });

      console.log(`${user.username} disconnected from room ${user.roomId}`);

      delete users[socket.id];
    }
  });
});

const PORT = 3000;

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
