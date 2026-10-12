import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateSnapshot} from '../worker/index.js';
const exec=promisify(execFile),root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const defaults={port:22};
export async function settings(){
  const config={...defaults,...JSON.parse(await readFile(resolve(root,'.runtime/vps.json'),'utf8'))};
  if(!['host','user','key','knownHosts'].every(key=>typeof config[key]==='string'&&config[key]))throw new Error('Configure .runtime/vps.json');
  return config;
}
export async function ssh(command){
  const config=await settings();
  if(!/^[a-zA-Z0-9.:-]+$/.test(config.host)||!/^[a-zA-Z0-9_-]+$/.test(config.user))throw new Error('Invalid SSH destination');
  return exec('ssh',['-p',String(config.port),'-i',config.key,'-o','StrictHostKeyChecking=yes','-o',`UserKnownHostsFile=${config.knownHosts}`,'-o','BatchMode=yes','-o','ConnectTimeout=12',`${config.user}@${config.host}`,command],{timeout:25000,maxBuffer:3*1024*1024,windowsHide:true});
}
export async function sync(){
  const {stdout}=await ssh('cat /var/lib/vrc-ranking-board/latest.json');
  const payload=validateSnapshot(JSON.parse(stdout));
  await mkdir(resolve(root,'.runtime'),{recursive:true});
  const temporary=resolve(root,'.runtime/latest.tmp.json');
  await writeFile(temporary,JSON.stringify(payload),'utf8');
  await rename(temporary,resolve(root,'.runtime/latest.json'));
  return payload;
}
export async function collect(){
  await ssh('systemctl start --no-block vrc-ranking-board.service');
}
export async function runState(){
  const {stdout}=await ssh('systemctl show vrc-ranking-board.service -p ActiveState --value');
  return stdout.trim();
}
export async function waitForCollection({onProgress=()=>{},maxMs=50*60*1000}={}){
  const started=Date.now();
  while(Date.now()-started<maxMs){
    const state=await runState();
    if(state==='failed')throw new Error('Collection failed; previous data retained');
    if(state==='inactive')return sync();
    onProgress(state);
    await new Promise(done=>setTimeout(done,30000));
  }
  throw new Error('Collection timed out; previous data retained');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv[2]==='collect'){
      await collect();console.log('Collecting active worlds on VPS (existing World Compass stays unchanged).');
      const payload=await waitForCollection();console.log(`Ready: ${payload.worlds.length} worlds / ${payload.candidateCount} candidates.`);
    }else if(process.argv[2]==='sync'){
      const payload=await sync();console.log(`Synced ${payload.worlds.length} observed worlds.`);
    }else throw new Error('Use sync or collect');
  }catch{console.error('Could not obtain live ranking data. Check SSH access and ranking service status.');process.exitCode=1;}
}
