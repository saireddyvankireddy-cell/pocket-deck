// Only packaged app code can reach the native API. No token is returned to JavaScript.
const originalFetch=window.fetch.bind(window);
let sequence=0;const requests=new Map();
window.saiNativeReply=(id,payload)=>{const pending=requests.get(id);if(!pending)return;requests.delete(id);clearTimeout(pending.timer);const result=JSON.parse(payload);pending.resolve(new Response(JSON.stringify(result.data),{status:result.status,headers:{'content-type':'application/json'}}));};
window.fetch=(input,options={})=>{
 const raw=typeof input==='string'?input:input.url;const url=new URL(raw,location.href);
 if(url.origin===location.origin&&url.pathname.startsWith('/.netlify/functions/')&&!url.pathname.endsWith('/media-content'))return new Promise((resolve,reject)=>{
  const id=++sequence;if(options.signal?.aborted){reject(new DOMException('Aborted','AbortError'));return;}
  const timer=setTimeout(()=>{requests.delete(id);reject(new Error('Request timed out. Saved changes will retry.'));},url.pathname.endsWith('/device-offline')?600000:180000);
  requests.set(id,{resolve,reject,timer});options.signal?.addEventListener('abort',()=>{requests.delete(id);clearTimeout(timer);reject(new DOMException('Aborted','AbortError'));},{once:true});
  SaiNative.request(String(id),url.pathname+url.search,options.method||'GET',String(options.body||''));
 });
 return originalFetch(input,options);
};
window.SAI_ANDROID=true;

window.SAI_PHOTOS_ONLY=true;

window.SAI_MUSIC_ENABLED=true;
window.addEventListener('load',()=>{try{SaiNative.ready()}catch(_){}});
