const socket = io();

// =========================================
// BUTTONS
// =========================================

const muteButton = document.getElementById("muteButton");
const cameraButton = document.getElementById("cameraButton");
const screenButton = document.getElementById("screenButton");
const logoutButton = document.getElementById("logoutButton");

const topLoginButton = document.getElementById("topLoginButton");

const topCreateAccountButton = document.getElementById(
  "topCreateAccountButton",
);

// =========================================
// REGISTRATION
// =========================================

const accountArea = document.getElementById("accountArea");

const registerUsernameInput = document.getElementById("registerUsernameInput");

const registerPasswordInput = document.getElementById("registerPasswordInput");

const registerButton = document.getElementById("registerButton");

const registrationMessage = document.getElementById("registrationMessage");

const closeAccountButton = document.getElementById("closeAccountButton");

// =========================================
// LOGIN
// =========================================

const loginArea = document.getElementById("loginArea");

const loginUsernameInput = document.getElementById("loginUsernameInput");

const loginPasswordInput = document.getElementById("loginPasswordInput");

const loginButton = document.getElementById("loginButton");

const loginMessage = document.getElementById("loginMessage");

const closeLoginButton = document.getElementById("closeLoginButton");

// =========================================
// TOP BAR
// =========================================

const topBar = document.getElementById("topBar");

const topBarLeft = document.getElementById("topBarLeft");

const topBarCenter = document.getElementById("topBarCenter");

const topBarRight = document.getElementById("topBarRight");

const loginStatusText = document.getElementById("loginStatusText");

// =========================================
// ROOM
// =========================================

const roomSelection = document.getElementById("roomSelection");

const roomInfo = document.getElementById("roomInfo");

const copyLinkButton = document.getElementById("copyLinkButton");

const roomRows = document.querySelectorAll(".room-row");

// =========================================
// LIVE ROOM COUNTS
// =========================================

function updateRoomCounts(counts = {}) {
  roomRows.forEach((roomRow) => {
    roomRow.href = "/";
    const roomName = roomRow.dataset.room;
    const countElement = roomRow.querySelector(".room-users");

    if (!countElement) {
      return;
    }

    const count = Number(counts[roomName] || 0);
    countElement.textContent = String(count);
    countElement.setAttribute(
      "aria-label",
      `${count} ${count === 1 ? "person" : "people"}`,
    );
  });
}

socket.on("room-counts", (counts) => {
  console.log("Room counts received:", counts);
  updateRoomCounts(counts);
});

socket.on("connect", () => {
  socket.emit("get-room-counts");
});

// =========================================
// PEOPLE
// =========================================

const peopleBox = document.getElementById("peopleBox");

const peopleList = document.getElementById("peopleList");

const peopleTitle = document.getElementById("peopleTitle");

const watchingList = document.getElementById("watchingList");

const watchingTitle = document.getElementById("watchingTitle");

// =========================================
// VIDEO
// =========================================

const videos = document.getElementById("videos");

const controls = document.getElementById("controls");

// =========================================
// CHAT
// =========================================

const chat = document.getElementById("chat");

const messages = document.getElementById("messages");

const messageInput = document.getElementById("messageInput");

const sendButton = document.getElementById("sendButton");

// =========================================
// ROOM ID
// =========================================

// Approved rooms. The server validates these separately.
const APPROVED_ROOM_IDS = new Set([
  "general",
  "gaming",
  "music",
  "movies",
  "sports",
  "technology",
  "random",
]);

// Remember the last selected room without putting it in the URL.
const savedRoomId = sessionStorage.getItem("videoChatRoomId");

let roomId = APPROVED_ROOM_IDS.has(savedRoomId) ? savedRoomId : "general";

// Always keep the browser at the website's root address.
if (window.location.pathname !== "/") {
  window.history.replaceState({}, "", "/");
}

// =========================================
// STATE
// =========================================

let username = "";

let userId = null;

let loggedIn = false;

let inRoom = false;

let cameraOn = false;

let microphoneOn = false;

let screenSharing = false;

let cameraTrack = null;

let microphoneTrack = null;

let screenTrack = null;

let localStream = new MediaStream();

const peerConnections = {};

const remoteStreams = {};

const remoteNames = {};

const roomPeople = {};

const cameraWatchers = {};

const cameraWatchRequests = {};

// Remote microphones are opt-in.
// This tracks which remote users the local viewer has chosen to hear.
const microphoneListeners = {};

// =========================================
// AUTHENTICATED UI
// =========================================

function setAuthenticatedUI(isAuthenticated) {
  const authenticatedElements = [
    topBarLeft,
    topBarCenter,
    roomSelection,
    peopleBox,
    videos,
    controls,
    chat,
  ];

  authenticatedElements.forEach((element) => {
    if (!element) {
      return;
    }

    element.classList.toggle("requires-login", !isAuthenticated);
  });

  if (topBar) {
    topBar.classList.toggle("logged-out", !isAuthenticated);
  }
}

// =========================================
// LOGIN / LOGOUT BUTTON DISPLAY
// =========================================

function showLoggedInButtons() {
  // Hide Login
  if (topLoginButton) {
    topLoginButton.style.display = "none";
  }

  // Hide Create Account
  if (topCreateAccountButton) {
    topCreateAccountButton.style.display = "none";
  }

  // Show Logout
  if (logoutButton) {
    logoutButton.style.display = "inline-block";
  }

  // Update login status
  if (loginStatusText) {
    loginStatusText.textContent = `🟢 Logged in as ${username}`;
  }
}

function showLoggedOutButtons() {
  // Show Login
  if (topLoginButton) {
    topLoginButton.style.display = "inline-block";
  }

  // Show Create Account
  if (topCreateAccountButton) {
    topCreateAccountButton.style.display = "inline-block";
  }

  // Hide Logout
  if (logoutButton) {
    logoutButton.style.display = "none";
  }

  // Update login status
  if (loginStatusText) {
    loginStatusText.textContent = "🔴 Not logged in";
  }
}

// =========================================
// INITIAL UI
// =========================================

closeLogin();

closeAccount();

showLoggedOutButtons();

setAuthenticatedUI(false);

// =========================================
// LOGIN AREA
// =========================================

function openLogin() {
  if (!loginArea) {
    return;
  }

  loginArea.style.display = "block";

  if (loginUsernameInput) {
    loginUsernameInput.focus();
  }
}

