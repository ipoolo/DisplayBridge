const delay=ms=>new Promise(r=>setTimeout(r,ms));
class KeyboardFollow{
  constructor(service,probe,kind='keyboard'){if(!['keyboard','mouse'].includes(kind))throw Error('设备类型无效');Object.assign(this,{service,probe,kind});this.busy=false;this.result=null;}
  message(text){return this.kind==='mouse'?text.replaceAll('键盘','鼠标').replaceAll('MX Keys','MX Master 3S'):text;}
  finish(status,message){return this.result={status,message:this.message(message)};}
  channel(deviceId){return this.service.profile[this.kind+'Channels']?.[deviceId];}
  enabled(){return this.service.preferences[this.kind+'Follow']===true;}
  async localStatus(){return {deviceId:this.service.identity.id,enabled:this.enabled(),probe:await this.probe.inspect(false)};}
  async status(deviceId){
    if(deviceId===this.service.identity.id)return this.localStatus();
    const peer=this.service.peers.find(p=>p.id===deviceId);if(!peer)throw Error('键盘目标电脑尚未配对');
    const result=await this.service.network.call(peer,'GET','/'+this.kind,undefined,15000);
    if(result.deviceId!==deviceId)throw Error('键盘控制端身份不匹配');return result;
  }
  receive(data){return this.performReceive(data).catch(e=>{throw Error(this.message(e.message));});}
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
