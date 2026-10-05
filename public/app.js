const socket = io();

const joinButton = document.getElementById("joinButton");
const muteButton = document.getElementById("muteButton");
const cameraButton = document.getElementById("cameraButton");
const screenButton = document.getElementById("screenButton");
const leaveButton = document.getElementById("leaveButton");

const usernameInput = document.getElementById("usernameInput");
const usernameArea = document.getElementById("usernameArea");
const videos = document.getElementById("videos");
const messages = document.getElementById("messages");
const messageInput = document.getElementById("messageInput");
const sendButton = document.getElementById("sendButton");
const roomInfo = document.getElementById("roomInfo");
const peopleList = document.getElementById("peopleList");
const peopleTitle = document.getElementById("peopleTitle");
const copyLinkButton = document.getElementById("copyLinkButton");

const roomId = window.location.pathname.split("/").pop();

let username = "";

let localStream = new MediaStream();

let peerConnections = {};
let remoteNames = {};
let remoteStreams = {};

let roomPeople = {};

let microphoneOn = false;
let cameraOn = false;
let screenSharing = false;

let screenTrack = null;
let cameraTrack = null;
let microphoneTrack = null;

// --------------------------------------------------
// ROOM
// --------------------------------------------------

roomInfo.textContent = `Room: ${roomId}`;

joinButton.addEventListener("click", joinRoom);

function joinRoom() {
  username = usernameInput.value.trim();

  if (!username) {
    alert("Please enter a username.");
    return;
  }

  socket.emit("join-room", {
    roomId: roomId,
    username: username,
  });

  usernameArea.style.display = "none";

  joinButton.disabled = true;

  muteButton.disabled = false;
  cameraButton.disabled = false;
  screenButton.disabled = false;
  leaveButton.disabled = false;

  console.log("Joining room:", roomId);
}

// --------------------------------------------------
// COPY ROOM LINK
// --------------------------------------------------

copyLinkButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(window.location.href);

    copyLinkButton.textContent = "✓ Link Copied!";

    setTimeout(() => {
      copyLinkButton.textContent = "🔗 Copy Room Link";
    }, 2000);
  } catch (error) {
    console.error("Could not copy room link:", error);

    alert("Could not copy the room link.");
  }
});

// --------------------------------------------------
// PEOPLE IN ROOM
// --------------------------------------------------

function updatePeopleList() {
  peopleList.innerHTML = "";

  const peopleCount = Object.keys(roomPeople).length;

  peopleTitle.textContent = `People in Room (${peopleCount})`;

  Object.values(roomPeople).forEach((person) => {
    const div = document.createElement("div");

    div.className = "person";

    // NAME

    const nameSpan = document.createElement("span");

    nameSpan.className = "person-name";

    if (person.id === socket.id) {
      nameSpan.textContent = `${person.username} (You)`;
    } else {
      nameSpan.textContent = person.username;
    }

    div.appendChild(nameSpan);

    // STATUS AREA

    const statusArea = document.createElement("div");

    statusArea.className = "person-status";

    // CAMERA STATUS
    // Do NOT show a camera button
    // next to our own name.

    if (person.id !== socket.id) {
      const cameraStatus = document.createElement("button");

      cameraStatus.className = "status-icon camera-status";

      if (person.camera) {
        cameraStatus.textContent = "📹";

        cameraStatus.title = "Show / hide camera";

        cameraStatus.addEventListener("click", () => {
          const container = document.getElementById(
            `video-container-${person.id}`,
          );

          if (!container) {
            return;
          }

          if (container.style.display === "none") {
            showRemoteVideo(person.id);
          } else {
            hideRemoteVideo(person.id);
          }
        });
      } else {
        cameraStatus.textContent = "📹";

        cameraStatus.classList.add("off");

        cameraStatus.title = "Camera off";

        cameraStatus.disabled = true;
      }

      statusArea.appendChild(cameraStatus);
    }

    // MICROPHONE STATUS

    const micStatus = document.createElement("span");

    micStatus.className = "status-icon mic-status";

    if (person.microphone) {
      micStatus.textContent = "🎤";

      micStatus.title = "Microphone on";
    } else {
      micStatus.textContent = "🔇";

      micStatus.title = "Microphone off";
    }

    statusArea.appendChild(micStatus);

    div.appendChild(statusArea);

    peopleList.appendChild(div);
  });
}

