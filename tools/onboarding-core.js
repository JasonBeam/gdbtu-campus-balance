/* Shared pure helpers for the standalone Scriptable onboarding. No network or storage. */
const OnboardingCore = (() => {
  const fields=['syscustid','acc_token','areacode','buildingID','custid','userAgent','timestamp','meterID','dormRoom','portalDormAddress'];
  function cleanConfig(input,{requirePower=false}={}) {
    if(!input||typeof input!=='object'||Array.isArray(input))throw Error('配置格式不正确');
    const out={};
    for(const key of fields){const value=input[key]??'';if(typeof value!=='string'||value.length>2048||/[\u0000-\u001f]/.test(value))throw Error('配置格式不正确');out[key]=value.trim();}
    for(const key of ['syscustid','acc_token','areacode'])if(!out[key])throw Error('请先完成学校登录');
    if(requirePower&&!out.buildingID)throw Error('请先选择自己的宿舍电表');
    if(out.dormRoom.length>128||out.portalDormAddress.length>128)throw Error('宿舍信息格式不正确');
    return out;
  }
  function owner(cfg){return JSON.stringify(['syscustid','areacode','custid','buildingID','meterID'].map(k=>cfg[k]||''));}
  function address(raw){
    if(typeof raw!=='string'||raw.length>128)return null;
    const m=raw.replace(/\s/g,'').match(/^(.{1,32}校区)([A-Za-z]?\d{1,3})(?:栋|幢)(?:(\d{1,3})号)?(\d{1,2})(?:层|楼)(\d{2,6}[A-Za-z]?)(?:房|室)$/);
    return m&&Number(m[4])>0?{campus:m[1],building:m[2],unit:m[3]||'',floor:Number(m[4]),room:m[5],shortRoom:m[2]+'栋'+m[5]}:null;
  }
  function matches(a,label,level){
    const s=String(label).replace(/\s/g,'');
    const cn=['零','一','二','三','四','五','六','七','八','九','十','十一','十二','十三','十四','十五','十六','十七','十八','十九','二十'];
    return level===0?s===a.campus:level===1?[a.building+'栋',a.building+'幢',a.building+'号楼'].includes(s):level===2?[a.floor+'楼',a.floor+'层',(cn[a.floor]||a.floor)+'楼',(cn[a.floor]||a.floor)+'层'].includes(s):[a.room,a.room+'房',a.room+'室'].includes(s);
  }
  function branches(a,rows){
    if(rows.some(x=>/\d+(栋|幢|号楼)$/.test(x.name)))return rows.filter(x=>matches(a,x.name,1));
    if(rows.some(x=>/\d+(号|单元)$/.test(x.name)))return rows.filter(x=>a.unit&&[a.unit+'号',a.unit+'单元'].includes(x.name.replace(/\s/g,'')));
    if(rows.some(x=>/[\d一二三四五六七八九十]+(楼|层)$/.test(x.name)))return rows.filter(x=>matches(a,x.name,2));
    if(rows.some(x=>/^\d{2,6}(房|室)?$/.test(x.name)))return rows.filter(x=>matches(a,x.name,3));
    return rows;
  }
  function options(raw){
    if(!Array.isArray(raw)||raw.length>10000)throw Error('宿舍目录格式发生变化');
    const out=raw.map(row=>{if(!row||typeof row.buildingID!=='string'||typeof row.buildingName!=='string'||!row.buildingID||!row.buildingName||row.buildingID.length>128||row.buildingName.length>128)throw Error('宿舍目录格式发生变化');return{id:row.buildingID,name:row.buildingName};});
    if(new Set(out.map(x=>x.id)).size!==out.length)throw Error('学校返回了重复的宿舍位置');return out;
  }
  function ownMeters(raw,a){
    if(!Array.isArray(raw)||raw.length>100)throw Error('电表数据格式发生变化');
    const rows=raw.filter(row=>row&&typeof row.comAddress==='string'&&row.comAddress&&typeof row.piplineName==='string');
    if(rows.length!==raw.length||new Set(rows.map(x=>x.comAddress)).size!==rows.length)throw Error('电表信息不完整或重复');
    return a?rows.filter(row=>[a.shortRoom,a.shortRoom+'房',a.shortRoom+'室'].includes(row.piplineName.replace(/[\s·]/g,''))):rows;
  }
  async function resolve(a,readBuildings){
    const roots=(await readBuildings(null)).filter(x=>matches(a,x.name,0));if(roots.length!==1)return [];
    const queue=[[roots[0]]],visited=new Set(),leaves=[];
    while(queue.length){const path=queue.shift(),last=path[path.length-1];
      if(visited.size>=64||visited.has(last.id))throw Error('宿舍目录过于复杂，请手动选择');visited.add(last.id);
      const rows=await readBuildings(last.id);
      if(!rows.length){if(path.some(x=>matches(a,x.name,1))&&path.some(x=>matches(a,x.name,2)||matches(a,x.name,3)))leaves.push(path);continue;}
      if(path.length>=7)throw Error('宿舍目录层级过多，请手动选择');
      const next=branches(a,rows);if(next.length>24)throw Error('同名位置较多，请手动选择');for(const row of next)queue.push([...path,row]);
    }
    return leaves;
  }
  return {fields,cleanConfig,owner,address,matches,options,ownMeters,resolve};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=OnboardingCore;
