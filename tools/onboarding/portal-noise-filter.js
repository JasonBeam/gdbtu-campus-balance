// Suppress only observed, unrelated portal errors; never patch login or wallet origins.
(() => {
  if(location.origin!=='https://portal.gdbtu.edu.cn')return;
  window.__balancePortalIssues=window.__balancePortalIssues||{};
  const record=value=>{
    const text=typeof value==='string'?value:(value?.message||'');
    const code=text.includes('personalInfo.attributes.userName')?'portal-profile':text.includes('bookList.shouldRepayList.length')?'portal-books':'portal-schedule';
    window.__balancePortalIssues[code]=Math.min(999,(window.__balancePortalIssues[code]||0)+1);
  };
  const known=value=>{
    const text=typeof value==='string'?value:(value&&typeof value.message==='string'?value.message:'');
    // Some bridges append a stack trace or forward multiple lines in one call.
    const lines=text.trim().split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
    const message=line=>/^请求日程错误[!！]$/.test(line) || /^(?:TypeError:\s*)?undefined is not an object \(evaluating 't\.(?:bookList\.shouldRepayList\.length|personalInfo\.attributes\.userName)'\)$/.test(line);
    return lines.length>0 && message(lines[0]) && lines.every(line=>message(line)||/^(?:at\s+.+|[^\s]*@https:\/\/portal\.gdbtu\.edu\.cn\/[^\s]+)$/.test(line));
  };
  const wrap=(object,key)=>{
    if(typeof object?.[key]!=='function'||object[key].__balancePortalNoiseWrapped)return;
    const filtered=original=>{
      if(typeof original!=='function'||original.__balancePortalNoiseWrapped)return original;
      const fn=function(...args){if(args.length>0&&args.every(known)){args.forEach(record);return;}return original.apply(this,args);};
      fn.__balancePortalNoiseWrapped=true;return fn;
    };
    let current=filtered(object[key]);
    const descriptor=Object.getOwnPropertyDescriptor(object,key);
    // The bridge can replace logError during evaluateJavaScript, including
    // between our polls. Wrap replacement functions at assignment time as well.
    if(!descriptor||descriptor.configurable){
      Object.defineProperty(object,key,{configurable:true,enumerable:descriptor?.enumerable??true,get:()=>current,set:value=>{current=filtered(value);}});
    }else if(descriptor.writable)object[key]=current;
  };
  // Scriptable may reinstall its log bridge on an evaluation; wrap the current functions.
  wrap(window.console,'error');wrap(window,'logError');
  if(!window.__balancePortalNoiseFilter){
    const stopKnown=event=>{const value=event.error||event.reason||event.message;if(known(value)){record(value);event.preventDefault();event.stopImmediatePropagation();}};
    window.addEventListener('error',stopKnown,true);
    window.addEventListener('unhandledrejection',stopKnown,true);
    window.__balancePortalNoiseFilter=true;
  }
})();
