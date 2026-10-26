const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {ClipboardShare,seal,unseal,validateContent}=require('../src/clipboard-share.cjs');
const {Service}=require('../src/service.cjs');
const {request}=require('../src/network.cjs');
test('clipboard encryption authenticates content and keys without plaintext on the wire',()=>{
  const a={inboundToken:'a'.repeat(64),outboundToken:'b'.repeat(64)},b={inboundToken:a.outboundToken,outboundToken:a.inboundToken},value={kind:'text',text:'Private fixture 复杂文本'};
  const encrypted=seal(value,a);assert.ok(!JSON.stringify(encrypted).includes(value.text));assert.deepEqual(unseal(encrypted,b),value);
  assert.throws(()=>unseal(encrypted,{...b,inboundToken:'c'.repeat(64)}));
  const bytes=Buffer.from(encrypted.data,'base64');bytes[0]^=1;assert.throws(()=>unseal({...encrypted,data:bytes.toString('base64')},b));
  assert.throws(()=>validateContent({kind:'text',text:'a'.repeat(1024*1024+1)}));
  assert.throws(()=>validateContent({kind:'image',png:'not a PNG'}));
});
test('manual/focus/automatic modes and disabling retain only the most recent item',async()=>{
  let mode='manual',reads=0,text='first';const c=new ClipboardShare({identity:{id:'a'},read:()=>{reads++;return{kind:'text',text};},write:()=>{},getMode:()=>mode,getPeers:()=>[],network:{}});
  c.focus();assert.equal(reads,0);await c.capture();const first=c.latest.id;
  await c.capture();assert.equal(c.latest.id,first);text='second';mode='focus';c.focus();await new Promise(r=>setTimeout(r,5));assert.equal(c.latest.text,'second');
  mode='auto';text='third';c.modeChanged();await new Promise(r=>setTimeout(r,5));assert.equal(c.latest.text,'third');
  mode='off';c.modeChanged();assert.equal(c.latest,null);assert.equal(c.items().length,0);await assert.rejects(c.capture(),/关闭/);c.close();
});
test('paired HTTP devices share text and PNG, paste explicitly, suppress echoes and revoke access',async t=>{
  const make=platform=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'displaybridge-clip-'));const s=new Service({dir,platform,backend:{scan:async()=>[],set:async()=>{throw Error('No display writes');}}});let content=null,mode='auto';const c=new ClipboardShare({identity:s.identity,read:()=>content,write:item=>{content=item;},getMode:()=>mode,getPeers:()=>s.peers,network:s.network});s.network.getClipboard=(peer,after)=>c.envelope(peer,after);t.after(()=>{c.close();s.close();fs.rmSync(dir,{recursive:true,force:true});});return{s,c,set:value=>{content=value;},get:()=>content,off:()=>{mode='off';c.modeChanged();}};};
  const a=make('win32'),b=make('darwin');await a.s.network.start(0);await b.s.network.start(0);await a.s.pair('127.0.0.1',b.s.network.port,b.s.network.pairingCode().code);
  await assert.rejects(request('127.0.0.1',a.s.network.port,'GET','/clipboard'),/配对/);
  a.set({kind:'text',text:'Across devices 中文'});await a.c.capture();await b.c.pollPeers();const text=b.c.remote.get(a.s.identity.id);assert.equal(text.text,'Across devices 中文');assert.equal(b.get(),null);
  await b.c.copy(a.s.identity.id,text.id);assert.equal(b.get().text,text.text);await b.c.capture();assert.equal(b.c.latest,null);
  const png=fs.readFileSync(path.join(__dirname,'../assets/icon.png')).toString('base64');a.set({kind:'image',png});await a.c.capture();await b.c.pollPeers();const image=b.c.remote.get(a.s.identity.id);assert.equal(image.png,png);assert.equal(image.width,512);assert.equal(b.c.remote.size,1);
  await b.c.copy(a.s.identity.id,image.id);assert.equal(b.get().png,png);
  a.off();await b.c.pollPeers();assert.equal(b.c.remote.size,0);
  const peer={...b.s.peers[0]};await b.s.unpair(a.s.identity.id);await assert.rejects(b.s.network.call(peer,'GET','/clipboard'),/配对/);
});
