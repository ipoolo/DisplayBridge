const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Service}=require('../src/service.cjs');
test('accepted but ignored DDC write retries another authenticated controller and confirms input',async t=>{
  let input=16;const writes=[];
  const make=platform=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'displaybridge-retry-'));
    const backend={scan:async()=>[{id:platform+'-display',name:'ROG',serial:'retry-rog',input,readable:true,observedAt:Date.now()}],set:async(_,n)=>{writes.push(platform);if(platform==='darwin')input=n;}};
    const s=new Service({dir,backend,platform});t.after(()=>{s.close();fs.rmSync(dir,{recursive:true,force:true});});return s;
  };
  const win=make('win32'),mac=make('darwin');await win.network.start(0);await mac.network.start(0);await win.refresh();await mac.refresh();
  await win.pair('127.0.0.1',mac.network.port,mac.network.pairingCode().code);
  const p=structuredClone(win.profile),m=p.monitors[0];m.inputs={[win.identity.id]:16,[mac.identity.id]:18};await win.saveProfile(p,p.revision);
  await win.execute({type:'monitor-cycle',monitorId:m.id});assert.deepEqual(writes,['win32','darwin']);assert.equal(input,18);assert.equal(win.results[m.id].status,'confirmed');
});
test('two real HTTP peers share profile, switch through alternate controller, verify and revoke pairing',async t=>{
  let input=16;const writes=[];
  const make=platform=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'displaybridge-pair-'));
    const backend={scan:async()=>[{id:platform+'-display',name:'CU34G3X',serial:'shared-monitor',input,readable:true,observedAt:Date.now(),inputs:[16,17]}],set:async(native,n)=>{writes.push({platform,native,n});if(platform==='win32')throw Error('当前通路不接受 DDC 写入');input=n;}};
    const s=new Service({dir,backend,platform});t.after(()=>{s.close();fs.rmSync(dir,{recursive:true,force:true});});return s;
  };
  const win=make('win32'),mac=make('darwin');
  await win.network.start(0);await mac.network.start(0);await win.refresh(true);await mac.refresh(true);
  const code=mac.network.pairingCode().code;await win.pair('127.0.0.1',mac.network.port,code);
  const p=structuredClone(win.profile),monitor=p.monitors[0];monitor.inputs={[win.identity.id]:16,[mac.identity.id]:17};
  await win.saveProfile(p,p.revision);
  assert.equal(mac.profile.monitors.length,1);assert.equal(mac.profile.monitors[0].endpoints[mac.identity.id],'darwin-display');
  assert.equal(win.peers.length,1);assert.equal(mac.peers.length,1);
  await win.execute({type:'switch',monitorId:monitor.id,deviceId:mac.identity.id});
  assert.equal(writes.length,2);assert.equal(input,17);assert.equal(win.results[monitor.id].status,'confirmed');
  assert.equal(win.states()[monitor.id].deviceId,mac.identity.id);
  const peer=structuredClone(win.peers[0]);await win.unpair(mac.identity.id);
  assert.equal(mac.peers.length,0);await assert.rejects(win.network.call(peer,'GET','/status'),/配对/);
});

test('switch verification refreshes the other computer instead of trusting its pre-switch cache',async t=>{
  let input=16;const reads={win32:0,darwin:0};
  const make=platform=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'displaybridge-fresh-'));
    const backend={scan:async()=>{reads[platform]++;return [{id:platform+'-display',name:'ROG XG279Q',serial:'same-rog',input,readable:true,observedAt:Date.now(),inputs:[16,18]}];},set:async(_,n)=>{input=n;}};
    const s=new Service({dir,backend,platform});t.after(()=>{s.close();fs.rmSync(dir,{recursive:true,force:true});});return s;
  };
  const win=make('win32'),mac=make('darwin');
  await win.network.start(0);await mac.network.start(0);await win.refresh();await mac.refresh();
  await win.pair('127.0.0.1',mac.network.port,mac.network.pairingCode().code);
  const p=structuredClone(win.profile),monitor=p.monitors[0];monitor.inputs={[win.identity.id]:16,[mac.identity.id]:18};
  await win.saveProfile(p,p.revision);const previousMacReads=reads.darwin;
  // No background polls: the receiver will retain the old input until verification requests a fresh read.
  await win.execute({type:'switch',monitorId:monitor.id,deviceId:mac.identity.id});
  assert.equal(win.results[monitor.id].status,'confirmed');
  assert.ok(reads.darwin>previousMacReads);assert.equal(mac.local[0].input,18);
});