function closeLogin() {
  if (loginArea) {
    loginArea.style.display = "none";
  }

  if (loginMessage) {
    loginMessage.textContent = "";
  }
}

if (topLoginButton) {
  topLoginButton.addEventListener("click", () => {
    closeAccount();
    openLogin();
  });
}

if (closeLoginButton) {
  closeLoginButton.addEventListener("click", () => {
    closeLogin();
  });
}

// =========================================
// ACCOUNT AREA
// =========================================

function openAccount() {
  if (!accountArea) {
    return;
  }

  accountArea.style.display = "block";

  if (registerUsernameInput) {
    registerUsernameInput.focus();
  }
}

function closeAccount() {
  if (accountArea) {
    accountArea.style.display = "none";
  }

  if (registrationMessage) {
    registrationMessage.textContent = "";
  }
}

if (topCreateAccountButton) {
  topCreateAccountButton.addEventListener("click", () => {
    closeLogin();
    openAccount();
  });
}

if (closeAccountButton) {
  closeAccountButton.addEventListener("click", () => {
    closeAccount();
  });
}

// =========================================
// REGISTER ACCOUNT
// =========================================

if (registerButton) {
  registerButton.addEventListener("click", registerAccount);
}

async function registerAccount() {
  const newUsername = registerUsernameInput.value.trim();

  const password = registerPasswordInput.value;

  if (!newUsername || !password) {
    registrationMessage.textContent = "Enter a username and password.";

    return;
  }

  registrationMessage.textContent = "Creating account...";

  socket.emit("register-user", {
    username: newUsername,
    password: password,
  });
}

// =========================================
// REGISTER RESULT
// =========================================

socket.on("registration-result", (result) => {
  console.log("Registration result:", result);

  if (!result.success) {
    if (registrationMessage) {
      registrationMessage.textContent =
        result.message || "Unable to create account.";
    }

    console.log("Registration failed:", result.message);
    return;
  }

  loggedIn = true;

  username = result.username;

  userId = result.userId;

  if (result.sessionToken) {
    sessionStorage.setItem("sessionToken", result.sessionToken);
  }

  closeAccount();
  closeLogin();

  showLoggedInButtons();
  setAuthenticatedUI(true);

  if (registerUsernameInput) {
    registerUsernameInput.value = "";
  }

  if (registerPasswordInput) {
    registerPasswordInput.value = "";
  }

  updateRoomInfo();

  joinRoom();

  console.log("Account created and logged in:", username);
});

// =========================================
// RESTORE SESSION
// =========================================

const savedSessionToken = sessionStorage.getItem("sessionToken");

if (savedSessionToken) {
  socket.emit("restore-session", { token: savedSessionToken });
}

// =========================================
// SESSION RESTORE RESULT
// =========================================

socket.on("session-result", (result) => {
  if (!result.success) {
    sessionStorage.removeItem("sessionToken");

    loggedIn = false;

    username = "";

    userId = null;

    showLoggedOutButtons();

    setAuthenticatedUI(false);

    return;
  }

  loggedIn = true;

  username = result.username;

  userId = result.userId;

  showLoggedInButtons();

  setAuthenticatedUI(true);

  closeLogin();

  closeAccount();

  updateRoomInfo();

  joinRoom();
});

// =========================================
// SESSION REPLACED BY ANOTHER LOGIN
// =========================================

socket.on("session-replaced", (data = {}) => {
  console.warn(data.message || "Your account was signed in elsewhere.");

  // Log out and clean up the existing connection.
  if (loggedIn) {
    logout();
  } else {
    sessionStorage.removeItem("sessionToken");

    inRoom = false;
    username = "";
    userId = null;

    stopAllMedia();

    showLoggedOutButtons();
    setAuthenticatedUI(false);
  }

  // Tell the user why they were logged out.
  openLogin();

  if (loginMessage) {
    loginMessage.textContent =
      data.message ||
      "This account was signed in on another browser. Please log in again.";
  }
});

// =========================================
// LOGIN
// =========================================

if (loginButton) {
  loginButton.addEventListener("click", loginAccount);
}

async function loginAccount() {
  const loginUsername = loginUsernameInput.value.trim();

  const password = loginPasswordInput.value;

  if (!loginUsername || !password) {
    loginMessage.textContent = "Enter your username and password.";

    return;
  }

  loginMessage.textContent = "Logging in...";

  socket.emit("login-user", {
    username: loginUsername,
    password: password,
  });
}

// =========================================
// LOGIN RESULT
// =========================================

socket.on("login-result", (result) => {
  console.log("Login result:", result);

  if (!result.success) {
    loginMessage.textContent = result.message || "Login failed.";
    return;
  }

  loggedIn = true;
  username = result.username;
  userId = result.userId;

  if (result.sessionToken) {
    sessionStorage.setItem("sessionToken", result.sessionToken);
  }

  showLoggedInButtons();
  setAuthenticatedUI(true);
  closeLogin();
  closeAccount();

  loginPasswordInput.value = "";

  updateRoomInfo();
  joinRoom();
});

// =========================================
// LOGOUT
// =========================================

if (logoutButton) {
  logoutButton.addEventListener("click", logout);
}

function logout() {
  if (!loggedIn) {
    return;
  }

  console.log("Logging out...");

  if (inRoom) {
    socket.emit("leave-room");
    inRoom = false;
  }

  stopAllMedia();

  Object.keys(peerConnections).forEach((remoteUserId) => {
    const pc = peerConnections[remoteUserId];

    if (pc) {
      pc.close();
    }

    delete peerConnections[remoteUserId];
  });

  Object.keys(remoteStreams).forEach((id) => delete remoteStreams[id]);
  Object.keys(remoteNames).forEach((id) => delete remoteNames[id]);
  Object.keys(roomPeople).forEach((id) => delete roomPeople[id]);
  Object.keys(cameraWatchers).forEach((id) => delete cameraWatchers[id]);
  Object.keys(microphoneListeners).forEach(
    (id) => delete microphoneListeners[id],
  );

  document.querySelectorAll("audio[data-remote-audio]").forEach((audio) => {
    audio.pause();
    audio.srcObject = null;
    audio.remove();
  });

  messages.innerHTML = "";

  updatePeopleList();
  updateWatchingList();

  socket.emit("logout-user");
  sessionStorage.removeItem("sessionToken");

  loggedIn = false;
  username = "";
  userId = null;

  showLoggedOutButtons();
  setAuthenticatedUI(false);

  closeLogin();
  closeAccount();

  console.log("Logged out.");
}

