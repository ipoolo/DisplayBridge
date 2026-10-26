const {test}=require('node:test'),assert=require('node:assert/strict');
const {normalizeAccelerator,exportShortcuts,planImport,planSelection}=require('../src/shortcuts.cjs');
const p={monitors:[{id:'m',inputs:{pc:15,mac:18}}],devices:[{id:'pc'},{id:'mac'}],scenes:[{id:'s'}],cycles:[{id:'c'}]};
const entry=(accelerator,action={type:'monitor-cycle',monitorId:'m'})=>({id:'old',accelerator,action});
test('shortcut export/import round trip strips IDs and unrelated sensitive properties',()=>{
  const s=entry('Control+Option+F9');s.token='private';const file=exportShortcuts([s],'darwin');assert.equal(file.format,'displaybridge-shortcuts');assert.equal(file.sourceOS,'macOS');assert.ok(!JSON.stringify(file).includes('private'));
  const plan=planImport(JSON.parse(JSON.stringify(file)),[],p,'merge','win32');assert.equal(plan.accepted,1);assert.equal(plan.shortcuts[0].accelerator,'Ctrl+Alt+F9');assert.notEqual(plan.shortcuts[0].id,'old');assert.deepEqual(plan.shortcuts[0].action,s.action);
});
test('merge detects aliases and modifier order conflicts; replace excludes previous bindings',()=>{
  const old=[entry('Ctrl+Alt+F9')],data=exportShortcuts([entry('Option+Control+F9'),entry('Ctrl+F10'),entry('Control+F10')]);
  const merged=planImport(data,old,p,'merge','win32');assert.equal(merged.accepted,1);assert.equal(merged.skipped,2);assert.equal(merged.shortcuts.length,2);assert.equal(merged.shortcuts[0].id,'old');
  const replacement=planImport(data,old,p,'replace','win32');assert.equal(replacement.accepted,2);assert.equal(replacement.skipped,1);assert.equal(replacement.replaced,1);
});
test('imports reject missing actions, invalid keys and incompatible Command without remapping it',()=>{
  assert.equal(normalizeAccelerator('Command+Option+K','darwin'),'Command+Alt+K');assert.equal(normalizeAccelerator('Control+K','darwin'),'Ctrl+K');assert.throws(()=>normalizeAccelerator('Command+K','win32'),/Command/);
  const data=exportShortcuts([entry('Ctrl+F9',{type:'scene',id:'missing'}),entry('Ctrl+F10',{type:'monitor-cycle',monitorId:'missing'}),entry('Ctrl+F11',{type:'switch',monitorId:'m',deviceId:'missing'}),entry('Ctrl+Wut'),entry('Ctrl+Ctrl+K'),entry('Ctrl+F12',{type:'shell',id:'bad'})]);
  const plan=planImport(data,[],p);assert.equal(plan.accepted,0);assert.equal(plan.skipped,6);assert.ok(plan.rows.every(r=>r.reason));
});
test('import enforces file schema, limits and valid existing target mappings',()=>{
  assert.throws(()=>planImport({},[],p),/JSON/);assert.throws(()=>planImport({...exportShortcuts([]),version:2},[],p),/JSON/);
  assert.throws(()=>planImport(exportShortcuts(Array(101).fill(entry('F1'))),[],p),/JSON/);
  const plan=planImport(exportShortcuts([entry('F1',{type:'scene',id:'s'}),entry('F2',{type:'cycle',id:'c'}),entry('F3',{type:'switch',monitorId:'m',deviceId:'mac'})]),[],p);assert.equal(plan.accepted,3);
});
test('device sync previews duplicates, accepts only selected edited keys and leaves source unchanged',()=>{
  const existing=[entry('Ctrl+F9')],data=exportShortcuts([entry('Control+F9'),entry('Ctrl+F9',{type:'scene',id:'s'}),entry('Ctrl+F10',{type:'scene',id:'s'}),entry('Ctrl+F11',{type:'scene',id:'missing'})]);
  const original=JSON.stringify(data),initial=planImport(data,existing,p);assert.equal(initial.rows[0].duplicate,true);assert.equal(initial.rows[1].duplicate,undefined);assert.equal(initial.rows[1].ok,false);
  const plan=planSelection(data,[1],{1:'Control+Option+F12'},existing,p,'win32');assert.equal(plan.accepted,1);assert.equal(plan.shortcuts.length,2);assert.equal(plan.shortcuts[1].accelerator,'Ctrl+Alt+F12');assert.equal(plan.rows[2].selected,false);assert.equal(plan.rows[2].ok,true);assert.equal(plan.rows[3].ok,false);assert.equal(JSON.stringify(data),original);assert.equal(existing.length,1);
  const all=planSelection(data,[],{},existing,p);assert.equal(all.accepted,0);assert.equal(all.shortcuts.length,1);
});
test('device sync rejects invalid selection indexes and conflicting edited bindings',()=>{
  const data=exportShortcuts([entry('F1'),entry('F2')]);assert.throws(()=>planSelection(data,[2],{},[],p),/条目/);assert.throws(()=>planSelection(data,[0,0],{},[],p),/条目/);assert.throws(()=>planSelection(data,[0],{'999':'F3'},[],p),/格式/);
  const plan=planSelection(data,[0,1],{0:'Ctrl+K',1:'Control+K'},[],p);assert.equal(plan.accepted,1);assert.equal(plan.skipped,1);assert.equal(plan.rows[1].duplicate,true);
});
