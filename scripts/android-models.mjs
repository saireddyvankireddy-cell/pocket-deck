// Restore the pinned public model assets; no account token is used.
import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));const manifest=JSON.parse(await readFile(join(root,'android/model-source.json'),'utf8'));
for(const file of manifest.files){const entry=typeof file==='string'?{path:file}:file;const destination=join(root,'.ai-cache/models',manifest.repository,manifest.revision,entry.path);let bytes;try{bytes=await readFile(destination);}catch{}if(bytes&&(!entry.sha256||createHash('sha256').update(bytes).digest('hex')===entry.sha256))continue;const response=await fetch(`https://huggingface.co/${manifest.repository}/resolve/${manifest.revision}/${entry.path}`);if(!response.ok)throw new Error('Public AI model download failed: '+entry.path);bytes=Buffer.from(await response.arrayBuffer());if(entry.sha256&&createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw new Error('AI model checksum failed: '+entry.path);await mkdir(dirname(destination),{recursive:true});await writeFile(destination+'.partial',bytes);await rename(destination+'.partial',destination);console.log('Prepared '+entry.path);}
