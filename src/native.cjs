const { execFile } = require('node:child_process');
const path=require('node:path');
const fs=require('node:fs');
const {parseInputs}=require('./core.cjs');
function run(file,args,timeout=18000) {
  return new Promise((resolve,reject)=>execFile(file,args,{timeout,windowsHide:true,maxBuffer:1024*1024,encoding:'utf8'},(error,stdout,stderr)=>{
    if(error) reject(Error(error.killed?'显示器驱动响应超时':(stderr||stdout||error.message).trim().slice(0,500)));
    else resolve(stdout.replace(/^\uFEFF/,'').trim());
  }));
}
class NativeBackend {
  constructor(root,platform=process.platform) {this.platform=platform;this.root=root;this.tail=Promise.resolve();this.cache=[];}
  serial(fn) { const next=this.tail.then(fn,fn);this.tail=next.catch(()=>{});return next; }
  binary() {
    const file=path.join(this.root,this.platform==='win32'?'display-ddc.exe':'m1ddc');
    if(!fs.existsSync(file)) throw Error('显示器控制组件缺失，请重新安装完整的屏间安装包');
    return file;
  }
  scan(probe=false) { return this.serial(async()=>{
    if(this.platform==='win32') {
      const rows=JSON.parse(await run(this.binary(),[probe?'probe':'status']));
      if(!Array.isArray(rows)) throw Error('显示器枚举失败');
      this.cache=rows.map(r=>({...this.cache.find(c=>c.id===r.id),...r,inputs:r.capabilities!==undefined?parseInputs(r.capabilities):(this.cache.find(c=>c.id===r.id)?.inputs||[]),observedAt:Date.now()}));
      return this.cache;
    }
    if(this.platform==='darwin') {
      const rows=JSON.parse(await run(this.binary(),['displaybridge-list']));
      if(!Array.isArray(rows)) throw Error('Mac 显示器枚举失败');
      this.cache=rows.map(r=>({...r,inputs:[],observedAt:Date.now()}));return this.cache;
    }
    throw Error('目前支持 Windows 和 Apple Silicon Mac');
  }); }
  set(id,input) {return this.serial(async()=>{
    if(!Number.isInteger(input)||input<1||input>255||typeof id!=='string'||id.length>1024) throw Error('输入源参数无效');
    if(this.platform==='win32') { const result=JSON.parse(await run(this.binary(),['set',id,String(input)]));if(!result.ok) throw Error('显示器未接受切换指令'); }
    else await run(this.binary(),['display',id,'set','input',String(input)]);
  });}
}
module.exports={NativeBackend,run};
