const http=require('node:http');
const dgram=require('node:dgram');
const os=require('node:os');
const net=require('node:net');
const {randomBytes,randomInt,timingSafeEqual}=require('node:crypto');
const PORT=43828, DISCOVERY_PORT=43829;
const normalizeIp=h=>String(h||'').replace(/^::ffff:/,'');
function isLan(h) {h=normalizeIp(h);return net.isIPv4(h)&&(/^(10\.|127\.|192\.168\.|169\.254\.)/.test(h)||(/^172\.(\d+)\./.test(h)&& +h.split('.')[1]>=16 && +h.split('.')[1]<=31));}
function addresses(){return Object.values(os.networkInterfaces()).flat().filter(i=>i&&i.family==='IPv4'&&!i.internal&&isLan(i.address)).map(i=>i.address);}
function safeEqual(a,b){return typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));}
function request(host,port,method,route,body,token,timeout=7000) {
  if(!isLan(host)||!Number.isInteger(port)||port<1||port>65535) return Promise.reject(Error('请输入局域网 IPv4 地址及有效端口'));
  return new Promise((resolve,reject)=>{
    const data=body===undefined?null:JSON.stringify(body);
    const req=http.request({host:normalizeIp(host),port,path:route,method,headers:{...(data?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}:{}),...(token?{'Authorization':`Bearer ${token}`}:{})}},res=>{
      const maxResponse=route.split('?')[0]==='/clipboard'?18*1024*1024:1024*1024;
      let text='';res.on('data',chunk=>{text+=chunk;if(text.length>maxResponse) res.destroy(Error('响应过大'));});
      res.on('error',reject);res.on('end',()=>{try{const result=JSON.parse(text);if(res.statusCode>=400) reject(Error(result.error||`HTTP ${res.statusCode}`));else resolve(result);}catch{reject(Error('对端响应无效'));}});
    });
    req.setTimeout(timeout,()=>req.destroy(Error('连接超时')));req.on('error',reject);if(data)req.write(data);req.end();
  });
}
function validIdentity(d){return d&&typeof d.id==='string'&&/^[a-f0-9-]{36}$/i.test(d.id)&&typeof d.name==='string'&&d.name.length>0&&d.name.length<=100&&['Windows','macOS'].includes(d.os);}
class Network {
  constructor({identity,getPeers,savePeer,removePeer,getStatus,getShortcuts,onProfile,onCommand,onChange}) {
    Object.assign(this,{identity,getPeers,savePeer,removePeer,getStatus,getShortcuts,onProfile,onCommand,onChange});
    this.discovered=new Map();this.attempts=new Map();this.pin=null;this.port=PORT;this.error=null;
  }
  pairingCode(){this.pin={code:String(randomInt(100000,1000000)),expires:Date.now()+300000};return this.pin;}
  async start(port=PORT) {
    this.server=http.createServer((req,res)=>this.handle(req,res));
    this.server.requestTimeout=10000;this.server.headersTimeout=8000;
    await new Promise((resolve,reject)=>{const fail=e=>{if(e.code==='EADDRINUSE'&&port!==0){this.server.listen(0,'0.0.0.0');port=0;}else reject(e);};this.server.on('error',fail);this.server.listen(port,'0.0.0.0',()=>{this.server.off('error',fail);this.server.on('error',e=>{this.error=e.message;this.onChange();});resolve();});});
    this.port=this.server.address().port;
    try {
      this.udp=dgram.createSocket({type:'udp4',reuseAddr:true});
      this.udp.on('error',e=>{this.error='自动发现不可用，可使用 IP 配对：'+e.message;this.onChange();});
      this.udp.on('message',(data,rinfo)=>{try{
        if(data.length>2048||!isLan(rinfo.address))return;
        const d=JSON.parse(data);if(d.app!=='displaybridge/1'||!validIdentity(d.device)||d.device.id===this.identity.id||!Number.isInteger(d.port)||d.port<1||d.port>65535)return;
        if(this.discovered.size>=64&&!this.discovered.has(d.device.id))return;
        this.discovered.set(d.device.id,{...d.device,host:rinfo.address,port:d.port,seenAt:Date.now()});this.onChange();
      }catch{}});
      this.udp.bind(DISCOVERY_PORT,()=>{this.udp.setBroadcast(true);this.announce();});
      this.timer=setInterval(()=>this.announce(),6000);this.timer.unref();
    }catch(e){this.error=e.message;}
  }
  announce(){
    for(const [id,d] of this.discovered)if(Date.now()-d.seenAt>20000)this.discovered.delete(id);
    const packet=Buffer.from(JSON.stringify({app:'displaybridge/1',device:this.identity,port:this.port}));
    if(this.udp)try{this.udp.send(packet,DISCOVERY_PORT,'255.255.255.255',()=>{});}catch{}
  }
  async handle(req,res) {
    const reply=(status,data)=>{if(!res.headersSent){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}};
    try {
      const host=normalizeIp(req.socket.remoteAddress);
      if(!isLan(host))return reply(403,{error:'仅允许局域网连接'});
      if(req.headers.origin)return reply(403,{error:'不接受网页发起的请求'});
      if(req.method==='GET'&&req.url==='/hello')return reply(200,{device:this.identity,port:this.port});
      const token=(req.headers.authorization||'').replace(/^Bearer /,'');
      const peer=this.getPeers().find(p=>safeEqual(p.inboundToken,token));
      if(req.url!=='/pair'&&!peer)return reply(401,{error:'尚未配对或配对已失效'});
      let data={};
      if(req.method==='POST') {
        let body='';for await(const chunk of req){body+=chunk;if(body.length>250000){reply(413,{error:'请求过大'});req.destroy();return;}}
        data=JSON.parse(body||'{}');
      }
      if(req.method==='POST'&&req.url==='/pair') {
        if(this.attempts.size>128)this.attempts.clear();
        let attempt=this.attempts.get(host);if(!attempt||Date.now()-attempt.since>300000)attempt={count:0,since:Date.now()};
        attempt.count++;this.attempts.set(host,attempt);
        if(attempt.count>8)return reply(429,{error:'尝试过多，请 5 分钟后重试'});
        if(!this.pin||Date.now()>this.pin.expires||!safeEqual(String(data.code),this.pin.code))return reply(403,{error:'配对码无效或已过期'});
        if(!validIdentity(data.device)||data.device.id===this.identity.id||!Number.isInteger(data.port)||data.port<1||data.port>65535||!/^[a-f0-9]{64}$/.test(data.token||''))return reply(400,{error:'设备信息无效'});
        const inboundToken=randomBytes(32).toString('hex');
        this.savePeer({...data.device,host,port:data.port,inboundToken,outboundToken:data.token});this.pin=null;
        return reply(200,{device:this.identity,token:inboundToken,port:this.port});
      }
      if(req.method==='GET'&&(req.url==='/status'||req.url==='/status?refresh=1'))return reply(200,await this.getStatus(req.url.includes('?refresh=1')));
      if(req.method==='GET'&&req.url==='/shortcuts'&&this.getShortcuts)return reply(200,await this.getShortcuts());
      if(req.method==='GET'&&req.url==='/keyboard'&&this.getKeyboard)return reply(200,await this.getKeyboard());
      if(req.method==='POST'&&req.url==='/keyboard-follow'&&this.onKeyboardFollow)return reply(200,await this.onKeyboardFollow(data));
      if(req.method==='GET'&&req.url==='/mouse'&&this.getMouse)return reply(200,await this.getMouse());
      if(req.method==='POST'&&req.url==='/mouse-follow'&&this.onMouseFollow)return reply(200,await this.onMouseFollow(data));
      if(req.method==='POST'&&req.url==='/keyboard-switch'&&this.onKeyboardSwitch)return reply(200,await this.onKeyboardSwitch(data));
      if(req.method==='POST'&&req.url==='/mouse-switch'&&this.onMouseSwitch)return reply(200,await this.onMouseSwitch(data));
      if(req.method==='GET'&&req.url.split('?')[0]==='/clipboard')return reply(200,this.getClipboard?await this.getClipboard(peer,new URL(req.url,'http://localhost').searchParams.get('after')):{empty:true});
      if(req.method==='POST'&&req.url==='/profile'){await this.onProfile(data,peer.id);return reply(200,{ok:true});}
      if(req.method==='POST'&&req.url==='/switch'){await this.onCommand(data);return reply(200,{ok:true});}
      if(req.method==='POST'&&req.url==='/unpair'){this.removePeer(peer.id);return reply(200,{ok:true});}
      reply(404,{error:'未知操作'});
    }catch(e){reply(400,{error:e.message});}
  }
  async pair(host,port,code) {
    const inboundToken=randomBytes(32).toString('hex');
    const result=await request(host,port,'POST','/pair',{device:this.identity,port:this.port,code,token:inboundToken});
    if(!validIdentity(result.device)||result.device.id===this.identity.id||!/^[a-f0-9]{64}$/.test(result.token||''))throw Error('对端身份无效');
    this.savePeer({...result.device,host,port:result.port,inboundToken,outboundToken:result.token});return result.device;
  }
  call(peer,method,route,body,timeout) {return request(peer.host,peer.port,method,route,body,peer.outboundToken,timeout);}
  close(){clearInterval(this.timer);if(this.udp)try{this.udp.close();}catch{}if(this.server)this.server.close();}
}
module.exports={Network,request,isLan,addresses,safeEqual};
