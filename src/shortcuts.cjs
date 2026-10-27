const {randomUUID}=require('node:crypto');
const FORMAT='displaybridge-shortcuts';
function normalizeAccelerator(value,platform=process.platform){
  if(typeof value!=='string'||!value.trim()||value.length>100)throw Error('快捷键格式无效');
  const parts=value.split('+').map(x=>x.trim().toLowerCase()),mods=new Set();
  const aliases={ctrl:'Ctrl',control:'Ctrl',alt:'Alt',option:'Alt',shift:'Shift',cmd:'Command',command:'Command',meta:'Super',super:'Super',win:'Super',windows:'Super',commandorcontrol:platform==='darwin'?'Command':'Ctrl',cmdorctrl:platform==='darwin'?'Command':'Ctrl'};
  const key=parts.pop();
  for(const p of parts){if(!aliases[p]||mods.has(aliases[p]))throw Error('修饰键无效或重复');mods.add(aliases[p]);}
  const names={esc:'Escape',escape:'Escape',enter:'Return',return:'Return',space:'Space',plus:'Plus',tab:'Tab',backspace:'Backspace',delete:'Delete',insert:'Insert',home:'Home',end:'End',pageup:'PageUp',pagedown:'PageDown',up:'Up',down:'Down',left:'Left',right:'Right',capslock:'Capslock',numlock:'Numlock',scrolllock:'Scrolllock',volumeup:'VolumeUp',volumedown:'VolumeDown',volumemute:'VolumeMute',medianexttrack:'MediaNextTrack',mediaprevioustrack:'MediaPreviousTrack',mediastop:'MediaStop',mediaplaypause:'MediaPlayPause',printscreen:'PrintScreen',numdec:'numdec',numadd:'numadd',numsub:'numsub',nummult:'nummult',numdiv:'numdiv'};
  const normalized=names[key]||(/^[a-z0-9]$/.test(key)||/^f([1-9]|1\d|2[0-4])$/.test(key)?key.toUpperCase():/^num[0-9]$/.test(key)||/^[,./;'\[\]\\`=\-]$/.test(key)?key:null);
  if(!normalized)throw Error('无法识别快捷键按键');
  if(platform==='win32'&&mods.has('Command'))throw Error('Command 不能直接用于 Windows，请改成 Ctrl 或 Windows 键');
  return [...['Command','Ctrl','Alt','Shift','Super'].filter(m=>mods.has(m)),normalized].join('+');
}
function validateAction(action,profile){
  if(!action||typeof action!=='object')throw Error('缺少执行动作');
  if(action.type==='input-cycle'){
    const valid=n=>Number.isInteger(n)&&n>=1&&n<=3;
    if(profile.devices.filter(d=>valid(profile.keyboardChannels?.[d.id])&&valid(profile.mouseChannels?.[d.id])).length<2)throw Error('请先为至少两台电脑同时配置键盘和鼠标通道');
    return {type:'input-cycle'};
  }
  if(['keyboard-cycle','keyboard-switch','mouse-cycle','mouse-switch'].includes(action.type)){
    const kind=action.type.split('-')[0],label=kind==='keyboard'?'键盘':'鼠标',channels=profile[kind+'Channels']||{};
    const configured=profile.devices.filter(d=>Number.isInteger(channels[d.id])&&channels[d.id]>=1&&channels[d.id]<=3);
    if(action.type.endsWith('-cycle')){if(configured.length<2)throw Error('请先为至少两台电脑配置'+label+'通道');return {type:action.type};}
    if(!configured.some(d=>d.id===action.deviceId))throw Error('目标电脑的'+label+'通道尚未配置');
    return {type:action.type,deviceId:action.deviceId};
  }
  if(action.type==='scene'||action.type==='cycle'){
    if(!profile[action.type==='scene'?'scenes':'cycles'].some(x=>x.id===action.id))throw Error(action.type==='scene'?'找不到对应场景':'找不到对应循环');
    return {type:action.type,id:action.id};
  }
  if(action.type==='switch'||action.type==='monitor-cycle'){
    const m=profile.monitors.find(m=>m.id===action.monitorId);if(!m)throw Error('找不到对应显示器');
    if(action.type==='monitor-cycle')return {type:action.type,monitorId:m.id};
    if(!profile.devices.some(d=>d.id===action.deviceId))throw Error('找不到目标电脑');
    if(!Number.isInteger(m.inputs[action.deviceId]))throw Error('目标电脑的输入接口尚未配置');
    return {type:'switch',monitorId:m.id,deviceId:action.deviceId};
  }
  throw Error('不支持的快捷键动作');
}
function exportShortcuts(shortcuts,platform=process.platform){
  return {format:FORMAT,version:1,exportedAt:new Date().toISOString(),sourceOS:platform==='darwin'?'macOS':'Windows',shortcuts:shortcuts.map(s=>({accelerator:s.accelerator,action:structuredClone(s.action)}))};
}
function planImport(data,existing,profile,mode='merge',platform=process.platform){
  if(!['merge','replace'].includes(mode))throw Error('导入方式无效');
  if(!data||data.format!==FORMAT||data.version!==1||!Array.isArray(data.shortcuts)||data.shortcuts.length>100||JSON.stringify(data).length>1048576)throw Error('请选择有效的屏间快捷键 JSON 文件（最多 100 条）');
  const shortcuts=mode==='merge'?structuredClone(existing):[],used=new Map(shortcuts.map(s=>{let key;try{key=normalizeAccelerator(s.accelerator,platform);}catch{key=s.accelerator.toLowerCase();}return [key,s.action];}));
  const rows=data.shortcuts.map((s,index)=>{
    const row={index,accelerator:typeof s?.accelerator==='string'?s.accelerator.slice(0,100):'',action:null,ok:false};
    try{
      const action=validateAction(s?.action,profile);row.action=action;const accelerator=normalizeAccelerator(s?.accelerator,platform);row.accelerator=accelerator;
      if(used.has(accelerator)){
        let prior;try{prior=validateAction(used.get(accelerator),profile);}catch{}
        if(prior&&JSON.stringify(prior)===JSON.stringify(action)){row.duplicate=true;throw Error('本机或清单中已有相同配置');}
        throw Error('与已有或文件内其他快捷键冲突');
      }
      if(shortcuts.length>=100)throw Error('合并后超过 100 条快捷键');
      used.set(accelerator,action);shortcuts.push({id:randomUUID(),accelerator,action});row.ok=true;
    }catch(e){row.reason=e.message;}
    return row;
  });
  return {mode,shortcuts,rows,accepted:rows.filter(r=>r.ok).length,skipped:rows.filter(r=>!r.ok).length,replaced:mode==='replace'?existing.length:0};
}
function planSelection(data,selection,edits,existing,profile,platform=process.platform){
  planImport(data,[],profile,'merge',platform);
  if(!Array.isArray(selection)||new Set(selection).size!==selection.length||selection.some(i=>!Number.isInteger(i)||i<0||i>=data.shortcuts.length))throw Error('请选择有效的快捷键条目');
  if(!edits||typeof edits!=='object'||Array.isArray(edits)||Object.entries(edits).some(([i,value])=>!/^\d+$/.test(i)||Number(i)>=data.shortcuts.length||typeof value!=='string'||value.length>100))throw Error('修改后的快捷键格式无效');
  const amended=data.shortcuts.map((s,i)=>({...s,accelerator:Object.hasOwn(edits,i)?edits[i]:s?.accelerator})),indices=[...selection].sort((a,b)=>a-b);
  const result=planImport({...data,shortcuts:indices.map(i=>amended[i])},existing,profile,'merge',platform);
  const chosen=new Map(result.rows.map((row,i)=>[indices[i],{...row,index:indices[i],selected:true}]));
  const rows=amended.map((s,index)=>chosen.get(index)||{...planImport({...data,shortcuts:[s]},result.shortcuts,profile,'merge',platform).rows[0],index,selected:false});
  return {...result,rows};
}
module.exports={normalizeAccelerator,validateAction,exportShortcuts,planImport,planSelection};
