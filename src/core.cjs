const { randomUUID } = require('node:crypto');
const INPUTS = { 15:'DisplayPort 1',16:'DisplayPort 2',17:'HDMI 1',18:'HDMI 2',27:'USB-C' };
const inputLabel = n => n == null ? '未知输入' : INPUTS[n] || `输入 ${n} (0x${Number(n).toString(16).toUpperCase()})`;
const cleanName = s => String(s || '').replace(/[^a-z0-9]/gi,'').toLowerCase();
function parseInputs(capabilities='') {
  const match = capabilities.match(/\b60\s*\(([^()]*)\)/i);
  return match ? [...new Set((match[1].match(/[0-9a-f]+/gi)||[]).map(s=>parseInt(s,16)))].filter(n=>n>0 && n<=255) : [];
}
function createProfile(device) {
  const other = device.os==='macOS' ? {id:'unpaired-windows',name:'Windows PC',os:'Windows'} : {id:'unpaired-mac',name:'Mac',os:'macOS'};
  return { version:1, revision:randomUUID(), devices:[device,other], monitors:[], groups:[], scenes:[], cycles:[], primaryId:null };
}
function validateProfile(p) {
  if (!p || p.version!==1 || !Array.isArray(p.devices)||!Array.isArray(p.monitors)||!Array.isArray(p.groups)||!Array.isArray(p.scenes)||!Array.isArray(p.cycles)) throw Error('配置格式无效');
  if (JSON.stringify(p).length>200000) throw Error('配置过大');
  for (const collection of [p.devices,p.monitors,p.groups,p.scenes,p.cycles]) {
    if(collection.length>64) throw Error('配置项超过上限');
    const ids = new Set();
    for(const x of collection) {
      if(!x || typeof x.id!=='string'||!x.id||x.id.length>256||ids.has(x.id)||typeof x.name!=='string'||!x.name.trim()||x.name.length>100) throw Error('名称或标识无效');
      ids.add(x.id);
    }
  }
  const devices=new Set(p.devices.map(x=>x.id)), monitors=new Set(p.monitors.map(x=>x.id));
  for(const [key,label] of [['keyboardChannels','键盘'],['mouseChannels','鼠标']])if(p[key]!==undefined){
    if(!p[key]||typeof p[key]!=='object'||Array.isArray(p[key]))throw Error(label+'通道配置无效');
    const used=new Set();for(const [id,channel] of Object.entries(p[key])){
      if(!devices.has(id)||!Number.isInteger(channel)||channel<1||channel>3||used.has(channel))throw Error(label+'通道必须为 1–3，且每个通道只对应一台电脑');used.add(channel);
    }
  }
  for(const m of p.monitors) {
    if(!m.inputs || !m.endpoints || typeof m.inputs!=='object'||Array.isArray(m.inputs)||typeof m.endpoints!=='object'||Array.isArray(m.endpoints)) throw Error('显示器映射无效');
    const used = new Set();
    for(const [id,n] of Object.entries(m.inputs)) {
      if(!devices.has(id)||!Number.isInteger(n)||n<1||n>255||used.has(n)) throw Error('每个输入只能对应一台电脑，输入码必须为 1–255');
      used.add(n);
    }
    for(const [id,n] of Object.entries(m.endpoints)) if(!devices.has(id)||typeof n!=='string'||n.length>1024) throw Error('显示器控制端无效');
    if(m.cycleDeviceIds!==undefined&&(!Array.isArray(m.cycleDeviceIds)||new Set(m.cycleDeviceIds).size!==m.cycleDeviceIds.length||m.cycleDeviceIds.some(id=>!devices.has(id))))throw Error('单屏循环设备顺序无效');
  }
  const groupMap=new Map(p.groups.map(g=>[g.id,g]));
  for(const g of p.groups) if(!Array.isArray(g.monitorIds)||!g.monitorIds.length||new Set(g.monitorIds).size!==g.monitorIds.length||g.monitorIds.some(id=>!monitors.has(id))) throw Error('分组必须包含有效且不重复的显示器');
  for(const s of p.scenes) {
    const g=groupMap.get(s.groupId);
    if(!g||!s.assignments||Object.keys(s.assignments).length!==g.monitorIds.length||g.monitorIds.some(id=>!devices.has(s.assignments[id]))) throw Error('场景必须为组内每一屏选择电脑');
  }
  const sceneMap=new Map(p.scenes.map(s=>[s.id,s]));
  for(const c of p.cycles) if(!groupMap.has(c.groupId)||!Array.isArray(c.sceneIds)||!c.sceneIds.length||new Set(c.sceneIds).size!==c.sceneIds.length||c.sceneIds.some(id=>sceneMap.get(id)?.groupId!==c.groupId)) throw Error('循环必须包含同一分组内的场景，且不能重复');
  if(p.primaryId!==null && !monitors.has(p.primaryId)) throw Error('主屏无效');
  return p;
}
function sceneReady(profile,scene,online) {
  return Object.entries(scene.assignments).every(([mid,did])=> online.has(did) && Number.isInteger(profile.monitors.find(m=>m.id===mid)?.inputs[did]));
}
function chooseNextScene(profile,cycle,states,online) {
  const scenes=cycle.sceneIds.map(id=>profile.scenes.find(s=>s.id===id)).filter(Boolean);
  const current=scenes.findIndex(s=>Object.entries(s.assignments).every(([m,d])=>states[m]?.deviceId===d && states[m]?.confirmed));
  // Unknown/manual combinations restart at the first available scene.
  for(let n=1;n<=scenes.length;n++) {
    const candidate=scenes[(current+n)%scenes.length];
    if(sceneReady(profile,candidate,online)) return candidate;
  }
  throw Error('没有可用场景：目标电脑离线，或输入映射尚未完成');
}
function deriveState(monitor,observations,now=Date.now()) {
  const all=observations.filter(o=>monitor.endpoints[o.deviceId]===o.nativeId);
  const fresh=all.filter(o=>o.readable && Number.isInteger(o.input) && now-o.observedAt<15000);
  if(!fresh.length) return {confirmed:false,input:null,deviceId:null,lastInput:all.sort((a,b)=>b.observedAt-a.observedAt)[0]?.input??null};
  if(new Set(fresh.map(o=>o.input)).size>1) return {confirmed:false,input:null,deviceId:null,conflict:true};
  const latest=fresh.sort((a,b)=>b.observedAt-a.observedAt)[0];
  const deviceId=Object.keys(monitor.inputs).find(id=>monitor.inputs[id]===latest.input)||null;
  return {confirmed:true,input:latest.input,deviceId,observedAt:latest.observedAt};
}
function chooseNextDevice(profile,monitorId,state,online){
  const m=profile.monitors.find(m=>m.id===monitorId);if(!m)throw Error('显示器不存在');
  if(!state?.confirmed||!state.deviceId)throw Error('无法确认当前设备，请刷新状态后再循环');
  const order=m.cycleDeviceIds??profile.devices.map(d=>d.id);
  const current=order.indexOf(state.deviceId);
  for(let n=1;n<=order.length;n++){
    const did=order[(current+n)%order.length];
    if(did!==state.deviceId&&online.has(did)&&Number.isInteger(m.inputs[did]))return did;
  }
  throw Error('没有其他可用设备：请检查循环顺序、在线状态和输入接口');
}
function adoptDevice(profile,device) {
  const placeholder=profile.devices.find(d=>d.id.startsWith('unpaired-')&&d.os===device.os);
  if(placeholder) {
    const old=placeholder.id;
    for(const key of ['keyboardChannels','mouseChannels'])if(profile[key]&&Object.hasOwn(profile[key],old)){profile[key][device.id]=profile[key][old];delete profile[key][old];}
    for(const m of profile.monitors) for(const key of ['inputs','endpoints']) if(Object.hasOwn(m[key],old)) {m[key][device.id]=m[key][old];delete m[key][old];}
    for(const m of profile.monitors)if(m.cycleDeviceIds)m.cycleDeviceIds=m.cycleDeviceIds.map(id=>id===old?device.id:id);
    for(const s of profile.scenes) for(const mid of Object.keys(s.assignments)) if(s.assignments[mid]===old) s.assignments[mid]=device.id;
    profile.devices=profile.devices.filter(d=>d.id!==old);
  }
  const existing=profile.devices.find(d=>d.id===device.id);
  if(existing) Object.assign(existing,{...device,name:existing.name}); else profile.devices.push(device);
}
function ensureQuickScenes(profile){
  if(profile.quickPresetsVersion===1||profile.monitors.length!==2||profile.devices.length!==2)return false;
  const group=profile.groups.find(g=>g.monitorIds.length===2&&profile.monitors.every(m=>g.monitorIds.includes(m.id)));if(!group)return false;
  const [a,b]=profile.monitors,[one,two]=profile.devices;
  for(const [left,right,name] of [[one,one,'双屏 '+one.os],[two,two,'双屏 '+two.os],[one,two,'混合工作台 1'],[two,one,'混合工作台 2']]){
    if(profile.scenes.some(s=>s.groupId===group.id&&s.assignments[a.id]===left.id&&s.assignments[b.id]===right.id))continue;
    profile.scenes.push({id:randomUUID(),name,groupId:group.id,assignments:{[a.id]:left.id,[b.id]:right.id}});
  }
  profile.quickPresetsVersion=1;return true;
}
module.exports={INPUTS,inputLabel,cleanName,parseInputs,createProfile,validateProfile,chooseNextScene,chooseNextDevice,deriveState,sceneReady,adoptDevice,ensureQuickScenes};