// =========================================
// UPDATE ROOM INFO
// =========================================

function updateRoomInfo() {
  if (!roomInfo) {
    return;
  }

  roomInfo.textContent = `Room: ${roomId}`;
}

// =========================================
// COPY ROOM LINK
// =========================================

if (copyLinkButton) {
  copyLinkButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);

      const originalText = copyLinkButton.textContent;
      copyLinkButton.textContent = "Copied!";

      setTimeout(() => {
        copyLinkButton.textContent = originalText;
      }, 1500);
    } catch (error) {
      console.error("Could not copy room link:", error);
    }
  });
}

// =========================================
// JOIN ROOM
// =========================================

function joinRoom() {
  if (!loggedIn || inRoom || !username) {
    return;
  }

  console.log("Joining room:", roomId, "as", username);

  roomPeople[socket.id] = {
    id: socket.id,
    username,
    camera: cameraOn,
    microphone: microphoneOn,
  };

  updatePeopleList();

  socket.emit("join-room", {
    roomId,
    username,
  });

  socket.emit("media-state", {
    camera: cameraOn,
    microphone: microphoneOn,
  });

  socket.emit("get-chat-history", {
    roomId,
  });

  inRoom = true;

  if (muteButton) muteButton.disabled = false;
  if (cameraButton) cameraButton.disabled = false;
  if (screenButton) screenButton.disabled = false;

  console.log("Joined room:", roomId);
}

// =========================================
// ROOM JOINED
// =========================================

socket.on("joined-room", (data) => {
  console.log("Joined room:", data);

  inRoom = true;

  if (data.users) {
    data.users.forEach((user) => {
      roomPeople[user.id] = {
        id: user.id,
        username: user.username,
        camera: user.camera || false,
        microphone: user.microphone || false,
      };

      if (user.id !== socket.id) {
        remoteNames[user.id] = user.username;
      }
    });
  }

  updatePeopleList();

  if (data.chatHistory) {
    messages.innerHTML = "";

    data.chatHistory.forEach(
      ({ username: senderUsername, message, created_at }) => {
        const element = createChatMessage(senderUsername, message, created_at);

        messages.appendChild(element);
      },
    );

    messages.scrollTop = messages.scrollHeight;
  }
});

// =========================================
// EXISTING ROOM USERS
// =========================================

socket.on("room-users", (users) => {
  console.log("Existing users:", users);

  users.forEach((user) => {
    if (user.id === socket.id) {
      return;
    }

    roomPeople[user.id] = {
      id: user.id,
      username: user.username,
      camera: user.camera || false,
      microphone: user.microphone || false,
    };

    remoteNames[user.id] = user.username;

    updatePeopleList();
  });
});

// =========================================
// USER JOINED
// =========================================

socket.on("user-joined", (user) => {
  if (!user || user.id === socket.id) {
    return;
  }

  console.log("User joined:", user);

  roomPeople[user.id] = {
    id: user.id,
    username: user.username,
    camera: user.camera || false,
    microphone: user.microphone || false,
  };

  remoteNames[user.id] = user.username;

  updatePeopleList();

  // The person already in the room initiates the connection.
  // This allows their existing camera track to be included
  // in the initial WebRTC offer.
  startConnection(user.id, user.username);
});

// =========================================
// USER LEFT
// =========================================

socket.on("user-left", ({ id: remoteUserId, username }) => {
  console.log("User left:", remoteUserId, username);

  removePeer(remoteUserId);
  delete roomPeople[remoteUserId];

  updatePeopleList();
});

// =========================================
// MEDIA STATE
// =========================================

socket.on(
  "media-state",
  ({ id: remoteUserId, username, camera, microphone }) => {
    if (!remoteUserId) {
      return;
    }

    if (!roomPeople[remoteUserId]) {
      roomPeople[remoteUserId] = {
        id: remoteUserId,
        username: username || remoteNames[remoteUserId] || "User",
        camera: false,
        microphone: false,
      };
    }

    roomPeople[remoteUserId].camera = !!camera;
    roomPeople[remoteUserId].microphone = !!microphone;

    if (!microphone) {
      delete microphoneListeners[remoteUserId];

      const audio = document.getElementById(`audio-${remoteUserId}`);

      if (audio) {
        audio.pause();
        audio.srcObject = null;
        audio.remove();
      }
    }

    if (username) {
      roomPeople[remoteUserId].username = username;
      remoteNames[remoteUserId] = username;
    }

    updatePeopleList();
  },
);

// =========================================
// REMOTE CAMERA OFF
// =========================================

socket.on("remote-camera-off", ({ id: remoteUserId, username }) => {
  if (!remoteUserId) {
    return;
  }

  console.log("Remote camera turned off:", username, remoteUserId);

  if (roomPeople[remoteUserId]) {
    roomPeople[remoteUserId].camera = false;
  }

  const container = document.getElementById(`video-container-${remoteUserId}`);

  const video = document.getElementById(`video-${remoteUserId}`);

  if (video) {
    video.pause();
    video.srcObject = null;
  }

  if (container) {
    container.remove();
  }

  delete remoteStreams[remoteUserId];

  updatePeopleList();
});

// =========================================
// PEOPLE LIST
// =========================================

function updatePeopleList() {
  if (!peopleList) {
    return;
  }

  peopleList.innerHTML = "";

  const users = Object.values(roomPeople);

  users.sort((a, b) => {
    if (a.id === socket.id) return -1;
    if (b.id === socket.id) return 1;

    return a.username.localeCompare(b.username);
  });

  if (peopleTitle) {
    peopleTitle.textContent = `People in Room (${users.length})`;
  }

  users.forEach((user) => {
    const row = document.createElement("div");
    row.className = "person-row";

    const name = document.createElement("span");
    name.className = "person-name";

    name.textContent =
      user.id === socket.id ? `${user.username} (You)` : user.username;

    row.appendChild(name);

    if (user.camera) {
      if (user.id !== socket.id) {
        const button = document.createElement("button");

        button.className = "camera-status-button";
        button.textContent = "📹";
        button.title = `View ${user.username}'s camera`;

        button.addEventListener("click", () => {
          showRemoteVideo(user.id);
        });

        row.appendChild(button);
      } else {
        const status = document.createElement("span");

        status.className = "camera-status";
        status.textContent = "📹";
        status.title = "Your camera is on";

        row.appendChild(status);
      }
    }

    if (user.id === socket.id) {
      const micStatus = document.createElement("span");

      micStatus.className = "mic-status";
      micStatus.textContent = user.microphone ? "🎤" : "🔇";
      micStatus.title = user.microphone
        ? "Your microphone is on"
        : "Your microphone is off";

      row.appendChild(micStatus);
    } else if (user.microphone) {
      const speakerButton = document.createElement("button");

      speakerButton.className = "speaker-status-button";

      const listening = !!microphoneListeners[user.id];

      speakerButton.textContent = listening ? "🔊" : "🔇";

      speakerButton.title = listening
        ? `Stop listening to ${user.username}`
        : `Listen to ${user.username}`;

      speakerButton.setAttribute("aria-label", speakerButton.title);

      speakerButton.addEventListener("click", async () => {
        await toggleMicrophoneListener(user.id);
      });

      row.appendChild(speakerButton);
    }

    peopleList.appendChild(row);
  });
}
// =========================================
// WATCHING MY CAMERA
// =========================================

