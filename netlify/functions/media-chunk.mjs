import { cleanMediaMeta, getMediaMeta, jsonResponse, requirePocketDeckAccess, saveMediaChunk, saveMediaMeta } from "./lib/media-store.mjs";

const MAX_CHUNK_BYTES = 2_200_000;

export default async request => {
  const denied = requirePocketDeckAccess(request);
  if (denied) return denied;

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const body = await request.json().catch(() => null);
  const id = body?.id;
  const index = Number(body?.index);
  const data = body?.data;
  if (!id || !Number.isInteger(index) || typeof data !== "string") {
    return jsonResponse({ error: "Invalid chunk request" }, 400);
  }

  const meta = await getMediaMeta(id);
  if (!meta) {
    return jsonResponse({ error: "Media not found" }, 404);
  }
  if (index < 0 || index >= meta.chunkCount) {
    return jsonResponse({ error: "Invalid chunk index" }, 400);
  }

  const bytes = Buffer.from(data, "base64");
  if (!bytes.length || bytes.length > MAX_CHUNK_BYTES) {
    return jsonResponse({ error: "Invalid chunk size" }, 400);
  }

  await saveMediaChunk(meta, index, bytes);

  meta.uploadedChunks = Math.max(Number(meta.uploadedChunks || 0), index + 1);
  if (index === meta.chunkCount - 1) {
    meta.complete = true;
    meta.completedAt = Date.now();
  }
  await saveMediaMeta(meta);

  return jsonResponse({ item: cleanMediaMeta(meta), uploadedChunks: meta.uploadedChunks });
};
