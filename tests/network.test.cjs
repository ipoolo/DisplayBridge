const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const http=require('node:http');
const {Network,request,isLan}=require('../src/network.cjs');
test('LAN addresses only',()=>{assert.equal(isLan('192.168.1.3'),true);assert.equal(isLan('172.31.1.1'),true);assert.equal(isLan('172.32.1.1'),false);assert.equal(isLan('8.8.8.8'),false);assert.equal(isLan('example.com'),false);});
test('pairing authenticates both directions, wrong/expired/reused codes and unauthenticated writes fail',async t=>{
  let peersA=[],peersB=[],writes=0;
  const make=(name,os,getPeers,savePeer)=>new Network({identity:{id:randomUUID(),name,os},getPeers,savePeer,removePeer:()=>{},getStatus:()=>({ok:true}),onProfile:()=>{},onCommand:()=>{writes++;},onChange:()=>{}});
  const a=make('A','Windows',()=>peersA,p=>peersA.push(p));const b=make('B','macOS',()=>peersB,p=>peersB.push(p));
  await a.start(0);await b.start(0);t.after(()=>{a.close();b.close();});
  const manual=[];b.onKeyboardSwitch=()=>{manual.push('keyboard');return {ok:true};};b.onMouseSwitch=()=>{manual.push('mouse');return {ok:true};};
  const followed=[];b.getKeyboard=()=>({kind:'keyboard'});b.getMouse=()=>({kind:'mouse'});b.onKeyboardFollow=()=>{followed.push('keyboard');return {ok:true};};b.onMouseFollow=()=>{followed.push('mouse');return {ok:true};};
  for(const kind of ['keyboard','mouse']){await assert.rejects(request('127.0.0.1',b.port,'GET','/'+kind),/尚未配对/);await assert.rejects(request('127.0.0.1',b.port,'POST','/'+kind+'-follow',{}),/尚未配对/);}assert.equal(followed.length,0);for(const kind of ['keyboard','mouse'])await assert.rejects(request('127.0.0.1',b.port,'POST','/'+kind+'-switch',{}),/尚未配对/);assert.equal(manual.length,0);
  await assert.rejects(request('127.0.0.1',b.port,'POST','/switch',{}),/尚未配对/);
  const pin=b.pairingCode();
  await assert.rejects(a.pair('127.0.0.1',b.port,'000000'),/配对码/);
  b.pin.expires=0;await assert.rejects(a.pair('127.0.0.1',b.port,pin.code),/过期/);
  const valid=b.pairingCode();await a.pair('127.0.0.1',b.port,valid.code);
  assert.equal(peersA.length,1);assert.equal(peersB.length,1);
  for(const kind of ['keyboard','mouse']){assert.deepEqual(await a.call(peersA[0],'GET','/'+kind),{kind});await a.call(peersA[0],'POST','/'+kind+'-follow',{});}assert.deepEqual(followed,['keyboard','mouse']);for(const kind of ['keyboard','mouse'])await a.call(peersA[0],'POST','/'+kind+'-switch',{});assert.deepEqual(manual,['keyboard','mouse']);
  assert.deepEqual(await a.call(peersA[0],'GET','/status'),{ok:true});assert.deepEqual(await b.call(peersB[0],'GET','/status'),{ok:true});
  await a.call(peersA[0],'POST','/switch',{});assert.equal(writes,1);
  await assert.rejects(a.pair('127.0.0.1',b.port,valid.code),/配对码/);
  // A website cannot reuse the API even if it somehow knows a token.
  const code=await new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port:b.port,path:'/status',headers:{Origin:'https://example.com',Authorization:'Bearer '+peersA[0].outboundToken}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});assert.equal(code,403);
});
