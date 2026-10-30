// Local UI only. Session credentials stay in the Scriptable runtime, outside HTML.
function onboardingPanelHTML(title,message,options=[]){
  const payload=JSON.stringify({title,message,options}).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>
  :root{color-scheme:light dark;--bg:#f2f2f7;--card:#fff;--fg:#202124;--secondary:#666;--line:#e5e5ea;--blue:#1766d4}
  @media(prefers-color-scheme:dark){:root{--bg:#000;--card:#1c1c1e;--fg:#f5f5f7;--secondary:#aaa;--line:#38383a;--blue:#75aaff}}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:17px -apple-system,BlinkMacSystemFont,sans-serif}main{max-width:480px;margin:auto;padding:24px 16px;padding-bottom:max(24px,env(safe-area-inset-bottom))}header{color:var(--secondary);font-size:13px}h1{font-size:25px;line-height:1.3;margin:16px 0}p{white-space:pre-line;line-height:1.65;color:var(--secondary);margin-bottom:24px}.options{background:var(--card);border-radius:16px;overflow:hidden}button{display:block;width:100%;min-height:52px;padding:14px 16px;border:0;border-bottom:1px solid var(--line);background:transparent;color:var(--blue);font:inherit;text-align:left;overflow-wrap:anywhere}button:last-child{border-bottom:0}button:focus-visible{outline:3px solid var(--blue);outline-offset:-3px}button:disabled{opacity:.45}#status{font-size:14px;color:var(--secondary);margin-top:16px}
  </style></head><body><main><header>校园余额</header><h1 id="title"></h1><p id="message" role="status"></p><div class="options" id="options"></div><div id="status" aria-live="polite"></div></main><script>
  (()=>{const data=${payload};window.__campusPanel=true;window.__campusChoice=null;
  document.getElementById('title').textContent=data.title;document.getElementById('message').textContent=data.message;
  data.options.forEach((label,index)=>{const button=document.createElement('button');button.textContent=label;button.addEventListener('click',()=>{if(window.__campusChoice!==null)return;window.__campusChoice=index;for(const b of document.querySelectorAll('button'))b.disabled=true;document.getElementById('status').textContent='正在继续…';});document.getElementById('options').append(button);});})();
  </script></body></html>`;
}
function inlineOnboardingPanel(web,isClosed,presented){
  async function show(title,message,options=[]){
    if(isClosed())return false;
    await within(web.loadHTML(onboardingPanelHTML(title,message,options)),5000);
    return !isClosed();
  }
  async function choose(title,message,options){
    if(!await show(title,message,options))return -1;
    const until=Date.now()+10*60*1000;
    while(!isClosed()&&Date.now()<until){
      const value=await Promise.race([
        within(web.evaluateJavaScript('window.__campusPanel===true ? window.__campusChoice : null'),5000),
        presented.then(()=>-1)
      ]);
      if(value===-1)return -1;
      if(Number.isInteger(value)&&value>=0&&value<options.length){
        await show('正在连接','正在读取学校返回的数据…');return value;
      }
      if(!isClosed())await pauseFor(200);
    }
    if(isClosed())return -1;
    throw Error('选择等待超时，请关闭后重新连接');
  }
  return {show,choose};
}