function updateWatchingList() {
  if (!watchingList) {
    return;
  }

  watchingList.innerHTML = "";

  const watcherIds = Object.keys(cameraWatchers);

  if (watchingTitle) {
    watchingTitle.textContent = `Watching My Camera (${watcherIds.length})`;
  }

  if (watcherIds.length === 0) {
    const empty = document.createElement("div");

    empty.className = "watching-empty";
    empty.textContent = "Nobody is watching your camera.";

    watchingList.appendChild(empty);
    return;
  }

  watcherIds.forEach((watcherId) => {
    const watcher = cameraWatchers[watcherId];

    const div = document.createElement("div");

    div.className = "watching-person";
    div.textContent = `👁️ ${watcher.username}`;

    watchingList.appendChild(div);
  });
}

// =========================================
// CAMERA WATCH STATUS
// =========================================

socket.on("camera-watch-status", ({ watcherId, watcherUsername, watching }) => {
  console.log("CAMERA WATCH STATUS RECEIVED:", {
    watcherId,
    watcherUsername,
    watching,
  });

  if (!watcherId) {
    return;
  }

  if (watching) {
    cameraWatchers[watcherId] = {
      id: watcherId,
      username: watcherUsername || "User",
    };
  } else {
    delete cameraWatchers[watcherId];
  }

  updateWatchingList();
});

// =========================================
// START CONNECTION EVENT
// =========================================

socket.on("start-connection", ({ userId: remoteUserId, username }) => {
  if (remoteUserId === socket.id) {
    return;
  }

  remoteNames[remoteUserId] = username;

  startConnection(remoteUserId, username);
});

// =========================================
// PEER CONNECTION
// =========================================

function createPeerConnection(remoteUserId, userName, initiator) {
  if (peerConnections[remoteUserId]) {
    return peerConnections[remoteUserId];
  }

  const pc = new RTCPeerConnection({
    iceServers: [
      {
        urls: "stun:stun.l.google.com:19302",
      },
    ],
  });

  pc.addTransceiver("audio", {
    direction: "inactive",
  });

  pc.addTransceiver("video", {
    direction: "recvonly",
  });

  peerConnections[remoteUserId] = pc;
  remoteNames[remoteUserId] = userName;

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("ice-candidate", {
        target: remoteUserId,
        candidate: event.candidate,
      });
    }
  };

  pc.onconnectionstatechange = () => {
    console.log(`Connection with ${userName}:`, pc.connectionState);

    if (pc.connectionState === "failed" || pc.connectionState === "closed") {
      removePeer(remoteUserId);
    }
  };

  pc.oniceconnectionstatechange = () => {
    console.log(`ICE with ${userName}:`, pc.iceConnectionState);
  };

  pc.ontrack = (event) => {
    console.log("Received media from:", userName, event.track.kind);

    let stream =
      event.streams && event.streams.length > 0
        ? event.streams[0]
        : remoteStreams[remoteUserId];

    if (!stream) {
      stream = new MediaStream();
    }

    if (!stream.getTracks().includes(event.track)) {
      stream.addTrack(event.track);
    }

    remoteStreams[remoteUserId] = stream;

    if (event.track.kind === "audio") {
      let audio = document.getElementById(`audio-${remoteUserId}`);

      if (!audio) {
        audio = document.createElement("audio");

        audio.id = `audio-${remoteUserId}`;
        audio.dataset.remoteAudio = "true";
        audio.autoplay = false;
        audio.playsInline = true;

        audio.muted = !microphoneListeners[remoteUserId];
        audio.volume = microphoneListeners[remoteUserId] ? 1 : 0;
        audio.style.display = "none";

        document.body.appendChild(audio);
      }

      audio.srcObject = stream;

      if (microphoneListeners[remoteUserId]) {
        audio.muted = false;
        audio.volume = 1;

        audio.play().catch((error) => {
          console.error("Remote audio playback error:", error);
        });
      } else {
        audio.muted = true;
        audio.volume = 0;
        audio.pause();
      }

      event.track.addEventListener("unmute", () => {
        if (microphoneListeners[remoteUserId]) {
          audio.muted = false;
          audio.volume = 1;

          audio.play().catch((error) => {
            console.error("Remote audio playback error:", error);
          });
        } else {
          audio.muted = true;
          audio.volume = 0;
          audio.pause();
        }
      });

      event.track.addEventListener("ended", () => {
        audio.pause();
        audio.srcObject = null;
        audio.remove();
      });

      return;
    }

    if (event.track.kind === "video") {
      event.track.addEventListener("unmute", () => {
        console.log("Remote camera unmuted:", userName);

        if (roomPeople[remoteUserId]) {
          roomPeople[remoteUserId].camera = true;
        }

        updatePeopleList();

        const video = document.getElementById(`video-${remoteUserId}`);

        if (video) {
          video.play().catch((error) => {
            console.error("Remote video playback error:", error);
          });
        }
      });

      event.track.addEventListener("mute", () => {
        console.log("Remote camera muted:", userName);

        if (roomPeople[remoteUserId]) {
          roomPeople[remoteUserId].camera = false;
        }

        hideRemoteVideo(remoteUserId);
        updatePeopleList();
      });

      event.track.addEventListener("ended", () => {
        console.log("Remote camera track ended:", userName);

        if (roomPeople[remoteUserId]) {
          roomPeople[remoteUserId].camera = false;
        }

        hideRemoteVideo(remoteUserId);
        updatePeopleList();
      });
    }

    ensureRemoteVideo(remoteUserId, userName, stream);

    if (cameraWatchRequests[remoteUserId]) {
      const container = document.getElementById(
        `video-container-${remoteUserId}`,
      );

      const video = document.getElementById(`video-${remoteUserId}`);

      if (container && video) {
        video.srcObject = stream;
        // Keep video-element audio muted; remote sound is controlled
        // by the separate speaker button and audio element.
        video.muted = true;
        container.style.display = "block";

        video.play().catch((error) => {
          console.error("Could not play remote video:", error);
        });

        console.log(
          "I AM NOW WATCHING:",
          remoteNames[remoteUserId] || remoteUserId,
        );

        socket.emit("camera-watching", {
          target: remoteUserId,
          watching: true,
        });
      }
    }
  };

  return pc;
}

