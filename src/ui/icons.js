'use strict';
function osIcon(os){
  if(os==='macOS')return '<svg class="os-icon" viewBox="0 0 24 24" aria-label="Apple"><path fill="currentColor" d="M15.5 2c.2 1.7-.6 3-1.5 3.8-.9.8-2 1.1-3.1 1 .1-1.5.7-2.8 1.6-3.6.9-.7 2-1.1 3-1.2ZM18.5 12.6c0-2.3 1.9-3.5 2-3.6-1.1-1.7-2.9-2-3.6-2-1.5-.1-3 1-3.8 1-.9 0-2.2-.9-3.6-.9-1.9 0-3.7 1.1-4.7 2.9-2 3.4-.5 8.4 1.4 11.1.9 1.3 1.9 2.7 3.3 2.6 1.3 0 1.8-.8 3.5-.8 1.6 0 2.1.8 3.5.8 1.5 0 2.4-1.3 3.3-2.6 1-1.4 1.4-2.8 1.4-2.9-.1 0-2.7-1-2.7-3.6Z" transform="translate(0 -1) scale(.95)"/></svg>';
  return '<svg class="os-icon" viewBox="0 0 24 24" aria-label="Windows"><path fill="currentColor" d="M2 3h9v8H2zm11 0h9v8h-9zM2 13h9v8H2zm11 0h9v8h-9z"/></svg>';
}
function escapeVisual(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function deviceCaption(profile,d){return profile.devices.filter(x=>x.os===d?.os).length>1?d?.name||'设备':d?.os==='macOS'?'Mac':d?.os||'未知设备';}
function orderedSceneMonitors(profile,scene){return profile.monitors.filter(m=>Object.hasOwn(scene.assignments,m.id));}
function monitorMarker(profile,m){return String(profile.monitors.indexOf(m)+1)+(m.id===profile.primaryId?'主':'');}
function sceneDescription(profile,scene){return orderedSceneMonitors(profile,scene).map(m=>`${monitorMarker(profile,m)} ${deviceCaption(profile,profile.devices.find(d=>d.id===scene.assignments[m.id]))}`).join(' · ');}
function customSceneName(scene){return scene.autoName?'':/^(混合工作台 [12]|全部切到 (Mac|Windows)|双屏 (macOS|Windows))$/.test(scene.name)?'':scene.name;}
function sceneVisual(profile,scene){return `<span class="scene-composition" aria-label="${escapeVisual(sceneDescription(profile,scene))}">${orderedSceneMonitors(profile,scene).map(m=>{const d=profile.devices.find(d=>d.id===scene.assignments[m.id]),duplicate=profile.devices.filter(x=>x.os===d?.os).length>1;return `<span class="scene-screen-item" title="${escapeVisual(m.name+' → '+d?.name)}"><span class="mini-monitor ${d?.os==='macOS'?'mac':''} ${/34|wide/i.test(m.model)?'wide':''}">${osIcon(d?.os)}</span><span class="scene-screen-caption ${m.id===profile.primaryId?'primary-marker':''}">${monitorMarker(profile,m)}${duplicate?' · '+escapeVisual(d?.name):''}</span></span>`;}).join('')}</span>`;}
function scenePresentation(profile,scene){return sceneVisual(profile,scene)+(customSceneName(scene)?`<span class="scene-custom-name">${escapeVisual(scene.name)}</span>`:'');}
function monitorCycleVisual(profile,monitorId){
  const m=profile.monitors.find(m=>m.id===monitorId);if(!m)return '已删除显示器';
  const devices=(m.cycleDeviceIds??profile.devices.map(d=>d.id)).map(id=>profile.devices.find(d=>d.id===id)).filter(d=>d&&Number.isInteger(m.inputs[d.id]));
  const duplicates=devices.some(d=>devices.filter(other=>other.os===d.os).length>1);
  return `<span class="scene-composition monitor-cycle-visual" aria-label="${escapeVisual('单屏循环 · '+m.name)}"><span class="scene-screen-item"><span class="mini-monitor cycle-monitor">${devices.length?devices.map(d=>`<span class="cycle-device" title="${escapeVisual(d.name)}">${osIcon(d.os)}</span>`).join('<span class="cycle-arrow" aria-hidden="true">⇄</span>'):'⇄'}</span><span class="scene-screen-caption ${m.id===profile.primaryId?'primary-marker':''}">${monitorMarker(profile,m)}</span></span></span><span class="scene-custom-name">${escapeVisual(m.name)}</span>${duplicates?`<span class="cycle-device-names">${devices.map(d=>escapeVisual(deviceCaption(profile,d))).join(' ⇄ ')}</span>`:''}`;
}
if(typeof module!=='undefined')module.exports={orderedSceneMonitors,sceneDescription,customSceneName,sceneVisual};
