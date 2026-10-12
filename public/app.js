import {rankWorlds,filterWorlds,isStale,chartPath,launchUrl} from './model.js';
const $=selector=>document.querySelector(selector);
const fmt=new Intl.NumberFormat('ja-JP');
const dateFmt=new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});
let data=null,sort='total',platform='all',onlySaved=false,saved=new Set(),toastTimer;
try{const ids=JSON.parse(localStorage.getItem('world-watch-saved')||'[]');if(Array.isArray(ids))saved=new Set(ids.filter(x=>typeof x==='string'));}catch{}
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=value=>Number.isFinite(Date.parse(value))?dateFmt.format(new Date(value)):'不明';
const platforms=w=>(w.platforms?.length?w.platforms:['unknown']).map(p=>`<span class="platform">${escape({pc:'PC',quest:'Quest',ios:'iOS',unknown:'対応不明'}[p]||p)}</span>`).join('');
const spark=(history,width=100,height=30,metric=1)=>{const d=chartPath(history,metric,width,height);return d?`<svg class="spark" viewBox="0 0 ${width} ${height}" role="img" aria-label="毎時観測の人数推移"><path d="${d}"/></svg>`:'<span class="history-empty">履歴待ち</span>';};
const recentHistory=w=>(w.history||[]).filter(p=>p[0]>=Date.parse(w.observedAt||data.observedAt)/1000-24*3600);
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,2400);}
function toggleSave(id){saved.has(id)?saved.delete(id):saved.add(id);try{localStorage.setItem('world-watch-saved',JSON.stringify([...saved]));}catch{toast('このブラウザーでは保存できません');}render();}
function render(){
  if(!data)return;
  const top=rankWorlds(data.worlds,sort);
  const rows=filterWorlds(top,{search:$('#search').value,platform,saved:onlySaved?saved:null});
  $('#result-count').textContent=`${rows.length}件表示 / ${top.length}件`;
  $('#ranking-body').innerHTML=rows.map(w=>{
    const launch=!data.demo&&launchUrl(w.id)?`<a class="launch-inline" href="${escape(launchUrl(w.id))}" title="PC版VRChatで開く" aria-label="${escape(w.name)}をPC版VRChatで起動">▶ 起動 <span>PC</span></a>`:'';
    const delta=sort==='public'?w.deltaPublic:w.deltaTotal;
    const direction=delta>0?'up':delta<0?'down':'';
    const change=Number.isSafeInteger(delta)?`${delta>0?'+':''}${fmt.format(delta)}`:'—';
    const hue=[205,235,165,285,35,185][w.rank%6];
    const art=w.thumbnail?`<img src="${escape(w.thumbnail)}" alt="" loading="lazy" referrerpolicy="no-referrer" style="width:100%;height:100%;object-fit:cover">`:`<span>${escape(w.name.slice(0,1))}</span>`;
    return `<tr><td class="rank ${w.rank<=3?'top':''}">${String(w.rank).padStart(2,'0')}</td><td><div class="world-cell"><div class="world-art" style="--hue:${hue}">${art}</div><div class="world-info"><button class="world-name" data-detail="${escape(w.id)}" title="${escape(w.name)}">${escape(w.name)}</button><div class="world-meta"><span class="author">${escape(w.author||'作者不明')}</span>${platforms(w)}${launch}</div></div></div></td><td class="num">${fmt.format(w.total)}</td><td class="num public-num">${fmt.format(w.public)}<div class="share" title="総人数に対する公開側の割合"><i style="width:${Math.min(100,w.total?w.public/w.total*100:0)}%"></i></div></td><td class="change ${direction}">${change}</td><td class="trend">${spark(recentHistory(w),100,30,sort==='public'?2:1)}</td><td><button class="save-button ${saved.has(w.id)?'saved':''}" data-save="${escape(w.id)}" aria-label="${escape(w.name)}を${saved.has(w.id)?'保存から外す':'保存する'}" aria-pressed="${saved.has(w.id)}">${saved.has(w.id)?'★':'☆'}</button></td></tr>`;
  }).join('');
  $('#empty').hidden=rows.length>0;
  $('#empty').textContent=top.length===0?(sort==='growth'?'急上昇は1時間前の観測が揃うと表示されます。':'まだ掲載できる観測データがありません。'):onlySaved?'保存したワールドが今回のTOP100にありません。':'条件に一致するワールドがありません。';
}
function showDetail(id){
  const w=data.worlds.find(w=>w.id===id);if(!w)return;
  const history=w.history||[],recent=recentHistory(w),peak=recent.length?Math.max(...recent.map(p=>p[1])):w.total;
  const consistency=w.total!==w.public+w.private?'<p class="detail-note">総人数と内訳の合計に差があります。APIの集計値をそのまま表示しています。</p>':'';
  $('#detail-content').innerHTML=`<h2>${escape(w.name)}</h2><div class="detail-author">by ${escape(w.author||'作者不明')} &nbsp; ${platforms(w)}</div><div class="detail-numbers"><div><span>総同接</span><strong>${fmt.format(w.total)}</strong></div><div><span>パブリック</span><strong>${fmt.format(w.public)}</strong></div><div><span>非公開側</span><strong>${fmt.format(w.private)}</strong></div></div><h3>総同接の推移 · 直近48時間</h3><div class="detail-chart">${spark(history,520,135)}<div class="chart-labels"><span>${history.length?date(new Date(history[0][0]*1000).toISOString()):'観測開始後に表示'}</span><span>${history.length?date(new Date(history.at(-1)[0]*1000).toISOString()):''}</span></div></div><p class="detail-note">24時間の毎時観測ピーク：${fmt.format(peak)}人<br>このワールドの取得時刻：${date(w.observedAt||data.observedAt)} JST<br>公開側人数は、今あなたが参加できる部屋の人数を保証しません。</p>${consistency}<div class="detail-actions">${data.demo?'<button class="secondary-button" disabled>サンプルワールド</button>':`<a class="primary-link" href="${escape(launchUrl(w.id))}" title="PC版VRChatが必要です">▶ VRChatを起動 <small>PCのみ</small></a><a class="secondary-button" href="https://vrchat.com/home/world/${encodeURIComponent(w.id)}" target="_blank" rel="noopener noreferrer">公式ページ ↗</a>`}<button class="secondary-button" id="detail-save">${saved.has(w.id)?'★ 保存済み':'☆ 保存する'}</button></div>`;
  $('#detail-save').addEventListener('click',()=>{toggleSave(w.id);$('#detail-save').textContent=saved.has(w.id)?'★ 保存済み':'☆ 保存する';});
  $('#detail-dialog').showModal();
}
async function load(){
  $('#refresh').disabled=true;
  try{
    const response=await fetch('/api/latest',{cache:'no-store'});if(!response.ok){let issue;try{issue=await response.json();}catch{}throw new Error(issue?.error||'unavailable');}
    const next=await response.json();if(!Array.isArray(next.worlds)||typeof next.observedAt!=='string')throw new Error('invalid');
    data=next;
    $('#updated').textContent=`最終集計 ${date(data.observedAt)} JST`;
    $('#stat-total').textContent=fmt.format(data.worlds.reduce((sum,w)=>sum+w.total,0));
    $('#stat-public').textContent=fmt.format(data.worlds.reduce((sum,w)=>sum+w.public,0));
    $('#stat-worlds').textContent=fmt.format(data.worlds.length);
    $('#stat-pool').textContent=`アクティブ候補${fmt.format(data.candidateCount)}件から抽出`;
    $('#coverage').textContent=`取得候補 ${data.candidateCount}件 · 人数取得済み ${data.worlds.length}件${data.failedCount?` · 取得失敗 ${data.failedCount}件`:''}`;
    const notices=[];
    if(data.demo)notices.push('プレビュー用のサンプルデータです。実際のワールド名・人数・順位ではありません。');
    else if(isStale(data.observedAt))notices.push('更新が遅れています。最後に取得できたランキングを表示しています。');
    if(!data.demo&&data.updateState==='error')notices.push('今回の更新に失敗しました。最後に取得できたデータを表示しています。');
    if(data.failedCount)notices.push(`${data.failedCount}件の人数取得に失敗しました。取得できたワールド内の順位です。`);
    if(!data.demo&&data.worlds.length<100)notices.push(`今回の取得範囲で掲載できたのは${data.worlds.length}件です。`);
    $('#notice').hidden=notices.length===0;$('#notice').textContent=notices.join(' ');
    render();
  }catch(error){
    $('#notice').hidden=false;$('#notice').textContent=data?'再読み込みに失敗しました。前回取得したデータを表示しています。':error.message==='collecting'?'初回の人数集計中です。取得が完了するとランキングが表示されます。':'ランキングデータをまだ取得できません。時間をおいて再読み込みしてください。';
    if(!data){$('#updated').textContent='データ未取得';$('#ranking-body').innerHTML='';$('#empty').hidden=false;$('#empty').textContent='人数データが届くと、ここにランキングが表示されます。';}
  }finally{$('#refresh').disabled=false;}
}
document.querySelectorAll('[data-sort]').forEach(button=>button.addEventListener('click',()=>{sort=button.dataset.sort;document.querySelectorAll('[data-sort]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));});render();}));
document.querySelectorAll('[data-platform]').forEach(button=>button.addEventListener('click',()=>{platform=button.dataset.platform;document.querySelectorAll('[data-platform]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));});render();}));
$('#saved-filter').addEventListener('click',()=>{onlySaved=!onlySaved;$('#saved-filter').classList.toggle('active',onlySaved);$('#saved-filter').setAttribute('aria-pressed',String(onlySaved));render();});
$('#search').addEventListener('input',render);$('#refresh').addEventListener('click',load);
$('#ranking-body').addEventListener('click',event=>{const save=event.target.closest('[data-save]'),detail=event.target.closest('[data-detail]');if(save)toggleSave(save.dataset.save);else if(detail)showDetail(detail.dataset.detail);});
for(const selector of ['#about-open','#about-footer'])$(selector).addEventListener('click',()=>$('#about-dialog').showModal());
document.querySelectorAll('dialog').forEach(dialog=>{dialog.querySelector('[data-close]').addEventListener('click',()=>dialog.close());dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});});
$('#ranking-body').innerHTML=Array.from({length:8},()=>'<tr><td colspan="7"><div class="skeleton"></div></td></tr>').join('');
load();setInterval(load,5*60*1000);