// =========================================
// START CONNECTION
// =========================================

async function startConnection(remoteUserId, userName) {
  if (peerConnections[remoteUserId]) {
    return;
  }

  const pc = createPeerConnection(remoteUserId, userName, true);

  try {
    await attachLocalTracks(pc, remoteUserId);

    const offer = await pc.createOffer();

    await pc.setLocalDescription(offer);

    socket.emit("offer", {
      target: remoteUserId,
      offer: pc.localDescription,
    });
  } catch (error) {
    console.error("Error creating offer:", error);
  }
}

// =========================================
// RECEIVE OFFER
// =========================================

socket.on("offer", async ({ sender, offer }) => {
  let pc = peerConnections[sender];

  if (!pc) {
    pc = createPeerConnection(sender, remoteNames[sender] || "User", false);
  }

  try {
    await pc.setRemoteDescription(new RTCSessionDescription(offer));

    await attachLocalTracks(pc, sender);

    const answer = await pc.createAnswer();

    await pc.setLocalDescription(answer);

    socket.emit("answer", {
      target: sender,
      answer: pc.localDescription,
    });
  } catch (error) {
    console.error("Error handling offer:", error);
  }
});

// =========================================
// RECEIVE ANSWER
// =========================================

socket.on("answer", async ({ sender, answer }) => {
  const pc = peerConnections[sender];

  if (!pc) {
    return;
  }

  if (pc.signalingState !== "have-local-offer") {
    console.warn(
      "Ignoring stale answer from:",
      remoteNames[sender] || sender,
      "Current state:",
      pc.signalingState,
    );

    return;
  }

  try {
    await pc.setRemoteDescription(new RTCSessionDescription(answer));

    console.log("Answer accepted from:", remoteNames[sender] || sender);
  } catch (error) {
    console.error("Error setting answer:", error);
  }
});

// =========================================
// ICE CANDIDATE
// =========================================

socket.on("ice-candidate", async ({ sender, candidate }) => {
  const pc = peerConnections[sender];

  if (!pc) {
    return;
  }

  try {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (error) {
    console.error("Error adding ICE candidate:", error);
  }
});

// =========================================
// ATTACH LOCAL TRACKS
// =========================================

async function attachLocalTracks(pc, remoteUserId) {
  const transceivers = pc.getTransceivers();

  const audioTransceiver = transceivers.find(
    (transceiver) =>
      transceiver.receiver &&
      transceiver.receiver.track &&
      transceiver.receiver.track.kind === "audio",
  );

  if (audioTransceiver) {
    const sendAudio = microphoneOn && Boolean(microphoneTrack);
    const receiveAudio = Boolean(microphoneListeners[remoteUserId]);

    await audioTransceiver.sender.replaceTrack(
      sendAudio ? microphoneTrack : null,
    );

    if (sendAudio && receiveAudio) {
      audioTransceiver.direction = "sendrecv";
    } else if (sendAudio) {
      audioTransceiver.direction = "sendonly";
    } else if (receiveAudio) {
      audioTransceiver.direction = "recvonly";
    } else {
      audioTransceiver.direction = "inactive";
    }
  }

  const videoTransceiver = transceivers.find(
    (transceiver) =>
      transceiver.receiver &&
      transceiver.receiver.track &&
      transceiver.receiver.track.kind === "video",
  );

  if (videoTransceiver) {
    let videoTrack = null;

    if (screenSharing && screenTrack) {
      videoTrack = screenTrack;
    } else if (cameraOn && cameraTrack) {
      videoTrack = cameraTrack;
    }

    if (videoTrack) {
      await videoTransceiver.sender.replaceTrack(videoTrack);
      videoTransceiver.direction = "sendrecv";
    } else {
      await videoTransceiver.sender.replaceTrack(null);
      videoTransceiver.direction = "recvonly";
    }
  }
}

// =========================================
// CAMERA
// =========================================

async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
    });

    cameraTrack = stream.getVideoTracks()[0];
    cameraTrack.enabled = true;

    localStream.addTrack(cameraTrack);
    cameraOn = true;

    showLocalVideo();

    for (const remoteUserId in peerConnections) {
      const pc = peerConnections[remoteUserId];

      const videoTransceiver = pc
        .getTransceivers()
        .find(
          (transceiver) =>
            transceiver.receiver &&
            transceiver.receiver.track &&
            transceiver.receiver.track.kind === "video",
        );

      if (videoTransceiver) {
        await videoTransceiver.sender.replaceTrack(cameraTrack);
        videoTransceiver.direction = "sendrecv";
      }

      await renegotiate(remoteUserId, pc);
    }

    socket.emit("media-state", {
      camera: true,
      microphone: microphoneOn,
    });

    if (roomPeople[socket.id]) {
      roomPeople[socket.id].camera = true;
    }

    updatePeopleList();
    cameraButton.textContent = "📹 Camera Off";
  } catch (error) {
    console.error("Camera error:", error);
    alert("Could not access the camera.");
  }
}

async function stopCamera() {
  cameraOn = false;

  if (cameraTrack) {
    cameraTrack.stop();
    localStream.removeTrack(cameraTrack);
    cameraTrack = null;
  }

  hideLocalVideo();

  Object.keys(cameraWatchers).forEach((watcherId) => {
    delete cameraWatchers[watcherId];
  });

  updateWatchingList();

  for (const remoteUserId in peerConnections) {
    const pc = peerConnections[remoteUserId];

    const videoTransceiver = pc
      .getTransceivers()
      .find(
        (transceiver) =>
          transceiver.receiver &&
          transceiver.receiver.track &&
          transceiver.receiver.track.kind === "video",
      );

    if (videoTransceiver) {
      await videoTransceiver.sender.replaceTrack(null);
      videoTransceiver.direction = "recvonly";
    }

    await renegotiate(remoteUserId, pc);
  }

  socket.emit("media-state", {
    camera: false,
    microphone: microphoneOn,
  });

  if (roomPeople[socket.id]) {
    roomPeople[socket.id].camera = false;
  }

  updatePeopleList();
  cameraButton.textContent = "📹 Camera On";
}

