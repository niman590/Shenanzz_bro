const remoteVideo = document.getElementById("remoteVideo");
const streamOverlay = document.getElementById("streamOverlay");
const streamStatus = document.getElementById("streamStatus");
const qualitySelect = document.getElementById("qualitySelect");
const fpsSelect = document.getElementById("fpsSelect");
const newsGrid = document.getElementById("newsGrid");
const sideNews = document.getElementById("sideNews");
const topTicker = document.getElementById("topTicker");
const breakingTicker = document.getElementById("breakingTicker");
const heroCard = document.getElementById("heroCard");
const heroCategory = document.getElementById("heroCategory");
const heroTitle = document.getElementById("heroTitle");
const heroSummary = document.getElementById("heroSummary");
const heroReadMore = document.getElementById("heroReadMore");
const heroDots = document.getElementById("heroDots");
const modal = document.getElementById("modal");
const modalTitle = document.getElementById("modalTitle");
const modalText = document.getElementById("modalText");
const modalLink = document.getElementById("modalLink");
const closeModal = document.getElementById("closeModal");
const searchModal = document.getElementById("searchModal");
const searchBtn = document.getElementById("searchBtn");
const closeSearch = document.getElementById("closeSearch");
const searchInput = document.getElementById("searchInput");
const searchResults = document.getElementById("searchResults");
const scoreCards = document.getElementById("scoreCards");
const liveTitle = document.getElementById("liveTitle");
const liveDescription = document.getElementById("liveDescription");

let allNews = [];
let shownNewsCount = 3;
let heroIndex = 0;
let socket;
let peerConnection;
let currentUserId = null;

const rtcConfig = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

remoteVideo.preload = "metadata";
remoteVideo.playsInline = true;

function showModal(title, text, url = "") {
  modalTitle.textContent = title;
  modalText.textContent = text;

  if (url) {
    modalLink.href = url;
    modalLink.classList.remove("hidden");
  } else {
    modalLink.classList.add("hidden");
  }

  modal.classList.remove("hidden");
}

function hideModal() {
  modal.classList.add("hidden");
}

closeModal.addEventListener("click", hideModal);

modal.addEventListener("click", (event) => {
  if (event.target === modal) {
    hideModal();
  }
});

