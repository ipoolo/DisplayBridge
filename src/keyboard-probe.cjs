const path=require('node:path');
const {run}=require('./native.cjs');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function inferChannels(profile,identity,peers,probe,key='keyboardChannels'){
  const channels={...profile[key]};if(probe.status!=='ready')return channels;
  const add=(id,channel)=>{if(!channels[id]&&!Object.values(channels).includes(channel))channels[id]=channel;};
  add(identity.id,probe.currentChannel);
  const normalize=name=>String(name||'').replace(/\.local$/i,'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
  for(const host of probe.hosts||[]){
    if(!host.paired||!normalize(host.name))continue;
    const matches=profile.devices.filter(d=>[d,identity,...peers].some(n=>n.id===d.id&&normalize(n.name)===normalize(host.name)));
    if(matches.length===1)add(matches[0].id,host.channel);
  }
  return channels;
}
class KeyboardProbe{
  constructor(root,platform=process.platform,execute=run,kind='keyboard'){if(!['keyboard','mouse'].includes(kind))throw Error('设备类型无效');Object.assign(this,{root,platform,execute,kind});this.result=null;this.pending=null;this.switching=null;}
  message(text){return this.kind==='mouse'?text.replaceAll('键盘','鼠标').replaceAll('MX Keys','MX Master 3S'):text;}
  args(args){return this.kind==='mouse'?['mouse',...args]:args;}
  inspect(requestAccess=false,hosts=false){
    if(this.switching)return this.switching.catch(()=>{}).then(()=>this.inspect(requestAccess,hosts));
    if(this.pending)return this.pending;
    this.pending=this.perform(requestAccess,hosts).then(result=>this.result={...result,...(result.device?{device:this.message(result.device)}:{}),message:this.message(result.message)}).finally(()=>{this.pending=null;});return this.pending;
  }
  binary(){return path.join(this.root,this.platform==='darwin'?'keyboard-probe':'keyboard-control.exe');}
  async perform(requestAccess,hosts){
    try{
      const args=this.args([this.platform==='darwin'?(requestAccess?'request-access':hosts?'inspect-hosts':'inspect'):'inspect']);
      let raw=JSON.parse(await this.execute(this.binary(),args,hosts?25000:12000));
      if(raw.status==='no-response'&&!requestAccess){await delay(200);raw=JSON.parse(await this.execute(this.binary(),args,hosts?25000:12000));}
      const messages={
        'permission-required':'需要 Mac 的输入监控权限。点击“授权键盘访问”，在系统设置中允许 DisplayBridge，然后重新打开屏间并再次检测。',
        'not-connected':'本机未检测到 MX Keys。请唤醒键盘，并确认 Easy-Switch 已连接到这台电脑。',
        'unsupported':'键盘未报告软件切换通道功能，暂不能启用硬件跟随。',
        'no-response':'已打开控制接口，但键盘未返回通道信息。请唤醒键盘后重试。',
        'open-failed':'键盘控制接口无法打开，请重连键盘后重试。'
      };
      if(raw.status==='ready'){
        if(!Number.isInteger(raw.channels)||raw.channels<1||raw.channels>3||!Number.isInteger(raw.currentChannel)||raw.currentChannel<1||raw.currentChannel>raw.channels)throw Error('键盘返回的通道信息无效');
        const knownHosts=Array.isArray(raw.hosts)?raw.hosts.filter(h=>Number.isInteger(h.channel)&&h.channel>=1&&h.channel<=3&&typeof h.name==='string').map(h=>({channel:h.channel,paired:h.paired===true,name:h.name.slice(0,100)})):[];
        return this.result={status:'ready',device:'MX Keys',channels:raw.channels,currentChannel:raw.currentChannel,hosts:knownHosts,message:`当前通道 ${raw.currentChannel}，共 ${raw.channels} 个通道；已读到软件切换能力。`};
      }
      if(!messages[raw.status])throw Error('无法识别键盘检测结果');
      return this.result={status:raw.status,message:messages[raw.status],...(typeof raw.code==='string'?{code:raw.code.slice(0,20)}:{})};
    }catch(e){return this.result={status:'error',message:'键盘检测失败：'+e.message.slice(0,300)};}
  }
  async switchTo(channel){
    if(!Number.isInteger(channel)||channel<1||channel>3)throw Error(this.message('键盘目标通道无效'));
    if(this.switching)throw Error(this.message('键盘正在切换，请稍候'));
    const operation=this.performSwitch(channel);this.switching=operation;
    try{return await operation;}finally{this.switching=null;}
  }
  async performSwitch(channel){
    if(this.pending)await this.pending;
    let raw;
    for(let attempt=0;attempt<3;attempt++){
      if(attempt)await delay(350);
      raw=JSON.parse(await this.execute(this.binary(),this.args(['switch',String(channel)]),12000));
      // Native no-response is returned only before any ChangeHost write.
      if(raw.status!=='no-response')break;
    }
    if(raw.status==='ready'&&raw.currentChannel===channel)return {status:'already',channel};
    if(raw.status==='sent'&&raw.targetChannel===channel){
      this.result={status:'switched-away',message:this.message('已发送键盘切换指令；点击检测可更新本机连接状态。')};
      return {status:'sent',channel};
    }
    throw Error(this.message('键盘未接受切换：')+String(raw.status||'unknown').slice(0,80));
  }
}
module.exports={KeyboardProbe,inferChannels};
