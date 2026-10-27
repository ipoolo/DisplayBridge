const {app,BrowserWindow,ipcMain,Menu,Tray,nativeImage,globalShortcut,dialog,nativeTheme,safeStorage,Notification,screen,clipboard,ClipboardItem,shell}=require('electron');
const path=require('node:path');
const fs=require('node:fs');
const {pathToFileURL}=require('node:url');
const {NativeBackend}=require('./native.cjs');
const {Service}=require('./service.cjs');
const {inputLabel}=require('./core.cjs');
const {createTrayIcon}=require('./tray-icon.cjs');
const {linkDisplays,relocationTarget,fitWindow}=require('./window-layout.cjs');
const {ClipboardShare}=require('./clipboard-share.cjs');
const {createClipboardAdapter}=require('./electron-clipboard.cjs');
const {exportShortcuts,planImport,planSelection,validateAction}=require('./shortcuts.cjs');
const {KeyboardProbe,inferChannels}=require('./keyboard-probe.cjs');
const {KeyboardFollow}=require('./keyboard-follow.cjs');
const {cycleInputs}=require('./input-cycle.cjs');
const {ShortcutSuspension}=require('./shortcut-suspension.cjs');
const smoke=process.argv.includes('--smoke');
let win,tray,trayWindow,service,sharing,keyboardProbe,keyboardFollow,mouseProbe,mouseFollow,shortcutSuspension,quitting=false,shortcutStatus={},broadcastTimer,windowSwitchPlan;
if(smoke) app.setPath('userData',path.join(__dirname,'../artifacts/smoke-profile'));
if(!app.requestSingleInstanceLock()){app.quit();}else{
app.on('second-instance',(_,argv)=>{const command=argv.find(a=>a.startsWith('--action='));if(command)runCli(command.substring(9));else show();});
app.on('before-quit',()=>{quitting=true;sharing?.close();service?.close();globalShortcut.unregisterAll();});
app.on('window-all-closed',()=>{});
app.on('activate',show);
app.whenReady().then(start).catch(e=>{console.error(e);if(!smoke)dialog.showErrorBox('屏间启动失败',e.message);app.exit(1);});
}
function show(){if(win){win.show();win.focus();}}
function localDisplays(){return screen.getAllDisplays().map(d=>({...d,physicalBounds:process.platform==='win32'?screen.dipToScreenRect(null,d.bounds):d.bounds}));}
function snapshot(){const displays=localDisplays();return {...service.snapshot(),clipboard:sharing?.status(),keyboardProbe:keyboardProbe?.result,keyboardFollow:keyboardFollow?.result,keyboardProbeBusy:Boolean(keyboardProbe?.pending),mouseProbe:mouseProbe?.result,mouseFollow:mouseFollow?.result,mouseProbeBusy:Boolean(mouseProbe?.pending),shortcutStatus,shortcutsPaused:Boolean(shortcutSuspension?.active),registeredShortcutCount:service.preferences.shortcuts.filter(s=>{try{return globalShortcut.isRegistered(s.accelerator);}catch{return false;}}).length,smoke,appVersion:app.getVersion(),windowBounds:win?.getBounds(),windowMovable:win?.isMovable(),windowDisplayId:win?screen.getDisplayMatching(win.getBounds()).id:null,displayBindings:linkDisplays(service.local,displays)};}
function moveWindowIfNeeded(assignments={}){
  if(smoke||!service.preferences.autoMoveWindow||!win?.isVisible()||win.isMinimized())return;
  const displays=localDisplays(),bounds=win.getBounds(),target=relocationTarget({profile:service.profile,states:service.states(),identityId:service.identity.id,bindings:linkDisplays(service.local,displays),currentDisplayId:screen.getDisplayMatching(bounds).id,assignments,displays});
  if(!target)return;if(win.isMaximized())win.unmaximize();win.setBounds(fitWindow(bounds,target.workArea));
}
function resizeMode(){
  if(!win)return;const compact=service.preferences.compactMode;
  win.setMinimumSize(compact?620:900,compact?420:680);
  const bounds=win.getBounds(),area=screen.getDisplayMatching(bounds).workArea;
  win.setBounds(fitWindow({...bounds,width:compact?920:1180,height:compact?650:820},area));
}
async function execute(action){
  if(smoke)return {ok:false,error:'只读验证模式禁止切换真实显示器'};
  try{await service.execute(action);return {ok:true,state:snapshot()};}catch(e){
    if(e.code==='OFFLINE'){
      const options={type:'question',title:'目标电脑离线',message:'目标电脑未在线，仍然切换输入源吗？',detail:'显示器可能暂时没有画面。你仍可使用显示器实体按钮恢复输入。',buttons:['取消','仍然切换'],defaultId:0,cancelId:0};
      const answer=win?.isVisible()?await dialog.showMessageBox(win,options):await dialog.showMessageBox(options);
      if(answer.response===1){await service.execute(action,{force:true});return {ok:true,state:snapshot()};}
      return {ok:false,cancelled:true};
    }
    service.log(e.message,'error');return {ok:false,error:e.message};
  }
}
function registerShortcuts(){
  globalShortcut.unregisterAll();shortcutStatus={};
  if(shortcutSuspension?.active){for(const s of service.preferences.shortcuts)shortcutStatus[s.id]='配置中，暂时停用';return;}
  for(const s of service.preferences.shortcuts)try{
    const ok=globalShortcut.register(s.accelerator,()=>{if(shortcutSuspension?.active)return;execute(s.action).then(r=>{if(r.error&&Notification.isSupported())new Notification({title:'屏间',body:r.error}).show();});});
    shortcutStatus[s.id]=ok?'已启用':'无法注册：与其他快捷键冲突';
  }catch{shortcutStatus[s.id]='快捷键格式无效';}
}
function trayMenu(){
  if(!tray)return;
  tray.setToolTip(service.busy?'屏间 · 正在切换':'屏间 · 显示器控制台');
  if(trayWindow&&!trayWindow.isDestroyed())trayWindow.webContents.send('tray:changed',snapshot());
}
async function createTrayWindow(){
  trayWindow=new BrowserWindow({width:370,height:620,frame:false,resizable:false,show:false,skipTaskbar:true,alwaysOnTop:true,backgroundColor:'#27292e',webPreferences:{preload:path.join(__dirname,'tray-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  trayWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  trayWindow.webContents.on('will-navigate',e=>e.preventDefault());
  trayWindow.on('blur',()=>trayWindow.hide());
  trayWindow.on('close',event=>{if(!quitting){event.preventDefault();trayWindow.hide();}});
  const page=pathToFileURL(path.join(__dirname,'ui/tray.html')).href;
  const handle=(name,fn)=>ipcMain.handle('tray:'+name,async(event,...args)=>{
    if(event.sender!==trayWindow.webContents||event.senderFrame!==trayWindow.webContents.mainFrame||event.senderFrame.url!==page)throw Error('无效请求来源');
    try{return await fn(...args);}catch(e){return {ok:false,error:e.message};}
  });
  handle('state',snapshot);
  handle('execute',async action=>{trayWindow.hide();const r=await execute(action);if(r.error&&Notification.isSupported())new Notification({title:'屏间',body:r.error}).show();return r;});
  handle('command',async command=>{
    if(command==='open'){trayWindow.hide();show();}
    else if(command==='hide')trayWindow.hide();
    else if(command==='quit')app.quit();
    else if(command==='refresh'){await Promise.all([service.refresh(true),service.refreshPeers()]);return {state:snapshot()};}
    else throw Error('未知操作');return {ok:true};
  });
  await trayWindow.loadFile(path.join(__dirname,'ui/tray.html'));
}
function showTrayPanel(){
  if(!trayWindow)return;if(trayWindow.isVisible()){trayWindow.hide();return;}
  const point=screen.getCursorScreenPoint(),area=screen.getDisplayNearestPoint(point).workArea;
  const width=Math.min(370,area.width),height=Math.min(620,area.height);
  const x=Math.max(area.x,Math.min(point.x-width/2,area.x+area.width-width));
  const y=point.y>area.y+area.height/2?area.y+area.height-height:area.y;
  trayWindow.setBounds({x:Math.round(x),y:Math.round(y),width,height});
  trayWindow.webContents.send('tray:changed',snapshot());trayWindow.show();trayWindow.focus();
}
async function start(){
  const packagedNative=path.join(process.resourcesPath,'native');
  const nativeRoot=app.isPackaged?(process.platform==='darwin'&&!fs.existsSync(path.join(packagedNative,'m1ddc'))?path.join(app.getPath('userData'),'native'):packagedNative):path.join(__dirname,'../native/bin');
  const backend=new NativeBackend(nativeRoot);
  keyboardProbe=new KeyboardProbe(app.isPackaged?packagedNative:nativeRoot);
  mouseProbe=new KeyboardProbe(app.isPackaged?packagedNative:nativeRoot,process.platform,undefined,'mouse');
  if(app.isPackaged&&process.platform==='darwin')backend.macSources=path.join(process.resourcesPath,'native-source');
  const encryptionAvailable=safeStorage.isAsyncEncryptionAvailable?await safeStorage.isAsyncEncryptionAvailable():safeStorage.isEncryptionAvailable();
  const codec=encryptionAvailable?{encode:s=>safeStorage.encryptString(s),decode:b=>safeStorage.decryptString(b)}:null;
  service=new Service({dir:app.getPath('userData'),backend,codec});
  shortcutSuspension=new ShortcutSuspension(()=>{if(!smoke&&!quitting)registerShortcuts();service.changed();});
  keyboardFollow=new KeyboardFollow(service,keyboardProbe);
  mouseFollow=new KeyboardFollow(service,mouseProbe,'mouse');
  if(!smoke){
    service.network.getKeyboard=()=>keyboardFollow.localStatus();
    service.network.onKeyboardFollow=data=>keyboardFollow.receive(data);
    service.network.getMouse=()=>mouseFollow.localStatus();
    service.network.onMouseFollow=data=>mouseFollow.receive(data);
    service.network.onKeyboardSwitch=data=>keyboardFollow.receiveManual(data);
    service.network.onMouseSwitch=data=>mouseFollow.receiveManual(data);
    service.onInputAction=action=>action.type==='input-cycle'?cycleInputs(service,keyboardFollow,mouseFollow):(action.type.startsWith('mouse-')?mouseFollow:keyboardFollow).manual(action);
    service.onPrimaryConfirmed=async target=>{
      const result=await keyboardFollow.follow(target);
      if(result.status==='failed'&&Notification.isSupported())new Notification({title:'屏间 · 键盘跟随',body:result.message}).show();
      return result;
    };
    service.onPrimaryMouseConfirmed=async target=>{
      const result=await mouseFollow.follow(target);
      if(result.status==='failed'&&Notification.isSupported())new Notification({title:'屏间 · 鼠标跟随',body:result.message}).show();
      return result;
    };
  }
  if(smoke)service.preferences.compactMode=true;
  const clipboardAdapter=createClipboardAdapter({clipboard,ClipboardItem,nativeImage});
  sharing=new ClipboardShare({identity:service.identity,getMode:()=>service.preferences.clipboardMode,getAutoSync:()=>service.preferences.clipboardAutoSync,getPeers:()=>service.peers,network:service.network,read:()=>smoke?null:clipboardAdapter.read(),write:async item=>{
    if(smoke)throw Error('验证模式不会修改系统剪贴板');
    await clipboardAdapter.write(item);
  }});
  service.network.getClipboard=(peer,after)=>sharing.envelope(peer,after);
  sharing.on('change',()=>service.changed());
  nativeTheme.themeSource=service.preferences.theme;
  const icon=nativeImage.createFromBuffer(createTrayIcon(process.platform==='darwin'));
  if(process.platform==='darwin')icon.setTemplateImage(true);
  const compact=service.preferences.compactMode;
  win=new BrowserWindow({width:compact?920:1180,height:compact?650:820,minWidth:compact?620:900,minHeight:compact?420:680,title:'屏间 · DisplayBridge',backgroundColor:'#f5f5f7',icon,show:false,autoHideMenuBar:true,...(process.platform==='darwin'?{titleBarStyle:'default',movable:true}:{}),webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',event=>event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_,__,callback)=>callback(false));
  win.on('close',event=>{if(!quitting){event.preventDefault();win.hide();}});
  win.on('focus',()=>{if(!smoke)sharing.focus();});
  win.on('hide',()=>{shortcutSuspension.reset();if(!win.webContents.isDestroyed())win.webContents.send('shortcut-edit:cancel');});
  win.webContents.on('render-process-gone',()=>shortcutSuspension.reset());
  win.webContents.on('did-start-navigation',(_event,_url,_inPlace,isMainFrame)=>{if(isMainFrame)shortcutSuspension.reset();});
  const page=pathToFileURL(path.join(__dirname,'ui/index.html')).href;
  function handle(name,fn){ipcMain.handle('bridge:'+name,async(event,...args)=>{
    if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame||event.senderFrame.url!==page)throw Error('无效请求来源');
    try{return await fn(...args);}catch(e){return {ok:false,error:e.message};}
  });}
  handle('state',snapshot);
  const shortcutRegistrationFailures=()=>shortcutSuspension.active?[]:service.preferences.shortcuts.filter(s=>shortcutStatus[s.id]!=='已启用').map(s=>({accelerator:s.accelerator,status:shortcutStatus[s.id]}));
  handle('shortcut-edit-begin',()=>{if(service.busy)throw Error('正在切换，请稍后再配置快捷键');const token=shortcutSuspension.begin();return {ok:true,token,state:snapshot()};});
  handle('shortcut-edit-end',token=>{shortcutSuspension.end(token);return {ok:true,state:snapshot(),registrationFailures:shortcutRegistrationFailures()};});
  handle('refresh',async()=>{await Promise.all([service.refresh(true),service.refreshPeers()]);return snapshot();});
  handle('self-check',async()=>{await service.selfCheck();return {ok:true,state:snapshot()};});
  handle('confirm-visible',async mid=>{await service.confirmVisible(mid);return {ok:true,state:snapshot()};});
  handle('profile',async(p,rev)=>{await service.saveProfile(p,rev);return {ok:true,state:snapshot()};});
  const savePreferences=async p=>{
    if(!p||!['system','light','dark'].includes(p.theme)||!Array.isArray(p.shortcuts)||p.shortcuts.length>100)throw Error('设置无效');
    for(const s of p.shortcuts)if(typeof s.id!=='string'||typeof s.accelerator!=='string'||s.accelerator.length>100||!s.action||!['switch','scene','cycle','monitor-cycle','input-cycle','keyboard-cycle','keyboard-switch','mouse-cycle','mouse-switch'].includes(s.action.type))throw Error('快捷键配置无效');
    for(const s of p.shortcuts)if((s.action.type==='input-cycle'||/^(keyboard|mouse)-(cycle|switch)$/.test(s.action.type))&&!service.preferences.shortcuts.some(old=>old.id===s.id&&JSON.stringify(old.action)===JSON.stringify(s.action)))validateAction(s.action,service.profile);
    if(!smoke&&Boolean(p.launchAtLogin)!==service.preferences.launchAtLogin)app.setLoginItemSettings({openAtLogin:Boolean(p.launchAtLogin),args:app.isPackaged?['--background']:[app.getAppPath(),'--background']});
    if(p.clipboardMode!==undefined&&!['auto','focus','manual','off'].includes(p.clipboardMode))throw Error('复制同步方式无效');
    if(p.clipboardAutoSync!==undefined&&typeof p.clipboardAutoSync!=='boolean')throw Error('自动剪贴板同步设置无效');
    if(p.keyboardFollow!==undefined&&typeof p.keyboardFollow!=='boolean')throw Error('键盘跟随设置无效');
    if(p.keyboardFollow&&(!service.profile.keyboardChannels?.[service.identity.id]||Object.keys(service.profile.keyboardChannels).length<2))throw Error('请先配置本机与另一台电脑的键盘通道');
    if(p.mouseFollow!==undefined&&typeof p.mouseFollow!=='boolean')throw Error('鼠标跟随设置无效');
    if(p.mouseFollow&&(!service.profile.mouseChannels?.[service.identity.id]||Object.keys(service.profile.mouseChannels).length<2))throw Error('请先配置本机与另一台电脑的鼠标通道');
    const previousMode=service.preferences.compactMode,previousClipboard=service.preferences.clipboardMode,previousAutoSync=service.preferences.clipboardAutoSync;
    service.preferences={...service.preferences,theme:p.theme,launchAtLogin:Boolean(p.launchAtLogin),compactMode:typeof p.compactMode==='boolean'?p.compactMode:previousMode,autoMoveWindow:typeof p.autoMoveWindow==='boolean'?p.autoMoveWindow:service.preferences.autoMoveWindow,clipboardMode:p.clipboardMode||previousClipboard,clipboardAutoSync:p.clipboardAutoSync??previousAutoSync,keyboardFollow:p.keyboardFollow??service.preferences.keyboardFollow,mouseFollow:p.mouseFollow??service.preferences.mouseFollow,shortcuts:p.shortcuts};service.persist();nativeTheme.themeSource=p.theme;if(previousMode!==service.preferences.compactMode)resizeMode();if(!smoke){registerShortcuts();if(previousClipboard!==service.preferences.clipboardMode||previousAutoSync!==service.preferences.clipboardAutoSync)sharing.modeChanged();}service.changed();return {ok:true,state:snapshot()};
  };
  handle('preferences',savePreferences);
  for(const [kind,probe] of [['keyboard',keyboardProbe],['mouse',mouseProbe]])handle(kind+'-probe',async requestAccess=>{
    if(smoke)throw Error('只读界面验证模式不访问输入设备');
    if(typeof requestAccess!=='boolean')throw Error('检测参数无效');
    const pending=probe.inspect(requestAccess,true);service.changed();
    const result=await pending;service.changed();
    const key=kind+'Channels',channels=inferChannels(service.profile,service.identity,service.peers,result,key);
    if(JSON.stringify(channels)!==JSON.stringify(service.profile[key]||{})){
      const profile=structuredClone(service.profile);profile[key]=channels;await service.saveProfile(profile,profile.revision);
    }
    if(requestAccess&&process.platform==='darwin'&&result.status==='permission-required')await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent');
    return {ok:true,result,state:snapshot()};
  });
  handle('shortcuts-export',async()=>{
    const result=await dialog.showSaveDialog(win,{title:'导出快捷键',defaultPath:'屏间-快捷键.json',filters:[{name:'快捷键 JSON',extensions:['json']}]});
    if(result.canceled)return {cancelled:true};
    fs.writeFileSync(result.filePath,JSON.stringify(exportShortcuts(service.preferences.shortcuts),null,2)+'\n','utf8');return {ok:true};
  });
  handle('shortcuts-import-open',async()=>{
    const result=await dialog.showOpenDialog(win,{title:'导入快捷键',filters:[{name:'快捷键 JSON',extensions:['json']}],properties:['openFile']});
    if(result.canceled)return {cancelled:true};
    const file=result.filePaths[0];if(fs.statSync(file).size>1048576)throw Error('快捷键文件不能超过 1 MB');
    let data;try{data=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch{throw Error('无法读取 JSON，请选择屏间导出的快捷键文件');}
    planImport(data,service.preferences.shortcuts,service.profile);return {ok:true,data};
  });
  handle('shortcuts-import-preview',(data,mode)=>{
    const plan=planImport(data,service.preferences.shortcuts,service.profile,mode);const {shortcuts,...preview}=plan;return {ok:true,...preview};
  });
  handle('shortcuts-import-apply',async(data,mode)=>{
    const plan=planImport(data,service.preferences.shortcuts,service.profile,mode);if(!plan.accepted)throw Error('没有可导入的快捷键，现有配置未更改');
    const result=await savePreferences({...service.preferences,shortcuts:plan.shortcuts});
    return {...result,accepted:plan.accepted,skipped:plan.skipped,registrationFailures:shortcutRegistrationFailures(),registrationPending:shortcutSuspension.active};
  });
  handle('shortcuts-peer-read',async peerId=>({ok:true,...await service.readPeerShortcuts(peerId)}));
  handle('shortcuts-sync-preview',(data,selection,edits)=>{const {shortcuts,...preview}=planSelection(data,selection,edits,service.preferences.shortcuts,service.profile);return {ok:true,...preview};});
  handle('shortcuts-sync-apply',async(data,selection,edits)=>{
    const plan=planSelection(data,selection,edits,service.preferences.shortcuts,service.profile);if(!plan.accepted)throw Error('请先选择至少一条可合并的快捷键');
    const result=await savePreferences({...service.preferences,shortcuts:plan.shortcuts});
    return {...result,accepted:plan.accepted,skipped:plan.skipped,registrationFailures:shortcutRegistrationFailures(),registrationPending:shortcutSuspension.active};
  });
  handle('execute',execute);
  handle('pairing-code',()=>{if(service.networkError)throw Error(service.networkError);const pin=service.network.pairingCode();service.changed();return pin;});
  handle('pair',async d=>{if(!d||typeof d.host!=='string'||typeof d.code!=='string')throw Error('配对信息无效');await service.pair(d.host,Number(d.port),d.code);return {ok:true,state:snapshot()};});
  handle('unpair',async id=>{await service.unpair(id);return {ok:true};});
  handle('sync',async()=>{await service.refreshPeers();await service.sync();return {ok:true,state:snapshot()};});
  handle('clipboard-list',()=>sharing.items());
  handle('clipboard-refresh',async()=>{await sharing.pollPeers();return {ok:true,state:snapshot()};});
  handle('clipboard-publish',async()=>{await sharing.capture();return {ok:true,state:snapshot()};});
  handle('clipboard-copy',async(sourceId,itemId)=>{await sharing.copy(sourceId,itemId);return {ok:true};});
  handle('diagnostics',async()=>{
    const target=await dialog.showSaveDialog(win,{title:'导出诊断',defaultPath:'DisplayBridge-diagnostics.json',filters:[{name:'JSON',extensions:['json']}]});
    if(target.canceled)return {cancelled:true};
    const data=snapshot();delete data.pairing;fs.writeFileSync(target.filePath,JSON.stringify(data,null,2));return {ok:true};
  });
  if(process.platform==='darwin')Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'屏间',submenu:[{role:'about'},{type:'separator'},{role:'hide'},{role:'quit'}]},{role:'editMenu'},{role:'windowMenu'}]));
  else Menu.setApplicationMenu(null);
  if(!smoke){tray=new Tray(icon);tray.on('click',showTrayPanel);tray.on('right-click',showTrayPanel);tray.on('double-click',()=>{trayWindow?.hide();show();});}
  service.on('before-switch',assignments=>{windowSwitchPlan={assignments,expires:Date.now()+30000};moveWindowIfNeeded(assignments);});
  service.on('change',()=>{clearTimeout(broadcastTimer);broadcastTimer=setTimeout(()=>{if(!win.isDestroyed()){
    const states=service.states();if(windowSwitchPlan&&(windowSwitchPlan.expires<Date.now()||Object.entries(windowSwitchPlan.assignments).every(([mid,did])=>states[mid]?.confirmed&&states[mid].deviceId===did)))windowSwitchPlan=null;
    moveWindowIfNeeded(windowSwitchPlan?.assignments||{});win.webContents.send('bridge:changed',snapshot());
  }trayMenu();},80);});
  await service.start({network:!smoke});
  if(!smoke)sharing.start();
  if(!smoke)registerShortcuts();trayMenu();
  await win.loadFile(path.join(__dirname,'ui/index.html'));
  if(!smoke)await createTrayWindow();
  if(!smoke&&!process.argv.includes('--background'))win.show();
  const command=process.argv.find(a=>a.startsWith('--action='));if(command)await runCli(command.substring(9));
  if(smoke)await smokeTest();
}
async function runCli(value){try{const parts=value.split(':');const action=parts[0]==='input-cycle'?{type:'input-cycle'}:/^(keyboard|mouse)-(cycle|switch)$/.test(parts[0])?(parts[0].endsWith('-cycle')?{type:parts[0]}:{type:parts[0],deviceId:parts[1]}):parts[0]==='monitor-cycle'?{type:'monitor-cycle',monitorId:parts[1]}:parts[0]==='switch'?{type:'switch',monitorId:parts[1],deviceId:parts[2]}:{type:parts[0],id:parts[1]};await execute(action);}catch(e){service.log(e.message,'error');}}
async function smokeTest(){
  const dir=path.join(__dirname,'../artifacts');fs.mkdirSync(dir,{recursive:true});
  const errors=[];win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message);});
  await new Promise(r=>setTimeout(r,700));
  const check=await win.webContents.executeJavaScript(`({title:document.title,compact:document.body.classList.contains('compact'),sceneTiles:document.querySelectorAll('.scene-tile').length,cards:document.querySelectorAll('.monitor-card').length,cardWidths:[...document.querySelectorAll('.monitor-card')].map(x=>x.getBoundingClientRect().width),text:document.body.innerText,overflow:document.documentElement.scrollWidth>innerWidth})`);
  const image=await win.webContents.capturePage();fs.writeFileSync(path.join(dir,'windows-preview.png'),image.toPNG());
  nativeTheme.themeSource='light';await new Promise(r=>setTimeout(r,250));
  fs.writeFileSync(path.join(dir,'windows-preview-light.png'),(await win.webContents.capturePage()).toPNG());
  const pages=[];
  for(const page of ['scenes','devices','shortcuts','settings','clipboard']){
    await win.webContents.executeJavaScript(`document.querySelector('[data-page="${page}"]').click()`);await new Promise(r=>setTimeout(r,100));
    const result=await win.webContents.executeJavaScript(`({page:'${page}',overflow:document.documentElement.scrollWidth>innerWidth,title:document.querySelector('h1').textContent})`);pages.push(result);
    fs.writeFileSync(path.join(dir,`preview-${page}.png`),(await win.webContents.capturePage()).toPNG());
  }
  await win.webContents.executeJavaScript(`document.querySelector('[data-page="displays"]').click();document.querySelector('[data-action="monitor-edit"]').click()`);
  const modal=await win.webContents.executeJavaScript(`({open:document.querySelector('dialog').open,inputs:document.querySelectorAll('[id^="input-"]').length})`);
  fs.writeFileSync(path.join(dir,'preview-mapping.png'),(await win.webContents.capturePage()).toPNG());
  const interactions=await win.webContents.executeJavaScript(`(async()=>{
    const original=await window.bridge.state();
    const waitClose=async()=>{for(let i=0;i<60;i++){await new Promise(r=>setTimeout(r,50));if(!document.querySelector('dialog').open)return;const error=document.querySelector('#editor-error').textContent;if(error)throw Error(error);}throw Error('Editor did not close');};
    document.querySelector('#save-editor').click();await waitClose();
    document.querySelector('[data-page="scenes"]').click();
    document.querySelector('[data-action="scene-edit"]').click();
    document.querySelector('#scene-name').value='验证用混合场景';
    const sceneCards=[...document.querySelectorAll('[data-scene-monitor]')];if(sceneCards.length>1)sceneCards[1].querySelectorAll('[data-scene-target]')[1]?.click();
    document.querySelector('#save-editor').click();await waitClose();
    let current=await window.bridge.state();const scene=current.profile.scenes.find(s=>s.name==='验证用混合场景');if(!scene)throw Error('Scene was not persisted');
    document.querySelector('[data-action="cycle-edit"]').click();document.querySelector('#cycle-name').value='验证循环';
    const boxes=[...document.querySelectorAll('[name="cycle-scene"]')];boxes[0].checked=true;boxes.find(b=>b.value===scene.id).checked=true;
    document.querySelector('#save-editor').click();await waitClose();
    current=await window.bridge.state();const cycle=current.profile.cycles.find(c=>c.name==='验证循环');if(cycle?.sceneIds.length!==2)throw Error('Cycle selection was not persisted');
    document.querySelector('[data-page="devices"]').click();document.querySelector('[data-action="device-edit"]').click();document.querySelector('#device-name').value='验证用工作电脑';document.querySelector('#save-editor').click();await waitClose();
    current=await window.bridge.state();if(current.profile.devices[0].name!=='验证用工作电脑')throw Error('Device rename was not saved');
    document.querySelector('[data-page="displays"]').click();
    const handles=[...document.querySelectorAll('[data-drag-monitor]')],cards=[...document.querySelectorAll('[data-monitor-card]')];
    const orderBefore=current.profile.monitors.map(m=>m.id);
    if(handles.length>1){const dt=new DataTransfer();handles[0].dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));cards[1].dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:dt}));for(let i=0;i<40;i++){await new Promise(r=>setTimeout(r,50));current=await window.bridge.state();if(current.profile.monitors[0].id===orderBefore[1])break;}if(current.profile.monitors[0].id!==orderBefore[1])throw Error('Drag order was not saved');}
    document.querySelector('[data-action="self-check"]')?.click();
    for(let i=0;i<80;i++){await new Promise(r=>setTimeout(r,100));if(document.querySelector('#editor').open)break;}
    const selfCheckOpened=document.querySelector('#editor').open;if(!selfCheckOpened)throw Error('Self-check did not open');document.querySelector('#cancel-editor').click();
    current=await window.bridge.state();const restored=await window.bridge.saveProfile(original.profile,current.profile.revision);if(restored.error)throw Error(restored.error);
    return {mappingSaved:true,mixedSceneSaved:true,cycleSelectionSaved:true,deviceRenamed:true,dragOrderSaved:true,selfCheckOpened,restored:true};
  })()`);
  fs.writeFileSync(path.join(dir,'smoke-result.json'),JSON.stringify({...check,pages,modal,interactions,errors},null,2));
  const bad=errors.length||!check.compact||check.overflow||check.cardWidths.some(w=>w<250)||pages.some(p=>p.overflow)||!modal.open;
  console.log(JSON.stringify({cards:check.cards,cardWidths:check.cardWidths,pages,modal,interactions,errors}));app.exit(bad?1:0);
}
