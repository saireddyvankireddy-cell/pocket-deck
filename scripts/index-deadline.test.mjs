import test from 'node:test';
import assert from 'node:assert/strict';
import {withIndexDeadline,normalizeFileVersion} from '../photo-tools.mjs';
import {boundedVisualFeatures,stopVisualWorker} from '../netlify/functions/lib/visual-worker-client.mjs';
test('index deadline retains the timeout reason and accepts completed work',async()=>{
 assert.equal(await withIndexDeadline(Promise.resolve(42),100,'Preview'),42);
 await assert.rejects(withIndexDeadline(new Promise(()=>{}),10,'Preview'),error=>error.name==='IndexTimeout'&&error.message.includes('saved indexes are retained'));
});
test('hung visual worker is terminated and a later task can start',async()=>{
 try{await assert.rejects(boundedVisualFeatures(Buffer.from('invalid'),{},1),/timed out/);await assert.rejects(boundedVisualFeatures(Buffer.from('invalid'),{},10000),/could not analyze/);}finally{stopVisualWorker();}
});

test('Mac and Android numeric hash representations reuse the same index version',()=>{assert.equal(normalizeFileVersion('5380817599554757120'),normalizeFileVersion('5380817599554757000'));assert.equal(normalizeFileVersion('5.380817599554757E18'),normalizeFileVersion('5380817599554757000'));assert.equal(normalizeFileVersion('version-1'),'version-1');assert.notEqual(normalizeFileVersion('5380817599554000000'),normalizeFileVersion('5380817599554757000'));});
