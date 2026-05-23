const DB_NAME = "pocket-deck";
const DB_VERSION = 1;
const STORE_NAME = "tracks";
const PLAYLISTS_STORAGE_KEY = "pocket-deck-playlists-v1";

const elements = {
  activeFilterLabel: document.querySelector("#activeFilterLabel"),
  allFilterButton: document.querySelector("#allFilterButton"),
  audio: document.querySelector("#audio"),
  clearButton: document.querySelector("#clearButton"),
  currentTime: document.querySelector("#currentTime"),
  createPlaylistButton: document.querySelector("#createPlaylistButton"),
  duration: document.querySelector("#duration"),
  emptyTemplate: document.querySelector("#emptyTemplate"),
  favoriteCurrentButton: document.querySelector("#favoriteCurrentButton"),
  favoritesFilterButton: document.querySelector("#favoritesFilterButton"),
  fileInput: document.querySelector("#fileInput"),
  heroCoverText: document.querySelector("#heroCoverText"),
  installButton: document.querySelector("#installButton"),
  miniMeta: document.querySelector("#miniMeta"),
  miniTitle: document.querySelector("#miniTitle"),
  muteButton: document.querySelector("#muteButton"),
  nextButton: document.querySelector("#nextButton"),
  playlistList: document.querySelector("#playlistList"),
  playlistNameInput: document.querySelector("#playlistNameInput"),
  playButton: document.querySelector("#playButton"),
  playIcon: document.querySelector("#playIcon"),
  previousButton: document.querySelector("#previousButton"),
  progress: document.querySelector("#progress"),
  queueHint: document.querySelector("#queueHint"),
  queueList: document.querySelector("#queueList"),
  repeatButton: document.querySelector("#repeatButton"),
  searchInput: document.querySelector("#searchInput"),
  shuffleButton: document.querySelector("#shuffleButton"),
  sleepSelect: document.querySelector("#sleepSelect"),
  sleepStatus: document.querySelector("#sleepStatus"),
  sortSelect: document.querySelector("#sortSelect"),
  speedSelect: document.querySelector("#speedSelect"),
  trackCount: document.querySelector("#trackCount"),
  trackList: document.querySelector("#trackList"),
  volume: document.querySelector("#volume")
};

const state = {
  currentId: null,
  currentUrl: null,
  deferredInstallPrompt: null,
  activePlaylistId: null,
  filterMode: "all",
  filteredTracks: [],
  playlists: [],
  repeatMode: "off",
  sleepTimerEndAt: null,
  sleepTimerSelection: "0",
  sleepTimerTickerId: null,
  sleepTimerTimeoutId: null,
  shuffle: false,
  tracks: []
};

let dbPromise = openDatabase();
let memoryTracks = [];
let memoryPlaylists = [];
let seeking = false;
let lastVolume = Number(elements.volume.value);

init();

function init() {
  loadPlaylists();
  registerServiceWorker();
  bindEvents();
  elements.audio.volume = Number(elements.volume.value);
  elements.audio.playbackRate = Number(elements.speedSelect.value);
  state.sleepTimerSelection = elements.sleepSelect.value;
  window.setInterval(syncSleepTimerSelection, 500);
  updateRepeatUi();
  updateShuffleUi();
  updateMuteUi();
  updateSleepTimerUi();
  renderPlaylists();
  loadTracks();
}