// --------------------------------------------------
// SOCKET EVENTS
// --------------------------------------------------

socket.on("room-users", (users) => {
  console.log("Existing users:", users);

  roomPeople[socket.id] = {
    id: socket.id,
    username: username,
    camera: cameraOn,
    microphone: microphoneOn,
  };

  users.forEach((user) => {
    remoteNames[user.id] = user.username;

    roomPeople[user.id] = {
      id: user.id,
      username: user.username,
      camera: Boolean(user.camera),
      microphone: Boolean(user.microphone),
    };

    startConnection(user.id, user.username);
  });

  updatePeopleList();
});

socket.on("start-connection", (user) => {
  remoteNames[user.id] = user.username;

  if (!roomPeople[user.id]) {
    roomPeople[user.id] = {
      id: user.id,
      username: user.username,
      camera: Boolean(user.camera),
      microphone: Boolean(user.microphone),
    };
  }

  startConnection(user.id, user.username);

  updatePeopleList();
});

socket.on("user-joined", (user) => {
  console.log(`${user.username} joined`);

  remoteNames[user.id] = user.username;

  roomPeople[user.id] = {
    id: user.id,
    username: user.username,
    camera: Boolean(user.camera),
    microphone: Boolean(user.microphone),
  };

  updatePeopleList();
});

socket.on("user-left", (user) => {
  console.log(`${user.username} left`);

  delete roomPeople[user.id];

  updatePeopleList();

  removePeer(user.id);
});

socket.on("media-state", (state) => {
  console.log(`${state.username} media state:`, state);

  remoteNames[state.id] = state.username;

  if (roomPeople[state.id]) {
    roomPeople[state.id].camera = Boolean(state.camera);

    roomPeople[state.id].microphone = Boolean(state.microphone);
  } else {
    roomPeople[state.id] = {
      id: state.id,
      username: state.username,
      camera: Boolean(state.camera),
      microphone: Boolean(state.microphone),
    };
  }

  updatePeopleList();

  if (!state.camera) {
    hideRemoteVideo(state.id);
  }
});

// --------------------------------------------------
// CREATE PEER CONNECTION
// --------------------------------------------------

function createPeerConnection(
  userId,
  userName,
  createMediaTransceivers = false,
) {
  console.log("Creating peer connection:", userName);

  const pc = new RTCPeerConnection({
    iceServers: [
      {
        urls: "stun:stun.l.google.com:19302",
      },
    ],
  });

  peerConnections[userId] = pc;

  remoteNames[userId] = userName;

  if (createMediaTransceivers) {
    pc.addTransceiver("audio", {
      direction: "sendrecv",
    });

    pc.addTransceiver("video", {
      direction: "sendrecv",
    });
  }

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

    let stream = remoteStreams[userId];

    if (!stream) {
      stream = new MediaStream();

      remoteStreams[userId] = stream;
    }

    if (!stream.getTracks().some((track) => track.id === event.track.id)) {
      stream.addTrack(event.track);
    }

    ensureRemoteVideo(userId, userName, stream);
  };

  return pc;
}

// --------------------------------------------------
// START CONNECTION
// --------------------------------------------------

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

// --------------------------------------------------
// RECEIVE OFFER
// --------------------------------------------------

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

// --------------------------------------------------
// RECEIVE ANSWER
// --------------------------------------------------

socket.on("answer", async ({ sender, answer }) => {
  const pc = peerConnections[sender];

  if (!pc) {
    return;
  }

  try {
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
  } catch (error) {
    console.error("Error setting answer:", error);
  }
});

// --------------------------------------------------
// ICE CANDIDATE
// --------------------------------------------------

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

// --------------------------------------------------
// ATTACH LOCAL TRACKS
// --------------------------------------------------

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

