const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Service}=require('../src/service.cjs');
const {rebindDevice,rebindShortcuts}=require('../src/device-identity.cjs');
function fixture(){return {devices:[{id:'old',name:'Custom name',os:'Windows'},{id:'new',name:'Computer',os:'Windows'}],monitors:[{id:'screen',inputs:{old:16},endpoints:{old:'native'},cycleDeviceIds:['old','new']}],keyboardChannels:{old:1},mouseChannels:{old:1},scenes:[{assignments:{screen:'old'}}]};}
test('confirmed identity replacement preserves mappings, scene identities, channels and shortcut references',()=>{
  const p=rebindDevice(fixture(),'old','new');assert.equal(p.devices.length,1);assert.equal(p.devices[0].name,'Custom name');assert.deepEqual(p.monitors[0],{id:'screen',inputs:{new:16},endpoints:{new:'native'},cycleDeviceIds:['new']});assert.equal(p.keyboardChannels.new,1);assert.equal(p.mouseChannels.new,1);assert.equal(p.scenes[0].assignments.screen,'new');
  assert.deepEqual(rebindShortcuts([{id:'key',action:{type:'keyboard-switch',deviceId:'old'}}],'old','new'),[{id:'key',action:{type:'keyboard-switch',deviceId:'new'}}]);
});
test('identity replacement refuses ambiguous mappings and different operating systems',()=>{
  const p=fixture();p.monitors[0].inputs.new=18;assert.throws(()=>rebindDevice(p,'old','new'),/冲突/);
  const q=fixture();q.devices[1].os='macOS';assert.throws(()=>rebindDevice(q,'old','new'),/不同系统/);
});
test('same address with a different hello identity is a warning, never trusted as a new pairing',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'displaybridge-identity-')),s=new Service({dir,backend:{scan:async()=>[]}});t.after(()=>{s.close();fs.rmSync(dir,{recursive:true,force:true});});
  s.peers=[{id:'original',name:'Peer',host:'127.0.0.1',port:1234}];s.network.call=async()=>{throw Error('尚未配对或配对已失效');};s.network.hello=async()=>({device:{id:'different'}});const before=structuredClone(s.profile);
  await s.refreshPeers();assert.equal(s.peers.length,1);assert.equal(s.peers[0].id,'original');assert.deepEqual(s.profile,before);assert.match(s.remote.get('original').error,/身份已变化/);
});
test('failed re-pairing never removes existing device identity or configuration',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'displaybridge-identity-')),s=new Service({dir,backend:{scan:async()=>[]}});t.after(()=>{s.close();fs.rmSync(dir,{recursive:true,force:true});});
  s.peers=[{id:'original',name:'Peer',host:'127.0.0.1',port:1234}];s.network.pair=async()=>{throw Error('配对码无效');};const before=structuredClone(s.profile);
  await assert.rejects(s.pair('127.0.0.1',1234,'bad','original'),/配对码/);assert.equal(s.peers[0].id,'original');assert.deepEqual(s.profile,before);
});
