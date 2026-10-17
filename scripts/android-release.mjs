import {spawnSync} from 'node:child_process';
import {readFile,mkdir,copyFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
const run=(command,args,env=process.env)=>{const result=spawnSync(command,args,{cwd:root,env,stdio:'inherit'});if(result.status!==0)throw new Error('Android release stopped because a required check failed.');};
run(process.execPath,['scripts/build.mjs']);run(process.execPath,['scripts/android-models.mjs']);run(process.execPath,['scripts/android-prepare.mjs']);
const tasks=['assembleRelease','testReleaseUnitTest'];if(process.env.SAI_ANDROID_DEVICE_TEST==='true')tasks.push('connectedReleaseAndroidTest');
run(process.env.SAI_ANDROID_GRADLE_BIN||join(root,'android/gradlew'),['-p','android',...tasks,'--max-workers=2','--console=plain']);
run(process.execPath,['scripts/backup.mjs'],{...process.env,SAI_PHOTOS_BACKUP_KIND:'android'});
const source=join(process.env.SAI_ANDROID_BUILD_DIR||join(root,'android/app/build'),'outputs/apk/release/app-release.apk');const bytes=await readFile(source);const hash=createHash('sha256').update(bytes).digest('hex');
const folder=join(homedir(),'pCloud Drive',pkg.edition==='ente-gallery'?'Sai Photos Ente':'Sai Photos','Android App','Releases','v'+pkg.version+'-'+new Date().toISOString().replace(/[:.]/g,'-'));await mkdir(folder,{recursive:true});
const name='Sai-Photos-Android-v'+pkg.version+'.apk';await copyFile(source,join(folder,name));if(createHash('sha256').update(await readFile(join(folder,name))).digest('hex')!==hash)throw new Error('APK cloud-drive copy failed verification.');await writeFile(join(folder,'SHA256SUMS'),hash+'  '+name+'\n');console.log('Verified Android APK release copied: '+folder);
if(process.env.SAI_ANDROID_OUTPUT){await mkdir(process.env.SAI_ANDROID_OUTPUT,{recursive:true});await copyFile(source,join(process.env.SAI_ANDROID_OUTPUT,name));await writeFile(join(process.env.SAI_ANDROID_OUTPUT,name+'.sha256'),hash+'  '+name+'\n');}
