import { readFile, mkdir, copyFile, readdir, cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
export const assets = ['index.html', 'styles.css', 'app.js', 'ui-boot.js', 'sw.js', 'manifest.webmanifest', 'icon.svg', 'settings.mjs', 'smart-features.mjs', 'photo-tools.mjs', 'favorite-queue.mjs', 'photo-cleanup.mjs', 'photo-editor.mjs', 'cloud-sync.mjs', 'photo-state.mjs', 'photo-ai.mjs', 'photo-cache.mjs', 'photo-library.mjs', 'music-player.mjs', 'music-state.mjs', 'gallery-controls.mjs', 'ai-providers.mjs', 'assistant.mjs', 'fonts/inter-vf.woff2', 'fonts/outfit-vf.woff2'];
async function scriptsIn(folder) {
  const entries = await readdir(folder, { withFileTypes: true });
  const lists = await Promise.all(entries.map(entry => entry.isDirectory()
    ? scriptsIn(join(folder, entry.name)) : [join(folder, entry.name)]));
  return lists.flat().filter(path => /\.(mjs|js)$/.test(path));
}
for (const path of [join(root, 'app.js'), join(root, 'sw.js'), ...assets.filter(name => name.endsWith('.mjs')).map(name => join(root, name)), ...await scriptsIn(join(root, 'netlify/functions')), ...await scriptsIn(join(root, 'scripts'))]) {
  const result = spawnSync(process.execPath, ['--check', path], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(1);
}
const packageInfo=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
const {APP_VERSION,RELEASES}=await import(new URL('../settings.mjs',import.meta.url));
if(APP_VERSION!==packageInfo.version||RELEASES[0]?.version!==APP_VERSION)throw new Error('Version and current release notes must match');
const manifest = JSON.parse(await readFile(join(root, 'manifest.webmanifest'), 'utf8'));
if (manifest.name !== 'Photos' || manifest.display !== 'standalone') throw new Error('Invalid app manifest');
const html = await readFile(join(root, 'index.html'), 'utf8');
const stylesText = await readFile(join(root, 'styles.css'), 'utf8');
for (const match of html.matchAll(/<dialog id="([A-Za-z][A-Za-z0-9_-]*)"/g)) {
  for (const rule of stylesText.matchAll(new RegExp('#' + match[1] + '\\{([^}]*)\\}', 'g'))) {
    if (rule[1].includes('display:')) throw new Error('Dialog #' + match[1] + ' must not set display on its base rule (it would cover the app when closed)');
  }
}
const app = (await Promise.all(['app.js','settings.mjs', 'smart-features.mjs','photo-library.mjs', 'photo-editor.mjs', 'music-player.mjs', 'music-state.mjs'].map(name => readFile(join(root, name), 'utf8')))).join('\n');
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
for(const match of app.matchAll(/\.id\s*=\s*['"]([A-Za-z][A-Za-z0-9_-]*)['"]/g))ids.add(match[1]);
for (const match of app.matchAll(/document\.querySelector\("#([^" ]+)"\)/g)) {
  if (!ids.has(match[1])) throw new Error(`Missing UI element: ${match[1]}`);
}
for (const match of app.matchAll(/\$\('([^']+)'\)/g)) {
  if (!ids.has(match[1])) throw new Error(`Missing UI element: ${match[1]}`);
}
await mkdir(resolve(root, 'dist'), { recursive: true });
for (const name of assets) { await mkdir(dirname(join(root, 'dist', name)), { recursive: true }); await copyFile(join(root, name), join(root, 'dist', name)); }
await cp(join(root, 'vendor'), join(root, 'dist', 'vendor'), { recursive: true });
console.log('Sai Photos build passed. Web assets: dist/; server functions: netlify/functions/.');
