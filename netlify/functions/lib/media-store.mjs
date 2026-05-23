export const SUPPORTED_KINDS = new Set(["audio", "photo"]);

const ROOT_PATH = "/PocketDeck";
const TEMP_PATH = `${ROOT_PATH}/_uploads`;
const DEFAULT_AUDIO_PATH = "/Music";
const DEFAULT_PHOTO_PATH = "/Pictures";
const AUDIO_EXTENSIONS = new Set(["aac", "flac", "m4a", "mp3", "oga", "ogg", "opus", "wav", "webm"]);
const PHOTO_EXTENSIONS = new Set(["gif", "heic", "heif", "jpeg", "jpg", "png", "webp"]);

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8"
    }
  });
}

export function requirePocketDeckAccess(request) {
  const expected = process.env.POCKET_DECK_ACCESS_CODE;
  if (!expected) return null;

  const actual = request.headers.get("x-pocket-deck-key");
  if (actual === expected) return null;

  return jsonResponse({ error: "Pocket Deck access code required" }, 401);
}

export function cleanMediaMeta(meta) {
  return {
    id: meta.id,
    kind: meta.kind,
    name: meta.name,
    fileName: meta.fileName,
    type: meta.type,
    size: meta.size,
    addedAt: meta.addedAt,
    chunkCount: meta.chunkCount || 1,
    complete: Boolean(meta.complete)
  };
}

export async function getMediaMeta(id) {
  if (!id) return null;

  if (id.startsWith("upload-")) {
    try {
      return await downloadJson(`${TEMP_PATH}/${id}/meta.json`);
    } catch {
      return null;
    }
  }

  const fileid = Number(id.replace(/^pc-/, ""));
  if (!Number.isFinite(fileid)) return null;
  const response = await pCloudRequest("stat", { fileid });
  return pCloudFileToMeta(response.metadata);
}

export async function listMediaMeta(kind) {
  const folders = mediaKindPaths(kind);
  const metas = [];

  for (const path of folders) {
    try {
      const response = await pCloudRequest("listfolder", { path, recursive: 1 });
      flattenPCloudFiles(response.metadata).forEach(file => {
        if (isSupportedMediaFile(file, kind)) {
          metas.push(pCloudFileToMeta(file));
        }
      });
    } catch (error) {
      if (!isMissingFolderError(error)) throw error;
    }
  }

  return dedupeById(metas);
}

export async function saveMediaMeta(meta) {
  await ensureFolder(ROOT_PATH);
  await ensureFolder(TEMP_PATH);
  await ensureFolder(`${TEMP_PATH}/${meta.id}`);
  await uploadBytes(`${TEMP_PATH}/${meta.id}`, "meta.json", Buffer.from(JSON.stringify(meta)), "application/json");
}

export async function saveMediaChunk(meta, index, bytes) {
  await ensureFolder(ROOT_PATH);
  await ensureFolder(TEMP_PATH);
  await ensureFolder(`${TEMP_PATH}/${meta.id}`);
  await uploadBytes(`${TEMP_PATH}/${meta.id}`, `${index}.chunk`, bytes, "application/octet-stream");
}

export async function finalizeUpload(meta) {
  const chunks = [];
  for (let index = 0; index < meta.chunkCount; index += 1) {
    chunks.push(await downloadBytes(`${TEMP_PATH}/${meta.id}/${index}.chunk`));
  }

  const uploaded = await uploadBytes(
    primaryMediaKindPath(meta.kind),
    meta.fileName,
    Buffer.concat(chunks),
    meta.type || "application/octet-stream",
    { renameIfExists: true }
  );

  if (!uploaded) {
    throw new Error("pCloud upload did not return file metadata");
  }

  await deleteTempUpload(meta);
  return pCloudFileToMeta(uploaded, meta.kind);
}

export async function getMediaChunk(meta) {
  if (meta.fileid) {
    return downloadBytes({ fileid: meta.fileid });
  }
  if (meta.path) {
    return downloadBytes(meta.path);
  }
  throw new Error("Media file has no pCloud path");
}

export async function deleteMedia(id) {
  const meta = await getMediaMeta(id);
  if (!meta) return null;

  if (meta.fileid) {
    await pCloudRequest("deletefile", { fileid: meta.fileid });
  } else if (meta.path) {
    await pCloudRequest("deletefile", { path: meta.path });
  }

  return meta;
}

function pCloudFileToMeta(file, fallbackKind = null) {
  const kind = fallbackKind || getMediaKindFromFile(file);
  return {
    id: `pc-${file.fileid}`,
    fileid: file.fileid,
    path: file.path,
    kind,
    name: cleanTitle(file.name),
    fileName: file.name,
    type: file.contenttype || getFallbackType(file.name, kind),
    size: Number(file.size || 0),
    addedAt: Date.parse(file.created || file.modified || "") || Date.now(),
    chunkCount: 1,
    complete: true
  };
}

function getMediaKindFromFile(file) {
  const contentType = file.contenttype || "";
  if (contentType.startsWith("image/")) return "photo";
  if (contentType.startsWith("audio/")) return "audio";
  const extension = getFileExtension(file.name);
  if (PHOTO_EXTENSIONS.has(extension)) return "photo";
  return "audio";
}

function isSupportedMediaFile(file, kind) {
  if (!file || file.isfolder || !file.fileid) return false;
  const contentType = file.contenttype || "";
  const extension = getFileExtension(file.name);
  if (kind === "photo") return contentType.startsWith("image/") || PHOTO_EXTENSIONS.has(extension);
  return contentType.startsWith("audio/") || AUDIO_EXTENSIONS.has(extension);
}

