export function demoSnapshot(){
  const hour=Math.floor(Date.now()/3600000)*3600;
  const names=['青灯の喫茶室','夜凪の集会所','雲上アーケード','雨宿り図書館','星見の湯','路地裏の音楽室','月明かりの駅','ひだまりキャンプ','桜の回廊','海辺の作業部屋','夕暮れ麻雀館','森の小さなホテル'];
  const worlds=Array.from({length:132},(_,i)=>{
    const total=Math.max(3,Math.round(1840*Math.exp(-i/22)+18*Math.sin(i)));
    const pub=Math.round(total*(.13+((i*17)%71)/100));
    const history=Array.from({length:48},(_,j)=>{const t=Math.max(0,Math.round(total*(.68+.2*Math.sin(j/3+i)+.12*j/47)));const p=Math.round(t*(pub/total));return [hour-(47-j)*3600,t,p,t-p];});
    history[47]=[hour,total,pub,total-pub];
    return {id:`wrld_00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,name:names[i%names.length]+(i>=12?` ${Math.floor(i/12)+1}`:''),author:['aoiro','凪 / nagi','haruworks','komorebi','夜の工房'][i%5],platforms:i%4===0?['pc']:i%7===0?['pc','quest','ios']:['pc','quest'],total,public:pub,private:total-pub,deltaTotal:total-history[46][1],deltaPublic:pub-history[46][2],history,observedAt:new Date(hour*1000).toISOString()};
  });
  return {version:1,demo:true,hour:new Date(hour*1000).toISOString(),observedAt:new Date(hour*1000).toISOString(),candidateCount:500,eligibleCount:132,failedCount:0,worlds};
}
