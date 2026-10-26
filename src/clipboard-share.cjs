const {EventEmitter}=require('node:events');
const {createHash,randomBytes,randomUUID,createCipheriv,createDecipheriv}=require('node:crypto');
const MAX_IMAGE=8*1024*1024,MAX_TEXT=1024*1024,MAX_WIRE=18*1024*1024;
const keyFor=p=>createHash('sha256').update('DisplayBridge clipboard v1\0'+[p.inboundToken,p.outboundToken].sort().join('|')).digest();
function seal(value,peer){const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',keyFor(peer),nonce);cipher.setAAD(Buffer.from('displaybridge-clipboard-v1'));const data=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);return {version:1,nonce:nonce.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')};}
function unseal(envelope,peer){
  if(!envelope||envelope.version!==1||typeof envelope.data!=='string'||envelope.data.length>MAX_WIRE||typeof envelope.nonce!=='string'||typeof envelope.tag!=='string')throw Error('剪贴板响应无效');
  const nonce=Buffer.from(envelope.nonce,'base64'),tag=Buffer.from(envelope.tag,'base64');if(nonce.length!==12||tag.length!==16)throw Error('剪贴板响应无效');
  const decipher=createDecipheriv('aes-256-gcm',keyFor(peer),nonce);decipher.setAAD(Buffer.from('displaybridge-clipboard-v1'));decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data,'base64')),decipher.final()]).toString('utf8'));
}
function validateContent(value){
  if(value?.kind==='text'){
    if(typeof value.text!=='string'||!value.text.length||Buffer.byteLength(value.text,'utf8')>MAX_TEXT)throw Error('文本为空或超过 1 MB');
    return {kind:'text',text:value.text,bytes:Buffer.byteLength(value.text,'utf8')};
  }
  if(value?.kind==='image'){
    if(typeof value.png!=='string'||value.png.length>Math.ceil(MAX_IMAGE/3)*4+4)throw Error('图片超过 8 MB');
    const png=Buffer.from(value.png,'base64');if(png.length<24||png.length>MAX_IMAGE||png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('图片格式无效');
    const width=png.readUInt32BE(16),height=png.readUInt32BE(20);if(!width||!height||width>16384||height>16384||width*height>64*1024*1024)throw Error('图片尺寸过大');
    return {kind:'image',png:png.toString('base64'),width,height,bytes:png.length};
  }
  throw Error('目前支持文本和图片');
}
const digest=v=>createHash('sha256').update(v.kind==='text'?'text\0'+v.text:'image\0'+v.png).digest('hex');
const metadata=item=>item?Object.fromEntries(['id','sourceId','kind','updatedAt','bytes','width','height','offline'].filter(k=>item[k]!==undefined).map(k=>[k,item[k]])):null;
class ClipboardShare extends EventEmitter{
  constructor({identity,read,write,getMode,getAutoSync=()=>false,getPeers,network}){super();Object.assign(this,{identity,read,write,getMode,getAutoSync,getPeers,network});this.latest=null;this.remote=new Map();this.error=null;this.polling=false;this.ignoredHash=null;this.session=randomUUID();this.clock=0;this.winner=null;this.seen=new Map();this.epoch=0;this.queue=Promise.resolve();this.closed=false;}
  autoSync(){return !this.closed&&this.getMode()==='auto'&&this.getAutoSync()===true;}
  serial(fn){const next=this.queue.then(fn);this.queue=next.catch(()=>{});return next;}
  start(){this.timer=setInterval(()=>{if(this.getMode()==='auto')this.capture().catch(()=>{});},500);this.pollTimer=setInterval(()=>this.pollPeers().catch(()=>{}),1000);this.timer.unref();this.pollTimer.unref();if(this.getMode()==='auto')this.capture().catch(()=>{});}
  close(){this.closed=true;this.epoch++;clearInterval(this.timer);clearInterval(this.pollTimer);this.latest=null;this.remote.clear();this.seen.clear();}
  changed(){this.emit('change');}
  modeChanged(){this.epoch++;this.seen.clear();if(this.getMode()==='off'){this.latest=null;this.remote.clear();this.error=null;this.changed();}else if(this.getMode()==='auto')this.capture().catch(()=>{});}
  focus(){if(this.getMode()==='focus')this.capture().catch(()=>{});}
  capture(){return this.serial(()=>this.captureNow());}
  async captureNow(){
    if(this.closed||this.getMode()==='off')throw Error('跨设备复制已关闭');const epoch=this.epoch;
    try{
      const raw=await this.read();if(this.closed||epoch!==this.epoch)return;if(!raw){this.ignoredHash=null;if(this.latest){this.latest=null;this.changed();}return;}
      const content=validateContent(raw),hash=digest(content);if(hash===this.ignoredHash||(!this.ignoredHash&&hash===this.latest?.hash))return this.latest;
      this.ignoredHash=null;const revision=++this.clock;this.winner={revision,sourceId:this.identity.id};this.latest={id:randomUUID(),sourceId:this.identity.id,updatedAt:Date.now(),revision,...content,hash};this.error=null;this.changed();return this.latest;
    }catch(e){this.error=e.message;this.changed();throw e;}
  }
  envelope(peer,after){const sync=seal({session:this.session,enabled:this.autoSync(),clock:this.clock},peer);if(this.getMode()==='off'||!this.latest)return {empty:true,sync};if(this.latest.id===after)return {unchanged:true,id:after,sync};const {hash,...item}=this.latest;return {payload:seal(item,peer),sync};}
  async writeItem(item){
    // Serialize writes with capture, and remember the OS-normalized PNG to avoid echoes.
    await this.write(item);this.ignoredHash=digest(item);
    try{const actual=await this.read();if(actual)this.ignoredHash=digest(validateContent(actual));}catch{}
  }
  async pollPeers(){
    if(this.closed||this.getMode()==='off'||this.polling)return;this.polling=true;const epoch=this.epoch;
    try{
      const peers=this.getPeers();for(const id of new Set([...this.remote.keys(),...this.seen.keys()]))if(!peers.some(p=>p.id===id)){this.remote.delete(id);this.seen.delete(id);}
      await Promise.allSettled(peers.map(async peer=>{
        const old=this.remote.get(peer.id);
        try{
          const response=await this.network.call(peer,'GET','/clipboard'+(old?'?after='+encodeURIComponent(old.id):''),undefined,15000);
          if(this.closed||epoch!==this.epoch||!this.getPeers().some(p=>p.id===peer.id))return;
          const sync=response.sync?unseal(response.sync,peer):null;
          const previous=this.seen.get(peer.id);
          const validSync=sync&&typeof sync.session==='string'&&sync.session.length<=100&&typeof sync.enabled==='boolean';
          const eligible=validSync&&previous?.session===sync.session&&previous.enabled&&sync.enabled;
          if(validSync)this.seen.set(peer.id,{session:sync.session,enabled:sync.enabled});else this.seen.delete(peer.id);
          if(validSync&&Number.isSafeInteger(sync.clock)&&sync.clock>=0&&sync.clock<Number.MAX_SAFE_INTEGER-1000)this.clock=Math.max(this.clock,sync.clock);
          if(response.empty){if(this.remote.delete(peer.id))this.changed();return;}
          if(response.unchanged){if(old?.offline){old.offline=false;this.changed();}return;}
          const value=unseal(response.payload,peer),content=validateContent(value);
          if(value.sourceId!==peer.id||typeof value.id!=='string'||value.id.length>100||!Number.isFinite(value.updatedAt))throw Error('剪贴板来源无效');
          this.remote.set(peer.id,{id:value.id,sourceId:peer.id,updatedAt:value.updatedAt,...content,offline:false});this.changed();
          if(Number.isSafeInteger(value.revision)&&value.revision>0){
            await this.serial(async()=>{
              if(this.closed||epoch!==this.epoch)return;
              // Capture a pending local copy before deciding which concurrent update wins.
              if(this.autoSync())await this.captureNow();
              this.clock=Math.max(this.clock,value.revision);
              const newer=!this.winner||value.revision>this.winner.revision||(value.revision===this.winner.revision&&value.sourceId>this.winner.sourceId);
              if(!eligible||!newer||!this.autoSync()||epoch!==this.epoch||!this.getPeers().some(p=>p.id===peer.id))return;
              try{await this.writeItem(content);this.winner={revision:value.revision,sourceId:value.sourceId};this.error=null;this.changed();}
              catch(e){this.error='自动同步失败：'+e.message;this.changed();}
            });
          }
        }catch{this.seen.delete(peer.id);if(old&&!old.offline){old.offline=true;this.changed();}}
      }));
    }finally{this.polling=false;}
  }
  status(){return {mode:this.getMode(),autoSync:this.autoSync(),local:metadata(this.latest),remote:[...this.remote.values()].map(metadata),error:this.error};}
  items(){return [this.latest,...this.remote.values()].filter(Boolean).map(({hash,...item})=>item);}
  copy(sourceId,itemId){return this.serial(async()=>{if(this.closed||this.getMode()==='off')throw Error('跨设备复制已关闭');const item=sourceId===this.identity.id?this.latest:this.remote.get(sourceId);if(!item||item.id!==itemId)throw Error('复制内容已更新，请刷新后重试');await this.writeItem(item);this.winner={revision:++this.clock,sourceId:this.identity.id};return metadata(item);});}
}
module.exports={ClipboardShare,seal,unseal,validateContent,MAX_WIRE};
