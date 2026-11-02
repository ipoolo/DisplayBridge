const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Service}=require('../src/service.cjs');
const {dataDirectory,atomic,loadSettings,legacyCandidates,migrateLegacy}=require('../src/storage.cjs');
const {advance}=require('../src/profile-sync.cjs');
const backend={scan:async()=>[],set:async()=>{throw Error('Hardware writes forbidden');}};
function make(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'displaybridge-store-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const service=new Service({dir,backend});t.after(()=>service.close());return service;}
function configured(s){const p=structuredClone(s.profile);p.monitors=[{id:'screen',name:'Screen',inputs:{[s.identity.id]:16,[p.devices[1].id]:18},endpoints:{}}];p.primaryId='screen';p.userEdited=true;return advance(p,true);}
test('stable Windows data directory ignores parent AppData and migration keeps identity, shortcuts and matching credentials',t=>{
  const s=make(t);s.commitProfile(configured(s));s.preferences.shortcuts=[{id:'hotkey',accelerator:'Ctrl+F9',action:{type:'monitor-cycle',monitorId:'screen'}}];s.persist();fs.writeFileSync(s.secretFile,'opaque paired credentials');
  fs.writeFileSync(path.join(s.dir,'Local State'),'matching encrypted key fixture');
  const target=path.join(s.dir,'stable'),home=path.join(s.dir,'home');
  assert.equal(dataDirectory('win32',home,'redirected'),dataDirectory('win32',home,'ordinary'));
  assert.equal(dataDirectory('darwin',home,'mac-data'),'mac-data');
  assert.equal(migrateLegacy(target,s.dir),true);assert.equal(migrateLegacy(target,s.dir),false);
  const saved=loadSettings(path.join(target,'settings.json')).saved;assert.equal(saved.identity.id,s.identity.id);assert.equal(saved.preferences.shortcuts.length,1);assert.equal(saved.profile.monitors[0].inputs[s.profile.devices[1].id],18);
  assert.equal(fs.readFileSync(path.join(target,'peers.secure'),'utf8'),'opaque paired credentials');assert.ok(fs.existsSync(s.file));
  assert.equal(fs.readFileSync(path.join(target,'Local State'),'utf8'),'matching encrypted key fixture');
  assert.equal(legacyCandidates([s.dir,s.dir,target]).length,1);
  const other=JSON.parse(fs.readFileSync(path.join(target,'settings.json')));other.preferences.shortcuts=[];fs.writeFileSync(path.join(target,'settings.json'),JSON.stringify(other));assert.equal(legacyCandidates([s.dir,target]).length,2);
});
test('invalid settings recover a valid backup; no valid copy fails instead of resetting identity',t=>{
  const s=make(t);s.commitProfile(configured(s));s.preferences.shortcuts=[{id:'hotkey',accelerator:'Ctrl+F9',action:{type:'monitor-cycle',monitorId:'screen'}}];s.persist();s.preferences.theme='dark';s.persist();
  fs.writeFileSync(s.file,'broken JSON');const r=loadSettings(s.file);assert.ok(r.warning);assert.equal(r.saved.preferences.shortcuts.length,1);assert.equal(r.saved.identity.id,s.identity.id);assert.ok(fs.readdirSync(s.dir).some(n=>n.startsWith('settings.json.damaged-')));
  const isolated=path.join(s.dir,'bad','settings.json');fs.mkdirSync(path.dirname(isolated));fs.writeFileSync(isolated,'bad');assert.throws(()=>loadSettings(isolated),/未创建空配置/);
});
test('backup history is bounded and unchanged writes do not consume backups',t=>{
  const s=make(t);for(let n=0;n<24;n++)atomic(s.file,JSON.stringify({...loadSettings(s.file).saved,marker:n}));
  const dir=path.join(s.dir,'backups');assert.equal(fs.readdirSync(dir).length,20);const names=fs.readdirSync(dir);atomic(s.file,fs.readFileSync(s.file));assert.deepEqual(fs.readdirSync(dir),names);
});
test('failed settings write does not publish an unsaved in-memory profile',t=>{
  const s=make(t),before=structuredClone(s.profile);s.persist=()=>{throw Error('Disk full');};assert.throws(()=>s.commitProfile(configured(s)),/Disk full/);assert.deepEqual(s.profile,before);
});
test('stale, divergent and legacy shared profiles cannot remove mappings; confirmed replacement uses compare-and-swap and a backup',t=>{
  const s=make(t);s.commitProfile(configured(s));const before=structuredClone(s.profile),missing=structuredClone(before);delete missing.monitors[0].inputs[missing.devices[1].id];missing.revision='unrelated';missing.syncHistory=[];
  assert.throws(()=>s.receiveProfile(missing),/旧版/);
  assert.throws(()=>s.receiveProfile({syncVersion:2,profile:missing,baseRevision:before.revision}),/分歧/);assert.deepEqual(s.profile,before);
  assert.throws(()=>s.receiveProfile({syncVersion:2,profile:missing,baseRevision:'old',replace:true}),/已变化/);
  s.receiveProfile({syncVersion:2,profile:missing,baseRevision:before.revision,replace:true});assert.equal(s.profile.monitors[0].inputs[missing.devices[1].id],undefined);
  assert.ok(fs.readdirSync(path.join(s.dir,'backups')).some(n=>JSON.parse(fs.readFileSync(path.join(s.dir,'backups',n))).profile?.revision===before.revision));
});
test('descendant edits persist without deleting local shortcuts and replay is idempotent',t=>{
  const s=make(t);s.commitProfile(configured(s));s.preferences.shortcuts=[{id:'hotkey',accelerator:'Ctrl+F9',action:{type:'monitor-cycle',monitorId:'screen'}}];s.persist();
  const old=structuredClone(s.profile),next=advance(structuredClone(old),true);next.monitors[0].name='Renamed';const accepted=s.receiveProfile({syncVersion:2,profile:next,baseRevision:old.revision}).profile;
  s.receiveProfile({syncVersion:2,profile:accepted,baseRevision:accepted.revision});assert.equal(loadSettings(s.file).saved.preferences.shortcuts.length,1);assert.equal(loadSettings(s.file).saved.profile.monitors[0].name,'Renamed');
  assert.throws(()=>s.receiveProfile({syncVersion:2,profile:old,baseRevision:accepted.revision}),/分歧/);
});
test('two peers synchronize descendants, pull newer settings, and retain both sides on divergent edits',async t=>{
  const a=make(t),b=make(t),base=configured(a);base.devices.push(b.identity);a.commitProfile(base);b.commitProfile(structuredClone(base));
  a.peers=[b.identity];b.peers=[a.identity];
  a.network.call=async(p,method,route,body)=>structuredClone(method==='GET'?b.sharedProfile():b.receiveProfile(structuredClone(body),a.identity.id));
  b.network.call=async(p,method,route,body)=>structuredClone(method==='GET'?a.sharedProfile():a.receiveProfile(structuredClone(body),b.identity.id));
  const edit=structuredClone(a.profile);edit.monitors[0].name='Shared rename';await a.saveProfile(edit,edit.revision);assert.deepEqual(a.profile,b.profile);
  const newer=advance(structuredClone(b.profile),true);newer.monitors[0].name='Remote rename';b.commitProfile(newer);await a.sync();assert.deepEqual(a.profile,b.profile);assert.equal(a.profile.monitors[0].name,'Remote rename');
  const left=advance(structuredClone(a.profile),true),right=advance(structuredClone(b.profile),true);left.monitors[0].name='Left';right.monitors[0].name='Right';a.commitProfile(left);b.commitProfile(right);await a.sync();assert.equal(a.profile.monitors[0].name,'Left');assert.equal(b.profile.monitors[0].name,'Right');assert.match(a.syncStatus[b.identity.id],/分歧/);
});
test('empty first pairing can bootstrap; initialized local configuration cannot',t=>{
  const s=make(t),incoming=advance(structuredClone(s.profile),true);incoming.syncHistory=[];incoming.monitors=[{id:'screen',name:'New screen',inputs:{[s.identity.id]:16},endpoints:{}}];
  s.receiveProfile({syncVersion:2,profile:incoming,baseRevision:s.profile.revision});assert.equal(s.profile.monitors.length,1);
  const different=advance(structuredClone(incoming),true);different.syncHistory=[];assert.throws(()=>s.receiveProfile({syncVersion:2,profile:different,baseRevision:s.profile.revision}),/分歧/);
});
