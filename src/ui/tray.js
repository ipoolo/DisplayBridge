const api=window.trayBridge,esc=escapeVisual;
let state;
function render(next){state=next;const p=state.profile;
  document.getElementById('tray-content').innerHTML=p.monitors.map((m,i)=>`<div class="tray-monitor"><div class="tray-monitor-title"><strong>${monitorMarker(p,m)} · ${esc(m.name)}</strong><button data-cycle="${m.id}" title="单屏循环" aria-label="${esc(m.name)}单屏循环" ${state.busy?'disabled':''}>⇄</button></div><div class="segmented">${p.devices.filter(d=>Number.isInteger(m.inputs[d.id])).map(d=>`<button data-monitor="${m.id}" data-device="${d.id}" class="${state.states[m.id]?.confirmed&&state.states[m.id]?.deviceId===d.id?'active':''}" title="${esc(d.name)}${state.online.includes(d.id)?'':' · 离线'}" aria-label="${esc(m.name+' → '+d.name)}" ${state.busy?'disabled':''}>${osIcon(d.os)}${p.devices.filter(x=>x.os===d.os).length>1?esc(d.name):''}</button>`).join('')}</div></div>`).join('')+'<div class="tray-label">场景</div><div class="tray-scenes">'+p.scenes.map(s=>`<button class="scene-tile ${Object.entries(s.assignments).every(([mid,did])=>state.states[mid]?.confirmed&&state.states[mid]?.deviceId===did)?'active':''}" data-scene="${s.id}" title="${esc(sceneDescription(p,s))}" aria-label="${esc(sceneDescription(p,s))}" ${state.busy?'disabled':''}>${scenePresentation(p,s)}</button>`).join('')+'</div>'+p.cycles.map(c=>`<button class="tray-cycle" data-group-cycle="${c.id}" ${state.busy?'disabled':''}>⇄ ${esc(c.name)}</button>`).join('');
}
document.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;try{
  let result;if(b.dataset.command)result=await api.command(b.dataset.command);
  else if(b.dataset.scene)result=await api.execute({type:'scene',id:b.dataset.scene});
  else if(b.dataset.groupCycle)result=await api.execute({type:'cycle',id:b.dataset.groupCycle});
  else if(b.dataset.cycle)result=await api.execute({type:'monitor-cycle',monitorId:b.dataset.cycle});
  else if(b.dataset.monitor)result=await api.execute({type:'switch',monitorId:b.dataset.monitor,deviceId:b.dataset.device});
  if(result?.error)throw Error(result.error);document.getElementById('tray-error').textContent='';if(result?.state)render(result.state);
}catch(e){document.getElementById('tray-error').textContent=e.message;}});
document.addEventListener('keydown',e=>{if(e.key==='Escape')api.command('hide');});
api.onChange(render);api.state().then(render).catch(e=>document.getElementById('tray-error').textContent=e.message);
