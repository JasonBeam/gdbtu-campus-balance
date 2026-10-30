// Single-script setup. These helpers are embedded by tools/sync_onboarding.py.
const SCRIPT_VERSION='0.2.0-candidate8';
const OFFICIAL_LOGIN = 'https://cas.gdbtu.edu.cn/cas/login?service='+encodeURIComponent('https://portal.gdbtu.edu.cn/?path=https%3A%2F%2Fportal.gdbtu.edu.cn%2Fmain.html%23%2FStudent');
function currentConfig(){
  const packed=read('configuration.v2');
  if(packed){try{return OnboardingCore.cleanConfig(JSON.parse(packed));}catch{throw Error('已保存的配置无法读取，请重新登录学校；旧配置仍保留。');}}
  return Object.fromEntries(FIELDS.map(k=>[k,read(k)]));
}
function saveConfiguration(input){
  const cfg=OnboardingCore.cleanConfig(input);
  // One Keychain entry commits the full new account and room together.
  // The cache carries an owner, so interrupted cleanup cannot show another account.
  write('configuration.v2',JSON.stringify(cfg));
  return cfg;
}
// Scriptable Timer.schedule takes milliseconds, matching the deadlines below.
const pauseFor=ms=>new Promise(resolve=>Timer.schedule(ms,false,resolve));
async function choice(title,message,items){
  const alert=new Alert();alert.title=title;alert.message=message;
  items.forEach(label=>alert.addAction(label));alert.addCancelAction('取消');
  return await alert.presentSheet();
}
async function notice(title,message){const alert=new Alert();alert.title=title;alert.message=message;alert.addAction('知道了');await alert.presentAlert();}
function connectionStage(stage){write('onboardingStatus',JSON.stringify({stage,at:Date.now()}));}
function connectionFailure(error){
  const failures={
    '学校接口连接或解析失败':['network-or-response','学校接口连接或解析失败，请稍后重试。'],
    '学校接口暂时不可用':['http-status','学校接口暂时不可用，请稍后重试。'],
    '学校接口拒绝请求，请核对参数或更新登录凭据':['api-rejected','学校接口拒绝了查询，请重新登录后重试。'],
    '登录凭据已失效，请更新 acc_token':['session-expired','校园会话已失效，请重新登录。'],
    '接口未返回有效余额':['balance-missing','学校没有返回有效余额。'],
    '绑定电表已变化，请重新选择宿舍':['meter-changed','绑定电表已变化，请重新选择宿舍。']
  };
  const value=failures[error?.message]||['unexpected','暂未完成，请稍后重试。'];
  write('onboardingFailure',value[0]);return value[1];
}
// Give Scriptable time to dismiss the previous native sheet before presenting another.
// All loading starts from an already-rendered local page, not an empty WebView.
const LOGIN_LOADING_HTML = '<!doctype html><html lang="zh"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html{font:17px -apple-system,sans-serif;color:#20252c;background:#f4f5f8}main{padding:32px 24px}p{line-height:1.7;color:#515b69}</style><main><h2>正在连接学校</h2><p>请填写校园账号和密码，认证仍由学校完成。登录后自动读取校园卡并核对宿舍；可随时点顶部 Close／关闭返回。</p></main></html>';
function within(promise,ms){
  let timer;
  return Promise.race([promise,new Promise((_,reject)=>{timer=Timer.schedule(ms,false,()=>reject(Error('deadline')));})])
    .finally(()=>timer?.invalidate?.());
}
function evaluateSchoolPage(web,script){return web.evaluateJavaScript(PORTAL_ERROR_FILTER+'\n'+script);}
async function officialLogin(connected=null){
  connectionStage('准备学校登录');
  write('onboardingPortalIssues','{}');
  write('onboardingFailure','');
  // The main menu is already the user's explicit login choice; do not stack another Alert.
  await pauseFor(400);
  const web=new WebView();
  await within(web.loadHTML(LOGIN_LOADING_HTML),5000);
  let closed=false,dorm='',ready=null,pending=null,stableReads=0,lastState=null,lastChecked=0,identityChanged=false;
  let loadFailed=false,loadFinished=false,schoolObserved=false,failureStage='';
  web.shouldAllowRequest=()=>!closed;
  connectionStage('显示学校登录');
  const presented=web.present(false).then(()=>{closed=true;},()=>{closed=true;});
  await pauseFor(400);
  if(closed)throw Error('已取消学校登录');
  connectionStage('加载学校网页');
  // Observe the rejection, without an unhandled or forever-awaited load promise.
  within(web.loadURL(OFFICIAL_LOGIN),30000).then(()=>{loadFinished=true;},()=>{loadFailed=true;});
  const until=Date.now()+10*60*1000;
  while(!closed&&Date.now()<until){
    if(loadFailed&&!schoolObserved){failureStage='学校网页加载失败';break;}
    try{
      const result=await Promise.race([
        within(evaluateSchoolPage(web,OFFICIAL_NAVIGATION),5000).then(state=>({state})),
        presented.then(()=>({closed:true}))
      ]);
      if(result.closed)break;
      const state=result.state;
      if(state?.portalIssues){const codes={};for(const key of ['portal-profile','portal-books','portal-schedule'])if(Number.isInteger(state.portalIssues[key]))codes[key]=Math.max(0,Math.min(999,state.portalIssues[key]));write('onboardingPortalIssues',JSON.stringify(codes));}
      if(state?.stage && state.stage!=='unsupported-origin')schoolObserved=true;
      lastState=state;lastChecked=Date.now();
      if(state?.stage==='login'){dorm='';connectionStage('等待学校登录');}
      if(state?.stage==='profile'){
        dorm=state.address;connectionStage('读取门户宿舍');
        await within(evaluateSchoolPage(web,'if(location.origin==="https://portal.gdbtu.edu.cn") window.__balanceDormAcknowledged='+JSON.stringify(dorm)),5000);
      }
      if(state?.stage==='opening-wallet'||state?.stage==='waiting-wallet')connectionStage('读取校园钱包');
      if(state?.stage==='ready'){
        const current=OnboardingCore.cleanConfig({...state.config,portalDormAddress:dorm});
        if(ready&&(current.syscustid!==ready.syscustid||current.areacode!==ready.areacode)){identityChanged=true;failureStage='登录账号发生变化';break;}
        if(!ready){
          // The wallet can briefly expose stale data while initializing. Require
          // three consecutive matching snapshots before enabling confirmation.
          const same=pending&&['syscustid','areacode','acc_token','custid'].every(k=>pending[k]===current[k]);
          stableReads=same?stableReads+1:1;pending=current;
          if(stableReads>=3){
            ready=current;connectionStage(connected?'校验校园会话':'等待关闭登录页');
            if(!connected)await within(evaluateSchoolPage(web,`if(location.origin==='https://ecykt.gdbtu.edu.cn'&&!document.getElementById('campus-ready-banner')){const b=document.createElement('div');b.id='campus-ready-banner';b.textContent='校园信息已就绪 · 点顶部 Close／关闭，继续匹配宿舍';b.style.cssText='position:fixed;bottom:20px;left:16px;right:16px;z-index:2147483647;padding:18px;border-radius:16px;background:#175eca;color:white;font:16px system-ui;text-align:center';document.body.append(b);}`),5000);
          }
        }
      }else if(!ready){pending=null;stableReads=0;}
    }catch{
      lastState=null;
      if(loadFinished&&!closed)connectionStage('等待页面响应');
    }
    if(ready&&connected)break;
    if(!closed)await pauseFor(500);
  }
  if(ready&&connected&&!closed){
    // Validate once more before replacing the remote document with our local UI.
    let latest;
    try{latest=await within(evaluateSchoolPage(web,OFFICIAL_NAVIGATION),5000);}catch{}
    if(!closed&&latest?.stage==='ready'&&latest.config.syscustid===ready.syscustid&&latest.config.areacode===ready.areacode){
      const cfg=OnboardingCore.cleanConfig({...latest.config,portalDormAddress:dorm});
      return await connected(cfg,web,()=>closed,presented);
    }
    failureStage='校园会话已变化，请重新登录';
  }
  if(!closed){
    failureStage=failureStage||'登录等待超时';connectionStage(failureStage);
    // Replace endless white/loading content with an offline, account-free explanation.
    try{await within(web.loadHTML('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><main style="padding:28px;font:17px -apple-system;line-height:1.7"><h2>暂时未能连接</h2><p>请点顶部 Close／关闭返回，再到「更多工具 → 导出连接诊断」查看停在哪一步。原有配置仍保留。</p></main>'),5000);}catch{}
  }
  await presented;
  if(failureStage){connectionStage(failureStage);throw Error('学校登录未完成');}
  connectionStage('校验登录返回');
  if(!ready)throw Error('尚未读取到校园登录，请等校园信息就绪后再点 Close／关闭');
  if(identityChanged||lastState?.stage!=='ready'||Date.now()-lastChecked>2000||lastState.config.syscustid!==ready.syscustid||lastState.config.areacode!==ready.areacode)throw Error('登录账号或页面已变化，请重新获取校园信息');
  return OnboardingCore.cleanConfig({...lastState.config,portalDormAddress:dorm});
}
async function exportConnectionDiagnostics(){
  let stage='尚未连接',at=null;
  try{const value=JSON.parse(read('onboardingStatus'));stage=String(value.stage).slice(0,40);at=value.at;}catch{}
  const report={schema:1,scriptVersion:SCRIPT_VERSION,stage,at,configurationSaved:!!read('configuration.v2')};
  const failure=read('onboardingFailure');if(['network-or-response','http-status','api-rejected','session-expired','balance-missing','meter-changed','unexpected'].includes(failure))report.failure=failure;
  try{const issues=JSON.parse(read('onboardingPortalIssues'));report.portalIssues={};for(const key of ['portal-profile','portal-books','portal-schedule'])if(Number.isInteger(issues[key]))report.portalIssues[key]=Math.max(0,Math.min(999,issues[key]));}catch{}
  await DocumentPicker.exportString(JSON.stringify(report,null,2),'campus-balance-diagnostics.json');
}

