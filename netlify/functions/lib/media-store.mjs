export const SUPPORTED_KINDS = new Set(["audio", "photo"]);

const ROOT_PATH = "/PocketDeck";
const META_PATH = `${ROOT_PATH}/_meta`;
const AUDIO_PATH = `${ROOT_PATH}/audio`;
const PHOTO_PATH = `${ROOT_PATH}/photos`;

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
    chunkCount: meta.chunkCount,
    complete: Boolean(meta.complete)
  };
}

export async function getMediaMeta(id) {
  if (!id) return null;
  try {
    return await downloadJson(`${META_PATH}/${id}.json`);
  } catch {
    return null;
  }
}

export async function listMediaMeta() {
  await ensurePocketDeckFolders();
  const response = await pCloudRequest("listfolder", { path: META_PATH });
  const contents = response.metadata?.contents || [];
  const metas = [];

  for (const item of contents) {
    if (item.isfolder || !item.name.endsWith(".json")) continue;
    try {
      const meta = await downloadJson(item.path);
      metas.push(meta);
    } catch {
      // Ignore malformed or unavailable metadata files.
    }
  }

  return metas;
}

export async function saveMediaMeta(meta) {
  await ensurePocketDeckFolders();
  await uploadBytes(META_PATH, `${meta.id}.json`, Buffer.from(JSON.stringify(meta)), "application/json");
}

export async function saveMediaChunk(meta, index, bytes) {
  await ensureMediaFolder(meta);
  await uploadBytes(mediaItemPath(meta), `${index}.chunk`, bytes, "application/octet-stream");
}

export async function getMediaChunk(meta, index) {
  return downloadBytes(`${mediaItemPath(meta)}/${index}.chunk`);
}

export async function deleteMedia(id) {
  const meta = await getMediaMeta(id);
  if (!meta) return null;

  for (let index = 0; index < meta.chunkCount; index += 1) {
    await deletePath(`${mediaItemPath(meta)}/${index}.chunk`);
  }
  await deletePath(`${META_PATH}/${id}.json`);
  return meta;
}

async function ensurePocketDeckFolders() {
  await ensureFolder(ROOT_PATH);
  await ensureFolder(META_PATH);
  await ensureFolder(AUDIO_PATH);
  await ensureFolder(PHOTO_PATH);
}

async function ensureMediaFolder(meta) {
  await ensurePocketDeckFolders();
  await ensureFolder(mediaItemPath(meta));
}

function mediaItemPath(meta) {
  return `${mediaKindPath(meta.kind)}/${meta.id}`;
}

function mediaKindPath(kind) {
  return kind === "photo" ? PHOTO_PATH : AUDIO_PATH;
}

async function ensureFolder(path) {
  await pCloudRequest("createfolderifnotexists", { path });
}

async function deletePath(path) {
  try {
    await pCloudRequest("deletefile", { path });
  } catch {
    // Deleting an already-missing chunk should not block library cleanup.
  }
}

async function downloadJson(path) {
  const bytes = await downloadBytes(path);
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function downloadBytes(path) {
  const link = await pCloudRequest("getfilelink", { path });
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

async function uploadBytes(folderPath, filename, bytes, contentType) {
  const formData = new FormData();
  formData.append("path", folderPath);
  formData.append("nopartial", "1");
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
    throw new Error(data?.error || `pCloud ${method} failed`);
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