function bindEvents() {
  elements.fileInput.addEventListener("change", handleImport);
  elements.searchInput.addEventListener("input", renderTracks);
  elements.sortSelect.addEventListener("change", renderTracks);
  elements.allFilterButton.addEventListener("click", () => setFilter("all"));
  elements.favoritesFilterButton.addEventListener("click", () => setFilter("favorites"));
  elements.createPlaylistButton.addEventListener("click", createPlaylist);
  elements.playlistNameInput.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      createPlaylist();
    }
  });
  elements.clearButton.addEventListener("click", clearLibrary);
  elements.playButton.addEventListener("click", togglePlayback);
  elements.previousButton.addEventListener("click", playPrevious);
  elements.nextButton.addEventListener("click", playNext);
  elements.shuffleButton.addEventListener("click", toggleShuffle);
  elements.repeatButton.addEventListener("click", cycleRepeatMode);
  elements.sleepSelect.addEventListener("change", handleSleepTimerChange);
  elements.sleepSelect.addEventListener("input", handleSleepTimerChange);
  elements.favoriteCurrentButton.addEventListener("click", () => {
    if (state.currentId) toggleFavorite(state.currentId);
  });
  elements.speedSelect.addEventListener("change", () => {
    elements.audio.playbackRate = Number(elements.speedSelect.value);
  });
  elements.volume.addEventListener("input", () => {
    const volumeValue = Number(elements.volume.value);
    elements.audio.volume = volumeValue;
    if (volumeValue > 0) {
      lastVolume = volumeValue;
    }
    updateMuteUi();
  });
  elements.muteButton.addEventListener("click", toggleMute);
  elements.progress.addEventListener("input", () => {
    seeking = true;
    const duration = elements.audio.duration || 0;
    const targetTime = (Number(elements.progress.value) / 1000) * duration;
    updateTimeLabels(targetTime);
  });
  elements.progress.addEventListener("change", () => {
    if (Number.isFinite(elements.audio.duration)) {
      elements.audio.currentTime = (Number(elements.progress.value) / 1000) * elements.audio.duration;
    }
    seeking = false;
  });
  elements.audio.addEventListener("timeupdate", updateProgress);
  elements.audio.addEventListener("loadedmetadata", updateProgress);
  elements.audio.addEventListener("play", handlePlayState);
  elements.audio.addEventListener("pause", handlePlayState);
  elements.audio.addEventListener("ended", handleEnded);
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    state.deferredInstallPrompt = event;
    elements.installButton.hidden = false;
  });
  elements.installButton.addEventListener("click", installApp);
}

async function loadTracks() {
  try {
    state.tracks = (await readAllTracks()).map(normalizeTrack);
  } catch {
    state.tracks = [...memoryTracks].map(normalizeTrack);
  }
  prunePlaylistTracks();
  renderTracks();
  renderPlaylists();

  if (state.tracks.length) {
    selectTrack(state.tracks[0].id, false);
  } else {
    resetNowPlaying();
    renderQueue();
  }
}

function normalizeTrack(track) {
  return {
    ...track,
    favorite: Boolean(track.favorite)
  };
}

function setFilter(mode) {
  if (state.filterMode === mode) return;
  state.filterMode = mode;
  state.activePlaylistId = null;
  renderPlaylists();
  renderTracks();
}

async function handleImport(event) {
  const files = [...event.target.files].filter(file => file.type.startsWith("audio/"));
  if (!files.length) return;

  const existingKeys = new Set(state.tracks.map(track => `${track.fileName}-${track.size}`));
  const imported = [];

  for (const file of files) {
    const key = `${file.name}-${file.size}`;
    if (existingKeys.has(key)) continue;
    const track = {
      id: crypto.randomUUID(),
      name: cleanTitle(file.name),
      fileName: file.name,
      type: file.type || "audio/mpeg",
      size: file.size,
      addedAt: Date.now(),
      favorite: false,
      blob: file
    };
    await putTrack(track);
    imported.push(track);
  }

  event.target.value = "";
  if (!imported.length) return;

  state.tracks = (await readAllTracks()).map(normalizeTrack);
  renderTracks();

  if (!state.currentId) {
    selectTrack(imported[0].id, false);
  }
}

