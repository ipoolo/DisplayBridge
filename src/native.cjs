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
    if(!fs.existsSync(file)) throw Error(this.platform==='darwin'?'Mac 控制组件未构建，请运行随附的 Mac 启动脚本':'Windows 控制组件缺失，请重新构建 native:win');
    return file;
  }
  async ensureMacHelper() {
    if(this.platform!=='darwin'||fs.existsSync(path.join(this.root,'m1ddc'))||!this.macSources)return;
    try{await run('/usr/bin/xcode-select',['-p'],5000);}catch{throw Error('首次运行需 Apple Command Line Tools：在 Mac 终端执行 xcode-select --install，安装完成后点击刷新状态');}
    const vendor=path.join(this.macSources,'vendor');fs.mkdirSync(this.root,{recursive:true});
    const output=path.join(this.root,'m1ddc.tmp');
    const args=['clang','-arch','arm64','-mmacosx-version-min=13.0','-O2','-fmodules','-DMAX_DISPLAYS=16','-I',path.join(vendor,'headers'),path.join(this.macSources,'DisplayDdc.m'),path.join(vendor,'sources/i2c.m'),path.join(vendor,'sources/ioregistry.m'),'-framework','Foundation','-framework','IOKit','-framework','CoreGraphics','-framework','ApplicationServices','-framework','CoreDisplay','-o',output];
    await run('/usr/bin/xcrun',args,60000);fs.chmodSync(output,0o755);fs.renameSync(output,path.join(this.root,'m1ddc'));
  }
  scan(probe=false) { return this.serial(async()=>{
    if(this.platform==='win32') {
      const rows=JSON.parse(await run(this.binary(),[probe?'probe':'status']));
      if(!Array.isArray(rows)) throw Error('显示器枚举失败');
      this.cache=rows.map(r=>({...this.cache.find(c=>c.id===r.id),...r,inputs:r.capabilities!==undefined?parseInputs(r.capabilities):(this.cache.find(c=>c.id===r.id)?.inputs||[]),observedAt:Date.now()}));
      return this.cache;
    }
    if(this.platform==='darwin') {
      await this.ensureMacHelper();
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
