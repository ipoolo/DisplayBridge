const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {ClipboardShare}=require('../src/clipboard-share.cjs');
function pair(t){
  const devices={};
  for(const [id,other] of [['a','b'],['b','a']]){
    const d={content:{kind:'text',text:'old '+id},enabled:true,mode:'auto',online:true,writes:0,peers:[{id:other,inboundToken:'a',outboundToken:'b'}]};
    d.c=new ClipboardShare({identity:{id},getMode:()=>d.mode,getAutoSync:()=>d.enabled,getPeers:()=>d.peers,read:()=>d.content,write:async item=>{d.writes++;d.content=item;},network:{call:async(peer,method,route)=>{
      if(!d.online||!devices[other].online)throw Error('offline');
      return devices[other].c.envelope(peer,new URL(route,'http://localhost').searchParams.get('after'));
    }}});devices[id]=d;t.after(()=>d.c.close());
  }
  const {a,b}=devices;
  return {a,b,ready:async()=>{await a.c.capture();await b.c.capture();await a.c.pollPeers();await b.c.pollPeers();},copy:async(d,text)=>{d.content={kind:'text',text};await d.c.capture();}};
}
test('automatic text and PNG work both directions without echoing or writing startup contents',async t=>{
  const {a,b,ready,copy}=pair(t);await ready();assert.equal(a.writes+b.writes,0);
  await copy(a,'Windows → Mac 中文');await b.c.pollPeers();assert.equal(b.content.text,'Windows → Mac 中文');
  await b.c.capture();await a.c.pollPeers();assert.equal(a.writes,0);
  await copy(b,'Mac → Windows');await a.c.pollPeers();assert.equal(a.content.text,'Mac → Windows');
  const png=fs.readFileSync(path.join(__dirname,'../assets/icon.png')).toString('base64');
  a.content={kind:'image',png};await a.c.capture();await b.c.pollPeers();assert.equal(b.content.png,png);
  await copy(b,'clear image');await a.c.pollPeers();b.content={kind:'image',png};await b.c.capture();await a.c.pollPeers();assert.equal(a.content.png,png);
  const writes=a.writes+b.writes;
  for(let i=0;i<5;i++){await a.c.capture();await b.c.capture();await a.c.pollPeers();await b.c.pollPeers();}
  assert.equal(a.writes+b.writes,writes);
});
test('disabled sender/receiver and manual mode never replace clipboard',async t=>{
  const {a,b,ready,copy}=pair(t);await ready();b.enabled=false;b.c.modeChanged();await copy(a,'disabled receiver');await b.c.pollPeers();assert.equal(b.writes,0);
  b.enabled=true;b.c.modeChanged();await b.c.pollPeers();assert.equal(b.writes,0);
  a.enabled=false;a.c.modeChanged();await copy(a,'disabled sender');await b.c.pollPeers();assert.equal(b.writes,0);
  a.enabled=true;a.c.modeChanged();await b.c.pollPeers();await copy(a,'next fresh copy');await b.c.pollPeers();assert.equal(b.writes,1);
  b.mode='manual';b.c.modeChanged();await copy(a,'manual');await b.c.pollPeers();assert.equal(b.writes,1);
});
test('reconnect and sender restart establish a baseline and skip stale copies',async t=>{
  const {a,b,ready,copy}=pair(t);await ready();a.online=false;await b.c.pollPeers();await copy(a,'offline');a.online=true;await b.c.pollPeers();assert.equal(b.writes,0);
  await copy(a,'after reconnect');await b.c.pollPeers();assert.equal(b.writes,1);
  a.c.session='new-session';await copy(a,'restart clipboard');await b.c.pollPeers();assert.equal(b.writes,1);
  await copy(a,'after restart');await b.c.pollPeers();assert.equal(b.writes,2);
});
test('simultaneous copies converge deterministically without system clock dependency',async t=>{
  const {a,b,ready,copy}=pair(t);await ready();await copy(a,'A concurrent');await copy(b,'B concurrent');
  await Promise.all([a.c.pollPeers(),b.c.pollPeers()]);
  assert.equal(a.content.text,b.content.text);assert.equal(b.content.text,'B concurrent');
  await copy(a,'newer after convergence');await b.c.pollPeers();assert.equal(b.content.text,'newer after convergence');
});
test('disabling while a response is in flight prevents write and stale status resurrection',async t=>{
  const {a,b,ready,copy}=pair(t);await ready();await copy(a,'in flight');
  const original=b.c.network.call;let release;b.c.network.call=async(...args)=>{const result=await original(...args);await new Promise(r=>release=r);return result;};
  const pending=b.c.pollPeers();await new Promise(r=>setImmediate(r));b.enabled=false;b.mode='off';b.c.modeChanged();release();await pending;
  assert.equal(b.writes,0);assert.equal(b.c.remote.size,0);
});
test('receiving cannot republish an OS-normalized image as a fresh local copy',async t=>{
  const {a,b,ready}=pair(t);await ready();const png=fs.readFileSync(path.join(__dirname,'../assets/icon.png'));
  const normalized=Buffer.concat([png,Buffer.from('normalized-fixture')]).toString('base64');
  b.c.write=async item=>{b.writes++;b.content={...item,png:normalized};};
  a.content={kind:'image',png:png.toString('base64')};await a.c.capture();const previous=b.c.latest.id;await b.c.pollPeers();await b.c.capture();assert.equal(b.c.latest.id,previous);await a.c.pollPeers();assert.equal(a.writes,0);
});
test('copying the previous local text again after receiving remote text is a new update',async t=>{
  const {a,b,ready,copy}=pair(t);await ready();await copy(a,'repeat me');await b.c.pollPeers();await copy(b,'interlude');await a.c.pollPeers();await copy(a,'repeat me');await b.c.pollPeers();assert.equal(b.content.text,'repeat me');
});
test('a restarted sender learns the peer clock even when peer has no latest item',async t=>{
  const {a,b,ready,copy}=pair(t);await ready();a.c.clock=100;await copy(a,'high counter');await b.c.pollPeers();
  a.c.session='restart';a.c.clock=0;a.c.winner=null;a.c.latest=null;a.c.seen.clear();b.c.latest=null;
  await a.c.pollPeers();await b.c.pollPeers();await copy(a,'first new copy after restart');await b.c.pollPeers();assert.equal(b.content.text,'first new copy after restart');
});
