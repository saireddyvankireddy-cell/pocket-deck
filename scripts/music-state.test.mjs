import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTrack, shuffleQueue, nextTrackId, previousTrackId, insertNext, matchesMusic, sleepDeadline, sleepRemaining, normalizeSleepMinutes } from '../music-state.mjs';
import { validOperation, replayOperations } from '../photo-state.mjs';
const id=n=>`${String(n).padStart(8,'0')}-0000-4000-8000-000000000000`;
const track=n=>normalizeTrack({id:'pc-'+n,fileName:'Same title.mp3',name:'Same title',size:10,version:'v1'});
test('queue navigation respects end, repeat-one, repeat-all and play-next without duplication',()=>{
  const queue=['pc-1','pc-2','pc-3'];
  assert.equal(nextTrackId(queue,'pc-3','off'),null);
  assert.equal(nextTrackId(queue,'pc-3','all'),'pc-1');
  assert.equal(nextTrackId(queue,'pc-2','one',true),'pc-2');
  assert.equal(nextTrackId(queue,'pc-2','one',false),'pc-3');
  assert.equal(previousTrackId(queue,'pc-1','all'),'pc-3');
  assert.deepEqual(insertNext(queue,'pc-1','pc-3'),['pc-1','pc-3','pc-2']);
  const shuffled=shuffleQueue([...queue,'pc-2'],'pc-2',()=>0);
  assert.equal(shuffled[0],'pc-2');assert.deepEqual(new Set(shuffled),new Set(queue));
});
test('likes, played history, playlists, queue and resume survive replay by exact track ID',()=>{
  const ops=[
    {id:id(1),at:1,type:'music-like',track:track(1),value:true},
    {id:id(2),at:2,type:'music-like',track:track(2),value:false},
    {id:id(3),at:3,type:'music-play',track:track(1),playedAt:100},
    {id:id(4),at:4,type:'music-play',track:track(1),playedAt:200},
    {id:id(5),at:5,type:'music-playlist',playlistId:id(10),name:'Favorites'},
    {id:id(6),at:6,type:'music-membership',playlistId:id(10),track:track(1),value:true},
    {id:id(7),at:7,type:'music-queue',tracks:[track(1),track(2)]},
    {id:id(8),at:8,type:'music-position',track:track(1),position:45},
    {id:id(9),at:9,type:'music-settings',shuffle:true,repeat:'all',rate:1.5}
  ];
  assert.ok(ops.every(validOperation));
  const result=replayOperations([...ops].reverse().concat(ops[3]));
  assert.equal(result.musicLikes['pc-1'],true);assert.equal(result.musicLikes['pc-2'],false);
  assert.equal(result.musicHistory['pc-1'].count,2);assert.equal(result.musicHistory['pc-1'].playedAt,200);
  assert.equal(result.playlists[id(10)].members['pc-1'],true);
  assert.deepEqual(result.musicQueue,['pc-1','pc-2']);assert.equal(result.musicResume.position,45);
  assert.equal(result.musicSettings.rate,1.5);
  assert.equal(validOperation({...ops[7],position:Infinity}),false);
  assert.equal(validOperation({...ops[6],tracks:[track(1),track(1)]}),false);
  const removed=replayOperations([...ops,{id:id(11),at:11,type:'music-membership',playlistId:id(10),track:track(1),value:false}]);
  assert.equal(removed.playlists[id(10)].members['pc-1'],false);
  const resumed=replayOperations([...ops,{id:id(12),at:12,type:'music-play',track:track(1),playedAt:300,position:52}]);
  assert.equal(resumed.musicResume.position,52);assert.equal(resumed.musicHistory['pc-1'].count,3);
});

test('song deletion clears exact ID from every collection and preserves other songs',()=>{
 const ops=[{id:id(1),at:1,type:'music-like',track:track(1),value:true},{id:id(2),at:2,type:'music-play',track:track(1),playedAt:10},{id:id(3),at:3,type:'music-membership',playlistId:id(10),track:track(1),value:true},{id:id(4),at:4,type:'music-queue',tracks:[track(1),track(2)]},{id:id(5),at:5,type:'music-delete',trackId:'pc-1'}];
 const result=replayOperations(ops);assert.equal(result.musicLikes['pc-1'],undefined);assert.equal(result.musicHistory['pc-1'],undefined);assert.equal(result.musicTracks['pc-1'],undefined);assert.equal(result.musicResume,null);assert.equal(result.playlists[id(10)].members['pc-1'],undefined);assert.deepEqual(result.musicQueue,['pc-2']);assert.equal(result.musicTracks['pc-2'].id,'pc-2');
});

test('music search matches words in any order and timer uses an absolute deadline',()=>{
 assert.equal(matchesMusic(track(1),'title same'),true);assert.equal(matchesMusic(track(1),'other'),false);
 for(const minutes of [10,15,30]){const deadline=sleepDeadline(minutes,1000);assert.equal(deadline,1000+minutes*60000);assert.equal(sleepRemaining(deadline,deadline),0);assert.equal(validOperation({id:id(80),at:80,type:'music-sleep',minutes}),true);}
 assert.equal(sleepDeadline(5,1000),301000);assert.equal(sleepDeadline(0,1000),0);assert.equal(sleepRemaining(301000,300000),1000);assert.equal(sleepRemaining(301000,400000),0);
});
test('download preferences and sleep choice replay from pCloud without claiming device availability',()=>{
 const ops=[{id:id(21),at:21,type:'music-download',track:track(1),deviceId:id(99),value:true},{id:id(22),at:22,type:'music-sleep',minutes:30}];assert.ok(ops.every(validOperation));const result=replayOperations(ops);assert.equal(result.musicDownloads[id(99)]['pc-1'],true);assert.equal(result.musicSleep,30);
 const removed=replayOperations([...ops,{id:id(23),at:23,type:'music-delete',trackId:'pc-1'}]);assert.equal(removed.musicDownloads[id(99)]['pc-1'],undefined);assert.equal(validOperation({...ops[1],minutes:Infinity}),false);
});

test('assistant sleep minutes snap to offered choices and stay bounded',()=>{
  assert.equal(normalizeSleepMinutes(10),10);
  assert.equal(normalizeSleepMinutes(20),15);
  assert.equal(normalizeSleepMinutes(1),5);
  assert.equal(normalizeSleepMinutes(200),90);
  assert.equal(normalizeSleepMinutes(0),0);
  assert.equal(normalizeSleepMinutes('nope'),0);
  assert.equal(sleepRemaining(sleepDeadline(10,1000),1000+60000),9*60000);
});
