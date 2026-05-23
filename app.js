const DB_NAME = "pocket-deck";
const DB_VERSION = 2;
const STORE_NAME = "tracks";
const PHOTO_STORE_NAME = "photos";
const ACCESS_KEY_STORAGE_KEY = "pocket-deck-access-key";
const PLAYLISTS_STORAGE_KEY = "pocket-deck-playlists-v1";
const FAVORITES_STORAGE_KEY = "pocket-deck-favorites-v1";
const AUDIO_EXTENSIONS = new Set(["aac", "flac", "m4a", "mp3", "oga", "ogg", "opus", "wav", "webm"]);
const PHOTO_EXTENSIONS = new Set(["gif", "heic", "heif", "jpeg", "jpg", "png", "webp"]);
const CLOUD_CHUNK_SIZE = 1_500_000;
const CLOUD_SYNC_INTERVAL_MS = 45000;
const PHOTO_RENDER_BATCH = 240;
const CLOUD_ENDPOINTS = {
  chunk: "/.netlify/functions/media-chunk",
  chunkGet: "/.netlify/functions/media-chunk-get",
  delete: "/.netlify/functions/media-delete",
  list: "/.netlify/functions/media-list",
  playlists: "/.netlify/functions/playlists",
  start: "/.netlify/functions/media-start"
};

const elements = {
  activeFilterLabel: document.querySelector("#activeFilterLabel"),
  allFilterButton: document.querySelector("#allFilterButton"),
  audio: document.querySelector("#audio"),
  accessResetButton: document.querySelector("#accessResetButton"),
  bottomMusicTabButton: document.querySelector("#bottomMusicTabButton"),
  bottomPhotosTabButton: document.querySelector("#bottomPhotosTabButton"),
  bottomPlaylistsTabButton: document.querySelector("#bottomPlaylistsTabButton"),
  bottomSettingsTabButton: document.querySelector("#bottomSettingsTabButton"),
  clearButton: document.querySelector("#clearButton"),
  clearPhotosButton: document.querySelector("#clearPhotosButton"),
  closePhotoButton: document.querySelector("#closePhotoButton"),
  createPlaylistHubButton: document.querySelector("#createPlaylistHubButton"),
  currentTime: document.querySelector("#currentTime"),
  createPlaylistButton: document.querySelector("#createPlaylistButton"),
  deletePhotoButton: document.querySelector("#deletePhotoButton"),
  duration: document.querySelector("#duration"),
  duplicatePhotosButton: document.querySelector("#duplicatePhotosButton"),
  emptyTemplate: document.querySelector("#emptyTemplate"),
  favoriteCurrentButton: document.querySelector("#favoriteCurrentButton"),
  favoritesFilterButton: document.querySelector("#favoritesFilterButton"),
  fileInput: document.querySelector("#fileInput"),
  folderInput: document.querySelector("#folderInput"),
  heroCoverText: document.querySelector("#heroCoverText"),
  hidePhotoUiButton: document.querySelector("#hidePhotoUiButton"),
  importStatus: document.querySelector("#importStatus"),
  installButton: document.querySelector("#installButton"),
  fitPhotoButton: document.querySelector("#fitPhotoButton"),
  miniMeta: document.querySelector("#miniMeta"),
  miniTitle: document.querySelector("#miniTitle"),
  musicPanel: document.querySelector("#musicPanel"),
  musicSidebarPanel: document.querySelector("#musicSidebarPanel"),
  musicTabButton: document.querySelector("#musicTabButton"),
  muteButton: document.querySelector("#muteButton"),
  nextButton: document.querySelector("#nextButton"),
  nextPhotoButton: document.querySelector("#nextPhotoButton"),
  photoCount: document.querySelector("#photoCount"),
  photoEmptyTemplate: document.querySelector("#photoEmptyTemplate"),
  photoFolderInput: document.querySelector("#photoFolderInput"),
  photoGrid: document.querySelector("#photoGrid"),
  photoImportStatus: document.querySelector("#photoImportStatus"),
  photoInput: document.querySelector("#photoInput"),
  photoPanel: document.querySelector("#photoPanel"),
  photoDuplicateStatus: document.querySelector("#photoDuplicateStatus"),
  photoSearchInput: document.querySelector("#photoSearchInput"),
  photoSidebarPanel: document.querySelector("#photoSidebarPanel"),
  photoSortSelect: document.querySelector("#photoSortSelect"),
  photoStage: document.querySelector("#photoStage"),
  photosTabButton: document.querySelector("#photosTabButton"),
  photoViewer: document.querySelector("#photoViewer"),
  photoViewerImage: document.querySelector("#photoViewerImage"),
  photoViewerMeta: document.querySelector("#photoViewerMeta"),
  photoViewerTitle: document.querySelector("#photoViewerTitle"),
  photoZoomRange: document.querySelector("#photoZoomRange"),
  playlistHubList: document.querySelector("#playlistHubList"),
  playlistHubNameInput: document.querySelector("#playlistHubNameInput"),
  playlistPanel: document.querySelector("#playlistPanel"),
  playlistSyncLabel: document.querySelector("#playlistSyncLabel"),
  playlistList: document.querySelector("#playlistList"),
  playlistNameInput: document.querySelector("#playlistNameInput"),
  playButton: document.querySelector("#playButton"),
  playIcon: document.querySelector("#playIcon"),
  previousButton: document.querySelector("#previousButton"),
  previousPhotoButton: document.querySelector("#previousPhotoButton"),
  progress: document.querySelector("#progress"),
  queueHint: document.querySelector("#queueHint"),
  queueList: document.querySelector("#queueList"),
  repeatButton: document.querySelector("#repeatButton"),
  refreshCloudButton: document.querySelector("#refreshCloudButton"),
  searchInput: document.querySelector("#searchInput"),
  settingsClearButton: document.querySelector("#settingsClearButton"),
  settingsClearPhotosButton: document.querySelector("#settingsClearPhotosButton"),
  settingsPanel: document.querySelector("#settingsPanel"),
  shuffleButton: document.querySelector("#shuffleButton"),
  sleepSelect: document.querySelector("#sleepSelect"),
  sleepStatus: document.querySelector("#sleepStatus"),
  sortSelect: document.querySelector("#sortSelect"),
  speedSelect: document.querySelector("#speedSelect"),
  syncStatus: document.querySelector("#syncStatus"),
  trackCount: document.querySelector("#trackCount"),
  trackList: document.querySelector("#trackList"),
  volume: document.querySelector("#volume"),
  zoomInButton: document.querySelector("#zoomInButton"),
  zoomOutButton: document.querySelector("#zoomOutButton")
};