if (cameraButton) {
  cameraButton.addEventListener("click", async () => {
    if (cameraOn) {
      await stopCamera();
    } else {
      await startCamera();
    }
  });
}

// =========================================
// REMOTE MICROPHONE LISTENING
// =========================================

async function updateAudioDirection(remoteUserId) {
  const pc = peerConnections[remoteUserId];

  if (!pc) {
    return;
  }

  const audioTransceiver = pc
    .getTransceivers()
    .find(
      (transceiver) =>
        transceiver.receiver &&
        transceiver.receiver.track &&
        transceiver.receiver.track.kind === "audio",
    );

  if (!audioTransceiver) {
    return;
  }

  const sendAudio = microphoneOn && Boolean(microphoneTrack);
  const receiveAudio = Boolean(microphoneListeners[remoteUserId]);

  await audioTransceiver.sender.replaceTrack(
    sendAudio ? microphoneTrack : null,
  );

  if (sendAudio && receiveAudio) {
    audioTransceiver.direction = "sendrecv";
  } else if (sendAudio) {
    audioTransceiver.direction = "sendonly";
  } else if (receiveAudio) {
    audioTransceiver.direction = "recvonly";
  } else {
    audioTransceiver.direction = "inactive";
  }
}

async function toggleMicrophoneListener(remoteUserId) {
  const person = roomPeople[remoteUserId];

  if (!person || !person.microphone) {
    return;
  }

  microphoneListeners[remoteUserId] = !microphoneListeners[remoteUserId];

  // Update the speaker icon immediately.
  updatePeopleList();

  const audio = document.getElementById(`audio-${remoteUserId}`);

  if (!microphoneListeners[remoteUserId] && audio) {
    // Stop playback immediately when the speaker is switched off.
    audio.muted = true;
    audio.volume = 0;
    audio.pause();
  }

  if (!peerConnections[remoteUserId]) {
    startConnection(remoteUserId, person.username);
    return;
  }

  const pc = peerConnections[remoteUserId];

  await updateAudioDirection(remoteUserId);
  await renegotiate(remoteUserId, pc);

  const currentAudio = document.getElementById(`audio-${remoteUserId}`);

  if (currentAudio) {
    if (microphoneListeners[remoteUserId]) {
      currentAudio.muted = false;
      currentAudio.volume = 1;

      currentAudio.play().catch((error) => {
        console.error("Remote audio playback error:", error);
      });
    } else {
      currentAudio.muted = true;
      currentAudio.volume = 0;
      currentAudio.pause();
    }
  }
}

// =========================================
// MICROPHONE
// =========================================

async function startMicrophone() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
    });

    microphoneTrack = stream.getAudioTracks()[0];
    microphoneTrack.enabled = true;

    localStream.addTrack(microphoneTrack);
    microphoneOn = true;

    for (const remoteUserId in peerConnections) {
      const pc = peerConnections[remoteUserId];

      await updateAudioDirection(remoteUserId);
      await renegotiate(remoteUserId, pc);
    }

    socket.emit("media-state", {
      camera: cameraOn,
      microphone: true,
    });

    if (roomPeople[socket.id]) {
      roomPeople[socket.id].microphone = true;
    }

    updatePeopleList();
    muteButton.textContent = "🎤 Mic Off";
  } catch (error) {
    console.error("Microphone error:", error);
    alert("Could not access the microphone.");
  }
}

async function stopMicrophone() {
  microphoneOn = false;

  if (microphoneTrack) {
    microphoneTrack.stop();
    localStream.removeTrack(microphoneTrack);
    microphoneTrack = null;
  }

  for (const remoteUserId in peerConnections) {
    const pc = peerConnections[remoteUserId];

    await updateAudioDirection(remoteUserId);
    await renegotiate(remoteUserId, pc);
  }

  socket.emit("media-state", {
    camera: cameraOn,
    microphone: false,
  });

  if (roomPeople[socket.id]) {
    roomPeople[socket.id].microphone = false;
  }

  updatePeopleList();
  muteButton.textContent = "🎤 Mic On";
}

if (muteButton) {
  muteButton.addEventListener("click", async () => {
    if (microphoneOn) {
      await stopMicrophone();
    } else {
      await startMicrophone();
    }
  });
}

// =========================================
// RENEGOTIATE
// =========================================

async function renegotiate(remoteUserId, pc) {
  try {
    if (pc.signalingState !== "stable") {
      return;
    }

    const offer = await pc.createOffer();

    await pc.setLocalDescription(offer);

    socket.emit("offer", {
      target: remoteUserId,
      offer: pc.localDescription,
    });
  } catch (error) {
    console.error("Renegotiation error:", error);
  }
}

// =========================================
// LOCAL VIDEO
// =========================================

function showLocalVideo() {
  if (!videos) {
    return;
  }

  let container = document.getElementById("local-video-container");

  if (!container) {
    container = document.createElement("div");
    container.id = "local-video-container";
    container.className = "video-container";

    const video = document.createElement("video");

    video.id = "local-video";
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;

    const label = document.createElement("div");

    label.className = "video-label";
    label.textContent = `${username} (You)`;

    container.appendChild(video);
    container.appendChild(label);
    videos.appendChild(container);
  }

  const video = document.getElementById("local-video");

  if (video) {
    video.srcObject = localStream;

    video.play().catch((error) => {
      console.error("Local video playback error:", error);
    });
  }
}

function hideLocalVideo() {
  const container = document.getElementById("local-video-container");

  if (container) {
    container.remove();
  }
}

// =========================================
// REMOTE VIDEO
// =========================================

