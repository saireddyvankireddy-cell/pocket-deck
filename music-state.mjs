import {normalizeFileVersion} from './photo-tools.mjs';
export function normalizeTrack(track) {
  return { id:track.id, name:String(track.name || track.fileName).slice(0,1024), fileName:String(track.fileName || track.name).slice(0,1024), size:Number(track.size || 0), version:normalizeFileVersion(track.version || track.addedAt || '').slice(0,199) };
}
export function shuffleQueue(ids, currentId, random = Math.random) {
  const other = [...new Set(ids)].filter(id => id !== currentId);
  for (let i = other.length-1; i>0; i--) { const j = Math.floor(random()*(i+1)); [other[i],other[j]]=[other[j],other[i]]; }
  return currentId ? [currentId,...other] : other;
}
export function nextTrackId(queue, currentId, repeat, ended = false) {
  if (!queue.length) return null;
  const index = queue.indexOf(currentId);
  if (ended && repeat === 'one' && index >= 0) return currentId;
  if (index+1 < queue.length) return queue[index+1];
  return repeat === 'all' ? queue[0] : null;
}
export function previousTrackId(queue, currentId, repeat) {
  const index = queue.indexOf(currentId);
  return index > 0 ? queue[index-1] : repeat === 'all' && queue.length ? queue.at(-1) : null;
}
export function insertNext(queue,currentId,trackId) {
  if (trackId === currentId) return queue;
  const result=queue.filter(id=>id!==trackId); const index=result.indexOf(currentId);
  result.splice(index>=0 ? index+1 : 0,0,trackId); return result.slice(0,2000);
}

export function sleepDeadline(minutes,now=Date.now()){return minutes>0?now+minutes*60000:0;}
export function sleepRemaining(deadline,now=Date.now()){return deadline?Math.max(0,deadline-now):0;}
export function normalizeSleepMinutes(minutes){const allowed=[0,5,10,15,30,45,60,90];const value=Number(minutes);if(!Number.isFinite(value)||value<=0)return 0;let best=allowed[1];for(const option of allowed.slice(1))if(Math.abs(option-value)<Math.abs(best-value))best=option;return best;}
export function matchesMusic(track,query){const words=query.toLowerCase().trim().split(/\s+/).filter(Boolean);const text=`${track.name} ${track.fileName}`.toLowerCase();return words.every(word=>text.includes(word));}
