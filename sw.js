const CACHE_NAME = 'sai-photos-v73';
const ASSETS = ['./', './index.html', './styles.css', './app.js', './ui-boot.js', './manifest.webmanifest', './icon.svg', './settings.mjs', './smart-features.mjs', './photo-tools.mjs', './favorite-queue.mjs', './photo-cleanup.mjs', './photo-editor.mjs', './cloud-sync.mjs', './photo-state.mjs', './photo-ai.mjs', './photo-cache.mjs', './photo-library.mjs', './music-player.mjs', './music-state.mjs', './gallery-controls.mjs', './ai-providers.mjs', './assistant.mjs', './fonts/inter-vf.woff2', './fonts/outfit-vf.woff2'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))); self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => /^(pocket-deck-|sai-photos-)/.test(key) && key !== CACHE_NAME && !key.startsWith('sai-photos-images-')).map(key => caches.delete(key))))); self.clients.claim(); });
self.addEventListener('fetch', event => {
 if (event.request.method !== 'GET') return;
 const url = new URL(event.request.url);
 if (url.origin !== self.location.origin || url.pathname.startsWith('/.netlify/')) return;
 event.respondWith(fetch(event.request).catch(() => caches.match(event.request).then(cached => cached || Response.error())));
});