async function readBuildings(cfg,parent){
  const rows=await post(PATHS.power,{server:'/api/getBuildingInfo',areacode:cfg.areacode,...(parent?{buildingID:parent}:{})},cfg,true);
  return OnboardingCore.options(rows);
}
async function readMeters(cfg,building){
  const rows=await post(PATHS.power,{server:'/api/getMeterStatus',areacode:cfg.areacode,buildingID:building},cfg,true);
  return OnboardingCore.ownMeters(Array.isArray(rows)?rows:[rows],null);
}
async function manualMeter(cfg,choose=choice){
  let parent=null,path=[];
  for(let depth=0;depth<8;depth++){
    const rows=await readBuildings(cfg,parent);
    if(!rows.length){
      if(!parent)throw Error('学校暂未返回宿舍目录');
      const meters=await readMeters(cfg,parent);if(!meters.length)throw Error('该位置暂未返回电表，请重新核对宿舍');
      const selected=meters.length===1?0:await choose('选择自己的电表','请核对房间，不会自动选择第一台。',meters.map(x=>x.piplineName));
      if(selected<0)return null;
      return {buildingID:parent,meterID:meters[selected].comAddress,dormRoom:meters[selected].piplineName};
    }
    if(rows.length>300)throw Error('该层目录过长，请先在学校官方电费页面选择宿舍，再使用原有导入方式');
    const selected=await choose(depth?'选择宿舍位置':'选择校区',path.map(x=>x.name).join(' · ')||'学校未返回完整宿舍地址，请手动选择一次。',rows.map(x=>x.name));
    if(selected<0)return null;const row=rows[selected];path.push(row);parent=row.id;
  }
  throw Error('宿舍目录层级发生变化，请稍后重试');
}
async function matchMeter(cfg,choose=choice){
  const a=OnboardingCore.address(cfg.portalDormAddress);
  if(a){
    const until=Date.now()+90_000;
    const paths=await OnboardingCore.resolve(a,parent=>{if(Date.now()>until)throw Error('自动匹配超时，请手动选择宿舍');return readBuildings(cfg,parent);});
    if(paths.length){
      const n=paths.length===1?0:await choose('确认宿舍公寓',a.shortRoom+' 有同名位置，请确认一次。',paths.map(p=>p.slice(1).map(x=>x.name).join(' · ')));
      if(n<0)return null;
      const path=paths[n],leaf=path[path.length-1];
      const meters=OnboardingCore.ownMeters(await readMeters(cfg,leaf.id),a);
      if(meters.length===1)return {buildingID:leaf.id,meterID:meters[0].comAddress,dormRoom:a.shortRoom};
    }
  }
  return await manualMeter(cfg,choose);
}
async function connectSchool(preview=async()=>{await buildWidget(await snapshot(),'small').presentSmall();}){
  let saved=false;
  try{
    await officialLogin(async(cfg,web,isClosed,presented)=>{
      const panel=inlineOnboardingPanel(web,isClosed,presented);
      try{
        connectionStage('匹配宿舍电表');
        if(!await panel.show('选择宿舍','正在匹配学校登记的宿舍…'))return;
        let meter=null,powerIssue='';
        try{meter=await matchMeter(cfg,panel.choose);}catch(error){powerIssue=connectionFailure(error)+' 可以稍后继续选择宿舍。';}
        if(isClosed())return;
        if(!meter){
          const n=await panel.choose('先连接校园卡？',powerIssue||'你取消了宿舍选择，旧配置尚未改变。',['先连接校园卡','保留旧配置']);
          if(n!==0){if(!isClosed())await panel.show('已取消','原有配置仍保留。可以关闭此页面。');await presented;return;}
        }
        const candidate=OnboardingCore.cleanConfig({...cfg,...(meter||{})});
        connectionStage('查询校园卡');await panel.show('正在查询余额','正在读取校园卡'+(meter?'和宿舍电费':'')+'…');
        const card=await fetchCard(candidate);let power=null,powerError='';
        if(meter){connectionStage('查询宿舍电费');try{power=await fetchPower(candidate);}catch(error){powerError=connectionFailure(error);}}
        if(isClosed())return;
        const summary=`校园卡 ${card.value.toFixed(2)} 元\n${meter?candidate.dormRoom+' · '+(power?'电费 '+power.value.toFixed(2)+' 元':'电费暂未查到：'+powerError):'电表尚未配置'}`;
        connectionStage('等待确认保存');
        const confirm=await panel.choose('确认保存',summary+'\n将更新本脚本的账号和宿舍配置。',['保存配置','取消，保留原配置']);
        if(confirm!==0||isClosed()){if(!isClosed()){await panel.show('已取消','原有配置仍保留。可以关闭此页面。');await presented;}return;}
        connectionStage('保存配置');saveConfiguration(candidate);saved=true;
        const metrics={card:{...card,state:'queried',fetchedAt:new Date().toISOString(),error:null},power:power?{...power,state:'queried',fetchedAt:new Date().toISOString(),error:null}:{value:null,state:'unavailable',error:meter?'电费暂未查到，稍后刷新重试':'请继续选择宿舍电表'}};
        write('cache',JSON.stringify({demo:false,owner:OnboardingCore.owner(candidate),room:candidate.dormRoom,metrics,checkedAt:Date.now()}));
        connectionStage('已完成');await panel.show('已保存',summary+'\n可以关闭此页面，查看小组件。');await presented;
      }catch(error){
        if(!isClosed()){
          let stage='连接校园卡';try{stage=JSON.parse(read('onboardingStatus')).stage;}catch{}
          const detail=connectionFailure(error);
          await panel.show(saved?'配置已保存':'连接未完成',saved?'余额预览暂未完成，请关闭后选择「查看双余额」。':'未完成步骤：'+stage+'。'+detail+' 原配置仍保留。');
          await presented;
        }
      }
    });
    if(saved)await preview();
  }catch{let stage='连接学校';try{stage=JSON.parse(read('onboardingStatus')).stage;}catch{}await notice(saved?'配置已保存':'连接未完成',saved?'可重新运行脚本，选择「查看双余额」。':'未完成步骤：'+stage+'。请重试这一步，原配置仍保留。');}
}
async function chooseMeterForSavedLogin(){
  let saved=false;
  try{
    const cfg=OnboardingCore.cleanConfig(currentConfig()),meter=await matchMeter(cfg);if(!meter)return;
    const candidate={...cfg,...meter},power=await fetchPower(candidate);
    if(await choice('确认电表',candidate.dormRoom+' · 电费 '+power.value.toFixed(2)+' 元',['保存此电表'])!==0)return;
    saveConfiguration(candidate);saved=true;await buildWidget(await snapshot(),'small').presentSmall();
  }catch{await notice(saved?'电表已保存':'暂时无法选择电表',saved?'预览暂未完成，请重新打开「查看双余额」。':'请检查网络和学校登录，必要时先重新登录。旧配置仍保留。');}
}
async function exportOwnConfiguration(){
  try{
    const cfg=OnboardingCore.cleanConfig(currentConfig(),{requirePower:true});
    if(await choice('导出自己的配置','文件包含校园登录凭据，请只交给自己的脚本或电脑面板，不要发群或上传。',['选择保存位置'])!==0)return;
    await DocumentPicker.exportString(JSON.stringify(cfg,null,2),'config.local.json');
  }catch{await notice('未导出','请先完成学校登录和宿舍选择。取消导出不会改变已有配置。');}
}
