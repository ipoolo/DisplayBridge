const {test}=require('node:test'),assert=require('node:assert/strict');
const {KeyboardFollow}=require('../src/keyboard-follow.cjs');
const {validateAction,planImport,exportShortcuts}=require('../src/shortcuts.cjs');
function fixture(kind='keyboard'){
  let attached='b',online=new Set(['a','b']);const controllers={},writes=[],routes=[];
  for(const [id,other] of [['a','b'],['b','a']]){
    const service={identity:{id},preferences:{keyboardFollow:false,mouseFollow:false},profile:{devices:[{id:'a'},{id:'b'},{id:'c'}],primaryId:'main',revision:'revision',keyboardChannels:{a:1,b:3,c:2},mouseChannels:{a:1,b:3,c:2}},peers:[{id:other}],online:()=>online,refresh:async()=>{throw Error('Display refresh should not be needed');},refreshPeers:async()=>{},states:()=>{throw Error('Primary status should not be needed');},network:{call:async(peer,method,route,data)=>{routes.push(route);return method==='GET'?controllers[peer.id].localStatus():controllers[peer.id].receiveManual(data);}}};
    const probe={inspect:async()=>attached===id?{status:'ready',currentChannel:service.profile[kind+'Channels'][id]}:{status:'not-connected'},switchTo:async channel=>{writes.push({kind,channel});attached=channel===1?'a':'b';return {status:'sent'};}};
    controllers[id]=new KeyboardFollow(service,probe,kind);
  }
  return {...controllers,writes,routes,setOnline:value=>online=new Set(value)};
}
for(const kind of ['keyboard','mouse'])test(kind+' manual cycle skips offline channel, wraps, and direct target works with follow disabled',async()=>{
  const {a,b,writes,routes}=fixture(kind);
  assert.equal((await a.manual({type:kind+'-cycle'})).status,'confirmed');
  assert.equal((await a.manual({type:kind+'-cycle'})).status,'confirmed');
  assert.equal((await a.manual({type:kind+'-switch',deviceId:'a'})).status,'confirmed');
  assert.equal((await a.manual({type:kind+'-switch',deviceId:'a'})).status,'confirmed');
  assert.deepEqual(writes,[{kind,channel:1},{kind,channel:3},{kind,channel:1}]);
  assert.ok(routes.includes('/'+kind+'-switch'));assert.ok(!routes.some(r=>r.includes('follow')));
  for(const controller of [a,b])assert.deepEqual(controller.service.preferences,{keyboardFollow:false,mouseFollow:false});
});
test('offline, unmapped, ambiguous, unknown current and old peer version never write',async()=>{
  for(const setup of [x=>x.setOnline(['b']),x=>delete x.a.service.profile.keyboardChannels.a,x=>{x.a.probe.inspect=async()=>({status:'ready',currentChannel:1});},x=>{x.b.probe.inspect=async()=>({status:'not-connected'});},x=>{x.b.localStatus=async()=>({deviceId:'b',probe:{status:'ready',currentChannel:3}});}]){
    const f=fixture();setup(f);assert.equal((await f.a.manual({type:'keyboard-switch',deviceId:'a'})).status,'failed');assert.equal(f.writes.length,0);
  }
});
test('manual receiver rejects stale configuration, busy controller, channel changes and unpaired targets',async()=>{
  const {b,writes}=fixture(),request={revision:'revision',targetDeviceId:'a',sourceChannel:3};
  await assert.rejects(b.receiveManual({...request,revision:'old'}),/配置/);
  b.service.busy=true;await assert.rejects(b.receiveManual(request),/正在切换/);b.service.busy=false;
  await assert.rejects(b.receiveManual({...request,targetDeviceId:'c'}),/尚未配对/);
  b.probe.inspect=async()=>{b.service.profile.revision='changed';return {status:'ready',currentChannel:3};};
  await assert.rejects(b.receiveManual(request),/变化/);assert.equal(writes.length,0);assert.equal(b.busy,false);
});
test('input shortcut actions survive export/import, reject missing mappings and keep conflict checks',()=>{
  const p={devices:[{id:'a'},{id:'b'}],keyboardChannels:{a:1,b:3},mouseChannels:{a:1,b:3}};
  const actions=['keyboard','mouse'].flatMap(k=>[{type:k+'-cycle'},{type:k+'-switch',deviceId:'b'}]);
  for(const action of actions)assert.deepEqual(validateAction(action,p),action);
  const entries=actions.map((action,i)=>({accelerator:'Ctrl+Alt+F'+(i+1),action}));
  const result=planImport(exportShortcuts(entries),[],p);assert.equal(result.accepted,4);
  assert.equal(planImport(exportShortcuts(entries),result.shortcuts,p).accepted,0);
  assert.throws(()=>validateAction({type:'mouse-switch',deviceId:'missing'},p),/通道/);
  assert.throws(()=>validateAction({type:'mouse-cycle'},{...p,mouseChannels:{a:1}}),/至少两台/);
});

test('combined preflight expectations reject a changed source or revision before a standalone write',async()=>{
  const f=fixture();assert.equal((await f.a.manual({type:'keyboard-switch',deviceId:'a'},{revision:'old',sourceDeviceId:'b'})).status,'failed');
  assert.equal((await f.a.manual({type:'keyboard-switch',deviceId:'a'},{revision:'revision',sourceDeviceId:'a'})).status,'failed');assert.equal(f.writes.length,0);
});
