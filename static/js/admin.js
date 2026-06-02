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
let viewerQualities = {};

const rtcConfig = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

/*
  Full-quality admin screen share + per-user quality selection.
  Admin captures Full HD once. Each viewer can request 144p, 240p, 360p, 480p, 720p, or 1080p.
  WebRTC will apply bitrate, frame rate, and scaleResolutionDownBy per viewer.
*/
const STREAM_VIDEO_CONSTRAINTS = {
  width: { ideal: 1920, max: 1920 },
  height: { ideal: 1080, max: 1080 },
  frameRate: { ideal: 30, max: 30 },
  cursor: "always",
  displaySurface: "browser"
};

const STREAM_AUDIO_CONSTRAINTS = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false
};

const QUALITY_SETTINGS = {
  auto: { label: "Auto", bitrate: 800000, framerate: 24, scaleResolutionDownBy: 1.5 },
  q144: { label: "144p", bitrate: 150000, framerate: 12, scaleResolutionDownBy: 5 },
  q240: { label: "240p", bitrate: 300000, framerate: 15, scaleResolutionDownBy: 3 },
  q360: { label: "360p", bitrate: 500000, framerate: 20, scaleResolutionDownBy: 2 },
  q480: { label: "480p", bitrate: 800000, framerate: 24, scaleResolutionDownBy: 1.5 },
  q720: { label: "720p HD", bitrate: 1800000, framerate: 30, scaleResolutionDownBy: 1.5 },
  q1080: { label: "1080p Full HD", bitrate: 3000000, framerate: 30, scaleResolutionDownBy: 1 }
};

function getQualitySettings(userId) {
  return QUALITY_SETTINGS[viewerQualities[userId]] || QUALITY_SETTINGS.auto;
}

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

    if (message.type === "quality-change") {
      viewerQualities[message.userId] = QUALITY_SETTINGS[message.quality] ? message.quality : "auto";

      if (localStream) {
        await createOfferForUser(message.userId);
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

      delete viewerQualities[message.userId];

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

async function limitVideoSenderBitrate(peerConnection, userId) {
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

    const quality = getQualitySettings(userId);

    params.encodings[0].maxBitrate = quality.bitrate;
    params.encodings[0].maxFramerate = quality.framerate;
    params.encodings[0].scaleResolutionDownBy = quality.scaleResolutionDownBy;
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

  await limitVideoSenderBitrate(peerConnection, userId);

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
    adminStatus.textContent = "Status: Admin live started in Full HD 1080p. Users can select 144p, 240p, 360p, 480p, 720p, or 1080p.";

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