function renderTracks() {
  const query = elements.searchInput.value.trim().toLowerCase();
  const sort = elements.sortSelect.value;
  const baseTracks = getBaseLibrary();
  let tracks = [...baseTracks];

  if (query) {
    tracks = tracks.filter(track => {
      return track.name.toLowerCase().includes(query) || track.fileName.toLowerCase().includes(query);
    });
  }

  tracks.sort((a, b) => {
    if (sort === "title") return a.name.localeCompare(b.name);
    if (sort === "size") return b.size - a.size;
    return b.addedAt - a.addedAt;
  });

  state.filteredTracks = tracks;
  elements.trackList.innerHTML = "";
  elements.trackCount.textContent = `${tracks.length} shown · ${state.tracks.length} total`;
  elements.activeFilterLabel.textContent = getFilterLabel();
  elements.allFilterButton.classList.toggle("is-active", state.filterMode === "all" && !state.activePlaylistId);
  elements.favoritesFilterButton.classList.toggle("is-active", state.filterMode === "favorites" && !state.activePlaylistId);

  if (!tracks.length) {
    elements.trackList.append(elements.emptyTemplate.content.cloneNode(true));
    renderQueue();
    return;
  }

  tracks.forEach((track, index) => {
    const item = document.createElement("li");
    item.className = "track-item";

    const mainButton = document.createElement("button");
    mainButton.type = "button";
    mainButton.className = `track-main${track.id === state.currentId ? " is-active" : ""}`;
    mainButton.addEventListener("click", () => selectTrack(track.id, true));

    const trackIndex = document.createElement("span");
    trackIndex.className = "track-index";
    trackIndex.textContent = String(index + 1);

    const trackText = document.createElement("span");
    const trackTitle = document.createElement("strong");
    trackTitle.className = "track-title";
    trackTitle.textContent = track.name;
    const trackDetail = document.createElement("span");
    trackDetail.className = "track-detail";
    trackDetail.textContent = `${formatBytes(track.size)} · ${track.fileName}`;
    trackText.append(trackTitle, trackDetail);

    const meta = document.createElement("span");
    meta.className = "track-meta";
    meta.textContent = "Local";

    mainButton.append(trackIndex, trackText, meta);

    const favoriteButton = document.createElement("button");
    favoriteButton.type = "button";
    favoriteButton.className = `favorite-button${track.favorite ? " is-active" : ""}`;
    favoriteButton.textContent = track.favorite ? "Liked" : "Like";
    favoriteButton.title = track.favorite ? "Remove from favorites" : "Add to favorites";
    favoriteButton.addEventListener("click", event => {
      event.stopPropagation();
      toggleFavorite(track.id);
    });

    const playlistSelect = document.createElement("select");
    playlistSelect.className = "playlist-add-select";
    playlistSelect.setAttribute("aria-label", `Add ${track.name} to playlist`);

    if (!state.playlists.length) {
      const placeholderOption = document.createElement("option");
      placeholderOption.value = "";
      placeholderOption.textContent = "No lists";
      playlistSelect.append(placeholderOption);
      playlistSelect.disabled = true;
    } else {
      const defaultOption = document.createElement("option");
      defaultOption.value = "";
      defaultOption.textContent = "Add";
      playlistSelect.append(defaultOption);

      state.playlists.forEach(playlist => {
        const option = document.createElement("option");
        option.value = playlist.id;
        option.textContent = playlist.name;
        playlistSelect.append(option);
      });
      playlistSelect.addEventListener("change", () => {
        const targetPlaylistId = playlistSelect.value;
        if (!targetPlaylistId) return;
        addTrackToPlaylist(track.id, targetPlaylistId);
        playlistSelect.value = "";
      });
    }

    item.append(mainButton, playlistSelect, favoriteButton);
    elements.trackList.append(item);
  });

  renderQueue();
}

function getBaseLibrary() {
  let baseTracks = state.filterMode === "favorites" ? state.tracks.filter(track => track.favorite) : state.tracks;

  if (state.activePlaylistId) {
    const activePlaylist = state.playlists.find(playlist => playlist.id === state.activePlaylistId);
    if (!activePlaylist) return [];
    const trackIds = new Set(activePlaylist.trackIds);
    baseTracks = baseTracks.filter(track => trackIds.has(track.id));
  }

  return baseTracks;
}

function getPlaybackPool() {
  if (state.filteredTracks.length) return state.filteredTracks;
  const base = getBaseLibrary();
  return base.length ? base : state.tracks;
}