document.querySelectorAll("[data-scroll]").forEach((button) => {
  button.addEventListener("click", () => {
    const target = document.querySelector(button.dataset.scroll);

    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
});

document.querySelectorAll(".top-socials button,.footer-socials button").forEach((button) => {
  button.addEventListener("click", () => {
    showModal("SN CRICK Social", `${button.textContent.toUpperCase()} link is ready. Add your real social URL later.`);
  });
});

function sendLiveQualityPreference() {
  if (!socket || socket.readyState !== WebSocket.OPEN || !currentUserId) {
    return;
  }

  socket.send(JSON.stringify({
    type: "quality-change",
    quality: qualitySelect ? qualitySelect.value : "auto",
    fps: fpsSelect ? fpsSelect.value : "auto"
  }));

  const qualityText = qualitySelect ? qualitySelect.options[qualitySelect.selectedIndex].text : "Auto";
  const fpsText = fpsSelect ? fpsSelect.options[fpsSelect.selectedIndex].text : "Auto FPS";

  if (!streamStatus.textContent.includes("Waiting")) {
    streamStatus.textContent = `Live quality set to ${qualityText} / ${fpsText}`;
  }
}

if (qualitySelect) {
  qualitySelect.addEventListener("change", sendLiveQualityPreference);
}

if (fpsSelect) {
  fpsSelect.addEventListener("change", sendLiveQualityPreference);
}

document.getElementById("watchLiveBtn").addEventListener("click", () => {
  document.getElementById("live-top").scrollIntoView({ behavior: "smooth" });
  remoteVideo.muted = false;

  remoteVideo.play().catch(() => {
    showModal("Live Stream", "Click the video play button if your browser blocks autoplay.");
  });
});

remoteVideo.addEventListener("waiting", () => {
  streamStatus.textContent = "Live stream is buffering. Try 144p, 240p or lower FPS.";
});

remoteVideo.addEventListener("playing", () => {
  streamStatus.textContent = "Live stream is playing. Sound depends on admin screen-share audio.";
  streamOverlay && streamOverlay.classList.add("hidden");
});

remoteVideo.addEventListener("pause", () => {
  if (remoteVideo.srcObject) {
    streamStatus.textContent = "Live connected. Click play to continue.";
  }
});

document.getElementById("newsletterForm").addEventListener("submit", (event) => {
  event.preventDefault();

  const value = document.getElementById("emailInput").value.trim();

  if (!value || !value.includes("@")) {
    return showModal("Newsletter", "Please enter a valid email address.");
  }

  showModal("Subscribed!", `Thanks! ${value} has been added to the SN CRICK newsletter demo list.`);
  event.target.reset();
});

searchBtn.addEventListener("click", () => {
  searchModal.classList.remove("hidden");
  searchInput.focus();
  renderSearchResults("");
});

closeSearch.addEventListener("click", () => searchModal.classList.add("hidden"));

searchModal.addEventListener("click", (event) => {
  if (event.target === searchModal) {
    searchModal.classList.add("hidden");
  }
});

searchInput.addEventListener("input", () => renderSearchResults(searchInput.value));

function renderSearchResults(query) {
  query = query.toLowerCase();

  const results = allNews.filter((item) =>
    item.title.toLowerCase().includes(query) ||
    item.category.toLowerCase().includes(query) ||
    item.summary.toLowerCase().includes(query)
  );

  searchResults.innerHTML = results.length
    ? results.map((item) => `<div class="search-result"><strong>${item.title}</strong><p>${item.summary}</p></div>`).join("")
    : "<p>No cricket news found.</p>";
}

async function loadLiveInfo() {
  try {
    const response = await fetch("/api/live-info");
    const info = await response.json();

    liveTitle.textContent = info.title;
    liveDescription.textContent = info.description;
    streamStatus.textContent = info.status;
  } catch (error) {
    console.error(error);
  }
}

async function loadNews() {
  try {
    const response = await fetch("/api/news");
    allNews = await response.json();

    topTicker.textContent = allNews.map((item) => item.title).join(" • ");
    breakingTicker.textContent = allNews.slice(0, 5).map((item) => item.title).join(" • ");

    renderHero();
    renderSideNews();
    renderNewsCards();
  } catch (error) {
    console.error(error);
    topTicker.textContent = "News loading failed. Check backend.";
    breakingTicker.textContent = "News loading failed.";
  }
}

function renderHero() {
  const item = allNews[heroIndex];

  if (!item) {
    return;
  }

  heroCard.style.backgroundImage = `linear-gradient(90deg,rgba(8,53,121,.92),rgba(8,53,121,.32),rgba(8,53,121,.8)),url('${item.image}')`;
  heroCategory.textContent = item.category;
  heroTitle.textContent = item.title;
  heroSummary.textContent = item.summary;
  heroReadMore.onclick = () => showModal(item.title, item.full || item.summary, item.url || "");

  heroDots.innerHTML = allNews
    .slice(0, 5)
    .map((_, index) => `<button class="${index === heroIndex ? "active" : ""}" data-index="${index}"></button>`)
    .join("");

  heroDots.querySelectorAll("button").forEach((dot) => {
    dot.addEventListener("click", () => {
      heroIndex = Number(dot.dataset.index);
      renderHero();
    });
  });
}

function nextHero() {
  if (allNews.length) {
    heroIndex = (heroIndex + 1) % Math.min(allNews.length, 5);
    renderHero();
  }
}

function prevHero() {
  if (allNews.length) {
    heroIndex = (heroIndex - 1 + Math.min(allNews.length, 5)) % Math.min(allNews.length, 5);
    renderHero();
  }
}

document.getElementById("heroRight").addEventListener("click", nextHero);
document.getElementById("heroLeft").addEventListener("click", prevHero);
document.getElementById("nextHero").addEventListener("click", nextHero);
document.getElementById("prevHero").addEventListener("click", prevHero);

function renderSideNews() {
  sideNews.innerHTML = allNews
    .slice(0, 4)
    .map((item) => `<article class="side-item"><img src="${item.image}" alt="${item.title}"><div><h4>${item.title}</h4><p>${item.date}</p></div></article>`)
    .join("");
}

function renderNewsCards() {
  newsGrid.innerHTML = allNews
    .slice(0, shownNewsCount)
    .map((item) => `<article class="news-card"><div class="news-img" style="background-image:url('${item.image}')"><span class="news-tag">${item.category}</span></div><div class="news-body"><h4>${item.title}</h4><p>${item.summary}</p><div class="news-meta"><span>${item.date}</span><span>${item.source || "SN CRICK"}</span></div><button data-news-id="${item.id}">Read More</button></div></article>`)
    .join("");

  newsGrid.querySelectorAll("button[data-news-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = allNews.find((newsItem) => newsItem.id === Number(button.dataset.newsId));

      if (item) {
        showModal(item.title, item.full || item.summary, item.url || "");
      }
    });
  });

  document.getElementById("loadMoreNews").textContent = shownNewsCount >= allNews.length ? "Show Less" : "Load More";
}

