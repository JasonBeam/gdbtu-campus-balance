export const labels={whale:'LOT 剩余',power:'电费余额',card:'校园卡余额'};
export const states={live:'实时',stale:'过期待更新',offline:'离线',cache:'缓存',refreshing:'更新中',demo:'示例',queried:'查询成功'};
export const sourceNames={device_direct:'设备直连',companion_cache:'Companion 缓存',device:'外接设备',companion:'Companion',demo:'示例数据',school:'学校接口',unavailable:'未获取'};
export const fmt=(n,digits=1)=>typeof n==='number'&&Number.isFinite(n)?new Intl.NumberFormat('zh-CN',{minimumFractionDigits:digits,maximumFractionDigits:digits}).format(n):'--';
export const time=(s,full=false)=>{const d=new Date(s);return s&&Number.isFinite(d.getTime())?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',...(full?{month:'2-digit',day:'2-digit'}:{}),hour:'2-digit',minute:'2-digit',hour12:false}).format(d):'--';};
export function metricValid(m){return m?.available===true&&typeof m.value==='number'&&Number.isFinite(m.value);}
export function mergeSnapshot(previous,next){
  const merged=structuredClone(next);merged.metrics={...(next.metrics||{})};merged.sources={...(next.sources||{})};
  for(const [key,old] of Object.entries(previous?.metrics||{})){
    const candidate=merged.metrics[key];
    const older=metricValid(candidate)&&Number.isFinite(Date.parse(old.updatedAt))&&Number.isFinite(Date.parse(candidate.updatedAt))&&Date.parse(candidate.updatedAt)<Date.parse(old.updatedAt);
    if(metricValid(old)&&(!metricValid(candidate)||older)){
      merged.metrics[key]={...old,sourceState:next.connected?'stale':'offline'};
      if(previous.sources?.[key])merged.sources[key]=previous.sources[key];
    }
  }
  return merged;
}
export function demoData(){
  const records=[];let lot=258.7,power=142.8,card=61.6;
  // Explicit synthetic fixtures; never inserted into the real journal.
  for(let day=0;day<30;day++){
    const date=new Date(Date.UTC(2026,8,16+day,10,0));
    lot-= [1.8,2.4,3.1,1.2,4.8,2.9,1.4][day%7];
    power-= [1.4,1.7,1.1,2.2][day%4];card-= [2.8,4.5,0,3.2][day%4];
    if(day===14)power+=40;if(day===20)card+=60;
    for(const [metric,value] of Object.entries({power,card}))records.push({id:records.length+1,metric,value:Math.round(value*100)/100,total:null,unit:'CNY',providerAt:date.toISOString(),observedAt:date.toISOString(),source:'demo',state:'demo',estimated:0});
  }
  const last=k=>records.filter(r=>r.metric===k).at(-1);
  const metric=(value,total=100)=>({value,total,available:true,sourceState:'demo',updatedAt:'2026-10-15T18:00:00+08:00',resetAt:null,estimate:false});
  const snapshot={connected:false,transport:'demo',checkedAt:null,device:{online:false},metrics:{power:metric(last('power').value,null),card:metric(last('card').value,null)},sources:{power:'demo',card:'demo'},battery:{keyboard:null,mouse:null}};
  return {snapshot,records};
}
export function filterRecords(records,days){
  const valid=records.filter(r=>Number.isFinite(Date.parse(r.providerAt)));
  if(!valid.length)return [];
  const last=Math.max(...valid.map(r=>Date.parse(r.providerAt)));
  const dayKey=s=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(s));
  const dayEnd=new Date(last+8*3600000).toISOString().slice(0,10);
  const start=Date.parse(dayEnd+'T00:00:00+08:00')-(days-1)*86400000;
  return valid.filter(r=>Date.parse(r.providerAt)>=start&&Date.parse(r.providerAt)<=last).sort((a,b)=>Date.parse(a.providerAt)-Date.parse(b.providerAt)||a.id-b.id);
}
export function changes(records,metric){
  const points=records.filter(r=>r.metric===metric).sort((a,b)=>Date.parse(a.providerAt)-Date.parse(b.providerAt)||a.id-b.id);
  let previous=null;
  return points.map(p=>{
    const sameTotal=previous&&previous.source===p.source&&(metric!=='whale'||previous.total===p.total);
    const changedTime=previous&&Date.parse(previous.providerAt)<Date.parse(p.providerAt);
    const comparable=Boolean(sameTotal&&changedTime&&!p.estimated&&!previous.estimated&&['live','demo','queried'].includes(p.state)&&['live','demo','queried'].includes(previous.state));
    const delta=comparable?Math.round((p.value-previous.value)*1000000)/1000000:null;
    previous=p;return {...p,delta};
  });
}
export function decrease(records,metric){return changes(records,metric).reduce((n,p)=>n+(p.delta<0?-p.delta:0),0);}
export function dailyData(records,metric,kind='balance'){
  const points=changes(records,metric),days=new Map();
  for(const p of points){
    const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(p.providerAt));
    let item=days.get(date)||{date,value:kind==='used'?null:p.value,estimated:false,stale:false,count:0};
    if(kind==='used'){if(p.delta!==null){item.value=(item.value??0)+Math.max(0,-p.delta);item.count++;}}
    else item.value=p.value;
    item.estimated=item.estimated||Boolean(p.estimated);item.stale=item.stale||!['live','demo','queried'].includes(p.state);days.set(date,item);
  }
  return [...days.values()];
}
