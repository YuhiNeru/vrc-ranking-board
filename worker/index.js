const ID=/^wrld_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const count=n=>Number.isSafeInteger(n)&&n>=0&&n<=10000000;
const date=s=>typeof s==='string'&&Number.isFinite(Date.parse(s));
const json=(data,status=200,headers={})=>Response.json(data,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff',...headers}});
export function validateSnapshot(input){
  if(!input||input.demo||input.version!==1||!date(input.hour)||!date(input.observedAt)||!Array.isArray(input.worlds)||input.worlds.length>500||!count(input.candidateCount)||input.candidateCount>500||!count(input.failedCount)||!count(input.eligibleCount))throw new Error('Invalid snapshot');
  if(input.worlds.length>input.eligibleCount||input.eligibleCount>input.candidateCount||input.failedCount>input.eligibleCount)throw new Error('Invalid coverage');
  if(Date.parse(input.hour)%3600000!==0||Date.parse(input.observedAt)<Date.parse(input.hour)||Date.parse(input.observedAt)>Date.now()+300000)throw new Error('Invalid time');
  const ids=new Set();
  const worlds=input.worlds.map(w=>{
    if(!w||!ID.test(w.id)||ids.has(w.id)||typeof w.name!=='string'||w.name.length<1||w.name.length>200||!count(w.total)||!count(w.public)||!count(w.private)||!date(w.observedAt))throw new Error('Invalid world');
    ids.add(w.id);
    if(!Array.isArray(w.history)||w.history.length>49)throw new Error('Invalid history');
    let previous=-1;
    const history=w.history.map(p=>{if(!Array.isArray(p)||p.length!==4||!Number.isSafeInteger(p[0])||p[0]<=previous||p[0]*1000>Date.parse(input.observedAt)+300000||!p.slice(1).every(count))throw new Error('Invalid history point');previous=p[0];return p;});
    const thumbnail=typeof w.thumbnail==='string'&&/^https:\/\/api\.vrchat\.cloud\/api\/1\/(file|image)\/[a-zA-Z0-9_\-/]+$/.test(w.thumbnail)?w.thumbnail:null;
    return {id:w.id,name:w.name,author:typeof w.author==='string'?w.author.slice(0,200):'',platforms:Array.isArray(w.platforms)?w.platforms.filter(p=>['pc','quest','ios'].includes(p)):[],thumbnail,total:w.total,public:w.public,private:w.private,deltaTotal:Number.isSafeInteger(w.deltaTotal)?w.deltaTotal:null,deltaPublic:Number.isSafeInteger(w.deltaPublic)?w.deltaPublic:null,observedAt:w.observedAt,history};
  });
  return {version:1,demo:false,hour:new Date(input.hour).toISOString(),observedAt:new Date(input.observedAt).toISOString(),candidateCount:input.candidateCount,eligibleCount:input.eligibleCount,failedCount:input.failedCount,worlds};
}
async function authorized(request,secret){
  if(typeof secret!=='string'||secret.length<32)return false;
  const supplied=request.headers.get('authorization')||'';
  if(supplied.length>256)return false;
  const enc=new TextEncoder();
  const a=new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(supplied)));
  const b=new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(`Bearer ${secret}`)));
  let difference=0;for(let i=0;i<a.length;i++)difference|=a[i]^b[i];return difference===0;
}
export default {async fetch(request,env){
  const path=new URL(request.url).pathname;
  if(path==='/api/latest'){
    if(request.method!=='GET')return json({error:'Method not allowed'},405,{allow:'GET'});
    if(!env.DB)return json({error:'Ranking data is not configured'},503);
    try{const row=await env.DB.prepare('SELECT payload FROM snapshots ORDER BY observed_at DESC LIMIT 1').first();if(!row)return json({error:'No observations yet'},503);return new Response(row.payload,{headers:{'content-type':'application/json; charset=utf-8','cache-control':'public, max-age=60','x-content-type-options':'nosniff'}});}catch{return json({error:'Ranking data unavailable'},503);}
  }
  if(path==='/api/ingest'){
    if(request.method!=='POST')return json({error:'Method not allowed'},405,{allow:'POST'});
    if(!await authorized(request,env.INGEST_TOKEN))return json({error:'Unauthorized'},401);
    if(!env.DB)return json({error:'Storage not configured'},503);
    if(Number(request.headers.get('content-length'))>3*1024*1024)return json({error:'Payload too large'},413);
    let payload;try{const raw=await request.text();if(new TextEncoder().encode(raw).length>3*1024*1024)return json({error:'Payload too large'},413);payload=validateSnapshot(JSON.parse(raw));}catch{return json({error:'Invalid snapshot'},400);}
    try{
      await env.DB.batch([env.DB.prepare('INSERT INTO snapshots(hour,observed_at,payload) VALUES(?,?,?) ON CONFLICT(hour) DO UPDATE SET observed_at=excluded.observed_at,payload=excluded.payload WHERE excluded.observed_at>=snapshots.observed_at').bind(payload.hour,payload.observedAt,JSON.stringify(payload)),env.DB.prepare('DELETE FROM snapshots WHERE hour NOT IN (SELECT hour FROM snapshots ORDER BY observed_at DESC LIMIT 24)')]);
      return json({ok:true,worlds:payload.worlds.length});
    }catch{return json({error:'Storage unavailable'},503);}
  }
  if(path.startsWith('/api/'))return json({error:'Not found'},404);
  const response=await env.ASSETS.fetch(request);
  const secured=new Response(response.body,response);
  secured.headers.set('X-Content-Type-Options','nosniff');
  secured.headers.set('Referrer-Policy','strict-origin-when-cross-origin');
  secured.headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://api.vrchat.cloud https://files.vrchat.cloud; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  return secured;
}};
