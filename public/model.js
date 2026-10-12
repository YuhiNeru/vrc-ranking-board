export const number = value => Number.isSafeInteger(value) && value >= 0;
export function launchUrl(id) {
  if(!/^wrld_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))return null;
  return `vrchat://launch?ref=vrchat.com&id=${encodeURIComponent(id)}&attach=1`;
}
export function rankWorlds(worlds, sort = 'total') {
  const rows = worlds.filter(w => number(w.total) && number(w.public) && number(w.private));
  const value = w => sort === 'public' ? w.public : sort === 'growth' ? w.deltaTotal : w.total;
  return rows.filter(w => sort !== 'growth' || Number.isSafeInteger(w.deltaTotal))
    .sort((a,b) => value(b)-value(a) || b.total-a.total || a.id.localeCompare(b.id))
    .slice(0,100).map((w,i) => ({...w,rank:i+1}));
}
export function filterWorlds(worlds, {search='',platform='all',saved=null}={}) {
  const query=search.toLocaleLowerCase('ja').normalize('NFKC').trim();
  return worlds.filter(w => (!query || `${w.name} ${w.author}`.toLocaleLowerCase('ja').normalize('NFKC').includes(query))
    && (platform==='all' || w.platforms?.includes(platform)) && (!saved || saved.has(w.id)));
}
export function isStale(observedAt, now=Date.now()) {
  const time=Date.parse(observedAt);
  return !Number.isFinite(time) || now-time > 90*60*1000;
}
export function chartPath(history, metric=1, width=100, height=30) {
  const valid=(history||[]).filter(p=>Array.isArray(p)&&Number.isFinite(p[0])&&number(p[metric]));
  if(valid.length<2)return '';
  const minT=valid[0][0],maxT=valid.at(-1)[0];
  if(maxT<=minT)return '';
  const values=valid.map(p=>p[metric]),min=Math.min(...values),max=Math.max(...values);
  let last=null;
  return valid.map(p=>{
    const x=2+(p[0]-minT)/(maxT-minT)*(width-4);
    const y=height-3-(p[metric]-min)/Math.max(1,max-min)*(height-6);
    const command=last===null || p[0]-last>95*60 ? 'M':'L';last=p[0];
    return `${command}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}