function ensureRemoteVideo(remoteUserId, userName, stream) {
  let container = document.getElementById(`video-container-${remoteUserId}`);

  if (!container) {
    container = document.createElement("div");

    container.id = `video-container-${remoteUserId}`;
    container.className = "video-container";
    container.style.display = "none";

    const video = document.createElement("video");

    video.id = `video-${remoteUserId}`;
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;

    video.setAttribute("autoplay", "");
    video.setAttribute("playsinline", "");

    video.style.width = "100%";
    video.style.height = "100%";
    video.style.objectFit = "cover";

    container.appendChild(video);

    const closeButton = document.createElement("button");

    closeButton.className = "close-video-button";
    closeButton.textContent = "✕";
    closeButton.title = "Hide this video";

    closeButton.addEventListener("click", () => {
      hideRemoteVideo(remoteUserId);
    });

    container.appendChild(closeButton);

    const label = document.createElement("div");

    label.className = "video-label remote-video-name";
    label.textContent = userName || remoteNames[remoteUserId] || "User";

    label.style.position = "absolute";
    label.style.left = "8px";
    label.style.bottom = "8px";
    label.style.zIndex = "5";
    label.style.padding = "4px 8px";
    label.style.borderRadius = "6px";
    label.style.background = "rgba(0, 0, 0, 0.65)";
    label.style.color = "white";
    label.style.fontSize = "14px";
    label.style.fontWeight = "600";
    label.style.lineHeight = "1.2";
    label.style.pointerEvents = "none";

    container.appendChild(label);
    videos.appendChild(container);

    video.addEventListener("loadedmetadata", () => {
      video.play().catch((error) => {
        console.log("Remote video playback waiting:", error);
      });
    });
  }

  const label = container.querySelector(".remote-video-name");

  if (label) {
    label.textContent = userName || remoteNames[remoteUserId] || "User";
  }

  const video = document.getElementById(`video-${remoteUserId}`);

  if (video.srcObject !== stream) {
    video.srcObject = stream;
  }

  video.play().catch((error) => {
    console.log("Remote video play attempt:", error);
  });
}

// =========================================
// SHOW REMOTE CAMERA
// =========================================

function showRemoteVideo(remoteUserId) {
  console.log("Camera button clicked for:", remoteUserId);

  // Remember the viewer's request even if the initial video track
  // has not arrived yet. The ontrack handler will show it later.
  cameraWatchRequests[remoteUserId] = true;

  const person = roomPeople[remoteUserId];

  if (!person || remoteUserId === socket.id) {
    console.warn("Cannot find the remote user:", remoteUserId);
    return;
  }

  const userName = remoteNames[remoteUserId] || person.username || "User";
  const pc = peerConnections[remoteUserId];

  // The existing room member initiates the WebRTC connection when this
  // user joins. Do not create a second offer from a camera click: that can
  // collide with the offer already being sent by the other browser.
  if (!pc) {
    console.log("Waiting for the initial WebRTC connection with:", userName);
    return;
  }

  const stream = remoteStreams[remoteUserId];
  const hasLiveVideoTrack = Boolean(
    stream &&
    stream.getVideoTracks().some((track) => track.readyState === "live"),
  );

  if (!hasLiveVideoTrack) {
    // Keep the viewing request queued. Do not renegotiate from the viewer
    // just because the remote track has not arrived yet. The ontrack
    // handler below will display the camera as soon as it arrives.
    console.log("Waiting for the remote video track from:", userName);
    return;
  }

  ensureRemoteVideo(remoteUserId, userName, stream);

  const container = document.getElementById(`video-container-${remoteUserId}`);
  const video = document.getElementById(`video-${remoteUserId}`);

  if (!container || !video) {
    console.error("Could not create the remote video tile.");
    return;
  }

  video.srcObject = stream;
  // Remote audio playback remains controlled by the separate speaker button.
  video.muted = true;
  container.style.display = "block";

  video.play().catch((error) => {
    console.error("Could not play the remote camera:", error);
  });

  socket.emit("camera-watching", {
    target: remoteUserId,
    watching: true,
  });
}

function hideRemoteVideo(remoteUserId) {
  const container = document.getElementById(`video-container-${remoteUserId}`);

  if (container) {
    container.remove();
  }

  delete cameraWatchRequests[remoteUserId];

  socket.emit("camera-watching", {
    target: remoteUserId,
    watching: false,
  });
}

// =========================================
// SCREEN SHARING
// =========================================

if (screenButton) {
  screenButton.addEventListener("click", async () => {
    if (screenSharing) {
      await stopScreenSharing();
    } else {
      await startScreenSharing();
    }
  });
}

async function startScreenSharing() {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
    });

    screenTrack = stream.getVideoTracks()[0];
    screenSharing = true;

    if (cameraTrack) {
      cameraTrack.enabled = false;
    }

    for (const remoteUserId in peerConnections) {
      const pc = peerConnections[remoteUserId];

      const videoTransceiver = pc
        .getTransceivers()
        .find(
          (transceiver) =>
            transceiver.receiver &&
            transceiver.receiver.track &&
            transceiver.receiver.track.kind === "video",
        );

      if (videoTransceiver) {
        await videoTransceiver.sender.replaceTrack(screenTrack);
        videoTransceiver.direction = "sendrecv";
      }

      await renegotiate(remoteUserId, pc);
    }

    screenTrack.onended = stopScreenSharing;

    socket.emit("media-state", {
      camera: true,
      microphone: microphoneOn,
    });

    screenButton.textContent = "🛑 Stop Sharing";
  } catch (error) {
    console.error("Screen sharing error:", error);
  }
}

async function stopScreenSharing() {
  if (!screenSharing) {
    return;
  }

  screenSharing = false;

  if (screenTrack) {
    screenTrack.stop();
    screenTrack = null;
  }

  for (const remoteUserId in peerConnections) {
    const pc = peerConnections[remoteUserId];

    const videoTransceiver = pc
      .getTransceivers()
      .find(
        (transceiver) =>
          transceiver.receiver &&
          transceiver.receiver.track &&
          transceiver.receiver.track.kind === "video",
      );

    if (videoTransceiver) {
      if (cameraOn && cameraTrack) {
        await videoTransceiver.sender.replaceTrack(cameraTrack);
      } else {
        await videoTransceiver.sender.replaceTrack(null);
        videoTransceiver.direction = "recvonly";
      }
    }

    await renegotiate(remoteUserId, pc);
  }

  if (cameraTrack) {
    cameraTrack.enabled = cameraOn;
  }

  socket.emit("media-state", {
    camera: cameraOn,
    microphone: microphoneOn,
  });

  screenButton.textContent = "🖥️ Share Screen";
}

// =========================================
// CHAT
// =========================================

if (sendButton) {
  sendButton.addEventListener("click", sendMessage);
}

if (messageInput) {
  messageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      sendMessage();
    }
  });
}

