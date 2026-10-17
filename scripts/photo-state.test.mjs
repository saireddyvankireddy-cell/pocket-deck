import test from 'node:test';
import assert from 'node:assert/strict';
import { validOperation, replayOperations, groupFaces, collectPeople, faceGroupName, matchNamedFaces } from '../photo-state.mjs';
const id = n => `${String(n).padStart(8,'0')}-0000-4000-8000-000000000000`;
test('favorite toggles and album membership survive replay, retry and out-of-order arrival', () => {
  const ops = [
    { id:id(1), at:1, type:'favorite', photoId:'pc-1', value:true },
    { id:id(2), at:2, type:'favorite', photoId:'pc-1', value:false },
    { id:id(3), at:3, type:'album', albumId:id(10), name:'Family' },
    { id:id(4), at:4, type:'membership', albumId:id(10), photoId:'pc-1', value:true },
  ];
  const result = replayOperations([ops[3],ops[1],ops[0],ops[2],ops[3]]);
  assert.equal(result.favorites['pc-1'], false);
  assert.equal(result.albums[id(10)].name, 'Family');
  assert.equal(result.albums[id(10)].members['pc-1'], true);
  assert.equal(replayOperations(ops.concat({ id:id(5), at:5, type:'membership', albumId:id(10), photoId:'pc-1', value:false })).albums[id(10)].members['pc-1'], false);
  const removed = replayOperations(ops.concat({ id:id(6), at:6, type:'photo-delete', photoId:'pc-1' }));
  assert.equal(removed.favorites['pc-1'],undefined);
  assert.equal(removed.albums[id(10)].members['pc-1'],undefined);
});
test('face indexes validate descriptors and avoid grouping two faces from one photo', () => {
  const descriptor = Array(128).fill(0);
  const face = { descriptor, box:[.1,.1,.3,.3] };
  const index = { id:id(1), at:1, type:'index', photoId:'pc-1', text:'HELLO SAI', version:'v1', faces:[face,face] };
  assert.equal(validOperation(index), true);
  assert.equal(validOperation({ ...index, faces:[{ ...face, descriptor:[NaN] }] }), false);
  const meta = replayOperations([index,{...index,id:id(2),photoId:'pc-2',faces:[face]}]);
  assert.equal(meta.indexes['pc-1'].text, 'HELLO SAI');
  const groups = groupFaces(meta.indexes);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].photos.size, 2);
  assert.equal(groups[1].photos.size, 1);
});

test('switching photo folders preserves favorites, album membership and indexes across cloud replay', () => {
  const albumId=id(40);
  const records=[
    {id:id(30),at:1,type:'photo-folder',folder:{id:'42',name:'pCloud / Test photos'}},
    {id:id(31),at:2,type:'favorite',photoId:'pc-1',value:true},
    {id:id(32),at:3,type:'album',albumId,name:'Family'},
    {id:id(33),at:4,type:'membership',albumId,photoId:'pc-1',value:true},
    {id:id(34),at:5,type:'index',photoId:'pc-1',version:'v1',text:'ROSE',faces:[]},
    {id:id(35),at:6,type:'photo-folder',folder:{id:'99',name:'pCloud / Other photos'}},
  ];
  assert.equal(validOperation(records[0]),true);
  assert.equal(validOperation({...records[0],folder:{id:'../secret',name:'Invalid'}}),false);
  const restored=replayOperations(records);
  assert.equal(restored.photoFolder.id,'99');assert.equal(restored.favorites['pc-1'],true);
  assert.equal(restored.albums[albumId].members['pc-1'],true);assert.equal(restored.indexes['pc-1'].text,'ROSE');
  assert.equal(replayOperations([...records,{id:id(36),at:7,type:'photo-folder',folder:null}]).photoFolder,null);
});

