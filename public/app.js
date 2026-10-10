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

const pathParts = window.location.pathname.split("/");

let roomId =
  pathParts[1] === "room" && pathParts[2]
    ? decodeURIComponent(pathParts[2])
    : "general";

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
  if (topLoginButton) {
    topLoginButton.style.display = "none";
  }

  if (logoutButton) {
    logoutButton.style.display = "inline-block";
  }

  if (loginStatusText) {
    loginStatusText.textContent = `🟢 Logged in as ${username}`;
  }
}

function showLoggedOutButtons() {
  if (topLoginButton) {
    topLoginButton.style.display = "inline-block";
  }

  if (logoutButton) {
    logoutButton.style.display = "none";
  }

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

  // Registration succeeded
  loggedIn = true;

  username = result.username;

  userId = result.userId;

  // Save the session token so changing rooms keeps us logged in.
  if (result.sessionToken) {
    sessionStorage.setItem("sessionToken", result.sessionToken);
  }

  // Close the account and login panels
  closeAccount();
  closeLogin();

  // Show the logged-in interface
  showLoggedInButtons();
  setAuthenticatedUI(true);

  // Clear registration fields
  if (registerUsernameInput) {
    registerUsernameInput.value = "";
  }

  if (registerPasswordInput) {
    registerPasswordInput.value = "";
  }

  // Update the room
  updateRoomInfo();

  // Join the current room
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
  if (!result.success) {
    loggedIn = false;

    showLoggedOutButtons();

    setAuthenticatedUI(false);

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

  Object.keys(remoteStreams).forEach((remoteUserId) => {
    delete remoteStreams[remoteUserId];
  });

  Object.keys(remoteNames).forEach((remoteUserId) => {
    delete remoteNames[remoteUserId];
  });

  Object.keys(roomPeople).forEach((remoteUserId) => {
    delete roomPeople[remoteUserId];
  });

  Object.keys(cameraWatchers).forEach((remoteUserId) => {
    delete cameraWatchers[remoteUserId];
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

  loginPasswordInput.value = "";

  console.log("Logged out.");
}

// =========================================
// LOGOUT RESULT
// =========================================

socket.on("logout-result", (result) => {
  console.log("Logout result:", result);
});

// =========================================
// ROOM INFO
// =========================================

function updateRoomInfo() {
  if (!roomInfo) {
    return;
  }

  roomInfo.textContent = `Room: ${roomId}`;
}

updateRoomInfo();

// =========================================
// ROOM COUNTS
// =========================================

socket.on("room-counts", (counts) => {
  console.log("Room counts received:", counts);

  roomRows.forEach((roomRow) => {
    const roomName = roomRow.dataset.room;
    const countElement = roomRow.querySelector(".room-users");

    if (!countElement) {
      return;
    }

    const count = counts[roomName] || 0;

    countElement.textContent = `${count} user${count === 1 ? "" : "s"}`;
  });
});

// =========================================
// COPY ROOM LINK
// =========================================

if (copyLinkButton) {
  copyLinkButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);

      copyLinkButton.textContent = "✓ Link Copied";

      setTimeout(() => {
        copyLinkButton.textContent = "Copy Room Link";
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
  if (!loggedIn) {
    return;
  }

  if (inRoom) {
    return;
  }

  if (!username) {
    return;
  }

  console.log("Joining room:", roomId, "as", username);

  // Add ourselves to the People in Room list immediately.
  // Keep our current media state when changing rooms.
  roomPeople[socket.id] = {
    id: socket.id,
    username: username,
    camera: cameraOn,
    microphone: microphoneOn,
  };

  updatePeopleList();

  // Join the room.
  socket.emit("join-room", {
    roomId: roomId,
    username: username,
  });

  // Tell the new room that our existing camera/microphone state
  // is still active. This does NOT start or stop any local media.
  socket.emit("media-state", {
    camera: cameraOn,
    microphone: microphoneOn,
  });

  // Load the saved chat history for this room.
  socket.emit("get-chat-history", {
    roomId: roomId,
  });

  inRoom = true;

  if (muteButton) {
    muteButton.disabled = false;
  }

  if (cameraButton) {
    cameraButton.disabled = false;
  }

  if (screenButton) {
    screenButton.disabled = false;
  }

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
        const messageElement = createChatMessage(
          senderUsername,
          message,
          created_at,
        );

        messages.appendChild(messageElement);
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

    // Start the WebRTC connection with this person.
    startConnection(user.id, user.username);
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
});

// =========================================
// USER LEFT
// =========================================

socket.on("user-left", ({ id: userId, username }) => {
  console.log("User left:", userId, username);

  removePeer(userId);

  delete roomPeople[userId];

  updatePeopleList();
});

// =========================================
// MEDIA STATE
// =========================================

socket.on("media-state", ({ id: userId, username, camera, microphone }) => {
  if (!userId) {
    return;
  }

  if (!roomPeople[userId]) {
    roomPeople[userId] = {
      id: userId,
      username: username || remoteNames[userId] || "User",
      camera: false,
      microphone: false,
    };
  }

  roomPeople[userId].camera = !!camera;
  roomPeople[userId].microphone = !!microphone;

  if (username) {
    roomPeople[userId].username = username;
    remoteNames[userId] = username;
  }

  updatePeopleList();
});

// =========================================
// REMOTE CAMERA OFF
// =========================================

socket.on("remote-camera-off", ({ id: userId, username }) => {
  if (!userId) {
    return;
  }

  console.log("Remote camera turned off:", username, userId);

  // Update the People in Room list.
  if (roomPeople[userId]) {
    roomPeople[userId].camera = false;
  }

  // Completely remove the frozen video.
  const container = document.getElementById(`video-container-${userId}`);

  const video = document.getElementById(`video-${userId}`);

  if (video) {
    video.pause();
    video.srcObject = null;
  }

  if (container) {
    container.remove();
  }

  // Remove the old stream reference.
  delete remoteStreams[userId];

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
    if (a.id === socket.id) {
      return -1;
    }

    if (b.id === socket.id) {
      return 1;
    }

    return a.username.localeCompare(b.username);
  });

  // Update the People in Room count.
  if (peopleTitle) {
    const count = users.length;
    peopleTitle.textContent = `People in Room (${count})`;
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
        const cameraButton = document.createElement("button");

        cameraButton.className = "camera-status-button";

        cameraButton.textContent = "📹";

        cameraButton.title = `View ${user.username}'s camera`;

        cameraButton.addEventListener("click", () => {
          showRemoteVideo(user.id);
        });

        row.appendChild(cameraButton);
      } else {
        const cameraStatus = document.createElement("span");

        cameraStatus.className = "camera-status";

        cameraStatus.textContent = "📹";

        cameraStatus.title = "Your camera is on";

        row.appendChild(cameraStatus);
      }
    }

    const micStatus = document.createElement("span");

    micStatus.className = "mic-status";

    micStatus.textContent = user.microphone ? "🎤" : "🔇";

    micStatus.title = user.microphone ? "Microphone on" : "Microphone off";

    row.appendChild(micStatus);

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
// START CONNECTION
// =========================================

socket.on("start-connection", ({ userId, username: remoteUsername }) => {
  if (userId === socket.id) {
    return;
  }

  remoteNames[userId] = remoteUsername;

  startConnection(userId, remoteUsername);
});

// =========================================
// PEER CONNECTION
// =========================================

function createPeerConnection(userId, userName, initiator) {
  if (peerConnections[userId]) {
    return peerConnections[userId];
  }

  const pc = new RTCPeerConnection({
    iceServers: [
      {
        urls: "stun:stun.l.google.com:19302",
      },
    ],
  });

  // Always create audio and video receive paths.
  // This allows users to join with their camera and
  // microphone OFF, but turn them on later.
  pc.addTransceiver("audio", {
    direction: "recvonly",
  });

  pc.addTransceiver("video", {
    direction: "recvonly",
  });

  peerConnections[userId] = pc;

  remoteNames[userId] = userName;

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("ice-candidate", {
        target: userId,
        candidate: event.candidate,
      });
    }
  };

  pc.onconnectionstatechange = () => {
    console.log(`Connection with ${userName}:`, pc.connectionState);

    if (pc.connectionState === "failed" || pc.connectionState === "closed") {
      removePeer(userId);
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
        : remoteStreams[userId];

    if (!stream) {
      stream = new MediaStream();
    }

    if (!stream.getTracks().includes(event.track)) {
      stream.addTrack(event.track);
    }

    remoteStreams[userId] = stream;

    if (event.track.kind === "video") {
      // The remote camera has started sending video.
      event.track.addEventListener("unmute", () => {
        console.log("Remote camera unmuted:", userName);

        if (roomPeople[userId]) {
          roomPeople[userId].camera = true;
        }

        updatePeopleList();

        const video = document.getElementById(`video-${userId}`);

        if (video) {
          video.play().catch((error) => {
            console.error("Remote video playback error:", error);
          });
        }
      });

      // THIS is the important part.
      // When the other person's camera is turned off,
      // the WebRTC receiver can become muted while
      // still holding the last video frame.
      event.track.addEventListener("mute", () => {
        console.log("Remote camera muted:", userName);

        if (roomPeople[userId]) {
          roomPeople[userId].camera = false;
        }

        hideRemoteVideo(userId);
        updatePeopleList();
      });

      event.track.addEventListener("ended", () => {
        console.log("Remote camera track ended:", userName);

        if (roomPeople[userId]) {
          roomPeople[userId].camera = false;
        }

        hideRemoteVideo(userId);
        updatePeopleList();
      });
    }

    ensureRemoteVideo(userId, userName, stream);

    // If the user clicked the camera button before
    // the remote stream arrived, show it now.
    if (cameraWatchRequests[userId]) {
      const container = document.getElementById(`video-container-${userId}`);

      const video = document.getElementById(`video-${userId}`);

      if (container && video) {
        video.srcObject = stream;
        video.muted = false;
        container.style.display = "block";

        video.play().catch((error) => {
          console.error("Could not play remote video:", error);
        });

        console.log("I AM NOW WATCHING:", remoteNames[userId] || userId);

        socket.emit("camera-watching", {
          target: userId,
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

async function startConnection(userId, userName) {
  if (peerConnections[userId]) {
    return;
  }

  const pc = createPeerConnection(userId, userName, true);

  try {
    attachLocalTracks(pc);

    const offer = await pc.createOffer();

    await pc.setLocalDescription(offer);

    socket.emit("offer", {
      target: userId,

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

    attachLocalTracks(pc);

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

function attachLocalTracks(pc) {
  const transceivers = pc.getTransceivers();

  const audioTransceiver = transceivers.find(
    (transceiver) =>
      transceiver.receiver &&
      transceiver.receiver.track &&
      transceiver.receiver.track.kind === "audio",
  );

  if (audioTransceiver) {
    if (microphoneTrack) {
      audioTransceiver.sender.replaceTrack(microphoneTrack);

      audioTransceiver.direction = "sendrecv";
    } else {
      audioTransceiver.sender.replaceTrack(null);

      audioTransceiver.direction = "recvonly";
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
      videoTransceiver.sender.replaceTrack(videoTrack);

      videoTransceiver.direction = "sendrecv";
    } else {
      videoTransceiver.sender.replaceTrack(null);

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

    for (const userId in peerConnections) {
      const pc = peerConnections[userId];

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

      await renegotiate(userId, pc);
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

  for (const userId in peerConnections) {
    const pc = peerConnections[userId];

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

    await renegotiate(userId, pc);
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

    for (const userId in peerConnections) {
      const pc = peerConnections[userId];

      const audioTransceiver = pc
        .getTransceivers()
        .find(
          (transceiver) =>
            transceiver.receiver &&
            transceiver.receiver.track &&
            transceiver.receiver.track.kind === "audio",
        );

      if (audioTransceiver) {
        await audioTransceiver.sender.replaceTrack(microphoneTrack);

        audioTransceiver.direction = "sendrecv";
      }

      await renegotiate(userId, pc);
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

  for (const userId in peerConnections) {
    const pc = peerConnections[userId];

    const audioTransceiver = pc
      .getTransceivers()
      .find(
        (transceiver) =>
          transceiver.receiver &&
          transceiver.receiver.track &&
          transceiver.receiver.track.kind === "audio",
      );

    if (audioTransceiver) {
      await audioTransceiver.sender.replaceTrack(null);

      audioTransceiver.direction = "recvonly";
    }

    await renegotiate(userId, pc);
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

async function renegotiate(userId, pc) {
  try {
    if (pc.signalingState !== "stable") {
      return;
    }

    const offer = await pc.createOffer();

    await pc.setLocalDescription(offer);

    socket.emit("offer", {
      target: userId,

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
  let container = document.getElementById("local-video-container");

  if (!container) {
    container = document.createElement("div");

    container.id = "local-video-container";

    container.className = "video-container";

    videos.prepend(container);

    const video = document.createElement("video");

    video.id = "local-video";

    video.autoplay = true;

    video.muted = true;

    video.playsInline = true;

    container.appendChild(video);

    const label = document.createElement("div");

    label.className = "username";

    label.textContent = `${username} (You)`;

    container.appendChild(label);
  }

  const video = document.getElementById("local-video");

  video.srcObject = localStream;

  video.play().catch((error) => {
    console.log("Local video playback:", error);
  });
}

// =========================================
// HIDE LOCAL VIDEO
// =========================================

function hideLocalVideo() {
  const container = document.getElementById("local-video-container");

  if (container) {
    container.remove();
  }
}

// =========================================
// REMOTE VIDEO
// =========================================

function ensureRemoteVideo(userId, userName, stream) {
  let container = document.getElementById(`video-container-${userId}`);

  if (!container) {
    container = document.createElement("div");

    container.id = `video-container-${userId}`;

    container.className = "video-container";

    container.style.display = "none";

    const video = document.createElement("video");

    video.id = `video-${userId}`;

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
      hideRemoteVideo(userId);
    });

    container.appendChild(closeButton);

    const label = document.createElement("div");

    label.className = "username";

    label.textContent = userName;

    container.appendChild(label);

    videos.appendChild(container);

    video.addEventListener("loadedmetadata", () => {
      video.play().catch((error) => {
        console.log("Remote video playback waiting:", error);
      });
    });
  }

  const video = document.getElementById(`video-${userId}`);

  if (video.srcObject !== stream) {
    video.srcObject = stream;
  }

  video.play().catch((error) => {
    console.log("Remote video play attempt:", error);
  });
}

function showRemoteVideo(userId) {
  console.log("Camera button clicked for:", userId);

  // Remember that this user wants to watch this camera.
  cameraWatchRequests[userId] = true;

  const stream = remoteStreams[userId];

  // If the WebRTC connection doesn't exist yet,
  // start it now.
  if (!peerConnections[userId]) {
    const userName = remoteNames[userId] || "User";

    console.log("Starting remote camera connection for:", userName);

    startConnection(userId, userName);

    return;
  }

  // The connection exists, but the media stream hasn't arrived yet.
  // ontrack will finish showing it when it arrives.
  if (!stream) {
    console.log("Waiting for remote camera stream:", userId);

    return;
  }

  let container = document.getElementById(`video-container-${userId}`);

  let video = document.getElementById(`video-${userId}`);

  // Create the video tile if it doesn't exist yet.
  if (!container || !video) {
    ensureRemoteVideo(userId, remoteNames[userId] || "User", stream);

    container = document.getElementById(`video-container-${userId}`);

    video = document.getElementById(`video-${userId}`);
  }

  if (!container || !video) {
    console.warn("Could not create remote video:", userId);
    return;
  }

  video.srcObject = stream;

  video.muted = false;

  container.style.display = "block";

  video.play().catch((error) => {
    console.error("Could not play remote video:", error);
  });

  console.log("I AM NOW WATCHING:", remoteNames[userId] || userId);

  socket.emit("camera-watching", {
    target: userId,
    watching: true,
  });
}

function hideRemoteVideo(userId) {
  delete cameraWatchRequests[userId];

  const container = document.getElementById(`video-container-${userId}`);

  if (container) {
    container.style.display = "none";
  }

  console.log("I STOPPED WATCHING:", remoteNames[userId] || userId);

  socket.emit("camera-watching", {
    target: userId,
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

    for (const userId in peerConnections) {
      const pc = peerConnections[userId];

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

      await renegotiate(userId, pc);
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

  for (const userId in peerConnections) {
    const pc = peerConnections[userId];

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

    await renegotiate(userId, pc);
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
    roomId: roomId,

    message: message,
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
    const destination = roomRow.href;

    if (!destination || !loggedIn || !inRoom) {
      return;
    }

    const destinationUrl = new URL(destination, window.location.origin);

    const pathParts = destinationUrl.pathname.split("/");

    const newRoomId =
      pathParts[1] === "room" && pathParts[2]
        ? decodeURIComponent(pathParts[2])
        : "general";

    if (newRoomId === roomId) {
      event.preventDefault();
      return;
    }

    event.preventDefault();

    console.log("Switching rooms:", roomId, "->", newRoomId);

    // IMPORTANT:
    // Do not call stopAllMedia() here.
    // The local camera, microphone, and screen share stay running.
    inRoom = false;

    // Close only the old room's remote WebRTC connections.
    Object.keys(peerConnections).forEach((remoteUserId) => {
      const pc = peerConnections[remoteUserId];

      if (pc) {
        pc.close();
      }

      delete peerConnections[remoteUserId];
    });

    // Remove old remote streams and names.
    Object.keys(remoteStreams).forEach((remoteUserId) => {
      delete remoteStreams[remoteUserId];
    });

    Object.keys(remoteNames).forEach((remoteUserId) => {
      delete remoteNames[remoteUserId];
    });

    // Clear old room people and camera watchers.
    Object.keys(roomPeople).forEach((remoteUserId) => {
      delete roomPeople[remoteUserId];
    });

    Object.keys(cameraWatchers).forEach((watcherId) => {
      delete cameraWatchers[watcherId];
    });

    // Remove old remote video tiles.
    // Keep our local camera tile.
    videos.querySelectorAll(".video-container").forEach((container) => {
      if (container.id !== "local-video-container") {
        container.remove();
      }
    });

    // Clear the old room's chat immediately.
    messages.innerHTML = "";

    updatePeopleList();
    updateWatchingList();

    // Change the room without reloading the webpage.
    // This is what keeps the local camera alive.
    roomId = newRoomId;

    window.history.pushState({}, "", destinationUrl.pathname);

    updateRoomInfo();
    highlightCurrentRoom();

    // Join the new room using the same socket
    // and the same local media.
    joinRoom();
  });
});

// =========================================
// REMOVE PEER
// =========================================

function removePeer(userId) {
  const pc = peerConnections[userId];

  if (pc) {
    pc.close();

    delete peerConnections[userId];
  }

  delete remoteStreams[userId];

  delete remoteNames[userId];

  delete cameraWatchers[userId];

  updateWatchingList();

  const container = document.getElementById(`video-container-${userId}`);

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