const state = {
  activeView: "music",
  currentId: null,
  currentUrl: null,
  deferredInstallPrompt: null,
  activePlaylistId: null,
  filterMode: "all",
  favoriteIds: new Set(),
  filteredTracks: [],
  filteredPhotos: [],
  cloudSyncAvailable: false,
  cloudSyncInProgress: false,
  playlists: [],
  photos: [],
  photoDuplicateMode: false,
  photoPinchStartDistance: 0,
  photoPinchStartZoom: 1,
  photoRenderLimit: PHOTO_RENDER_BATCH,
  photoUiHidden: false,
  photoZoom: 1,
  repeatMode: "off",
  selectedPhotoId: null,
  sleepTimerEndAt: null,
  sleepTimerSelection: "0",
  sleepTimerTickerId: null,
  sleepTimerTimeoutId: null,
  shuffle: false,
  tracks: []
};

let dbPromise = openDatabase();
let memoryTracks = [];
let memoryPhotos = [];
let memoryPlaylists = [];
let photoUrls = new Map();
let cloudObjectUrls = new Map();
let cloudBlobPromises = new Map();
let seeking = false;
let lastVolume = Number(elements.volume.value);

init();

function init() {
  state.favoriteIds = loadFavoriteIds();
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
  loadPhotos();
  refreshCloudLibrary();
  window.setInterval(refreshCloudLibrary, CLOUD_SYNC_INTERVAL_MS);
}

function bindEvents() {
  elements.musicTabButton.addEventListener("click", () => setActiveView("music"));
  elements.photosTabButton.addEventListener("click", () => setActiveView("photos"));
  elements.bottomMusicTabButton.addEventListener("click", () => setActiveView("music"));
  elements.bottomPhotosTabButton.addEventListener("click", () => setActiveView("photos"));
  elements.bottomPlaylistsTabButton.addEventListener("click", () => setActiveView("playlists"));
  elements.bottomSettingsTabButton.addEventListener("click", () => setActiveView("settings"));
  elements.fileInput.addEventListener("change", handleImport);
  elements.folderInput.addEventListener("change", handleImport);
  elements.photoInput.addEventListener("change", handlePhotoImport);
  elements.photoFolderInput.addEventListener("change", handlePhotoImport);
  elements.photoSearchInput.addEventListener("input", resetPhotoRenderLimit);
  elements.photoSortSelect.addEventListener("change", resetPhotoRenderLimit);
  elements.duplicatePhotosButton.addEventListener("click", toggleDuplicatePhotoMode);
  elements.clearPhotosButton.addEventListener("click", clearPhotos);
  elements.settingsClearPhotosButton.addEventListener("click", clearPhotos);
  elements.searchInput.addEventListener("input", renderTracks);
  elements.sortSelect.addEventListener("change", renderTracks);
  elements.allFilterButton.addEventListener("click", () => setFilter("all"));
  elements.favoritesFilterButton.addEventListener("click", () => setFilter("favorites"));
  elements.createPlaylistButton.addEventListener("click", createPlaylist);
  elements.createPlaylistHubButton.addEventListener("click", createPlaylist);
  elements.playlistNameInput.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      createPlaylist();
    }
  });
  elements.playlistHubNameInput.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      createPlaylist();
    }
  });
  elements.clearButton.addEventListener("click", clearLibrary);
  elements.settingsClearButton.addEventListener("click", clearLibrary);
  elements.refreshCloudButton.addEventListener("click", refreshCloudLibrary);
  elements.accessResetButton.addEventListener("click", resetPocketDeckAccessCode);
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
  elements.closePhotoButton.addEventListener("click", closePhotoViewer);
  elements.previousPhotoButton.addEventListener("click", () => showRelativePhoto(-1));
  elements.nextPhotoButton.addEventListener("click", () => showRelativePhoto(1));
  elements.zoomOutButton.addEventListener("click", () => setPhotoZoom(state.photoZoom - 0.25));
  elements.zoomInButton.addEventListener("click", () => setPhotoZoom(state.photoZoom + 0.25));
  elements.fitPhotoButton.addEventListener("click", () => setPhotoZoom(1));
  elements.deletePhotoButton.addEventListener("click", deleteSelectedPhoto);
  elements.hidePhotoUiButton.addEventListener("click", () => setPhotoViewerUiHidden(true));
  elements.photoZoomRange.addEventListener("input", () => setPhotoZoom(Number(elements.photoZoomRange.value)));
  elements.photoStage.addEventListener("click", () => setPhotoViewerUiHidden(!state.photoUiHidden));
  elements.photoStage.addEventListener("wheel", handlePhotoWheel, { passive: false });
  elements.photoStage.addEventListener("touchstart", handlePhotoTouchStart, { passive: false });
  elements.photoStage.addEventListener("touchmove", handlePhotoTouchMove, { passive: false });
  window.addEventListener("keydown", handleKeyboardShortcuts);
}