function selectTrack(id, autoplay) {
  const track = state.tracks.find(item => item.id === id);
  if (!track) return;

  state.currentId = id;
  if (state.currentUrl) URL.revokeObjectURL(state.currentUrl);
  state.currentUrl = URL.createObjectURL(track.blob);
  elements.audio.src = state.currentUrl;
  elements.progress.value = 0;
  updateTimeLabels(0);
  updateNowPlaying(track);
  renderTracks();

  if (autoplay) {
    playAudio();
  }
}

async function togglePlayback() {
  if (!state.currentId && state.tracks.length) {
    selectTrack(state.tracks[0].id, false);
  }
  if (!elements.audio.src) return;

  if (elements.audio.paused) {
    await playAudio();
  } else {
    elements.audio.pause();
  }
}

async function playAudio() {
  await elements.audio.play();
}

function playPrevious() {
  if (elements.audio.currentTime > 3) {
    elements.audio.currentTime = 0;
    return;
  }
  playRelative(-1);
}

function playNext() {
  playRelative(1);
}

function playRelative(direction) {
  const tracks = getPlaybackPool();
  if (!tracks.length) return;

  const currentIndex = Math.max(0, tracks.findIndex(track => track.id === state.currentId));
  let nextIndex;

  if (state.shuffle && tracks.length > 1) {
    do {
      nextIndex = Math.floor(Math.random() * tracks.length);
    } while (nextIndex === currentIndex);
  } else {
    nextIndex = (currentIndex + direction + tracks.length) % tracks.length;
  }

  selectTrack(tracks[nextIndex].id, true);
}

function handleEnded() {
  if (state.repeatMode === "one") {
    elements.audio.currentTime = 0;
    playAudio();
    return;
  }

  const tracks = getPlaybackPool();
  const atLast = tracks.findIndex(track => track.id === state.currentId) === tracks.length - 1;
  if (state.repeatMode === "off" && atLast) {
    elements.audio.pause();
    return;
  }
  playNext();
}

function handlePlayState() {
  const isPlaying = !elements.audio.paused;
  elements.playIcon.textContent = isPlaying ? "II" : "▶";
  elements.playButton.title = isPlaying ? "Pause" : "Play";
}

function updateProgress() {
  const duration = elements.audio.duration || 0;
  const current = elements.audio.currentTime || 0;
  if (!seeking && Number.isFinite(duration) && duration > 0) {
    elements.progress.value = String((current / duration) * 1000);
  }
  elements.duration.textContent = formatTime(duration);
  updateTimeLabels(current);
}

function updateTimeLabels(current) {
  elements.currentTime.textContent = formatTime(current);
}

function updateNowPlaying(track) {
  elements.miniTitle.textContent = track.name;
  elements.miniMeta.textContent = `${formatBytes(track.size)} · local file`;
  elements.heroCoverText.textContent = getCoverLetter(track.name);
  elements.favoriteCurrentButton.classList.toggle("is-active", track.favorite);
  elements.favoriteCurrentButton.textContent = track.favorite ? "Liked" : "Favorite";
}

function resetNowPlaying() {
  elements.miniTitle.textContent = "No track selected";
  elements.miniMeta.textContent = "Import local audio files to start listening.";
  elements.heroCoverText.textContent = "♪";
  elements.favoriteCurrentButton.classList.remove("is-active");
  elements.favoriteCurrentButton.textContent = "Favorite";
  elements.playIcon.textContent = "▶";
  elements.currentTime.textContent = "0:00";
  elements.duration.textContent = "0:00";
  elements.progress.value = 0;
}

function renderQueue() {
  const tracks = getPlaybackPool();
  elements.queueList.innerHTML = "";

  if (!tracks.length) {
    elements.queueHint.textContent = "Select a track to build your queue.";
    return;
  }

  const currentIndex = tracks.findIndex(track => track.id === state.currentId);
  const start = currentIndex >= 0 ? currentIndex : 0;
  const windowed = [];

  for (let step = 0; step < Math.min(tracks.length, 6); step += 1) {
    const index = (start + step) % tracks.length;
    windowed.push(tracks[index]);
  }

  elements.queueHint.textContent = state.shuffle ? "Shuffle is on. Queue order can change each skip." : "Queue follows your current filter and sort.";

  windowed.forEach((track, index) => {
    const item = document.createElement("li");
    item.className = `queue-item${track.id === state.currentId ? " current" : ""}`;

    const label = document.createElement("span");
    label.className = "queue-label";
    label.textContent = index === 0 ? "Now Playing" : `Up Next ${index}`;

    const title = document.createElement("span");
    title.className = "queue-title";
    title.textContent = track.name;

    item.append(label, title);
    elements.queueList.append(item);
  });
}

