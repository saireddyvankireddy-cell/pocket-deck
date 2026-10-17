import test from 'node:test';
import assert from 'node:assert/strict';
import { photoAlbumMatches, albumQueryFilters, suggestAlbums } from '../smart-features.mjs';
test('smart album queries keep old phrasing and gain year, month and media filters', () => {
  const meta={favorites:{'pc-1':true},indexes:{'pc-2':{version:'v1',text:'Red roses in the garden'}}};
  const people=[{name:'Wifey',photos:new Set(['pc-3'])}];
  const photo={id:'pc-1',fileName:'IMG_1.jpg',version:'v1',addedAt:Date.UTC(2024,5,10),mediaType:'photo'};
  const video={id:'pc-4',fileName:'clip.mp4',version:'v1',addedAt:Date.UTC(2024,5,10),mediaType:'video'};
  assert.equal(photoAlbumMatches(photo,{query:'favorites'},meta,people),true);
  assert.equal(photoAlbumMatches(video,{query:'media:video month:2024-06'},meta,people),true);
  assert.equal(photoAlbumMatches(photo,{query:'media:video month:2024-06'},meta,people),false);
  assert.equal(photoAlbumMatches(photo,{query:'year:2024'},meta,people),true);
  assert.equal(photoAlbumMatches(photo,{query:'year:2023'},meta,people),false);
  assert.equal(photoAlbumMatches(photo,{query:'media:photo'},meta,people),true);
  const wifey={id:'pc-3',fileName:'IMG_3.jpg',version:'v1',addedAt:Date.UTC(2024,2,1),mediaType:'photo'};
  assert.equal(photoAlbumMatches(wifey,{query:'Wifey year:2024'},meta,people),true);
  assert.equal(photoAlbumMatches(wifey,{query:'Wifey year:2025'},meta,people),false);
  const roses={id:'pc-2',fileName:'IMG_2.jpg',version:'v1',addedAt:Date.UTC(2024,5,10),mediaType:'photo'};
  assert.equal(photoAlbumMatches(roses,{query:'roses'},meta,people),true);
  assert.equal(photoAlbumMatches(roses,{query:'roses year:2024'},meta,people),true);
  assert.equal(photoAlbumMatches(roses,{query:'roses year:2020'},meta,people),false);
  assert.deepEqual(albumQueryFilters('Wifey year:2024 media:photo').filters.map(filter=>filter.kind),['year','media']);
});
test('suggestions combine monthly recaps, person years, favourites and text terms', () => {
  const photos=[];
  for(let i=0;i<18;i++)photos.push({id:'pc-'+i,fileName:'p'+i+'.jpg',version:'v1',addedAt:Date.UTC(2026,8,3+i%20),mediaType:'photo'});
  for(let i=0;i<9;i++)photos.push({id:'pc-v'+i,fileName:'v'+i+'.mp4',version:'v1',addedAt:Date.UTC(2026,8,5),mediaType:'video'});
  const peoplePhotos=new Set();
  for(let i=0;i<10;i++){const photo={id:'pc-w'+i,fileName:'w'+i+'.jpg',version:'v1',addedAt:Date.UTC(2026,1,1),mediaType:'photo'};photos.push(photo);peoplePhotos.add(photo.id);}
  const meta={favorites:{'pc-0':true},indexes:{},albums:{}};
  for(let i=0;i<12;i++)meta.indexes['pc-'+i]={version:'v1',text:'birthday celebration with cake'};
  const suggestions=suggestAlbums(photos,meta,[{name:'Wifey',photos:peoplePhotos}],new Date(Date.UTC(2026,9,17)));
  const names=suggestions.map(suggestion=>suggestion.name);
  assert.ok(names.includes('Recap · September 2026'),names.join(' | '));
  assert.ok(names.includes('Videos · September 2026'));
  assert.ok(names.includes('Wifey · 2026'));
  assert.ok(names.some(name=>name.startsWith('Tag · ')));
  assert.ok(!names.includes('♥ Favourites'));
  const recap=suggestions.find(suggestion=>suggestion.kind==='month');
  assert.equal(recap.query,'month:2026-09');
  const second=suggestAlbums(photos,{...meta,albums:{a:{name:'Recap · September 2026',query:'month:2026-09'}}},[{name:'Wifey',photos:peoplePhotos}],new Date(Date.UTC(2026,9,17)));
  assert.ok(!second.some(suggestion=>suggestion.name==='Recap · September 2026'));
  assert.ok(second.every(suggestion=>suggestion.count>=8));
});

test('year recaps and yearly favourite recaps refill the suggestion list', () => {
  const photos=[];
  for(let i=0;i<30;i++)photos.push({id:'pc-'+i,fileName:'p'+i+'.jpg',version:'v1',addedAt:Date.UTC(2025,4,10),mediaType:'photo'});
  const favorites={};for(let i=0;i<12;i++)favorites['pc-'+i]=true;
  const meta={favorites,indexes:{},albums:{}};
  const suggestions=suggestAlbums(photos,meta,[],new Date(Date.UTC(2026,9,17)),8);
  assert.ok(suggestions.some(suggestion=>suggestion.kind==='year'&&suggestion.query==='year:2025'&&suggestion.name==='Recap · 2025'),names(suggestions));
  assert.ok(suggestions.some(suggestion=>suggestion.kind==='favorites-year'&&suggestion.query==='favorites year:2025'&&suggestion.count===12));
  assert.ok(suggestions.length>=2);
  function names(list){return list.map(item=>item.name).join(' | ');}
});
