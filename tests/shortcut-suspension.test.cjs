const {test}=require('node:test'),assert=require('node:assert/strict');
const {ShortcutSuspension}=require('../src/shortcut-suspension.cjs');
test('shortcut suspension immediately refreshes registration and a stale dialog cannot resume a newer one',()=>{
  const active=[];const gate=new ShortcutSuspension(()=>active.push(gate.active));
  const first=gate.begin();assert.equal(gate.active,true);assert.equal(gate.begin(),first);assert.deepEqual(active,[true]);
  assert.equal(gate.end('foreign-token'),false);assert.equal(gate.active,true);gate.end(first);assert.equal(gate.active,false);
  const second=gate.begin();assert.notEqual(second,first);gate.end(first);assert.equal(gate.active,true);gate.end(second);assert.deepEqual(active,[true,false,true,false]);
});
test('renderer failure or hide resets transient suspension without changing persisted preferences',()=>{
  let calls=0;const gate=new ShortcutSuspension(()=>calls++);assert.equal(gate.reset(),false);gate.begin();assert.equal(gate.reset(),true);assert.equal(gate.active,false);assert.equal(gate.reset(),false);assert.equal(calls,2);
});