function setActiveView(view) {
  state.activeView = view;
  const isMusic = view === "music";
  const isPhotos = view === "photos";
  const isPlaylists = view === "playlists";
  const isSettings = view === "settings";

  elements.musicTabButton.classList.toggle("is-active", isMusic);
  elements.photosTabButton.classList.toggle("is-active", isPhotos);
  elements.bottomMusicTabButton.classList.toggle("is-active", isMusic);
  elements.bottomPhotosTabButton.classList.toggle("is-active", isPhotos);
  elements.bottomPlaylistsTabButton.classList.toggle("is-active", isPlaylists);
  elements.bottomSettingsTabButton.classList.toggle("is-active", isSettings);
  elements.musicSidebarPanel.hidden = !isMusic && !isPlaylists;
  elements.photoSidebarPanel.hidden = !isPhotos;
  elements.musicPanel.hidden = !isMusic;
  elements.photoPanel.hidden = !isPhotos;
  elements.playlistPanel.hidden = !isPlaylists;
  elements.settingsPanel.hidden = !isSettings;
  document.body.classList.toggle("photos-active", isPhotos);
  document.body.classList.toggle("settings-active", isSettings);
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
    favorite: Boolean(track.favorite || state.favoriteIds.has(track.id))
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
  const selectedFiles = [...event.target.files];
  const files = selectedFiles.filter(isSupportedAudioFile);
  const skippedUnsupported = selectedFiles.length - files.length;

  if (!files.length) {
    updateImportStatus(selectedFiles.length ? "No supported audio files found." : "");
    event.target.value = "";
    return;
  }

  const existingKeys = new Set(state.tracks.map(track => `${track.fileName}-${track.size}`));
  const imported = [];
  let skippedDuplicates = 0;
  let failed = 0;

  updateImportStatus(`Importing ${files.length} songs...`);

  for (const file of files) {
    const fileName = getImportFileName(file);
    const key = `${fileName}-${file.size}`;
    if (existingKeys.has(key)) {
      skippedDuplicates += 1;
      continue;
    }
    try {
      const uploaded = await uploadCloudMedia(file, "audio", fileName, progress => {
        updateImportStatus(`Uploading ${imported.length + 1} of ${files.length}: ${file.name} (${progress}%)`);
      });
      existingKeys.add(key);
      imported.push(normalizeCloudTrack(uploaded));
    } catch {
      failed += 1;
    }
  }

  event.target.value = "";
  if (!imported.length) {
    updateImportStatus(getImportSummary(0, skippedDuplicates, skippedUnsupported, failed));
    return;
  }

  await refreshCloudLibrary();
  if (!state.cloudSyncAvailable) {
    state.tracks = [...imported, ...state.tracks];
  }
  renderTracks();

  if (!state.currentId) {
    selectTrack(imported[0].id, false);
  }

  updateImportStatus(getImportSummary(imported.length, skippedDuplicates, skippedUnsupported, failed));
}

function isSupportedAudioFile(file) {
  if (file.type.startsWith("audio/")) return true;
  return AUDIO_EXTENSIONS.has(getFileExtension(file.name));
}

function getFileExtension(fileName) {
  const parts = fileName.toLowerCase().split(".");
  return parts.length > 1 ? parts.pop() : "";
}

function getImportFileName(file) {
  return file.webkitRelativePath || file.name;
}

function getImportSummary(imported, duplicates, unsupported, failed) {
  const details = [];
  if (duplicates) details.push(`${duplicates} duplicate`);
  if (unsupported) details.push(`${unsupported} unsupported`);
  if (failed) details.push(`${failed} failed`);
  const suffix = details.length ? ` · skipped ${details.join(", ")}` : "";
  return `Imported ${imported} song${imported === 1 ? "" : "s"}${suffix}`;
}

function updateImportStatus(message) {
  elements.importStatus.textContent = message;
}

async function loadPhotos() {
  try {
    state.photos = await readAllPhotos();
  } catch {
    state.photos = [...memoryPhotos];
  }
  renderPhotos();
}

async function refreshCloudLibrary() {
  if (state.cloudSyncInProgress) return;
  state.cloudSyncInProgress = true;
  updateSyncStatus("Syncing with pCloud...");

  try {
    const [cloudTracks, cloudPhotos, cloudPlaylists] = await Promise.all([
      listCloudMedia("audio"),
      listCloudMedia("photo"),
      listCloudPlaylists()
    ]);

    const localTracks = state.tracks.filter(track => !track.cloud && track.blob);
    const localPhotos = state.photos.filter(photo => !photo.cloud && photo.blob);
    const currentTrackStillExists = state.currentId && [...cloudTracks, ...localTracks].some(track => track.id === state.currentId);
    state.cloudSyncAvailable = true;
    state.tracks = mergeCloudAndLocal(cloudTracks.map(normalizeCloudTrack), localTracks);
    state.photos = mergeCloudAndLocal(cloudPhotos.map(normalizeCloudPhoto), localPhotos);
    if (cloudPlaylists.length || !state.playlists.length) {
      state.playlists = cloudPlaylists;
      savePlaylists({ syncCloud: false });
    } else {
      syncPlaylistsToCloud();
    }
    prunePlaylistTracks();
    renderPlaylists();
    renderTracks();
    renderPhotos();
    updateSyncStatus(`Synced ${state.tracks.length} songs, ${state.photos.length} photos, ${state.playlists.length} playlists`);

    if (!state.tracks.length) {
      resetNowPlaying();
      renderQueue();
    } else if (!state.currentId || !currentTrackStillExists) {
      selectTrack(state.tracks[0].id, false);
    }
  } catch {
    state.cloudSyncAvailable = false;
    updateSyncStatus("Cloud sync needs your access code or pCloud settings.");
  } finally {
    state.cloudSyncInProgress = false;
  }
}

function mergeCloudAndLocal(cloudItems, localItems) {
  const cloudKeys = new Set(cloudItems.map(item => `${item.fileName}-${item.size}`));
  return [
    ...cloudItems,
    ...localItems.filter(item => !cloudKeys.has(`${item.fileName}-${item.size}`))
  ];
}

function normalizeCloudTrack(item) {
  return normalizeTrack({
    ...item,
    cloud: true,
    favorite: state.favoriteIds.has(item.id)
  });
}