function loadPlaylists() {
  if (!canUseLocalStorage()) {
    state.playlists = clonePlaylists(memoryPlaylists);
    return;
  }

  let raw;
  try {
    raw = localStorage.getItem(PLAYLISTS_STORAGE_KEY);
  } catch {
    state.playlists = clonePlaylists(memoryPlaylists);
    return;
  }

  if (!raw) {
    state.playlists = [];
    return;
  }

  try {
    const parsed = JSON.parse(raw);
    state.playlists = normalizePlaylists(parsed);
  } catch {
    state.playlists = [];
  }
  memoryPlaylists = clonePlaylists(state.playlists);
}

function savePlaylists() {
  memoryPlaylists = clonePlaylists(state.playlists);
  if (!canUseLocalStorage()) return;
  try {
    localStorage.setItem(PLAYLISTS_STORAGE_KEY, JSON.stringify(state.playlists));
  } catch {
    // Storage might be unavailable in restricted browser contexts.
  }
}

function renderPlaylists() {
  elements.playlistList.innerHTML = "";

  if (!state.playlists.length) {
    const emptyRow = document.createElement("li");
    emptyRow.className = "playlist-empty";
    emptyRow.textContent = "No playlists yet";
    elements.playlistList.append(emptyRow);
    return;
  }

  state.playlists.forEach(playlist => {
    const row = document.createElement("li");
    row.className = "playlist-row";

    const filterButton = document.createElement("button");
    filterButton.type = "button";
    filterButton.className = `playlist-filter-button${playlist.id === state.activePlaylistId ? " is-active" : ""}`;
    filterButton.textContent = `${playlist.name} (${playlist.trackIds.length})`;
    filterButton.title = `Filter by ${playlist.name}`;
    filterButton.addEventListener("click", () => {
      if (state.activePlaylistId === playlist.id) {
        state.activePlaylistId = null;
      } else {
        state.activePlaylistId = playlist.id;
        state.filterMode = "all";
      }
      renderPlaylists();
      renderTracks();
    });

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "playlist-delete-button";
    deleteButton.textContent = "Delete";
    deleteButton.title = `Delete ${playlist.name}`;
    deleteButton.addEventListener("click", () => deletePlaylist(playlist.id));

    row.append(filterButton, deleteButton);
    elements.playlistList.append(row);
  });
}

function createPlaylist() {
  const name = elements.playlistNameInput.value.trim();
  if (!name) return;

  const alreadyExists = state.playlists.some(playlist => playlist.name.toLowerCase() === name.toLowerCase());
  if (alreadyExists) {
    elements.playlistNameInput.focus();
    elements.playlistNameInput.select();
    return;
  }

  state.playlists.push({
    id: crypto.randomUUID(),
    name: name.slice(0, 28),
    trackIds: []
  });

  elements.playlistNameInput.value = "";
  savePlaylists();
  renderPlaylists();
  renderTracks();
}

function deletePlaylist(playlistId) {
  const index = state.playlists.findIndex(playlist => playlist.id === playlistId);
  if (index === -1) return;

  if (state.activePlaylistId === playlistId) {
    state.activePlaylistId = null;
  }
  state.playlists.splice(index, 1);
  savePlaylists();
  renderPlaylists();
  renderTracks();
}

function addTrackToPlaylist(trackId, playlistId) {
  const playlist = state.playlists.find(item => item.id === playlistId);
  if (!playlist) return;

  if (!playlist.trackIds.includes(trackId)) {
    playlist.trackIds.push(trackId);
    savePlaylists();
    renderPlaylists();
    if (state.activePlaylistId === playlistId) {
      renderTracks();
    }
  }
}

