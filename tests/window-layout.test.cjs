const {test}=require('node:test'),assert=require('node:assert/strict');
const {linkDisplays,relocationTarget,fitWindow}=require('../src/window-layout.cjs');
test('window binding handles Mac IDs and mixed-DPI Windows bounds without guessing duplicate names',()=>{
  const displays=[{id:10,label:'Same',bounds:{x:0,y:0,width:1000,height:800},physicalBounds:{x:0,y:0,width:1500,height:1200}},{id:20,label:'Same',bounds:{x:1000,y:0,width:1000,height:800},physicalBounds:{x:1500,y:0,width:1000,height:800}}];
  assert.deepEqual(linkDisplays([{id:'a',displayId:10},{id:'b',bounds:displays[1].physicalBounds}],displays),{a:10,b:20});
  assert.deepEqual(linkDisplays([{id:'unknown',name:'Same'}],displays),{});
});
test('move only to a screen that remains on this computer, including a whole-scene plan',()=>{
  const displays=[{id:1},{id:2}],profile={monitors:[{id:'a',endpoints:{pc:'na'}},{id:'b',endpoints:{pc:'nb'}}]},states={a:{confirmed:true,deviceId:'pc'},b:{confirmed:true,deviceId:'pc'}};
  const base={profile,states,identityId:'pc',bindings:{na:1,nb:2},currentDisplayId:1,displays};
  assert.equal(relocationTarget({...base,assignments:{a:'mac'}}).id,2);
  assert.equal(relocationTarget({...base,assignments:{a:'mac',b:'mac'}}),null);
  assert.equal(relocationTarget({...base,states:{...states,b:{confirmed:false}},assignments:{a:'mac'}}),null);
  assert.equal(relocationTarget({...base,assignments:{b:'mac'}}),null);
  assert.equal(relocationTarget({...base,states:{...states,a:{confirmed:true,deviceId:'mac'}}}).id,2);
});
test('relocated window fits a smaller work area at negative coordinates',()=>{
  assert.deepEqual(fitWindow({width:1180,height:820},{x:-1000,y:100,width:1000,height:700}),{x:-1000,y:100,width:1000,height:700});
});
