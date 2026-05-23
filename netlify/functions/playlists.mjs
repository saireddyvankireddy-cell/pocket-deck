import { jsonResponse, readCloudPlaylists, requirePocketDeckAccess, writeCloudPlaylists } from "./lib/media-store.mjs";

export default async request => {
  const denied = requirePocketDeckAccess(request);
  if (denied) return denied;

  if (request.method === "GET") {
    const playlists = await readCloudPlaylists();
    return jsonResponse({ playlists });
  }

  if (request.method === "POST") {
    const body = await request.json().catch(() => null);
    if (!Array.isArray(body?.playlists)) {
      return jsonResponse({ error: "Invalid playlists" }, 400);
    }

    await writeCloudPlaylists(body.playlists);
    return jsonResponse({ playlists: body.playlists });
  }

  return jsonResponse({ error: "Method not allowed" }, 405);
};
