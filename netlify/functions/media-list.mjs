import { cleanMediaMeta, getMetaStore, jsonResponse, SUPPORTED_KINDS } from "./lib/media-store.mjs";

export default async request => {
  if (request.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const url = new URL(request.url);
  const kind = url.searchParams.get("kind");
  if (!SUPPORTED_KINDS.has(kind)) {
    return jsonResponse({ error: "Invalid media kind" }, 400);
  }

  const store = getMetaStore();
  const items = [];

  for await (const page of store.list({ paginate: true })) {
    for (const blob of page.blobs) {
      const key = typeof blob === "string" ? blob : blob.key;
      const meta = await store.get(key, { type: "json", consistency: "strong" });
      if (meta?.kind === kind && meta.complete) {
        items.push(cleanMediaMeta(meta));
      }
    }
  }

  items.sort((a, b) => b.addedAt - a.addedAt);
  return jsonResponse({ items });
};
