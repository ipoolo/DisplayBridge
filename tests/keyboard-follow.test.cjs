const {test}=require('node:test'),assert=require('node:assert/strict');
const {KeyboardFollow}=require('../src/keyboard-follow.cjs');
const {validateProfile,createProfile}=require('../src/core.cjs');
function fixture(kind='keyboard'){
  let attached='b';const controllers={},writes=[];
  for(const [id,other] of [['a','b'],['b','a']]){
    const service={identity:{id},preferences:{keyboardFollow:true,mouseFollow:kind==='mouse'},profile:{primaryId:'main',revision:'revision',keyboardChannels:{a:1,b:3},mouseChannels:{a:2,b:1}},peers:[{id:other}],online:()=>new Set(['a','b']),refresh:async()=>{},refreshPeers:async()=>{},states:()=>({main:{confirmed:true,deviceId:'a'}}),network:{call:async(peer,method,route,data)=>route==='/'+kind?controllers[peer.id].localStatus():controllers[peer.id].receive(data)}};
    const probe={inspect:async()=>attached===id?{status:'ready',currentChannel:service.profile[kind+'Channels'][id]}:{status:'not-connected'},switchTo:async channel=>{writes.push(channel);attached=channel===service.profile[kind+'Channels'].a?'a':'b';return {status:'sent'};}};
    controllers[id]=new KeyboardFollow(service,probe,kind);
  }return {...controllers,writes};
}
test('confirmed primary follows via authenticated controller and verifies arrival, then no-ops',async()=>{
  const {a,writes}=fixture();assert.equal((await a.follow('a')).status,'confirmed');assert.deepEqual(writes,[1]);assert.equal((await a.follow('a')).status,'confirmed');assert.deepEqual(writes,[1]);
});
test('disabled or mismatched primary/configuration/keyboard channel never writes',async()=>{
  const {a,b,writes}=fixture();a.service.preferences.keyboardFollow=false;assert.equal((await a.follow('a')).status,'disabled');
  b.service.preferences.keyboardFollow=false;await assert.rejects(b.receive({targetDeviceId:'a',primaryId:'main',revision:'revision'}),/未开启/);b.service.preferences.keyboardFollow=true;
  await assert.rejects(b.receive({targetDeviceId:'a',primaryId:'other',revision:'revision'}),/已变化/);
  await assert.rejects(b.receive({targetDeviceId:'a',primaryId:'main',revision:'old'}),/已变化/);
  b.service.states=()=>({main:{confirmed:false,deviceId:'a'}});await assert.rejects(b.receive({targetDeviceId:'a',primaryId:'main',revision:'revision'}),/尚未确认/);
  b.service.states=()=>({main:{confirmed:true,deviceId:'a'}});b.probe.inspect=async()=>({status:'ready',currentChannel:2});await assert.rejects(b.receive({targetDeviceId:'a',primaryId:'main',revision:'revision'}),/不一致/);assert.equal(writes.length,0);
});
test('turning follow off during a read cancels the pending hardware write',async()=>{
  const {b,writes}=fixture();b.probe.inspect=async()=>{b.service.preferences.keyboardFollow=false;return {status:'ready',currentChannel:3};};
  await assert.rejects(b.receive({targetDeviceId:'a',primaryId:'main',revision:'revision'}),/已变化/);assert.equal(writes.length,0);
});
test('shared channel mappings reject duplicate, invalid and foreign channels',()=>{
  const p=createProfile({id:'a',name:'PC',os:'Windows'});p.keyboardChannels={a:1,'unpaired-mac':3};assert.equal(validateProfile(p),p);
  for(const channels of [{a:1,'unpaired-mac':1},{a:4},{foreign:1},[],null])assert.throws(()=>validateProfile({...p,keyboardChannels:channels}),/键盘通道/);
});
test('mouse follow uses its own switch and mappings independently of keyboard',async()=>{
  const {a,b,writes}=fixture('mouse');a.service.preferences.keyboardFollow=false;b.service.preferences.keyboardFollow=false;
  const result=await a.follow('a');assert.equal(result.status,'confirmed');assert.match(result.message,/鼠标/);assert.deepEqual(writes,[2]);
  a.service.preferences.mouseFollow=false;a.service.preferences.keyboardFollow=true;assert.equal((await a.follow('b')).status,'disabled');assert.deepEqual(writes,[2]);
});
