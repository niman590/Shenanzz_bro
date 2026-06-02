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
let userStreamSettings = {};

const rtcConfig = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

const STREAM_VIDEO_CONSTRAINTS = {
  width: { ideal: 1920, max: 1920 },
  height: { ideal: 1080, max: 1080 },
  frameRate: { ideal: 60, max: 60 },
  cursor: "always",
  displaySurface: "browser"
};

const STREAM_AUDIO_CONSTRAINTS = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false
};

const QUALITY_PROFILES = {
  auto: { label: "Auto", maxBitrate: 1200000, maxFramerate: 30, scaleResolutionDownBy: 2.0 },
  q144: { label: "144p", maxBitrate: 120000, maxFramerate: 24, scaleResolutionDownBy: 7.5 },
  q240: { label: "240p", maxBitrate: 250000, maxFramerate: 24, scaleResolutionDownBy: 4.5 },
  q360: { label: "360p", maxBitrate: 450000, maxFramerate: 30, scaleResolutionDownBy: 3.0 },
  q480: { label: "480p", maxBitrate: 800000, maxFramerate: 30, scaleResolutionDownBy: 2.25 },
  q720: { label: "720p", maxBitrate: 1800000, maxFramerate: 30, scaleResolutionDownBy: 1.5 },
  q1080: { label: "1080p", maxBitrate: 3500000, maxFramerate: 60, scaleResolutionDownBy: 1.0 }
};

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

function getUserProfile(userId) {
  const savedSettings = userStreamSettings[userId] || {};
  const quality = savedSettings.quality || "auto";
  const fps = savedSettings.fps || "auto";
  const profile = { ...(QUALITY_PROFILES[quality] || QUALITY_PROFILES.auto) };

  if (fps !== "auto") {
    profile.maxFramerate = Number(fps);
  }

  if (profile.maxFramerate >= 60 && profile.maxBitrate < 2500000) {
    profile.maxBitrate = Math.max(profile.maxBitrate, 2500000);
  }

  return profile;
}

async function applyUserStreamSettings(userId) {
  const peerConnection = peerConnections[userId];

  if (!peerConnection) {
    return;
  }

  const videoSender = peerConnection
    .getSenders()
    .find((sender) => sender.track && sender.track.kind === "video");

  if (!videoSender) {
    return;
  }

  try {
    const profile = getUserProfile(userId);
    const params = videoSender.getParameters();

    if (!params.encodings || !params.encodings.length) {
      params.encodings = [{}];
    }

    params.encodings[0].maxBitrate = profile.maxBitrate;
    params.encodings[0].maxFramerate = profile.maxFramerate;
    params.encodings[0].scaleResolutionDownBy = profile.scaleResolutionDownBy;

    params.degradationPreference = "maintain-framerate";

    await videoSender.setParameters(params);
  } catch (error) {
    console.warn("Could not apply user stream settings:", error);
  }
}

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

      if (!userStreamSettings[message.userId]) {
        userStreamSettings[message.userId] = { quality: "auto", fps: "auto" };
      }

      if (localStream) {
        await createOfferForUser(message.userId);
      }
    }

    if (message.type === "quality-change") {
      const userId = message.userId;

      if (userId) {
        userStreamSettings[userId] = {
          quality: message.quality || "auto",
          fps: message.fps || "auto"
        };

        await applyUserStreamSettings(userId);

        const profile = getUserProfile(userId);
        console.log(`Viewer ${userId} changed quality to ${profile.label}, FPS ${profile.maxFramerate}`);
      }
    }

    if (message.type === "answer") {
      const peerConnection = peerConnections[message.userId];

      if (peerConnection) {
        await peerConnection.setRemoteDescription(message.answer);
        await applyUserStreamSettings(message.userId);
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

      delete userStreamSettings[message.userId];
    }
  };

  socket.onclose = () => {
    adminStatus.textContent = "Status: Signaling disconnected. Reconnecting...";
    setTimeout(connectAdminSocket, 2500);
  };
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

  await applyUserStreamSettings(userId);

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
    adminStatus.textContent = "Status: Full HD live stream started. Users can select 144p to 1080p and FPS.";

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