function normalizeCloudPhoto(item) {
  return {
    ...item,
    cloud: true
  };
}

async function handlePhotoImport(event) {
  const selectedFiles = [...event.target.files];
  const files = selectedFiles.filter(isSupportedPhotoFile);
  const skippedUnsupported = selectedFiles.length - files.length;

  if (!files.length) {
    updatePhotoImportStatus(selectedFiles.length ? "No supported photos found." : "");
    event.target.value = "";
    return;
  }

  const existingKeys = new Set(state.photos.map(photo => `${photo.fileName}-${photo.size}`));
  const imported = [];
  let skippedDuplicates = 0;
  let failed = 0;

  updatePhotoImportStatus(`Importing ${files.length} photos...`);

  for (const file of files) {
    const fileName = getImportFileName(file);
    const key = `${fileName}-${file.size}`;
    if (existingKeys.has(key)) {
      skippedDuplicates += 1;
      continue;
    }

    try {
      const uploaded = await uploadCloudMedia(file, "photo", fileName, progress => {
        updatePhotoImportStatus(`Uploading ${imported.length + 1} of ${files.length}: ${file.name} (${progress}%)`);
      });
      existingKeys.add(key);
      imported.push(normalizeCloudPhoto(uploaded));
    } catch {
      failed += 1;
    }
  }

  event.target.value = "";
  await refreshCloudLibrary();
  if (!state.cloudSyncAvailable) {
    state.photos = [...imported, ...state.photos];
  }
  renderPhotos();
  updatePhotoImportStatus(getPhotoImportSummary(imported.length, skippedDuplicates, skippedUnsupported, failed));
}

function isSupportedPhotoFile(file) {
  if (file.type.startsWith("image/")) return true;
  return PHOTO_EXTENSIONS.has(getFileExtension(file.name));
}

function getPhotoImportSummary(imported, duplicates, unsupported, failed) {
  const details = [];
  if (duplicates) details.push(`${duplicates} duplicate`);
  if (unsupported) details.push(`${unsupported} unsupported`);
  if (failed) details.push(`${failed} failed`);
  const suffix = details.length ? ` · skipped ${details.join(", ")}` : "";
  return `Imported ${imported} photo${imported === 1 ? "" : "s"}${suffix}`;
}

function updatePhotoImportStatus(message) {
  elements.photoImportStatus.textContent = message;
}

async function cloudFetch(url, options = {}, retryOnAccessDenied = true) {
  const headers = new Headers(options.headers || {});
  const accessKey = getPocketDeckAccessKey();
  if (accessKey) {
    headers.set("x-pocket-deck-key", accessKey);
  }

  const response = await fetch(url, { ...options, headers });
  if (response.status !== 401 || !retryOnAccessDenied) {
    return response;
  }

  const nextAccessKey = prompt("Enter Pocket Deck access code");
  if (!nextAccessKey) return response;
  savePocketDeckAccessKey(nextAccessKey.trim());
  return cloudFetch(url, options, false);
}

function getPocketDeckAccessKey() {
  if (!canUseLocalStorage()) return "";
  return localStorage.getItem(ACCESS_KEY_STORAGE_KEY) || "";
}

function savePocketDeckAccessKey(value) {
  if (!canUseLocalStorage()) return;
  localStorage.setItem(ACCESS_KEY_STORAGE_KEY, value);
}

function resetPocketDeckAccessCode() {
  if (!canUseLocalStorage()) return;
  localStorage.removeItem(ACCESS_KEY_STORAGE_KEY);
  updateSyncStatus("Access code reset. Refresh or sync to enter it again.");
}

async function uploadCloudMedia(file, kind, fileName, onProgress) {
  const chunkCount = Math.ceil(file.size / CLOUD_CHUNK_SIZE);
  const startResponse = await cloudFetch(CLOUD_ENDPOINTS.start, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind,
      name: cleanTitle(file.name),
      fileName,
      type: file.type || getFallbackMediaType(file.name, kind),
      size: file.size,
      chunkCount
    })
  });

  if (!startResponse.ok) {
    throw new Error("Cloud upload could not start");
  }

  const { item } = await startResponse.json();
  let uploadedItem = item;
  for (let index = 0; index < chunkCount; index += 1) {
    const start = index * CLOUD_CHUNK_SIZE;
    const end = Math.min(file.size, start + CLOUD_CHUNK_SIZE);
    const data = await arrayBufferToBase64(await file.slice(start, end).arrayBuffer());
    const chunkResponse = await cloudFetch(CLOUD_ENDPOINTS.chunk, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: item.id, index, data })
    });

    if (!chunkResponse.ok) {
      throw new Error("Cloud upload chunk failed");
    }

    const chunkData = await chunkResponse.json().catch(() => null);
    if (chunkData?.item) uploadedItem = chunkData.item;

    onProgress?.(Math.round(((index + 1) / chunkCount) * 100));
  }

  return uploadedItem;
}

function getFallbackMediaType(fileName, kind) {
  const extension = getFileExtension(fileName);
  if (kind === "photo") {
    if (extension === "jpg") return "image/jpeg";
    return `image/${extension || "jpeg"}`;
  }
  if (extension === "mp3") return "audio/mpeg";
  if (extension === "m4a") return "audio/mp4";
  return `audio/${extension || "mpeg"}`;
}

async function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const batchSize = 0x8000;
  for (let index = 0; index < bytes.length; index += batchSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + batchSize));
  }
  return btoa(binary);
}

async function listCloudMedia(kind) {
  const response = await cloudFetch(`${CLOUD_ENDPOINTS.list}?kind=${encodeURIComponent(kind)}`, {
    cache: "no-store"
  });
  if (!response.ok) throw new Error("Cloud list failed");
  const data = await response.json();
  return Array.isArray(data.items) ? data.items : [];
}

