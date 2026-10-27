const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {EventEmitter}=require('node:events');
const {randomUUID}=require('node:crypto');
const {createProfile,validateProfile,deriveState,chooseNextScene,chooseNextDevice,adoptDevice,cleanName,ensureQuickScenes}=require('./core.cjs');
const {Network,addresses}=require('./network.cjs');
const {exportShortcuts,planImport}=require('./shortcuts.cjs');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function atomic(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',value,{mode:0o600});fs.renameSync(file+'.tmp',file);}
class Service extends EventEmitter {
  constructor({dir,backend,platform=process.platform,codec=null}) {
    super();Object.assign(this,{dir,backend,codec});this.file=path.join(dir,'settings.json');this.secretFile=path.join(dir,'peers.secure');
    let saved={};if(fs.existsSync(this.file))saved=JSON.parse(fs.readFileSync(this.file,'utf8'));
    this.identity=saved.identity||{id:randomUUID(),name:os.hostname(),os:platform==='darwin'?'macOS':'Windows'};
    this.profile=saved.profile?validateProfile(saved.profile):createProfile(this.identity);
    this.preferences={theme:'system',pollSeconds:5,launchAtLogin:false,compactMode:true,autoMoveWindow:true,clipboardMode:'auto',clipboardAutoSync:false,keyboardFollow:false,mouseFollow:false,shortcuts:[],...saved.preferences};
    this.peers=[];this.secretError=null;
    if(fs.existsSync(this.secretFile))try{const raw=fs.readFileSync(this.secretFile);this.peers=JSON.parse(codec?codec.decode(raw):raw.toString());}catch{this.secretError='无法解密已保存的配对，请重新配对';}
    this.local=[];this.remote=new Map();this.logs=[];this.results={};this.lastAction=null;this.busy=false;this.localError=null;this.scanPromise=null;this.networkError=null;this.syncStatus={};
    this.network=new Network({identity:this.identity,getPeers:()=>this.peers,savePeer:p=>this.savePeer(p),removePeer:id=>this.removePeer(id),getStatus:async fresh=>{if(fresh)await this.refresh();return this.publicStatus();},getShortcuts:()=>({device:this.identity,configuration:exportShortcuts(this.preferences.shortcuts,platform)}),onProfile:p=>this.receiveProfile(p),onCommand:d=>this.remoteSwitch(d),onChange:()=>this.changed()});
    this.persist();
  }
  persist(){atomic(this.file,JSON.stringify({identity:this.identity,profile:this.profile,preferences:this.preferences},null,2));}
  persistPeers(){const data=JSON.stringify(this.peers);atomic(this.secretFile,this.codec?this.codec.encode(data):data);}
  changed(){this.emit('change');}
  log(message,type='info'){this.logs.unshift({id:randomUUID(),time:Date.now(),message,type});this.logs=this.logs.slice(0,100);this.changed();}
  async start({network=true}={}) {
    if(network)try{await this.network.start();}catch(e){this.networkError=e.message;this.log('局域网服务未启动：'+e.message,'error');}
    await this.refresh(true);
    this.poll=setInterval(()=>{if(!this.busy)this.refresh().catch(e=>this.log(e.message,'error'));},this.preferences.pollSeconds*1000);
    this.peerPoll=setInterval(()=>{if(!this.busy)this.refreshPeers().catch(()=>{});},4000);
    this.poll.unref();this.peerPoll.unref();
  }
  close(){clearInterval(this.poll);clearInterval(this.peerPoll);this.network.close();}
  mergeLocal(profile) {
    let changed=false;
    for(const native of this.local) {
      let monitor=profile.monitors.find(m=>m.endpoints[this.identity.id]===native.id);
      if(!monitor&&native.serial)monitor=profile.monitors.find(m=>m.serial===native.serial);
      if(!monitor){const matches=profile.monitors.filter(m=>cleanName(m.model)===cleanName(native.name)&&!m.endpoints[this.identity.id]);if(matches.length===1)monitor=matches[0];}
      if(monitor){if(monitor.endpoints[this.identity.id]!==native.id){monitor.endpoints[this.identity.id]=native.id;changed=true;}continue;}
      const id=randomUUID();profile.monitors.push({id,name:native.name,model:native.name,serial:native.serial||'',inputs:{},endpoints:{[this.identity.id]:native.id}});changed=true;
      if(!profile.primaryId||/cu34g3x/i.test(native.name))profile.primaryId=id;
    }
    if(!profile.groups.length&&profile.monitors.length){
      const group={id:randomUUID(),name:'桌面显示器',monitorIds:profile.monitors.map(m=>m.id)};profile.groups.push(group);
      const scenes=profile.devices.map(d=>({id:randomUUID(),name:d.os==='macOS'?'全部切到 Mac':'全部切到 Windows',groupId:group.id,assignments:Object.fromEntries(group.monitorIds.map(id=>[id,d.id]))}));
      profile.scenes.push(...scenes);profile.cycles.push({id:randomUUID(),name:'桌面循环',groupId:group.id,sceneIds:scenes.map(s=>s.id)});changed=true;
    }
    return ensureQuickScenes(profile)||changed;
  }
  async refresh(probe=false) {
    if(this.scanPromise)return this.scanPromise;
    this.scanPromise=(async()=>{
      try {this.local=await this.backend.scan(probe);this.localError=null;if(this.mergeLocal(this.profile)){this.profile.revision=randomUUID();this.persist();}}
      catch(e){this.localError=e.message;this.local=this.local.map(m=>({...m,readable:false}));}
      this.changed();
    })().finally(()=>{this.scanPromise=null;});return this.scanPromise;
  }
  publicStatus(){return {device:this.identity,revision:this.profile.revision,monitors:this.local.map(m=>({...m,ageMs:Math.max(0,Date.now()-m.observedAt)})),error:this.localError};}
  async refreshPeers({fresh=false}={}) {
    await Promise.allSettled(this.peers.map(async p=>{
      try {
        // Discovery is a hint only; authenticate every response before accepting it.
        const hint=this.network.discovered.get(p.id);const endpoint=hint?{...p,host:hint.host,port:hint.port}:p;
        const result=await this.network.call(endpoint,'GET',fresh?'/status?refresh=1':'/status',undefined,fresh?25000:7000);
        if(result.device?.id!==p.id||!Array.isArray(result.monitors)||result.monitors.length>64)throw Error('对端状态无效');
        const now=Date.now();
        this.remote.set(p.id,{...result,seenAt:now,monitors:result.monitors.map(m=>({...m,observedAt:now-Math.max(0,Number.isFinite(m.ageMs)?m.ageMs:60000)}))});
        if(endpoint.host!==p.host||endpoint.port!==p.port){p.host=endpoint.host;p.port=endpoint.port;this.persistPeers();}
      }catch(e){this.remote.set(p.id,{...this.remote.get(p.id),offline:true,seenAt:0,error:e.message});}
    }));this.changed();
  }
  online(){return new Set([this.identity.id,...[...this.remote].filter(([,s])=>Date.now()-s.seenAt<15000).map(([id])=>id)]);}
  observations(){
    const obs=this.local.map(m=>({...m,deviceId:this.identity.id,nativeId:m.id}));
    for(const [id,status] of this.remote)if(Date.now()-status.seenAt<15000)for(const m of status.monitors||[])obs.push({...m,deviceId:id,nativeId:m.id});
    return obs;
  }
  states(){const obs=this.observations();return Object.fromEntries(this.profile.monitors.map(m=>[m.id,deriveState(m,obs)]));}
  snapshot(){return {identity:this.identity,profile:this.profile,preferences:this.preferences,states:this.states(),local:this.local,remote:Object.fromEntries(this.remote),online:[...this.online()],peers:this.peers.map(({inboundToken,outboundToken,...p})=>p),discovered:[...this.network.discovered.values()],addresses:addresses(),port:this.network.port,pairing:this.network.pin,networkError:this.networkError||this.network.error||this.secretError,localError:this.localError,logs:this.logs,results:this.results,lastAction:this.lastAction,busy:this.busy,syncStatus:this.syncStatus};}
  savePeer(peer){this.peers=this.peers.filter(p=>p.id!==peer.id);this.peers.push(peer);adoptDevice(this.profile,{id:peer.id,name:peer.name,os:peer.os});this.profile.revision=randomUUID();this.persistPeers();this.persist();this.log('已配对 '+peer.name);}
  removePeer(id){this.peers=this.peers.filter(p=>p.id!==id);this.remote.delete(id);this.persistPeers();this.changed();}
  async pair(host,port,code){await this.network.pair(host,port,code);await this.refreshPeers();await this.sync();return this.snapshot();}
  async readPeerShortcuts(peerId){
    const peer=this.peers.find(p=>p.id===peerId);if(!peer)throw Error('请先配对这台电脑');
    await this.refreshPeers();if(!this.online().has(peerId))throw Error('这台电脑当前离线，请确认对方屏间正在运行');
    let response;try{response=await this.network.call(peer,'GET','/shortcuts');}catch(e){if(e.message==='未知操作')throw Error('对方版本尚不支持快捷键同步，请更新对方的屏间');throw e;}
    if(response.device?.id!==peerId)throw Error('对端身份与配对记录不一致');
    planImport(response.configuration,[],this.profile);
    return {sourceId:peerId,data:response.configuration};
  }
  async unpair(id){const peer=this.peers.find(p=>p.id===id);if(peer)try{await this.network.call(peer,'POST','/unpair',{});}catch{}this.removePeer(id);}
  receiveProfile(incoming) {
    if(this.busy)throw Error('对端正在切换，请稍后同步配置');
    const profile=validateProfile(structuredClone(incoming));
    if(!profile.devices.some(d=>d.id===this.identity.id))throw Error('配置中缺少本机');
    this.mergeLocal(profile);this.profile=profile;this.persist();this.log('已接收共享配置');
  }
  async sync() {
    for(const peer of this.peers)try{
      // Include the peer's native monitor identities using serial, then unique model.
      for(const n of this.remote.get(peer.id)?.monitors||[]) {
        const matches=this.profile.monitors.filter(m=>(n.serial&&m.serial===n.serial)||cleanName(m.model)===cleanName(n.name));
        if(matches.length===1)matches[0].endpoints[peer.id]=n.id;
      }
      await this.network.call(peer,'POST','/profile',this.profile);this.syncStatus[peer.id]='已同步';
    }catch(e){this.syncStatus[peer.id]='待同步：'+e.message;}
    this.persist();this.changed();
  }
  async saveProfile(profile,baseRevision) {
    if(this.busy)throw Error('切换进行中，请稍后保存');
    if(baseRevision!==this.profile.revision)throw Error('配置已更新，请关闭编辑器后重新编辑');
    const next=validateProfile(structuredClone(profile));
    if(!next.devices.some(d=>d.id===this.identity.id))throw Error('不能移除本机');
    next.revision=randomUUID();this.profile=next;this.persist();this.changed();await this.sync();return this.snapshot();
  }
  async remoteSwitch({monitorId,deviceId,assignments}) {
    if(this.busy)throw Error('对端正忙');
    const m=this.profile.monitors.find(m=>m.id===monitorId),input=m?.inputs[deviceId],nativeId=m?.endpoints[this.identity.id];
    if(!m||!nativeId||!Number.isInteger(input))throw Error('对端输入映射未配置，请同步配置');
    this.busy=true;this.changed();
    try{this.emit('before-switch',assignments&&assignments[monitorId]===deviceId?assignments:{[monitorId]:deviceId});await this.backend.set(nativeId,input);await this.refresh();}finally{this.busy=false;this.changed();}
  }
  async switchOne(monitorId,deviceId,force=false,assignments) {
    const m=this.profile.monitors.find(m=>m.id===monitorId);if(!m||!Number.isInteger(m.inputs[deviceId]))throw Error('请先为该显示器配置目标电脑的输入接口');
    if(!force&&!this.online().has(deviceId)){const e=Error('目标电脑离线，是否仍然切换？');e.code='OFFLINE';throw e;}
    if(this.states()[monitorId]?.deviceId===deviceId&&this.states()[monitorId]?.confirmed){this.results[monitorId]={status:'confirmed',message:'已在目标设备'};return;}
    this.results[monitorId]={status:'switching',message:'正在切换…'};this.changed();
    const current=this.states()[monitorId]?.deviceId;
    const candidates=Object.keys(m.endpoints).filter(id=>this.online().has(id)).sort((a,b)=>(a===current?-2:a===this.identity.id?-1:0)-(b===current?-2:b===this.identity.id?-1:0));
    let sent=false;const errors=[];
    // A successful DDC transport write is not proof that the monitor changed input.
    // Try another paired control path only after fresh reads fail to verify the first.
    for(const id of candidates){
      try{
        if(id===this.identity.id)await this.backend.set(m.endpoints[id],m.inputs[deviceId]);
        else{const peer=this.peers.find(p=>p.id===id);if(!peer)continue;await this.network.call(peer,'POST','/switch',{monitorId,deviceId,assignments},25000);}
        sent=true;
      }catch(e){errors.push(e.message);continue;}
      this.results[monitorId]={status:'pending',message:'指令已发送，正在验证…'};this.changed();
      for(let n=0;n<3;n++) {
        await delay(1300);await Promise.all([this.refresh(),this.refreshPeers({fresh:true})]);
        const state=this.states()[monitorId];
        if(state?.confirmed&&state.deviceId===deviceId){this.results[monitorId]={status:'confirmed',message:'已确认切换'};this.log(`${m.name} 已切换到 ${this.profile.devices.find(d=>d.id===deviceId)?.name}`);return;}
      }
      if(id!==candidates.at(-1))this.log(m.name+' 尚未确认输入，尝试另一条控制通路');
    }
    if(!sent)throw Error(errors.join('；')||'没有在线且可用的显示器控制端');
    this.results[monitorId]={status:'unverified',message:'已发送，未能确认画面。请检查显示器'};this.log(m.name+' 切换指令已发送，但未能确认结果','warning');
  }
  async execute(action,{force=false}={}) {
    if(this.busy)throw Error('正在切换，请稍候');
    if(['input-cycle','keyboard-cycle','keyboard-switch','mouse-cycle','mouse-switch'].includes(action?.type)){
      this.busy=true;this.changed();
      try{
        if(!this.onInputAction)throw Error('此版本不支持独立键鼠切换');
        await this.refreshPeers();
        const result=await this.onInputAction(action),kind=action.type.split('-')[0];
        this.lastAction={time:Date.now(),ok:result.status==='confirmed',message:result.message,results:[],[kind]:result};
        if(action.type==='input-cycle')Object.assign(this.lastAction,{keyboard:result.keyboard,mouse:result.mouse,targetDeviceId:result.targetDeviceId});
        if(!this.lastAction.ok)throw Error(result.message);
        this.log(result.message);
      }finally{this.busy=false;this.changed();}
      return this.snapshot();
    }
    if(!action||!['switch','scene','cycle','monitor-cycle'].includes(action.type))throw Error('未知动作');
    this.busy=true;this.changed();
    try {
    await this.refreshPeers({fresh:action.type==='monitor-cycle'});
    await this.refresh();
    let assignments;
    if(action.type==='switch') assignments={[action.monitorId]:action.deviceId};
    else if(action.type==='monitor-cycle') {
      let current=this.states()[action.monitorId];
      // Video handshakes can briefly invalidate DDC reads immediately after a switch.
      for(let attempt=0;attempt<2&&!current?.confirmed;attempt++){
        await delay(700);await Promise.all([this.refresh(),this.refreshPeers({fresh:true})]);current=this.states()[action.monitorId];
      }
      assignments={[action.monitorId]:chooseNextDevice(this.profile,action.monitorId,current,this.online())};
    }
    else {
      let scene;
      if(action.type==='cycle'){const cycle=this.profile.cycles.find(c=>c.id===action.id);if(!cycle)throw Error('循环不存在');scene=chooseNextScene(this.profile,cycle,this.states(),this.online());}
      else scene=this.profile.scenes.find(s=>s.id===action.id);
      if(!scene)throw Error('场景不存在');assignments=scene.assignments;
    }
    // Preflight the whole scene before touching any screen.
    for(const [mid,did] of Object.entries(assignments)) {
      if(!Number.isInteger(this.profile.monitors.find(m=>m.id===mid)?.inputs[did]))throw Error('输入映射未完成，请先配置接口');
      if(!force&&!this.online().has(did)){const e=Error('目标电脑离线，是否仍然切换？');e.code='OFFLINE';throw e;}
    }
      this.emit('before-switch',assignments);
      for(const [mid,did] of Object.entries(assignments))try{await this.switchOne(mid,did,force,assignments);}catch(e){this.results[mid]={status:'failed',message:e.message};this.log(e.message,'error');}
      const results=Object.keys(assignments).map(mid=>({monitorId:mid,...this.results[mid]}));
      const confirmed=results.filter(r=>r.status==='confirmed').length,failed=results.filter(r=>r.status==='failed').length;
      this.lastAction={time:Date.now(),results,ok:confirmed===results.length,message:confirmed===results.length?`已确认 ${confirmed} 台显示器的目标输入`:`${confirmed} 台已确认，${failed} 台失败，${results.length-confirmed-failed} 台待确认。请查看显示器卡片。`};
      const primary=this.profile.primaryId;
      if(Object.hasOwn(assignments,primary)&&this.results[primary]?.status==='confirmed'){
        await Promise.all([['keyboard',this.onPrimaryConfirmed],['mouse',this.onPrimaryMouseConfirmed]].map(async([kind,follow])=>{
          if(!follow)return;
          try{this.lastAction[kind]=await follow(assignments[primary]);}catch(e){this.lastAction[kind]={status:'failed',message:e.message};}
          if(this.lastAction[kind]?.status==='failed')this.log(this.lastAction[kind].message,'warning');
        }));
      }
    }finally{this.busy=false;this.changed();}
    return this.snapshot();
  }
  async selfCheck(){
    await Promise.all([this.refresh(true),this.refreshPeers({fresh:true})]);
    if(this.peers.length)await this.sync();
    return this.snapshot();
  }
  async confirmVisible(monitorId){
    if(this.busy)throw Error('正在切换，请稍后确认');
    await this.refresh(true);
    const p=structuredClone(this.profile),m=p.monitors.find(m=>m.id===monitorId),n=this.local.find(n=>n.id===m?.endpoints[this.identity.id]);
    if(!n?.readable||!Number.isInteger(n.input))throw Error('当前无法读取输入，暂时需要手动配置接口');
    if(Object.entries(m.inputs).some(([id,value])=>id!==this.identity.id&&value===n.input))throw Error('当前输入已关联另一台电脑，请在完整配置中检查映射');
    m.inputs[this.identity.id]=n.input;
    return this.saveProfile(p,this.profile.revision);
  }
}
module.exports={Service,atomic};