function prunePlaylistTracks() {
  const existingTrackIds = new Set(state.tracks.map(track => track.id));
  let changed = false;

  state.playlists.forEach(playlist => {
    const before = playlist.trackIds.length;
    playlist.trackIds = playlist.trackIds.filter(trackId => existingTrackIds.has(trackId));
    if (before !== playlist.trackIds.length) {
      changed = true;
    }
  });

  if (changed) {
    savePlaylists();
  }
}

function getFilterLabel() {
  if (state.activePlaylistId) {
    const playlist = state.playlists.find(item => item.id === state.activePlaylistId);
    if (playlist) return `Playlist: ${playlist.name}`;
  }
  return state.filterMode === "favorites" ? "Favorites" : "All songs";
}

function canUseLocalStorage() {
  return typeof localStorage !== "undefined";
}

function normalizePlaylists(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(item => item && typeof item.id === "string" && typeof item.name === "string")
    .map(item => ({
      id: item.id,
      name: item.name.trim().slice(0, 28),
      trackIds: Array.isArray(item.trackIds) ? [...new Set(item.trackIds.filter(value => typeof value === "string"))] : []
    }))
    .filter(item => item.name.length);
}

function clonePlaylists(playlists) {
  return playlists.map(playlist => ({
    id: playlist.id,
    name: playlist.name,
    trackIds: [...playlist.trackIds]
  }));
}

async function toggleFavorite(trackId) {
  const track = state.tracks.find(item => item.id === trackId);
  if (!track) return;

  track.favorite = !track.favorite;
  await putTrack(track);
  renderTracks();
  if (state.currentId === track.id) {
    updateNowPlaying(track);
  }
}

function toggleShuffle() {
  state.shuffle = !state.shuffle;
  updateShuffleUi();
  renderQueue();
}

function updateShuffleUi() {
  elements.shuffleButton.classList.toggle("is-active", state.shuffle);
  elements.shuffleButton.title = state.shuffle ? "Shuffle on" : "Shuffle off";
}

function cycleRepeatMode() {
  if (state.repeatMode === "off") {
    state.repeatMode = "all";
  } else if (state.repeatMode === "all") {
    state.repeatMode = "one";
  } else {
    state.repeatMode = "off";
  }
  updateRepeatUi();
}

function updateRepeatUi() {
  const labels = {
    off: "Repeat",
    all: "Repeat All",
    one: "Repeat One"
  };
  elements.repeatButton.textContent = labels[state.repeatMode];
  elements.repeatButton.title = `Mode: ${labels[state.repeatMode]}`;
  elements.repeatButton.classList.toggle("is-active", state.repeatMode !== "off");
}

function handleSleepTimerChange() {
  state.sleepTimerSelection = elements.sleepSelect.value;
  const minutes = Number(elements.sleepSelect.value);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    stopSleepTimer({ resetSelect: false });
    return;
  }
  startSleepTimer(minutes);
}

function startSleepTimer(minutes) {
  stopSleepTimer({ resetSelect: false });
  const durationMs = minutes * 60 * 1000;
  state.sleepTimerEndAt = Date.now() + durationMs;
  state.sleepTimerTimeoutId = window.setTimeout(() => {
    stopSleepTimer({ keepStatus: true, resetSelect: true });
    elements.audio.pause();
    elements.sleepStatus.textContent = "Ended";
  }, durationMs);
  state.sleepTimerTickerId = window.setInterval(updateSleepTimerUi, 1000);
  updateSleepTimerUi();
}

function stopSleepTimer(options = {}) {
  const { keepStatus = false, resetSelect = true } = options;

  if (state.sleepTimerTimeoutId) {
    clearTimeout(state.sleepTimerTimeoutId);
    state.sleepTimerTimeoutId = null;
  }
  if (state.sleepTimerTickerId) {
    clearInterval(state.sleepTimerTickerId);
    state.sleepTimerTickerId = null;
  }
  state.sleepTimerEndAt = null;

  if (resetSelect) {
    elements.sleepSelect.value = "0";
  }
  state.sleepTimerSelection = elements.sleepSelect.value;

  if (keepStatus) {
    window.setTimeout(() => {
      if (!state.sleepTimerEndAt) {
        updateSleepTimerUi();
      }
    }, 2200);
    return;
  }
  updateSleepTimerUi();
}

