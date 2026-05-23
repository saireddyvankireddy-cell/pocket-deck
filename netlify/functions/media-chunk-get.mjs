import { getChunkStore, getMediaMeta, jsonResponse } from "./lib/media-store.mjs";

export default async request => {
  if (request.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const index = Number(url.searchParams.get("index"));
  if (!id || !Number.isInteger(index)) {
    return jsonResponse({ error: "Invalid chunk request" }, 400);
  }

  const meta = await getMediaMeta(id);
  if (!meta || !meta.complete || index < 0 || index >= meta.chunkCount) {
    return jsonResponse({ error: "Chunk not found" }, 404);
  }

  const chunk = await getChunkStore().get(`${id}/${index}`, {
    type: "arrayBuffer",
    consistency: "strong"
  });
  if (chunk === null) {
    return jsonResponse({ error: "Chunk not found" }, 404);
  }

  return new Response(chunk, {
    headers: {
      "content-type": "application/octet-stream",
      "cache-control": "private, max-age=3600"
    }
  });
};
