import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
let child;let serial=0;const pending=new Map();let queue=Promise.resolve();let idle;
function discard(message){const old=child;child=null;clearTimeout(idle);old?.kill('SIGKILL');for(const row of pending.values()){clearTimeout(row.timer);row.reject(new Error(message));}pending.clear();}
function worker(){
 if(child)return child;
 child=fork(fileURLToPath(new URL('../../../scripts/visual-worker.mjs',import.meta.url)),[],{execArgv:[],env:{PATH:process.env.PATH,TMPDIR:process.env.TMPDIR,HOME:process.env.HOME},stdio:['ignore','ignore','ignore','ipc']});
 const current=child;
 current.on('message',message=>{const row=pending.get(message.id);if(!row)return;pending.delete(message.id);clearTimeout(row.timer);message.error?row.reject(new Error(message.error)):row.resolve(message.features);clearTimeout(idle);idle=setTimeout(()=>{if(child===current&&!pending.size)discard('AI worker stopped while idle.');},60000);idle.unref();});
 current.on('error',()=>{if(child===current)discard('Local AI worker failed. Retry indexing.');});
 current.on('exit',()=>{if(child===current)discard('Local AI worker stopped. Retry indexing.');});
 return child;
}
export function boundedVisualFeatures(bytes,photo,timeoutMs=90000){
 const task=queue.catch(()=>{}).then(()=>new Promise((resolve,reject)=>{clearTimeout(idle);const id=++serial;const timer=setTimeout(()=>discard('Visual AI timed out. This photo can be retried; saved indexes are retained.'),timeoutMs);pending.set(id,{resolve,reject,timer});worker().send({id,bytes:Buffer.from(bytes).toString('base64'),photo});}));queue=task;return task;
}
export function stopVisualWorker(){discard('Visual AI stopped. Saved indexes are retained.');}
