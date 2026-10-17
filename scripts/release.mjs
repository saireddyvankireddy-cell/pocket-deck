import {spawnSync} from 'node:child_process';
import {readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const tests=(await readdir(new URL('./',import.meta.url))).filter(name=>name.endsWith('.test.mjs')).map(name=>'scripts/'+name);
for(const args of [['scripts/build.mjs'],['--test',...tests],['scripts/backup.mjs']]){const result=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit'});if(result.status!==0)process.exit(result.status||1);}
