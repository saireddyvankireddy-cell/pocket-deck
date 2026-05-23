import { cleanMediaMeta, jsonResponse, listMediaMeta, requirePocketDeckAccess, SUPPORTED_KINDS } from "./lib/media-store.mjs";

export default async request => {
  const denied = requirePocketDeckAccess(request);
  if (denied) return denied;

  if (request.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const url = new URL(request.url);
  const kind = url.searchParams.get("kind");
  if (!SUPPORTED_KINDS.has(kind)) {
    return jsonResponse({ error: "Invalid media kind" }, 400);
  }

  const metas = await listMediaMeta();
  const items = metas
    .filter(meta => meta?.kind === kind && meta.complete)
    .map(cleanMediaMeta);

  items.sort((a, b) => b.addedAt - a.addedAt);
  return jsonResponse({ items });
};
