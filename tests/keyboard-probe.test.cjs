const {test}=require('node:test'),assert=require('node:assert/strict');
const {KeyboardProbe,inferChannels}=require('../src/keyboard-probe.cjs');
test('keyboard probe coalesces reads and never requests permission implicitly',async()=>{
  let release;const calls=[];
  const probe=new KeyboardProbe('/native','darwin',(...args)=>{calls.push(args);return new Promise(r=>release=r);});
  const first=probe.inspect(false),second=probe.inspect(false);assert.equal(first,second);assert.deepEqual(calls[0][1],['inspect']);
  release(JSON.stringify({status:'permission-required'}));const result=await first;assert.equal(result.status,'permission-required');assert.equal(probe.pending,null);
  const request=probe.inspect(true);assert.deepEqual(calls[1][1],['request-access']);release(JSON.stringify({status:'ready',channels:3,currentChannel:2}));assert.equal((await request).currentChannel,2);
});
test('invalid or unavailable keyboard data cannot be promoted to ready',async()=>{
  for(const raw of [{status:'ready',channels:3,currentChannel:4},{status:'ready',channels:99,currentChannel:1},{status:'unexpected'}]){
    const probe=new KeyboardProbe('/native','darwin',async()=>JSON.stringify(raw));assert.equal((await probe.inspect()).status,'error');
  }
  const pc=new KeyboardProbe('/native','win32',async(file,args)=>{assert.ok(file.endsWith('keyboard-control.exe'));assert.deepEqual(args,['inspect']);return JSON.stringify({status:'not-connected'});});assert.equal((await pc.inspect()).status,'not-connected');
});
test('keyboard switching validates target and distinguishes a sent command from confirmation',async()=>{
  const probe=new KeyboardProbe('/native','win32',async(file,args)=>{assert.deepEqual(args,['switch','1']);return JSON.stringify({status:'sent',targetChannel:1});});
  await assert.rejects(probe.switchTo(4),/无效/);assert.equal((await probe.switchTo(1)).status,'sent');
});
test('detected names fill only known unambiguous channels and preserve explicit mappings',()=>{
  const profile={devices:[{id:'a',name:'Work PC'},{id:'b',name:'Mac'}]},identity={id:'b',name:'Test-Laptop.local'},peers=[{id:'a',name:'TEST-PC'}];
  const probe={status:'ready',currentChannel:3,hosts:[{channel:1,paired:true,name:'TEST-PC'},{channel:2,paired:true,name:'Unrelated PC'},{channel:3,paired:true,name:'Test Laptop'}]};
  assert.deepEqual(inferChannels(profile,identity,peers,probe),{b:3,a:1});
  assert.deepEqual(inferChannels({...profile,keyboardChannels:{a:2,b:3}},identity,peers,probe),{a:2,b:3});
  assert.deepEqual(inferChannels({...profile,devices:[...profile.devices,{id:'c',name:'TEST-PC'}]},identity,peers,probe),{b:3});
});
test('mouse commands use an explicit device selector and separate mapping key',async()=>{
  const calls=[];const mouse=new KeyboardProbe('/native','win32',async(_file,args)=>{calls.push(args);return JSON.stringify(args.includes('switch')?{status:'sent',targetChannel:3}:{status:'ready',channels:3,currentChannel:1});},'mouse');
  const detected=await mouse.inspect();assert.equal(detected.device,'MX Master 3S');await mouse.switchTo(3);assert.deepEqual(calls,[['mouse','inspect'],['mouse','switch','3']]);
  assert.equal(mouse.result.status,'switched-away');assert.equal(mouse.result.currentChannel,undefined);assert.match(mouse.result.message,/鼠标/);
  const profile={devices:[{id:'a',name:'PC'}],keyboardChannels:{a:2}};
  assert.deepEqual(inferChannels(profile,{id:'a',name:'PC'},[],detected,'mouseChannels'),{a:1});assert.deepEqual(profile.keyboardChannels,{a:2});
});
test('transient read failure retries before send, and inspection waits for switching',async()=>{
  let attempts=0,release;const calls=[];
  const probe=new KeyboardProbe('/native','win32',async(_file,args)=>{calls.push(args[0]);if(args[0]==='inspect')return JSON.stringify({status:'ready',channels:3,currentChannel:1});if(++attempts===1)return JSON.stringify({status:'no-response'});await new Promise(r=>release=r);return JSON.stringify({status:'sent',targetChannel:3});});
  const switching=probe.switchTo(3);const inspecting=probe.inspect();await new Promise(r=>setTimeout(r,400));assert.deepEqual(calls,['switch','switch']);release();assert.equal((await switching).status,'sent');assert.equal((await inspecting).status,'ready');assert.deepEqual(calls,['switch','switch','inspect']);
});