// --------------------------------------------------
// CAMERA
// --------------------------------------------------

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

  for (const userId in peerConnections) {
    const pc = peerConnections[userId];

    const videoTransceiver = pc
      .getTransceivers()
      .find(
        (transceiver) =>
          transceiver.receiver &&
          transceiver.track &&
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

cameraButton.addEventListener("click", async () => {
  if (cameraOn) {
    await stopCamera();
  } else {
    await startCamera();
  }
});

// --------------------------------------------------
// MICROPHONE
// --------------------------------------------------

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

muteButton.addEventListener("click", async () => {
  if (microphoneOn) {
    await stopMicrophone();
  } else {
    await startMicrophone();
  }
});

// --------------------------------------------------
// RENEGOTIATE
// --------------------------------------------------

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

// --------------------------------------------------
// LOCAL VIDEO
// --------------------------------------------------

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
}

function hideLocalVideo() {
  const container = document.getElementById("local-video-container");

  if (container) {
    container.remove();
  }
}

// --------------------------------------------------
// REMOTE VIDEO
// --------------------------------------------------

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

    container.appendChild(video);

    // CLOSE BUTTON

    const closeButton = document.createElement("button");

    closeButton.className = "close-video-button";

    closeButton.textContent = "✕";

    closeButton.title = "Hide this video";

    closeButton.addEventListener("click", () => {
      hideRemoteVideo(userId);
    });

    container.appendChild(closeButton);

    // USERNAME

    const label = document.createElement("div");

    label.className = "username";

    label.textContent = userName;

    container.appendChild(label);

    videos.appendChild(container);
  }

  const video = document.getElementById(`video-${userId}`);

  if (video.srcObject !== stream) {
    video.srcObject = stream;
  }
}

function showRemoteVideo(userId) {
  const container = document.getElementById(`video-container-${userId}`);

  if (container) {
    container.style.display = "block";
  }
}

function hideRemoteVideo(userId) {
  const container = document.getElementById(`video-container-${userId}`);

  if (container) {
    container.style.display = "none";
  }
}

// --------------------------------------------------
// SCREEN SHARING
// --------------------------------------------------

screenButton.addEventListener("click", async () => {
  if (screenSharing) {
    stopScreenSharing();
  } else {
    await startScreenSharing();
  }
});

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

// --------------------------------------------------
// CHAT
// --------------------------------------------------

sendButton.addEventListener("click", sendMessage);

messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();

    sendMessage();
  }
});

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

socket.on("chat-message", ({ username: senderUsername, message }) => {
  const messageElement = document.createElement("div");

  // Determine whether this is our own message.
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

  timeElement.textContent = new Date().toLocaleTimeString([], {
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

  messages.appendChild(messageElement);

  messages.scrollTop = messages.scrollHeight;
});

// --------------------------------------------------
// REMOVE PEERS
// --------------------------------------------------

function removePeer(userId) {
  const pc = peerConnections[userId];

  if (pc) {
    pc.close();

    delete peerConnections[userId];
  }

  delete remoteStreams[userId];

  delete remoteNames[userId];

  const container = document.getElementById(`video-container-${userId}`);

  if (container) {
    container.remove();
  }
}

// --------------------------------------------------
// LEAVE ROOM
// --------------------------------------------------

leaveButton.addEventListener("click", () => {
  socket.emit("leave-room");

  Object.values(peerConnections).forEach((pc) => pc.close());

  peerConnections = {};

  remoteStreams = {};

  remoteNames = {};

  roomPeople = {};

  updatePeopleList();

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

  cameraOn = false;

  microphoneOn = false;

  screenSharing = false;

  hideLocalVideo();

  videos.innerHTML = "";

  muteButton.disabled = true;

  cameraButton.disabled = true;

  screenButton.disabled = true;

  leaveButton.disabled = true;

  muteButton.textContent = "🎤 Mic On";

  cameraButton.textContent = "📹 Camera On";

  screenButton.textContent = "🖥️ Share Screen";

  usernameArea.style.display = "block";

  usernameInput.disabled = false;

  joinButton.disabled = false;

  usernameInput.value = "";

  console.log("Left room. Ready to join again.");
});
