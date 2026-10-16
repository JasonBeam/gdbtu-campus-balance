// Run ONLY on your own logged-in official H5 page after selecting your room.
// Reads two known storage keys. Makes no network requests. Exports on click.
(() => {
  'use strict';
  if(location.origin!=='https://ecykt.gdbtu.edu.cn'){
    alert('请在已登录的学校官方页面运行此工具。');return;
  }
  let state,power;
  try{
    state=JSON.parse(localStorage.getItem('elecampus_state')||'{}');
    power=JSON.parse(localStorage.getItem('elecampus_state_new_power')||'{}');
  }catch{alert('官方页面缓存无法解析，请重新登录并选择宿舍。');return;}
  const login=state.loginInfo||{}, room=(power.selInfo||{}).info||{};
  const cfg={syscustid:String(login.syscustid||''),acc_token:String(state.logintoken||''),
    areacode:String(state.schoolid||login.areacode||''),buildingID:String(room.value||''),
    custid:String((state.custInfo||{}).custid||login.custid||state.custid||''),userAgent:navigator.userAgent,timestamp:String(login.timestamp||'')};
  const missing=['syscustid','acc_token','areacode','buildingID'].filter(k=>!cfg[k]);
  if(missing.length){alert('缺少 '+missing.join('、')+'。请在同一页面完成官方登录、选择自己的宿舍并成功查看余额后重试。此工具不会绕过登录。');return;}
  if(document.getElementById('gdbtu-export'))return;
  const host=document.createElement('div');host.id='gdbtu-export';
  host.style.cssText='position:fixed;inset:0;z-index:2147483647;background:#0006;display:grid;place-items:center;padding:20px';
  const panel=document.createElement('section');panel.style.cssText='background:#fff;color:#202522;padding:24px;border-radius:20px;max-width:440px;font:15px system-ui;line-height:1.8';
  const title=document.createElement('h2');title.textContent='导出个人查询配置';panel.append(title);
  const desc=document.createElement('p');desc.textContent='当前选择：'+String(power.selInfo.fieldValue||room.label||'已选宿舍')+'。请核对是自己的宿舍。配置含登录凭据，仅保存给自己，不要发群、截图或上传 GitHub。';panel.append(desc);
  const status=document.createElement('p');status.textContent='凭据已隐藏 · 此工具不会发出网络请求';panel.append(status);
  function button(label,fn){const b=document.createElement('button');b.textContent=label;b.style.cssText='min-height:44px;margin:6px;padding:8px 14px';b.onclick=fn;panel.append(b);}
  button('保存配置文件',()=>{const blob=new Blob([JSON.stringify(cfg,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='config.local.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);status.textContent='已请求下载；文件中含个人凭据，请妥善保管。';});
  button('复制配置',async()=>{try{await navigator.clipboard.writeText(JSON.stringify(cfg,null,2));status.textContent='已复制，导入后请清空剪贴板。';}catch{status.textContent='浏览器未允许复制，请使用保存配置文件。';}});
  button('关闭',()=>host.remove());host.append(panel);document.body.append(host);
})();
