import { cleanMediaMeta, deleteMedia, jsonResponse } from "./lib/media-store.mjs";

export default async request => {
  if (request.method !== "POST" && request.method !== "DELETE") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const body = await request.json().catch(() => null);
  const id = body?.id;
  if (!id) {
    return jsonResponse({ error: "Missing media id" }, 400);
  }

  const deleted = await deleteMedia(id);
  if (!deleted) {
    return jsonResponse({ error: "Media not found" }, 404);
  }

  return jsonResponse({ item: cleanMediaMeta(deleted) });
};
