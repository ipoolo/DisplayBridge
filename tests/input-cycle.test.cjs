const {test}=require('node:test'),assert=require('node:assert/strict');
const {cycleInputs}=require('../src/input-cycle.cjs');
const {validateAction,planImport,planSelection,exportShortcuts}=require('../src/shortcuts.cjs');
function fixture(mouseId='a',keyboardId='a'){
  const owner={mouse:mouseId,keyboard:keyboardId},calls=[],online=new Set(['a','b']);
  const service={identity:{id:'a'},peers:[{id:'b'},{id:'c'}],online:()=>online,profile:{revision:'r1',devices:[{id:'a',name:'PC'},{id:'b',name:'Mac'},{id:'c',name:'Other'}],mouseChannels:{a:1,c:2,b:3},keyboardChannels:{a:3,c:2,b:1}}};
  const make=kind=>({kind,channel:id=>service.profile[kind+'Channels'][id],status:async id=>({deviceId:id,manualSwitch:true,probe:owner[kind]===id?{status:'ready',currentChannel:service.profile[kind+'Channels'][id]}:{status:'not-connected'}}),manual:async(action,expected)=>{calls.push({kind,action,expected});owner[kind]=action.deviceId;return {status:'confirmed',message:kind+' switched'};}});
  return {service,keyboard:make('keyboard'),mouse:make('mouse'),calls,owner,online};
}
test('combined cycle always derives the common computer from the mouse, including split ownership',async()=>{
  for(const [mouse,keyboard,target] of [['a','a','b'],['a','b','b'],['b','a','a']]){
    const f=fixture(mouse,keyboard),result=await cycleInputs(f.service,f.keyboard,f.mouse);
    assert.equal(result.status,'confirmed');assert.equal(result.targetDeviceId,target);assert.deepEqual(f.owner,{mouse:target,keyboard:target});
    assert.ok(f.calls.every(c=>c.action.type===c.kind+'-switch'&&c.action.deviceId===target));
    assert.equal(f.calls.find(c=>c.kind==='mouse').expected.sourceDeviceId,mouse);
  }
});
test('common target order uses mouse channels, skips offline and keyboard-unmapped computers, then wraps',async()=>{
  const f=fixture();f.online.add('c');assert.equal((await cycleInputs(f.service,f.keyboard,f.mouse)).targetDeviceId,'c');
  assert.equal((await cycleInputs(f.service,f.keyboard,f.mouse)).targetDeviceId,'b');
  assert.equal((await cycleInputs(f.service,f.keyboard,f.mouse)).targetDeviceId,'a');
  delete f.service.profile.keyboardChannels.c;assert.equal((await cycleInputs(f.service,f.keyboard,f.mouse)).targetDeviceId,'b');
});
test('uncertain mouse or keyboard, invalid mappings, unsupported peer and no common target abort before writes',async()=>{
  for(const setup of [f=>f.owner.mouse=null,f=>f.owner.keyboard=null,f=>{f.mouse.status=async id=>({deviceId:id,manualSwitch:true,probe:{status:'ready',currentChannel:f.mouse.channel(id)}});},f=>f.online.delete('b'),f=>delete f.service.profile.keyboardChannels.b,f=>{f.mouse.status=async id=>({deviceId:id,manualSwitch:false,probe:id==='a'?{status:'ready',currentChannel:1}:{status:'not-connected'}}); }]){
    const f=fixture();setup(f);await assert.rejects(cycleInputs(f.service,f.keyboard,f.mouse));assert.equal(f.calls.length,0);
  }
});
test('a configuration change during preflight prevents both writes',async()=>{
  const f=fixture(),status=f.mouse.status;f.mouse.status=async id=>{const s=await status(id);f.service.profile.revision='r2';return s;};
  await assert.rejects(cycleInputs(f.service,f.keyboard,f.mouse),/配置已变化/);assert.equal(f.calls.length,0);
});
test('partial failure is reported per device without rollback or falsely reporting overall success',async()=>{
  const f=fixture();f.keyboard.manual=async()=>({status:'failed',message:'unavailable'});
  const r=await cycleInputs(f.service,f.keyboard,f.mouse);assert.equal(r.status,'failed');assert.equal(r.keyboard.status,'failed');assert.equal(r.mouse.status,'confirmed');assert.equal(f.owner.mouse,'b');assert.equal(f.owner.keyboard,'a');assert.match(r.message,/键盘失败.*鼠标已确认/);
});
test('combined action supports export, import and selected peer merge with common mapping validation',()=>{
  const f=fixture(),action={type:'input-cycle'};assert.deepEqual(validateAction({...action,deviceId:'ignored'},f.service.profile),action);
  const data=exportShortcuts([{accelerator:'Ctrl+Alt+F10',action}]);assert.equal(planImport(data,[],f.service.profile).accepted,1);
  assert.equal(planSelection(data,[0],{},[],f.service.profile).accepted,1);
  delete f.service.profile.keyboardChannels.b;delete f.service.profile.keyboardChannels.c;assert.throws(()=>validateAction(action,f.service.profile),/至少两台/);
});
