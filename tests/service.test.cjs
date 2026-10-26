const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Service}=require('../src/service.cjs');
function make(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'displaybridge-test-'));let writes=[];const backend={scan:async()=>[{id:'native',name:'CU34G3X',serial:'test-only',input:16,readable:true,observedAt:Date.now(),inputs:[15,16,17,18]}],set:async(...a)=>writes.push(a)};const s=new Service({dir,backend});t.after(()=>{s.close();fs.rmSync(dir,{recursive:true,force:true});});return {s,writes};}
test('scan never assumes the currently selected input belongs to this computer',async t=>{const {s,writes}=make(t);await s.refresh(true);assert.equal(s.profile.monitors.length,1);assert.deepEqual(s.profile.monitors[0].inputs,{});assert.equal(s.states()[s.profile.monitors[0].id].deviceId,null);assert.equal(writes.length,0);});
test('entire scene is preflighted before the first DDC write',async t=>{const {s,writes}=make(t);await s.refresh(true);const m=s.profile.monitors[0];m.inputs[s.identity.id]=16;const scene=s.profile.scenes.find(x=>Object.values(x.assignments).some(v=>v!==s.identity.id));await assert.rejects(s.execute({type:'scene',id:scene.id}),/输入映射/);assert.equal(writes.length,0);});
test('offline direct switch returns a confirmation requirement without writing',async t=>{const {s,writes}=make(t);await s.refresh(true);const m=s.profile.monitors[0],other=s.profile.devices.find(d=>d.id!==s.identity.id);m.inputs[other.id]=17;await assert.rejects(s.execute({type:'switch',monitorId:m.id,deviceId:other.id}),e=>e.code==='OFFLINE');assert.equal(writes.length,0);});
test('no-op switch is confirmed without DDC write',async t=>{const {s,writes}=make(t);await s.refresh(true);const m=s.profile.monitors[0];m.inputs[s.identity.id]=16;await s.execute({type:'switch',monitorId:m.id,deviceId:s.identity.id});assert.equal(writes.length,0);assert.equal(s.results[m.id].status,'confirmed');});
test('keyboard follows only a confirmed primary assignment; failure does not roll back display',async t=>{
  const {s,writes}=make(t);await s.refresh();const m=s.profile.monitors[0];m.inputs[s.identity.id]=16;
  s.profile.monitors.push({id:'secondary',name:'Secondary',inputs:{[s.identity.id]:16},endpoints:{[s.identity.id]:'native'}});
  let follows=0;s.onPrimaryConfirmed=async target=>{follows++;assert.equal(target,s.identity.id);return {status:'failed',message:'keyboard offline'};};
  await s.execute({type:'switch',monitorId:'secondary',deviceId:s.identity.id});assert.equal(follows,0);
  await s.execute({type:'switch',monitorId:m.id,deviceId:s.identity.id});assert.equal(follows,1);assert.equal(s.results[m.id].status,'confirmed');assert.equal(s.lastAction.ok,true);assert.equal(s.lastAction.keyboard.status,'failed');assert.equal(writes.length,0);
});
test('keyboard failure does not block independent mouse follow or roll back the primary',async t=>{
  const {s,writes}=make(t);await s.refresh();const m=s.profile.monitors[0];m.inputs[s.identity.id]=16;let mouseCalls=0;
  s.onPrimaryConfirmed=async()=>{throw Error('keyboard unavailable');};s.onPrimaryMouseConfirmed=async()=>{mouseCalls++;return {status:'confirmed',message:'mouse followed'};};
  await s.execute({type:'switch',monitorId:m.id,deviceId:s.identity.id});assert.equal(s.lastAction.keyboard.status,'failed');assert.equal(s.lastAction.mouse.status,'confirmed');assert.equal(mouseCalls,1);assert.equal(s.lastAction.ok,true);assert.equal(writes.length,0);
});
test('persisted configuration survives restart and stale editors are rejected',async t=>{const {s}=make(t);await s.refresh(true);const p=structuredClone(s.profile);p.monitors[0].name='工作主屏';await s.saveProfile(p,p.revision);const restored=new Service({dir:s.dir,backend:s.backend});t.after(()=>restored.close());assert.equal(restored.profile.monitors[0].name,'工作主屏');await assert.rejects(s.saveProfile(p,p.revision),/配置已更新/);});
test('write accepted but actual input unchanged is reported unverified',async t=>{const {s,writes}=make(t);await s.refresh(true);const m=s.profile.monitors[0],other=s.profile.devices.find(d=>d.id!==s.identity.id);m.inputs[other.id]=17;await s.execute({type:'switch',monitorId:m.id,deviceId:other.id},{force:true});assert.equal(writes.length,1);assert.equal(s.results[m.id].status,'unverified');assert.equal(s.busy,false);});
test('concurrent shortcut invocation is rejected before its first await',async t=>{const {s}=make(t);await s.refresh(true);const m=s.profile.monitors[0];m.inputs[s.identity.id]=16;let release;const gate=new Promise(r=>release=r);s.refreshPeers=()=>gate;const first=s.execute({type:'switch',monitorId:m.id,deviceId:s.identity.id});await assert.rejects(s.execute({type:'switch',monitorId:m.id,deviceId:s.identity.id}),/正在切换/);release();await first;assert.equal(s.busy,false);});
test('single monitor cycle writes only its target and determines next from freshly read input',async t=>{
  const {s}=make(t);await s.refresh();const m=s.profile.monitors[0],other=s.profile.devices.find(d=>d.id!==s.identity.id);m.inputs={[s.identity.id]:16,[other.id]:18};
  let input=16;const writes=[];s.backend.scan=async()=>[{id:'native',name:'CU34G3X',input,readable:true,observedAt:Date.now()}];s.backend.set=async(id,value)=>{writes.push([id,value]);input=value;};
  let fresh=false;s.refreshPeers=async options=>{fresh||=Boolean(options?.fresh);};s.online=()=>new Set([s.identity.id,other.id]);
  s.profile.monitors.push({id:'untouched',name:'Other screen',inputs:{[s.identity.id]:15,[other.id]:18},endpoints:{[s.identity.id]:'untouched-native'}});
  const plans=[];s.on('before-switch',p=>plans.push(p));
  await s.execute({type:'monitor-cycle',monitorId:m.id});assert.equal(s.results[m.id].status,'confirmed');
  await s.execute({type:'monitor-cycle',monitorId:m.id});assert.deepEqual(writes,[['native',18],['native',16]]);assert.equal(fresh,true);
  assert.ok(plans.every(p=>Object.keys(p).length===1&&Object.hasOwn(p,m.id)));assert.equal(s.results.untouched,undefined);
});
test('single monitor cycle rechecks transient unreadable input before choosing a target',async t=>{
  const {s}=make(t);await s.refresh();const m=s.profile.monitors[0],other=s.profile.devices.find(d=>d.id!==s.identity.id);m.inputs={[s.identity.id]:16,[other.id]:18};let reads=0,input=16;const writes=[];
  s.backend.scan=async()=>[{id:'native',name:'CU34G3X',input:++reads<3?null:input,readable:reads>=3,observedAt:Date.now()}];s.backend.set=async(id,value)=>{assert.ok(reads>=3);writes.push([id,value]);input=value;};s.refreshPeers=async()=>{};s.online=()=>new Set([s.identity.id,other.id]);
  await s.execute({type:'monitor-cycle',monitorId:m.id});assert.deepEqual(writes,[['native',18]]);assert.equal(s.results[m.id].status,'confirmed');
});
