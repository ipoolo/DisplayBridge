const delay=ms=>new Promise(r=>setTimeout(r,ms));
class KeyboardFollow{
  constructor(service,probe,kind='keyboard'){if(!['keyboard','mouse'].includes(kind))throw Error('设备类型无效');Object.assign(this,{service,probe,kind});this.busy=false;this.result=null;}
  message(text){return this.kind==='mouse'?text.replaceAll('键盘','鼠标').replaceAll('MX Keys','MX Master 3S'):text;}
  finish(status,message){return this.result={status,message:this.message(message)};}
  channel(deviceId){return this.service.profile[this.kind+'Channels']?.[deviceId];}
  enabled(){return this.service.preferences[this.kind+'Follow']===true;}
  async localStatus(){return {deviceId:this.service.identity.id,enabled:this.enabled(),manualSwitch:true,probe:await this.probe.inspect(false)};}
  async status(deviceId){
    if(deviceId===this.service.identity.id)return this.localStatus();
    const peer=this.service.peers.find(p=>p.id===deviceId);if(!peer)throw Error('键盘目标电脑尚未配对');
    const result=await this.service.network.call(peer,'GET','/'+this.kind,undefined,15000);
    if(result.deviceId!==deviceId)throw Error('键盘控制端身份不匹配');return result;
  }
  receive(data){return this.performReceive(data).catch(e=>{throw Error(this.message(e.message));});}
  receiveManual(data,localInitiator=false){return this.performManualReceive(data,localInitiator).catch(e=>{throw Error(this.message(e.message));});}
  async performManualReceive(data,localInitiator){
    const service=this.service;
    if(this.busy||service.busy&&!localInitiator)throw Error('键盘控制端正在切换，请稍候');
    const valid=()=>data&&data.revision===service.profile.revision&&Number.isInteger(this.channel(data.targetDeviceId))&&data.sourceChannel===this.channel(service.identity.id);
    if(!valid())throw Error('键盘配置已变化或目标通道未配置，请重试');
    if(data.targetDeviceId!==service.identity.id&&!service.peers.some(p=>p.id===data.targetDeviceId))throw Error('目标电脑尚未配对');
    this.busy=true;
    try{
      await service.refreshPeers();
      if(!service.online().has(data.targetDeviceId))throw Error('目标电脑离线，未切换键盘');
      const before=await this.probe.inspect(false);
      if(before.status!=='ready'||before.currentChannel!==data.sourceChannel)throw Error('键盘连接已变化，请重新检测后再试');
      if(!valid()||!service.online().has(data.targetDeviceId))throw Error('键盘配置或连接已变化，未执行切换');
      return await this.probe.switchTo(this.channel(data.targetDeviceId));
    }finally{this.busy=false;}
  }
  async manual(action,expected={}){
    const service=this.service;
    try{
      if(this.busy)throw Error('键盘正在切换，请稍候');
      if(![this.kind+'-switch',this.kind+'-cycle'].includes(action?.type))throw Error('不支持的键盘动作');
      const revision=service.profile.revision;
      if(expected.revision!==undefined&&expected.revision!==revision)throw Error('键盘配置已变化，请重试');
      const configured=service.profile.devices.filter(d=>Number.isInteger(this.channel(d.id))).sort((a,b)=>this.channel(a.id)-this.channel(b.id));
      if(action.type.endsWith('-switch')&&(!configured.some(d=>d.id===action.deviceId)||!service.online().has(action.deviceId)))throw Error('目标电脑离线或键盘通道未配置');
      const ids=[service.identity.id,...service.peers.filter(p=>service.online().has(p.id)).map(p=>p.id)];
      const checks=await Promise.all(ids.map(async id=>{try{return await this.status(id);}catch{return {deviceId:id};}}));
      const attached=checks.filter(r=>r.probe?.status==='ready');
      if(attached.length!==1)throw Error(attached.length?'多台电脑报告键盘在线，未执行切换':'未找到可控制的键盘，请唤醒并重新检测');
      const source=attached[0];
      if(expected.sourceDeviceId!==undefined&&source.deviceId!==expected.sourceDeviceId)throw Error('键盘连接已变化，请重新执行同步循环');
      if(source.probe.currentChannel!==this.channel(source.deviceId))throw Error('当前键盘通道与配置不一致');
      let targetId=action.deviceId;
      if(action.type.endsWith('-cycle')){
        const current=configured.findIndex(d=>d.id===source.deviceId);
        for(let offset=1;offset<configured.length;offset++){const next=configured[(current+offset)%configured.length];if(service.online().has(next.id)){targetId=next.id;break;}}
        if(!targetId)throw Error('没有其他在线且已配置键盘通道的电脑');
      }
      const target=checks.find(r=>r.deviceId===targetId);
      if(!source.manualSwitch||!target?.manualSwitch)throw Error('请将两端屏间更新到支持独立键鼠快捷键的版本');
      if(revision!==service.profile.revision)throw Error('键盘配置已变化，请重试');
      if(source.deviceId===targetId)return this.finish('confirmed','键盘已在目标电脑');
      const data={targetDeviceId:targetId,revision,sourceChannel:source.probe.currentChannel};let sendError;
      try{
        if(source.deviceId===service.identity.id)await this.receiveManual(data,true);
        else await service.network.call(service.peers.find(p=>p.id===source.deviceId),'POST','/'+this.kind+'-switch',data,25000);
      }catch(e){sendError=e.message;}
      for(let attempt=0;attempt<8;attempt++){
        await delay(700);let check;try{check=await this.status(targetId);}catch{continue;}
        if(check.probe?.status==='ready'&&check.probe.currentChannel===this.channel(targetId))return this.finish('confirmed','键盘已切换 · 通道 '+this.channel(targetId));
      }
      throw Error((sendError?sendError+'；':'')+'未确认键盘到达目标电脑，可使用 Easy-Switch 实体键恢复');
    }catch(e){return this.finish('failed','键盘切换未完成：'+e.message);}
  }
  async performReceive(data){
    if(!this.enabled())throw Error('本机键盘跟随开关未开启');
    if(this.busy)throw Error('键盘正在切换，请稍候');
    if(!data||data.primaryId!==this.service.profile.primaryId||data.revision!==this.service.profile.revision)throw Error('主屏或配置已变化，请重试');
    const channel=this.channel(data.targetDeviceId);
    if(!Number.isInteger(channel))throw Error('目标电脑的键盘通道尚未配置');
    if(data.targetDeviceId!==this.service.identity.id&&!this.service.peers.some(p=>p.id===data.targetDeviceId))throw Error('目标电脑尚未配对');
    this.busy=true;
    try{
      let current;
      for(let attempt=0;attempt<5;attempt++){
        if(attempt)await delay(700);
        if(!this.enabled()||data.revision!==this.service.profile.revision)throw Error('跟随开关或配置已变化，未切换键盘');
        await Promise.all([this.service.refresh(),this.service.refreshPeers({fresh:true})]);
        current=this.service.states()[data.primaryId];if(current?.confirmed&&current.deviceId===data.targetDeviceId)break;
      }
      if(!current?.confirmed||current.deviceId!==data.targetDeviceId)throw Error('主屏尚未确认显示目标电脑，未切换键盘');
      if(!this.service.online().has(data.targetDeviceId))throw Error('目标电脑离线，未切换键盘');
      const before=await this.probe.inspect(false);
      if(before.status!=='ready')throw Error(before.message||'本机未连接键盘');
      if(!this.enabled()||data.primaryId!==this.service.profile.primaryId||data.revision!==this.service.profile.revision)throw Error('跟随开关或配置已变化，未切换键盘');
      if(before.currentChannel!==this.channel(this.service.identity.id))throw Error('本机键盘通道与配置不一致，请重新检测');
      return await this.probe.switchTo(channel);
    }finally{this.busy=false;}
  }
  async follow(targetDeviceId){
    if(!this.enabled())return {status:'disabled'};
    const service=this.service,channel=this.channel(targetDeviceId);
    try{
      if(!Number.isInteger(channel))throw Error('请先配置目标电脑的键盘通道');
      if(!service.online().has(targetDeviceId))throw Error('目标电脑离线');
      const ids=[service.identity.id,...service.peers.filter(p=>service.online().has(p.id)).map(p=>p.id)];
      const checks=await Promise.all(ids.map(async id=>{try{return await this.status(id);}catch(e){return {deviceId:id,error:e.message};}}));
      const target=checks.find(r=>r.deviceId===targetDeviceId);
      if(!target?.enabled)throw Error('请在目标电脑开启键盘跟随');
      const attached=checks.filter(r=>r.probe?.status==='ready');
      if(attached.length!==1)throw Error(attached.length?'多台电脑报告键盘在线，未自动切换':'未找到可控制的 MX Keys，请唤醒键盘并检查权限');
      const source=attached[0];if(!source.enabled)throw Error('请在键盘当前连接的电脑开启跟随');
      if(source.probe.currentChannel!==this.channel(source.deviceId))throw Error('检测到的键盘通道与配置不符');
      if(source.deviceId===targetDeviceId)return this.finish('confirmed','键盘已在主屏所在电脑');
      const data={targetDeviceId,primaryId:service.profile.primaryId,revision:service.profile.revision};
      let sendError;
      try{
        if(source.deviceId===service.identity.id)await this.receive(data);
        else await service.network.call(service.peers.find(p=>p.id===source.deviceId),'POST','/'+this.kind+'-follow',data,25000);
      }catch(e){sendError=e.message;}
      for(let i=0;i<8;i++){
        await delay(700);let check;try{check=await this.status(targetDeviceId);}catch{continue;}
        if(check.probe?.status==='ready'&&check.probe.currentChannel===channel)return this.finish('confirmed','键盘已跟随主屏 · 通道 '+channel);
      }
      throw Error((sendError?sendError+'；':'切换指令已发送，但')+'未确认键盘到达目标电脑；可使用 Easy-Switch 实体键恢复');
    }catch(e){return this.finish('failed','键盘跟随未完成：'+e.message);}
  }
}
module.exports={KeyboardFollow};
