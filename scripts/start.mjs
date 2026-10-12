import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {openSync,closeSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('..',import.meta.url)),url='http://127.0.0.1:4173/';
async function ready(){try{const response=await fetch(url+'api/health',{signal:AbortSignal.timeout(1000)});return (await response.json()).app==='world-watch';}catch{return false;}}
if(await ready()){console.log(`Already running: ${url}`);process.exit(0);}
await mkdir(resolve(root,'.runtime'),{recursive:true});
const out=openSync(resolve(root,'.runtime/server.log'),'a'),err=openSync(resolve(root,'.runtime/server-error.log'),'a');
const child=spawn(process.execPath,[resolve(root,'scripts/dev.mjs'),'--live'],{cwd:root,detached:true,windowsHide:true,stdio:['ignore',out,err]});
child.unref();closeSync(out);closeSync(err);
await writeFile(resolve(root,'.runtime/server.pid'),String(child.pid));
for(let i=0;i<20;i++){await new Promise(done=>setTimeout(done,250));if(await ready()){console.log(`Local: ${url}`);process.exit(0);}}
console.error('Local server could not start. See .runtime/server-error.log.');process.exitCode=1;