test('same named face groups combine photos once and preserve unnamed people separately', () => {
  const group=(id,photos,faces)=>({id,photos:new Set(photos),faces:new Set(faces)});
  const groups=[group('pc-1-face-0',['pc-1','pc-2'],['pc-1-face-0','pc-2-face-0']),group('pc-3-face-0',['pc-2','pc-3'],['pc-2-face-1','pc-3-face-0']),group('pc-4-face-0',['pc-4'],['pc-4-face-0']),group('pc-5-face-0',['pc-5'],['pc-5-face-0'])];
  const names={'pc-1-face-0':'Sai Reddy','pc-3-face-0':' sai   REDDY '};
  const people=collectPeople(groups,names);
  assert.equal(people.length,3);assert.equal(people[0].id,'person:sai reddy');
  assert.deepEqual([...people[0].photos],['pc-1','pc-2','pc-3']);assert.equal(people[0].faces.size,4);
});
test('person labels restore from cloud, survive deletion of a cover photo and rename every merged face', () => {
  const face={descriptor:Array(128).fill(0),box:[.1,.1,.3,.3]};
  const indexes=[1,2].map(n=>({id:id(50+n),at:n,type:'index',photoId:'pc-'+n,version:'v1',text:'',faces:[face]}));
  const label={id:id(53),at:3,type:'person-label',faceIds:['pc-1-face-0','pc-2-face-0'],name:'Sai'};
  assert.equal(validOperation(label),true);assert.equal(validOperation({...label,faceIds:['pc-1-face-0','pc-1-face-0']}),false);assert.equal(validOperation({...label,faceIds:['bad']}),false);
  let state=replayOperations([...indexes,label,{id:id(54),at:4,type:'photo-delete',photoId:'pc-1'}]);
  let people=collectPeople(groupFaces(state.indexes),state.peopleNames,state.peopleNameTimes);
  assert.equal(people[0].name,'Sai');assert.deepEqual([...people[0].photos],['pc-2']);
  state=replayOperations([...indexes,label,{id:id(55),at:5,type:'person-label',faceIds:label.faceIds,name:'Sai Reddy'}]);
  people=collectPeople(groupFaces(state.indexes),state.peopleNames,state.peopleNameTimes);
  assert.equal(people.length,1);assert.equal(people[0].name,'Sai Reddy');assert.equal(state.peopleNames['pc-1-face-0'],'Sai Reddy');assert.equal(state.peopleNames['pc-2-face-0'],'Sai Reddy');
});
test('new matching face inherits a named group while a different face stays unnamed', () => {
  const face=value=>({descriptor:Array(128).fill(value),box:[.1,.1,.3,.3]});
  const groups=groupFaces({'pc-1':{faces:[face(0)]},'pc-2':{faces:[face(.01)]},'pc-3':{faces:[face(1)]}});
  const people=collectPeople(groups,{'pc-1-face-0':'Sai'});
  assert.equal(people.length,2);assert.equal(faceGroupName(groups[0],{'pc-1-face-0':'Sai'}),'Sai');assert.equal(people[0].photos.has('pc-2'),true);assert.equal(people[0].photos.has('pc-3'),false);
});