function mediaKindPaths(kind) {
  const raw = kind === "photo"
    ? process.env.PCLOUD_PHOTO_PATHS || process.env.PCLOUD_PHOTO_PATH || DEFAULT_PHOTO_PATH
    : process.env.PCLOUD_AUDIO_PATHS || process.env.PCLOUD_AUDIO_PATH || DEFAULT_AUDIO_PATH;

  return raw
    .split(",")
    .map(path => normalizePCloudPath(path))
    .filter(Boolean);
}

function primaryMediaKindPath(kind) {
  return mediaKindPaths(kind)[0] || (kind === "photo" ? DEFAULT_PHOTO_PATH : DEFAULT_AUDIO_PATH);
}

function flattenPCloudFiles(folder) {
  const files = [];
  const stack = [...(folder?.contents || [])];
  while (stack.length) {
    const item = stack.pop();
    if (item.isfolder) {
      stack.push(...(item.contents || []));
    } else {
      files.push(item);
    }
  }
  return files;
}

function dedupeById(items) {
  const seen = new Set();
  return items.filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

async function deleteTempUpload(meta) {
  for (let index = 0; index < meta.chunkCount; index += 1) {
    await deletePath(`${TEMP_PATH}/${meta.id}/${index}.chunk`);
  }
  await deletePath(`${TEMP_PATH}/${meta.id}/meta.json`);
}

async function ensureFolder(path) {
  await pCloudRequest("createfolderifnotexists", { path });
}

async function deletePath(path) {
  try {
    await pCloudRequest("deletefile", { path });
  } catch {
    // Deleting an already-missing temporary file should not block cleanup.
  }
}

async function downloadJson(path) {
  const bytes = await downloadBytes(path);
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function downloadBytes(target) {
  const params = typeof target === "string" ? { path: target } : target;
  const link = await pCloudRequest("getfilelink", params);
  const host = link.hosts?.[0];
  if (!host || !link.path) {
    throw new Error("pCloud file link unavailable");
  }

  const response = await fetch(`https://${host}${link.path}`);
  if (!response.ok) {
    throw new Error("pCloud download failed");
  }

  return Buffer.from(await response.arrayBuffer());
}

async function uploadBytes(folderPath, filename, bytes, contentType, options = {}) {
  await ensureFolder(folderPath);

  const formData = new FormData();
  formData.append("path", folderPath);
  formData.append("nopartial", "1");
  if (options.renameIfExists) formData.append("renameifexists", "1");
  formData.append("file", new Blob([bytes], { type: contentType }), filename);

  const response = await fetch(pCloudUrl("uploadfile"), {
    method: "POST",
    headers: pCloudAuthHeaders(),
    body: formData
  });

  const data = await response.json().catch(() => null);
  if (!response.ok || data?.result !== 0) {
    throw new Error(data?.error || "pCloud upload failed");
  }

  return data.metadata?.[0] || null;
}

async function pCloudRequest(method, params = {}) {
  const response = await fetch(pCloudUrl(method, params), {
    headers: pCloudAuthHeaders()
  });

  const data = await response.json().catch(() => null);
  if (!response.ok || data?.result !== 0) {
    const error = new Error(data?.error || `pCloud ${method} failed`);
    error.result = data?.result;
    throw error;
  }

  return data;
}

function pCloudUrl(method, params = {}) {
  const url = new URL(`https://${pCloudHost()}/${method}`);
  addAuthParams(url.searchParams);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, String(value));
  });
  return url;
}

function pCloudHost() {
  return (process.env.PCLOUD_API_HOST || "api.pcloud.com").replace(/^https?:\/\//, "");
}

function addAuthParams(searchParams) {
  if (process.env.PCLOUD_AUTH_TOKEN) {
    searchParams.set("auth", process.env.PCLOUD_AUTH_TOKEN);
  } else if (process.env.PCLOUD_ACCESS_TOKEN) {
    searchParams.set("access_token", process.env.PCLOUD_ACCESS_TOKEN);
  }
}

function pCloudAuthHeaders() {
  if (process.env.PCLOUD_ACCESS_TOKEN && !process.env.PCLOUD_AUTH_TOKEN) {
    return { authorization: `Bearer ${process.env.PCLOUD_ACCESS_TOKEN}` };
  }
  return {};
}

function normalizePCloudPath(path) {
  const cleaned = String(path || "").trim();
  if (!cleaned) return "";
  return cleaned.startsWith("/") ? cleaned : `/${cleaned}`;
}

function getFileExtension(fileName) {
  const parts = String(fileName || "").toLowerCase().split(".");
  return parts.length > 1 ? parts.pop() : "";
}

function getFallbackType(fileName, kind) {
  const extension = getFileExtension(fileName);
  if (kind === "photo") {
    if (extension === "jpg") return "image/jpeg";
    return `image/${extension || "jpeg"}`;
  }
  if (extension === "mp3") return "audio/mpeg";
  if (extension === "m4a") return "audio/mp4";
  return `audio/${extension || "mpeg"}`;
}

function isMissingFolderError(error) {
  const message = String(error?.message || "").toLowerCase();
  return error?.result === 2005 || message.includes("not found") || message.includes("does not exist");
}

function cleanTitle(fileName) {
  return String(fileName || "Untitled").replace(/\.[^/.]+$/, "").replace(/[_-]+/g, " ").trim() || fileName;
}
