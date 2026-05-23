import { cleanMediaMeta, jsonResponse, requirePocketDeckAccess, saveMediaMeta, SUPPORTED_KINDS } from "./lib/media-store.mjs";

export default async request => {
  const denied = requirePocketDeckAccess(request);
  if (denied) return denied;

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const body = await request.json().catch(() => null);
  if (!body || !SUPPORTED_KINDS.has(body.kind)) {
    return jsonResponse({ error: "Invalid media kind" }, 400);
  }

  const size = Number(body.size);
  const chunkCount = Number(body.chunkCount);
  if (!Number.isFinite(size) || size <= 0 || !Number.isInteger(chunkCount) || chunkCount <= 0) {
    return jsonResponse({ error: "Invalid media size" }, 400);
  }

  const now = Date.now();
  const meta = {
    id: crypto.randomUUID(),
    kind: body.kind,
    name: String(body.name || body.fileName || "Untitled").slice(0, 180),
    fileName: String(body.fileName || body.name || "media").slice(0, 240),
    type: String(body.type || "application/octet-stream").slice(0, 120),
    size,
    addedAt: now,
    chunkCount,
    uploadedChunks: 0,
    complete: false
  };

  await saveMediaMeta(meta);
  return jsonResponse({ item: cleanMediaMeta(meta) });
};
