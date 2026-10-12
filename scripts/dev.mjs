import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {demoSnapshot} from './demo.mjs';
import {sync,runState} from './vps.mjs';
const root=resolve('public'),port=Number(process.env.PORT||4173);
const live=process.argv.includes('--live');
let syncing=false,updateState='idle',lastObservedAt=null;
async function updateLive(){
  if(syncing)return;
  syncing=true;
  try{
    const payload=await sync();
    updateState=(await runState())==='failed'?'error':'idle';
    if(payload.observedAt!==lastObservedAt){console.log(`Live ranking: ${payload.worlds.length} worlds, ${payload.observedAt}`);lastObservedAt=payload.observedAt;}
  }catch{
    try{updateState=(await runState())==='activating'?'collecting':'error';}catch{updateState='error';}
    console.log('Could not sync VPS data; previous ranking retained.');
  }finally{syncing=false;}
}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/api/health'){
      res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify({app:'world-watch',mode:live?'live':'preview',updateState}));return;
    }
    if(url.pathname==='/api/latest'){
      let data;try{data=JSON.parse(await readFile('.runtime/latest.json','utf8'));}catch(error){if(error.code!=='ENOENT')throw error;if(live){res.writeHead(503,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify({error:updateState==='collecting'?'collecting':'unavailable'}));return;}data=demoSnapshot();}
      if(live)data.updateState=updateState;
      res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data));return;
    }
    const path=resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
    if(!path.startsWith(root+'\\')&&!path.startsWith(root+'/')){res.writeHead(403);res.end();return;}
    const body=await readFile(path);
    res.writeHead(200,{'content-type':mime[extname(path)]||'application/octet-stream','cache-control':'no-store'});res.end(body);
  }catch{if(!res.headersSent){res.writeHead(404);res.end('Not found');}else res.destroy();}
}).listen(port,'127.0.0.1',()=>{
  console.log(`Local: http://127.0.0.1:${port} (${live?'live data':'preview'})`);
  if(live){updateLive();setInterval(updateLive,5*60*1000);}
});