async function listCloudPlaylists() {
  const response = await cloudFetch(CLOUD_ENDPOINTS.playlists, {
    cache: "no-store"
  });
  if (!response.ok) throw new Error("Cloud playlists failed");
  const data = await response.json();
  return normalizePlaylists(data.playlists);
}

async function saveCloudPlaylists(playlists) {
  const response = await cloudFetch(CLOUD_ENDPOINTS.playlists, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ playlists: normalizePlaylists(playlists) })
  });
  if (!response.ok) throw new Error("Cloud playlist save failed");
  updateSyncStatus("Playlists synced to pCloud");
}

async function deleteCloudMedia(id) {
  const response = await cloudFetch(CLOUD_ENDPOINTS.delete, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id })
  });
  if (!response.ok) throw new Error("Cloud delete failed");
  revokeCloudObjectUrl(id);
}

function updateSyncStatus(message) {
  if (elements.syncStatus) elements.syncStatus.textContent = message;
  if (elements.playlistSyncLabel) elements.playlistSyncLabel.textContent = message.includes("needs") ? "Needs setup" : "pCloud Sync";
}

function renderPhotos() {
  const query = elements.photoSearchInput.value.trim().toLowerCase();
  const sort = elements.photoSortSelect.value;
  const duplicateIds = getDuplicatePhotoIds();
  let photos = [...state.photos];

  if (state.photoDuplicateMode) {
    photos = photos.filter(photo => duplicateIds.has(photo.id));
  }

  if (query) {
    photos = photos.filter(photo => {
      return photo.name.toLowerCase().includes(query) || photo.fileName.toLowerCase().includes(query);
    });
  }

  photos.sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name);
    if (sort === "size") return b.size - a.size;
    return b.addedAt - a.addedAt;
  });

  state.filteredPhotos = photos;
  elements.photoGrid.innerHTML = "";
  const visiblePhotos = photos.slice(0, state.photoRenderLimit);
  elements.photoCount.textContent = `${Math.min(visiblePhotos.length, photos.length)} shown · ${state.photos.length} total`;
  updateDuplicatePhotoStatus(duplicateIds.size);

  if (!photos.length) {
    elements.photoGrid.append(elements.photoEmptyTemplate.content.cloneNode(true));
    return;
  }

  visiblePhotos.forEach(photo => {
    const item = document.createElement("li");
    item.className = `photo-tile${duplicateIds.has(photo.id) ? " is-duplicate" : ""}`;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "photo-tile-button";
    button.title = photo.name;
    button.addEventListener("click", () => openPhotoViewer(photo.id));

    const image = document.createElement("img");
    image.alt = photo.name;
    image.loading = "lazy";
    if (photo.cloud) {
      image.className = "is-loading";
      loadCloudImage(photo, image);
    } else {
      image.src = getPhotoUrl(photo);
    }

    const name = document.createElement("span");
    name.textContent = photo.name;

    button.append(image, name);
    if (duplicateIds.has(photo.id)) {
      const badge = document.createElement("em");
      badge.className = "duplicate-badge";
      badge.textContent = "Duplicate";
      button.append(badge);
    }
    item.append(button);
    elements.photoGrid.append(item);
  });

  if (visiblePhotos.length < photos.length) {
    const loadMoreItem = document.createElement("li");
    loadMoreItem.className = "photo-load-more";
    const loadMoreButton = document.createElement("button");
    loadMoreButton.type = "button";
    loadMoreButton.textContent = `Show ${Math.min(PHOTO_RENDER_BATCH, photos.length - visiblePhotos.length)} more`;
    loadMoreButton.addEventListener("click", () => {
      state.photoRenderLimit += PHOTO_RENDER_BATCH;
      renderPhotos();
    });
    loadMoreItem.append(loadMoreButton);
    elements.photoGrid.append(loadMoreItem);
  }
}

function toggleDuplicatePhotoMode() {
  state.photoDuplicateMode = !state.photoDuplicateMode;
  state.photoRenderLimit = PHOTO_RENDER_BATCH;
  renderPhotos();
}

function resetPhotoRenderLimit() {
  state.photoRenderLimit = PHOTO_RENDER_BATCH;
  renderPhotos();
}

function updateDuplicatePhotoStatus(duplicateCount) {
  elements.duplicatePhotosButton.textContent = state.photoDuplicateMode ? "Show All Photos" : "Find Duplicates";
  if (!duplicateCount) {
    elements.photoDuplicateStatus.textContent = "No likely duplicates found.";
    return;
  }
  elements.photoDuplicateStatus.textContent = `${duplicateCount} likely duplicate photo${duplicateCount === 1 ? "" : "s"} found.`;
}

function getDuplicatePhotoIds() {
  const groups = new Map();

  state.photos.forEach(photo => {
    const key = getPhotoDuplicateKey(photo);
    if (!key) return;
    groups.set(key, [...(groups.get(key) || []), photo.id]);
  });

  return new Set([...groups.values()].filter(ids => ids.length > 1).flat());
}

function getPhotoDuplicateKey(photo) {
  if (photo.fingerprint) return `hash-${photo.fingerprint}`;
  if (photo.fileName && photo.size) return `name-size-${photo.fileName.toLowerCase()}-${photo.size}`;
  return photo.size ? `size-${photo.size}` : "";
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
    meta.textContent = track.cloud ? "Shared" : "Local";

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

    const playlistControl = createPlaylistControl(track);
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "track-delete-button";
    deleteButton.textContent = "Delete";
    deleteButton.title = track.cloud ? "Delete this song from pCloud" : "Remove this imported song";
    deleteButton.addEventListener("click", event => {
      event.stopPropagation();
      deleteTrackFromLibrary(track.id);
    });

    item.append(mainButton, playlistControl, favoriteButton, deleteButton);
    elements.trackList.append(item);
  });

  renderQueue();
}

