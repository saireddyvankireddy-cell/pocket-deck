import process from 'node:process';
import fs from 'node:fs';
import {VISUAL_MODEL} from '../photo-tools.mjs';

const site = (process.env.SAI_SITE_URL || 'http://localhost:4173').replace(/\/+$/, '');
const rawCookie = (process.env.SAI_SESSION_COOKIE || '').trim() || (() => {
  const file = (process.env.SAI_SESSION_COOKIE_FILE || '').trim();
  if (!file) return '';
  try { return fs.readFileSync(file, 'utf8').trim(); } catch { return ''; }
})();
const sleepMs = Math.max(60000, Number(process.env.SAI_INDEX_SLEEP_MS || 300000));
const once = process.env.SAI_INDEX_ONCE === '1';
const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const log = (...parts) => console.log('[' + stamp() + ']', ...parts);

if (!rawCookie) {
  console.error('No Mac browser session saved yet. Sign in to pCloud at ' + site + ' in the Mac browser,');
  console.error('then open this page once: ' + site + '/.netlify/functions/mac-index-claim');
  process.exit(2);
}
const cookie = rawCookie.includes('=') ? rawCookie : 'sai_photos_session=' + rawCookie;

async function call(path, body) {
  const response = await fetch(site + '/.netlify/functions/' + path, {
    method: body ? 'POST' : 'GET',
    headers: {cookie, 'content-type': 'application/json'},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120000),
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    const error = new Error('Session expired: sign in again on the Mac browser and update SAI_SESSION_COOKIE.');
    error.auth = true;
    throw error;
  }
  if (!response.ok) throw new Error(data.error || ('Request failed: ' + response.status));
  return data;
}

async function restoreOperations() {
  const operations = [];
  const seen = new Set();
  for (let page = 0; page < 120; page++) {
    const result = await call('photo-metadata?action=sync', {known: [...seen]});
    for (const op of result.operations || []) {
      if (op.id && !seen.has(op.id)) { seen.add(op.id); operations.push(op); }
    }
    if (!result.more) break;
  }
  return operations;
}

function latestPerPhoto(operations, type) {
  const latest = new Map();
  for (const op of operations) {
    if (op.type !== type || !op.photoId) continue;
    const current = latest.get(op.photoId);
    if (!current || (op.at || 0) >= (current.at || 0)) latest.set(op.photoId, op);
  }
  return latest;
}

async function indexPass() {
  log('Reading saved indexes from pCloud...');
  const operations = await restoreOperations();
  const visuals = latestPerPhoto(operations, 'visual-index');
  const checksums = latestPerPhoto(operations, 'content-index');
  const known = [...visuals.values()].filter(op => op.model === VISUAL_MODEL).map(op => ({id: op.photoId, version: op.version}));
  const checks = [...checksums.values()].map(op => ({id: op.photoId, version: op.version}));
  log('Saved: ' + known.length + ' visual indexes, ' + checks.length + ' duplicate checksums.');
  await call('photo-analysis', {action: 'start', folderId: null, known, checksums: checks});
  for (;;) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    const job = await call('photo-analysis');
    if (!job.running) {
      if (job.message) throw new Error(job.message);
      const total = job.libraryTotal ?? job.total ?? 0;
      if (!job.total) log('Everything is already indexed (' + total + ' photos). Watching for new photos every ' + Math.round(sleepMs / 60000) + ' minutes.');
      else log('Pass complete: indexed ' + job.completed + ' of ' + job.total + ' missing photos' + (job.failed ? '; ' + job.failed + ' failed and will retry' : '') + '. ' + total + ' photos now covered.');
      return;
    }
  }
}

(async () => {
  log('Continuous pCloud indexing started for ' + site + '. Samsung and Mac results share pCloud.');
  for (;;) {
    try {
      await indexPass();
    } catch (error) {
      log(error.auth ? error.message : 'Indexing pass failed: ' + error.message);
      log('Continuing; next attempt in ' + Math.round(sleepMs / 60000) + ' minutes.');
    }
    if (once) break;
    await new Promise(resolve => setTimeout(resolve, sleepMs));
  }
})().catch(error => { console.error(error); process.exit(1); });
