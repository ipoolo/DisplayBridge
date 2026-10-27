'use strict';
const api=window.bridge;
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const id=()=>crypto.randomUUID();
const clone=o=>structuredClone(o);
const labels={15:'DisplayPort 1',16:'DisplayPort 2',17:'HDMI 1',18:'HDMI 2',27:'USB-C'};
const inputName=n=>n==null?'未知输入':labels[n]||`输入 ${n}`;
let state,page='displays',editorSave,toastTimer,draggedMonitor=null,clipboardItems=[],clipboardSignature='',clipboardLoading=false;
const pages={displays:['显示器','让每一块屏幕，回到你正在做的事。'],scenes:['场景与循环','为不同工作方式，保存合适的屏幕组合。'],devices:['设备与连接','在同一局域网中，连接你的 Windows 与 Mac。'],shortcuts:['快捷键','不用打开窗口，也能切换整个工作空间。'],settings:['设置','让屏间按照你的习惯工作。']};
pages.clipboard=['复制内容','在一台电脑复制，在另一台电脑继续。'];
pages.keyboard=['键盘','让键盘跟随主屏，回到当前电脑。'];
pages.mouse=['鼠标','独立控制鼠标，跟随你的主屏。'];
const device=did=>state.profile.devices.find(d=>d.id===did);
const online=did=>state.online.includes(did);
const connectionLabel=did=>online(did)?'':state.peers.some(p=>p.id===did)?' · 离线':' · 未配对';
const button=(text,action,attrs='',kind='secondary')=>`<button type="button" class="button ${kind}" data-action="${action}" ${attrs}>${text}</button>`;
const option=(value,text,selected)=>`<option value="${esc(value)}" ${selected?'selected':''}>${esc(text)}</option>`;
function toast(text){$('toast').textContent=text;$('toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),4000);}
function accept(result){if(result?.error)throw Error(result.error);if(result?.state){state=result.state;render();}return result;}
async function task(fn){try{return await fn();}catch(e){toast(e.message);}}
async function runAction(action){const result=accept(await api.execute(action));if(result.state?.lastAction)toast(result.state.lastAction.message);}
function summary(scene){return sceneDescription(state.profile,scene);}
function sceneLabel(scene){return customSceneName(scene)||summary(scene);}
function isInputAction(a){return a?.type==='input-cycle'||/^(keyboard|mouse)-(cycle|switch)$/.test(a?.type||'');}
function inputActionVisual(a){
  const combined=a.type==='input-cycle',kind=combined||a.type.startsWith('mouse')?'mouse':'keyboard',cycle=a.type.endsWith('-cycle');
  const targets=cycle?state.profile.devices.filter(d=>Number.isInteger(state.profile[kind+'Channels']?.[d.id])&&(!combined||Number.isInteger(state.profile.keyboardChannels?.[d.id]))).sort((a,b)=>state.profile[kind+'Channels'][a.id]-state.profile[kind+'Channels'][b.id]):[device(a.deviceId)].filter(Boolean);
  return `<span class="input-action-visual" aria-label="${esc(actionName(a))}">${combined?inputDeviceIcon('keyboard'):''}${inputDeviceIcon(kind)}<span class="input-action-targets">${targets.length?targets.map(d=>`<span title="${esc(d.name)}">${osIcon(d.os)}${state.profile.devices.filter(x=>x.os===d.os).length>1?`<small>${esc(d.name)}</small>`:''}</span>`).join(cycle?'<span aria-hidden="true">⇄</span>':''):'⇄'}</span></span><span class="scene-custom-name">${combined?'键鼠同步循环':(kind==='mouse'?'鼠标':'键盘')+(cycle?'循环':'切换')}</span>`;
}
function actionVisual(a){if(isInputAction(a))return inputActionVisual(a);if(a.type==='monitor-cycle')return monitorCycleVisual(state.profile,a.monitorId);if(a.type==='scene'){const s=state.profile.scenes.find(s=>s.id===a.id);return s?scenePresentation(state.profile,s):'已删除场景';}if(a.type==='switch')return esc(state.profile.monitors.find(m=>m.id===a.monitorId)?.name||'显示器')+' → '+osIcon(device(a.deviceId)?.os)+(state.profile.devices.filter(d=>d.os===device(a.deviceId)?.os).length>1?' '+esc(device(a.deviceId)?.name):'');return esc(actionName(a));}
function actionValue(a){if(isInputAction(a))return a.type+(a.deviceId?'|'+a.deviceId:'');return a.type==='monitor-cycle'?`monitor-cycle|${a.monitorId}`:a.type==='switch'?`switch|${a.monitorId}|${a.deviceId}`:`${a.type}|${a.id}`;}
function parseAction(value){const p=value.split('|');if(p[0]==='input-cycle')return {type:'input-cycle'};if(/^(keyboard|mouse)-(cycle|switch)$/.test(p[0]))return p[0].endsWith('-cycle')?{type:p[0]}:{type:p[0],deviceId:p[1]};return p[0]==='monitor-cycle'?{type:p[0],monitorId:p[1]}:p[0]==='switch'?{type:p[0],monitorId:p[1],deviceId:p[2]}:{type:p[0],id:p[1]};}
function actionName(a){if(a.type==='input-cycle')return '键鼠同步循环 · 以鼠标当前连接决定目标';if(isInputAction(a))return (a.type.startsWith('mouse')?'鼠标':'键盘')+(a.type.endsWith('-cycle')?'循环':(' → '+(device(a.deviceId)?.name||'已删除电脑')));if(a.type==='monitor-cycle')return '单屏循环 · '+(state.profile.monitors.find(m=>m.id===a.monitorId)?.name||'已删除显示器');if(a.type==='scene'){const s=state.profile.scenes.find(s=>s.id===a.id);return s?sceneLabel(s):'已删除场景';}if(a.type==='switch')return `${state.profile.monitors.find(m=>m.id===a.monitorId)?.name||'已删除显示器'} → ${device(a.deviceId)?.name||'设备'}`;return `${a.type==='cycle'?'循环：':'场景：'}${state.profile[a.type==='cycle'?'cycles':'scenes'].find(s=>s.id===a.id)?.name||'已删除'}`;}
function render(){
  if(!state?.profile)return;
  if(draggedMonitor)return;
  document.body.classList.toggle('compact',Boolean(state.preferences.compactMode));
  document.body.classList.toggle('platform-mac',state.identity.os==='macOS');
  $('compact-toolbar').hidden=!state.preferences.compactMode;
  $('compact-status').textContent=`${state.online.length} 台在线`;
  document.querySelectorAll('[data-page]').forEach(b=>b.classList.toggle('selected',b.dataset.page===page));
  $('page-title').textContent=pages[page][0];$('page-subtitle').textContent=pages[page][1];$('local-name').textContent=device(state.identity.id)?.name||state.identity.name;
  $('refresh').disabled=state.busy;
  $('content').innerHTML=({displays:renderDisplays,scenes:renderScenes,devices:renderDevices,shortcuts:renderShortcuts,settings:renderSettings,keyboard:()=>renderInputDevicePage('keyboard'),mouse:()=>renderInputDevicePage('mouse'),clipboard:renderClipboard}[page])();
  if(page==='clipboard')loadClipboardItems();
  $('footer').textContent=`${state.busy?'正在切换…':'每 5 秒读取显示器状态'} · ${state.identity.os} · ${state.peers.length} 台已配对设备 · ${state.smoke?'只读验证模式':'屏间 '+state.appVersion}`;
}
function renderDisplays(){
  const p=state.profile,unmapped=p.monitors.filter(m=>p.devices.some(d=>!m.inputs[d.id]));
  const confirmed=Object.values(state.states).filter(s=>s.confirmed).length;
  return `<div class="overview full-only"><div class="stat"><span class="stat-icon">▣</span><div><strong>${p.monitors.length}</strong><small>工作空间显示器</small></div></div><div class="stat"><span class="stat-icon">⌘</span><div><strong>${state.online.length}</strong><small>在线电脑</small></div></div><div class="stat"><span class="stat-icon">⇄</span><div><strong>${p.scenes.length}</strong><small>已保存场景</small></div></div></div>
  ${state.localError?`<div class="notice">${esc(state.localError)}</div>`:''}
  ${!state.peers.length?`<div class="notice">另一台电脑尚未配对，当前在线数量只包含本机。${button('连接另一台电脑','go-devices','','ghost')}</div>`:''}
  <div class="section-heading full-only"><h2>我的显示器</h2><span>${confirmed} / ${p.monitors.length} 台输入状态已读取 · 拖动 ⠿ 调整顺序</span></div>
  <div class="monitor-grid">${p.monitors.map(m=>{
    const s=state.states[m.id]||{},d=device(s.deviceId),result=state.results[m.id];
    const local=state.local.find(n=>n.id===m.endpoints[state.identity.id]);
    return `<article class="monitor-card" data-monitor-card="${m.id}"><div class="monitor-top"><div class="monitor-title"><strong>${esc(m.name)}</strong>${m.id===p.primaryId?'<span class="badge">主屏</span>':''}</div><div class="card-tools"><button class="icon-button" data-action="monitor-cycle" data-id="${m.id}" title="单屏循环：切到下一台在线电脑" aria-label="${esc(m.name)} 单屏循环" ${state.busy?'disabled':''}>⇄</button><button class="icon-button drag-handle" draggable="true" data-drag-monitor="${m.id}" title="拖动调整顺序，两端同步" aria-label="移动 ${esc(m.name)}">⠿</button><button class="icon-button" aria-label="配置 ${esc(m.name)}" data-action="monitor-edit" data-id="${m.id}">···</button></div></div>
    <div class="monitor-art"><div class="screen-frame ${/34|wide/i.test(m.model)?'wide':''} ${d?.os==='macOS'?'mac':''}"><span class="screen-word">${d?osIcon(d.os)+'<span class="os-label">'+esc(d.os)+'</span>':'▣ &nbsp;'+esc(s.conflict?'状态不一致':inputName(s.input))}</span></div><div class="stand"></div><div class="foot"></div></div>
    <div class="monitor-detail"><div class="current-line"><strong>${d?esc(d.name):s.confirmed?'待关联电脑':'状态未知'}</strong><span>${s.confirmed?esc(inputName(s.input)):'等待读取'}</span></div>
    <div class="segmented">${p.devices.map(d=>`<button class="${s.deviceId===d.id?'active':''}" data-action="switch" data-monitor="${m.id}" data-device="${d.id}" ${state.busy||!m.inputs[d.id]?'disabled':''} title="${esc(d.name+connectionLabel(d.id))} · ${m.inputs[d.id]?inputName(m.inputs[d.id]):'请先自动检测'}" aria-label="${esc(m.name+' 切到 '+d.name)}">${osIcon(d.os)}<span class="device-button-label ${p.devices.filter(x=>x.os===d.os).length>1?'same-os':''}">${esc(d.name)}${connectionLabel(d.id)}</span></button>`).join('')}</div>
    <div class="monitor-meta" title="${result?esc(result.message):s.confirmed?'输入源已读取':'未确认实际输入'}"><span><span class="state-symbol ${result?.status==='failed'||result?.status==='unverified'?'warning-text':'connected'}">${result?.status==='failed'||result?.status==='unverified'?'!':s.confirmed?'●':'○'}</span><span class="meta-message"> ${result?esc(result.message):s.confirmed?'输入源已读取':'未确认实际输入'}</span></span><button class="button ghost full-only" data-action="monitor-edit" data-id="${m.id}">配置接口</button></div>
    ${local?.inputs?.length?`<div class="hint">支持 ${local.inputs.map(inputName).map(esc).join(' / ')}</div>`:''}</div></article>`;
  }).join('')}</div>
  ${!p.monitors.length?'<div class="empty">尚未识别外接显示器。检查连接后点击“刷新状态”。</div>':''}
  ${unmapped.length?`<div class="notice"><span>还有 ${unmapped.length} 台显示器需要识别接线归属。</span>${button('自动检测','self-check','','ghost')}</div>`:''}
  ${renderQuickSwitch()}`;
}
function renderQuickSwitch(){const p=state.profile;if(state.preferences.compactMode)return `<div class="section-heading"><h2>场景</h2><div class="cycle-buttons">${p.cycles.map(c=>button('⇄','execute',`data-type="cycle" data-id="${c.id}" title="${esc('下一场景 · '+c.name)}" aria-label="${esc('下一场景 · '+c.name)}" ${state.busy?'disabled':''}`,'secondary')).join('')}</div></div><div class="scene-tiles">${p.scenes.map(s=>{
  const active=Object.entries(s.assignments).every(([mid,did])=>state.states[mid]?.confirmed&&state.states[mid]?.deviceId===did);
  return `<button class="scene-tile ${active?'active':''}" data-action="execute" data-type="scene" data-id="${s.id}" title="${esc(sceneLabel(s))}" aria-label="${esc(sceneLabel(s))}" ${state.busy?'disabled':''}>${scenePresentation(p,s)}</button>`;
}).join('')}</div>`;
return `<div class="section-heading"><h2>快速切换</h2>${button('管理场景','page-scenes','','ghost')}</div>
  <div class="panel">${p.cycles.map(c=>`<div class="cycle-strip"><div><strong>${esc(c.name)}</strong><p>${c.sceneIds.map(sid=>p.scenes.find(s=>s.id===sid)?scenePresentation(p,p.scenes.find(s=>s.id===sid)):'').join(' &nbsp;⇄&nbsp; ')}</p></div>${button('⇄ &nbsp;下一场景','execute',`data-type="cycle" data-id="${c.id}" ${state.busy?'disabled':''}`,'primary')}</div>`).join('')||'<div class="row muted">添加循环后即可一键切换</div>'}</div>
  <div class="scene-pills">${p.scenes.map(s=>`<button class="scene-pill" data-action="execute" data-type="scene" data-id="${s.id}" ${state.busy?'disabled':''}>${scenePresentation(p,s)}</button>`).join('')}</div>`;
}
function renderScenes(){const p=state.profile;return `
  <div class="section-heading"><h2>显示器分组</h2>${button('＋ 新建分组','group-edit')}</div>
  <div class="panel">${p.groups.map(g=>`<div class="row"><div class="row-left"><div class="scene-dot">▦</div><div><div class="row-title">${esc(g.name)}</div><div class="row-sub">${g.monitorIds.map(mid=>esc(p.monitors.find(m=>m.id===mid)?.name)).join(' · ')}</div></div></div><div class="row-actions">${button('编辑','group-edit',`data-id="${g.id}"`,'ghost')}${button('删除','delete',`data-kind="groups" data-id="${g.id}"`,'ghost danger')}</div></div>`).join('')||'<div class="row muted">请先连接显示器，再创建分组</div>'}</div>
  <div class="section-heading"><h2>场景</h2>${button('＋ 新建场景','scene-edit',!p.groups.length?'disabled':'')}</div>
  <div class="panel">${p.scenes.map(s=>`<div class="row"><div><div class="row-title scene-row-visual">${scenePresentation(p,s)}</div></div><div class="row-actions">${button('应用','execute',`data-type="scene" data-id="${s.id}" ${state.busy?'disabled':''}`,'primary')}${button('编辑','scene-edit',`data-id="${s.id}"`,'ghost')}${button('删除','delete',`data-kind="scenes" data-id="${s.id}"`,'ghost danger')}</div></div>`).join('')||'<div class="row muted">保存每块屏幕的目标设备，组成一个场景</div>'}</div>
  <div class="section-heading"><h2>循环列表</h2>${button('＋ 新建循环','cycle-edit',!p.scenes.length?'disabled':'')}</div>
  <div class="panel">${p.cycles.map(c=>`<div class="row"><div><div class="row-title">${esc(c.name)}</div><div class="row-sub">${c.sceneIds.map(sid=>p.scenes.find(s=>s.id===sid)?scenePresentation(p,p.scenes.find(s=>s.id===sid)):'').join(' → ')}</div></div><div class="row-actions">${button('下一场景','execute',`data-type="cycle" data-id="${c.id}" ${state.busy?'disabled':''}`,'primary')}${button('编辑','cycle-edit',`data-id="${c.id}"`,'ghost')}${button('删除','delete',`data-kind="cycles" data-id="${c.id}"`,'ghost danger')}</div></div>`).join('')||'<div class="row muted">选择场景及顺序，绑定一个循环快捷键</div>'}</div>
  <p class="help">循环会跳过目标电脑离线或接口未配置的场景。当前组合不属于循环时，从第一个可用场景开始。</p>`;}
function renderDevices(){return `
  <div class="section-heading"><h2>电脑显示名称</h2><span>名称会同步到两端，系统类型自动识别</span></div><div class="panel">${state.profile.devices.map(d=>`<div class="row"><div class="row-left">${osIcon(d.os)}<div><div class="row-title">${esc(d.name)}</div><div class="row-sub">${esc(d.os)}</div></div></div>${button('修改名称','device-edit',`data-id="${d.id}"`,'ghost')}</div>`).join('')}</div><div class="spacer"></div>
  ${state.networkError?`<div class="notice">${esc(state.networkError)}</div>`:''}
  <div class="device-grid"><div class="panel device-tile"><div class="device-symbol">▣</div><h3>${esc(device(state.identity.id)?.name||state.identity.name)}</h3><span class="chip">本机 · ${esc(state.identity.os)}</span><p>连接地址：${state.addresses.map(a=>esc(a+':'+state.port)).join(' / ')||'未找到局域网地址'}</p>${button('生成配对码','pair-code','','primary')}${state.pairing&&state.pairing.expires>Date.now()?`<div class="pair-code">${esc(state.pairing.code)}</div><div class="hint">请在另一台电脑输入 · 五分钟内有效</div>`:''}</div>
  <div class="panel device-tile"><div class="device-symbol">＋</div><h3>连接另一台电脑</h3><p>在对方的屏间 App 中生成配对码，然后在这里输入。发现列表仅代表设备广播。</p>${button('输入地址与配对码','pair-edit','','secondary')}<p>首次配对后，将以发起端的场景配置为准。</p></div></div>
  <div class="section-heading"><h2>已配对设备</h2>${button('将本机配置同步到对端','sync','','ghost')}</div>
  <div class="panel">${state.peers.map(p=>`<div class="row"><div class="row-left"><span class="status-dot ${online(p.id)?'':'off'}"></span><div><div class="row-title">${esc(device(p.id)?.name||p.name)} <span class="chip">${esc(p.os)}</span></div><div class="row-sub">${esc(p.host)}:${p.port} · ${online(p.id)?'在线':'离线'} · ${esc(state.syncStatus[p.id]||'已配对')}${state.remote[p.id]?.error?' · '+esc(state.remote[p.id].error):''}</div></div></div>${button('取消配对','unpair',`data-id="${p.id}"`,'ghost danger')}</div>`).join('')||'<div class="row muted">尚未配对。完成配对后可同步状态和控制显示器。</div>'}</div>
  <div class="section-heading"><h2>局域网中发现</h2><span>自动发现，也支持手动输入 IP</span></div><div class="panel">${state.discovered.filter(d=>!state.peers.some(p=>p.id===d.id)).map(d=>`<div class="row"><div><div class="row-title">${esc(d.name)}</div><div class="row-sub">${esc(d.os)} · ${esc(d.host)}:${d.port}</div></div>${button('配对','pair-edit',`data-host="${esc(d.host)}" data-port="${d.port}"`)}</div>`).join('')||'<div class="row muted">等待另一台电脑开启屏间…</div>'}</div>
  <p class="help">两台电脑需在同一局域网。若系统提示网络权限，请允许专用网络访问。控制请求使用配对凭据认证；当前版本的局域网传输未加密，适用于可信的家庭网络。</p>`;}
function renderShortcuts(){return `<div class="notice info"><span>全局快捷键在 App 隐藏时仍然有效，也可以绑定到鼠标按键。</span></div><div class="section-heading"><h2>我的快捷键</h2><div class="row-actions">${button('从设备同步','shortcuts-sync',!state.peers.length?'disabled':'')}${button('导入','shortcuts-import')}${button('导出','shortcuts-export')}${button('＋ 添加快捷键','shortcut-edit')}</div></div><div class="panel">${state.preferences.shortcuts.map(s=>`<div class="row"><div><div class="row-title">${actionVisual(s.action)}</div><div class="row-sub">${esc(state.shortcutStatus[s.id]||'等待注册')}</div></div><div class="row-actions"><span class="kbd">${esc(s.accelerator)}</span>${button('编辑','shortcut-edit',`data-id="${s.id}"`,'ghost')}${button('删除','shortcut-delete',`data-id="${s.id}"`,'ghost danger')}</div></div>`).join('')||'<div class="row muted">添加一个快捷键，直接切换显示器或轮换场景。</div>'}</div><div class="section-heading"><h2>外部命令</h2></div><div class="panel"><div class="row"><div><div class="row-title">为鼠标宏或语音工具预留调用入口</div><div class="row-sub">Windows 可调用 DisplayBridge.exe；Mac 可通过 open -a DisplayBridge --args 传入参数。</div><p><code>--action=cycle:${esc(state.profile.cycles[0]?.id||'循环ID')}</code></p><p><code>--action=monitor-cycle:${esc(state.profile.monitors[0]?.id||'显示器ID')}</code></p><div class="hint">应用启动后也能接收上述命令。语音识别暂未内置；键盘与鼠标可在对应页面配置跟随。</div></div></div></div>`;}
function renderSettings(){const p=state.profile;return `${renderBehaviorSettings()}<div class="section-heading"><h2>通用</h2></div><div class="panel"><div class="row"><div><div class="row-title">外观</div><div class="row-sub">选择浅色、深色或跟随系统</div></div><select id="theme-setting">${[['system','跟随系统'],['light','浅色'],['dark','深色']].map(([v,l])=>option(v,l,state.preferences.theme===v)).join('')}</select></div><div class="row"><div><div class="row-title">登录时启动</div><div class="row-sub">启动后驻留托盘／菜单栏</div></div><input type="checkbox" aria-label="登录时启动" id="startup-setting" ${state.preferences.launchAtLogin?'checked':''}></div><div class="row"><div><div class="row-title">主显示器</div><div class="row-sub">独立于系统主屏设置，用于键盘、鼠标跟随与主屏标记</div></div><select id="primary-setting">${p.monitors.map(m=>option(m.id,m.name,p.primaryId===m.id)).join('')}</select></div></div>
  <div class="section-heading"><h2>可选扩展</h2></div><div class="panel"><div class="row"><div><div class="row-title">多显示器、多电脑</div><div class="row-sub">配置支持扩展；当前实机验证范围为 AOC / ROG 与 Windows / Mac。</div></div><span class="chip">可扩展</span></div></div>
  <div class="section-heading"><h2>诊断与运行记录</h2>${button('导出诊断','diagnostics','','ghost')}</div><div class="panel scroll-list">${state.logs.map(l=>`<div class="log-row"><time>${new Date(l.time).toLocaleTimeString()}</time><span class="${l.type==='error'?'error-text':l.type==='warning'?'warning-text':''}">${esc(l.message)}</span></div>`).join('')||'<div class="row muted">暂无操作记录</div>'}</div><p class="help">屏间 ${esc(state.appVersion)} · 关闭窗口后继续运行，退出请使用托盘／菜单栏。诊断文件包含设备名称、地址与显示器信息，不包含配对凭据。</p>`;}
function inputDeviceIcon(kind){return kind==='mouse'?'<svg viewBox="0 0 96 96" aria-hidden="true"><rect x="25" y="7" width="46" height="80" rx="23"/><path d="M48 8v30M26 40h44"/><rect x="45" y="18" width="6" height="14" rx="3"/></svg>':'<svg viewBox="0 0 140 96" aria-hidden="true"><rect x="7" y="18" width="126" height="64" rx="10"/>'+[0,1,2].map(y=>[0,1,2,3,4,5,6,7,8].map(x=>`<rect class="key" x="${17+x*12}" y="${28+y*13}" width="7" height="7" rx="1"/>`).join('')).join('')+'<path d="M42 72h56"/></svg>';}
function renderInputDevicePage(kind){
  const mouse=kind==='mouse',label=mouse?'鼠标':'键盘',model=mouse?'MX Master 3S':'MX Keys',probe=state[kind+'Probe'],busy=state[kind+'ProbeBusy'],follow=state[kind+'Follow'],enabled=state.preferences[kind+'Follow'],channels=state.profile[kind+'Channels']||{},primary=state.profile.monitors.find(m=>m.id===state.profile.primaryId);
  return `<div class="input-device-hero panel"><div class="input-device-art">${inputDeviceIcon(kind)}</div><div><h2>${model}</h2><p>${probe?.status==='ready'?`上次检测 · 本机通道 ${probe.currentChannel}`:'Easy-Switch · 三个连接通道'}</p><span class="chip">主屏 · ${esc(primary?.name||'尚未指定')}</span></div></div><div class="section-heading"><h2>跟随与连接</h2></div><div class="panel"><div class="row"><div><div class="row-title">${label}跟随主屏</div><div class="row-sub">主屏确认切换后跟随；副屏单独切换不触发，与${mouse?'键盘':'鼠标'}开关独立</div></div><input class="input-device-toggle" id="${kind}-follow-setting" type="checkbox" role="switch" aria-label="${label}跟随主屏" ${enabled?'checked':''}></div><div class="row"><div><div class="row-title">设备检测</div><div class="row-sub">${esc(probe?.message||'先自动识别本机通道与已知电脑，未识别的通道可以手动选择')}</div></div><div class="row-actions">${probe?.status==='permission-required'?button('授权'+label+'访问',kind+'-access',busy?'disabled':'','primary'):''}${button(busy?'检测中…':'检测'+label,kind+'-probe',busy?'disabled':'','secondary')}</div></div></div><div class="section-heading"><h2>电脑与通道</h2><span>映射同步到已配对设备</span></div><div class="panel">${state.profile.devices.map(d=>`<div class="row"><div class="row-left">${osIcon(d.os)}<span>${esc(d.name)}</span></div><select aria-label="${esc(d.name)} ${label}通道" data-${kind}-channel="${esc(d.id)}">${option('','未配置',!channels[d.id])}${[1,2,3].map(n=>option(String(n),'通道 '+n,channels[d.id]===n)).join('')}</select></div>`).join('')}</div>${follow?`<div class="notice ${follow.status==='failed'?'':'info'}">${esc(follow.message)}</div>`:''}<p class="help">在两台电脑分别开启${label}跟随后生效。关闭此开关仍可使用设备上的 Easy-Switch 切换。</p>`;
}
function openEditor(title,description,html,save){$('editor').classList.remove('visual-editor');$('editor-body').innerHTML=`<h2>${esc(title)}</h2><p class="description">${esc(description)}</p>${html}`;$('editor-error').textContent='';$('save-editor').textContent='保存';$('save-editor').disabled=false;editorSave=save;$('editor').showModal();}
function field(name,label,value='',extra=''){return `<div class="field"><label for="${name}">${esc(label)}</label><input type="text" id="${name}" value="${esc(value)}" maxlength="100" ${extra}></div>`;}
async function saveProfile(p,revision){accept(await api.saveProfile(p,revision));toast('配置已保存');}
function renderBehaviorSettings(){return `<div class="section-heading"><h2>工作空间</h2>${button('自动检测','self-check','','ghost')}</div><div class="panel"><div class="row"><div><div class="row-title">精简模式</div><div class="row-sub">只保留显示器和图形化场景，默认开启</div></div><input id="compact-setting" type="checkbox" aria-label="精简模式" ${state.preferences.compactMode?'checked':''}></div><div class="row"><div><div class="row-title">自动移动窗口</div><div class="row-sub">当前屏幕切离本机时，移动到仍显示本机的屏幕</div></div><input id="move-setting" type="checkbox" aria-label="自动移动窗口" ${state.preferences.autoMoveWindow?'checked':''}></div><div class="row"><div><div class="row-title">跨设备复制</div><div class="row-sub">收集最新文字和图片，供另一台电脑查看或复制</div></div><select id="clipboard-mode">${[['auto','自动收集到工作空间'],['focus','切回屏间时同步'],['manual','手动同步'],['off','关闭']].map(([v,n])=>option(v,n,(state.preferences.clipboardMode||'auto')===v)).join('')}</select></div><div class="row"><div><div class="row-title">双向自动剪贴板</div><div class="row-sub">两端开启后，复制文字或图片即可在另一端直接粘贴；新内容会替换剪贴板</div></div><input id="clipboard-auto-sync" type="checkbox" aria-label="双向自动剪贴板" ${state.clipboard?.autoSync?'checked':''}></div></div>`;}
async function loadClipboardItems(){
  const signature=JSON.stringify(state.clipboard);if(clipboardLoading||clipboardSignature===signature)return;
  clipboardLoading=true;
  try{const items=accept(await api.clipboardList());clipboardItems=Array.isArray(items)?items:[];clipboardSignature=signature;if(page==='clipboard')render();}catch(e){toast(e.message);}finally{clipboardLoading=false;}
}
function renderClipboard(){
  const mode=state.preferences.clipboardMode||'auto',modes={auto:'自动收集',focus:'切回屏间时同步',manual:'手动同步',off:'已关闭'};
  const devices=[state.identity.id,...state.peers.map(p=>p.id)];
  return `<div class="section-heading"><h2>最新复制内容 <span class="chip">${state.clipboard?.autoSync?'双向自动剪贴板':modes[mode]}</span></h2><div class="row-actions">${button('刷新','clipboard-refresh','','secondary')}${button('共享本机剪贴板','clipboard-publish',mode==='off'?'disabled':'','primary')}</div></div>
  ${state.clipboard?.error?`<div class="notice">${esc(state.clipboard.error)}</div>`:''}
  ${mode==='off'?'<div class="notice">跨设备复制已关闭，可在设置中重新开启。</div>':''}
  <div class="clipboard-grid">${devices.map(did=>{const d=device(did)||state.identity,item=clipboardItems.find(x=>x.sourceId===did),local=did===state.identity.id;return `<article class="panel clipboard-card"><div class="clipboard-heading">${osIcon(d.os)}<strong>${esc(d.name)}</strong><span class="chip">${local?'本机':online(did)?'在线':'离线'}</span></div>${item&&mode!=='off'?`<div class="clipboard-body">${item.kind==='image'?`<img class="clipboard-image" alt="${esc(d.name)} 最新复制的图片" src="data:image/png;base64,${item.png}">`:`<pre class="clipboard-text">${esc(item.text.slice(0,12000))}</pre>${item.text.length>12000?'<p class="hint">预览已截取；复制按钮会复制完整文本。</p>':''}`}</div><div class="clipboard-bottom"><span class="hint">${item.kind==='image'?`${item.width} × ${item.height}`:'文本'} · ${new Date(item.updatedAt).toLocaleTimeString()}${item.offline?' · 上次收到的内容':''}</span>${local?'<span class="chip">已共享</span>':button('复制到本机','clipboard-copy',`data-source="${did}" data-id="${item.id}"`,'primary')}</div>`:`<div class="clipboard-empty">${local?(mode==='manual'?'点击上方按钮共享本机内容':'复制一段文字或图片后，会显示在这里'):'等待这台电脑共享复制内容'}</div>`}</article>`;}).join('')}</div>
  <p class="help">仅保留每台电脑最新的一条，关闭 App 后清空缓存。文本最多 1 MB，图片最多 8 MB。内容经加密传给已配对设备；${state.clipboard?.autoSync?'两端开启自动剪贴板后，可直接 Ctrl+V / ⌘V 粘贴新内容。连接恢复后从下一次复制开始同步。':'点击“复制到本机”后，再到目标软件粘贴。'}</p>`;
}
function monitorEditor(mid){
  const p=clone(state.profile),revision=p.revision,m=p.monitors.find(m=>m.id===mid);if(!m)return;
  const native=state.local.find(n=>n.id===m.endpoints[state.identity.id]);
  const supported=native?.inputs||[];
  let cycleOrder=[...(m.cycleDeviceIds??p.devices.map(d=>d.id))];
  const candidates=[...new Set([...supported,15,16,17,18,27,...Object.values(m.inputs)])];
  openEditor('配置显示器','确认每台电脑实际连接的输入口。当前输入只表示显示器选中的接口，不会自动关联电脑。',
    field('monitor-name','显示器名称',m.name)+`<div class="monitor-position"><label for="monitor-position">桌面排列</label><select id="monitor-position">${p.monitors.map((_,i)=>option(i,'第 '+(i+1)+' 位（从左到右）',p.monitors[i].id===mid)).join('')}</select></div><label class="check-row"><input id="monitor-primary" type="checkbox" ${p.primaryId===mid?'checked':''}>设为联动主屏</label><p class="help">检测到的当前输入：${esc(inputName(state.states[mid]?.input))}</p>`+
    '<div class="field"><label>单屏循环顺序</label><small>只循环勾选的电脑，自动跳过离线或未配置接口的电脑。</small><div id="monitor-cycle-order"></div></div>'+p.devices.map((d,i)=>{const detected=d.id===state.identity.id?state.local:state.remote[d.id]?.monitors||[];return `<div class="mapping-row"><strong>${esc(d.name)} · ${esc(d.os)}</strong><select id="input-${i}" aria-label="${esc(d.name)}输入接口">${option('','尚未配置',!m.inputs[d.id])}${candidates.map(n=>option(n,inputName(n)+(supported.includes(n)?' · 显示器报告支持':''),m.inputs[d.id]===n)).join('')}${option('custom','自定义输入码',false)}</select><input type="number" id="custom-${i}" placeholder="自定义十进制输入码（1–255）" min="1" max="255" hidden><small>该电脑上识别的显示器（用于两端协作控制）</small><select id="endpoint-${i}">${option('','暂不绑定',!m.endpoints[d.id])}${detected.map(n=>option(n.id,n.name,m.endpoints[d.id]===n.id)).join('')}${m.endpoints[d.id]&&!detected.some(n=>n.id===m.endpoints[d.id])?option(m.endpoints[d.id],'保留已绑定的离线显示器',true):''}</select></div>`;}).join(''),async()=>{
      m.name=$('monitor-name').value.trim();m.cycleDeviceIds=cycleOrder.filter(did=>document.querySelector('[data-cycle-device="'+did+'"]').checked);if($('monitor-primary').checked)p.primaryId=mid;
      for(let i=0;i<p.devices.length;i++){const did=p.devices[i].id,value=$('input-'+i).value;if(value)m.inputs[did]=Number(value==='custom'?$('custom-'+i).value:value);else delete m.inputs[did];const endpoint=$('endpoint-'+i).value;if(endpoint)m.endpoints[did]=endpoint;else delete m.endpoints[did];}
      applyMonitorOrder(p,mid,Number($('monitor-position').value));await saveProfile(p,revision);
    });
  const drawCycle=()=>{$('monitor-cycle-order').innerHTML=cycleOrder.map((did,i)=>{const d=p.devices.find(d=>d.id===did);return `<div class="order-item"><label><input type="checkbox" data-cycle-device="${did}" checked>${osIcon(d.os)} ${esc(deviceCaption(p,d))}</label><button type="button" class="button secondary" data-cycle-move="${i}" data-delta="-1" aria-label="上移">↑</button><button type="button" class="button secondary" data-cycle-move="${i}" data-delta="1" aria-label="下移">↓</button></div>`;}).join('');};
  const selectedCycle=new Set(cycleOrder);cycleOrder=[...cycleOrder,...p.devices.map(d=>d.id).filter(did=>!cycleOrder.includes(did))];drawCycle();document.querySelectorAll('[data-cycle-device]').forEach(b=>b.checked=selectedCycle.has(b.dataset.cycleDevice));
  $('monitor-cycle-order').addEventListener('click',e=>{const b=e.target.closest('[data-cycle-move]');if(!b)return;const a=Number(b.dataset.cycleMove),to=a+Number(b.dataset.delta);if(to<0||to>=cycleOrder.length)return;const selected=new Set([...document.querySelectorAll('[data-cycle-device]:checked')].map(x=>x.dataset.cycleDevice));[cycleOrder[a],cycleOrder[to]]=[cycleOrder[to],cycleOrder[a]];drawCycle();document.querySelectorAll('[data-cycle-device]').forEach(x=>x.checked=selected.has(x.dataset.cycleDevice));});
  p.devices.forEach((d,i)=>$('input-'+i).addEventListener('change',()=>$('custom-'+i).hidden=$('input-'+i).value!=='custom'));
}
function applyMonitorOrder(p,mid,index){const from=p.monitors.findIndex(m=>m.id===mid);if(from<0)return;const [m]=p.monitors.splice(from,1);p.monitors.splice(index,0,m);for(const g of p.groups)g.monitorIds.sort((a,b)=>p.monitors.findIndex(m=>m.id===a)-p.monitors.findIndex(m=>m.id===b));}
function deviceEditor(did){const p=clone(state.profile),rev=p.revision,d=p.devices.find(d=>d.id===did);if(!d)return;openEditor('修改电脑名称','此名称在两端的显示器、场景和托盘中使用，不更改系统主机名。',field('device-name','显示名称',d.name)+`<p class="help">系统：${esc(d.os)} · 自动识别</p>`,async()=>{d.name=$('device-name').value.trim();await saveProfile(p,rev);});}
async function setMode(compact,target='displays'){page=target;accept(await api.preferences({...state.preferences,compactMode:compact}));render();}
async function selfCheckEditor(){
  toast('正在检测显示器和局域网连接…');accept(await api.selfCheck());
  const p=state.profile;
  openEditor('自动检测','已自动读取硬件、输入状态和已有共享配置。只有无法确定的接线归属需要确认。',`<div class="check-summary">${p.monitors.length} 台显示器 · ${state.online.length} 台在线电脑 · ${state.peers.length} 台已配对</div>`+p.monitors.map(m=>{
    const s=state.states[m.id]||{},local=state.local.find(n=>n.id===m.endpoints[state.identity.id]);
    const missing=p.devices.filter(d=>!Number.isInteger(m.inputs[d.id]));
    return `<div class="check-monitor"><strong>${esc(m.name)}</strong><p>${s.confirmed?'当前输入已读取：'+esc(inputName(s.input)):s.conflict?'两端状态暂不一致，请稍后重试':'暂时无法读取输入，请检查 DDC/CI 和连接'}</p><p>${missing.length?'待确认：'+missing.map(d=>esc(d.name)).join('、'):'接口映射完整 ✓'}</p>${!m.inputs[state.identity.id]&&local?.readable?button('这块屏幕正在显示本机','confirm-visible',`data-id="${m.id}"`,'primary'):''}${missing.some(d=>d.id!==state.identity.id)?'<p>在另一台电脑的屏间中确认这块屏幕正在显示它，即可自动记录接口并同步。</p>':''}${button('手动配置','monitor-edit',`data-id="${m.id}"`,'ghost')}</div>`;
  }).join('')+(!state.peers.length?`<div class="notice">尚未配对另一台电脑。${button('去连接','go-devices','','ghost')}</div>`:''),async()=>{});
  $('save-editor').textContent='完成';
}
function groupEditor(gid){const p=clone(state.profile),rev=p.revision,old=p.groups.find(g=>g.id===gid);openEditor(old?'编辑分组':'新建分组','分组决定一次场景操作涉及哪些显示器。',field('group-name','分组名称',old?.name||'')+p.monitors.map(m=>`<label class="check-row"><input type="checkbox" name="group-monitor" value="${m.id}" ${old?.monitorIds.includes(m.id)?'checked':''}>${esc(m.name)}</label>`).join(''),async()=>{
  const group={id:old?.id||id(),name:$('group-name').value.trim(),monitorIds:[...document.querySelectorAll('[name=group-monitor]:checked')].map(c=>c.value)};
  if(old){p.groups=p.groups.map(g=>g.id===old.id?group:g);for(const s of p.scenes.filter(s=>s.groupId===group.id))s.assignments=Object.fromEntries(group.monitorIds.map(mid=>[mid,s.assignments[mid]||state.identity.id]));}else p.groups.push(group);
  await saveProfile(p,rev);
});}
function sceneEditor(sid){
  const p=clone(state.profile),rev=p.revision,old=p.scenes.find(s=>s.id===sid),draft={...(old?.assignments||{})};
  const monitors=()=>p.monitors.filter(m=>p.groups.find(g=>g.id===$('scene-group').value)?.monitorIds.includes(m.id));
  openEditor(old?'编辑场景':'新建场景','按桌面排列选择各屏幕的目标电脑。这里只编辑配置，不会切换实际画面。',field('scene-name','场景名称（可留空，自动使用图标）',old?customSceneName(old):'')+`<div class="field"><label>显示器分组</label><select id="scene-group">${p.groups.map(g=>option(g.id,g.name,(old?.groupId||p.groups[0]?.id)===g.id)).join('')}</select></div><div id="scene-assignments" class="scene-editor-grid"></div>`,async()=>{
    const group=p.groups.find(g=>g.id===$('scene-group').value);const scene={id:old?.id||id(),name:$('scene-name').value.trim()||'图标场景',groupId:group.id,assignments:Object.fromEntries(monitors().map(m=>[m.id,draft[m.id]]))};
    scene.autoName=!$('scene-name').value.trim();
    if(old){if(old.groupId!==scene.groupId&&p.cycles.some(c=>c.sceneIds.includes(old.id)))throw Error('该场景被循环引用，请先从循环移除后再更改分组');p.scenes=p.scenes.map(s=>s.id===old.id?scene:s);}else p.scenes.push(scene);await saveProfile(p,rev);
  });
  $('editor').classList.add('visual-editor');
  const draw=()=>{$('scene-assignments').innerHTML=monitors().map(m=>{draft[m.id]??=state.identity.id;const d=p.devices.find(d=>d.id===draft[m.id]);return `<article class="monitor-card scene-edit-card" data-scene-monitor="${m.id}"><div class="monitor-top"><strong>${monitorMarker(p,m)} · ${esc(m.name)}</strong></div><div class="monitor-art"><div class="screen-frame ${d?.os==='macOS'?'mac':''} ${/34|wide/i.test(m.model)?'wide':''}"><span class="screen-word">${osIcon(d?.os)}</span></div><div class="stand"></div><div class="foot"></div></div><div class="monitor-detail"><div class="segmented" role="group" aria-label="${esc(m.name)}目标电脑">${p.devices.map(d=>`<button type="button" class="${draft[m.id]===d.id?'active':''}" data-scene-target="${d.id}" data-monitor="${m.id}" aria-pressed="${draft[m.id]===d.id}" title="${esc(d.name)}" aria-label="${esc(m.name+' → '+d.name)}">${osIcon(d.os)}${p.devices.filter(x=>x.os===d.os).length>1?'<span>'+esc(d.name)+'</span>':''}</button>`).join('')}</div><div class="hint">${m.inputs[draft[m.id]]?esc(inputName(m.inputs[draft[m.id]])):'接口尚未配置'}</div></div></article>`;}).join('');};
  $('scene-group').addEventListener('change',draw);$('scene-assignments').addEventListener('click',e=>{const b=e.target.closest('[data-scene-target]');if(!b)return;draft[b.dataset.monitor]=b.dataset.sceneTarget;draw();});draw();
}
function cycleEditor(cid){const p=clone(state.profile),rev=p.revision,old=p.cycles.find(c=>c.id===cid);let order=[...(old?.sceneIds||[])];openEditor(old?'编辑循环':'新建循环','勾选需要参与的场景，使用箭头调整循环顺序。',field('cycle-name','循环名称',old?.name||'')+`<div class="field"><label>显示器分组</label><select id="cycle-group">${p.groups.map(g=>option(g.id,g.name,(old?.groupId||p.groups[0]?.id)===g.id)).join('')}</select></div><div id="cycle-order"></div>`,async()=>{
  const checked=new Set([...document.querySelectorAll('[name=cycle-scene]:checked')].map(c=>c.value));const cycle={id:old?.id||id(),name:$('cycle-name').value.trim(),groupId:$('cycle-group').value,sceneIds:order.filter(s=>checked.has(s))};
  if(old)p.cycles=p.cycles.map(c=>c.id===old.id?cycle:c);else p.cycles.push(cycle);await saveProfile(p,rev);
});
  let checked=new Set(old?.sceneIds||[]);
  const draw=()=>{const choices=p.scenes.filter(s=>s.groupId===$('cycle-group').value);order=[...order.filter(s=>choices.some(c=>c.id===s)),...choices.filter(s=>!order.includes(s.id)).map(s=>s.id)];$('cycle-order').innerHTML=order.map((sid,i)=>`<div class="order-item"><label><input type="checkbox" name="cycle-scene" value="${sid}" ${checked.has(sid)?'checked':''}>${p.scenes.find(s=>s.id===sid)?scenePresentation(p,p.scenes.find(s=>s.id===sid)):''}</label><button type="button" class="button secondary" data-move="${i}" data-delta="-1" aria-label="上移">↑</button><button type="button" class="button secondary" data-move="${i}" data-delta="1" aria-label="下移">↓</button></div>`).join('')||'<p class="help">此分组中还没有场景</p>';};
  $('cycle-group').addEventListener('change',()=>{order=[];checked=new Set();draw();});$('cycle-order').addEventListener('click',e=>{const b=e.target.closest('[data-move]');if(!b)return;checked=new Set([...document.querySelectorAll('[name=cycle-scene]:checked')].map(c=>c.value));const a=Number(b.dataset.move),t=a+Number(b.dataset.delta);if(t<0||t>=order.length)return;[order[a],order[t]]=[order[t],order[a]];draw();});draw();
}
let shortcutEditToken=null,shortcutEditorOpening=false;
async function releaseShortcutEdit(){const token=shortcutEditToken;shortcutEditToken=null;if(!token)return;const r=accept(await api.endShortcutEdit(token));if(r.registrationFailures?.length)toast(`${r.registrationFailures.length} 条快捷键未能恢复，请查看快捷键列表`);}
async function guardShortcutEditor(showEditor){
  if($('editor').open||shortcutEditorOpening)return;shortcutEditorOpening=true;
  try{const r=accept(await api.beginShortcutEdit());shortcutEditToken=r.token;await showEditor();if($('editor').open){const description=$('editor-body').querySelector('.description');if(description)description.textContent+=' 配置期间屏间全部快捷键已暂停，关闭后恢复。';}}
  finally{shortcutEditorOpening=false;if(!$('editor').open)await releaseShortcutEdit();}
}
function shortcutEditor(sid){return guardShortcutEditor(()=>renderShortcutEditor(sid));}
function shortcutsSyncEditor(){return guardShortcutEditor(()=>renderShortcutsSyncEditor());}
function showShortcutsImport(data){return guardShortcutEditor(()=>renderShortcutsImport(data));}
function renderShortcutEditor(sid){const preferences=clone(state.preferences),old=preferences.shortcuts.find(s=>s.id===sid);const actions=[{type:'input-cycle'},...state.profile.cycles.map(c=>({type:'cycle',id:c.id})),...state.profile.monitors.map(m=>({type:'monitor-cycle',monitorId:m.id})),...['keyboard','mouse'].flatMap(kind=>[{type:kind+'-cycle'},...state.profile.devices.filter(d=>Number.isInteger(state.profile[kind+'Channels']?.[d.id])).map(d=>({type:kind+'-switch',deviceId:d.id}))]),...state.profile.scenes.map(s=>({type:'scene',id:s.id})),...state.profile.monitors.flatMap(m=>state.profile.devices.map(d=>({type:'switch',monitorId:m.id,deviceId:d.id})))];openEditor(old?'编辑快捷键':'添加快捷键','点击输入框并按下组合键。键鼠动作只切对应设备，与跟随主屏开关独立；循环按通道顺序，跳过离线电脑；键鼠同步循环以鼠标决定共同目标。',`<div class="field"><label>执行动作</label><input type="hidden" id="shortcut-action" value="${esc(actionValue(old?.action||actions[0]||{type:'scene',id:''}))}"><div id="shortcut-choices" class="action-choices">${actions.map(a=>`<button type="button" class="action-choice ${actionValue(old?.action||actions[0])===actionValue(a)?'active':''}" data-action-value="${esc(actionValue(a))}" title="${esc(actionName(a))}" aria-pressed="${actionValue(old?.action||actions[0])===actionValue(a)}">${actionVisual(a)}</button>`).join('')}</div></div>`+field('shortcut-keys','快捷键',old?.accelerator||'','placeholder="例如 Ctrl+Alt+F9"'),async()=>{
  if(!$('shortcut-action').value)throw Error('请先创建场景或连接显示器');
  const shortcut={id:old?.id||id(),accelerator:$('shortcut-keys').value.trim(),action:parseAction($('shortcut-action').value)};
  if(!shortcut.accelerator)throw Error('请设置快捷键');if(preferences.shortcuts.some(s=>s.id!==shortcut.id&&s.accelerator.toLowerCase()===shortcut.accelerator.toLowerCase()))throw Error('此快捷键已被使用');
  if(old)preferences.shortcuts=preferences.shortcuts.map(s=>s.id===old.id?shortcut:s);else preferences.shortcuts.push(shortcut);accept(await api.preferences(preferences));toast(state.shortcutStatus[shortcut.id]||'已保存');
});$('shortcut-choices').addEventListener('click',e=>{const b=e.target.closest('[data-action-value]');if(!b)return;$('shortcut-action').value=b.dataset.actionValue;document.querySelectorAll('[data-action-value]').forEach(x=>{x.classList.toggle('active',x===b);x.setAttribute('aria-pressed',String(x===b));});});$('shortcut-keys').addEventListener('keydown',e=>{if(e.key==='Tab')return;if(['Control','Shift','Alt','Meta'].includes(e.key))return;if(e.key==='Backspace'&&!e.ctrlKey&&!e.metaKey)return;e.preventDefault();const keys=[];if(e.ctrlKey)keys.push('Ctrl');if(e.metaKey)keys.push('Command');if(e.altKey)keys.push('Alt');if(e.shiftKey)keys.push('Shift');let key=e.key===' '?'Space':e.key.length===1?e.key.toUpperCase():({ArrowUp:'Up',ArrowDown:'Down',ArrowLeft:'Left',ArrowRight:'Right'}[e.key]||e.key);keys.push(key);$('shortcut-keys').value=keys.join('+');});}
async function renderShortcutsSyncEditor(){
  let data=null,selected=new Set(),edits={},previewTicket=0,loadTicket=0;
  openEditor('同步快捷键','读取另一台电脑当前的快捷键，选择需要的条目合并到本机。不会修改对方的配置。',`<div class="field"><label for="shortcut-source">来源电脑</label><div class="shortcut-source"><select id="shortcut-source">${state.peers.map((peer,i)=>option(peer.id,(device(peer.id)?.name||peer.name)+(online(peer.id)?'':' · 离线'),i===0)).join('')}</select><button type="button" class="button secondary" id="shortcut-source-read">重新读取</button></div></div><p id="shortcut-sync-summary" class="help">正在读取…</p><div id="shortcut-sync-rows"></div><p class="help">只合并勾选且检查通过的条目。遇到按键冲突，可直接修改快捷键后重新勾选；相同配置不重复添加。</p>`,async()=>{
    if(!data)throw Error('请先读取来源电脑的配置');const r=accept(await api.applyShortcutsSync(data,[...selected],edits));
    toast(`已合并 ${r.accepted} 条快捷键`+(r.skipped?`，跳过 ${r.skipped} 条`: '')+(r.registrationFailures?.length?`；${r.registrationFailures.length} 条无法注册，请查看列表`:''));
  });
  $('editor').classList.add('visual-editor');$('save-editor').textContent='合并到本机';$('save-editor').disabled=true;const sourceElement=$('shortcut-source'),active=()=>$('editor').open&&$('shortcut-source')===sourceElement;
  const drawRows=rows=>{$('shortcut-sync-rows').innerHTML=rows.map(row=>`<div class="shortcut-sync-row" data-sync-row="${row.index}"><input type="checkbox" data-sync-select="${row.index}" aria-label="选择第 ${row.index+1} 条快捷键" ${selected.has(row.index)?'checked':''} ${!row.action||row.duplicate&&!selected.has(row.index)?'disabled':''}><div class="sync-action">${row.action?actionVisual(row.action):'<span class="muted">对应动作不可用</span>'}</div><div class="sync-key"><input type="text" maxlength="100" data-sync-key="${row.index}" value="${esc(edits[row.index]??data.shortcuts[row.index]?.accelerator??'')}" aria-label="第 ${row.index+1} 条快捷键" ${!row.action?'disabled':''}><small data-sync-status="${row.index}" class="${row.ok?'connected':'warning-text'}">${row.ok?selected.has(row.index)?'已选择，可合并':'可选择':esc(row.reason)}</small></div></div>`).join('')||'<p class="help">这台电脑尚未配置快捷键</p>';};
  const preview=async redraw=>{if(!data)return;const ticket=++previewTicket;$('save-editor').disabled=true;try{
    const r=accept(await api.previewShortcutsSync(data,[...selected],edits));if(ticket!==previewTicket||!active())return;
    $('shortcut-sync-summary').textContent=`共 ${r.rows.length} 条，已选 ${selected.size} 条；可合并 ${r.accepted} 条`+(r.skipped?`，其中 ${r.skipped} 条需处理`: '')+'。';
    if(redraw)drawRows(r.rows);else for(const row of r.rows){const text=document.querySelector('[data-sync-status="'+row.index+'"]'),box=document.querySelector('[data-sync-select="'+row.index+'"]');if(!text)continue;text.textContent=row.ok?(selected.has(row.index)?'已选择，可合并':'可选择'):row.reason;text.className=row.ok?'connected':'warning-text';box.disabled=!row.action||row.duplicate&&!selected.has(row.index);}
    $('save-editor').disabled=!r.accepted;$('editor-error').textContent='';
  }catch(e){if(active())$('editor-error').textContent=e.message;}};
  const read=async()=>{const ticket=++loadTicket;++previewTicket;data=null;selected.clear();edits={};$('save-editor').disabled=true;$('shortcut-sync-rows').innerHTML='';$('shortcut-sync-summary').textContent='正在读取当前配置…';$('shortcut-source-read').disabled=true;$('editor-error').textContent='';try{
    const result=accept(await api.readPeerShortcuts($('shortcut-source').value));if(ticket!==loadTicket||!active())return;data=result.data;
    const initial=accept(await api.previewShortcutsImport(data,'merge'));if(ticket!==loadTicket||!active())return;selected=new Set(initial.rows.filter(r=>r.ok).map(r=>r.index));await preview(true);
  }catch(e){if(ticket===loadTicket&&active()){$('shortcut-sync-summary').textContent='未读取到配置';$('editor-error').textContent=e.message;}}finally{if(ticket===loadTicket&&active())$('shortcut-source-read').disabled=false;}};
  $('shortcut-source').addEventListener('change',read);$('shortcut-source-read').addEventListener('click',read);
  $('shortcut-sync-rows').addEventListener('change',e=>{if(e.target.matches('[data-sync-select]')){const index=Number(e.target.dataset.syncSelect);if(e.target.checked)selected.add(index);else selected.delete(index);preview(false);}});
  $('shortcut-sync-rows').addEventListener('input',e=>{if(e.target.matches('[data-sync-key]')){edits[Number(e.target.dataset.syncKey)]=e.target.value;preview(false);}});
  await read();
}
async function shortcutsImportEditor(){return guardShortcutEditor(async()=>{const opened=accept(await api.openShortcutsImport());if(!opened.cancelled)await renderShortcutsImport(opened.data);});}
async function renderShortcutsImport(data){
  openEditor('导入快捷键','先检查导入结果。目标场景和显示器按共享配置标识匹配，不会自动猜测。',`<div class="field"><label for="shortcut-import-mode">导入方式</label><select id="shortcut-import-mode"><option value="merge">合并：保留现有快捷键</option><option value="replace">替换：用导入内容替换现有快捷键</option></select></div><p id="shortcut-import-summary" class="help"></p><div id="shortcut-import-rows"></div><p class="help">有问题的条目会跳过。其他软件占用的按键将在注册后显示结果；Command 不会自动改为 Ctrl。</p>`,async()=>{
    const r=accept(await api.applyShortcutsImport(data,$('shortcut-import-mode').value));
    toast(`已导入 ${r.accepted} 条，跳过 ${r.skipped} 条`+(r.registrationFailures?.length?`；${r.registrationFailures.length} 条无法注册，请查看快捷键列表`:''));
  });
  $('save-editor').textContent='导入';let ticket=0;
  const preview=async()=>{const current=++ticket;$('save-editor').disabled=true;try{const r=accept(await api.previewShortcutsImport(data,$('shortcut-import-mode').value));if(current!==ticket)return;
    $('shortcut-import-summary').textContent=(r.mode==='replace'?`将替换现有 ${r.replaced} 条快捷键。`:'保留现有快捷键。')+` 可导入 ${r.accepted} 条，跳过 ${r.skipped} 条。`;
    $('shortcut-import-rows').innerHTML=r.rows.map(row=>`<div class="import-shortcut-row"><span class="kbd">${esc(row.accelerator||'无按键')}</span><div>${row.action?actionVisual(row.action):''}<div class="${row.ok?'connected':'warning-text'}">${row.ok?'可导入':esc(row.reason)}</div></div></div>`).join('')||'<p class="help">文件中没有快捷键</p>';
    $('save-editor').disabled=!r.accepted;
  }catch(e){$('editor-error').textContent=e.message;}};
  $('shortcut-import-mode').addEventListener('change',preview);await preview();
}
function pairEditor(host='',port=43828){openEditor('配对另一台电脑','在另一台电脑的“设备与连接”中生成配对码。',field('pair-host','对方局域网 IP',host,'placeholder="192.168.1.100"')+`<div class="field-inline">${field('pair-port','端口',port)}${field('pair-code','六位配对码','','inputmode="numeric" placeholder="000000"')}</div>`,async()=>{accept(await api.pair({host:$('pair-host').value.trim(),port:Number($('pair-port').value),code:$('pair-code').value.trim()}));toast('配对成功');});$('save-editor').textContent='配对';}
async function removeItem(kind,itemId){const p=clone(state.profile),rev=p.revision;const item=p[kind].find(x=>x.id===itemId);if(!item)return;openEditor('删除'+item.name,'删除配置不会切换显示器。相关引用会一并清理。','',async()=>{
  if(kind==='groups'){p.scenes=p.scenes.filter(s=>s.groupId!==itemId);p.cycles=p.cycles.filter(c=>c.groupId!==itemId);}
  if(kind==='scenes'){p.cycles.forEach(c=>c.sceneIds=c.sceneIds.filter(s=>s!==itemId));p.cycles=p.cycles.filter(c=>c.sceneIds.length);}
  p[kind]=p[kind].filter(x=>x.id!==itemId);await saveProfile(p,rev);
});$('save-editor').textContent='删除';}
document.addEventListener('click',e=>task(async()=>{
  const nav=e.target.closest('[data-page]');if(nav){if(state.preferences.compactMode)await setMode(false,nav.dataset.page);else{page=nav.dataset.page;render();}return;}
  const b=e.target.closest('[data-action]');if(!b)return;const a=b.dataset.action;
  if(a==='monitor-edit')monitorEditor(b.dataset.id);
  if(a==='device-edit')deviceEditor(b.dataset.id);
  if(a==='page-scenes')await setMode(false,'scenes');
  if(a==='go-devices'){if($('editor').open)$('editor').close();await setMode(false,'devices');}
  if(a==='full-mode')await setMode(false,'settings');
  if(a==='compact-mode')await setMode(true);
  if(a==='go-clipboard'){await setMode(false,'clipboard');accept(await api.clipboardRefresh());}
  if(['keyboard-probe','keyboard-access','mouse-probe','mouse-access'].includes(a)){const mouse=a.startsWith('mouse'),r=await api[mouse?'mouseProbe':'keyboardProbe'](a.endsWith('access'));accept(r);toast(r.result?.status==='ready'?'已读取'+(mouse?'鼠标':'键盘')+'通道':r.result?.message||'检测完成');}
  if(a==='clipboard-refresh'){accept(await api.clipboardRefresh());clipboardSignature='';loadClipboardItems();}
  if(a==='clipboard-publish'){accept(await api.clipboardPublish());toast('本机复制内容已共享');}
  if(a==='clipboard-copy'){accept(await api.clipboardCopy(b.dataset.source,b.dataset.id));toast('已复制到本机，现在可以粘贴');}
  if(a==='self-check')await selfCheckEditor();
  if(a==='confirm-visible'){accept(await api.confirmVisible(b.dataset.id));await selfCheckEditor();}
  if(a==='monitor-cycle')await runAction({type:'monitor-cycle',monitorId:b.dataset.id});
  if(a==='switch')await runAction({type:'switch',monitorId:b.dataset.monitor,deviceId:b.dataset.device});
  if(a==='execute')await runAction({type:b.dataset.type,id:b.dataset.id});
  if(a==='group-edit')groupEditor(b.dataset.id);
  if(a==='scene-edit')sceneEditor(b.dataset.id);
  if(a==='cycle-edit')cycleEditor(b.dataset.id);
  if(a==='shortcut-edit')await shortcutEditor(b.dataset.id);
  if(a==='shortcuts-sync')await shortcutsSyncEditor();
  if(a==='shortcuts-import')await shortcutsImportEditor();
  if(a==='shortcuts-export'){const r=accept(await api.exportShortcuts());if(r.ok)toast('快捷键已导出');}
  if(a==='delete')await removeItem(b.dataset.kind,b.dataset.id);
  if(a==='shortcut-delete'){const p=clone(state.preferences);p.shortcuts=p.shortcuts.filter(s=>s.id!==b.dataset.id);accept(await api.preferences(p));}
  if(a==='pair-code'){accept(await api.pairingCode());state=await api.state();render();}
  if(a==='pair-edit')pairEditor(b.dataset.host,b.dataset.port);
  if(a==='sync'){accept(await api.sync());toast('同步已完成，请查看各设备结果');}
  if(a==='unpair'){openEditor('取消配对','取消后，对方将无法继续控制本机。显示器映射和场景会保留。','',async()=>{accept(await api.unpair(b.dataset.id));state=await api.state();render();});}
  if(a==='diagnostics'){const result=accept(await api.exportDiagnostics());if(result.ok)toast('诊断已导出');}
}));
document.addEventListener('change',e=>task(async()=>{
  if(['theme-setting','startup-setting'].includes(e.target.id)){const p=clone(state.preferences);p.theme=$('theme-setting').value;p.launchAtLogin=$('startup-setting').checked;accept(await api.preferences(p));}
  if(e.target.id==='primary-setting'){const p=clone(state.profile);p.primaryId=e.target.value;await saveProfile(p,p.revision);}
  if(e.target.id==='compact-setting')await setMode(e.target.checked,e.target.checked?'displays':'settings');
  if(e.target.id==='move-setting')accept(await api.preferences({...state.preferences,autoMoveWindow:e.target.checked}));
  if(e.target.id==='clipboard-mode')accept(await api.preferences({...state.preferences,clipboardMode:e.target.value,clipboardAutoSync:e.target.value==='auto'&&state.preferences.clipboardAutoSync}));
  for(const kind of ['keyboard','mouse']){
    if(e.target.id===kind+'-follow-setting')accept(await api.preferences({...state.preferences,[kind+'Follow']:e.target.checked}));
    if(e.target.dataset[kind+'Channel']){const p=structuredClone(state.profile),key=kind+'Channels';p[key]={...p[key]};if(e.target.value)p[key][e.target.dataset[kind+'Channel']]=Number(e.target.value);else delete p[key][e.target.dataset[kind+'Channel']];await saveProfile(p,p.revision);}
  }
  if(e.target.id==='clipboard-auto-sync')accept(await api.preferences({...state.preferences,clipboardAutoSync:e.target.checked,...(e.target.checked?{clipboardMode:'auto'}:{})}));
}));
document.addEventListener('dragstart',e=>{const handle=e.target.closest('[data-drag-monitor]');if(!handle||state.busy)return;draggedMonitor=handle.dataset.dragMonitor;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',draggedMonitor);handle.closest('.monitor-card').classList.add('dragging');});
document.addEventListener('dragover',e=>{if(!draggedMonitor)return;const card=e.target.closest('[data-monitor-card]');if(!card)return;e.preventDefault();document.querySelectorAll('.drag-target').forEach(c=>c.classList.remove('drag-target'));card.classList.add('drag-target');});
document.addEventListener('drop',e=>{const card=e.target.closest('[data-monitor-card]');if(!draggedMonitor||!card)return;e.preventDefault();const mid=draggedMonitor;draggedMonitor=null;task(async()=>{const p=clone(state.profile),to=p.monitors.findIndex(m=>m.id===card.dataset.monitorCard);applyMonitorOrder(p,mid,to);await saveProfile(p,p.revision);render();});});
document.addEventListener('dragend',()=>{draggedMonitor=null;render();});
$('refresh').addEventListener('click',()=>task(async()=>{$('refresh').disabled=true;const next=await api.refresh();if(next.error)throw Error(next.error);state=next;render();toast('状态已刷新');}));
$('editor').addEventListener('close',()=>{if(!$('editor').open)task(releaseShortcutEdit);});
api.onShortcutEditCancel(()=>{if($('editor').open&&shortcutEditToken)$('editor').close();task(releaseShortcutEdit);});
window.addEventListener('pagehide',()=>{if(shortcutEditToken)api.endShortcutEdit(shortcutEditToken);});
$('cancel-editor').addEventListener('click',()=>$('editor').close());
$('editor-form').addEventListener('submit',async e=>{e.preventDefault();$('save-editor').disabled=true;$('cancel-editor').disabled=true;try{await editorSave();$('editor').close();}catch(e){$('editor-error').textContent=e.message;}finally{$('save-editor').disabled=false;$('cancel-editor').disabled=false;}});
api.onChange(next=>{state=next;render();});
api.state().then(next=>{state=next;render();}).catch(e=>{$('content').textContent=e.message;});