function syncSleepTimerSelection() {
  const selectedValue = elements.sleepSelect.value;
  if (selectedValue === state.sleepTimerSelection) return;
  state.sleepTimerSelection = selectedValue;
  handleSleepTimerChange();
}

function updateSleepTimerUi() {
  if (!state.sleepTimerEndAt) {
    elements.sleepStatus.textContent = "Off";
    elements.sleepSelect.title = "Sleep timer off";
    return;
  }

  const remainingSeconds = Math.max(0, Math.ceil((state.sleepTimerEndAt - Date.now()) / 1000));
  if (remainingSeconds <= 0) {
    elements.sleepStatus.textContent = "Ending";
    return;
  }

  const display = formatCountdown(remainingSeconds);
  elements.sleepStatus.textContent = display;
  elements.sleepSelect.title = `Sleep timer ${display}`;
}

function toggleMute() {
  if (elements.audio.volume === 0) {
    const restored = lastVolume > 0 ? lastVolume : 0.85;
    elements.audio.volume = restored;
    elements.volume.value = String(restored);
  } else {
    lastVolume = elements.audio.volume;
    elements.audio.volume = 0;
    elements.volume.value = "0";
  }
  updateMuteUi();
}

function updateMuteUi() {
  const muted = elements.audio.volume === 0;
  elements.muteButton.classList.toggle("is-active", muted);
  elements.muteButton.textContent = muted ? "Unmute" : "Mute";
  elements.muteButton.title = muted ? "Unmute" : "Mute";
}

async function clearLibrary() {
  if (!state.tracks.length) return;
  const confirmed = confirm("Clear every imported track from this browser?");
  if (!confirmed) return;

  elements.audio.pause();
  elements.audio.removeAttribute("src");
  if (state.currentUrl) URL.revokeObjectURL(state.currentUrl);
  state.currentId = null;
  state.currentUrl = null;
  stopSleepTimer({ resetSelect: true });
  await clearTracks();
  state.tracks = [];
  state.filteredTracks = [];
  state.playlists = state.playlists.map(playlist => ({ ...playlist, trackIds: [] }));
  state.activePlaylistId = null;
  savePlaylists();
  resetNowPlaying();
  renderPlaylists();
  renderTracks();
  renderQueue();
}

function getCoverLetter(value) {
  const cleaned = value.replace(/[^a-zA-Z0-9]/g, "");
  return cleaned ? cleaned[0].toUpperCase() : "♪";
}

function openDatabase() {
  if (!("indexedDB" in window)) {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, callback) {
  const db = await dbPromise;
  if (!db) return null;

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    const request = callback(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function readAllTracks() {
  if (!("indexedDB" in window)) {
    return Promise.resolve([...memoryTracks]);
  }
  return withStore("readonly", store => store.getAll());
}

async function putTrack(track) {
  if (!("indexedDB" in window)) {
    memoryTracks = [track, ...memoryTracks.filter(item => item.id !== track.id)];
    return track;
  }
  return withStore("readwrite", store => store.put(track));
}

function clearTracks() {
  if (!("indexedDB" in window)) {
    memoryTracks = [];
    return Promise.resolve();
  }
  return withStore("readwrite", store => store.clear());
}

function cleanTitle(fileName) {
  return fileName.replace(/\.[^/.]+$/, "").replace(/[_-]+/g, " ").trim() || fileName;
}

function formatBytes(bytes) {
  if (!bytes) return "0 KB";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** exponent).toFixed(exponent ? 1 : 0)} ${units[exponent]}`;
}

function formatTime(value) {
  if (!Number.isFinite(value) || value <= 0) return "0:00";
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function formatCountdown(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js");
  }
}

async function installApp() {
  if (!state.deferredInstallPrompt) return;
  state.deferredInstallPrompt.prompt();
  await state.deferredInstallPrompt.userChoice;
  state.deferredInstallPrompt = null;
  elements.installButton.hidden = true;
}
