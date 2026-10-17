import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuestion, summarizeAnswer, describeSearch, resultLabel, SUGGESTED_QUESTIONS } from '../assistant.mjs';
test('questions break into intents without losing the person or song', () => {
  const beach = parseQuestion('Show me photos of the beach');
  assert.equal(beach.kind, 'search');
  assert.deepEqual(beach.terms, ['beach']);
  assert.equal(beach.count, false);
  const person = parseQuestion('photos of wifey', ['Wifey']);
  assert.equal(person.personName, 'Wifey');
  assert.deepEqual(person.terms, []);
  const capitalized = parseQuestion('photos of Bhanu papa');
  assert.equal(capitalized.personName, 'Bhanu');
  const count = parseQuestion('How many photos did I take in 2024?');
  assert.equal(count.count, true);
  assert.equal(count.year, '2024');
  assert.deepEqual(count.terms, []);
  const videos = parseQuestion('Videos from last month');
  assert.equal(videos.videos, true);
  assert.equal(videos.monthOffset, -1);
  assert.deepEqual(videos.terms, []);
  const play = parseQuestion('play Kesariya');
  assert.equal(play.kind, 'play');
  assert.equal(play.play, 'kesariya');
  const favorites = parseQuestion('my favorites');
  assert.equal(favorites.favorites, true);
  assert.deepEqual(favorites.terms, []);
  const help = parseQuestion('What can you do?');
  assert.equal(help.help, true);
  assert.equal(help.kind, 'help');
  assert.ok(SUGGESTED_QUESTIONS.length >= 4);
});
test('answers describe exactly what was searched and what was found', () => {
  const beach = parseQuestion('beach photos');
  const found = summarizeAnswer(beach, { photos: [{ id: 'pc-1' }, { id: 'pc-2' }], songs: [] });
  assert.match(found.text, /Found 2 photos matching “beach”/);
  assert.match(found.text, /Searched filenames and text, AI image search, albums\./);
  assert.equal(found.done, false);
  const empty = summarizeAnswer(beach, { photos: [], songs: [] });
  assert.match(empty.text, /could not find photos matching “beach”/);
  assert.equal(empty.done, true);
});
test('person, count, videos, favorites and play answers stay specific', () => {
  const person = summarizeAnswer(parseQuestion('photos of wifey', ['Wifey']), { photos: [{ id: 'pc-1' }], songs: [] });
  assert.match(person.text, /Found 1 photo of Wifey/);
  assert.match(describeSearch({ personName: 'Wifey', terms: [] }), /people/);
  const count = summarizeAnswer(parseQuestion('how many videos from last month'), { photos: [{ id: 'pc-1' }, { id: 'pc-2' }], songs: [], videosIn: 2 });
  assert.match(count.text, /You have 2 items matching last month \(0 photos · 2 videos\)\./);
  const favorites = summarizeAnswer(parseQuestion('favorites'), { photos: [], songs: [] });
  assert.equal(favorites.done, true);
  const play = summarizeAnswer(parseQuestion('play kesariya'), { photos: [], songs: [{ id: 'pc-9', name: 'Kesariya' }, { id: 'pc-8', name: 'Kesariya (Live)' }] });
  assert.match(play.text, /Playing “Kesariya” — 1 more match below\./);
  const missing = summarizeAnswer(parseQuestion('play nothing at all'), { photos: [], songs: [] });
  assert.match(missing.text, /could not find a song matching “nothing at all”/);
});
test('help and result labels cover every phrasing', () => {
  const help = summarizeAnswer(parseQuestion('help'), { photos: [], songs: [] });
  assert.match(help.text, /Ask me about your own library/);
  assert.equal(resultLabel(parseQuestion('2024 photos'), 3), '3 photos from 2024');
  assert.equal(resultLabel(parseQuestion('photos of Ravi', ['Ravi']), 1), '1 photo of Ravi');
  assert.equal(resultLabel(parseQuestion('show me the photos'), 5), '5 photos');
});

test('assistant actions parse into sleep, stop, index and album intents', () => {
  const sleep=parseQuestion('Stop music in 10 minutes');
  assert.equal(sleep.kind,'sleep');assert.equal(sleep.sleepMinutes,10);
  const songs=parseQuestion('stop songs after 10 min');
  assert.equal(songs.kind,'sleep');assert.equal(songs.sleepMinutes,10);
  const off=parseQuestion('stop the sleep timer');
  assert.equal(off.kind,'sleep-off');
  const stop=parseQuestion('stop music');
  assert.equal(stop.kind,'stop');
  const start=parseQuestion('index my photos');
  assert.equal(start.kind,'index');
  const status=parseQuestion('indexing status');
  assert.equal(status.kind,'index-status');
  const album=parseQuestion('create album Beach 2026');
  assert.equal(album.kind,'album');assert.equal(album.albumName,'Beach 2026');
  const sleepAnswer=summarizeAnswer(sleep,{photos:[],songs:[]});
  assert.match(sleepAnswer.text,/Sleep timer set — music will stop in 10 minutes/);
  assert.equal(sleepAnswer.done,true);
  assert.match(summarizeAnswer(off,{photos:[],songs:[]}).text,/cancelled/);
  assert.match(summarizeAnswer(stop,{photos:[],songs:[],stopped:true}).text,/Music stopped/);
  assert.match(summarizeAnswer(status,{photos:[],songs:[],indexStatus:{indexed:2,total:4,visuals:1,songs:0,running:false}}).text,/Indexed 2 of 4 photos/);
  assert.match(summarizeAnswer(start,{photos:[],songs:[]}).text,/Indexing started/);
  const albumAnswer=summarizeAnswer(album,{photos:[],songs:[]});
  assert.match(albumAnswer.text,/Created album “Beach 2026”/);
  assert.equal(albumAnswer.done,false);
  assert.match(summarizeAnswer(album,{photos:[],songs:[],albumError:'Connect pCloud first — albums are saved in pCloud.'}).text,/Connect pCloud first/);
  assert.equal(parseQuestion('beach photos').kind,'search');
});

test('greetings get a friendly assistant reply', () => {
  for (const phrase of ['hi', 'Hi!', 'Hello', 'hey', 'Good morning', 'namaste']) {
    const intent = parseQuestion(phrase);
    assert.equal(intent.kind, 'greeting', phrase);
    const answer = summarizeAnswer(intent, { photos: [], songs: [] });
    assert.match(answer.text, /^Hi! I am your Sai Photos assistant/);
    assert.equal(answer.done, true);
    assert.equal(intent.terms.length, 0);
  }
  assert.equal(parseQuestion('hey there').kind, 'search');
  assert.equal(parseQuestion('hi how many photos do I have').kind, 'search');
});

test('everyday questions are routed to the cloud model instead of the library', () => {
  for (const phrase of ['What is the capital of France?', 'Who won the world cup in 2022?', 'How do I cook rice?', 'Explain gravity', 'Tell me a joke']) {
    assert.equal(parseQuestion(phrase).kind, 'general', phrase);
  }
  assert.notEqual(parseQuestion('how many photos do I have').kind, 'general');
  assert.equal(parseQuestion('photos of Sai', ['Sai']).kind, 'search');
  assert.notEqual(parseQuestion('play Kesariya').kind, 'general');
  assert.notEqual(parseQuestion('stop music in 10 minutes').kind, 'general');
  assert.notEqual(parseQuestion('create album Beach 2026').kind, 'general');
  const answer = summarizeAnswer(parseQuestion('What is the capital of France?'), { photos: [], songs: [] });
  assert.match(answer.text, /Cloud-enhanced answers in Settings → AI/);
  assert.equal(answer.done, true);
});
