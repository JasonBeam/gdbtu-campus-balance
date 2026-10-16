const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const source=fs.readFileSync('tools/export-official-session.js','utf8');
function run(origin,records){
  const alerts=[],nodes=[],downloads=[],storageReads=[];
  class Element{
    constructor(tag){this.tag=tag;this.style={};this.children=[];nodes.push(this);}
    append(...children){this.children.push(...children);}
    click(){if(this.tag==='a')downloads.push(this.download);else this.onclick?.();}
    remove(){}
  }
  const context={location:{origin},alert:t=>alerts.push(t),
    localStorage:{getItem:k=>{storageReads.push(k);return records[k]||null;}},
    navigator:{userAgent:'test-agent',clipboard:{writeText:async value=>{context.copied=JSON.parse(value);}}},
    document:{createElement:t=>new Element(t),getElementById:()=>null,body:new Element('body')},
    Blob:class{},URL:{createObjectURL:()=> 'blob:test',revokeObjectURL:()=>{}},setTimeout:()=>{}};
  vm.runInNewContext(source,context);return {context,alerts,nodes,downloads,storageReads};
}
(async()=>{
  const bad=run('https://example.com',{});assert.equal(bad.alerts.length,1);assert.equal(bad.storageReads.length,0);
  const missing=run('https://ecykt.gdbtu.edu.cn',{});assert.equal(missing.alerts.length,1);
  const records={elecampus_state:JSON.stringify({logintoken:'fixture-token',loginInfo:{syscustid:'fixture-user'},schoolid:'fixture-school',custInfo:{custid:'fixture-card'}}),
    elecampus_state_new_power:JSON.stringify({selInfo:{info:{value:'fixture-leaf',label:'演示宿舍'},fieldValue:'演示校区 / 演示宿舍'}})};
  const ok=run('https://ecykt.gdbtu.edu.cn',records);assert.equal(ok.alerts.length,0);assert(!ok.context.copied);
  assert.deepEqual(ok.storageReads,['elecampus_state','elecampus_state_new_power']);
  assert(!ok.nodes.some(n=>String(n.textContent).includes('fixture-token')));
  await ok.nodes.find(n=>n.textContent==='复制配置').onclick();
  assert.equal(ok.context.copied.buildingID,'fixture-leaf');assert.equal(ok.context.copied.acc_token,'fixture-token');
  assert.equal(ok.context.copied.custid,'fixture-card');
  ok.nodes.find(n=>n.textContent==='保存配置文件').onclick();assert.deepEqual(ok.downloads,['config.local.json']);
  console.log('Official-page export: origin guard, missing fields, exact storage allowlist, masked UI, explicit export: PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
