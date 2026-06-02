const startBtn = document.getElementById("startStream");
const stopBtn = document.getElementById("stopStream");
const copyUserLinkBtn = document.getElementById("copyUserLink");
const localVideo = document.getElementById("localVideo");
const adminStatus = document.getElementById("adminStatus");
const viewerCount = document.getElementById("viewerCount");
const toast = document.getElementById("adminToast");
const liveInfoForm = document.getElementById("liveInfoForm");
const adminLiveTitle = document.getElementById("adminLiveTitle");
const adminLiveDescription = document.getElementById("adminLiveDescription");
const adminLiveStatus = document.getElementById("adminLiveStatus");

let socket;
let localStream;
let peerConnections = {};
let knownUsers = new Set();

const rtcConfig = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

/*
  Low-end-device stream fix:
  - 480p screen share
  - 15–20 FPS
  - 600 kbps max video bitrate
  This keeps the live stream smoother for weak phones and slow internet.
*/
const STREAM_VIDEO_CONSTRAINTS = {
  width: { ideal: 854, max: 854 },
  height: { ideal: 480, max: 480 },
  frameRate: { ideal: 15, max: 20 },
  cursor: "always",
  displaySurface: "browser"
};

const STREAM_AUDIO_CONSTRAINTS = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false
};

const VIDEO_MAX_BITRATE = 600000; // 600 kbps
const VIDEO_MAX_FRAMERATE = 20;

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove("hidden");

  setTimeout(() => toast.classList.add("hidden"), 2600);
}

function updateViewerCount() {
  viewerCount.textContent = `Connected viewers: ${knownUsers.size}`;
}

async function loadLiveInfo() {
  try {
    const response = await fetch("/api/live-info");
    const info = await response.json();

    adminLiveTitle.value = info.title;
    adminLiveDescription.value = info.description;
    adminLiveStatus.value = info.status;
  } catch (error) {
    console.error(error);
  }
}

liveInfoForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData();
  formData.append("title", adminLiveTitle.value.trim() || "Today Live Cricket Stream");
  formData.append("description", adminLiveDescription.value.trim() || "Admin will update this section with match details.");
  formData.append("status", adminLiveStatus.value.trim() || "Waiting for admin live stream");

  try {
    await fetch("/api/live-info", {
      method: "POST",
      body: formData
    });

    showToast("Live details saved.");
  } catch (error) {
    showToast("Could not save live details.");
  }
});

function connectAdminSocket() {
  const protocol = location.protocol === "https:" ? "wss" : "ws";

  socket = new WebSocket(`${protocol}://${location.host}/ws/live`);

  socket.onopen = () => {
    socket.send(JSON.stringify({ role: "admin" }));
    adminStatus.textContent = "Status: Admin connected. Ready to stream.";
  };

  socket.onmessage = async (event) => {
    const message = JSON.parse(event.data);

    if (message.type === "user-joined") {
      knownUsers.add(message.userId);
      updateViewerCount();
      showToast("A viewer connected.");

      if (localStream) {
        await createOfferForUser(message.userId);
      }
    }

    if (message.type === "answer") {
      const peerConnection = peerConnections[message.userId];

      if (peerConnection) {
        await peerConnection.setRemoteDescription(message.answer);
      }
    }

    if (message.type === "candidate") {
      const peerConnection = peerConnections[message.userId];

      if (peerConnection) {
        try {
          await peerConnection.addIceCandidate(message.candidate);
        } catch (error) {
          console.error(error);
        }
      }
    }

    if (message.type === "user-left") {
      knownUsers.delete(message.userId);
      updateViewerCount();

      if (peerConnections[message.userId]) {
        peerConnections[message.userId].close();
        delete peerConnections[message.userId];
      }
    }
  };

  socket.onclose = () => {
    adminStatus.textContent = "Status: Signaling disconnected. Reconnecting...";
    setTimeout(connectAdminSocket, 2500);
  };
}

async function limitVideoSenderBitrate(peerConnection) {
  const videoSender = peerConnection
    .getSenders()
    .find((sender) => sender.track && sender.track.kind === "video");

  if (!videoSender) {
    return;
  }

  try {
    const params = videoSender.getParameters();

    if (!params.encodings || !params.encodings.length) {
      params.encodings = [{}];
    }

    params.encodings[0].maxBitrate = VIDEO_MAX_BITRATE;
    params.encodings[0].maxFramerate = VIDEO_MAX_FRAMERATE;
    params.degradationPreference = "maintain-framerate";

    await videoSender.setParameters(params);
  } catch (error) {
    console.warn("Could not apply bitrate limit:", error);
  }
}

async function createOfferForUser(userId) {
  if (!localStream || !socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  if (peerConnections[userId]) {
    peerConnections[userId].close();
  }

  const peerConnection = new RTCPeerConnection(rtcConfig);
  peerConnections[userId] = peerConnection;

  localStream.getTracks().forEach((track) => {
    peerConnection.addTrack(track, localStream);
  });

  await limitVideoSenderBitrate(peerConnection);

  peerConnection.onicecandidate = (event) => {
    if (event.candidate && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: "candidate",
        target: userId,
        candidate: event.candidate
      }));
    }
  };

  const offer = await peerConnection.createOffer({
    offerToReceiveAudio: true,
    offerToReceiveVideo: true
  });

  await peerConnection.setLocalDescription(offer);

  socket.send(JSON.stringify({
    type: "offer",
    target: userId,
    from: "admin",
    offer
  }));
}

startBtn.addEventListener("click", async () => {
  try {
    localStream = await navigator.mediaDevices.getDisplayMedia({
      video: STREAM_VIDEO_CONSTRAINTS,
      audio: STREAM_AUDIO_CONSTRAINTS
    });

    localVideo.srcObject = localStream;
    adminStatus.textContent = "Status: Optimized 480p live stream started. For sound, share a Chrome tab and tick Share tab audio.";

    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "admin-live" }));
    }

    for (const userId of knownUsers) {
      await createOfferForUser(userId);
    }

    const videoTrack = localStream.getVideoTracks()[0];

    if (videoTrack) {
      videoTrack.onended = stopStream;
    }
  } catch (error) {
    adminStatus.textContent = "Status: Screen share cancelled or blocked.";
    console.error(error);
  }
});

stopBtn.addEventListener("click", stopStream);

function stopStream() {
  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    localStream = null;
  }

  Object.values(peerConnections).forEach((peerConnection) => peerConnection.close());
  peerConnections = {};

  localVideo.srcObject = null;
  adminStatus.textContent = "Status: Stream stopped.";
}

copyUserLinkBtn.addEventListener("click", async () => {
  const link = location.origin + "/";

  try {
    await navigator.clipboard.writeText(link);
    showToast("User website link copied.");
  } catch {
    showToast(link);
  }
});

loadLiveInfo();
connectAdminSocket();
updateViewerCount();