function sendMessage() {
  const message = messageInput.value.trim();

  if (!message) {
    return;
  }

  socket.emit("chat-message", {
    roomId,
    message,
  });

  messageInput.value = "";
  messageInput.focus();
}

// =========================================
// CREATE CHAT MESSAGE
// =========================================

function createChatMessage(senderUsername, message, createdAt = null) {
  const messageElement = document.createElement("div");

  const isMine = senderUsername === username;

  messageElement.className = isMine
    ? "chat-message mine"
    : "chat-message other";

  const messageHeader = document.createElement("div");
  messageHeader.className = "message-header";

  const nameElement = document.createElement("span");
  nameElement.className = "message-username";

  nameElement.textContent = isMine ? `${senderUsername} (You)` : senderUsername;

  const timeElement = document.createElement("span");
  timeElement.className = "message-time";

  let messageDate;

  if (createdAt) {
    messageDate = new Date(createdAt.replace(" ", "T") + "Z");
  } else {
    messageDate = new Date();
  }

  timeElement.textContent = messageDate.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  const textElement = document.createElement("div");
  textElement.className = "message-text";
  textElement.textContent = message;

  messageHeader.appendChild(nameElement);
  messageHeader.appendChild(timeElement);

  messageElement.appendChild(messageHeader);
  messageElement.appendChild(textElement);

  return messageElement;
}

// =========================================
// RECEIVE NEW CHAT MESSAGE
// =========================================

socket.on("chat-message", ({ username: senderUsername, message }) => {
  const messageElement = createChatMessage(senderUsername, message);

  messages.appendChild(messageElement);
  messages.scrollTop = messages.scrollHeight;
});

// =========================================
// RECEIVE CHAT HISTORY
// =========================================

socket.on("chat-history", (chatHistory) => {
  messages.innerHTML = "";

  chatHistory.forEach(({ username: senderUsername, message, created_at }) => {
    const messageElement = createChatMessage(
      senderUsername,
      message,
      created_at,
    );

    messages.appendChild(messageElement);
  });

  messages.scrollTop = messages.scrollHeight;
});

// =========================================
// ROOM NAVIGATION
// =========================================

roomRows.forEach((roomRow) => {
  roomRow.addEventListener("click", (event) => {
    // Prevent navigation to a room URL.
    event.preventDefault();

    if (!loggedIn || !inRoom) {
      return;
    }

    // Get the selected room from the room list.
    const newRoomId = roomRow.dataset.room;

    // Only allow rooms in the approved room list.
    if (!APPROVED_ROOM_IDS.has(newRoomId)) {
      return;
    }

    // Do nothing if already in this room.
    if (newRoomId === roomId) {
      return;
    }

    console.log("Switching rooms:", roomId, "->", newRoomId);

    inRoom = false;

    Object.keys(peerConnections).forEach((remoteUserId) => {
      const pc = peerConnections[remoteUserId];

      if (pc) {
        pc.close();
      }

      delete peerConnections[remoteUserId];
    });

    Object.keys(remoteStreams).forEach((id) => delete remoteStreams[id]);
    Object.keys(remoteNames).forEach((id) => delete remoteNames[id]);
    Object.keys(roomPeople).forEach((id) => delete roomPeople[id]);
    Object.keys(cameraWatchers).forEach((id) => delete cameraWatchers[id]);
    Object.keys(microphoneListeners).forEach(
      (id) => delete microphoneListeners[id],
    );

    document.querySelectorAll("audio[data-remote-audio]").forEach((audio) => {
      audio.pause();
      audio.srcObject = null;
      audio.remove();
    });

    videos.querySelectorAll(".video-container").forEach((container) => {
      if (container.id !== "local-video-container") {
        container.remove();
      }
    });

    messages.innerHTML = "";

    updatePeopleList();
    updateWatchingList();

    roomId = newRoomId;

    // Remember the selected room without putting it in the URL.
    sessionStorage.setItem("videoChatRoomId", roomId);

    // Keep the browser address at the main website address.
    if (window.location.pathname !== "/") {
      window.history.replaceState({}, "", "/");
    }

    updateRoomInfo();
    highlightCurrentRoom();

    joinRoom();
  });
});

// =========================================
// REMOVE PEER
// =========================================

function removePeer(remoteUserId) {
  const pc = peerConnections[remoteUserId];

  if (pc) {
    pc.close();
    delete peerConnections[remoteUserId];
  }

  delete remoteStreams[remoteUserId];
  delete remoteNames[remoteUserId];
  delete cameraWatchers[remoteUserId];
  delete microphoneListeners[remoteUserId];

  const audio = document.getElementById(`audio-${remoteUserId}`);

  if (audio) {
    audio.pause();
    audio.srcObject = null;
    audio.remove();
  }

  updateWatchingList();

  const container = document.getElementById(`video-container-${remoteUserId}`);

  if (container) {
    container.remove();
  }
}

// =========================================
// STOP ALL MEDIA
// =========================================

function stopAllMedia() {
  cameraOn = false;
  microphoneOn = false;
  screenSharing = false;

  if (cameraTrack) {
    cameraTrack.stop();
    cameraTrack = null;
  }

  if (microphoneTrack) {
    microphoneTrack.stop();
    microphoneTrack = null;
  }

  if (screenTrack) {
    screenTrack.stop();
    screenTrack = null;
  }

  localStream.getTracks().forEach((track) => {
    track.stop();
  });

  localStream = new MediaStream();

  hideLocalVideo();

  if (cameraButton) {
    cameraButton.textContent = "📹 Camera On";
  }

  if (muteButton) {
    muteButton.textContent = "🎤 Mic On";
  }

  if (screenButton) {
    screenButton.textContent = "🖥️ Share Screen";
  }
}

// =========================================
// CURRENT ROOM HIGHLIGHT
// =========================================

function highlightCurrentRoom() {
  roomRows.forEach((roomRow) => {
    const isCurrentRoom = roomRow.dataset.room === roomId;

    roomRow.classList.toggle("current-room", isCurrentRoom);

    roomRow.setAttribute("aria-current", isCurrentRoom ? "page" : "false");
  });
}

const currentRoomStyle = document.createElement("style");

currentRoomStyle.textContent = `
  .room-row.current-room {
    outline: 2px solid #4da3ff;
    outline-offset: -2px;
    background: rgba(77, 163, 255, 0.18);
    font-weight: 700;
  }
`;

document.head.appendChild(currentRoomStyle);

highlightCurrentRoom();
