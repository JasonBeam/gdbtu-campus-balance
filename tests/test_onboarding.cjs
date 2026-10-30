const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=require('../tools/onboarding-core.js');
const source=fs.readFileSync('scriptable/校园余额.js','utf8');
const navigation=fs.readFileSync('tools/onboarding/portal-noise-filter.js','utf8')+'\n'+fs.readFileSync('tools/onboarding/official-login.js','utf8');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const cfg={syscustid:'fixture-user',acc_token:'fixture-token',areacode:'fixture-school',buildingID:'fixture-room',custid:'fixture-card',meterID:'own-meter',dormRoom:'2栋504'};
async function load(overrides={}){
 const storage=new Map(),calls=[],notices=[],timerIntervals=[],panels=[];let webViews=0;
 const Keychain={contains:k=>storage.has(k),get:k=>storage.get(k),set:(k,v)=>storage.set(k,v)};
 class Alert{addAction(){} addCancelAction(){} async presentAlert(){notices.push(this.title);return 0;} async presentSheet(){return this.title==='选择自己的电表'?1:0;}}
 class Request{
  constructor(url){this.url=url;this.response={statusCode:200};}
  async loadJSON(){const b=JSON.parse(this.body);calls.push(b);
   if(b.server==='/api/getBuildingInfo'){
    const graph={root:[['campus','示例校区']],campus:[['building','2栋']],building:[['floor','5楼']],floor:[['room','504']],room:[]};
    return {code:0,data:(graph[b.buildingID||'root']||[]).map(([id,name])=>({buildingID:id,buildingName:name}))};
   }
   if(b.server==='/api/getMeterStatus')return {code:0,data:[{comAddress:'other-meter',piplineName:'2栋505',leftMoney:'99'},{comAddress:'own-meter',piplineName:'2栋504',leftMoney:overrides.missingPowerBalance?null:'42',remaining:'60'}]};
   if(this.url.includes('loginBySysId'))return {code:0,data:{syscustid:cfg.syscustid}};
   return {code:0,data:'12.34'};
  }
 }
 class WebView{
  constructor(){webViews++;}
  async loadHTML(html){
   assert(!html.includes(cfg.acc_token),'credentials must never enter the local panel');
   if(html.includes('window.__campusPanel=true')){
    this.panel=JSON.parse(html.match(/const data=(.*);window.__campusPanel=true/)[1]);panels.push(this.panel);
    if(['已保存','已取消','连接未完成','配置已保存'].includes(this.panel.title))this.close();
    if(overrides.closeOnPanel===this.panel.title)this.close();
   }else assert(html.includes('正在连接学校'));
  }
  async loadURL(url){assert(url.startsWith('https://cas.gdbtu.edu.cn/cas/login?service='));}
  present(){return new Promise(r=>this.close=r);}
  async evaluateJavaScript(script){
   if(script===navigation)return {stage:'ready',config:{...cfg,buildingID:'',meterID:''}};
   if(script.includes('window.__campusPanel===true'))return overrides.panelChoice?overrides.panelChoice(this.panel):this.panel.title==='选择自己的电表'?1:0;
   this.close();return null;
  }
 }
 const module={exports:{}};
 // Match Scriptable's millisecond API; accelerate wall time only after recording it.
 const env={module,Keychain,Request,Alert,WebView,Timer:{schedule:(milliseconds,repeat,fn)=>{timerIntervals.push(milliseconds);const id=setTimeout(fn,milliseconds/100);return {invalidate:()=>clearTimeout(id)};}},...overrides};
 await new AsyncFunction(...Object.keys(env),source)(...Object.values(env));
 return {api:module.exports,storage,calls,notices,Keychain,timerIntervals,panels,webViews:()=>webViews};
}
(async()=>{
 const a=core.address('示例校区2栋3号5层504房');assert.equal(a.shortRoom,'2栋504');assert.equal(core.address('2栋504'),null);
 assert.throws(()=>core.cleanConfig({...cfg,acc_token:'bad\nheader'}));assert.throws(()=>core.cleanConfig({...cfg,meterID:42}));
 const graph={root:[['campus','示例校区']],campus:[['a','兰香公寓'],['b','半山公寓']],a:[['a2','2栋']],b:[['b2','2栋']],a2:[['a5','5楼']],b2:[['b5','5楼']],a5:[['ar','504']],b5:[['br','504']],ar:[],br:[]};
 const paths=await core.resolve(a,async parent=>(graph[parent||'root']||[]).map(([id,name])=>({id,name})));
 assert.equal(paths.length,2);assert.deepEqual(paths.map(p=>p.at(-1).id),['ar','br']);
 let count=0;await assert.rejects(()=>core.resolve(a,async parent=>{count++;return parent?[{id:'campus',name:'任意公寓'}]:[{id:'campus',name:'示例校区'}];}));assert(count<10);
 assert.throws(()=>core.options([{buildingID:'a',buildingName:'A'},{buildingID:'a',buildingName:'B'}]));
 assert.deepEqual(core.ownMeters([{comAddress:'x',piplineName:'12栋504'},{comAddress:'y',piplineName:'2栋504'}],a).map(x=>x.comAddress),['y']);
 const ctx={location:{origin:'https://evil.example'},document:{querySelector:()=>null,querySelectorAll:()=>{throw Error('must not inspect foreign page');}}};
 assert.equal(vm.runInNewContext(navigation,ctx).stage,'unsupported-origin');
 ctx.location.origin='https://cas.gdbtu.edu.cn';assert.equal(vm.runInNewContext(navigation,ctx).stage,'login');
 const styles=[];
 const loginPage={location:{origin:'https://cas.gdbtu.edu.cn'},document:{querySelector:()=>({}),getElementById:()=>styles[0],createElement:()=>({}),head:{appendChild:node=>styles.push(node)}}};
 assert.equal(vm.runInNewContext(navigation,loginPage).stage,'login');
 assert.equal(vm.runInNewContext(navigation,loginPage).stage,'login');assert.equal(styles.length,1);
 assert(styles[0].textContent.includes('.mobile .login-form .el-input__inner'));
 assert(!/input[^{}]*\{[^}]*display\s*:\s*none/.test(styles[0].textContent));
 // Only the three observed portal messages are filtered, across console and
 // browser error forwarding. Unknown/auth errors and other origins stay visible.
 const logs=[],handlers={};
 const portal={location:{origin:'https://portal.gdbtu.edu.cn'},document:{querySelectorAll:()=>[]},
  console:{error:(...args)=>logs.push(args)},logError:(...args)=>logs.push(args),
  addEventListener:(name,fn)=>handlers[name]=fn};portal.window=portal;
 assert.equal(vm.runInNewContext(navigation,portal).stage,'waiting-portal');
 const wrapped=portal.console.error;vm.runInNewContext(navigation,portal);assert.equal(portal.console.error,wrapped);
 portal.console.error=(...args)=>logs.push(args);vm.runInNewContext(navigation,portal);
 for(const text of ['请求日程错误!',"TypeError: undefined is not an object (evaluating 't.bookList.shouldRepayList.length')","undefined is not an object (evaluating 't.personalInfo.attributes.userName')"]){
  portal.console.error(text);portal.logError({message:text});
  for(const name of ['error','unhandledrejection']){let prevented=false,stopped=false;handlers[name]({error:{message:text},preventDefault:()=>prevented=true,stopImmediatePropagation:()=>stopped=true});assert(prevented&&stopped);}
 }
 assert.equal(logs.length,0);
 assert(portal.__balancePortalIssues['portal-profile']>0);assert(portal.__balancePortalIssues['portal-books']>0);assert(portal.__balancePortalIssues['portal-schedule']>0);
 // Replacing a bridge after polling must still filter the observed messages.
 portal.logError=(...args)=>logs.push(args);
 portal.logError('请求日程错误！');
 portal.console.error("TypeError: undefined is not an object (evaluating 't.bookList.shouldRepayList.length')\nrender@https://portal.gdbtu.edu.cn/js/app.js:1:2");
 portal.logError("TypeError: undefined is not an object (evaluating 't.personalInfo.attributes.userName')",'请求日程错误!');
 assert.equal(logs.length,0);
 const unknown=new Error('校园登录已失效');portal.console.error(unknown);portal.logError('network timeout');
 portal.console.error('请求日程错误!','other failure');assert.equal(logs.length,3);assert.equal(logs[0][0],unknown);
 handlers.error({message:'校园登录已失效',preventDefault:()=>assert.fail('auth errors must remain visible'),stopImmediatePropagation:()=>assert.fail()});
 const wallet={...portal,location:{origin:'https://ecykt.gdbtu.edu.cn'},localStorage:{getItem:()=>null}};
 wallet.window={console:{error:()=>{}},addEventListener:()=>assert.fail('must not filter wallet')};
 vm.runInNewContext(navigation,wallet);assert.equal(wallet.window.__balancePortalNoiseFilter,undefined);
 const r=await load();r.api.saveConfiguration(cfg);
 const first=await r.api.snapshot();assert.equal(first.metrics.power.value,42);assert.equal(first.metrics.card.value,12.34);assert(!JSON.stringify(first).includes(cfg.acc_token));
 r.api.saveConfiguration({...cfg,syscustid:'other-user',meterID:'missing'});
 const next=await r.api.snapshot();assert.equal(next.metrics.power.value,null);assert.equal(next.metrics.power.state,'unavailable');assert.equal(next.metrics.card.value,12.34);
 assert.throws(()=>r.api.saveConfiguration({...cfg,acc_token:''}));assert.equal(r.api.currentConfig().syscustid,'other-user');
 const failing=await load();failing.api.saveConfiguration(cfg);
 failing.Keychain.set=()=>{throw Error('disk full');};assert.throws(()=>failing.api.saveConfiguration({...cfg,syscustid:'new-user'}));assert.equal(failing.api.currentConfig().syscustid,cfg.syscustid);
 const login=await r.api.officialLogin();assert.equal(login.syscustid,cfg.syscustid);assert.equal(login.acc_token,cfg.acc_token);
 assert.deepEqual(r.timerIntervals.slice(0,4),[400,5000,400,30000]);
 // A non-instant HTML load must finish before the 5-second deadline. With the old
 // seconds conversion the accelerated deadline was 0.05ms and this rejected.
 class DelayedHTMLView {
  async loadHTML(){await new Promise(resolve=>setTimeout(resolve,20));}
  async loadURL(){} present(){return new Promise(resolve=>this.close=resolve);}
  async evaluateJavaScript(script){if(script===navigation)return {stage:'ready',config:cfg};this.close();}
 }
 const delayed=await load({WebView:DelayedHTMLView});assert.equal((await delayed.api.officialLogin()).syscustid,cfg.syscustid);
 const connected=await load();let previews=0;await connected.api.connectSchool(async()=>{previews++;});
 assert.equal(previews,1);assert.equal(connected.api.currentConfig().meterID,'own-meter');
 assert.equal(connected.api.currentConfig().buildingID,'room');assert.equal((await connected.api.snapshot()).metrics.power.value,42);
 assert.equal(connected.webViews(),1,'login and all meter/save steps share one presented WebView');
 assert(connected.panels.some(p=>p.title==='选择校区'));assert(connected.panels.some(p=>p.title==='确认保存'));
 assert(connected.panels.at(-1).message.includes('42.00'));assert(!connected.notices.length,'no stacked native alerts during inline flow');
 const matched=await r.api.matchMeter({...cfg,portalDormAddress:'示例校区2栋3号5层504房'});assert.equal(matched.meterID,'own-meter');
 const cancelled=await load({panelChoice:panel=>panel.title==='确认保存'?1:panel.title==='选择自己的电表'?1:0});cancelled.api.saveConfiguration({...cfg,syscustid:'previous-user'});
 await cancelled.api.connectSchool(async()=>{throw Error('must not preview after cancellation');});assert.equal(cancelled.api.currentConfig().syscustid,'previous-user');
 const closeDuringSetup=await load({closeOnPanel:'选择校区'});closeDuringSetup.api.saveConfiguration({...cfg,syscustid:'previous-user'});
 await closeDuringSetup.api.connectSchool(async()=>assert.fail('must not preview when dismissed'));
 assert.equal(closeDuringSetup.api.currentConfig().syscustid,'previous-user');
 const missingPower=await load({missingPowerBalance:true});await missingPower.api.connectSchool(async()=>{});
 assert(missingPower.panels.at(-1).message.includes('学校没有返回有效余额'));
 assert(!missingPower.panels.at(-1).message.includes('电费 0.00'));
 assert.equal(missingPower.storage.get('gdbtu_public_v1_onboardingFailure'),'balance-missing');
 // Slow loadURL must not block presentation, and dismissal must not trigger evaluation.
 class SlowView{
  async loadHTML(){}
  loadURL(){return new Promise(()=>{});}
  present(){return new Promise(r=>this.close=r);}
  async evaluateJavaScript(s){assert(!this.closed,'no evaluation after Close');if(s===navigation)return {stage:'ready',config:cfg};this.closed=true;this.close();}
 }
 const slow=await load({WebView:SlowView});assert.equal((await slow.api.officialLogin()).syscustid,cfg.syscustid);
 // Reject account changes between automatic capture and closing the official view.
 let reads=0;
 class ChangedView{
  async loadHTML(){if(this.close)this.close();}
  async loadURL(){} present(){return new Promise(r=>this.close=r);}
  async evaluateJavaScript(s){if(s===navigation){reads++;return {stage:'ready',config:{...cfg,syscustid:reads>3?'changed':cfg.syscustid}};}}
 }
 const changed=await load({WebView:ChangedView});await assert.rejects(()=>changed.api.officialLogin());assert.equal(changed.storage.has('gdbtu_public_v1_configuration.v2'),false);
 reads=0;const changedInline=await load({WebView:ChangedView});changedInline.api.saveConfiguration({...cfg,syscustid:'previous-user'});
 await changedInline.api.connectSchool(async()=>assert.fail('changed identity must not save'));
 assert.equal(changedInline.api.currentConfig().syscustid,'previous-user');
 // A stale first wallet snapshot can change while the page initializes; it must
 // stabilize before the banner rather than being mistaken for an account switch.
 let hydrationReads=0,bannerAt=0;
 class HydratingView{
  async loadHTML(){} async loadURL(){} present(){return new Promise(r=>this.close=r);}
  async evaluateJavaScript(s){if(s===navigation){hydrationReads++;return {stage:'ready',config:{...cfg,syscustid:hydrationReads===1?'stale':cfg.syscustid}};}bannerAt=hydrationReads;this.close();}
 }
 const hydrated=await load({WebView:HydratingView});assert.equal((await hydrated.api.officialLogin()).syscustid,cfg.syscustid);assert.equal(bannerAt,4);
 // A failed network load must become a readable local error page, not endless white.
 class FailedView{
  async loadHTML(html){if(this.close){assert(html.includes('暂时未能连接'));this.close();}}
  async loadURL(){throw Error('network details must remain private');}
  present(){return new Promise(r=>this.close=r);}
  async evaluateJavaScript(){return {stage:'unsupported-origin'};}
 }
 const failed=await load({WebView:FailedView});failed.api.saveConfiguration(cfg);
 await assert.rejects(()=>failed.api.officialLogin());assert.equal(failed.api.currentConfig().syscustid,cfg.syscustid);
 assert.equal(JSON.parse(failed.storage.get('gdbtu_public_v1_onboardingStatus')).stage,'学校网页加载失败');
 class ClosedView{
  async loadHTML(){} present(){return Promise.resolve();}
  loadURL(){throw Error('must not load after cancellation');}
 }
 const closed=await load({WebView:ClosedView});await assert.rejects(()=>closed.api.officialLogin());
 console.log('Onboarding: official-origin guard, bounded exact dorm matching, ambiguity, meter identity, atomic config, cache isolation and account-switch cancellation: PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
