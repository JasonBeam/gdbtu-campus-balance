import {labels,states,sourceNames,fmt,time,metricValid,demoData,filterRecords,changes,decrease,dailyData,mergeSnapshot} from './model.js';
const $=id=>document.getElementById(id),demo=demoData();
const allowedViews=['overview','records','quality'];
let view='overview',mode='real',range=7,page=0;
let real={connected:false,transport:'offline',metrics:{},sources:{},device:{online:false}},history=[],hasRead=false,busy=false,recording=false;
const pageSize=15, pageNames={overview:'数据总览',records:'校园余额记录',quality:'数据状态',};
function parseURL(){const q=new URLSearchParams(location.search);view=allowedViews.includes(q.get('view'))?q.get('view'):'overview';mode=q.get('mode')==='demo'?'demo':'real';range=q.get('range')==='30'?30:7;}
function pushURL(){const q=new URLSearchParams({view,mode,range:String(range)});historyPush('?'+q.toString());}
const historyPush=url=>window.history.pushState({},'',url);
function go(next){view=next;page=0;pushURL();render();$('pageTitle').focus({preventScroll:true});window.scrollTo({top:0,behavior:'instant'});}
function dataset(){return mode==='demo'?demo:{snapshot:real,records:history};}
function status(s){return states[s]||'未获取';}
function statusChip(id,metric){const el=$(id);el.className='status-chip '+(metric?.sourceState||'offline');el.textContent=metric?.estimate?'估算 · '+status(metric?.sourceState):status(metric?.sourceState);}
function segments(id,value){const node=$(id);node.replaceChildren();const valid=typeof value==='number'&&Number.isFinite(value);for(let n=0;n<20;n++){const i=document.createElement('i'),fill=document.createElement('span');fill.style.width=Math.max(0,Math.min(100,((valid?value:0)-n*5)*20))+'%';i.append(fill);node.append(i);}node.setAttribute('aria-label',valid?`剩余 ${fmt(value,0)}%`:'剩余额度未获取');}
function sumLabel(records,key){const comparable=changes(records,key).some(p=>p.delta!==null);return comparable?fmt(decrease(records,key),key==='whale'?1:2):'--';}
function dateLabel(date){const d=new Date(date+'T12:00:00+08:00');return new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',timeZone:'Asia/Shanghai'}).format(d);}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function emptyChart(id){$(id).innerHTML='<div class="empty-state"><strong>从第一条真实记录开始</strong><p>暂无可比较样本。切换真实模式并记录快照后，这里才会形成趋势。</p></div>';}
function chart(id,series,{bars=false,unit='CNY'}={}){
  const sets=series.map(s=>({...s,points:s.points.filter(p=>p.value!==null&&Number.isFinite(p.value))}));
  const dates=[...new Set(series.flatMap(s=>s.points.map(p=>p.date)))].sort();
  const values=sets.flatMap(s=>s.points.map(p=>p.value));if(!values.length){emptyChart(id);return;}
  const W=520,H=188,L=35,R=10,T=12,B=25,iw=W-L-R,ih=H-T-B;
  const max=Math.max(...values),ceiling=max<=0?1:Math.ceil(max*1.15/(max>100?20:max>10?5:1))*(max>100?20:max>10?5:1);
  const floor=Math.min(0,...values);
  const x=d=>L+(dates.indexOf(d)+.5)*iw/dates.length,y=v=>T+ih-(v-floor)/(ceiling-floor)*ih;
  let svg=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${bars?'观察到的流量减少':'余额历史'}，单位 ${unit}">`;
  for(let i=0;i<4;i++){const val=floor+(ceiling-floor)*i/3,yy=y(val);svg+=`<line class="gridline" x1="${L}" y1="${yy}" x2="${W-R}" y2="${yy}"/><text x="${L-8}" y="${yy+3}" text-anchor="end">${esc(fmt(val,max<5?1:0))}</text>`;}
  dates.forEach((d,i)=>{if(dates.length<=7||i===0||i===dates.length-1||i%Math.ceil(dates.length/6)===0)svg+=`<text x="${x(d)}" y="${H-4}" text-anchor="middle">${esc(dateLabel(d))}</text>`;});
  for(const s of sets){
    if(bars){const width=Math.min(32,iw/dates.length*.48);for(const p of s.points){const xx=x(p.date),yy=y(p.value);svg+=`<rect class="data-bar" tabindex="0" x="${xx-width/2}" y="${yy}" width="${width}" height="${Math.max(1,T+ih-yy)}" rx="3" data-tip="${esc(dateLabel(p.date)+'\n'+s.label+' '+fmt(p.value,1)+' '+unit)}"><title>${esc(dateLabel(p.date)+'：'+fmt(p.value,1)+' '+unit)}</title></rect>`;}}
    else{
      // Split gaps: do not interpolate across days without observations.
      let run=[];const runs=[];
      for(const p of s.points){if(run.length&&Date.parse(p.date)-Date.parse(run.at(-1).date)>86400000){runs.push(run);run=[];}run.push(p);}if(run.length)runs.push(run);
      for(const part of runs)for(let i=1;i<part.length;i++){const a=part[i-1],b=part[i];svg+=`<path class="plot-line" style="stroke:${s.color}${a.stale||b.stale||a.estimated||b.estimated?';stroke-dasharray:4 4':''}" d="M${x(a.date)},${y(a.value)} L${x(b.date)},${y(b.value)}"/>`;}
      for(const p of s.points)svg+=`<circle class="point" tabindex="0" style="fill:${p.estimated||p.stale?'var(--surface)':s.color}${p.estimated||p.stale?';stroke:'+s.color:''}" cx="${x(p.date)}" cy="${y(p.value)}" r="3.5" data-tip="${esc(dateLabel(p.date)+'\n'+s.label+' '+fmt(p.value,s.label==='LOT'?1:2)+' '+unit+(p.estimated?' · 估算':p.stale?' · 缓存/过期样本':''))}"><title>${esc(s.label+'：'+fmt(p.value,2)+' '+unit)}</title></circle>`;
    }
  }
  $(id).innerHTML=svg+'</svg>';
}
function rowsFor(records){return ['power','card'].flatMap(k=>changes(records,k)).sort((a,b)=>Date.parse(b.providerAt)-Date.parse(a.providerAt)||b.id-a.id);}
function fillTable(id,rows,full=false){
  const body=$(id);body.replaceChildren();
  if(!rows.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=full?5:4;td.className='empty-table';td.textContent='还没有记录。真实历史从首次采集开始，不补造过去的数据。';tr.append(td);body.append(tr);return;}
  for(const row of rows){
    const tr=document.createElement('tr');
    const value=(row.metric==='whale'?fmt(row.value,1)+' GB':'¥'+fmt(row.value,2));
    const delta=row.delta===null?'不可比较':row.delta===0?'未变化':(row.delta>0?'+':'−')+fmt(Math.abs(row.delta),row.metric==='whale'?1:2)+(row.metric==='whale'?' GB':' 元');
    const vals=[time(row.providerAt,true),value,delta,mode==='demo'?'FIXTURE 示例':`${sourceNames[row.source]||'未知'} · ${status(row.state)}${row.estimated?' · 估算':''}`];
    if(full)vals.push(time(row.observedAt,true));
    vals.forEach((v,i)=>{const td=document.createElement('td');td.textContent=v;if(i===1||i===2)td.className='numeric';if(i===2)td.classList.add(row.delta>0?'change-up':'change-down');tr.append(td);});body.append(tr);
  }
}
function renderQuality(snapshot,records){
  const metrics=snapshot.metrics||{},selected=['power','card'].map(k=>metrics[k]),available=selected.filter(metricValid).length,live=selected.filter(m=>metricValid(m)&&m.sourceState==='live').length;
  $('qualityTitle').textContent=mode==='demo'?'示例数据，不参与真实记录':`${available} / 2 项有有效值，${live} 项标记为实时`;
  $('qualitySummary').textContent=mode==='demo'?'当前指标、走势图和记录均为 FIXTURE。':'状态沿用 provider 原始语义，不把读取时间冒充数据更新时间；缓存值可看，不能冒充实时。';
  $('checkedAt').textContent=mode==='demo'?'FIXTURE':`本机读取 ${time(snapshot.checkedAt,true)}`;
  const body=$('qualityRows');body.replaceChildren();
  for(const key of ['power','card']){
    const m=metrics[key],tr=document.createElement('tr');const source=mode==='demo'?'示例':(sourceNames[snapshot.sources?.[key]]||'未获取');
    for(const text of [labels[key],source,status(m?.sourceState),time(m?.updatedAt,true),metricValid(m)?'有有效值':'未获取']){const td=document.createElement('td');td.textContent=text;tr.append(td);}body.append(tr);
  }
}
function render(){
  const {snapshot,records}=dataset(),metrics=snapshot.metrics||{},filtered=filterRecords(records,range),rows=rowsFor(filtered);
  document.querySelectorAll('.page-view').forEach(el=>{el.hidden=el.id!=='view-'+view;});
  document.querySelectorAll('[data-view]').forEach(a=>{a.classList.toggle('active',a.dataset.view===view);a.setAttribute('href','?'+new URLSearchParams({view:a.dataset.view,mode,range}));if(a.closest('nav'))a.setAttribute('aria-current',a.dataset.view===view?'page':'false');});
  $('pageTitle').textContent=pageNames[view];$('pageTitle').tabIndex=-1;$('crumb').textContent=pageNames[view];
  const descriptions={overview:'电费和校园卡分开看记录，保留原 Dashboard 的校园板块。',records:'电费与校园卡分板块保存。',quality:'分别查看电费与校园卡的来源和数据状态。'};
  $('pageDesc').textContent=`${descriptions[view]} · 近 ${range} 天（截至最后样本）`;
  document.title=`${pageNames[view]} · 近${range}天 · 校园余额`;
  document.querySelectorAll('[data-mode]').forEach(b=>{b.classList.toggle('selected',b.dataset.mode===mode);b.setAttribute('aria-pressed',String(b.dataset.mode===mode));});
  document.querySelectorAll('[data-range]').forEach(b=>{b.classList.toggle('selected',Number(b.dataset.range)===range);b.setAttribute('aria-pressed',String(Number(b.dataset.range)===range));});
  document.querySelectorAll('.fixture-marker').forEach(e=>{e.textContent=mode==='demo'?'FIXTURE':'真实样本';});
  $('modeNotice').textContent=mode==='demo'?'FIXTURE · 以下均为示例':!hasRead?'正在读取…':snapshot.connected?'个人学校接口查询':'查询暂不可用 · 保留旧值';
  $('footerMode').textContent=mode==='demo'?'示例模式 · 不写入真实记录':'真实模式 · 校园余额独立记录';
  $('navCount').textContent=String(records.length);$('exportButton').innerHTML='<svg><use href="#download"/></svg>'+(mode==='demo'?'导出示例记录':'导出真实记录');
  $('recordButton').disabled=busy||mode==='demo';$('recordButton').textContent=busy?'正在读取…':mode==='demo'?'真实模式可记录':'记录校园余额';
  $('refreshButton').disabled=busy;$('autoButton').hidden=true;
  $('powerValue').textContent=metricValid(metrics.power)?'¥'+fmt(metrics.power.value,2):'--';$('cardValue').textContent=metricValid(metrics.card)?'¥'+fmt(metrics.card.value,2):'--';
  statusChip('campusStatus',metrics.power);$('campusUpdated').textContent=`${sourceNames[snapshot.sources?.power]||'未获取'} · 更新 ${mode==='demo'?'示例时间':time(metrics.power?.updatedAt,true)} · 查询 ${mode==='demo'?'演示':time(metrics.power?.fetchedAt,true)}`;
  for(const key of ['power','card']){
    $(key+'Narrative').textContent=`近 ${range} 天，记录内累计减少 ¥${sumLabel(filtered,key)}。`;
    chart(key+'Chart',[{label:key==='power'?'电费':'校园卡',color:key==='power'?'var(--amber)':'var(--violet)',points:dailyData(filtered,key)}],{unit:'CNY'});
    $(key+'Coverage').textContent=`${filtered.filter(r=>r.metric===key).length} 条样本 · 缺测不补点`;
    fillTable(key==='power'?'recentPowerRows':'recentCardRows',rows.filter(r=>r.metric===key).slice(0,3));
  }
  const powerRows=rows.filter(r=>r.metric==='power'),cardRows=rows.filter(r=>r.metric==='card');
  const pages=Math.max(1,Math.ceil(Math.max(powerRows.length,cardRows.length)/pageSize));page=Math.min(page,pages-1);
  fillTable('powerRows',powerRows.slice(page*pageSize,(page+1)*pageSize),true);fillTable('cardRows',cardRows.slice(page*pageSize,(page+1)*pageSize),true);
  $('powerRecordCount').textContent=powerRows.length+' 条';$('cardRecordCount').textContent=cardRows.length+' 条';
  $('pageInfo').textContent=`电费 ${powerRows.length} 条 · 校园卡 ${cardRows.length} 条 · 第 ${page+1} / ${pages} 页`;$('prevPage').disabled=page===0;$('nextPage').disabled=page>=pages-1;
  $('journalTitle').textContent='电费与校园卡，分别记录';
  $('journalSummary').textContent=`近 ${range} 天，电费 ${powerRows.length} 条、校园卡 ${cardRows.length} 条。`;
  renderQuality(snapshot,filtered);
}
async function request(path,method='GET'){
  const response=await fetch(path,{method,cache:'no-store',signal:AbortSignal.timeout(8500)});if(!response.ok)throw new Error('request failed');return response.json();
}
function markDisconnected(){real=structuredClone(real);real.connected=false;for(const m of Object.values(real.metrics||{}))m.sourceState='offline';}
async function refresh(){
  if(busy)return;busy=true;render();
  try{const [snap,log]=await Promise.all([request('/api/current'),request('/api/history')]);
    if(snap.connected)real=mergeSnapshot(real,snap);else{markDisconnected();real.checkedAt=snap.checkedAt;}
    history=Array.isArray(log.records)?log.records:[];hasRead=true;
  }catch{markDisconnected();hasRead=true;$('actionStatus').textContent='读取失败；请检查本机服务，已保留上次有效数据。';}
  finally{busy=false;render();}
}
async function record(){
  if(mode!=='real'||busy)return;busy=true;render();$('actionStatus').textContent='正在读取真实校园余额快照…';
  try{const data=await request('/api/record','POST');real=mergeSnapshot(real,data.snapshot);history=data.records;hasRead=true;$('actionStatus').textContent=data.added?`已新增 ${data.added} 条真实校园余额样本。`:'没有新样本；重复数据、缺少真实时间或不可用数据不会新增记录。';}
  catch{$('actionStatus').textContent='记录失败；请检查本机服务连接。未修改设备配置。';}
  finally{busy=false;render();}
}
document.querySelectorAll('[data-view]').forEach(a=>a.addEventListener('click',e=>{if(e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();go(a.dataset.view);}));
document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{mode=b.dataset.mode;if(mode==='demo')recording=false;page=0;$('actionStatus').textContent='';pushURL();render();if(mode==='real')refresh();});
document.querySelectorAll('[data-range]').forEach(b=>b.onclick=()=>{range=Number(b.dataset.range);page=0;pushURL();render();});
$('resetButton').onclick=()=>{range=7;page=0;pushURL();render();};
$('refreshButton').onclick=()=>mode==='real'?refresh():($('actionStatus').textContent='当前是固定示例数据。切换真实模式后可读取已有数据源。');
$('recordButton').onclick=record;$('autoButton').onclick=()=>{if(mode!=='real')return;recording=!recording;$('actionStatus').textContent=recording?'已开始本页面采集；关闭页面会停止，仅保存预览账本。':'自动记录已停止。';render();if(recording)record();};
$('prevPage').onclick=()=>{page=Math.max(0,page-1);render();};$('nextPage').onclick=()=>{page++;render();};
$('helpButton').onclick=()=>$('helpDialog').showModal();$('closeHelp').onclick=()=>$('helpDialog').close();
$('themeButton').onclick=()=>{const theme=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=theme;document.querySelector('meta[name="theme-color"]').content=theme==='dark'?'#111419':'#f7f8fa';$('themeButton').setAttribute('aria-label',theme==='dark'?'切换浅色模式':'切换深色模式');try{localStorage.setItem('beam-dashboard-preview-theme',theme);}catch{}};
$('exportButton').onclick=()=>{
  const records=filterRecords(dataset().records,range).filter(r=>['power','card'].includes(r.metric));
  const fields=['dataset','metric','value','unit','providerAt','observedAt','source','state','estimated'];
  const safeCell=value=>'"'+String(value??'').replace(/"/g,'""').replace(/^[=+@-]/,"'")+'"';
  const csv='\ufeff'+[fields.join(','),...records.map(r=>fields.map(f=>safeCell(f==='dataset'?mode==='demo'?'FIXTURE':'REAL':r[f])).join(','))].join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`校园余额-${mode==='demo'?'FIXTURE':'real'}-${range}d.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$('actionStatus').textContent=`已导出 ${records.length} 条${mode==='demo'?'示例':'真实'}记录。`;
};
const tooltip=document.createElement('div');tooltip.className='data-tooltip';tooltip.hidden=true;document.body.append(tooltip);
function showTip(el,x,y){if(!el?.dataset.tip)return;tooltip.textContent=el.dataset.tip;tooltip.hidden=false;tooltip.style.left=Math.min(window.innerWidth-180,Math.max(8,x+12))+'px';tooltip.style.top=Math.max(8,y-62)+'px';}
document.addEventListener('pointermove',e=>{const el=e.target.closest('[data-tip]');if(el)showTip(el,e.clientX,e.clientY);else tooltip.hidden=true;});
document.addEventListener('focusin',e=>{if(e.target.dataset.tip)showTip(e.target,window.innerWidth/2,window.innerHeight/2);});document.addEventListener('focusout',()=>{tooltip.hidden=true;});
window.addEventListener('popstate',()=>{parseURL();page=0;render();if(mode==='real'&&!hasRead)refresh();});
try{const saved=localStorage.getItem('beam-dashboard-preview-theme');if(saved==='dark')document.documentElement.dataset.theme='dark';}catch{}
document.querySelector('.preview-label').textContent='校园余额 · GDBTU';
document.querySelector('.sidebar-note').innerHTML='<span class="tiny-dot"></span>个人查询工作区<p>不依赖 ESP32 设备</p>';
$('autoNote').textContent='服务运行时每 20 分钟检查；有学校时间才记录。';
parseURL();render();if(mode==='real')refresh();
setInterval(()=>{if(mode==='real'&&!document.hidden)refresh();},60000);
