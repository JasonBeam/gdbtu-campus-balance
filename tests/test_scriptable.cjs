const fs=require('node:fs');
const assert=require('node:assert/strict');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const source=fs.readFileSync('scriptable/校园余额.js','utf8');
(async()=>{
  const storage=new Map();
  const Keychain={contains:k=>storage.has(k),get:k=>storage.get(k),set:(k,v)=>storage.set(k,v)};
  let failure=false,calls=[];
  class Request{
    constructor(url){this.url=url;this.response={statusCode:200};}
    async loadJSON(){
      const body=JSON.parse(this.body);calls.push({url:this.url,body});
      if(this.url.includes('electricnew')){if(failure)throw Error('upstream secret');return {code:0,data:JSON.stringify([{leftMoney:'86.42',updateDateTime:'2026-10-16 12:00:00'}])};}
      if(this.url.includes('loginBySysId'))return {code:0,data:{syscustid:'resolved-user'}};
      if(this.url.includes('getSysBindCustInfo'))return {code:0,data:[{custid:'resolved-card'}]};
      assert.equal(body.syscustid,'resolved-user');return {code:0,data:'32.80'};
    }
  }
  const module={exports:{}};
  await new AsyncFunction('module','Keychain','Request',source)(module,Keychain,Request);
  const api=module.exports;
  for(const value of [null,undefined,'',' ',true,false,{},[],NaN,'Infinity'])assert.throws(()=>api.amount(value));
  assert.equal(api.amount('0'),0);assert.equal(api.amount('-2.8'),-2.8);
  assert.deepEqual(api.dataOf({code:0,data:'[{"value":2}]'}),[{value:2}]);
  assert.equal(api.providerTime('2026-10-16 12:00:00'),'2026-10-16T04:00:00.000Z');
  for(const [key,val] of Object.entries({syscustid:'test-user',acc_token:'test-token',buildingID:'test-room'}))storage.set('gdbtu_public_v1_'+key,val);
  const first=await api.snapshot();assert.equal(first.metrics.power.value,86.42);assert.equal(first.metrics.card.value,32.8);
  assert.equal(first.metrics.card.providerAt,null);const count=calls.length;
  await api.snapshot();assert.equal(calls.length,count);
  const cached=JSON.parse(storage.get('gdbtu_public_v1_cache'));cached.checkedAt=1;storage.set('gdbtu_public_v1_cache',JSON.stringify(cached));failure=true;
  const second=await api.snapshot();assert.equal(second.metrics.power.state,'stale');assert.equal(second.metrics.power.value,86.42);assert.equal(second.metrics.card.state,'queried');
  assert.equal(second.metrics.power.fetchedAt,first.metrics.power.fetchedAt);assert(!JSON.stringify(second).includes('test-token'));assert(!JSON.stringify(second).includes('upstream secret'));
  console.log('Scriptable parsing, independent queries, session/custid resolution, TTL and stale fallback: PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