document.getElementById("loadMoreNews").addEventListener("click", () => {
  shownNewsCount = shownNewsCount >= allNews.length ? 3 : allNews.length;
  renderNewsCards();
});

async function loadScores() {
  try {
    const response = await fetch("/api/scores");
    const scores = await response.json();

    scoreCards.innerHTML = scores
      .map((score) => `<div class="score-card"><h4>${score.match}</h4><p><strong>${score.status}</strong> — ${score.score}</p>${score.note && score.note.startsWith("http") ? `<a href="${score.note}" target="_blank">Open match</a>` : `<p>${score.note || ""}</p>`}</div>`)
      .join("");
  } catch (error) {
    scoreCards.innerHTML = "<p>Scores loading failed.</p>";
  }
}

document.getElementById("refreshScores").addEventListener("click", loadScores);

function connectLiveWebRTC() {
  const protocol = location.protocol === "https:" ? "wss" : "ws";

  socket = new WebSocket(`${protocol}://${location.host}/ws/live`);

  socket.onopen = () => {
    socket.send(JSON.stringify({ role: "user" }));

    if (!streamStatus.textContent.includes("Live")) {
      streamStatus.textContent = "Connected. Waiting for admin stream...";
    }
  };

  socket.onmessage = async (event) => {
    const message = JSON.parse(event.data);

    if (message.type === "user-id") {
      currentUserId = message.userId;
      sendLiveQualityPreference();
    }

    if (message.type === "offer") {
      await handleOffer(message);
    }

    if (message.type === "candidate" && peerConnection) {
      try {
        await peerConnection.addIceCandidate(message.candidate);
      } catch (error) {
        console.error(error);
      }
    }

    if (message.type === "admin-offline") {
      streamStatus.textContent = "Admin is offline. Waiting for live stream...";
      streamOverlay && streamOverlay.classList.remove("hidden");
    }

    if (message.type === "admin-live") {
      streamStatus.textContent = "Admin started live. Connecting...";
      sendLiveQualityPreference();
    }
  };

  socket.onclose = () => {
    streamStatus.textContent = "Connection closed. Reconnecting...";
    setTimeout(connectLiveWebRTC, 2500);
  };
}

async function handleOffer(message) {
  if (peerConnection) {
    peerConnection.close();
  }

  peerConnection = new RTCPeerConnection(rtcConfig);

  peerConnection.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
    streamStatus.textContent = "Live connected. Starting playback...";
    streamOverlay && streamOverlay.classList.add("hidden");

    remoteVideo.play().catch(() => {
      streamStatus.textContent = "Live connected. Click play if needed.";
    });
  };

  peerConnection.onconnectionstatechange = () => {
    if (peerConnection.connectionState === "failed" || peerConnection.connectionState === "disconnected") {
      streamStatus.textContent = "Live connection is weak. Try lower quality or lower FPS.";
      streamOverlay && streamOverlay.classList.remove("hidden");
    }

    if (peerConnection.connectionState === "connected") {
      streamStatus.textContent = "Live stream connected.";
      sendLiveQualityPreference();
    }
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: "candidate",
        candidate: event.candidate
      }));
    }
  };

  await peerConnection.setRemoteDescription(message.offer);

  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);

  socket.send(JSON.stringify({
    type: "answer",
    target: message.from,
    answer
  }));
}

loadLiveInfo();
loadNews();
loadScores();
connectLiveWebRTC();

setInterval(loadLiveInfo, 30000);
setInterval(loadNews, 300000);
setInterval(loadScores, 60000);
setInterval(nextHero, 7000);