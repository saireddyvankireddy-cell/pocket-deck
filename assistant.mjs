// Local-first question understanding for the AI tab. Pure functions only, so every rule is unit tested.
// The app supplies the real library lookups (photos, people, songs) and the optional cloud polish.
export const SUGGESTED_QUESTIONS = [
  'What can you do?',
  'How many photos do I have?',
  'Videos from last month',
  'Favorites',
  'Stop music in 10 minutes',
];
const STOP = new Set(['a','about','all','an','and','any','are','at','by','did','display','do','favorite','favorites','favourite','favourites','find','for','from','give','got','afternoon','day','evening','good','greetings','hello','hey','hi','hola','how','morning','i','in','is','it','last','list','made','many','me','month','my','namaste','next','number','of','on','photo','photos','pic','pics','picture','pictures','please','show','song','songs','take','taken','that','the','these','this','those','to','took','video','videos','was','were','what','with','year','you','your']);
const CAPITALIZED_STARTS = new Set(['Find','Show','How','List','Give','Any','What','Play','Start','Put','Stop','Create','Index','Cancel','Sleep']);
export function parseQuestion(input, knownNames = []) {
  const raw = String(input || '').trim().slice(0, 300);
  const text = raw.toLowerCase().replace(/\s+/g, ' ');
  const help = /^(?:help|what can you do|what can i ask|what can you help)/.test(text);
  const greeting = !help && /^(?:hi+|hiya|hello+|hey+|yo|namaste|hola|good\s+(?:morning|afternoon|evening|day))[\s!.,?]*$/.test(text);
  const playMatch = text.match(/^(?:play|put on|start)\s+(.+)$/) || text.match(/\bplay\s+(.+)$/);
  const play = playMatch ? playMatch[1].replace(/[?!.]+$/, '').trim().slice(0, 120) : '';
  const year = (raw.match(/\b(?:19|20)\d{2}\b/) || [])[0] || null;
  let monthOffset = null;
  if (/\blast month\b/.test(text)) monthOffset = -1;
  else if (/\bthis month\b/.test(text)) monthOffset = 0;
  const count = /\bhow many\b|\bcount\b|number of/.test(text);
  const videos = /\bvideos?\b/.test(text);
  const favorites = /\bfavou?rites?\b/.test(text);
  let personName = '';
  let knownPerson = false;
  for (const name of knownNames || []) {
    const clean = String(name || '').trim();
    if (clean && text.includes(clean.toLowerCase())) { personName = clean; knownPerson = true; }
  }
  if (!personName) {
    const capitalized = raw.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/);
    if (capitalized && !CAPITALIZED_STARTS.has(capitalized[1])) personName = capitalized[1];
  }
  const personLower = personName.toLowerCase();
  const sleepMatch = text.match(/\bsleep\s*(?:timer)?\s*(?:for\s+)?(\d{1,3})\s*(?:minutes?|mins?|m)\b/) || text.match(/\b(?:stop|pause)\b[^]{0,40}?\b(?:after|in)\s+(\d{1,3})\s*(?:minutes?|mins?|m)\b/);
  const sleepOff = !sleepMatch && /\b(?:cancel|stop|clear|turn off)\s+(?:the\s+)?sleep\s?timer\b/.test(text);
  const stopPlayback = !sleepMatch && !sleepOff && /\b(?:stop|pause)\s+(?:the\s+)?(?:music|songs?|playback|audio)\b/.test(text);
  const indexStatus = /\bindex(?:ing)?\s+(?:status|progress)\b|\bstatus\s+of\s+index(?:ing)?\b/.test(text);
  const indexStart = !indexStatus && (/\b(?:start|resume|run|begin)\s+(?:the\s+)?index(?:ing)?\b/.test(text) || /\bindex\s+(?:my\s+)?(?:photos|library|pictures)\b/.test(text));
  const albumMatch = raw.match(/^\s*create\s+(?:a\s+)?album\s+(?:called\s+|named\s+)?(.+?)\s*$/i);
  const albumName = albumMatch ? albumMatch[1].replace(/[?!.]+$/, '').trim().slice(0, 80) : '';
  const libraryWord = /\b(?:photo|photos|picture|pictures|pic|pics|image|images|video|videos|song|songs|music|favorite|favorites|favourite|favourites|album|albums|duplicate|duplicates|person|people|face|faces|index|indexing|library|pcloud|download|downloads|memory|memories|trash|contact|contacts|assistant)\b/.test(text);
  const questionStart = /^(?:what|who|whose|where|when|why|how|which|is|are|was|were|am|do|does|did|can|could|should|would|will|tell me|explain|define|translate|calculate|write|give me|help me)\b/.test(text);
  const general = !help && !greeting && !knownPerson && !play && !albumName && !sleepMatch && !sleepOff && !stopPlayback && !indexStatus && !indexStart && questionStart && !libraryWord;
  const sleepMinutes = sleepMatch ? Math.min(180, Math.max(0, parseInt(sleepMatch[1], 10))) : null;
  const terms = text.replace(/[^a-z0-9\u00c0-\uffff ]+/g, ' ').split(' ').filter(word =>
    word && !STOP.has(word) && !/^(?:19|20)\d{2}$/.test(word) && word !== personLower &&
    !(play && play.split(' ').includes(word)) && !(personLower && personLower.split(' ').includes(word)));
  const kind = help ? 'help' : greeting ? 'greeting' : sleepMatch ? 'sleep' : sleepOff ? 'sleep-off' : stopPlayback ? 'stop' : indexStatus ? 'index-status' : indexStart ? 'index' : albumName ? 'album' : play ? 'play' : general ? 'general' : 'search';
  return { raw, text, kind, help, greeting, general, play, year, monthOffset, count, videos, favorites, personName, terms, sleepMinutes, sleepOff, stopPlayback, indexStatus, indexStart, albumName };
}
export function describeSearch(intent) {
  const channels = ['filenames and text'];
  if (intent.personName) channels.push('people');
  channels.push('AI image search', 'albums');
  return 'Searched ' + channels.join(', ') + '.';
}
export function resultLabel(intent, count) {
  const noun = count === 1 ? 'photo' : 'photos';
  if (intent.personName) return count.toLocaleString() + ' ' + noun + ' of ' + intent.personName;
  if (intent.terms.length) return count.toLocaleString() + ' ' + noun + ' matching “' + intent.terms.join(' ') + '”';
  if (intent.monthOffset !== null) return count.toLocaleString() + ' ' + noun + ' from ' + (intent.monthOffset === -1 ? 'last month' : 'this month');
  if (intent.year) return count.toLocaleString() + ' ' + noun + ' from ' + intent.year;
  return count.toLocaleString() + ' ' + noun;
}
export function summarizeAnswer(intent, facts) {
  const found = facts.photos.length;
  if (intent.kind === 'help') return { text: 'Ask me about your own library: “photos of the beach”, “photos of Wifey”, “how many photos in 2024”, “videos from last month”, “favorites”, or “play <song name>”. I can also act: “stop music in 10 minutes” sets a sleep timer, “stop music” pauses, “index my photos” starts indexing, “create album Beach 2026” makes an album, and “indexing status” reports progress. I answer from this phone’s indexes and your pCloud records. Nothing leaves the phone unless you switch on Cloud-enhanced answers in Settings → AI.', done: true };
  if (intent.kind === 'greeting') return { text: 'Hi! I am your Sai Photos assistant. Ask me about your photos, videos and music — for example “photos of the beach”, “videos from last month” or “play <song name>”. I can also set a sleep timer, create albums and report indexing. For everyday questions like “what is the capital of France”, switch on Cloud-enhanced answers in Settings → AI with a free key and I will answer those too.', done: true };
  if (intent.kind === 'sleep') {
    const minutes = intent.sleepMinutes || 0;
    if (!minutes) return { text: 'Sleep timer cleared. Music keeps playing.', done: true };
    return { text: (facts.sleepError ? facts.sleepError + ' ' : '') + 'Sleep timer set — music will stop in ' + minutes + ' minute' + (minutes === 1 ? '' : 's') + '. Keep the app open for reliable timing.', done: true };
  }
  if (intent.kind === 'sleep-off') return { text: 'Sleep timer cancelled. Music keeps playing.', done: true };
  if (intent.kind === 'stop') return { text: facts.stopped ? 'Music stopped.' : 'Nothing is playing right now.', done: true };
  if (intent.kind === 'index-status') {
    const info = facts.indexStatus;
    if (!info) return { text: 'Indexing status is not available yet — connect pCloud and open your library first.', done: true };
    if (!info.total && !info.indexed) return { text: 'No photos are loaded yet. Open the Photos tab once your library is connected.', done: true };
    return { text: 'Indexed ' + info.indexed.toLocaleString() + ' of ' + info.total.toLocaleString() + ' photos in this view' + (info.visuals ? ' · ' + info.visuals.toLocaleString() + ' with AI image search' : '') + (info.songs ? ' · ' + info.songs.toLocaleString() + ' song titles' : '') + '. ' + (info.running ? 'Indexing is running right now.' : 'Open Settings → Indexing to keep it going.'), done: true };
  }
  if (intent.kind === 'index') {
    if (facts.indexError) return { text: facts.indexError, done: true };
    return { text: facts.indexRunning ? 'Indexing is already running — progress shows in Settings → Indexing.' : 'Indexing started. Keep the app open; progress shows in Settings → Indexing.', done: true };
  }
  if (intent.kind === 'album') {
    if (!intent.albumName) return { text: 'Tell me the album name, like “create album Beach 2026”.', done: true };
    if (facts.albumError) return { text: facts.albumError, done: true };
    return { text: 'Created album “' + intent.albumName + '”. Open Albums to add photos to it.', done: false };
  }
  if (intent.kind === 'play') {
    if (!facts.songs.length) return { text: 'I could not find a song matching “' + (intent.play || '') + '”. Check the name, or open the Music tab to search by title.', done: true };
    const extra = facts.songs.length > 1 ? ' — ' + (facts.songs.length - 1) + ' more match' + (facts.songs.length > 2 ? 'es' : '') + ' below.' : '.';
    return { text: 'Playing “' + facts.songs[0].name + '”' + extra, done: false };
  }
  if (intent.kind === 'general') return { text: 'That is an everyday question — on this phone I answer about your own photos, videos and music. Switch on Cloud-enhanced answers in Settings → AI (a free key; LLM7 needs no signup) and I will answer general questions like this too.', done: true };
  if (intent.count) {
    const subject = intent.personName ? intent.personName : intent.terms.length ? '“' + intent.terms.join(' ') + '”' : intent.year ? intent.year : intent.monthOffset === -1 ? 'last month' : intent.monthOffset === 0 ? 'this month' : 'your library';
    if (!found) return { text: 'No photos matched, so the count is 0. Try a different word, year or person.', done: true };
    const videos = facts.videosIn || 0;
    const mix = videos ? ' (' + (found - videos) + ' photos · ' + videos + ' videos)' : '';
    return { text: 'You have ' + found.toLocaleString() + ' items matching ' + subject + mix + '.', done: false };
  }
  if (!found) return { text: 'I could not find photos matching ' + (intent.terms.length ? '“' + intent.terms.join(' ') + '”' : intent.personName ? intent.personName : intent.year ? intent.year : 'that') + '. Try another word, or index new photos in Settings → Indexing.', done: true };
  return { text: 'Found ' + resultLabel(intent, found) + '. Tap any photo to open it. ' + describeSearch(intent), done: false };
}
