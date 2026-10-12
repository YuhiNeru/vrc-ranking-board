import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rankWorlds,filterWorlds,chartPath,isStale,launchUrl} from '../public/model.js';
import {demoSnapshot} from '../scripts/demo.mjs';
test('Public and total have independent TOP100 membership',()=>{
  const worlds=demoSnapshot().worlds;
  const total=rankWorlds(worlds),pub=rankWorlds(worlds,'public');
  assert.equal(total.length,100);assert.equal(pub.length,100);
  assert.notEqual(total[0].id,pub[0].id);
  assert.ok(pub.every((w,i)=>!i||pub[i-1].public>=w.public));
});
test('Missing observations are never converted into zero or growth',()=>{
  const valid={id:'1',name:'テスト',author:'a',total:0,public:0,private:0,deltaTotal:null};
  assert.equal(rankWorlds([valid,{...valid,id:'2',public:null}]).length,1);
  assert.equal(rankWorlds([valid],'growth').length,0);
});
test('Filters preserve rank and search matches normalized fullwidth input',()=>{
  const w={rank:8,id:'1',name:'JP カフェ',author:'test',platforms:['quest']};
  assert.equal(filterWorlds([w],{search:'ＪＰ',platform:'quest'})[0].rank,8);
  assert.equal(filterWorlds([w],{saved:new Set()}).length,0);
});
test('Charts do not bridge missing hours',()=>{
  assert.equal((chartPath([[0,10],[3600,20],[10800,30]]).match(/M/g)||[]).length,2);
  assert.equal(chartPath([[0,10]]),'');
  assert.equal(isStale(new Date(0).toISOString(),91*60000),true);
});
test('PC launch link matches the reference and rejects invalid world IDs',()=>{
  const id='wrld_b8562984-4c23-4374-9421-47e1495de24b';
  assert.equal(launchUrl(id),`vrchat://launch?ref=vrchat.com&id=${id}&attach=1`);
  assert.equal(launchUrl('javascript:alert(1)'),null);
});
