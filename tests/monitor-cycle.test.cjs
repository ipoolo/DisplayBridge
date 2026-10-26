const {test}=require('node:test'),assert=require('node:assert/strict');
const {chooseNextDevice,validateProfile}=require('../src/core.cjs');
const {sceneDescription,orderedSceneMonitors,sceneVisual,customSceneName}=require('../src/ui/icons.js');
const profile=()=>({version:1,revision:'r',devices:[{id:'pc',name:'PC',os:'Windows'},{id:'mac',name:'Mac',os:'macOS'},{id:'studio',name:'Studio',os:'macOS'}],monitors:[{id:'b',name:'Right',inputs:{pc:15,mac:18,studio:17},endpoints:{}},{id:'a',name:'Left',inputs:{pc:16,mac:18},endpoints:{}}],groups:[{id:'g',name:'Desk',monitorIds:['a','b']}],scenes:[],cycles:[],primaryId:'a'});
test('single monitor cycle follows configured order, wraps and skips offline/unmapped targets',()=>{
  const p=profile(),m=p.monitors[0],all=new Set(['pc','mac','studio']);m.cycleDeviceIds=['studio','pc','mac'];
  for(const [current,next] of [['studio','pc'],['pc','mac'],['mac','studio']])assert.equal(chooseNextDevice(p,m.id,{deviceId:current,confirmed:true},all),next);
  assert.equal(chooseNextDevice(p,m.id,{deviceId:'pc',confirmed:true},new Set(['pc','studio'])),'studio');
  delete m.inputs.mac;assert.equal(chooseNextDevice(p,m.id,{deviceId:'pc',confirmed:true},all),'studio');
  assert.equal(chooseNextDevice(p,'a',{deviceId:'pc',confirmed:true},all),'mac');
});
test('single monitor cycle never guesses unknown input or rewrites current-only targets',()=>{
  const p=profile(),all=new Set(['pc','mac','studio']);
  assert.throws(()=>chooseNextDevice(p,'b',{confirmed:false,deviceId:'pc'},all),/无法确认/);
  assert.throws(()=>chooseNextDevice(p,'b',{confirmed:true,deviceId:null},all),/无法确认/);
  assert.throws(()=>chooseNextDevice(p,'b',{confirmed:true,deviceId:'pc'},new Set(['pc'])),/没有其他/);
  p.monitors[0].cycleDeviceIds=[];assert.throws(()=>chooseNextDevice(p,'b',{confirmed:true,deviceId:'pc'},all),/没有其他/);
  p.monitors[0].cycleDeviceIds=['mac','studio'];assert.equal(chooseNextDevice(p,'b',{confirmed:true,deviceId:'pc'},all),'mac');
});
test('shared monitor cycle order validates duplicate and foreign devices',()=>{
  const p=profile();p.monitors[0].cycleDeviceIds=['mac','pc'];assert.doesNotThrow(()=>validateProfile(p));
  p.monitors[0].cycleDeviceIds=['mac','mac'];assert.throws(()=>validateProfile(p),/单屏循环/);
  p.monitors[0].cycleDeviceIds=['foreign'];assert.throws(()=>validateProfile(p),/单屏循环/);
});
test('scene visuals follow desktop order, distinguish same OS aliases, escape names and preserve custom titles',()=>{
  const p=profile(),s={name:'混合工作台 1',assignments:{a:'pc',b:'studio'}};
  assert.deepEqual(orderedSceneMonitors(p,s).map(m=>m.id),['b','a']);
  assert.equal(sceneDescription(p,s),'1 Studio · 2主 Windows');assert.equal(customSceneName(s),'');
  s.name='我的工作区';assert.equal(customSceneName(s),s.name);s.autoName=true;assert.equal(customSceneName(s),'');
  p.devices[2].name='<img src=x onerror=alert(1)>';assert.ok(!sceneVisual(p,s).includes('<img'));
  p.devices=p.devices.filter(d=>d.id!=='mac');assert.equal(sceneDescription(p,s),'1 Mac · 2主 Windows');p.primaryId='b';assert.equal(sceneDescription(p,s),'1主 Mac · 2 Windows');
});
