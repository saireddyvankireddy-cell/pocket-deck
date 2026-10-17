import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, extname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
try { process.loadEnvFile(join(root, '.env')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const assets = new Set(['index.html', 'styles.css', 'app.js', 'sw.js', 'manifest.webmanifest', 'icon.svg', 'settings.mjs', 'smart-features.mjs', 'photo-tools.mjs', 'favorite-queue.mjs', 'photo-cleanup.mjs', 'cloud-sync.mjs', 'photo-state.mjs', 'photo-ai.mjs', 'photo-cache.mjs', 'photo-library.mjs', 'music-player.mjs', 'music-state.mjs', 'gallery-controls.mjs', 'ai-providers.mjs', 'assistant.mjs']);
async function vendorFiles(folder, prefix = '') {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) await vendorFiles(join(folder, entry.name), relative + '/');
    else if (entry.isFile()) assets.add('vendor/' + relative);
  }
}
await vendorFiles(join(root, 'vendor'));
const functions = new Set(['pcloud-auth', 'media-list', 'media-content', 'folders', 'photo-metadata', 'photo-delete', 'music-delete', 'photos-delete', 'photo-analysis', 'music-analysis']);
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const port = Number(process.env.PORT || 4173);
const host = process.env.SAI_PHOTOS_HOST || '127.0.0.1';
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || `127.0.0.1:${port}`}`);
    if(url.pathname==='/version.json'){res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({version:JSON.parse(await readFile(join(root,'package.json'),'utf8')).version}));return;}
    if (url.pathname.startsWith('/.netlify/functions/')) {
      const name = url.pathname.slice('/.netlify/functions/'.length);
      if (!functions.has(name)) { res.writeHead(404); res.end(); return; }
      const chunks = [];
      let length = 0;
      for await (const chunk of req) {
        length += chunk.length;
        if (length > 4_000_000) { res.writeHead(413); res.end('Request too large'); return; }
        chunks.push(chunk);
      }
      const method = req.method || 'GET';
      const request = new Request(url, { method, headers: req.headers, ...(method === 'GET' || method === 'HEAD' ? {} : { body: Buffer.concat(chunks) }) });
      const handler = (await import(new URL(`../netlify/functions/${name}.mjs`, import.meta.url))).default;
      const response = await handler(request);
      const outgoingHeaders = Object.fromEntries(response.headers);
      const cookies = response.headers.getSetCookie();
      if (cookies.length) outgoingHeaders['set-cookie'] = cookies;
      res.writeHead(response.status, outgoingHeaders);
      if (response.body) await pipeline(Readable.fromWeb(response.body), res);
      else res.end();
      return;
    }
    const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (!assets.has(name) || !['GET', 'HEAD'].includes(req.method)) { res.writeHead(404); res.end(); return; }
    const bytes = await readFile(join(root, name));
    res.writeHead(200, { 'content-type': types[extname(name)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch {
    if (res.headersSent) { res.destroy(); return; }
    // Do not return backend errors that could contain authenticated pCloud URLs.
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Cloud request failed. Check pCloud configuration.' }));
  }
});
server.listen(port, host, () => console.log(`Sai Photos preview listening on ${host}:${port}`));
