/* Runs only inside the user's Scriptable WebView. Never reads password inputs. */
(() => {
  const origin=location.origin;
  // Conceal school dashboard content while retaining its authenticated runtime,
  // just as the App overlays its WKWebView during automatic navigation.
  if(['https://portal.gdbtu.edu.cn','https://ecykt.gdbtu.edu.cn'].includes(origin)&&document.body&&document.documentElement&&!window.__balanceShowSchoolPage&&!document.getElementById('balance-connecting')){
    const style=document.createElement('style');
    style.textContent='html.balance-connecting body>:not(#balance-connecting){visibility:hidden!important}#balance-connecting{position:fixed;inset:0;z-index:2147483647;background:#f2f2f7;color:#242428;font:17px -apple-system,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;text-align:center}#balance-connecting button{margin-top:24px;min-height:44px;border:0;background:none;color:#1766d4;font:inherit}@media(prefers-color-scheme:dark){#balance-connecting{background:#000;color:#f5f5f7}}';
    const cover=document.createElement('div');cover.id='balance-connecting';
    const title=document.createElement('p');title.textContent=origin==='https://portal.gdbtu.edu.cn'?'正在连接校园卡…':'正在同步校园信息…';title.setAttribute('role','status');cover.append(title);
    const reveal=document.createElement('button');reveal.textContent='显示学校页面';reveal.onclick=()=>{window.__balanceShowSchoolPage=true;document.documentElement.classList.remove('balance-connecting');cover.remove();style.remove();};cover.append(reveal);
    document.head.append(style);document.body.append(cover);document.documentElement.classList.add('balance-connecting');
  }
  if(origin==='https://cas.gdbtu.edu.cn'){
    // Presentation only: retain official inputs, encryption, captcha and MFA.
    // No field values, form submissions or authentication models are accessed.
    if (document.querySelector('.sw-login,.mobile .login-form') && !document.getElementById('campus-compact-login')) {
      const style = document.createElement('style'); style.id = 'campus-compact-login';
      style.textContent = `
        :root{--campus-bg:#f2f2f7;--campus-fg:#242428;--campus-card:#fff;--campus-line:#d9dce3;color-scheme:light dark}
        @media(prefers-color-scheme:dark){:root{--campus-bg:#000;--campus-fg:#f5f5f7;--campus-card:#1c1c1e;--campus-line:#3a3a3f}}
        html,body,#content,#vue_main,.sw-login,.sw-login-wrap{background:var(--campus-bg)!important;color:var(--campus-fg)!important;min-width:0!important}
        .sw-login-wrap>.el-container{display:block!important}
        .sw-login-wrap>.el-container>div[style]{position:relative!important;height:auto!important}
        #background,#logo{display:none!important}
        .sw-login-main{position:relative!important;top:auto!important;left:auto!important;right:auto!important;transform:none!important;width:100%!important;height:auto!important;min-height:0!important;margin:0!important;padding:16px!important;box-sizing:border-box!important}
        .sw-login-main-content{position:relative!important;max-width:440px!important;width:100%!important;margin:0 auto!important;padding:24px 20px!important;box-sizing:border-box!important;border-radius:20px!important;background:var(--campus-card)!important;box-shadow:none!important;color:var(--campus-fg)!important}
        .sw-login-menu{background:transparent!important;color:var(--campus-fg)!important}
        .sw-login-menu .el-menu-item{background:transparent!important;color:var(--campus-fg)!important;font-size:15px!important}
        .sw-login-menu .el-menu-item.is-active{color:#2670df!important;border-bottom-color:#2670df!important}
        #passwordLogin .el-input__inner,#smsCodeLogin .el-input__inner{height:50px!important;border-radius:12px!important;font-size:17px!important;background:var(--campus-bg)!important;color:var(--campus-fg)!important;border-color:var(--campus-line)!important}
        .login-btn{height:50px!important;border-radius:12px!important;background:#2169d8!important;border-color:#2169d8!important;color:#fff!important;font-size:17px!important;font-weight:600!important}
        .mobile,.mobile .wrap,.mobile .white-wrap{background:var(--campus-bg)!important;color:var(--campus-fg)!important}
        .mobile .main{max-width:472px!important;margin:0 auto!important;padding:12px 0!important}
        .mobile .card:not(.mfa-m){width:calc(100% - 32px)!important;margin:0 auto!important;padding:24px 20px!important;box-sizing:border-box!important;border-radius:20px!important;background:var(--campus-card)!important;box-shadow:none!important}
        .mobile .van-tabs__nav{background:var(--campus-card)!important}
        .mobile .van-tab{color:var(--campus-fg)!important}
        .mobile .van-tab--active{color:#2670df!important}
        .mobile .van-tabs__line{background:#2670df!important}
        .mobile .login-form .el-input__inner{height:50px!important;border-radius:12px!important;font-size:17px!important;background:var(--campus-bg)!important;color:var(--campus-fg)!important;border-color:var(--campus-line)!important}
        .mobile .login-form .el-button--primary{height:50px!important;border-radius:12px!important;background:#2169d8!important;border-color:#2169d8!important;color:#fff!important;font-size:17px!important;font-weight:600!important}
        #vue_main .card:not(.mfa-m) .el-button--primary{background:#2169d8!important;background-image:none!important;border-color:#2169d8!important;color:#fff!important;border-radius:12px!important}
        #vue_main .el-button--text{color:#2670df!important}
        #vue_main .van-tabs__line{background:#2670df!important}
        .login-error{line-height:1.5!important}
        .el-dialog{max-width:calc(100vw - 32px)!important}
      `;
      document.head.appendChild(style);
    }
    return {stage:'login'};
  }
  if(origin==='https://portal.gdbtu.edu.cn'){
    const state=value=>({...value,portalIssues:window.__balancePortalIssues||{}});
    const values=[...document.querySelectorAll('.studentContainer-left-top-info span')].map(x=>x.textContent.trim()).filter(x=>/^宿舍地址\s*[：:]/.test(x)).map(x=>x.replace(/^宿舍地址\s*[：:]\s*/,''));
    const unique=[...new Set(values.filter(x=>x.length<=128&&/\d/.test(x)&&!/[\u0000-\u001f]/.test(x)))];
    if(unique.length===1&&window.__balanceDormAcknowledged!==unique[0])return state({stage:'profile',address:unique[0]});
    if(window.__balanceWalletOpening)return state({stage:'opening-wallet'});
    const titles=[...document.querySelectorAll('.studentContainer-right-top-title')].filter(x=>[...x.querySelectorAll('span')].some(y=>y.textContent.trim()==='一卡通信息'));
    if(titles.length!==1)return state({stage:'waiting-portal'});
    let node=titles[0],entry=null;
    for(let i=0;node&&i<12;i++,node=node.parentElement){const v=node.__vue__,info=v&&(v.cardInfo||(v.$data&&v.$data.cardInfo));if(info&&typeof info.pcUrl==='string'){entry=info.pcUrl;break;}}
    if(!entry)return state({stage:'waiting-portal'});
    let url;try{url=new URL(entry,location.href);}catch{return state({stage:'unsupported-entry'});}
    if(url.origin!=='https://ecykt.gdbtu.edu.cn'||url.username||url.password)return state({stage:'unsupported-entry'});
    window.__balanceWalletOpening=true;location.assign(url.href);return state({stage:'opening-wallet'});
  }
  if(origin==='https://ecykt.gdbtu.edu.cn'){
    try {
      const s=JSON.parse(localStorage.getItem('elecampus_state')||'{}'),login=s.loginInfo||{};
      const cfg={syscustid:String(login.syscustid||''),acc_token:String(s.logintoken||''),areacode:String(s.schoolid||login.areacode||''),custid:String((s.custInfo||{}).custid||login.custid||s.custid||''),timestamp:String(login.timestamp||''),userAgent:navigator.userAgent};
      if(!cfg.syscustid||!cfg.acc_token||!cfg.areacode)return {stage:'waiting-wallet'};
      return {stage:'ready',config:cfg};
    }catch{return {stage:'waiting-wallet'};}
  }
  return {stage:'unsupported-origin'};
})()
