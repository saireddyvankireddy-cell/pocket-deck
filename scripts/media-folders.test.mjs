import test from 'node:test';
import assert from 'node:assert/strict';
import {flatten} from '../netlify/functions/lib/pcloud.mjs';
test('duplicate filenames retain their distinct source folders through recursive listing',()=>{
 const tree={folderid:0,name:'pCloud',contents:[
  {isfolder:true,folderid:10,name:'Automatic Folder',contents:[{fileid:1,name:'same.jpg'}]},
  {isfolder:true,folderid:20,name:'Thanusreenivas Reddy',contents:[{isfolder:true,folderid:21,name:'Family',contents:[{fileid:2,name:'same.jpg'}]}]},
 ]};
 const files=flatten(tree,'/');
 assert.deepEqual(files.map(file=>[file.fileid,file.folderName,file.folderPath,file.folderId]),[
  [1,'Automatic Folder','/Automatic Folder','10'],[2,'Family','/Thanusreenivas Reddy/Family','21'],
 ]);
 assert.equal(tree.contents[0].contents[0].folderPath,undefined);
 assert.equal(flatten(tree.contents[1],'Thanusreenivas Reddy')[0].folderPath,'Thanusreenivas Reddy/Family');
});

import {scanFolderTree} from '../netlify/functions/lib/pcloud.mjs';
test('all-folder scanning uses shallow reads and preserves photos across nested folders',async()=>{
 const trees={0:{folderid:0,name:'pCloud',contents:[{fileid:1,name:'root.jpg'},{isfolder:true,folderid:10,name:'Family'},{isfolder:true,folderid:20,name:'Music'}]},10:{folderid:10,name:'Family',contents:[{fileid:2,name:'same.jpg'},{isfolder:true,folderid:11,name:'Sister'}]},11:{folderid:11,name:'Sister',contents:[{fileid:3,name:'same.jpg'}]},20:{folderid:20,name:'Music',contents:[{fileid:4,name:'song.mp3'}]}};
 const calls=[];const scan=await scanFolderTree(async params=>{assert.equal(params.recursive,0);calls.push(params.folderid);return {metadata:trees[params.folderid]};},{folderid:'0'},'/');
 assert.deepEqual(scan.files.map(file=>[file.fileid,file.folderPath]),[[1,'/'],[2,'/Family'],[4,'/Music'],[3,'/Family/Sister']]);assert.equal(scan.folders,4);assert.deepEqual(scan.unavailable,[]);assert.deepEqual(calls,['0','10','20','11']);
});
test('a denied child is marked incomplete while root and network failures remain failures',async()=>{
 const denied=Object.assign(new Error('denied'),{result:2003});
 const scan=await scanFolderTree(async params=>{if(params.folderid==='0')return {metadata:{folderid:0,contents:[{fileid:1,name:'one.jpg'},{isfolder:true,folderid:2,name:'Shared'}]}};throw denied;},{folderid:'0'},'/');
 assert.deepEqual(scan.unavailable,['/Shared']);assert.equal(scan.files.length,1);
 await assert.rejects(()=>scanFolderTree(async()=>{throw denied;},{folderid:'0'},'/'),error=>error.result===2003);
 await assert.rejects(()=>scanFolderTree(async()=>{throw new Error('network');},{folderid:'0'},'/'),/network/);
});
