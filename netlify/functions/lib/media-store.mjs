import { getStore } from "@netlify/blobs";

export const MEDIA_META_STORE = "pocketdeck-media-meta";
export const MEDIA_CHUNK_STORE = "pocketdeck-media-chunks";
export const SUPPORTED_KINDS = new Set(["audio", "photo"]);

export function getMetaStore() {
  return getStore({ name: MEDIA_META_STORE, consistency: "strong" });
}

export function getChunkStore() {
  return getStore({ name: MEDIA_CHUNK_STORE, consistency: "strong" });
}

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8"
    }
  });
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
  return getMetaStore().get(id, { type: "json", consistency: "strong" });
}

export async function saveMediaMeta(meta) {
  await getMetaStore().setJSON(meta.id, meta);
}

export async function deleteMedia(id) {
  const meta = await getMediaMeta(id);
  if (!meta) return null;

  const chunks = getChunkStore();
  for (let index = 0; index < meta.chunkCount; index += 1) {
    await chunks.delete(`${id}/${index}`);
  }
  await getMetaStore().delete(id);
  return meta;
}