function createPlaylistControl(track) {
  if (state.activePlaylistId) {
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "playlist-remove-button";
    removeButton.textContent = "Remove";
    removeButton.title = "Remove from this playlist";
    removeButton.addEventListener("click", event => {
      event.stopPropagation();
      removeTrackFromPlaylist(track.id, state.activePlaylistId);
    });
    return removeButton;
  }

  const playlistSelect = document.createElement("select");
  playlistSelect.className = "playlist-add-select";
  playlistSelect.setAttribute("aria-label", `Add ${track.name} to playlist`);

  if (!state.playlists.length) {
    const placeholderOption = document.createElement("option");
    placeholderOption.value = "";
    placeholderOption.textContent = "No lists";
    playlistSelect.append(placeholderOption);
    playlistSelect.disabled = true;
    return playlistSelect;
  }

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

  return playlistSelect;
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
  if (state.activePlaylistId) return base;
  return base.length ? base : state.tracks;
}

async function selectTrack(id, autoplay) {
  const track = state.tracks.find(item => item.id === id);
  if (!track) return;

  state.currentId = id;
  if (state.currentUrl) URL.revokeObjectURL(state.currentUrl);
  elements.progress.value = 0;
  updateTimeLabels(0);
  updateNowPlaying(track);
  renderTracks();

  try {
    const url = track.cloud ? await getCloudObjectUrl(track) : URL.createObjectURL(track.blob);
    if (state.currentId !== id) return;
    state.currentUrl = track.cloud ? null : url;
    elements.audio.src = url;
  } catch {
    if (state.currentId === id) {
      elements.miniMeta.textContent = "Could not load this shared song.";
    }
    return;
  }

  if (autoplay) {
    await playAudio();
  }
}