test('named matching learns multiple confirmed examples and matches later third and fourth photos', () => {
  const face=value=>({descriptor:Array(128).fill(value),box:[.1,.1,.3,.3]});
  const indexes={'pc-1':{faces:[face(0)]},'pc-2':{faces:[face(.06)]},'pc-3':{faces:[face(.065)]},'pc-4':{faces:[face(.07)]},'pc-5':{faces:[face(1)]}};
  const names={'pc-1-face-0':'Sister','pc-2-face-0':'Sister'};
  const matches=matchNamedFaces(indexes,names);
  assert.deepEqual(matches,[{faceId:'pc-3-face-0',name:'Sister'},{faceId:'pc-4-face-0',name:'Sister'}]);
  const records=[1,2,3,4,5].map(n=>({id:id(70+n),at:n,type:'index',photoId:'pc-'+n,version:'v1',text:'',faces:indexes['pc-'+n].faces}));
  records.push({id:id(80),at:6,type:'person-label',faceIds:Object.keys(names),name:'Sister'});
  records.push({id:id(81),at:7,type:'person-label',faceIds:matches.map(x=>x.faceId),name:'Sister',inferred:true});
  const restored=replayOperations(records);const people=collectPeople(groupFaces(restored.indexes),restored.peopleNames,restored.peopleNameTimes);
  assert.equal(people.find(p=>p.name==='Sister').photos.size,4);assert.equal(restored.peopleNameInferred['pc-3-face-0'],true);
});
test('named matching avoids a second face in the same photo, ambiguous identities and inferred training drift', () => {
  const face=value=>({descriptor:Array(128).fill(value),box:[.1,.1,.3,.3]});
  assert.deepEqual(matchNamedFaces({'pc-1':{faces:[face(0),face(.01)]}},{'pc-1-face-0':'Sister'}),[]);
  assert.deepEqual(matchNamedFaces({'pc-1':{faces:[face(0)]},'pc-2':{faces:[face(.002)]},'pc-3':{faces:[face(.001)]}},{'pc-1-face-0':'Sister','pc-2-face-0':'Mother'}),[]);
  assert.deepEqual(matchNamedFaces({'pc-1':{faces:[face(0)]},'pc-2':{faces:[face(.10)]},'pc-3':{faces:[face(.13)]}},{'pc-1-face-0':'Sister','pc-2-face-0':'Sister'},{'pc-2-face-0':true}),[]);
  assert.deepEqual(matchNamedFaces({'pc-1':{faces:[face(0)]},'pc-2':{faces:[face(.01),face(.012)]}},{'pc-1-face-0':'Sister'}),[]);
});
test('hidden photos and albums replay, validate, and clean up on deletion', () => {
  const albumId = id(20);
  const ops = [
    { id:id(1), at:1, type:'hidden', photoId:'pc-1', value:true },
    { id:id(2), at:2, type:'album', albumId, name:'Trip' },
    { id:id(3), at:3, type:'album-hidden', albumId, value:true },
    { id:id(4), at:4, type:'hidden', photoId:'pc-1', value:false },
  ];
  assert.equal(validOperation(ops[0]), true);
  assert.equal(validOperation(ops[2]), true);
  assert.equal(validOperation({ id:id(5), at:5, type:'hidden', photoId:'bad', value:true }), false);
  assert.equal(validOperation({ id:id(6), at:6, type:'hidden', photoId:'pc-1', value:'yes' }), false);
  assert.equal(validOperation({ id:id(7), at:7, type:'album-hidden', albumId:'nope', value:true }), false);
  const result = replayOperations([ops[2],ops[0],ops[3],ops[1]]);
  assert.equal(result.hidden['pc-1'], false);
  assert.equal(result.hiddenAlbums[albumId], true);
  const hidAgain = replayOperations(ops.concat({ id:id(8), at:8, type:'hidden', photoId:'pc-1', value:true }));
  assert.equal(hidAgain.hidden['pc-1'], true);
  const deleted = replayOperations(ops.concat([
    { id:id(9), at:9, type:'hidden', photoId:'pc-2', value:true },
    { id:id(10), at:10, type:'photos-delete', photoIds:['pc-2'] },
    { id:id(11), at:11, type:'album-delete', albumId },
  ]));
  assert.equal(deleted.hidden['pc-2'], undefined);
  assert.equal(deleted.hiddenAlbums[albumId], undefined);
});
test('a group that merged two named people never hands one person photos to the other', () => {
  const group=(id,photos,faces)=>({id,photos:new Set(photos),faces:new Set(faces)});
  const groups=[group('pc-1-face-0',['pc-1','pc-2','pc-3'],['pc-1-face-0','pc-2-face-0','pc-3-face-0'])];
  const people=collectPeople(groups,{'pc-1-face-0':'Bhanu papa','pc-3-face-0':'Wifey'});
  const bhanu=people.find(p=>p.name==='Bhanu papa');const wifey=people.find(p=>p.name==='Wifey');
  assert.deepEqual([...bhanu.photos],['pc-1']);assert.deepEqual([...wifey.photos],['pc-3']);
  const neutral=people.find(p=>p.name==='');assert.equal(neutral.photos.has('pc-2'),true);
  assert.equal(bhanu.photos.has('pc-2'),false);assert.equal(wifey.photos.has('pc-2'),false);
});
test('after a Not correction removes a face, unnamed faces in that group no longer join the name automatically', () => {
  const group=(id,photos,faces)=>({id,photos:new Set(photos),faces:new Set(faces)});
  const groups=[group('pc-1-face-0',['pc-1','pc-2','pc-3'],['pc-1-face-0','pc-2-face-0','pc-3-face-0'])];
  const people=collectPeople(groups,{'pc-1-face-0':'Bhanu papa','pc-2-face-0':''});
  const bhanu=people.find(p=>p.name==='Bhanu papa');assert.deepEqual([...bhanu.photos],['pc-1']);
  assert.equal(bhanu.faces.has('pc-3-face-0'),false);
  assert.equal(people.some(p=>p.name===''&&p.photos.has('pc-3')),true);
});
test('a face in a 6-person group photo joins the right person while the named person there stays untouched', () => {
  const face=value=>({descriptor:Array(128).fill(value),box:[.1,.1,.3,.3]});
  const indexes={'pc-8':{faces:[face(.012),face(.5)]},'pc-9':{faces:[face(.5),face(.01),face(.51),face(.52),face(.53),face(.54)]}};
  const matches=matchNamedFaces(indexes,{'pc-8-face-0':'Wifey','pc-8-face-1':'Bhanu papa','pc-9-face-0':'Bhanu papa'});
  assert.deepEqual(matches,[{faceId:'pc-9-face-1',name:'Wifey'}]);
});
test('ambiguous near matches are left neutral instead of guessed while a clear match still lands', () => {
  const face=value=>({descriptor:Array(128).fill(value),box:[.1,.1,.3,.3]});
  assert.deepEqual(matchNamedFaces({'pc-1':{faces:[face(0)]},'pc-2':{faces:[face(.0155)]},'pc-3':{faces:[face(.01)]}},{'pc-1-face-0':'Sister','pc-2-face-0':'Mother'}),[]);
  assert.deepEqual(matchNamedFaces({'pc-1':{faces:[face(0)]},'pc-2':{faces:[face(.01)]}},{'pc-1-face-0':'Sister'}),[{faceId:'pc-2-face-0',name:'Sister'}]);
});
test('deleting an album removes only the album record, including smart albums, and never the photos', () => {
  const albumId=id(40);const smartId=id(41);const face={descriptor:Array(128).fill(0),box:[.1,.1,.3,.3]};
  const ops=[
    {id:id(1),at:1,type:'index',photoId:'pc-1',version:'v1',text:'',faces:[face]},
    {id:id(2),at:2,type:'favorite',photoId:'pc-1',value:true},
    {id:id(3),at:3,type:'album',albumId,name:'Trip'},
    {id:id(4),at:4,type:'smart-album',albumId:smartId,name:'Beach',query:'beach',embedding:null},
    {id:id(5),at:5,type:'album-delete',albumId},
    {id:id(6),at:6,type:'album-delete',albumId:smartId},
  ];
  assert.equal(validOperation(ops[1]),true);assert.equal(validOperation(ops[3]),true);
  assert.equal(validOperation(ops[4]),true);assert.equal(validOperation(ops[5]),true);
  assert.equal(validOperation({id:id(7),at:7,type:'album-delete',albumId:'bad'}),false);
  const result=replayOperations(ops);
  assert.equal(result.albums[albumId],undefined);assert.equal(result.albums[smartId],undefined);
  assert.equal(result.favorites['pc-1'],true);assert.equal(result.indexes['pc-1'].text,'');
});
test('ai settings and chat memory replay from pCloud records', () => {
  const settings={id:id(50),at:50,type:'ai-settings',provider:'gemini',tier:'high',model:'gemini-3.6-flash',webSearch:true,privacy:'cloud'};
  const chat={id:id(51),at:51,type:'ai-chat',question:'Photos of Bhanu papa at the beach?',answer:'12 photos, mostly June 2026.',photoIds:['pc-1','pc-2'],songIds:['pc-9']};
  assert.equal(validOperation(settings),true);assert.equal(validOperation(chat),true);
  assert.equal(validOperation({...settings,provider:'unknown'}),false);
  assert.equal(validOperation({...settings,tier:'ultra'}),false);
  assert.equal(validOperation({...settings,privacy:'open'}),false);
  assert.equal(validOperation({...chat,question:'x'.repeat(301)}),false);
  assert.equal(validOperation({...chat,answer:'x'.repeat(2001)}),false);
  assert.equal(validOperation({...chat,photoIds:['bad']}),false);
  assert.equal(validOperation({...chat,songIds:['bad']}),false);
  const result=replayOperations([chat,settings]);
  assert.equal(result.aiSettings.provider,'gemini');assert.equal(result.aiSettings.model,'gemini-3.6-flash');assert.equal(result.aiSettings.privacy,'cloud');assert.equal(result.aiSettings.webSearch,true);
  assert.equal(result.aiChats.length,1);assert.equal(result.aiChats[0].question,'Photos of Bhanu papa at the beach?');assert.deepEqual(result.aiChats[0].songIds,['pc-9']);
});
test('ai chat memory keeps only the latest 200 questions', () => {
  const ops=[];for(let n=0;n<205;n++)ops.push({id:id(1000+n),at:1000+n,type:'ai-chat',question:'q'+n,answer:'a'+n});
  assert.equal(validOperation(ops[204]),true);
  const result=replayOperations(ops);
  assert.equal(result.aiChats.length,200);
  assert.equal(result.aiChats[0].question,'q5');
  assert.equal(result.aiChats[199].question,'q204');
});

