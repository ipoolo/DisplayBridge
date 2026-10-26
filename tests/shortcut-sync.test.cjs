const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Service}=require('../src/service.cjs'),{request}=require('../src/network.cjs'),{planSelection}=require('../src/shortcuts.cjs');
test('authenticated shortcut pull reads latest peer settings without changing either device',async t=>{
  const make=platform=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'displaybridge-shortcut-sync-'));const service=new Service({dir,platform,backend:{scan:async()=>[],set:async()=>{throw Error('No display writes expected');}}});t.after(()=>{service.close();fs.rmSync(dir,{recursive:true,force:true});});return service;};
  const win=make('win32'),mac=make('darwin');await win.network.start(0);await mac.network.start(0);await win.refresh();await mac.refresh();
  await assert.rejects(request('127.0.0.1',mac.network.port,'GET','/shortcuts'),/尚未配对/);
  await win.pair('127.0.0.1',mac.network.port,mac.network.pairingCode().code);
  const profile=structuredClone(win.profile);profile.monitors.push({id:'screen',name:'Screen',inputs:{[win.identity.id]:15,[mac.identity.id]:18},endpoints:{}});profile.primaryId='screen';await win.saveProfile(profile,profile.revision);
  mac.preferences.shortcuts=[{id:'source-id',accelerator:'Control+Option+F10',action:{type:'monitor-cycle',monitorId:'screen'}}];mac.persist();
  const first=await win.readPeerShortcuts(mac.identity.id);assert.equal(first.data.sourceOS,'macOS');assert.equal(first.data.shortcuts[0].accelerator,'Control+Option+F10');assert.equal(first.data.shortcuts[0].id,undefined);assert.equal(first.data.preferences,undefined);assert.equal(win.preferences.shortcuts.length,0);assert.equal(mac.preferences.shortcuts.length,1);
  mac.preferences.shortcuts[0].accelerator='Control+Option+F11';mac.persist();const latest=await win.readPeerShortcuts(mac.identity.id);assert.equal(latest.data.shortcuts[0].accelerator,'Control+Option+F11');
  const plan=planSelection(latest.data,[0],{},win.preferences.shortcuts,win.profile,'win32');assert.equal(plan.accepted,1);assert.equal(plan.shortcuts[0].accelerator,'Ctrl+Alt+F11');assert.equal(win.preferences.shortcuts.length,0);assert.equal(mac.preferences.shortcuts[0].accelerator,'Control+Option+F11');
  const peer=structuredClone(win.peers[0]);await win.unpair(mac.identity.id);await assert.rejects(win.readPeerShortcuts(mac.identity.id),/配对/);await assert.rejects(win.network.call(peer,'GET','/shortcuts'),/配对/);
});