async function togglePlayback() {
  if (!state.currentId && state.tracks.length) {
    await selectTrack(state.tracks[0].id, false);
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
  elements.miniMeta.textContent = `${formatBytes(track.size)} · ${track.cloud ? "shared cloud" : "local file"}`;
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

function savePlaylists(options = {}) {
  const { syncCloud = true } = options;
  memoryPlaylists = clonePlaylists(state.playlists);
  if (canUseLocalStorage()) {
    try {
      localStorage.setItem(PLAYLISTS_STORAGE_KEY, JSON.stringify(state.playlists));
    } catch {
      // Storage might be unavailable in restricted browser contexts.
    }
  }
  if (syncCloud) {
    syncPlaylistsToCloud();
  }
}

function syncPlaylistsToCloud() {
  saveCloudPlaylists(state.playlists).catch(() => {
    updateSyncStatus("Playlist sync failed. Check access code.");
  });
}

function renderPlaylists() {
  elements.playlistList.innerHTML = "";
  elements.playlistHubList.innerHTML = "";

  if (!state.playlists.length) {
    const emptyRow = document.createElement("li");
    emptyRow.className = "playlist-empty";
    emptyRow.textContent = "No playlists yet";
    elements.playlistList.append(emptyRow);
    elements.playlistHubList.append(emptyRow.cloneNode(true));
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

    const hubRow = document.createElement("li");
    hubRow.className = "playlist-hub-row";

    const hubButton = document.createElement("button");
    hubButton.type = "button";
    hubButton.className = "playlist-hub-button";
    hubButton.innerHTML = `<strong>${escapeHtml(playlist.name)}</strong><span>${playlist.trackIds.length} song${playlist.trackIds.length === 1 ? "" : "s"}</span>`;
    hubButton.addEventListener("click", () => {
      state.activePlaylistId = playlist.id;
      state.filterMode = "all";
      setActiveView("music");
      renderPlaylists();
      renderTracks();
    });

    const hubDeleteButton = document.createElement("button");
    hubDeleteButton.type = "button";
    hubDeleteButton.className = "playlist-delete-button";
    hubDeleteButton.textContent = "Delete";
    hubDeleteButton.addEventListener("click", () => deletePlaylist(playlist.id));

    hubRow.append(hubButton, hubDeleteButton);
    elements.playlistHubList.append(hubRow);
  });
}

function createPlaylist() {
  const name = (elements.playlistNameInput.value.trim() || elements.playlistHubNameInput.value.trim()).slice(0, 28);
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
  elements.playlistHubNameInput.value = "";
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

function removeTrackFromPlaylist(trackId, playlistId) {
  const playlist = state.playlists.find(item => item.id === playlistId);
  if (!playlist) return;

  const before = playlist.trackIds.length;
  playlist.trackIds = playlist.trackIds.filter(id => id !== trackId);
  if (playlist.trackIds.length === before) return;

  savePlaylists();
  renderPlaylists();
  renderTracks();
}

async function deleteTrackFromLibrary(trackId) {
  const track = state.tracks.find(item => item.id === trackId);
  if (!track) return;

  const target = track.cloud ? "pCloud music on every device" : "Pocket Deck on this device";
  const confirmed = confirm(`Remove "${track.name}" from ${target}?`);
  if (!confirmed) return;

  const wasCurrentTrack = state.currentId === trackId;
  const currentTrackIndex = Math.max(0, state.filteredTracks.findIndex(item => item.id === trackId));
  if (track.cloud) {
    await deleteCloudMedia(trackId);
  } else {
    await deleteTrack(trackId);
  }
  state.tracks = state.tracks.filter(item => item.id !== trackId);
  state.filteredTracks = state.filteredTracks.filter(item => item.id !== trackId);

  let playlistsChanged = false;
  state.playlists.forEach(playlist => {
    const before = playlist.trackIds.length;
    playlist.trackIds = playlist.trackIds.filter(id => id !== trackId);
    if (playlist.trackIds.length !== before) {
      playlistsChanged = true;
    }
  });

  if (playlistsChanged) {
    savePlaylists();
  }

  if (wasCurrentTrack) {
    elements.audio.pause();
    elements.audio.removeAttribute("src");
    elements.audio.load();
    if (state.currentUrl) URL.revokeObjectURL(state.currentUrl);
    state.currentId = null;
    state.currentUrl = null;
    resetNowPlaying();

    const nextTracks = getBaseLibrary();
    const nextTrack = nextTracks[Math.min(currentTrackIndex, nextTracks.length - 1)];
    if (nextTrack) {
      selectTrack(nextTrack.id, false);
    }
  }

  renderPlaylists();
  renderTracks();
  renderQueue();
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

function openPhotoViewer(photoId) {
  const photo = state.photos.find(item => item.id === photoId);
  if (!photo) return;

  state.selectedPhotoId = photoId;
  state.photoZoom = 1;
  state.photoUiHidden = false;
  elements.photoViewer.hidden = false;
  document.body.classList.add("photo-viewer-open");
  updatePhotoViewer();
}

function closePhotoViewer() {
  elements.photoViewer.hidden = true;
  document.body.classList.remove("photo-viewer-open");
  state.selectedPhotoId = null;
  state.photoUiHidden = false;
}

async function updatePhotoViewer() {
  const photo = state.photos.find(item => item.id === state.selectedPhotoId);
  if (!photo) return;

  const visiblePhotos = state.filteredPhotos.length ? state.filteredPhotos : state.photos;
  const index = Math.max(0, visiblePhotos.findIndex(item => item.id === photo.id));
  elements.photoViewerImage.removeAttribute("src");
  if (photo.cloud) {
    getCloudObjectUrl(photo).then(url => {
      if (state.selectedPhotoId === photo.id) {
        elements.photoViewerImage.src = url;
      }
    }).catch(() => {
      if (state.selectedPhotoId === photo.id) {
        elements.photoViewerMeta.textContent = "Could not load this shared photo";
      }
    });
  } else {
    elements.photoViewerImage.src = getPhotoUrl(photo);
  }
  elements.photoViewerImage.alt = photo.name;
  elements.photoViewerImage.style.transform = `scale(${state.photoZoom})`;
  elements.photoViewerTitle.textContent = photo.name;
  elements.photoViewerMeta.textContent = `${index + 1} of ${visiblePhotos.length} · ${formatBytes(photo.size)}`;
  elements.photoZoomRange.value = String(state.photoZoom);
  elements.photoViewer.classList.toggle("is-ui-hidden", state.photoUiHidden);
}

function showRelativePhoto(direction) {
  const photos = state.filteredPhotos.length ? state.filteredPhotos : state.photos;
  if (!photos.length || !state.selectedPhotoId) return;

  const currentIndex = Math.max(0, photos.findIndex(photo => photo.id === state.selectedPhotoId));
  const nextIndex = (currentIndex + direction + photos.length) % photos.length;
  state.selectedPhotoId = photos[nextIndex].id;
  state.photoZoom = 1;
  state.photoUiHidden = false;
  updatePhotoViewer();
}

async function deleteSelectedPhoto() {
  const photo = state.photos.find(item => item.id === state.selectedPhotoId);
  if (!photo) return;

  const confirmed = confirm(`Delete "${photo.name}" from ${photo.cloud ? "pCloud on every device" : "this browser"}?`);
  if (!confirmed) return;

  const photos = state.filteredPhotos.length ? state.filteredPhotos : state.photos;
  const currentIndex = Math.max(0, photos.findIndex(item => item.id === photo.id));

  if (photo.cloud) {
    await deleteCloudMedia(photo.id);
  } else {
    await deletePhoto(photo.id);
    revokePhotoUrl(photo.id);
  }

  state.photos = state.photos.filter(item => item.id !== photo.id);
  state.filteredPhotos = state.filteredPhotos.filter(item => item.id !== photo.id);
  revokeCloudObjectUrl(photo.id);

  const nextPhotos = state.filteredPhotos.length ? state.filteredPhotos : state.photos;
  if (!nextPhotos.length) {
    closePhotoViewer();
    renderPhotos();
    updatePhotoImportStatus("Deleted photo");
    return;
  }

  state.selectedPhotoId = nextPhotos[Math.min(currentIndex, nextPhotos.length - 1)].id;
  state.photoZoom = 1;
  renderPhotos();
  updatePhotoViewer();
  updatePhotoImportStatus("Deleted photo");
}

function setPhotoZoom(value) {
  state.photoZoom = Math.min(3, Math.max(1, Number(value) || 1));
  updatePhotoViewer();
}

function setPhotoViewerUiHidden(hidden) {
  state.photoUiHidden = hidden;
  updatePhotoViewer();
}

function handlePhotoWheel(event) {
  if (elements.photoViewer.hidden) return;
  event.preventDefault();
  const step = event.deltaY < 0 ? 0.15 : -0.15;
  setPhotoZoom(state.photoZoom + step);
}

function handlePhotoTouchStart(event) {
  if (event.touches.length !== 2) return;
  event.preventDefault();
  state.photoPinchStartDistance = getTouchDistance(event.touches);
  state.photoPinchStartZoom = state.photoZoom;
}

function handlePhotoTouchMove(event) {
  if (event.touches.length !== 2 || !state.photoPinchStartDistance) return;
  event.preventDefault();
  const distance = getTouchDistance(event.touches);
  setPhotoZoom(state.photoPinchStartZoom * (distance / state.photoPinchStartDistance));
}

function getTouchDistance(touches) {
  const [first, second] = touches;
  return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
}

function handleKeyboardShortcuts(event) {
  if (elements.photoViewer.hidden) return;

  if (event.key === "Escape") {
    if (state.photoUiHidden) {
      setPhotoViewerUiHidden(false);
    } else {
      closePhotoViewer();
    }
  } else if (event.key === "ArrowLeft") {
    showRelativePhoto(-1);
  } else if (event.key === "ArrowRight") {
    showRelativePhoto(1);
  } else if (event.key === "+" || event.key === "=") {
    setPhotoZoom(state.photoZoom + 0.25);
  } else if (event.key === "-") {
    setPhotoZoom(state.photoZoom - 0.25);
  } else if (event.key === "Delete" || event.key === "Backspace") {
    deleteSelectedPhoto();
  }
}

async function loadCloudImage(photo, image) {
  try {
    const url = await getCloudObjectUrl(photo);
    if (image.isConnected) {
      image.src = url;
      image.classList.remove("is-loading");
    }
  } catch {
    if (image.isConnected) {
      image.alt = "Could not load shared photo";
      image.classList.remove("is-loading");
    }
  }
}

async function getCloudObjectUrl(item) {
  if (cloudObjectUrls.has(item.id)) {
    return cloudObjectUrls.get(item.id);
  }

  const blob = await getCloudBlob(item);
  const url = URL.createObjectURL(blob);
  cloudObjectUrls.set(item.id, url);
  return url;
}

async function getCloudBlob(item) {
  if (cloudBlobPromises.has(item.id)) {
    return cloudBlobPromises.get(item.id);
  }

  const promise = downloadCloudBlob(item);
  cloudBlobPromises.set(item.id, promise);
  return promise;
}

async function downloadCloudBlob(item) {
  const chunks = [];
  for (let index = 0; index < item.chunkCount; index += 1) {
    const response = await cloudFetch(`${CLOUD_ENDPOINTS.chunkGet}?id=${encodeURIComponent(item.id)}&index=${index}`, {
      cache: "force-cache"
    });
    if (!response.ok) {
      throw new Error("Could not download shared media");
    }
    chunks.push(await response.arrayBuffer());
  }
  return new Blob(chunks, { type: item.type || "application/octet-stream" });
}

function revokeCloudObjectUrl(id) {
  const url = cloudObjectUrls.get(id);
  if (url) URL.revokeObjectURL(url);
  cloudObjectUrls.delete(id);
  cloudBlobPromises.delete(id);
}

function getPhotoUrl(photo) {
  if (!photoUrls.has(photo.id)) {
    photoUrls.set(photo.id, URL.createObjectURL(photo.blob));
  }
  return photoUrls.get(photo.id);
}

function revokePhotoUrl(photoId) {
  const url = photoUrls.get(photoId);
  if (url) URL.revokeObjectURL(url);
  photoUrls.delete(photoId);
}

async function clearPhotos() {
  if (!state.photos.length) return;
  const hasSharedPhotos = state.photos.some(photo => photo.cloud);
  const confirmed = confirm(hasSharedPhotos ? "Delete every shared photo from pCloud on every device?" : "Clear every imported photo from this browser?");
  if (!confirmed) return;

  if (hasSharedPhotos) {
    for (const photo of state.photos.filter(item => item.cloud)) {
      await deleteCloudMedia(photo.id);
    }
  }
  await clearPhotoStore();
  photoUrls.forEach(url => URL.revokeObjectURL(url));
  photoUrls = new Map();
  cloudObjectUrls.forEach(url => URL.revokeObjectURL(url));
  cloudObjectUrls = new Map();
  cloudBlobPromises = new Map();
  state.photos = [];
  state.filteredPhotos = [];
  closePhotoViewer();
  renderPhotos();
  updatePhotoImportStatus("Cleared photos");
}

function canUseLocalStorage() {
  return typeof localStorage !== "undefined";
}

function loadFavoriteIds() {
  if (!canUseLocalStorage()) return new Set();
  try {
    const parsed = JSON.parse(localStorage.getItem(FAVORITES_STORAGE_KEY) || "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter(id => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function saveFavoriteIds() {
  if (!canUseLocalStorage()) return;
  try {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify([...state.favoriteIds]));
  } catch {
    // Storage might be unavailable in restricted browser contexts.
  }
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
  if (track.favorite) {
    state.favoriteIds.add(track.id);
  } else {
    state.favoriteIds.delete(track.id);
  }
  saveFavoriteIds();
  if (!track.cloud) {
    await putTrack(track);
  }
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
  const hasSharedTracks = state.tracks.some(track => track.cloud);
  const confirmed = confirm(hasSharedTracks ? "Delete every shared song from pCloud on every device?" : "Clear every imported track from this browser?");
  if (!confirmed) return;

  elements.audio.pause();
  elements.audio.removeAttribute("src");
  if (state.currentUrl) URL.revokeObjectURL(state.currentUrl);
  state.currentId = null;
  state.currentUrl = null;
  stopSleepTimer({ resetSelect: true });
  if (hasSharedTracks) {
    for (const track of state.tracks.filter(item => item.cloud)) {
      await deleteCloudMedia(track.id);
    }
  }
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
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(PHOTO_STORE_NAME)) {
        db.createObjectStore(PHOTO_STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, callback, storeName = STORE_NAME) {
  const db = await dbPromise;
  if (!db) return null;

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
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

function deleteTrack(trackId) {
  if (!("indexedDB" in window)) {
    memoryTracks = memoryTracks.filter(item => item.id !== trackId);
    return Promise.resolve();
  }
  return withStore("readwrite", store => store.delete(trackId));
}

function readAllPhotos() {
  if (!("indexedDB" in window)) {
    return Promise.resolve([...memoryPhotos]);
  }
  return withStore("readonly", store => store.getAll(), PHOTO_STORE_NAME);
}

async function putPhoto(photo) {
  if (!("indexedDB" in window)) {
    memoryPhotos = [photo, ...memoryPhotos.filter(item => item.id !== photo.id)];
    return photo;
  }
  return withStore("readwrite", store => store.put(photo), PHOTO_STORE_NAME);
}

function deletePhoto(photoId) {
  if (!("indexedDB" in window)) {
    memoryPhotos = memoryPhotos.filter(item => item.id !== photoId);
    return Promise.resolve();
  }
  return withStore("readwrite", store => store.delete(photoId), PHOTO_STORE_NAME);
}

function clearPhotoStore() {
  if (!("indexedDB" in window)) {
    memoryPhotos = [];
    return Promise.resolve();
  }
  return withStore("readwrite", store => store.clear(), PHOTO_STORE_NAME);
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

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character]);
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