test('people reset clears all names and lock replays on both devices',()=>{
  const ops=[
    {id:id(1),at:1,type:'person-name',personId:'pc-1-face-0',name:'Sai'},
    {id:id(2),at:2,type:'person-label',faceIds:['pc-2-face-0'],name:'Sai',inferred:true},
    {id:id(3),at:3,type:'people-reset'},
    {id:id(4),at:4,type:'person-name',personId:'pc-3-face-0',name:'Mom'},
    {id:id(5),at:5,type:'people-lock',value:true},
  ];
  const state=replayOperations(ops);
  assert.deepEqual(state.peopleNames,{'pc-3-face-0':'Mom'});
  assert.deepEqual(state.peopleNameTimes,{'pc-3-face-0':4});
  assert.equal(state.peopleNameInferred['pc-3-face-0'],false);
  assert.equal(state.peopleLocked,true);
  assert.equal(validOperation({id:id(6),at:6,type:'people-reset'}),true);
  assert.equal(validOperation({id:id(7),at:7,type:'people-lock',value:'yes'}),false);
  assert.equal(replayOperations([{id:id(8),at:8,type:'people-lock',value:true},{id:id(9),at:9,type:'people-lock',value:false}]).peopleLocked,false);
});

test('naming two separate face groups the same name merges them into one person', () => {
  const group=(id,photos,faces)=>({id,photos:new Set(photos),faces:new Set(faces)});
  const groups=[group('pc-1-face-0',['pc-1'],['pc-1-face-0']),group('pc-2-face-0',['pc-2'],['pc-2-face-0'])];
  const people=collectPeople(groups,{'pc-1-face-0':'Sai','pc-2-face-0':'  sai '});
  assert.equal(people.length,1);
  assert.equal(people[0].id,'person:sai');
  assert.deepEqual([...people[0].photos].sort(),['pc-1','pc-2']);
  assert.equal(people[0].faces.size,2);
  const later=collectPeople(groups,{'pc-1-face-0':'SAI','pc-2-face-0':'sai'},{'pc-2-face-0':2});
  assert.equal(later.length,1);
  assert.equal(later[0].name,'SAI');
});
