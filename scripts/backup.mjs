import {mkdtemp,readFile,writeFile,readdir,mkdir,copyFile,rm,lstat,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {homedir,tmpdir} from 'node:os';
import {join,dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
const destination=process.env.PCLOUD_BACKUP_PATH||join(homedir(),'pCloud Drive',pkg.edition==='ente-gallery'?'Sai Photos Ente':'Sai Photos',process.env.SAI_PHOTOS_BACKUP_KIND==='android'?'Android App':'Web App','Build Code');
// Refuse to silently create an ordinary local folder when pCloud is unavailable.
const drive=process.env.PCLOUD_BACKUP_PATH||join(homedir(),'pCloud Drive');
try{await lstat(drive);}catch{throw new Error('pCloud Drive is not available. Mount it or set PCLOUD_BACKUP_PATH before making a cloud backup.');}
if(!process.env.PCLOUD_BACKUP_PATH){const check=spawnSync('df',['-P',drive],{encoding:'utf8'});if(check.status!==0||!check.stdout.split('\n').some(line=>line.trim().startsWith('pCloud.fs ')))throw new Error('The pCloud Drive folder is not mounted as pCloud storage. Backup stopped.');}
const temp=await mkdtemp(join(tmpdir(),'sai-photos-source-'));
const source=join(temp,'Sai Photos');await mkdir(source);
const secrets=[];try{for(const line of (await readFile(join(root,'.env'),'utf8')).split('\n')){const match=line.match(/^(PCLOUD_CLIENT_SECRET|SAI_PHOTOS_SESSION_KEY)=(.*)$/);if(match){const value=match[2].trim().replace(/^['"]|['"]$/g,'');if(value.length>7)secrets.push(Buffer.from(value));}}}catch{}
const manifest=[];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function include(path){const info=await lstat(path);if(info.isSymbolicLink())throw new Error('Source backup cannot include symlinks.');if(info.isDirectory()){for(const name of await readdir(path))await include(join(path,name));return;}if(!info.isFile())return;const name=relative(root,path);if(name.split('/').some(part=>['.git','node_modules','.ai-cache','dist','.netlify','.DS_Store','.gradle','build','.android-private','assets'].includes(part)))return;if(name.split('/').some(part=>part.startsWith('.env')&&part!=='.env.example')||/\.(pem|key|p12|pfx|jks|keystore|apk|aab|onnx)$/.test(name))return;if(name==='android/local.properties'||process.env.SAI_PHOTOS_BACKUP_KIND!=='android'&&name.startsWith('android/'))return;const bytes=await readFile(path);if(secrets.some(secret=>bytes.includes(secret)))throw new Error('Private configuration found in source; backup stopped.');const target=join(source,name);await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes);manifest.push({path:name,size:bytes.length,sha256:hash(bytes)});}
try{
 for(const name of await readdir(root)){if(['scripts','vendor','android'].includes(name))await include(join(root,name));else if(name==='netlify')await include(join(root,'netlify','functions'));else if(['.gitignore','.dockerignore','Dockerfile','.env.example','AGENTS.md','README.md','RESTORE.md','ENTE-PARITY.md','pnpm-lock.yaml','pnpm-workspace.yaml','netlify.toml','package.json'].includes(name)||/\.(mjs|js|html|css|svg|webmanifest)$/.test(name))await include(join(root,name));}
 await writeFile(join(source,'SOURCE-MANIFEST.json'),JSON.stringify({project:'Sai Photos',version:pkg.version,createdUtc:new Date().toISOString(),files:manifest},null,2)+'\n');
 const stamp=new Date().toISOString().replace(/[:.]/g,'-');const folder=join(destination,'v'+pkg.version+'-'+stamp);await mkdir(folder,{recursive:true});
 const zip=join(temp,'Sai-Photos-Source.zip');const result=spawnSync('zip',['-qr',zip,'Sai Photos'],{cwd:temp,stdio:'inherit'});if(result.status!==0)throw new Error('ZIP creation failed; the zip utility is required.');if(spawnSync('unzip',['-tq',zip],{stdio:'ignore'}).status!==0)throw new Error('Archive integrity check failed.');
 const digest=hash(await readFile(zip));const partial=join(folder,'Sai-Photos-Source.zip.partial');await copyFile(zip,partial);if(hash(await readFile(partial))!==digest)throw new Error('Cloud-drive copy does not match the source ZIP.');await rename(partial,join(folder,'Sai-Photos-Source.zip'));
 for(const name of ['RESTORE.md','SOURCE-MANIFEST.json'])await copyFile(join(source,name),join(folder,name));await writeFile(join(folder,'SHA256SUMS'),digest+'  Sai-Photos-Source.zip\n');
 if(process.env.SAI_PHOTOS_BACKUP_OUTPUT){await mkdir(process.env.SAI_PHOTOS_BACKUP_OUTPUT,{recursive:true});await copyFile(zip,join(process.env.SAI_PHOTOS_BACKUP_OUTPUT,'Sai-Photos-'+(process.env.SAI_PHOTOS_BACKUP_KIND==='android'?'Android':'Web')+'-v'+pkg.version+'-Source.zip'));}
 console.log('Source backup copied and checksum verified: '+folder);console.log('pCloud Drive handles upload; confirm the version folder appears on another device.');
}finally{await rm(temp,{recursive:true,force:true});}
